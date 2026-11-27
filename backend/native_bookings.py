"""Branch-scoped native reservations. V1 accepts requests only; no payment."""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo
from uuid import UUID
import re

from fastapi import HTTPException, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Literal

class Settings(BaseModel):
    venue_enabled: bool = False
    table_enabled: bool = False
    opens_at: time = time(10)
    closes_at: time = time(22)
    weekdays: list[int] = Field(default_factory=lambda: list(range(1,8)), max_length=7)
    blocked_dates: list[date] = Field(default_factory=list,max_length=365)

class Resource(BaseModel):
    id: UUID | None = None
    kind: Literal["venue","table"]
    name: str = Field(min_length=1,max_length=100)
    capacity: int = Field(ge=1,le=1000)
    duration_minutes: int = Field(ge=30,le=720,multiple_of=30)
    price_centavos: int = Field(default=0,ge=0,le=100000000)
    active: bool = True

class RequestBooking(BaseModel):
    resource_id: UUID
    branch: str = Field(min_length=1,max_length=128)
    starts_at: datetime
    guests: int = Field(ge=1,le=1000)
    name: str = Field(min_length=1,max_length=100)
    phone: str = Field(min_length=7,max_length=30)
    note: str = Field(default="",max_length=500)
    request_id: UUID

class Transition(BaseModel):
    status: Literal["confirmed","declined","cancelled","completed"]

def booking_error(exc):
    message = getattr(exc,"message","")
    messages = {
        "unavailable": (409,"That time is no longer available. Select another slot."),
        "request_conflict": (409,"This request reference was already used for different details."),
        "rate_limit": (429,"Too many booking requests. Please try again later."),
        "not_found": (404,"Booking not found."),
        "resource_changed": (409,"Package details changed. Ask the customer to submit a new request."),
        "invalid_transition": (409,"This booking cannot move to that status."),
    }
    status, detail = messages.get(message,(503,"Booking service temporarily unavailable."))
    return HTTPException(status_code=status,detail=detail)

BOOKING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def short_booking_code(value):
    raw = UUID(str(value)).bytes
    n = (int.from_bytes(raw[:6],"big") << 12) | ((raw[6] & 15) << 8) | raw[7]
    return "".join(BOOKING_ALPHABET[(n >> (i*5)) & 31] for i in range(11,-1,-1))

def booking_lookup(value):
    # Legacy UUIDs remain valid. Short codes ignore case, hyphens, and whitespace.
    if len(value)>64: raise HTTPException(404,"Booking reference not found.")
    try: return "id",str(UUID(value.strip()))
    except ValueError: pass
    code=re.sub(r"[\s-]","",value.upper()).translate(str.maketrans("OIL","011"))
    if len(code)!=12 or any(c not in BOOKING_ALPHABET for c in code):
        raise HTTPException(404,"Booking reference not found.")
    return "booking_code",code

def normalize_phone(value):
    if not re.fullmatch(r"[\d+() .-]{7,30}",value):
        raise HTTPException(422,"Enter a valid contact number.")
    digits = re.sub(r"\D","",value)
    if len(digits)==11 and digits.startswith("09"): digits="63"+digits[1:]
    if not 7<=len(digits)<=15: raise HTTPException(422,"Enter a valid contact number.")
    return digits

def register_native_booking_routes(app, *, db, get_business, require_owner, read_card_token=None, get_customer=None, booking_operator=None):
    def business(slug, auth=None):
        if auth is not None: require_owner(slug,auth)
        b=get_business(slug)
        if not b: raise HTTPException(404,"Business not found.")
        if auth is None and str(b.get("status","")).upper()!="ACTIVE":
            raise HTTPException(404,"Bookings unavailable.")
        return b["id"]

    def booking_scope(slug, authorization, *, write=False):
        # Existing standalone callers remain owner-only. Production reuses the
        # live staff lookup, including current role and active branch assignment.
        if booking_operator is None:
            return business(slug, authorization), {"role": "owner", "branch": "", "all_branches": True}
        allowed = ("owner", "manager") if write else ("owner", "manager", "cashier")
        b, scope = booking_operator(slug, authorization, allow=allowed)
        role = scope.get("role")
        if role not in allowed or (not scope.get("branch") and not scope.get("all_branches")):
            raise HTTPException(403, "Reservation access is restricted to your assigned branch.")
        return b["id"], scope

    def member(slug, bid, authorization):
        parts = authorization.split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != "bearer" or not read_card_token or not get_customer:
            raise HTTPException(401, "Connect your loyalty card.")
        identity = read_card_token(parts[1], "session")
        merchant = get_business(slug)
        if not merchant or str(identity.get("business_public_id")) != str(merchant.get("public_id")):
            raise HTTPException(401, "Reconnect your loyalty card.")
        cid = str(identity.get("customer_public_id") or "")
        customer = get_customer(cid) if cid else None
        if not customer or str(customer.get("business_id")) != str(bid) or str(customer.get("public_id")) != cid:
            raise HTTPException(404, "Customer not found.")
        return customer["id"]

    @app.get("/api/v1/public/bookings/{slug}/history")
    def customer_history(slug: str, authorization: str = Header(default="")):
        bid = business(slug)
        cid = member(slug, bid, authorization)
        try:
            rows = (db.table("lt_bookings").select("id,booking_code,kind,resource_name,starts_at,ends_at,guests,status,price_centavos")
                    .eq("business_id", bid).eq("customer_id", cid).order("starts_at", desc=True).order("id").limit(101).execute().data or [])
        except Exception as exc:
            raise HTTPException(503, "Booking history unavailable.") from exc
        return JSONResponse({"bookings": rows[:100], "complete": len(rows) <= 100}, headers={"Cache-Control": "private, no-store"})

    def branches(bid):
        return [b for b in (db.table("branches").select("id,public_id,name").eq("business_id",bid).eq("is_active",True).order("name").execute().data or []) if b.get("public_id")]

    def branch(bid,slug):
        row=next((b for b in branches(bid) if b["public_id"]==slug),None)
        if row is None: raise HTTPException(404,"Branch not found.")
        return row["id"]

    def config(bid,br):
        rows=db.table("lt_booking_settings").select("*").eq("business_id",bid).eq("branch_id",br).limit(1).execute().data or []
        return rows[0] if rows else Settings().model_dump(mode="json")

    def resources(bid,br,active_only=False):
        query=db.table("lt_booking_resources").select("id,kind,name,capacity,duration_minutes,price_centavos,active").eq("business_id",bid).eq("branch_id",br)
        if active_only: query=query.eq("active",True)
        return query.order("name").execute().data or []

    def rpc(name,params):
        try: return db.rpc(name,params).execute().data
        except Exception as exc: raise booking_error(exc) from None

    @app.get("/api/v1/business/{slug}/native-bookings")
    def owner_bookings(slug:str, branch_id:str="", month:str="", authorization:str=Header(default="")):
        bid,scope=booking_scope(slug,authorization)
        locked=scope.get("branch") or ""
        if locked and branch_id and branch_id != locked:
            raise HTTPException(403,"You can only see reservations for your own branch.")
        month=month or datetime.now(ZoneInfo("Asia/Manila")).strftime("%Y-%m")
        try:
            if not re.fullmatch(r"\d{4}-\d{2}",month): raise ValueError("Invalid month")
            start=date.fromisoformat(month+"-01")
            end=date(start.year+int(start.month==12),start.month%12+1,1)
        except ValueError: raise HTTPException(422,"Choose a valid calendar month.")
        lower=datetime.combine(start,time.min,ZoneInfo("Asia/Manila")).isoformat()
        upper=datetime.combine(end,time.min,ZoneInfo("Asia/Manila")).isoformat()
        try:
            places=branches(bid)
            if locked:
                places=[p for p in places if p["public_id"] == locked]
                if not places: raise HTTPException(403,"Your branch is not available.")
            chosen=locked or branch_id or (places[0]["public_id"] if places else "")
            if not chosen: return {"branches":[],"branch":"","settings":Settings().model_dump(mode="json"),"resources":[],"bookings":[]}
            br=branch(bid,chosen)
            fields="id,booking_code,kind,resource_name,starts_at,ends_at,guests,customer_name,status,created_at"
            if scope["role"] != "cashier": fields+=",phone,note,price_centavos"
            rows=db.table("lt_bookings").select(fields).eq("business_id",bid).eq("branch_id",br).gte("starts_at",lower).lt("starts_at",upper).order("starts_at").limit(501).execute().data or []
            return {"branches":[{"public_id":b["public_id"],"name":b["name"]} for b in places],"branch":chosen,"settings":config(bid,br) if scope["role"]=="owner" else {},"resources":resources(bid,br) if scope["role"]=="owner" else [],"can_update":scope["role"] in ("owner","manager"),"bookings":rows[:500],"month":month,"truncated":len(rows)>500}
        except HTTPException: raise
        except Exception: raise HTTPException(503,"Booking service unavailable.")

    @app.put("/api/v1/business/{slug}/native-bookings/settings")
    def save_settings(slug:str,payload:Settings,branch_id:str,authorization:str=Header(default="")):
        bid=business(slug,authorization)
        if payload.opens_at.tzinfo or payload.closes_at.tzinfo or payload.opens_at>=payload.closes_at or any(d not in range(1,8) for d in payload.weekdays):
            raise HTTPException(422,"Choose valid same-day opening hours and weekdays.")
        try:
            br=branch(bid,branch_id)
            row=payload.model_dump(mode="json")|{"branch_id":br,"business_id":bid}
            db.table("lt_booking_settings").upsert(row,on_conflict="branch_id").execute()
            return {"success":True}
        except HTTPException: raise
        except Exception: raise HTTPException(503,"Could not save booking settings.")

    @app.post("/api/v1/business/{slug}/native-bookings/resources")
    def save_resource(slug:str,payload:Resource,branch_id:str,authorization:str=Header(default="")):
        bid=business(slug,authorization)
        if not payload.name.strip(): raise HTTPException(422,"Enter a resource name.")
        try:
            br=branch(bid,branch_id)
            data=payload.model_dump(mode="json",exclude={"id"})|{"name":payload.name.strip()}
            if payload.kind=="table" and payload.price_centavos: raise HTTPException(422,"Table deposits are not supported in V1.")
            if payload.id:
                # Do not allow branch, business or resource type reassignment.
                rows=db.table("lt_booking_resources").update(data).eq("id",str(payload.id)).eq("business_id",bid).eq("branch_id",br).eq("kind",payload.kind).execute().data or []
                if not rows: raise HTTPException(404,"Resource not found.")
            else:
                db.table("lt_booking_resources").insert(data|{"branch_id":br,"business_id":bid}).execute()
            return {"success":True}
        except HTTPException: raise
        except Exception: raise HTTPException(503,"Save branch settings first, then add resources.")

    @app.post("/api/v1/business/{slug}/native-bookings/{booking_id}/status")
    def set_status(slug:str,booking_id:UUID,payload:Transition,authorization:str=Header(default="")):
        bid,scope=booking_scope(slug,authorization,write=True)
        locked=scope.get("branch") or ""
        if locked:
            # Booking branch is immutable through the booking API. The RPC
            # still enforces tenant and transition/availability invariants.
            try:
                br=branch(bid,locked)
                rows=db.table("lt_bookings").select("id").eq("business_id",bid).eq("branch_id",br).eq("id",str(booking_id)).limit(1).execute().data or []
            except HTTPException: raise
            except Exception: raise HTTPException(503,"Booking service unavailable.")
            if not rows: raise HTTPException(404,"Booking not found.")
        return rpc("lt_booking_transition",{"p_business":bid,"p_id":str(booking_id),"p_status":payload.status})

    @app.get("/api/v1/public/bookings/{slug}")
    def public_catalog(slug:str):
        bid=business(slug)
        try:
            result=[]
            settings={row["branch_id"]:row for row in (db.table("lt_booking_settings").select("branch_id,venue_enabled,table_enabled").eq("business_id",bid).execute().data or [])}
            all_resources=db.table("lt_booking_resources").select("id,branch_id,kind,name,capacity,duration_minutes,price_centavos,active").eq("business_id",bid).eq("active",True).order("name").execute().data or []
            for b in branches(bid):
                s=settings.get(b["id"],{})
                rr=[{k:v for k,v in r.items() if k!="branch_id"} for r in all_resources if r["branch_id"]==b["id"] and s.get("venue_enabled" if r["kind"]=="venue" else "table_enabled")]
                if rr: result.append({"public_id":b["public_id"],"name":b["name"],"resources":rr})
            return {"branches":result}
        except Exception: raise HTTPException(503,"Bookings temporarily unavailable.")

    @app.get("/api/v1/public/bookings/{slug}/slots")
    def available(slug:str,branch_id:str,resource_id:UUID,day:date,guests:int=Query(ge=1,le=1000)):
        bid=business(slug)
        try: br=branch(bid,branch_id)
        except HTTPException: raise
        except Exception: raise HTTPException(503,"Bookings temporarily unavailable.")
        return {"slots":rpc("lt_booking_slots",{"p_business":bid,"p_branch":br,"p_resource":str(resource_id),"p_day":day.isoformat(),"p_guests":guests}) or []}

    @app.post("/api/v1/public/bookings/{slug}/request")
    def submit(slug:str,payload:RequestBooking,authorization:str=Header(default="")):
        bid=business(slug)
        if payload.starts_at.tzinfo is None or not payload.name.strip(): raise HTTPException(422,"Select a valid time and enter your name.")
        phone=normalize_phone(payload.phone)
        try: br=branch(bid,payload.branch)
        except HTTPException: raise
        except Exception: raise HTTPException(503,"Bookings temporarily unavailable.")
        cid=member(slug,bid,authorization) if authorization else None
        result=rpc("lt_booking_request_linked",{"p_business":bid,"p_branch":br,"p_resource":str(payload.resource_id),"p_start":payload.starts_at.astimezone(timezone.utc).isoformat(),"p_guests":payload.guests,"p_name":payload.name.strip(),"p_phone":phone,"p_note":payload.note.strip(),"p_request":str(payload.request_id),"p_customer":cid})
        return result | {"booking_code":short_booking_code(result["reference"])}

    @app.get("/api/v1/public/bookings/{slug}/status/{reference}")
    def public_status(slug:str,reference:str):
        bid=business(slug)
        field,value=booking_lookup(reference)
        try:
            rows=db.table("lt_bookings").select("status").eq("business_id",bid).eq(field,value).limit(1).execute().data or []
        except Exception: raise HTTPException(503,"Status temporarily unavailable.")
        if not rows: raise HTTPException(404,"Booking reference not found.")
        return rows[0]

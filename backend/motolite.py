import os
import uuid
import hashlib
import hmac
import json
import zipfile
from io import BytesIO
from datetime import datetime, timedelta
from typing import Optional, Literal, List

from fastapi import APIRouter, HTTPException, Header, Depends
from fastapi.responses import Response, RedirectResponse, HTMLResponse
from pydantic import BaseModel, Field
from supabase import create_client, Client

motolite_router = APIRouter(prefix="/api/v1/motolite", tags=["Motolite"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
MOTOLITE_BASE_URL = os.getenv("MOTOLITE_BASE_URL", os.getenv("BASE_URL", "http://localhost:8000"))
MOTOLITE_TOKEN_SECRET = os.getenv("MOTOLITE_TOKEN_SECRET", os.getenv("STAFF_SESSION_SECRET", "change-me-in-production"))
MOTOLITE_AUTH_SECRET = os.getenv("MOTOLITE_AUTH_SECRET", MOTOLITE_TOKEN_SECRET)
MOTOLITE_MASTER_USERNAME = os.getenv("MOTOLITE_MASTER_USERNAME", "")
MOTOLITE_MASTER_PASSWORD = os.getenv("MOTOLITE_MASTER_PASSWORD", "")
MOTOLITE_MASTER_NAME = os.getenv("MOTOLITE_MASTER_NAME", "Motolite National Admin")
MOTOLITE_EMERGENCY_NUMBER = os.getenv("MOTOLITE_EMERGENCY_NUMBER", "")

GOOGLE_WALLET_ISSUER_ID = os.getenv("GOOGLE_WALLET_ISSUER_ID", "")
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv("GOOGLE_WALLET_CLASS_SUFFIX", "")
APPLE_PASS_TYPE_IDENTIFIER = os.getenv("APPLE_PASS_TYPE_IDENTIFIER", "")
APPLE_TEAM_IDENTIFIER = os.getenv("APPLE_TEAM_IDENTIFIER", "")
MOTOLITE_GOOGLE_WALLET_CLASS_SUFFIX = os.getenv("MOTOLITE_GOOGLE_WALLET_CLASS_SUFFIX", "motolite_warranty")
MOTOLITE_WALLET_BACKGROUND_COLOR = os.getenv("MOTOLITE_WALLET_BACKGROUND_COLOR", "#d71920")

ROLE_NATIONAL = "national"
ROLE_REGIONAL = "regional"
ROLE_LOCAL = "local"
WARRANTY_ACTIVE = "active"
WARRANTY_EXPIRED = "expired"
WARRANTY_REPLACED = "replaced"


def _supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=503, detail="Supabase is not configured on this server.")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _public_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _parse_date(value: str) -> datetime:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid date '{value}'. Expected YYYY-MM-DD.")


def _warranty_expiry(start_date: str, months: int) -> str:
    import calendar
    start = _parse_date(start_date)
    year = start.year
    month = start.month - 1 + months
    year += month // 12
    month = month % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return datetime(year, month, day).strftime("%Y-%m-%d")


def _secure_qr_token(warranty_public_id: str) -> str:
    digest = hmac.new(MOTOLITE_TOKEN_SECRET.encode(), warranty_public_id.encode(), hashlib.sha256).hexdigest()
    return f"{warranty_public_id}.{digest[:32]}"


def _verify_qr_token(token: str) -> Optional[str]:
    if not token or "." not in token:
        return None
    warranty_public_id, supplied = token.rsplit(".", 1)
    expected = _secure_qr_token(warranty_public_id).rsplit(".", 1)[1]
    return warranty_public_id if hmac.compare_digest(supplied, expected) else None


def _get_one(table: str, field: str, value):
    rows = _supabase().table(table).select("*").eq(field, value).limit(1).execute().data or []
    return rows[0] if rows else None


def _insert(table: str, payload: dict):
    rows = _supabase().table(table).insert(payload).execute().data or []
    return rows[0] if rows else payload


def _update(table: str, public_id: str, payload: dict):
    rows = _supabase().table(table).update(payload).eq("public_id", public_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Record not found")
    return rows[0]


def _require_record(table: str, public_id: str, label: str):
    row = _get_one(table, "public_id", public_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return row


# ---------------- AUTH ----------------
def _hash_password(password: str, salt_hex: Optional[str] = None):
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210000)
    return salt.hex(), digest.hex()


def _verify_password(password: str, salt_hex: str, expected_hex: str) -> bool:
    _, actual = _hash_password(password, salt_hex)
    return hmac.compare_digest(actual, expected_hex)


def _make_session(staff: dict) -> str:
    try:
        import jwt
        now = datetime.utcnow()
        payload = {
            "sub": staff["public_id"],
            "role": staff["role"],
            "region": staff.get("region_public_id"),
            "branch": staff.get("branch_public_id"),
            "iat": now,
            "exp": now + timedelta(hours=12),
            "typ": "motolite_staff",
        }
        token = jwt.encode(payload, MOTOLITE_AUTH_SECRET, algorithm="HS256")
        return token if isinstance(token, str) else token.decode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not create staff session: {exc}")


def _decode_session(token: str) -> dict:
    try:
        import jwt
        data = jwt.decode(token, MOTOLITE_AUTH_SECRET, algorithms=["HS256"])
        if data.get("typ") != "motolite_staff":
            raise ValueError("wrong token type")
        return data
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired Motolite staff session.")


def _public_staff(staff: dict) -> dict:
    hidden = {"password_hash", "password_salt"}
    return {k: v for k, v in staff.items() if k not in hidden}


def _bootstrap_master_if_needed(username: str, password: str):
    db = _supabase()
    existing = db.table("motolite_staff_scope").select("public_id").limit(1).execute().data or []
    if existing:
        return None
    if not MOTOLITE_MASTER_USERNAME or not MOTOLITE_MASTER_PASSWORD:
        return None
    if not (hmac.compare_digest(username, MOTOLITE_MASTER_USERNAME) and hmac.compare_digest(password, MOTOLITE_MASTER_PASSWORD)):
        return None
    salt, pwd_hash = _hash_password(password)
    pid = _public_id("mts")
    return _insert("motolite_staff_scope", {
        "public_id": pid,
        "user_id": pid,
        "full_name": MOTOLITE_MASTER_NAME,
        "username": username,
        "email": None,
        "password_salt": salt,
        "password_hash": pwd_hash,
        "role": ROLE_NATIONAL,
        "region_public_id": None,
        "branch_public_id": None,
        "is_active": True,
        "created_by_public_id": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    })


def current_staff(authorization: Optional[str] = Header(default=None, alias="Authorization")) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Motolite staff login required.")
    claims = _decode_session(authorization[7:].strip())
    staff = _get_one("motolite_staff_scope", "public_id", claims.get("sub"))
    if not staff or not staff.get("is_active", True):
        raise HTTPException(status_code=401, detail="Staff account is disabled or missing.")
    return staff


def _require_roles(staff: dict, *roles):
    if staff.get("role") not in roles:
        raise HTTPException(status_code=403, detail="You do not have permission for this action.")


def _can_access_branch(staff: dict, branch_public_id: str) -> bool:
    role = staff.get("role")
    if role == ROLE_NATIONAL:
        return True
    if role == ROLE_LOCAL:
        return staff.get("branch_public_id") == branch_public_id
    if role == ROLE_REGIONAL:
        branch = _get_one("motolite_branches", "public_id", branch_public_id)
        return bool(branch and branch.get("region_public_id") == staff.get("region_public_id"))
    return False


class LoginRequest(BaseModel):
    username: str
    password: str


class StaffCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    email: Optional[str] = None
    role: Literal["national", "regional", "local"]
    region_public_id: Optional[str] = None
    branch_public_id: Optional[str] = None


class StaffStatusUpdate(BaseModel):
    is_active: bool


class StaffPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class RegionCreate(BaseModel):
    name: str
    code: Optional[str] = None


class BranchCreate(BaseModel):
    region_public_id: str
    name: str
    branch_code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    is_active: bool = True


class MemberCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    preferred_branch_public_id: Optional[str] = None


class MemberUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    preferred_branch_public_id: Optional[str] = None


class VehicleCreate(BaseModel):
    member_public_id: str
    make: str
    model: str
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    plate_number: Optional[str] = None
    color: Optional[str] = None


class BatteryCreate(BaseModel):
    member_public_id: str
    vehicle_public_id: Optional[str] = None
    original_branch_public_id: str
    product_name: str
    model_code: Optional[str] = None
    serial_number: str
    purchase_date: str
    installation_date: Optional[str] = None
    warranty_months: int = Field(default=12, ge=1, le=120)
    purchase_price: Optional[float] = Field(default=None, ge=0)
    receipt_number: Optional[str] = None
    notes: Optional[str] = None


class WarrantyActionCreate(BaseModel):
    warranty_public_id: str
    servicing_branch_public_id: str
    service_type: Literal["inspection", "warranty_claim", "replacement", "battery_check", "emergency_assistance", "other"]
    notes: Optional[str] = None
    result: Optional[str] = None
    replacement_battery_product_name: Optional[str] = None
    replacement_battery_model_code: Optional[str] = None
    replacement_serial_number: Optional[str] = None


@motolite_router.get("/health")
async def health():
    return {"ok": True, "service": "motolite", "mode": "single-file-auth", "database_configured": bool(SUPABASE_URL and SUPABASE_KEY), "wallet": {"apple_configured": bool(APPLE_PASS_TYPE_IDENTIFIER and APPLE_TEAM_IDENTIFIER), "google_configured": bool(GOOGLE_WALLET_ISSUER_ID)}}


@motolite_router.post("/auth/login")
async def login(payload: LoginRequest):
    _bootstrap_master_if_needed(payload.username.strip(), payload.password)
    staff = _get_one("motolite_staff_scope", "username", payload.username.strip())
    if not staff or not staff.get("is_active", True) or not staff.get("password_hash") or not staff.get("password_salt"):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    if not _verify_password(payload.password, staff["password_salt"], staff["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    _supabase().table("motolite_staff_scope").update({"last_login_at": _now_iso(), "updated_at": _now_iso()}).eq("public_id", staff["public_id"]).execute()
    staff["last_login_at"] = _now_iso()
    return {"token": _make_session(staff), "staff": _public_staff(staff)}


@motolite_router.get("/auth/me")
async def me(staff: dict = Depends(current_staff)):
    return _public_staff(staff)


@motolite_router.get("/staff")
async def list_staff(staff: dict = Depends(current_staff)):
    _require_roles(staff, ROLE_NATIONAL, ROLE_REGIONAL)
    db = _supabase()
    q = db.table("motolite_staff_scope").select("*")
    if staff["role"] == ROLE_REGIONAL:
        q = q.eq("region_public_id", staff.get("region_public_id"))
    rows = q.order("created_at", desc=True).execute().data or []
    return [_public_staff(x) for x in rows]


@motolite_router.post("/staff")
async def create_staff(payload: StaffCreate, staff: dict = Depends(current_staff)):
    _require_roles(staff, ROLE_NATIONAL, ROLE_REGIONAL)
    if staff["role"] == ROLE_REGIONAL and payload.role != ROLE_LOCAL:
        raise HTTPException(status_code=403, detail="Regional accounts can create Local accounts only.")
    if staff["role"] == ROLE_REGIONAL:
        if payload.region_public_id != staff.get("region_public_id"):
            raise HTTPException(status_code=403, detail="Regional accounts can only create staff in their own region.")
    if payload.role == ROLE_REGIONAL:
        if not payload.region_public_id:
            raise HTTPException(status_code=400, detail="Regional account requires a region.")
        _require_record("motolite_regions", payload.region_public_id, "Region")
    if payload.role == ROLE_LOCAL:
        if not payload.branch_public_id:
            raise HTTPException(status_code=400, detail="Local account requires a branch.")
        branch = _require_record("motolite_branches", payload.branch_public_id, "Branch")
        region_id = payload.region_public_id or branch.get("region_public_id")
        if branch.get("region_public_id") != region_id:
            raise HTTPException(status_code=400, detail="Branch does not belong to the selected region.")
        if staff["role"] == ROLE_REGIONAL and region_id != staff.get("region_public_id"):
            raise HTTPException(status_code=403, detail="Branch is outside your region.")
    else:
        region_id = payload.region_public_id
    if _get_one("motolite_staff_scope", "username", payload.username.strip()):
        raise HTTPException(status_code=409, detail="Username already exists.")
    salt, pwd_hash = _hash_password(payload.password)
    pid = _public_id("mts")
    row = _insert("motolite_staff_scope", {
        "public_id": pid, "user_id": pid, "full_name": payload.full_name,
        "username": payload.username.strip(), "email": payload.email,
        "password_salt": salt, "password_hash": pwd_hash, "role": payload.role,
        "region_public_id": region_id, "branch_public_id": payload.branch_public_id if payload.role == ROLE_LOCAL else None,
        "is_active": True, "created_by_public_id": staff["public_id"], "created_at": _now_iso(), "updated_at": _now_iso(),
    })
    return _public_staff(row)


@motolite_router.patch("/staff/{staff_public_id}/status")
async def set_staff_status(staff_public_id: str, payload: StaffStatusUpdate, staff: dict = Depends(current_staff)):
    _require_roles(staff, ROLE_NATIONAL, ROLE_REGIONAL)
    target = _require_record("motolite_staff_scope", staff_public_id, "Staff")
    if target["public_id"] == staff["public_id"] and not payload.is_active:
        raise HTTPException(status_code=400, detail="You cannot disable your own account.")
    if staff["role"] == ROLE_REGIONAL and (target.get("role") != ROLE_LOCAL or target.get("region_public_id") != staff.get("region_public_id")):
        raise HTTPException(status_code=403, detail="Regional accounts can manage Local staff in their own region only.")
    return _public_staff(_update("motolite_staff_scope", staff_public_id, {"is_active": payload.is_active, "updated_at": _now_iso()}))


@motolite_router.post("/staff/{staff_public_id}/reset-password")
async def reset_staff_password(staff_public_id: str, payload: StaffPasswordReset, staff: dict = Depends(current_staff)):
    _require_roles(staff, ROLE_NATIONAL, ROLE_REGIONAL)
    target = _require_record("motolite_staff_scope", staff_public_id, "Staff")
    if staff["role"] == ROLE_REGIONAL and (target.get("role") != ROLE_LOCAL or target.get("region_public_id") != staff.get("region_public_id")):
        raise HTTPException(status_code=403, detail="Regional accounts can reset Local staff in their own region only.")
    salt, pwd_hash = _hash_password(payload.new_password)
    _update("motolite_staff_scope", staff_public_id, {"password_salt": salt, "password_hash": pwd_hash, "updated_at": _now_iso()})
    return {"ok": True}


@motolite_router.get("/regions")
async def regions():
    return _supabase().table("motolite_regions").select("*").order("name").execute().data or []


@motolite_router.post("/regions")
async def create_region(payload: RegionCreate, staff: dict = Depends(current_staff)):
    _require_roles(staff, ROLE_NATIONAL)
    return _insert("motolite_regions", {"public_id": _public_id("mtr"), "name": payload.name, "code": payload.code, "is_active": True, "created_at": _now_iso(), "updated_at": _now_iso()})


@motolite_router.get("/branches")
async def branches(region_public_id: Optional[str] = None):
    q = _supabase().table("motolite_branches").select("*")
    if region_public_id:
        q = q.eq("region_public_id", region_public_id)
    return q.order("name").execute().data or []


@motolite_router.post("/branches")
async def create_branch(payload: BranchCreate, staff: dict = Depends(current_staff)):
    _require_roles(staff, ROLE_NATIONAL)
    _require_record("motolite_regions", payload.region_public_id, "Region")
    return _insert("motolite_branches", {"public_id": _public_id("mtb"), "region_public_id": payload.region_public_id, "name": payload.name, "branch_code": payload.branch_code, "address": payload.address, "city": payload.city, "province": payload.province, "latitude": payload.latitude, "longitude": payload.longitude, "phone": payload.phone, "is_active": payload.is_active, "created_at": _now_iso(), "updated_at": _now_iso()})


def _branch_for_staff(staff: dict, requested: Optional[str]) -> Optional[str]:
    if staff["role"] == ROLE_LOCAL:
        return staff.get("branch_public_id")
    if requested and not _can_access_branch(staff, requested):
        raise HTTPException(status_code=403, detail="You cannot use that branch.")
    return requested


@motolite_router.post("/members")
async def create_member(payload: MemberCreate, staff: dict = Depends(current_staff)):
    branch_id = _branch_for_staff(staff, payload.preferred_branch_public_id)
    if not branch_id:
        raise HTTPException(status_code=400, detail="A branch is required for member registration.")
    _require_record("motolite_branches", branch_id, "Branch")
    if _get_one("motolite_members", "phone", payload.phone):
        raise HTTPException(status_code=409, detail="A Motolite member with this phone number already exists.")
    return _insert("motolite_members", {"public_id": _public_id("mtm"), "member_number": f"MTL-{datetime.utcnow().strftime('%Y')}-{uuid.uuid4().hex[:8].upper()}", "name": payload.name, "phone": payload.phone, "email": payload.email, "address": payload.address, "city": payload.city, "province": payload.province, "preferred_branch_public_id": branch_id, "created_by_branch_public_id": branch_id, "is_active": True, "created_at": _now_iso(), "updated_at": _now_iso()})


@motolite_router.get("/members")
async def list_members(q: Optional[str] = None, staff: dict = Depends(current_staff)):
    db = _supabase(); query = db.table("motolite_members").select("*")
    if staff["role"] == ROLE_LOCAL:
        query = query.eq("preferred_branch_public_id", staff.get("branch_public_id"))
    elif staff["role"] == ROLE_REGIONAL:
        bs = db.table("motolite_branches").select("public_id").eq("region_public_id", staff.get("region_public_id")).execute().data or []
        ids = [b["public_id"] for b in bs]
        if not ids: return []
        query = query.in_("preferred_branch_public_id", ids)
    rows = query.order("created_at", desc=True).limit(500).execute().data or []
    if q:
        n=q.lower().strip(); rows=[r for r in rows if n in str(r.get("name","")).lower() or n in str(r.get("phone","")).lower() or n in str(r.get("member_number","")).lower()]
    return rows


@motolite_router.get("/members/{member_public_id}")
async def get_member(member_public_id: str, staff: dict = Depends(current_staff)):
    member = _require_record("motolite_members", member_public_id, "Member")
    if member.get("preferred_branch_public_id") and not _can_access_branch(staff, member["preferred_branch_public_id"]):
        raise HTTPException(status_code=403, detail="Member is outside your authorized scope.")
    db=_supabase()
    return {"member": member, "vehicles": db.table("motolite_vehicles").select("*").eq("member_public_id",member_public_id).execute().data or [], "batteries": db.table("motolite_batteries").select("*").eq("member_public_id",member_public_id).execute().data or [], "warranties": db.table("motolite_warranties").select("*").eq("member_public_id",member_public_id).execute().data or []}


@motolite_router.post("/vehicles")
async def create_vehicle(payload: VehicleCreate, staff: dict = Depends(current_staff)):
    member = _require_record("motolite_members", payload.member_public_id, "Member")
    if not _can_access_branch(staff, member.get("preferred_branch_public_id")):
        raise HTTPException(status_code=403, detail="Member is outside your authorized scope.")
    return _insert("motolite_vehicles", {"public_id": _public_id("mtv"), "member_public_id": payload.member_public_id, "make": payload.make, "model": payload.model, "year": payload.year, "plate_number": payload.plate_number, "color": payload.color, "is_active": True, "created_at": _now_iso(), "updated_at": _now_iso()})


@motolite_router.post("/batteries")
async def register_battery(payload: BatteryCreate, staff: dict = Depends(current_staff)):
    if not _can_access_branch(staff, payload.original_branch_public_id):
        raise HTTPException(status_code=403, detail="You cannot register batteries for that branch.")
    member=_require_record("motolite_members",payload.member_public_id,"Member")
    if payload.vehicle_public_id:
        vehicle=_require_record("motolite_vehicles",payload.vehicle_public_id,"Vehicle")
        if vehicle.get("member_public_id") != payload.member_public_id: raise HTTPException(status_code=400,detail="Vehicle does not belong to this member.")
    branch=_require_record("motolite_branches",payload.original_branch_public_id,"Branch")
    if _get_one("motolite_batteries","serial_number",payload.serial_number): raise HTTPException(status_code=409,detail="This battery serial number is already registered.")
    purchase=_parse_date(payload.purchase_date).strftime("%Y-%m-%d"); install=_parse_date(payload.installation_date).strftime("%Y-%m-%d") if payload.installation_date else purchase
    bid=_public_id("mtbat"); wid=_public_id("mtw")
    battery={"public_id":bid,"member_public_id":payload.member_public_id,"vehicle_public_id":payload.vehicle_public_id,"original_branch_public_id":payload.original_branch_public_id,"product_name":payload.product_name,"model_code":payload.model_code,"serial_number":payload.serial_number,"purchase_date":purchase,"installation_date":install,"purchase_price":payload.purchase_price,"receipt_number":payload.receipt_number,"notes":payload.notes,"status":"installed","created_at":_now_iso(),"updated_at":_now_iso()}
    warranty={"public_id":wid,"member_public_id":payload.member_public_id,"battery_public_id":bid,"vehicle_public_id":payload.vehicle_public_id,"original_branch_public_id":payload.original_branch_public_id,"region_public_id":branch.get("region_public_id"),"warranty_months":payload.warranty_months,"start_date":install,"expires_at":_warranty_expiry(install,payload.warranty_months),"status":WARRANTY_ACTIVE,"qr_token":_secure_qr_token(wid),"replacement_count":0,"created_at":_now_iso(),"updated_at":_now_iso()}
    db=_supabase(); b=(db.table("motolite_batteries").insert(battery).execute().data or [battery])[0]
    try: w=(db.table("motolite_warranties").insert(warranty).execute().data or [warranty])[0]
    except Exception:
        try: db.table("motolite_batteries").delete().eq("public_id",bid).execute()
        except Exception: pass
        raise
    return {"battery":b,"warranty":w,"qr_verification_url":f"{MOTOLITE_BASE_URL}/api/v1/motolite/warranty/verify/{warranty['qr_token']}","wallet":{"landing_url":f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/{wid}","qr_svg_url":f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/qr/{wid}.svg","apple_url":f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/apple/{wid}","google_url":f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/google/{wid}"}}


def _warranty_response(wid: str):
    w=_require_record("motolite_warranties",wid,"Warranty"); db=_supabase()
    computed=w.get("status")
    if computed==WARRANTY_ACTIVE and w.get("expires_at") and _parse_date(w["expires_at"])<datetime.utcnow(): computed=WARRANTY_EXPIRED
    return {"warranty":{**w,"computed_status":computed},"member":_get_one("motolite_members","public_id",w.get("member_public_id")),"battery":_get_one("motolite_batteries","public_id",w.get("battery_public_id")),"vehicle":_get_one("motolite_vehicles","public_id",w.get("vehicle_public_id")) if w.get("vehicle_public_id") else None,"original_branch":_get_one("motolite_branches","public_id",w.get("original_branch_public_id")),"history":db.table("motolite_warranty_actions").select("*").eq("warranty_public_id",wid).order("created_at",desc=True).execute().data or []}


@motolite_router.get("/warranties/{warranty_public_id}")
async def get_warranty(warranty_public_id: str, staff: dict = Depends(current_staff)):
    w=_require_record("motolite_warranties",warranty_public_id,"Warranty")
    if not _can_access_branch(staff,w.get("original_branch_public_id")): raise HTTPException(status_code=403,detail="Warranty is outside your authorized scope.")
    return _warranty_response(warranty_public_id)


@motolite_router.get("/warranty/verify/{token}")
async def verify_warranty(token: str):
    wid=_verify_qr_token(token)
    if not wid: raise HTTPException(status_code=400,detail="Invalid warranty QR token.")
    return _warranty_response(wid)


@motolite_router.post("/warranty-actions")
async def warranty_action(payload: WarrantyActionCreate, staff: dict = Depends(current_staff)):
    if not _can_access_branch(staff,payload.servicing_branch_public_id): raise HTTPException(status_code=403,detail="You cannot service from that branch.")
    w=_require_record("motolite_warranties",payload.warranty_public_id,"Warranty")
    _require_record("motolite_branches",payload.servicing_branch_public_id,"Branch")
    action=_insert("motolite_warranty_actions",{"public_id":_public_id("mta"),"warranty_public_id":payload.warranty_public_id,"member_public_id":w.get("member_public_id"),"battery_public_id":w.get("battery_public_id"),"servicing_branch_public_id":payload.servicing_branch_public_id,"service_type":payload.service_type,"notes":payload.notes,"result":payload.result,"created_at":_now_iso()})
    replacement=None
    if payload.service_type=="replacement":
        if not payload.replacement_serial_number: raise HTTPException(status_code=400,detail="Replacement serial number is required.")
        old=_require_record("motolite_batteries",w.get("battery_public_id"),"Original battery"); nid=_public_id("mtbat")
        replacement=_insert("motolite_batteries",{"public_id":nid,"member_public_id":w.get("member_public_id"),"vehicle_public_id":w.get("vehicle_public_id"),"original_branch_public_id":payload.servicing_branch_public_id,"product_name":payload.replacement_battery_product_name or old.get("product_name"),"model_code":payload.replacement_battery_model_code or old.get("model_code"),"serial_number":payload.replacement_serial_number,"purchase_date":datetime.utcnow().strftime("%Y-%m-%d"),"installation_date":datetime.utcnow().strftime("%Y-%m-%d"),"status":"installed","notes":f"Warranty replacement for {payload.warranty_public_id}","created_at":_now_iso(),"updated_at":_now_iso()})
        db=_supabase(); db.table("motolite_batteries").update({"status":"replaced","updated_at":_now_iso()}).eq("public_id",w.get("battery_public_id")).execute(); db.table("motolite_warranties").update({"status":WARRANTY_REPLACED,"replacement_count":int(w.get("replacement_count") or 0)+1,"replacement_battery_public_id":nid,"updated_at":_now_iso()}).eq("public_id",payload.warranty_public_id).execute()
    return {"action":action,"replacement_battery":replacement}


def _dashboard_counts(branch_ids: Optional[List[str]]):
    db=_supabase(); mq=db.table("motolite_members").select("public_id,preferred_branch_public_id"); wq=db.table("motolite_warranties").select("public_id,status,original_branch_public_id,expires_at"); aq=db.table("motolite_warranty_actions").select("public_id,servicing_branch_public_id,service_type")
    if branch_ids is not None:
        if not branch_ids:return {"members":0,"warranties":0,"active_warranties":0,"replacements":0,"claims":0}
        mq=mq.in_("preferred_branch_public_id",branch_ids); wq=wq.in_("original_branch_public_id",branch_ids); aq=aq.in_("servicing_branch_public_id",branch_ids)
    ms=mq.execute().data or []; ws=wq.execute().data or []; acts=aq.execute().data or []; now=datetime.utcnow(); active=sum(1 for w in ws if w.get("status")==WARRANTY_ACTIVE and (not w.get("expires_at") or _parse_date(w["expires_at"])>=now))
    return {"members":len(ms),"warranties":len(ws),"active_warranties":active,"replacements":sum(a.get("service_type")=="replacement" for a in acts),"claims":sum(a.get("service_type")=="warranty_claim" for a in acts)}


@motolite_router.get("/dashboard")
async def dashboard(staff: dict = Depends(current_staff)):
    db=_supabase(); role=staff["role"]
    if role==ROLE_NATIONAL:
        branches=db.table("motolite_branches").select("public_id").execute().data or []; regions=db.table("motolite_regions").select("public_id").execute().data or []
        return {"scope":"national","regions":len(regions),"branches":len(branches),**_dashboard_counts(None)}
    if role==ROLE_REGIONAL:
        bs=db.table("motolite_branches").select("public_id").eq("region_public_id",staff.get("region_public_id")).execute().data or []; ids=[b["public_id"] for b in bs]
        return {"scope":"regional","region_public_id":staff.get("region_public_id"),"branches":len(ids),**_dashboard_counts(ids)}
    return {"scope":"local","branch":_get_one("motolite_branches","public_id",staff.get("branch_public_id")),**_dashboard_counts([staff.get("branch_public_id")])}


def _wallet_payload(wid: str):
    w=_require_record("motolite_warranties",wid,"Warranty"); m=_require_record("motolite_members",w.get("member_public_id"),"Member"); b=_require_record("motolite_batteries",w.get("battery_public_id"),"Battery"); v=_get_one("motolite_vehicles","public_id",w.get("vehicle_public_id")) if w.get("vehicle_public_id") else None
    return {"member_public_id":m.get("public_id"),"member_number":m.get("member_number"),"member_name":m.get("name"),"battery_product":b.get("product_name"),"battery_model":b.get("model_code"),"serial_number":b.get("serial_number"),"vehicle":f"{v.get('make')} {v.get('model')}" if v else None,"plate_number":v.get("plate_number") if v else None,"warranty_public_id":w.get("public_id"),"warranty_status":w.get("status"),"warranty_expires_at":w.get("expires_at"),"qr_token":w.get("qr_token"),"qr_verification_url":f"{MOTOLITE_BASE_URL}/api/v1/motolite/warranty/verify/{w.get('qr_token')}","emergency_number":MOTOLITE_EMERGENCY_NUMBER}


def _google_class_id(): return f"{GOOGLE_WALLET_ISSUER_ID}.{MOTOLITE_GOOGLE_WALLET_CLASS_SUFFIX}"


def _ensure_google_class():
    try:
        import main as pm, httpx
        token=pm.get_google_access_token()
        if not token:return False
        cid=_google_class_id(); headers={"Authorization":f"Bearer {token}","Content-Type":"application/json"}
        with httpx.Client(timeout=20) as c:
            r=c.get(f"https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{cid}",headers=headers)
            if r.status_code==200:return True
            logo=getattr(pm,"DEFAULT_LOGO_URL",None)
            body={"id":cid,"issuerName":"Motolite","programName":"Motolite Digital Warranty","reviewStatus":"UNDER_REVIEW","hexBackgroundColor":MOTOLITE_WALLET_BACKGROUND_COLOR}
            if logo:body["programLogo"]={"sourceUri":{"uri":logo}}
            r=c.post("https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass",headers=headers,json=body)
            return r.status_code in (200,201,409)
    except Exception as e:
        print("MOTOLITE Google class error",e); return False


def _google_object(wid: str):
    p=_wallet_payload(wid); verification=p["qr_verification_url"]
    return {"id":f"{GOOGLE_WALLET_ISSUER_ID}.motolite_{wid}","classId":_google_class_id(),"state":"active","accountId":str(p.get("member_number")),"accountName":str(p.get("member_name")),"loyaltyPoints":{"label":"Warranty","balance":{"string":str(p.get("warranty_status") or "active").upper()}},"barcode":{"type":"QR_CODE","value":verification,"alternateText":str(p.get("member_number"))},"textModulesData":[{"header":"Motolite Digital Warranty","body":str(p.get("member_name"))},{"header":"BATTERY","body":str(p.get("battery_product"))},{"header":"SERIAL","body":str(p.get("serial_number"))},{"header":"VEHICLE","body":f"{p.get('vehicle') or '—'} · {p.get('plate_number') or '—'}"},{"header":"VALID UNTIL","body":str(p.get("warranty_expires_at"))}],"linksModuleData":{"uris":[{"uri":verification,"description":"Open verified warranty details"}]}}


def _apple_pkpass(wid: str):
    try:
        import main as pm
        if pm.get_apple_pass_credentials() is None:return None
        p=_wallet_payload(wid); verification=p["qr_verification_url"]
        pj={"formatVersion":1,"passTypeIdentifier":APPLE_PASS_TYPE_IDENTIFIER,"serialNumber":f"motolite-{wid}","teamIdentifier":APPLE_TEAM_IDENTIFIER,"organizationName":"Motolite","description":"Motolite Digital Warranty","logoText":"Motolite","foregroundColor":"rgb(255,255,255)","backgroundColor":"rgb(215,25,32)","labelColor":"rgb(255,215,0)","barcode":{"format":"PKBarcodeFormatQR","message":verification,"messageEncoding":"iso-8859-1","altText":str(p.get("member_number"))},"barcodes":[{"format":"PKBarcodeFormatQR","message":verification,"messageEncoding":"iso-8859-1","altText":str(p.get("member_number"))}],"storeCard":{"headerFields":[{"key":"status","label":"WARRANTY","value":str(p.get("warranty_status") or "active").upper()}],"primaryFields":[{"key":"member","label":"MEMBER","value":str(p.get("member_name"))}],"secondaryFields":[{"key":"battery","label":"BATTERY","value":str(p.get("battery_product"))},{"key":"expiry","label":"VALID UNTIL","value":str(p.get("warranty_expires_at"))}],"auxiliaryFields":[{"key":"member_number","label":"MEMBER ID","value":str(p.get("member_number"))},{"key":"serial","label":"SERIAL","value":str(p.get("serial_number"))}],"backFields":[{"key":"vehicle","label":"Vehicle","value":str(p.get("vehicle") or "—")},{"key":"plate","label":"Plate Number","value":str(p.get("plate_number") or "—")},{"key":"verification","label":"Warranty Verification","value":verification},{"key":"emergency","label":"Emergency Assistance","value":str(p.get("emergency_number") or "Motolite Hotline")} ]}}
        files={"pass.json":json.dumps(pj).encode(),"icon.png":pm.generate_apple_icon_bytes(MOTOLITE_WALLET_BACKGROUND_COLOR,"M",29),"icon@2x.png":pm.generate_apple_icon_bytes(MOTOLITE_WALLET_BACKGROUND_COLOR,"M",58),"icon@3x.png":pm.generate_apple_icon_bytes(MOTOLITE_WALLET_BACKGROUND_COLOR,"M",87),"logo.png":pm.generate_apple_logo_bytes("Motolite",160,50),"logo@2x.png":pm.generate_apple_logo_bytes("Motolite",320,100),"logo@3x.png":pm.generate_apple_logo_bytes("Motolite",480,150)}
        manifest={n:hashlib.sha1(c).hexdigest() for n,c in files.items()}; mb=json.dumps(manifest).encode(); sig=pm.sign_pkpass_manifest(mb)
        if sig is None:return None
        buf=BytesIO(); z=zipfile.ZipFile(buf,"w",zipfile.ZIP_DEFLATED)
        for n,c in files.items():z.writestr(n,c)
        z.writestr("manifest.json",mb); z.writestr("signature",sig); z.close(); return buf.getvalue()
    except Exception as e:
        print("MOTOLITE Apple pass error",e); return None


@motolite_router.get("/wallet/apple/{warranty_public_id}")
async def apple_wallet(warranty_public_id: str):
    _wallet_payload(warranty_public_id); data=_apple_pkpass(warranty_public_id)
    if data is None: raise HTTPException(status_code=500,detail="Apple Wallet pass could not be generated. Check Apple Wallet credentials.")
    return Response(content=data,media_type="application/vnd.apple.pkpass",headers={"Content-Disposition":f'attachment; filename="motolite-{warranty_public_id}.pkpass"'})


@motolite_router.get("/wallet/google/{warranty_public_id}")
async def google_wallet(warranty_public_id: str):
    _wallet_payload(warranty_public_id)
    if not GOOGLE_WALLET_ISSUER_ID: raise HTTPException(status_code=500,detail="Google Wallet issuer is not configured.")
    try:
        import main as pm
        if not _ensure_google_class(): raise HTTPException(status_code=500,detail="Could not create/access Motolite Google Wallet class.")
        token=pm.create_google_wallet_jwt(_google_object(warranty_public_id))
        if not token: raise HTTPException(status_code=500,detail="Could not generate Google Wallet save token.")
        return RedirectResponse(url=f"https://pay.google.com/gp/v/save/{token}",status_code=302)
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500,detail=f"Google Wallet generation failed: {e}")



@motolite_router.get("/wallet/qr/{warranty_public_id}.svg")
async def motolite_wallet_qr(warranty_public_id: str):
    """Scannable QR that opens the customer's Motolite Wallet landing page."""
    _wallet_payload(warranty_public_id)

    landing_url = (
        f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/"
        f"{warranty_public_id}"
    )

    try:
        import main as platform_main
        svg = platform_main.generate_qr_svg(landing_url)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not generate Motolite wallet QR: {exc}",
        )

    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": (
                f'inline; filename="motolite-wallet-{warranty_public_id}.svg"'
            ),
        },
    )


@motolite_router.get("/wallet/{warranty_public_id}", response_class=HTMLResponse)
async def motolite_wallet_landing_page(warranty_public_id: str):
    """
    Customer-facing mobile landing page reached by scanning the branch QR.
    Offers both Apple Wallet and Google Wallet from one permanent QR.
    """
    payload = _wallet_payload(warranty_public_id)

    apple_url = (
        f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/apple/"
        f"{warranty_public_id}"
    )
    google_url = (
        f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/google/"
        f"{warranty_public_id}"
    )
    verify_url = payload.get("qr_verification_url") or "#"

    import html as html_lib

    member_name = html_lib.escape(
        str(payload.get("member_name") or "Motolite Member")
    )
    member_number = html_lib.escape(
        str(payload.get("member_number") or "")
    )
    battery = html_lib.escape(
        str(payload.get("battery_product") or "Motolite Battery")
    )
    model = html_lib.escape(
        str(payload.get("battery_model") or "—")
    )
    serial_number = html_lib.escape(
        str(payload.get("serial_number") or "—")
    )
    vehicle = html_lib.escape(
        str(payload.get("vehicle") or "—")
    )
    plate = html_lib.escape(
        str(payload.get("plate_number") or "—")
    )
    expires = html_lib.escape(
        str(payload.get("warranty_expires_at") or "—")
    )
    status = html_lib.escape(
        str(payload.get("warranty_status") or "active").upper()
    )

    return HTMLResponse(
        content=f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Motolite Digital Warranty</title>
<style>
*{{box-sizing:border-box}}
body{{
  margin:0;background:#f3f3f3;color:#171717;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif
}}
.wrap{{max-width:520px;margin:0 auto;padding:24px 16px 44px}}
.brand{{
  background:#d71920;color:#fff;border-radius:18px 18px 0 0;
  padding:24px;text-align:center
}}
.brand .word{{font-size:34px;font-weight:950;letter-spacing:-1.5px}}
.brand .sub{{font-size:11px;letter-spacing:.16em;font-weight:800;color:#ffd400;margin-top:5px}}
.card{{
  background:#fff;border-radius:0 0 18px 18px;padding:24px;
  box-shadow:0 16px 45px rgba(0,0,0,.10)
}}
.status{{
  display:inline-block;padding:7px 11px;border-radius:999px;
  background:#e8f8ee;color:#178144;font-size:11px;font-weight:900
}}
h1{{font-size:26px;margin:15px 0 3px}}
.member{{font-size:12px;color:#777;font-weight:700}}
.battery{{font-size:19px;font-weight:900;margin:24px 0 5px}}
.meta{{border-top:1px solid #eee;margin-top:20px}}
.row{{display:grid;grid-template-columns:130px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid #eee;font-size:13px}}
.row span{{color:#777}} .row b{{text-align:right}}
.wallets{{display:grid;gap:11px;margin-top:22px}}
.wallet{{
  display:flex;align-items:center;justify-content:center;text-decoration:none;
  padding:15px 16px;border-radius:9px;font-weight:900;font-size:15px
}}
.apple{{background:#000;color:#fff}}
.google{{background:#fff;color:#111;border:1px solid #ddd}}
.verify{{display:block;text-align:center;color:#d71920;font-weight:800;font-size:13px;margin-top:20px;text-decoration:none}}
.help{{font-size:11px;color:#888;text-align:center;line-height:1.55;margin-top:22px}}
.device-note{{background:#fff7d6;border:1px solid #f0dc79;padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:14px;display:none}}
@media(max-width:390px){{.row{{grid-template-columns:1fr}}.row b{{text-align:left}}}}
</style>
</head>
<body>
<div class="wrap">
  <div class="device-note" id="device-note"></div>
  <div class="brand">
    <div class="word">MOTOLITE</div>
    <div class="sub">DIGITAL WARRANTY</div>
  </div>
  <div class="card">
    <span class="status">WARRANTY {status}</span>
    <h1>{member_name}</h1>
    <div class="member">{member_number}</div>

    <div class="battery">{battery}</div>

    <div class="meta">
      <div class="row"><span>Battery Model</span><b>{model}</b></div>
      <div class="row"><span>Serial Number</span><b>{serial_number}</b></div>
      <div class="row"><span>Vehicle</span><b>{vehicle}</b></div>
      <div class="row"><span>Plate Number</span><b>{plate}</b></div>
      <div class="row"><span>Warranty Until</span><b>{expires}</b></div>
    </div>

    <div class="wallets" id="wallets">
      <a class="wallet apple" id="apple-wallet" href="{apple_url}"> Add to Apple Wallet</a>
      <a class="wallet google" id="google-wallet" href="{google_url}">G&nbsp;&nbsp;Add to Google Wallet</a>
    </div>

    <a class="verify" href="{verify_url}">View verified warranty record →</a>
    <div class="help">
      This QR is linked to this registered Motolite warranty.
      You can reopen this page anytime and add the card to a supported wallet.
    </div>
  </div>
</div>
<script>
(function(){{
  var ua=navigator.userAgent||"";
  var ios=/iPhone|iPad|iPod/i.test(ua);
  var android=/Android/i.test(ua);
  var apple=document.getElementById("apple-wallet");
  var google=document.getElementById("google-wallet");
  var note=document.getElementById("device-note");

  if(ios){{
    apple.parentNode.insertBefore(apple, google);
    note.textContent="iPhone detected — Apple Wallet is recommended for this device.";
    note.style.display="block";
  }}else if(android){{
    google.parentNode.insertBefore(google, apple);
    note.textContent="Android detected — Google Wallet is recommended for this device.";
    note.style.display="block";
  }}
}})();
</script>
</body>
</html>"""
    )


@motolite_router.get("/emergency")
async def emergency(): return {"phone":MOTOLITE_EMERGENCY_NUMBER,"tel_url":f"tel:{MOTOLITE_EMERGENCY_NUMBER}" if MOTOLITE_EMERGENCY_NUMBER else None,"configured":bool(MOTOLITE_EMERGENCY_NUMBER)}


@motolite_router.get("/setup/check")
async def setup_check():
    expected=["motolite_regions","motolite_branches","motolite_members","motolite_vehicles","motolite_batteries","motolite_warranties","motolite_warranty_actions","motolite_staff_scope"]
    db=_supabase(); status={}
    for table in expected:
        try: db.table(table).select("*").limit(1).execute(); status[table]=True
        except Exception: status[table]=False
    return {"ok":all(status.values()),"database_configured":True,"tables":status,"master_env_configured":bool(MOTOLITE_MASTER_USERNAME and MOTOLITE_MASTER_PASSWORD)}

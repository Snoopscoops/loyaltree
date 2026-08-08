
import os
import uuid
import hashlib
import hmac
from datetime import datetime
from typing import Optional, Literal, List

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from supabase import create_client, Client


motolite_router = APIRouter(
    prefix="/api/v1/motolite",
    tags=["Motolite"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
MOTOLITE_BASE_URL = os.getenv(
    "MOTOLITE_BASE_URL",
    os.getenv("BASE_URL", "http://localhost:8000"),
)
MOTOLITE_TOKEN_SECRET = os.getenv(
    "MOTOLITE_TOKEN_SECRET",
    os.getenv("STAFF_SESSION_SECRET", "change-me-in-production"),
)
MOTOLITE_EMERGENCY_NUMBER = os.getenv("MOTOLITE_EMERGENCY_NUMBER", "")

GOOGLE_WALLET_ISSUER_ID = os.getenv("GOOGLE_WALLET_ISSUER_ID", "")
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv("GOOGLE_WALLET_CLASS_SUFFIX", "")
APPLE_PASS_TYPE_IDENTIFIER = os.getenv("APPLE_PASS_TYPE_IDENTIFIER", "")
APPLE_TEAM_IDENTIFIER = os.getenv("APPLE_TEAM_IDENTIFIER", "")

ROLE_NATIONAL = "national"
ROLE_REGIONAL = "regional"
ROLE_LOCAL = "local"

WARRANTY_ACTIVE = "active"
WARRANTY_EXPIRED = "expired"
WARRANTY_REPLACED = "replaced"
WARRANTY_VOID = "void"
WARRANTY_PENDING = "pending"


def _supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(
            status_code=503,
            detail="Supabase is not configured on this server.",
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _public_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _parse_date(value: str) -> datetime:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date '{value}'. Expected YYYY-MM-DD.",
        )


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
    digest = hmac.new(
        MOTOLITE_TOKEN_SECRET.encode("utf-8"),
        warranty_public_id.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{warranty_public_id}.{digest[:32]}"


def _verify_qr_token(token: str) -> Optional[str]:
    if not token or "." not in token:
        return None
    warranty_public_id, supplied = token.rsplit(".", 1)
    expected = _secure_qr_token(warranty_public_id).rsplit(".", 1)[1]
    return warranty_public_id if hmac.compare_digest(supplied, expected) else None


def _get_one(table: str, field: str, value):
    db = _supabase()
    rows = (
        db.table(table)
        .select("*")
        .eq(field, value)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _insert(table: str, payload: dict):
    db = _supabase()
    rows = db.table(table).insert(payload).execute().data or []
    return rows[0] if rows else payload


def _update(table: str, public_id: str, payload: dict):
    db = _supabase()
    rows = (
        db.table(table)
        .update(payload)
        .eq("public_id", public_id)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Record not found")
    return rows[0]


def _require_record(table: str, public_id: str, label: str):
    row = _get_one(table, "public_id", public_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return row


def _resolve_staff_scope(
    x_motolite_role: Optional[str],
    x_motolite_region: Optional[str],
    x_motolite_branch: Optional[str],
) -> dict:
    role = (x_motolite_role or "").strip().lower()

    if role not in {ROLE_NATIONAL, ROLE_REGIONAL, ROLE_LOCAL}:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid X-Motolite-Role header.",
        )

    if role == ROLE_REGIONAL and not x_motolite_region:
        raise HTTPException(
            status_code=401,
            detail="Regional access requires X-Motolite-Region.",
        )

    if role == ROLE_LOCAL and not x_motolite_branch:
        raise HTTPException(
            status_code=401,
            detail="Local access requires X-Motolite-Branch.",
        )

    return {
        "role": role,
        "region_public_id": x_motolite_region,
        "branch_public_id": x_motolite_branch,
    }


class RegionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    code: Optional[str] = Field(default=None, max_length=40)


class BranchCreate(BaseModel):
    region_public_id: str
    name: str = Field(min_length=1, max_length=200)
    branch_code: Optional[str] = Field(default=None, max_length=80)
    address: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=120)
    province: Optional[str] = Field(default=None, max_length=120)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = Field(default=None, max_length=80)
    is_active: bool = True


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=5, max_length=80)
    email: Optional[str] = Field(default=None, max_length=255)
    address: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=120)
    province: Optional[str] = Field(default=None, max_length=120)
    preferred_branch_public_id: Optional[str] = None


class MemberUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=255)
    address: Optional[str] = Field(default=None, max_length=500)
    city: Optional[str] = Field(default=None, max_length=120)
    province: Optional[str] = Field(default=None, max_length=120)
    preferred_branch_public_id: Optional[str] = None


class VehicleCreate(BaseModel):
    member_public_id: str
    make: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=120)
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    plate_number: Optional[str] = Field(default=None, max_length=80)
    color: Optional[str] = Field(default=None, max_length=80)


class BatteryCreate(BaseModel):
    member_public_id: str
    vehicle_public_id: Optional[str] = None
    original_branch_public_id: str
    product_name: str = Field(min_length=1, max_length=200)
    model_code: Optional[str] = Field(default=None, max_length=120)
    serial_number: str = Field(min_length=1, max_length=200)
    purchase_date: str
    installation_date: Optional[str] = None
    warranty_months: int = Field(default=12, ge=1, le=120)
    purchase_price: Optional[float] = Field(default=None, ge=0)
    receipt_number: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)


class WarrantyActionCreate(BaseModel):
    warranty_public_id: str
    servicing_branch_public_id: str
    service_type: Literal[
        "inspection",
        "warranty_claim",
        "replacement",
        "battery_check",
        "emergency_assistance",
        "other",
    ]
    notes: Optional[str] = Field(default=None, max_length=2000)
    result: Optional[str] = Field(default=None, max_length=500)
    replacement_battery_product_name: Optional[str] = Field(default=None, max_length=200)
    replacement_battery_model_code: Optional[str] = Field(default=None, max_length=120)
    replacement_serial_number: Optional[str] = Field(default=None, max_length=200)


@motolite_router.get("/health")
async def motolite_health():
    return {
        "ok": True,
        "service": "motolite",
        "mode": "single-file",
        "database_configured": bool(SUPABASE_URL and SUPABASE_KEY),
        "wallet": {
            "apple_configured": bool(
                APPLE_PASS_TYPE_IDENTIFIER and APPLE_TEAM_IDENTIFIER
            ),
            "google_configured": bool(
                GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_CLASS_SUFFIX
            ),
        },
    }


@motolite_router.post("/regions")
async def create_region(
    payload: RegionCreate,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
):
    if (x_motolite_role or "").lower() != ROLE_NATIONAL:
        raise HTTPException(status_code=403, detail="National access required")

    return _insert(
        "motolite_regions",
        {
            "public_id": _public_id("mtr"),
            "name": payload.name,
            "code": payload.code,
            "is_active": True,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        },
    )


@motolite_router.get("/regions")
async def list_regions():
    db = _supabase()
    return (
        db.table("motolite_regions")
        .select("*")
        .order("name")
        .execute()
        .data
        or []
    )


@motolite_router.post("/branches")
async def create_branch(
    payload: BranchCreate,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
):
    if (x_motolite_role or "").lower() != ROLE_NATIONAL:
        raise HTTPException(status_code=403, detail="National access required")

    _require_record("motolite_regions", payload.region_public_id, "Region")

    return _insert(
        "motolite_branches",
        {
            "public_id": _public_id("mtb"),
            "region_public_id": payload.region_public_id,
            "name": payload.name,
            "branch_code": payload.branch_code,
            "address": payload.address,
            "city": payload.city,
            "province": payload.province,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "phone": payload.phone,
            "is_active": payload.is_active,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        },
    )


@motolite_router.get("/branches")
async def list_branches(region_public_id: Optional[str] = None):
    db = _supabase()
    q = db.table("motolite_branches").select("*")
    if region_public_id:
        q = q.eq("region_public_id", region_public_id)
    return q.order("name").execute().data or []


@motolite_router.post("/members")
async def create_member(
    payload: MemberCreate,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
    x_motolite_region: Optional[str] = Header(default=None, alias="X-Motolite-Region", description="Region public_id. Required for regional staff."),
    x_motolite_branch: Optional[str] = Header(default=None, alias="X-Motolite-Branch", description="Branch public_id. Required for local staff."),
):
    scope = _resolve_staff_scope(
        x_motolite_role,
        x_motolite_region,
        x_motolite_branch,
    )

    branch_id = payload.preferred_branch_public_id or scope.get("branch_public_id")

    if branch_id:
        _require_record("motolite_branches", branch_id, "Branch")

    if _get_one("motolite_members", "phone", payload.phone):
        raise HTTPException(
            status_code=409,
            detail="A Motolite member with this phone number already exists.",
        )

    return _insert(
        "motolite_members",
        {
            "public_id": _public_id("mtm"),
            "member_number": (
                f"MTL-{datetime.utcnow().strftime('%Y')}-"
                f"{uuid.uuid4().hex[:8].upper()}"
            ),
            "name": payload.name,
            "phone": payload.phone,
            "email": payload.email,
            "address": payload.address,
            "city": payload.city,
            "province": payload.province,
            "preferred_branch_public_id": branch_id,
            "created_by_branch_public_id": scope.get("branch_public_id"),
            "is_active": True,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        },
    )


@motolite_router.get("/members/{member_public_id}")
async def get_member(member_public_id: str):
    member = _require_record("motolite_members", member_public_id, "Member")
    db = _supabase()

    vehicles = (
        db.table("motolite_vehicles")
        .select("*")
        .eq("member_public_id", member_public_id)
        .execute()
        .data
        or []
    )

    batteries = (
        db.table("motolite_batteries")
        .select("*")
        .eq("member_public_id", member_public_id)
        .execute()
        .data
        or []
    )

    warranties = (
        db.table("motolite_warranties")
        .select("*")
        .eq("member_public_id", member_public_id)
        .execute()
        .data
        or []
    )

    return {
        "member": member,
        "vehicles": vehicles,
        "batteries": batteries,
        "warranties": warranties,
    }


@motolite_router.patch("/members/{member_public_id}")
async def update_member(member_public_id: str, payload: MemberUpdate):
    _require_record("motolite_members", member_public_id, "Member")
    updates = payload.model_dump(exclude_unset=True)
    updates["updated_at"] = _now_iso()
    return _update("motolite_members", member_public_id, updates)


@motolite_router.get("/members")
async def list_members(
    q: Optional[str] = None,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
    x_motolite_region: Optional[str] = Header(default=None, alias="X-Motolite-Region", description="Region public_id. Required for regional staff."),
    x_motolite_branch: Optional[str] = Header(default=None, alias="X-Motolite-Branch", description="Branch public_id. Required for local staff."),
):
    scope = _resolve_staff_scope(
        x_motolite_role,
        x_motolite_region,
        x_motolite_branch,
    )

    db = _supabase()
    query = db.table("motolite_members").select("*")

    if scope["role"] == ROLE_LOCAL:
        query = query.eq(
            "preferred_branch_public_id",
            scope["branch_public_id"],
        )
    elif scope["role"] == ROLE_REGIONAL:
        branches = (
            db.table("motolite_branches")
            .select("public_id")
            .eq("region_public_id", scope["region_public_id"])
            .execute()
            .data
            or []
        )
        ids = [b["public_id"] for b in branches if b.get("public_id")]
        if not ids:
            return []
        query = query.in_("preferred_branch_public_id", ids)

    rows = (
        query.order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
        or []
    )

    if q:
        needle = q.strip().lower()
        rows = [
            row
            for row in rows
            if needle in str(row.get("name", "")).lower()
            or needle in str(row.get("phone", "")).lower()
            or needle in str(row.get("member_number", "")).lower()
        ]

    return rows


@motolite_router.post("/vehicles")
async def create_vehicle(payload: VehicleCreate):
    _require_record("motolite_members", payload.member_public_id, "Member")

    return _insert(
        "motolite_vehicles",
        {
            "public_id": _public_id("mtv"),
            "member_public_id": payload.member_public_id,
            "make": payload.make,
            "model": payload.model,
            "year": payload.year,
            "plate_number": payload.plate_number,
            "color": payload.color,
            "is_active": True,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        },
    )


@motolite_router.post("/batteries")
async def register_battery(
    payload: BatteryCreate,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
    x_motolite_region: Optional[str] = Header(default=None, alias="X-Motolite-Region", description="Region public_id. Required for regional staff."),
    x_motolite_branch: Optional[str] = Header(default=None, alias="X-Motolite-Branch", description="Branch public_id. Required for local staff."),
):
    _resolve_staff_scope(
        x_motolite_role,
        x_motolite_region,
        x_motolite_branch,
    )

    _require_record("motolite_members", payload.member_public_id, "Member")
    branch = _require_record(
        "motolite_branches",
        payload.original_branch_public_id,
        "Original branch",
    )

    if payload.vehicle_public_id:
        vehicle = _require_record(
            "motolite_vehicles",
            payload.vehicle_public_id,
            "Vehicle",
        )
        if vehicle.get("member_public_id") != payload.member_public_id:
            raise HTTPException(
                status_code=400,
                detail="Vehicle does not belong to this member.",
            )

    if _get_one("motolite_batteries", "serial_number", payload.serial_number):
        raise HTTPException(
            status_code=409,
            detail="This battery serial number is already registered.",
        )

    purchase_date = _parse_date(payload.purchase_date).strftime("%Y-%m-%d")
    installation_date = (
        _parse_date(payload.installation_date).strftime("%Y-%m-%d")
        if payload.installation_date
        else purchase_date
    )

    battery_public_id = _public_id("mtbat")
    warranty_public_id = _public_id("mtw")

    battery = {
        "public_id": battery_public_id,
        "member_public_id": payload.member_public_id,
        "vehicle_public_id": payload.vehicle_public_id,
        "original_branch_public_id": payload.original_branch_public_id,
        "product_name": payload.product_name,
        "model_code": payload.model_code,
        "serial_number": payload.serial_number,
        "purchase_date": purchase_date,
        "installation_date": installation_date,
        "purchase_price": payload.purchase_price,
        "receipt_number": payload.receipt_number,
        "notes": payload.notes,
        "status": "installed",
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    warranty = {
        "public_id": warranty_public_id,
        "member_public_id": payload.member_public_id,
        "battery_public_id": battery_public_id,
        "vehicle_public_id": payload.vehicle_public_id,
        "original_branch_public_id": payload.original_branch_public_id,
        "region_public_id": branch.get("region_public_id"),
        "warranty_months": payload.warranty_months,
        "start_date": installation_date,
        "expires_at": _warranty_expiry(
            installation_date,
            payload.warranty_months,
        ),
        "status": WARRANTY_ACTIVE,
        "qr_token": _secure_qr_token(warranty_public_id),
        "replacement_count": 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    db = _supabase()
    battery_rows = db.table("motolite_batteries").insert(battery).execute().data or []

    try:
        warranty_rows = (
            db.table("motolite_warranties")
            .insert(warranty)
            .execute()
            .data
            or []
        )
    except Exception:
        try:
            db.table("motolite_batteries").delete().eq(
                "public_id",
                battery_public_id,
            ).execute()
        except Exception:
            pass
        raise

    return {
        "battery": battery_rows[0] if battery_rows else battery,
        "warranty": warranty_rows[0] if warranty_rows else warranty,
        "qr_verification_url": (
            f"{MOTOLITE_BASE_URL}/api/v1/motolite/warranty/verify/"
            f"{warranty['qr_token']}"
        ),
        "wallet": {
            "apple_url": (
                f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/apple/"
                f"{warranty_public_id}"
            ),
            "google_url": (
                f"{MOTOLITE_BASE_URL}/api/v1/motolite/wallet/google/"
                f"{warranty_public_id}"
            ),
        },
    }


async def _build_warranty_response(warranty_public_id: str):
    warranty = _require_record(
        "motolite_warranties",
        warranty_public_id,
        "Warranty",
    )
    member = _get_one(
        "motolite_members",
        "public_id",
        warranty.get("member_public_id"),
    )
    battery = _get_one(
        "motolite_batteries",
        "public_id",
        warranty.get("battery_public_id"),
    )
    vehicle = (
        _get_one(
            "motolite_vehicles",
            "public_id",
            warranty.get("vehicle_public_id"),
        )
        if warranty.get("vehicle_public_id")
        else None
    )
    branch = _get_one(
        "motolite_branches",
        "public_id",
        warranty.get("original_branch_public_id"),
    )

    db = _supabase()
    history = (
        db.table("motolite_warranty_actions")
        .select("*")
        .eq("warranty_public_id", warranty_public_id)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    computed_status = warranty.get("status")
    if (
        computed_status == WARRANTY_ACTIVE
        and warranty.get("expires_at")
        and _parse_date(warranty["expires_at"]) < datetime.utcnow()
    ):
        computed_status = WARRANTY_EXPIRED

    return {
        "warranty": {**warranty, "computed_status": computed_status},
        "member": member,
        "battery": battery,
        "vehicle": vehicle,
        "original_branch": branch,
        "history": history,
    }


@motolite_router.get("/warranties/{warranty_public_id}")
async def get_warranty(warranty_public_id: str):
    return await _build_warranty_response(warranty_public_id)


@motolite_router.get("/warranty/verify/{token}")
async def verify_warranty_qr(token: str):
    warranty_public_id = _verify_qr_token(token)
    if not warranty_public_id:
        raise HTTPException(
            status_code=400,
            detail="Invalid warranty QR token.",
        )
    return await _build_warranty_response(warranty_public_id)


@motolite_router.post("/warranty-actions")
async def create_warranty_action(
    payload: WarrantyActionCreate,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
    x_motolite_region: Optional[str] = Header(default=None, alias="X-Motolite-Region", description="Region public_id. Required for regional staff."),
    x_motolite_branch: Optional[str] = Header(default=None, alias="X-Motolite-Branch", description="Branch public_id. Required for local staff."),
):
    scope = _resolve_staff_scope(
        x_motolite_role,
        x_motolite_region,
        x_motolite_branch,
    )

    warranty = _require_record(
        "motolite_warranties",
        payload.warranty_public_id,
        "Warranty",
    )

    _require_record(
        "motolite_branches",
        payload.servicing_branch_public_id,
        "Servicing branch",
    )

    if (
        scope["role"] == ROLE_LOCAL
        and payload.servicing_branch_public_id != scope["branch_public_id"]
    ):
        raise HTTPException(
            status_code=403,
            detail="Local users can only service from their own branch.",
        )

    action = _insert(
        "motolite_warranty_actions",
        {
            "public_id": _public_id("mta"),
            "warranty_public_id": payload.warranty_public_id,
            "member_public_id": warranty.get("member_public_id"),
            "battery_public_id": warranty.get("battery_public_id"),
            "servicing_branch_public_id": payload.servicing_branch_public_id,
            "service_type": payload.service_type,
            "notes": payload.notes,
            "result": payload.result,
            "created_at": _now_iso(),
        },
    )

    replacement = None

    if payload.service_type == "replacement":
        if not payload.replacement_serial_number:
            raise HTTPException(
                status_code=400,
                detail="Replacement serial number is required.",
            )

        old_battery = _require_record(
            "motolite_batteries",
            warranty.get("battery_public_id"),
            "Original battery",
        )

        new_id = _public_id("mtbat")

        replacement = _insert(
            "motolite_batteries",
            {
                "public_id": new_id,
                "member_public_id": warranty.get("member_public_id"),
                "vehicle_public_id": warranty.get("vehicle_public_id"),
                "original_branch_public_id": payload.servicing_branch_public_id,
                "product_name": (
                    payload.replacement_battery_product_name
                    or old_battery.get("product_name")
                ),
                "model_code": (
                    payload.replacement_battery_model_code
                    or old_battery.get("model_code")
                ),
                "serial_number": payload.replacement_serial_number,
                "purchase_date": datetime.utcnow().strftime("%Y-%m-%d"),
                "installation_date": datetime.utcnow().strftime("%Y-%m-%d"),
                "status": "installed",
                "notes": f"Warranty replacement for {payload.warranty_public_id}",
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            },
        )

        db = _supabase()

        db.table("motolite_batteries").update(
            {
                "status": "replaced",
                "updated_at": _now_iso(),
            }
        ).eq(
            "public_id",
            warranty.get("battery_public_id"),
        ).execute()

        db.table("motolite_warranties").update(
            {
                "status": WARRANTY_REPLACED,
                "replacement_count": int(
                    warranty.get("replacement_count") or 0
                ) + 1,
                "replacement_battery_public_id": new_id,
                "updated_at": _now_iso(),
            }
        ).eq(
            "public_id",
            payload.warranty_public_id,
        ).execute()

    return {
        "action": action,
        "replacement_battery": replacement,
    }


def _dashboard_counts(branch_ids: Optional[List[str]] = None):
    db = _supabase()

    members_q = db.table("motolite_members").select(
        "public_id,preferred_branch_public_id"
    )
    warranties_q = db.table("motolite_warranties").select(
        "public_id,status,original_branch_public_id,expires_at"
    )
    actions_q = db.table("motolite_warranty_actions").select(
        "public_id,servicing_branch_public_id,service_type"
    )

    if branch_ids is not None:
        if not branch_ids:
            return {
                "members": 0,
                "warranties": 0,
                "active_warranties": 0,
                "replacements": 0,
                "claims": 0,
            }

        members_q = members_q.in_("preferred_branch_public_id", branch_ids)
        warranties_q = warranties_q.in_("original_branch_public_id", branch_ids)
        actions_q = actions_q.in_("servicing_branch_public_id", branch_ids)

    members = members_q.execute().data or []
    warranties = warranties_q.execute().data or []
    actions = actions_q.execute().data or []

    active = 0
    now = datetime.utcnow()

    for warranty in warranties:
        if warranty.get("status") != WARRANTY_ACTIVE:
            continue
        expires_at = warranty.get("expires_at")
        if not expires_at or _parse_date(expires_at) >= now:
            active += 1

    return {
        "members": len(members),
        "warranties": len(warranties),
        "active_warranties": active,
        "replacements": len(
            [a for a in actions if a.get("service_type") == "replacement"]
        ),
        "claims": len(
            [a for a in actions if a.get("service_type") == "warranty_claim"]
        ),
    }


@motolite_router.get("/dashboard/national")
async def national_dashboard(
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
):
    if (x_motolite_role or "").lower() != ROLE_NATIONAL:
        raise HTTPException(status_code=403, detail="National access required.")

    db = _supabase()
    regions = db.table("motolite_regions").select("public_id").execute().data or []
    branches = db.table("motolite_branches").select("public_id").execute().data or []

    return {
        "scope": "national",
        "regions": len(regions),
        "branches": len(branches),
        **_dashboard_counts(None),
    }


@motolite_router.get("/dashboard/regional/{region_public_id}")
async def regional_dashboard(
    region_public_id: str,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
    x_motolite_region: Optional[str] = Header(default=None, alias="X-Motolite-Region", description="Region public_id. Required for regional staff."),
):
    role = (x_motolite_role or "").lower()

    if role not in {ROLE_NATIONAL, ROLE_REGIONAL}:
        raise HTTPException(
            status_code=403,
            detail="Regional or national access required.",
        )

    if role == ROLE_REGIONAL and x_motolite_region != region_public_id:
        raise HTTPException(
            status_code=403,
            detail="This regional account cannot access another region.",
        )

    _require_record("motolite_regions", region_public_id, "Region")

    db = _supabase()
    rows = (
        db.table("motolite_branches")
        .select("public_id")
        .eq("region_public_id", region_public_id)
        .execute()
        .data
        or []
    )
    ids = [r["public_id"] for r in rows if r.get("public_id")]

    return {
        "scope": "regional",
        "region_public_id": region_public_id,
        "branches": len(ids),
        **_dashboard_counts(ids),
    }


@motolite_router.get("/dashboard/local/{branch_public_id}")
async def local_dashboard(
    branch_public_id: str,
    x_motolite_role: Optional[str] = Header(default=None, alias="X-Motolite-Role", description="Staff access level: national, regional, or local"),
    x_motolite_branch: Optional[str] = Header(default=None, alias="X-Motolite-Branch", description="Branch public_id. Required for local staff."),
):
    role = (x_motolite_role or "").lower()

    if role not in {ROLE_NATIONAL, ROLE_REGIONAL, ROLE_LOCAL}:
        raise HTTPException(
            status_code=403,
            detail="Motolite dashboard access required.",
        )

    if role == ROLE_LOCAL and x_motolite_branch != branch_public_id:
        raise HTTPException(
            status_code=403,
            detail="This local account cannot access another branch.",
        )

    branch = _require_record("motolite_branches", branch_public_id, "Branch")

    return {
        "scope": "local",
        "branch": branch,
        **_dashboard_counts([branch_public_id]),
    }


def _wallet_payload(warranty_public_id: str) -> dict:
    warranty = _require_record(
        "motolite_warranties",
        warranty_public_id,
        "Warranty",
    )
    member = _require_record(
        "motolite_members",
        warranty.get("member_public_id"),
        "Member",
    )
    battery = _require_record(
        "motolite_batteries",
        warranty.get("battery_public_id"),
        "Battery",
    )

    vehicle = (
        _get_one(
            "motolite_vehicles",
            "public_id",
            warranty.get("vehicle_public_id"),
        )
        if warranty.get("vehicle_public_id")
        else None
    )

    return {
        "member_public_id": member.get("public_id"),
        "member_number": member.get("member_number"),
        "member_name": member.get("name"),
        "battery_product": battery.get("product_name"),
        "battery_model": battery.get("model_code"),
        "serial_number": battery.get("serial_number"),
        "vehicle": (
            f"{vehicle.get('make')} {vehicle.get('model')}"
            if vehicle
            else None
        ),
        "plate_number": vehicle.get("plate_number") if vehicle else None,
        "warranty_public_id": warranty.get("public_id"),
        "warranty_status": warranty.get("status"),
        "warranty_expires_at": warranty.get("expires_at"),
        "qr_token": warranty.get("qr_token"),
        "qr_verification_url": (
            f"{MOTOLITE_BASE_URL}/api/v1/motolite/warranty/verify/"
            f"{warranty.get('qr_token')}"
        ),
        "emergency_number": MOTOLITE_EMERGENCY_NUMBER,
    }


@motolite_router.get("/wallet/apple/{warranty_public_id}")
async def apple_wallet_adapter(warranty_public_id: str):
    payload = _wallet_payload(warranty_public_id)

    return {
        "configured": bool(
            APPLE_PASS_TYPE_IDENTIFIER and APPLE_TEAM_IDENTIFIER
        ),
        "provider": "apple",
        "message": (
            "Connect this Motolite warranty payload to the existing "
            "Apple PassKit generator in main.py."
        ),
        "payload": payload,
    }


@motolite_router.get("/wallet/google/{warranty_public_id}")
async def google_wallet_adapter(warranty_public_id: str):
    payload = _wallet_payload(warranty_public_id)

    return {
        "configured": bool(
            GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_CLASS_SUFFIX
        ),
        "provider": "google",
        "message": (
            "Connect this Motolite warranty payload to the existing "
            "Google Wallet generator in main.py."
        ),
        "payload": payload,
    }


@motolite_router.get("/emergency")
async def emergency_info():
    return {
        "phone": MOTOLITE_EMERGENCY_NUMBER,
        "tel_url": (
            f"tel:{MOTOLITE_EMERGENCY_NUMBER}"
            if MOTOLITE_EMERGENCY_NUMBER
            else None
        ),
        "configured": bool(MOTOLITE_EMERGENCY_NUMBER),
    }


@motolite_router.get("/locations/nearest")
async def nearest_branches(
    latitude: float,
    longitude: float,
    limit: int = 5,
):
    import math

    db = _supabase()
    branches = (
        db.table("motolite_branches")
        .select("*")
        .eq("is_active", True)
        .execute()
        .data
        or []
    )

    def haversine(lat1, lon1, lat2, lon2):
        radius_km = 6371.0
        p1 = math.radians(lat1)
        p2 = math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = (
            math.sin(dp / 2) ** 2
            + math.cos(p1)
            * math.cos(p2)
            * math.sin(dl / 2) ** 2
        )
        return 2 * radius_km * math.asin(math.sqrt(a))

    ranked = []

    for branch in branches:
        lat = branch.get("latitude")
        lng = branch.get("longitude")

        if lat is None or lng is None:
            continue

        try:
            distance = haversine(
                latitude,
                longitude,
                float(lat),
                float(lng),
            )
        except Exception:
            continue

        ranked.append(
            {
                **branch,
                "distance_km": round(distance, 2),
            }
        )

    ranked.sort(key=lambda item: item["distance_km"])

    return ranked[: max(1, min(limit, 20))]


@motolite_router.get("/setup/check")
async def setup_check():
    expected = [
        "motolite_regions",
        "motolite_branches",
        "motolite_members",
        "motolite_vehicles",
        "motolite_batteries",
        "motolite_warranties",
        "motolite_warranty_actions",
    ]

    if not SUPABASE_URL or not SUPABASE_KEY:
        return {
            "ok": False,
            "database_configured": False,
            "tables": {},
        }

    db = _supabase()
    status = {}

    for table in expected:
        try:
            db.table(table).select("*").limit(1).execute()
            status[table] = True
        except Exception:
            status[table] = False

    return {
        "ok": all(status.values()),
        "database_configured": True,
        "tables": status,
    }

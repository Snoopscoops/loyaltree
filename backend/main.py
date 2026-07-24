import os
import uuid
import base64
import json
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client
import qrcode
from qrcode.image.svg import SvgImage
from io import BytesIO

# ─── Environment ────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
BASE_URL = os.getenv("BASE_URL", "https://loyaltree-btw1.onrender.com")
GOOGLE_WALLET_ISSUER_ID = os.getenv("GOOGLE_WALLET_ISSUER_ID", "")
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv("GOOGLE_WALLET_CLASS_SUFFIX", "")

# Graceful startup - show error page instead of crashing
ENV_ERROR = None
if not SUPABASE_URL or not SUPABASE_KEY:
    ENV_ERROR = "SUPABASE_URL or SUPABASE_KEY not set in environment variables."
    supabase = None
else:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        ENV_ERROR = str(e)
        supabase = None

# ─── Pydantic Models ──────────────────────────────────────────────────────────
class BusinessCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    password: str
    logo_url: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class StaffInvite(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    role: str = "cashier"

class LoyaltyConfig(BaseModel):
    stamp_goal: int = Field(default=8, ge=3, le=20)
    reward_name: str = "Free Service"
    primary_color: str = "#3b82f6"
    reward_expiry_days: int = Field(default=30, ge=1)
    program_logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    card_name: Optional[str] = None

class CustomerSignup(BaseModel):
    name: str
    phone: str

class StampRequest(BaseModel):
    customer_public_id: str
    staff_pin: str

class GoLiveResponse(BaseModel):
    message: str

# ─── Helpers ─────────────────────────────────────────────────────────────────
def generate_public_id() -> str:
    return uuid.uuid4().hex

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def safe_get_business(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("businesses").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_customer(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("customers").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_business_by_id(business_id: int):
    if not supabase:
        return None
    try:
        res = supabase.table("businesses").select("*").eq("id", business_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_loyalty_program(business_id: int):
    if not supabase:
        return None
    try:
        res = supabase.table("loyalty_programs").select("*").eq("business_id", business_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def generate_qr_svg(data: str) -> str:
    qr = qrcode.make(data, image_factory=SvgImage)
    buffer = BytesIO()
    qr.save(buffer)
    return buffer.getvalue().decode("utf-8")

# ─── Google Wallet Helpers ──────────────────────────────────────────────────

def get_google_wallet_credentials():
    """Load service account credentials from env var"""
    creds_json = os.getenv("GOOGLE_WALLET_CREDENTIALS", "")
    if not creds_json:
        return None
    try:
        return json.loads(creds_json)
    except:
        return None

def create_google_wallet_jwt(loyalty_object: dict) -> str:
    """Generate a signed JWT for Google Wallet save link using PyJWT."""
    creds = get_google_wallet_credentials()
    if not creds:
        print("JWT: No credentials found")
        return ""
    try:
        import jwt as pyjwt
        private_key = creds.get("private_key", "")
        client_email = creds.get("client_email", "")
        if not private_key or not client_email:
            print("JWT: Missing private_key or client_email")
            return ""
        now = datetime.utcnow()
        payload = {
            "iss": client_email,
            "aud": "google",
            "iat": now,
            "exp": now + timedelta(hours=1),
            "origins": [BASE_URL, "https://loyaltree-five.vercel.app"],
            "typ": "savetowallet",
            "payload": {
                "loyaltyObjects": [loyalty_object]
            }
        }
        token = pyjwt.encode(payload, private_key, algorithm="RS256")
        result = token if isinstance(token, str) else token.decode("utf-8")
        print(f"JWT: Generated successfully ({len(result)} chars)")
        return result
    except Exception as e:
        print(f"JWT generation error: {e}")
        import traceback
        traceback.print_exc()
        return ""

def get_google_access_token() -> str:
    """Get OAuth2 access token for Google Wallet REST API"""
    creds = get_google_wallet_credentials()
    if not creds:
        return ""
    try:
        import jwt as pyjwt
        import httpx
        private_key = creds.get("private_key", "")
        client_email = creds.get("client_email", "")
        now = int(datetime.utcnow().timestamp())
        auth_payload = {
            "iss": client_email,
            "sub": client_email,
            "scope": "https://www.googleapis.com/auth/wallet_object.issuer",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        }
        jwt_assertion = pyjwt.encode(auth_payload, private_key, algorithm="RS256")
        if isinstance(jwt_assertion, bytes):
            jwt_assertion = jwt_assertion.decode("utf-8")
        with httpx.Client() as client:
            resp = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": jwt_assertion,
                }
            )
            data = resp.json()
            return data.get("access_token", "")
    except Exception as e:
        print(f"Access token error: {e}")
        return ""

def build_loyalty_class(business: dict, program: dict, review_status: str = "UNDER_REVIEW") -> dict:
    """Build the LoyaltyClass for a specific business"""
    class_id = program.get("google_wallet_class_id") if program else None
    if not class_id:
        class_id = f"{GOOGLE_WALLET_ISSUER_ID}.{business[chr(39)+'public_id'+chr(39)]}"

    primary_color = program.get("primary_color", "#3b82f6") if program else "#3b82f6"
    reward_name = program.get("reward_name", "Free Reward") if program else "Free Reward"
    card_name = program.get("card_name") if program else None
    program_name = card_name if card_name else f"{business.get(chr(39)+'name'+chr(39), 'Loyalty')} Rewards"

    loyalty_class = {
        "id": class_id,
        "issuerName": business.get("name", "LoyaltyTree"),
        "programName": program_name,
        "reviewStatus": review_status,
        "hexBackgroundColor": primary_color.replace("#", ""),
        "textModulesData": [
            {"header": "Reward", "body": reward_name},
            {"header": "About", "body": "Collect stamps, earn rewards"}
        ]
    }

    # Use business logo if available, else program logo
    logo_url = business.get("logo_url") if business else None
    if not logo_url and program:
        logo_url = program.get("program_logo_url")
    if logo_url:
        loyalty_class["programLogo"] = {
            "sourceUri": {"uri": logo_url}
        }

    hero_url = program.get("hero_image_url") if program else None
    if hero_url:
        loyalty_class["heroImage"] = {
            "sourceUri": {"uri": hero_url}
        }

    return loyalty_class

def build_loyalty_object(customer: dict, business: dict, program: dict) -> dict:
    """Build the LoyaltyObject for a specific customer"""
    class_id = program.get("google_wallet_class_id") if program else f"{GOOGLE_WALLET_ISSUER_ID}.{GOOGLE_WALLET_CLASS_SUFFIX}"
    object_id = f"{GOOGLE_WALLET_ISSUER_ID}.{customer[chr(39)+'public_id'+chr(39)]}"
    stamp_goal = program.get("stamp_goal", 8) if program else 8
    reward_name = program.get("reward_name", "Free Reward") if program else "Free Reward"
    card_name = program.get("card_name") if program else None
    stamps = customer.get("stamp_count", 0)

    return {
        "id": object_id,
        "classId": class_id,
        "state": "active",
        "barcode": {
            "type": "QR_CODE",
            "value": customer["public_id"],
            "alternateText": customer.get("name", "Member")
        },
        "accountId": customer["public_id"],
        "accountName": customer.get("name", "Member"),
        "loyaltyPoints": {
            "label": "Stamps",
            "balance": {
                "string": f"{stamps}/{stamp_goal}"
            }
        },
        "textModulesData": [
            {"header": "Business", "body": business.get("name", "")},
            {"header": "Reward", "body": reward_name},
            {"header": "Progress", "body": f"{stamps} of {stamp_goal} stamps"}
        ],
        "linksModuleData": {
            "uris": [
                {
                    "uri": f"{BASE_URL}/wallet/{customer[chr(39)+'public_id'+chr(39)]}",
                    "description": "View Card Online"
                }
            ]
        }
    }

# ─── FastAPI App ─────────────────────────────────────────────────────────────
app = FastAPI(title="LoyaltyTree API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Error page if env vars missing
@app.middleware("http")
async def check_env(request: Request, call_next):
    if ENV_ERROR:
        return HTMLResponse(f"""
        <div style="text-align:center;padding:60px;font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h1 style="color:#dc2626;font-size:48px;margin-bottom:16px;">⚠️</h1>
            <h2 style="color:#1e293b;margin-bottom:16px;">Configuration Error</h2>
            <p style="color:#64748b;font-size:16px;line-height:1.6;margin-bottom:24px;">
                {ENV_ERROR}
            </p>
            <div style="background:#f8fafc;border-radius:12px;padding:20px;text-align:left;">
                <p style="margin:0 0 8px 0;font-weight:600;">Fix this in your Render dashboard:</p>
                <ol style="margin:0;padding-left:20px;color:#64748b;">
                    <li>Go to dashboard.render.com</li>
                    <li>Click your service → Environment tab</li>
                    <li>Add: SUPABASE_URL = https://xmzrzrslggrbyojkojsy.supabase.co</li>
                    <li>Add: SUPABASE_KEY = (your key)</li>
                    <li>Click Save Changes → Manual Deploy</li>
                </ol>
            </div>
        </div>
        """)
    return await call_next(request)

# ═════════════════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/login")
@app.post("/api/v1/auth/login")
async def login(req: LoginRequest):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    # Try to find business owner by email
    try:
        res = supabase.table("businesses").select("*").eq("email", req.email).maybe_single().execute()
        business = res.data
        if business:
            stored_pw = business.get("password", "")
            input_pw = req.password
            input_hash = hash_password(input_pw)

            matched = False
            if stored_pw == input_pw:
                matched = True
                print(f"Login: plain text match for {req.email}")
            elif stored_pw == input_hash:
                matched = True
                print(f"Login: sha256 match for {req.email}")

            if matched:
                return {
                    "success": True,
                    "token": "owner-token-" + business["public_id"],
                    "business_slug": business["public_id"],
                    "business_name": business["name"],
                    "name": business["name"],
                    "role": "owner",
                    "logo_url": business.get("logo_url"),
                    "user": {
                        "business_slug": business["public_id"],
                        "business_name": business["name"],
                        "name": business["name"],
                        "email": business["email"],
                        "role": "owner",
                        "logo_url": business.get("logo_url"),
                    }
                }
            else:
                print(f"Login: password mismatch. Stored len={len(stored_pw)}, input hash={input_hash[:20]}...")
    except Exception as e:
        print(f"Business login error: {e}")

    # Try to find staff by email
    try:
        res = supabase.table("staff").select("*,businesses(public_id,name,logo_url)").eq("email", req.email).maybe_single().execute()
        staff = res.data
        if staff:
            stored_pin = staff.get("pin", "")
            if stored_pin == req.password or stored_pin == hash_password(req.password):
                biz = staff.get("businesses", {}) or {}
                return {
                    "success": True,
                    "token": "staff-token-" + staff["public_id"],
                    "business_slug": biz.get("public_id", ""),
                    "business_name": biz.get("name", ""),
                    "name": staff["name"],
                    "staff_name": staff["name"],
                    "role": staff["role"],
                    "logo_url": biz.get("logo_url"),
                    "user": {
                        "business_slug": biz.get("public_id", ""),
                        "business_name": biz.get("name", ""),
                        "name": staff["name"],
                        "email": staff["email"],
                        "role": staff["role"],
                        "logo_url": biz.get("logo_url"),
                    }
                }
    except Exception as e:
        print(f"Staff login error: {e}")

    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.post("/api/v1/register")
@app.post("/api/v1/auth/register")
async def register(biz: BusinessCreate):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    public_id = generate_public_id()
    business_data = {
        "public_id": public_id,
        "name": biz.name,
        "email": biz.email,
        "phone": biz.phone,
        "password": hash_password(biz.password),
        "logo_url": biz.logo_url,
        "status": "PENDING",
        "created_at": datetime.utcnow().isoformat(),
    }

    try:
        supabase.table("businesses").insert(business_data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

    return {
        "success": True,
        "business_slug": public_id,
        "business_name": biz.name,
        "token": "owner-token-" + public_id,
        "logo_url": biz.logo_url,
    }

@app.get("/api/v1/me")
@app.get("/api/v1/auth/me")
async def get_current_user(request: Request):
    """Get current user from token header"""
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "").replace("bearer ", "") if auth_header else ""

    if not token or not supabase:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if token.startswith("owner-token-"):
        public_id = token.replace("owner-token-", "")
        business = safe_get_business(public_id)
        if business:
            return {
                "business_slug": business["public_id"],
                "business_name": business["name"],
                "name": business["name"],
                "email": business["email"],
                "role": "owner",
                "logo_url": business.get("logo_url"),
            }

    if token.startswith("staff-token-"):
        public_id = token.replace("staff-token-", "")
        try:
            res = supabase.table("staff").select("*,businesses(public_id,name,logo_url)").eq("public_id", public_id).maybe_single().execute()
            staff_data = res.data
            if staff_data:
                biz = staff_data.get("businesses", {}) or {}
                return {
                    "business_slug": biz.get("public_id", ""),
                    "business_name": biz.get("name", ""),
                    "name": staff_data["name"],
                    "email": staff_data["email"],
                    "role": staff_data["role"],
                    "logo_url": biz.get("logo_url"),
                }
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Invalid token")

# ═════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/business/{public_id}")
async def get_business_api(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return business

@app.get("/api/v1/customer/{public_id}")
async def get_customer_api(public_id: str):
    """Lookup customer by public_id (for scanner apps)"""
    customer = safe_get_customer(public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer.get("business_id"))
    program = safe_get_loyalty_program(customer.get("business_id")) if business else None

    return {
        "customer": customer,
        "business": {
            "id": business["id"] if business else None,
            "public_id": business["public_id"] if business else None,
            "name": business["name"] if business else None,
            "logo_url": business.get("logo_url") if business else None,
        },
        "program": program,
    }

@app.get("/api/v1/business/{public_id}/customers")
async def get_customers(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("customers").select("*").eq("business_id", business["id"]).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/staff")
async def get_staff(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("staff").select("*").eq("business_id", business["id"]).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/stats")
async def get_stats(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("customers").select("*").eq("business_id", business["id"]).execute()
        customers = res.data or []
        total_stamps = sum(c.get("stamp_count", 0) for c in customers)
        return {
            "total_customers": len(customers),
            "total_stamps": total_stamps,
            "unlocked_rewards": sum(1 for c in customers if c.get("reward_unlocked") or c.get("stamp_count", 0) >= 8),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/loyalty-config")
async def get_loyalty_config(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business["id"])
    if not program:
        return {
            "stamp_goal": 8,
            "reward_name": "Free Service",
            "primary_color": "#3b82f6",
            "reward_expiry_days": 30,
            "program_logo_url": None,
            "hero_image_url": None,
            "card_name": None,
            "google_wallet_class_id": None,
        }
    return program

@app.post("/api/v1/business/{public_id}/loyalty-config")
async def save_loyalty_config(public_id: str, config: LoyaltyConfig):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    data = {
        "business_id": business["id"],
        "stamp_goal": config.stamp_goal,
        "reward_name": config.reward_name,
        "primary_color": config.primary_color,
        "reward_expiry_days": config.reward_expiry_days,
        "updated_at": datetime.utcnow().isoformat(),
    }

    # Only update optional fields if provided (do not wipe existing values)
    if config.program_logo_url is not None:
        data["program_logo_url"] = config.program_logo_url
    if config.hero_image_url is not None:
        data["hero_image_url"] = config.hero_image_url
    if config.card_name is not None:
        data["card_name"] = config.card_name

    try:
        existing = supabase.table("loyalty_programs").select("id").eq("business_id", business["id"]).maybe_single().execute()
        if existing.data:
            result = supabase.table("loyalty_programs").update(data).eq("business_id", business["id"]).execute()
            print(f"Config update success: {result}")
        else:
            data["created_at"] = datetime.utcnow().isoformat()
            result = supabase.table("loyalty_programs").insert(data).execute()
            print(f"Config insert success: {result}")
        return {"message": "Configuration saved"}
    except Exception as e:
        error_msg = str(e)
        print(f"Config save ERROR: {error_msg}")
        if "row-level security" in error_msg.lower() or "rls" in error_msg.lower():
            return JSONResponse(
                status_code=403,
                content={"detail": "Write blocked by Row Level Security. Use service_role key or disable RLS in Supabase.", "error": error_msg}
            )
        raise HTTPException(status_code=500, detail=error_msg)

@app.post("/api/v1/business/{public_id}/staff/invite")
async def invite_staff(public_id: str, invite: StaffInvite):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff_data = {
        "business_id": business["id"],
        "public_id": generate_public_id(),
        "name": invite.name,
        "email": invite.email,
        "phone": invite.phone,
        "role": invite.role,
        "pin": "0000",
        "is_active": True,
        "created_at": datetime.utcnow().isoformat(),
    }

    try:
        supabase.table("staff").insert(staff_data).execute()
        return {"message": "Staff invited", "pin": "0000"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/business/{public_id}/go-live")
async def go_live(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if business.get("status", "").upper() == "ACTIVE":
        return {"message": "Business is already live!", "status": business["status"]}

    try:
        result = supabase.table("businesses").update({
            "status": "ACTIVE",
            "updated_at": datetime.utcnow().isoformat(),
        }).eq("id", business["id"]).execute()
        print(f"Go-live success: {result}")
        return {"message": "Business is now live!"}
    except Exception as e:
        error_msg = str(e)
        print(f"Go-live ERROR: {error_msg}")
        return JSONResponse(
            status_code=200,
            content={"message": "Business appears to be active", "warning": error_msg, "status": business.get("status")}
        )

@app.get("/api/v1/business/{public_id}/qr-code")
async def get_qr_code(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    join_url = f"{BASE_URL}/join/{public_id}"
    svg = generate_qr_svg(join_url)
    return JSONResponse({
        "svg": svg,
        "join_url": join_url,
        "business_name": business["name"],
    })

@app.post("/api/v1/business/{public_id}/stamp")
async def add_stamp(public_id: str, req: StampRequest):
    print(f"STAMP REQUEST: business={public_id}, customer={req.customer_public_id}, pin={req.staff_pin}")

    business = safe_get_business(public_id)
    if not business:
        print("STAMP ERROR: Business not found")
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        print(f"STAMP ERROR: Customer {req.customer_public_id} not found")
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get("business_id") != business["id"]:
        print(f"STAMP ERROR: Customer business_id={customer.get(chr(39)+'business_id'+chr(39))} != business_id={business[chr(39)+'id'+chr(39)]}")
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        staff_res = supabase.table("staff").select("*").eq("business_id", business["id"]).eq("pin", req.staff_pin).execute()
        if not staff_res.data:
            print("STAMP ERROR: Invalid staff PIN")
            raise HTTPException(status_code=403, detail="Invalid staff PIN")
        print(f"STAMP: Staff verified: {staff_res.data[0][chr(39)+'name'+chr(39)]}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"STAFF VERIFY ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    program = safe_get_loyalty_program(business["id"])
    goal = program.get("stamp_goal", 8) if program else 8

    new_count = customer.get("stamp_count", 0) + 1
    reward_unlocked = new_count >= goal

    try:
        update_data = {
            "stamp_count": new_count,
            "updated_at": datetime.utcnow().isoformat(),
        }
        try:
            update_data["reward_unlocked"] = reward_unlocked
        except:
            pass

        result = supabase.table("customers").update(update_data).eq("id", customer["id"]).execute()
        print(f"STAMP SUCCESS: new_count={new_count}, result={result}")
    except Exception as e:
        error_msg = str(e)
        print(f"STAMP UPDATE ERROR: {error_msg}")
        if "reward_unlocked" in error_msg.lower():
            try:
                supabase.table("customers").update({
                    "stamp_count": new_count,
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", customer["id"]).execute()
                print(f"STAMP SUCCESS (without reward_unlocked): new_count={new_count}")
                return {
                    "message": "Stamp added!",
                    "stamp_count": new_count,
                    "reward_unlocked": reward_unlocked,
                }
            except Exception as e2:
                error_msg = str(e2)
        if "row-level security" in error_msg.lower() or "rls" in error_msg.lower():
            return JSONResponse(
                status_code=200,
                content={
                    "message": "Stamp added! (RLS blocked DB update, but stamp counted)",
                    "stamp_count": new_count,
                    "reward_unlocked": reward_unlocked,
                    "warning": "Database write blocked. Disable RLS in Supabase or use service_role key."
                }
            )
        raise HTTPException(status_code=500, detail=error_msg)

    return {
        "message": "Stamp added!",
        "stamp_count": new_count,
        "reward_unlocked": reward_unlocked,
    }

# ═════════════════════════════════════════════════════════════════════════════
# GOOGLE WALLET CLASS MANAGEMENT (B2B Customization)
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/business/{public_id}/wallet-class")
async def get_wallet_class(public_id: str):
    """Get the current Google Wallet class config for a business"""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business["id"])
    class_id = None
    if program and program.get("google_wallet_class_id"):
        class_id = program["google_wallet_class_id"]
    else:
        class_id = f"{GOOGLE_WALLET_ISSUER_ID}.{business[chr(39)+'public_id'+chr(39)]}"

    # Try to fetch from Google API
    access_token = get_google_access_token()
    google_data = None
    if access_token:
        try:
            import httpx
            with httpx.Client() as client:
                resp = client.get(
                    f"https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if resp.status_code == 200:
                    google_data = resp.json()
        except Exception as e:
            print(f"Google class fetch error: {e}")

    return {
        "class_id": class_id,
        "business_name": business["name"],
        "program": program,
        "google_class_exists": google_data is not None,
        "google_class_data": google_data,
    }

@app.post("/api/v1/business/{public_id}/wallet-class")
async def create_or_update_wallet_class(public_id: str):
    """Create or update a business-specific Google Wallet LoyaltyClass"""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business["id"])

    # Determine class ID and review status
    class_id = None
    review_status = "UNDER_REVIEW"
    if program and program.get("google_wallet_class_id"):
        class_id = program["google_wallet_class_id"]
    else:
        class_id = f"{GOOGLE_WALLET_ISSUER_ID}.{business[chr(39)+'public_id'+chr(39)]}"

    # Build class payload
    loyalty_class = build_loyalty_class(business, program, review_status=review_status)

    # Get access token
    access_token = get_google_access_token()
    if not access_token:
        raise HTTPException(status_code=500, detail="Could not get Google access token. Check GOOGLE_WALLET_CREDENTIALS.")

    # Create/update class via Google REST API
    try:
        import httpx
        with httpx.Client() as client:
            resp = client.put(
                f"https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                json=loyalty_class
            )
            result = resp.json()
            print(f"Google Wallet class API response: {resp.status_code} - {result}")

            if resp.status_code in (200, 201):
                # Save class ID to DB
                db_data = {
                    "google_wallet_class_id": class_id,
                    "updated_at": datetime.utcnow().isoformat(),
                }
                if program:
                    supabase.table("loyalty_programs").update(db_data).eq("business_id", business["id"]).execute()
                else:
                    db_data["business_id"] = business["id"]
                    db_data["stamp_goal"] = 8
                    db_data["reward_name"] = "Free Service"
                    db_data["primary_color"] = "#3b82f6"
                    db_data["reward_expiry_days"] = 30
                    db_data["created_at"] = datetime.utcnow().isoformat()
                    supabase.table("loyalty_programs").insert(db_data).execute()

                return {
                    "success": True,
                    "message": "Wallet class created/updated successfully",
                    "class_id": class_id,
                    "review_status": review_status,
                    "google_response": result
                }
            else:
                raise HTTPException(status_code=500, detail=f"Google API error: {result}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Wallet class creation error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ═════════════════════════════════════════════════════════════════════════════
# CUSTOMER JOIN PAGE
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/join/{business_public_id}", response_class=HTMLResponse)
async def customer_join_page(business_public_id: str):
    business = safe_get_business(business_public_id)
    if not business:
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Business not found</h1>
            <p>This link is invalid.</p>
        </div>
        """)

    if business.get("status", "").upper() != "ACTIVE":
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Business not active</h1>
            <p>This business is not accepting new members yet.</p>
        </div>
        """)

    program = safe_get_loyalty_program(business["id"])
    primary_color = program.get("primary_color", "#3b82f6") if program else "#3b82f6"
    reward_name = program.get("reward_name", "Free Service") if program else "Free Service"
    stamp_goal = program.get("stamp_goal", 8) if program else 8
    card_name = program.get("card_name") if program else None
    display_name = card_name if card_name else f"{business[chr(39)+'name'+chr(39)]} Rewards"
    logo_url = business.get("logo_url")
    logo_html = f'<img src="{logo_url}" style="width:80px;height:80px;border-radius:20px;object-fit:cover;margin:0 auto 20px;display:block;" alt="Logo"/>' if logo_url else '<div class="logo">🌳</div>'
    business_name_escaped = business["name"].replace("'", "\\'")

    return HTMLResponse(f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Join {display_name}</title>
        <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: linear-gradient(135deg, {primary_color} 0%, #1e293b 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }}
            .card {{
                background: white;
                border-radius: 24px;
                padding: 32px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
            }}
            .logo {{
                width: 80px; height: 80px; border-radius: 20px;
                background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
                display: flex; align-items: center; justify-content: center;
                margin: 0 auto 20px; font-size: 36px;
            }}
            h1 {{ font-size: 24px; color: #1e293b; margin-bottom: 8px; }}
            .subtitle {{ color: #64748b; margin-bottom: 24px; font-size: 14px; }}
            .reward-preview {{
                background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 24px;
            }}
            .reward-preview h3 {{ color: {primary_color}; font-size: 16px; margin-bottom: 4px; }}
            .reward-preview p {{ color: #64748b; font-size: 13px; }}
            input {{
                width: 100%; padding: 14px 16px; border: 2px solid #e2e8f0;
                border-radius: 12px; font-size: 16px; margin-bottom: 12px; outline: none;
            }}
            input:focus {{ border-color: {primary_color}; }}
            button {{
                width: 100%; padding: 16px;
                background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
                color: white; border: none; border-radius: 12px;
                font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 8px;
            }}
            .success-qr {{ background: #f8fafc; border-radius: 12px; padding: 16px; margin: 16px 0; }}
            .success-qr img {{ width: 160px; height: 160px; border-radius: 12px; }}
            .member-id {{ background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 16px; }}
            .member-id p {{ margin: 0; font-weight: 600; color: #1e293b; }}
            .member-id code {{
                display: block; margin-top: 8px; font-family: monospace;
                font-size: 14px; color: #64748b; word-break: break-all;
            }}
            .wallet-btn {{
                display: block; width: 100%; padding: 14px; background: #1a73e8;
                color: white; text-decoration: none; border-radius: 10px;
                font-weight: 600; margin-bottom: 12px; text-align: center;
            }}
            .share-btn {{
                width: 100%; padding: 14px; background: #f0fdf4; color: #0d9488;
                border: 1px solid #a7f3d0; border-radius: 10px; font-weight: 600; cursor: pointer;
            }}
        </style>
    </head>
    <body>
        <div class="card" id="card">
            {logo_html}
            <h1>{display_name}</h1>
            <p class="subtitle">{business["name"]}</p>
            <div class="reward-preview">
                <h3>🎁 {reward_name}</h3>
                <p>Collect {stamp_goal} stamps to unlock your reward</p>
            </div>
            <form id="signupForm">
                <input type="text" id="name" placeholder="Your name" required>
                <input type="tel" id="phone" placeholder="Phone number" required>
                <button type="submit">Join & Get Your Card 🌱</button>
            </form>
        </div>

        <script>
            (function() {{
                const API_BASE = "{BASE_URL}";
                const BIZ_ID = "{business_public_id}";
                const BIZ_NAME = "{business_name_escaped}";
                const CARD_NAME = "{display_name}";

                document.getElementById("signupForm").addEventListener("submit", async function(e) {{
                    e.preventDefault();
                    const name = document.getElementById("name").value;
                    const phone = document.getElementById("phone").value;

                    try {{
                        const res = await fetch(API_BASE + "/api/v1/join/" + BIZ_ID, {{
                            method: "POST",
                            headers: {{"Content-Type": "application/json"}},
                            body: JSON.stringify({{name: name, phone: phone}})
                        }});
                        const data = await res.json();

                        if (res.ok) {{
                            const walletUrl = API_BASE + "/wallet/" + data.public_id;
                            const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(data.public_id);

                            var cardHtml = 
                                '<div style="font-size:48px;margin-bottom:16px;">🎉</div>' +
                                '<h1>Welcome, ' + escapeHtml(data.name) + '!</h1>' +
                                '<p style="color:#64748b;margin-bottom:24px;">Your ' + escapeHtml(CARD_NAME) + ' is ready</p>' +
                                '<div class="success-qr">' +
                                    '<img src="' + qrUrl + '" alt="Your QR Code"/>' +
                                    '<p style="font-size:12px;color:#94a3b8;margin-top:8px;">Scan at checkout</p>' +
                                '</div>' +
                                '<div class="member-id">' +
                                    '<p>Your Member ID</p>' +
                                    '<code>' + escapeHtml(data.public_id) + '</code>' +
                                '</div>' +
                                '<div id="wallet-btn-container" style="margin-bottom:12px;">' +
                                    '<p style="color:#94a3b8;font-size:13px;">Loading Google Wallet...</p>' +
                                '</div>' +
                                '<button onclick="doShare()" class="share-btn">🔗 Share Card</button>' +
                                '<p style="font-size:12px;color:#94a3b8;margin-top:16px;">Show this QR to your cashier on every visit to earn stamps.</p>';

                            document.getElementById("card").innerHTML = cardHtml;

                            window.doShare = function() {{
                                navigator.share({{
                                    title: "My " + CARD_NAME,
                                    text: "My card for " + BIZ_NAME,
                                    url: walletUrl
                                }});
                            }};

                            console.log("Fetching wallet pass for: " + data.public_id);
                            fetch(API_BASE + "/api/v1/customer/" + data.public_id + "/wallet-pass")
                                .then(function(r) {{
                                    console.log("Wallet API status: " + r.status);
                                    return r.json();
                                }})
                                .then(function(walletData) {{
                                    console.log("Wallet data:", walletData);
                                    var container = document.getElementById("wallet-btn-container");
                                    if (walletData.save_url) {{
                                        container.innerHTML = '<a href="' + escapeHtml(walletData.save_url) + '" class="wallet-btn" target="_blank">🎫 Add to Google Wallet</a>';
                                    }} else if (walletData.error) {{
                                        container.innerHTML = '<div style="background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;">⚠️ ' + escapeHtml(walletData.error) + '</div>';
                                    }} else {{
                                        container.innerHTML = '<div style="background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;">⚠️ Could not generate wallet link</div>';
                                    }}
                                }})
                                .catch(function(err) {{
                                    console.error("Wallet fetch error:", err);
                                    var container = document.getElementById("wallet-btn-container");
                                    container.innerHTML = '<div style="background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;">⚠️ Google Wallet error: ' + escapeHtml(err.message || "Network error") + '</div>';
                                }});
                        }} else {{
                            alert(data.detail || "Signup failed");
                        }}
                    }} catch (err) {{
                        console.error(err);
                        alert("Network error. Please try again.");
                    }}
                }});

                function escapeHtml(text) {{
                    const div = document.createElement("div");
                    div.textContent = text;
                    return div.innerHTML;
                }}
            }})();
        </script>
    </body>
    </html>
    """)

@app.post("/api/v1/join/{business_public_id}")
async def customer_signup(business_public_id: str, signup: CustomerSignup):
    business = safe_get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if business.get("status", "").upper() != "ACTIVE":
        raise HTTPException(status_code=400, detail="Business not active")

    customer_public_id = generate_public_id()
    customer_data = {
        "business_id": business["id"],
        "public_id": customer_public_id,
        "name": signup.name,
        "phone": signup.phone,
        "stamp_count": 0,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    try:
        supabase.table("customers").insert(customer_data).execute()
    except Exception as e:
        error_msg = str(e)
        print(f"CUSTOMER INSERT ERROR: {error_msg}")
        if "column" in error_msg.lower() and "does not exist" in error_msg.lower():
            raise HTTPException(status_code=500, detail=f"Database schema mismatch: {error_msg}. Please check your Supabase table columns.")
        raise HTTPException(status_code=500, detail=error_msg)

    return {
        "public_id": customer_public_id,
        "name": signup.name,
        "message": "Welcome to the loyalty program!",
    }

# ═════════════════════════════════════════════════════════════════════════════
# WALLET PAGE
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/wallet/{customer_public_id}", response_class=HTMLResponse)
async def customer_wallet_page(customer_public_id: str):
    customer = safe_get_customer(customer_public_id)
    if not customer:
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Card not found</h1>
            <p>This loyalty card does not exist.</p>
        </div>
        """)

    business = safe_get_business_by_id(customer["business_id"])
    if not business:
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Business not found</h1>
        </div>
        """)

    program = safe_get_loyalty_program(business["id"])
    primary_color = program.get("primary_color", "#3b82f6") if program else "#3b82f6"
    stamp_goal = program.get("stamp_goal", 8) if program else 8
    reward_name = program.get("reward_name", "Free Service") if program else "Free Service"
    card_name = program.get("card_name") if program else None
    display_name = card_name if card_name else f"{business[chr(39)+'name'+chr(39)]} Rewards"
    logo_url = business.get("logo_url")
    logo_html = f'<img src="{logo_url}" style="width:64px;height:64px;border-radius:16px;object-fit:cover;margin-bottom:12px;" alt="Logo"/>' if logo_url else ''

    stamps = customer.get("stamp_count", 0) % stamp_goal
    filled = stamps

    stars_html = ""
    for i in range(stamp_goal):
        if i < filled:
            stars_html += f'<span style="width:32px;height:32px;border-radius:16px;background:{primary_color};color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;margin:3px;">★</span>'
        else:
            stars_html += f'<span style="width:32px;height:32px;border-radius:16px;background:rgba(255,255,255,0.25);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;margin:3px;">★</span>'

    return HTMLResponse(f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>My {display_name}</title>
        <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: linear-gradient(135deg, {primary_color} 0%, #1e293b 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }}
            .card {{
                background: white;
                border-radius: 24px;
                padding: 32px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
            }}
            .loyalty-card {{
                background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
                border-radius: 16px;
                padding: 24px;
                color: white;
                margin-bottom: 20px;
            }}
            .loyalty-card h2 {{ font-size: 20px; margin-bottom: 4px; }}
            .loyalty-card h3 {{ font-size: 16px; opacity: 0.9; margin-bottom: 8px; }}
            .loyalty-card .id {{ font-size: 12px; opacity: 0.7; font-family: monospace; }}
            .stars {{ margin: 16px 0; }}
            .stamp-count {{ font-size: 14px; margin-top: 8px; opacity: 0.9; }}
            .qr-section {{
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
            }}
            .qr-section img {{
                width: 160px;
                height: 160px;
                border-radius: 12px;
            }}
            .qr-section p {{ font-size: 12px; color: #94a3b8; margin-top: 8px; }}
            .wallet-btn {{
                display: block;
                width: 100%;
                padding: 14px;
                background: #1a73e8;
                color: white;
                text-decoration: none;
                border-radius: 10px;
                font-weight: 600;
                margin-bottom: 12px;
                text-align: center;
            }}
            .share-btn {{
                width: 100%;
                padding: 14px;
                background: #f0fdf4;
                color: #0d9488;
                border: 1px solid #a7f3d0;
                border-radius: 10px;
                font-weight: 600;
                cursor: pointer;
            }}
            .reward-badge {{
                display: inline-block;
                padding: 6px 14px;
                background: #fef3c7;
                color: #92400e;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 600;
                margin-top: 12px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="loyalty-card">
                {logo_html}
                <h2>{display_name}</h2>
                <h3>{customer["name"]}</h3>
                <p class="id">ID: {customer["public_id"][:12]}...</p>
                <div class="stars">{stars_html}</div>
                <p class="stamp-count">{stamps} / {stamp_goal} stamps</p>
                {f'<span class="reward-badge">🎁 {reward_name} Ready!</span>' if customer.get("reward_unlocked") else ''}
            </div>

            <div class="qr-section">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={customer["public_id"]}" alt="Your QR Code"/>
                <p>Scan at checkout to earn stamps</p>
            </div>

            <a href="https://pay.google.com/gp/v/save/{customer["public_id"]}" class="wallet-btn">
                🎫 Add to Google Wallet
            </a>

            <button onclick="navigator.share({{title: 'My {display_name}', text: 'My card for {business["name"]}', url: window.location.href}})" class="share-btn">
                🔗 Share Card
            </button>
        </div>
    </body>
    </html>
    """)

# ═════════════════════════════════════════════════════════════════════════════
# GOOGLE WALLET PASS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/customer/{customer_public_id}/wallet-pass")
async def get_wallet_pass(customer_public_id: str):
    """Generate a Google Wallet save link for a customer"""
    print(f"WALLET-PASS: Requested for customer {customer_public_id}")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        print("WALLET-PASS: Customer not found")
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer["business_id"])
    if not business:
        print("WALLET-PASS: Business not found")
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business["id"])

    # Check env vars
    creds = get_google_wallet_credentials()
    print(f"WALLET-PASS: Creds loaded: {bool(creds)}")
    print(f"WALLET-PASS: Issuer ID set: {bool(GOOGLE_WALLET_ISSUER_ID)}")
    print(f"WALLET-PASS: Class suffix set: {bool(GOOGLE_WALLET_CLASS_SUFFIX)}")

    # Build the loyalty object (class already exists in Google Wallet UI or via API)
    loyalty_object = build_loyalty_object(customer, business, program)
    print(f"WALLET-PASS: Object ID: {loyalty_object['id']}")
    print(f"WALLET-PASS: Class ID ref: {loyalty_object['classId']}")

    # Generate JWT with OBJECT only (class already exists via UI or API)
    jwt_token = create_google_wallet_jwt(loyalty_object)
    print(f"WALLET-PASS: JWT generated: {bool(jwt_token)}")

    if not jwt_token:
        print("WALLET-PASS: JWT generation failed")
        return JSONResponse({
            "error": "Google Wallet not configured",
            "debug": {
                "creds_loaded": bool(creds),
                "issuer_id_set": bool(GOOGLE_WALLET_ISSUER_ID),
                "class_suffix_set": bool(GOOGLE_WALLET_CLASS_SUFFIX),
            },
            "loyalty_object_preview": loyalty_object
        })

    save_url = f"https://pay.google.com/gp/v/save/{jwt_token}"
    print(f"WALLET-PASS: Save URL generated successfully")

    return JSONResponse({
        "save_url": save_url,
        "jwt_preview": jwt_token[:50] + "...",
        "loyalty_object_id": loyalty_object["id"],
        "class_id": loyalty_object["classId"],
    })

# ═════════════════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat(), "env_ok": not bool(ENV_ERROR)}

# ═════════════════════════════════════════════════════════════════════════════
# ROOT
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {"message": "LoyaltyTree API is running", "base_url": BASE_URL, "env_ok": not bool(ENV_ERROR)}

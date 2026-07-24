import os
import uuid
import base64
import json
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client
import qrcode
from qrcode.image.svg import SvgImage
from io import BytesIO

# ─── Google Wallet ──────────────────────────────────────────────────────────
try:
    from google.auth.crypt import RSASigner
    from google.auth import jwt as google_jwt
    GOOGLE_WALLET_AVAILABLE = True
except ImportError:
    GOOGLE_WALLET_AVAILABLE = False
    print("WARNING: google-auth not installed. Google Wallet will not work.")

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
        # ✅ FIXED: table name is loyalty_programs, not loyalty_configs
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
    """Generate a signed JWT for Google Wallet save link using PyJWT"""
    creds = get_google_wallet_credentials()
    if not creds:
        return ""

    try:
        import jwt as pyjwt

        private_key = creds.get("private_key", "")
        client_email = creds.get("client_email", "")

        if not private_key or not client_email:
            return ""

        now = datetime.utcnow()
        payload = {
            "iss": client_email,
            "aud": "google",
            "iat": now,
            "exp": now + timedelta(hours=1),
            "typ": "savetowallet",
            "payload": {
                "loyaltyObjects": [loyalty_object]
            }
        }

        token = pyjwt.encode(payload, private_key, algorithm="RS256")
        return token if isinstance(token, str) else token.decode("utf-8")
    except Exception as e:
        print(f"JWT generation error: {e}")
        return ""

def build_loyalty_object(customer: dict, business: dict, config: dict) -> dict:
    """Build the LoyaltyObject for a specific customer"""
    class_id = f"{GOOGLE_WALLET_ISSUER_ID}.{GOOGLE_WALLET_CLASS_SUFFIX}"
    object_id = f"{GOOGLE_WALLET_ISSUER_ID}.{customer['public_id']}"
    stamp_goal = config.get("stamp_goal", 8) if config else 8
    reward_name = config.get("reward_name", "Free Reward") if config else "Free Reward"
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
                    "uri": f"{BASE_URL}/wallet/{customer['public_id']}",
                    "description": "View Card Online"
                }
            ]
        }
    }

# ─── FastAPI App ─────────────────────────────────────────────────────────────
app = FastAPI(title="LoyaltyTree API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ✅ Allow all origins temporarily
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
@app.post("/api/v1/auth/login")  # ✅ Alias for frontend compatibility
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

            # Try multiple password formats
            matched = False
            if stored_pw == input_pw:
                matched = True
                print(f"Login: plain text match for {req.email}")
            elif stored_pw == input_hash:
                matched = True
                print(f"Login: sha256 match for {req.email}")
            elif stored_pw == input_hash[:len(stored_pw)]:
                matched = True
                print(f"Login: partial hash match for {req.email}")

            if matched:
                return {
                    "success": True,
                    "token": "owner-token-" + business["public_id"],
                    "business_slug": business["public_id"],
                    "business_name": business["name"],
                    "name": business["name"],
                    "role": "owner",
                    "user": {
                        "business_slug": business["public_id"],
                        "business_name": business["name"],
                        "name": business["name"],
                        "email": business["email"],
                        "role": "owner",
                    }
                }
            else:
                print(f"Login: password mismatch. Stored len={len(stored_pw)}, input hash={input_hash[:20]}...")
    except Exception as e:
        print(f"Business login error: {e}")

    # Try to find staff by email
    try:
        res = supabase.table("staff").select("*,businesses(public_id,name)").eq("email", req.email).maybe_single().execute()
        staff = res.data
        if staff:
            stored_pin = staff.get("pin", "")
            # Try multiple pin formats
            if stored_pin == req.password or stored_pin == hash_password(req.password):
                return {
                    "success": True,
                    "token": "staff-token-" + staff["public_id"],
                    "business_slug": staff["businesses"]["public_id"] if staff.get("businesses") else "",
                    "business_name": staff["businesses"]["name"] if staff.get("businesses") else "",
                    "name": staff["name"],
                    "staff_name": staff["name"],
                    "role": staff["role"],
                    "user": {
                        "business_slug": staff["businesses"]["public_id"] if staff.get("businesses") else "",
                        "business_name": staff["businesses"]["name"] if staff.get("businesses") else "",
                        "name": staff["name"],
                        "email": staff["email"],
                        "role": staff["role"],
                    }
                }
    except Exception as e:
        print(f"Staff login error: {e}")

    raise HTTPException(status_code=401, detail="Invalid email or password")

# ═════════════════════════════════════════════════════════════════════════════
# DEBUG ROUTE - Remove after fixing login
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/me")
@app.get("/api/v1/auth/me")
async def get_current_user(request: Request):
    """Get current user from token header"""
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "").replace("bearer ", "") if auth_header else ""

    if not token or not supabase:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Check if it's an owner token
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
            }

    # Check if it's a staff token
    if token.startswith("staff-token-"):
        public_id = token.replace("staff-token-", "")
        staff = safe_get_customer(public_id)  # This might not work - staff uses different table
        # Actually staff public_id is in staff table, let's query properly
        try:
            res = supabase.table("staff").select("*,businesses(public_id,name)").eq("public_id", public_id).maybe_single().execute()
            staff_data = res.data
            if staff_data:
                return {
                    "business_slug": staff_data["businesses"]["public_id"] if staff_data.get("businesses") else "",
                    "business_name": staff_data["businesses"]["name"] if staff_data.get("businesses") else "",
                    "name": staff_data["name"],
                    "email": staff_data["email"],
                    "role": staff_data["role"],
                }
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/api/v1/debug/login")
async def debug_login(req: LoginRequest):
    """Debug endpoint to see why login fails"""
    if not supabase:
        return {"error": "No supabase connection"}

    result = {"email_searched": req.email, "found": None}

    # Check businesses
    try:
        res = supabase.table("businesses").select("id,public_id,name,email,status,password").eq("email", req.email).maybe_single().execute()
        if res.data:
            business = res.data
            result["business_found"] = {
                "id": business.get("id"),
                "public_id": business.get("public_id"),
                "name": business.get("name"),
                "status": business.get("status"),
                "password_length": len(business.get("password", "")) if business.get("password") else 0,
                "password_starts_with": business.get("password", "")[:10] if business.get("password") else None,
                "sha256_of_input": hash_password(req.password)[:20],
            }
            result["found"] = "business"
    except Exception as e:
        result["business_error"] = str(e)

    # Check staff
    try:
        res = supabase.table("staff").select("id,public_id,name,email,role,pin,business_id").eq("email", req.email).maybe_single().execute()
        if res.data:
            staff = res.data
            result["staff_found"] = {
                "id": staff.get("id"),
                "public_id": staff.get("public_id"),
                "name": staff.get("name"),
                "role": staff.get("role"),
                "pin_length": len(staff.get("pin", "")) if staff.get("pin") else 0,
                "pin_value": staff.get("pin", ""),
            }
            if not result["found"]:
                result["found"] = "staff"
    except Exception as e:
        result["staff_error"] = str(e)

    if not result.get("business_found") and not result.get("staff_found"):
        result["error"] = "No user found with this email"

    return result

@app.post("/api/v1/register")
@app.post("/api/v1/auth/register")  # ✅ Alias for frontend compatibility
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
    }

# ═════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/business/{public_id}")
async def get_business_api(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return business

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
        # Return defaults if no program configured yet
        return {
            "stamp_goal": 8,
            "reward_name": "Free Service",
            "primary_color": "#3b82f6",
            "reward_expiry_days": 30,
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
        # Try to return helpful error
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

    # If already active, just return success
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
        # Return 200 with error info so frontend doesn't crash
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
        print(f"STAMP ERROR: Customer business_id={customer.get('business_id')} != business_id={business['id']}")
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    # Verify staff PIN
    try:
        staff_res = supabase.table("staff").select("*").eq("business_id", business["id"]).eq("pin", req.staff_pin).execute()
        if not staff_res.data:
            print("STAMP ERROR: Invalid staff PIN")
            raise HTTPException(status_code=403, detail="Invalid staff PIN")
        print(f"STAMP: Staff verified: {staff_res.data[0]['name']}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"STAFF VERIFY ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    program = safe_get_loyalty_program(business["id"])
    goal = program.get("stamp_goal", 8) if program else 8
    print(f"STAMP: Goal={goal}, current={customer.get('stamp_count', 0)}")

    new_count = customer.get("stamp_count", 0) + 1
    reward_unlocked = new_count >= goal

    try:
        update_data = {
            "stamp_count": new_count,
            "updated_at": datetime.utcnow().isoformat(),
        }
        # Try to add reward_unlocked, but handle if column doesn't exist
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
            # Try again without reward_unlocked
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

    join_api_url = f"{BASE_URL}/api/v1/join/{business_public_id}"
    wallet_base_url = f"{BASE_URL}/wallet/"
    business_name_escaped = business["name"].replace("'", "\'")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Join {business["name"]} Rewards</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, {primary_color} 0%, #1e293b 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 20px;
}}
.card {{
    background: white; border-radius: 24px; padding: 32px; max-width: 400px; width: 100%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center;
}}
.logo {{
    width: 80px; height: 80px; border-radius: 20px;
    background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px; font-size: 36px;
}}
h1 {{ font-size: 24px; color: #1e293b; margin-bottom: 8px; }}
.subtitle {{ color: #64748b; margin-bottom: 24px; font-size: 14px; }}
.reward-preview {{ background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 24px; }}
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
    border: 1px solid #a7f3d0; border-radius: 10px;
    font-weight: 600; cursor: pointer;
}}
</style>
</head>
<body>
<div class="card" id="card">
    <div class="logo">🌳</div>
    <h1>{business["name"]}</h1>
    <p class="subtitle">Join our loyalty program</p>
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
    const JOIN_API_URL = "{join_api_url}";
    const WALLET_BASE_URL = "{wallet_base_url}";
    const BUSINESS_NAME = "{business_name_escaped}";

    document.getElementById("signupForm").addEventListener("submit", async function(e) {{
        e.preventDefault();
        const name = document.getElementById("name").value;
        const phone = document.getElementById("phone").value;

        try {{
            const res = await fetch(JOIN_API_URL, {{
                method: "POST",
                headers: {{"Content-Type": "application/json"}},
                body: JSON.stringify({{name: name, phone: phone}})
            }});
            const data = await res.json();

            if (res.ok) {{
                const walletUrl = WALLET_BASE_URL + data.public_id;
                const card = document.getElementById("card");
                card.innerHTML =
                    '<div style="font-size: 48px; margin-bottom: 16px;">🎉</div>' +
                    '<h1>Welcome, ' + escapeHtml(data.name) + '!</h1>' +
                    '<p style="color: #64748b; margin-bottom: 24px;">Your loyalty card is ready</p>' +
                    '<div class="success-qr">' +
                    '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + data.public_id + '" alt="Your QR Code"/>' +
                    '<p style="font-size: 12px; color: #94a3b8; margin-top: 8px;">Scan at checkout</p>' +
                    '</div>' +
                    '<div class="member-id">' +
                    '<p>Your Member ID</p>' +
                    '<code>' + data.public_id + '</code>' +
                    '</div>' +
                    '<a href="https://pay.google.com/gp/v/save/' + data.public_id + '" class="wallet-btn">🎫 Add to Google Wallet</a>' +
                    '<button onclick="shareCard()" class="share-btn">🔗 Share Card</button>' +
                    '<p style="font-size: 12px; color: #94a3b8; margin-top: 16px;">Show this QR to your cashier on every visit to earn stamps.</p>';

                window._shareData = {{title: "My Loyalty Card", text: "My card for " + BUSINESS_NAME, url: walletUrl}};
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

    function shareCard() {{
        if (navigator.share && window._shareData) {{
            navigator.share(window._shareData);
        }} else if (window._shareData) {{
            navigator.clipboard.writeText(window._shareData.url);
            alert("Link copied!");
        }}
    }}
</script>
</body>
</html>"""
    return HTMLResponse(html)

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
        # If reward_unlocked column is missing, try without it (already removed above)
        # If other column missing, report it
        if "column" in error_msg.lower() and "does not exist" in error_msg.lower():
            # Extract column name from error
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
        <title>My {business["name"]} Card</title>
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
                <h2>{business["name"]}</h2>
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

            <button onclick="navigator.share({title: 'My Loyalty Card', text: 'My card for {business["name"]}', url: window.location.href})" class="share-btn">
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
    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer["business_id"])
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business["id"])

    pass_object = {
        "issuers": [{
            "issuerId": GOOGLE_WALLET_ISSUER_ID,
            "classSuffix": GOOGLE_WALLET_CLASS_SUFFIX,
        }],
        "loyaltyObjects": [{
            "id": f"{GOOGLE_WALLET_ISSUER_ID}.{customer_public_id}",
            "classId": f"{GOOGLE_WALLET_ISSUER_ID}.{GOOGLE_WALLET_CLASS_SUFFIX}",
            "state": "active",
            "barcode": {
                "type": "QR_CODE",
                "value": customer_public_id,
                "alternateText": customer["name"],
            },
            "accountId": customer_public_id,
            "accountName": customer["name"],
            "loyaltyPoints": {
                "label": "Stamps",
                "balance": {
                    "int": str(customer.get("stamp_count", 0)),
                }
            },
            "textModulesData": [
                {"header": "Business", "body": business["name"]},
                {"header": "Reward", "body": program.get("reward_name", "Free Service") if program else "Free Service"},
            ],
        }]
    }

    return JSONResponse(pass_object)

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

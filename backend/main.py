import os
import re
import uuid
import base64
import json
import hashlib
import html as html_lib
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client
import qrcode
from qrcode.image.svg import SvgImage
from io import BytesIO

# Environment
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')
BASE_URL = os.getenv('BASE_URL', 'https://loyaltree-btw1.onrender.com')
GOOGLE_WALLET_ISSUER_ID = os.getenv('GOOGLE_WALLET_ISSUER_ID', '')
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv('GOOGLE_WALLET_CLASS_SUFFIX', '')
DEFAULT_LOGO_URL = os.getenv('DEFAULT_LOGO_URL', 'https://placehold.co/300x300/0d9488/ffffff.png?text=LoyaltyTree')

# Platform super-admin credentials (you, the LoyaltyTree operator - not a
# business owner). Set these in your environment; there is no signup flow
# for this role on purpose. If unset, the admin routes are disabled.
SUPER_ADMIN_EMAIL = os.getenv('SUPER_ADMIN_EMAIL', '')
SUPER_ADMIN_PASSWORD = os.getenv('SUPER_ADMIN_PASSWORD', '')

# Subscription tiers available to businesses. This is the single source of
# truth the admin dashboard reads from to show plan options and limits.
# Extend this dict when you're ready to add real billing/tier logic -
# nothing else needs to change to introduce a new plan.
SUBSCRIPTION_PLANS = {
    'starter': {'label': 'Starter', 'customer_limit': 100, 'price_month': 0},
    'growth': {'label': 'Growth', 'customer_limit': 1000, 'price_month': 29},
    'pro': {'label': 'Pro', 'customer_limit': None, 'price_month': 79},
}

ENV_ERROR = None
if not SUPABASE_URL or not SUPABASE_KEY:
    ENV_ERROR = 'SUPABASE_URL or SUPABASE_KEY not set in environment variables.'
    supabase = None
else:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        ENV_ERROR = str(e)
        supabase = None

# Pydantic Models
class BusinessCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    password: str
    logo_url: Optional[str] = None
    business_type: Optional[str] = 'other'
    plan: Optional[str] = 'starter'

class LoginRequest(BaseModel):
    email: str
    password: str

class StaffInvite(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    role: str = 'cashier'

class StaffUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None

class LoyaltyConfig(BaseModel):
    stamp_goal: int = Field(default=8, ge=3, le=20)
    reward_name: str = 'Free Service'
    primary_color: str = '#3b82f6'
    reward_expiry_days: int = Field(default=30, ge=1)
    program_logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    card_name: Optional[str] = None

class CustomerSignup(BaseModel):
    name: str
    address: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    phone: str
    email: Optional[str] = None
    birthday: Optional[str] = None  # 'YYYY-MM-DD'
    occupation: Optional[str] = None  # 'working' | 'business_owner' | 'unemployed'
    last_order_date: Optional[str] = None  # 'YYYY-MM-DD'

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    phone: Optional[str] = None
    email: Optional[str] = None
    birthday: Optional[str] = None  # 'YYYY-MM-DD'
    occupation: Optional[str] = None  # 'working' | 'business_owner' | 'unemployed'
    last_order_date: Optional[str] = None  # 'YYYY-MM-DD'

class StampRequest(BaseModel):
    customer_public_id: str
    staff_pin: str

class PinVerify(BaseModel):
    pin: str

class AnnouncementCreate(BaseModel):
    title: str
    message: str
    type: Optional[str] = 'info'
    is_active: Optional[bool] = True
    end_date: Optional[str] = None  # 'YYYY-MM-DD'

class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    type: Optional[str] = None
    is_active: Optional[bool] = None
    end_date: Optional[str] = None

class AdminLoginRequest(BaseModel):
    email: str
    password: str

class AdminBusinessUpdate(BaseModel):
    status: Optional[str] = None
    plan: Optional[str] = None

class RedeemRequest(BaseModel):
    customer_public_id: str
    staff_pin: str

# Helpers
def generate_public_id() -> str:
    return uuid.uuid4().hex

def slugify(text: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', (text or '').lower()).strip('-')
    return slug[:30] or 'biz'

def generate_business_public_id(name: str) -> str:
    """Human-readable business ID: 'businessname-xxxx' instead of a raw UUID,
    so cashiers can read/type it more easily when logging in."""
    slug = slugify(name)
    if not supabase:
        return f"{slug}-{uuid.uuid4().hex[:4]}"
    for _ in range(5):
        candidate = f"{slug}-{uuid.uuid4().hex[:4]}"
        try:
            existing = supabase.table("businesses").select("id").eq("public_id", candidate).maybe_single().execute()
        except Exception:
            existing = None
        if not existing or not existing.data:
            return candidate
    # Extremely unlikely fallback if 5 collisions happen in a row
    return f"{slug}-{uuid.uuid4().hex[:8]}"

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

def safe_get_staff(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("staff").select("*").eq("public_id", public_id).maybe_single().execute()
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

def get_admin_token() -> Optional[str]:
    """The one valid admin token, derived from the configured super-admin
    password. Stateless by design (matches owner/staff tokens elsewhere in
    this file) - no admin_sessions table to manage. Returns None if no
    super-admin password is configured, which disables the admin routes."""
    if not SUPER_ADMIN_PASSWORD:
        return None
    return "admin-token-" + hash_password(SUPER_ADMIN_PASSWORD)

def require_admin(request: Request):
    valid_token = get_admin_token()
    if not valid_token:
        raise HTTPException(status_code=503, detail="Admin access is not configured on this server")
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "").replace("bearer ", "") if auth_header else ""
    if not token or token != valid_token:
        raise HTTPException(status_code=401, detail="Admin authentication required")
    return True

def business_summary(biz: dict) -> dict:
    """Lightweight per-business row for the admin businesses list - counts
    only, no raw customer/staff records."""
    biz_id = biz.get('id')
    customer_count = 0
    staff_count = 0
    stamps_30d = 0
    try:
        cust_res = supabase.table("customers").select("id", count="exact").eq("business_id", biz_id).execute()
        customer_count = cust_res.count or 0
    except Exception:
        pass
    try:
        staff_res = supabase.table("staff").select("id", count="exact").eq("business_id", biz_id).execute()
        staff_count = staff_res.count or 0
    except Exception:
        pass
    try:
        since = (datetime.utcnow() - timedelta(days=30)).isoformat()
        stamp_res = supabase.table("stamp_events").select("id", count="exact").eq("business_id", biz_id).gte("created_at", since).execute()
        stamps_30d = stamp_res.count or 0
    except Exception:
        pass
    plan = biz.get('plan', 'starter')
    return {
        "public_id": biz.get("public_id", ""),
        "name": biz.get("name", ""),
        "email": biz.get("email", ""),
        "phone": biz.get("phone", ""),
        "status": biz.get("status", "PENDING"),
        "plan": plan,
        "plan_label": SUBSCRIPTION_PLANS.get(plan, {}).get("label", plan),
        "business_type": biz.get("business_type", "other"),
        "logo_url": biz.get("logo_url"),
        "created_at": biz.get("created_at"),
        "customer_count": customer_count,
        "staff_count": staff_count,
        "stamps_30d": stamps_30d,
    }

def generate_qr_svg(data: str) -> str:
    qr = qrcode.make(data, image_factory=SvgImage)
    buffer = BytesIO()
    qr.save(buffer)
    return buffer.getvalue().decode("utf-8")

# Google Wallet Helpers
def get_google_wallet_credentials():
    creds_json = os.getenv('GOOGLE_WALLET_CREDENTIALS', '')
    if not creds_json:
        return None
    try:
        return json.loads(creds_json)
    except:
        return None

def create_google_wallet_jwt(loyalty_object: dict) -> str:
    creds = get_google_wallet_credentials()
    if not creds:
        return ''
    try:
        import jwt as pyjwt
        private_key = creds.get('private_key', '')
        client_email = creds.get('client_email', '')
        if not private_key or not client_email:
            return ''
        now = datetime.utcnow()
        payload = {
            'iss': client_email,
            'aud': 'google',
            'iat': now,
            'exp': now + timedelta(hours=1),
            'origins': [BASE_URL, 'https://loyaltree-five.vercel.app'],
            'typ': 'savetowallet',
            'payload': {'loyaltyObjects': [loyalty_object]}
        }
        token = pyjwt.encode(payload, private_key, algorithm='RS256')
        return token if isinstance(token, str) else token.decode('utf-8')
    except Exception as e:
        print(f"JWT generation error: {e}")
        return ''

def get_google_access_token() -> str:
    creds = get_google_wallet_credentials()
    if not creds:
        return ''
    try:
        import jwt as pyjwt
        import httpx
        private_key = creds.get('private_key', '')
        client_email = creds.get('client_email', '')
        now = int(datetime.utcnow().timestamp())
        auth_payload = {
            'iss': client_email,
            'sub': client_email,
            'scope': 'https://www.googleapis.com/auth/wallet_object.issuer',
            'aud': 'https://oauth2.googleapis.com/token',
            'iat': now,
            'exp': now + 3600,
        }
        jwt_assertion = pyjwt.encode(auth_payload, private_key, algorithm='RS256')
        if isinstance(jwt_assertion, bytes):
            jwt_assertion = jwt_assertion.decode('utf-8')
        with httpx.Client() as client:
            resp = client.post(
                'https://oauth2.googleapis.com/token',
                data={
                    'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                    'assertion': jwt_assertion,
                }
            )
            return resp.json().get('access_token', '')
    except Exception as e:
        print(f"Access token error: {e}")
        return ''

def build_loyalty_class(business: dict, program: dict, review_status: str = 'UNDER_REVIEW') -> dict:
    biz_public_id = business.get('public_id', '')
    class_id = program.get('google_wallet_class_id') if program else None
    if not class_id:
        class_id = f'{GOOGLE_WALLET_ISSUER_ID}.{biz_public_id}'

    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    card_name = program.get('card_name') if program else None
    biz_name = business.get('name', 'Loyalty')
    program_name = card_name if card_name else f'{biz_name} Rewards'

    loyalty_class = {
        'id': class_id,
        'issuerName': biz_name,
        'programName': program_name,
        'reviewStatus': review_status,
        'hexBackgroundColor': primary_color if primary_color.startswith('#') else f'#{primary_color}',
        'textModulesData': [
            {'header': 'Reward', 'body': reward_name},
            {'header': 'About', 'body': 'Collect stamps, earn rewards'}
        ]
    }

    logo_url = business.get('logo_url')
    if not logo_url and program:
        logo_url = program.get('program_logo_url')
    if not logo_url:
        # Google Wallet requires a programLogo to create a class - fall back to a
        # generic placeholder so publishing never hard-fails when a business hasn't
        # uploaded their own logo yet. Businesses should still be encouraged to set
        # a real logo_url via signup or loyalty-config for a branded look.
        logo_url = DEFAULT_LOGO_URL
    loyalty_class['programLogo'] = {'sourceUri': {'uri': logo_url}}

    hero_url = program.get('hero_image_url') if program else None
    if hero_url:
        loyalty_class['heroImage'] = {'sourceUri': {'uri': hero_url}}

    return loyalty_class

def build_loyalty_object(customer: dict, business: dict, program: dict) -> dict:
    cust_public_id = customer.get('public_id', '')
    class_id = program.get('google_wallet_class_id') if program and program.get('google_wallet_class_id') else f'{GOOGLE_WALLET_ISSUER_ID}.{GOOGLE_WALLET_CLASS_SUFFIX}'
    object_id = f'{GOOGLE_WALLET_ISSUER_ID}.{cust_public_id}'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    stamps = customer.get('stamp_count', 0)
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', '')

    return {
        'id': object_id,
        'classId': class_id,
        'state': 'active',
        'barcode': {
            'type': 'QR_CODE',
            'value': cust_public_id,
            'alternateText': cust_name
        },
        'accountId': cust_public_id,
        'accountName': cust_name,
        'loyaltyPoints': {
            'label': 'Stamps',
            'balance': {'string': f'{stamps}/{stamp_goal}'}
        },
        'textModulesData': [
            {'header': 'Business', 'body': biz_name},
            {'header': 'Reward', 'body': reward_name},
            {'header': 'Progress', 'body': f'{stamps} of {stamp_goal} stamps'}
        ],
        'linksModuleData': {
            'uris': [{'uri': f'{BASE_URL}/wallet/{cust_public_id}', 'description': 'View Card Online'}]
        }
    }

def sync_wallet_object(customer: dict, business: dict, program: dict):
    """Push the customer's latest stamp count to Google Wallet.
    Google only creates its own copy of the loyaltyObject when the customer taps
    "Add to Google Wallet" - after that, changes in our DB never reach the saved
    pass unless we PATCH it here. Best-effort: never raises, so a Wallet API hiccup
    never blocks the stamp/redeem response to the cashier."""
    access_token = get_google_access_token()
    if not access_token:
        return
    try:
        import httpx
        loyalty_object = build_loyalty_object(customer, business, program)
        object_id = loyalty_object['id']
        with httpx.Client() as client:
            resp = client.patch(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}',
                headers={"Authorization": f"Bearer {access_token}"},
                json=loyalty_object
            )
            if resp.status_code in (200, 201):
                print(f"WALLET SYNC: updated {object_id}")
            elif resp.status_code == 404:
                print(f"WALLET SYNC: {object_id} not found - customer hasn't added it to their wallet yet")
            else:
                print(f"WALLET SYNC: failed {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"WALLET SYNC error: {e}")

def send_wallet_class_message(class_id: str, header: str, body: str, message_id: str, detail_url: str = None) -> bool:
    """Push a notification to every customer who has saved a loyalty card
    under this business's Wallet class. Google Wallet's addMessage endpoint on
    the *class* (not each individual object) fans the message out to every
    saved card in one call, which is what powers the phone notification -
    but only if messageType is TEXT_AND_NOTIFY. Plain TEXT silently adds the
    message to the back of the pass without ever firing a push/lock-screen
    notification, which looks identical to success in the API response.
    message_id should be stable per-announcement-send so re-calling this with
    the same id doesn't spam a duplicate notification.

    IMPORTANT - what the customer actually sees: the lock-screen notification
    text itself is controlled entirely by Google Wallet, not by header/body
    here - issuers can't customize it. Tapping the notification opens the
    pass with a "Review update" / "View message" callout that reveals header
    + body on the back of the pass. That back-of-pass view is the only place
    this app's content is actually shown, so if detail_url is given, it's
    appended to body as a hyperlink (Wallet supports basic <a> tags in
    message bodies) pointing at a full HTML detail page - useful since body
    is capped at 500 plain-text characters and can't hold images/formatting.

    Google-side limits to know about (not enforced by this app):
    - Max 3 notification-triggering messages per pass per rolling 24h; extra
      calls beyond that raise a quota error on Google's side.
    - The customer must have notifications enabled for the pass in their
      Google Wallet app, or nothing will show even though the API call
      succeeds.
    - Delivery isn't always instant; a short delay is normal."""
    access_token = get_google_access_token()
    if not access_token or not class_id:
        return False
    try:
        import httpx
        body_text = (body or '').strip()
        if detail_url:
            link_html = f' <a href="{detail_url}">View full details</a>'
            if len(body_text) + len(link_html) > 500:
                body_text = body_text[:500 - len(link_html)].rstrip() + '…'
            body_text = (body_text + link_html)[:500]
        else:
            body_text = body_text[:500]
        payload = {
            'message': {
                'header': (header or '')[:150],
                'body': body_text,
                'id': message_id,
                'messageType': 'TEXT_AND_NOTIFY',
            }
        }
        with httpx.Client() as client:
            resp = client.post(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}/addMessage',
                headers={"Authorization": f"Bearer {access_token}"},
                json=payload
            )
            if resp.status_code in (200, 201):
                print(f"WALLET PUSH: sent to class {class_id}")
                return True
            print(f"WALLET PUSH failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print(f"WALLET PUSH error: {e}")
        return False

def log_stamp_event(business_id: int, customer_id: int):
    """Best-effort event log powering the Analytics dashboard's trend and
    peak-activity charts. Never raises - a logging hiccup should never
    block the stamp response to the cashier."""
    try:
        supabase.table("stamp_events").insert({
            'business_id': business_id,
            'customer_id': customer_id,
            'created_at': datetime.utcnow().isoformat(),
        }).execute()
    except Exception as e:
        print(f"STAMP EVENT LOG error: {e}")

def log_redemption_event(business_id: int, customer_id: int):
    """Best-effort event log powering the Analytics dashboard's reward
    trend chart. Never raises."""
    try:
        supabase.table("redemption_events").insert({
            'business_id': business_id,
            'customer_id': customer_id,
            'created_at': datetime.utcnow().isoformat(),
        }).execute()
    except Exception as e:
        print(f"REDEMPTION EVENT LOG error: {e}")

# FastAPI App
app = FastAPI(title='LoyaltyTree API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.middleware("http")
async def check_env(request: Request, call_next):
    if ENV_ERROR:
        return HTMLResponse(f"""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
        <h1 style="color:#dc2626;font-size:48px;margin-bottom:16px;">&#9888;</h1>
        <h2 style="color:#1e293b;margin-bottom:16px;">Configuration Error</h2>
        <p style="color:#64748b;font-size:16px;line-height:1.6;margin-bottom:24px;">{ENV_ERROR}</p>
        </div>
        """)
    return await call_next(request)

# AUTH ROUTES

@app.post("/api/v1/login")
@app.post("/api/v1/auth/login")
async def login(req: LoginRequest):
    # Platform super-admin check happens first, and doesn't touch the
    # database at all - it's an env-configured account, not a row in
    # `businesses`. Checked before the DB call so it still works even if
    # SUPABASE_URL/KEY are misconfigured.
    admin_token = get_admin_token()
    if admin_token and req.email == SUPER_ADMIN_EMAIL and req.password == SUPER_ADMIN_PASSWORD:
        return {
            "success": True,
            "token": admin_token,
            "business_slug": "",
            "business_name": "LoyaltyTree Admin",
            "name": "Admin",
            "role": "super_admin",
            "logo_url": None,
            "user": {
                "business_slug": "",
                "business_name": "LoyaltyTree Admin",
                "name": "Admin",
                "email": SUPER_ADMIN_EMAIL,
                "role": "super_admin",
                "logo_url": None,
            }
        }

    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        res = supabase.table("businesses").select("*").eq("email", req.email).maybe_single().execute()
        business = res.data
        if business:
            stored_pw = business.get('password_hash', '')
            input_hash = hash_password(req.password)
            matched = (stored_pw == req.password) or (stored_pw == input_hash)
            if matched:
                return {
                    "success": True,
                    "token": "owner-token-" + business.get("public_id", ""),
                    "business_slug": business.get("public_id", ""),
                    "business_name": business.get("name", ""),
                    "name": business.get("name", ""),
                    "role": "owner",
                    "logo_url": business.get("logo_url"),
                    "user": {
                        "business_slug": business.get("public_id", ""),
                        "business_name": business.get("name", ""),
                        "name": business.get("name", ""),
                        "email": business.get("email", ""),
                        "role": "owner",
                        "logo_url": business.get("logo_url"),
                    }
                }
    except Exception as e:
        print(f"Business login error: {e}")

    try:
        res = supabase.table("staff").select("*,businesses(public_id,name,logo_url)").eq("email", req.email).maybe_single().execute()
        staff = res.data
        if staff:
            stored_pin = staff.get('pin', '')
            if stored_pin == req.password or stored_pin == hash_password(req.password):
                biz = staff.get('businesses', {}) or {}
                return {
                    "success": True,
                    "token": "staff-token-" + staff.get("public_id", ""),
                    "business_slug": biz.get("public_id", ""),
                    "business_name": biz.get("name", ""),
                    "name": staff.get("name", ""),
                    "staff_name": staff.get("name", ""),
                    "role": staff.get("role", "cashier"),
                    "logo_url": biz.get("logo_url"),
                    "user": {
                        "business_slug": biz.get("public_id", ""),
                        "business_name": biz.get("name", ""),
                        "name": staff.get("name", ""),
                        "email": staff.get("email", ""),
                        "role": staff.get("role", "cashier"),
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

    public_id = generate_business_public_id(biz.name)
    business_data = {
        'public_id': public_id,
        'name': biz.name,
        'email': biz.email,
        'phone': biz.phone,
        'password_hash': hash_password(biz.password),
        'logo_url': biz.logo_url,
        'business_type': biz.business_type,
        'plan': biz.plan,
        'status': 'PENDING',
        'created_at': datetime.utcnow().isoformat(),
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
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ","").replace("bearer ","") if auth_header else ""

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    admin_token = get_admin_token()
    if admin_token and token == admin_token:
        return {
            "business_slug": "",
            "business_name": "LoyaltyTree Admin",
            "name": "Admin",
            "email": SUPER_ADMIN_EMAIL,
            "role": "super_admin",
            "logo_url": None,
        }

    if not supabase:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if token.startswith("owner-token-"):
        public_id = token.replace("owner-token-", "")
        business = safe_get_business(public_id)
        if business:
            return {
                "business_slug": business.get("public_id", ""),
                "business_name": business.get("name", ""),
                "name": business.get("name", ""),
                "email": business.get("email", ""),
                "role": "owner",
                "logo_url": business.get("logo_url"),
            }

    if token.startswith("staff-token-"):
        public_id = token.replace("staff-token-", "")
        try:
            res = supabase.table("staff").select("*,businesses(public_id,name,logo_url)").eq("public_id", public_id).maybe_single().execute()
            staff_data = res.data
            if staff_data:
                biz = staff_data.get('businesses', {}) or {}
                return {
                    "business_slug": biz.get("public_id", ""),
                    "business_name": biz.get("name", ""),
                    "name": staff_data.get("name", ""),
                    "email": staff_data.get("email", ""),
                    "role": staff_data.get("role", "cashier"),
                    "logo_url": biz.get("logo_url"),
                }
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Invalid token")

# ADMIN ROUTES (platform owner only - not exposed to businesses)

@app.post("/api/v1/admin/login")
async def admin_login(req: AdminLoginRequest):
    valid_token = get_admin_token()
    if not valid_token:
        raise HTTPException(status_code=503, detail="Admin access is not configured on this server")
    if req.email != SUPER_ADMIN_EMAIL or req.password != SUPER_ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    return {"success": True, "token": valid_token, "email": SUPER_ADMIN_EMAIL, "role": "super_admin"}

@app.get("/api/v1/admin/me")
async def admin_me(_: bool = Depends(require_admin)):
    return {"email": SUPER_ADMIN_EMAIL, "role": "super_admin"}

@app.get("/api/v1/admin/plans")
async def admin_list_plans(_: bool = Depends(require_admin)):
    return SUBSCRIPTION_PLANS

@app.get("/api/v1/admin/overview")
async def admin_overview(_: bool = Depends(require_admin)):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        businesses = supabase.table("businesses").select("*").execute().data or []
        customers_res = supabase.table("customers").select("id", count="exact").execute()
        staff_res = supabase.table("staff").select("id", count="exact").execute()
        since = (datetime.utcnow() - timedelta(days=30)).isoformat()
        stamps_30d_res = supabase.table("stamp_events").select("id", count="exact").gte("created_at", since).execute()
        redemptions_30d_res = supabase.table("redemption_events").select("id", count="exact").gte("created_at", since).execute()

        status_breakdown = {}
        plan_breakdown = {}
        for b in businesses:
            status = (b.get('status') or 'PENDING').upper()
            plan = b.get('plan') or 'starter'
            status_breakdown[status] = status_breakdown.get(status, 0) + 1
            plan_breakdown[plan] = plan_breakdown.get(plan, 0) + 1

        return {
            "total_businesses": len(businesses),
            "total_customers": customers_res.count or 0,
            "total_staff": staff_res.count or 0,
            "stamps_30d": stamps_30d_res.count or 0,
            "redemptions_30d": redemptions_30d_res.count or 0,
            "status_breakdown": status_breakdown,
            "plan_breakdown": plan_breakdown,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load overview: {str(e)}")

@app.get("/api/v1/admin/businesses")
async def admin_list_businesses(status: Optional[str] = None, plan: Optional[str] = None, search: Optional[str] = None, _: bool = Depends(require_admin)):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        query = supabase.table("businesses").select("*")
        if status:
            query = query.eq("status", status.upper())
        if plan:
            query = query.eq("plan", plan)
        businesses = query.order("created_at", desc=True).execute().data or []
        if search:
            needle = search.lower()
            businesses = [b for b in businesses if needle in (b.get('name') or '').lower() or needle in (b.get('email') or '').lower()]
        return [business_summary(b) for b in businesses]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load businesses: {str(e)}")

@app.get("/api/v1/admin/businesses/{public_id}")
async def admin_get_business(public_id: str, _: bool = Depends(require_admin)):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    program = safe_get_loyalty_program(business.get('id'))
    summary = business_summary(business)
    try:
        since = (datetime.utcnow() - timedelta(days=30)).isoformat()
        redemptions_res = supabase.table("redemption_events").select("id", count="exact").eq("business_id", business.get('id')).gte("created_at", since).execute()
        summary["redemptions_30d"] = redemptions_res.count or 0
    except Exception:
        summary["redemptions_30d"] = 0
    summary["loyalty_program"] = program
    return summary

@app.patch("/api/v1/admin/businesses/{public_id}")
async def admin_update_business(public_id: str, update: AdminBusinessUpdate, _: bool = Depends(require_admin)):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    data = {}
    if update.status is not None:
        data['status'] = update.status.upper()
    if update.plan is not None:
        if update.plan not in SUBSCRIPTION_PLANS:
            raise HTTPException(status_code=400, detail=f"Unknown plan '{update.plan}'. Valid plans: {list(SUBSCRIPTION_PLANS.keys())}")
        data['plan'] = update.plan
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    data['updated_at'] = datetime.utcnow().isoformat()

    try:
        supabase.table("businesses").update(data).eq("id", business.get("id")).execute()
        return {"success": True, **data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")

@app.delete("/api/v1/admin/businesses/{public_id}")
async def admin_delete_business(public_id: str, _: bool = Depends(require_admin)):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    biz_id = business.get('id')
    try:
        # No cascading FKs on these tables, so children are removed first.
        for table in ["stamp_events", "redemption_events", "announcements", "customers", "staff", "loyalty_programs"]:
            supabase.table(table).delete().eq("business_id", biz_id).execute()
        supabase.table("businesses").delete().eq("id", biz_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

# API ROUTES

@app.get("/api/v1/business/{public_id}")
async def get_business_api(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return business

@app.get("/api/v1/customer/{public_id}")
async def get_customer_api(public_id: str):
    customer = safe_get_customer(public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer.get('business_id'))
    program = safe_get_loyalty_program(customer.get('business_id')) if business else None

    return {
        "customer": customer,
        "business": {
            "id": business.get("id") if business else None,
            "public_id": business.get("public_id") if business else None,
            "name": business.get("name") if business else None,
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
        res = supabase.table("customers").select("*").eq("business_id", business.get("id")).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/v1/business/{public_id}/customers/{customer_public_id}")
async def update_customer(public_id: str, customer_public_id: str, update: CustomerUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return customer

    update_data['updated_at'] = datetime.utcnow().isoformat()

    try:
        res = supabase.table("customers").update(update_data).eq("id", customer.get("id")).execute()
        return res.data[0] if res.data else {**customer, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/staff")
async def get_staff(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("staff").select("*").eq("business_id", business.get("id")).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/v1/business/{public_id}/staff/{staff_public_id}")
async def update_staff(public_id: str, staff_public_id: str, update: StaffUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff = safe_get_staff(staff_public_id)
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")
    if staff.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Staff not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return staff

    try:
        res = supabase.table("staff").update(update_data).eq("id", staff.get("id")).execute()
        return res.data[0] if res.data else {**staff, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/business/{public_id}/staff/{staff_public_id}")
async def delete_staff(public_id: str, staff_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff = safe_get_staff(staff_public_id)
    if not staff:
        raise HTTPException(status_code=404, detail="Staff not found")
    if staff.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Staff not found for this business")

    try:
        supabase.table("staff").delete().eq("id", staff.get("id")).execute()
        return {"message": "Staff removed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/stats")
async def get_stats(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("customers").select("*").eq("business_id", business.get("id")).execute()
        customers = res.data or []
        total_stamps = sum(c.get('stamp_count', 0) for c in customers)
        return {
            "total_customers": len(customers),
            "total_stamps": total_stamps,
            "unlocked_rewards": sum(1 for c in customers if c.get("reward_unlocked") or c.get("stamp_count", 0) >= 8),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ANALYTICS
# Powers AnalyticsDashboard.jsx. Built from stamp_events / redemption_events
# (see analytics_events_migration.sql) plus a snapshot of the customers
# table. Anything this app doesn't actually capture - namely dollar amounts,
# since no price field exists anywhere in the schema - is reported as
# untracked rather than estimated. See the `revenue` block below.

def _parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).replace(tzinfo=None)
    except Exception:
        return None

def _range_to_days(range_key: str):
    return {'7d': 7, '30d': 30, '90d': 90}.get(range_key)  # None -> all time

def _pct_change(curr: float, prev: float) -> float:
    if prev == 0:
        return 100.0 if curr > 0 else 0.0
    return round(((curr - prev) / prev) * 100, 1)

def _filter_between(rows, field, start, end):
    """Rows whose parsed `field` timestamp falls in [start, end)."""
    out = []
    for r in rows:
        ts = _parse_ts(r.get(field))
        if ts is None:
            continue
        if start and ts < start:
            continue
        if end and ts >= end:
            continue
        out.append(r)
    return out

def _bucketed_series(rows, field, start, end, max_buckets=30):
    """[{label, value}] counting rows per day, switching to wider buckets
    if the range is long enough that daily buckets would be unreadable."""
    if not start or not end or end <= start:
        return []
    total_days = max((end.date() - start.date()).days, 1)
    bucket_days = 1 if total_days <= max_buckets else -(-total_days // max_buckets)  # ceil div
    buckets = []
    cur = datetime(start.year, start.month, start.day)
    while cur < end:
        buckets.append(cur)
        cur += timedelta(days=bucket_days)
    if not buckets:
        buckets = [datetime(start.year, start.month, start.day)]

    counts = [0] * len(buckets)
    for r in rows:
        ts = _parse_ts(r.get(field))
        if not ts or ts < start or ts >= end:
            continue
        idx = min(int((ts - buckets[0]).days // bucket_days), len(buckets) - 1)
        counts[idx] += 1

    return [{'label': b.strftime('%b %d'), 'value': c} for b, c in zip(buckets, counts)]

def _day_of_week_series(rows, field, start, end):
    """[{label, value}] - one bucket per weekday for the Peak Activity
    heatmap (the UI grid is fixed at 7 columns)."""
    names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    counts = [0] * 7
    for r in rows:
        ts = _parse_ts(r.get(field))
        if not ts:
            continue
        if start and ts < start:
            continue
        if end and ts >= end:
            continue
        counts[ts.weekday()] += 1
    return [{'label': n, 'value': c} for n, c in zip(names, counts)]

@app.get("/api/v1/business/{public_id}/analytics")
async def get_analytics(public_id: str, range: str = '30d'):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    business_id = business.get('id')

    try:
        customers = supabase.table("customers").select("*").eq("business_id", business_id).execute().data or []
        stamp_events = supabase.table("stamp_events").select("*").eq("business_id", business_id).execute().data or []
        redemption_events = supabase.table("redemption_events").select("*").eq("business_id", business_id).execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    now = datetime.utcnow()
    days = _range_to_days(range)
    if days:
        period_start = now - timedelta(days=days)
        prev_start = period_start - timedelta(days=days)
        prev_end = period_start
    else:
        candidates = [t for t in (
            [_parse_ts(business.get('created_at'))] +
            [_parse_ts(c.get('created_at')) for c in customers]
        ) if t]
        period_start = min(candidates) if candidates else now - timedelta(days=90)
        span = max((now - period_start).days, 1)
        prev_start = period_start - timedelta(days=span)
        prev_end = period_start

    cust_period = _filter_between(customers, 'created_at', period_start, now)
    cust_prev = _filter_between(customers, 'created_at', prev_start, prev_end)

    stamps_period = _filter_between(stamp_events, 'created_at', period_start, now)
    stamps_prev = _filter_between(stamp_events, 'created_at', prev_start, prev_end)

    redeems_period = _filter_between(redemption_events, 'created_at', period_start, now)
    redeems_prev = _filter_between(redemption_events, 'created_at', prev_start, prev_end)

    active_ids_period = {e.get('customer_id') for e in stamps_period}
    active_ids_prev = {e.get('customer_id') for e in stamps_prev}

    total_customers = len(customers)
    new_customers = len(cust_period)
    new_customers_prev = len(cust_prev)

    active_members = len(active_ids_period)
    active_members_prev = len(active_ids_prev)

    total_stamps = len(stamps_period)
    total_stamps_prev = len(stamps_prev)

    total_rewards = len(redeems_period)
    total_rewards_prev = len(redeems_prev)

    avg_stamps = round(total_stamps / active_members, 1) if active_members else 0
    avg_stamps_prev = round(total_stamps_prev / active_members_prev, 1) if active_members_prev else 0

    adoption_rate = round((active_members / total_customers) * 100, 1) if total_customers else 0

    overview = {
        "total_customers": total_customers,
        "customer_change": _pct_change(new_customers, new_customers_prev),
        "new_customers": new_customers,
        "active_members": active_members,
        "active_change": _pct_change(active_members, active_members_prev),
        "total_stamps": total_stamps,
        "stamp_change": _pct_change(total_stamps, total_stamps_prev),
        "total_rewards": total_rewards,
        "reward_change": _pct_change(total_rewards, total_rewards_prev),
        "avg_stamps_per_customer": avg_stamps,
        "avg_change": _pct_change(avg_stamps, avg_stamps_prev),
        "adoption_rate": adoption_rate,
    }

    trends = {
        "customers": _bucketed_series(customers, 'created_at', period_start, now),
        "stamps": _bucketed_series(stamp_events, 'created_at', period_start, now),
        "rewards": _bucketed_series(redemption_events, 'created_at', period_start, now),
        "peak_hours": _day_of_week_series(stamp_events, 'created_at', period_start, now),
    }

    top_customers = sorted(customers, key=lambda c: c.get('stamp_count', 0), reverse=True)[:5]
    top_customers_out = [
        {"name": c.get("name") or "Customer", "stamps": c.get("stamp_count", 0)}
        for c in top_customers if c.get('stamp_count', 0) > 0
    ]

    returning = active_ids_period & active_ids_prev
    retention_rate = round((len(returning) / len(active_ids_prev)) * 100, 1) if active_ids_prev else 0

    thirty_days_ago = now - timedelta(days=30)
    churn_risk = sum(
        1 for c in customers
        if c.get('stamp_count', 0) > 0
        and (_parse_ts(c.get('updated_at')) or _parse_ts(c.get('created_at')) or now) < thirty_days_ago
    )

    customers_block = {
        "top_customers": top_customers_out,
        "retention_rate": retention_rate,
        "churn_risk": churn_risk,
        "engagement_rate": adoption_rate,
    }

    # Proxy for "how many customers hit the stamp goal": customers currently
    # sitting at reward_unlocked (goal reached, not yet redeemed) plus
    # everyone who redeemed this period. There's no separate "goal reached"
    # event logged today - only stamp and redemption events - so this is the
    # closest honest approximation available without adding a new event type.
    currently_unlocked = sum(1 for c in customers if c.get('reward_unlocked'))
    reached_goal_period = currently_unlocked + total_rewards

    stamps_block = {
        "completion_rate": round((reached_goal_period / active_members) * 100, 1) if active_members else 0,
    }
    rewards_block = {
        "redemption_rate": round((total_rewards / reached_goal_period) * 100, 1) if reached_goal_period else 0,
    }

    # No price/amount field exists anywhere in this schema (stamps and
    # redemptions don't capture a dollar value), so revenue is reported as
    # untracked rather than guessed at. To light this up for real, add an
    # `amount` field to StampRequest and store it on stamp_events.
    revenue = {
        "tracked": False,
        "stamp_revenue": None,
        "reward_cost": None,
        "net_value": None,
        "avg_transaction": None,
    }

    return {
        "range": range,
        "overview": overview,
        "trends": trends,
        "customers": customers_block,
        "stamps": stamps_block,
        "rewards": rewards_block,
        "revenue": revenue,
    }

@app.get("/api/v1/business/{public_id}/loyalty-config")
async def get_loyalty_config(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))
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
        'business_id': business.get('id'),
        'stamp_goal': config.stamp_goal,
        'reward_name': config.reward_name,
        'primary_color': config.primary_color,
        'reward_expiry_days': config.reward_expiry_days,
        'updated_at': datetime.utcnow().isoformat(),
    }

    if config.program_logo_url is not None:
        data['program_logo_url'] = config.program_logo_url
    if config.hero_image_url is not None:
        data['hero_image_url'] = config.hero_image_url
    if config.card_name is not None:
        data['card_name'] = config.card_name

    try:
        existing = supabase.table("loyalty_programs").select("id").eq("business_id", business.get("id")).maybe_single().execute()
        if existing and existing.data:
            supabase.table("loyalty_programs").update(data).eq("business_id", business.get("id")).execute()
        else:
            data['created_at'] = datetime.utcnow().isoformat()
            supabase.table("loyalty_programs").insert(data).execute()
        return {"message": "Configuration saved"}
    except Exception as e:
        error_msg = str(e)
        if "row-level security" in error_msg.lower() or "rls" in error_msg.lower():
            return JSONResponse(
                status_code=403,
                content={"detail": "Write blocked by Row Level Security. Use service_role key or disable RLS in Supabase.", "error": error_msg}
            )
        raise HTTPException(status_code=500, detail=error_msg)

def friendly_db_error(e: Exception) -> str:
    """Supabase's 'relation does not exist' errors are the #1 cause of blind
    500s right after shipping a new feature - the migration just hasn't been
    run against the live DB yet. Make that obvious instead of a raw PG error."""
    msg = str(e)
    if 'does not exist' in msg.lower() or 'could not find the table' in msg.lower():
        return f"{msg} — has the matching Supabase migration (SQL script) been run yet?"
    return msg

# ANNOUNCEMENTS

@app.get("/api/v1/business/{public_id}/announcements")
async def get_announcements(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = (
            supabase.table("announcements")
            .select("*")
            .eq("business_id", business.get("id"))
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/announcements")
async def create_announcement(public_id: str, ann: AnnouncementCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    is_active = ann.is_active if ann.is_active is not None else True
    data = {
        'business_id': business.get('id'),
        'title': ann.title,
        'message': ann.message,
        'type': ann.type or 'info',
        'is_active': is_active,
        'end_date': ann.end_date,
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
    }

    try:
        res = supabase.table("announcements").insert(data).execute()
        created = res.data[0] if res.data else data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Auto-push on creation of a new, active announcement. Editing an existing
    # one later does NOT re-push automatically - use the Notify button for that,
    # so fixing a typo doesn't re-spam everyone's phone.
    push_sent = False
    push_error = None
    if is_active:
        program = safe_get_loyalty_program(business.get('id'))
        class_id = program.get('google_wallet_class_id') if program else None
        if class_id:
            message_id = f"ann-{created.get('id')}"
            detail_url = f"{BASE_URL}/a/{public_id}/{created.get('id')}"
            push_sent = send_wallet_class_message(class_id, ann.title, ann.message, message_id, detail_url)
            if push_sent:
                try:
                    supabase.table("announcements").update(
                        {'notified_at': datetime.utcnow().isoformat()}
                    ).eq("id", created.get("id")).execute()
                    created['notified_at'] = datetime.utcnow().isoformat()
                except Exception:
                    pass
            else:
                push_error = "Notification could not be sent. Check Google Wallet credentials."
        else:
            push_error = "Publish your card design to Google Wallet (Program tab) first, then customers can be notified."

    created['_push_sent'] = push_sent
    if push_error:
        created['_push_error'] = push_error
    return created

@app.put("/api/v1/business/{public_id}/announcements/{announcement_id}")
async def update_announcement(public_id: str, announcement_id: str, ann: AnnouncementUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        existing = (
            supabase.table("announcements")
            .select("*")
            .eq("id", announcement_id)
            .eq("business_id", business.get("id"))
            .maybe_single()
            .execute()
        )
    except Exception:
        existing = None
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Announcement not found")

    update_data = {k: v for k, v in ann.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return existing.data
    update_data['updated_at'] = datetime.utcnow().isoformat()

    try:
        res = supabase.table("announcements").update(update_data).eq("id", announcement_id).execute()
        return res.data[0] if res.data else {**existing.data, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/business/{public_id}/announcements/{announcement_id}")
async def delete_announcement(public_id: str, announcement_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        supabase.table("announcements").delete().eq("id", announcement_id).eq("business_id", business.get("id")).execute()
        return {"message": "Announcement deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/announcements/{announcement_id}/notify")
async def notify_announcement(public_id: str, announcement_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        res = (
            supabase.table("announcements")
            .select("*")
            .eq("id", announcement_id)
            .eq("business_id", business.get("id"))
            .maybe_single()
            .execute()
        )
        ann = res.data
    except Exception:
        ann = None
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")

    program = safe_get_loyalty_program(business.get('id'))
    class_id = program.get('google_wallet_class_id') if program else None
    if not class_id:
        raise HTTPException(
            status_code=400,
            detail="Publish your card design to Google Wallet (Program tab) before sending notifications."
        )

    message_id = f"ann-{ann.get('id')}-{int(datetime.utcnow().timestamp())}"
    detail_url = f"{BASE_URL}/a/{public_id}/{ann.get('id')}"
    sent = send_wallet_class_message(class_id, ann.get('title', ''), ann.get('message', ''), message_id, detail_url)
    if not sent:
        raise HTTPException(status_code=500, detail="Could not send notification. Check Google Wallet credentials.")

    try:
        supabase.table("announcements").update(
            {'notified_at': datetime.utcnow().isoformat()}
        ).eq("id", announcement_id).execute()
    except Exception:
        pass

    return {"message": "Notification sent to everyone who saved this business's card."}

@app.post("/api/v1/business/{public_id}/staff/invite")
async def invite_staff(public_id: str, invite: StaffInvite):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'name': invite.name,
        'email': invite.email,
        'phone': invite.phone,
        'role': invite.role,
        'pin': '0000',
        'is_active': True,
        'created_at': datetime.utcnow().isoformat(),
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

    if business.get('status', '').upper() == 'ACTIVE':
        return {"message": "Business is already live!", "status": business.get("status")}

    try:
        supabase.table("businesses").update({
            'status': 'ACTIVE',
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", business.get("id")).execute()
        return {"message": "Business is now live!"}
    except Exception as e:
        error_msg = str(e)
        return JSONResponse(
            status_code=200,
            content={"message": "Business appears to be active", "warning": error_msg, "status": business.get("status")}
        )

@app.get("/api/v1/business/{public_id}/qr-code")
async def get_qr_code(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    join_url = f'{BASE_URL}/join/{public_id}'
    svg = generate_qr_svg(join_url)
    return JSONResponse({
        "svg": svg,
        "join_url": join_url,
        "business_name": business.get("name", ""),
    })

@app.post("/api/v1/business/{public_id}/stamp")
async def add_stamp(public_id: str, req: StampRequest):
    print(f"STAMP REQUEST: business={public_id}, customer={req.customer_public_id}, pin={req.staff_pin}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
        if not staff_res.data:
            raise HTTPException(status_code=403, detail="Invalid staff PIN")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    program = safe_get_loyalty_program(business.get('id'))
    goal = program.get('stamp_goal', 8) if program else 8
    new_count = customer.get('stamp_count', 0) + 1
    reward_unlocked = new_count >= goal

    try:
        update_data = {
            'stamp_count': new_count,
            'updated_at': datetime.utcnow().isoformat(),
        }
        try:
            update_data['reward_unlocked'] = reward_unlocked
        except:
            pass
        supabase.table("customers").update(update_data).eq("id", customer.get("id")).execute()
        customer['stamp_count'] = new_count
        customer['reward_unlocked'] = reward_unlocked
        sync_wallet_object(customer, business, program)
        log_stamp_event(business.get('id'), customer.get('id'))
    except Exception as e:
        error_msg = str(e)
        if 'reward_unlocked' in error_msg.lower():
            try:
                supabase.table("customers").update({
                    'stamp_count': new_count,
                    'updated_at': datetime.utcnow().isoformat(),
                }).eq("id", customer.get("id")).execute()
                log_stamp_event(business.get('id'), customer.get('id'))
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

@app.post("/api/v1/business/{public_id}/staff/verify-pin")
async def verify_staff_pin(public_id: str, req: PinVerify):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.pin).execute()
        if not res.data:
            raise HTTPException(status_code=403, detail="Invalid staff PIN")
        staff = res.data[0]
        if not staff.get('is_active', True):
            raise HTTPException(status_code=403, detail="This staff account is inactive")
        return {
            "success": True,
            "name": staff.get("name", ""),
            "role": staff.get("role", "cashier"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/business/{public_id}/reward/redeem")
async def redeem_reward(public_id: str, req: RedeemRequest):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
        if not staff_res.data:
            raise HTTPException(status_code=403, detail="Invalid staff PIN")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    if not customer.get('reward_unlocked'):
        raise HTTPException(status_code=400, detail="No reward available to redeem")

    program = safe_get_loyalty_program(business.get('id'))
    goal = program.get('stamp_goal', 8) if program else 8

    try:
        new_count = max(customer.get('stamp_count', 0) - goal, 0)
        supabase.table("customers").update({
            'stamp_count': new_count,
            'reward_unlocked': False,
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", customer.get("id")).execute()
        customer['stamp_count'] = new_count
        customer['reward_unlocked'] = False
        sync_wallet_object(customer, business, program)
        log_redemption_event(business.get('id'), customer.get('id'))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"message": "Reward redeemed!", "success": True}

# GOOGLE WALLET CLASS MANAGEMENT

@app.get("/api/v1/business/{public_id}/wallet-class")
async def get_wallet_class(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))
    class_id = None
    if program and program.get('google_wallet_class_id'):
        class_id = program.get('google_wallet_class_id')
    else:
        class_id = f'{GOOGLE_WALLET_ISSUER_ID}.{business.get("public_id", "")}'

    access_token = get_google_access_token()
    google_data = None
    if access_token:
        try:
            import httpx
            with httpx.Client() as client:
                resp = client.get(
                    f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}',
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if resp.status_code == 200:
                    google_data = resp.json()
        except Exception as e:
            print(f"Google class fetch error: {e}")

    return {
        "class_id": class_id,
        "business_name": business.get("name", ""),
        "program": program,
        "google_class_exists": google_data is not None,
        "google_class_data": google_data,
    }

@app.post("/api/v1/business/{public_id}/wallet-class")
async def create_or_update_wallet_class(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if not GOOGLE_WALLET_ISSUER_ID:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_WALLET_ISSUER_ID is not set in environment variables. Set it to your Google Wallet Issuer ID and redeploy."
        )

    program = safe_get_loyalty_program(business.get('id'))

    class_id = None
    review_status = 'UNDER_REVIEW'
    if program and program.get('google_wallet_class_id'):
        class_id = program.get('google_wallet_class_id')
    else:
        class_id = f'{GOOGLE_WALLET_ISSUER_ID}.{business.get("public_id", "")}'

    loyalty_class = build_loyalty_class(business, program, review_status=review_status)

    access_token = get_google_access_token()
    if not access_token:
        raise HTTPException(status_code=500, detail="Could not get Google access token. Check GOOGLE_WALLET_CREDENTIALS.")

    def parse_response(resp):
        """Google usually returns JSON, but on some errors (auth failures,
        malformed requests) it can return plain text/HTML instead - calling
        .json() on that raises and used to mask the real error behind a
        bare 500. Fall back to raw text so the actual cause always surfaces."""
        try:
            return resp.json()
        except Exception:
            return {"raw_response": resp.text[:2000]}

    try:
        import httpx
        with httpx.Client() as client:
            resp = client.put(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}',
                headers={"Authorization": f"Bearer {access_token}"},
                json=loyalty_class
            )
            result = parse_response(resp)
            print(f"Google Wallet class PUT response: {resp.status_code} - {result}")

            # Class doesn't exist yet - create it instead of updating it
            if resp.status_code == 404:
                resp = client.post(
                    'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass',
                    headers={"Authorization": f"Bearer {access_token}"},
                    json=loyalty_class
                )
                result = parse_response(resp)
                print(f"Google Wallet class POST (create) response: {resp.status_code} - {result}")

            if resp.status_code in (200, 201):
                db_data = {
                    'google_wallet_class_id': class_id,
                    'updated_at': datetime.utcnow().isoformat(),
                }
                if program:
                    supabase.table("loyalty_programs").update(db_data).eq("business_id", business.get("id")).execute()
                else:
                    db_data['business_id'] = business.get('id')
                    db_data['stamp_goal'] = 8
                    db_data['reward_name'] = 'Free Service'
                    db_data['primary_color'] = '#3b82f6'
                    db_data['reward_expiry_days'] = 30
                    db_data['created_at'] = datetime.utcnow().isoformat()
                    supabase.table("loyalty_programs").insert(db_data).execute()
                
                return {
                    "success": True,
                    "message": "Wallet class created/updated successfully",
                    "class_id": class_id,
                    "review_status": review_status,
                    "google_response": result
                }
            else:
                error_detail = result.get('error', result) if isinstance(result, dict) else result
                raise HTTPException(status_code=500, detail=f"Google API error ({resp.status_code}): {error_detail}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Wallet class creation error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# CUSTOMER JOIN PAGE

@app.get("/join/{business_public_id}", response_class=HTMLResponse)
async def customer_join_page(business_public_id: str):
    try:
        business = safe_get_business(business_public_id)
        if not business:
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1><p>This link is invalid.</p></div>")

        if business.get('status', '').upper() != 'ACTIVE':
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not active</h1><p>This business is not accepting new members yet.</p></div>")

        program = safe_get_loyalty_program(business.get('id'))
        
        primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
        reward_name = program.get('reward_name', 'Free Service') if program else 'Free Service'
        stamp_goal = program.get('stamp_goal', 8) if program else 8
        card_name = program.get('card_name') if program else None
        biz_name = business.get('name', '')
        display_name = card_name if card_name else (biz_name + ' Rewards')
        logo_url = business.get('logo_url')
        
        if logo_url:
            logo_html = '<img src="' + logo_url + '" style="width:80px;height:80px;border-radius:20px;object-fit:cover;margin:0 auto 20px;display:block;" alt="Logo"/>'
        else:
            logo_html = '<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,' + primary_color + ' 0%,#14b8a6 100%);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;">&#127795;</div>'
        
        biz_name_json = json.dumps(biz_name)
        display_name_json = json.dumps(display_name)
        
        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
            '<title>Join ' + display_name + '</title>'
            '<style>'
            '*{box-sizing:border-box;margin:0;padding:0}'
            'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
            'background:linear-gradient(135deg,' + primary_color + ' 0%,#1e293b 100%);'
            'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
            '.card{background:white;border-radius:24px;padding:32px;max-width:400px;width:100%;'
            'box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}'
            'h1{font-size:24px;color:#1e293b;margin-bottom:8px}'
            '.subtitle{color:#64748b;margin-bottom:24px;font-size:14px}'
            '.reward-preview{background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:24px}'
            '.reward-preview h3{color:' + primary_color + ';font-size:16px;margin-bottom:4px}'
            '.reward-preview p{color:#64748b;font-size:13px}'
            'input{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;'
            'font-size:16px;margin-bottom:12px;outline:none}'
            'input:focus{border-color:' + primary_color + '}'
            'select{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;'
            'font-size:16px;margin-bottom:12px;outline:none;background:white;color:#1e293b}'
            'select:focus{border-color:' + primary_color + '}'
            'button{width:100%;padding:16px;background:linear-gradient(135deg,' + primary_color + ' 0%,#14b8a6 100%);'
            'color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}'
            '.success-qr{background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0}'
            '.success-qr img{width:160px;height:160px;border-radius:12px}'
            '.member-id{background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:16px}'
            '.member-id p{margin:0;font-weight:600;color:#1e293b}'
            '.member-id code{display:block;margin-top:8px;font-family:monospace;font-size:14px;color:#64748b;word-break:break-all}'
            '.wallet-btn{display:block;width:100%;padding:14px;background:#1a73e8;color:white;text-decoration:none;'
            'border-radius:10px;font-weight:600;margin-bottom:12px;text-align:center}'
            '.share-btn{width:100%;padding:14px;background:#f0fdf4;color:#0d9488;border:1px solid #a7f3d0;'
            'border-radius:10px;font-weight:600;cursor:pointer}'
            '</style></head><body>'
            '<div class="card" id="card">'
            + logo_html +
            '<h1>' + display_name + '</h1>'
            '<p class="subtitle">' + biz_name + '</p>'
            '<div class="reward-preview">'
            '<h3>&#127873; ' + reward_name + '</h3>'
            '<p>Collect ' + str(stamp_goal) + ' stamps to unlock your reward</p>'
            '</div>'
            '<form id="signupForm">'
            '<input type="text" id="name" placeholder="Full name" required>'
            '<input type="text" id="address" placeholder="Address">'
            '<input type="number" id="age" placeholder="Age" min="0" max="120">'
            '<input type="tel" id="phone" placeholder="Phone number" required>'
            '<input type="email" id="email" placeholder="Email (optional)">'
            '<label style="display:block;text-align:left;font-size:13px;color:#64748b;margin-bottom:6px;">Birthday (optional, MM/DD/YYYY)</label>'
            '<input type="date" id="birthday" placeholder="Birthday">'
            '<select id="occupation">'
            '<option value="">Occupation (optional)</option>'
            '<option value="working">Working</option>'
            '<option value="business_owner">Business Owner</option>'
            '<option value="unemployed">Unemployed</option>'
            '</select>'
            '<button type="submit">Join &amp; Get Your Card &#127793;</button>'
            '</form></div>'
            '<script>'
            '(function(){'
            'const API_BASE=' + json.dumps(BASE_URL) + ';'
            'const BIZ_ID=' + json.dumps(business_public_id) + ';'
            'const BIZ_NAME=' + biz_name_json + ';'
            'const CARD_NAME=' + display_name_json + ';'
            'document.getElementById("signupForm").addEventListener("submit",async function(e){'
            'e.preventDefault();'
            'const name=document.getElementById("name").value;'
            'const address=document.getElementById("address").value;'
            'const age=document.getElementById("age").value;'
            'const phone=document.getElementById("phone").value;'
            'const email=document.getElementById("email").value;'
            'const birthday=document.getElementById("birthday").value;'
            'const occupation=document.getElementById("occupation").value;'
            'try{'
            'const res=await fetch(API_BASE+"/api/v1/join/"+BIZ_ID,{'
            'method:"POST",'
            'headers:{"Content-Type":"application/json"},'
            'body:JSON.stringify({name:name,address:address||null,age:age?parseInt(age,10):null,phone:phone,email:email||null,birthday:birthday||null,occupation:occupation||null})'
            '});'
            'const data=await res.json();'
            'if(res.ok){'
            'const walletUrl=API_BASE+"/wallet/"+data.public_id;'
            'const qrUrl="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data="+encodeURIComponent(data.public_id);'
            'var cardHtml='
            '"<div style=\'font-size:48px;margin-bottom:16px;\'>&#127881;</div>"+'
            '"<h1>Welcome, "+escapeHtml(data.name)+"!</h1>"+'
            '"<p style=\'color:#64748b;margin-bottom:24px;\'>Your "+escapeHtml(CARD_NAME)+" is ready</p>"+'
            '"<div class=\'success-qr\'><img src=\'"+qrUrl+"\' alt=\'Your QR Code\'/>"+'
            '"<p style=\'font-size:12px;color:#94a3b8;margin-top:8px;\'>Scan at checkout</p></div>"+'
            '"<div class=\'member-id\'><p>Your Member ID</p>"+'
            '"<code>"+escapeHtml(data.public_id)+"</code></div>"+'
            '"<div id=\'wallet-btn-container\' style=\'margin-bottom:12px;\'>"+'
            '"<p style=\'color:#94a3b8;font-size:13px;\'>Loading Google Wallet...</p></div>"+'
            '"<button onclick=\'doShare()\' class=\'share-btn\'>&#128279; Share Card</button>"+'
            '"<p style=\'font-size:12px;color:#94a3b8;margin-top:16px;\'>Show this QR to your cashier on every visit to earn stamps.</p>";'
            'document.getElementById("card").innerHTML=cardHtml;'
            'window.doShare=function(){'
            'navigator.share({title:"My "+CARD_NAME,text:"My card for "+BIZ_NAME,url:walletUrl});'
            '};'
            'console.log("Fetching wallet pass for: "+data.public_id);'
            'fetch(API_BASE+"/api/v1/customer/"+data.public_id+"/wallet-pass")'
            '.then(function(r){console.log("Wallet API status: "+r.status);return r.json();})'
            '.then(function(walletData){'
            'console.log("Wallet data:",walletData);'
            'var container=document.getElementById("wallet-btn-container");'
            'if(walletData.save_url){'
            'container.innerHTML="<a href=\'"+escapeHtml(walletData.save_url)+"\' class=\'wallet-btn\' target=\'_blank\'>&#127903; Add to Google Wallet</a>";'
            '}else if(walletData.error){'
            'container.innerHTML="<div style=\'background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;\'>&#9888; "+escapeHtml(walletData.error)+"</div>";'
            '}else{'
            'container.innerHTML="<div style=\'background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;\'>&#9888; Could not generate wallet link</div>";'
            '}'
            '})'
            '.catch(function(err){'
            'console.error("Wallet fetch error:",err);'
            'var container=document.getElementById("wallet-btn-container");'
            'container.innerHTML="<div style=\'background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;\'>&#9888; Google Wallet error: "+escapeHtml(err.message||"Network error")+"</div>";'
            '});'
            '}else{'
            'alert(data.detail||"Signup failed");'
            '}'
            '}catch(err){'
            'console.error(err);'
            'alert("Network error. Please try again.");'
            '}'
            '});'
            'function escapeHtml(text){'
            'const div=document.createElement("div");'
            'div.textContent=text;'
            'return div.innerHTML;'
            '}'
            '})();'
            '</script></body></html>'
        )
        
        return HTMLResponse(html)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Error</h1><p>Could not load join page: " + str(e) + "</p></div>")

@app.post("/api/v1/join/{business_public_id}")
async def customer_signup(business_public_id: str, signup: CustomerSignup):
    business = safe_get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if business.get('status', '').upper() != 'ACTIVE':
        raise HTTPException(status_code=400, detail="Business not active")

    customer_public_id = generate_public_id()
    customer_data = {
        'business_id': business.get('id'),
        'public_id': customer_public_id,
        'name': signup.name,
        'address': signup.address,
        'age': signup.age,
        'phone': signup.phone,
        'email': signup.email,
        'birthday': signup.birthday,
        'occupation': signup.occupation,
        'last_order_date': signup.last_order_date,
        'stamp_count': 0,
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
    }

    try:
        supabase.table("customers").insert(customer_data).execute()
    except Exception as e:
        error_msg = str(e)
        print(f"CUSTOMER INSERT ERROR: {error_msg}")
        if 'column' in error_msg.lower() and 'does not exist' in error_msg.lower():
            raise HTTPException(status_code=500, detail=f"Database schema mismatch: {error_msg}. Please check your Supabase table columns.")
        raise HTTPException(status_code=500, detail=error_msg)

    return {
        "public_id": customer_public_id,
        "name": signup.name,
        "message": "Welcome to the loyalty program!",
    }

# WALLET PAGE

@app.get("/wallet/{customer_public_id}", response_class=HTMLResponse)
async def customer_wallet_page(customer_public_id: str):
    customer = safe_get_customer(customer_public_id)
    if not customer:
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Card not found</h1><p>This loyalty card does not exist.</p></div>")

    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1></div>")

    program = safe_get_loyalty_program(business.get('id'))
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    reward_name = program.get('reward_name', 'Free Service') if program else 'Free Service'
    card_name = program.get('card_name') if program else None
    display_name = card_name if card_name else (business.get('name', '') + ' Rewards')
    logo_url = business.get('logo_url')

    stamps = customer.get('stamp_count', 0) % stamp_goal
    filled = stamps

    stars_html = ''
    for i in range(stamp_goal):
        if i < filled:
            stars_html += '<span style="width:32px;height:32px;border-radius:16px;background:' + primary_color + ';color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;margin:3px;">&#9733;</span>'
        else:
            stars_html += '<span style="width:32px;height:32px;border-radius:16px;background:rgba(255,255,255,0.25);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;margin:3px;">&#9733;</span>'

    logo_html = ''
    if logo_url:
        logo_html = '<img src="' + logo_url + '" style="width:64px;height:64px;border-radius:16px;object-fit:cover;margin-bottom:12px;" alt="Logo"/>'

    reward_badge = ''
    if customer.get('reward_unlocked'):
        reward_badge = '<span style="display:inline-block;padding:6px 14px;background:#fef3c7;color:#92400e;border-radius:20px;font-size:13px;font-weight:600;margin-top:12px;">&#127873; ' + reward_name + ' Ready!</span>'

    display_name_json = json.dumps(display_name)
    biz_name_json = json.dumps(business.get('name', ''))

    html = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>My ' + display_name + '</title>'
        '<style>'
        '*{box-sizing:border-box;margin:0;padding:0}'
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        'background:linear-gradient(135deg,' + primary_color + ' 0%,#1e293b 100%);'
        'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
        '.card{background:white;border-radius:24px;padding:32px;max-width:400px;width:100%;'
        'box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}'
        '.loyalty-card{background:linear-gradient(135deg,' + primary_color + ' 0%,#14b8a6 100%);'
        'border-radius:16px;padding:24px;color:white;margin-bottom:20px}'
        '.loyalty-card h2{font-size:20px;margin-bottom:4px}'
        '.loyalty-card h3{font-size:16px;opacity:0.9;margin-bottom:8px}'
        '.loyalty-card .id{font-size:12px;opacity:0.7;font-family:monospace}'
        '.stars{margin:16px 0}'
        '.stamp-count{font-size:14px;margin-top:8px;opacity:0.9}'
        '.qr-section{background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:16px}'
        '.qr-section img{width:160px;height:160px;border-radius:12px}'
        '.qr-section p{font-size:12px;color:#94a3b8;margin-top:8px}'
        '.wallet-btn{display:block;width:100%;padding:14px;background:#1a73e8;color:white;'
        'text-decoration:none;border-radius:10px;font-weight:600;margin-bottom:12px;text-align:center}'
        '.share-btn{width:100%;padding:14px;background:#f0fdf4;color:#0d9488;'
        'border:1px solid #a7f3d0;border-radius:10px;font-weight:600;cursor:pointer}'
        '</style></head><body>'
        '<div class="card">'
        '<div class="loyalty-card">'
        + logo_html +
        '<h2>' + display_name + '</h2>'
        '<h3>' + customer.get("name", "") + '</h3>'
        '<p class="id">ID: ' + customer.get("public_id", "")[:12] + '...</p>'
        '<div class="stars">' + stars_html + '</div>'
        '<p class="stamp-count">' + str(stamps) + ' / ' + str(stamp_goal) + ' stamps</p>'
        + reward_badge +
        '</div>'
        '<div class="qr-section">'
        '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + customer.get("public_id", "") + '" alt="Your QR Code"/>'
        '<p>Scan at checkout to earn stamps</p>'
        '</div>'
        '<a href="https://pay.google.com/gp/v/save/' + customer.get("public_id", "") + '" class="wallet-btn">'
        '&#127903; Add to Google Wallet'
        '</a>'
        '<button id="shareBtn" class="share-btn">'
        '&#128279; Share Card'
        '</button>'
        '<script>'
        '(function(){'
        'const dName=' + display_name_json + ';'
        'const bName=' + biz_name_json + ';'
        'document.getElementById("shareBtn").addEventListener("click",function(){'
        'navigator.share({title:"My "+dName,text:"My card for "+bName,url:window.location.href});'
        '});'
        '})();'
        '</script>'
        '</div></body></html>'
    )

    return HTMLResponse(html)

# ANNOUNCEMENT DETAIL PAGE
# Linked from the "View full details" link inside Google Wallet notification
# messages (see send_wallet_class_message) - Wallet's message body is capped
# at 500 plain-text characters with no images, so this page is where the
# full announcement actually lives for customers who tap through.

@app.get("/a/{business_public_id}/{announcement_id}", response_class=HTMLResponse)
async def announcement_detail_page(business_public_id: str, announcement_id: str):
    business = safe_get_business(business_public_id)
    if not business:
        return HTMLResponse(
            "<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Not found</h1></div>",
            status_code=404,
        )

    try:
        res = (
            supabase.table("announcements")
            .select("*")
            .eq("id", announcement_id)
            .eq("business_id", business.get("id"))
            .maybe_single()
            .execute()
        )
        ann = res.data
    except Exception:
        ann = None
    if not ann:
        return HTMLResponse(
            "<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Announcement not found</h1></div>",
            status_code=404,
        )

    program = safe_get_loyalty_program(business.get('id'))
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    logo_url = business.get('logo_url')
    biz_name = business.get('name', '')

    type_meta = {
        'info':  {'bg': '#dbeafe', 'text': '#1e40af', 'icon': '&#8505;&#65039;', 'label': 'Info'},
        'promo': {'bg': '#fce7f3', 'text': '#be185d', 'icon': '&#127991;&#65039;', 'label': 'Promotion'},
        'event': {'bg': '#d1fae5', 'text': '#065f46', 'icon': '&#128197;', 'label': 'Event'},
        'alert': {'bg': '#fee2e2', 'text': '#991b1b', 'icon': '&#9888;&#65039;', 'label': 'Alert'},
    }
    meta = type_meta.get(ann.get('type') or 'info', type_meta['info'])

    logo_html = ''
    if logo_url:
        logo_html = (
            '<img src="' + html_lib.escape(logo_url) + '" '
            'style="width:56px;height:56px;border-radius:14px;object-fit:cover;margin-bottom:14px;" alt="Logo"/>'
        )

    end_date_html = ''
    if ann.get('end_date'):
        end_date_html = '<p class="meta">Valid until ' + html_lib.escape(str(ann.get('end_date'))) + '</p>'

    title = html_lib.escape(ann.get('title') or '')
    message = html_lib.escape(ann.get('message') or '').replace('\n', '<br>')

    html_out = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>' + title + ' - ' + html_lib.escape(biz_name) + '</title>'
        '<style>'
        '*{box-sizing:border-box;margin:0;padding:0}'
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        'background:linear-gradient(135deg,' + primary_color + ' 0%,#1e293b 100%);'
        'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
        '.card{background:white;border-radius:24px;padding:32px;max-width:440px;width:100%;'
        'box-shadow:0 20px 60px rgba(0,0,0,0.3)}'
        '.badge{display:inline-block;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;'
        'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:14px;'
        'background:' + meta['bg'] + ';color:' + meta['text'] + '}'
        'h1{font-size:22px;color:#0f172a;margin-bottom:12px;line-height:1.3}'
        'p.message{font-size:15px;color:#334155;line-height:1.6;margin-bottom:16px}'
        '.meta{font-size:13px;color:#94a3b8;margin-bottom:4px}'
        '.biz{font-size:13px;color:#64748b;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0}'
        '</style></head><body>'
        '<div class="card">'
        + logo_html +
        '<div class="badge">' + meta['icon'] + ' ' + meta['label'] + '</div>'
        '<h1>' + title + '</h1>'
        '<p class="message">' + message + '</p>'
        + end_date_html +
        '<div class="biz">From ' + html_lib.escape(biz_name) + '</div>'
        '</div></body></html>'
    )
    return HTMLResponse(html_out)

# GOOGLE WALLET PASS

@app.get("/api/v1/customer/{customer_public_id}/wallet-pass")
async def get_wallet_pass(customer_public_id: str):
    print(f"WALLET-PASS: Requested for customer {customer_public_id}")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        print("WALLET-PASS: Customer not found")
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        print("WALLET-PASS: Business not found")
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))

    loyalty_object = build_loyalty_object(customer, business, program)

    jwt_token = create_google_wallet_jwt(loyalty_object)
    if not jwt_token:
        print("WALLET-PASS: JWT generation failed")
        return JSONResponse({
            "save_url": None,
            "error": "Could not generate Google Wallet link. Check GOOGLE_WALLET_CREDENTIALS."
        })

    save_url = f"https://pay.google.com/gp/v/save/{jwt_token}"
    print(f"WALLET-PASS: Generated save URL for customer {customer_public_id}")

    return {
        "save_url": save_url,
        "loyalty_object": loyalty_object,
    }

# Run

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))


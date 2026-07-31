import os
import re
from urllib.parse import quote
import uuid
import base64
import json
import hashlib
import hmac
import html as html_lib
from datetime import datetime, timedelta
from typing import Optional, List, Literal

from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client
import qrcode
from qrcode.image.svg import SvgImage
from io import BytesIO
from PIL import Image
import zipfile

# Environment
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')
BASE_URL = os.getenv('BASE_URL', 'https://loyaltree-btw1.onrender.com')
GOOGLE_WALLET_ISSUER_ID = os.getenv('GOOGLE_WALLET_ISSUER_ID', '')
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv('GOOGLE_WALLET_CLASS_SUFFIX', '')
DEFAULT_LOGO_URL = os.getenv('DEFAULT_LOGO_URL', 'https://placehold.co/300x300/0d9488/ffffff.png?text=LoyaltyTree')

# Apple Wallet (PassKit). Preferred setup: APPLE_PASS_CERTIFICATE is a
# base64-encoded PEM certificate and APPLE_PASS_PRIVATE_KEY is a
# base64-encoded PEM private key, both extracted from your Pass Type ID
# .p12 with openssl - e.g.
#   openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out cert.pem
#   openssl pkcs12 -in Certificates.p12 -nocerts -nodes -out key.pem
#   base64 -i cert.pem | pbcopy   # -> APPLE_PASS_CERTIFICATE
#   base64 -i key.pem | pbcopy    # -> APPLE_PASS_PRIVATE_KEY
# (PEM extraction avoids modern OpenSSL/cryptography refusing to read the
# legacy RC2-40 encryption Keychain Access uses on .p12 exports.)
# Alternatively, if your .p12 exported with a modern cipher and openssl
# can read it directly, set only APPLE_PASS_CERTIFICATE to the base64 .p12
# itself plus APPLE_PASS_CERTIFICATE_PASSWORD - both paths are supported.
# APPLE_WWDR_CERTIFICATE is Apple's Worldwide Developer Relations
# intermediate certificate (download from
# https://www.apple.com/certificateauthority/ - match the G-number your
# Pass Type ID cert's issuer shows), also base64-encoded; .pem or .cer
# (DER) both work. APPLE_PASS_AUTH_SECRET is a secret you make up yourself
# (any long random string) - it's used to derive a per-customer token that
# authenticates their device's Wallet app when it calls back in for
# updates; it is never sent to Apple.
APPLE_PASS_TYPE_IDENTIFIER = os.getenv('APPLE_PASS_TYPE_IDENTIFIER', '')
APPLE_TEAM_IDENTIFIER = os.getenv('APPLE_TEAM_IDENTIFIER', '')
APPLE_PASS_CERTIFICATE = os.getenv('APPLE_PASS_CERTIFICATE', '')
APPLE_PASS_PRIVATE_KEY = os.getenv('APPLE_PASS_PRIVATE_KEY', '')
APPLE_PASS_CERTIFICATE_PASSWORD = os.getenv('APPLE_PASS_CERTIFICATE_PASSWORD', '')
APPLE_WWDR_CERTIFICATE = os.getenv('APPLE_WWDR_CERTIFICATE', '')
APPLE_PASS_AUTH_SECRET = os.getenv('APPLE_PASS_AUTH_SECRET', '')
APPLE_PASS_WEB_SERVICE_URL = f'{BASE_URL}/api/v1/apple-wallet'

# Platform super-admin credentials (you, the LoyaltyTree operator - not a
# business owner). Set these in your environment; there is no signup flow
# for this role on purpose. If unset, the admin routes are disabled.
SUPER_ADMIN_EMAIL = os.getenv('SUPER_ADMIN_EMAIL', '')
SUPER_ADMIN_PASSWORD = os.getenv('SUPER_ADMIN_PASSWORD', '')

# PayMongo (QR Ph subscription payments). Secret key is server-side only -
# never send it to the frontend. Webhook secret is the separate "whsec_..."
# value PayMongo shows you when you register the webhook endpoint on their
# dashboard (Developers > Webhooks) - it's used only to verify that
# incoming webhook calls really came from PayMongo, and is different from
# the API secret key above.
PAYMONGO_SECRET_KEY = os.getenv('PAYMONGO_SECRET_KEY', '')
PAYMONGO_WEBHOOK_SECRET = os.getenv('PAYMONGO_WEBHOOK_SECRET', '')
PAYMONGO_API_BASE = 'https://api.paymongo.com/v1'
SUBSCRIPTION_PERIOD_DAYS = 30  # how long a successful payment extends access for

# Subscription expiry reminder emails, sent via Resend (resend.com). Get
# RESEND_API_KEY from Resend's dashboard once you've verified a sending
# domain there. SUBSCRIPTION_REMINDER_FROM must be an address on that
# verified domain (e.g. 'billing@yourdomain.com') - Resend rejects sends
# from unverified domains. FRONTEND_URL is optional and only used to put a
# "log in to pay" link in the email; if unset, the email just omits the link.
RESEND_API_KEY = os.getenv('RESEND_API_KEY', '')
SUBSCRIPTION_REMINDER_FROM = os.getenv('SUBSCRIPTION_REMINDER_FROM', 'billing@loyaltytree.app')
FRONTEND_URL = os.getenv('FRONTEND_URL', '')
SUBSCRIPTION_REMINDER_RESEND_DAYS = 3  # don't re-email more often than this while still expiring_soon/expired

# Subscription tiers available to businesses. This is the single source of
# truth the admin dashboard AND the API's feature gates read from - nothing
# else needs to change to introduce a new plan or adjust a limit.
#
# announcements_per_month: int limit, or None for unlimited
# max_loyalty_cards: how many concurrent loyalty_programs rows a business
#   may run at once (multi-card support itself is not implemented yet -
#   this limit is reserved for that follow-up feature)
# apple_wallet: reserved for when Apple Wallet (PassKit) support is built -
#   not implemented yet, so this flag currently has no effect anywhere
SUBSCRIPTION_PLANS = {
    'starter': {
        'label': 'Starter',
        'price_month': 350,
        'price_tiers': {'1': 350, '2-3': 550, '5': 750},
        'customer_limit': 100,
        'google_wallet': True,
        'apple_wallet': True,
        'announcements_per_month': 2,
        'analytics': True,
        'google_review_prompt': False,
        'birthday_greetings': False,
        'max_loyalty_cards': 1,
        'win_back': False,
        'max_branches': 1,
        'geofence_notifications': False,
    },
    'growth': {
        'label': 'Growth',
        'price_month': 550,
        'price_tiers': {'1': 550, '2-3': 750, '5': 950},
        'customer_limit': 1000,
        'google_wallet': True,
        'apple_wallet': True,
        'announcements_per_month': 5,
        'analytics': True,
        'google_review_prompt': True,
        'birthday_greetings': True,
        'max_loyalty_cards': 1,
        'win_back': False,
        'max_branches': 3,
        'geofence_notifications': False,
    },
    'pro': {
        'label': 'Pro',
        'price_month': 750,
        'price_tiers': {'1': 750, '2-3': 950, '5': 1150},
        'customer_limit': None,
        'google_wallet': True,
        'apple_wallet': True,
        'announcements_per_month': 5,
        'analytics': True,
        'google_review_prompt': True,
        'birthday_greetings': True,
        'max_loyalty_cards': 3,
        'win_back': True,
        'max_branches': None,  # unlimited
        # Reserved for the geotag/geofence notification feature (push a
        # notification when a customer's device enters the business's
        # geofence) - this is an Ultra-tier feature, not included in Pro.
        # Not implemented yet either way.
        'geofence_notifications': False,
    },
}

def get_plan_features(plan: Optional[str]) -> dict:
    """Feature/limit config for a plan name, falling back to Starter for an
    unrecognized or missing plan so a bad value never silently unlocks
    Pro-only features."""
    return SUBSCRIPTION_PLANS.get(plan or 'starter', SUBSCRIPTION_PLANS['starter'])

def get_effective_announcement_limit(business: dict) -> Optional[int]:
    """The plan's announcements_per_month (2/5/5 for Starter/Growth/Pro),
    adjusted by whatever an admin has manually granted or deducted for this
    specific business (businesses.announcement_limit_adjustment, e.g. +3 as
    a goodwill bonus or -1 to rein in an abuser) - see admin_update_business.
    Returns None only when the plan itself has no limit at all (there's no
    such plan today, but the field supports it). Otherwise the result is
    clamped to [0, 99] - never negative, and 99 is treated as a practical
    ceiling an admin can raise a business to but not beyond."""
    base_limit = get_plan_features(business.get('plan')).get('announcements_per_month')
    if base_limit is None:
        return None
    adjustment = business.get('announcement_limit_adjustment') or 0
    try:
        adjustment = int(adjustment)
    except (TypeError, ValueError):
        adjustment = 0
    return max(0, min(99, base_limit + adjustment))

def branch_price_bracket(branch_count: int) -> str:
    """Maps an actual branch count to one of the pricing brackets shown on
    the marketing page. Same bracket used regardless of which plan (feature
    tier) is chosen - price scales with branch count independently of plan."""
    if branch_count <= 1:
        return '1'
    if branch_count <= 3:
        return '2-3'
    return '5'

def get_price_for_plan(plan: Optional[str], branch_count: int) -> int:
    """The actual monthly price for a plan at a given branch count, per the
    price_tiers table. Falls back to the plan's flat price_month if a plan
    has no price_tiers configured (shouldn't happen for the built-in plans)."""
    features = get_plan_features(plan)
    tiers = features.get('price_tiers') or {}
    bracket = branch_price_bracket(branch_count)
    return tiers.get(bracket, features.get('price_month', 0))

def determine_plan_from_branch_count(branch_count: int) -> str:
    """Default plan suggestion when the signup form doesn't specify one
    explicitly - 1 branch -> Starter, 2-3 -> Growth, 4+ -> Pro. A business
    can still explicitly choose a different plan; branch count then only
    affects price within that plan, not which plan they're on."""
    if branch_count <= 1:
        return 'starter'
    if branch_count <= 3:
        return 'growth'
    return 'pro'

# --- PayMongo QR Ph helpers -------------------------------------------------
# Manual flow (no BIR/DTI-gated Checkout Session needed): we drive the raw
# Payment Intent workflow ourselves - create a Payment Intent, create a qrph
# Payment Method, attach them together, and PayMongo hands back a QR code
# image the customer (the business owner, in our case) scans to pay. The
# secret key is used for all three calls since this happens entirely on our
# server - no card data is ever collected, so there's no need to involve the
# public key or the browser at all.

def paymongo_auth_header() -> str:
    token = base64.b64encode(f"{PAYMONGO_SECRET_KEY}:".encode()).decode()
    return f"Basic {token}"

def create_qrph_checkout(amount_php: float, description: str, billing_name: str,
                          billing_email: str, billing_phone: Optional[str],
                          metadata: dict) -> dict:
    """Creates a PayMongo Payment Intent + qrph Payment Method and attaches
    them. Returns {intent_id, status, qr_image_url}. Raises HTTPException on
    any failure so callers don't have to duplicate error handling."""
    import httpx

    if not PAYMONGO_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payment processing is not configured on this server.")

    amount_centavos = int(round(amount_php * 100))
    headers = {"Authorization": paymongo_auth_header(), "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=20) as client:
            intent_res = client.post(
                f"{PAYMONGO_API_BASE}/payment_intents",
                headers=headers,
                json={"data": {"attributes": {
                    "amount": amount_centavos,
                    "currency": "PHP",
                    "payment_method_allowed": ["qrph"],
                    "capture_type": "automatic",
                    "description": description[:255],
                    "metadata": metadata,
                }}},
            )
            if intent_res.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"PayMongo error creating payment intent: {intent_res.text}")
            intent = intent_res.json()["data"]
            intent_id = intent["id"]
            client_key = intent["attributes"]["client_key"]

            pm_res = client.post(
                f"{PAYMONGO_API_BASE}/payment_methods",
                headers=headers,
                json={"data": {"attributes": {
                    "type": "qrph",
                    "billing": {
                        "name": billing_name,
                        "email": billing_email,
                        "phone": billing_phone,
                    },
                }}},
            )
            if pm_res.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"PayMongo error creating payment method: {pm_res.text}")
            payment_method_id = pm_res.json()["data"]["id"]

            attach_res = client.post(
                f"{PAYMONGO_API_BASE}/payment_intents/{intent_id}/attach",
                headers=headers,
                json={"data": {"attributes": {
                    "payment_method": payment_method_id,
                    "client_key": client_key,
                }}},
            )
            if attach_res.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"PayMongo error attaching payment method: {attach_res.text}")
            attached = attach_res.json()["data"]["attributes"]
            next_action = attached.get("next_action") or {}
            qr_image_url = (next_action.get("code") or {}).get("image_url")

            return {
                "intent_id": intent_id,
                "status": attached.get("status"),
                "qr_image_url": qr_image_url,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach PayMongo: {e}")

def verify_paymongo_signature(raw_body: bytes, signature_header: str) -> bool:
    """Verifies the Paymongo-Signature header per PayMongo's webhook spec:
    header is 't=<timestamp>,te=<test-mode sig>,li=<live-mode sig>'; the
    signed payload is '<timestamp>.<raw body>', HMAC-SHA256'd with the
    webhook secret (not the API secret key). We check both the 'li' and
    'te' values so this works against both live and test-mode webhooks."""
    if not PAYMONGO_WEBHOOK_SECRET or not signature_header:
        return False
    parts = {}
    for chunk in signature_header.split(","):
        if "=" in chunk:
            k, v = chunk.split("=", 1)
            parts[k.strip()] = v.strip()
    timestamp = parts.get("t")
    if not timestamp:
        return False
    signed_payload = f"{timestamp}.{raw_body.decode('utf-8')}"
    computed = hmac.new(PAYMONGO_WEBHOOK_SECRET.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    for key in ("li", "te"):
        candidate = parts.get(key)
        if candidate and hmac.compare_digest(candidate, computed):
            return True
    return False

# --- Email helper (Resend) --------------------------------------------------

def send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Sends a transactional email via Resend's API. Returns False (never
    raises) on any failure so a mail hiccup never breaks the caller - same
    best-effort pattern as send_wallet_object_message elsewhere in this file."""
    import httpx

    if not RESEND_API_KEY or not to_email:
        return False
    try:
        with httpx.Client(timeout=15) as client:
            res = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": SUBSCRIPTION_REMINDER_FROM,
                    "to": [to_email],
                    "subject": subject,
                    "html": html_body,
                },
            )
            return res.status_code < 300
    except Exception as e:
        print(f"EMAIL send error: {e}")
        return False

def build_subscription_reminder_email(business: dict, days_left: Optional[int], price: float) -> tuple:
    """Returns (subject, html_body) for a subscription reminder, worded
    differently depending on whether access has already lapsed."""
    name = html_lib.escape(business.get('name', 'there'))
    login_html = f'<p><a href="{html_lib.escape(FRONTEND_URL)}/login" style="color:#0d9488;font-weight:600;">Log in to pay now</a></p>' if FRONTEND_URL else ''

    if days_left is not None and days_left < 0:
        subject = f"Your LoyaltyTree subscription has expired"
        body = (
            f"<p>Hi {name},</p>"
            f"<p>Your LoyaltyTree subscription expired on {html_lib.escape(str(business.get('subscription_expires_at') or ''))}. "
            f"Pay ₱{price:,.2f} via QR Ph from your dashboard's Billing tab to restore access.</p>"
            f"{login_html}"
        )
    else:
        subject = f"Your LoyaltyTree subscription expires in {days_left} day{'s' if days_left != 1 else ''}"
        body = (
            f"<p>Hi {name},</p>"
            f"<p>Your subscription expires on {html_lib.escape(str(business.get('subscription_expires_at') or ''))} "
            f"({days_left} day{'s' if days_left != 1 else ''} from now). "
            f"Pay ₱{price:,.2f} via QR Ph from your dashboard's Billing tab to avoid any interruption.</p>"
            f"{login_html}"
        )
    return subject, body

# Shared secret for the /api/v1/cron/* endpoints (birthday greetings,
# win-back messages). These are meant to be hit by an external scheduler
# (Render Cron Job, cron-job.org, GitHub Actions, etc.) once a day, not by
# the frontend - so they're gated by a header instead of a login.
CRON_SECRET = os.getenv('CRON_SECRET', '')

def require_cron(request: Request):
    if not CRON_SECRET:
        raise HTTPException(status_code=503, detail="CRON_SECRET is not configured on this server")
    if request.headers.get("x-cron-secret", "") != CRON_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing cron secret")
    return True

# Staff session tokens - issued once when a cashier/manager verifies their
# PIN at the start of a shift (see /staff/verify-pin). The frontend then
# sends this token on every scan instead of re-sending the raw PIN, so the
# PIN itself only ever crosses the wire once. Signed + time-limited, so a
# leaked token is only useful for STAFF_SESSION_TTL_HOURS and only for the
# one business it was issued for.
STAFF_SESSION_SECRET = os.getenv('STAFF_SESSION_SECRET', '')
STAFF_SESSION_TTL_HOURS = 12  # covers a full shift

def create_staff_session_token(business_public_id: str, staff_id, role: str, name: str) -> str:
    import jwt as pyjwt
    payload = {
        'business_public_id': business_public_id,
        'staff_id': staff_id,  # None when the owner is the one scanning
        'role': role,
        'name': name,
        'exp': datetime.utcnow() + timedelta(hours=STAFF_SESSION_TTL_HOURS),
    }
    return pyjwt.encode(payload, STAFF_SESSION_SECRET, algorithm='HS256')

def verify_staff_session_token(token: str):
    import jwt as pyjwt
    try:
        return pyjwt.decode(token, STAFF_SESSION_SECRET, algorithms=['HS256'])
    except Exception:
        return None

def get_staff_session_claims(public_id: str, authorization: str):
    """Pulls staff/owner identity off a Bearer session token and checks it
    matches the business in the URL. Returns None if there's no token to
    check (caller then falls back to the legacy per-request PIN path)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    claims = verify_staff_session_token(authorization.split(" ", 1)[1])
    if not claims:
        raise HTTPException(status_code=401, detail="Session expired - please log in again")
    if claims.get('business_public_id') != public_id:
        raise HTTPException(status_code=403, detail="Session does not match this business")
    return claims

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
    address: Optional[str] = None  # business's main address - lets super admin organize businesses by location
    branch_count: int = Field(default=1, ge=1, le=50)
    plan: Optional[str] = None  # explicit plan choice; if omitted, derived from branch_count

class LoginRequest(BaseModel):
    email: str
    password: str

class StaffInvite(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    role: str = 'cashier'
    branch_public_id: Optional[str] = None  # which location this cashier is assigned to

class StaffUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None
    branch_public_id: Optional[str] = None  # reassign to a different location

class BranchCreate(BaseModel):
    name: str
    address: Optional[str] = None

class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class PointsPrize(BaseModel):
    # id is client-generated (uuid4 hex) so the owner can reorder/edit
    # prizes without the list re-keying itself on every save.
    id: Optional[str] = None
    name: str = Field(max_length=80)
    points_cost: int = Field(ge=1)
    description: Optional[str] = Field(default=None, max_length=140)

class LoyaltyConfig(BaseModel):
    card_type: Literal['stamp', 'points'] = 'stamp'  # a business runs ONE active card at a time
    stamp_goal: int = Field(default=8, ge=3, le=20)
    reward_name: str = 'Free Service'
    primary_color: str = '#3b82f6'
    reward_expiry_days: int = Field(default=30, ge=1)
    program_logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    card_name: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=140)  # short blurb shown below the card on the join page / wallet pass
    google_review_url: Optional[str] = None  # Growth/Pro only - link prompted after a redeemed reward
    # --- Points card only ---
    points_per_amount: Optional[float] = Field(default=10, ge=0)     # points earned...
    points_amount_pesos: Optional[float] = Field(default=100, ge=1)  # ...per this many pesos spent
    points_prizes: Optional[List[PointsPrize]] = None                # catalog of prizes customers can redeem points for

class CustomerSignup(BaseModel):
    name: str
    address: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    phone: str
    email: Optional[str] = None
    birthday: Optional[str] = None  # 'YYYY-MM-DD'
    occupation: Optional[str] = None  # 'working' | 'business_owner' | 'unemployed'
    gender: Optional[str] = None  # 'male' | 'female' | 'rather_not_say'
    last_order_date: Optional[str] = None  # 'YYYY-MM-DD'

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    age: Optional[int] = Field(default=None, ge=0, le=120)
    phone: Optional[str] = None
    email: Optional[str] = None
    birthday: Optional[str] = None  # 'YYYY-MM-DD'
    occupation: Optional[str] = None  # 'working' | 'business_owner' | 'unemployed'
    gender: Optional[str] = None  # 'male' | 'female' | 'rather_not_say'
    last_order_date: Optional[str] = None  # 'YYYY-MM-DD'
    stamp_count: Optional[int] = Field(default=None, ge=0)  # lets the owner manually correct a customer's stamp count
    points_balance: Optional[int] = Field(default=None, ge=0)  # lets the owner manually correct a customer's points balance

class StampRequest(BaseModel):
    customer_public_id: str
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class PointsSaleRequest(BaseModel):
    customer_public_id: str
    amount_spent: float = Field(gt=0)  # pesos - converted to points via program.points_per_amount / points_amount_pesos
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class PointsRedeemRequest(BaseModel):
    customer_public_id: str
    prize_id: str  # matches the id of an entry in loyalty_programs.points_prizes
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class PinVerify(BaseModel):
    email: str
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
    last_paid_at: Optional[str] = None          # 'YYYY-MM-DD' - when the business last paid
    subscription_expires_at: Optional[str] = None  # 'YYYY-MM-DD' - when access should lapse
    address: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    business_type: Optional[str] = None
    logo_url: Optional[str] = None
    announcement_limit_adjustment: Optional[int] = None  # +/- adjustment to the plan's announcements_per_month for this business only

class RedeemRequest(BaseModel):
    customer_public_id: str
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class CouponCreate(BaseModel):
    reward_text: str  # free text - owner decides what the coupon is for
    expires_at: Optional[str] = None  # 'YYYY-MM-DD', optional

class CouponRedeem(BaseModel):
    customer_public_id: str
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

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

def safe_get_branch(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("branches").select("*").eq("public_id", public_id).maybe_single().execute()
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

def safe_get_active_coupon(customer_id: int):
    """The customer's current active, non-expired coupon (there's only ever
    one at a time - creation is blocked while one is already active). If an
    'active' row has passed its expires_at date, it's treated as expired
    here and never returned - a background/cron sweep isn't required for
    correctness, only for tidying up the stored status eventually."""
    if not supabase:
        return None
    try:
        res = (
            supabase.table("coupons")
            .select("*")
            .eq("customer_id", customer_id)
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        coupon = rows[0]
        expires_at = coupon.get('expires_at')
        if expires_at:
            try:
                if datetime.fromisoformat(str(expires_at)).date() < datetime.utcnow().date():
                    return None
            except Exception:
                pass
        return coupon
    except Exception:
        return None

def find_business_duplicate(email: Optional[str], phone: Optional[str]) -> Optional[str]:
    """Checks whether another business already uses this email or phone.
    Email is compared case-insensitively; phone is compared as-entered.
    Returns which field collided ('email' or 'phone'), or None if clear."""
    if not supabase:
        return None
    email = (email or '').strip()
    phone = (phone or '').strip()
    try:
        if email:
            res = supabase.table("businesses").select("id").ilike("email", email).execute()
            if res.data:
                return "email"
        if phone:
            res = supabase.table("businesses").select("id").eq("phone", phone).execute()
            if res.data:
                return "phone"
    except Exception:
        return None
    return None

def find_customer_duplicate(business_id: int, phone: Optional[str], email: Optional[str], exclude_id: Optional[int] = None) -> Optional[str]:
    """Checks whether another customer already enrolled in this business
    (same business_id) has this phone or email. exclude_id skips the
    customer's own row, so updates only flag a collision with someone else.
    Returns which field collided ('phone' or 'email'), or None if clear."""
    if not supabase:
        return None
    phone = (phone or '').strip()
    email = (email or '').strip()
    try:
        if phone:
            res = (
                supabase.table("customers").select("id")
                .eq("business_id", business_id).eq("phone", phone).execute()
            )
            for row in (res.data or []):
                if exclude_id is None or row.get('id') != exclude_id:
                    return "phone"
        if email:
            res = (
                supabase.table("customers").select("id")
                .eq("business_id", business_id).ilike("email", email).execute()
            )
            for row in (res.data or []):
                if exclude_id is None or row.get('id') != exclude_id:
                    return "email"
    except Exception:
        return None
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
    activity_30d = 0
    points_balance_outstanding = 0
    program = safe_get_loyalty_program(biz_id)
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
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
        # Points-card businesses log sales to points_events, not
        # stamp_events (see the card_type guard around /stamp vs
        # /points-sale) - read from whichever table actually holds this
        # business's activity so points businesses don't show a false 0.
        since = (datetime.utcnow() - timedelta(days=30)).isoformat()
        activity_table = "points_events" if card_type == 'points' else "stamp_events"
        activity_res = supabase.table(activity_table).select("id", count="exact").eq("business_id", biz_id).gte("created_at", since).execute()
        activity_30d = activity_res.count or 0
    except Exception:
        pass
    if card_type == 'points':
        try:
            # Outstanding points liability across all customers - lets
            # admin monitor how many unredeemed points a points-card
            # business is carrying.
            bal_res = supabase.table("customers").select("points_balance").eq("business_id", biz_id).execute()
            points_balance_outstanding = sum((c.get('points_balance') or 0) for c in (bal_res.data or []))
        except Exception:
            pass
    plan = biz.get('plan', 'starter')

    branch_count = 1
    try:
        branch_res = supabase.table("branches").select("id", count="exact").eq("business_id", biz_id).execute()
        branch_count = branch_res.count or 1
    except Exception:
        pass

    subscription_expires_at = biz.get('subscription_expires_at')
    subscription_status = 'none'
    if subscription_expires_at:
        try:
            expires = _parse_ts(subscription_expires_at)
            if expires:
                days_left = (expires - datetime.utcnow()).days
                if days_left < 0:
                    subscription_status = 'expired'
                elif days_left <= 7:
                    subscription_status = 'expiring_soon'
                else:
                    subscription_status = 'active'
        except Exception:
            subscription_status = 'none'

    return {
        "public_id": biz.get("public_id", ""),
        "name": biz.get("name", ""),
        "email": biz.get("email", ""),
        "phone": biz.get("phone", ""),
        "status": biz.get("status", "PENDING"),
        "plan": plan,
        "plan_label": SUBSCRIPTION_PLANS.get(plan, {}).get("label", plan),
        "plan_features": get_plan_features(plan),
        "announcement_limit_adjustment": biz.get("announcement_limit_adjustment") or 0,
        "announcements_per_month_effective": get_effective_announcement_limit(biz),
        "branch_count": branch_count,
        "price_month": get_price_for_plan(plan, branch_count),
        "business_type": biz.get("business_type", "other"),
        "address": biz.get("address"),
        "logo_url": biz.get("logo_url"),
        "created_at": biz.get("created_at"),
        "last_paid_at": biz.get("last_paid_at"),
        "subscription_expires_at": subscription_expires_at,
        "subscription_status": subscription_status,
        "customer_count": customer_count,
        "staff_count": staff_count,
        "card_type": card_type,
        # stamps_30d holds stamp punches for stamp cards, or points sales
        # (transactions, not points earned) for points cards - see card_type
        # to know which. Kept as one key so existing callers keep working.
        "stamps_30d": activity_30d,
        "points_balance_outstanding": points_balance_outstanding if card_type == 'points' else None,
    }

def generate_qr_svg(data: str) -> str:
    qr = qrcode.make(data, image_factory=SvgImage)
    buffer = BytesIO()
    qr.save(buffer)
    return buffer.getvalue().decode("utf-8")

# Wallet hero-image generation
# Google Wallet's heroImage has to be a flat, static PNG - it can't render
# CSS, so the diagonal gradient card look used on the web/join page
# (linear-gradient(135deg, primary_color 0%, #14b8a6 100%)) is baked into a
# real 1032x336 image here instead. Rendered at 1/4 scale then upscaled with
# LANCZOS, which is both fast and smooth enough for a soft gradient.
HERO_GRADIENT_END = (20, 184, 166)  # #14b8a6 - matches the web card's gradient end
HERO_SIZE = (1032, 336)             # Google's recommended hero image size

def _hex_to_rgb(hex_color: Optional[str]) -> tuple:
    hex_color = (hex_color or '#3b82f6').lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join(c * 2 for c in hex_color)
    try:
        return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return (13, 148, 136)  # fallback teal if primary_color is malformed

def generate_hero_image_bytes(primary_color: str) -> bytes:
    """Plain gradient, no text - used as the class-level fallback banner
    (shared by every customer before any personalized object image exists)."""
    return _hero_to_png(_render_hero(primary_color))

def _render_hero(primary_color: str) -> "Image.Image":
    start = _hex_to_rgb(primary_color)
    end = HERO_GRADIENT_END
    scale = 4
    w, h = HERO_SIZE[0] // scale, HERO_SIZE[1] // scale
    small = Image.new('RGB', (w, h))
    px = small.load()
    max_d = w + h
    for y in range(h):
        for x in range(w):
            t = (x + y) / max_d  # 135deg diagonal blend, matches CSS gradient direction
            px[x, y] = (
                int(start[0] + (end[0] - start[0]) * t),
                int(start[1] + (end[1] - start[1]) * t),
                int(start[2] + (end[2] - start[2]) * t),
            )
    return small.resize(HERO_SIZE, Image.LANCZOS)

def _hero_to_png(img: "Image.Image") -> bytes:
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    return buffer.getvalue()

def _wrap_text(draw, text: str, font, max_width: int, max_lines: int) -> List[str]:
    """Greedy word-wrap using actual glyph widths, truncating with an
    ellipsis if the text still doesn't fit in max_lines."""
    words = (text or '').split()
    lines, current = [], ''
    for word in words:
        trial = f'{current} {word}'.strip()
        if draw.textbbox((0, 0), trial, font=font)[2] <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
            if len(lines) == max_lines:
                break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) == max_lines and words:
        # last line may still overflow after wrapping - truncate with ellipsis
        last = lines[-1]
        while last and draw.textbbox((0, 0), last + '…', font=font)[2] > max_width:
            last = last[:-1]
        lines[-1] = last + '…' if last != lines[-1] else last
    return lines

def generate_personalized_hero_image_bytes(
    primary_color: str,
    reward_name: str,
    stamps: int,
    stamp_goal: int,
    description: Optional[str] = None,
    card_type: str = 'stamp',
    points_balance: int = 0,
) -> bytes:
    """Same gradient as generate_hero_image_bytes, but with a bottom banner
    burned in showing the reward/progress and short description - the
    per-customer Wallet equivalent of the reward/progress rows shown on the
    web card. This is set as the *object*-level heroImage (per customer),
    not the class-level one, since progress differs per person.
    For card_type == 'points', the top line becomes a plain points balance
    instead of a reward name (points cards have no single fixed reward -
    see points_prizes on loyalty_programs) and the progress line reports
    the points balance instead of a stamp count."""
    img = _render_hero(primary_color).convert('RGBA')
    from PIL import ImageDraw, ImageFont

    scrim_height = 150
    scrim = Image.new('RGBA', (HERO_SIZE[0], scrim_height), (0, 0, 0, 0))
    scrim_px = scrim.load()
    for y in range(scrim_height):
        alpha = int(150 * (y / scrim_height))  # fades in from transparent to dark
        for x in range(HERO_SIZE[0]):
            scrim_px[x, y] = (0, 0, 0, alpha)
    img.alpha_composite(scrim, (0, HERO_SIZE[1] - scrim_height))

    draw = ImageDraw.Draw(img)
    pad = 40
    max_w = HERO_SIZE[0] - pad * 2
    font_reward = ImageFont.load_default(size=34)
    font_progress = ImageFont.load_default(size=24)
    font_desc = ImageFont.load_default(size=19)

    if card_type == 'points':
        reward_line = f'{points_balance} points'
        progress_line = 'Redeem prizes in-store'
    else:
        reward_line = (reward_name or 'Reward')[:60]
        progress_line = f'{stamps} of {stamp_goal} stamps'
    desc_lines = _wrap_text(draw, description or '', font_desc, max_w, max_lines=2) if description else []

    y = HERO_SIZE[1] - 24
    for line in reversed(desc_lines):
        h = draw.textbbox((0, 0), line, font=font_desc)[3]
        y -= h + 4
        draw.text((pad, y), line, font=font_desc, fill=(255, 255, 255, 235))
    y -= 8
    h = draw.textbbox((0, 0), progress_line, font=font_progress)[3]
    y -= h
    draw.text((pad, y), progress_line, font=font_progress, fill=(255, 255, 255, 255))
    y -= 6
    h = draw.textbbox((0, 0), reward_line, font=font_reward)[3]
    y -= h
    draw.text((pad, y), reward_line, font=font_reward, fill=(255, 255, 255, 255))

    return _hero_to_png(img.convert('RGB'))

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
            'origins': [BASE_URL, 'https://theloyaltytree.com', 'https://loyaltree-five.vercel.app'],
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
    description = program.get('description') if program else None
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
            {'header': 'About', 'body': description if description else 'Collect stamps, earn rewards'}
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
    if not hero_url:
        # No custom hero photo uploaded - generate the same diagonal gradient
        # used on the web/join page so the Wallet pass matches it, instead of
        # showing no banner at all. The color is baked into the URL itself:
        # same primary_color -> same URL -> Google can keep using its cached
        # copy; a color change produces a new URL, forcing Google to refetch.
        color_key = primary_color.lstrip('#')
        hero_url = f'{BASE_URL}/api/v1/business/{biz_public_id}/hero-image.png?c={color_key}'
    loyalty_class['heroImage'] = {'sourceUri': {'uri': hero_url}}

    return loyalty_class

def build_loyalty_object(customer: dict, business: dict, program: dict) -> dict:
    cust_public_id = customer.get('public_id', '')
    class_id = program.get('google_wallet_class_id') if program and program.get('google_wallet_class_id') else f'{GOOGLE_WALLET_ISSUER_ID}.{GOOGLE_WALLET_CLASS_SUFFIX}'
    object_id = f'{GOOGLE_WALLET_ISSUER_ID}.{cust_public_id}'
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    stamps = customer.get('stamp_count', 0)
    points_balance = customer.get('points_balance', 0)
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', '')

    if card_type == 'points':
        loyalty_points_label = 'Points'
        loyalty_points_balance = str(points_balance)
        progress_body = f'{points_balance} points'
        reward_body = 'Redeem prizes in-store'
    else:
        loyalty_points_label = 'Stamps'
        loyalty_points_balance = f'{stamps}/{stamp_goal}'
        progress_body = f'{stamps} of {stamp_goal} stamps'
        reward_body = reward_name

    loyalty_object = {
        'id': object_id,
        'classId': class_id,
        'state': 'active',
        'barcode': {
            'type': 'QR_CODE',
            'value': f'{BASE_URL}/stamp/{cust_public_id}',
            'alternateText': cust_name
        },
        'accountId': cust_public_id,
        'accountName': cust_name,
        'loyaltyPoints': {
            'label': loyalty_points_label,
            'balance': {'string': loyalty_points_balance}
        },
        'textModulesData': [
            {'header': 'Business', 'body': biz_name},
            {'header': 'Reward', 'body': reward_body},
            {'header': 'Progress', 'body': progress_body}
        ],
        'linksModuleData': {
            'uris': [{'uri': f'{BASE_URL}/wallet/{cust_public_id}', 'description': 'View Card Online'}]
        }
    }

    # Object-level heroImage overrides the class-level one for just this
    # customer - used to burn their live reward/progress/description onto
    # the gradient banner. Skipped when the business uploaded their own
    # hero photo, since baking text onto someone else's image would look
    # wrong; that photo is left to show as-is (inherited from the class).
    if not (program and program.get('hero_image_url')):
        primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
        description = program.get('description') if program else None
        color_key = primary_color.lstrip('#')
        progress_key = points_balance if card_type == 'points' else stamps
        hero_url = (
            f'{BASE_URL}/api/v1/customer/{cust_public_id}/hero-image.png'
            f'?s={progress_key}&g={stamp_goal}&c={color_key}'
        )
        loyalty_object['heroImage'] = {'sourceUri': {'uri': hero_url}}

    return loyalty_object


def sync_wallet_object(customer: dict, business: dict, program: dict,
                        notify_header: str = None, notify_body: str = None,
                        notify_message_id: str = None):
    """Push the customer's latest stamp count to Google Wallet.
    Google only creates its own copy of the loyaltyObject when the customer taps
    "Add to Google Wallet" - after that, changes in our DB never reach the saved
    pass unless we PATCH it here. Best-effort: never raises, so a Wallet API hiccup
    never blocks the stamp/redeem response to the cashier.

    Pass notify_header/notify_body/notify_message_id to also fire a
    TEXT_AND_NOTIFY addMessage call (via send_wallet_object_message) after the
    patch succeeds - the PATCH alone silently updates the pass's data with no
    visible notification to the customer. Omit them (as the owner's manual
    dashboard stamp-count edit does) to keep the sync silent."""
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
                if notify_header and notify_message_id:
                    send_wallet_object_message(object_id, notify_header, notify_body or '', notify_message_id)
            elif resp.status_code == 404:
                print(f"WALLET SYNC: {object_id} not found - customer hasn't added it to their wallet yet")
            else:
                print(f"WALLET SYNC: failed {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"WALLET SYNC error: {e}")

# Apple Wallet (PassKit) Helpers
#
# Unlike Google Wallet (a REST API Google hosts), an Apple Wallet pass is a
# signed zip file (.pkpass) that we build and sign ourselves, plus a small
# "web service" Apple's Wallet app calls back into for live updates. Three
# things happen here:
#   1. build_pkpass_bytes() - assembles + signs the .pkpass, used both for
#      the initial download and for every subsequent refetch.
#   2. The web service routes (registration, list-updated, get-pass, log)
#      further down, which Wallet calls per Apple's PassKit Web Service spec.
#   3. push_apple_wallet_update() - the APNs push that tells a device's
#      Wallet app "go call the web service, something changed" - the Apple
#      equivalent of sync_wallet_object() above.

_apple_pass_credentials_cache = None
_apple_push_cert_paths = None

def get_apple_pass_credentials():
    """Loads (private_key, certificate, wwdr_certificate) from the env vars
    once per process. Returns None if Apple Wallet isn't configured yet.
    Tries the PEM cert+key path first (APPLE_PASS_CERTIFICATE +
    APPLE_PASS_PRIVATE_KEY), falling back to reading APPLE_PASS_CERTIFICATE
    as a raw .p12 if no separate key was given."""
    global _apple_pass_credentials_cache
    if _apple_pass_credentials_cache is not None:
        return _apple_pass_credentials_cache or None
    if not APPLE_PASS_CERTIFICATE or not APPLE_WWDR_CERTIFICATE:
        _apple_pass_credentials_cache = False
        return None
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization

        wwdr_bytes = base64.b64decode(APPLE_WWDR_CERTIFICATE)
        try:
            wwdr_cert = x509.load_pem_x509_certificate(wwdr_bytes)
        except ValueError:
            wwdr_cert = x509.load_der_x509_certificate(wwdr_bytes)

        private_key = None
        certificate = None

        if APPLE_PASS_PRIVATE_KEY:
            cert_bytes = base64.b64decode(APPLE_PASS_CERTIFICATE)
            key_bytes = base64.b64decode(APPLE_PASS_PRIVATE_KEY)
            certificate = x509.load_pem_x509_certificate(cert_bytes)
            key_password = APPLE_PASS_CERTIFICATE_PASSWORD.encode() if APPLE_PASS_CERTIFICATE_PASSWORD else None
            private_key = serialization.load_pem_private_key(key_bytes, password=key_password)
        else:
            from cryptography.hazmat.primitives.serialization import pkcs12
            p12_bytes = base64.b64decode(APPLE_PASS_CERTIFICATE)
            password_bytes = APPLE_PASS_CERTIFICATE_PASSWORD.encode() if APPLE_PASS_CERTIFICATE_PASSWORD else None
            private_key, certificate, _extra = pkcs12.load_key_and_certificates(p12_bytes, password_bytes)

        if not private_key or not certificate:
            print("APPLE WALLET: credentials did not yield both a private key and a certificate")
            _apple_pass_credentials_cache = False
            return None
        _apple_pass_credentials_cache = (private_key, certificate, wwdr_cert)
        return _apple_pass_credentials_cache
    except Exception as e:
        print(f"APPLE WALLET: credential load error: {e}")
        _apple_pass_credentials_cache = False
        return None

def apple_pass_auth_token(serial_number: str) -> str:
    """Per-customer token embedded in pass.json's authenticationToken. The
    Wallet app sends it back as 'Authorization: ApplePass <token>' on every
    web service call for that pass, so we can verify the call is really
    about that customer's pass without storing a token anywhere ourselves."""
    secret = APPLE_PASS_AUTH_SECRET or 'unset-secret-please-configure-APPLE_PASS_AUTH_SECRET'
    return hmac.new(secret.encode(), serial_number.encode(), hashlib.sha256).hexdigest()

def apple_auth_ok(serial_number: str, authorization: Optional[str]) -> bool:
    if not authorization or not authorization.startswith('ApplePass '):
        return False
    token = authorization[len('ApplePass '):].strip()
    return hmac.compare_digest(token, apple_pass_auth_token(serial_number))

def sign_pkpass_manifest(manifest_bytes: bytes) -> Optional[bytes]:
    creds = get_apple_pass_credentials()
    if not creds:
        return None
    private_key, certificate, wwdr_cert = creds
    try:
        from cryptography.hazmat.primitives.serialization import pkcs7, Encoding
        from cryptography.hazmat.primitives import hashes
        return (
            pkcs7.PKCS7SignatureBuilder()
            .set_data(manifest_bytes)
            .add_signer(certificate, private_key, hashes.SHA256())
            .add_certificate(wwdr_cert)
            .sign(Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary])
        )
    except Exception as e:
        print(f"APPLE WALLET: manifest signing error: {e}")
        return None

def generate_apple_icon_bytes(primary_color: str, business_name: str, size: int) -> bytes:
    """Solid primary_color square with the business's first initial - the
    same 'colored circle + initial' look used for customer avatars in the
    dashboard, just square (Apple rounds the corners itself)."""
    from PIL import ImageDraw, ImageFont
    r, g, b = _hex_to_rgb(primary_color)
    img = Image.new('RGB', (size, size), (r, g, b))
    draw = ImageDraw.Draw(img)
    letter = (business_name or '?').strip()[:1].upper() or '?'
    font = ImageFont.load_default(size=int(size * 0.55))
    bbox = draw.textbbox((0, 0), letter, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), letter, font=font, fill=(255, 255, 255))
    return _hero_to_png(img)

def generate_apple_logo_bytes(business_name: str, width: int, height: int) -> bytes:
    """Transparent-background wordmark shown in the pass header, next to
    logoText. Shrinks the font until the business name fits on one line."""
    from PIL import ImageDraw, ImageFont
    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    text = (business_name or 'Loyalty').strip()[:24]
    font_size = int(height * 0.55)
    font = ImageFont.load_default(size=font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    while tw > width - 16 and font_size > 8:
        font_size -= 2
        font = ImageFont.load_default(size=font_size)
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((width - tw) / 2 - bbox[0], (height - th) / 2 - bbox[1]), text, font=font, fill=(255, 255, 255, 255))
    return _hero_to_png(img)

def get_latest_active_announcement(business_id: int) -> Optional[dict]:
    """Latest still-active, not-yet-expired announcement for a business, used
    to surface an 'Announcement' field on the Apple Wallet pass (Google
    Wallet gets its own copy via send_wallet_class_message's addMessage
    call, so this is Apple's equivalent data source). Returns None on any
    error or when there simply isn't one - callers treat that the same as
    'no announcement configured', not an error."""
    if not supabase:
        return None
    try:
        res = (
            supabase.table("announcements")
            .select("*")
            .eq("business_id", business_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
    except Exception:
        return None
    if not rows:
        return None
    ann = rows[0]
    end_date = ann.get('end_date')
    if end_date and str(end_date) < datetime.utcnow().date().isoformat():
        return None
    return ann

def build_apple_pass_json(customer: dict, business: dict, program: dict, announcement: Optional[dict] = None) -> dict:
    cust_public_id = customer.get('public_id', '')
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', 'Loyalty')
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    description = program.get('description') if program else None
    stamps = customer.get('stamp_count', 0)
    points_balance = customer.get('points_balance', 0)
    reward_unlocked = bool(customer.get('reward_unlocked'))
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    r, g, b = _hex_to_rgb(primary_color)

    # Announcement field: always present (rather than added/removed) so the
    # field's value - not its existence - is what changes between rebuilds.
    # PassKit only offers a lock-screen notification when a field's *value*
    # differs from what the device already has for that key, substituted
    # into changeMessage's %@. Falls back to a static placeholder when there
    # is no active announcement, so first-time installs and quiet periods
    # don't show stale or blank text. Note: this placeholder is itself a
    # "value" PassKit can diff against, so a business going from an active
    # announcement back to none will also trigger one (harmless but
    # unavoidable) notification - PassKit has no per-field "silent update".
    ann_title = (announcement or {}).get('title', '') or ''
    ann_message = (announcement or {}).get('message', '') or ''
    announcement_value = ann_title.strip() or ann_message.strip() or 'Check back for updates'

    back_fields = [
        {'key': 'about', 'label': 'About', 'value': description or 'Collect stamps, earn rewards.'},
        {'key': 'online', 'label': 'View Online', 'value': f'{BASE_URL}/wallet/{cust_public_id}'},
        {
            'key': 'announcement',
            'label': '📢 ANNOUNCEMENT',
            'value': announcement_value[:150],
            'changeMessage': '%@',
        },
    ]
    if ann_message.strip() and ann_message.strip() != announcement_value:
        back_fields.append({'key': 'announcement_detail', 'label': ' ', 'value': ann_message.strip()[:400]})

    return {
        'formatVersion': 1,
        'passTypeIdentifier': APPLE_PASS_TYPE_IDENTIFIER,
        'teamIdentifier': APPLE_TEAM_IDENTIFIER,
        'organizationName': biz_name,
        'serialNumber': cust_public_id,
        'description': f'{biz_name} Loyalty Card',
        'logoText': biz_name[:20],
        'backgroundColor': f'rgb({r}, {g}, {b})',
        'foregroundColor': 'rgb(255, 255, 255)',
        'labelColor': 'rgba(255, 255, 255, 0.75)',
        'webServiceURL': APPLE_PASS_WEB_SERVICE_URL,
        'authenticationToken': apple_pass_auth_token(cust_public_id),
        'storeCard': {
            'headerFields': [
                {'key': 'points', 'label': 'POINTS', 'value': str(points_balance), 'changeMessage': 'Points added! You now have %@ points.'}
                if card_type == 'points' else
                {'key': 'stamps', 'label': 'STAMPS', 'value': f'{stamps}/{stamp_goal}', 'changeMessage': 'Stamp added! You now have %@ stamps.'}
            ],
            'primaryFields': [
                {'key': 'reward', 'label': 'REWARD', 'value': 'Redeem prizes in-store', 'changeMessage': '%@'}
                if card_type == 'points' else
                {'key': 'reward', 'label': 'REWARD', 'value': '🎉 Ready to redeem!' if reward_unlocked else reward_name, 'changeMessage': '%@'}
            ],
            'secondaryFields': [
                {'key': 'member', 'label': 'MEMBER', 'value': cust_name}
            ],
            'auxiliaryFields': [
                {'key': 'business', 'label': 'BUSINESS', 'value': biz_name}
            ],
            'backFields': back_fields
        },
        'barcodes': [
            {
                'format': 'PKBarcodeFormatQR',
                'message': f'{BASE_URL}/stamp/{cust_public_id}',
                'messageEncoding': 'iso-8859-1',
                'altText': cust_name
            }
        ]
    }

def build_pkpass_bytes(customer: dict, business: dict, program: dict, announcement: Optional[dict] = None) -> Optional[bytes]:
    """Assembles and signs the full .pkpass zip. Returns None if Apple
    Wallet credentials aren't configured or signing fails - callers treat
    that the same way create_google_wallet_jwt()'s empty-string return is
    treated: a clear 'not configured' error rather than a crash.
    `announcement` is optional - pass the business's current active
    announcement (see get_latest_active_announcement) so it's reflected in
    the pass; omitted, the pass just shows the no-announcement placeholder."""
    if not APPLE_PASS_TYPE_IDENTIFIER or not APPLE_TEAM_IDENTIFIER:
        return None
    if get_apple_pass_credentials() is None:
        return None

    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    biz_name = business.get('name', 'Loyalty')
    pass_json = build_apple_pass_json(customer, business, program, announcement)

    files = {
        'pass.json': json.dumps(pass_json).encode('utf-8'),
        'icon.png': generate_apple_icon_bytes(primary_color, biz_name, 29),
        'icon@2x.png': generate_apple_icon_bytes(primary_color, biz_name, 58),
        'icon@3x.png': generate_apple_icon_bytes(primary_color, biz_name, 87),
        'logo.png': generate_apple_logo_bytes(biz_name, 160, 50),
        'logo@2x.png': generate_apple_logo_bytes(biz_name, 320, 100),
        'logo@3x.png': generate_apple_logo_bytes(biz_name, 480, 150),
    }

    manifest = {name: hashlib.sha1(content).hexdigest() for name, content in files.items()}
    manifest_bytes = json.dumps(manifest).encode('utf-8')
    signature = sign_pkpass_manifest(manifest_bytes)
    if signature is None:
        return None

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
        zf.writestr('manifest.json', manifest_bytes)
        zf.writestr('signature', signature)
    return buffer.getvalue()

def get_apple_push_cert_files():
    """Writes the signing cert + private key to temp PEM files once per
    process (httpx/ssl need real file paths, not bytes) and reuses them -
    this is the same cert used to sign passes, reused here as the TLS
    client cert APNs requires to authorize pushes for this Pass Type ID."""
    global _apple_push_cert_paths
    if _apple_push_cert_paths and all(os.path.exists(p) for p in _apple_push_cert_paths):
        return _apple_push_cert_paths
    creds = get_apple_pass_credentials()
    if not creds:
        return None, None
    private_key, certificate, _wwdr = creds
    try:
        import tempfile
        from cryptography.hazmat.primitives import serialization
        cert_pem = certificate.public_bytes(serialization.Encoding.PEM)
        key_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
        cert_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pem')
        cert_file.write(cert_pem)
        cert_file.close()
        key_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pem')
        key_file.write(key_pem)
        key_file.close()
        _apple_push_cert_paths = (cert_file.name, key_file.name)
        return _apple_push_cert_paths
    except Exception as e:
        print(f"APPLE WALLET: push cert setup error: {e}")
        return None, None

def _send_apple_wallet_pushes(push_tokens: list) -> int:
    """Shared APNs-sending core used by both push_apple_wallet_update()
    (single customer, e.g. after a stamp/redeem) and
    push_apple_wallet_announcement() (whole business, e.g. a new
    announcement). Takes raw push tokens rather than querying itself, so
    callers control which registrations get notified. Best-effort and
    silent on failure - a push hiccup must never block the caller.
    Returns the number of tokens APNs accepted (200 response), just for
    logging - callers don't need to react to this."""
    tokens = [t for t in push_tokens if t]
    if not tokens:
        return 0
    cert_path, key_path = get_apple_push_cert_files()
    if not cert_path:
        return 0
    sent = 0
    try:
        import httpx
        with httpx.Client(http2=True, cert=(cert_path, key_path), timeout=10) as client:
            for token in tokens:
                try:
                    resp = client.post(
                        f"https://api.push.apple.com/3/device/{token}",
                        headers={"apns-topic": APPLE_PASS_TYPE_IDENTIFIER},
                        json={},
                    )
                    if resp.status_code == 200:
                        sent += 1
                        print(f"APPLE WALLET PUSH: sent to {token[:12]}...")
                    else:
                        print(f"APPLE WALLET PUSH failed {resp.status_code}: {resp.text}")
                except Exception as e:
                    print(f"APPLE WALLET PUSH error: {e}")
    except Exception as e:
        print(f"APPLE WALLET PUSH client error: {e}")
    return sent

def push_apple_wallet_update(serial_number: str):
    """Tells every device that has this one customer's pass saved to
    refetch it. Best-effort and silent on failure, same contract as
    sync_wallet_object() - a push hiccup must never block a stamp/redeem."""
    if not supabase or not APPLE_PASS_TYPE_IDENTIFIER:
        return
    try:
        rows = (
            supabase.table("apple_wallet_registrations")
            .select("push_token")
            .eq("serial_number", serial_number)
            .eq("pass_type_identifier", APPLE_PASS_TYPE_IDENTIFIER)
            .execute()
        ).data or []
    except Exception:
        return
    _send_apple_wallet_pushes([row.get('push_token') for row in rows])

def push_apple_wallet_announcement(business_id: int) -> int:
    """Companion to send_wallet_class_message() for announcements, but for
    Apple Wallet: send_wallet_class_message() pushes to every Google
    Wallet card via one class-level API call, but Apple Wallet has no
    equivalent "notify everyone with this pass type" call - PassKit only
    supports pushing to individual registered serial numbers. So this
    fetches every customer's public_id for the business, looks up which
    of those serial numbers have an Apple Wallet registration, and pushes
    to each. Best-effort and silent on failure, same contract as
    push_apple_wallet_update() - a push hiccup must never block posting
    an announcement. Returns the number of tokens APNs accepted, so
    callers can optionally log/report it; 0 is a normal outcome (no
    Apple Wallet customers yet) and never raises."""
    if not supabase or not APPLE_PASS_TYPE_IDENTIFIER:
        return 0
    try:
        customer_rows = (
            supabase.table("customers")
            .select("public_id")
            .eq("business_id", business_id)
            .execute()
        ).data or []
    except Exception:
        return 0
    serial_numbers = [r['public_id'] for r in customer_rows if r.get('public_id')]
    if not serial_numbers:
        return 0
    push_tokens = []
    try:
        # Chunked to stay well under PostgREST's URL length limit for large
        # customer bases - an .in_() filter with thousands of UUIDs in one
        # request risks a 414/URI-too-long instead of a clean empty result.
        CHUNK_SIZE = 200
        for i in range(0, len(serial_numbers), CHUNK_SIZE):
            chunk = serial_numbers[i:i + CHUNK_SIZE]
            rows = (
                supabase.table("apple_wallet_registrations")
                .select("push_token")
                .in_("serial_number", chunk)
                .eq("pass_type_identifier", APPLE_PASS_TYPE_IDENTIFIER)
                .execute()
            ).data or []
            push_tokens.extend(row.get('push_token') for row in rows)
    except Exception as e:
        print(f"APPLE WALLET announcement lookup error: {e}")
        return 0
    return _send_apple_wallet_pushes(push_tokens)

def sync_apple_wallet_pass(customer: dict):
    """Companion to sync_wallet_object() - call alongside it wherever a
    customer's stamp_count changes. Never raises."""
    try:
        push_apple_wallet_update(customer.get('public_id', ''))
    except Exception as e:
        print(f"APPLE WALLET sync error: {e}")

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

def send_wallet_object_message(object_id: str, header: str, body: str, message_id: str) -> bool:
    """Push a notification to ONE customer's saved loyalty card, unlike
    send_wallet_class_message above which fans out to everyone on the
    business's card at once. Used for personalized messages - birthday
    greetings, win-back nudges - where blasting every customer would be
    wrong. Same TEXT_AND_NOTIFY / 500-char / 3-per-24h rules apply as the
    class-level version; see that function's docstring for details."""
    access_token = get_google_access_token()
    if not access_token or not object_id:
        return False
    try:
        import httpx
        payload = {
            'message': {
                'header': (header or '')[:150],
                'body': (body or '')[:500],
                'id': message_id,
                'messageType': 'TEXT_AND_NOTIFY',
            }
        }
        with httpx.Client() as client:
            resp = client.post(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}/addMessage',
                headers={"Authorization": f"Bearer {access_token}"},
                json=payload
            )
            if resp.status_code in (200, 201):
                print(f"WALLET PUSH: sent to object {object_id}")
                return True
            print(f"WALLET PUSH (object) failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print(f"WALLET PUSH (object) error: {e}")
        return False

def log_stamp_event(business_id: int, customer_id: int, staff_id: Optional[int] = None, branch_id: Optional[int] = None):
    """Best-effort event log powering the Analytics dashboard's trend and
    peak-activity charts, and the per-cashier/per-branch stamp counters.
    Never raises - a logging hiccup should never block the stamp response
    to the cashier. staff_id/branch_id are None when the owner stamps
    directly from their dashboard (no staff PIN involved)."""
    try:
        event = {
            'business_id': business_id,
            'customer_id': customer_id,
            'created_at': datetime.utcnow().isoformat(),
        }
        if staff_id is not None:
            event['staff_id'] = staff_id
        if branch_id is not None:
            event['branch_id'] = branch_id
        supabase.table("stamp_events").insert(event).execute()
    except Exception as e:
        print(f"STAMP EVENT LOG error: {e}")

def log_redemption_event(business_id: int, customer_id: int, staff_id: Optional[int] = None, branch_id: Optional[int] = None,
                          prize_name: Optional[str] = None, points_spent: Optional[int] = None):
    """Best-effort event log powering the Analytics dashboard's reward
    trend chart. Never raises. prize_name/points_spent are set only for
    points-card prize redemptions (see redeem_points_prize) - left out
    entirely for stamp-goal reward redemptions, same as before."""
    try:
        event = {
            'business_id': business_id,
            'customer_id': customer_id,
            'created_at': datetime.utcnow().isoformat(),
        }
        if staff_id is not None:
            event['staff_id'] = staff_id
        if branch_id is not None:
            event['branch_id'] = branch_id
        if prize_name is not None:
            event['prize_name'] = prize_name
        if points_spent is not None:
            event['points_spent'] = points_spent
        supabase.table("redemption_events").insert(event).execute()
    except Exception as e:
        print(f"REDEMPTION EVENT LOG error: {e}")

def log_points_event(business_id: int, customer_id: int, amount_spent: float, points_earned: int,
                      staff_id: Optional[int] = None, branch_id: Optional[int] = None):
    """Best-effort event log for points-card sales - powers the Analytics
    dashboard the same way log_stamp_event powers it for stamp cards.
    Never raises."""
    try:
        event = {
            'business_id': business_id,
            'customer_id': customer_id,
            'amount_spent_pesos': amount_spent,
            'points_earned': points_earned,
            'created_at': datetime.utcnow().isoformat(),
        }
        if staff_id is not None:
            event['staff_id'] = staff_id
        if branch_id is not None:
            event['branch_id'] = branch_id
        supabase.table("points_events").insert(event).execute()
    except Exception as e:
        print(f"POINTS EVENT LOG error: {e}")

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
                status = (business.get('status') or 'PENDING').upper()
                if status == 'PENDING':
                    raise HTTPException(
                        status_code=403,
                        detail="Your business application is still pending approval. We'll email you as soon as it's reviewed."
                    )
                if status != 'ACTIVE':
                    raise HTTPException(
                        status_code=403,
                        detail="Your account is not active. Please contact support for details."
                    )
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"Business login error: {e}")

    try:
        res = supabase.table("staff").select("*,businesses(public_id,name,logo_url,status)").eq("email", req.email).maybe_single().execute()
        staff = res.data
        if staff:
            stored_pin = staff.get('pin', '')
            if stored_pin == req.password or stored_pin == hash_password(req.password):
                biz = staff.get('businesses', {}) or {}
                status = (biz.get('status') or 'PENDING').upper()
                if status == 'PENDING':
                    raise HTTPException(
                        status_code=403,
                        detail="This business's application is still pending approval. Please check back once it's reviewed."
                    )
                if status != 'ACTIVE':
                    raise HTTPException(
                        status_code=403,
                        detail="This business's account is not active. Please contact support for details."
                    )
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"Staff login error: {e}")

    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.post("/api/v1/register")
@app.post("/api/v1/auth/register")
async def register(biz: BusinessCreate):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    dup_field = find_business_duplicate(biz.email, biz.phone)
    if dup_field:
        raise HTTPException(status_code=400, detail=f"An account with this {dup_field} already exists.")

    public_id = generate_business_public_id(biz.name)
    if biz.plan:
        if biz.plan not in SUBSCRIPTION_PLANS:
            raise HTTPException(status_code=400, detail=f"Unknown plan '{biz.plan}'. Valid plans: {list(SUBSCRIPTION_PLANS.keys())}")
        max_branches = SUBSCRIPTION_PLANS[biz.plan].get('max_branches')
        if max_branches is not None and biz.branch_count > max_branches:
            raise HTTPException(
                status_code=400,
                detail=f"{SUBSCRIPTION_PLANS[biz.plan]['label']} supports up to {max_branches} branch{'es' if max_branches != 1 else ''}. Choose a higher plan or reduce your branch count."
            )
        plan = biz.plan
    else:
        plan = determine_plan_from_branch_count(biz.branch_count)
    price_month = get_price_for_plan(plan, biz.branch_count)
    business_data = {
        'public_id': public_id,
        'name': biz.name,
        'email': biz.email,
        'phone': biz.phone,
        'password_hash': hash_password(biz.password),
        'logo_url': biz.logo_url,
        'business_type': biz.business_type,
        'address': biz.address,
        'plan': plan,
        'status': 'PENDING',
        'created_at': datetime.utcnow().isoformat(),
    }

    try:
        insert_res = supabase.table("businesses").insert(business_data).execute()
        business_id = insert_res.data[0]['id'] if insert_res.data else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

    # One placeholder branch per unit they signed up with, named so the
    # owner can tell them apart immediately and rename later from the
    # dashboard. "Main Branch" instead of "Branch 1" when there's only one.
    if business_id:
        try:
            if biz.branch_count <= 1:
                branch_names = ['Main Branch']
            else:
                branch_names = [f'Branch {i + 1}' for i in range(biz.branch_count)]
            branch_rows = [
                {
                    'business_id': business_id,
                    'public_id': generate_public_id(),
                    'name': name,
                    'is_active': True,
                    'created_at': datetime.utcnow().isoformat(),
                }
                for name in branch_names
            ]
            supabase.table("branches").insert(branch_rows).execute()
        except Exception as e:
            print(f"BRANCH SEED error: {e}")  # best-effort - owner can add branches manually if this fails

    return {
        "success": True,
        "business_slug": public_id,
        "business_name": biz.name,
        "token": "owner-token-" + public_id,
        "logo_url": biz.logo_url,
        "plan": plan,
        "branch_count": biz.branch_count,
        "price_month": price_month,
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

@app.get("/api/v1/plans")
async def list_plans():
    """Public (no auth) - lets the signup page show accurate tier names,
    prices, and branch limits without hardcoding a copy that can drift
    from SUBSCRIPTION_PLANS."""
    return SUBSCRIPTION_PLANS

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
        points_sales_30d_res = supabase.table("points_events").select("points_earned").gte("created_at", since).execute()
        points_sales_30d = len(points_sales_30d_res.data or [])
        points_issued_30d = sum((e.get('points_earned') or 0) for e in (points_sales_30d_res.data or []))

        status_breakdown = {}
        plan_breakdown = {}
        card_type_breakdown = {'stamp': 0, 'points': 0}
        for b in businesses:
            status = (b.get('status') or 'PENDING').upper()
            plan = b.get('plan') or 'starter'
            status_breakdown[status] = status_breakdown.get(status, 0) + 1
            plan_breakdown[plan] = plan_breakdown.get(plan, 0) + 1

        # Outstanding points liability across every points-card business.
        total_points_outstanding = 0
        try:
            points_programs = supabase.table("loyalty_programs").select("business_id").eq("card_type", "points").execute().data or []
            points_business_ids = [p.get('business_id') for p in points_programs]
            card_type_breakdown['points'] = len(points_business_ids)
            card_type_breakdown['stamp'] = len(businesses) - len(points_business_ids)
            if points_business_ids:
                bal_res = supabase.table("customers").select("points_balance").in_("business_id", points_business_ids).execute()
                total_points_outstanding = sum((c.get('points_balance') or 0) for c in (bal_res.data or []))
        except Exception:
            pass

        return {
            "total_businesses": len(businesses),
            "total_customers": customers_res.count or 0,
            "total_staff": staff_res.count or 0,
            "stamps_30d": stamps_30d_res.count or 0,
            "redemptions_30d": redemptions_30d_res.count or 0,
            "points_sales_30d": points_sales_30d,
            "points_issued_30d": points_issued_30d,
            "total_points_outstanding": total_points_outstanding,
            "card_type_breakdown": card_type_breakdown,
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
            businesses = [
                b for b in businesses
                if needle in (b.get('name') or '').lower()
                or needle in (b.get('email') or '').lower()
                or needle in (b.get('address') or '').lower()
            ]
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
    if summary.get("card_type") == 'points':
        try:
            since = (datetime.utcnow() - timedelta(days=30)).isoformat()
            pe_res = supabase.table("points_events").select("points_earned").eq("business_id", business.get('id')).gte("created_at", since).execute()
            summary["points_issued_30d"] = sum((e.get('points_earned') or 0) for e in (pe_res.data or []))
        except Exception:
            summary["points_issued_30d"] = 0
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
    if update.last_paid_at is not None:
        data['last_paid_at'] = update.last_paid_at
    if update.name is not None:
        if not update.name.strip():
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        data['name'] = update.name.strip()
    if update.email is not None:
        new_email = update.email.strip().lower()
        if not new_email:
            raise HTTPException(status_code=400, detail="Email cannot be empty")
        if new_email != (business.get('email') or '').lower():
            existing = supabase.table("businesses").select("id").eq("email", new_email).execute().data or []
            if any(row.get('id') != business.get('id') for row in existing):
                raise HTTPException(status_code=400, detail="Another business already uses this email")
        data['email'] = new_email
    if update.phone is not None:
        data['phone'] = update.phone
    if update.business_type is not None:
        data['business_type'] = update.business_type
    if update.logo_url is not None:
        data['logo_url'] = update.logo_url
    if update.subscription_expires_at is not None:
        data['subscription_expires_at'] = update.subscription_expires_at
    if update.address is not None:
        data['address'] = update.address
    if update.announcement_limit_adjustment is not None:
        data['announcement_limit_adjustment'] = update.announcement_limit_adjustment
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

# SUBSCRIPTION PAYMENTS (PayMongo QR Ph)
# Flow: owner opens their billing page -> frontend POSTs to /checkout -> we
# create a PayMongo Payment Intent for their current plan's price and hand
# back a QR code image to display -> owner scans and pays with their
# banking/e-wallet app -> PayMongo calls our /webhooks/paymongo endpoint ->
# we update businesses.last_paid_at / subscription_expires_at automatically.
# The frontend can poll GET /subscription while the QR is on screen to know
# the moment the webhook has landed.

@app.post("/api/v1/business/{public_id}/subscription/checkout")
async def create_subscription_checkout(public_id: str):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        branch_res = supabase.table("branches").select("id", count="exact").eq("business_id", business.get("id")).execute()
        branch_count = branch_res.count or 1
    except Exception:
        branch_count = 1

    plan = business.get('plan') or 'starter'
    price = get_price_for_plan(plan, branch_count)
    plan_label = SUBSCRIPTION_PLANS.get(plan, {}).get('label', plan)
    description = f"LoyaltyTree {plan_label} subscription - {business.get('name', '')}"

    checkout = create_qrph_checkout(
        amount_php=price,
        description=description,
        billing_name=business.get('name') or 'Business Owner',
        billing_email=business.get('email') or '',
        billing_phone=business.get('phone'),
        metadata={'business_public_id': public_id, 'plan': plan},
    )

    payment_public_id = generate_public_id()
    try:
        supabase.table("subscription_payments").insert({
            'public_id': payment_public_id,
            'business_id': business.get('id'),
            'paymongo_payment_intent_id': checkout['intent_id'],
            'amount': price,
            'plan': plan,
            'branch_count': branch_count,
            'status': 'pending',
            'created_at': datetime.utcnow().isoformat(),
        }).execute()
    except Exception as e:
        print(f"SUBSCRIPTION PAYMENT LOG error: {e}")  # not fatal - metadata on the intent itself is the webhook's fallback lookup

    return {
        "payment_intent_id": checkout['intent_id'],
        "status": checkout['status'],
        "qr_image_url": checkout['qr_image_url'],
        "amount": price,
        "plan": plan,
        "plan_label": plan_label,
        "expires_in_seconds": 600,  # PayMongo QR Ph codes expire ~10 minutes after generation
    }

@app.get("/api/v1/business/{public_id}/subscription")
async def get_subscription_status(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    subscription_expires_at = business.get('subscription_expires_at')
    subscription_status = 'none'
    days_left = None
    if subscription_expires_at:
        expires = _parse_ts(subscription_expires_at)
        if expires:
            days_left = (expires - datetime.utcnow()).days
            if days_left < 0:
                subscription_status = 'expired'
            elif days_left <= 7:
                subscription_status = 'expiring_soon'
            else:
                subscription_status = 'active'

    latest_payment = None
    try:
        res = (
            supabase.table("subscription_payments")
            .select("*")
            .eq("business_id", business.get("id"))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest_payment = (res.data or [None])[0]
    except Exception:
        pass

    return {
        "plan": business.get('plan', 'starter'),
        "last_paid_at": business.get('last_paid_at'),
        "subscription_expires_at": subscription_expires_at,
        "subscription_status": subscription_status,
        "days_left": days_left,
        "latest_payment": latest_payment,
    }

@app.get("/api/v1/business/{public_id}/subscription/payments")
async def list_subscription_payments(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = (
            supabase.table("subscription_payments")
            .select("*")
            .eq("business_id", business.get("id"))
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/webhooks/paymongo")
async def paymongo_webhook(request: Request):
    raw_body = await request.body()
    signature_header = request.headers.get("paymongo-signature", "")

    if not verify_paymongo_signature(raw_body, signature_header):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    envelope = event.get("data", {}).get("attributes", {})
    event_type = envelope.get("type", "")
    resource = envelope.get("data", {}) or {}
    resource_attrs = resource.get("attributes", {}) or {}
    metadata = resource_attrs.get("metadata") or {}
    payment_intent_id = resource_attrs.get("payment_intent_id") or resource.get("id")

    print(f"PAYMONGO WEBHOOK: {event_type} intent={payment_intent_id} metadata={metadata}")

    if not supabase:
        return {"received": True}

    business = None
    business_public_id = metadata.get("business_public_id")
    if business_public_id:
        business = safe_get_business(business_public_id)
    if not business and payment_intent_id:
        try:
            row = (
                supabase.table("subscription_payments")
                .select("*")
                .eq("paymongo_payment_intent_id", payment_intent_id)
                .maybe_single()
                .execute()
                .data
            )
            if row:
                business = safe_get_business_by_id(row.get("business_id"))
        except Exception:
            pass

    if event_type == "payment.paid":
        if business:
            now = datetime.utcnow()
            new_expiry = (now + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)).date().isoformat()
            business_update = {
                "last_paid_at": now.date().isoformat(),
                "subscription_expires_at": new_expiry,
            }
            # First payment activates the account automatically - no manual
            # admin approval needed. Only PENDING is auto-promoted; if an
            # admin has REJECTED or SUSPENDED this business, a stray/late
            # payment should not silently reactivate it - that stays a
            # manual admin decision.
            if (business.get('status') or '').upper() == 'PENDING':
                business_update['status'] = 'ACTIVE'
            try:
                supabase.table("businesses").update(business_update).eq("id", business.get("id")).execute()
            except Exception as e:
                print(f"WEBHOOK business update error: {e}")
            try:
                supabase.table("subscription_payments").update({
                    "status": "paid",
                    "paymongo_payment_id": resource.get("id"),
                    "paid_at": now.isoformat(),
                }).eq("paymongo_payment_intent_id", payment_intent_id).execute()
            except Exception as e:
                print(f"WEBHOOK payment log update error: {e}")
        else:
            print(f"WEBHOOK payment.paid - could not match a business for intent {payment_intent_id}")

    elif event_type in ("payment.failed", "qrph.expired"):
        try:
            supabase.table("subscription_payments").update({
                "status": "failed" if event_type == "payment.failed" else "expired",
            }).eq("paymongo_payment_intent_id", payment_intent_id).execute()
        except Exception as e:
            print(f"WEBHOOK failure log update error: {e}")

    return {"received": True}

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
        "active_coupon": safe_get_active_coupon(customer.get('id')),
    }

@app.get("/api/v1/business/{public_id}/customers")
async def get_customers(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("customers").select("*").eq("business_id", business.get("id")).execute()
        customers = res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Attach last_stamp_at from stamp_events (most recent stamp per customer),
    # so the owner dashboard can show "last stamped" instead of only the
    # cumulative stamp_count. Best-effort - if this fails, customers still
    # return without the field rather than erroring the whole list out.
    try:
        stamp_events = (
            supabase.table("stamp_events")
            .select("customer_id,created_at")
            .eq("business_id", business.get("id"))
            .execute()
            .data or []
        )
        last_stamp_by_customer = {}
        for ev in stamp_events:
            cid = ev.get('customer_id')
            ts = _parse_ts(ev.get('created_at'))
            if not ts:
                continue
            if cid not in last_stamp_by_customer or ts > last_stamp_by_customer[cid]:
                last_stamp_by_customer[cid] = ts
        for c in customers:
            last_stamp = last_stamp_by_customer.get(c.get('id'))
            c['last_stamp_at'] = last_stamp.isoformat() if last_stamp else None
    except Exception:
        for c in customers:
            c.setdefault('last_stamp_at', None)

    return customers

@app.api_route("/api/v1/business/{public_id}/customers/{customer_public_id}", methods=["PUT", "PATCH"])
async def update_customer(public_id: str, customer_public_id: str, update: CustomerUpdate):
    # Accepts both PUT and PATCH: EditCustomerModal.jsx calls this with PUT,
    # while the semantics here are really a partial update (PATCH). Supporting
    # both avoids a 405 Method Not Allowed without having to touch the frontend.
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}

    # Empty-string dates ("" from a blank date input) aren't valid Postgres
    # date/timestamp values - Supabase rejects them outright ("invalid input
    # syntax for type timestamp/date: \"\""). Treat a blank date field as
    # "not provided" rather than "clear it", same as the other Optional
    # fields already behave via exclude_unset above.
    for date_field in ('birthday', 'last_order_date'):
        if update_data.get(date_field) == '':
            del update_data[date_field]

    if not update_data:
        return customer

    if 'phone' in update_data or 'email' in update_data:
        dup_field = find_customer_duplicate(
            business.get('id'),
            update_data.get('phone'),
            update_data.get('email'),
            exclude_id=customer.get('id'),
        )
        if dup_field:
            raise HTTPException(
                status_code=400,
                detail=f"Another member already uses this {dup_field}."
            )

    # Manual stamp correction: recompute reward_unlocked against this
    # business's current stamp goal so the card/wallet pass stays
    # consistent with the corrected total, the same way add_stamp does.
    # Points corrections don't need a recomputed field the way stamps do
    # (no reward_unlocked equivalent for points), but still need `program`
    # loaded below so the wallet push has it.
    program = None
    if 'stamp_count' in update_data or 'points_balance' in update_data:
        program = safe_get_loyalty_program(business.get('id'))
    if 'stamp_count' in update_data:
        goal = program.get('stamp_goal', 8) if program else 8
        update_data['reward_unlocked'] = update_data['stamp_count'] >= goal

    update_data['updated_at'] = datetime.utcnow().isoformat()

    try:
        res = supabase.table("customers").update(update_data).eq("id", customer.get("id")).execute()
        updated_customer = res.data[0] if res.data else {**customer, **update_data}
    except Exception as e:
        error_msg = str(e)
        print(f"CUSTOMER UPDATE ERROR: {error_msg}")
        if 'reward_unlocked' in error_msg.lower() and 'reward_unlocked' in update_data:
            # Some installs may not have this column yet - retry without it
            # rather than blocking the whole edit (stamp_count still saves).
            retry_data = {k: v for k, v in update_data.items() if k != 'reward_unlocked'}
            try:
                res = supabase.table("customers").update(retry_data).eq("id", customer.get("id")).execute()
                return res.data[0] if res.data else {**customer, **retry_data}
            except Exception as e2:
                error_msg = str(e2)
        is_schema_mismatch = (
            'PGRST204' in error_msg
            or ('column' in error_msg.lower() and 'does not exist' in error_msg.lower())
            or ('could not find' in error_msg.lower() and 'column' in error_msg.lower())
        )
        if is_schema_mismatch:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Database schema mismatch: {error_msg}. Add the missing column(s) to "
                    f"'customers' in Supabase and run NOTIFY pgrst, 'reload schema'; "
                    f"before retrying."
                ),
            )
        raise HTTPException(status_code=500, detail=error_msg)

    if 'stamp_count' in update_data or 'points_balance' in update_data:
        try:
            sync_wallet_object(updated_customer, business, program)
        except Exception:
            pass  # best-effort - a wallet push failing shouldn't block the edit itself
        sync_apple_wallet_pass(updated_customer)

    return updated_customer

@app.delete("/api/v1/business/{public_id}/customers/{customer_public_id}")
async def delete_customer(public_id: str, customer_public_id: str):
    """Owner removes a member from their loyalty program. No cascading FKs
    on these tables (same as admin_delete_business below), so related rows
    are cleared first, then the customer row itself."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    customer_id = customer.get('id')
    try:
        for table in ["stamp_events", "redemption_events", "coupons"]:
            supabase.table(table).delete().eq("customer_id", customer_id).execute()
        supabase.table("customers").delete().eq("id", customer_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

    return {"success": True, "deleted": customer_public_id}

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

@app.get("/api/v1/business/{public_id}/staff/stamp-counts")
async def get_staff_stamp_counts(public_id: str):
    """How many stamps each cashier/staff member has personally added -
    counted from stamp_events.staff_id, which is only populated for stamps
    added via a staff PIN (not owner scans, which log staff_id=None)."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        staff_res = supabase.table("staff").select("id,public_id,name,branch_id").eq("business_id", business.get("id")).execute()
        staff_rows = staff_res.data or []

        branches_res = supabase.table("branches").select("id,name").eq("business_id", business.get("id")).execute()
        branch_name_by_id = {b["id"]: b["name"] for b in (branches_res.data or [])}

        events_res = supabase.table("stamp_events").select("staff_id").eq("business_id", business.get("id")).execute()
        counts = {}
        for row in (events_res.data or []):
            sid = row.get("staff_id")
            if sid is None:
                continue
            counts[sid] = counts.get(sid, 0) + 1

        return [
            {
                "staff_public_id": s["public_id"],
                "name": s["name"],
                "branch_name": branch_name_by_id.get(s.get("branch_id")),
                "stamp_count": counts.get(s["id"], 0),
            }
            for s in staff_rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/branches/stamp-counts")
async def get_branch_stamp_counts(public_id: str):
    """Stamps and redemptions per branch, so an owner with multiple
    locations can see which one is actually driving activity - this is
    the per-location equivalent of the per-cashier counter above."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        branches_res = supabase.table("branches").select("id,public_id,name").eq("business_id", business.get("id")).execute()
        branch_rows = branches_res.data or []

        # Points-card businesses never write to stamp_events (add_stamp
        # rejects them - see the card_type guard there), so their activity
        # lives in points_events instead. Same activity_events swap as
        # get_analytics above, keeping the "stamp_count" field name so the
        # dashboard doesn't need a second shape to handle.
        program = safe_get_loyalty_program(business.get("id"))
        card_type = program.get('card_type', 'stamp') if program else 'stamp'
        activity_table = "points_events" if card_type == 'points' else "stamp_events"

        activity_events = supabase.table(activity_table).select("branch_id").eq("business_id", business.get("id")).execute().data or []
        redemption_events = supabase.table("redemption_events").select("branch_id").eq("business_id", business.get("id")).execute().data or []

        stamp_counts, redemption_counts = {}, {}
        for row in activity_events:
            bid = row.get("branch_id")
            if bid is not None:
                stamp_counts[bid] = stamp_counts.get(bid, 0) + 1
        for row in redemption_events:
            bid = row.get("branch_id")
            if bid is not None:
                redemption_counts[bid] = redemption_counts.get(bid, 0) + 1

        return [
            {
                "branch_public_id": b["public_id"],
                "name": b["name"],
                "card_type": card_type,
                "stamp_count": stamp_counts.get(b["id"], 0),
                "redemption_count": redemption_counts.get(b["id"], 0),
            }
            for b in branch_rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/branches")
async def list_branches(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("branches").select("*").eq("business_id", business.get("id")).order("created_at").execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/business/{public_id}/branches")
async def create_branch(public_id: str, branch: BranchCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    branch_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'name': branch.name,
        'address': branch.address,
        'is_active': True,
        'created_at': datetime.utcnow().isoformat(),
    }
    try:
        res = supabase.table("branches").insert(branch_data).execute()
        return res.data[0] if res.data else branch_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/v1/business/{public_id}/branches/{branch_public_id}")
async def update_branch(public_id: str, branch_public_id: str, update: BranchUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    branch = safe_get_branch(branch_public_id)
    if not branch or branch.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Branch not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return branch
    try:
        res = supabase.table("branches").update(update_data).eq("id", branch.get("id")).execute()
        return res.data[0] if res.data else {**branch, **update_data}
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

    if 'branch_public_id' in update_data:
        branch_public_id = update_data.pop('branch_public_id')
        if not branch_public_id:
            update_data['branch_id'] = None  # explicitly unassigned from any branch
        else:
            branch = safe_get_branch(branch_public_id)
            if not branch or branch.get('business_id') != business.get('id'):
                raise HTTPException(status_code=404, detail="Branch not found for this business")
            update_data['branch_id'] = branch.get('id')
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

@app.get("/api/v1/business/{public_id}/plan")
async def get_plan_info(public_id: str):
    """Plan name, feature flags/limits, and current usage against those
    limits - lets the owner dashboard show/hide Pro-only UI and display
    'X of Y announcements used this month' without duplicating the plan
    matrix on the frontend."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    plan = business.get('plan', 'starter')
    features = get_plan_features(plan)

    announcements_used = 0
    limit = get_effective_announcement_limit(business)
    if limit is not None:
        month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        try:
            count_res = (
                supabase.table("announcements")
                .select("id", count="exact")
                .eq("business_id", business.get("id"))
                .gte("created_at", month_start.isoformat())
                .execute()
            )
            announcements_used = count_res.count or 0
        except Exception:
            announcements_used = 0

    return {
        "plan": plan,
        "plan_label": SUBSCRIPTION_PLANS.get(plan, {}).get("label", plan),
        "features": features,
        "usage": {
            "announcements_used_this_month": announcements_used,
            "announcements_limit": limit,
        },
        "last_paid_at": business.get("last_paid_at"),
        "subscription_expires_at": business.get("subscription_expires_at"),
    }

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

    features = get_plan_features(business.get('plan'))
    if not features.get('analytics'):
        raise HTTPException(
            status_code=403,
            detail="Analytics is available on the Growth and Pro plans. Upgrade to unlock it."
        )

    try:
        customers = supabase.table("customers").select("*").eq("business_id", business_id).execute().data or []
        stamp_events = supabase.table("stamp_events").select("*").eq("business_id", business_id).execute().data or []
        redemption_events = supabase.table("redemption_events").select("*").eq("business_id", business_id).execute().data or []
        points_events = supabase.table("points_events").select("*").eq("business_id", business_id).execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    program = safe_get_loyalty_program(business_id)
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    # Points-card businesses never generate stamp_events (add_stamp rejects
    # them - see the card_type guard there), so all "activity" metrics below
    # - active members, trend charts, peak-activity heatmap, per-customer
    # averages - read from points_events instead of stamp_events when the
    # business is on a points card. Keeping the same downstream field names
    # (total_stamps, trends.stamps, etc.) so the dashboard keeps working
    # either way; card_type is included below for a frontend that wants to
    # relabel them ("points sales" vs "stamps").
    activity_events = points_events if card_type == 'points' else stamp_events

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

    stamps_period = _filter_between(activity_events, 'created_at', period_start, now)
    stamps_prev = _filter_between(activity_events, 'created_at', prev_start, prev_end)

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

    total_points_earned = sum(e.get('points_earned', 0) or 0 for e in stamps_period) if card_type == 'points' else None
    total_points_earned_prev = sum(e.get('points_earned', 0) or 0 for e in stamps_prev) if card_type == 'points' else None

    overview = {
        "card_type": card_type,
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
        "total_points_earned": total_points_earned,
        "points_change": _pct_change(total_points_earned, total_points_earned_prev) if card_type == 'points' else None,
    }

    trends = {
        "customers": _bucketed_series(customers, 'created_at', period_start, now),
        "stamps": _bucketed_series(activity_events, 'created_at', period_start, now),
        "rewards": _bucketed_series(redemption_events, 'created_at', period_start, now),
        "peak_hours": _day_of_week_series(activity_events, 'created_at', period_start, now),
    }

    top_sort_field = 'points_balance' if card_type == 'points' else 'stamp_count'
    top_customers = sorted(customers, key=lambda c: c.get(top_sort_field, 0), reverse=True)[:5]
    top_customers_out = [
        {"name": c.get("name") or "Customer", "stamps": c.get(top_sort_field, 0), "metric": top_sort_field}
        for c in top_customers if c.get(top_sort_field, 0) > 0
    ]

    returning = active_ids_period & active_ids_prev
    retention_rate = round((len(returning) / len(active_ids_prev)) * 100, 1) if active_ids_prev else 0

    thirty_days_ago = now - timedelta(days=30)
    if card_type == 'points':
        # "At risk" for a points card is a customer sitting on an unspent
        # balance who hasn't earned or redeemed anything in 30+ days -
        # stamp_count doesn't exist for these customers, so gate on
        # points_balance instead.
        churn_risk = sum(
            1 for c in customers
            if c.get('points_balance', 0) > 0
            and (_parse_ts(c.get('updated_at')) or _parse_ts(c.get('created_at')) or now) < thirty_days_ago
        )
    else:
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

    # Gender breakdown - all-time distribution across every customer on file,
    # not scoped to the selected date range (same treatment as top_customers
    # above). Anyone who signed up before this field existed, or chose not
    # to answer, falls under "rather_not_say" alongside people who picked it.
    gender_counts = {"male": 0, "female": 0, "rather_not_say": 0}
    for c in customers:
        g = (c.get('gender') or 'rather_not_say')
        if g not in gender_counts:
            g = 'rather_not_say'
        gender_counts[g] += 1
    demographics_block = {
        "gender": gender_counts,
    }

    # Proxy for "how many customers hit the goal": for stamp cards, that's
    # reward_unlocked (goal reached, not yet redeemed) plus redemptions this
    # period - there's no separate "goal reached" event logged, only stamp
    # and redemption events. For points cards there's no single goal, so the
    # closest equivalent is "can currently afford at least one prize" (using
    # the cheapest configured prize), plus redemptions this period.
    if card_type == 'points':
        prize_costs = [p.get('points_cost', 0) for p in (program.get('points_prizes') or [])]
        cheapest_prize_cost = min(prize_costs) if prize_costs else None
        currently_unlocked = (
            sum(1 for c in customers if c.get('points_balance', 0) >= cheapest_prize_cost)
            if cheapest_prize_cost is not None else 0
        )
    else:
        currently_unlocked = sum(1 for c in customers if c.get('reward_unlocked'))
    reached_goal_period = currently_unlocked + total_rewards

    stamps_block = {
        "completion_rate": round((reached_goal_period / active_members) * 100, 1) if active_members else 0,
    }
    rewards_block = {
        "redemption_rate": round((total_rewards / reached_goal_period) * 100, 1) if reached_goal_period else 0,
    }

    # Stamp cards still have no price/amount field anywhere in the schema
    # (stamps and stamp-goal redemptions don't capture a dollar value), so
    # revenue stays untracked for them rather than guessed at. Points cards
    # are different: every points_events row already stores the real sale
    # amount (amount_spent_pesos) via log_points_event, so revenue for those
    # businesses is genuinely trackable.
    if card_type == 'points':
        revenue_period = sum(e.get('amount_spent_pesos', 0) or 0 for e in stamps_period)
        revenue_prev = sum(e.get('amount_spent_pesos', 0) or 0 for e in stamps_prev)
        transaction_count = len(stamps_period)
        revenue = {
            "tracked": True,
            "stamp_revenue": round(revenue_period, 2),
            "revenue_change": _pct_change(revenue_period, revenue_prev),
            "reward_cost": None,
            "net_value": None,
            "avg_transaction": round(revenue_period / transaction_count, 2) if transaction_count else 0,
        }
    else:
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
        "demographics": demographics_block,
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
            "card_type": "stamp",
            "stamp_goal": 8,
            "reward_name": "Free Service",
            "primary_color": "#3b82f6",
            "reward_expiry_days": 30,
            "program_logo_url": None,
            "hero_image_url": None,
            "card_name": None,
            "description": None,
            "google_wallet_class_id": None,
            "points_per_amount": 10,
            "points_amount_pesos": 100,
            "points_prizes": [],
        }
    return program

@app.post("/api/v1/business/{public_id}/loyalty-config")
async def save_loyalty_config(public_id: str, config: LoyaltyConfig):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    data = {
        'business_id': business.get('id'),
        'card_type': config.card_type,
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
    if config.description is not None:
        data['description'] = config.description
    if config.card_type == 'points':
        data['points_per_amount'] = config.points_per_amount
        data['points_amount_pesos'] = config.points_amount_pesos
        # Backfill an id for any prize the owner added client-side without one,
        # so it can be referenced (e.g. from the cashier redemption flow) later.
        prizes = []
        for p in (config.points_prizes or []):
            prizes.append({
                'id': p.id or uuid.uuid4().hex[:12],
                'name': p.name,
                'points_cost': p.points_cost,
                'description': p.description,
            })
        data['points_prizes'] = prizes
    if config.google_review_url is not None:
        features = get_plan_features(business.get('plan'))
        if not features.get('google_review_prompt'):
            raise HTTPException(
                status_code=403,
                detail="The Google review prompt is available on the Growth and Pro plans. Upgrade to set a review link."
            )
        data['google_review_url'] = config.google_review_url

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

    limit = get_effective_announcement_limit(business)
    if limit is not None:
        month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        try:
            count_res = (
                supabase.table("announcements")
                .select("id", count="exact")
                .eq("business_id", business.get("id"))
                .gte("created_at", month_start.isoformat())
                .execute()
            )
            used = count_res.count or 0
        except Exception as e:
            raise HTTPException(status_code=500, detail=friendly_db_error(e))
        if used >= limit:
            plan_label = SUBSCRIPTION_PLANS.get(business.get('plan', 'starter'), {}).get('label', 'your plan')
            raise HTTPException(
                status_code=403,
                detail=f"You've used all {limit} announcements included in {plan_label} this month. Upgrade your plan for more."
            )

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

        # Apple Wallet has its own, separate push channel (APNs, not
        # Google's class-message API) - fire it too so iPhone customers
        # who added the card via Safari's "Add to Apple Wallet" also get
        # notified. Independent of the Google push above: this still runs
        # even if Google Wallet isn't configured for this business, and a
        # failure here never affects the response or push_error above -
        # same "never blocks the caller" contract as sync_apple_wallet_pass.
        try:
            push_apple_wallet_announcement(business.get('id'))
        except Exception as e:
            print(f"APPLE WALLET announcement push error: {e}")

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

    # Apple Wallet has its own, separate push channel (APNs, not Google's
    # class-message API), so it's fired here unconditionally rather than
    # gated behind the Google Wallet class_id check below - an iPhone
    # customer who added the card via Safari should still get notified
    # even for a business that hasn't set up Google Wallet at all. Same
    # "never blocks the caller" contract as sync_apple_wallet_pass; any
    # failure here must not affect the Google push or the response below.
    try:
        push_apple_wallet_announcement(business.get('id'))
    except Exception as e:
        print(f"APPLE WALLET announcement push error: {e}")

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

    branch_id = None
    if invite.branch_public_id:
        branch = safe_get_branch(invite.branch_public_id)
        if not branch or branch.get('business_id') != business.get('id'):
            raise HTTPException(status_code=404, detail="Branch not found for this business")
        branch_id = branch.get('id')

    staff_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'name': invite.name,
        'email': invite.email,
        'phone': invite.phone,
        'role': invite.role,
        'branch_id': branch_id,
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

    status = (business.get('status') or 'PENDING').upper()
    if status == 'ACTIVE':
        return {"message": "Business is already live!", "status": status}

    # Status is now controlled by admin approval (see /api/v1/admin/businesses)
    # so a business can no longer flip itself to ACTIVE here - that would
    # bypass admin review entirely. This just reports where things stand.
    if status == 'PENDING':
        raise HTTPException(
            status_code=403,
            detail="Your business is still pending admin approval. We'll notify you as soon as it's reviewed."
        )
    raise HTTPException(status_code=403, detail="Your account is not active. Please contact support.")

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
async def add_stamp(public_id: str, req: StampRequest, authorization: str = Header(default="")):
    print(f"STAMP REQUEST: business={public_id}, customer={req.customer_public_id}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    stamping_staff_id = None
    stamping_branch_id = None

    # Preferred path: a session token from /staff/verify-pin. Raises its own
    # HTTPException on a bad/expired/mismatched token; returns None only
    # when no token was sent at all, so we fall through to the legacy path.
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        stamping_staff_id = session_claims.get('staff_id')  # None for the owner
    elif req.as_owner:
        # Owner is scanning from their own dashboard, where they've already
        # authenticated with their business email/password - no separate
        # cashier PIN to check.
        pass
    else:
        # Legacy fallback for clients that haven't switched to session
        # tokens yet - re-checks the raw PIN on every single request.
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            stamping_staff_id = staff_res.data[0].get('id')
            stamping_branch_id = staff_res.data[0].get('branch_id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    program = safe_get_loyalty_program(business.get('id'))
    if program and program.get('card_type') == 'points':
        raise HTTPException(status_code=400, detail="This business is on a points card - use /points-sale instead")
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
        sync_wallet_object(
            customer, business, program,
            notify_header="Reward unlocked! 🎉" if reward_unlocked else "Stamp added ⭐",
            notify_body=("You've unlocked your reward!" if reward_unlocked
                         else f"{new_count}/{goal} stamps - keep it up!"),
            notify_message_id=f"stamp-{customer.get('id')}-{new_count}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
        log_stamp_event(business.get('id'), customer.get('id'), stamping_staff_id, stamping_branch_id)
    except Exception as e:
        error_msg = str(e)
        if 'reward_unlocked' in error_msg.lower():
            try:
                supabase.table("customers").update({
                    'stamp_count': new_count,
                    'updated_at': datetime.utcnow().isoformat(),
                }).eq("id", customer.get("id")).execute()
                log_stamp_event(business.get('id'), customer.get('id'), stamping_staff_id, stamping_branch_id)
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

@app.post("/api/v1/business/{public_id}/points-sale")
async def add_points_sale(public_id: str, req: PointsSaleRequest, authorization: str = Header(default="")):
    """Points-card equivalent of add_stamp: converts a purchase amount into
    points using the program's points_per_amount/points_amount_pesos rate
    and credits the customer's points_balance, then pushes the update to
    any Google/Apple Wallet pass the customer already saved - same pattern
    add_stamp() uses, now that build_loyalty_object()/build_apple_pass_json()
    are points-aware."""
    print(f"POINTS SALE REQUEST: business={public_id}, customer={req.customer_public_id}, amount={req.amount_spent}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'points':
        raise HTTPException(status_code=400, detail="This business is not on a points card - use /stamp instead")

    sale_staff_id = None
    sale_branch_id = None

    # Same auth pattern as add_stamp: session token from /staff/verify-pin
    # preferred, owner-mode next, raw PIN as legacy fallback.
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        sale_staff_id = session_claims.get('staff_id')  # None for the owner
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            sale_staff_id = staff_res.data[0].get('id')
            sale_branch_id = staff_res.data[0].get('branch_id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    points_per_amount = program.get('points_per_amount') or 0
    points_amount_pesos = program.get('points_amount_pesos') or 1
    points_earned = int((req.amount_spent / points_amount_pesos) * points_per_amount)
    if points_earned < 0:
        points_earned = 0

    new_balance = customer.get('points_balance', 0) + points_earned

    try:
        update_data = {
            'points_balance': new_balance,
            'updated_at': datetime.utcnow().isoformat(),
        }
        supabase.table("customers").update(update_data).eq("id", customer.get("id")).execute()
        customer['points_balance'] = new_balance
        sync_wallet_object(
            customer, business, program,
            notify_header="Points added ⭐",
            notify_body=f"You now have {new_balance} points!",
            notify_message_id=f"points-{customer.get('id')}-{new_balance}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
        log_points_event(business.get('id'), customer.get('id'), req.amount_spent, points_earned, sale_staff_id, sale_branch_id)
    except Exception as e:
        error_msg = str(e)
        is_schema_mismatch = (
            'PGRST204' in error_msg
            or ('column' in error_msg.lower() and 'does not exist' in error_msg.lower())
            or ('could not find' in error_msg.lower() and 'column' in error_msg.lower())
        )
        if is_schema_mismatch:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Database schema mismatch: {error_msg}. Add a 'points_balance' integer "
                    f"column (default 0) to 'customers' in Supabase and run "
                    f"NOTIFY pgrst, 'reload schema'; before retrying."
                ),
            )
        raise HTTPException(status_code=500, detail=error_msg)

    return {
        "message": f"{points_earned} points added!",
        "amount_spent": req.amount_spent,
        "points_earned": points_earned,
        "points_balance": new_balance,
    }

@app.post("/api/v1/business/{public_id}/points-redeem")
async def redeem_points_prize(public_id: str, req: PointsRedeemRequest, authorization: str = Header(default="")):
    """Points-card equivalent of /reward/redeem: deducts a prize's
    points_cost from the customer's points_balance instead of resetting a
    stamp count. Same staff-session / owner / legacy-PIN auth pattern as
    every other cashier-facing action."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'points':
        raise HTTPException(status_code=400, detail="This business is not on a points card")

    prize = next((p for p in (program.get('points_prizes') or []) if p.get('id') == req.prize_id), None)
    if not prize:
        raise HTTPException(status_code=404, detail="Prize not found - it may have been removed or changed")

    prize_cost = prize.get('points_cost', 0)
    current_balance = customer.get('points_balance', 0)
    if current_balance < prize_cost:
        raise HTTPException(status_code=400, detail=f"Not enough points - needs {prize_cost}, has {current_balance}")

    redeeming_staff_id = None
    redeeming_branch_id = None

    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        redeeming_staff_id = session_claims.get('staff_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            redeeming_staff_id = staff_res.data[0].get('id')
            redeeming_branch_id = staff_res.data[0].get('branch_id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    try:
        new_balance = current_balance - prize_cost
        supabase.table("customers").update({
            'points_balance': new_balance,
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", customer.get("id")).execute()
        customer['points_balance'] = new_balance
        sync_wallet_object(
            customer, business, program,
            notify_header="Prize redeemed 🎁",
            notify_body=f"{prize.get('name', 'Prize')} redeemed - you now have {new_balance} points.",
            notify_message_id=f"points-redeem-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
        log_redemption_event(
            business.get('id'), customer.get('id'), redeeming_staff_id, redeeming_branch_id,
            prize_name=prize.get('name'), points_spent=prize_cost,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "message": f"{prize.get('name', 'Prize')} redeemed!",
        "success": True,
        "prize_name": prize.get('name'),
        "points_spent": prize_cost,
        "points_balance": new_balance,
    }

@app.post("/api/v1/business/{public_id}/staff/verify-pin")
async def verify_staff_pin(public_id: str, req: PinVerify):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    email = req.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    try:
        res = supabase.table("staff").select("*").eq("business_id", business.get("id")).ilike("email", email).eq("pin", req.pin).execute()
        if not res.data:
            raise HTTPException(status_code=403, detail="Invalid email or PIN")
        staff = res.data[0]
        if not staff.get('is_active', True):
            raise HTTPException(status_code=403, detail="This staff account is inactive")

        response = {
            "success": True,
            "name": staff.get("name", ""),
            "role": staff.get("role", "cashier"),
        }
        # Issue a session token so the PIN doesn't need to be re-sent on
        # every scan for the rest of the shift. Only added if the server
        # has STAFF_SESSION_SECRET configured - if not, the frontend keeps
        # working exactly as before (resending the raw PIN each time).
        if STAFF_SESSION_SECRET:
            response["session_token"] = create_staff_session_token(
                public_id, staff.get('id'), staff.get('role', 'cashier'), staff.get('name', '')
            )
            response["expires_in_hours"] = STAFF_SESSION_TTL_HOURS
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/business/{public_id}/reward/redeem")
async def redeem_reward(public_id: str, req: RedeemRequest, authorization: str = Header(default="")):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    redeeming_staff_id = None
    redeeming_branch_id = None

    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        redeeming_staff_id = session_claims.get('staff_id')
    elif req.as_owner:
        pass
    else:
        # Legacy fallback for clients that haven't switched to session
        # tokens yet - re-checks the raw PIN on every single request.
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            redeeming_staff_id = staff_res.data[0].get('id')
            redeeming_branch_id = staff_res.data[0].get('branch_id')
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
        sync_wallet_object(
            customer, business, program,
            notify_header="Reward redeemed ✅",
            notify_body="Your reward has been redeemed - your card is reset and ready for more stamps.",
            notify_message_id=f"redeem-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
        log_redemption_event(business.get('id'), customer.get('id'), redeeming_staff_id, redeeming_branch_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    review_url = None
    features = get_plan_features(business.get('plan'))
    if features.get('google_review_prompt') and program:
        review_url = program.get('google_review_url')

    return {"message": "Reward redeemed!", "success": True, "google_review_url": review_url}

# ONE-TIME COUPONS
# Owner-issued, per-customer, free-text coupons - separate from the
# stamp-goal reward above. Only one can be active per customer at a time
# (enforced on create); redeeming or cancelling frees up a slot for a new
# one. Reuses the same staff-session / owner / legacy-PIN auth pattern as
# /stamp and /reward/redeem above.

@app.post("/api/v1/business/{public_id}/customers/{customer_public_id}/coupons")
async def create_coupon(public_id: str, customer_public_id: str, req: CouponCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    reward_text = (req.reward_text or '').strip()
    if not reward_text:
        raise HTTPException(status_code=400, detail="Coupon description is required")
    if len(reward_text) > 200:
        raise HTTPException(status_code=400, detail="Keep the coupon description under 200 characters")

    if safe_get_active_coupon(customer.get('id')):
        raise HTTPException(status_code=400, detail="This customer already has an active coupon - it must be redeemed or cancelled first")

    expires_at = None
    if req.expires_at:
        try:
            expires_at = datetime.fromisoformat(req.expires_at).date().isoformat()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid expiry date")

    coupon = {
        'public_id': generate_public_id(),
        'business_id': business.get('id'),
        'customer_id': customer.get('id'),
        'reward_text': reward_text,
        'status': 'active',
        'expires_at': expires_at,
        'created_at': datetime.utcnow().isoformat(),
    }
    try:
        res = supabase.table("coupons").insert(coupon).execute()
        created = res.data[0] if res.data else coupon
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    return created

@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/coupons")
async def list_customer_coupons(public_id: str, customer_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        res = (
            supabase.table("coupons")
            .select("*")
            .eq("customer_id", customer.get('id'))
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/business/{public_id}/coupons/{coupon_public_id}")
async def cancel_coupon(public_id: str, coupon_public_id: str):
    """Lets the owner cancel a coupon they just issued by mistake, freeing
    the customer up for a new one. Only works while it's still active -
    a redeemed or already-cancelled/expired coupon can't be touched."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        res = supabase.table("coupons").select("*").eq("public_id", coupon_public_id).maybe_single().execute()
        coupon = res.data
    except Exception:
        coupon = None
    if not coupon or coupon.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Coupon not found")
    if coupon.get('status') != 'active':
        raise HTTPException(status_code=400, detail="Only an active coupon can be cancelled")

    try:
        supabase.table("coupons").update({
            'status': 'cancelled',
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", coupon.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    return {"message": "Coupon cancelled"}

@app.post("/api/v1/business/{public_id}/coupon/redeem")
async def redeem_coupon(public_id: str, req: CouponRedeem, authorization: str = Header(default="")):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    redeeming_staff_id = None
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        redeeming_staff_id = session_claims.get('staff_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            redeeming_staff_id = staff_res.data[0].get('id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    coupon = safe_get_active_coupon(customer.get('id'))
    if not coupon:
        raise HTTPException(status_code=400, detail="No active coupon to redeem")

    try:
        supabase.table("coupons").update({
            'status': 'redeemed',
            'redeemed_at': datetime.utcnow().isoformat(),
            'redeemed_by_staff_id': redeeming_staff_id,
        }).eq("id", coupon.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    return {"message": "Coupon redeemed!", "success": True, "reward_text": coupon.get('reward_text')}

@app.get("/api/v1/business/{public_id}/hero-image.png")
async def get_hero_image(public_id: str, c: Optional[str] = None):
    """Serves the generated gradient hero image that build_loyalty_class()
    points heroImage at when a business hasn't uploaded their own hero photo.
    `c` is just the cache-busting color key from the URL - the color itself
    always comes fresh from the business's saved program, so this can't be
    used to render an arbitrary color."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'

    png_bytes = generate_hero_image_bytes(primary_color)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )

@app.get("/api/v1/customer/{customer_public_id}/hero-image.png")
async def get_customer_hero_image(customer_public_id: str, s: Optional[str] = None, g: Optional[str] = None, c: Optional[str] = None):
    """Serves the personalized hero image build_loyalty_object() points a
    customer's object-level heroImage at - the gradient plus their live
    reward name, stamp progress, and short description burned in. s/g/c
    are just cache-busting values read off the URL Google requested; the
    real numbers are always re-read fresh from the DB below, so a stale or
    tampered query string can't show a wrong stamp count - it can only
    cause an unnecessary (harmless) regeneration."""
    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    description = program.get('description') if program else None
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    stamps = customer.get('stamp_count', 0)
    points_balance = customer.get('points_balance', 0)

    png_bytes = generate_personalized_hero_image_bytes(
        primary_color, reward_name, stamps, stamp_goal, description,
        card_type=card_type, points_balance=points_balance,
    )
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )

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
        description = program.get('description') if program else None
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
            '.program-description{color:#64748b;font-size:13px;line-height:1.6;margin-bottom:24px;text-align:center}'
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
            '.apple-btn{background:#000000}'
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
            + ('<p class="program-description">' + html_lib.escape(description) + '</p>' if description else '') +
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
            '<select id="gender">'
            '<option value="">Gender (optional)</option>'
            '<option value="male">Male</option>'
            '<option value="female">Female</option>'
            '<option value="rather_not_say">Rather not say</option>'
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
            'const gender=document.getElementById("gender").value;'
            'try{'
            'const res=await fetch(API_BASE+"/api/v1/join/"+BIZ_ID,{'
            'method:"POST",'
            'headers:{"Content-Type":"application/json"},'
            'body:JSON.stringify({name:name,address:address||null,age:age?parseInt(age,10):null,phone:phone,email:email||null,birthday:birthday||null,occupation:occupation||null,gender:gender||null})'
            '});'
            'const data=await res.json();'
            'if(res.ok){'
            'const walletUrl=API_BASE+"/wallet/"+data.public_id;'
            'const qrUrl="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data="+encodeURIComponent(API_BASE+"/stamp/"+data.public_id);'
            'var cardHtml='
            '"<div style=\'font-size:48px;margin-bottom:16px;\'>&#127881;</div>"+'
            '"<h1>Welcome, "+escapeHtml(data.name)+"!</h1>"+'
            '"<p style=\'color:#64748b;margin-bottom:24px;\'>Your "+escapeHtml(CARD_NAME)+" is ready</p>"+'
            '"<div class=\'success-qr\'><img src=\'"+qrUrl+"\' alt=\'Your QR Code\'/>"+'
            '"<p style=\'font-size:12px;color:#94a3b8;margin-top:8px;\'>Scan at checkout</p></div>"+'
            '"<div class=\'member-id\'><p>Your Member ID</p>"+'
            '"<code>"+escapeHtml(data.public_id)+"</code></div>"+'
            '"<a href=\'"+API_BASE+"/api/v1/customer/"+escapeHtml(data.public_id)+"/apple-wallet-pass\' class=\'wallet-btn apple-btn\'>&#63743; Add to Apple Wallet</a>"+'
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

    dup_field = find_customer_duplicate(business.get('id'), signup.phone, signup.email)
    if dup_field:
        raise HTTPException(
            status_code=400,
            detail=f"This {dup_field} is already enrolled in this rewards program."
        )

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
        'gender': signup.gender,
        'last_order_date': signup.last_order_date,
        'stamp_count': 0,
        'points_balance': 0,
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
    }

    try:
        supabase.table("customers").insert(customer_data).execute()
    except Exception as e:
        error_msg = str(e)
        print(f"CUSTOMER INSERT ERROR: {error_msg}")
        is_schema_mismatch = (
            'PGRST204' in error_msg
            or ('column' in error_msg.lower() and 'does not exist' in error_msg.lower())
            or ('could not find' in error_msg.lower() and 'column' in error_msg.lower())
        )
        if is_schema_mismatch:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Database schema mismatch: {error_msg}. One or more columns sent by the "
                    f"app (e.g. address, age, birthday, occupation, gender, last_order_date) are "
                    f"missing from the 'customers' table in Supabase, or the PostgREST schema "
                    f"cache is stale. Add the missing column(s) and run "
                    f"NOTIFY pgrst, 'reload schema'; (or use 'Reload schema' in the Supabase "
                    f"dashboard) before retrying."
                ),
            )
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
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    points_balance = customer.get('points_balance', 0)
    points_prizes = (program.get('points_prizes') or []) if program else []
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

    # Points-card progress block - shown instead of the star grid below when
    # this business is running a points card. Lists the prize catalog
    # (points_prizes, set from LoyaltyCardCustomizer.jsx) so the customer
    # can see what their balance can be redeemed for, same info the cashier
    # sees when processing a points sale.
    prizes_html = ''
    for prize in points_prizes:
        prize_name = html_lib.escape(str(prize.get('name', '')))
        prize_cost = prize.get('points_cost', 0)
        affordable = points_balance >= prize_cost
        prizes_html += (
            '<div style="display:flex;justify-content:space-between;align-items:center;'
            'padding:8px 0;' + ('' if affordable else 'opacity:0.5;') + '">'
            '<span style="font-size:13px;color:white;">' + prize_name + '</span>'
            '<span style="font-size:12px;font-weight:700;color:white;">' + str(prize_cost) + ' pts</span>'
            '</div>'
        )
    points_html = (
        '<div style="text-align:center;margin:16px 0;">'
        '<div style="font-size:40px;font-weight:800;color:white;">' + str(points_balance) + '</div>'
        '<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:2px;">points</div>'
        '</div>'
        + ('<div style="border-top:1px solid rgba(255,255,255,0.25);padding-top:8px;">' + prizes_html + '</div>' if prizes_html else '')
    )

    logo_html = ''
    if logo_url:
        logo_html = '<img src="' + logo_url + '" style="width:64px;height:64px;border-radius:16px;object-fit:cover;margin-bottom:12px;" alt="Logo"/>'

    reward_badge = ''
    if customer.get('reward_unlocked'):
        reward_badge = '<span style="display:inline-block;padding:6px 14px;background:#fef3c7;color:#92400e;border-radius:20px;font-size:13px;font-weight:600;margin-top:12px;">&#127873; ' + reward_name + ' Ready!</span>'

    coupon_html = ''
    active_coupon = safe_get_active_coupon(customer.get('id'))
    if active_coupon:
        coupon_html = (
            '<div style="background:#f0fdfa;border:1.5px dashed #0d9488;border-radius:12px;'
            'padding:14px 16px;margin-bottom:16px;text-align:center;">'
            '<div style="font-size:11px;font-weight:700;color:#0f766e;text-transform:uppercase;'
            'letter-spacing:0.5px;margin-bottom:4px;">&#127903; Coupon Available</div>'
            '<div style="font-size:15px;font-weight:600;color:#0f172a;">' + html_lib.escape(active_coupon.get('reward_text', '')) + '</div>'
            '<div style="font-size:12px;color:#64748b;margin-top:6px;">Show this card to your cashier to redeem</div>'
            '</div>'
        )

    display_name_json = json.dumps(display_name)
    biz_name_json = json.dumps(business.get('name', ''))

    # Google's save link needs a signed JWT describing the pass, not the
    # customer's raw public_id - build_loyalty_object()/create_google_wallet_jwt()
    # are the same helpers get_wallet_pass() (the JSON API WalletPass.jsx
    # calls) already uses for this. Falls back to omitting the button
    # entirely if Google Wallet isn't configured (missing JWT), rather than
    # linking to a save URL that will 404.
    loyalty_object = build_loyalty_object(customer, business, program)
    google_jwt = create_google_wallet_jwt(loyalty_object)
    google_wallet_html = ''
    if google_jwt:
        google_wallet_html = (
            '<a href="https://pay.google.com/gp/v/save/' + google_jwt + '" class="wallet-btn google-btn">'
            '&#127903; Add to Google Wallet'
            '</a>'
        )

    # Same .pkpass download link as WalletPass.jsx/CustomerJoin.jsx use -
    # Safari on iOS/macOS recognizes the content type and shows the native
    # "Add to Apple Wallet" sheet; other browsers just download the file.
    apple_wallet_html = (
        '<a href="' + BASE_URL + '/api/v1/customer/' + customer.get("public_id", "") + '/apple-wallet-pass" class="wallet-btn apple-btn">'
        '&#63743; Add to Apple Wallet'
        '</a>'
    )

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
        '.apple-btn{background:#000000}'
        '.share-btn{width:100%;padding:14px;background:#f0fdf4;color:#0d9488;'
        'border:1px solid #a7f3d0;border-radius:10px;font-weight:600;cursor:pointer}'
        '</style></head><body>'
        '<div class="card">'
        '<div class="loyalty-card">'
        + logo_html +
        '<h2>' + display_name + '</h2>'
        '<h3>' + customer.get("name", "") + '</h3>'
        '<p class="id">ID: ' + customer.get("public_id", "")[:12] + '...</p>'
        + (
            points_html if card_type == 'points' else
            '<div class="stars">' + stars_html + '</div>'
            '<p class="stamp-count">' + str(stamps) + ' / ' + str(stamp_goal) + ' stamps</p>'
        )
        + reward_badge +
        '</div>'
        + coupon_html +
        '<div class="qr-section">'
        '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + quote(f'{BASE_URL}/stamp/{customer.get("public_id", "")}', safe="") + '" alt="Your QR Code"/>'
        '<p>Scan at checkout to earn ' + ('points' if card_type == 'points' else 'stamps') + '</p>'
        '</div>'
        + apple_wallet_html
        + google_wallet_html +
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

# CASHIER STAMP PAGE - opened when a cashier scans a customer's QR with
# their phone's native Camera app (rather than the in-app scanner in
# CashierApp.jsx). Handles cashier login itself: first scan of a shift
# asks for the staff PIN, trades it for a session token, and remembers
# that token in localStorage (keyed per business) so later scans on the
# same phone skip straight to the Add Stamp button.
@app.get("/stamp/{customer_public_id}", response_class=HTMLResponse)
async def cashier_stamp_page(customer_public_id: str):
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

    active_coupon = safe_get_active_coupon(customer.get('id'))

    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    points_prizes = program.get('points_prizes', []) if program else []

    data = {
        'customer_public_id': customer.get('public_id', ''),
        'customer_name': customer.get('name', 'Member'),
        'business_public_id': business.get('public_id', ''),
        'business_name': business.get('name', ''),
        'card_type': card_type,
        'stamp_count': customer.get('stamp_count', 0),
        'stamp_goal': stamp_goal,
        'reward_name': reward_name,
        'reward_unlocked': bool(customer.get('reward_unlocked')),
        'points_balance': customer.get('points_balance', 0),
        'points_prizes': points_prizes if isinstance(points_prizes, list) else [],
        'coupon_text': active_coupon.get('reward_text') if active_coupon else None,
    }
    data_json = json.dumps(data)

    head = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>' + ('Add Points' if card_type == 'points' else 'Add Stamp') + ' - ' + html_lib.escape(business.get('name', '')) + '</title>'
        '<style>'
        '*{box-sizing:border-box;margin:0;padding:0}'
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        'background:linear-gradient(135deg,' + primary_color + ' 0%,#1e293b 100%);'
        'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
        '.card{background:white;border-radius:24px;padding:32px;max-width:400px;width:100%;'
        'box-shadow:0 20px 60px rgba(0,0,0,0.3)}'
        'h1{font-size:20px;color:#0f172a;margin-bottom:4px;text-align:center}'
        '.sub{font-size:13px;color:#94a3b8;text-align:center;margin-bottom:20px}'
        'input{width:100%;padding:14px;margin-bottom:12px;border:2px solid #e2e8f0;'
        'border-radius:10px;font-size:16px;box-sizing:border-box}'
        'button{width:100%;padding:14px;border:none;border-radius:10px;font-size:15px;'
        'font-weight:700;cursor:pointer;color:white;margin-bottom:10px}'
        'button:disabled{opacity:0.6;cursor:default}'
        '.btn-primary{background:' + primary_color + '}'
        '.btn-reward{background:#f59e0b}'
        '.btn-coupon{background:#0d9488}'
        '.btn-secondary{background:#f1f5f9;color:#475569;font-weight:600}'
        '.customer-box{background:#f8fafc;border-radius:14px;padding:18px;margin-bottom:16px;text-align:center}'
        '.customer-box .name{font-size:18px;font-weight:700;color:#0f172a}'
        '.customer-box .stamps{font-size:14px;color:#64748b;margin-top:4px}'
        '.reward{background:#fef3c7;color:#92400e;border-radius:10px;padding:10px;'
        'text-align:center;font-weight:700;font-size:14px;margin-bottom:14px}'
        '.coupon{background:#f0fdfa;border:1.5px dashed #0d9488;color:#0f766e;border-radius:10px;padding:10px;'
        'text-align:center;font-weight:700;font-size:14px;margin-bottom:14px}'
        '.msg{margin-bottom:14px;padding:12px;border-radius:10px;font-size:14px;text-align:center}'
        '.msg-ok{background:#dcfce7;color:#166534}'
        '.msg-err{background:#fee2e2;color:#991b1b}'
        '.hint{font-size:12px;color:#94a3b8;text-align:center;margin-top:8px}'
        '</style></head><body>'
        '<div class="card" id="app"></div>'
    )

    script = (
        '<script>'
        # cachedPin below is the fallback used when no session token is issued
        # (STAFF_SESSION_SECRET not set) - kept only in memory, never persisted
        'const DATA=' + data_json + ';'
        'const cardType=DATA.card_type;'
        'let stampCount=DATA.stamp_count;'
        'let rewardUnlocked=DATA.reward_unlocked;'
        'let pointsBalance=DATA.points_balance;'
        'const pointsPrizes=DATA.points_prizes||[];'
        'let couponText=DATA.coupon_text;'
        'let cachedPin=null;'
        'const app=document.getElementById("app");'
        'const sessionKey="loyaltree_cashier_"+DATA.business_public_id;'

        'function escapeHtml(t){const d=document.createElement("div");d.textContent=t;return d.innerHTML;}'

        'function getSession(){'
        'try{'
        'const raw=localStorage.getItem(sessionKey);'
        'if(!raw)return null;'
        'const s=JSON.parse(raw);'
        'if(!s.token||!s.expires_at||Date.now()>s.expires_at)return null;'
        'return s;'
        '}catch(e){return null;}'
        '}'

        'function saveSession(token,name,expiresInHours){'
        'localStorage.setItem(sessionKey,JSON.stringify({'
        'token:token,name:name,expires_at:Date.now()+(expiresInHours||12)*3600*1000'
        '}));'
        '}'

        'function clearSession(){localStorage.removeItem(sessionKey);cachedPin=null;}'

        'function authHeaders(){'
        'const s=getSession();'
        'const h={"Content-Type":"application/json"};'
        'if(s&&s.token)h["Authorization"]="Bearer "+s.token;'
        'return h;'
        '}'

        'function renderLogin(msg){'
        'app.innerHTML='
        '"<h1>Cashier Login</h1>"+'
        '"<p class=\'sub\'>"+escapeHtml(DATA.business_name)+"</p>"+'
        '(msg?"<div class=\'msg msg-err\'>"+escapeHtml(msg)+"</div>":"")+'
        '"<input id=\'email\' type=\'email\' inputmode=\'email\' placeholder=\'Your Email\' autocomplete=\'username\'>"+'
        '"<input id=\'pin\' type=\'password\' inputmode=\'numeric\' placeholder=\'Staff PIN\' autocomplete=\'current-password\'>"+'
        '"<button class=\'btn-primary\' id=\'loginBtn\'>Log In</button>"+'
        '"<p class=\'hint\'>Stays signed in on this phone for your shift.</p>";'
        'document.getElementById("loginBtn").addEventListener("click",doLogin);'
        'document.getElementById("pin").addEventListener("keydown",function(e){if(e.key==="Enter")doLogin();});'
        'document.getElementById("email").focus();'
        '}'

        'async function doLogin(){'
        'const emailEl=document.getElementById("email");'
        'const pinEl=document.getElementById("pin");'
        'const email=emailEl.value.trim();'
        'const pin=pinEl.value.trim();'
        'if(!email||!pin){renderLogin("Enter your email and PIN");return;}'
        'const btn=document.getElementById("loginBtn");'
        'btn.disabled=true;btn.textContent="Checking...";'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/staff/verify-pin",{'
        'method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email,pin:pin})'
        '});'
        'const d=await res.json();'
        'if(res.ok&&d.success){'
        'if(d.session_token){saveSession(d.session_token,d.name,d.expires_in_hours);cachedPin=null;}'
        'else{cachedPin=pin;}'
        'renderCard(d.name,null);'
        '}else{'
        'renderLogin(d.detail||"Invalid PIN");'
        '}'
        '}catch(e){'
        'renderLogin("Network error - try again");'
        '}'
        '}'

        'function renderStampBody(){'
        'const rewardHtml=rewardUnlocked?"<div class=\'reward\'>&#127873; "+escapeHtml(DATA.reward_name)+" unlocked!</div>":"";'
        'return rewardHtml+'
        '"<button class=\'btn-primary\' id=\'stampBtn\'>Add Stamp</button>"+'
        '(rewardUnlocked?"<button class=\'btn-reward\' id=\'redeemBtn\'>Redeem Reward</button>":"");'
        '}'

        'function renderPointsBody(){'
        'let prizeHtml="";'
        'for(let i=0;i<pointsPrizes.length;i++){'
        'const p=pointsPrizes[i];'
        'const affordable=pointsBalance>=p.points_cost;'
        'prizeHtml+="<div style=\'display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:8px;opacity:"+(affordable?"1":"0.5")+"\'>"+'
        '"<div><div style=\'font-weight:600;font-size:14px;color:#0f172a\'>"+escapeHtml(p.name)+"</div><div style=\'font-size:12px;color:#64748b\'>"+p.points_cost+" pts</div></div>"+'
        '"<button data-prize-id=\'"+escapeHtml(String(p.id))+"\' class=\'prizeRedeemBtn\' style=\'padding:8px 14px;border-radius:8px;border:none;background:"+(affordable?"#f59e0b":"#cbd5e1")+";color:white;font-size:13px;font-weight:700;cursor:"+(affordable?"pointer":"not-allowed")+"\' "+(affordable?"":"disabled")+">Redeem</button>"+'
        '"</div>";'
        '}'
        'return "<input id=\'saleAmount\' type=\'number\' inputmode=\'decimal\' min=\'0\' placeholder=\'Amount spent\'>"+'
        '"<button class=\'btn-primary\' id=\'pointsBtn\'>Add Points</button>"+'
        'prizeHtml;'
        '}'

        'function attachBodyListeners(){'
        'if(cardType==="points"){'
        'const pointsBtn=document.getElementById("pointsBtn");'
        'if(pointsBtn)pointsBtn.addEventListener("click",doPoints);'
        'const prizeBtns=document.querySelectorAll(".prizeRedeemBtn");'
        'for(let i=0;i<prizeBtns.length;i++){'
        'prizeBtns[i].addEventListener("click",function(e){doRedeemPrize(e.currentTarget.getAttribute("data-prize-id"));});'
        '}'
        '}else{'
        'const stampBtn=document.getElementById("stampBtn");'
        'if(stampBtn)stampBtn.addEventListener("click",doStamp);'
        'const redeemBtn=document.getElementById("redeemBtn");'
        'if(redeemBtn)redeemBtn.addEventListener("click",doRedeem);'
        '}'
        '}'

        'function renderCard(staffName,msg){'
        'const bodyHtml=cardType==="points"?renderPointsBody():renderStampBody();'
        'const couponHtml=couponText?"<div class=\'coupon\'>&#127903; "+escapeHtml(couponText)+"</div>":"";'
        'const statsHtml=cardType==="points"?(pointsBalance+" points"):(stampCount+" / "+DATA.stamp_goal+" stamps");'
        'app.innerHTML='
        '(msg?"<div class=\'msg "+(msg.ok?"msg-ok":"msg-err")+"\'>"+escapeHtml(msg.text)+"</div>":"")+'
        '"<div class=\'customer-box\'>"+'
        '"<div class=\'name\'>"+escapeHtml(DATA.customer_name)+"</div>"+'
        '"<div class=\'stamps\'>"+statsHtml+"</div>"+'
        '"</div>"+'
        'bodyHtml+'
        'couponHtml+'
        '(couponText?"<button class=\'btn-coupon\' id=\'redeemCouponBtn\'>Redeem Coupon</button>":"")+'
        '"<button class=\'btn-secondary\' id=\'switchBtn\'>Not "+escapeHtml(staffName||"you")+"? Switch</button>";'
        'attachBodyListeners();'
        'const redeemCouponBtn=document.getElementById("redeemCouponBtn");'
        'if(redeemCouponBtn)redeemCouponBtn.addEventListener("click",doRedeemCoupon);'
        'document.getElementById("switchBtn").addEventListener("click",function(){clearSession();renderLogin();});'
        '}'

        'async function doStamp(){'
        'const btn=document.getElementById("stampBtn");'
        'btn.disabled=true;btn.textContent="Adding...";'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/stamp",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'stampCount=d.stamp_count;rewardUnlocked=!!d.reward_unlocked;'
        'renderCard(s?s.name:"",{ok:true,text:rewardUnlocked?"Stamp added! Reward unlocked!":("Stamp added! "+stampCount+" total.")});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not add stamp"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error - stamp not added"});'
        '}'
        '}'

        'async function doPoints(){'
        'const input=document.getElementById("saleAmount");'
        'const amount=parseFloat(input?input.value:"");'
        'if(!amount||amount<=0){renderCard(getSession()?getSession().name:"",{ok:false,text:"Enter an amount spent first"});return;}'
        'const btn=document.getElementById("pointsBtn");'
        'btn.disabled=true;btn.textContent="Adding...";'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/points-sale",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,amount_spent:amount,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'pointsBalance=d.points_balance;'
        'renderCard(s?s.name:"",{ok:true,text:"+"+d.points_earned+" points! "+pointsBalance+" total."});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not add points"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error - points not added"});'
        '}'
        '}'

        'async function doRedeemPrize(prizeId){'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/points-redeem",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,prize_id:prizeId,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'pointsBalance=d.points_balance;'
        'renderCard(s?s.name:"",{ok:true,text:escapeHtml(d.prize_name||"Prize")+" redeemed!"});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not redeem prize"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error"});'
        '}'
        '}'

        'async function doRedeem(){'
        'const btn=document.getElementById("redeemBtn");'
        'btn.disabled=true;btn.textContent="Redeeming...";'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/reward/redeem",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'stampCount=0;rewardUnlocked=false;'
        'renderCard(s?s.name:"",{ok:true,text:"Reward redeemed!"});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not redeem"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error"});'
        '}'
        '}'

        'async function doRedeemCoupon(){'
        'const btn=document.getElementById("redeemCouponBtn");'
        'btn.disabled=true;btn.textContent="Redeeming...";'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/coupon/redeem",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'couponText=null;'
        'renderCard(s?s.name:"",{ok:true,text:"Coupon redeemed!"});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not redeem coupon"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error"});'
        '}'
        '}'

        '(function init(){'
        'const s=getSession();'
        'if(s){renderCard(s.name,null);}else{renderLogin();}'
        '})();'
        '</script>'
    )

    return HTMLResponse(head + script + '</body></html>')

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

# WALLET PASS (Google + Apple)

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
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    reward_name = program.get('reward_name', 'Free Service') if program else 'Free Service'
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    points_prizes = program.get('points_prizes', []) if program else []

    loyalty_object = build_loyalty_object(customer, business, program)
    jwt_token = create_google_wallet_jwt(loyalty_object)
    save_url = f"https://pay.google.com/gp/v/save/{jwt_token}" if jwt_token else None
    if not jwt_token:
        print("WALLET-PASS: Google JWT generation failed (check GOOGLE_WALLET_CREDENTIALS)")

    print(f"WALLET-PASS: Prepared pass data for customer {customer_public_id}")

    return {
        # Shape WalletPass.jsx renders the card from. card_type tells the
        # frontend whether to render the stamp grid or the points balance -
        # stamps/goal/reward_unlocked stay stamp-only, points_balance/
        # points_prizes stay points-only, so either UI can be built without
        # the other's fields being misleadingly present.
        "pass_data": {
            "business_name": business.get('name', ''),
            "customer_name": customer.get('name', ''),
            "customer_id": customer_public_id,
            "card_type": card_type,
            "stamps": customer.get('stamp_count', 0),
            "goal": stamp_goal,
            "reward_name": reward_name,
            "points_balance": customer.get('points_balance', 0),
            "points_prizes": points_prizes,
            "primary_color": primary_color,
            "reward_unlocked": bool(customer.get('reward_unlocked')),
            "qr_code": f"{BASE_URL}/stamp/{customer_public_id}",
        },
        "save_url": save_url,
        "apple_pass_url": f"{BASE_URL}/api/v1/customer/{customer_public_id}/apple-wallet-pass",
        "loyalty_object": loyalty_object,
    }

@app.get("/api/v1/customer/{customer_public_id}/apple-wallet-pass")
async def get_apple_wallet_pass(customer_public_id: str):
    """Direct .pkpass download - Safari on iOS/macOS recognizes the
    application/vnd.apple.pkpass content type and opens the native
    'Add to Apple Wallet' sheet; any other browser just downloads the file."""
    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    program = safe_get_loyalty_program(business.get('id'))
    announcement = get_latest_active_announcement(business.get('id'))

    pkpass_bytes = build_pkpass_bytes(customer, business, program, announcement)
    if pkpass_bytes is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Apple Wallet is not configured. Set APPLE_PASS_TYPE_IDENTIFIER, "
                "APPLE_TEAM_IDENTIFIER, APPLE_PASS_CERTIFICATE, APPLE_PASS_PRIVATE_KEY "
                "(or APPLE_PASS_CERTIFICATE_PASSWORD if using a .p12), "
                "APPLE_WWDR_CERTIFICATE and APPLE_PASS_AUTH_SECRET in your "
                "environment and redeploy."
            ),
        )
    return Response(
        content=pkpass_bytes,
        media_type="application/vnd.apple.pkpass",
        headers={"Content-Disposition": f'attachment; filename="{customer_public_id}.pkpass"'},
    )

# APPLE WALLET PASSKIT WEB SERVICE
# Implements the routes Apple's Wallet app calls on its own, per Apple's
# PassKit Web Service spec, so a pass someone already added keeps itself
# up to date instead of going stale the moment they leave the join page.
# webServiceURL in the pass points here (see APPLE_PASS_WEB_SERVICE_URL).

@app.post("/api/v1/apple-wallet/v1/devices/{device_library_identifier}/registrations/{pass_type_identifier}/{serial_number}")
async def apple_register_device(device_library_identifier: str, pass_type_identifier: str, serial_number: str, request: Request, authorization: Optional[str] = Header(None)):
    if not apple_auth_ok(serial_number, authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not supabase:
        raise HTTPException(status_code=500, detail="Not configured")
    try:
        body = await request.json()
    except Exception:
        body = {}
    push_token = body.get('pushToken', '')
    if not push_token:
        raise HTTPException(status_code=400, detail="Missing pushToken")
    try:
        existing = (
            supabase.table("apple_wallet_registrations")
            .select("id")
            .eq("device_library_identifier", device_library_identifier)
            .eq("serial_number", serial_number)
            .maybe_single()
            .execute()
        )
        # supabase-py's maybe_single().execute() returns None outright (not a
        # response object with .data = None) when zero rows match - which is
        # exactly the case for every brand-new registration, since this table
        # starts out empty for that device+serial pair. Guard against that
        # instead of assuming `existing` is always a response object.
        existing_id = existing.data['id'] if existing and existing.data else None
        if existing_id:
            supabase.table("apple_wallet_registrations").update({
                "push_token": push_token,
            }).eq("id", existing_id).execute()
            return Response(status_code=200)
        supabase.table("apple_wallet_registrations").insert({
            "device_library_identifier": device_library_identifier,
            "pass_type_identifier": pass_type_identifier,
            "serial_number": serial_number,
            "push_token": push_token,
            "created_at": datetime.utcnow().isoformat(),
        }).execute()
        print(f"APPLE WALLET: registered device for {serial_number}")
        return Response(status_code=201)
    except Exception as e:
        print(f"APPLE WALLET register error: {e}")
        raise HTTPException(status_code=500, detail="Registration failed")

@app.delete("/api/v1/apple-wallet/v1/devices/{device_library_identifier}/registrations/{pass_type_identifier}/{serial_number}")
async def apple_unregister_device(device_library_identifier: str, pass_type_identifier: str, serial_number: str, authorization: Optional[str] = Header(None)):
    if not apple_auth_ok(serial_number, authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        if supabase:
            supabase.table("apple_wallet_registrations").delete().eq(
                "device_library_identifier", device_library_identifier
            ).eq("serial_number", serial_number).execute()
    except Exception as e:
        print(f"APPLE WALLET unregister error: {e}")
    return Response(status_code=200)

@app.get("/api/v1/apple-wallet/v1/devices/{device_library_identifier}/registrations/{pass_type_identifier}")
async def apple_list_updated_serials(device_library_identifier: str, pass_type_identifier: str, passesUpdatedSince: Optional[str] = None):
    # 204 must carry no body at all - Apple's Wallet daemon (an HTTP/2 client)
    # can misread a 204 with a JSON body attached, so this uses a bare
    # Response() rather than HTTPException (which always attaches
    # {"detail": ...}, even when detail is None).
    if not supabase:
        return Response(status_code=204)
    try:
        rows = (
            supabase.table("apple_wallet_registrations")
            .select("serial_number")
            .eq("device_library_identifier", device_library_identifier)
            .eq("pass_type_identifier", pass_type_identifier)
            .execute()
        ).data or []
    except Exception:
        rows = []
    serials = [r['serial_number'] for r in rows]
    if not serials:
        return Response(status_code=204)
    return {"serialNumbers": serials, "lastUpdated": datetime.utcnow().isoformat()}

@app.get("/api/v1/apple-wallet/v1/passes/{pass_type_identifier}/{serial_number}")
async def apple_get_updated_pass(pass_type_identifier: str, serial_number: str, authorization: Optional[str] = Header(None), if_modified_since: Optional[str] = Header(None, alias="If-Modified-Since")):
    if not apple_auth_ok(serial_number, authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    customer = safe_get_customer(serial_number)
    if not customer:
        raise HTTPException(status_code=404, detail="Not found")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Not found")

    announcement = get_latest_active_announcement(business.get('id'))

    # Last-Modified needs to reflect whichever changed more recently - the
    # customer row (stamps/redemptions) or the business's active announcement.
    # Without the announcement side of this, posting a new announcement would
    # never actually change what this endpoint serves: the customer row is
    # untouched by an announcement, so the old customer-only timestamp would
    # keep matching If-Modified-Since and every device would get a 304
    # forever, no matter how many times push_apple_wallet_announcement() woke
    # them up to check.
    customer_ts = _parse_ts(customer.get('updated_at'))
    ann_ts_raw = (announcement or {}).get('updated_at') or (announcement or {}).get('created_at')
    ann_ts = _parse_ts(ann_ts_raw)
    if ann_ts and (not customer_ts or ann_ts > customer_ts):
        last_modified = ann_ts_raw
        last_modified_ts = ann_ts
    else:
        last_modified = customer.get('updated_at') or datetime.utcnow().isoformat()
        last_modified_ts = customer_ts

    # Wallet echoes back whatever we previously sent as Last-Modified (see
    # below) as If-Modified-Since on the next check. If neither side has
    # changed since then, a 304 with no body is required here - Apple's own
    # device logs flag it as a web service error when this is skipped and
    # the full (unchanged) pass is sent back every time instead.
    since_ts = _parse_ts(if_modified_since)
    if last_modified_ts and since_ts and last_modified_ts <= since_ts:
        return Response(status_code=304)

    program = safe_get_loyalty_program(business.get('id'))
    pkpass_bytes = build_pkpass_bytes(customer, business, program, announcement)
    if pkpass_bytes is None:
        raise HTTPException(status_code=500, detail="Could not build pass")
    return Response(
        content=pkpass_bytes,
        media_type="application/vnd.apple.pkpass",
        headers={"Last-Modified": last_modified},
    )

@app.post("/api/v1/apple-wallet/v1/log")
async def apple_log(request: Request):
    try:
        body = await request.json()
        for line in body.get('logs', []):
            print(f"APPLE WALLET DEVICE LOG: {line}")
    except Exception:
        pass
    return Response(status_code=200)

# SCHEDULED / CRON-TRIGGERED JOBS (Pro plan only)
# Neither of these run on their own - this app has no built-in scheduler.
# Point an external scheduler (Render Cron Job, cron-job.org, GitHub Actions
# on a schedule, etc.) at each of these once a day, e.g.:
#   POST {BASE_URL}/api/v1/cron/birthday-greetings   header: X-Cron-Secret: <CRON_SECRET>
#   POST {BASE_URL}/api/v1/cron/win-back              header: X-Cron-Secret: <CRON_SECRET>
# Both are safe to call more than once a day - each skips customers already
# messaged (this year for birthdays, in the last 30 days for win-back).

@app.post("/api/v1/cron/birthday-greetings")
async def run_birthday_greetings(_: bool = Depends(require_cron)):
    today = datetime.utcnow().date()
    sent, skipped, errors = 0, 0, 0

    try:
        businesses = supabase.table("businesses").select("*").eq("status", "ACTIVE").execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    for business in businesses:
        if not get_plan_features(business.get('plan')).get('birthday_greetings'):
            continue  # not entitled on this plan (Growth and Pro currently)
        try:
            customers = supabase.table("customers").select("*").eq("business_id", business.get("id")).execute().data or []
        except Exception:
            continue
        program = safe_get_loyalty_program(business.get('id'))
        for customer in customers:
            birthday = customer.get('birthday')
            if not birthday:
                continue
            try:
                bday = datetime.fromisoformat(str(birthday)).date()
            except Exception:
                continue
            if (bday.month, bday.day) != (today.month, today.day):
                continue
            if customer.get('last_birthday_greeting_year') == today.year:
                skipped += 1
                continue

            object_id = f"{GOOGLE_WALLET_ISSUER_ID}.{customer.get('public_id', '')}"
            reward_name = program.get('reward_name', 'a treat') if program else 'a treat'
            ok = send_wallet_object_message(
                object_id,
                header="Happy Birthday! 🎉",
                body=f"Happy birthday from {business.get('name', 'us')}! Stop by soon to celebrate with {reward_name}.",
                message_id=f"birthday-{customer.get('id')}-{today.year}",
            )
            if ok:
                sent += 1
                try:
                    supabase.table("customers").update({'last_birthday_greeting_year': today.year}).eq("id", customer.get("id")).execute()
                except Exception:
                    pass
            else:
                errors += 1

    return {"sent": sent, "skipped_already_sent": skipped, "errors": errors}

@app.post("/api/v1/cron/win-back")
async def run_win_back(_: bool = Depends(require_cron)):
    now = datetime.utcnow()
    inactivity_cutoff = now - timedelta(days=30)
    resend_cutoff = now - timedelta(days=30)  # don't re-nudge more than once a month
    sent, skipped, errors = 0, 0, 0

    try:
        businesses = supabase.table("businesses").select("*").eq("plan", "pro").eq("status", "ACTIVE").execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    for business in businesses:
        biz_id = business.get('id')
        try:
            customers = supabase.table("customers").select("*").eq("business_id", biz_id).execute().data or []
            stamp_events = supabase.table("stamp_events").select("customer_id,created_at").eq("business_id", biz_id).execute().data or []
        except Exception:
            continue

        last_stamp_by_customer = {}
        for ev in stamp_events:
            cid = ev.get('customer_id')
            ts = _parse_ts(ev.get('created_at'))
            if not ts:
                continue
            if cid not in last_stamp_by_customer or ts > last_stamp_by_customer[cid]:
                last_stamp_by_customer[cid] = ts

        for customer in customers:
            if not customer.get('stamp_count'):
                continue  # never stamped at all - not a "win back", they never started

            last_stamp = last_stamp_by_customer.get(customer.get('id'))
            reference_date = last_stamp or _parse_ts(customer.get('created_at'))
            if not reference_date or reference_date > inactivity_cutoff:
                continue  # still active within the last 30 days

            last_sent = _parse_ts(customer.get('last_winback_sent_at'))
            if last_sent and last_sent > resend_cutoff:
                skipped += 1
                continue

            object_id = f"{GOOGLE_WALLET_ISSUER_ID}.{customer.get('public_id', '')}"
            ok = send_wallet_object_message(
                object_id,
                header="We miss you! 🌱",
                body=f"It's been a while since your last visit to {business.get('name', 'us')} - come back and pick up where you left off!",
                message_id=f"winback-{customer.get('id')}-{now.strftime('%Y%m%d')}",
            )
            if ok:
                sent += 1
                try:
                    supabase.table("customers").update({'last_winback_sent_at': now.isoformat()}).eq("id", customer.get("id")).execute()
                except Exception:
                    pass
            else:
                errors += 1

    return {"sent": sent, "skipped_recently_sent": skipped, "errors": errors}

@app.post("/api/v1/cron/subscription-reminders")
async def run_subscription_reminders(_: bool = Depends(require_cron)):
    """Emails an owner when their subscription is within 7 days of expiring,
    or has already expired - at most once every SUBSCRIPTION_REMINDER_RESEND_DAYS
    while that condition holds, so this is safe to run daily. Point an
    external scheduler at this the same way as the two cron jobs above."""
    if not RESEND_API_KEY:
        raise HTTPException(status_code=503, detail="RESEND_API_KEY is not configured on this server")

    now = datetime.utcnow()
    resend_cutoff = now - timedelta(days=SUBSCRIPTION_REMINDER_RESEND_DAYS)
    sent, skipped, errors = 0, 0, 0

    try:
        businesses = supabase.table("businesses").select("*").eq("status", "ACTIVE").execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    for business in businesses:
        expires_raw = business.get('subscription_expires_at')
        if not expires_raw:
            continue  # never paid yet - nothing to remind about here
        expires = _parse_ts(expires_raw)
        if not expires:
            continue
        days_left = (expires - now).days
        if days_left > 7:
            continue  # still comfortably active

        last_sent = _parse_ts(business.get('last_subscription_reminder_sent_at'))
        if last_sent and last_sent > resend_cutoff:
            skipped += 1
            continue

        if not business.get('email'):
            continue

        try:
            branch_res = supabase.table("branches").select("id", count="exact").eq("business_id", business.get("id")).execute()
            branch_count = branch_res.count or 1
        except Exception:
            branch_count = 1
        price = get_price_for_plan(business.get('plan'), branch_count)

        subject, html_body = build_subscription_reminder_email(business, days_left, price)
        ok = send_email(business.get('email'), subject, html_body)
        if ok:
            sent += 1
            try:
                supabase.table("businesses").update({'last_subscription_reminder_sent_at': now.isoformat()}).eq("id", business.get("id")).execute()
            except Exception:
                pass
        else:
            errors += 1

    return {"sent": sent, "skipped_recently_sent": skipped, "errors": errors}

# Run

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))


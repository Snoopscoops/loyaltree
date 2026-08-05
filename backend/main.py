import os
import re
import asyncio
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
import calendar

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

# Cloudinary (vehicle photo uploads from the Inventory / AddVehicleModal).
# Upload preset is SIGNED, so the browser can't upload straight to
# Cloudinary on its own - it first calls
# POST /api/v1/business/{public_id}/cloudinary-signature to get a
# short-lived signature from this server (the only place CLOUDINARY_API_SECRET
# ever lives), then uploads directly to Cloudinary using that signature.
CLOUDINARY_CLOUD_NAME = os.getenv('CLOUDINARY_CLOUD_NAME', 'du72linxf')
CLOUDINARY_API_KEY = os.getenv('CLOUDINARY_API_KEY', '')
CLOUDINARY_API_SECRET = os.getenv('CLOUDINARY_API_SECRET', '')
CLOUDINARY_UPLOAD_PRESET = os.getenv('CLOUDINARY_UPLOAD_PRESET', 'LoyaltyTree_Images')
SUBSCRIPTION_PERIOD_DAYS = 30  # how long a successful payment extends access for
TRIAL_PERIOD_DAYS = 7  # free trial length granted automatically on signup, no payment/approval needed

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

# --- Car Lending / Showroom: buyer records (cl_customers table - kept
# separate from the loyalty `customers` table on purpose, see
# car_lending_schema.sql) ---
class CLCustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    id_number: Optional[str] = None  # driver's license / gov ID, for the contract
    notes: Optional[str] = None

class CLCustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    id_number: Optional[str] = None
    notes: Optional[str] = None

# --- Car Lending / Showroom: vehicle inventory ---
VEHICLE_STATUS_OPTIONS = ['available', 'reserved', 'sold', 'financed']

VEHICLE_MAX_PHOTOS = 10

def format_showroom_date(value: str) -> str:
    """Renders a YYYY-MM-DD date (as stored for a vehicle's amortization
    due dates) as something readable on the public showroom, e.g.
    'Aug 15, 2026'. Falls back to the raw stored value if it's not in
    the expected format, rather than failing the whole page."""
    try:
        return datetime.strptime(str(value)[:10], '%Y-%m-%d').strftime('%b %-d, %Y')
    except Exception:
        return str(value)

class VehicleCreate(BaseModel):
    make: str
    model: str
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    plate_number: Optional[str] = None
    plate_end_in: Optional[str] = None  # last digit of the plate number, kept as its own field (number-coding/color-coding schemes) rather than parsed off plate_number
    color: Optional[str] = None
    mileage: Optional[int] = Field(default=None, ge=0)
    transmission: Optional[Literal['automatic', 'manual']] = None
    fuel_type: Optional[Literal['gasoline', 'diesel', 'hybrid', 'electric']] = None
    price: float = Field(default=0, ge=0)  # "price to sell" - the only price shown publicly on the showroom, optional (may not apply on a monthly-amortization unit)
    total_cost: float = Field(default=0, ge=0)  # what the business paid to acquire this unit - NEVER shown on the showroom, used only for the owner's profit/loss (net income) computation on the dashboard
    agent_name: Optional[str] = None  # which agent is handling/sourced this unit - used to roll up "top agent" on the dashboard
    status: Optional[Literal['available', 'reserved', 'sold', 'financed']] = 'available'
    payment_type: Optional[Literal['cash', 'monthly_amortization']] = None  # how this unit is being sold - cash sale or financed/monthly amortization
    location: Optional[str] = None  # where the physical unit currently is - dashboard-only
    notes: Optional[str] = None  # free-text internal note (e.g. agent fee) - dashboard-only, never shown on the showroom
    downpayment: Optional[float] = Field(default=None, ge=0)  # only meaningful when payment_type = 'monthly_amortization'
    monthly_amortization_amount: Optional[float] = Field(default=None, ge=0)  # the "how much per month" figure shown on the showroom - only meaningful when payment_type = 'monthly_amortization'
    amortization_due_date: Optional[str] = None      # YYYY-MM-DD, recurring monthly due date - only meaningful when payment_type = 'monthly_amortization'
    amortization_next_due: Optional[str] = None       # YYYY-MM-DD, next actual due date coming up - only meaningful when payment_type = 'monthly_amortization'
    amortization_months_remaining: Optional[int] = Field(default=None, ge=0)  # only meaningful when payment_type = 'monthly_amortization'
    image_url: Optional[str] = None  # legacy single-photo field - kept in sync as image_urls[0] for old readers
    image_urls: Optional[List[str]] = None  # up to VEHICLE_MAX_PHOTOS photos, shown as a gallery on the showroom card

class VehicleUpdate(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    plate_number: Optional[str] = None
    plate_end_in: Optional[str] = None
    color: Optional[str] = None
    mileage: Optional[int] = Field(default=None, ge=0)
    transmission: Optional[Literal['automatic', 'manual']] = None
    fuel_type: Optional[Literal['gasoline', 'diesel', 'hybrid', 'electric']] = None
    price: Optional[float] = Field(default=None, ge=0)
    total_cost: Optional[float] = Field(default=None, ge=0)
    agent_name: Optional[str] = None
    status: Optional[Literal['available', 'reserved', 'sold', 'financed']] = None
    payment_type: Optional[Literal['cash', 'monthly_amortization']] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    downpayment: Optional[float] = Field(default=None, ge=0)
    monthly_amortization_amount: Optional[float] = Field(default=None, ge=0)
    amortization_due_date: Optional[str] = None
    amortization_next_due: Optional[str] = None
    amortization_months_remaining: Optional[int] = Field(default=None, ge=0)
    image_url: Optional[str] = None
    image_urls: Optional[List[str]] = None

# --- Car Lending / Showroom: public showroom page settings (one row per
# business - hero banner shown at the top of /showroom/{public_id}, the
# business logo shown inside that banner, and an owner-editable
# inquiries/contact note shown just below it, e.g. "For inquiries, call
# 0917-xxx-xxxx" - free text, not a link). Stored directly on the
# businesses table (hero_image_url/contact_text under showroom_* columns,
# logo_url shared with the rest of the app - loyalty cards, wallet passes,
# etc). ---
class ShowroomConfigUpdate(BaseModel):
    hero_image_url: Optional[str] = None
    contact_text: Optional[str] = Field(default=None, max_length=280)
    logo_url: Optional[str] = None

# --- Car Lending / Showroom: contracts (the deal - cash sale or financed) ---
CONTRACT_MAX_IMAGES = 5  # signed IDs, signed contract pages, official receipts, etc - private, never shown on the public showroom

class ContractCreate(BaseModel):
    customer_public_id: str
    vehicle_public_id: str
    sale_type: Literal['cash', 'financed'] = 'financed'
    # Required for cash sales. For financed deals, leave this unset and
    # provide installment_amount + term_months instead - the server derives
    # vehicle_price from those (down_payment + installment_amount * term_months).
    vehicle_price: Optional[float] = Field(default=None, gt=0)
    down_payment: float = Field(default=0, ge=0)
    # The buyer's fixed payment per period - no markup/interest added on top,
    # this number IS what they pay each time. Required for financed deals.
    installment_amount: Optional[float] = Field(default=None, gt=0)
    term_months: int = Field(default=0, ge=0, le=120)
    payment_frequency: Literal['weekly', 'biweekly', 'monthly'] = 'monthly'
    start_date: Optional[str] = None  # 'YYYY-MM-DD' - defaults to today if omitted
    image_urls: Optional[List[str]] = None  # up to CONTRACT_MAX_IMAGES Cloudinary URLs - signed contract pages, buyer ID, etc

    # Manual overrides - the fields above still describe the ORIGINAL deal
    # terms (used to compute principal/total payable/installment for the
    # record), but these three let the owner state where the loan actually
    # stands TODAY. This is what makes it possible to transfer an
    # already-in-progress loan (an existing customer/car already mid-payment
    # before this system existed) straight into LoyaltyTree instead of only
    # supporting brand-new deals starting from zero.
    balance_remaining: Optional[float] = Field(default=None, ge=0)
    last_paid_date: Optional[str] = None  # 'YYYY-MM-DD'
    next_due_date: Optional[str] = None  # 'YYYY-MM-DD'
    status: Optional[Literal['active', 'overdue', 'completed', 'repossessed', 'cancelled']] = None

class ContractUpdate(BaseModel):
    sale_type: Optional[Literal['cash', 'financed']] = None
    # Editing this directly wins over re-deriving it from installment_amount
    # in this same request - see the recompute logic in update_contract().
    vehicle_price: Optional[float] = Field(default=None, gt=0)
    down_payment: Optional[float] = Field(default=None, ge=0)
    term_months: Optional[int] = Field(default=None, ge=0, le=120)
    payment_frequency: Optional[Literal['weekly', 'biweekly', 'monthly']] = None
    start_date: Optional[str] = None
    # The buyer's payment per period. Editing this (without also editing
    # vehicle_price in the same request) re-derives vehicle_price from it.
    installment_amount: Optional[float] = Field(default=None, gt=0)
    image_urls: Optional[List[str]] = None  # up to CONTRACT_MAX_IMAGES Cloudinary URLs; send [] to clear
    balance_remaining: Optional[float] = Field(default=None, ge=0)
    last_paid_date: Optional[str] = None
    next_due_date: Optional[str] = None
    status: Optional[Literal['active', 'overdue', 'completed', 'repossessed', 'cancelled']] = None

# --- Car Lending / Showroom: payments against a contract ---
class CLPaymentCreate(BaseModel):
    amount: float = Field(gt=0)
    payment_date: Optional[str] = None  # 'YYYY-MM-DD' - defaults to today
    method: Optional[str] = None        # e.g. 'cash', 'bank_transfer', 'gcash', 'other'
    notes: Optional[str] = None

class CLPaymentUpdate(BaseModel):
    """Owner correcting a logged payment. method/notes can be edited on any
    payment. amount/payment_date can only be changed on the CONTRACT'S MOST
    RECENT payment - same rule as the existing undo/delete endpoint - since
    those two are what balance_remaining/next_due_date were derived from;
    changing an older payment's amount would silently drift every payment
    logged after it. To correct an older payment's amount, undo forward to
    it and re-log."""
    amount: Optional[float] = Field(default=None, gt=0)
    payment_date: Optional[str] = None
    method: Optional[str] = None
    notes: Optional[str] = None

# --- Car Lending / Showroom: agent/buyer/seller applications. One table,
# distinguished by `role` - only the business owner ("admin" of their own
# dashboard) can move status from pending to approved/rejected; there's no
# self-service path for an applicant to approve themselves. As of the
# cl-agent-signup rework below, this is also where the showroom's "Agent
# Login" sign-up popup lands (role='agent', with password_hash/selfie_url/
# id_photo_url filled in) - see CLApplicationUpdate/update_cl_application
# for how approving one of those provisions the real cl_agents account. ---
CL_APPLICATION_ROLES = ['agent', 'buyer', 'seller']
CL_APPLICATION_STATUSES = ['pending', 'approved', 'rejected']

class CLApplicationCreate(BaseModel):
    role: Literal['agent', 'buyer', 'seller']
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None  # agent: coverage area/experience; buyer: budget/preferred unit; seller: vehicle they want to list

class CLApplicationUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    # Approve/reject goes through this same field - the owner is the only
    # one with a UI path that calls this endpoint, so no separate
    # approve/reject endpoints are needed.
    status: Optional[Literal['pending', 'approved', 'rejected']] = None
    # The owner's note on the decision itself (e.g. why it was rejected) -
    # distinct from `notes` above, which is the applicant's own info.
    # Optional either way, settable in the same request as `status`.
    review_note: Optional[str] = None

# Public, unauthenticated self-service version - what the /apply page
# submits. No `status` field: every self-submitted application always
# lands as 'pending', same spirit as CLCustomerSelfSignup below never
# letting the submitter set their own approval state.
class CLApplicationSelfSignup(BaseModel):
    role: Literal['agent', 'buyer', 'seller']
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


# --- Car Lending / Showroom: the showroom's "Agent Login" sign-up popup
# (password + camera-captured KYC photos) submits this. It does NOT create
# a cl_agents account directly - it lands as a pending row in
# cl_applications (role='agent'), same as any other agent application, and
# waits for the business owner to approve or reject it (with an optional
# review_note) on the dashboard's Applications tab. Only on approval does
# update_cl_application() provision the real cl_agents login account from
# the stored password_hash/selfie_url/id_photo_url - see that function.
# Login itself is still a UI-only placeholder for now (see the showroom's
# SHOWROOM_JS) - there's no session/token issued yet and nothing
# server-side checks a password against it. ---
class CLAgentSignup(BaseModel):
    name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    email: str
    password: str = Field(min_length=6)
    selfie_url: str  # camera-captured selfie, uploaded to Cloudinary before this is submitted - see cl-agent-signup
    id_photo_url: str  # camera-captured photo of a government ID, same flow as selfie_url

# Dashboard-only edits to an approved agent's own contact details - name/
# phone/email/address only. Approval itself never happens here: an agent
# only exists in this table once their cl_applications row has been
# approved (see update_cl_application), so there's no status to set on it.
class CLAgentUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None


# --- Car Lending / Showroom: "Inquire to buy this car" popup, opened
# from a vehicle's detail modal on the public showroom. Public,
# unauthenticated, same spirit as CLApplicationSelfSignup/CLAgentSignup -
# lands as a normal 'pending' row in cl_applications (role='buyer'), NOT
# a separate table, so it shows up on the dashboard's existing
# Applications tab -> Buyers Application, and goes through the same
# owner approve/reject flow (see update_cl_application). The 4 document
# photos (2 valid IDs, proof of billing, proof of income) are uploaded
# client-side to Cloudinary (purpose=purchase_inquiry) before this is
# called, same pattern as the agent KYC photos - see uploadInquiryPhoto
# in SHOWROOM_JS. Trade-in fields are only meaningful when make_offer is
# true; the frontend hides them otherwise, and this endpoint blanks them
# server-side too if make_offer is false. ---
class CLBuyerInquiry(BaseModel):
    name: str
    phone: str
    address: Optional[str] = None
    vehicle_public_id: Optional[str] = None
    referring_agent: Optional[str] = None  # free-text name of the agent the buyer says referred them - not validated against cl_agents
    id_photo_url: str        # ID #1 - reuses the same column agent KYC uses
    id_photo_2_url: str      # ID #2
    proof_of_billing_url: str
    proof_of_income_url: str
    make_offer: bool = False
    trade_in_make: Optional[str] = None
    trade_in_model: Optional[str] = None
    trade_in_year: Optional[str] = None
    trade_in_mileage: Optional[int] = Field(default=None, ge=0)
    add_cash_amount: Optional[float] = Field(default=None, ge=0)
    add_cash_by: Optional[Literal['buyer', 'seller']] = None


# --- Car Lending / Showroom: "Sell your car" popup, opened from a
# standalone button on the public showroom (not tied to any vehicle
# already in inventory - the visitor is offering to sell the dealership
# their own car). Public, unauthenticated, same spirit as CLBuyerInquiry
# above - lands as a normal 'pending' row in cl_applications
# (role='seller') for the owner to review on the dashboard's
# Applications tab -> Sellers Application, going through the same
# approve/reject flow (see update_cl_application). Up to
# VEHICLE_MAX_PHOTOS vehicle photos are uploaded client-side to
# Cloudinary (purpose=sell_your_car) before this is called, same
# signed-upload pattern as the buyer inquiry's documents - see
# uploadSellPhoto in SHOWROOM_JS. Amortization fields are only
# meaningful when has_amortization is true; the frontend hides them
# otherwise, and this endpoint blanks them server-side too if
# has_amortization is false. ---
class CLSellerInquiry(BaseModel):
    name: str
    phone: str
    address: Optional[str] = None
    image_urls: List[str] = Field(default_factory=list)  # up to VEHICLE_MAX_PHOTOS photos of the vehicle being sold
    seller_make: Optional[str] = None
    seller_model: Optional[str] = None
    seller_year: Optional[str] = None
    seller_transmission: Optional[Literal['automatic', 'manual']] = None
    seller_mileage: Optional[int] = Field(default=None, ge=0)
    seller_price: Optional[float] = Field(default=None, ge=0)  # cash/downpayment offer the seller is asking for
    seller_type: Literal['owner', 'third_party']  # required - who's submitting this on the vehicle's behalf
    has_amortization: bool = False
    amortization_amount: Optional[float] = Field(default=None, ge=0)
    amortization_due_date: Optional[str] = None      # YYYY-MM-DD, recurring monthly due date on the existing loan
    amortization_next_due: Optional[str] = None       # YYYY-MM-DD, next actual due date coming up
    amortization_months_remaining: Optional[int] = Field(default=None, ge=0)


# --- Car Lending / Showroom: self-service signup (buyer scans the
# dealership's "Join" QR and registers themselves, mirrors CustomerSignup
# below but for cl_customers - no loyalty-specific fields) ---
class CLCustomerSelfSignup(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None

class CLAnnouncementCreate(BaseModel):
    title: str
    message: str
    customer_public_id: Optional[str] = None  # None = broadcast to every buyer with an email on file


class PointsPrize(BaseModel):
    # id is client-generated (uuid4 hex) so the owner can reorder/edit
    # prizes without the list re-keying itself on every save.
    id: Optional[str] = None
    name: str = Field(max_length=80)
    points_cost: int = Field(ge=1)
    description: Optional[str] = Field(default=None, max_length=140)

class LoyaltyConfig(BaseModel):
    card_type: Literal['stamp', 'points', 'multipass', 'membership'] = 'stamp'  # a business runs ONE active card at a time
    stamp_goal: int = Field(default=8, ge=3, le=20)
    reward_name: str = 'Free Service'
    primary_color: str = '#3b82f6'
    reward_expiry_days: int = Field(default=30, ge=1)
    program_logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    card_name: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=140)  # short blurb shown below the card on the join page / wallet pass - also doubles as the multipass card's "what these sessions are for" description
    google_review_url: Optional[str] = None  # Growth/Pro only - link prompted after a redeemed reward
    # --- Points card only ---
    points_per_amount: Optional[float] = Field(default=10, ge=0)     # points earned...
    points_amount_pesos: Optional[float] = Field(default=100, ge=1)  # ...per this many pesos spent
    points_prizes: Optional[List[PointsPrize]] = None                # catalog of prizes customers can redeem points for
    # --- Multipass card only ---
    multipass_session_count: Optional[int] = Field(default=12, ge=2, le=200)  # sessions issued per pass, e.g. 12 sessions sold at the price of 10
    multipass_validity_days: Optional[int] = Field(default=90, ge=1)          # days a freshly-issued pass stays valid before it expires unused
    # --- Membership card only ---
    membership_services: Optional[List[str]] = None  # preset list of service names (e.g. "Cleaning", "Whitening") shown as quick-select chips at the cashier - cashier can still type a custom note per visit

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
    multipass_sessions_remaining: Optional[int] = Field(default=None, ge=0)  # lets the owner manually correct a customer's remaining sessions

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

class MultipassIssueRequest(BaseModel):
    # Issues a fresh session pack to a customer - their first pack, or a
    # renewal once their previous one is used up / expired.
    customer_public_id: str
    session_count: Optional[int] = Field(default=None, ge=1)  # overrides the program's default pack size for a one-off custom sale
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class MultipassUseRequest(BaseModel):
    # Burns one session off the customer's current pack.
    customer_public_id: str
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class MembershipNoteRequest(BaseModel):
    # Membership-card equivalent of a stamp/session: the cashier logs what
    # service the member came in for today, so the owner can later pull up
    # a full activity history per member (think: a dentist's per-patient
    # chart) - see 'leaves' on the member's record.
    customer_public_id: str
    service_name: str = Field(max_length=120)  # what was done, e.g. "Teeth cleaning", "Root canal - session 1"
    note: Optional[str] = Field(default=None, max_length=500)  # optional longer note - observations, follow-up needed, etc.
    service_date: Optional[str] = None  # 'YYYY-MM-DD' - defaults to today if omitted; lets a cashier log a visit entered late
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class MembershipLeafUpdate(BaseModel):
    # Lets the owner correct a mistaken/typo'd leaf from the dashboard.
    service_name: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)
    service_date: Optional[str] = None  # 'YYYY-MM-DD'

class PinVerify(BaseModel):
    email: str
    pin: str

class AnnouncementCreate(BaseModel):
    title: str
    message: str
    type: Optional[str] = 'info'
    is_active: Optional[bool] = True
    end_date: Optional[str] = None  # 'YYYY-MM-DD'

class PlatformAnnouncementCreate(BaseModel):
    """Admin -> business owner promo/announcement (e.g. 'Refer a friend and
    get a free month'), shown on the owner's dashboard - distinct from
    AnnouncementCreate above, which is a business owner -> their own
    customers announcement."""
    title: str
    message: str
    type: Optional[str] = 'promo'
    is_active: Optional[bool] = True
    end_date: Optional[str] = None  # 'YYYY-MM-DD'

class PlatformAnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    type: Optional[str] = None
    is_active: Optional[bool] = None
    end_date: Optional[str] = None

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

class AdminBusinessCreate(BaseModel):
    """Admin-provisioned business account - used for invite-only business
    types (e.g. car_lending) that don't go through the public signup form.
    Skips duplicate self-serve trial logic: goes straight to ACTIVE with a
    full billing cycle, since there's no free-trial funnel to start from."""
    name: str
    email: str
    password: str
    phone: Optional[str] = None
    business_type: str = 'other'
    address: Optional[str] = None
    branch_count: int = Field(default=1, ge=1, le=50)
    plan: Optional[str] = None

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

def safe_get_cl_customer(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("cl_customers").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_vehicle(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("vehicles").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_contract(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("contracts").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_cl_application(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("cl_applications").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_cl_agent(public_id: str):
    if not supabase:
        return None
    try:
        res = supabase.table("cl_agents").select("*").eq("public_id", public_id).maybe_single().execute()
        return res.data
    except Exception:
        return None

def safe_get_cl_customer_by_id(customer_id: int):
    if not supabase:
        return None
    try:
        res = supabase.table("cl_customers").select("*").eq("id", customer_id).maybe_single().execute()
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

def safe_get_customer_by_id(customer_id: int):
    if not supabase:
        return None
    try:
        res = supabase.table("customers").select("*").eq("id", customer_id).maybe_single().execute()
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

def find_cl_customer_duplicate(business_id: int, phone: Optional[str], email: Optional[str], exclude_id: Optional[int] = None) -> Optional[str]:
    """Same idea as find_customer_duplicate but scoped to cl_customers (Car
    Lending buyers) - a separate table from the loyalty `customers` one."""
    if not supabase:
        return None
    phone = (phone or '').strip()
    email = (email or '').strip()
    try:
        if phone:
            res = (
                supabase.table("cl_customers").select("id")
                .eq("business_id", business_id).eq("phone", phone).execute()
            )
            for row in (res.data or []):
                if exclude_id is None or row.get('id') != exclude_id:
                    return "phone"
        if email:
            res = (
                supabase.table("cl_customers").select("id")
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
    sessions_outstanding = 0
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
        # Points-card businesses log sales to points_events and multipass
        # businesses log issues/uses to multipass_events, not stamp_events
        # (see the card_type guard around /stamp vs /points-sale vs
        # /multipass) - read from whichever table actually holds this
        # business's activity so it doesn't show a false 0.
        since = (datetime.utcnow() - timedelta(days=30)).isoformat()
        if card_type == 'points':
            activity_table = "points_events"
        elif card_type == 'multipass':
            activity_table = "multipass_events"
        else:
            activity_table = "stamp_events"
        activity_q = supabase.table(activity_table).select("id", count="exact").eq("business_id", biz_id).gte("created_at", since)
        if card_type == 'multipass':
            # "activity" here means sessions actually used, not passes issued.
            activity_q = activity_q.eq("action", "used")
        activity_res = activity_q.execute()
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
    elif card_type == 'multipass':
        try:
            # Outstanding session liability - unused sessions still owed on
            # unexpired passes, same idea as points_balance_outstanding.
            bal_res = supabase.table("customers").select("multipass_sessions_remaining").eq("business_id", biz_id).execute()
            sessions_outstanding = sum((c.get('multipass_sessions_remaining') or 0) for c in (bal_res.data or []))
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
        # stamps_30d holds stamp punches for stamp cards, points sales
        # (transactions, not points earned) for points cards, or sessions
        # used for multipass cards - see card_type to know which. Kept as
        # one key so existing callers keep working.
        "stamps_30d": activity_30d,
        "points_balance_outstanding": points_balance_outstanding if card_type == 'points' else None,
        "sessions_outstanding": sessions_outstanding if card_type == 'multipass' else None,
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
    sessions_remaining: int = 0,
    sessions_total: int = 0,
    total_visits: int = 0,
    last_service_name: Optional[str] = None,
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
    elif card_type == 'multipass':
        reward_line = 'Session Pass'
        progress_line = (f'{sessions_remaining} of {sessions_total} sessions left' if sessions_remaining > 0
                         else 'All sessions used')
    elif card_type == 'membership':
        reward_line = f'{total_visits} visit{"s" if total_visits != 1 else ""}'
        progress_line = f'Last visit: {last_service_name}' if last_service_name else 'Welcome!'
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
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    card_name = program.get('card_name') if program else None
    description = program.get('description') if program else None
    biz_name = business.get('name', 'Loyalty')
    program_name = card_name if card_name else f'{biz_name} Rewards'

    if card_type == 'multipass':
        session_count = program.get('multipass_session_count', 12) if program else 12
        reward_module_body = f'{session_count}-session pass'
    elif card_type == 'membership':
        services = (program.get('membership_services') if program else None) or []
        reward_module_body = ', '.join(services) if services else 'Membership'
    else:
        reward_module_body = reward_name

    loyalty_class = {
        'id': class_id,
        'issuerName': biz_name,
        'programName': program_name,
        'reviewStatus': review_status,
        'hexBackgroundColor': primary_color if primary_color.startswith('#') else f'#{primary_color}',
        'textModulesData': [
            {'header': 'Reward', 'body': reward_module_body},
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
    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    sessions_total = customer.get('multipass_total_sessions', 0) or (program.get('multipass_session_count', 12) if program else 12)
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', '')
    membership_summary = (
        get_membership_summary(business.get('id'), customer.get('id'))
        if card_type == 'membership' else None
    )

    if card_type == 'points':
        loyalty_points_label = 'Points'
        loyalty_points_balance = str(points_balance)
        progress_body = f'{points_balance} points'
        reward_body = 'Redeem prizes in-store'
    elif card_type == 'multipass':
        loyalty_points_label = 'Sessions'
        loyalty_points_balance = f'{sessions_remaining}/{sessions_total}'
        progress_body = f'{sessions_remaining} of {sessions_total} sessions left'
        reward_body = (program.get('description') if program else None) or 'Session pass'
    elif card_type == 'membership':
        total_visits = membership_summary['total_visits']
        loyalty_points_label = 'Visits'
        loyalty_points_balance = str(total_visits)
        progress_body = f'{total_visits} visit{"s" if total_visits != 1 else ""}'
        reward_body = membership_summary['last_service_name'] or (program.get('description') if program else None) or 'Member services'
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
        if card_type == 'points':
            progress_key = points_balance
        elif card_type == 'multipass':
            progress_key = sessions_remaining
        elif card_type == 'membership':
            progress_key = membership_summary['total_visits']
        else:
            progress_key = stamps
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
    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    sessions_total = customer.get('multipass_total_sessions', 0) or (program.get('multipass_session_count', 12) if program else 12)
    multipass_expires_at = customer.get('multipass_expires_at')
    reward_unlocked = bool(customer.get('reward_unlocked'))
    primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
    r, g, b = _hex_to_rgb(primary_color)
    membership_summary = (
        get_membership_summary(business.get('id'), customer.get('id'))
        if card_type == 'membership' else None
    )

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
            # Clean, real-card layout: one small header (member name), one
            # BIG hero value (the number that matters - points or stamp
            # progress), and a single short secondary line for the reward.
            # Nothing repeats logoText/organizationName (already shown up
            # top), so there's no duplicate "business name" field.
            'headerFields': [
                {'key': 'member', 'label': 'MEMBER', 'value': cust_name[:20]}
            ],
            'primaryFields': [
                {'key': 'points', 'label': 'POINTS', 'value': str(points_balance), 'changeMessage': 'Points added! You now have %@ points.'}
                if card_type == 'points' else
                {'key': 'sessions', 'label': 'SESSIONS', 'value': f'{sessions_remaining}/{sessions_total}', 'changeMessage': 'Session used! %@ sessions left.'}
                if card_type == 'multipass' else
                {'key': 'visits', 'label': 'VISITS', 'value': str(membership_summary['total_visits']), 'changeMessage': 'Visit logged! You now have %@ visits.'}
                if card_type == 'membership' else
                {'key': 'stamps', 'label': 'STAMPS', 'value': f'{stamps}/{stamp_goal}', 'changeMessage': 'Stamp added! You now have %@ stamps.'}
            ],
            'secondaryFields': [
                {'key': 'reward', 'label': 'REWARD', 'value': 'Redeem prizes in-store', 'changeMessage': '%@'}
                if card_type == 'points' else
                {'key': 'reward', 'label': 'EXPIRES', 'value': (multipass_expires_at or 'No expiry set'), 'changeMessage': '%@'}
                if card_type == 'multipass' else
                {'key': 'reward', 'label': 'LAST VISIT', 'value': (membership_summary['last_service_name'] or 'No visits yet')[:30], 'changeMessage': '%@'}
                if card_type == 'membership' else
                {'key': 'reward', 'label': 'REWARD', 'value': ('🎉 Ready to redeem!' if reward_unlocked else reward_name)[:30], 'changeMessage': '%@'}
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
    private_key, certificate, wwdr_cert = creds
    try:
        import tempfile
        from cryptography.hazmat.primitives import serialization
        # APNs' mTLS handshake needs the full chain - our leaf pass-signing
        # cert PLUS the Apple WWDR intermediate - or Apple can't build a
        # trust path to its root and silently drops the connection. Without
        # this, pushes fail inside _send_apple_wallet_pushes' try/except and
        # get swallowed: passes still issue fine (that path doesn't use this
        # file), but no device ever gets woken up to refetch.
        cert_pem = certificate.public_bytes(serialization.Encoding.PEM) + \
            wwdr_cert.public_bytes(serialization.Encoding.PEM)
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

# CAR LENDING / SHOWROOM - WALLET PASSES
#
# Separate pass type from the loyalty stamp/points/multipass/membership
# cards above: a car-lending buyer's pass shows their loan BALANCE and
# NEXT DUE DATE instead of a stamp/points count. Reuses all the same
# plumbing (Google Wallet REST API creds, Apple PassKit signing cert,
# apple_wallet_registrations table, the generic send_wallet_class_message /
# send_wallet_object_message / push_apple_wallet_update primitives above) -
# no new credentials or tables needed. The only thing that distinguishes a
# car-lending pass from a loyalty one at the infra level is:
#   - Google: its own loyaltyClass, id'd `{ISSUER_ID}.cl-{business.public_id}`
#     (stored on businesses.cl_google_wallet_class_id), separate from the
#     loyalty class on the same business.
#   - Apple: its own serialNumber, `cl-{customer.public_id}` (prefixed so
#     apple_get_updated_pass can tell which table to look the pass up in) -
#     same passTypeIdentifier/cert as loyalty, since Apple doesn't require a
#     distinct Pass Type ID per pass "shape", only per signing identity.
#
# A buyer with no active loan still gets a pass (0 / 0) - see
# build_cl_wallet_object/build_cl_apple_pass_json below - specifically so
# every member can receive dealership-wide announcements (send_wallet_class_
# message / push_cl_apple_wallet_announcement) even before their first deal,
# or after their loan is paid off.

def get_active_contract_for_cl_customer(customer_id: int) -> Optional[dict]:
    """The contract that should drive this buyer's wallet pass: their
    active or overdue loan if they have one, else the most recently
    completed one (so a paid-off buyer's pass still shows the deal they
    just finished for a beat), else None (never financed - 0/0 pass)."""
    if not supabase:
        return None
    try:
        rows = (
            supabase.table("contracts")
            .select("*")
            .eq("customer_id", customer_id)
            .in_("status", ["active", "overdue"])
            .order("next_due_date")
            .limit(1)
            .execute()
        ).data or []
        if rows:
            return rows[0]
        rows = (
            supabase.table("contracts")
            .select("*")
            .eq("customer_id", customer_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None
    except Exception:
        return None

def get_latest_cl_announcement(business_id: int) -> Optional[dict]:
    """Latest dealership-wide (broadcast, not single-buyer) announcement,
    used as the back-of-pass 'Announcement' field - same role
    get_latest_active_announcement() plays for loyalty passes."""
    if not supabase:
        return None
    try:
        rows = (
            supabase.table("cl_announcements")
            .select("*")
            .eq("business_id", business_id)
            .is_("customer_id", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None
    except Exception:
        return None

def build_cl_wallet_class(business: dict) -> dict:
    biz_public_id = business.get('public_id', '')
    class_id = business.get('cl_google_wallet_class_id') or f'{GOOGLE_WALLET_ISSUER_ID}.cl-{biz_public_id}'
    biz_name = business.get('name', 'Financing')

    loyalty_class = {
        'id': class_id,
        'issuerName': biz_name,
        'programName': biz_name,
        'reviewStatus': 'UNDER_REVIEW',
        'hexBackgroundColor': '#0f172a',
        'textModulesData': [
            {'header': 'About', 'body': 'Your loan balance and next payment due date, always up to date.'},
        ],
    }
    logo_url = business.get('logo_url') or DEFAULT_LOGO_URL
    loyalty_class['programLogo'] = {'sourceUri': {'uri': logo_url}}
    return loyalty_class

def build_cl_wallet_object(customer: dict, business: dict, contract: Optional[dict]) -> dict:
    cust_public_id = customer.get('public_id', '')
    class_id = business.get('cl_google_wallet_class_id') or f'{GOOGLE_WALLET_ISSUER_ID}.cl-{business.get("public_id", "")}'
    object_id = f'{GOOGLE_WALLET_ISSUER_ID}.cl-{cust_public_id}'
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', '')

    if contract and contract.get('status') in ('active', 'overdue'):
        balance = float(contract.get('balance_remaining') or 0)
        total = float(contract.get('installment_amount') or 0) * float(contract.get('term_months') or 1)
        # total_payable isn't stored on the row - installment*term is a
        # reasonable approximation for the "X / Y" display; balance itself
        # (the field that matters for the notification) is always exact.
        balance_str = f'₱{balance:,.0f} / ₱{total:,.0f}'
        due = contract.get('next_due_date') or '—'
        status_body = 'Overdue' if contract.get('status') == 'overdue' else f'Due {due}'
    else:
        balance_str = '0/0'
        due = '—'
        status_body = 'No active loan'

    return {
        'id': object_id,
        'classId': class_id,
        'state': 'active',
        'barcode': {
            'type': 'QR_CODE',
            # A URL, not a bare public_id - scanning the card with any
            # ordinary camera app now opens the buyer's own "check your
            # card" page (balance, next due date, Browse Showroom button)
            # instead of just displaying plain text. The owner's own
            # in-store "Scan QR" lookup (handleScanResult in the dashboard)
            # still works off the same barcode - it pulls the public_id
            # back out of the URL's last path segment.
            'value': f'{BASE_URL}/cl-wallet/{cust_public_id}',
            'alternateText': cust_name,
        },
        'accountId': cust_public_id,
        'accountName': cust_name,
        'loyaltyPoints': {
            'label': 'Balance',
            'balance': {'string': balance_str},
        },
        'textModulesData': [
            {'header': 'Business', 'body': biz_name},
            {'header': 'Status', 'body': status_body},
            {'header': 'Next Due', 'body': due},
        ],
        # Tappable link on the card itself, in addition to the barcode
        # above - opens the public showroom directly (browse current
        # inventory) without going through the "check your card" page.
        'linksModuleData': {
            'uris': [{'uri': f'{BASE_URL}/showroom/{business.get("public_id", "")}', 'description': 'Browse Showroom'}]
        },
    }

def sync_cl_wallet_object(customer: dict, business: dict, contract: Optional[dict],
                           notify_header: str = None, notify_body: str = None,
                           notify_message_id: str = None):
    """Car-lending equivalent of sync_wallet_object() - PATCHes the buyer's
    Google Wallet loan card with their current balance/due date, optionally
    firing a TEXT_AND_NOTIFY push alongside it. Best-effort, never raises."""
    access_token = get_google_access_token()
    if not access_token:
        return
    try:
        import httpx
        cl_object = build_cl_wallet_object(customer, business, contract)
        object_id = cl_object['id']
        with httpx.Client() as client:
            resp = client.patch(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}',
                headers={"Authorization": f"Bearer {access_token}"},
                json=cl_object
            )
            if resp.status_code in (200, 201):
                print(f"CL WALLET SYNC: updated {object_id}")
                if notify_header and notify_message_id:
                    send_wallet_object_message(object_id, notify_header, notify_body or '', notify_message_id)
            elif resp.status_code == 404:
                print(f"CL WALLET SYNC: {object_id} not found - buyer hasn't added it to their wallet yet")
            else:
                print(f"CL WALLET SYNC: failed {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"CL WALLET SYNC error: {e}")

def build_cl_apple_pass_json(customer: dict, business: dict, contract: Optional[dict],
                              announcement: Optional[dict] = None, reminder_text: Optional[str] = None) -> dict:
    cust_public_id = customer.get('public_id', '')
    serial = f'cl-{cust_public_id}'
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', 'Financing')

    if contract and contract.get('status') in ('active', 'overdue'):
        balance = float(contract.get('balance_remaining') or 0)
        due = contract.get('next_due_date') or '—'
        balance_value = f'₱{balance:,.0f}'
        due_value = due
    else:
        balance_value = '0/0'
        due_value = '—'

    ann_title = (announcement or {}).get('title', '') or ''
    ann_message = (announcement or {}).get('message', '') or ''
    announcement_value = ann_title.strip() or ann_message.strip() or 'Check back for updates'

    # Value (not existence) is what PassKit diffs to decide whether to fire
    # a lock-screen notification on refetch - see build_apple_pass_json's
    # comment above for the full explanation. reminder_text is passed in by
    # the payment-reminder cron with a stage-specific message ("Due in 7
    # days", "Overdue", etc.) so each new stage is a genuinely new value.
    reminder_value = reminder_text or due_value

    back_fields = [
        {'key': 'about', 'label': 'About', 'value': 'Your loan balance and next payment due date.'},
        {
            'key': 'showroom',
            'label': 'Browse Showroom',
            # Apple Wallet auto-links a bare URL in a back field's value, so
            # this renders as a tappable link straight to the public
            # inventory page - no extra "links module" concept on PassKit.
            'value': f'{BASE_URL}/showroom/{business.get("public_id", "")}',
        },
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
        'serialNumber': serial,
        'description': biz_name,
        'logoText': biz_name[:20],
        'backgroundColor': 'rgb(15, 23, 42)',
        'foregroundColor': 'rgb(255, 255, 255)',
        'labelColor': 'rgba(255, 255, 255, 0.75)',
        'webServiceURL': APPLE_PASS_WEB_SERVICE_URL,
        'authenticationToken': apple_pass_auth_token(serial),
        'storeCard': {
            'headerFields': [
                {'key': 'member', 'label': 'MEMBER', 'value': cust_name[:20]}
            ],
            'primaryFields': [
                {'key': 'balance', 'label': 'BALANCE', 'value': balance_value, 'changeMessage': 'Balance updated: %@'}
            ],
            'secondaryFields': [
                {'key': 'reminder', 'label': 'NEXT DUE', 'value': reminder_value[:30], 'changeMessage': '%@'}
            ],
            'backFields': back_fields,
        },
        'barcodes': [
            {
                'format': 'PKBarcodeFormatQR',
                # Same URL as the Google Wallet barcode above - see that
                # comment for why this changed from a bare public_id.
                'message': f'{BASE_URL}/cl-wallet/{cust_public_id}',
                'messageEncoding': 'iso-8859-1',
                'altText': cust_name,
            }
        ],
    }

def build_cl_pkpass_bytes(customer: dict, business: dict, contract: Optional[dict],
                           announcement: Optional[dict] = None, reminder_text: Optional[str] = None) -> Optional[bytes]:
    if not APPLE_PASS_TYPE_IDENTIFIER or not APPLE_TEAM_IDENTIFIER:
        return None
    if get_apple_pass_credentials() is None:
        return None

    biz_name = business.get('name', 'Financing')
    pass_json = build_cl_apple_pass_json(customer, business, contract, announcement, reminder_text)

    files = {
        'pass.json': json.dumps(pass_json).encode('utf-8'),
        'icon.png': generate_apple_icon_bytes('#0f172a', biz_name, 29),
        'icon@2x.png': generate_apple_icon_bytes('#0f172a', biz_name, 58),
        'icon@3x.png': generate_apple_icon_bytes('#0f172a', biz_name, 87),
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

def push_cl_apple_wallet_announcement(business_id: int) -> int:
    """Car-lending equivalent of push_apple_wallet_announcement() - fans a
    push out to every buyer's registered Apple Wallet loan card for this
    business, including ones with no active loan (0/0 pass), so a
    dealership-wide announcement reaches everyone. Best-effort, never
    raises; 0 is a normal outcome."""
    if not supabase or not APPLE_PASS_TYPE_IDENTIFIER:
        return 0
    try:
        customer_rows = (
            supabase.table("cl_customers")
            .select("public_id")
            .eq("business_id", business_id)
            .execute()
        ).data or []
    except Exception:
        return 0
    serial_numbers = [f"cl-{r['public_id']}" for r in customer_rows if r.get('public_id')]
    if not serial_numbers:
        return 0
    push_tokens = []
    try:
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
        print(f"CL APPLE WALLET announcement lookup error: {e}")
        return 0
    return _send_apple_wallet_pushes(push_tokens)

def sync_cl_apple_wallet_pass(customer: dict):
    """Companion to sync_cl_wallet_object() - call alongside it wherever a
    buyer's balance/due date changes. Never raises."""
    try:
        push_apple_wallet_update(f"cl-{customer.get('public_id', '')}")
    except Exception as e:
        print(f"CL APPLE WALLET sync error: {e}")

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

def log_multipass_event(business_id: int, customer_id: int, action: str, sessions_remaining: int,
                         staff_id: Optional[int] = None, branch_id: Optional[int] = None):
    """Best-effort event log for multipass issues/uses - powers the Analytics
    dashboard the same way log_stamp_event/log_points_event do for their
    card types. action is 'issued' or 'used'. Never raises."""
    try:
        event = {
            'business_id': business_id,
            'customer_id': customer_id,
            'action': action,
            'sessions_remaining': sessions_remaining,
            'created_at': datetime.utcnow().isoformat(),
        }
        if staff_id is not None:
            event['staff_id'] = staff_id
        if branch_id is not None:
            event['branch_id'] = branch_id
        supabase.table("multipass_events").insert(event).execute()
    except Exception as e:
        print(f"MULTIPASS EVENT LOG error: {e}")

def log_membership_event(business_id: int, customer_id: int, service_name: str, note: Optional[str],
                          service_date: str, staff_id: Optional[int] = None, branch_id: Optional[int] = None):
    """Records one 'leaf' on a membership-card member's activity history -
    e.g. a dentist noting a patient came in for a cleaning on a given date.
    Unlike stamp/points/multipass, membership has no running balance on the
    customer row - the full history in membership_events IS the card.
    Returns the inserted row (so callers can hand back its id), or None on
    failure. Best-effort - never raises."""
    try:
        event = {
            'business_id': business_id,
            'customer_id': customer_id,
            'service_name': service_name,
            'note': note,
            'service_date': service_date,
            'created_at': datetime.utcnow().isoformat(),
        }
        if staff_id is not None:
            event['staff_id'] = staff_id
        if branch_id is not None:
            event['branch_id'] = branch_id
        res = supabase.table("membership_events").insert(event).execute()
        return (res.data or [None])[0]
    except Exception as e:
        print(f"MEMBERSHIP EVENT LOG error: {e}")
        return None

def get_membership_summary(business_id: int, customer_id: int) -> dict:
    """Membership cards have no running balance on the customer row (see
    log_membership_event) - the Wallet pass, hero image, and pass_data JSON
    all need a stand-in for 'progress', so this derives one from
    membership_events on demand: how many visits total, and what/when the
    most recent one was. Best-effort - never raises, returns zeros/None on
    any failure (including the table not existing yet) so a Wallet pass
    request never 500s over this."""
    summary = {'total_visits': 0, 'last_service_name': None, 'last_service_date': None}
    try:
        res = (
            supabase.table("membership_events")
            .select("service_name,service_date")
            .eq("business_id", business_id)
            .eq("customer_id", customer_id)
            .order("service_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        rows = res.data or []
        summary['total_visits'] = len(rows)
        if rows:
            summary['last_service_name'] = rows[0].get('service_name')
            summary['last_service_date'] = rows[0].get('service_date')
    except Exception as e:
        print(f"MEMBERSHIP SUMMARY error: {e}")
    return summary

# FastAPI App
app = FastAPI(title='LoyaltyTree API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.get("/health")
async def health():
    """Cheap endpoint with no DB/auth work - just proves the process is
    alive. Used by the keep-alive loop below and safe for an external
    uptime monitor to hit too."""
    return {"status": "ok"}

# KEEP-ALIVE (Render free tier spins the service down after ~15 min with no
# inbound requests). This loop pings our own public /health endpoint every
# 10 minutes so Render always sees recent traffic and never sleeps us.
# RENDER_EXTERNAL_URL is set automatically by Render on every web service -
# no manual config needed there. If it's missing (e.g. running locally, or
# hosted elsewhere), the loop just skips itself instead of erroring.
async def _keep_alive_loop():
    import httpx
    self_url = os.getenv("RENDER_EXTERNAL_URL")
    if not self_url:
        return
    while True:
        await asyncio.sleep(10 * 60)
        try:
            with httpx.Client(timeout=10) as client:
                client.get(f"{self_url}/health")
        except Exception as e:
            print(f"KEEP-ALIVE ping error: {e}")

@app.on_event("startup")
async def start_keep_alive():
    asyncio.create_task(_keep_alive_loop())

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
                    "business_type": business.get("business_type", "other"),
                    "user": {
                        "business_slug": business.get("public_id", ""),
                        "business_name": business.get("name", ""),
                        "name": business.get("name", ""),
                        "email": business.get("email", ""),
                        "role": "owner",
                        "logo_url": business.get("logo_url"),
                        "business_type": business.get("business_type", "other"),
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

    # Approved Car Lending agents authenticate from cl_agents. Their row is
    # provisioned only after the dealership owner approves the original
    # application, so existence here means the agent is approved.
    try:
        res = supabase.table("cl_agents").select("*,businesses(public_id,name,logo_url,status,business_type)") \
            .eq("email", req.email.strip().lower()).maybe_single().execute()
        agent = res.data
        if agent:
            stored_pw = agent.get('password_hash', '')
            input_hash = hash_password(req.password)
            if stored_pw == req.password or stored_pw == input_hash:
                biz = agent.get('businesses', {}) or {}
                status = (biz.get('status') or 'PENDING').upper()
                if status != 'ACTIVE':
                    raise HTTPException(
                        status_code=403,
                        detail="This dealership is not active. Please contact the dealership owner."
                    )
                business_public_id = biz.get('public_id', '')
                return {
                    "success": True,
                    "token": "agent-token-" + agent.get("public_id", ""),
                    "business_slug": business_public_id,
                    "business_name": biz.get("name", ""),
                    "business_type": biz.get("business_type", "car_lending"),
                    "name": agent.get("name", ""),
                    "role": "agent",
                    "agent_public_id": agent.get("public_id", ""),
                    "logo_url": biz.get("logo_url"),
                    "redirect_url": f"{BASE_URL}/agent/{business_public_id}",
                    "user": {
                        "business_slug": business_public_id,
                        "business_name": biz.get("name", ""),
                        "business_type": biz.get("business_type", "car_lending"),
                        "name": agent.get("name", ""),
                        "email": agent.get("email", ""),
                        "role": "agent",
                        "agent_public_id": agent.get("public_id", ""),
                        "logo_url": biz.get("logo_url"),
                    }
                }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Agent login error: {e}")

    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.post("/api/v1/register")
@app.post("/api/v1/auth/register")
async def register(biz: BusinessCreate):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    # Some business types are invite-only / admin-provisioned (specialized
    # dashboards set up by us, not self-serve) - block them here rather than
    # just hiding the option in the UI, since this endpoint is public.
    INVITE_ONLY_BUSINESS_TYPES = {'car_lending'}
    if biz.business_type in INVITE_ONLY_BUSINESS_TYPES:
        raise HTTPException(
            status_code=403,
            detail="This business type is set up by invitation only. Please contact us to get started."
        )

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
    trial_expires = (datetime.utcnow() + timedelta(days=TRIAL_PERIOD_DAYS)).date().isoformat()
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
        # Live immediately on a free trial - no manual admin approval or
        # payment needed to start using the app. subscription_expires_at
        # doubles as the trial end date; the existing reminder cron already
        # emails the owner as this gets close, and a real PayMongo payment
        # later just extends it by SUBSCRIPTION_PERIOD_DAYS as normal.
        'status': 'ACTIVE',
        'subscription_expires_at': trial_expires,
        'created_at': datetime.utcnow().isoformat(),
    }

    try:
        insert_res = supabase.table("businesses").insert(business_data).execute()
        business_id = insert_res.data[0]['id'] if insert_res.data else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

    # Best-effort heads-up to the platform admin - never blocks signup if it fails.
    if SUPER_ADMIN_EMAIL:
        send_email(
            SUPER_ADMIN_EMAIL,
            subject=f"New business signed up: {biz.name}",
            html_body=(
                f"<p>A new business just registered on LoyaltyTree.</p>"
                f"<ul>"
                f"<li><b>Name:</b> {html_lib.escape(biz.name)}</li>"
                f"<li><b>Email:</b> {html_lib.escape(biz.email or '')}</li>"
                f"<li><b>Phone:</b> {html_lib.escape(biz.phone or '')}</li>"
                f"<li><b>Plan:</b> {SUBSCRIPTION_PLANS.get(plan, {}).get('label', plan)}</li>"
                f"<li><b>Branches:</b> {biz.branch_count}</li>"
                f"<li><b>Status:</b> ACTIVE (7-day free trial, expires {trial_expires})</li>"
                f"</ul>"
            ),
        )


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
        "business_type": biz.business_type,
        "plan": plan,
        "branch_count": biz.branch_count,
        "price_month": price_month,
        "trial_expires_at": trial_expires,
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
        card_type_breakdown = {'stamp': 0, 'points': 0, 'multipass': 0}
        for b in businesses:
            status = (b.get('status') or 'PENDING').upper()
            plan = b.get('plan') or 'starter'
            status_breakdown[status] = status_breakdown.get(status, 0) + 1
            plan_breakdown[plan] = plan_breakdown.get(plan, 0) + 1

        # Outstanding points/session liability across every points/multipass business.
        total_points_outstanding = 0
        sessions_issued_30d = 0
        sessions_used_30d = 0
        total_sessions_outstanding = 0
        try:
            points_programs = supabase.table("loyalty_programs").select("business_id").eq("card_type", "points").execute().data or []
            points_business_ids = [p.get('business_id') for p in points_programs]
            multipass_programs = supabase.table("loyalty_programs").select("business_id").eq("card_type", "multipass").execute().data or []
            multipass_business_ids = [p.get('business_id') for p in multipass_programs]
            card_type_breakdown['points'] = len(points_business_ids)
            card_type_breakdown['multipass'] = len(multipass_business_ids)
            card_type_breakdown['stamp'] = len(businesses) - len(points_business_ids) - len(multipass_business_ids)
            if points_business_ids:
                bal_res = supabase.table("customers").select("points_balance").in_("business_id", points_business_ids).execute()
                total_points_outstanding = sum((c.get('points_balance') or 0) for c in (bal_res.data or []))
            if multipass_business_ids:
                mp_events_30d = supabase.table("multipass_events").select("action").in_("business_id", multipass_business_ids).gte("created_at", since).execute().data or []
                sessions_issued_30d = sum(1 for e in mp_events_30d if e.get('action') == 'issued')
                sessions_used_30d = sum(1 for e in mp_events_30d if e.get('action') == 'used')
                mp_bal_res = supabase.table("customers").select("multipass_sessions_remaining").in_("business_id", multipass_business_ids).execute()
                total_sessions_outstanding = sum((c.get('multipass_sessions_remaining') or 0) for c in (mp_bal_res.data or []))
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
            "sessions_issued_30d": sessions_issued_30d,
            "sessions_used_30d": sessions_used_30d,
            "total_sessions_outstanding": total_sessions_outstanding,
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

@app.post("/api/v1/admin/businesses")
async def admin_create_business(biz: AdminBusinessCreate, _: bool = Depends(require_admin)):
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
                detail=f"{SUBSCRIPTION_PLANS[biz.plan]['label']} supports up to {max_branches} branch{'es' if max_branches != 1 else ''}. Choose a higher plan or reduce branch count."
            )
        plan = biz.plan
    else:
        plan = determine_plan_from_branch_count(biz.branch_count)

    business_data = {
        'public_id': public_id,
        'name': biz.name,
        'email': biz.email,
        'phone': biz.phone,
        'password_hash': hash_password(biz.password),
        'business_type': biz.business_type,
        'address': biz.address,
        'plan': plan,
        'status': 'ACTIVE',
        'subscription_expires_at': (datetime.utcnow() + timedelta(days=SUBSCRIPTION_PERIOD_DAYS)).date().isoformat(),
        'created_at': datetime.utcnow().isoformat(),
    }

    try:
        insert_res = supabase.table("businesses").insert(business_data).execute()
        business_id = insert_res.data[0]['id'] if insert_res.data else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Creation failed: {str(e)}")

    # Same placeholder-branch seeding as public registration.
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
            print(f"BRANCH SEED error: {e}")

    return {
        "success": True,
        "public_id": public_id,
        "name": biz.name,
        "email": biz.email,
        "business_type": biz.business_type,
        "plan": plan,
    }

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
    elif summary.get("card_type") == 'multipass':
        try:
            since = (datetime.utcnow() - timedelta(days=30)).isoformat()
            mp_res = supabase.table("multipass_events").select("action").eq("business_id", business.get('id')).gte("created_at", since).execute().data or []
            summary["sessions_issued_30d"] = sum(1 for e in mp_res if e.get('action') == 'issued')
            summary["sessions_used_30d"] = sum(1 for e in mp_res if e.get('action') == 'used')
        except Exception:
            summary["sessions_issued_30d"] = 0
            summary["sessions_used_30d"] = 0
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

# PLATFORM ANNOUNCEMENTS (admin -> all business owners' dashboards, e.g.
# LoyaltyTree promos like "refer a friend, get a free month"). Separate
# from the /business/{id}/announcements routes above, which are a business
# owner's own announcements to their customers.

@app.get("/api/v1/admin/platform-announcements")
async def admin_list_platform_announcements(_: bool = Depends(require_admin)):
    try:
        res = (
            supabase.table("platform_announcements")
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/admin/platform-announcements")
async def admin_create_platform_announcement(ann: PlatformAnnouncementCreate, _: bool = Depends(require_admin)):
    data = {
        'public_id': generate_public_id(),
        'title': ann.title,
        'message': ann.message,
        'type': ann.type or 'promo',
        'is_active': ann.is_active if ann.is_active is not None else True,
        'end_date': ann.end_date,
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
    }
    try:
        res = supabase.table("platform_announcements").insert(data).execute()
        return res.data[0] if res.data else data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.put("/api/v1/admin/platform-announcements/{announcement_id}")
async def admin_update_platform_announcement(announcement_id: str, ann: PlatformAnnouncementUpdate, _: bool = Depends(require_admin)):
    update_data = {k: v for k, v in ann.dict().items() if v is not None}
    update_data['updated_at'] = datetime.utcnow().isoformat()
    try:
        res = (
            supabase.table("platform_announcements")
            .update(update_data)
            .eq("public_id", announcement_id)
            .execute()
        )
        if not res.data:
            raise HTTPException(status_code=404, detail="Announcement not found")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/admin/platform-announcements/{announcement_id}")
async def admin_delete_platform_announcement(announcement_id: str, _: bool = Depends(require_admin)):
    try:
        supabase.table("platform_announcements").delete().eq("public_id", announcement_id).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

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

            # Best-effort heads-up to the platform admin - never blocks the
            # webhook if it fails. amount_php comes off PayMongo's own
            # amount field (centavos) rather than the local payments table,
            # so this still fires correctly even if that DB write above failed.
            if SUPER_ADMIN_EMAIL:
                amount_centavos = resource_attrs.get("amount")
                amount_php = f"{amount_centavos / 100:.2f}" if amount_centavos else "unknown"
                send_email(
                    SUPER_ADMIN_EMAIL,
                    subject=f"Payment received: {business.get('name', '')}",
                    html_body=(
                        f"<p>A subscription payment just came through via PayMongo.</p>"
                        f"<ul>"
                        f"<li><b>Business:</b> {html_lib.escape(business.get('name', ''))}</li>"
                        f"<li><b>Amount:</b> ₱{amount_php}</li>"
                        f"<li><b>Plan:</b> {SUBSCRIPTION_PLANS.get(business.get('plan'), {}).get('label', business.get('plan'))}</li>"
                        f"</ul>"
                    ),
                )
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
    if 'stamp_count' in update_data or 'points_balance' in update_data or 'multipass_sessions_remaining' in update_data:
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

    if 'stamp_count' in update_data or 'points_balance' in update_data or 'multipass_sessions_remaining' in update_data:
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

    # Apple Wallet registrations aren't tied to customers by FK (the serial
    # number is the join key, not customer_id), so they'd otherwise survive
    # the delete as orphans - leaving a phone registered for a pass whose
    # backing customer row is gone. Every future refetch attempt for that
    # serial then 404s at GET /api/v1/apple-wallet/v1/passes/... forever,
    # silently killing update notifications for that device. Best-effort:
    # this cleanup must never block the customer delete itself.
    try:
        supabase.table("apple_wallet_registrations").delete().eq(
            "serial_number", customer_public_id
        ).execute()
    except Exception as e:
        print(f"APPLE WALLET registration cleanup error: {e}")

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
        # lives in points_events instead, and multipass businesses log to
        # multipass_events. Same activity_events swap as get_analytics
        # above, keeping the "stamp_count" field name so the dashboard
        # doesn't need a second shape to handle.
        program = safe_get_loyalty_program(business.get("id"))
        card_type = program.get('card_type', 'stamp') if program else 'stamp'
        if card_type == 'points':
            activity_table = "points_events"
        elif card_type == 'multipass':
            activity_table = "multipass_events"
        else:
            activity_table = "stamp_events"

        activity_q = supabase.table(activity_table).select("branch_id,sessions_remaining" if card_type == 'multipass' else "branch_id").eq("business_id", business.get("id"))
        if card_type == 'multipass':
            # "activity" is sessions used, not passes issued - see get_analytics.
            activity_q = activity_q.eq("action", "used")
        activity_events = activity_q.execute().data or []

        # multipass never writes to redemption_events - its "redemption"
        # equivalent (a used session that leaves 0 remaining, i.e. a
        # completed pack) is derived from the activity rows above instead.
        redemption_events = (
            [] if card_type == 'multipass'
            else supabase.table("redemption_events").select("branch_id").eq("business_id", business.get("id")).execute().data or []
        )

        stamp_counts, redemption_counts = {}, {}
        for row in activity_events:
            bid = row.get("branch_id")
            if bid is not None:
                stamp_counts[bid] = stamp_counts.get(bid, 0) + 1
                if card_type == 'multipass' and (row.get('sessions_remaining') or 0) <= 0:
                    redemption_counts[bid] = redemption_counts.get(bid, 0) + 1
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
        multipass_events = supabase.table("multipass_events").select("*").eq("business_id", business_id).execute().data or []
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
    #
    # Multipass "activity" is sessions used (the day-to-day equivalent of a
    # stamp punch / points sale) - pack issues are a separate signal (a new
    # or renewed pack), not routine activity, so they're excluded the same
    # way a points top-up wouldn't count as "activity" either.
    multipass_used_events = [e for e in multipass_events if e.get('action') == 'used']
    # A 'used' event that leaves 0 sessions remaining is a completed pack -
    # the multipass equivalent of a redeemed reward. multipass_events
    # already stores the resulting sessions_remaining on every 'used' row
    # (see log_multipass_event), so this is derived rather than needing a
    # separate completion log; redemption_events is never written for
    # multipass businesses.
    multipass_completed_events = [e for e in multipass_used_events if (e.get('sessions_remaining') or 0) <= 0]

    if card_type == 'points':
        activity_events = points_events
    elif card_type == 'multipass':
        activity_events = multipass_used_events
    else:
        activity_events = stamp_events

    reward_events = multipass_completed_events if card_type == 'multipass' else redemption_events

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

    redeems_period = _filter_between(reward_events, 'created_at', period_start, now)
    redeems_prev = _filter_between(reward_events, 'created_at', prev_start, prev_end)

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
        "rewards": _bucketed_series(reward_events, 'created_at', period_start, now),
        "peak_hours": _day_of_week_series(activity_events, 'created_at', period_start, now),
    }

    if card_type == 'multipass':
        # No single "sessions used" field on the customer row - derive it
        # from the pack size vs what's left, same arithmetic the wallet
        # pass and cashier app use to show progress.
        def _sessions_used(c):
            total = c.get('multipass_total_sessions', 0) or 0
            remaining = c.get('multipass_sessions_remaining', 0) or 0
            return max(total - remaining, 0)
        top_customers = sorted(customers, key=_sessions_used, reverse=True)[:5]
        top_customers_out = [
            {"name": c.get("name") or "Customer", "stamps": _sessions_used(c), "metric": "sessions_used"}
            for c in top_customers if _sessions_used(c) > 0
        ]
    else:
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
    elif card_type == 'multipass':
        # "At risk" here means sessions still sitting on an active pack
        # that haven't been touched in 30+ days - mirrors the points-card
        # gate above, keyed on the outstanding session balance instead.
        churn_risk = sum(
            1 for c in customers
            if (c.get('multipass_sessions_remaining', 0) or 0) > 0
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
    elif card_type == 'multipass':
        # Pack exhausted right now (0 sessions left, pack was actually
        # issued) - the multipass equivalent of reward_unlocked: goal
        # reached, awaiting the customer to come back and renew.
        currently_unlocked = sum(
            1 for c in customers
            if (c.get('multipass_total_sessions', 0) or 0) > 0
            and (c.get('multipass_sessions_remaining', 0) or 0) <= 0
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
            "membership_services": [],
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
    if config.card_type == 'membership' and config.membership_services is not None:
        data['membership_services'] = [s.strip() for s in config.membership_services if s and s.strip()]
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

def add_months(d, months: int):
    """Calendar-correct month addition (handles month-end overflow, e.g. Jan
    31 + 1 month -> Feb 28/29, not Mar 3)."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)

def compute_next_due_date(start, frequency: str):
    if frequency == 'weekly':
        return start + timedelta(days=7)
    if frequency == 'biweekly':
        return start + timedelta(days=14)
    return add_months(start, 1)  # monthly

def compute_contract_financials(vehicle_price: Optional[float], down_payment: float, installment_amount: Optional[float], term_months: int, prefer_installment: bool = True):
    """No markup/interest - a financed deal's buyer-facing payment amount IS
    the loan math, nothing is added on top of it.

    prefer_installment=True (contract creation, and edits that only touch
    installment_amount): if installment_amount and term_months are both set,
    vehicle_price is DERIVED from them (down_payment + installment_amount *
    term_months). This is the normal financed-deal path.

    prefer_installment=False (edits that touch vehicle_price directly, or
    any case with no usable installment_amount/term_months - e.g. cash
    sales): vehicle_price is the source of truth, and installment_amount is
    computed from it instead (spread evenly over the term, or paid in one
    lump sum if term_months is 0).

    Returns (vehicle_price, principal_amount, total_payable, installment_amount).
    """
    down_payment = down_payment or 0
    if prefer_installment and installment_amount and term_months and term_months > 0:
        total_payable = round(installment_amount * term_months, 2)
        vehicle_price = round(down_payment + total_payable, 2)
        installment_amount = round(installment_amount, 2)
    else:
        vehicle_price = vehicle_price or 0
        total_payable = round(max(vehicle_price - down_payment, 0), 2)
        installment_amount = round(total_payable / term_months, 2) if term_months and term_months > 0 else total_payable
    principal_amount = round(max(vehicle_price - down_payment, 0), 2)
    return vehicle_price, principal_amount, total_payable, installment_amount

def compute_reminder_stage(next_due, today) -> Optional[str]:
    """Which of the 7-day / 3-day / due-today / overdue touchpoints (if any)
    today matches for a contract's next_due_date."""
    if not next_due:
        return None
    days = (next_due - today).days
    if days == 7:
        return '7_day'
    if days == 3:
        return '3_day'
    if days == 0:
        return 'due_today'
    if days < 0:
        return 'overdue'
    return None

def build_payment_reminder_email(business: dict, customer: dict, contract: dict, stage: str) -> tuple:
    name = html_lib.escape(customer.get('name') or 'there')
    biz_name = html_lib.escape(business.get('name') or 'us')
    amount = float(contract.get('installment_amount') or 0)
    due = html_lib.escape(str(contract.get('next_due_date') or ''))
    if stage == '7_day':
        subject = f"Payment reminder: due in 7 days - {biz_name}"
        lede = f"Your next payment of ₱{amount:,.2f} is due on {due} (7 days from now)."
    elif stage == '3_day':
        subject = f"Payment reminder: due in 3 days - {biz_name}"
        lede = f"Your next payment of ₱{amount:,.2f} is due on {due} (3 days from now)."
    elif stage == 'due_today':
        subject = f"Payment due today - {biz_name}"
        lede = f"Your payment of ₱{amount:,.2f} is due today ({due})."
    else:  # overdue
        subject = f"Payment overdue - {biz_name}"
        lede = f"Your payment of ₱{amount:,.2f} was due on {due} and hasn't been received yet. Please settle it as soon as you can."
    body = f"<p>Hi {name},</p><p>{lede}</p><p>Contact {biz_name} if you have questions about your account.</p>"
    return subject, body

def build_cl_wallet_reminder_text(contract: dict, stage: str) -> tuple:
    """Wallet-push equivalent of build_payment_reminder_email() - short
    header/body for Google's addMessage, plus a compact string for Apple's
    NEXT DUE field (that field's *value* has to actually change stage to
    stage for PassKit to fire a notification - see build_cl_apple_pass_json).
    Returns (header, body, short_display)."""
    amount = float(contract.get('installment_amount') or 0)
    due = contract.get('next_due_date') or ''
    if stage == '7_day':
        return ('Payment due in 7 days', f'Your next payment of ₱{amount:,.2f} is due on {due}.', f'Due in 7 days ({due})')
    if stage == '3_day':
        return ('Payment due in 3 days', f'Your next payment of ₱{amount:,.2f} is due on {due}.', f'Due in 3 days ({due})')
    if stage == 'due_today':
        return ('Payment due today', f'Your payment of ₱{amount:,.2f} is due today.', 'Due today')
    return ('Payment overdue', f'Your payment of ₱{amount:,.2f} was due on {due} and is now overdue.', f'Overdue since {due}')

def build_cl_announcement_email(business: dict, title: str, message: str) -> tuple:
    biz_name = html_lib.escape(business.get('name') or 'Your dealer')
    safe_title = html_lib.escape(title)
    safe_message = html_lib.escape(message).replace('\n', '<br>')
    subject = f"{biz_name}: {title}"
    body = (
        f"<p><strong>{safe_title}</strong></p>"
        f"<p>{safe_message}</p>"
        f"<p style='color:#94a3b8;font-size:12px;'>Sent by {biz_name} via LoyaltyTree.</p>"
    )
    return subject, body

# CAR LENDING / SHOWROOM - CUSTOMERS (BUYERS)

@app.get("/api/v1/business/{public_id}/cl-customers")
async def list_cl_customers(public_id: str, search: Optional[str] = None):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        query = supabase.table("cl_customers").select("*").eq("business_id", business.get("id"))
        if search:
            # or_() takes a single comma-separated filter string - matches
            # name OR phone OR email against the same search term.
            like = f"%{search}%"
            query = query.or_(f"name.ilike.{like},phone.ilike.{like},email.ilike.{like}")
        res = query.order("created_at", desc=True).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/cl-customers")
async def create_cl_customer(public_id: str, customer: CLCustomerCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if customer.phone or customer.email:
        dup_field = find_cl_customer_duplicate(business.get('id'), customer.phone, customer.email)
        if dup_field:
            raise HTTPException(status_code=400, detail=f"Another customer already uses this {dup_field}.")

    customer_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'name': customer.name,
        'phone': customer.phone,
        'email': customer.email,
        'address': customer.address,
        'id_number': customer.id_number,
        'notes': customer.notes,
    }
    try:
        res = supabase.table("cl_customers").insert(customer_data).execute()
        return res.data[0] if res.data else customer_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.patch("/api/v1/business/{public_id}/cl-customers/{customer_public_id}")
async def update_cl_customer(public_id: str, customer_public_id: str, update: CLCustomerUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_cl_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return customer

    if 'phone' in update_data or 'email' in update_data:
        dup_field = find_cl_customer_duplicate(
            business.get('id'),
            update_data.get('phone'),
            update_data.get('email'),
            exclude_id=customer.get('id'),
        )
        if dup_field:
            raise HTTPException(status_code=400, detail=f"Another customer already uses this {dup_field}.")

    update_data['updated_at'] = datetime.utcnow().isoformat()
    try:
        res = supabase.table("cl_customers").update(update_data).eq("id", customer.get("id")).execute()
        updated_customer = res.data[0] if res.data else {**customer, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Name is the only field that shows on the pass face (accountName) -
    # publish it if it changed, silently.
    if 'name' in update_data:
        try:
            contract = get_active_contract_for_cl_customer(updated_customer.get('id'))
            sync_cl_wallet_object(updated_customer, business, contract)
            sync_cl_apple_wallet_pass(updated_customer)
        except Exception:
            pass

    return updated_customer

@app.delete("/api/v1/business/{public_id}/cl-customers/{customer_public_id}")
async def delete_cl_customer(public_id: str, customer_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_cl_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    # contracts.customer_id has no ON DELETE for this FK path being safe by
    # accident - it's ON DELETE CASCADE in the schema, so deleting a buyer
    # with an existing contract would silently wipe their deal/payment
    # history too. Block that here instead, same spirit as the vehicle
    # RESTRICT check below - once Step 4/5 land, an owner should close out
    # or transfer a contract before removing the customer record.
    try:
        existing = supabase.table("contracts").select("id").eq("customer_id", customer.get("id")).limit(1).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="This customer has a contract on file - resolve or remove it first.")
    except HTTPException:
        raise
    except Exception:
        pass  # contracts table not present yet (pre-Step 4) - nothing to block on

    try:
        supabase.table("cl_customers").delete().eq("id", customer.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Same orphaned-registration issue as delete_customer() above, just with
    # the 'cl-' prefix build_cl_apple_pass_json uses as this pass type's
    # serial number. Without this, the phone stays registered for a serial
    # whose cl_customers row is now gone, and every background refetch 404s
    # forever - so no future announcement or payment-reminder push ever
    # actually updates the pass on that device again. Best-effort: must
    # never block the customer delete itself.
    try:
        supabase.table("apple_wallet_registrations").delete().eq(
            "serial_number", f"cl-{customer_public_id}"
        ).execute()
    except Exception as e:
        print(f"APPLE WALLET registration cleanup error: {e}")

    return {"success": True, "deleted": customer_public_id}

@app.get("/api/v1/business/{public_id}/cl-customers/{customer_public_id}/qr-code")
async def get_cl_customer_qr_code(public_id: str, customer_public_id: str):
    """Encodes just the buyer's public_id (not a URL) - there's no payment
    portal for it to link to. It only ever gets read back by this same
    owner's own "Scan QR" button on the Payments tab, to look the buyer's
    contract up quickly instead of searching by name."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_cl_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    svg = generate_qr_svg(customer.get('public_id'))
    return JSONResponse({
        "svg": svg,
        "customer_public_id": customer.get('public_id'),
        "customer_name": customer.get('name', ''),
    })

@app.get("/api/v1/business/{public_id}/cl-customers/{customer_public_id}/wallet-qr-code")
async def get_cl_customer_wallet_qr_code(public_id: str, customer_public_id: str):
    """For buyers the owner already had on the books before this system
    existed (an imported, already-in-progress loan created via the
    'existing loan' toggle on the Contracts tab) - they never went through
    /cl-join, so they have no Wallet card yet. This encodes the actual
    /cl-wallet/{public_id} URL (unlike get_cl_customer_qr_code above, which
    encodes just the bare public_id for the owner's own payment-lookup
    scan) so the owner can show/print/share it and the buyer's own phone
    camera opens the Add-to-Wallet page directly."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_cl_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    wallet_url = f'{BASE_URL}/cl-wallet/{customer.get("public_id")}'
    svg = generate_qr_svg(wallet_url)
    return JSONResponse({
        "svg": svg,
        "wallet_url": wallet_url,
        "customer_public_id": customer.get('public_id'),
        "customer_name": customer.get('name', ''),
    })

@app.get("/api/v1/business/{public_id}/cl-join-qr-code")
async def get_cl_join_qr_code(public_id: str):
    """The dealership's own self-signup QR (one per business, not per
    buyer) - print it or display it in the showroom. Scanning it opens
    /cl-join/{public_id}, where a new buyer registers themselves and adds
    the Loan Card straight to Google/Apple Wallet, no owner data entry
    needed. Mirrors get_qr_code() for the loyalty side's /join page."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    join_url = f'{BASE_URL}/cl-join/{public_id}'
    svg = generate_qr_svg(join_url)
    return JSONResponse({
        "svg": svg,
        "join_url": join_url,
        "business_name": business.get("name", ""),
    })

@app.get("/api/v1/business/{public_id}/showroom-config")
async def get_showroom_config(public_id: str):
    """Hero banner + logo + owner-editable contact/inquiries note shown on
    the public /showroom page. Read straight off the businesses row - no
    separate table."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return {
        "hero_image_url": business.get("showroom_hero_image_url"),
        "contact_text": business.get("showroom_contact_text") or "",
        "logo_url": business.get("logo_url"),
    }

@app.post("/api/v1/business/{public_id}/showroom-config")
async def save_showroom_config(public_id: str, config: ShowroomConfigUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    update_data = {k: v for k, v in {
        'showroom_hero_image_url': config.hero_image_url,
        'showroom_contact_text': config.contact_text,
        'logo_url': config.logo_url,
    }.items() if v is not None}
    if not update_data:
        return await get_showroom_config(public_id)

    try:
        supabase.table("businesses").update(update_data).eq("id", business.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    return await get_showroom_config(public_id)

@app.get("/api/v1/business/{public_id}/showroom-qr-code")
async def get_showroom_qr_code(public_id: str):
    """QR that opens the public showroom page (/showroom/{public_id}) -
    print it, display it in the physical showroom, or drop it into
    marketing material. This is also the link surfaced inside the buyer's
    Google/Apple Wallet card (see build_cl_wallet_object /
    build_cl_apple_pass_json) so tapping through from the wallet pass lands
    here too."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    showroom_url = f'{BASE_URL}/showroom/{public_id}'
    svg = generate_qr_svg(showroom_url)
    return JSONResponse({
        "svg": svg,
        "showroom_url": showroom_url,
        "business_name": business.get("name", ""),
    })

# CAR LENDING / SHOWROOM - VEHICLE INVENTORY

@app.post("/api/v1/business/{public_id}/cloudinary-signature")
async def get_cloudinary_signature(public_id: str, purpose: Optional[str] = None):
    """Signs a Cloudinary upload. Used by AddVehicleModal (vehicle photos)
    and by LoyaltyCardCustomizer (program logo / hero banner photos) - both
    follow the same flow. The preset (LoyaltyTree_Images) is a SIGNED
    preset, so the browser can't hit Cloudinary directly - only params
    listed here are covered by the signature, so the frontend must send
    exactly these same params (plus file + api_key, which are never part of
    the signature) on the actual upload. Cloudinary's signing rule: sort
    params alphabetically by key, join as key=value&key2=value2 (no
    api_secret in that string), then sha1(that_string + api_secret).

    `purpose=branding` (sent by LoyaltyCardCustomizer) signs into a
    business-scoped branding/ folder instead of the default vehicles/
    folder, so logo/banner uploads don't get mixed in with vehicle photos.
    `purpose=contract` (sent by the Contracts tab's file attachments) signs
    into a business-scoped contracts/ folder instead - these are private
    deal documents (signed pages, buyer ID, etc), never shown on the public
    showroom, so keeping them out of vehicles/ also keeps them out of
    anything that lists a vehicle's showroom photos by folder.
    `purpose=agent_kyc` (sent by the showroom's Agent Sign Up popup) signs
    into a business-scoped agent-kyc/ folder for the camera-captured selfie
    + ID photo - also private, never shown on the public showroom."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if not CLOUDINARY_API_KEY or not CLOUDINARY_API_SECRET:
        raise HTTPException(status_code=503, detail="Cloudinary is not configured on this server")

    timestamp = int(datetime.utcnow().timestamp())
    if purpose == 'branding':
        folder = f'branding/{public_id}'
    elif purpose == 'contract':
        folder = f'contracts/{public_id}'
    elif purpose == 'agent_kyc':
        folder = f'agent-kyc/{public_id}'
    else:
        folder = f'vehicles/{public_id}'
    params_to_sign = {
        'folder': folder,
        'timestamp': timestamp,
        'upload_preset': CLOUDINARY_UPLOAD_PRESET,
    }
    to_sign = '&'.join(f'{k}={v}' for k, v in sorted(params_to_sign.items()))
    signature = hashlib.sha1((to_sign + CLOUDINARY_API_SECRET).encode('utf-8')).hexdigest()

    return {
        "signature": signature,
        "timestamp": timestamp,
        "api_key": CLOUDINARY_API_KEY,
        "cloud_name": CLOUDINARY_CLOUD_NAME,
        "upload_preset": CLOUDINARY_UPLOAD_PRESET,
        "folder": folder,
    }

@app.get("/api/v1/business/{public_id}/vehicles")
async def list_vehicles(public_id: str, status: Optional[str] = None):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        query = supabase.table("vehicles").select("*").eq("business_id", business.get("id"))
        if status:
            query = query.eq("status", status)
        res = query.order("created_at", desc=True).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/vehicles")
async def create_vehicle(public_id: str, vehicle: VehicleCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    # image_urls is the source of truth going forward; image_url (legacy
    # single-photo field, still read by anything not yet updated) is kept
    # in sync as just its first entry. Accept either on the way in, but
    # never store more than VEHICLE_MAX_PHOTOS.
    image_urls = [u for u in (vehicle.image_urls or ([vehicle.image_url] if vehicle.image_url else [])) if u][:VEHICLE_MAX_PHOTOS]

    vehicle_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'make': vehicle.make,
        'model': vehicle.model,
        'year': vehicle.year,
        'plate_number': vehicle.plate_number,
        'plate_end_in': vehicle.plate_end_in,
        'color': vehicle.color,
        'mileage': vehicle.mileage,
        'transmission': vehicle.transmission,
        'fuel_type': vehicle.fuel_type,
        'price': vehicle.price,
        'total_cost': vehicle.total_cost,
        'agent_name': vehicle.agent_name,
        'status': vehicle.status or 'available',
        'payment_type': vehicle.payment_type,
        'location': vehicle.location,
        'notes': vehicle.notes,
        'downpayment': vehicle.downpayment,
        'monthly_amortization_amount': vehicle.monthly_amortization_amount,
        'amortization_due_date': vehicle.amortization_due_date,
        'amortization_next_due': vehicle.amortization_next_due,
        'amortization_months_remaining': vehicle.amortization_months_remaining,
        'image_url': image_urls[0] if image_urls else None,
        'image_urls': image_urls,
    }
    try:
        res = supabase.table("vehicles").insert(vehicle_data).execute()
        return res.data[0] if res.data else vehicle_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.patch("/api/v1/business/{public_id}/vehicles/{vehicle_public_id}")
async def update_vehicle(public_id: str, vehicle_public_id: str, update: VehicleUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    vehicle = safe_get_vehicle(vehicle_public_id)
    if not vehicle or vehicle.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Vehicle not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return vehicle

    # Keep the legacy image_url field mirrored to image_urls[0] whenever the
    # gallery changes, and cap it to VEHICLE_MAX_PHOTOS. Sending image_urls: []
    # explicitly clears all photos (empty list isn't None, so it still lands
    # in update_data above).
    if 'image_urls' in update_data:
        capped = [u for u in (update_data.get('image_urls') or []) if u][:VEHICLE_MAX_PHOTOS]
        update_data['image_urls'] = capped
        update_data['image_url'] = capped[0] if capped else None

    update_data['updated_at'] = datetime.utcnow().isoformat()
    try:
        res = supabase.table("vehicles").update(update_data).eq("id", vehicle.get("id")).execute()
        return res.data[0] if res.data else {**vehicle, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/business/{public_id}/vehicles/{vehicle_public_id}")
async def delete_vehicle(public_id: str, vehicle_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    vehicle = safe_get_vehicle(vehicle_public_id)
    if not vehicle or vehicle.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Vehicle not found for this business")

    try:
        supabase.table("vehicles").delete().eq("id", vehicle.get("id")).execute()
    except Exception as e:
        error_msg = str(e)
        # contracts.vehicle_id is ON DELETE RESTRICT - Postgres will refuse
        # the delete outright once a contract references this vehicle.
        if 'foreign key' in error_msg.lower() or 'violates' in error_msg.lower():
            raise HTTPException(status_code=400, detail="This vehicle is linked to a contract - it can't be deleted while that contract exists.")
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    return {"success": True, "deleted": vehicle_public_id}

# CAR LENDING / SHOWROOM - CONTRACTS (DEALS)

@app.get("/api/v1/business/{public_id}/contracts")
async def list_contracts(public_id: str, status: Optional[str] = None):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        query = supabase.table("contracts").select("*").eq("business_id", business.get("id"))
        if status:
            query = query.eq("status", status)
        res = query.order("created_at", desc=True).execute()
        contracts = res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Attach lightweight customer/vehicle summaries so the dashboard can show
    # "who" and "what car" per contract without an N+1 request per row.
    try:
        customer_ids = list({c.get('customer_id') for c in contracts if c.get('customer_id')})
        vehicle_ids = list({c.get('vehicle_id') for c in contracts if c.get('vehicle_id')})
        customers_by_id, vehicles_by_id = {}, {}
        if customer_ids:
            rows = supabase.table("cl_customers").select("id,public_id,name,phone").in_("id", customer_ids).execute().data or []
            customers_by_id = {r['id']: r for r in rows}
        if vehicle_ids:
            # total_cost/agent_name included so the dashboard can compute
            # per-contract profit (price - total_cost) and roll it up by
            # agent without a second round-trip per vehicle.
            rows = supabase.table("vehicles").select("id,public_id,make,model,year,plate_number,total_cost,agent_name").in_("id", vehicle_ids).execute().data or []
            vehicles_by_id = {r['id']: r for r in rows}
        for c in contracts:
            c['customer'] = customers_by_id.get(c.get('customer_id'))
            c['vehicle'] = vehicles_by_id.get(c.get('vehicle_id'))
    except Exception:
        pass  # best-effort - list still returns fine without the joined summaries

    return contracts

@app.post("/api/v1/business/{public_id}/contracts")
async def create_contract(public_id: str, contract: ContractCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_cl_customer(contract.customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    vehicle = safe_get_vehicle(contract.vehicle_public_id)
    if not vehicle or vehicle.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Vehicle not found for this business")
    if vehicle.get('status') == 'sold':
        raise HTTPException(status_code=400, detail="This vehicle is already marked sold.")

    try:
        start = datetime.fromisoformat(contract.start_date).date() if contract.start_date else datetime.utcnow().date()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid start_date - use YYYY-MM-DD")

    if contract.vehicle_price is None and not (contract.installment_amount and contract.term_months and contract.term_months > 0):
        raise HTTPException(
            status_code=400,
            detail="Provide a vehicle price, or a monthly payment and term (months) so it can be calculated"
        )

    vehicle_price, principal_amount, total_payable, installment_amount = compute_contract_financials(
        contract.vehicle_price, contract.down_payment, contract.installment_amount, contract.term_months
    )

    # next_due_date: an explicit override wins (used when transferring an
    # already-in-progress loan); otherwise compute it fresh from the start
    # date, unless this is a 0-month (paid-in-full) deal with nothing left
    # to schedule.
    next_due = None
    if contract.next_due_date:
        try:
            next_due = datetime.fromisoformat(contract.next_due_date).date()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid next_due_date - use YYYY-MM-DD")
    elif contract.term_months and contract.term_months > 0:
        next_due = compute_next_due_date(start, contract.payment_frequency)

    balance_remaining = contract.balance_remaining if contract.balance_remaining is not None else total_payable
    status = contract.status or ('completed' if balance_remaining <= 0 else 'active')

    contract_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'customer_id': customer.get('id'),
        'vehicle_id': vehicle.get('id'),
        'sale_type': contract.sale_type,
        'vehicle_price': vehicle_price,
        'down_payment': contract.down_payment,
        'principal_amount': principal_amount,
        'interest_rate': 0,
        'total_payable': total_payable,
        'term_months': contract.term_months,
        'payment_frequency': contract.payment_frequency,
        'installment_amount': installment_amount,
        'start_date': start.isoformat(),
        'last_paid_date': contract.last_paid_date,
        'next_due_date': next_due.isoformat() if next_due else None,
        'balance_remaining': balance_remaining,
        'status': status,
        'image_urls': [u for u in (contract.image_urls or []) if u][:CONTRACT_MAX_IMAGES],
    }

    try:
        res = supabase.table("contracts").insert(contract_data).execute()
        created = res.data[0] if res.data else contract_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Reflect the deal on the vehicle's inventory status right away.
    try:
        new_status = 'sold' if contract.sale_type == 'cash' else 'financed'
        supabase.table("vehicles").update({'status': new_status, 'updated_at': datetime.utcnow().isoformat()}).eq("id", vehicle.get("id")).execute()
    except Exception:
        pass

    created['customer'] = customer
    created['vehicle'] = vehicle
    return created

@app.patch("/api/v1/business/{public_id}/contracts/{contract_public_id}")
async def update_contract(public_id: str, contract_public_id: str, update: ContractUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    contract = safe_get_contract(contract_public_id)
    if not contract or contract.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Contract not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return contract

    if 'image_urls' in update_data:
        update_data['image_urls'] = [u for u in (update_data.get('image_urls') or []) if u][:CONTRACT_MAX_IMAGES]

    # If any of the deal's underlying inputs changed, recompute the derived
    # financial fields from the (possibly mixed new/existing) values.
    # Editing vehicle_price directly always wins for that request - it's
    # only DERIVED from installment_amount when the owner is editing the
    # monthly payment without also touching vehicle_price.
    recompute_keys = {'vehicle_price', 'down_payment', 'installment_amount', 'term_months'}
    if recompute_keys & update_data.keys():
        vehicle_price = update_data.get('vehicle_price', contract.get('vehicle_price'))
        down_payment = update_data.get('down_payment', contract.get('down_payment'))
        installment_amount = update_data.get('installment_amount', contract.get('installment_amount'))
        term_months = update_data.get('term_months', contract.get('term_months'))
        prefer_installment = 'installment_amount' in update_data and 'vehicle_price' not in update_data
        vehicle_price, principal_amount, total_payable, installment_amount = compute_contract_financials(
            vehicle_price, down_payment, installment_amount, term_months, prefer_installment=prefer_installment
        )
        update_data['vehicle_price'] = vehicle_price
        update_data['principal_amount'] = principal_amount
        update_data['total_payable'] = total_payable
        update_data['installment_amount'] = installment_amount

    update_data['updated_at'] = datetime.utcnow().isoformat()
    try:
        res = supabase.table("contracts").update(update_data).eq("id", contract.get("id")).execute()
        updated = res.data[0] if res.data else {**contract, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Keep the linked vehicle's inventory status in sync with a status
    # change that closes out or reopens the deal.
    try:
        if updated.get('status') == 'completed':
            supabase.table("vehicles").update({'status': 'sold', 'updated_at': datetime.utcnow().isoformat()}).eq("id", contract.get('vehicle_id')).execute()
        elif updated.get('status') in ('repossessed', 'cancelled'):
            supabase.table("vehicles").update({'status': 'available', 'updated_at': datetime.utcnow().isoformat()}).eq("id", contract.get('vehicle_id')).execute()
    except Exception:
        pass

    return updated

@app.delete("/api/v1/business/{public_id}/contracts/{contract_public_id}")
async def delete_contract(public_id: str, contract_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    contract = safe_get_contract(contract_public_id)
    if not contract or contract.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Contract not found for this business")

    try:
        supabase.table("cl_payments").delete().eq("contract_id", contract.get("id")).execute()  # future-proof once Step 5 exists
    except Exception:
        pass
    try:
        supabase.table("contracts").delete().eq("id", contract.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Deleting the deal frees the vehicle back up for sale.
    try:
        supabase.table("vehicles").update({'status': 'available', 'updated_at': datetime.utcnow().isoformat()}).eq("id", contract.get('vehicle_id')).execute()
    except Exception:
        pass

    return {"success": True, "deleted": contract_public_id}

# CAR LENDING / SHOWROOM - PAYMENTS

@app.get("/api/v1/business/{public_id}/contracts/{contract_public_id}/payments")
async def list_contract_payments(public_id: str, contract_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    contract = safe_get_contract(contract_public_id)
    if not contract or contract.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Contract not found for this business")
    try:
        res = (
            supabase.table("cl_payments")
            .select("*")
            .eq("contract_id", contract.get("id"))
            .order("payment_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/contracts/{contract_public_id}/payments")
async def log_contract_payment(public_id: str, contract_public_id: str, payment: CLPaymentCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    contract = safe_get_contract(contract_public_id)
    if not contract or contract.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Contract not found for this business")
    if contract.get('status') in ('completed', 'cancelled'):
        raise HTTPException(status_code=400, detail=f"This contract is {contract.get('status')} - no more payments to log.")

    try:
        pay_date = datetime.fromisoformat(payment.payment_date).date() if payment.payment_date else datetime.utcnow().date()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payment_date - use YYYY-MM-DD")

    prior_balance = float(contract.get('balance_remaining') or 0)
    new_balance = round(max(prior_balance - payment.amount, 0), 2)
    is_paid_off = new_balance <= 0

    payment_public_id = generate_public_id()
    payment_data = {
        'business_id': business.get('id'),
        'contract_id': contract.get('id'),
        'public_id': payment_public_id,
        'amount': payment.amount,
        'payment_date': pay_date.isoformat(),
        'method': payment.method,
        'notes': payment.notes,
        'balance_after': new_balance,
        # Short, human-readable receipt number derived from the payment's own
        # public_id - unique without a separate counter/sequence table, and
        # stable even if two payments are logged in the same second.
        'receipt_number': f"RCPT-{payment_public_id[:8].upper()}",
    }
    try:
        res = supabase.table("cl_payments").insert(payment_data).execute()
        created_payment = res.data[0] if res.data else payment_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Roll the payment into the contract: clear any overdue flag, push the
    # due date forward one cycle, and close the loan out once fully paid.
    # A fresh payment also resets the reminder cycle for the new due date.
    contract_update = {
        'balance_remaining': new_balance,
        'last_paid_date': pay_date.isoformat(),
        'last_reminder_stage': None,
        'updated_at': datetime.utcnow().isoformat(),
    }
    if is_paid_off:
        contract_update['status'] = 'completed'
        contract_update['next_due_date'] = None
    else:
        contract_update['status'] = 'active'
        contract_update['next_due_date'] = compute_next_due_date(
            pay_date, contract.get('payment_frequency') or 'monthly'
        ).isoformat()

    try:
        res = supabase.table("contracts").update(contract_update).eq("id", contract.get("id")).execute()
        updated_contract = res.data[0] if res.data else {**contract, **contract_update}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    if is_paid_off:
        try:
            supabase.table("vehicles").update(
                {'status': 'sold', 'updated_at': datetime.utcnow().isoformat()}
            ).eq("id", contract.get('vehicle_id')).execute()
        except Exception:
            pass

    # Publish the new balance/due date straight to whatever Wallet card this
    # buyer already added - same "sync after the thing that changed the
    # balance" pattern as the loyalty side's stamp/points endpoints. This is
    # the only place the buyer ever sees the payment reflect - there's no
    # payment portal for them to check.
    try:
        cl_customer = safe_get_cl_customer_by_id(contract.get('customer_id'))
        if cl_customer:
            notify_header = "Loan paid off! 🎉" if is_paid_off else "Payment received ✅"
            notify_body = (
                "Your loan is fully paid off - thanks for financing with us!"
                if is_paid_off else
                f"₱{payment.amount:,.0f} received. New balance: ₱{new_balance:,.0f}"
            )
            sync_cl_wallet_object(
                cl_customer, business, updated_contract,
                notify_header=notify_header,
                notify_body=notify_body,
                notify_message_id=f"cl-payment-{payment_public_id}",
            )
            sync_cl_apple_wallet_pass(cl_customer)
    except Exception:
        pass  # best-effort - a wallet push failing should never block the payment itself

    created_payment['contract'] = updated_contract
    return created_payment

@app.delete("/api/v1/business/{public_id}/contracts/{contract_public_id}/payments/{payment_public_id}")
async def delete_contract_payment(public_id: str, contract_public_id: str, payment_public_id: str):
    """Undo a payment logged by mistake. Only the most recent payment on the
    contract can be undone, so balance_remaining never drifts out of sync
    with the payment log - correcting an older one means undoing everything
    after it, in order."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    contract = safe_get_contract(contract_public_id)
    if not contract or contract.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Contract not found for this business")

    try:
        pay_res = (
            supabase.table("cl_payments")
            .select("*")
            .eq("public_id", payment_public_id)
            .eq("contract_id", contract.get("id"))
            .maybe_single()
            .execute()
        )
        payment = pay_res.data
    except Exception:
        payment = None
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found for this contract")

    try:
        latest = (
            supabase.table("cl_payments")
            .select("public_id")
            .eq("contract_id", contract.get("id"))
            .order("payment_date", desc=True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    if not latest.data or latest.data[0].get('public_id') != payment_public_id:
        raise HTTPException(status_code=400, detail="Only the most recent payment on this contract can be undone.")

    restored_balance = round(float(contract.get('balance_remaining') or 0) + float(payment.get('amount') or 0), 2)
    contract_update = {
        'balance_remaining': restored_balance,
        'status': 'active',
        'updated_at': datetime.utcnow().isoformat(),
    }
    try:
        supabase.table("cl_payments").delete().eq("id", payment.get("id")).execute()
        res = supabase.table("contracts").update(contract_update).eq("id", contract.get("id")).execute()
        updated_contract = res.data[0] if res.data else {**contract, **contract_update}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Undoing a payment moves the balance back up - publish that to the
    # Wallet card too, silently (no push banner - this is a correction, not
    # news worth notifying the buyer about).
    try:
        cl_customer = safe_get_cl_customer_by_id(contract.get('customer_id'))
        if cl_customer:
            sync_cl_wallet_object(cl_customer, business, updated_contract)
            sync_cl_apple_wallet_pass(cl_customer)
    except Exception:
        pass

    return {"success": True, "deleted": payment_public_id, "contract": updated_contract}

@app.patch("/api/v1/business/{public_id}/contracts/{contract_public_id}/payments/{payment_public_id}")
async def update_contract_payment(public_id: str, contract_public_id: str, payment_public_id: str, update: CLPaymentUpdate):
    """Owner-side correction of a logged payment - see CLPaymentUpdate for
    why amount/payment_date are restricted to the most recent payment."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    contract = safe_get_contract(contract_public_id)
    if not contract or contract.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Contract not found for this business")

    try:
        pay_res = (
            supabase.table("cl_payments")
            .select("*")
            .eq("public_id", payment_public_id)
            .eq("contract_id", contract.get("id"))
            .maybe_single()
            .execute()
        )
        payment = pay_res.data
    except Exception:
        payment = None
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found for this contract")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return payment

    amount_changed = 'amount' in update_data and round(float(update_data['amount']), 2) != round(float(payment.get('amount') or 0), 2)
    date_changed = 'payment_date' in update_data and update_data['payment_date'] != payment.get('payment_date')

    if amount_changed or date_changed:
        try:
            latest = (
                supabase.table("cl_payments")
                .select("public_id")
                .eq("contract_id", contract.get("id"))
                .order("payment_date", desc=True)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=friendly_db_error(e))
        if not latest.data or latest.data[0].get('public_id') != payment_public_id:
            raise HTTPException(
                status_code=400,
                detail="Only the most recent payment on this contract can have its amount or date edited. Undo it (and any payments after it) and re-log instead, or edit the method/notes only."
            )

    if 'payment_date' in update_data:
        try:
            new_pay_date = datetime.fromisoformat(update_data['payment_date']).date()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payment_date - use YYYY-MM-DD")
        update_data['payment_date'] = new_pay_date.isoformat()

    contract_update = {}
    if amount_changed:
        amount_diff = round(float(update_data['amount']) - float(payment.get('amount') or 0), 2)
        new_balance = round(max(float(contract.get('balance_remaining') or 0) - amount_diff, 0), 2)
        update_data['balance_after'] = new_balance
        contract_update['balance_remaining'] = new_balance

        is_paid_off = new_balance <= 0
        if is_paid_off:
            contract_update['status'] = 'completed'
            contract_update['next_due_date'] = None
        elif contract.get('status') == 'completed':
            # Editing the amount down reopened a loan that was previously
            # paid off - restart the due-date cycle from this payment.
            contract_update['status'] = 'active'
            base_date = datetime.fromisoformat(update_data.get('payment_date', payment.get('payment_date'))).date()
            contract_update['next_due_date'] = compute_next_due_date(base_date, contract.get('payment_frequency') or 'monthly').isoformat()

    if date_changed:
        contract_update['last_paid_date'] = update_data['payment_date']

    try:
        res = supabase.table("cl_payments").update(update_data).eq("id", payment.get("id")).execute()
        updated_payment = res.data[0] if res.data else {**payment, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    updated_contract = contract
    if contract_update:
        contract_update['updated_at'] = datetime.utcnow().isoformat()
        try:
            res = supabase.table("contracts").update(contract_update).eq("id", contract.get("id")).execute()
            updated_contract = res.data[0] if res.data else {**contract, **contract_update}
        except Exception as e:
            raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Amount/date edits can move the balance - publish it if they did.
    if contract_update:
        try:
            cl_customer = safe_get_cl_customer_by_id(contract.get('customer_id'))
            if cl_customer:
                sync_cl_wallet_object(cl_customer, business, updated_contract)
                sync_cl_apple_wallet_pass(cl_customer)
        except Exception:
            pass

    updated_payment['contract'] = updated_contract
    return updated_payment

@app.get("/api/v1/business/{public_id}/cl-customers/{customer_public_id}/payments")
async def list_customer_payment_history(public_id: str, customer_public_id: str):
    """Step 6: full receipt/payment history for one buyer across ALL of
    their contracts (not just the currently-open one) - what the Payments
    tab's per-contract history (Step 5) doesn't show, since that view only
    lists active/overdue loans. Ordered newest-first; each row carries
    enough of its parent contract + vehicle to render a standalone receipt
    (business name is looked up client-side from the already-loaded
    business object)."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_cl_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        contracts = (
            supabase.table("contracts")
            .select("id,public_id,vehicle_id,sale_type,status")
            .eq("customer_id", customer.get("id"))
            .execute()
        ).data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    if not contracts:
        return []

    contract_ids = [c['id'] for c in contracts]
    contracts_by_id = {c['id']: c for c in contracts}

    vehicle_ids = list({c.get('vehicle_id') for c in contracts if c.get('vehicle_id')})
    vehicles_by_id = {}
    if vehicle_ids:
        try:
            rows = supabase.table("vehicles").select("id,public_id,make,model,year,plate_number").in_("id", vehicle_ids).execute().data or []
            vehicles_by_id = {r['id']: r for r in rows}
        except Exception:
            pass

    try:
        payments = (
            supabase.table("cl_payments")
            .select("*")
            .in_("contract_id", contract_ids)
            .order("payment_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        ).data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    for p in payments:
        contract = contracts_by_id.get(p.get('contract_id')) or {}
        p['contract'] = {
            'public_id': contract.get('public_id'),
            'sale_type': contract.get('sale_type'),
            'status': contract.get('status'),
        }
        p['vehicle'] = vehicles_by_id.get(contract.get('vehicle_id'))

    return payments

# CAR LENDING / SHOWROOM - AGENT / BUYER / SELLER APPLICATIONS
# One shared table (cl_applications), split by `role`. Only the business
# owner's dashboard can create/edit/approve/reject these - there's no public
# self-service form yet, so every application here is logged by the owner
# (e.g. after receiving one by call/message) and then approved or rejected.

@app.get("/api/v1/business/{public_id}/applications")
async def list_cl_applications(public_id: str, role: Optional[str] = None, status: Optional[str] = None):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if role and role not in CL_APPLICATION_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {CL_APPLICATION_ROLES}")
    if status and status not in CL_APPLICATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {CL_APPLICATION_STATUSES}")
    try:
        query = supabase.table("cl_applications").select("*").eq("business_id", business.get("id"))
        if role:
            query = query.eq("role", role)
        if status:
            query = query.eq("status", status)
        res = query.order("created_at", desc=True).execute()
        # password_hash is only ever set on agent applications submitted via
        # cl-agent-signup (see CLAgentSignup) - never send it back out.
        return [{k: v for k, v in a.items() if k != 'password_hash'} for a in (res.data or [])]
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/applications")
async def create_cl_application(public_id: str, application: CLApplicationCreate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    application_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'role': application.role,
        'name': application.name,
        'phone': application.phone,
        'email': application.email,
        'notes': application.notes,
        'status': 'pending',
    }
    try:
        res = supabase.table("cl_applications").insert(application_data).execute()
        return res.data[0] if res.data else application_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.patch("/api/v1/business/{public_id}/applications/{application_public_id}")
async def update_cl_application(public_id: str, application_public_id: str, update: CLApplicationUpdate):
    """Covers plain edits (name/phone/email/notes) and the owner's
    approve/reject decision (status + review_note). Approving an agent
    application - whether it came in through the showroom's Agent Login KYC
    sign-up (has a password_hash/selfie_url/id_photo_url already attached)
    or was logged manually by the owner with none of that - provisions (or,
    matched by email, reuses) the real cl_agents account, and then the
    application row itself is DELETED rather than left sitting around with
    status='approved'. That's the whole point: an approved agent shows up
    exactly once, under the Agents tab (GET .../cl-agents), never still
    lingering on Applications too. Rejecting, or approving a buyer/seller
    application, never touches cl_agents and never deletes the row - only
    an agent application, and only on first approval, takes this branch.
    The dashboard is the only caller of this endpoint, so there's no
    applicant-facing path that could set status itself."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    application = safe_get_cl_application(application_public_id)
    if not application or application.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Application not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return {k: v for k, v in application.items() if k != 'password_hash'}

    update_data['updated_at'] = datetime.utcnow().isoformat()
    newly_decided = 'status' in update_data and update_data['status'] != application.get('status')
    if newly_decided and update_data['status'] != 'pending':
        update_data['decided_at'] = datetime.utcnow().isoformat()

    newly_approved_agent = (newly_decided and update_data.get('status') == 'approved'
                             and application.get('role') == 'agent')

    # The normal path: plain edits, rejections, reopens, and approving a
    # buyer/seller application all just update the cl_applications row like
    # before. Approving an agent skips this - see below.
    if not newly_approved_agent:
        try:
            res = supabase.table("cl_applications").update(update_data).eq("id", application.get("id")).execute()
            updated = res.data[0] if res.data else {**application, **update_data}
        except Exception as e:
            raise HTTPException(status_code=500, detail=friendly_db_error(e))
        return {k: v for k, v in updated.items() if k != 'password_hash'}

    # An agent application just got approved for the first time. Merge in
    # whatever this same request also changed (name/phone/review_note) so
    # the agent account reflects the latest edit, then move it: provision
    # cl_agents (or reuse an existing account with the same email, so
    # re-approving/duplicate signups never create two), and delete the
    # cl_applications row so it stops showing up there.
    updated = {**application, **update_data}
    try:
        email = (updated.get('email') or '').strip().lower()
        existing = None
        if email:
            existing = supabase.table("cl_agents").select("*") \
                .eq("business_id", business.get("id")).eq("email", email).maybe_single().execute()
        if existing and existing.data:
            agent_row = existing.data
        else:
            insert_data = {
                'business_id': business.get('id'),
                'public_id': generate_public_id(),
                'name': updated.get('name'),
                'phone': updated.get('phone'),
                'address': updated.get('address'),
                'email': email or None,
                # Both None on a manually-logged application (no KYC
                # sign-up behind it) - that's fine, there's no login
                # flow enforcing these yet anyway.
                'password_hash': updated.get('password_hash'),
                'selfie_url': updated.get('selfie_url'),
                'id_photo_url': updated.get('id_photo_url'),
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat(),
            }
            agent_res = supabase.table("cl_agents").insert(insert_data).execute()
            agent_row = agent_res.data[0] if agent_res.data else insert_data
        supabase.table("cl_applications").delete().eq("id", application.get("id")).execute()
    except Exception as e:
        # The approval decision itself never got saved (this whole branch
        # runs before any DB write survives), so surface it distinctly from
        # a plain update failure - the owner knows to just try approving
        # again rather than ending up with a half-moved record.
        raise HTTPException(status_code=500, detail=f"Approving this agent failed: {friendly_db_error(e)}")

    return {**_cl_agent_public(agent_row), 'moved_to_agents': True}

@app.delete("/api/v1/business/{public_id}/applications/{application_public_id}")
async def delete_cl_application(public_id: str, application_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    application = safe_get_cl_application(application_public_id)
    if not application or application.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Application not found for this business")
    try:
        supabase.table("cl_applications").delete().eq("id", application.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    return {"success": True, "deleted": application_public_id}

# CAR LENDING / SHOWROOM - "Inquire to buy this car" -> lands directly in
# cl_applications (role='buyer'), NOT a separate table, so it shows up on
# the dashboard's existing Applications tab (Buyers Application) and goes
# through the normal approve/reject flow. No separate list/update
# endpoints needed - GET/PATCH .../applications already cover it.
@app.post("/api/v1/business/{public_id}/cl-buyer-inquiry")
async def cl_buyer_inquiry(public_id: str, inquiry: CLBuyerInquiry):
    """Public, unauthenticated - submitted by the "Inquire to buy this
    car" form on the vehicle detail popup of the public showroom. Always
    lands as a 'pending' cl_applications row with role='buyer'; only the
    owner's dashboard (Applications tab) can approve or reject it."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if business.get('status', '').upper() != 'ACTIVE':
        raise HTTPException(status_code=400, detail="This dealership isn't accepting inquiries right now.")
    if not inquiry.id_photo_url or not inquiry.id_photo_2_url or not inquiry.proof_of_billing_url or not inquiry.proof_of_income_url:
        raise HTTPException(status_code=400, detail="Both IDs, proof of billing, and proof of income are all required.")

    vehicle_id = None
    vehicle_label = None
    if inquiry.vehicle_public_id:
        vehicle = safe_get_vehicle(inquiry.vehicle_public_id)
        if vehicle and vehicle.get('business_id') == business.get('id'):
            vehicle_id = vehicle.get('id')
            vehicle_label = f"{vehicle.get('year') or ''} {vehicle.get('make', '')} {vehicle.get('model', '')}".strip()

    application_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'role': 'buyer',
        'name': inquiry.name,
        'phone': inquiry.phone,
        'address': inquiry.address,
        'referring_agent': inquiry.referring_agent,
        'vehicle_id': vehicle_id,
        'vehicle_label': vehicle_label,
        'id_photo_url': inquiry.id_photo_url,
        'id_photo_2_url': inquiry.id_photo_2_url,
        'proof_of_billing_url': inquiry.proof_of_billing_url,
        'proof_of_income_url': inquiry.proof_of_income_url,
        'make_offer': inquiry.make_offer,
        'trade_in_make': inquiry.trade_in_make if inquiry.make_offer else None,
        'trade_in_model': inquiry.trade_in_model if inquiry.make_offer else None,
        'trade_in_year': inquiry.trade_in_year if inquiry.make_offer else None,
        'trade_in_mileage': inquiry.trade_in_mileage if inquiry.make_offer else None,
        'add_cash_amount': inquiry.add_cash_amount if inquiry.make_offer else None,
        'add_cash_by': inquiry.add_cash_by if inquiry.make_offer else None,
        'status': 'pending',
    }
    try:
        res = supabase.table("cl_applications").insert(application_data).execute()
        return res.data[0] if res.data else application_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/cl-sell-your-car")
async def cl_sell_your_car(public_id: str, inquiry: CLSellerInquiry):
    """Public, unauthenticated - submitted by the "Sell your car" popup on
    the public showroom. Always lands as a 'pending' cl_applications row
    with role='seller'; only the owner's dashboard (Applications tab) can
    approve or reject it."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if business.get('status', '').upper() != 'ACTIVE':
        raise HTTPException(status_code=400, detail="This dealership isn't accepting submissions right now.")

    image_urls = [u for u in (inquiry.image_urls or []) if u][:VEHICLE_MAX_PHOTOS]

    application_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'role': 'seller',
        'name': inquiry.name,
        'phone': inquiry.phone,
        'address': inquiry.address,
        'image_urls': image_urls,
        'seller_make': inquiry.seller_make,
        'seller_model': inquiry.seller_model,
        'seller_year': inquiry.seller_year,
        'seller_transmission': inquiry.seller_transmission,
        'seller_mileage': inquiry.seller_mileage,
        'seller_price': inquiry.seller_price,
        'seller_type': inquiry.seller_type,
        'has_amortization': inquiry.has_amortization,
        'amortization_amount': inquiry.amortization_amount if inquiry.has_amortization else None,
        'amortization_due_date': inquiry.amortization_due_date if inquiry.has_amortization else None,
        'amortization_next_due': inquiry.amortization_next_due if inquiry.has_amortization else None,
        'amortization_months_remaining': inquiry.amortization_months_remaining if inquiry.has_amortization else None,
        'status': 'pending',
    }
    try:
        res = supabase.table("cl_applications").insert(application_data).execute()
        return res.data[0] if res.data else application_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

# CAR LENDING / SHOWROOM - AGENT ACCOUNTS (approved roster)
# An agent only ever lands here once their cl_applications row has been
# approved (see update_cl_application above, which provisions this row) -
# there's no separate approval step here, this is just the roster shown on
# the dashboard's Agents tab (next to Customers): details + KYC photo for
# whoever the owner has already let in.

def _cl_agent_public(agent: dict) -> dict:
    """Strips password_hash before an agent row goes back to the
    dashboard - the list/update responses below have no other reason to
    carry it."""
    return {k: v for k, v in agent.items() if k != 'password_hash'}

@app.get("/api/v1/business/{public_id}/cl-agents")
async def list_cl_agents(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("cl_agents").select("*").eq("business_id", business.get("id")) \
            .order("created_at", desc=True).execute()
        return [_cl_agent_public(a) for a in (res.data or [])]
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.patch("/api/v1/business/{public_id}/cl-agents/{agent_public_id}")
async def update_cl_agent(public_id: str, agent_public_id: str, update: CLAgentUpdate):
    """Editing an already-approved agent's own contact details only -
    name/phone/email. There's no status here to approve/reject; that
    decision already happened on the cl_applications row."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    agent = safe_get_cl_agent(agent_public_id)
    if not agent or agent.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Agent not found for this business")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        return _cl_agent_public(agent)
    update_data['updated_at'] = datetime.utcnow().isoformat()

    try:
        res = supabase.table("cl_agents").update(update_data).eq("id", agent.get("id")).execute()
        updated = res.data[0] if res.data else {**agent, **update_data}
        return _cl_agent_public(updated)
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/business/{public_id}/cl-agents/{agent_public_id}")
async def delete_cl_agent(public_id: str, agent_public_id: str):
    """Revokes an approved agent's account. Does not touch the original
    cl_applications row it was provisioned from - that stays as a record
    that it was once approved."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    agent = safe_get_cl_agent(agent_public_id)
    if not agent or agent.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Agent not found for this business")
    try:
        supabase.table("cl_agents").delete().eq("id", agent.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    return {"success": True, "deleted": agent_public_id}

# CAR LENDING / SHOWROOM - OWNER -> BUYER MESSAGES
# Distinct from the generic /announcements below (which push to Google/Apple
# Wallet card holders) - car-lending buyers don't have a wallet pass, so
# these go by email instead, either to one buyer or broadcast to everyone.

@app.get("/api/v1/business/{public_id}/cl-announcements")
async def list_cl_announcements(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = (
            supabase.table("cl_announcements")
            .select("*")
            .eq("business_id", business.get("id"))
            .order("created_at", desc=True)
            .execute()
        )
        items = res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    customer_ids = list({i.get('customer_id') for i in items if i.get('customer_id')})
    if customer_ids:
        try:
            rows = supabase.table("cl_customers").select("id,public_id,name").in_("id", customer_ids).execute().data or []
            by_id = {r['id']: r for r in rows}
            for i in items:
                i['customer'] = by_id.get(i.get('customer_id'))
        except Exception:
            pass
    return items

@app.post("/api/v1/business/{public_id}/cl-announcements")
async def create_cl_announcement(public_id: str, ann: CLAnnouncementCreate):
    """Wallet-push only, no email - see build_cl_wallet_reminder_text's
    sibling logic below. A single buyer (ann.customer_public_id set) gets a
    personalized push via their own Wallet object/pass. Omitting it
    broadcasts to every buyer's Wallet card for this business in one call
    each to Google/Apple - including buyers with no active loan (0/0 pass),
    so the whole membership can be reached regardless of loan status, same
    as requested. A buyer only receives this if they've added the wallet
    pass; there's no email fallback."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    target_customer = None
    if ann.customer_public_id:
        target_customer = safe_get_cl_customer(ann.customer_public_id)
        if not target_customer or target_customer.get('business_id') != business.get('id'):
            raise HTTPException(status_code=404, detail="Customer not found for this business")
        recipient_count = 1
    else:
        try:
            recipient_count = (
                supabase.table("cl_customers")
                .select("id", count="exact")
                .eq("business_id", business.get("id"))
                .execute()
            ).count or 0
        except Exception as e:
            raise HTTPException(status_code=500, detail=friendly_db_error(e))

    record = {
        'business_id': business.get('id'),
        'customer_id': target_customer.get('id') if target_customer else None,
        'title': ann.title,
        'message': ann.message,
        'recipient_count': recipient_count,
        'sent_count': 0,
    }
    try:
        res = supabase.table("cl_announcements").insert(record).execute()
        created = res.data[0] if res.data else record
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    message_id = f"cl-announcement-{created.get('id', generate_public_id())}"
    apple_accepted = 0
    google_sent = False

    if target_customer:
        contract = get_active_contract_for_cl_customer(target_customer.get('id'))
        # sync_cl_wallet_object PATCHes the pass's live data AND (since
        # notify_message_id is given) fires the TEXT_AND_NOTIFY push in the
        # same call - no separate send_wallet_object_message call needed.
        sync_cl_wallet_object(target_customer, business, contract, notify_header=ann.title, notify_body=ann.message, notify_message_id=message_id)
        google_sent = bool(get_google_access_token())
        sync_cl_apple_wallet_pass(target_customer)
        apple_accepted = 1 if APPLE_PASS_TYPE_IDENTIFIER else 0
    else:
        cl_class_id = business.get('cl_google_wallet_class_id') or f'{GOOGLE_WALLET_ISSUER_ID}.cl-{business.get("public_id", "")}'
        google_sent = send_wallet_class_message(cl_class_id, ann.title, ann.message, message_id)
        apple_accepted = push_cl_apple_wallet_announcement(business.get('id'))

    sent_count = apple_accepted + (1 if google_sent else 0)
    try:
        supabase.table("cl_announcements").update({'sent_count': sent_count}).eq("id", created.get("id")).execute()
    except Exception:
        pass

    created['sent_count'] = sent_count
    created['recipient_count'] = recipient_count
    created['google_sent'] = google_sent
    created['apple_pushes_accepted'] = apple_accepted
    if target_customer:
        created['customer'] = target_customer
    return created

# ANNOUNCEMENTS

@app.get("/api/v1/business/{public_id}/platform-announcements")
async def get_platform_announcements(public_id: str):
    """Active LoyaltyTree promos/announcements for this owner's dashboard,
    minus ones they've already dismissed. No admin auth needed here - any
    business can read the ones addressed to them, same trust level as
    reading their own /business/{id} record."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    today = datetime.utcnow().date().isoformat()
    try:
        res = (
            supabase.table("platform_announcements")
            .select("*")
            .eq("is_active", True)
            .order("created_at", desc=True)
            .execute()
        )
        all_active = res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Drop anything past its end_date - same "still running" check the
    # customer-facing announcements use.
    still_running = [a for a in all_active if not a.get('end_date') or a.get('end_date') >= today]

    try:
        dismissed_res = (
            supabase.table("platform_announcement_dismissals")
            .select("announcement_id")
            .eq("business_id", business.get("id"))
            .execute()
        )
        dismissed_ids = {row['announcement_id'] for row in (dismissed_res.data or [])}
    except Exception:
        dismissed_ids = set()  # best-effort - worst case an owner sees one they already dismissed

    return [a for a in still_running if a.get('id') not in dismissed_ids]

@app.post("/api/v1/business/{public_id}/platform-announcements/{announcement_id}/dismiss")
async def dismiss_platform_announcement(public_id: str, announcement_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        supabase.table("platform_announcement_dismissals").insert({
            'business_id': business.get('id'),
            'announcement_id': announcement_id,
            'dismissed_at': datetime.utcnow().isoformat(),
        }).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

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

@app.post("/api/v1/business/{public_id}/multipass/issue")
async def issue_multipass(public_id: str, req: MultipassIssueRequest, authorization: str = Header(default="")):
    """Multipass-card equivalent of the customer's first stamp: issues a
    fresh session pack, e.g. 12 sessions sold at the price of 10. Called
    whenever a customer buys a pack - their first one, or a renewal once
    their previous pack is used up or expired. Overwrites whatever pack the
    customer currently has, since a business runs ONE active card at a time
    and a customer only ever has one multipass in flight."""
    print(f"MULTIPASS ISSUE REQUEST: business={public_id}, customer={req.customer_public_id}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'multipass':
        raise HTTPException(status_code=400, detail="This business is not on a multi-pass card")

    issuing_staff_id = None
    issuing_branch_id = None

    # Same staff-session / owner / legacy-PIN auth pattern as /stamp and /points-sale.
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        issuing_staff_id = session_claims.get('staff_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            issuing_staff_id = staff_res.data[0].get('id')
            issuing_branch_id = staff_res.data[0].get('branch_id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    session_count = req.session_count or program.get('multipass_session_count', 12)
    validity_days = program.get('multipass_validity_days', 90)
    expires_at = (datetime.utcnow() + timedelta(days=validity_days)).date().isoformat()

    try:
        update_data = {
            'multipass_sessions_remaining': session_count,
            'multipass_total_sessions': session_count,
            'multipass_expires_at': expires_at,
            'updated_at': datetime.utcnow().isoformat(),
        }
        supabase.table("customers").update(update_data).eq("id", customer.get("id")).execute()
        customer.update(update_data)
        sync_wallet_object(
            customer, business, program,
            notify_header="New pass activated 🎟️",
            notify_body=f"You have {session_count} sessions - valid until {expires_at}.",
            notify_message_id=f"multipass-issue-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
        log_multipass_event(business.get('id'), customer.get('id'), 'issued', session_count, issuing_staff_id, issuing_branch_id)
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
                    f"Database schema mismatch: {error_msg}. Add 'multipass_sessions_remaining' "
                    f"(int, default 0), 'multipass_total_sessions' (int, default 0), and "
                    f"'multipass_expires_at' (date) columns to 'customers' in Supabase and run "
                    f"NOTIFY pgrst, 'reload schema'; before retrying."
                ),
            )
        raise HTTPException(status_code=500, detail=error_msg)

    return {
        "message": f"{session_count}-session pass issued!",
        "sessions_remaining": session_count,
        "sessions_total": session_count,
        "multipass_expires_at": expires_at,
    }

@app.post("/api/v1/business/{public_id}/multipass/use")
async def use_multipass_session(public_id: str, req: MultipassUseRequest, authorization: str = Header(default="")):
    """Multipass-card equivalent of /stamp: burns one session off the
    customer's current pack (e.g. checking off one of their 12 tooth-cleaning
    visits). Refuses if the pack is exhausted or has expired - the cashier
    should issue a new pack via /multipass/issue instead."""
    print(f"MULTIPASS USE REQUEST: business={public_id}, customer={req.customer_public_id}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'multipass':
        raise HTTPException(status_code=400, detail="This business is not on a multi-pass card")

    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    expires_at = customer.get('multipass_expires_at')
    today = datetime.utcnow().date().isoformat()
    if expires_at and expires_at < today:
        raise HTTPException(status_code=400, detail=f"This pass expired on {expires_at} - issue a new one")
    if sessions_remaining <= 0:
        raise HTTPException(status_code=400, detail="No sessions left on this pass - issue a new one")

    using_staff_id = None
    using_branch_id = None

    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        using_staff_id = session_claims.get('staff_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            using_staff_id = staff_res.data[0].get('id')
            using_branch_id = staff_res.data[0].get('branch_id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    new_remaining = sessions_remaining - 1

    try:
        supabase.table("customers").update({
            'multipass_sessions_remaining': new_remaining,
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", customer.get("id")).execute()
        customer['multipass_sessions_remaining'] = new_remaining
        sync_wallet_object(
            customer, business, program,
            notify_header="Session used ✅" if new_remaining > 0 else "Pass complete 🎉",
            notify_body=(f"{new_remaining} sessions left." if new_remaining > 0
                         else "You've used all your sessions - come back to buy a new pass!"),
            notify_message_id=f"multipass-use-{customer.get('id')}-{new_remaining}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
        log_multipass_event(business.get('id'), customer.get('id'), 'used', new_remaining, using_staff_id, using_branch_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "message": "Session used!",
        "sessions_remaining": new_remaining,
        "sessions_total": customer.get('multipass_total_sessions', 0),
    }

# MEMBERSHIP CARD - visit notes ("leaves")
#
# Unlike stamp/points/multipass, a membership card has no running balance -
# there's nothing on the customer row to increment. Every cashier visit just
# appends a dated note (service_name + optional note) to membership_events,
# and the owner dashboard reads that history back per member - like a
# patient chart. Wallet-pass sync, cashier UI, and analytics wiring come later;
# this is just the record-keeping backbone.

@app.post("/api/v1/business/{public_id}/membership/note")
async def add_membership_note(public_id: str, req: MembershipNoteRequest, authorization: str = Header(default="")):
    """Cashier logs one visit: what service the member came in for, and
    (usually) today's date. This is the membership-card equivalent of
    /stamp - the thing a cashier does at every visit."""
    print(f"MEMBERSHIP NOTE REQUEST: business={public_id}, customer={req.customer_public_id}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'membership':
        raise HTTPException(status_code=400, detail="This business is not on a membership card")

    noting_staff_id = None
    noting_branch_id = None

    # Same staff-session / owner / legacy-PIN auth pattern as /stamp, /points-sale, /multipass.
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        noting_staff_id = session_claims.get('staff_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = supabase.table("staff").select("*").eq("business_id", business.get("id")).eq("pin", req.staff_pin).execute()
            if not staff_res.data:
                raise HTTPException(status_code=403, detail="Invalid staff PIN")
            noting_staff_id = staff_res.data[0].get('id')
            noting_branch_id = staff_res.data[0].get('branch_id')
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Staff verification failed: {str(e)}")

    service_date = req.service_date or datetime.utcnow().date().isoformat()

    try:
        leaf = log_membership_event(
            business.get('id'), customer.get('id'), req.service_name.strip(),
            (req.note or '').strip() or None, service_date, noting_staff_id, noting_branch_id,
        )
        if leaf is None:
            raise Exception("insert failed")
        sync_wallet_object(
            customer, business, program,
            notify_header="Visit logged ✅",
            notify_body=f"Thanks for visiting! Service: {req.service_name.strip()}",
            notify_message_id=f"membership-{customer.get('id')}-{leaf.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        sync_apple_wallet_pass(customer)
    except Exception as e:
        error_msg = str(e)
        is_schema_mismatch = (
            'PGRST204' in error_msg
            or ('relation' in error_msg.lower() and 'does not exist' in error_msg.lower())
            or ('could not find' in error_msg.lower() and ('table' in error_msg.lower() or 'column' in error_msg.lower()))
        )
        if is_schema_mismatch:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Database schema mismatch: {error_msg}. Create a 'membership_events' table in "
                    f"Supabase (business_id, customer_id, service_name, note, service_date, staff_id, "
                    f"branch_id, created_at) and run NOTIFY pgrst, 'reload schema'; before retrying."
                ),
            )
        raise HTTPException(status_code=500, detail=error_msg)

    return {
        "message": "Visit noted",
        "leaf": leaf,
    }

@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/leaves")
async def get_membership_leaves(public_id: str, customer_public_id: str):
    """Owner dashboard: the full, dated activity history for one member -
    every service they've come in for, most recent first. This is the
    membership card's equivalent of a patient chart."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        res = (
            supabase.table("membership_events")
            .select("*")
            .eq("business_id", business.get("id"))
            .eq("customer_id", customer.get("id"))
            .order("service_date", desc=True)
            .order("created_at", desc=True)
            .execute()
        )
        leaves = res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    # Attach staff/branch names for display, same best-effort spirit as the
    # last_stamp_at attachment in get_customers - a lookup failure shouldn't
    # take the whole history down.
    try:
        staff_ids = {l.get('staff_id') for l in leaves if l.get('staff_id')}
        branch_ids = {l.get('branch_id') for l in leaves if l.get('branch_id')}
        staff_by_id, branch_by_id = {}, {}
        if staff_ids:
            staff_rows = supabase.table("staff").select("id,name").in_("id", list(staff_ids)).execute().data or []
            staff_by_id = {s.get('id'): s.get('name') for s in staff_rows}
        if branch_ids:
            branch_rows = supabase.table("branches").select("id,name").in_("id", list(branch_ids)).execute().data or []
            branch_by_id = {b.get('id'): b.get('name') for b in branch_rows}
        for l in leaves:
            l['staff_name'] = staff_by_id.get(l.get('staff_id'))
            l['branch_name'] = branch_by_id.get(l.get('branch_id'))
    except Exception:
        for l in leaves:
            l.setdefault('staff_name', None)
            l.setdefault('branch_name', None)

    return leaves

@app.api_route("/api/v1/business/{public_id}/leaves/{leaf_id}", methods=["PUT", "PATCH"])
async def update_membership_leaf(public_id: str, leaf_id: int, update: MembershipLeafUpdate):
    """Lets the owner fix a typo'd or mistaken visit note from the dashboard."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    update_data = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Nothing to update")

    try:
        existing = supabase.table("membership_events").select("id,customer_id").eq("id", leaf_id).eq("business_id", business.get("id")).maybe_single().execute()
        if not existing or not existing.data:
            raise HTTPException(status_code=404, detail="Leaf not found")
        res = supabase.table("membership_events").update(update_data).eq("id", leaf_id).execute()
        updated_leaf = (res.data or [None])[0]
        # Only the most recent leaf drives what the Wallet pass currently
        # shows (see get_membership_summary), so an edit only needs a
        # re-sync when it could have touched that leaf - best-effort, a
        # sync failure here shouldn't fail the edit itself.
        try:
            customer = safe_get_customer_by_id(existing.data.get('customer_id'))
            if customer:
                program = safe_get_loyalty_program(business.get('id'))
                sync_wallet_object(customer, business, program)
                sync_apple_wallet_pass(customer)
        except Exception as sync_err:
            print(f"MEMBERSHIP LEAF EDIT sync error: {sync_err}")
        return updated_leaf
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/business/{public_id}/leaves/{leaf_id}")
async def delete_membership_leaf(public_id: str, leaf_id: int):
    """Lets the owner remove a mistakenly-logged visit note."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    try:
        existing = supabase.table("membership_events").select("id,customer_id").eq("id", leaf_id).eq("business_id", business.get("id")).maybe_single().execute()
        if not existing or not existing.data:
            raise HTTPException(status_code=404, detail="Leaf not found")
        supabase.table("membership_events").delete().eq("id", leaf_id).execute()
        try:
            customer = safe_get_customer_by_id(existing.data.get('customer_id'))
            if customer:
                program = safe_get_loyalty_program(business.get('id'))
                sync_wallet_object(customer, business, program)
                sync_apple_wallet_pass(customer)
        except Exception as sync_err:
            print(f"MEMBERSHIP LEAF DELETE sync error: {sync_err}")
        return {"message": "Leaf deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

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
    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    sessions_total = customer.get('multipass_total_sessions', 0) or (program.get('multipass_session_count', 12) if program else 12)
    membership_summary = (
        get_membership_summary(business.get('id'), customer.get('id'))
        if card_type == 'membership' else None
    )

    png_bytes = generate_personalized_hero_image_bytes(
        primary_color, reward_name, stamps, stamp_goal, description,
        card_type=card_type, points_balance=points_balance,
        sessions_remaining=sessions_remaining, sessions_total=sessions_total,
        total_visits=(membership_summary['total_visits'] if membership_summary else 0),
        last_service_name=(membership_summary['last_service_name'] if membership_summary else None),
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

# CAR LENDING / SHOWROOM - GOOGLE WALLET CLASS MANAGEMENT
# Same PUT-then-fall-back-to-POST pattern as the loyalty version above,
# just persisted to businesses.cl_google_wallet_class_id instead of
# loyalty_programs.google_wallet_class_id (car lending has no "program"
# row - the class lives one level up, straight on the business).

@app.get("/api/v1/business/{public_id}/cl-wallet-class")
async def get_cl_wallet_class(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    class_id = business.get('cl_google_wallet_class_id') or f'{GOOGLE_WALLET_ISSUER_ID}.cl-{business.get("public_id", "")}'

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
            print(f"CL Google class fetch error: {e}")

    return {
        "class_id": class_id,
        "business_name": business.get("name", ""),
        "google_class_exists": google_data is not None,
        "google_class_data": google_data,
        # Both of these reflect the PLATFORM's shared Wallet credentials
        # (env vars), not anything per-business - a business can't bring
        # its own Apple/Google Wallet developer account here. Google still
        # needs the explicit "publish" step below because each business
        # gets its own loyaltyClass; Apple has no per-business setup step -
        # once the platform cert is configured, .pkpass generation just
        # works for every business automatically.
        "google_wallet_configured": bool(GOOGLE_WALLET_ISSUER_ID),
        "apple_wallet_configured": bool(
            APPLE_PASS_TYPE_IDENTIFIER and APPLE_TEAM_IDENTIFIER and APPLE_PASS_CERTIFICATE
            and APPLE_WWDR_CERTIFICATE and APPLE_PASS_AUTH_SECRET
        ),
    }

@app.post("/api/v1/business/{public_id}/cl-wallet-class")
async def create_or_update_cl_wallet_class(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if not GOOGLE_WALLET_ISSUER_ID:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_WALLET_ISSUER_ID is not set in environment variables. Set it to your Google Wallet Issuer ID and redeploy."
        )

    class_id = business.get('cl_google_wallet_class_id') or f'{GOOGLE_WALLET_ISSUER_ID}.cl-{business.get("public_id", "")}'
    loyalty_class = build_cl_wallet_class(business)

    access_token = get_google_access_token()
    if not access_token:
        raise HTTPException(status_code=500, detail="Could not get Google access token. Check GOOGLE_WALLET_CREDENTIALS.")

    def parse_response(resp):
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
            if resp.status_code == 404:
                resp = client.post(
                    'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass',
                    headers={"Authorization": f"Bearer {access_token}"},
                    json=loyalty_class
                )
                result = parse_response(resp)

            if resp.status_code in (200, 201):
                supabase.table("businesses").update({
                    'cl_google_wallet_class_id': class_id,
                    'updated_at': datetime.utcnow().isoformat(),
                }).eq("id", business.get("id")).execute()
                return {
                    "success": True,
                    "message": "Car-lending wallet class created/updated successfully",
                    "class_id": class_id,
                    "google_response": result,
                }
            else:
                error_detail = result.get('error', result) if isinstance(result, dict) else result
                raise HTTPException(status_code=500, detail=f"Google API error ({resp.status_code}): {error_detail}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"CL wallet class creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# CAR LENDING / SHOWROOM - BUYER WALLET PASS
# Mirrors get_wallet_pass()/get_apple_wallet_pass() below, but for
# cl_customers + their current contract instead of loyalty customers.

@app.get("/api/v1/cl-customer/{customer_public_id}/wallet-pass")
async def get_cl_wallet_pass(customer_public_id: str):
    customer = safe_get_cl_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    contract = get_active_contract_for_cl_customer(customer.get('id'))
    has_active_loan = bool(contract and contract.get('status') in ('active', 'overdue'))

    cl_object = build_cl_wallet_object(customer, business, contract)
    jwt_token = create_google_wallet_jwt(cl_object)
    save_url = f"https://pay.google.com/gp/v/save/{jwt_token}" if jwt_token else None

    return {
        "pass_data": {
            "business_name": business.get('name', ''),
            "customer_name": customer.get('name', ''),
            "customer_id": customer_public_id,
            "has_active_loan": has_active_loan,
            "balance_remaining": float(contract.get('balance_remaining') or 0) if has_active_loan else 0,
            "next_due_date": contract.get('next_due_date') if has_active_loan else None,
            "status": contract.get('status') if contract else None,
            "qr_code": customer_public_id,
        },
        "save_url": save_url,
        "apple_pass_url": f"{BASE_URL}/api/v1/cl-customer/{customer_public_id}/apple-wallet-pass",
        "cl_object": cl_object,
    }

@app.get("/api/v1/cl-customer/{customer_public_id}/apple-wallet-pass")
async def get_cl_apple_wallet_pass(customer_public_id: str):
    customer = safe_get_cl_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    contract = get_active_contract_for_cl_customer(customer.get('id'))
    announcement = get_latest_cl_announcement(business.get('id'))

    pkpass_bytes = build_cl_pkpass_bytes(customer, business, contract, announcement)
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
        headers={"Content-Disposition": f'attachment; filename="cl-{customer_public_id}.pkpass"'},
    )

@app.get("/cl-wallet/{customer_public_id}", response_class=HTMLResponse)
async def cl_customer_wallet_page(customer_public_id: str):
    """Simple 'Add to Wallet' page for a car-lending buyer - shares to the
    buyer once (SMS/email/in person) alongside their contract, or the owner
    hands them a QR code that points here. No payment portal, no login:
    just the two Wallet buttons, matching the loyalty wallet page's pattern
    at /wallet/{customer_public_id}."""
    customer = safe_get_cl_customer(customer_public_id)
    if not customer:
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Card not found</h1></div>")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1></div>")

    contract = get_active_contract_for_cl_customer(customer.get('id'))
    has_active_loan = bool(contract and contract.get('status') in ('active', 'overdue'))
    balance = float(contract.get('balance_remaining') or 0) if has_active_loan else 0
    due = contract.get('next_due_date') if has_active_loan else None
    biz_name = business.get('name', '')
    logo_url = business.get('logo_url')

    cl_object = build_cl_wallet_object(customer, business, contract)
    google_jwt = create_google_wallet_jwt(cl_object)
    google_wallet_html = ''
    if google_jwt:
        google_wallet_html = (
            '<a href="https://pay.google.com/gp/v/save/' + google_jwt + '" class="wallet-btn google-btn">'
            '&#127903; Add to Google Wallet</a>'
        )
    apple_wallet_html = (
        '<a href="' + BASE_URL + '/api/v1/cl-customer/' + customer_public_id + '/apple-wallet-pass" class="wallet-btn apple-btn">'
        '&#63743; Add to Apple Wallet</a>'
    )
    showroom_html = (
        '<a href="' + BASE_URL + '/showroom/' + html_lib.escape(business.get('public_id', '')) + '" class="wallet-btn showroom-btn">'
        '&#128663; Browse Showroom</a>'
    )
    logo_html = ''
    if logo_url:
        logo_html = '<img src="' + logo_url + '" style="width:64px;height:64px;border-radius:16px;object-fit:cover;margin-bottom:12px;" alt="Logo"/>'
    balance_html = (
        '<div style="text-align:center;margin:16px 0;">'
        '<div style="font-size:36px;font-weight:800;color:white;">₱' + f'{balance:,.0f}' + '</div>'
        '<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:2px;">balance remaining</div>'
        + ('<div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:8px;">Next due: ' + html_lib.escape(str(due)) + '</div>' if due else '')
        + '</div>'
        if has_active_loan else
        '<div style="text-align:center;margin:16px 0;">'
        '<div style="font-size:15px;color:rgba(255,255,255,0.85);">No active loan yet</div>'
        '<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px;">Add this card to get dealership updates</div>'
        '</div>'
    )

    html = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>' + html_lib.escape(biz_name) + '</title>'
        '<style>*{box-sizing:border-box;margin:0;padding:0}'
        'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        'background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);'
        'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
        '.card{background:white;border-radius:24px;padding:32px;max-width:400px;width:100%;'
        'box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}'
        '.loan-card{background:linear-gradient(135deg,#0f172a 0%,#334155 100%);'
        'border-radius:16px;padding:24px;color:white;margin-bottom:20px}'
        '.loan-card h2{font-size:20px;margin-bottom:4px}'
        '.loan-card h3{font-size:16px;opacity:0.9;margin-bottom:8px}'
        '.wallet-btn{display:block;width:100%;padding:14px;background:#1a73e8;color:white;'
        'text-decoration:none;border-radius:10px;font-weight:600;margin-bottom:12px;text-align:center}'
        '.apple-btn{background:#000000}'
        '.showroom-btn{background:#0d9488}'
        '</style></head><body>'
        '<div class="card"><div class="loan-card">'
        + logo_html +
        '<h2>' + html_lib.escape(biz_name) + '</h2>'
        '<h3>' + html_lib.escape(customer.get('name', '')) + '</h3>'
        + balance_html +
        '</div>'
        + apple_wallet_html + google_wallet_html + showroom_html +
        '</div></body></html>'
    )
    return HTMLResponse(html)

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

# CAR LENDING / SHOWROOM - SELF-SERVICE BUYER JOIN PAGE
# Mirrors /join/{business_public_id} + POST /api/v1/join/{business_public_id}
# above, but registers a cl_customers row instead of a loyalty customer, and
# the success screen offers the Loan Card wallet buttons (built from
# get_cl_wallet_pass / get_cl_apple_wallet_pass) instead of a stamp QR.
# The owner prints/displays the QR from GET .../cl-join-qr-code so new
# buyers can register themselves without any dashboard data entry.

@app.get("/cl-join/{business_public_id}", response_class=HTMLResponse)
async def cl_customer_join_page(business_public_id: str):
    try:
        business = safe_get_business(business_public_id)
        if not business:
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1><p>This link is invalid.</p></div>")
        if business.get('status', '').upper() != 'ACTIVE':
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not active</h1><p>This dealership isn't accepting new members yet.</p></div>")

        biz_name = business.get('name', '')
        logo_url = business.get('logo_url')
        biz_name_json = json.dumps(biz_name)

        if logo_url:
            logo_html = '<img src="' + logo_url + '" style="width:80px;height:80px;border-radius:20px;object-fit:cover;margin:0 auto 20px;display:block;" alt="Logo"/>'
        else:
            logo_html = '<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#0f172a 0%,#334155 100%);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;">&#128663;</div>'

        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
            '<title>Join ' + html_lib.escape(biz_name) + '</title>'
            '<style>'
            '*{box-sizing:border-box;margin:0;padding:0}'
            'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
            'background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);'
            'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
            '.card{background:white;border-radius:24px;padding:32px;max-width:400px;width:100%;'
            'box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}'
            'h1{font-size:24px;color:#1e293b;margin-bottom:8px}'
            '.subtitle{color:#64748b;margin-bottom:24px;font-size:14px}'
            'input{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;'
            'font-size:16px;margin-bottom:12px;outline:none}'
            'input:focus{border-color:#0f172a}'
            'button{width:100%;padding:16px;background:linear-gradient(135deg,#0f172a 0%,#334155 100%);'
            'color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}'
            '.member-id{background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:16px}'
            '.member-id p{margin:0;font-weight:600;color:#1e293b}'
            '.member-id code{display:block;margin-top:8px;font-family:monospace;font-size:14px;color:#64748b;word-break:break-all}'
            '.wallet-btn{display:block;width:100%;padding:14px;background:#1a73e8;color:white;text-decoration:none;'
            'border-radius:10px;font-weight:600;margin-bottom:12px;text-align:center}'
            '.apple-btn{background:#000000}'
            '</style></head><body>'
            '<div class="card" id="card">'
            + logo_html +
            '<h1>' + html_lib.escape(biz_name) + '</h1>'
            '<p class="subtitle">Register as a buyer/member — add your card to your phone\'s wallet for balance, due-date reminders, and dealership updates.</p>'
            '<form id="signupForm">'
            '<input type="text" id="name" placeholder="Full name" required>'
            '<input type="tel" id="phone" placeholder="Phone number" required>'
            '<input type="email" id="email" placeholder="Email (optional)">'
            '<input type="text" id="address" placeholder="Address (optional)">'
            '<button type="submit">Join &amp; Add to Wallet</button>'
            '</form></div>'
            '<script>'
            '(function(){'
            'const API_BASE=' + json.dumps(BASE_URL) + ';'
            'const BIZ_ID=' + json.dumps(business_public_id) + ';'
            'const BIZ_NAME=' + biz_name_json + ';'
            'document.getElementById("signupForm").addEventListener("submit",async function(e){'
            'e.preventDefault();'
            'const name=document.getElementById("name").value;'
            'const phone=document.getElementById("phone").value;'
            'const email=document.getElementById("email").value;'
            'const address=document.getElementById("address").value;'
            'try{'
            'const res=await fetch(API_BASE+"/api/v1/cl-join/"+BIZ_ID,{'
            'method:"POST",'
            'headers:{"Content-Type":"application/json"},'
            'body:JSON.stringify({name:name,phone:phone,email:email||null,address:address||null})'
            '});'
            'const data=await res.json();'
            'if(res.ok){'
            'var cardHtml='
            '"<div style=\'font-size:48px;margin-bottom:16px;\'>&#127881;</div>"+'
            '"<h1>Welcome, "+escapeHtml(data.name)+"!</h1>"+'
            '"<p style=\'color:#64748b;margin-bottom:24px;\'>You\'re registered with "+escapeHtml(BIZ_NAME)+"</p>"+'
            '"<div class=\'member-id\'><p>Your Member ID</p>"+'
            '"<code>"+escapeHtml(data.public_id)+"</code></div>"+'
            '"<a href=\'"+API_BASE+"/api/v1/cl-customer/"+escapeHtml(data.public_id)+"/apple-wallet-pass\' class=\'wallet-btn apple-btn\'>&#63743; Add to Apple Wallet</a>"+'
            '"<div id=\'wallet-btn-container\' style=\'margin-bottom:12px;\'>"+'
            '"<p style=\'color:#94a3b8;font-size:13px;\'>Loading Google Wallet...</p></div>"+'
            '"<p style=\'font-size:12px;color:#94a3b8;margin-top:16px;\'>Show this card to the dealership when you make a payment.</p>";'
            'document.getElementById("card").innerHTML=cardHtml;'
            'fetch(API_BASE+"/api/v1/cl-customer/"+data.public_id+"/wallet-pass")'
            '.then(function(r){return r.json();})'
            '.then(function(walletData){'
            'var container=document.getElementById("wallet-btn-container");'
            'if(walletData.save_url){'
            'container.innerHTML="<a href=\'"+escapeHtml(walletData.save_url)+"\' class=\'wallet-btn\' target=\'_blank\'>&#127903; Add to Google Wallet</a>";'
            '}else{'
            'container.innerHTML="<div style=\'background:#fef3c7;color:#92400e;padding:12px;border-radius:10px;font-size:13px;\'>&#9888; Could not generate Google Wallet link</div>";'
            '}'
            '})'
            '.catch(function(err){'
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

# Public "apply to become an agent/buyer/seller" page - linked from the
# showroom's contact block. Submits to POST /api/v1/cl-apply/{public_id},
# which always creates the row as 'pending' (see CLApplicationSelfSignup) -
# approval only ever happens from the owner's dashboard Applications tab.
APPLY_ROLE_LABELS = {
    'agent': ('Become an Agent', 'Tell us about your coverage area and experience.'),
    'buyer': ('Apply as a Buyer', 'Tell us your budget and what you\'re looking for.'),
    'seller': ('Sell Your Car', 'Tell us about the vehicle you want to list.'),
}

@app.get("/apply/{business_public_id}", response_class=HTMLResponse)
async def cl_application_page(business_public_id: str, role: Optional[str] = None):
    try:
        business = safe_get_business(business_public_id)
        if not business:
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1><p>This link is invalid.</p></div>")
        if business.get('status', '').upper() != 'ACTIVE':
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Not accepting applications</h1><p>This dealership isn't accepting applications yet.</p></div>")

        biz_name = business.get('name', '')
        logo_url = business.get('logo_url')
        default_role = role if role in APPLY_ROLE_LABELS else 'buyer'

        if logo_url:
            logo_html = '<img src="' + html_lib.escape(logo_url) + '" style="width:80px;height:80px;border-radius:20px;object-fit:cover;margin:0 auto 20px;display:block;" alt="Logo"/>'
        else:
            logo_html = '<div style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#0f172a 0%,#334155 100%);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;">&#128663;</div>'

        role_tabs_html = ''.join(
            '<button type="button" class="role-tab' + (' active' if k == default_role else '') + '" data-role="' + k + '">'
            + html_lib.escape(v[0]) + '</button>'
            for k, v in APPLY_ROLE_LABELS.items()
        )

        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
            '<title>Apply — ' + html_lib.escape(biz_name) + '</title>'
            '<style>'
            '*{box-sizing:border-box;margin:0;padding:0}'
            'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
            'background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);'
            'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}'
            '.card{background:white;border-radius:24px;padding:32px;max-width:420px;width:100%;'
            'box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}'
            'h1{font-size:22px;color:#1e293b;margin-bottom:4px}'
            '.subtitle{color:#64748b;margin-bottom:20px;font-size:14px}'
            '.role-tabs{display:flex;gap:6px;margin-bottom:20px;background:#f1f5f9;border-radius:12px;padding:4px}'
            '.role-tab{flex:1;padding:10px 6px;border:none;border-radius:9px;background:transparent;'
            'font-size:12px;font-weight:600;color:#64748b;cursor:pointer}'
            '.role-tab.active{background:#0f172a;color:white}'
            'input,textarea{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;'
            'font-size:16px;margin-bottom:12px;outline:none;font-family:inherit}'
            'textarea{min-height:80px;resize:vertical}'
            'input:focus,textarea:focus{border-color:#0f172a}'
            'button.submit-btn{width:100%;padding:16px;background:linear-gradient(135deg,#0f172a 0%,#334155 100%);'
            'color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}'
            '</style></head><body>'
            '<div class="card" id="card">'
            + logo_html +
            '<h1>' + html_lib.escape(biz_name) + '</h1>'
            '<p class="subtitle" id="role-subtitle">' + html_lib.escape(APPLY_ROLE_LABELS[default_role][1]) + '</p>'
            '<div class="role-tabs">' + role_tabs_html + '</div>'
            '<form id="applyForm">'
            '<input type="text" id="name" placeholder="Full name" required>'
            '<input type="tel" id="phone" placeholder="Phone number">'
            '<input type="email" id="email" placeholder="Email (optional)">'
            '<textarea id="notes" placeholder="Details"></textarea>'
            '<button type="submit" class="submit-btn">Submit application</button>'
            '</form></div>'
            '<script>'
            '(function(){'
            'const API_BASE=' + json.dumps(BASE_URL) + ';'
            'const BIZ_ID=' + json.dumps(business_public_id) + ';'
            'const ROLE_LABELS=' + json.dumps({k: v for k, v in APPLY_ROLE_LABELS.items()}) + ';'
            'let currentRole=' + json.dumps(default_role) + ';'
            'const tabs=document.querySelectorAll(".role-tab");'
            'const notesEl=document.getElementById("notes");'
            'const subtitleEl=document.getElementById("role-subtitle");'
            'function applyRoleUI(role){'
            'tabs.forEach(function(t){t.classList.toggle("active",t.dataset.role===role);});'
            'subtitleEl.textContent=ROLE_LABELS[role][1];'
            'notesEl.placeholder=role==="agent"?"Coverage area, experience, etc."'
            ':role==="seller"?"Vehicle make/model/year and asking price":"Budget, preferred vehicle, etc.";'
            '}'
            'applyRoleUI(currentRole);'
            'tabs.forEach(function(t){t.addEventListener("click",function(){currentRole=t.dataset.role;applyRoleUI(currentRole);});});'
            'document.getElementById("applyForm").addEventListener("submit",async function(e){'
            'e.preventDefault();'
            'const name=document.getElementById("name").value;'
            'const phone=document.getElementById("phone").value;'
            'const email=document.getElementById("email").value;'
            'const notes=notesEl.value;'
            'try{'
            'const res=await fetch(API_BASE+"/api/v1/cl-apply/"+BIZ_ID,{'
            'method:"POST",'
            'headers:{"Content-Type":"application/json"},'
            'body:JSON.stringify({role:currentRole,name:name,phone:phone||null,email:email||null,notes:notes||null})'
            '});'
            'const data=await res.json();'
            'if(res.ok){'
            'document.getElementById("card").innerHTML='
            '"<div style=\'font-size:48px;margin-bottom:16px;\'>&#9989;</div>"+'
            '"<h1>Application received!</h1>"+'
            '"<p style=\'color:#64748b;margin-top:8px;\'>"+escapeHtml(data.message||"We\'ll be in touch once it\'s reviewed.")+"</p>";'
            '}else{'
            'alert(data.detail||"Submission failed");'
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
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Error</h1><p>Could not load application page: " + str(e) + "</p></div>")

# Public showroom - lists every vehicle currently for sale (status
# 'available' or 'reserved'). A vehicle appears here the moment it's added
# via POST /vehicles and disappears the moment a contract is written against
# it (create_contract flips it to 'sold'/'financed') - no separate sync step
# needed, this just reads live off the vehicles table. Scanning the
# showroom QR (GET .../showroom-qr-code) or tapping the link on a buyer's
# Wallet loan card both land here.
SHOWROOM_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#0f172a;--muted:#64748b;--line:#e7eaf0;--accent:#0d9488;--accent-dark:#0b7c72;--paper:#f6f7fb}
html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--paper);color:var(--ink);padding-bottom:48px;-webkit-font-smoothing:antialiased}
a{color:inherit}

.hero{position:relative;height:460px;background-size:cover;background-position:center;background-color:var(--ink);isolation:isolate}
.hero-fallback{background:radial-gradient(120% 140% at 20% 0%,#1e293b 0%,#0f172a 55%,#020617 100%)}
.hero-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(2,6,23,0.25) 0%,rgba(2,6,23,0.55) 55%,rgba(2,6,23,0.92) 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;text-align:center;color:#fff;padding:28px 20px 26px}
.hero-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;
  color:#5eead4;background:rgba(13,148,136,0.16);border:1px solid rgba(94,234,212,0.3);padding:5px 12px;border-radius:999px;margin-bottom:14px}
.hero-eyebrow .dot{width:6px;height:6px;border-radius:50%;background:#2dd4bf;box-shadow:0 0 0 3px rgba(45,212,191,0.25)}
.hero-logo img{width:224px;height:224px;border-radius:32px;object-fit:cover;margin-bottom:10px;box-shadow:0 10px 32px rgba(0,0,0,0.4);border:3px solid rgba(255,255,255,0.15)}
.hero-logo{font-size:96px;margin-bottom:6px}
.hero h1{font-size:clamp(24px,5vw,34px);font-weight:800;letter-spacing:-0.02em}
.hero p{font-size:14px;opacity:0.78;margin-top:6px;max-width:440px}

.contact-wrap{display:flex;justify-content:center;margin-top:-16px;position:relative;z-index:5;padding:0 20px}
.contact-note{max-width:520px;text-align:center;background:#fff;border:1px solid var(--line);color:var(--ink);
  font-size:13.5px;line-height:1.5;padding:18px 22px;border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,0.08)}
.contact-note b{font-weight:700}
.connect-title{font-size:15px;font-weight:800;letter-spacing:-0.01em;margin-bottom:10px}
.connect-fb-btn{display:inline-flex;align-items:center;gap:8px;background:#1877f2;color:#fff;font-weight:700;
  font-size:13.5px;padding:10px 20px;border-radius:999px;text-decoration:none;box-shadow:0 6px 16px rgba(24,119,242,0.28)}
.connect-fb-btn:hover{background:#166fe0}
.connect-phones{margin-top:10px;font-size:13px;color:var(--muted)}
.connect-phones a{color:var(--ink);font-weight:700;text-decoration:none}
.connect-phones a:hover{text-decoration:underline}
.connect-apply-row{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);
  display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.connect-apply-link{font-size:12.5px;font-weight:700;color:var(--ink);text-decoration:none;
  background:#f1f5f9;padding:8px 14px;border-radius:999px;border:none;cursor:pointer;font-family:inherit}
.connect-apply-link:hover{background:#e2e8f0}

.stats-strip{max-width:1080px;margin:30px auto 0;padding:0 20px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.stats-strip h2{font-size:19px;font-weight:800;letter-spacing:-0.01em}
.stats-strip span{font-size:13px;color:var(--muted)}

.search-wrap{max-width:1080px;margin:14px auto 0;padding:0 20px}
.search-input{width:100%;box-sizing:border-box;padding:12px 16px 12px 42px;border:1px solid var(--line);border-radius:12px;
  font-size:14px;font-family:inherit;color:var(--ink);background:#fff url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>') no-repeat 14px center/16px 16px;
  outline:none;transition:border-color .15s ease}
.search-input:focus{border-color:var(--accent)}
.search-input::placeholder{color:#94a3b8}

.filter-bar{max-width:1080px;margin:14px auto 0;padding:0 20px;display:flex;gap:8px;flex-wrap:wrap}
.filter-chip{border:1px solid var(--line);background:#fff;color:var(--muted);font-size:12.5px;font-weight:600;
  padding:8px 14px;border-radius:999px;cursor:pointer;transition:all .15s ease;display:inline-flex;align-items:center;gap:7px}
.filter-chip:hover{border-color:#cbd5e1;color:var(--ink)}
.filter-chip.active{background:var(--ink);border-color:var(--ink);color:#fff}
.filter-chip .chip-count{color:inherit;opacity:0.55;font-weight:700}
.filter-chip.active .chip-count{opacity:0.75}

.make-filter-bar{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
.make-filter-bar::-webkit-scrollbar{height:5px}
.make-filter-bar::-webkit-scrollbar-thumb{background:var(--line);border-radius:999px}
.make-filter-bar .filter-chip{flex:0 0 auto}

.car-grid{max-width:1080px;margin:18px auto 0;padding:0 20px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px}
.car-card{background:#fff;border-radius:18px;overflow:hidden;border:1px solid var(--line);cursor:pointer;
  box-shadow:0 1px 3px rgba(15,23,42,0.04);transition:transform .2s ease,box-shadow .2s ease}
.car-card:hover{transform:translateY(-5px);box-shadow:0 18px 34px rgba(15,23,42,0.12)}

.car-gallery{position:relative;aspect-ratio:4/3;background:#e2e8f0;overflow:hidden;cursor:pointer}
.gal-track{display:flex;height:100%;transition:transform .35s cubic-bezier(.4,0,.2,1)}
.gal-track img{flex:0 0 100%;width:100%;height:100%;object-fit:cover;display:block;user-select:none;-webkit-user-drag:none}
.gal-btn{position:absolute;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;border:none;
  background:rgba(2,6,23,0.5);color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;opacity:0;transition:opacity .15s ease,background .15s ease;backdrop-filter:blur(2px)}
.car-gallery:hover .gal-btn{opacity:1}
.gal-btn:hover{background:rgba(2,6,23,0.75)}
.gal-btn.prev{left:8px}.gal-btn.next{right:8px}
.gal-dots{position:absolute;bottom:9px;left:0;right:0;display:flex;justify-content:center;gap:5px}
.gal-dots .dot{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,0.55);transition:all .15s ease}
.gal-dots .dot.active{background:#fff;width:14px;border-radius:3px}
.gal-count{position:absolute;top:9px;right:9px;background:rgba(2,6,23,0.55);color:#fff;font-size:10.5px;font-weight:600;
  padding:3px 8px;border-radius:999px;letter-spacing:0.02em}
.no-image{width:100%;aspect-ratio:4/3;background:linear-gradient(135deg,#eef1f6,#e2e8f0);display:flex;align-items:center;
  justify-content:center;font-size:44px;color:#b6c0cf}

.badge{position:absolute;top:10px;left:10px;z-index:2;display:inline-block;font-size:10.5px;font-weight:700;
  padding:4px 10px;border-radius:999px;letter-spacing:0.02em;box-shadow:0 4px 10px rgba(0,0,0,0.15)}
.badge.reserved{background:#fef3c7;color:#92400e}

.car-info{padding:16px 16px 18px}
.car-info h3{font-size:16px;font-weight:700;margin:2px 0 4px;letter-spacing:-0.01em}
.car-meta{font-size:12.5px;color:var(--muted)}
.car-price-row{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
.car-price{font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-0.01em}
.car-price small{font-size:11px;font-weight:600;color:var(--muted);margin-left:4px}

.empty-state{max-width:480px;margin:70px auto;text-align:center;color:var(--muted);padding:0 24px}
.empty-state .icon{font-size:42px;margin-bottom:10px;opacity:0.6}
.empty-state p{font-size:14px}

.location-wrap{max-width:1080px;margin:40px auto 0;padding:0 20px;text-align:center}
.location-title{font-size:19px;font-weight:800;letter-spacing:-0.01em;margin-bottom:6px}
.location-address{font-size:13.5px;color:var(--muted);margin-bottom:16px}
.location-map{border-radius:16px;overflow:hidden;border:1px solid var(--line);box-shadow:0 10px 24px rgba(15,23,42,0.06)}
.location-map iframe{display:block;width:100%;height:300px;border:0}
.location-directions-btn{display:inline-flex;align-items:center;gap:8px;background:var(--ink);color:#fff;font-weight:700;
  font-size:13.5px;padding:10px 20px;border-radius:999px;text-decoration:none;margin-top:16px}
.location-directions-btn:hover{opacity:0.88}

.footer{max-width:1080px;margin:44px auto 0;padding:20px 20px 0;text-align:center;color:#9aa4b2;font-size:11.5px;
  border-top:1px solid var(--line)}

.site-nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(16px);border-bottom:1px solid rgba(226,232,240,.9)}
.site-nav-inner{max-width:1180px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px}
.site-brand{display:flex;align-items:center;gap:10px;text-decoration:none;min-width:0}
.site-brand-mark{width:38px;height:38px;border-radius:11px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;font-size:20px}
.site-brand-mark img{width:100%;height:100%;object-fit:cover}
.site-brand-name{font-size:15px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.site-nav-links{display:flex;align-items:center;gap:18px}
.site-nav-links a{font-size:13px;font-weight:700;color:#475569;text-decoration:none}
.site-nav-links a:hover{color:var(--ink)}
.site-nav-cta{background:var(--ink)!important;color:#fff!important;padding:9px 15px;border-radius:999px}
.hero-home{min-height:560px;height:auto}
.hero-home .hero-overlay{align-items:flex-start;justify-content:center;text-align:left;padding:92px max(24px,calc((100vw - 1140px)/2)) 70px;background:linear-gradient(90deg,rgba(2,6,23,.94) 0%,rgba(2,6,23,.78) 44%,rgba(2,6,23,.22) 100%)}
.hero-copy{max-width:660px}
.hero-home .hero-logo{display:flex;align-items:center;gap:13px;font-size:42px;margin-bottom:18px}
.hero-home .hero-logo img{width:62px;height:62px;border-radius:16px;margin:0;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.hero-home h1{font-size:clamp(38px,6vw,68px);line-height:1.02;max-width:760px}
.hero-home .hero-subtitle{font-size:clamp(16px,2vw,20px);line-height:1.6;opacity:.88;max-width:620px;margin-top:18px}
.hero-cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.hero-primary-btn,.hero-secondary-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:13px 20px;font-size:14px;font-weight:800;text-decoration:none;border:none;cursor:pointer;font-family:inherit}
.hero-primary-btn{background:#fff;color:var(--ink)}
.hero-secondary-btn{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.3)}
.hero-actions{position:absolute;top:24px;right:max(20px,calc((100vw - 1140px)/2));z-index:4;display:flex;gap:8px}
.agent-login-btn{background:rgba(255,255,255,.94);color:var(--ink);border:none;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(2,6,23,.18)}
.hero-metrics{display:flex;gap:28px;flex-wrap:wrap;margin-top:34px}
.hero-metric strong{display:block;font-size:24px;color:#fff}.hero-metric span{display:block;font-size:12px;color:rgba(255,255,255,.68);margin-top:3px}
.trust-strip{max-width:1080px;margin:-34px auto 0;position:relative;z-index:8;padding:0 20px}
.trust-grid{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 16px 38px rgba(15,23,42,.11);display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden}
.trust-item{padding:21px 18px;text-align:center;border-right:1px solid var(--line)}.trust-item:last-child{border-right:none}
.trust-icon{font-size:23px}.trust-title{font-size:13px;font-weight:800;margin-top:7px}.trust-text{font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.45}
.home-section{max-width:1080px;margin:64px auto 0;padding:0 20px}
.home-kicker{font-size:11px;font-weight:800;letter-spacing:.12em;color:var(--accent);text-transform:uppercase}
.home-heading{font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-.035em;margin-top:8px}
.home-copy{font-size:14px;color:var(--muted);line-height:1.65;max-width:660px;margin-top:10px}
.inventory-shell{scroll-margin-top:86px}
.inventory-toolbar{max-width:1080px;margin:42px auto 0;padding:0 20px}
.inventory-toolbar .stats-strip,.inventory-toolbar .search-wrap,.inventory-toolbar .filter-bar{padding-left:0;padding-right:0;max-width:none}
.process-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px}
.process-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px}.process-n{width:34px;height:34px;border-radius:10px;background:#ccfbf1;color:#0f766e;display:flex;align-items:center;justify-content:center;font-weight:800}.process-card h3{font-size:15px;margin-top:15px}.process-card p{font-size:12.5px;color:var(--muted);line-height:1.55;margin-top:7px}
@media(max-width:760px){.site-nav-links a:not(.site-nav-cta){display:none}.hero-home{min-height:620px}.hero-home .hero-overlay{padding:100px 22px 58px;background:linear-gradient(180deg,rgba(2,6,23,.55),rgba(2,6,23,.96) 70%)}.hero-actions{top:18px;right:16px}.hero-actions #sell-car-btn{display:none}.trust-grid{grid-template-columns:repeat(2,1fr)}.trust-item:nth-child(2){border-right:none}.trust-item:nth-child(-n+2){border-bottom:1px solid var(--line)}.process-grid{grid-template-columns:1fr}.hero-metrics{gap:18px}.hero-metric strong{font-size:20px}}

.lightbox{display:none;position:fixed;inset:0;background:rgba(2,6,23,0.94);z-index:1000;align-items:center;justify-content:center}
.lightbox.open{display:flex}
.lightbox-img{max-width:88vw;max-height:78vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.5);object-fit:contain}
.lightbox-close{position:fixed;top:18px;right:20px;font-size:30px;line-height:1;color:#fff;background:rgba(255,255,255,0.08);
  border:none;width:42px;height:42px;border-radius:50%;cursor:pointer}
.lightbox-close:hover{background:rgba(255,255,255,0.16)}
.lightbox-nav{position:fixed;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;
  background:rgba(255,255,255,0.08);color:#fff;border:none;font-size:18px;cursor:pointer;transition:background .15s ease}
.lightbox-nav:hover{background:rgba(255,255,255,0.18)}
.lightbox-nav.prev{left:16px}.lightbox-nav.next{right:16px}
.lightbox-counter{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);color:#fff;font-size:12.5px;
  background:rgba(255,255,255,0.1);padding:5px 14px;border-radius:999px;letter-spacing:0.02em}

@media(max-width:520px){
  .hero{height:340px}
  .hero-logo img{width:140px;height:140px;border-radius:24px}
  .hero-logo{font-size:60px}
  .lightbox-nav{width:40px;height:40px;font-size:15px}
  .lightbox-nav.prev{left:8px}.lightbox-nav.next{right:8px}
}

.vehicle-modal{display:none;position:fixed;inset:0;background:rgba(2,6,23,0.6);z-index:900;
  align-items:center;justify-content:center;padding:20px}
.vehicle-modal.open{display:flex}
.vehicle-modal-card{background:#fff;border-radius:20px;max-width:480px;width:100%;max-height:88vh;
  overflow-y:auto;box-shadow:0 24px 60px rgba(2,6,23,0.35);position:relative}
.vehicle-modal-close{position:absolute;top:12px;right:12px;z-index:3;width:34px;height:34px;border-radius:50%;
  border:none;background:rgba(15,23,42,0.55);color:#fff;font-size:20px;line-height:1;cursor:pointer}
.vehicle-modal-close:hover{background:rgba(15,23,42,0.75)}
.vehicle-modal-gallery{position:relative;aspect-ratio:4/3;background:#e2e8f0;border-radius:20px 20px 0 0;overflow:hidden}
.vehicle-modal-gallery img{width:100%;height:100%;object-fit:cover;cursor:zoom-in;display:block}
.vehicle-modal-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;
  border:none;background:rgba(255,255,255,0.85);color:var(--ink);font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2)}
.vehicle-modal-nav.prev{left:12px}.vehicle-modal-nav.next{right:12px}
.vehicle-modal-count{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);color:#fff;font-size:12px;
  background:rgba(2,6,23,0.55);padding:4px 12px;border-radius:999px}
.vehicle-modal-body{padding:20px 22px 24px}
.vehicle-modal-body h3{font-size:19px;font-weight:800;letter-spacing:-0.01em;margin-bottom:4px}
.vehicle-modal-meta{font-size:13px;color:var(--muted);margin-bottom:14px}
.vehicle-modal-specs{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-bottom:16px}
.vehicle-modal-spec{display:flex;flex-direction:column;gap:2px}
.vehicle-modal-spec-label{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em}
.vehicle-modal-spec-value{font-size:13.5px;font-weight:600;color:var(--ink)}
.vehicle-modal-requirements{padding-top:14px;border-top:1px dashed var(--line);margin-bottom:16px}
.vehicle-modal-requirements h4{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px}
.vehicle-modal-requirements ul{list-style:none;display:flex;flex-direction:column;gap:6px}
.vehicle-modal-requirements li{font-size:13.5px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px}
.vehicle-modal-requirements li::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent);flex-shrink:0}
.vehicle-modal-price-row{display:flex;align-items:center;gap:10px;padding-top:14px;border-top:1px dashed var(--line);margin-bottom:16px}
.vehicle-modal-price{font-size:22px;font-weight:800;color:var(--ink);letter-spacing:-0.01em}
.vehicle-modal-call-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
  background:var(--accent);color:#fff;font-size:14.5px;font-weight:700;padding:13px 18px;border-radius:12px;
  text-decoration:none;transition:background .15s ease}
.vehicle-modal-call-btn:hover{background:var(--accent-dark)}

@media(max-width:520px){
  .vehicle-modal-card{max-height:92vh}
}

.hero-actions{position:absolute;top:16px;right:16px;z-index:6;display:flex;gap:8px}
.agent-login-btn{background:rgba(255,255,255,0.12);
  backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.35);color:#fff;font-size:12.5px;font-weight:700;
  padding:9px 16px;border-radius:999px;cursor:pointer;transition:background .15s ease;white-space:nowrap}
.agent-login-btn:hover{background:rgba(255,255,255,0.22)}

.agent-modal{display:none;position:fixed;inset:0;background:rgba(2,6,23,0.6);z-index:950;
  align-items:center;justify-content:center;padding:20px}
.agent-modal.open{display:flex}
.agent-modal-card{background:#fff;border-radius:20px;max-width:380px;width:100%;max-height:88vh;
  box-shadow:0 24px 60px rgba(2,6,23,0.35);position:relative;text-align:center;overflow:hidden;padding:0}
.agent-modal-scroll{max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:30px 26px 26px}
.agent-modal-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;
  border:none;background:#f1f5f9;color:var(--ink);font-size:18px;line-height:1;cursor:pointer;z-index:2}
.agent-modal-close:hover{background:#e2e8f0}
.agent-modal-title{font-size:19px;font-weight:800;letter-spacing:-0.01em;margin-bottom:4px}
.agent-modal-sub{font-size:13px;color:var(--muted);margin-bottom:18px}
.agent-modal-view input{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid var(--line);
  border-radius:11px;font-size:14px;margin-bottom:10px;outline:none;font-family:inherit}
.agent-modal-view input:focus{border-color:var(--accent)}
.agent-modal-submit{width:100%;padding:13px;background:var(--ink);color:#fff;border:none;border-radius:11px;
  font-size:14px;font-weight:700;cursor:pointer;margin-top:4px}
.agent-modal-submit:hover{opacity:0.9}
.agent-modal-secondary{background:#f1f5f9;color:var(--ink)}
.agent-modal-switch{margin-top:16px;font-size:12.5px;color:var(--muted)}
.agent-modal-switch a{color:var(--accent-dark);font-weight:700;text-decoration:none}
.agent-modal-switch a:hover{text-decoration:underline}
.agent-modal-error{background:#fef2f2;color:#b91c1c;font-size:12.5px;padding:9px 12px;border-radius:9px;
  margin-bottom:10px;text-align:left}
.agent-modal-success-icon{font-size:38px;margin-bottom:8px}
.agent-modal-hint{font-size:12.5px;color:var(--muted);margin-bottom:18px}

.agent-camera-block{margin-bottom:14px;text-align:left}
.agent-camera-label{display:block;font-size:11.5px;font-weight:700;color:var(--ink);margin-bottom:6px}
.agent-camera-frame{position:relative;width:100%;aspect-ratio:4/3;background:#0f172a;border-radius:12px;
  overflow:hidden;display:flex;align-items:center;justify-content:center}
.agent-camera-video,.agent-camera-preview{width:100%;height:100%;object-fit:cover;display:block}
.agent-camera-placeholder{font-size:30px;opacity:0.35;color:#fff}
.agent-camera-actions{display:flex;gap:8px;margin-top:8px}
.agent-camera-btn{flex:1;padding:9px 6px;border:1.5px solid var(--line);background:#fff;border-radius:9px;
  font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;font-family:inherit}
.agent-camera-btn:hover{border-color:#cbd5e1}
.agent-camera-btn-secondary{background:#f8fafc}
.agent-camera-status{font-size:11px;color:var(--muted);margin-top:6px;min-height:14px}
.agent-camera-status.error{color:#b91c1c}
.agent-camera-status.success{color:#0b7c72}

.inquiry-field-label{font-size:11.5px;font-weight:700;color:var(--ink);margin:12px 0 6px}
.agent-modal-view input[type=file]{padding:9px 10px;font-size:12px}
.inquiry-checkbox-row{display:flex;align-items:center;gap:8px;margin:16px 0 4px;font-size:13.5px;
  font-weight:700;cursor:pointer}
.inquiry-checkbox-row input{width:auto!important;padding:0!important;margin:0}
.inquiry-tradein{display:none;border-top:1px solid var(--line);padding-top:12px;margin-top:10px}
.inquiry-tradein.open{display:block}
.inquiry-radio-row{display:flex;gap:18px;font-size:13px;margin:6px 0 14px}
.inquiry-radio-row label{display:flex;align-items:center;gap:6px;font-weight:500;cursor:pointer}
.inquiry-radio-row input{width:auto!important;padding:0!important;margin:0}
.inquiry-contact-line{font-size:12.5px;color:var(--muted);text-align:center;margin-top:14px}
.inquiry-contact-line a{color:var(--accent-dark);font-weight:700;text-decoration:none}
.inquiry-contact-line a:hover{text-decoration:underline}

.sell-photos-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.sell-photo-thumb{position:relative;width:64px;height:64px;border-radius:9px;overflow:hidden;
  border:1.5px solid var(--line)}
.sell-photo-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.sell-photo-remove{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;
  border:none;background:rgba(2,6,23,0.7);color:#fff;font-size:11px;line-height:1;cursor:pointer;padding:0}
.sell-photo-add{width:64px;height:64px;border-radius:9px;border:1.5px dashed var(--line);background:#f8fafc;
  color:var(--muted);font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;
  justify-content:center;text-align:center;padding:4px}
.sell-photo-add:hover{border-color:#cbd5e1}
.sell-photo-count{font-size:11.5px;color:var(--muted);margin-bottom:4px}

@media(max-width:520px){
  .hero-actions{top:12px;right:12px;gap:6px}
  .agent-login-btn{font-size:11.5px;padding:7px 12px}
  .agent-modal-card{max-height:92vh}
  .agent-modal-scroll{max-height:92vh;padding:26px 20px 22px}
}


/* Premium showroom v2 */
.hero-clean{min-height:620px;background:#0b1220;overflow:hidden}
.hero-clean:before{content:"";position:absolute;inset:-20% -10% auto 45%;height:680px;background:radial-gradient(circle,rgba(13,148,136,.22),transparent 64%);pointer-events:none}
.hero-clean:after{content:"";position:absolute;inset:auto auto -260px -180px;width:620px;height:620px;border:1px solid rgba(255,255,255,.06);border-radius:50%;box-shadow:0 0 0 90px rgba(255,255,255,.02),0 0 0 180px rgba(255,255,255,.015);pointer-events:none}
.hero-clean .hero-overlay{position:relative;min-height:620px;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);align-items:center;gap:70px;max-width:1180px;margin:0 auto;padding:88px 20px 72px;background:none;text-align:left}
.hero-clean .hero-copy{max-width:720px}
.hero-clean .hero-logo{font-size:20px;margin-bottom:22px}
.hero-clean .hero-logo img{width:54px;height:54px;border-radius:14px}
.hero-clean h1{font-size:clamp(40px,5.8vw,72px);line-height:1.02;letter-spacing:-.055em;max-width:820px}
.hero-clean .hero-subtitle{font-size:17px;line-height:1.7;max-width:650px;margin-top:20px;color:#cbd5e1;opacity:1}
.hero-assurance-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 18px;margin-top:28px}
.hero-assurance-list div{display:flex;align-items:center;gap:10px;font-size:13px;color:#e2e8f0}
.hero-assurance-list span{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:rgba(45,212,191,.12);border:1px solid rgba(94,234,212,.28);color:#5eead4;font-weight:900;flex:0 0 auto}
.hero-assurance-list b{font-weight:650}
.hero-clean .hero-metrics{margin-top:30px;padding-top:26px;border-top:1px solid rgba(255,255,255,.1)}
.hero-visual{display:flex;justify-content:flex-end}
.hero-visual-card{width:min(100%,360px);padding:34px;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:linear-gradient(145deg,rgba(255,255,255,.1),rgba(255,255,255,.035));box-shadow:0 30px 80px rgba(0,0,0,.3);backdrop-filter:blur(20px)}
.hero-visual-mark{width:70px;height:70px;border-radius:22px;display:flex;align-items:center;justify-content:center;background:#fff;color:#0f172a;font-size:34px;margin-bottom:34px}
.hero-visual-label{font-size:12px;text-transform:uppercase;letter-spacing:.13em;color:#94a3b8;font-weight:800}
.hero-visual-number{font-size:84px;line-height:1;font-weight:850;letter-spacing:-.07em;margin-top:8px;color:#fff}
.hero-visual-copy{font-size:14px;line-height:1.65;color:#cbd5e1;margin-top:16px}
.hero-actions{top:20px;right:max(20px,calc((100vw - 1180px)/2))}
.trust-strip{margin-top:-34px;position:relative;z-index:6}
.trust-grid{box-shadow:0 18px 50px rgba(15,23,42,.10);border-radius:22px;background:#fff}
.trust-item{padding:26px 24px}
.trust-icon{background:#ecfdf5!important;color:#0f766e!important;border-radius:12px;width:42px;height:42px;display:flex;align-items:center;justify-content:center;font-size:18px!important;margin-bottom:14px}
.inventory-shell{background:#fff;border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7;padding:18px 0 54px;margin-top:14px}
.car-card{border-radius:16px;box-shadow:none}
.car-card:hover{transform:translateY(-3px);box-shadow:0 18px 42px rgba(15,23,42,.10)}
@media(max-width:900px){.hero-clean .hero-overlay{grid-template-columns:1fr;gap:38px;padding-top:104px}.hero-visual{display:none}.hero-clean h1{font-size:clamp(38px,9vw,62px)}}
@media(max-width:640px){.hero-clean{min-height:auto}.hero-clean .hero-overlay{min-height:auto;padding:100px 20px 58px}.hero-clean h1{font-size:40px}.hero-assurance-list{grid-template-columns:1fr}.hero-clean .hero-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.hero-clean .hero-metric{padding-right:4px}.hero-clean .hero-metric strong{font-size:20px}.hero-clean .hero-metric span{font-size:10px}.hero-actions{top:14px;right:14px}.trust-strip{margin-top:0;padding-top:16px}.trust-grid{grid-template-columns:1fr 1fr;border-radius:16px}.trust-item{padding:20px 16px}}

/* Mobile-first polish v3 */
.process-section{padding-bottom:72px!important;margin-bottom:0!important}
.connect-section{background:#0f172a;padding:72px 20px;margin-top:0}
.connect-section .contact-wrap{margin:0;padding:0}
.connect-section .contact-note{width:100%;max-width:760px;padding:34px;border:none;border-radius:22px;box-shadow:0 24px 60px rgba(2,6,23,.24)}
.connect-section .connect-title{font-size:24px;margin-bottom:16px}
.connect-section .connect-fb-btn{min-height:46px;padding:12px 22px}

@media(max-width:760px){
  body{padding-bottom:24px;overflow-x:hidden}
  .hero-actions{position:static;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 24px;width:100%}
  .hero-clean .hero-overlay{display:block;padding:22px 16px 44px}
  .hero-clean .hero-copy{max-width:none}
  .hero-clean .hero-logo{font-size:18px;margin-bottom:18px}
  .hero-clean .hero-logo img{width:46px;height:46px;border-radius:12px}
  .hero-clean h1{font-size:clamp(34px,10.5vw,46px);line-height:1.04;letter-spacing:-.045em}
  .hero-clean .hero-subtitle{font-size:15px;line-height:1.65;margin-top:16px}
  .hero-cta-row{display:grid!important;grid-template-columns:1fr;gap:10px;margin-top:22px}
  .hero-primary-btn,.hero-secondary-btn{width:100%;justify-content:center;text-align:center;min-height:48px}
  .hero-assurance-list{gap:10px;margin-top:24px}
  .hero-assurance-list div{align-items:flex-start;font-size:12.5px;line-height:1.45}
  .hero-clean .hero-metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin-top:24px;padding-top:20px}
  .hero-clean .hero-metric{min-width:0}
  .hero-clean .hero-metric strong{font-size:19px}
  .hero-clean .hero-metric span{font-size:9.5px;line-height:1.25}
  .trust-strip{padding:14px 14px 0}
  .trust-grid{grid-template-columns:1fr!important;gap:0;border-radius:18px;overflow:hidden}
  .trust-item{display:grid;grid-template-columns:42px 1fr;column-gap:12px;padding:17px 16px;border-bottom:1px solid #eef2f7}
  .trust-item:last-child{border-bottom:none}
  .trust-icon{grid-row:1/3;margin:0!important}
  .trust-title,.trust-text{text-align:left}
  .home-section{padding-left:16px!important;padding-right:16px!important}
  .home-heading{font-size:28px!important;line-height:1.12}
  .home-copy{font-size:14px!important;line-height:1.65}
  .inventory-shell{padding-top:10px;margin-top:0}
  .stats-strip,.search-wrap,.filter-bar,.car-grid,.location-wrap{padding-left:14px;padding-right:14px}
  .stats-strip{margin-top:20px}
  .stats-strip h2{font-size:18px}
  .filter-bar{flex-wrap:nowrap;overflow-x:auto;padding-bottom:5px;scrollbar-width:none}
  .filter-bar::-webkit-scrollbar{display:none}
  .filter-chip{flex:0 0 auto}
  .car-grid{grid-template-columns:1fr;gap:16px;margin-top:15px}
  .car-card{border-radius:16px}
  .car-gallery{aspect-ratio:16/11}
  .gal-btn{opacity:1;width:34px;height:34px}
  .car-info{padding:15px}
  .car-info h3{font-size:17px}
  .car-price{font-size:18px}
  .process-section{padding-top:54px!important;padding-bottom:58px!important}
  .process-grid{grid-template-columns:1fr!important;gap:12px!important}
  .process-card{padding:20px!important}
  .connect-section{padding:50px 14px}
  .connect-section .contact-note{padding:26px 18px;border-radius:18px}
  .connect-section .connect-title{font-size:22px}
  .connect-fb-btn{display:flex;width:100%;justify-content:center;border-radius:12px}
  .connect-phones{font-size:12.5px;line-height:1.7}
  .connect-apply-row{display:grid;grid-template-columns:1fr;gap:8px}
  .connect-apply-link{width:100%;border-radius:10px;padding:11px 12px}
  .location-wrap{margin-top:50px}
  .location-map iframe{height:240px}
  .location-directions-btn{width:100%;justify-content:center;border-radius:12px}
  .footer{margin-top:34px;padding-left:16px;padding-right:16px}
}

@media(max-width:380px){
  .hero-actions{grid-template-columns:1fr}
  .hero-clean h1{font-size:32px}
  .hero-clean .hero-metrics{grid-template-columns:1fr;gap:12px}
  .hero-clean .hero-metric{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:0 0 10px}
}
/* Agent conversion section */
.agent-cta-section{display:flex;align-items:center;justify-content:space-between;gap:32px;background:linear-gradient(135deg,#0f172a,#111827);color:#fff;border-radius:24px;margin-top:34px;margin-bottom:54px;padding:36px 40px;box-shadow:0 20px 55px rgba(15,23,42,.16)}
.agent-cta-section .home-heading,.agent-cta-section .home-copy{color:#fff}
.agent-cta-section .home-copy{max-width:720px;color:#cbd5e1}
.agent-cta-benefits{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:20px;color:#e2e8f0;font-size:14px;font-weight:700}
.agent-cta-btn{border:0;white-space:nowrap;min-width:190px}
.hero-secondary-btn{font-family:inherit;cursor:pointer}
.connect-apply-row{justify-content:center}
button,a{touch-action:manipulation}
@media(max-width:720px){.agent-cta-section{margin:26px 16px 42px;padding:26px 20px;display:block;border-radius:20px}.agent-cta-benefits{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:22px}.agent-cta-btn{width:100%}.hero-actions{padding:12px 14px}.hero-cta-row .hero-secondary-btn{width:100%}}

/* Phone layout repair v6 — desktop styles remain unchanged */
@media (max-width:760px){
  html,body{max-width:100%;overflow-x:hidden}
  .hero-clean{min-height:auto!important}
  .hero-clean .hero-overlay{display:block!important;min-height:auto!important;padding:18px 16px 42px!important;margin:0!important}
  .hero-actions{position:static!important;display:flex!important;justify-content:flex-end!important;width:100%!important;margin:0 0 22px!important;padding:0!important;gap:8px!important}
  .agent-login-btn{width:auto!important;min-height:42px;padding:10px 16px!important}
  .hero-clean .hero-logo{display:flex!important;align-items:center!important;gap:10px!important;margin:0 0 18px!important;font-size:17px!important;line-height:1.25!important}
  .hero-clean .hero-logo img{width:44px!important;height:44px!important;flex:0 0 44px!important}
  .hero-clean h1{font-size:clamp(32px,9.5vw,44px)!important;line-height:1.06!important;max-width:100%!important;overflow-wrap:anywhere}
  .hero-clean .hero-subtitle{font-size:15px!important;line-height:1.58!important;max-width:100%!important}
  .hero-cta-row{display:grid!important;grid-template-columns:1fr 1fr!important;gap:10px!important;width:100%!important;margin-top:22px!important}
  .hero-primary-btn,.hero-secondary-btn{box-sizing:border-box!important;width:100%!important;min-width:0!important;min-height:48px!important;padding:12px 10px!important;white-space:normal!important;line-height:1.25!important}
  .hero-assurance-list{display:grid!important;grid-template-columns:1fr!important;gap:10px!important;width:100%!important}
  .hero-assurance-list div{min-width:0!important}
  .hero-clean .hero-metrics{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;width:100%!important;gap:8px!important}
  .hero-clean .hero-metric{min-width:0!important;padding:0 4px!important}
  .hero-clean .hero-metric strong,.hero-clean .hero-metric span{overflow-wrap:anywhere}
  .trust-strip{margin:0!important;padding:14px 14px 0!important}
  .trust-grid{display:grid!important;grid-template-columns:1fr!important;width:100%!important}
  .trust-item{box-sizing:border-box!important;width:100%!important;border-right:0!important}
  .home-section,.inventory-toolbar,.car-grid,.location-wrap{box-sizing:border-box!important;width:100%!important;max-width:100%!important;margin-left:auto!important;margin-right:auto!important}
  .home-section{margin-top:46px!important;padding-left:16px!important;padding-right:16px!important}
  .inventory-toolbar{margin-top:30px!important;padding-left:14px!important;padding-right:14px!important}
  .stats-strip,.search-wrap,.filter-bar,.car-grid,.location-wrap{box-sizing:border-box!important;max-width:100%!important}
  .search-wrap input{box-sizing:border-box!important;width:100%!important;min-width:0!important}
  .filter-bar{display:flex!important;flex-wrap:nowrap!important;overflow-x:auto!important;overflow-y:hidden!important;gap:8px!important;-webkit-overflow-scrolling:touch}
  .car-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;padding-left:14px!important;padding-right:14px!important}
  .car-card,.car-gallery,.car-info{min-width:0!important;max-width:100%!important}
  .process-section{margin-bottom:0!important;padding-bottom:54px!important}
  .process-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important}
  .agent-cta-section{display:block!important;box-sizing:border-box!important;width:auto!important;margin:0 14px 46px!important;padding:26px 20px!important}
  .agent-cta-benefits{display:grid!important;grid-template-columns:1fr!important}
  .connect-section{clear:both!important;position:relative!important;margin:0!important;padding:48px 14px!important}
  .connect-section .contact-wrap,.connect-section .contact-note{box-sizing:border-box!important;width:100%!important;max-width:100%!important;margin:0!important}
  .connect-apply-row{display:grid!important;grid-template-columns:1fr!important;width:100%!important}
  .connect-apply-link,.connect-fb-btn{box-sizing:border-box!important;width:100%!important}
  .vehicle-modal,.agent-modal{padding:10px!important;align-items:flex-end!important}
  .vehicle-modal-card,.agent-modal-card{width:100%!important;max-width:100%!important;max-height:92dvh!important;border-radius:20px 20px 0 0!important}
}
@media (max-width:430px){
  .hero-cta-row{grid-template-columns:1fr!important}
  .hero-clean .hero-metrics{grid-template-columns:1fr!important;gap:10px!important}
  .hero-clean .hero-metric{display:flex!important;align-items:baseline!important;justify-content:space-between!important;border-bottom:1px solid rgba(255,255,255,.1)!important;padding:0 0 10px!important}
}



/* v7 — white-dominant black + gold showroom preview */
:root{
  --ink:#171717;
  --muted:#6b7280;
  --line:#e8e3d7;
  --accent:#c9a227;
  --accent-dark:#a98212;
  --gold-soft:#fbf7e9;
  --paper:#fbfbfa;
}
body{background:#fbfbfa;color:var(--ink)}
.hero,.hero-home{background:#fff!important;min-height:560px;color:var(--ink)}
.hero-home .hero-overlay,.hero-overlay{
  position:relative!important;inset:auto!important;min-height:560px;
  background:linear-gradient(135deg,#ffffff 0%,#ffffff 62%,#fbf7e9 100%)!important;
  color:var(--ink)!important;align-items:flex-start!important;justify-content:center!important;
  text-align:left!important;padding:86px max(24px,calc((100vw - 1140px)/2)) 72px!important;
}
.hero-copy{max-width:700px}
.hero-home .hero-logo{color:var(--ink)!important}
.hero-home .hero-logo img{box-shadow:0 12px 30px rgba(23,23,23,.12)!important;border:1px solid #eee6cc!important}
.hero-eyebrow{color:#6f5710!important;background:var(--gold-soft)!important;border:1px solid #eadcae!important}
.hero-eyebrow .dot{background:var(--accent)!important;box-shadow:0 0 0 3px rgba(201,162,39,.18)!important}
.hero h1,.hero-home h1{color:var(--ink)!important}
.hero p,.hero-home p{color:#5f6368!important;opacity:1!important}
.hero-primary-btn,.agent-cta-btn{background:var(--accent)!important;color:#111!important;box-shadow:0 10px 24px rgba(201,162,39,.24)!important}
.hero-primary-btn:hover,.agent-cta-btn:hover{background:var(--accent-dark)!important;color:#fff!important}
.hero-secondary-btn{background:#fff!important;color:var(--ink)!important;border:1.5px solid var(--ink)!important}
.hero-secondary-btn:hover{background:var(--ink)!important;color:#fff!important}
.agent-login-btn{background:#fff!important;color:var(--ink)!important;border:1px solid #ddd4b7!important;box-shadow:0 6px 18px rgba(23,23,23,.08)!important}
.agent-login-btn:hover{background:var(--gold-soft)!important}
.hero-metrics{border-top-color:#e8e3d7!important}
.hero-metric strong{color:var(--ink)!important}.hero-metric span{color:var(--muted)!important}
.trust-strip{background:#fff!important;border-color:var(--line)!important;box-shadow:0 14px 36px rgba(23,23,23,.07)!important}
.trust-icon{color:var(--accent)}
.home-kicker{color:var(--accent-dark)!important}
.car-card,.process-card,.contact-note,.agent-cta-card,.search-input,.filter-chip,.location-map{border-color:var(--line)!important}
.car-card:hover{box-shadow:0 18px 38px rgba(201,162,39,.15)!important}
.car-price,.vehicle-modal-price{color:var(--accent-dark)!important}
.filter-chip.active{background:var(--ink)!important;border-color:var(--ink)!important;color:#fff!important}
.search-input:focus,.agent-modal-view input:focus{border-color:var(--accent)!important;box-shadow:0 0 0 3px rgba(201,162,39,.12)!important}
.process-n{background:var(--gold-soft)!important;color:var(--accent-dark)!important}
.location-directions-btn,.agent-modal-submit{background:var(--ink)!important;color:#fff!important}
.vehicle-modal-call-btn{background:var(--accent)!important;color:#111!important}
.vehicle-modal-call-btn:hover{background:var(--accent-dark)!important;color:#fff!important}
.vehicle-modal-requirements li::before{background:var(--accent)!important}
.connect-apply-link{background:var(--gold-soft)!important;color:#5e4810!important;border:1px solid #eadcae!important}
.connect-apply-link:hover{background:#f5edcf!important}
.footer{color:#7b7b78!important;border-top-color:var(--line)!important}

@media(max-width:760px){
  body{overflow-x:hidden;padding-bottom:26px}
  .hero,.hero-home{min-height:auto!important;height:auto!important}
  .hero-home .hero-overlay,.hero-overlay{
    min-height:auto!important;padding:64px 18px 42px!important;text-align:center!important;
    align-items:center!important;background:linear-gradient(180deg,#fff 0%,#fff 72%,#fbf7e9 100%)!important;
  }
  .hero-copy{width:100%;max-width:100%}
  .hero-home .hero-logo{justify-content:center!important;margin-bottom:16px!important;gap:10px!important}
  .hero-home .hero-logo img{width:54px!important;height:54px!important;border-radius:14px!important}
  .hero h1,.hero-home h1{font-size:31px!important;line-height:1.08!important;letter-spacing:-.035em!important}
  .hero p,.hero-home p{font-size:14px!important;line-height:1.55!important;max-width:340px!important;margin:10px auto 0!important}
  .hero-actions{position:static!important;width:100%!important;display:flex!important;justify-content:center!important;margin-bottom:20px!important;order:-1!important}
  .agent-login-btn{width:auto!important;min-height:42px!important}
  .hero-cta-row{display:grid!important;grid-template-columns:1fr!important;width:100%!important;gap:10px!important;margin-top:24px!important}
  .hero-primary-btn,.hero-secondary-btn{width:100%!important;min-height:50px!important;justify-content:center!important}
  .hero-metrics{display:grid!important;grid-template-columns:1fr 1fr!important;width:100%!important;gap:0!important;margin-top:28px!important;padding-top:20px!important}
  .hero-metric{padding:0 10px!important}.hero-metric+ .hero-metric{border-left:1px solid var(--line)!important}
  .trust-strip{margin:18px 14px 0!important;border-radius:18px!important}
  .trust-grid{grid-template-columns:1fr!important}
  .trust-item{border-right:none!important;border-bottom:1px solid var(--line)!important;padding:17px 15px!important}
  .trust-item:last-child{border-bottom:none!important}
  .home-section,.inventory-toolbar,.car-grid,.location-wrap{padding-left:16px!important;padding-right:16px!important}
  .home-section{margin-top:44px!important}
  .home-heading{font-size:27px!important;line-height:1.12!important}
  .home-copy{font-size:13.5px!important}
  .inventory-toolbar{margin-top:30px!important}
  .search-wrap{padding:0!important}
  .filter-bar{padding-left:0!important;padding-right:0!important;overflow-x:auto!important;flex-wrap:nowrap!important;-webkit-overflow-scrolling:touch!important;padding-bottom:6px!important}
  .filter-chip{flex:0 0 auto!important}
  .car-grid{grid-template-columns:1fr!important;gap:18px!important;margin-top:16px!important}
  .car-card{width:100%!important;max-width:none!important}
  .process-grid{grid-template-columns:1fr!important;gap:12px!important}
  .contact-wrap{padding:0 16px!important;margin-top:28px!important}
  .contact-note{width:100%!important;padding:20px 16px!important}
  .connect-apply-row{display:grid!important;grid-template-columns:1fr!important}
  .connect-apply-link{width:100%!important;min-height:44px!important}
  .location-map iframe{height:240px!important}
  .vehicle-modal,.agent-modal{padding:0!important;align-items:flex-end!important}
  .vehicle-modal-card,.agent-modal-card{width:100%!important;max-width:none!important;border-radius:22px 22px 0 0!important;max-height:92vh!important}
  .vehicle-modal-gallery{border-radius:22px 22px 0 0!important}
}



/* ===== Showroom Clean V3 overrides ===== */
:root{--gold:#b58a2b;--gold-dark:#8d6719;--black:#141414;--soft:#f7f7f5;--line2:#e8e6e1}
body{background:#fff;color:var(--black);padding-bottom:0;overflow-x:hidden}
.site-nav{position:sticky;top:0;z-index:80;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line2);backdrop-filter:blur(14px)}
.site-nav-inner{max-width:1180px;height:76px;margin:auto;padding:0 28px;display:flex;align-items:center;justify-content:space-between}
.site-brand{display:flex;align-items:center;gap:11px;text-decoration:none;font-weight:800;letter-spacing:.02em}
.site-brand-mark{width:46px;height:46px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#fff}
.site-brand-mark img{width:100%;height:100%;object-fit:contain}
.site-brand-name{font-size:16px;text-transform:uppercase}
.site-nav-links{display:flex;align-items:center;gap:28px;font-size:13px;font-weight:700}
.site-nav-links a,.nav-text-btn{background:none;border:0;text-decoration:none;color:#383838;cursor:pointer;font:inherit;padding:10px 0}
.site-nav-links a:hover,.nav-text-btn:hover{color:var(--gold-dark)}
.site-nav-cta{border:1px solid #1b1b1b;background:#1b1b1b;color:#fff;border-radius:8px;padding:11px 17px;font-weight:800;cursor:pointer}
.mobile-menu-btn{display:none;border:0;background:#111;color:#fff;border-radius:8px;width:42px;height:42px;font-size:21px}
.hero.hero-clean{height:auto;min-height:610px;background:#fff}
.hero-overlay{position:relative;inset:auto;max-width:1180px;min-height:610px;margin:auto;padding:72px 28px 60px;display:grid;grid-template-columns:minmax(0,.95fr) minmax(420px,1.05fr);align-items:center;gap:58px;color:var(--black);text-align:left;background:none}
.hero-copy{max-width:590px}
.hero-eyebrow{color:var(--gold-dark);background:#fbf5e8;border:1px solid #ead7a5;border-radius:999px;padding:8px 12px;width:max-content;margin-bottom:20px}
.hero-eyebrow .dot{background:var(--gold)}
.hero-logo{display:flex;align-items:center;gap:10px;margin-bottom:18px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#545454}
.hero-logo img{width:34px;height:34px;object-fit:contain;border-radius:50%}
.hero h1{font-size:clamp(46px,5vw,72px);line-height:.99;letter-spacing:-.055em;color:#111;margin:0 0 24px;max-width:650px}
.hero-subtitle{font-size:18px;line-height:1.72;color:#636363;max-width:570px;margin:0 0 30px}
.hero-cta-row{display:flex;gap:12px;flex-wrap:wrap}
.hero-primary-btn,.hero-secondary-btn{min-height:50px;border-radius:8px;padding:0 22px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;text-decoration:none;cursor:pointer}
.hero-primary-btn{background:var(--gold);color:#111;border:1px solid var(--gold)}
.hero-primary-btn:hover{background:#c49a3b}
.hero-secondary-btn{background:#fff;color:#171717;border:1px solid #d5d2cb}
.hero-secondary-btn:hover{border-color:#111}
.hero-visual{min-width:0}
.hero-car-stage{position:relative;min-height:420px;border-radius:28px;background:linear-gradient(145deg,#fafafa,#efefec);overflow:hidden;display:flex;align-items:center;justify-content:center;padding:30px;box-shadow:0 30px 80px rgba(20,20,20,.11)}
.hero-car-stage:after{content:"";position:absolute;left:8%;right:8%;bottom:44px;height:26px;border-radius:50%;background:rgba(0,0,0,.16);filter:blur(20px)}
.hero-car-image{position:relative;z-index:2;width:100%;height:350px;object-fit:contain;filter:drop-shadow(0 22px 20px rgba(0,0,0,.18))}
.hero-car-placeholder{position:relative;z-index:2;font-size:150px}
.hero-plate{position:absolute;z-index:4;left:50%;bottom:104px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:5px 10px;background:#fff;border:2px solid #222;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.22);font-size:10px;font-weight:900;letter-spacing:.08em;white-space:nowrap}
.hero-plate-mark{width:20px;height:20px;display:grid;place-items:center;overflow:hidden}
.hero-plate-mark img{width:100%;height:100%;object-fit:contain}
.hero-live-caption{position:absolute;z-index:4;left:24px;bottom:20px;max-width:calc(100% - 48px);background:rgba(255,255,255,.94);border:1px solid #dedbd4;border-radius:999px;padding:10px 14px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px;box-shadow:0 8px 25px rgba(0,0,0,.09)}
.hero-live-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.13)}
.benefit-strip{background:#fff;border-top:1px solid var(--line2);border-bottom:1px solid var(--line2)}
.benefit-strip-inner{max-width:1180px;margin:auto;min-height:88px;padding:20px 28px;display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr;align-items:center}
.benefit-chip{display:flex;align-items:center;justify-content:center;gap:10px;text-transform:uppercase;letter-spacing:.05em;font-size:12px;color:#292929;text-align:center}
.benefit-icon{width:30px;height:30px;border-radius:50%;background:#fbf5e8;color:var(--gold-dark);display:grid;place-items:center;font-weight:900}
.benefit-divider{width:1px;height:32px;background:#e4e1da}
.inventory-shell{max-width:1180px;margin:0 auto;padding:78px 28px 92px}
.inventory-toolbar{margin-bottom:28px}
.stats-strip{display:flex;align-items:end;justify-content:space-between;border:0;padding:0;margin-bottom:24px}
.stats-strip h2{font-size:34px;letter-spacing:-.035em}
.stats-strip span{color:#777;font-size:13px}
.search-wrap{max-width:none;margin-bottom:14px}
.search-input{height:52px;border:1px solid #dedcd6;border-radius:10px;background:#fff;padding:0 17px;font-size:14px}
.filter-bar{display:flex;gap:8px;overflow-x:auto;padding:0 0 6px;scrollbar-width:none}
.filter-bar::-webkit-scrollbar{display:none}
.filter-chip{flex:0 0 auto;border:1px solid #dedcd6;background:#fff;color:#555;border-radius:999px;padding:10px 16px;font-weight:700}
.filter-chip.active{background:#171717;color:#fff;border-color:#171717}
.car-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}
.car-card{border:1px solid #e3e1db;border-radius:15px;background:#fff;overflow:hidden;box-shadow:0 8px 24px rgba(20,20,20,.055);transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease}
.car-card:hover{transform:translateY(-4px);box-shadow:0 18px 38px rgba(20,20,20,.11);border-color:#d2c08e}
.car-gallery{height:230px;background:#f2f2ef}
.car-gallery img{height:230px;object-fit:cover}
.no-image{height:230px;background:#f1f1ee}
.car-info{padding:20px}
.car-info h3{font-size:19px;letter-spacing:-.02em;margin-bottom:10px}
.car-meta{font-size:13px;color:#777;line-height:1.5}
.car-price-row{margin-top:18px;padding-top:15px;border-top:1px solid #eceae5}
.car-price{font-size:20px;color:var(--gold-dark);font-weight:900}
.agent-cta-section{max-width:1124px;margin:0 auto 78px;border-radius:22px;background:#181818;color:#fff;padding:48px 54px;display:flex;align-items:center;justify-content:space-between;gap:34px}
.agent-cta-section .home-kicker{color:#d8b45c}.agent-cta-section .home-heading{color:#fff}.agent-cta-section .home-copy{color:#c9c9c9}
.connect-section{background:#f6f5f2;padding:76px 28px}
.contact-wrap{max-width:1124px;margin:auto}
.contact-note{background:#fff;border:1px solid #e1ded7;border-radius:18px;padding:38px;text-align:center;box-shadow:0 12px 35px rgba(20,20,20,.05)}
.location-wrap{max-width:1124px;margin:0 auto;padding:74px 28px}
.footer{background:#171717;color:#aaa;padding:26px;text-align:center}

@media(max-width:900px){
  .site-nav-links{display:none}.mobile-menu-btn{display:block}
  body.mobile-nav-open .site-nav-links{display:flex;position:absolute;left:16px;right:16px;top:68px;background:#fff;border:1px solid #e3e1dc;border-radius:14px;box-shadow:0 18px 45px rgba(0,0,0,.14);padding:14px;flex-direction:column;align-items:stretch;gap:0}
  body.mobile-nav-open .site-nav-links a,body.mobile-nav-open .nav-text-btn,body.mobile-nav-open .site-nav-cta{width:100%;text-align:left;padding:14px;border-radius:8px}
  .hero-overlay{grid-template-columns:1fr;gap:34px;padding-top:50px}.hero-copy{max-width:680px}.hero-car-stage{min-height:360px}.hero-car-image{height:300px}
  .benefit-strip-inner{grid-template-columns:1fr 1fr;gap:0;padding:10px 20px}.benefit-divider{display:none}.benefit-chip{justify-content:flex-start;padding:14px}
  .car-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:600px){
  .site-nav-inner{height:66px;padding:0 16px}.site-brand-mark{width:40px;height:40px}.site-brand-name{font-size:14px}
  .hero.hero-clean{min-height:0}.hero-overlay{min-height:0;padding:38px 18px 34px;gap:28px}.hero-logo{margin-bottom:12px}.hero h1{font-size:43px;line-height:1.02}.hero-subtitle{font-size:15px;line-height:1.62;margin-bottom:24px}
  .hero-cta-row{display:grid;grid-template-columns:1fr}.hero-primary-btn,.hero-secondary-btn{width:100%;min-height:52px}
  .hero-car-stage{min-height:285px;border-radius:18px;padding:14px}.hero-car-image{height:245px}.hero-car-placeholder{font-size:95px}.hero-plate{bottom:70px;transform:translateX(-50%) scale(.86)}.hero-live-caption{left:12px;right:12px;bottom:10px;max-width:none;border-radius:10px}
  .benefit-strip-inner{grid-template-columns:1fr 1fr;padding:10px}.benefit-chip{padding:12px 8px;justify-content:flex-start;font-size:10px;letter-spacing:.02em}.benefit-icon{width:27px;height:27px;flex:0 0 auto}
  .inventory-shell{padding:52px 16px 66px}.stats-strip{align-items:flex-start;gap:6px;flex-direction:column}.stats-strip h2{font-size:29px}.car-grid{grid-template-columns:1fr;gap:18px}.car-gallery,.car-gallery img,.no-image{height:245px}
  .agent-cta-section{margin:0 16px 54px;padding:32px 24px;display:block;border-radius:17px}.agent-cta-btn{width:100%;margin-top:24px}
  .connect-section{padding:54px 16px}.contact-note{padding:28px 18px}.connect-apply-row{display:grid;grid-template-columns:1fr;gap:10px}.connect-apply-link{width:100%}
  .location-wrap{padding:54px 16px}.location-map{height:280px}
  .agent-modal-card,.vehicle-modal-card{width:100%;max-height:92vh;border-radius:20px 20px 0 0;position:absolute;bottom:0}.agent-modal,.vehicle-modal{align-items:flex-end;padding:0}
}

"""

SHOWROOM_JS = """
(function(){
  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  document.querySelectorAll('.car-gallery').forEach(function(gallery){
    var track = gallery.querySelector('.gal-track');
    if (!track) return;
    var imgs = track.querySelectorAll('img');
    var dots = gallery.querySelectorAll('.gal-dots .dot');
    var counter = gallery.querySelector('.gal-count');
    var index = 0;
    function render(){
      track.style.transform = 'translateX(-' + (index * 100) + '%)';
      dots.forEach(function(d, i){ d.classList.toggle('active', i === index); });
      if (counter) counter.textContent = (index + 1) + '/' + imgs.length;
    }
    var prevBtn = gallery.querySelector('.gal-btn.prev');
    var nextBtn = gallery.querySelector('.gal-btn.next');
    if (prevBtn) prevBtn.addEventListener('click', function(e){ e.stopPropagation(); index = (index - 1 + imgs.length) % imgs.length; render(); });
    if (nextBtn) nextBtn.addEventListener('click', function(e){ e.stopPropagation(); index = (index + 1) % imgs.length; render(); });
    dots.forEach(function(d, i){ d.addEventListener('click', function(e){ e.stopPropagation(); index = i; render(); }); });
  });

  var lightbox = document.getElementById('lightbox');
  var lbImg = document.getElementById('lightbox-img');
  var lbCounter = document.getElementById('lightbox-counter');
  var lbImages = [];
  var lbIndex = 0;

  function openLightbox(images, startIndex){
    if (!images.length) return;
    lbImages = images;
    lbIndex = startIndex || 0;
    renderLightbox();
    lightbox.classList.add('open');
  }
  function renderLightbox(){
    lbImg.src = lbImages[lbIndex];
    lbCounter.textContent = (lbIndex + 1) + ' / ' + lbImages.length;
  }
  function closeLightbox(){ lightbox.classList.remove('open'); lbImg.src=''; }
  function stepLightbox(delta){ lbIndex = (lbIndex + delta + lbImages.length) % lbImages.length; renderLightbox(); }

  var closeBtn = document.getElementById('lightbox-close');
  var lbPrevBtn = document.getElementById('lightbox-prev');
  var lbNextBtn = document.getElementById('lightbox-next');
  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
  if (lbPrevBtn) lbPrevBtn.addEventListener('click', function(){ stepLightbox(-1); });
  if (lbNextBtn) lbNextBtn.addEventListener('click', function(){ stepLightbox(1); });
  if (lightbox) lightbox.addEventListener('click', function(e){ if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', function(e){
    if (lightbox && lightbox.classList.contains('open')) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    }
  });

  var cards = document.querySelectorAll('.car-card');
  var activeStatus = 'all';
  var activeMake = 'all';
  var searchTerm = '';
  var noResultsEl = document.getElementById('no-results');

  function applyFilters(){
    var visibleCount = 0;
    cards.forEach(function(card){
      var statusOk = (activeStatus === 'all' || card.getAttribute('data-status') === activeStatus);
      var makeOk = (activeMake === 'all' || card.getAttribute('data-make') === activeMake);
      var searchOk = (!searchTerm || (card.getAttribute('data-search') || '').indexOf(searchTerm) !== -1);
      var show = statusOk && makeOk && searchOk;
      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });
    if (noResultsEl) noResultsEl.style.display = visibleCount === 0 ? '' : 'none';
  }

  var searchInput = document.getElementById('car-search');
  if (searchInput) {
    searchInput.addEventListener('input', function(){
      searchTerm = searchInput.value.trim().toLowerCase();
      applyFilters();
    });
  }

  var statusChips = document.querySelectorAll('.filter-bar:not(.make-filter-bar) .filter-chip');
  statusChips.forEach(function(chip){
    chip.addEventListener('click', function(){
      statusChips.forEach(function(c){ c.classList.remove('active'); });
      chip.classList.add('active');
      activeStatus = chip.getAttribute('data-status');
      applyFilters();
    });
  });

  var makeChips = document.querySelectorAll('.make-filter-bar .filter-chip');
  makeChips.forEach(function(chip){
    chip.addEventListener('click', function(){
      makeChips.forEach(function(c){ c.classList.remove('active'); });
      chip.classList.add('active');
      activeMake = chip.getAttribute('data-make');
      applyFilters();
    });
  });

  // ---- Tap a car card to open its details (photos, price, status, and a
  // "Call to inquire" button using the dealership's phone number) ----
  var CARS = [];
  try {
    var carsDataEl = document.getElementById('cars-data');
    CARS = carsDataEl ? JSON.parse(carsDataEl.textContent || '[]') : [];
  } catch (e) { CARS = []; }

  var vModal = document.getElementById('vehicle-modal');
  var vImg = document.getElementById('vehicle-modal-img');
  var vTitle = document.getElementById('vehicle-modal-title');
  var vMeta = document.getElementById('vehicle-modal-meta');
  var vSpecs = document.getElementById('vehicle-modal-specs');
  var vPrice = document.getElementById('vehicle-modal-price');
  var vBadge = document.getElementById('vehicle-modal-badge');
  var vInquireBtn = document.getElementById('vehicle-modal-inquire');
  var vCount = document.getElementById('vehicle-modal-count');
  var vPrev = document.getElementById('vehicle-modal-prev');
  var vNext = document.getElementById('vehicle-modal-next');
  var vClose = document.getElementById('vehicle-modal-close');
  var vCurCar = null;
  var vCurIdx = 0;

  function renderVehicleModal(){
    if (!vCurCar) return;
    var vimgs = vCurCar.imgs || [];
    var multi = vimgs.length > 1;
    if (vImg) vImg.src = vimgs[vCurIdx] || '';
    if (vImg) vImg.alt = vCurCar.title || 'Vehicle photo';
    if (vTitle) vTitle.textContent = vCurCar.title || '';
    if (vMeta) { vMeta.textContent = vCurCar.meta || ''; vMeta.style.display = vCurCar.meta ? '' : 'none'; }
    if (vSpecs) {
      var specs = vCurCar.specs || [];
      vSpecs.innerHTML = specs.map(function(s){
        return '<div class="vehicle-modal-spec"><span class="vehicle-modal-spec-label">' + escapeHtml(s.label) +
          '</span><span class="vehicle-modal-spec-value">' + escapeHtml(s.value) + '</span></div>';
      }).join('');
      vSpecs.style.display = specs.length ? '' : 'none';
    }
    if (vPrice) vPrice.textContent = vCurCar.price || '';
    if (vBadge) vBadge.style.display = (vCurCar.status === 'reserved') ? '' : 'none';
    if (vPrev) vPrev.style.display = multi ? '' : 'none';
    if (vNext) vNext.style.display = multi ? '' : 'none';
    if (vCount) { vCount.style.display = multi ? '' : 'none'; vCount.textContent = (vCurIdx + 1) + '/' + vimgs.length; }
  }
  function openVehicleModal(idx){
    var car = CARS[idx];
    if (!car || !vModal) return;
    vCurCar = car;
    vCurIdx = 0;
    renderVehicleModal();
    vModal.classList.add('open');
  }
  function closeVehicleModal(){ if (vModal) vModal.classList.remove('open'); }

  if (vPrev) vPrev.addEventListener('click', function(e){ e.stopPropagation(); var n = (vCurCar && vCurCar.imgs ? vCurCar.imgs.length : 0); if (!n) return; vCurIdx = (vCurIdx - 1 + n) % n; renderVehicleModal(); });
  if (vNext) vNext.addEventListener('click', function(e){ e.stopPropagation(); var n = (vCurCar && vCurCar.imgs ? vCurCar.imgs.length : 0); if (!n) return; vCurIdx = (vCurIdx + 1) % n; renderVehicleModal(); });
  if (vClose) vClose.addEventListener('click', closeVehicleModal);
  if (vModal) vModal.addEventListener('click', function(e){ if (e.target === vModal) closeVehicleModal(); });
  if (vImg) vImg.addEventListener('click', function(){
    if (vCurCar && vCurCar.imgs && vCurCar.imgs.length) openLightbox(vCurCar.imgs, vCurIdx);
  });
  if (vInquireBtn) vInquireBtn.addEventListener('click', function(){
    if (vCurCar) openInquiryModal(vCurCar);
  });
  document.addEventListener('keydown', function(e){
    if (!vModal || !vModal.classList.contains('open')) return;
    if (e.key === 'Escape') closeVehicleModal();
  });

  cards.forEach(function(card){
    card.addEventListener('click', function(){
      var idx = card.getAttribute('data-idx');
      if (idx !== null) openVehicleModal(parseInt(idx, 10));
    });
  });

  // ---- Inquire to buy this car popup (opened from the vehicle detail
  // modal's "Inquire to buy this car" button). Posts to POST /api/v1/
  // business/{id}/cl-buyer-inquiry (see CLBuyerInquiry in main.py) - it
  // lands as a normal 'pending' cl_applications row with role='buyer',
  // so it shows up on the dashboard's Applications tab (Buyers
  // Application) for the owner to approve/reject like any other.
  // The 4 document photos are picked from the file system (not the
  // camera) and uploaded to Cloudinary first, same signed-upload
  // pattern as the agent KYC photos - see uploadInquiryPhoto below. ----
  var inquiryConfig = {};
  try {
    var inquiryConfigEl = document.getElementById('agent-config');
    inquiryConfig = inquiryConfigEl ? JSON.parse(inquiryConfigEl.textContent || '{}') : {};
  } catch (e) { inquiryConfig = {}; }

  var inquiryModal = document.getElementById('inquiry-modal');
  var inquiryModalClose = document.getElementById('inquiry-modal-close');
  var inquiryFormView = document.getElementById('inquiry-form-view');
  var inquirySuccessView = document.getElementById('inquiry-success-view');
  var inquirySuccessClose = document.getElementById('inquiry-success-close');
  var inquiryVehicleTitle = document.getElementById('inquiry-vehicle-title');
  var inquiryForm = document.getElementById('inquiry-form');
  var inquirySubmit = document.getElementById('inquiry-submit');
  var inquiryError = document.getElementById('inquiry-error');
  var inquiryMakeOffer = document.getElementById('inquiry-make-offer');
  var inquiryTradein = document.getElementById('inquiry-tradein');
  var inquiryCurVehiclePublicId = null;

  function showInquiryView(view){
    if (inquiryFormView) inquiryFormView.style.display = (view === 'form') ? '' : 'none';
    if (inquirySuccessView) inquirySuccessView.style.display = (view === 'success') ? '' : 'none';
  }

  function openInquiryModal(car){
    if (!inquiryModal) return;
    inquiryCurVehiclePublicId = (car && car.public_id) || null;
    if (inquiryVehicleTitle) inquiryVehicleTitle.textContent = car && car.title ? ('For: ' + car.title) : '';
    if (inquiryError) inquiryError.style.display = 'none';
    showInquiryView('form');
    inquiryModal.classList.add('open');
  }
  function closeInquiryModal(){ if (inquiryModal) inquiryModal.classList.remove('open'); }

  if (inquiryModalClose) inquiryModalClose.addEventListener('click', closeInquiryModal);
  if (inquirySuccessClose) inquirySuccessClose.addEventListener('click', closeInquiryModal);
  if (inquiryModal) inquiryModal.addEventListener('click', function(e){ if (e.target === inquiryModal) closeInquiryModal(); });
  document.addEventListener('keydown', function(e){
    if (!inquiryModal || !inquiryModal.classList.contains('open')) return;
    if (e.key === 'Escape') closeInquiryModal();
  });

  if (inquiryMakeOffer) inquiryMakeOffer.addEventListener('change', function(){
    if (inquiryTradein) inquiryTradein.classList.toggle('open', inquiryMakeOffer.checked);
  });

  // Uploads a picked file (not a data URL) to Cloudinary using a
  // short-lived signature from our own backend - same signed-upload
  // pattern as the agent KYC photos, just from a file input instead of
  // the camera.
  async function uploadInquiryPhoto(file, sig){
    var form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.api_key);
    form.append('timestamp', sig.timestamp);
    form.append('signature', sig.signature);
    form.append('upload_preset', sig.upload_preset);
    form.append('folder', sig.folder);
    var res = await fetch('https://api.cloudinary.com/v1_1/' + sig.cloud_name + '/image/upload', {
      method: 'POST',
      body: form
    });
    var data = await res.json();
    if (!res.ok || !data.secure_url) throw new Error(data.error && data.error.message ? data.error.message : 'Photo upload failed');
    return data.secure_url;
  }

  if (inquiryForm) inquiryForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var name = document.getElementById('inquiry-name').value.trim();
    var phone = document.getElementById('inquiry-phone').value.trim();
    var address = document.getElementById('inquiry-address').value.trim();
    var id1File = document.getElementById('inquiry-id1').files[0];
    var id2File = document.getElementById('inquiry-id2').files[0];
    var billingFile = document.getElementById('inquiry-billing').files[0];
    var incomeFile = document.getElementById('inquiry-income').files[0];
    var referringAgent = document.getElementById('inquiry-agent').value.trim();
    var makeOffer = inquiryMakeOffer && inquiryMakeOffer.checked;
    var tradeMake = document.getElementById('inquiry-tradein-make').value.trim();
    var tradeModel = document.getElementById('inquiry-tradein-model').value.trim();
    var tradeYear = document.getElementById('inquiry-tradein-year').value.trim();
    var tradeMileage = document.getElementById('inquiry-tradein-mileage').value;
    var addCash = document.getElementById('inquiry-add-cash').value;
    var addCashByEl = document.querySelector('input[name="inquiry-add-cash-by"]:checked');
    var addCashBy = addCashByEl ? addCashByEl.value : null;

    if (inquiryError) inquiryError.style.display = 'none';
    if (!id1File || !id2File || !billingFile || !incomeFile) {
      if (inquiryError) { inquiryError.textContent = 'Please upload both IDs, proof of billing, and proof of income.'; inquiryError.style.display = ''; }
      return;
    }
    if (!inquiryConfig.api_base || !inquiryConfig.business_public_id) {
      if (inquiryError) { inquiryError.textContent = 'This form is unavailable right now.'; inquiryError.style.display = ''; }
      return;
    }

    if (inquirySubmit) { inquirySubmit.disabled = true; inquirySubmit.textContent = 'Uploading documents…'; }
    try {
      var sigRes = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/cloudinary-signature?purpose=purchase_inquiry', {
        method: 'POST'
      });
      var sig = await sigRes.json();
      if (!sigRes.ok) throw new Error(sig.detail || 'Could not prepare document upload');

      var id1Url = await uploadInquiryPhoto(id1File, sig);
      var id2Url = await uploadInquiryPhoto(id2File, sig);
      var billingUrl = await uploadInquiryPhoto(billingFile, sig);
      var incomeUrl = await uploadInquiryPhoto(incomeFile, sig);

      if (inquirySubmit) inquirySubmit.textContent = 'Submitting…';
      var res = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/cl-buyer-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_public_id: inquiryCurVehiclePublicId,
          name: name, phone: phone, address: address || null,
          referring_agent: referringAgent || null,
          id_photo_url: id1Url, id_photo_2_url: id2Url,
          proof_of_billing_url: billingUrl, proof_of_income_url: incomeUrl,
          make_offer: !!makeOffer,
          trade_in_make: makeOffer ? (tradeMake || null) : null,
          trade_in_model: makeOffer ? (tradeModel || null) : null,
          trade_in_year: makeOffer ? (tradeYear || null) : null,
          trade_in_mileage: (makeOffer && tradeMileage) ? parseInt(tradeMileage, 10) : null,
          add_cash_amount: (makeOffer && addCash) ? parseFloat(addCash) : null,
          add_cash_by: makeOffer ? addCashBy : null
        })
      });
      var data = await res.json();
      if (res.ok) {
        inquiryForm.reset();
        if (inquiryTradein) inquiryTradein.classList.remove('open');
        showInquiryView('success');
      } else {
        if (inquiryError) { inquiryError.textContent = data.detail || 'Submission failed'; inquiryError.style.display = ''; }
      }
    } catch (err) {
      if (inquiryError) { inquiryError.textContent = (err && err.message) || 'Network error. Please try again.'; inquiryError.style.display = ''; }
    } finally {
      if (inquirySubmit) { inquirySubmit.disabled = false; inquirySubmit.textContent = 'Submit'; }
    }
  });

  // ---- Sell your car popup (opened from the "Sell your car" button in
  // the hero). Posts to POST /api/v1/business/{id}/cl-sell-your-car (see
  // CLSellerInquiry in main.py) - it lands as a normal 'pending'
  // cl_applications row with role='seller', so it shows up on the
  // dashboard's Applications tab (Sellers Application). Up to 10 photos
  // are picked from the file system and uploaded to Cloudinary first,
  // same pattern as the buyer inquiry's documents - see
  // uploadInquiryPhoto above. ----
  var sellCarBtn = document.getElementById('sell-car-btn');
  var sellModal = document.getElementById('sell-modal');
  var sellModalClose = document.getElementById('sell-modal-close');
  var sellFormView = document.getElementById('sell-form-view');
  var sellSuccessView = document.getElementById('sell-success-view');
  var sellSuccessClose = document.getElementById('sell-success-close');
  var sellForm = document.getElementById('sell-form');
  var sellSubmit = document.getElementById('sell-submit');
  var sellError = document.getElementById('sell-error');
  var sellHasAmortization = document.getElementById('sell-has-amortization');
  var sellAmortization = document.getElementById('sell-amortization');
  var sellPhotosInput = document.getElementById('sell-photos-input');
  var sellPhotoAddBtn = document.getElementById('sell-photo-add');
  var sellPhotosGrid = document.getElementById('sell-photos-grid');
  var sellPhotoCount = document.getElementById('sell-photo-count');
  var SELL_MAX_PHOTOS = 10;
  var sellPhotoFiles = [];

  function showSellView(view){
    if (sellFormView) sellFormView.style.display = (view === 'form') ? '' : 'none';
    if (sellSuccessView) sellSuccessView.style.display = (view === 'success') ? '' : 'none';
  }

  function openSellModal(){
    if (!sellModal) return;
    if (sellError) sellError.style.display = 'none';
    showSellView('form');
    sellModal.classList.add('open');
  }
  function closeSellModal(){ if (sellModal) sellModal.classList.remove('open'); }

  if (sellCarBtn) sellCarBtn.addEventListener('click', openSellModal);
  var connectSellLink = document.getElementById('connect-sell-link');
  if (connectSellLink) connectSellLink.addEventListener('click', openSellModal);
  if (sellModalClose) sellModalClose.addEventListener('click', closeSellModal);
  if (sellSuccessClose) sellSuccessClose.addEventListener('click', closeSellModal);
  if (sellModal) sellModal.addEventListener('click', function(e){ if (e.target === sellModal) closeSellModal(); });
  document.addEventListener('keydown', function(e){
    if (!sellModal || !sellModal.classList.contains('open')) return;
    if (e.key === 'Escape') closeSellModal();
  });

  if (sellHasAmortization) sellHasAmortization.addEventListener('change', function(){
    if (sellAmortization) sellAmortization.classList.toggle('open', sellHasAmortization.checked);
  });

  function renderSellPhotos(){
    if (!sellPhotosGrid) return;
    var thumbs = sellPhotosGrid.querySelectorAll('.sell-photo-thumb');
    thumbs.forEach(function(t){ t.remove(); });
    sellPhotoFiles.forEach(function(file, idx){
      var thumb = document.createElement('div');
      thumb.className = 'sell-photo-thumb';
      var img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = 'Vehicle photo ' + (idx + 1);
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'sell-photo-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', function(){
        sellPhotoFiles.splice(idx, 1);
        renderSellPhotos();
      });
      thumb.appendChild(img);
      thumb.appendChild(removeBtn);
      sellPhotosGrid.insertBefore(thumb, sellPhotoAddBtn);
    });
    if (sellPhotoAddBtn) sellPhotoAddBtn.style.display = (sellPhotoFiles.length >= SELL_MAX_PHOTOS) ? 'none' : '';
    if (sellPhotoCount) sellPhotoCount.textContent = sellPhotoFiles.length + ' / ' + SELL_MAX_PHOTOS + ' photos added';
  }

  if (sellPhotoAddBtn) sellPhotoAddBtn.addEventListener('click', function(){
    if (sellPhotosInput) sellPhotosInput.click();
  });
  if (sellPhotosInput) sellPhotosInput.addEventListener('change', function(){
    var picked = Array.prototype.slice.call(sellPhotosInput.files || []);
    picked.forEach(function(file){
      if (sellPhotoFiles.length < SELL_MAX_PHOTOS) sellPhotoFiles.push(file);
    });
    sellPhotosInput.value = '';
    renderSellPhotos();
  });

  if (sellForm) sellForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var name = document.getElementById('sell-name').value.trim();
    var phone = document.getElementById('sell-phone').value.trim();
    var address = document.getElementById('sell-address').value.trim();
    var make = document.getElementById('sell-make').value.trim();
    var model = document.getElementById('sell-model').value.trim();
    var year = document.getElementById('sell-year').value.trim();
    var transmissionEl = document.querySelector('input[name="sell-transmission"]:checked');
    var transmission = transmissionEl ? transmissionEl.value : null;
    var mileage = document.getElementById('sell-mileage').value;
    var price = document.getElementById('sell-price').value;
    var sellerTypeEl = document.querySelector('input[name="sell-type"]:checked');
    var sellerType = sellerTypeEl ? sellerTypeEl.value : null;
    var hasAmortization = sellHasAmortization && sellHasAmortization.checked;
    var amortAmount = document.getElementById('sell-amortization-amount').value;
    var amortDueDate = document.getElementById('sell-amortization-due-date').value;
    var amortNextDue = document.getElementById('sell-amortization-next-due').value;
    var amortMonthsRemaining = document.getElementById('sell-amortization-months-remaining').value;

    if (sellError) sellError.style.display = 'none';
    if (!sellerType) {
      if (sellError) { sellError.textContent = 'Please tell us whether you\\'re the owner or a 3rd party.'; sellError.style.display = ''; }
      return;
    }
    if (!inquiryConfig.api_base || !inquiryConfig.business_public_id) {
      if (sellError) { sellError.textContent = 'This form is unavailable right now.'; sellError.style.display = ''; }
      return;
    }

    if (sellSubmit) { sellSubmit.disabled = true; sellSubmit.textContent = 'Uploading photos…'; }
    try {
      var imageUrls = [];
      if (sellPhotoFiles.length) {
        var sigRes = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/cloudinary-signature?purpose=sell_your_car', {
          method: 'POST'
        });
        var sig = await sigRes.json();
        if (!sigRes.ok) throw new Error(sig.detail || 'Could not prepare photo upload');
        for (var i = 0; i < sellPhotoFiles.length; i++) {
          if (sellSubmit) sellSubmit.textContent = 'Uploading photo ' + (i + 1) + ' of ' + sellPhotoFiles.length + '…';
          imageUrls.push(await uploadInquiryPhoto(sellPhotoFiles[i], sig));
        }
      }

      if (sellSubmit) sellSubmit.textContent = 'Submitting…';
      var res = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/cl-sell-your-car', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name, phone: phone, address: address || null,
          image_urls: imageUrls,
          seller_make: make || null,
          seller_model: model || null,
          seller_year: year || null,
          seller_transmission: transmission,
          seller_mileage: mileage ? parseInt(mileage, 10) : null,
          seller_price: price ? parseFloat(price) : null,
          seller_type: sellerType,
          has_amortization: !!hasAmortization,
          amortization_amount: (hasAmortization && amortAmount) ? parseFloat(amortAmount) : null,
          amortization_due_date: hasAmortization ? (amortDueDate || null) : null,
          amortization_next_due: hasAmortization ? (amortNextDue || null) : null,
          amortization_months_remaining: (hasAmortization && amortMonthsRemaining) ? parseInt(amortMonthsRemaining, 10) : null
        })
      });
      var data = await res.json();
      if (res.ok) {
        sellForm.reset();
        sellPhotoFiles = [];
        renderSellPhotos();
        if (sellAmortization) sellAmortization.classList.remove('open');
        showSellView('success');
      } else {
        if (sellError) { sellError.textContent = data.detail || 'Submission failed'; sellError.style.display = ''; }
      }
    } catch (err) {
      if (sellError) { sellError.textContent = (err && err.message) || 'Network error. Please try again.'; sellError.style.display = ''; }
    } finally {
      if (sellSubmit) { sellSubmit.disabled = false; sellSubmit.textContent = 'Submit'; }
    }
  });

  // ---- Agent Login / Sign Up popup ----
  var agentConfig = {};
  try {
    var agentConfigEl = document.getElementById('agent-config');
    agentConfig = agentConfigEl ? JSON.parse(agentConfigEl.textContent || '{}') : {};
  } catch (e) { agentConfig = {}; }

  var agentModal = document.getElementById('agent-modal');
  var agentLoginBtn = document.getElementById('agent-login-btn');
  var navAgentLoginBtn = document.getElementById('nav-agent-login-btn');
  var navSellCarBtn = document.getElementById('nav-sell-car-btn');
  var mobileMenuBtn = document.getElementById('mobile-menu-btn');
  var agentModalClose = document.getElementById('agent-modal-close');
  var agentLoginView = document.getElementById('agent-login-view');
  var agentSignupView = document.getElementById('agent-signup-view');
  var agentLoggedinView = document.getElementById('agent-loggedin-view');
  var agentLoggedIn = false;

  function showAgentView(view){
    [agentLoginView, agentSignupView, agentLoggedinView].forEach(function(v){ if (v) v.style.display = 'none'; });
    if (view) view.style.display = '';
  }
  function openAgentModal(){
    if (!agentModal) return;
    agentModal.classList.add('open');
    showAgentView(agentLoggedIn ? agentLoggedinView : agentLoginView);
  }
  function closeAgentModal(){ if (agentModal) agentModal.classList.remove('open'); }

  function openAgentSignup(){
    if (!agentModal) return;
    agentModal.classList.add('open');
    showAgentView(agentSignupView);
  }

  if (agentLoginBtn) agentLoginBtn.addEventListener('click', openAgentModal);
  ['hero-become-agent-btn', 'section-become-agent-btn', 'connect-become-agent-btn'].forEach(function(id){
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', openAgentSignup);
  });
  if (agentModalClose) agentModalClose.addEventListener('click', function(){ closeAgentModal(); stopAgentCameras(); });
  if (agentModal) agentModal.addEventListener('click', function(e){ if (e.target === agentModal) { closeAgentModal(); stopAgentCameras(); } });
  document.addEventListener('keydown', function(e){
    if (agentModal && agentModal.classList.contains('open') && e.key === 'Escape') { closeAgentModal(); stopAgentCameras(); }
  });

  var agentShowSignup = document.getElementById('agent-show-signup');
  var agentShowLogin = document.getElementById('agent-show-login');
  if (agentShowSignup) agentShowSignup.addEventListener('click', function(e){ e.preventDefault(); showAgentView(agentSignupView); });
  if (agentShowLogin) agentShowLogin.addEventListener('click', function(e){ e.preventDefault(); showAgentView(agentLoginView); stopAgentCameras(); });

  // Camera-only capture (no file picker) for the sign-up form's selfie and
  // ID photo. facingMode is a soft preference, not `exact`, so it still
  // works on devices without a matching front/back camera.
  function setupAgentCamera(prefix, facingMode){
    var frame = document.getElementById(prefix + '-frame');
    var placeholder = document.getElementById(prefix + '-placeholder');
    var video = document.getElementById(prefix + '-video');
    var preview = document.getElementById(prefix + '-preview');
    var canvas = document.getElementById(prefix + '-canvas');
    var startBtn = document.getElementById(prefix + '-start');
    var captureBtn = document.getElementById(prefix + '-capture');
    var retakeBtn = document.getElementById(prefix + '-retake');
    var statusEl = document.getElementById(prefix + '-status');
    var stream = null;
    var dataUrl = null;

    function setStatus(msg, cls){
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'agent-camera-status' + (cls ? ' ' + cls : '');
    }

    async function start(){
      setStatus('');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Camera not available on this device/browser.', 'error');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode }, audio: false });
        if (video) { video.srcObject = stream; video.style.display = ''; }
        if (placeholder) placeholder.style.display = 'none';
        if (preview) preview.style.display = 'none';
        if (startBtn) startBtn.style.display = 'none';
        if (captureBtn) captureBtn.style.display = '';
        if (retakeBtn) retakeBtn.style.display = 'none';
      } catch (err) {
        setStatus('Could not access the camera. Please allow camera permission and try again.', 'error');
      }
    }

    function stop(){
      if (stream) { stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; }
    }

    function capture(){
      if (!video || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      if (preview) { preview.src = dataUrl; preview.style.display = ''; }
      if (video) video.style.display = 'none';
      stop();
      if (captureBtn) captureBtn.style.display = 'none';
      if (retakeBtn) retakeBtn.style.display = '';
      setStatus('Photo captured.', 'success');
    }

    function retake(){
      dataUrl = null;
      setStatus('');
      start();
    }

    function reset(){
      dataUrl = null;
      stop();
      if (preview) preview.style.display = 'none';
      if (video) video.style.display = 'none';
      if (placeholder) placeholder.style.display = '';
      if (startBtn) startBtn.style.display = '';
      if (captureBtn) captureBtn.style.display = 'none';
      if (retakeBtn) retakeBtn.style.display = 'none';
      setStatus('');
    }

    if (startBtn) startBtn.addEventListener('click', start);
    if (captureBtn) captureBtn.addEventListener('click', capture);
    if (retakeBtn) retakeBtn.addEventListener('click', retake);

    return {
      getDataUrl: function(){ return dataUrl; },
      stop: stop,
      reset: reset,
      setStatus: setStatus
    };
  }

  var agentSelfieCam = setupAgentCamera('agent-selfie', 'user');
  var agentIdCam = setupAgentCamera('agent-id', 'environment');
  function stopAgentCameras(){
    if (agentSelfieCam) agentSelfieCam.stop();
    if (agentIdCam) agentIdCam.stop();
  }

  // Uploads one camera-captured photo (a data URL, never a picked file) to
  // Cloudinary using a short-lived signature from our own backend.
  async function uploadAgentPhoto(dataUrl, sig){
    var blob = await (await fetch(dataUrl)).blob();
    var form = new FormData();
    form.append('file', blob, 'photo.jpg');
    form.append('api_key', sig.api_key);
    form.append('timestamp', sig.timestamp);
    form.append('signature', sig.signature);
    form.append('upload_preset', sig.upload_preset);
    form.append('folder', sig.folder);
    var res = await fetch('https://api.cloudinary.com/v1_1/' + sig.cloud_name + '/image/upload', {
      method: 'POST',
      body: form
    });
    var data = await res.json();
    if (!res.ok || !data.secure_url) throw new Error(data.error && data.error.message ? data.error.message : 'Photo upload failed');
    return data.secure_url;
  }

  // Approved agents authenticate against cl_agents through the shared
  // login endpoint, then go directly to this dealership's agent inventory.
  var agentLoginForm = document.getElementById('agent-login-form');
  if (agentLoginForm) agentLoginForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var email = document.getElementById('agent-login-email').value.trim();
    var password = document.getElementById('agent-login-password').value;
    var errEl = document.getElementById('agent-login-error');
    var submitBtn = agentLoginForm.querySelector('button[type="submit"]');
    if (errEl) errEl.style.display = 'none';
    if (!email || !password) return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in…'; }
    try {
      var res = await fetch(agentConfig.api_base + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Login failed');
      if (data.role !== 'agent') throw new Error('This login is not an approved agent account.');
      try { localStorage.setItem('loyaltree_agent', JSON.stringify(data)); } catch (storageErr) {}
      window.location.href = data.redirect_url || (agentConfig.api_base + '/agent/' + data.business_slug);
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Login failed'; errEl.style.display = ''; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Log in'; }
    }
  });

  // Real signup - captures a selfie + ID photo live from the camera
  // (never a file picker), uploads both to Cloudinary, then creates an
  // actual cl_agents row with a hashed password.
  var agentSignupForm = document.getElementById('agent-signup-form');
  var agentSignupSubmit = document.getElementById('agent-signup-submit');
  if (agentSignupForm) agentSignupForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var name = document.getElementById('agent-signup-name').value.trim();
    var phone = document.getElementById('agent-signup-phone').value.trim();
    var address = document.getElementById('agent-signup-address').value.trim();
    var email = document.getElementById('agent-signup-email').value.trim();
    var password = document.getElementById('agent-signup-password').value;
    var errEl = document.getElementById('agent-signup-error');
    if (errEl) errEl.style.display = 'none';

    var selfieData = agentSelfieCam.getDataUrl();
    var idData = agentIdCam.getDataUrl();
    if (!selfieData || !idData) {
      if (errEl) { errEl.textContent = 'Please take both your selfie and ID photo using the camera.'; errEl.style.display = ''; }
      return;
    }
    if (!agentConfig.api_base || !agentConfig.business_public_id) {
      if (errEl) { errEl.textContent = 'Sign up is unavailable right now.'; errEl.style.display = ''; }
      return;
    }

    if (agentSignupSubmit) { agentSignupSubmit.disabled = true; agentSignupSubmit.textContent = 'Uploading photos…'; }
    try {
      var sigRes = await fetch(agentConfig.api_base + '/api/v1/business/' + agentConfig.business_public_id + '/cloudinary-signature?purpose=agent_kyc', {
        method: 'POST'
      });
      var sig = await sigRes.json();
      if (!sigRes.ok) throw new Error(sig.detail || 'Could not prepare photo upload');

      var selfieUrl = await uploadAgentPhoto(selfieData, sig);
      var idPhotoUrl = await uploadAgentPhoto(idData, sig);

      if (agentSignupSubmit) agentSignupSubmit.textContent = 'Creating account…';
      var res = await fetch(agentConfig.api_base + '/api/v1/business/' + agentConfig.business_public_id + '/cl-agent-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name, phone: phone || null, address: address || null, email: email, password: password,
          selfie_url: selfieUrl, id_photo_url: idPhotoUrl
        })
      });
      var data = await res.json();
      if (res.ok) {
        var loginEmailEl = document.getElementById('agent-login-email');
        if (loginEmailEl) loginEmailEl.value = email;
        agentSignupForm.reset();
        agentSelfieCam.reset();
        agentIdCam.reset();
        showAgentView(agentLoginView);
      } else {
        if (errEl) { errEl.textContent = data.detail || 'Sign up failed'; errEl.style.display = ''; }
      }
    } catch (err) {
      if (errEl) { errEl.textContent = (err && err.message) || 'Network error. Please try again.'; errEl.style.display = ''; }
    } finally {
      if (agentSignupSubmit) { agentSignupSubmit.disabled = false; agentSignupSubmit.textContent = 'Create account'; }
    }
  });

  if (navAgentLoginBtn) navAgentLoginBtn.addEventListener('click', openAgentModal);
  if (navSellCarBtn) navSellCarBtn.addEventListener('click', openSellModal);
  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', function(){ document.body.classList.toggle('mobile-nav-open'); });

  var agentLogoutBtn = document.getElementById('agent-logout-btn');
  if (agentLogoutBtn) agentLogoutBtn.addEventListener('click', function(){
    agentLoggedIn = false;
    if (agentLoginBtn) agentLoginBtn.textContent = 'Agent Login';
    if (agentLoginForm) agentLoginForm.reset();
    showAgentView(agentLoginView);
    closeAgentModal();
  });
})();
"""

@app.get("/showroom/{business_public_id}", response_class=HTMLResponse)
async def showroom_page(business_public_id: str):
    try:
        business = safe_get_business(business_public_id)
        if not business:
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1><p>This link is invalid.</p></div>")

        biz_name = business.get('name', '')
        logo_url = business.get('logo_url')
        hero_url = business.get('showroom_hero_image_url')

        try:
            vehicles = supabase.table("vehicles").select("*").eq("business_id", business.get("id")) \
                .in_("status", ["available", "reserved"]).order("created_at", desc=True).execute().data or []
        except Exception:
            vehicles = []

        logo_html = ('<img src="' + html_lib.escape(logo_url) + '" alt="Logo"/>') if logo_url else '&#128663;'
        featured_vehicle = vehicles[0] if vehicles else None
        featured_images = []
        if featured_vehicle:
            featured_images = featured_vehicle.get('image_urls') or ([featured_vehicle.get('image_url')] if featured_vehicle.get('image_url') else [])
            featured_images = [img for img in featured_images if img]
        featured_image_url = featured_images[0] if featured_images else ''
        featured_title = (f"{featured_vehicle.get('year') or ''} {featured_vehicle.get('make') or ''} {featured_vehicle.get('model') or ''}".strip() if featured_vehicle else 'Live dealership inventory')
        # Clean dealership hero using the newest live vehicle as the visual.
        hero_class = 'hero hero-home hero-fallback hero-clean'
        hero_style = ''
        featured_visual_html = (
            '<div class="hero-car-stage">'
            + ('<img class="hero-car-image" src="' + html_lib.escape(featured_image_url) + '" alt="' + html_lib.escape(featured_title) + '">' if featured_image_url else '<div class="hero-car-placeholder">&#128663;</div>')
            + '<div class="hero-plate"><span class="hero-plate-mark">' + logo_html + '</span><span>WOLF CARS</span></div>'
            + '<div class="hero-live-caption"><span class="hero-live-dot"></span>' + html_lib.escape(featured_title) + '</div>'
            + '</div>'
        )
        hero_html = (
            '<section class="' + hero_class + '">'
            '<div class="hero-overlay"><div class="hero-copy">'
            '<div class="hero-eyebrow"><span class="dot"></span>Verified live inventory</div>'
            '<div class="hero-logo">' + logo_html + '<span>' + html_lib.escape(biz_name) + '</span></div>'
            '<h1>Drive home your next vehicle.</h1>'
            '<p class="hero-subtitle">Browse ready-to-deliver cash and monthly-amortization units, review complete details, and inquire online.</p>'
            '<div class="hero-cta-row">'
            '<a href="#inventory" class="hero-primary-btn">Browse Available Cars</a>'
            '<button id="sell-car-btn" class="hero-secondary-btn" type="button">Sell a Car</button>'
            '</div>'
            '</div><div class="hero-visual">' + featured_visual_html + '</div></div>'
            '</section>'
        )


        # Fixed "Connect with us?" block (Facebook message button + phone
        # numbers) - replaces the old owner-editable inquiries/contact note.
        # The apply-links row at the bottom sends visitors to the public
        # /apply page (POST /api/v1/cl-apply/...) for the three roles the
        # owner reviews from the dashboard's Applications tab.
        # The 'seller' entry opens the richer "Sell your car" popup (photos,
        # vehicle specs, amortization - see sell_modal_html) instead of
        # linking to the plain /apply page like agent/buyer do.
        apply_links_html = (
            '<button type="button" id="connect-become-agent-btn" class="connect-apply-link">Become an Agent</button>'
            '<button type="button" id="connect-sell-link" class="connect-apply-link">Sell your car</button>'
        )
        payment_html = (
            '<section id="connect" class="connect-section"><div class="contact-wrap"><div class="contact-note">'
            '<div class="connect-title">Connect with us?</div>'
            '<a class="connect-fb-btn" href="https://www.facebook.com/wolfcarsmain08" target="_blank" rel="noopener noreferrer">'
            '&#128172; Message our Facebook page</a>'
            '<div class="connect-phones">or call us at <a href="tel:09551996574">0955-199-6574</a> or '
            '<a href="tel:09097030170">0909-703-0170</a></div>'
            '<div class="connect-apply-row">' + apply_links_html + '</div>'
            '</div></div></section>'
        )

        n_available = sum(1 for v in vehicles if v.get('status') == 'available')
        n_reserved = sum(1 for v in vehicles if v.get('status') == 'reserved')

        stats_html = (
            '<div class="stats-strip"><h2>Available Vehicles</h2>'
            '<span>' + str(len(vehicles)) + (' unit' if len(vehicles) == 1 else ' units') + ' listed</span></div>'
        )

        # Search bar - only shown once the inventory is big enough that
        # scrolling/chip-tapping alone gets tedious (5+ live units).
        search_html = (
            '<div class="search-wrap"><input type="text" id="car-search" class="search-input" '
            'placeholder="Search by make, model, or year..." autocomplete="off"></div>'
        ) if len(vehicles) >= 5 else ''

        chips = ['<button class="filter-chip active" data-status="all">All (' + str(len(vehicles)) + ')</button>']
        if n_available:
            chips.append('<button class="filter-chip" data-status="available">Available (' + str(n_available) + ')</button>')
        if n_reserved:
            chips.append('<button class="filter-chip" data-status="reserved">Reserved (' + str(n_reserved) + ')</button>')
        filter_html = ('<div class="filter-bar">' + ''.join(chips) + '</div>') if vehicles else ''

        # Make/brand chips (All + one per manufacturer, most-listed first) so
        # buyers can jump straight to a brand instead of scrolling the whole
        # grid - mirrors the status chips above but filters on data-make.
        make_counts = {}
        for v in vehicles:
            mk = (v.get('make') or '').strip()
            if mk:
                make_counts[mk] = make_counts.get(mk, 0) + 1
        sorted_makes = sorted(make_counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))

        if len(sorted_makes) > 1:
            make_chips = ['<button class="filter-chip active" data-make="all">All <span class="chip-count">'
                          + str(len(vehicles)) + '</span></button>']
            for mk, cnt in sorted_makes:
                make_chips.append(
                    '<button class="filter-chip" data-make="' + html_lib.escape(mk) + '">'
                    + html_lib.escape(mk) + ' <span class="chip-count">' + str(cnt) + '</span>'
                    '</button>'
                )
            make_filter_html = '<div class="filter-bar make-filter-bar">' + ''.join(make_chips) + '</div>'
        else:
            make_filter_html = ''

        if vehicles:
            cards = []
            cars_data = []
            for idx, v in enumerate(vehicles):
                raw_imgs = v.get('image_urls') or ([v.get('image_url')] if v.get('image_url') else [])
                raw_imgs = [i for i in raw_imgs if i][:VEHICLE_MAX_PHOTOS]
                imgs = [html_lib.escape(i) for i in raw_imgs]
                title = html_lib.escape(f"{v.get('year') or ''} {v.get('make', '')} {v.get('model', '')}".strip())
                title_plain = f"{v.get('year') or ''} {v.get('make', '')} {v.get('model', '')}".strip()

                if imgs:
                    gal_imgs_html = ''.join('<img src="' + i + '" alt="' + title + '" loading="lazy">' for i in imgs)
                    multi = len(imgs) > 1
                    nav_html = (
            '<nav class="site-nav"><div class="site-nav-inner">'
            '<a class="site-brand" href="#top"><span class="site-brand-mark">' + logo_html + '</span>'
            '<span class="site-brand-name">' + html_lib.escape(biz_name) + '</span></a>'
            '<div class="site-nav-links">'
            '<a href="#inventory">Available Cars</a><button id="nav-sell-car-btn" class="nav-text-btn" type="button">Sell a Car</button>'
            '<a href="#location">Location</a><button id="nav-agent-login-btn" class="site-nav-cta" type="button">Agent Login</button>'
            '</div><button id="mobile-menu-btn" class="mobile-menu-btn" type="button" aria-label="Open menu">&#9776;</button></div></nav>'
        )
        trust_html = (
            '<section class="benefit-strip" aria-label="Dealership advantages"><div class="benefit-strip-inner">'
            '<div class="benefit-chip"><span class="benefit-icon">&#10003;</span><strong>No Bank Approval</strong></div>'
            '<div class="benefit-divider"></div>'
            '<div class="benefit-chip"><span class="benefit-icon">&#9889;</span><strong>5-Minute Approval</strong></div>'
            '<div class="benefit-divider"></div>'
            '<div class="benefit-chip"><span class="benefit-icon">&#128663;</span><strong>Ready to Deliver</strong></div>'
            '<div class="benefit-divider"></div>'
            '<div class="benefit-chip"><span class="benefit-icon">&#128260;</span><strong>Trade-ins Accepted</strong></div>'
            '</div></section>'
        )
        agent_cta_html = (
            '<section class="home-section agent-cta-section">'
            '<div class="agent-cta-copy"><div class="home-kicker">Join our sales network</div>'
            '<h2 class="home-heading">Become a Sales Agent</h2>'
            '<p class="home-copy">Help buyers find the right vehicle and earn through successful referrals and sales. Submit your application online and start after approval.</p>'
            '<div class="agent-cta-benefits"><span>&#10003; Flexible selling</span><span>&#10003; Dealership inventory access</span><span>&#10003; Agent support</span><span>&#10003; Start after approval</span></div></div>'
            '<button id="section-become-agent-btn" class="hero-primary-btn agent-cta-btn" type="button">Become an Agent</button>'
            '</section>'
        )
        footer_html = '<div class="footer">Powered by LoyaltyTree &middot; listings update in real time</div>'

        showroom_address = "WOLFCARS, Saint Francis Subdivision, 129 Diamond Dr, Meycauayan, 3020 Bulacan"
        maps_embed_src = "https://maps.google.com/maps?q=" + quote(showroom_address) + "&output=embed"
        maps_directions_href = "https://www.google.com/maps/search/?api=1&query=" + quote(showroom_address)
        location_html = (
            '<div id="location" class="location-wrap">'
            '<div class="location-title">Find us</div>'
            '<div class="location-address">' + html_lib.escape(showroom_address) + '</div>'
            '<div class="location-map"><iframe src="' + maps_embed_src + '" loading="lazy" '
            'referrerpolicy="no-referrer-when-downgrade" allowfullscreen title="Showroom location"></iframe></div>'
            '<a class="location-directions-btn" href="' + maps_directions_href + '" target="_blank" rel="noopener noreferrer">'
            '&#128205; Get directions</a>'
            '</div>'
        )

        html = (
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
            '<title>' + html_lib.escape(biz_name) + ' Showroom</title>'
            '<link rel="preconnect" href="https://fonts.googleapis.com">'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
            '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
            '<style>' + SHOWROOM_CSS + '</style></head><body id="top">'
            + nav_html + hero_html + trust_html + '<section id="inventory" class="inventory-shell"><div class="inventory-toolbar">' + stats_html + search_html + filter_html + make_filter_html + '</div>' + grid_html + '</section>' + agent_cta_html + payment_html + location_html + footer_html + lightbox_html + vehicle_modal_html + agent_modal_html + inquiry_modal_html + sell_modal_html +
            '<script>' + SHOWROOM_JS + '</script>'
            '</body></html>'
        )
        return HTMLResponse(html)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Error</h1><p>Could not load showroom: " + str(e) + "</p></div>")

@app.post("/api/v1/cl-join/{business_public_id}")
async def cl_customer_self_signup(business_public_id: str, signup: CLCustomerSelfSignup):
    business = safe_get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if business.get('status', '').upper() != 'ACTIVE':
        raise HTTPException(status_code=400, detail="Business not active")

    dup_field = find_cl_customer_duplicate(business.get('id'), signup.phone, signup.email)
    if dup_field:
        raise HTTPException(
            status_code=400,
            detail=f"This {dup_field} is already registered with this dealership."
        )

    customer_public_id = generate_public_id()
    customer_data = {
        'business_id': business.get('id'),
        'public_id': customer_public_id,
        'name': signup.name,
        'phone': signup.phone,
        'email': signup.email,
        'address': signup.address,
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
    }
    try:
        supabase.table("cl_customers").insert(customer_data).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    return {
        "public_id": customer_public_id,
        "name": signup.name,
        "message": "Registered - add your card to your wallet.",
    }

@app.post("/api/v1/cl-apply/{business_public_id}")
async def cl_application_self_signup(business_public_id: str, application: CLApplicationSelfSignup):
    """Public, unauthenticated endpoint the /apply page submits to. Always
    lands as 'pending' - only the owner's dashboard (see the Applications
    tab, after Payments) can move it to approved/rejected."""
    business = safe_get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if business.get('status', '').upper() != 'ACTIVE':
        raise HTTPException(status_code=400, detail="This dealership isn't accepting applications yet.")

    application_data = {
        'business_id': business.get('id'),
        'public_id': generate_public_id(),
        'role': application.role,
        'name': application.name,
        'phone': application.phone,
        'email': application.email,
        'notes': application.notes,
        'status': 'pending',
    }
    try:
        supabase.table("cl_applications").insert(application_data).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    return {
        "success": True,
        "message": "Application received - we'll be in touch once it's reviewed.",
    }

@app.post("/api/v1/business/{business_public_id}/cl-agent-signup")
async def cl_agent_signup(business_public_id: str, signup: CLAgentSignup):
    """Public, unauthenticated endpoint the showroom's Agent Login popup
    submits its "Sign up" form to. Does NOT create a cl_agents account
    directly - it lands as a pending row in cl_applications (role='agent'),
    same as any other agent application, carrying the hashed password and
    both KYC photos along with it. Only the owner's dashboard (Applications
    tab -> Agents Application) can approve or reject it; approving is what
    actually provisions the real cl_agents login account - see
    update_cl_application(). Requires a selfie_url and id_photo_url, both
    camera-captured (no file picker) and already uploaded to Cloudinary
    (purpose=agent_kyc on the signature endpoint) by the time this is
    called - see the agent-signup-view JS in SHOWROOM_JS. Logging in with
    the resulting account is still a front-end placeholder for now (see
    SHOWROOM_JS)."""
    business = safe_get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    if business.get('status', '').upper() != 'ACTIVE':
        raise HTTPException(status_code=400, detail="This dealership isn't accepting agent signups yet.")

    email = signup.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    if not signup.selfie_url or not signup.id_photo_url:
        raise HTTPException(status_code=400, detail="A camera-captured selfie and ID photo are both required.")

    try:
        existing_agent = supabase.table("cl_agents").select("id") \
            .eq("business_id", business.get("id")).eq("email", email).maybe_single().execute()
        if existing_agent.data:
            raise HTTPException(status_code=400, detail="An agent account with this email already exists.")
        existing_application = supabase.table("cl_applications").select("id") \
            .eq("business_id", business.get("id")).eq("role", "agent") \
            .eq("email", email).eq("status", "pending").maybe_single().execute()
        if existing_application.data:
            raise HTTPException(status_code=400, detail="An application with this email is already pending review.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"cl_agent_signup lookup error: {e}")

    application_public_id = generate_public_id()
    application_data = {
        'business_id': business.get('id'),
        'public_id': application_public_id,
        'role': 'agent',
        'name': signup.name,
        'phone': signup.phone,
        'address': signup.address,
        'email': email,
        'password_hash': hash_password(signup.password),
        'selfie_url': signup.selfie_url,
        'id_photo_url': signup.id_photo_url,
        'status': 'pending',
    }
    try:
        supabase.table("cl_applications").insert(application_data).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    return {
        "success": True,
        "public_id": application_public_id,
        "name": signup.name,
        "message": "Application received - pending the dealership's review before you can log in.",
    }

# AGENT INVENTORY PAGE
#
# Simple, agent-facing page - separate from the owner's React dashboard and
# from the public /showroom page. Agents open /agent/{business_public_id}
# (link shared by the owner for now - there's no session/login gate wired
# up yet, same "placeholder" state SHOWROOM_JS's Agent Login popup is
# already in) and see every unit in inventory, any status, as a tappable
# grid. Tapping a card opens a detail sheet with the full spec sheet and a
# "Copy details" button that builds a ready-to-post listing (title, price/
# financing line, specs, location) and copies it to the clipboard via
# navigator.clipboard, so the agent can paste it straight into FB
# Marketplace/groups/chat. `notes` (the internal-only field, e.g. agent fee)
# is intentionally left out of the copied text - shown in the detail sheet
# for the agent's own reference only, never in what gets pasted publicly.
# Styling reuses the same --ink/--muted/--line/--accent tokens as
# SHOWROOM_CSS so it feels like the same product, under agent-* class names
# so nothing here collides with the showroom's CSS/JS if both are ever
# embedded on the same page.

AGENT_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#0f172a;--muted:#64748b;--line:#e7eaf0;--accent:#0d9488;--accent-dark:#0b7c72;--paper:#f6f7fb}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--paper);color:var(--ink);padding-bottom:48px;-webkit-font-smoothing:antialiased}

.agent-header{background:var(--ink);color:#fff;padding:18px 20px;position:sticky;top:0;z-index:50;
  display:flex;align-items:center;gap:12px}
.agent-header img{width:36px;height:36px;border-radius:10px;object-fit:cover;flex-shrink:0}
.agent-header-text{flex:1;min-width:0}
.agent-header-text h1{font-size:15px;font-weight:700;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-header-text p{font-size:11.5px;color:#94a3b8;margin-top:1px}

.agent-toolbar{max-width:1080px;margin:16px auto 0;padding:0 20px}
.agent-search{width:100%;padding:12px 16px 12px 42px;border:1px solid var(--line);border-radius:12px;
  font-size:14px;font-family:inherit;color:var(--ink);background:#fff url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>') no-repeat 14px center/16px 16px;
  outline:none}
.agent-search:focus{border-color:var(--accent)}
.agent-filter-bar{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;margin-top:12px;padding-bottom:4px;scrollbar-width:thin}
.agent-filter-bar::-webkit-scrollbar{height:5px}
.agent-filter-bar::-webkit-scrollbar-thumb{background:var(--line);border-radius:999px}
.agent-chip{flex:0 0 auto;border:1px solid var(--line);background:#fff;color:var(--muted);font-size:12.5px;font-weight:600;
  padding:8px 14px;border-radius:999px;cursor:pointer;transition:all .15s ease}
.agent-chip:hover{border-color:#cbd5e1;color:var(--ink)}
.agent-chip.active{background:var(--ink);border-color:var(--ink);color:#fff}

.agent-grid{max-width:1080px;margin:16px auto 0;padding:0 20px;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.agent-card{background:#fff;border-radius:16px;overflow:hidden;border:1px solid var(--line);cursor:pointer;
  box-shadow:0 1px 3px rgba(15,23,42,0.04);transition:transform .15s ease,box-shadow .15s ease}
.agent-card:hover{transform:translateY(-3px);box-shadow:0 12px 24px rgba(15,23,42,0.1)}
.agent-card-img{position:relative;aspect-ratio:4/3;background:linear-gradient(135deg,#eef1f6,#e2e8f0)}
.agent-card-img img{width:100%;height:100%;object-fit:cover;display:block}
.agent-card-noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:38px;color:#b6c0cf}
.agent-status-badge{position:absolute;top:9px;left:9px;font-size:10px;font-weight:700;text-transform:capitalize;
  padding:4px 9px;border-radius:999px;letter-spacing:0.02em;box-shadow:0 4px 10px rgba(0,0,0,0.15)}
.agent-status-available{background:#dcfce7;color:#15803d}
.agent-status-reserved{background:#fef9c3;color:#a16207}
.agent-status-financed{background:#dbeafe;color:#1d4ed8}
.agent-status-sold{background:#f1f5f9;color:#64748b}
.agent-card-info{padding:12px 14px 14px}
.agent-card-info h3{font-size:14.5px;font-weight:700;letter-spacing:-0.01em;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-card-meta{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-card-price{font-size:15px;font-weight:800;color:var(--accent-dark);margin-top:8px}

.agent-empty{max-width:1080px;margin:60px auto;text-align:center;color:#94a3b8;padding:0 20px}
.agent-empty .icon{font-size:40px;margin-bottom:10px}

.agent-modal{display:none;position:fixed;inset:0;background:rgba(2,6,23,0.6);z-index:900;
  align-items:flex-end;justify-content:center;padding:0}
.agent-modal.open{display:flex}
.agent-modal-card{background:#fff;border-radius:20px 20px 0 0;max-width:480px;width:100%;max-height:90vh;
  overflow-y:auto;position:relative;-webkit-overflow-scrolling:touch}
.agent-modal-close{position:absolute;top:12px;right:12px;z-index:3;width:34px;height:34px;border-radius:50%;
  border:none;background:rgba(15,23,42,0.55);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.agent-modal-gallery{position:relative;aspect-ratio:4/3;background:#e2e8f0}
.agent-modal-gallery img{width:100%;height:100%;object-fit:cover;display:block}
.agent-modal-nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;
  border:none;background:rgba(2,6,23,0.5);color:#fff;font-size:13px;cursor:pointer}
.agent-modal-nav.prev{left:10px}.agent-modal-nav.next{right:10px}
.agent-modal-count{position:absolute;bottom:10px;right:10px;background:rgba(2,6,23,0.55);color:#fff;font-size:11px;
  font-weight:600;padding:3px 9px;border-radius:999px}
.agent-modal-body{padding:20px 22px 24px}
.agent-modal-body h3{font-size:19px;font-weight:800;letter-spacing:-0.01em;margin-bottom:4px}
.agent-modal-meta{font-size:13px;color:var(--muted);margin-bottom:14px}
.agent-modal-specs{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin-bottom:14px}
.agent-modal-spec-label{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em}
.agent-modal-spec-value{font-size:13.5px;font-weight:600;color:var(--ink)}
.agent-modal-note{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:12.5px;
  color:#92400e;margin-bottom:14px}
.agent-modal-note b{font-weight:700}
.agent-modal-price-row{display:flex;align-items:center;gap:10px;padding-top:14px;border-top:1px dashed var(--line);margin-bottom:16px}
.agent-modal-price{font-size:21px;font-weight:800;color:var(--ink);letter-spacing:-0.01em}
.agent-copy-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
  background:var(--accent);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14.5px;font-weight:700;
  font-family:inherit;cursor:pointer;transition:background .15s ease}
.agent-copy-btn:hover{background:var(--accent-dark)}
.agent-copy-btn.copied{background:#15803d}

.agent-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(0);background:var(--ink);
  color:#fff;padding:11px 20px;border-radius:999px;font-size:13px;font-weight:600;z-index:1000;
  box-shadow:0 10px 24px rgba(0,0,0,0.25);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}
.agent-toast.show{opacity:1;transform:translateX(-50%) translateY(-6px)}

@media(min-width:640px){
  .agent-modal{align-items:center}
  .agent-modal-card{border-radius:20px;max-height:88vh}
}
"""

AGENT_JS = """
(function(){
  var cars = JSON.parse(document.getElementById('agent-cars-data').textContent);
  var grid = document.getElementById('agent-grid');
  var search = document.getElementById('agent-search');
  var statusChips = document.querySelectorAll('.agent-chip[data-status]');
  var activeStatus = 'all';

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function applyFilters(){
    var q = (search ? search.value : '').trim().toLowerCase();
    var cards = grid.querySelectorAll('.agent-card');
    var visible = 0;
    cards.forEach(function(card){
      var idx = Number(card.getAttribute('data-idx'));
      var car = cars[idx];
      var matchesStatus = activeStatus === 'all' || car.status === activeStatus;
      var matchesSearch = !q || car.search.indexOf(q) !== -1;
      var show = matchesStatus && matchesSearch;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    var empty = document.getElementById('agent-no-results');
    if (empty) empty.style.display = visible === 0 ? 'block' : 'none';
  }

  statusChips.forEach(function(chip){
    chip.addEventListener('click', function(){
      statusChips.forEach(function(c){ c.classList.remove('active'); });
      chip.classList.add('active');
      activeStatus = chip.getAttribute('data-status');
      applyFilters();
    });
  });
  if (search) search.addEventListener('input', applyFilters);

  // ---- Detail modal ----
  var modal = document.getElementById('agent-modal');
  var modalImg = document.getElementById('agent-modal-img');
  var modalCount = document.getElementById('agent-modal-count');
  var modalTitle = document.getElementById('agent-modal-title');
  var modalMeta = document.getElementById('agent-modal-meta');
  var modalSpecs = document.getElementById('agent-modal-specs');
  var modalNote = document.getElementById('agent-modal-note');
  var modalPrice = document.getElementById('agent-modal-price');
  var copyBtn = document.getElementById('agent-copy-btn');
  var saveImagesBtn = document.getElementById('agent-save-images-btn');
  var currentCar = null;
  var currentImgIndex = 0;

  function renderModalImage(){
    var imgs = currentCar.imgs;
    if (imgs.length){
      modalImg.src = imgs[currentImgIndex];
      modalCount.style.display = imgs.length > 1 ? 'block' : 'none';
      modalCount.textContent = (currentImgIndex + 1) + '/' + imgs.length;
    } else {
      modalImg.src = '';
      modalCount.style.display = 'none';
    }
  }

  function openModal(car){
    currentCar = car;
    currentImgIndex = 0;
    modalTitle.textContent = car.title;
    modalMeta.textContent = car.meta;
    modalSpecs.innerHTML = car.specs.map(function(s){
      return '<div><div class="agent-modal-spec-label">' + escapeHtml(s.label) + '</div>'
        + '<div class="agent-modal-spec-value">' + escapeHtml(s.value) + '</div></div>';
    }).join('');
    modalPrice.textContent = car.price;
    if (car.note){
      modalNote.style.display = 'block';
      modalNote.innerHTML = '<b>Internal note:</b> ' + escapeHtml(car.note);
    } else {
      modalNote.style.display = 'none';
    }
    copyBtn.classList.remove('copied');
    copyBtn.textContent = 'Copy Agent Post';
    saveImagesBtn.disabled = !car.imgs || car.imgs.length === 0;
    saveImagesBtn.textContent = car.imgs && car.imgs.length
      ? 'Save Images (' + car.imgs.length + ')'
      : 'Save Images';
    renderModalImage();
    modal.classList.add('open');
  }
  function closeModal(){ modal.classList.remove('open'); currentCar = null; }

  grid.addEventListener('click', function(e){
    var card = e.target.closest('.agent-card');
    if (!card) return;
    openModal(cars[Number(card.getAttribute('data-idx'))]);
  });
  document.getElementById('agent-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', function(e){ if (e.target === modal) closeModal(); });
  document.getElementById('agent-modal-prev').addEventListener('click', function(){
    if (!currentCar || !currentCar.imgs.length) return;
    currentImgIndex = (currentImgIndex - 1 + currentCar.imgs.length) % currentCar.imgs.length;
    renderModalImage();
  });
  document.getElementById('agent-modal-next').addEventListener('click', function(){
    if (!currentCar || !currentCar.imgs.length) return;
    currentImgIndex = (currentImgIndex + 1) % currentCar.imgs.length;
    renderModalImage();
  });

  // ---- Agent-ready copy and image download tools ----
  function specValue(car, label){
    var item = (car.specs || []).find(function(s){ return s.label === label; });
    return item ? String(item.value || '') : '';
  }

  function dateDayOnly(value){
    if (!value) return '';
    var d = new Date(value + (String(value).length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return String(value).replace(/^0+/, '');
    return String(d.getDate());
  }

  function monthAndDay(value){
    if (!value) return '';
    var d = new Date(value + (String(value).length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  function money(value){
    var n = Number(value || 0);
    return '₱' + n.toLocaleString('en-PH', { maximumFractionDigits: 0 });
  }

  function buildPostText(car){
    var monthly = car.payment_type === 'monthly_amortization';
    var lines = [];
    lines.push('Unit update: ' + new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }));
    lines.push('');
    lines.push(monthly ? 'Tuloy hulog/ Rent to own' : 'For sale!!');
    lines.push('');
    lines.push(car.title || '');
    if (car.transmission) lines.push(String(car.transmission).toUpperCase());
    if (car.color) lines.push(String(car.color));
    if (car.plate_ending) lines.push('Plate ending: ' + car.plate_ending);

    if (monthly){
      lines.push('');
      if (car.amortization_due_date) lines.push('Due date: ' + dateDayOnly(car.amortization_due_date));
      if (car.amortization_next_due) lines.push('Next due: ' + monthAndDay(car.amortization_next_due));
      if (car.amortization_months_remaining !== null && car.amortization_months_remaining !== undefined && car.amortization_months_remaining !== ''){
        lines.push('Months remaining: ' + car.amortization_months_remaining);
      }
    }

    lines.push('');
    lines.push('Net price: ' + money(monthly ? car.downpayment : car.sale_price) + (monthly ? ' All in DP!!' : ''));
    lines.push('');
    lines.push('✅ no need bank approval');
    lines.push('✅ ready to deliver for sure buyer');
    lines.push('✅ 5 mins approval only');
    lines.push('✅ we accept trade in upgrade or downgrade');
    if (car.note){
      lines.push('');
      lines.push('Agent fee / Admin note: ' + car.note);
    }
    return lines.join('\\n');
  }

  copyBtn.addEventListener('click', function(){
    if (!currentCar) return;
    var text = buildPostText(currentCar);
    var done = function(){
      copyBtn.classList.add('copied');
      copyBtn.textContent = 'Copied!';
      showToast('Agent post copied - ready to paste');
      setTimeout(function(){
        copyBtn.classList.remove('copied');
        copyBtn.textContent = 'Copy Agent Post';
      }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  });

  saveImagesBtn.addEventListener('click', function(){
    if (!currentCar || !currentCar.imgs || !currentCar.imgs.length) return;
    var baseName = String(currentCar.title || 'vehicle')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    currentCar.imgs.forEach(function(url, index){
      setTimeout(function(){
        var a = document.createElement('a');
        a.href = url;
        a.download = baseName + '-' + (index + 1) + '.jpg';
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 250);
    });
    showToast('Saving ' + currentCar.imgs.length + ' image' + (currentCar.imgs.length === 1 ? '' : 's'));
  });

  function fallbackCopy(text, done){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function showToast(msg){
    var toast = document.getElementById('agent-toast');
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 2200);
  }
})();
"""

@app.get("/agent/{business_public_id}", response_class=HTMLResponse)
async def agent_inventory_page(business_public_id: str):
    """Agent-facing inventory page - GET /agent/{business_public_id}.
    Shows every vehicle regardless of status (agents need to see the whole
    lot, not just what's publicly listed on /showroom). Tapping a card
    opens a detail sheet with a "Copy details to post" button that copies a
    ready-to-paste listing to the clipboard - see AGENT_JS's buildPostText.
    No login/session yet - see the AGENT INVENTORY PAGE comment above this
    route; that's a follow-up, not wired into this page yet."""
    business = safe_get_business(business_public_id)
    if not business:
        return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1><p>This link is invalid.</p></div>")

    biz_name = business.get('name', '')
    logo_url = business.get('logo_url')

    try:
        vehicles = supabase.table("vehicles").select("*").eq("business_id", business.get("id")) \
            .order("created_at", desc=True).execute().data or []
    except Exception:
        vehicles = []

    logo_html = ('<img src="' + html_lib.escape(logo_url) + '" alt="Logo"/>') if logo_url else ''
    header_html = (
        '<div class="agent-header">' + logo_html +
        '<div class="agent-header-text"><h1>' + html_lib.escape(biz_name) + '</h1>'
        '<p>Agent Inventory · ' + str(len(vehicles)) + (' unit' if len(vehicles) == 1 else ' units') + '</p></div>'
        '</div>'
    )

    status_counts = {}
    for v in vehicles:
        st = v.get('status') or ''
        if st:
            status_counts[st] = status_counts.get(st, 0) + 1
    status_order = ['available', 'reserved', 'financed', 'sold']
    chips = ['<button class="agent-chip active" data-status="all">All (' + str(len(vehicles)) + ')</button>']
    for st in status_order:
        if status_counts.get(st):
            chips.append(
                '<button class="agent-chip" data-status="' + st + '">'
                + st.capitalize() + ' (' + str(status_counts[st]) + ')</button>'
            )
    filter_html = '<div class="agent-filter-bar">' + ''.join(chips) + '</div>' if vehicles else ''

    search_html = (
        '<input type="text" id="agent-search" class="agent-search" placeholder="Search by make, model, plate...">'
    ) if len(vehicles) >= 5 else ''

    toolbar_html = (
        '<div class="agent-toolbar">' + search_html + filter_html + '</div>'
    ) if vehicles else ''

    if vehicles:
        cards = []
        cars_data = []
        for idx, v in enumerate(vehicles):
            raw_imgs = v.get('image_urls') or ([v.get('image_url')] if v.get('image_url') else [])
            raw_imgs = [i for i in raw_imgs if i][:VEHICLE_MAX_PHOTOS]
            imgs = [html_lib.escape(i) for i in raw_imgs]
            title_plain = f"{v.get('year') or ''} {v.get('make', '')} {v.get('model', '')}".strip()
            title = html_lib.escape(title_plain)
            status = v.get('status') or ''

            payment_type = v.get('payment_type')
            monthly_amount = v.get('monthly_amortization_amount')
            price = v.get('price') or 0
            if payment_type == 'monthly_amortization':
                price_str = (f"₱{monthly_amount:,.0f}/month" if monthly_amount else "Contact for pricing")
            else:
                price_str = f"₱{price:,.0f}"

            meta_bits_plain = []
            if v.get('color'):
                meta_bits_plain.append(str(v.get('color')))
            if v.get('mileage') is not None:
                meta_bits_plain.append(f"{v.get('mileage'):,} km")
            if v.get('plate_number'):
                meta_bits_plain.append(f"Plate {v.get('plate_number')}")
            meta_plain = ' · '.join(meta_bits_plain)
            meta = html_lib.escape(meta_plain)

            if imgs:
                img_html = '<img src="' + imgs[0] + '" alt="' + title + '" loading="lazy">'
            else:
                img_html = '<div class="agent-card-noimg">&#128663;</div>'

            cards.append(
                '<div class="agent-card" data-idx="' + str(idx) + '">'
                '<div class="agent-card-img">'
                + ('<span class="agent-status-badge agent-status-' + status + '">' + status + '</span>' if status else '')
                + img_html +
                '</div>'
                '<div class="agent-card-info">'
                '<h3>' + title + '</h3>'
                + ('<div class="agent-card-meta">' + meta + '</div>' if meta else '') +
                '<div class="agent-card-price">' + price_str + '</div>'
                '</div></div>'
            )

            # Fuller spec sheet + plain-text fields for the detail sheet and
            # the copy-to-post button - unescaped since AGENT_JS sets these
            # via textContent/escapeHtml, not innerHTML from raw strings.
            specs_data = []
            if v.get('transmission'):
                specs_data.append({'label': 'Transmission', 'value': str(v.get('transmission')).capitalize()})
            if v.get('fuel_type'):
                specs_data.append({'label': 'Fuel type', 'value': str(v.get('fuel_type')).capitalize()})
            if v.get('mileage') is not None:
                specs_data.append({'label': 'Mileage', 'value': f"{v.get('mileage'):,} km"})
            if v.get('color'):
                specs_data.append({'label': 'Color', 'value': str(v.get('color'))})
            if v.get('plate_number'):
                specs_data.append({'label': 'Plate number', 'value': str(v.get('plate_number'))})
            if v.get('plate_end_in'):
                specs_data.append({'label': 'Plate ends in', 'value': str(v.get('plate_end_in'))})
            if v.get('location'):
                specs_data.append({'label': 'Location', 'value': str(v.get('location'))})
            if payment_type == 'monthly_amortization':
                specs_data.append({'label': 'Payment type', 'value': 'Monthly amortization'})
                if v.get('downpayment') is not None:
                    specs_data.append({'label': 'Downpayment', 'value': f"₱{v.get('downpayment'):,.0f}"})
                if v.get('amortization_due_date'):
                    specs_data.append({'label': 'Due date', 'value': format_showroom_date(v.get('amortization_due_date'))})
                if v.get('amortization_next_due'):
                    specs_data.append({'label': 'Next due', 'value': format_showroom_date(v.get('amortization_next_due'))})
                if v.get('amortization_months_remaining') is not None:
                    specs_data.append({'label': 'Months remaining', 'value': str(v.get('amortization_months_remaining'))})
            elif payment_type == 'cash':
                specs_data.append({'label': 'Payment type', 'value': 'Cash'})

            cars_data.append({
                'public_id': v.get('public_id'),
                'title': title_plain,
                'meta': meta_plain,
                'specs': specs_data,
                'price': price_str,
                'status': status,
                'imgs': raw_imgs,
                'note': v.get('notes') or '',
                'payment_type': payment_type,
                'transmission': v.get('transmission') or '',
                'color': v.get('color') or '',
                'plate_ending': v.get('plate_end_in') or (str(v.get('plate_number') or '')[-1:] if v.get('plate_number') else ''),
                'downpayment': float(v.get('downpayment') or 0),
                'sale_price': float(v.get('price') or 0),
                'amortization_due_date': str(v.get('amortization_due_date') or ''),
                'amortization_next_due': str(v.get('amortization_next_due') or ''),
                'amortization_months_remaining': v.get('amortization_months_remaining'),
                'search': (title_plain + ' ' + meta_plain + ' ' + str(v.get('plate_number') or '')).lower(),
            })
        grid_html = '<div class="agent-grid" id="agent-grid">' + ''.join(cards) + '</div>'
        no_results_html = (
            '<div id="agent-no-results" class="agent-empty" style="display:none">'
            '<div class="icon">&#128269;</div><p>No vehicles match your search.</p></div>'
        )
        cars_json = json.dumps(cars_data).replace('</', '<\\/')
    else:
        grid_html = '<div id="agent-grid" class="agent-grid"></div>'
        no_results_html = '<div class="agent-empty"><div class="icon">&#128663;</div><p>No vehicles in inventory yet.</p></div>'
        cars_json = '[]'

    modal_html = (
        '<div id="agent-modal" class="agent-modal">'
        '<div class="agent-modal-card">'
        '<button id="agent-modal-close" class="agent-modal-close" aria-label="Close">&times;</button>'
        '<div class="agent-modal-gallery">'
        '<img id="agent-modal-img" src="" alt="Vehicle photo">'
        '<button id="agent-modal-prev" class="agent-modal-nav prev" aria-label="Previous photo">&#10094;</button>'
        '<button id="agent-modal-next" class="agent-modal-nav next" aria-label="Next photo">&#10095;</button>'
        '<span id="agent-modal-count" class="agent-modal-count"></span>'
        '</div>'
        '<div class="agent-modal-body">'
        '<h3 id="agent-modal-title"></h3>'
        '<p id="agent-modal-meta" class="agent-modal-meta"></p>'
        '<div id="agent-modal-specs" class="agent-modal-specs"></div>'
        '<div id="agent-modal-note" class="agent-modal-note" style="display:none"></div>'
        '<div class="agent-modal-price-row">'
        '<span id="agent-modal-price" class="agent-modal-price"></span>'
        '</div>'
        '<div style="display:flex;gap:10px;flex-wrap:wrap">'
        '<button type="button" id="agent-copy-btn" class="agent-copy-btn" style="flex:1;min-width:180px">Copy Agent Post</button>'
        '<button type="button" id="agent-save-images-btn" class="agent-copy-btn" style="flex:1;min-width:160px">Save Images</button>'
        '</div>'
        '</div></div></div>'
        '<script id="agent-cars-data" type="application/json">' + cars_json + '</script>'
    )

    html = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>' + html_lib.escape(biz_name) + ' - Agent Inventory</title>'
        '<style>' + AGENT_CSS + '</style></head><body>'
        + header_html + toolbar_html + grid_html + no_results_html + modal_html +
        '<div id="agent-toast" class="agent-toast"></div>'
        '<script>' + AGENT_JS + '</script>'
        '</body></html>'
    )
    return HTMLResponse(html)

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
    multipass_description = (program.get('description') if program else None) or 'Session pass'
    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    sessions_total = customer.get('multipass_total_sessions', 0) or (program.get('multipass_session_count', 12) if program else 12)
    multipass_expires_at = customer.get('multipass_expires_at')
    multipass_expired = bool(multipass_expires_at and multipass_expires_at < datetime.utcnow().date().isoformat())
    membership_services = (program.get('membership_services') if program else None) or []
    membership_summary = (
        get_membership_summary(business.get('id'), customer.get('id'))
        if card_type == 'membership' else None
    )

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
            # --- Multipass-only fields ---
            "sessions_remaining": sessions_remaining,
            "sessions_total": sessions_total,
            "multipass_description": multipass_description,
            "multipass_expires_at": multipass_expires_at,
            "multipass_expired": multipass_expired,
            # --- Membership-only fields ---
            "membership_services": membership_services,
            "total_visits": (membership_summary['total_visits'] if membership_summary else 0),
            "last_service_name": (membership_summary['last_service_name'] if membership_summary else None),
            "last_service_date": (membership_summary['last_service_date'] if membership_summary else None),
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

    # Car-lending passes use a 'cl-' prefixed serial number (see
    # build_cl_apple_pass_json) so this one shared web-service route can
    # tell which table - and which pass-building logic - a refetch belongs
    # to, without needing a second passTypeIdentifier/webServiceURL.
    if serial_number.startswith('cl-'):
        cust_public_id = serial_number[len('cl-'):]
        customer = safe_get_cl_customer(cust_public_id)
        if not customer:
            raise HTTPException(status_code=404, detail="Not found")
        business = safe_get_business_by_id(customer.get('business_id'))
        if not business:
            raise HTTPException(status_code=404, detail="Not found")

        contract = get_active_contract_for_cl_customer(customer.get('id'))
        announcement = get_latest_cl_announcement(business.get('id'))
        reminder_text = None
        if contract and contract.get('status') in ('active', 'overdue') and contract.get('next_due_date'):
            try:
                next_due = datetime.fromisoformat(contract['next_due_date']).date()
                stage = compute_reminder_stage(next_due, datetime.utcnow().date()) or (
                    'overdue' if contract.get('status') == 'overdue' else None
                )
                if stage:
                    _, _, reminder_text = build_cl_wallet_reminder_text(contract, stage)
            except Exception:
                pass

        contract_ts = _parse_ts((contract or {}).get('updated_at'))
        customer_ts = _parse_ts(customer.get('updated_at'))
        ann_ts_raw = (announcement or {}).get('updated_at') or (announcement or {}).get('created_at')
        ann_ts = _parse_ts(ann_ts_raw)
        candidates = [t for t in (contract_ts, customer_ts, ann_ts) if t]
        if not candidates:
            last_modified = datetime.utcnow().isoformat()
            last_modified_ts = None
        elif ann_ts and ann_ts == max(candidates):
            last_modified, last_modified_ts = ann_ts_raw, ann_ts
        elif contract_ts and contract_ts == max(candidates):
            last_modified, last_modified_ts = (contract or {}).get('updated_at'), contract_ts
        else:
            last_modified, last_modified_ts = customer.get('updated_at'), customer_ts

        since_ts = _parse_ts(if_modified_since)
        if last_modified_ts and since_ts and last_modified_ts <= since_ts:
            return Response(status_code=304)

        pkpass_bytes = build_cl_pkpass_bytes(customer, business, contract, announcement, reminder_text)
        if pkpass_bytes is None:
            raise HTTPException(status_code=500, detail="Could not build pass")
        return Response(
            content=pkpass_bytes,
            media_type="application/vnd.apple.pkpass",
            headers={"Last-Modified": last_modified or datetime.utcnow().isoformat()},
        )

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

@app.post("/api/v1/cron/loan-payment-reminders")
async def run_loan_payment_reminders(_: bool = Depends(require_cron)):
    """Pushes a Google/Apple Wallet notification to car-lending buyers 7
    days before, 3 days before, and on the day a payment is due; flags the
    contract 'overdue' and sends one more notice the moment it slips past
    due. Wallet push only - no email. Each of the 4 touchpoints only ever
    fires once per due-date cycle - contracts.last_reminder_stage dedupes
    it, and gets reset to null whenever a new payment lands (see
    /contracts/{id}/payments), which starts the cycle over for the new due
    date. Safe to run more than once a day. Point an external scheduler at
    this daily, same as the crons above.

    Note: a buyer only receives these if they've added the wallet pass
    (via /cl-wallet/{public_id} or the QR/link the owner shares with them) -
    there's no email fallback, so a buyer who never added the card gets no
    reminder at all. contract/status/last_reminder_stage still update
    either way, so 'flagged_overdue' and the dashboard stay accurate
    regardless of whether the push itself lands."""
    today = datetime.utcnow().date()
    sent, skipped, flagged_overdue, errors = 0, 0, 0, 0

    try:
        active = supabase.table("contracts").select("*").eq("status", "active").execute().data or []
        overdue = supabase.table("contracts").select("*").eq("status", "overdue").execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    for contract in active + overdue:
        next_due_raw = contract.get('next_due_date')
        if not next_due_raw:
            continue
        try:
            next_due = datetime.fromisoformat(next_due_raw).date()
        except Exception:
            continue

        stage = compute_reminder_stage(next_due, today)
        if not stage:
            continue

        # Flip to overdue the moment it slips past due, independent of
        # whether the push below succeeds.
        if stage == 'overdue' and contract.get('status') != 'overdue':
            try:
                supabase.table("contracts").update(
                    {'status': 'overdue', 'updated_at': datetime.utcnow().isoformat()}
                ).eq("id", contract.get("id")).execute()
                contract['status'] = 'overdue'
            except Exception:
                pass
            flagged_overdue += 1

        if contract.get('last_reminder_stage') == stage:
            skipped += 1
            continue

        business = safe_get_business_by_id(contract.get('business_id'))
        customer = safe_get_cl_customer_by_id(contract.get('customer_id'))
        if not business or not customer:
            continue

        header, body, _short = build_cl_wallet_reminder_text(contract, stage)
        message_id = f"cl-reminder-{contract.get('id')}-{next_due_raw}-{stage}"

        # Google: PATCH the pass's live balance/due-date fields, then fire a
        # TEXT_AND_NOTIFY push on that same call - one round trip.
        sync_cl_wallet_object(customer, business, contract, notify_header=header, notify_body=body, notify_message_id=message_id)
        # Apple: no server-triggered "send this text" call exists - a push
        # just tells the device to refetch, and the NEXT DUE field's new
        # value (computed fresh in apple_get_updated_pass) is what actually
        # triggers the lock-screen notification on that refetch.
        sync_cl_apple_wallet_pass(customer)

        sent += 1
        try:
            supabase.table("contracts").update({
                'last_reminder_stage': stage,
                'last_reminder_at': datetime.utcnow().isoformat(),
            }).eq("id", contract.get("id")).execute()
        except Exception:
            errors += 1

    return {"sent": sent, "skipped_already_sent": skipped, "flagged_overdue": flagged_overdue, "errors": errors}

# Run

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))


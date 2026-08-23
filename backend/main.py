import os
import re
import asyncio
from collections import defaultdict, deque
from threading import Lock
from urllib.parse import quote, unquote
import uuid
import base64
import json
import hashlib
import hmac
import html as html_lib
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime, parsedate_to_datetime
from typing import Optional, List, Literal

from fastapi import FastAPI, HTTPException, Request, Depends, Header, BackgroundTasks, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client
import qrcode
from qrcode.image.svg import SvgImage
from io import BytesIO
from PIL import Image
import zipfile
import calendar
import time

# Environment
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')
BASE_URL = os.getenv('BASE_URL', 'https://loyaltree-btw1.onrender.com')
GOOGLE_WALLET_ISSUER_ID = os.getenv('GOOGLE_WALLET_ISSUER_ID', '')
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv('GOOGLE_WALLET_CLASS_SUFFIX', '')
DEFAULT_LOGO_URL = os.getenv('DEFAULT_LOGO_URL', 'https://placehold.co/300x300/0d9488/ffffff.png?text=LoyaltyTree')


# Contactless / NFC loyalty. These switches are intentionally opt-in so the
# existing QR + Wallet passes keep working before Apple/Google approve the
# NFC credentials for this account.
def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')

NFC_TOKEN_SECRET = os.getenv('NFC_TOKEN_SECRET', '')
GOOGLE_SMART_TAP_ENABLED = _env_bool('GOOGLE_SMART_TAP_ENABLED', False)
GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID = os.getenv('GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID', '')
APPLE_NFC_ENABLED = _env_bool('APPLE_NFC_ENABLED', False)
APPLE_NFC_ENCRYPTION_PUBLIC_KEY = os.getenv('APPLE_NFC_ENCRYPTION_PUBLIC_KEY', '')
APPLE_NFC_REQUIRES_AUTHENTICATION = _env_bool('APPLE_NFC_REQUIRES_AUTHENTICATION', False)

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
# announcements_per_month: legacy field name; now used as max concurrently-active announcements
# max_loyalty_cards: how many concurrent loyalty_programs rows a business
#   may run at once (multi-card support itself is not implemented yet -
#   this limit is reserved for that follow-up feature)
# apple_wallet: reserved for when Apple Wallet (PassKit) support is built -
#   not implemented yet, so this flag currently has no effect anywhere
SUBSCRIPTION_PLANS = {
    'starter': {
        'label': 'Starter',
        'price_month': 350,
        'price_tiers': {'1': 350, '2-3': 650, '5': 1300},
        'customer_limit': None,  # unlimited customers
        'google_wallet': True,
        'apple_wallet': True,
        # Maximum concurrently-active customer announcements (not a monthly post quota).
        'announcements_per_month': 2,
        'analytics': True,
        'google_review_prompt': False,
        'birthday_greetings': True,
        'max_loyalty_cards': 1,
        'win_back': False,
        'max_branches': 5,
        'geofence_notifications': False,
    },
    'growth': {
        'label': 'Growth',
        'price_month': 550,
        'price_tiers': {'1': 550, '2-3': 1050, '5': 2100},
        'customer_limit': None,  # unlimited customers
        'google_wallet': True,
        'apple_wallet': True,
        'announcements_per_month': 5,
        'analytics': True,
        'google_review_prompt': True,
        'birthday_greetings': True,
        'max_loyalty_cards': 1,
        'win_back': True,
        'max_branches': 5,
        'geofence_notifications': False,
    },
    'pro': {
        'label': 'Pro',
        'price_month': 750,
        'price_tiers': {'1': 750, '2-3': 1450, '5': 2900},
        'customer_limit': None,  # unlimited customers
        'google_wallet': True,
        'apple_wallet': True,
        'announcements_per_month': 7,
        'analytics': True,
        'google_review_prompt': True,
        'birthday_greetings': True,
        'max_loyalty_cards': 3,
        'win_back': True,
        'max_branches': 5,
        # Reserved until geotag/geofence delivery is implemented and enabled.
        'geofence_notifications': False,
    },
}

def get_plan_features(plan: Optional[str]) -> dict:
    """Feature/limit config for a plan name, falling back to Starter for an
    unrecognized or missing plan so a bad value never silently unlocks
    Pro-only features."""
    return SUBSCRIPTION_PLANS.get(plan or 'starter', SUBSCRIPTION_PLANS['starter'])

def get_effective_announcement_limit(business: dict) -> Optional[int]:
    """The plan's active announcement cap (2/5/7 for Starter/Growth/Pro),
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

def count_active_announcements(business_id: int, exclude_id: Optional[str] = None) -> int:
    """Count announcements that are active *right now*. Expired rows do not
    consume a plan slot, and editing an existing row can exclude itself.
    This matches the public pricing language: Starter 2, Growth 5, Pro 7
    concurrently-active announcements."""
    today = datetime.utcnow().date().isoformat()
    try:
        rows = (
            supabase.table("announcements")
            .select("id,is_active,end_date")
            .eq("business_id", business_id)
            .eq("is_active", True)
            .execute()
            .data or []
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    active = 0
    for row in rows:
        if exclude_id is not None and str(row.get('id')) == str(exclude_id):
            continue
        end_date = row.get('end_date')
        if end_date and str(end_date)[:10] < today:
            continue
        active += 1
    return active

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
OWNER_SESSION_TTL_HOURS = 12  # owner dashboard session; requires re-login after expiry

def create_staff_session_token(
    business_public_id: str,
    staff_id,
    role: str,
    name: str,
    branch_id=None,
) -> str:
    import jwt as pyjwt
    payload = {
        'business_public_id': business_public_id,
        'staff_id': staff_id,  # None when the owner is the one scanning
        'role': role,
        'name': name,
        'branch_id': branch_id,
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


def create_owner_session_token(business: dict) -> str:
    """Signed, expiring owner token. Replaces the old predictable owner-token-<slug>."""
    import jwt as pyjwt
    if not STAFF_SESSION_SECRET:
        raise HTTPException(status_code=503, detail="STAFF_SESSION_SECRET is not configured")
    now = datetime.utcnow()
    payload = {
        'business_public_id': business.get('public_id'),
        'business_id': business.get('id'),
        'role': 'owner',
        'name': business.get('name', ''),
        'iat': now,
        'exp': now + timedelta(hours=OWNER_SESSION_TTL_HOURS),
    }
    return pyjwt.encode(payload, STAFF_SESSION_SECRET, algorithm='HS256')


def require_owner_session(public_id: str, authorization: str):
    """Require a valid signed owner token scoped to the business in the URL."""
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Owner authentication required')
    claims = verify_staff_session_token(authorization.split(' ', 1)[1])
    if not claims:
        raise HTTPException(status_code=401, detail='Owner session expired - please log in again')
    if claims.get('role') != 'owner':
        raise HTTPException(status_code=403, detail='Owner access required')
    if claims.get('business_public_id') != public_id:
        raise HTTPException(status_code=403, detail='Session does not match this business')
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


# LoyaltyTree self-serve business categories. Car Lending and Cockpit stay
# supported by the backend but remain invite-only specialized systems.
BUSINESS_CATEGORY_META = {
    'spa': {'label': 'Spa', 'icon': '🌿', 'color': '#0f766e', 'recommended_cards': ['membership','vip','stamp']},
    'salon': {'label': 'Salon / Barber', 'icon': '✂️', 'color': '#7c3aed', 'recommended_cards': ['vip','stamp','points']},
    'fitness': {'label': 'Gym / Fitness', 'icon': '🏋️', 'color': '#2563eb', 'recommended_cards': ['membership','multipass','vip']},
    'restaurant': {'label': 'Restaurant / Food', 'icon': '🍽️', 'color': '#ea580c', 'recommended_cards': ['stamp','points','vip']},
    'coffee': {'label': 'Coffee Shop / Café', 'icon': '☕', 'color': '#92400e', 'recommended_cards': ['stamp','points','vip']},
    'retail': {'label': 'Retail / Store', 'icon': '🛍️', 'color': '#d97706', 'recommended_cards': ['points','vip','stamp']},
    'clinic': {'label': 'Clinic / Wellness', 'icon': '🩺', 'color': '#0891b2', 'recommended_cards': ['membership','multipass','vip']},
    'laundry': {'label': 'Laundry Shop', 'icon': '🧺', 'color': '#0284c7', 'recommended_cards': ['stamp','points','membership']},
    'gas_station': {'label': 'Gasoline Station', 'icon': '⛽', 'color': '#dc2626', 'recommended_cards': ['points','vip','stamp']},
    'car_wash': {'label': 'Car Wash', 'icon': '🚿', 'color': '#0369a1', 'recommended_cards': ['stamp','multipass','points']},
    'pharmacy': {'label': 'Pharmacy', 'icon': '💊', 'color': '#16a34a', 'recommended_cards': ['points','vip','stamp']},
    'bakery': {'label': 'Bakery', 'icon': '🥐', 'color': '#b45309', 'recommended_cards': ['stamp','points','vip']},
    'hotel': {'label': 'Hotel / Resort', 'icon': '🏨', 'color': '#4338ca', 'recommended_cards': ['vip','membership','points']},
    'other': {'label': 'Other Business', 'icon': '🏪', 'color': '#0d9488', 'recommended_cards': ['stamp','points','vip']},
    'car_lending': {'label': 'Car Lending / Showroom', 'icon': '🚗', 'color': '#0f172a', 'recommended_cards': []},
    'cockpit': {'label': 'Cockpit Arena', 'icon': '🏆', 'color': '#713f12', 'recommended_cards': []},
}

def normalize_business_type(value: Optional[str]) -> str:
    value = (value or 'other').strip().lower()
    return value if value in BUSINESS_CATEGORY_META else 'other'

def business_category_meta(value: Optional[str]) -> dict:
    return BUSINESS_CATEGORY_META.get(normalize_business_type(value), BUSINESS_CATEGORY_META['other'])

# Pydantic Models
class BusinessCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    contact_person: Optional[str] = None
    password: str
    logo_url: Optional[str] = None
    business_type: Optional[str] = 'other'
    address: Optional[str] = None  # business's main address - lets super admin organize businesses by location
    branch_count: int = Field(default=1, ge=1, le=50)
    plan: Optional[str] = None  # explicit plan choice; if omitted, derived from branch_count
    setup_kit_requested: bool = False
    kit_recipient_name: Optional[str] = None
    kit_contact_number: Optional[str] = None
    kit_delivery_address: Optional[str] = None
    kit_delivery_instructions: Optional[str] = None
    partner_code: Optional[str] = Field(default=None, max_length=64)

class BusinessOnboardingUpdate(BaseModel):
    onboarding_step: Optional[int] = Field(default=None, ge=0, le=9)
    onboarding_completed: Optional[bool] = None

class SetupKitOwnerUpdate(BaseModel):
    recipient_name: Optional[str] = None
    contact_number: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_instructions: Optional[str] = None
    logo_url: Optional[str] = None

class SetupKitAdminUpdate(BaseModel):
    fulfillment_status: Optional[Literal['requested','paid','preparing','ready_to_ship','shipped','delivered','cancelled']] = None
    payment_status: Optional[Literal['unpaid','paid','refunded']] = None
    courier: Optional[str] = None
    tracking_number: Optional[str] = None
    admin_notes: Optional[str] = None

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

class PartnerDemoCashierCreate(BaseModel):
    name: str
    email: str
    pin: str

class PartnerDemoCashierUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    pin: Optional[str] = None
    is_active: Optional[bool] = None

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
    engine_number: Optional[str] = None  # internal admin record only; never rendered on the public showroom or agent listing
    chassis_number: Optional[str] = None  # internal admin record only; never rendered on the public showroom or agent listing
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
    financing_bank_name: Optional[str] = None  # optional internal bank/lender name for monthly-amortization units
    image_url: Optional[str] = None  # legacy single-photo field - kept in sync as image_urls[0] for old readers
    image_urls: Optional[List[str]] = None  # up to VEHICLE_MAX_PHOTOS photos, shown as a gallery on the showroom card

class VehicleUpdate(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    plate_number: Optional[str] = None
    plate_end_in: Optional[str] = None
    engine_number: Optional[str] = None
    chassis_number: Optional[str] = None
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
    financing_bank_name: Optional[str] = None
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
CL_APPLICATION_ROLES = ['agent', 'buyer', 'seller', 'reservation']
CL_APPLICATION_STATUSES = ['pending', 'approved', 'rejected']

class CLApplicationCreate(BaseModel):
    role: Literal['agent', 'buyer', 'seller', 'reservation']
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
    role: Literal['agent', 'buyer', 'seller', 'reservation']
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



# --- Car Lending / Showroom: reservation payment submission. Opened from
# the selected vehicle's "Reserve this car" action. The buyer sees the
# owner's current reservation-payment instructions, enters their name, and
# uploads a payment receipt. The submission lands in cl_applications with
# role='reservation' so the owner reviews it under Applications ->
# Reservation Application.
class CLReservationCreate(BaseModel):
    name: str
    contact_number: str
    address: str
    vehicle_public_id: str
    receipt_url: str

class CLReservationSettingsUpdate(BaseModel):
    reservation_amount: Optional[float] = Field(default=None, ge=0)
    payment_note: Optional[str] = Field(default=None, max_length=1000)


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

class StampRewardMilestone(BaseModel):
    id: Optional[str] = None
    stamps: int = Field(ge=1, le=500)
    reward_name: str = Field(min_length=1, max_length=100)

class LoyaltyConfig(BaseModel):
    card_type: Literal['stamp', 'points', 'multipass', 'membership', 'vip'] = 'stamp'  # a business runs ONE active card at a time
    stamp_goal: int = Field(default=8, ge=1, le=500)
    reward_name: str = 'Free Service'
    stamp_rewards: Optional[List[StampRewardMilestone]] = None
    stamp_once_per_day: bool = False
    stamp_reset_after_final: bool = True
    primary_color: str = '#3b82f6'
    reward_expiry_days: int = Field(default=30, ge=1)
    program_logo_url: Optional[str] = None
    hero_image_url: Optional[str] = None
    card_name: Optional[str] = None
    # --- LoyaltyTree Wallet 2.0 ---
    wallet_style: Literal['modern', 'premium', 'minimal', 'dark'] = 'modern'
    wallet_secondary_color: Optional[str] = None
    wallet_show_background: bool = True
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
    membership_services: Optional[List[str]] = None
    membership_duration_days: Optional[int] = Field(default=30, ge=1, le=3650)
    membership_price: Optional[float] = Field(default=0, ge=0)
    membership_terms: Optional[str] = Field(default=None, max_length=2000)
    membership_quick_checkin: Optional[bool] = False
    # --- VIP card only ---
    vip_points_per_amount: Optional[float] = Field(default=10, ge=0)
    vip_amount_pesos: Optional[float] = Field(default=100, ge=1)
    vip_tiers: Optional[List[dict]] = None

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
    privacy_consent: bool = False
    privacy_consent_version: Optional[str] = Field(default=None, max_length=40)

class PlatformAnalyticsEventCreate(BaseModel):
    event_name: str = Field(min_length=1, max_length=80)
    session_id: Optional[str] = Field(default=None, max_length=160)
    visitor_id: Optional[str] = Field(default=None, max_length=160)
    path: Optional[str] = Field(default=None, max_length=500)
    page_name: Optional[str] = Field(default=None, max_length=160)
    referrer: Optional[str] = Field(default=None, max_length=1000)
    source: Optional[str] = Field(default=None, max_length=160)
    medium: Optional[str] = Field(default=None, max_length=160)
    campaign: Optional[str] = Field(default=None, max_length=200)
    business_public_id: Optional[str] = Field(default=None, max_length=160)
    metadata: Optional[dict] = None


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
    membership_status: Optional[Literal['inactive', 'active', 'suspended', 'cancelled', 'lifetime']] = None
    membership_start_date: Optional[str] = None
    membership_expires_at: Optional[str] = None
    vip_points: Optional[int] = Field(default=None, ge=0)
    vip_manual_tier_id: Optional[str] = None

class StampRequest(BaseModel):
    customer_public_id: str
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class StampAdjustRequest(BaseModel):
    customer_public_id: str
    delta: int = Field(ge=-100, le=100)
    reason: Optional[str] = Field(default=None, max_length=200)
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False


class NfcResolveRequest(BaseModel):
    # The opaque-ish, signed LoyaltyTree value delivered by Apple VAS or
    # Google Smart Tap. NFC only identifies a member; all points/stamps/etc.
    # continue to live in the normal LoyaltyTree database.
    token: str = Field(min_length=10, max_length=256)
    source: Optional[Literal['apple_wallet', 'google_wallet', 'android_hce', 'terminal']] = None

class PointsSaleRequest(BaseModel):
    customer_public_id: str
    amount_spent: float = Field(gt=0)  # pesos - converted to points via program.points_per_amount / points_amount_pesos
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class VIPSaleRequest(BaseModel):
    customer_public_id: str
    amount_spent: float = Field(gt=0)
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class VIPAdjustRequest(BaseModel):
    customer_public_id: str
    points_delta: int
    note: Optional[str] = None

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


class MembershipActionRequest(BaseModel):
    customer_public_id: str
    action: Literal['activate', 'renew', 'suspend', 'reactivate', 'cancel', 'lifetime']
    duration_days: Optional[int] = Field(default=None, ge=1, le=3650)
    price_paid: Optional[float] = Field(default=None, ge=0)
    payment_method: Optional[str] = Field(default=None, max_length=80)
    note: Optional[str] = Field(default=None, max_length=500)
    staff_pin: Optional[str] = None
    as_owner: Optional[bool] = False

class MembershipNoteRequest(BaseModel):
    # Membership-card equivalent of a stamp/session: the cashier logs what
    # service the member came in for today, so the owner can later pull up
    # a full activity history per member (think: a dentist's per-patient
    # chart) - see 'leaves' on the member's record.
    customer_public_id: str
    service_name: Optional[str] = Field(default=None, max_length=120)  # optional in quick check-in mode; blank becomes 'Visit'
    note: Optional[str] = Field(default=None, max_length=500)  # optional longer note - observations, follow-up needed, etc.
    service_date: Optional[str] = None  # 'YYYY-MM-DD' - defaults to today if omitted; lets a cashier log a visit entered late
    entry_source: Optional[Literal['qr', 'nfc', 'manual']] = 'manual'
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
    device_id: Optional[str] = None

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


class PartnerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    logo_url: str = Field(min_length=1, max_length=1000)
    sector: Optional[str] = Field(default=None, max_length=120)
    plan_segment: Literal['partners', 'starter', 'growth']
    website_url: Optional[str] = Field(default=None, max_length=1000)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=9999)

class PartnerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    logo_url: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    sector: Optional[str] = Field(default=None, max_length=120)
    plan_segment: Optional[Literal['partners', 'starter', 'growth']] = None
    website_url: Optional[str] = Field(default=None, max_length=1000)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=9999)

class NetworkPartnerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=200)
    partner_type: Literal['region','city'] = 'city'
    region: str = Field(min_length=2, max_length=120)
    city: Optional[str] = Field(default=None, max_length=120)
    partner_code: str = Field(min_length=3, max_length=40)
    commission_type: Literal['percent','fixed'] = 'percent'
    commission_value: float = Field(default=10, ge=0, le=100000)
    is_active: bool = True

class NetworkPartnerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    email: Optional[str] = Field(default=None, min_length=3, max_length=320)
    password: Optional[str] = Field(default=None, min_length=8, max_length=200)
    partner_type: Optional[Literal['region','city']] = None
    region: Optional[str] = Field(default=None, min_length=2, max_length=120)
    city: Optional[str] = Field(default=None, max_length=120)
    partner_code: Optional[str] = Field(default=None, min_length=3, max_length=40)
    commission_type: Optional[Literal['percent','fixed']] = None
    commission_value: Optional[float] = Field(default=None, ge=0, le=100000)
    is_active: Optional[bool] = None

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
    contact_person: Optional[str] = None
    business_type: Optional[str] = None
    logo_url: Optional[str] = None
    announcement_limit_adjustment: Optional[int] = None  # +/- adjustment to the plan's announcements_per_month for this business only

class AdminNfcTrialUpdate(BaseModel):
    # Experimental NFC is deliberately controlled only by the LoyaltyTree
    # platform super admin. Business-owner loyalty config cannot set this.
    enabled: bool

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
    """Return the most recently saved loyalty program.

    Historical duplicate rows can exist in older databases. maybe_single()
    returns no data when that happens, which made the cashier fall back to
    Stamp. Reading the newest row keeps existing customer QR codes valid.
    """
    if not supabase:
        return None
    try:
        res = (
            supabase.table("loyalty_programs")
            .select("*")
            .eq("business_id", business_id)
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .order("id", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as e:
        print(f"LOYALTY PROGRAM lookup error for business {business_id}: {e}")
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

def issue_partner_session(partner: dict) -> str:
    import jwt as pyjwt
    if not STAFF_SESSION_SECRET:
        raise HTTPException(status_code=503, detail="STAFF_SESSION_SECRET is not configured")
    now = datetime.utcnow()
    return pyjwt.encode({
        'role': 'partner', 'partner_id': partner.get('id'),
        'partner_public_id': partner.get('public_id'),
        'partner_type': partner.get('partner_type'), 'name': partner.get('name',''),
        'iat': now, 'exp': now + timedelta(hours=OWNER_SESSION_TTL_HOURS),
    }, STAFF_SESSION_SECRET, algorithm='HS256')

def require_partner(authorization: str = Header(default='')) -> dict:
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Partner authentication required')
    claims = verify_staff_session_token(authorization.split(' ',1)[1])
    if not claims or claims.get('role') != 'partner':
        raise HTTPException(status_code=401, detail='Partner session expired - please log in again')
    return claims

def _network_partner_public(row: dict) -> dict:
    return {k: row.get(k) for k in ('public_id','name','email','partner_type','region','city','partner_code','commission_type','commission_value','is_active','created_at')}

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
        "contact_person": biz.get("contact_person", ""),
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
        "setup_kit_requested": bool(biz.get("setup_kit_requested")),
        "setup_kit_paid": bool(biz.get("setup_kit_paid")),
        "setup_kit_status": biz.get("setup_kit_status"),
        "onboarding_step": int(biz.get("onboarding_step") or 0),
        "onboarding_completed": bool(biz.get("onboarding_completed")),
        "join_url": f"{(FRONTEND_URL or BASE_URL).rstrip('/')}/join/{biz.get('public_id','')}",
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
    vip_points: int = 0,
    vip_tier_name: Optional[str] = None,
    membership_status: Optional[str] = None,
    membership_expires_at: Optional[str] = None,
    secondary_color: Optional[str] = None,
    wallet_style: str = 'modern',
    business_name: Optional[str] = None,
    card_label: Optional[str] = None,
    include_text_overlay: bool = True,
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
    # Wallet 2.0 branded hero. Keep the image static (Google requirement)
    # but make it look like a deliberate digital card instead of a plain gradient.
    img = _render_hero(primary_color).convert('RGBA')
    from PIL import ImageDraw, ImageFont

    if secondary_color:
        overlay = Image.new('RGBA', HERO_SIZE, (*_hex_to_rgb(secondary_color), 0))
        overlay_px = overlay.load()
        for y in range(HERO_SIZE[1]):
            for x in range(HERO_SIZE[0]):
                # Soft accent glow from top-right.
                strength = max(0.0, 1.0 - (((HERO_SIZE[0]-x) + y) / (HERO_SIZE[0] + HERO_SIZE[1])))
                overlay_px[x, y] = (*_hex_to_rgb(secondary_color), int(95 * strength))
        img = Image.alpha_composite(img, overlay)

    # Subtle premium framing + a single soft rectangular accent in the top
    # right corner. Drawn on their own transparent layer and alpha_composite'd
    # in - drawing translucent fills straight onto `img` with ImageDraw looks
    # right in-memory, but this function ends with img.convert('RGB'), which
    # DROPS the alpha channel instead of blending it, so any "translucent"
    # shape drawn directly renders fully opaque instead. (This is also why
    # the old three-circle version showed up as a solid white blob instead of
    # a soft accent - same bug, not just the wrong shape.)
    deco = Image.new('RGBA', HERO_SIZE, (0, 0, 0, 0))
    deco_draw = ImageDraw.Draw(deco)
    if wallet_style in ('premium', 'dark'):
        deco_draw.rounded_rectangle((18,18,HERO_SIZE[0]-18,HERO_SIZE[1]-18), radius=34, outline=(255,255,255,45), width=2)
    deco_draw.rounded_rectangle((HERO_SIZE[0]-300, -60, HERO_SIZE[0]+40, 150), radius=36, fill=(255,255,255,22))
    img = Image.alpha_composite(img, deco)
    draw = ImageDraw.Draw(img)

    if include_text_overlay and business_name:
        font_brand = ImageFont.load_default(size=20)
        draw.text((40, 28), str(business_name)[:38], font=font_brand, fill=(255,255,255,225))
    if include_text_overlay and card_label:
        font_label = ImageFont.load_default(size=16)
        label = str(card_label).upper()
        bbox = draw.textbbox((0,0), label, font=font_label)
        draw.text((HERO_SIZE[0]-40-(bbox[2]-bbox[0]), 30), label, font=font_label, fill=(255,255,255,185))

    if not include_text_overlay:
        # Apple's storeCard already overlays organization name (logoText),
        # MEMBER/status headerFields+primaryFields, and the reward/progress
        # detail on backFields - baking the same text into the strip image
        # AGAIN (as done for Google's hero image below) just produces
        # doubled, overlapping text on top of Apple's own chrome. Return the
        # plain branded gradient background only; let native fields do the
        # talking.
        return _hero_to_png(img.convert('RGB'))

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
    elif card_type == 'vip':
        reward_line = str(vip_tier_name or 'VIP')
        progress_line = f'{vip_points} VIP points'
    elif card_type == 'membership':
        reward_line = f'Membership · {membership_status.upper() if membership_status else "INACTIVE"}'
        progress_line = (
            'Lifetime membership'
            if membership_status == 'lifetime'
            else f'Active until {membership_expires_at}'
            if membership_expires_at
            else 'Not activated'
        )
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
WALLET_CARD_LABELS = {
    'stamp': 'STAMP CARD',
    'points': 'POINTS CARD',
    'membership': 'MEMBERSHIP',
    'multipass': 'MULTIPASS',
    'vip': 'VIP MEMBER',
}

def _normalize_hex_color(value: Optional[str], fallback: str = '#0d9488') -> str:
    value = str(value or '').strip()
    if re.fullmatch(r'#[0-9a-fA-F]{6}', value):
        return value.lower()
    if re.fullmatch(r'[0-9a-fA-F]{6}', value):
        return f'#{value.lower()}'
    return fallback

def _mix_hex(color_a: str, color_b: str, ratio: float) -> str:
    a = _hex_to_rgb(_normalize_hex_color(color_a))
    b = _hex_to_rgb(_normalize_hex_color(color_b))
    ratio = max(0.0, min(1.0, ratio))
    rgb = tuple(round(a[i] * (1-ratio) + b[i] * ratio) for i in range(3))
    return '#%02x%02x%02x' % rgb

def wallet_20_design(business: dict, program: Optional[dict]) -> dict:
    program = program or {}
    category = business_category_meta(business.get('business_type'))
    card_type = program.get('card_type') or 'stamp'
    style = str(program.get('wallet_style') or 'modern').lower()
    if style not in ('modern', 'premium', 'minimal', 'dark'):
        style = 'modern'

    primary = _normalize_hex_color(program.get('primary_color'), category.get('color') or '#0d9488')
    secondary = _normalize_hex_color(
        program.get('wallet_secondary_color'),
        _mix_hex(primary, '#14b8a6', .42)
    )

    if style == 'dark':
        background = '#111827'
        secondary = _mix_hex(primary, '#111827', .30)
    elif style == 'premium':
        background = _mix_hex(primary, '#050505', .58)
        secondary = _mix_hex(primary, '#d4af37', .28)
    elif style == 'minimal':
        background = _mix_hex(primary, '#ffffff', .12)
        secondary = _mix_hex(primary, '#ffffff', .35)
    else:
        background = primary

    return {
        'version': '2.0',
        'style': style,
        'primary': primary,
        'secondary': secondary,
        'background': background,
        'show_background': program.get('wallet_show_background') is not False,
        'card_type': card_type,
        'card_label': WALLET_CARD_LABELS.get(card_type, 'LOYALTY CARD'),
        'category': category,
    }

def wallet_20_program_name(business: dict, program: Optional[dict]) -> str:
    # issuerName (small, top) already shows the business name - programName
    # (big title) should be the card's own name so the two rows say
    # different things instead of repeating the business name twice. Falls
    # back to "<Business> Rewards" (matches the card-name default used
    # elsewhere, e.g. get_wallet_pass) when the business hasn't set one.
    biz_name = str(business.get('name') or 'LoyaltyTree')
    card_name = str((program or {}).get('card_name') or '').strip()
    return card_name or f'{biz_name} Rewards'

def wallet_20_short_status(customer: dict, business: dict, program: dict) -> tuple:
    card_type = (program or {}).get('card_type', 'stamp')
    if card_type == 'points':
        return 'POINTS', f"{int(customer.get('points_balance') or 0):,}"
    if card_type == 'multipass':
        remaining = int(customer.get('multipass_sessions_remaining') or 0)
        total = int(customer.get('multipass_total_sessions') or (program or {}).get('multipass_session_count') or 0)
        return 'SESSIONS LEFT', f'{remaining} / {total}'
    if card_type == 'membership':
        return 'STATUS', membership_effective_status(customer).upper()
    if card_type == 'vip':
        tier = get_vip_tier(customer, program or {})
        return 'VIP TIER', str(tier.get('name') or 'VIP').upper()
    goal = int((program or {}).get('stamp_goal') or 8)
    stamps = int(customer.get('stamp_count') or 0)
    return 'STAMPS', f'{stamps} / {goal}'

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


def _google_wallet_base_class_id(business: dict, program: dict) -> str:
    """Stable root Google Wallet class ID for this business."""
    if program and program.get('google_wallet_class_id'):
        return str(program.get('google_wallet_class_id'))
    return f'{GOOGLE_WALLET_ISSUER_ID}.{business.get("public_id", "")}'


def _google_wallet_safe_fragment(value: str, fallback: str = "tier") -> str:
    """Google class identifiers allow only alphanumerics, dots, underscores and hyphens."""
    value = re.sub(r'[^A-Za-z0-9._-]+', '-', str(value or '').strip()).strip('._-')
    return (value or fallback)[:60]


def google_wallet_vip_class_id(business: dict, program: dict, tier: dict) -> str:
    """One shared Google LoyaltyClass per VIP tier so its background can match the tier."""
    base = _google_wallet_base_class_id(business, program)
    tier_key = _google_wallet_safe_fragment((tier or {}).get('id') or (tier or {}).get('name') or 'vip')
    return f'{base}-vip-{tier_key}'


def google_wallet_class_id_for_customer(customer: dict, business: dict, program: dict) -> str:
    """Return the normal class, or the customer's current tier class for VIP."""
    if (program or {}).get('card_type') == 'vip':
        return google_wallet_vip_class_id(business, program, get_vip_tier(customer, program or {}))
    return _google_wallet_base_class_id(business, program)


def ensure_google_wallet_vip_class(customer: dict, business: dict, program: dict) -> bool:
    """Ensure the current member's tier LoyaltyClass exists before issuing a Save URL.

    A newly-created VIP member can open their wallet immediately, even if the
    owner has not manually pressed Publish Card since tier-class support was
    deployed. This avoids generating a LoyaltyObject that references a class
    Google does not know about yet.
    """
    if (program or {}).get('card_type') != 'vip':
        return True

    access_token = get_google_access_token()
    if not access_token:
        print("GOOGLE VIP CLASS: no Google access token")
        return False

    tier = get_vip_tier(customer, program or {})
    class_id = google_wallet_vip_class_id(business, program or {}, tier)
    loyalty_class = build_loyalty_class(
        business,
        program or {},
        review_status='UNDER_REVIEW',
        class_id_override=class_id,
        background_color_override=tier.get('color') or '#111827',
        vip_tier_name=tier.get('name') or 'VIP',
    )

    try:
        import httpx
        with httpx.Client(timeout=20) as client:
            # Fast path: class already exists.
            check = client.get(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}',
                headers={"Authorization": f"Bearer {access_token}"}
            )
            if check.status_code == 200:
                return True

            if check.status_code != 404:
                print(f"GOOGLE VIP CLASS: GET {class_id} failed {check.status_code} - {check.text[:1000]}")
                return False

            # Missing class: create it now.
            created = client.post(
                'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass',
                headers={"Authorization": f"Bearer {access_token}"},
                json=loyalty_class
            )

            if created.status_code in (200, 201):
                print(f"GOOGLE VIP CLASS: created {class_id}")
                return True

            # Concurrent request may have created it between GET and POST.
            if created.status_code == 409:
                verify = client.get(
                    f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{class_id}',
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if verify.status_code == 200:
                    return True

            print(f"GOOGLE VIP CLASS: create {class_id} failed {created.status_code} - {created.text[:1500]}")
            return False
    except Exception as e:
        print(f"GOOGLE VIP CLASS error: {e}")
        return False


def build_loyalty_class(
    business: dict,
    program: dict,
    review_status: str = 'UNDER_REVIEW',
    class_id_override: Optional[str] = None,
    background_color_override: Optional[str] = None,
    vip_tier_name: Optional[str] = None,
) -> dict:
    biz_public_id = business.get('public_id', '')
    class_id = class_id_override or _google_wallet_base_class_id(business, program)

    design = wallet_20_design(business, program)
    category = design['category']
    primary_color = background_color_override or design['background']
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    card_name = program.get('card_name') if program else None
    description = program.get('description') if program else None
    biz_name = business.get('name', 'Loyalty')
    program_name = wallet_20_program_name(business, program)

    if card_type == 'multipass':
        session_count = program.get('multipass_session_count', 12) if program else 12
        reward_module_body = f'{session_count}-session pass'
    elif card_type == 'membership':
        services = (program.get('membership_services') if program else None) or []
        reward_module_body = ', '.join(services) if services else 'Membership'
    elif card_type == 'vip':
        reward_module_body = f'{vip_tier_name or "VIP"} tier'
        if vip_tier_name:
            program_name = f'{program_name} · {vip_tier_name}'
    else:
        reward_module_body = reward_name

    loyalty_class = {
        'id': class_id,
        'issuerName': biz_name,
        'programName': program_name,
        'reviewStatus': review_status,
        'hexBackgroundColor': primary_color if primary_color.startswith('#') else f'#{primary_color}',
        'textModulesData': [
            {'header': 'CARD', 'body': design['card_label']},
            {'header': 'BUSINESS TYPE', 'body': f"{category['icon']} {category['label']}"},
            {'header': 'BENEFIT / REWARD', 'body': reward_module_body},
            {'header': 'ABOUT', 'body': description if description else f"{biz_name} digital loyalty card powered by LoyaltyTree"}
        ],
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

    hero_url = (program.get('hero_image_url') if program else None) if design['show_background'] else None
    if not hero_url and design['show_background']:
        # No custom hero photo uploaded - generate the same diagonal gradient
        # used on the web/join page so the Wallet pass matches it, instead of
        # showing no banner at all. The color is baked into the URL itself:
        # same primary_color -> same URL -> Google can keep using its cached
        # copy; a color change produces a new URL, forcing Google to refetch.
        color_key = primary_color.lstrip('#')
        hero_url = f'{BASE_URL}/api/v1/business/{biz_public_id}/hero-image.png?c={color_key}'
    if hero_url:
        loyalty_class['heroImage'] = {'sourceUri': {'uri': hero_url}}

    # NFC trial safety gate: Smart Tap is exposed only on MEMBERSHIP cards
    # explicitly enabled by the LoyaltyTree super admin. A business owner cannot
    # turn this on through normal loyalty-config updates.
    nfc_trial_active = bool(card_type == 'membership' and program and program.get('nfc_trial_enabled'))
    if nfc_trial_active and GOOGLE_SMART_TAP_ENABLED and GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID:
        loyalty_class['enableSmartTap'] = True
        loyalty_class['redemptionIssuers'] = [str(GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID)]

    return loyalty_class

def build_loyalty_object(customer: dict, business: dict, program: dict) -> dict:
    cust_public_id = customer.get('public_id', '')
    class_id = google_wallet_class_id_for_customer(customer, business, program or {})
    object_id = f'{GOOGLE_WALLET_ISSUER_ID}.{cust_public_id}'
    card_type = program.get('card_type', 'stamp') if program else 'stamp'
    stamp_goal = program.get('stamp_goal', 8) if program else 8
    reward_name = program.get('reward_name', 'Free Reward') if program else 'Free Reward'
    stamps = customer.get('stamp_count', 0)
    points_balance = customer.get('points_balance', 0)

    # Points-card front layout: identify the nearest configured prize at or
    # above the member's current balance so Apple Wallet can show a clean
    # "NEXT REWARD" summary above the full-width banner.
    points_prizes = []
    if card_type == 'points':
        for prize in ((program or {}).get('points_prizes') or []):
            if not isinstance(prize, dict):
                continue
            try:
                cost = int(float(prize.get('points_cost') or 0))
            except (TypeError, ValueError):
                cost = 0
            name = str(prize.get('name') or '').strip()
            if cost > 0 and name:
                points_prizes.append({**prize, 'points_cost': cost, 'name': name})
        points_prizes.sort(key=lambda p: p['points_cost'])

    next_points_prize = None
    if points_prizes:
        current_points = int(points_balance or 0)
        next_points_prize = next(
            (p for p in points_prizes if p['points_cost'] >= current_points),
            points_prizes[-1],
        )

    # Shared "reference-style" Apple Wallet front layout for every LoyaltyTree
    # card type: main status/reward above the full-width banner, then two
    # important customer fields below it, with the barcode at the bottom.
    stamp_rewards = []
    if card_type == 'stamp':
        for reward in ((program or {}).get('stamp_rewards') or []):
            if not isinstance(reward, dict):
                continue
            try:
                required_stamps = int(reward.get('stamps') or 0)
            except (TypeError, ValueError):
                required_stamps = 0
            reward_label = str(reward.get('reward_name') or '').strip()
            if required_stamps > 0 and reward_label:
                stamp_rewards.append({
                    **reward,
                    'stamps': required_stamps,
                    'reward_name': reward_label,
                })
        stamp_rewards.sort(key=lambda r: r['stamps'])

    next_stamp_reward = None
    if stamp_rewards:
        current_stamps = int(stamps or 0)
        next_stamp_reward = next(
            (r for r in stamp_rewards if r['stamps'] >= current_stamps),
            stamp_rewards[-1],
        )

    # The visible stamp progress always uses the FULL/final goal.
    # Example: milestones at 4 / 8 / 10 show 0/10, while NEXT REWARD can
    # still point to the 4-stamp milestone.
    configured_stamp_goals = [int(stamp_goal or 0)]
    configured_stamp_goals += [int(r.get('stamps') or 0) for r in stamp_rewards]
    full_stamp_goal = max([g for g in configured_stamp_goals if g > 0] or [8])

    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    sessions_total = customer.get('multipass_total_sessions', 0) or (program.get('multipass_session_count', 12) if program else 12)
    cust_name = customer.get('name', 'Member')
    biz_name = business.get('name', '')
    design = wallet_20_design(business, program)
    category = design['category']
    membership_summary = (
        get_membership_summary(business.get('id'), customer.get('id'))
        if card_type == 'membership' else None
    )

    details = []  # [(header, body), ...] - mirrors WalletPass.jsx's `view.details`
    if card_type == 'points':
        loyalty_points_label = 'Points'
        loyalty_points_balance = str(points_balance)
        details.append(('REWARD', reward_name))
    elif card_type == 'multipass':
        loyalty_points_label = 'Sessions'
        loyalty_points_balance = f'{sessions_remaining}/{sessions_total}'
        multipass_expires_at = customer.get('multipass_expires_at')
        details.append(('VALID UNTIL', multipass_expires_at or 'No expiry set'))
    elif card_type == 'vip':
        tier = get_vip_tier(customer, program or {})
        next_tier = get_next_vip_tier(customer, program or {})
        loyalty_points_label = 'VIP Points'
        loyalty_points_balance = str(int(customer.get('vip_points') or 0))
        details.append(('NEXT TIER', next_tier.get('name') if next_tier else 'Top tier'))
    elif card_type == 'membership':
        status = membership_effective_status(customer)
        expiry = customer.get('membership_expires_at')
        loyalty_points_label = 'Status'
        loyalty_points_balance = status.upper()
        services = (program.get('membership_services') if program else None) or []
        details.append(('ACTIVE UNTIL', 'Lifetime' if status == 'lifetime' else (expiry or 'Not activated')))
        details.append(('MEMBER SINCE', customer.get('membership_started_at') or '—'))
        details.append(('MEMBERSHIP TYPE', (program.get('card_name') if program else None) or design['card_label']))
        details.append(('NEXT BENEFIT', services[0] if services else 'Rewards'))
    else:
        loyalty_points_label = 'Stamps'
        loyalty_points_balance = f'{stamps}/{stamp_goal}'
        left = max(full_stamp_goal - stamps, 0)
        details.append(('REWARD', reward_name if left == 0 else f'{left} more to {reward_name}'))
    description = program.get('description') if program else None
    if len(details) < 4 and description:
        details.append(('ABOUT', description))
    if len(details) < 4:
        details.append(('BUSINESS', f"{category['icon']} {biz_name} · {category['label']}"))
    details = details[:4]

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
            'balance': (
                {'int': int(customer.get('vip_points') or 0)}
                if card_type == 'vip'
                else {'string': loyalty_points_balance}
            )
        },
        'textModulesData': [
            {'header': design['card_label'], 'body': cust_name},
            *[{'header': header, 'body': str(body)} for header, body in details],
        ],
        'linksModuleData': {
            'uris': [
                {'uri': f'{BASE_URL}/feedback/{cust_public_id}', 'description': '⭐ Rate Your Experience'},
                {'uri': f'{BASE_URL}/wallet/{cust_public_id}', 'description': 'Open full LoyaltyTree card'}
            ]
        }
    }

    # Object-level heroImage overrides the class-level one for just this
    # customer - used to burn their live reward/progress/description onto
    # the gradient banner. Skipped when the business uploaded their own
    # hero photo, since baking text onto someone else's image would look
    # wrong; that photo is left to show as-is (inherited from the class).
    if design['show_background'] and not (program and program.get('hero_image_url')):
        primary_color = (
            get_vip_tier(customer, program or {}).get('color') or '#111827'
            if card_type == 'vip'
            else design['background']
        )
        description = program.get('description') if program else None
        color_key = primary_color.lstrip('#')
        if card_type == 'points':
            progress_key = points_balance
        elif card_type == 'multipass':
            progress_key = sessions_remaining
        elif card_type == 'membership':
            progress_key = membership_summary['total_visits']
        elif card_type == 'vip':
            progress_key = int(customer.get('vip_points') or 0)
        else:
            progress_key = stamps
        hero_url = (
            f'{BASE_URL}/api/v1/customer/{cust_public_id}/hero-image.png'
            f'?s={progress_key}&g={stamp_goal}&c={color_key}'
        )
        loyalty_object['heroImage'] = {'sourceUri': {'uri': hero_url}}


    contactless_token = contactless_member_token(cust_public_id)
    nfc_trial_active = bool(card_type == 'membership' and program and program.get('nfc_trial_enabled'))
    if nfc_trial_active and GOOGLE_SMART_TAP_ENABLED and GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID and contactless_token:
        loyalty_object['smartTapRedemptionValue'] = contactless_token

    return loyalty_object


async def refresh_existing_member_wallets(business: dict, program: dict):
    """Refresh already-issued Wallet cards after an explicit publish.

    Google still requires an object-level check/patch per member, but Apple
    registrations are fetched in bulk first.  The old implementation queried
    Supabase once per member for Apple registrations while also doing Google
    API work at concurrency 8; on larger refreshes that produced unnecessary
    PostgREST/Cloudflare pressure and duplicate Wallet traffic.
    """
    try:
        members = (
            supabase.table('customers')
            .select('*')
            .eq('business_id', business.get('id'))
            .execute()
            .data or []
        )
        members = [m for m in members if m.get('public_id')]
        if not members:
            print(f"WALLET SYNC: no members to refresh for {business.get('name')}")
            return

        current_program = safe_get_loyalty_program(business.get('id')) or program or {}
        serials = [m.get('public_id') for m in members]

        # Apple: find every saved registration in a few bounded queries instead
        # of one registration lookup per member.  One APNs wake-up per device is
        # enough; Wallet then asks our list-updated endpoint which serial(s)
        # changed for that device.
        apple_rows = []
        if supabase and APPLE_PASS_TYPE_IDENTIFIER:
            chunk_size = 100
            for i in range(0, len(serials), chunk_size):
                chunk = serials[i:i + chunk_size]
                try:
                    rows = (
                        supabase.table('apple_wallet_registrations')
                        .select('serial_number,push_token')
                        .in_('serial_number', chunk)
                        .eq('pass_type_identifier', APPLE_PASS_TYPE_IDENTIFIER)
                        .execute()
                    ).data or []
                    apple_rows.extend(rows)
                except Exception as apple_lookup_error:
                    print(f"APPLE WALLET bulk registration lookup error: {apple_lookup_error}")

        # Google: keep concurrency deliberately modest.  This is publish-time
        # work, not a latency-critical checkout transaction, so stability wins
        # over firing many simultaneous external requests.
        semaphore = asyncio.Semaphore(4)

        async def refresh_google(member):
            async with semaphore:
                try:
                    return await asyncio.to_thread(
                        sync_wallet_object, member, business, current_program
                    )
                except Exception as exc:
                    print(f"WALLET SYNC Google member error {member.get('public_id')}: {exc}")
                    return {"status": "error", "detail": str(exc)}

        google_results = await asyncio.gather(*(refresh_google(member) for member in members))

        # Mark only serials that actually have an Apple registration as dirty,
        # then de-duplicate push tokens so a device with multiple passes is not
        # woken repeatedly for the same publish.
        registered_serials = list({
            row.get('serial_number') for row in apple_rows if row.get('serial_number')
        })
        if registered_serials:
            _mark_apple_pass_dirty(registered_serials)

        apple_tokens = list(dict.fromkeys(
            row.get('push_token') for row in apple_rows if row.get('push_token')
        ))
        apple_sent = 0
        if apple_tokens:
            apple_sent = await asyncio.to_thread(_send_apple_wallet_pushes, apple_tokens)

        google_updated = sum(
            1 for result in google_results
            if isinstance(result, dict) and result.get('status') == 'updated'
        )
        google_not_saved = sum(
            1 for result in google_results
            if isinstance(result, dict) and result.get('status') == 'not_saved'
        )
        print(
            f"WALLET SYNC: publish refresh complete for {business.get('name')} "
            f"members={len(members)} google_updated={google_updated} "
            f"google_not_saved={google_not_saved} "
            f"apple_registered={len(registered_serials)} apple_devices_woken={apple_sent}"
        )
    except Exception as refresh_error:
        print(f"WALLET SYNC bulk refresh error: {refresh_error}")

async def republish_wallet_class_and_refresh(business: dict, program: dict):
    """Republish the normal class, or every VIP tier class, then refresh objects."""
    class_id = (program or {}).get('google_wallet_class_id')
    if class_id and GOOGLE_WALLET_ISSUER_ID:
        try:
            access_token = get_google_access_token()
            if access_token:
                import httpx
                class_specs = [(class_id, None, None)]
                if (program or {}).get('card_type') == 'vip':
                    class_specs = [
                        (
                            google_wallet_vip_class_id(business, program, tier),
                            tier.get('color') or '#111827',
                            tier.get('name') or 'VIP',
                        )
                        for tier in normalize_vip_tiers(program or {})
                    ] or [(google_wallet_vip_class_id(business, program, get_vip_tier({}, program or {})), '#111827', 'VIP')]

                with httpx.Client() as client:
                    for target_id, target_color, tier_name in class_specs:
                        loyalty_class = build_loyalty_class(
                            business,
                            program,
                            review_status='UNDER_REVIEW',
                            class_id_override=target_id,
                            background_color_override=target_color,
                            vip_tier_name=tier_name,
                        )
                        resp = client.put(
                            f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{target_id}',
                            headers={"Authorization": f"Bearer {access_token}"},
                            json=loyalty_class
                        )
                        print(f"WALLET SYNC: class PUT {target_id} -> {resp.status_code}")
        except Exception as e:
            print(f"WALLET SYNC: class PUT error: {e}")
    await refresh_existing_member_wallets(business, program)

def sync_wallet_object(customer: dict, business: dict, program: dict,
                        notify_header: str = None, notify_body: str = None,
                        notify_message_id: str = None):
    """Push the latest member state to an already-saved Google Wallet pass.

    Returns a small diagnostic dict. Existing callers do not need to use it,
    but transaction endpoints can surface it so a database success is not
    mistaken for a Wallet success.
    """
    access_token = get_google_access_token()
    if not access_token:
        print("WALLET SYNC: skipped - Google access token unavailable")
        return {"status": "not_configured", "detail": "Google Wallet access token unavailable"}

    try:
        import httpx

        if (program or {}).get('card_type') == 'vip':
            ensure_google_wallet_vip_class(customer, business, program or {})

        desired = build_loyalty_object(customer, business, program)
        object_id = desired['id']
        desired_class_id = desired.get('classId')
        headers = {"Authorization": f"Bearer {access_token}"}

        with httpx.Client(timeout=20) as client:
            current_resp = client.get(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}',
                headers=headers
            )

            if current_resp.status_code == 404:
                detail = "Customer has not added this pass to Google Wallet yet"
                print(f"WALLET SYNC: {object_id} not found - {detail}")
                return {"status": "not_saved", "http_status": 404, "detail": detail}
            if current_resp.status_code != 200:
                detail = current_resp.text[:1200]
                print(f"WALLET SYNC: GET failed {current_resp.status_code} - {detail}")
                return {"status": "error", "stage": "get", "http_status": current_resp.status_code, "detail": detail}

            current = current_resp.json()
            current_class_id = current.get('classId')

            member_patch = {
                'loyaltyPoints': desired.get('loyaltyPoints'),
                'accountId': desired.get('accountId'),
                'accountName': desired.get('accountName'),
                'barcode': desired.get('barcode'),
                'textModulesData': desired.get('textModulesData'),
                'linksModuleData': desired.get('linksModuleData'),
                'state': desired.get('state', 'active'),
                'notifyPreference': 'NOTIFY_ON_UPDATE',
            }
            # Keep object-level hero artwork in sync with the desired object.
            # Important: Google Wallet PATCH leaves omitted fields unchanged.
            # When a business uploads a custom hero image, build_loyalty_object()
            # intentionally omits object.heroImage so the object inherits the
            # class-level custom banner. Older objects may still have a generated
            # per-customer heroImage, though, and that stale object image overrides
            # the new class banner until we explicitly delete it with null.
            if desired.get('heroImage'):
                member_patch['heroImage'] = desired.get('heroImage')
            elif current.get('heroImage'):
                member_patch['heroImage'] = None

            if current_class_id == desired_class_id:
                resp = client.patch(
                    f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}',
                    headers=headers,
                    json=member_patch
                )
                if resp.status_code in (200, 201):
                    print(
                        f"WALLET SYNC: updated {object_id} "
                        f"stamps={customer.get('stamp_count')} "
                        f"points={customer.get('points_balance')}"
                    )
                    message_sent = None
                    if notify_header and notify_message_id:
                        message_sent = send_wallet_object_message(
                            object_id, notify_header, notify_body or '', notify_message_id
                        )
                    return {
                        "status": "updated",
                        "http_status": resp.status_code,
                        "object_id": object_id,
                        "notification_sent": message_sent,
                    }

                detail = resp.text[:1500]
                print(f"WALLET SYNC: member PATCH failed {resp.status_code} - {detail}")
                return {"status": "error", "stage": "patch", "http_status": resp.status_code, "detail": detail}

            resp = client.put(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}',
                headers=headers,
                json=desired
            )
            if resp.status_code in (200, 201):
                print(
                    f"WALLET SYNC: moved {object_id} from {current_class_id} "
                    f"to {desired_class_id}; points={customer.get('vip_points')}"
                )
                message_sent = None
                if notify_header and notify_message_id:
                    message_sent = send_wallet_object_message(
                        object_id, notify_header, notify_body or '', notify_message_id
                    )
                return {
                    "status": "updated",
                    "http_status": resp.status_code,
                    "object_id": object_id,
                    "notification_sent": message_sent,
                }

            print(
                f"WALLET SYNC: tier-class move failed {resp.status_code} - "
                f"{resp.text[:1200]}; patching member balance on existing class instead"
            )
            fallback = client.patch(
                f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/{object_id}',
                headers=headers,
                json=member_patch
            )
            if fallback.status_code in (200, 201):
                print(f"WALLET SYNC: fallback member update succeeded for {object_id}")
                message_sent = None
                if notify_header and notify_message_id:
                    message_sent = send_wallet_object_message(
                        object_id, notify_header, notify_body or '', notify_message_id
                    )
                return {
                    "status": "updated",
                    "stage": "fallback_patch",
                    "http_status": fallback.status_code,
                    "object_id": object_id,
                    "notification_sent": message_sent,
                }

            detail = fallback.text[:1500]
            print(f"WALLET SYNC: fallback PATCH failed {fallback.status_code} - {detail}")
            return {"status": "error", "stage": "fallback_patch", "http_status": fallback.status_code, "detail": detail}

    except Exception as e:
        print(f"WALLET SYNC error: {e}")
        return {"status": "error", "stage": "exception", "detail": str(e)}


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

# A push tells Wallet to ask which pass changed.  Some pass-visible changes
# (for example membership-event edits) do not necessarily touch the customer's
# updated_at column, so source timestamps alone can make the subsequent
# passesUpdatedSince request incorrectly return 204 ("spurious push").
# Keep a small, short-lived in-process dirty marker as a delivery hint.  The
# real pass data remains in Supabase; this is not durable state and is pruned.
_APPLE_PASS_DIRTY_AT = {}
_APPLE_PASS_DIRTY_TTL_SECONDS = 6 * 60 * 60

def _mark_apple_pass_dirty(serial_numbers):
    now = datetime.utcnow()
    if isinstance(serial_numbers, str):
        serial_numbers = [serial_numbers]
    for serial in serial_numbers or []:
        if serial:
            _APPLE_PASS_DIRTY_AT[str(serial)] = now

    # Opportunistic pruning keeps this bounded on a long-running process.
    cutoff = now - timedelta(seconds=_APPLE_PASS_DIRTY_TTL_SECONDS)
    stale = [key for key, value in _APPLE_PASS_DIRTY_AT.items() if value < cutoff]
    for key in stale:
        _APPLE_PASS_DIRTY_AT.pop(key, None)

def _apple_pass_dirty_at(serial_number: str):
    value = _APPLE_PASS_DIRTY_AT.get(str(serial_number or ''))
    if not value:
        return None
    if (datetime.utcnow() - value).total_seconds() > _APPLE_PASS_DIRTY_TTL_SECONDS:
        _APPLE_PASS_DIRTY_AT.pop(str(serial_number or ''), None)
        return None
    return value

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


# Keep the NFC message below Apple's 64-byte pass NFC message limit. A
# customer's public_id is already random; the HMAC prevents somebody from
# inventing another customer's value. Format is LT1:<32-char-id>:<16-hex-mac>
def contactless_member_token(customer_public_id: str) -> Optional[str]:
    if not NFC_TOKEN_SECRET or not customer_public_id:
        return None
    public_id = str(customer_public_id).strip()
    mac = hmac.new(NFC_TOKEN_SECRET.encode(), public_id.encode(), hashlib.sha256).hexdigest()[:16]
    token = f'LT1:{public_id}:{mac}'
    return token if len(token.encode('utf-8')) <= 64 else None


def verify_contactless_member_token(token: str) -> Optional[str]:
    if not NFC_TOKEN_SECRET or not token:
        return None
    try:
        prefix, public_id, supplied_mac = token.strip().split(':', 2)
    except ValueError:
        return None
    if prefix != 'LT1' or not public_id or len(supplied_mac) != 16:
        return None
    expected = hmac.new(NFC_TOKEN_SECRET.encode(), public_id.encode(), hashlib.sha256).hexdigest()[:16]
    if not hmac.compare_digest(supplied_mac, expected):
        return None
    return public_id

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

# Apple Wallet image cache.  Business branding changes rarely, while Wallet can
# request the same pass several times during add/registration/update.  Keeping
# fetched bytes in-process removes repeated network waits from the hot path.
_APPLE_IMAGE_CACHE = {}
_APPLE_IMAGE_CACHE_TTL_SECONDS = 900

def _fetch_image_bytes(url: Optional[str], timeout: float = 1.5) -> Optional[bytes]:
    """Fast best-effort download for Apple Wallet artwork.

    A slow or broken image URL must never make the Add to Apple Wallet sheet
    wait several seconds.  Successful and failed fetches are cached briefly;
    on failure the pass immediately falls back to generated artwork.
    """
    if not url:
        return None
    now = time.monotonic()
    cached = _APPLE_IMAGE_CACHE.get(url)
    if cached and now - cached[0] < _APPLE_IMAGE_CACHE_TTL_SECONDS:
        return cached[1]
    try:
        import httpx
        limits = httpx.Limits(max_keepalive_connections=5, max_connections=10)
        timeout_cfg = httpx.Timeout(timeout, connect=min(timeout, 1.0))
        with httpx.Client(timeout=timeout_cfg, follow_redirects=True, limits=limits) as client:
            resp = client.get(url)
            content = resp.content if resp.status_code == 200 and resp.content else None
            _APPLE_IMAGE_CACHE[url] = (now, content)
            return content
    except Exception as e:
        print(f"IMAGE FETCH fast-fallback ({url}): {e}")
        _APPLE_IMAGE_CACHE[url] = (now, None)
        return None

def apple_icon_from_logo_bytes(logo_bytes: bytes, size: int) -> Optional[bytes]:
    """Center-crops the business's real logo to a square and composites it
    onto white (Apple's icon slot has no reliable transparency handling
    across devices) - used instead of generate_apple_icon_bytes's
    initial-letter placeholder whenever a real logo is available."""
    try:
        img = Image.open(BytesIO(logo_bytes)).convert('RGBA')
        w, h = img.size
        side = min(w, h)
        left, top = (w - side) // 2, (h - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)
        bg = Image.new('RGB', (size, size), (255, 255, 255))
        bg.paste(img, (0, 0), img)
        return _hero_to_png(bg)
    except Exception as e:
        print(f"APPLE ICON from logo error: {e}")
        return None

def apple_logo_from_image_bytes(logo_bytes: bytes, width: int, height: int) -> Optional[bytes]:
    """Fits the business's real logo (preserving aspect ratio, transparent
    padding) into the pass-header logo slot - used instead of
    generate_apple_logo_bytes's generated wordmark whenever a real logo is
    available."""
    try:
        img = Image.open(BytesIO(logo_bytes)).convert('RGBA')
        img.thumbnail((width, height), Image.LANCZOS)
        canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        # PassKit positions the logo slot itself, so we cannot remove Apple's
        # native outer margin. What we *can* remove is our own transparent
        # left padding. Anchor the uploaded logo at x=0 instead of centering
        # it inside the 160x50 / @2x / @3x logo canvas. This makes the visible
        # artwork sit as close to Apple's top-left edge as PassKit permits.
        canvas.paste(img, (0, (height - img.height) // 2), img)
        return _hero_to_png(canvas)
    except Exception as e:
        print(f"APPLE LOGO from image error: {e}")
        return None

def apple_strip_from_image_bytes(image_bytes: bytes, width: int, height: int) -> Optional[bytes]:
    """Center-crops/resizes the business's real hero photo to the strip
    banner's aspect ratio - used instead of generate_apple_strip_bytes's
    procedurally-drawn gradient whenever the business has uploaded one."""
    try:
        img = Image.open(BytesIO(image_bytes)).convert('RGB')
        src_ratio, dst_ratio = img.width / img.height, width / height
        if src_ratio > dst_ratio:
            new_w = int(img.height * dst_ratio)
            left = (img.width - new_w) // 2
            img = img.crop((left, 0, left + new_w, img.height))
        else:
            new_h = int(img.width / dst_ratio)
            top = (img.height - new_h) // 2
            img = img.crop((0, top, img.width, top + new_h))
        img = img.resize((width, height), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()
    except Exception as e:
        print(f"APPLE STRIP from image error: {e}")
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
    # Left-anchor the generated fallback too, matching uploaded logos and
    # avoiding extra transparent padding before Apple's own native margin.
    draw.text((max(0, -bbox[0]), (height - th) / 2 - bbox[1]), text, font=font, fill=(255, 255, 255, 255))
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

    # Apple Wallet front-card reward targets. Keep these local to this
    # builder: the similarly named values in build_loyalty_object() belong
    # to the Google Wallet builder and are not visible in this function.
    points_prizes = []
    if card_type == 'points':
        for prize in ((program or {}).get('points_prizes') or []):
            if not isinstance(prize, dict):
                continue
            try:
                cost = int(float(prize.get('points_cost') or 0))
            except (TypeError, ValueError):
                cost = 0
            name = str(prize.get('name') or '').strip()
            if cost > 0 and name:
                points_prizes.append({**prize, 'points_cost': cost, 'name': name})
        points_prizes.sort(key=lambda p: p['points_cost'])

    next_points_prize = None
    if points_prizes:
        current_points = int(points_balance or 0)
        next_points_prize = next(
            (p for p in points_prizes if p['points_cost'] >= current_points),
            points_prizes[-1],
        )

    stamp_rewards = []
    if card_type == 'stamp':
        for reward in ((program or {}).get('stamp_rewards') or []):
            if not isinstance(reward, dict):
                continue
            try:
                required_stamps = int(reward.get('stamps') or 0)
            except (TypeError, ValueError):
                required_stamps = 0
            reward_label = str(reward.get('reward_name') or '').strip()
            if required_stamps > 0 and reward_label:
                stamp_rewards.append({
                    **reward,
                    'stamps': required_stamps,
                    'reward_name': reward_label,
                })
        stamp_rewards.sort(key=lambda r: r['stamps'])

    next_stamp_reward = None
    if stamp_rewards:
        current_stamps = int(stamps or 0)
        next_stamp_reward = next(
            (r for r in stamp_rewards if r['stamps'] >= current_stamps),
            stamp_rewards[-1],
        )

    sessions_remaining = customer.get('multipass_sessions_remaining', 0) or 0
    sessions_total = customer.get('multipass_total_sessions', 0) or (program.get('multipass_session_count', 12) if program else 12)
    multipass_expires_at = customer.get('multipass_expires_at')
    reward_unlocked = bool(customer.get('reward_unlocked'))
    design = wallet_20_design(business, program)
    card_title = str(
        (program or {}).get('card_name')
        or design['card_label']
        or f'{biz_name} Rewards'
    ).strip()

    # VIP is fully dynamic on Apple Wallet: tier name, next tier, points and
    # the pass color all come from the customer's current VIP points.
    vip_tier = get_vip_tier(customer, program or {}) if card_type == 'vip' else {}
    vip_next_tier = get_next_vip_tier(customer, program or {}) if card_type == 'vip' else None

    if card_type == 'vip':
        vip_tier_color = (vip_tier or {}).get('color') or '#111827'
        primary_color = _normalize_hex_color(vip_tier_color, '#111827')
    else:
        primary_color = design['background']
    r, g, b = _hex_to_rgb(primary_color)

    # Keep text readable even when a business uses a light VIP tier color
    # such as gold, silver or pale yellow.
    relative_luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
    if relative_luma > 170:
        apple_foreground = 'rgb(15, 23, 42)'
        apple_label = 'rgba(15, 23, 42, 0.72)'
    else:
        apple_foreground = 'rgb(255, 255, 255)'
        apple_label = 'rgba(255, 255, 255, 0.75)'
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

    # Same per-type detail rows as build_loyalty_object (Google) and
    # WalletPass.jsx (website) - kept in sync so flipping to the back of the
    # Apple pass shows the same Active Until / Member Since / Membership
    # Type / Next Benefit style breakdown instead of duplicating whatever's
    # already on the front (primary/secondary fields below).
    apple_details = []
    if card_type == 'multipass':
        apple_details.append(('valid_until', 'VALID UNTIL', multipass_expires_at or 'No expiry set'))
    elif card_type == 'vip':
        current_vip_points = int(customer.get('vip_points') or 0)
        apple_details.append(('current_tier', 'CURRENT TIER', (vip_tier or {}).get('name') or 'VIP'))
        if vip_next_tier:
            next_threshold = int(vip_next_tier.get('min_points') or vip_next_tier.get('points') or 0)
            points_to_next = max(next_threshold - current_vip_points, 0) if next_threshold > 0 else None
            next_value = (
                f"{vip_next_tier.get('name')} · {points_to_next} points to go"
                if points_to_next is not None
                else str(vip_next_tier.get('name') or 'Next tier')
            )
        else:
            next_value = 'Top tier'
        apple_details.append(('next_tier', 'NEXT TIER', next_value))
    elif card_type == 'membership':
        status = membership_effective_status(customer)
        expiry = customer.get('membership_expires_at')
        services = (program.get('membership_services') if program else None) or []
        apple_details.append(('active_until', 'ACTIVE UNTIL', 'Lifetime' if status == 'lifetime' else (expiry or 'Not activated')))
        apple_details.append(('member_since', 'MEMBER SINCE', customer.get('membership_started_at') or '—'))
        apple_details.append(('membership_type', 'MEMBERSHIP TYPE', (program.get('card_name') if program else None) or design['card_label']))
        apple_details.append(('next_benefit', 'NEXT BENEFIT', services[0] if services else 'Rewards'))
    else:
        left = max(stamp_goal - stamps, 0)
        apple_details.append(('reward_detail', 'REWARD', reward_name if left == 0 else f'{left} more to {reward_name}'))

    # Recent Activity: one backField per movement (stamp added, points
    # earned/redeemed, session used, VIP tier change, membership visit -
    # whichever event table this card type actually writes to, see
    # get_recent_activity). Sits below the per-type summary above and
    # above the static About/link/announcement rows so flipping the pass
    # reads top-to-bottom as: status summary -> history -> about.
    activity = get_recent_activity(business.get('id'), customer.get('id'), card_type)
    activity_fields = []
    if activity:
        activity_fields.append({'key': 'activity_header', 'label': 'RECENT ACTIVITY', 'value': f'Last {len(activity)} movement{"s" if len(activity) != 1 else ""}'})
        activity_fields += [
            {'key': f'activity_{i}', 'label': format_activity_date(when), 'value': desc}
            for i, (when, desc) in enumerate(activity)
        ]

    back_fields = [
        {'key': 'card', 'label': 'CARD', 'value': design['card_label']},
        *[{'key': key, 'label': label, 'value': str(value)} for key, label, value in apple_details],
        *activity_fields,
        {'key': 'about', 'label': 'ABOUT', 'value': description or f'{biz_name} digital loyalty card powered by LoyaltyTree.'},
        {
            'key': 'feedback',
            'label': '⭐ RATE YOUR EXPERIENCE',
            'value': 'Share Feedback',
            'attributedValue': f'<a href="{BASE_URL}/feedback/{cust_public_id}">Share Feedback</a>',
        },
        {
            'key': 'online',
            'label': 'FULL CARD & HISTORY',
            'value': 'Open LoyaltyTree Card',
            'attributedValue': f'<a href="{BASE_URL}/wallet/{cust_public_id}">Open LoyaltyTree Card</a>',
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

    pass_dict = {
        'formatVersion': 1,
        'passTypeIdentifier': APPLE_PASS_TYPE_IDENTIFIER,
        'teamIdentifier': APPLE_TEAM_IDENTIFIER,
        'organizationName': biz_name,
        'serialNumber': cust_public_id,
        'description': f'{biz_name} Loyalty Card',
        'backgroundColor': f'rgb({r}, {g}, {b})',
        'foregroundColor': apple_foreground,
        'labelColor': apple_label,
        'webServiceURL': APPLE_PASS_WEB_SERVICE_URL,
        'authenticationToken': apple_pass_auth_token(cust_public_id),
        'storeCard': (
            {
                # POINTS
                # Card name stays at the top. Banner is image-only.
                # Below the banner: NEXT REWARD left, POINTS right.
                'headerFields': [
                    {'key': 'card_name', 'label': 'CARD', 'value': card_title[:32]}
                ],
                'primaryFields': [],
                'secondaryFields': [
                    {
                        'key': 'next_reward',
                        'label': 'NEXT REWARD',
                        'value': (
                            f"{next_points_prize.get('name')} · {next_points_prize.get('points_cost')} points"
                            if next_points_prize else
                            'Ask in-store for rewards'
                        ),
                        'changeMessage': 'Next reward: %@',
                    },
                    {
                        'key': 'points',
                        'label': 'POINTS',
                        'value': str(int(points_balance or 0)),
                        'textAlignment': 'PKTextAlignmentRight',
                        'changeMessage': 'Points updated: %@',
                    },
                ],
                'auxiliaryFields': [],
                'backFields': back_fields,
            }
            if card_type == 'points' else
            {
                # STAMP
                # No duplicate NAME field: the member name already appears
                # beneath the QR code via barcode alternateText.
                # Below the banner: NEXT REWARD left, STAMPS at the far right.
                'headerFields': [
                    {'key': 'card_name', 'label': 'CARD', 'value': card_title[:32]}
                ],
                'primaryFields': [],
                'secondaryFields': [
                    {
                        'key': 'next_reward',
                        'label': 'NEXT REWARD',
                        'value': (
                            f"{next_stamp_reward.get('reward_name')} · {next_stamp_reward.get('stamps')} stamps"
                            if next_stamp_reward else
                            f"{reward_name} · {full_stamp_goal} stamps"
                        ),
                        'changeMessage': 'Next reward: %@',
                    },
                    {
                        'key': 'stamps',
                        'label': 'STAMPS',
                        'value': f"{int(stamps or 0)}/{int(full_stamp_goal)}",
                        'textAlignment': 'PKTextAlignmentRight',
                        'changeMessage': 'Stamp progress: %@',
                    },
                ],
                'auxiliaryFields': [],
                'backFields': back_fields,
            }
            if card_type == 'stamp' else
            {
                # MULTIPASS: status left, sessions right.
                'headerFields': [
                    {'key': 'card_name', 'label': 'CARD', 'value': card_title[:32]}
                ],
                'primaryFields': [],
                'secondaryFields': [
                    {
                        'key': 'expires',
                        'label': 'EXPIRES',
                        'value': (multipass_expires_at or 'No expiry set'),
                        'changeMessage': 'Pass expiry: %@',
                    },
                    {
                        'key': 'sessions',
                        'label': 'SESSIONS',
                        'value': f"{sessions_remaining}/{sessions_total}",
                        'textAlignment': 'PKTextAlignmentRight',
                        'changeMessage': 'Sessions remaining: %@',
                    },
                ],
                'auxiliaryFields': [],
                'backFields': back_fields,
            }
            if card_type == 'multipass' else
            {
                # MEMBERSHIP: expiry/status info left, status right.
                'headerFields': [
                    {'key': 'card_name', 'label': 'CARD', 'value': card_title[:32]}
                ],
                'primaryFields': [],
                'secondaryFields': [
                    {
                        'key': 'active_until',
                        'label': 'ACTIVE UNTIL',
                        'value': (
                            'Lifetime'
                            if membership_effective_status(customer) == 'lifetime'
                            else (customer.get('membership_expires_at') or 'Not activated')
                        ),
                        'changeMessage': 'Active until: %@',
                    },
                    {
                        'key': 'membership_status',
                        'label': 'MEMBERSHIP',
                        'value': membership_effective_status(customer).upper(),
                        'textAlignment': 'PKTextAlignmentRight',
                        'changeMessage': 'Membership status: %@',
                    },
                ],
                'auxiliaryFields': [],
                'backFields': back_fields,
            }
            if card_type == 'membership' else
            {
                # VIP: tier left, VIP points right; tier colors remain dynamic.
                'headerFields': [
                    {'key': 'card_name', 'label': 'CARD', 'value': card_title[:32]}
                ],
                'primaryFields': [],
                'secondaryFields': [
                    {
                        'key': 'vip_tier',
                        'label': 'VIP TIER',
                        'value': (vip_tier or {}).get('name', 'VIP'),
                        'changeMessage': 'VIP tier updated: %@',
                    },
                    {
                        'key': 'vip_points',
                        'label': 'VIP POINTS',
                        'value': str(int(customer.get('vip_points') or 0)),
                        'textAlignment': 'PKTextAlignmentRight',
                        'changeMessage': 'VIP points updated: %@',
                    },
                ],
                'auxiliaryFields': [],
                'backFields': back_fields,
            }
        ),
        'barcodes': [
            {
                'format': 'PKBarcodeFormatQR',
                'message': f'{BASE_URL}/stamp/{cust_public_id}',
                'messageEncoding': 'iso-8859-1',
                'altText': cust_name
            }
        ]
    }

    # Keep the QR fallback exactly as it is. Apple VAS NFC is additionally
    # gated to a super-admin-enabled MEMBERSHIP trial.
    contactless_token = contactless_member_token(cust_public_id)
    nfc_trial_active = bool(card_type == 'membership' and program and program.get('nfc_trial_enabled'))
    if nfc_trial_active and APPLE_NFC_ENABLED and APPLE_NFC_ENCRYPTION_PUBLIC_KEY and contactless_token:
        pass_dict['nfc'] = {
            'message': contactless_token,
            'encryptionPublicKey': APPLE_NFC_ENCRYPTION_PUBLIC_KEY,
            'requiresAuthentication': bool(APPLE_NFC_REQUIRES_AUTHENTICATION),
        }
        if APPLE_NFC_REQUIRES_AUTHENTICATION:
            pass_dict['sharingProhibited'] = True

    # No logoText: it sits at the top next to the logo icon on the same row
    # as headerFields (e.g. "MEMBER: <name>"), and a business name of even
    # moderate length collides/overlaps with that field on narrower phones.
    # The logo image already carries the brand - headerFields already carry
    # the member context - logoText is redundant and the most common source
    # of the overlapping-text look on real devices.
    return pass_dict

def generate_apple_strip_bytes(customer: dict, business: dict, program: dict, width: int, height: int) -> bytes:
    design = wallet_20_design(business, program)
    card_type = (program or {}).get('card_type', 'stamp')
    stamp_goal = int((program or {}).get('stamp_goal') or 8)
    membership_summary = get_membership_summary(business.get('id'), customer.get('id')) if card_type == 'membership' else None
    vip_tier = get_vip_tier(customer, program or {}) if card_type == 'vip' else None
    hero_primary_color = (
        _normalize_hex_color((vip_tier or {}).get('color') or '#111827', '#111827')
        if card_type == 'vip'
        else design['background']
    )
    raw = generate_personalized_hero_image_bytes(
        hero_primary_color,
        (program or {}).get('reward_name') or 'Reward',
        int(customer.get('stamp_count') or 0),
        stamp_goal,
        (program or {}).get('description'),
        card_type=card_type,
        points_balance=int(customer.get('points_balance') or 0),
        sessions_remaining=int(customer.get('multipass_sessions_remaining') or 0),
        sessions_total=int(customer.get('multipass_total_sessions') or (program or {}).get('multipass_session_count') or 0),
        total_visits=(membership_summary or {}).get('total_visits', 0),
        last_service_name=(membership_summary or {}).get('last_service_name'),
        vip_points=int(customer.get('vip_points') or 0),
        vip_tier_name=(vip_tier or {}).get('name'),
        membership_status=membership_effective_status(customer) if card_type == 'membership' else None,
        membership_expires_at=customer.get('membership_expires_at'),
        secondary_color=(
            _normalize_hex_color((vip_tier or {}).get('color') or design['secondary'], design['secondary'])
            if card_type == 'vip'
            else design['secondary']
        ),
        wallet_style=design['style'],
        business_name=business.get('name'),
        card_label=design['card_label'],
        include_text_overlay=False,
    )
    img = Image.open(BytesIO(raw)).convert('RGB')
    src_ratio = img.width / img.height
    dst_ratio = width / height
    if src_ratio > dst_ratio:
        new_w = int(img.height * dst_ratio)
        left = (img.width - new_w) // 2
        img = img.crop((left, 0, left + new_w, img.height))
    else:
        new_h = int(img.width / dst_ratio)
        top = (img.height - new_h) // 2
        img = img.crop((0, top, img.width, top + new_h))
    img = img.resize((width, height), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

def _resize_png_bytes(png_bytes: bytes, width: int, height: int) -> Optional[bytes]:
    """Resize an already-rendered PNG without regenerating the underlying artwork."""
    if not png_bytes:
        return None
    try:
        img = Image.open(BytesIO(png_bytes)).convert("RGBA")
        img = img.resize((width, height), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="PNG", optimize=False)
        return buf.getvalue()
    except Exception as e:
        print(f"APPLE PNG resize error: {e}")
        return None


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

    design = wallet_20_design(business, program)
    primary_color = design['background']
    biz_name = business.get('name', 'Loyalty')

    # Real branding when the business has uploaded it - same source URLs
    # Google Wallet already uses (see build_loyalty_class) - so both wallets
    # end up matching. Each falls back to the existing generated placeholder
    # on any missing URL, fetch failure, or unreadable image.
    logo_url = business.get('logo_url') or ((program or {}).get('program_logo_url'))
    logo_bytes = _fetch_image_bytes(logo_url)
    pass_json = build_apple_pass_json(customer, business, program, announcement)

    # Render each branding asset only once at the largest required size, then
    # downscale it. Re-opening/resampling the same Cloudinary image six times
    # was unnecessary CPU work on every Add-to-Wallet request.
    icon_87 = apple_icon_from_logo_bytes(logo_bytes, 87) if logo_bytes else None
    if not icon_87:
        icon_87 = generate_apple_icon_bytes(primary_color, biz_name, 87)
    icon_58 = _resize_png_bytes(icon_87, 58, 58)
    icon_29 = _resize_png_bytes(icon_87, 29, 29)

    logo_480 = apple_logo_from_image_bytes(logo_bytes, 480, 150) if logo_bytes else None
    if not logo_480:
        logo_480 = generate_apple_logo_bytes(biz_name, 480, 150)
    logo_320 = _resize_png_bytes(logo_480, 320, 100)
    logo_160 = _resize_png_bytes(logo_480, 160, 50)

    files = {
        'pass.json': json.dumps(pass_json).encode('utf-8'),
        'icon.png': icon_29,
        'icon@2x.png': icon_58,
        'icon@3x.png': icon_87,
        'logo.png': logo_160,
        'logo@2x.png': logo_320,
        'logo@3x.png': logo_480,
    }
    if design['show_background']:
        # Restore the full-width Apple Wallet banner. Use the business's
        # uploaded hero image when available; otherwise generate a branded
        # LoyaltyTree fallback. Build @3x once and downscale for speed.
        hero_url = (program or {}).get('hero_image_url')
        hero_bytes = _fetch_image_bytes(hero_url)

        strip_3x = apple_strip_from_image_bytes(hero_bytes, 1125, 369) if hero_bytes else None
        if not strip_3x:
            strip_3x = generate_apple_strip_bytes(customer, business, program, 1125, 369)
        strip_2x = _resize_png_bytes(strip_3x, 750, 246)
        strip_1x = _resize_png_bytes(strip_3x, 375, 123)

        files.update({
            'strip.png': strip_1x,
            'strip@2x.png': strip_2x,
            'strip@3x.png': strip_3x,
        })

    manifest = {name: hashlib.sha1(content).hexdigest() for name, content in files.items()}
    manifest_bytes = json.dumps(manifest).encode('utf-8')
    signature = sign_pkpass_manifest(manifest_bytes)
    if signature is None:
        return None

    buffer = BytesIO()
    # PNG files are already compressed. ZIP_STORED avoids spending CPU trying to
    # deflate them again and materially shortens pass assembly on Render.
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_STORED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
        zf.writestr('manifest.json', manifest_bytes)
        zf.writestr('signature', signature)
    return buffer.getvalue()


# Short-lived cache for the *initial* Apple Wallet add flow.
# CustomerJoin requests /wallet-pass immediately after signup, and customer_signup
# prewarms this cache in the background. By the time the person taps "Add to Wallet"
# the already-signed .pkpass can usually be returned without image rendering/signing.
_APPLE_PKPASS_CACHE = {}
_APPLE_PKPASS_CACHE_TTL_SECONDS = 90


def _apple_pkpass_fingerprint(customer: dict, business: dict, program: dict, announcement: Optional[dict]) -> str:
    payload = {
        "customer": {
            "id": customer.get("public_id"),
            "updated_at": customer.get("updated_at"),
            "stamp_count": customer.get("stamp_count"),
            "points_balance": customer.get("points_balance"),
            "vip_points": customer.get("vip_points"),
            "multipass_sessions_remaining": customer.get("multipass_sessions_remaining"),
            "membership_status": customer.get("membership_status"),
            "membership_expires_at": customer.get("membership_expires_at"),
        },
        "business": {
            "updated_at": business.get("updated_at"),
            "logo_url": business.get("logo_url"),
            "name": business.get("name"),
        },
        "program": {
            "updated_at": (program or {}).get("updated_at"),
            "card_type": (program or {}).get("card_type"),
            "hero_image_url": (program or {}).get("hero_image_url"),
            "program_logo_url": (program or {}).get("program_logo_url"),
            "wallet_style": (program or {}).get("wallet_style"),
            "primary_color": (program or {}).get("primary_color"),
        },
        "announcement": {
            "id": (announcement or {}).get("id"),
            "updated_at": (announcement or {}).get("updated_at") or (announcement or {}).get("created_at"),
        },
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _get_cached_apple_pkpass(customer: dict, business: dict, program: dict, announcement: Optional[dict]) -> Optional[bytes]:
    serial = str(customer.get("public_id") or "")
    if not serial:
        return None
    cached = _APPLE_PKPASS_CACHE.get(serial)
    if not cached:
        return None
    created_at, fingerprint, pkpass_bytes = cached
    if time.monotonic() - created_at > _APPLE_PKPASS_CACHE_TTL_SECONDS:
        _APPLE_PKPASS_CACHE.pop(serial, None)
        return None
    if fingerprint != _apple_pkpass_fingerprint(customer, business, program or {}, announcement):
        _APPLE_PKPASS_CACHE.pop(serial, None)
        return None
    return pkpass_bytes


def _cache_apple_pkpass(customer: dict, business: dict, program: dict, announcement: Optional[dict], pkpass_bytes: bytes):
    serial = str(customer.get("public_id") or "")
    if serial and pkpass_bytes:
        _APPLE_PKPASS_CACHE[serial] = (
            time.monotonic(),
            _apple_pkpass_fingerprint(customer, business, program or {}, announcement),
            pkpass_bytes,
        )

        # Keep the cache bounded on long-running instances.
        if len(_APPLE_PKPASS_CACHE) > 500:
            cutoff = time.monotonic() - _APPLE_PKPASS_CACHE_TTL_SECONDS
            for key, value in list(_APPLE_PKPASS_CACHE.items()):
                if value[0] < cutoff:
                    _APPLE_PKPASS_CACHE.pop(key, None)


def _prewarm_apple_pkpass(customer: dict, business: dict, program: dict):
    """Best-effort preparation after signup; never delays the signup response."""
    try:
        if not customer or not APPLE_PASS_TYPE_IDENTIFIER or not APPLE_TEAM_IDENTIFIER:
            return
        announcement = get_latest_active_announcement(business.get("id"))
        pkpass_bytes = build_pkpass_bytes(customer, business, program or {}, announcement)
        if pkpass_bytes:
            _cache_apple_pkpass(customer, business, program or {}, announcement, pkpass_bytes)
            print(f"APPLE PASS PREWARMED: {customer.get('public_id')} bytes={len(pkpass_bytes)}")
    except Exception as e:
        print(f"APPLE PASS PREWARM error: {e}")


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
    """Wake Apple Wallet so it refetches this member's newly-built pass.

    Returns diagnostics but remains best-effort: a Wallet push failure must
    never roll back a valid loyalty transaction in Supabase.
    """
    if not supabase or not APPLE_PASS_TYPE_IDENTIFIER:
        print("APPLE WALLET SYNC: skipped - PassKit is not configured")
        return {"status": "not_configured", "registrations": 0, "pushes_sent": 0}
    if not serial_number:
        print("APPLE WALLET SYNC: skipped - missing serial number")
        return {"status": "error", "detail": "Missing serial number", "registrations": 0, "pushes_sent": 0}
    try:
        rows = (
            supabase.table("apple_wallet_registrations")
            .select("push_token")
            .eq("serial_number", serial_number)
            .eq("pass_type_identifier", APPLE_PASS_TYPE_IDENTIFIER)
            .execute()
        ).data or []
    except Exception as e:
        print(f"APPLE WALLET SYNC: registration lookup failed for {serial_number}: {e}")
        return {"status": "error", "stage": "registration_lookup", "detail": str(e), "registrations": 0, "pushes_sent": 0}

    tokens = [row.get('push_token') for row in rows if row.get('push_token')]
    if not tokens:
        print(f"APPLE WALLET SYNC: no saved Apple pass registration for {serial_number}")
        return {"status": "not_saved", "registrations": 0, "pushes_sent": 0}

    # Record the change before waking Wallet.  This guarantees the immediate
    # passesUpdatedSince callback can identify the serial even when the visible
    # change came from a related table rather than customers.updated_at.
    _mark_apple_pass_dirty(serial_number)
    tokens = list(dict.fromkeys(tokens))
    sent = _send_apple_wallet_pushes(tokens)
    status = "push_sent" if sent > 0 else "push_failed"
    print(f"APPLE WALLET SYNC: {serial_number} registrations={len(tokens)} pushes_sent={sent}")
    return {"status": status, "registrations": len(tokens), "pushes_sent": sent}


APPLE_PASS_LAYOUT_RELEASE = "wallet-layout-2026-08-23-v4-reward-left-metric-right"


def refresh_business_apple_wallet_passes(business_id: int, reason: str = "card_config_change"):
    """Wake every installed Apple Wallet pass for one business.

    This is Apple-only. It deliberately does not republish or PATCH Google
    Wallet classes/objects, so normal card edits can immediately reach
    existing iPhones without making the owner press Publish Card.
    """
    if not supabase or not APPLE_PASS_TYPE_IDENTIFIER:
        return {"status": "not_configured", "registered": 0, "devices_woken": 0}

    try:
        customer_rows = (
            supabase.table("customers")
            .select("public_id")
            .eq("business_id", business_id)
            .execute()
        ).data or []
    except Exception as e:
        print(f"APPLE AUTO REFRESH customer lookup error: {e}")
        return {"status": "error", "detail": str(e), "registered": 0, "devices_woken": 0}

    serials = [str(row.get("public_id")) for row in customer_rows if row.get("public_id")]
    if not serials:
        return {"status": "no_members", "registered": 0, "devices_woken": 0}

    registrations = []
    try:
        for i in range(0, len(serials), 100):
            chunk = serials[i:i + 100]
            rows = (
                supabase.table("apple_wallet_registrations")
                .select("serial_number,push_token")
                .in_("serial_number", chunk)
                .eq("pass_type_identifier", APPLE_PASS_TYPE_IDENTIFIER)
                .execute()
            ).data or []
            registrations.extend(rows)
    except Exception as e:
        print(f"APPLE AUTO REFRESH registration lookup error: {e}")
        return {"status": "error", "detail": str(e), "registered": 0, "devices_woken": 0}

    registered_serials = list(dict.fromkeys(
        str(row.get("serial_number"))
        for row in registrations
        if row.get("serial_number")
    ))
    if registered_serials:
        _mark_apple_pass_dirty(registered_serials)

    # A program/config change changes the pass fingerprint, so old cached
    # signed passes should never be served after we wake the phones.
    for serial in registered_serials:
        try:
            _APPLE_PKPASS_CACHE.pop(serial, None)
        except Exception:
            pass

    tokens = list(dict.fromkeys(
        row.get("push_token") for row in registrations if row.get("push_token")
    ))
    sent = _send_apple_wallet_pushes(tokens) if tokens else 0

    print(
        f"APPLE AUTO REFRESH: business={business_id} reason={reason} "
        f"registered={len(registered_serials)} devices_woken={sent}"
    )
    return {
        "status": "push_sent" if sent else ("not_saved" if not tokens else "push_failed"),
        "registered": len(registered_serials),
        "devices_woken": sent,
        "reason": reason,
    }


def refresh_all_apple_wallet_passes_for_release(layout_release: str):
    """One-time, durable migration wake-up for a newly deployed pass layout.

    The marker is stored in Supabase so Render restarts do not repeatedly wake
    every installed pass. A future pass redesign only needs a new
    APPLE_PASS_LAYOUT_RELEASE value to roll itself out automatically.
    """
    if not supabase or not APPLE_PASS_TYPE_IDENTIFIER:
        return

    try:
        marker_rows = (
            supabase.table("wallet_release_state")
            .select("value")
            .eq("key", "apple_pass_layout_release")
            .limit(1)
            .execute()
        ).data or []
    except Exception as e:
        print(
            "APPLE LAYOUT MIGRATION skipped: wallet_release_state unavailable. "
            f"Run the updated master SQL. Detail: {e}"
        )
        return

    if marker_rows and str(marker_rows[0].get("value") or "") == str(layout_release):
        print(f"APPLE LAYOUT MIGRATION already applied: {layout_release}")
        return

    try:
        rows = (
            supabase.table("apple_wallet_registrations")
            .select("serial_number,push_token")
            .eq("pass_type_identifier", APPLE_PASS_TYPE_IDENTIFIER)
            .execute()
        ).data or []
    except Exception as e:
        print(f"APPLE LAYOUT MIGRATION registration lookup error: {e}")
        return

    serials = list(dict.fromkeys(
        str(row.get("serial_number"))
        for row in rows
        if row.get("serial_number") and not str(row.get("serial_number")).startswith("cl-")
    ))
    tokens = list(dict.fromkeys(
        row.get("push_token")
        for row in rows
        if row.get("push_token") and not str(row.get("serial_number") or "").startswith("cl-")
    ))

    if serials:
        _mark_apple_pass_dirty(serials)
    for serial in serials:
        try:
            _APPLE_PKPASS_CACHE.pop(serial, None)
        except Exception:
            pass

    sent = _send_apple_wallet_pushes(tokens) if tokens else 0

    # Mark complete only after the fan-out attempt. If the process crashes
    # before this point, the next Render boot safely retries the migration.
    try:
        supabase.table("wallet_release_state").upsert(
            {
                "key": "apple_pass_layout_release",
                "value": str(layout_release),
                "updated_at": datetime.utcnow().isoformat(),
            },
            on_conflict="key",
        ).execute()
    except Exception as e:
        print(f"APPLE LAYOUT MIGRATION marker write error: {e}")
        return

    print(
        f"APPLE LAYOUT MIGRATION complete: release={layout_release} "
        f"passes={len(serials)} devices_woken={sent}"
    )


async def _apple_layout_release_startup():
    # Give Uvicorn/Supabase a moment to finish startup before doing a fan-out.
    await asyncio.sleep(8)
    await asyncio.to_thread(
        refresh_all_apple_wallet_passes_for_release,
        APPLE_PASS_LAYOUT_RELEASE,
    )


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
    """Companion to sync_wallet_object(); never raises, but returns status."""
    try:
        return push_apple_wallet_update(customer.get('public_id', ''))
    except Exception as e:
        print(f"APPLE WALLET sync error: {e}")
        return {"status": "error", "stage": "exception", "detail": str(e), "registrations": 0, "pushes_sent": 0}

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



def normalize_vip_tiers(program: dict) -> list:
    raw = program.get('vip_tiers') or []
    tiers = []
    for i, t in enumerate(raw):
        if not isinstance(t, dict):
            continue
        try:
            threshold = max(0, int(t.get('threshold') or 0))
        except Exception:
            threshold = 0
        tiers.append({
            'id': str(t.get('id') or f'tier-{i+1}'),
            'name': str(t.get('name') or f'Tier {i+1}'),
            'threshold': threshold,
            'color': str(t.get('color') or '#64748b'),
            'discount_percent': max(0, min(100, float(t.get('discount_percent') or 0))),
            'benefits': [str(x).strip() for x in (t.get('benefits') or []) if str(x).strip()],
            'active': t.get('active') is not False,
        })
    tiers = [t for t in tiers if t['active']]
    tiers.sort(key=lambda t: t['threshold'])
    return tiers

def get_vip_tier(customer: dict, program: dict) -> dict:
    tiers = normalize_vip_tiers(program)
    if not tiers:
        return {'id':'vip','name':'VIP','threshold':0,'color':'#111827','discount_percent':0,'benefits':[]}
    manual = customer.get('vip_manual_tier_id')
    if manual:
        found = next((t for t in tiers if t['id'] == manual), None)
        if found:
            return found
    points = int(customer.get('vip_points') or 0)
    current = tiers[0]
    for tier in tiers:
        if points >= tier['threshold']:
            current = tier
        else:
            break
    return current

def get_next_vip_tier(customer: dict, program: dict):
    points = int(customer.get('vip_points') or 0)
    current = get_vip_tier(customer, program)
    tiers = normalize_vip_tiers(program)
    for tier in tiers:
        if tier['threshold'] > points and tier['threshold'] > current['threshold']:
            return tier
    return None

def log_vip_event(business_id, customer_id, action, points_delta, points_balance, amount_spent=None, old_tier=None, new_tier=None, staff_id=None, branch_id=None, note=None):
    try:
        supabase.table('vip_events').insert({
            'business_id': business_id, 'customer_id': customer_id, 'action': action,
            'points_delta': points_delta, 'points_balance': points_balance,
            'amount_spent': amount_spent, 'old_tier': old_tier, 'new_tier': new_tier,
            'staff_id': staff_id, 'branch_id': branch_id, 'note': note,
            'created_at': datetime.utcnow().isoformat(),
        }).execute()
    except Exception as e:
        print(f'VIP EVENT error: {e}')

def membership_effective_status(customer: dict) -> str:
    """Returns the current access status, automatically treating a past
    expiry date as expired without overwriting suspended/cancelled/lifetime."""
    status = (customer.get('membership_status') or 'inactive').lower()
    if status in ('suspended', 'cancelled', 'lifetime'):
        return status
    expiry = customer.get('membership_expires_at')
    if status == 'active' and expiry:
        try:
            if datetime.strptime(str(expiry)[:10], '%Y-%m-%d').date() < datetime.utcnow().date():
                return 'expired'
        except Exception:
            pass
    return status

def membership_access_allowed(customer: dict) -> bool:
    return membership_effective_status(customer) in ('active', 'lifetime')

def add_days_to_date(date_value: Optional[str], days: int) -> str:
    base = datetime.utcnow().date()
    if date_value:
        try:
            parsed = datetime.strptime(str(date_value)[:10], '%Y-%m-%d').date()
            if parsed > base:
                base = parsed
        except Exception:
            pass
    return (base + timedelta(days=days)).isoformat()

def log_membership_history(business_id: int, customer_id: int, action: str,
                           old_status: Optional[str], new_status: Optional[str],
                           expires_at: Optional[str], price_paid: Optional[float],
                           payment_method: Optional[str], note: Optional[str]):
    try:
        supabase.table('membership_history').insert({
            'business_id': business_id,
            'customer_id': customer_id,
            'action': action,
            'old_status': old_status,
            'new_status': new_status,
            'expires_at': expires_at,
            'price_paid': price_paid,
            'payment_method': payment_method,
            'note': note,
            'created_at': datetime.utcnow().isoformat(),
        }).execute()
    except Exception as e:
        print(f"MEMBERSHIP HISTORY error: {e}")

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

def format_activity_date(value) -> str:
    """Renders either a 'YYYY-MM-DD' date (service_date) or a full ISO
    timestamp (created_at) as 'Aug 8, 2026', same convention as
    format_showroom_date. Falls back to the raw value on anything
    unparseable rather than dropping the row."""
    if not value:
        return '—'
    s = str(value)
    try:
        dt = datetime.fromisoformat(s.replace('Z', '+00:00')) if 'T' in s else datetime.strptime(s[:10], '%Y-%m-%d')
        return dt.strftime('%b %-d, %Y')
    except Exception:
        return s[:10] or s

def get_recent_activity(business_id: int, customer_id: int, card_type: str, limit: int = 15) -> List[tuple]:
    """Best-effort per-customer movement log, newest first, pulled from
    whichever event table this card type actually writes to (see
    log_stamp_event/log_points_event/log_multipass_event/log_vip_event/
    log_membership_event) plus redemption_events where a card type can
    redeem. Powers the 'Recent Activity' section on the back of the Apple
    Wallet pass. Returns a list of (raw_date, description) tuples, already
    sorted/trimmed to `limit`. Never raises - a query failure (including a
    table not existing yet) just means no activity section, same tradeoff
    as get_membership_summary."""
    entries = []
    try:
        if card_type == 'stamp':
            rows = (supabase.table('stamp_events').select('created_at')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('created_at', desc=True).limit(limit).execute().data or [])
            entries += [(r.get('created_at'), 'Stamp added') for r in rows]
            redemptions = (supabase.table('redemption_events').select('created_at')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('created_at', desc=True).limit(limit).execute().data or [])
            entries += [(r.get('created_at'), 'Reward redeemed') for r in redemptions]

        elif card_type == 'points':
            rows = (supabase.table('points_events').select('created_at,amount_spent_pesos,points_earned')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('created_at', desc=True).limit(limit).execute().data or [])
            for r in rows:
                pts, amt = r.get('points_earned'), r.get('amount_spent_pesos')
                desc = f"+{pts} pts" if pts is not None else 'Points earned'
                if amt:
                    desc += f" (₱{float(amt):,.0f} spent)"
                entries.append((r.get('created_at'), desc))
            redemptions = (supabase.table('redemption_events').select('created_at,points_spent')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('created_at', desc=True).limit(limit).execute().data or [])
            for r in redemptions:
                pts = r.get('points_spent')
                entries.append((r.get('created_at'), f"-{pts} pts • Reward redeemed" if pts is not None else 'Reward redeemed'))

        elif card_type == 'multipass':
            rows = (supabase.table('multipass_events').select('created_at,action,sessions_remaining')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('created_at', desc=True).limit(limit).execute().data or [])
            for r in rows:
                action, remaining = (r.get('action') or '').lower(), r.get('sessions_remaining')
                if action == 'used':
                    desc = f"Session used • {remaining} left" if remaining is not None else 'Session used'
                elif action == 'issued':
                    desc = f"Sessions issued • {remaining} total" if remaining is not None else 'Sessions issued'
                else:
                    desc = action.capitalize() or 'Update'
                entries.append((r.get('created_at'), desc))

        elif card_type == 'vip':
            rows = (supabase.table('vip_events').select('created_at,action,points_delta,points_balance,amount_spent,old_tier,new_tier')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('created_at', desc=True).limit(limit).execute().data or [])
            for r in rows:
                action, delta = (r.get('action') or '').lower(), r.get('points_delta')
                if action == 'tier_change' and r.get('new_tier'):
                    desc = f"Tier: {r.get('old_tier') or '—'} → {r.get('new_tier')}"
                elif delta is not None:
                    desc = f"{'+' if delta >= 0 else ''}{delta} VIP pts"
                    if r.get('amount_spent'):
                        desc += f" (₱{float(r['amount_spent']):,.0f})"
                else:
                    desc = action.replace('_', ' ').capitalize() or 'Update'
                entries.append((r.get('created_at'), desc))

        else:  # membership
            rows = (supabase.table('membership_events').select('service_date,service_name,note')
                    .eq('business_id', business_id).eq('customer_id', customer_id)
                    .order('service_date', desc=True).order('created_at', desc=True).limit(limit).execute().data or [])
            for r in rows:
                desc = r.get('service_name') or 'Visit'
                if r.get('note'):
                    desc += f" — {r['note']}"
                entries.append((r.get('service_date'), desc))
    except Exception as e:
        print(f"ACTIVITY LOG error: {e}")
        return []

    entries.sort(key=lambda item: str(item[0] or ''), reverse=True)
    return entries[:limit]

# ============================================================
# API SECURITY V2 — RATE LIMITING / BRUTE FORCE / DDoS GUARDS
# ============================================================
# These controls protect the application layer. A volumetric DDoS must still
# be filtered upstream (Cloudflare/hosting edge) before traffic reaches Render.

_RATE_LOCK = Lock()
_RATE_BUCKETS = defaultdict(deque)
_AUTH_FAILURES = defaultdict(deque)

# Tunable via Render environment variables without another code deployment.
API_MAX_BODY_BYTES = int(os.getenv("API_MAX_BODY_BYTES", str(1024 * 1024)))  # 1 MiB
API_GLOBAL_PER_MINUTE = int(os.getenv("API_GLOBAL_PER_MINUTE", "300"))
API_LOGIN_PER_MINUTE = int(os.getenv("API_LOGIN_PER_MINUTE", "12"))
API_CASHIER_LOGIN_PER_MINUTE = int(os.getenv("API_CASHIER_LOGIN_PER_MINUTE", "12"))
API_TRANSACTION_PER_MINUTE = int(os.getenv("API_TRANSACTION_PER_MINUTE", "90"))
API_PUBLIC_PER_MINUTE = int(os.getenv("API_PUBLIC_PER_MINUTE", "180"))
AUTH_FAILURE_WINDOW_SECONDS = int(os.getenv("AUTH_FAILURE_WINDOW_SECONDS", "900"))
AUTH_FAILURE_LIMIT = int(os.getenv("AUTH_FAILURE_LIMIT", "8"))


def _security_client_ip(request: Request) -> str:
    # Render terminates the public connection and forwards the original IP.
    # Take the first forwarded address; fall back to Starlette's client host.
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _rate_hit(key: str, limit: int, window_seconds: int = 60):
    now = time.time()
    cutoff = now - window_seconds
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            return False, retry_after
        bucket.append(now)
    return True, 0


def _auth_failure_key(kind: str, request: Request, identity: str = "") -> str:
    ip = _security_client_ip(request)
    normalized = (identity or "").strip().lower()[:320]
    return f"{kind}:{ip}:{normalized}"


def _check_auth_bruteforce(kind: str, request: Request, identity: str = ""):
    key = _auth_failure_key(kind, request, identity)
    now = time.time()
    cutoff = now - AUTH_FAILURE_WINDOW_SECONDS
    with _RATE_LOCK:
        bucket = _AUTH_FAILURES[key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= AUTH_FAILURE_LIMIT:
            retry_after = max(1, int(AUTH_FAILURE_WINDOW_SECONDS - (now - bucket[0])))
            raise HTTPException(
                status_code=429,
                detail="Too many failed login attempts. Please wait before trying again.",
                headers={"Retry-After": str(retry_after)},
            )


def _record_auth_failure(kind: str, request: Request, identity: str = ""):
    key = _auth_failure_key(kind, request, identity)
    now = time.time()
    cutoff = now - AUTH_FAILURE_WINDOW_SECONDS
    with _RATE_LOCK:
        bucket = _AUTH_FAILURES[key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        bucket.append(now)


def _clear_auth_failures(kind: str, request: Request, identity: str = ""):
    key = _auth_failure_key(kind, request, identity)
    with _RATE_LOCK:
        _AUTH_FAILURES.pop(key, None)


def _api_limit_for_path(path: str, method: str):
    p = path.lower()
    if p in ("/api/v1/login", "/api/v1/auth/login"):
        return "owner-login", API_LOGIN_PER_MINUTE
    if p.endswith("/staff/verify-pin"):
        return "cashier-login", API_CASHIER_LOGIN_PER_MINUTE
    if any(token in p for token in (
        "/stamp", "/points-sale", "/points-redeem", "/vip-sale",
        "/vip-adjust", "/multipass/issue", "/multipass/use",
        "/membership/action", "/membership/note",
    )):
        return "transaction", API_TRANSACTION_PER_MINUTE
    if p.startswith("/api/"):
        return "api", API_PUBLIC_PER_MINUTE
    return "global", API_GLOBAL_PER_MINUTE


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
async def api_abuse_guard(request: Request, call_next):
    """Application-layer protection against request floods and oversized bodies."""
    path = request.url.path
    ip = _security_client_ip(request)

    # Do not let large bodies consume application memory/CPU.
    if request.method in {"POST", "PUT", "PATCH"}:
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                if int(raw_length) > API_MAX_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request body too large"},
                    )
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length"})

    bucket_name, limit = _api_limit_for_path(path, request.method)
    allowed, retry_after = _rate_hit(f"{bucket_name}:{ip}", limit, 60)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please try again shortly."},
            headers={"Retry-After": str(retry_after)},
        )

    response = await call_next(request)

    # Basic response hardening.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


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
async def login(req: LoginRequest, request: Request):
    _check_auth_bruteforce('owner', request, req.email)

    # Platform super-admin check happens first, and doesn't touch the
    # database at all - it's an env-configured account, not a row in
    # `businesses`. Checked before the DB call so it still works even if
    # SUPABASE_URL/KEY are misconfigured.
    admin_token = get_admin_token()
    if admin_token and req.email == SUPER_ADMIN_EMAIL and req.password == SUPER_ADMIN_PASSWORD:
        _clear_auth_failures('owner', request, req.email)
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

    # Region/city partner accounts are platform-scoped and intentionally
    # separate from businesses and homepage-logo partners.
    try:
        partner = supabase.table("network_partners").select("*").ilike("email", req.email.strip()).maybe_single().execute().data
    except Exception:
        partner = None
    if partner:
        matched = partner.get('password_hash') in (req.password, hash_password(req.password))
        if matched and partner.get('is_active', True):
            _clear_auth_failures('owner', request, req.email)
            token = issue_partner_session(partner)
            return {
                "success": True,
                "token": token,
                "business_slug": "",
                "business_name": "LoyaltyTree Partner",
                "name": partner.get('name'),
                "role": "partner",
                "partner_type": partner.get('partner_type'),
                "partner_public_id": partner.get('public_id'),
                "user": {
                    "name": partner.get('name'),
                    "email": partner.get('email'),
                    "role": "partner",
                    "partner_type": partner.get('partner_type'),
                    "partner_public_id": partner.get('public_id'),
                    "token": token,
                    "business_slug": "",
                    "business_name": "LoyaltyTree Partner",
                }
            }
        if matched and not partner.get('is_active', True):
            raise HTTPException(status_code=403, detail='Partner account is inactive')

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
                _clear_auth_failures('owner', request, req.email)
                owner_session_token = create_owner_session_token(business)
                return {
                    "success": True,
                    "token": owner_session_token,
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
                        "token": owner_session_token,
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

    _record_auth_failure('owner', request, req.email)
    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.post("/api/v1/register")
@app.post("/api/v1/auth/register")
async def register(biz: BusinessCreate):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    # Some business types are invite-only / admin-provisioned (specialized
    # dashboards set up by us, not self-serve) - block them here rather than
    # just hiding the option in the UI, since this endpoint is public.
    biz.business_type = normalize_business_type(biz.business_type)
    INVITE_ONLY_BUSINESS_TYPES = {'car_lending', 'cockpit'}
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
    assigned_partner = None
    if (biz.partner_code or '').strip():
        code = biz.partner_code.strip().upper()
        try:
            assigned_partner = supabase.table('network_partners').select('*').eq('partner_code', code).eq('is_active', True).maybe_single().execute().data
        except Exception:
            assigned_partner = None
        if not assigned_partner:
            raise HTTPException(status_code=400, detail='Partner/referral code is not valid or is inactive')
    business_data = {
        'public_id': public_id,
        'name': biz.name,
        'email': biz.email,
        'phone': biz.phone,
        'contact_person': (biz.contact_person or '').strip() or None,
        'password_hash': hash_password(biz.password),
        'logo_url': biz.logo_url,
        'business_type': biz.business_type,
        'address': biz.address,
        'plan': plan,
        # Self-serve businesses remain pending until PayMongo confirms the
        # first subscription payment. The payment webhook promotes PENDING
        # accounts to ACTIVE and sets the normal subscription expiry date.
        'status': 'PENDING',
        'subscription_expires_at': None,
        'setup_kit_requested': bool(biz.setup_kit_requested),
        'setup_kit_paid': False,
        'setup_kit_status': 'requested' if biz.setup_kit_requested else None,
        'onboarding_step': 5,
        'onboarding_completed': False,
        'created_at': datetime.utcnow().isoformat(),
        'partner_id': assigned_partner.get('id') if assigned_partner else None,
        'partner_code_at_signup': assigned_partner.get('partner_code') if assigned_partner else None,
    }

    if biz.setup_kit_requested:
        if not (biz.logo_url or '').strip():
            raise HTTPException(status_code=400, detail='Business logo is required for the physical QR kit')
        if not (biz.kit_recipient_name or '').strip() or not (biz.kit_contact_number or '').strip() or not (biz.kit_delivery_address or '').strip():
            raise HTTPException(status_code=400, detail='Complete delivery details are required for the physical QR kit')

    try:
        insert_res = supabase.table("businesses").insert(business_data).execute()
        business_id = insert_res.data[0]['id'] if insert_res.data else None
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

    if business_id and biz.setup_kit_requested:
        try:
            frontend_base = (FRONTEND_URL or BASE_URL).rstrip('/')
            supabase.table('setup_kit_orders').insert({
                'public_id': generate_public_id(),
                'business_id': business_id,
                'recipient_name': biz.kit_recipient_name.strip(),
                'contact_number': biz.kit_contact_number.strip(),
                'delivery_address': biz.kit_delivery_address.strip(),
                'delivery_instructions': (biz.kit_delivery_instructions or '').strip() or None,
                'logo_url': biz.logo_url,
                'qr_join_url': f"{frontend_base}/join/{public_id}",
                'amount': 150,
                'payment_status': 'unpaid',
                'fulfillment_status': 'requested',
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat(),
            }).execute()
        except Exception as e:
            print(f"SETUP KIT ORDER create error: {e}")

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
                f"<li><b>Status:</b> PENDING PAYMENT</li>"
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


def setup_kit_payload(order: dict, business: dict) -> dict:
    frontend_base = (FRONTEND_URL or BASE_URL).rstrip('/')
    join_url = order.get('qr_join_url') or f"{frontend_base}/join/{business.get('public_id')}"
    return {
        **order,
        'business_public_id': business.get('public_id'),
        'business_name': business.get('name'),
        'business_email': business.get('email'),
        'business_phone': business.get('phone'),
        'business_address': business.get('address'),
        'logo_url': order.get('logo_url') or business.get('logo_url'),
        'qr_join_url': join_url,
        'qr_image_url': f"https://api.qrserver.com/v1/create-qr-code/?size=700x700&data={quote(join_url, safe='')}",
    }

@app.patch("/api/v1/business/{public_id}/onboarding-progress")
async def update_business_onboarding_progress(public_id: str, item: BusinessOnboardingUpdate, authorization: str = Header(default='')):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    require_owner_session(public_id, authorization)
    patch = {k:v for k,v in item.model_dump().items() if v is not None}
    if not patch:
        return {'success': True}
    patch['updated_at'] = datetime.utcnow().isoformat()
    supabase.table('businesses').update(patch).eq('id', business['id']).execute()
    return {'success': True, **patch}

@app.get("/api/v1/business/{public_id}/setup-kit")
async def get_setup_kit(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    rows = supabase.table('setup_kit_orders').select('*').eq('business_id', business['id']).order('created_at', desc=True).limit(1).execute().data or []
    return setup_kit_payload(rows[0], business) if rows else None

@app.patch("/api/v1/business/{public_id}/setup-kit")
async def update_setup_kit(public_id: str, item: SetupKitOwnerUpdate):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    rows = supabase.table('setup_kit_orders').select('*').eq('business_id', business['id']).order('created_at', desc=True).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail='No QR kit order found')
    patch = {k:v for k,v in item.model_dump().items() if v is not None}
    if 'logo_url' in patch:
        supabase.table('businesses').update({'logo_url':patch['logo_url'],'updated_at':datetime.utcnow().isoformat()}).eq('id',business['id']).execute()
        business['logo_url'] = patch['logo_url']
    patch['updated_at'] = datetime.utcnow().isoformat()
    updated = supabase.table('setup_kit_orders').update(patch).eq('id',rows[0]['id']).execute().data[0]
    return setup_kit_payload(updated,business)

@app.get("/api/v1/admin/setup-kit-orders")
async def admin_setup_kit_orders(_: bool = Depends(require_admin)):
    orders = supabase.table('setup_kit_orders').select('*').order('created_at', desc=True).execute().data or []
    ids = list({o['business_id'] for o in orders})
    businesses = supabase.table('businesses').select('*').in_('id',ids).execute().data or [] if ids else []
    by_id = {b['id']:b for b in businesses}
    return [setup_kit_payload(o,by_id.get(o['business_id'],{})) for o in orders]

@app.patch("/api/v1/admin/setup-kit-orders/{order_public_id}")
async def admin_update_setup_kit_order(order_public_id: str, item: SetupKitAdminUpdate, _: bool = Depends(require_admin)):
    rows = supabase.table('setup_kit_orders').select('*').eq('public_id',order_public_id).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail='QR kit order not found')
    patch = {k:v for k,v in item.model_dump().items() if v is not None}
    now = datetime.utcnow().isoformat()
    if patch.get('fulfillment_status') == 'shipped': patch['shipped_at'] = now
    if patch.get('fulfillment_status') == 'delivered': patch['delivered_at'] = now
    patch['updated_at'] = now
    updated = supabase.table('setup_kit_orders').update(patch).eq('id',rows[0]['id']).execute().data[0]
    supabase.table('businesses').update({'setup_kit_status':updated.get('fulfillment_status'),'updated_at':now}).eq('id',updated['business_id']).execute()
    business = safe_get_business_by_id(updated['business_id']) or {}
    return setup_kit_payload(updated,business)



# ============================================================
# PUBLIC COMMUNITY IMPACT STATS
# Homepage-safe aggregate totals only. No customer/business records are exposed.
# Cached briefly so a busy homepage does not repeatedly scan aggregate tables.
# ============================================================

_COMMUNITY_STATS_CACHE = {"value": None, "expires_at": 0.0}
_COMMUNITY_STATS_LOCK = Lock()

def _sum_numeric_column_all(table_name: str, column_name: str, max_rows: int = 250000) -> int:
    """Sum one numeric column in pages so Supabase's default row cap cannot
    truncate lifetime public impact totals."""
    total = 0
    page_size = 1000
    start = 0
    while start < max_rows:
        batch = (
            supabase.table(table_name)
            .select(column_name)
            .range(start, min(start + page_size - 1, max_rows - 1))
            .execute()
            .data or []
        )
        for row in batch:
            try:
                total += int(row.get(column_name) or 0)
            except (TypeError, ValueError):
                pass
        if len(batch) < page_size:
            break
        start += page_size
    return total

@app.get("/api/v1/public/community-stats")
async def public_community_stats():
    """Live lifetime platform totals for the public homepage.

    This intentionally returns aggregate counts only:
    - businesses: same all-business count used by the super-admin overview
    - members: all customer/member records
    - stamps: lifetime stamp-event count
    - points: lifetime points issued (sum of positive points_earned)
    """
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    now_ts = time.time()
    cached = _COMMUNITY_STATS_CACHE.get("value")
    if cached is not None and now_ts < float(_COMMUNITY_STATS_CACHE.get("expires_at") or 0):
        return cached

    try:
        businesses_res = supabase.table("businesses").select("id", count="exact").execute()
        members_res = supabase.table("customers").select("id", count="exact").execute()
        stamps_res = supabase.table("stamp_events").select("id", count="exact").execute()

        points_total = _sum_numeric_column_all("points_events", "points_earned")
        # "Points issued" should never be reduced by redemption/adjustment rows.
        # If a historical row is negative, exclude that negative effect.
        # Re-read in pages only when negatives are possible would add more load,
        # so the event writer is expected to store issued points as non-negative.
        result = {
            "businesses": int(businesses_res.count or 0),
            "stamps": int(stamps_res.count or 0),
            "points": max(0, int(points_total or 0)),
            "members": int(members_res.count or 0),
            "updated_at": datetime.utcnow().isoformat(),
        }

        with _COMMUNITY_STATS_LOCK:
            _COMMUNITY_STATS_CACHE["value"] = result
            _COMMUNITY_STATS_CACHE["expires_at"] = time.time() + 30
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load community stats: {friendly_db_error(exc)}")


# ============================================================
# PLATFORM SITE / CONVERSION ANALYTICS
# First-party, privacy-conscious analytics for LoyaltyTree public pages.
# No raw IP address is stored. Frontend-generated random visitor/session IDs
# are used only for aggregate visit counts and conversion reporting.
# ============================================================

_PLATFORM_ANALYTICS_ALLOWED_EVENTS = {
    'page_view',
    'pricing_view',
    'apply_business_click',
    'contact_click',
    'login_click',
    'customer_join_view',
    'customer_join_complete',
    'wallet_google_click',
    'wallet_apple_click',
    'wallet_card_view',
}

def _analytics_device_type(user_agent: str) -> str:
    ua = (user_agent or '').lower()
    if any(x in ua for x in ('ipad', 'tablet', 'kindle', 'silk/')):
        return 'tablet'
    if any(x in ua for x in ('iphone', 'ipod', 'android', 'mobile')):
        return 'mobile'
    return 'desktop'

def _analytics_browser(user_agent: str) -> str:
    ua = (user_agent or '').lower()
    if 'edg/' in ua:
        return 'Edge'
    if 'opr/' in ua or 'opera' in ua:
        return 'Opera'
    if 'chrome/' in ua and 'chromium' not in ua:
        return 'Chrome'
    if 'firefox/' in ua:
        return 'Firefox'
    if 'safari/' in ua and 'chrome/' not in ua:
        return 'Safari'
    return 'Other'


_ANALYTICS_GEO_CACHE = {}
_ANALYTICS_GEO_LOCK = Lock()
ANALYTICS_GEO_LOOKUP_ENABLED = _env_bool("ANALYTICS_GEO_LOOKUP_ENABLED", True)
ANALYTICS_GEO_CACHE_SECONDS = int(os.getenv("ANALYTICS_GEO_CACHE_SECONDS", "21600"))

def _analytics_clean_geo(value, max_length=120):
    value = unquote(str(value or "")).strip()
    if not value or value.lower() in ("unknown", "null", "none"):
        return None
    return value[:max_length]

def _analytics_header_geo(headers: dict) -> dict:
    """Use trusted edge geolocation headers when they are present.
    Vercel supplies these when a request is routed through Vercel; Cloudflare
    may supply country. Missing fields are filled by the server-side fallback."""
    return {
        "country_code": _analytics_clean_geo(headers.get("x-vercel-ip-country") or headers.get("cf-ipcountry"), 8),
        "region": _analytics_clean_geo(headers.get("x-vercel-ip-country-region")),
        "city": _analytics_clean_geo(headers.get("x-vercel-ip-city")),
    }

def _analytics_geo_for_ip(ip: str, header_geo: Optional[dict] = None) -> dict:
    """Best-effort approximate IP geolocation.

    Raw IP addresses are used only transiently for the lookup/cache key and are
    never written to Supabase. The stored analytics event receives only coarse
    country/region/city fields inside metadata.geo.
    """
    geo = dict(header_geo or {})
    if geo.get("city") and geo.get("region") and geo.get("country_code"):
        return geo

    ip = str(ip or "").strip()
    if not ANALYTICS_GEO_LOOKUP_ENABLED or not ip or ip == "unknown":
        return geo

    try:
        import ipaddress
        parsed = ipaddress.ip_address(ip)
        if parsed.is_private or parsed.is_loopback or parsed.is_link_local:
            return geo
    except Exception:
        return geo

    now_ts = time.time()
    with _ANALYTICS_GEO_LOCK:
        cached = _ANALYTICS_GEO_CACHE.get(ip)
        if cached and now_ts < cached.get("expires_at", 0):
            merged = dict(cached.get("geo") or {})
            merged.update({k: v for k, v in geo.items() if v})
            return merged

    looked_up = {}
    try:
        import httpx
        # ipapi.co is only a fallback when hosting-edge geo headers are absent.
        # A short timeout ensures analytics can never slow the public request.
        with httpx.Client(timeout=2.5, follow_redirects=True) as client:
            res = client.get(f"https://ipapi.co/{quote(ip, safe='')}/json/")
        if res.status_code < 400:
            data = res.json() if res.content else {}
            if not data.get("error"):
                looked_up = {
                    "country": _analytics_clean_geo(data.get("country_name")),
                    "country_code": _analytics_clean_geo(data.get("country_code"), 8),
                    "region": _analytics_clean_geo(data.get("region")),
                    "city": _analytics_clean_geo(data.get("city")),
                }
    except Exception as exc:
        print(f"PLATFORM ANALYTICS geo lookup warning: {exc}")

    with _ANALYTICS_GEO_LOCK:
        # Keep the cache bounded on long-running instances.
        if len(_ANALYTICS_GEO_CACHE) > 5000:
            _ANALYTICS_GEO_CACHE.clear()
        _ANALYTICS_GEO_CACHE[ip] = {
            "geo": looked_up,
            "expires_at": time.time() + ANALYTICS_GEO_CACHE_SECONDS,
        }

    merged = dict(looked_up)
    merged.update({k: v for k, v in geo.items() if v})
    return {k: v for k, v in merged.items() if v}

def _record_platform_analytics_event(payload: dict, user_agent: str = '', client_ip: str = '', header_geo: Optional[dict] = None):
    """Best-effort analytics insert. Never raises into a customer-facing flow."""
    if not supabase:
        return
    try:
        event_name = str(payload.get('event_name') or '').strip().lower()
        if event_name not in _PLATFORM_ANALYTICS_ALLOWED_EVENTS:
            return

        path = str(payload.get('path') or '/')[:500]
        # Public analytics only. This keeps accidental dashboard events out of
        # the traffic numbers even if a future frontend calls the endpoint.
        blocked_prefixes = ('/admin', '/dashboard', '/scanner', '/partner', '/analytics')
        if any(path.startswith(prefix) for prefix in blocked_prefixes):
            return

        business_id = None
        business_public_id = (payload.get('business_public_id') or '').strip() or None
        if business_public_id:
            business = safe_get_business(business_public_id)
            if business:
                business_id = business.get('id')

        metadata = dict(payload.get('metadata')) if isinstance(payload.get('metadata'), dict) else {}
        # Approximate visitor location is added server-side only. The browser is
        # never asked for GPS permission, and the raw IP is never stored.
        if event_name == 'page_view':
            geo = _analytics_geo_for_ip(client_ip, header_geo)
            if geo:
                metadata['geo'] = geo

        # Never allow profile/contact data to be copied into analytics metadata.
        for sensitive_key in (
            'name', 'email', 'phone', 'address', 'birthday', 'age',
            'password', 'pin', 'token', 'authorization'
        ):
            metadata.pop(sensitive_key, None)

        row = {
            'public_id': generate_public_id(),
            'event_name': event_name,
            'session_id': (payload.get('session_id') or None),
            'visitor_id': (payload.get('visitor_id') or None),
            'path': path,
            'page_name': (payload.get('page_name') or None),
            'referrer': (payload.get('referrer') or None),
            'source': (payload.get('source') or 'direct'),
            'medium': (payload.get('medium') or None),
            'campaign': (payload.get('campaign') or None),
            'device_type': _analytics_device_type(user_agent),
            'browser': _analytics_browser(user_agent),
            'business_id': business_id,
            'metadata': metadata,
            'created_at': datetime.utcnow().isoformat(),
        }
        supabase.table('platform_analytics_events').insert(row).execute()
    except Exception as exc:
        print(f"PLATFORM ANALYTICS insert warning: {exc}")

@app.post("/api/v1/public/analytics/event", status_code=202)
async def public_platform_analytics_event(
    event: PlatformAnalyticsEventCreate,
    request: Request,
    background_tasks: BackgroundTasks,
):
    payload = event.model_dump()
    user_agent = request.headers.get('user-agent', '')
    client_ip = _security_client_ip(request)
    header_geo = _analytics_header_geo(dict(request.headers))
    background_tasks.add_task(
        _record_platform_analytics_event,
        payload,
        user_agent,
        client_ip,
        header_geo,
    )
    return {'ok': True}

def _load_platform_analytics_rows(since_iso: str, max_rows: int = 50000) -> list:
    """Load analytics rows in pages so Supabase's default row cap does not
    silently truncate a normal admin report."""
    rows = []
    page_size = 1000
    start = 0
    while start < max_rows:
        batch = (
            supabase.table('platform_analytics_events')
            .select('*')
            .gte('created_at', since_iso)
            .order('created_at', desc=True)
            .range(start, min(start + page_size - 1, max_rows - 1))
            .execute()
            .data or []
        )
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows

@app.get("/api/v1/admin/platform-analytics")
async def admin_platform_analytics(
    days: int = Query(default=30, ge=1, le=365),
    _: bool = Depends(require_admin),
):
    if not supabase:
        raise HTTPException(status_code=503, detail='Database not connected')

    now = datetime.utcnow()
    since_dt = now - timedelta(days=days)
    since_iso = since_dt.isoformat()
    today_iso = now.date().isoformat()

    try:
        rows = _load_platform_analytics_rows(since_iso)
    except Exception as exc:
        # Clear, actionable error when the master SQL has not been run yet.
        raise HTTPException(
            status_code=500,
            detail=f"Platform analytics table is not ready. Run the updated LoyaltyTree master SQL first. {friendly_db_error(exc)}",
        )

    page_rows = [r for r in rows if r.get('event_name') == 'page_view']
    unique_sessions = {r.get('session_id') for r in page_rows if r.get('session_id')}
    unique_visitors = {r.get('visitor_id') for r in page_rows if r.get('visitor_id')}

    def count_event(name):
        return sum(1 for r in rows if r.get('event_name') == name)

    page_counts = {}
    source_counts = {}
    device_counts = {}
    browser_counts = {}
    event_counts = {}
    business_join_counts = {}
    country_visitors = defaultdict(set)
    region_visitors = defaultdict(set)
    city_visitors = defaultdict(set)
    geo_page_views = 0
    daily_map = {}

    for offset in range(days - 1, -1, -1):
        day = (now - timedelta(days=offset)).date().isoformat()
        daily_map[day] = {'date': day, 'views': 0, 'unique_sessions': set(), 'conversions': 0}

    for row in rows:
        event_name = row.get('event_name') or 'unknown'
        event_counts[event_name] = event_counts.get(event_name, 0) + 1

        created_day = str(row.get('created_at') or '')[:10]
        if created_day in daily_map:
            if event_name == 'page_view':
                daily_map[created_day]['views'] += 1
                if row.get('session_id'):
                    daily_map[created_day]['unique_sessions'].add(row.get('session_id'))
            if event_name in ('apply_business_click', 'customer_join_complete'):
                daily_map[created_day]['conversions'] += 1

        if event_name == 'page_view':
            path = row.get('path') or '/'
            page_counts[path] = page_counts.get(path, 0) + 1
            source = row.get('source') or 'direct'
            source_counts[source] = source_counts.get(source, 0) + 1
            device = row.get('device_type') or 'unknown'
            device_counts[device] = device_counts.get(device, 0) + 1
            browser = row.get('browser') or 'Other'
            browser_counts[browser] = browser_counts.get(browser, 0) + 1

            metadata = row.get('metadata') or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except Exception:
                    metadata = {}
            geo = metadata.get('geo') if isinstance(metadata, dict) else {}
            geo = geo if isinstance(geo, dict) else {}
            visitor_key = row.get('visitor_id') or row.get('session_id') or row.get('public_id')
            if visitor_key and any(geo.get(k) for k in ('country', 'country_code', 'region', 'city')):
                geo_page_views += 1
                country_label = geo.get('country') or geo.get('country_code')
                region_label = geo.get('region')
                city_label = geo.get('city')
                if country_label:
                    country_visitors[str(country_label)].add(str(visitor_key))
                if region_label:
                    region_visitors[str(region_label)].add(str(visitor_key))
                if city_label:
                    # Add the region where available to disambiguate duplicate city names.
                    label = f"{city_label}, {region_label}" if region_label else str(city_label)
                    city_visitors[label].add(str(visitor_key))

            if row.get('business_id') and str(path).startswith('/join/'):
                key = str(row.get('business_id'))
                business_join_counts[key] = business_join_counts.get(key, 0) + 1

    # Resolve business names only for join pages that actually received traffic.
    business_names = {}
    if business_join_counts:
        try:
            ids = [int(k) for k in business_join_counts.keys()]
            biz_rows = supabase.table('businesses').select('id,public_id,name').in_('id', ids).execute().data or []
            business_names = {str(b.get('id')): b for b in biz_rows}
        except Exception:
            business_names = {}

    # Reliable conversion totals from core tables. These remain correct even if
    # an analytics POST was blocked by an ad blocker or the visitor closed the tab.
    try:
        business_signups_rows = (
            supabase.table('businesses')
            .select('id,is_demo,created_at')
            .gte('created_at', since_iso)
            .execute()
            .data or []
        )
        business_signups = sum(1 for b in business_signups_rows if not b.get('is_demo'))
    except Exception:
        business_signups = 0

    try:
        customers_created_res = (
            supabase.table('customers')
            .select('id', count='exact')
            .gte('created_at', since_iso)
            .execute()
        )
        customers_created = customers_created_res.count or 0
    except Exception:
        customers_created = count_event('customer_join_complete')

    apply_clicks = count_event('apply_business_click')
    join_page_views = sum(
        1 for r in page_rows if str(r.get('path') or '').startswith('/join/')
    )
    customer_join_completions = count_event('customer_join_complete')

    daily = [
        {
            'date': day,
            'views': data['views'],
            'unique_visitors': len(data['unique_sessions']),
            'conversions': data['conversions'],
        }
        for day, data in daily_map.items()
    ]

    def ranked(mapping, limit=10):
        return [
            {'label': label, 'count': count}
            for label, count in sorted(mapping.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        ]

    def ranked_sets(mapping, limit=10):
        return [
            {'label': label, 'count': len(values)}
            for label, values in sorted(mapping.items(), key=lambda kv: len(kv[1]), reverse=True)[:limit]
        ]

    top_business_join_pages = []
    for key, count in sorted(business_join_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]:
        biz = business_names.get(key) or {}
        top_business_join_pages.append({
            'business_id': int(key),
            'business_public_id': biz.get('public_id'),
            'business_name': biz.get('name') or f'Business #{key}',
            'views': count,
        })

    recent = []
    for row in rows[:25]:
        metadata = row.get('metadata') or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = {}
        geo = metadata.get('geo') if isinstance(metadata, dict) else {}
        geo = geo if isinstance(geo, dict) else {}
        location_parts = [geo.get('city'), geo.get('region'), geo.get('country_code') or geo.get('country')]
        location = ', '.join(str(x) for x in location_parts if x)
        recent.append({
            'event_name': row.get('event_name'),
            'path': row.get('path'),
            'page_name': row.get('page_name'),
            'source': row.get('source'),
            'device_type': row.get('device_type'),
            'browser': row.get('browser'),
            'location': location or None,
            'created_at': row.get('created_at'),
        })

    return {
        'days': days,
        'total_page_views': len(page_rows),
        'unique_sessions': len(unique_sessions),
        'unique_visitors': len(unique_visitors),
        'views_today': sum(1 for r in page_rows if str(r.get('created_at') or '')[:10] == today_iso),
        'apply_clicks': apply_clicks,
        'business_signups': business_signups,
        'business_apply_conversion_rate': round((business_signups / apply_clicks) * 100, 1) if apply_clicks else 0,
        'join_page_views': join_page_views,
        'customer_join_completions': customer_join_completions,
        'customers_created': customers_created,
        'customer_join_conversion_rate': round((customer_join_completions / join_page_views) * 100, 1) if join_page_views else 0,
        'pricing_views': count_event('pricing_view'),
        'contact_clicks': count_event('contact_click'),
        'wallet_google_clicks': count_event('wallet_google_click'),
        'wallet_apple_clicks': count_event('wallet_apple_click'),
        'wallet_card_views': count_event('wallet_card_view'),
        'daily': daily,
        'top_pages': ranked(page_counts),
        'sources': ranked(source_counts, 8),
        'devices': ranked(device_counts, 5),
        'browsers': ranked(browser_counts, 8),
        'top_countries': ranked_sets(country_visitors, 10),
        'top_regions': ranked_sets(region_visitors, 10),
        'top_cities': ranked_sets(city_visitors, 12),
        'geo_page_views': geo_page_views,
        'geo_coverage_percent': round((geo_page_views / len(page_rows)) * 100, 1) if page_rows else 0,
        'events': ranked(event_counts, 20),
        'top_business_join_pages': top_business_join_pages,
        'recent': recent,
        'sample_truncated': len(rows) >= 50000,
    }


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
    summary["nfc_trial"] = {
        'enabled': bool(program and program.get('card_type') == 'membership' and program.get('nfc_trial_enabled')),
        'eligible': bool(program and program.get('card_type') == 'membership'),
        'token_secret_configured': bool(NFC_TOKEN_SECRET),
        'google_smart_tap_configured': bool(GOOGLE_SMART_TAP_ENABLED and GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID),
        'apple_nfc_configured': bool(APPLE_NFC_ENABLED and APPLE_NFC_ENCRYPTION_PUBLIC_KEY),
    }
    return summary

@app.patch("/api/v1/admin/businesses/{public_id}/nfc-trial")
async def admin_set_nfc_trial(public_id: str, update: AdminNfcTrialUpdate, background_tasks: BackgroundTasks, _: bool = Depends(require_admin)):
    """Super-admin-only switch for the first NFC membership pilot.

    The flag lives on loyalty_programs, not businesses, so NFC is attached to
    the active card program. It cannot be enabled for stamp/points/VIP/etc.
    """
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    program = safe_get_loyalty_program(business.get('id'))
    if not program:
        raise HTTPException(status_code=400, detail="Create a loyalty program before enabling NFC")
    if update.enabled and program.get('card_type') != 'membership':
        raise HTTPException(status_code=400, detail="NFC trial can only be enabled for a membership card")

    try:
        supabase.table('loyalty_programs').update({
            'nfc_trial_enabled': bool(update.enabled),
            'updated_at': datetime.utcnow().isoformat(),
        }).eq('business_id', business.get('id')).execute()
    except Exception as e:
        if 'nfc_trial_enabled' in str(e):
            raise HTTPException(status_code=503, detail="NFC trial database migration has not been installed yet")
        raise HTTPException(status_code=500, detail=f"Could not update NFC trial: {friendly_db_error(e)}")

    current_program = safe_get_loyalty_program(business.get('id')) or {**program, 'nfc_trial_enabled': bool(update.enabled)}
    # Rebuild Google class/object state and wake registered Apple passes in the
    # background. QR remains intact regardless of NFC platform readiness.
    background_tasks.add_task(republish_wallet_class_and_refresh, dict(business), dict(current_program))

    return {
        'success': True,
        'enabled': bool(update.enabled),
        'membership_only': True,
        'token_secret_configured': bool(NFC_TOKEN_SECRET),
        'google_smart_tap_configured': bool(GOOGLE_SMART_TAP_ENABLED and GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID),
        'apple_nfc_configured': bool(APPLE_NFC_ENABLED and APPLE_NFC_ENCRYPTION_PUBLIC_KEY),
        'message': 'NFC membership trial enabled' if update.enabled else 'NFC membership trial disabled',
    }

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
    if update.contact_person is not None:
        data['contact_person'] = update.contact_person.strip() or None
    if update.business_type is not None:
        data['business_type'] = normalize_business_type(update.business_type)
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



# ---- Partner Sales Demo / Agyaman Express -----------------------------------
def _partner_demo_slug(partner: dict) -> str:
    code = re.sub(r'[^a-z0-9]+', '-', str(partner.get('partner_code') or partner.get('public_id') or 'partner').lower()).strip('-')
    return f"agyaman-express-{code}"[:120]


def _ensure_partner_demo_business(partner: dict) -> dict:
    """Return this partner's isolated Agyaman Express demo business.

    The demo is a real LoyaltyTree business technically, so Join QR, customer
    Wallet cards, card editing and cashier transactions exercise the production
    stack. It is NOT attached through businesses.partner_id and is marked
    is_demo=true, so normal referral commission attribution is not triggered.
    """
    if not partner:
        raise HTTPException(status_code=404, detail='Partner not found')

    business = None
    demo_business_id = partner.get('demo_business_id')
    if demo_business_id:
        try:
            business = safe_get_business_by_id(demo_business_id)
        except Exception:
            business = None

    slug = _partner_demo_slug(partner)
    if not business:
        try:
            business = supabase.table('businesses').select('*').eq('public_id', slug).maybe_single().execute().data
        except Exception:
            business = None

    now = datetime.utcnow().isoformat()
    if not business:
        demo_email = f"demo+{str(partner.get('public_id') or uuid.uuid4().hex).replace('@','_')}@loyaltytree.demo"
        payload = {
            'public_id': slug,
            'name': 'Agyaman Express',
            'email': demo_email,
            'phone': None,
            'password_hash': hash_password(uuid.uuid4().hex + uuid.uuid4().hex),
            'status': 'ACTIVE',
            'logo_url': None,
            'business_type': 'coffee',
            'address': ', '.join(x for x in [partner.get('city'), partner.get('region')] if x) or 'Partner Demo',
            'plan': 'pro',
            'created_at': now,
            'updated_at': now,
            'subscription_expires_at': '2099-12-31',
            'is_demo': True,
        }
        rows = supabase.table('businesses').insert(payload).execute().data or []
        if not rows:
            raise HTTPException(status_code=500, detail='Could not create Agyaman Express demo business')
        business = rows[0]
    elif business.get('is_demo') is not True:
        # Only ever mark the deterministic Agyaman demo slug. Never convert an
        # arbitrary linked real business into demo mode.
        if business.get('public_id') != slug:
            raise HTTPException(status_code=409, detail='Partner demo link points to a non-demo business')
        rows = supabase.table('businesses').update({'is_demo': True, 'updated_at': now}).eq('id', business.get('id')).execute().data or []
        if rows:
            business = rows[0]

    # Keep the linkage on the partner row.
    if partner.get('demo_business_id') != business.get('id'):
        try:
            supabase.table('network_partners').update({
                'demo_business_id': business.get('id'),
                'updated_at': now,
            }).eq('id', partner.get('id')).execute()
            partner['demo_business_id'] = business.get('id')
        except Exception as exc:
            print(f"PARTNER DEMO link update failed: {exc}")

    # Seed a polished stamp-card demo once. After that, the partner edits this
    # exact loyalty_programs row through the normal LoyaltyCardCustomizer.
    program = safe_get_loyalty_program(business.get('id'))
    if not program:
        demo_program = {
            'business_id': business.get('id'),
            'card_type': 'stamp',
            'card_name': 'Agyaman Express Rewards',
            'description': 'Collect stamps, unlock rewards, and experience LoyaltyTree in real time.',
            'stamp_goal': 10,
            'reward_name': 'Agyaman Grand Reward',
            'stamp_rewards': [
                {'id': 'agyaman-5', 'stamps': 5, 'reward_name': 'Free Agyaman Drink'},
                {'id': 'agyaman-10', 'stamps': 10, 'reward_name': 'Agyaman Grand Reward'},
            ],
            'stamp_once_per_day': False,
            'stamp_reset_after_final': False,
            'primary_color': '#0d9488',
            'wallet_style': 'gradient',
            'wallet_secondary_color': '#14b8a6',
            'wallet_show_background': True,
            'reward_expiry_days': 30,
            'updated_at': now,
        }
        try:
            supabase.table('loyalty_programs').insert(demo_program).execute()
        except Exception as exc:
            # Keep the demo usable even if an older schema is missing one of the
            # newer optional fields; save_loyalty_config can populate them later.
            print(f"PARTNER DEMO loyalty seed warning: {exc}")
            fallback = {
                'business_id': business.get('id'),
                'card_type': 'stamp',
                'stamp_goal': 10,
                'reward_name': 'Agyaman Grand Reward',
                'primary_color': '#0d9488',
                'reward_expiry_days': 30,
                'updated_at': now,
            }
            try:
                supabase.table('loyalty_programs').insert(fallback).execute()
            except Exception as fallback_exc:
                print(f"PARTNER DEMO fallback loyalty seed warning: {fallback_exc}")

    return business


def _partner_demo_payload(partner: dict, business: dict) -> dict:
    frontend = (FRONTEND_URL or BASE_URL).rstrip('/')
    customer_count = 0
    latest_customer = None
    try:
        customer_count = (
            supabase.table('customers').select('id', count='exact')
            .eq('business_id', business.get('id')).execute().count or 0
        )
        rows = (
            supabase.table('customers')
            .select('public_id,name,created_at')
            .eq('business_id', business.get('id'))
            .order('created_at', desc=True)
            .limit(1).execute().data or []
        )
        if rows:
            latest_customer = rows[0]
    except Exception:
        pass
    return {
        'name': business.get('name') or 'Agyaman Express',
        'business_slug': business.get('public_id'),
        'join_url': f"{frontend}/join/{business.get('public_id')}",
        'customer_count': customer_count,
        'latest_customer': latest_customer,
        'is_demo': True,
    }



# ---- Region / City Partner Network -----------------------------------------
@app.get("/api/v1/public/network-partner/{partner_code}")
async def public_network_partner(partner_code: str):
    try:
        row = supabase.table('network_partners').select('name,partner_type,region,city,partner_code,is_active').eq('partner_code', partner_code.strip().upper()).eq('is_active', True).maybe_single().execute().data
    except Exception:
        row = None
    if not row: raise HTTPException(status_code=404, detail='Partner code not found')
    return {k:row.get(k) for k in ('name','partner_type','region','city','partner_code')}

@app.get("/api/v1/admin/network-partners")
async def admin_network_partners(_: bool = Depends(require_admin)):
    rows = supabase.table('network_partners').select('*').order('created_at', desc=True).execute().data or []
    out=[]
    for row in rows:
        item=_network_partner_public(row)
        try:
            item['business_count']=supabase.table('businesses').select('id',count='exact').eq('partner_id',row.get('id')).execute().count or 0
            cr=supabase.table('partner_commissions').select('commission_amount,status').eq('partner_id',row.get('id')).execute().data or []
            item['commission_earned']=round(sum(float(x.get('commission_amount') or 0) for x in cr),2)
            item['commission_unpaid']=round(sum(float(x.get('commission_amount') or 0) for x in cr if x.get('status') in ('earned','approved')),2)
        except Exception: pass
        out.append(item)
    return out

@app.post("/api/v1/admin/network-partners")
async def admin_create_network_partner(req: NetworkPartnerCreate, _: bool = Depends(require_admin)):
    code=re.sub(r'[^A-Z0-9_-]','',req.partner_code.strip().upper())
    if len(code)<3: raise HTTPException(status_code=400,detail='Partner code must contain at least 3 letters/numbers')
    if req.partner_type=='city' and not (req.city or '').strip(): raise HTTPException(status_code=400,detail='City is required for a city partner')
    payload=req.model_dump(exclude={'password','partner_code'})
    payload.update({'public_id':'np_'+uuid.uuid4().hex[:20],'partner_code':code,'email':req.email.strip().lower(),'password_hash':hash_password(req.password),'created_at':datetime.utcnow().isoformat(),'updated_at':datetime.utcnow().isoformat()})
    try:
        row = (supabase.table('network_partners').insert(payload).execute().data or [payload])[0]
        try:
            _ensure_partner_demo_business(row)
        except Exception as demo_exc:
            # Partner creation itself succeeds even if demo provisioning has a
            # temporary schema/config issue; the dashboard retries lazily.
            print(f"PARTNER DEMO provision warning: {demo_exc}")
        return _network_partner_public(row)
    except Exception as e:
        raise HTTPException(status_code=400,detail=friendly_db_error(e))

@app.patch("/api/v1/admin/network-partners/{public_id}")
async def admin_update_network_partner(public_id:str, req:NetworkPartnerUpdate, _:bool=Depends(require_admin)):
    data={k:v for k,v in req.model_dump(exclude={'password'}).items() if v is not None}
    if req.password: data['password_hash']=hash_password(req.password)
    if 'partner_code' in data: data['partner_code']=re.sub(r'[^A-Z0-9_-]','',data['partner_code'].strip().upper())
    if 'email' in data: data['email']=data['email'].strip().lower()
    data['updated_at']=datetime.utcnow().isoformat()
    try:
        row=(supabase.table('network_partners').update(data).eq('public_id',public_id).execute().data or [None])[0]
        if not row: raise HTTPException(status_code=404,detail='Partner not found')
        return _network_partner_public(row)
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=400,detail=friendly_db_error(e))

@app.get("/api/v1/admin/network-partners/{public_id}/businesses")
async def admin_network_partner_businesses(public_id:str, _:bool=Depends(require_admin)):
    p=supabase.table('network_partners').select('id').eq('public_id',public_id).maybe_single().execute().data
    if not p: raise HTTPException(status_code=404,detail='Partner not found')
    rows=supabase.table('businesses').select('public_id,name,business_type,address,plan,status,created_at,subscription_expires_at').eq('partner_id',p['id']).order('created_at',desc=True).execute().data or []
    return rows

@app.patch("/api/v1/admin/businesses/{business_public_id}/network-partner/{partner_public_id}")
async def admin_assign_network_partner(business_public_id:str, partner_public_id:str, _:bool=Depends(require_admin)):
    p=supabase.table('network_partners').select('id,partner_code').eq('public_id',partner_public_id).maybe_single().execute().data
    b=safe_get_business(business_public_id)
    if not p or not b: raise HTTPException(status_code=404,detail='Partner or business not found')
    supabase.table('businesses').update({'partner_id':p['id'],'partner_code_at_signup':p['partner_code']}).eq('id',b['id']).execute()
    return {'success':True}

@app.get("/api/v1/partner/me")
async def partner_me(claims:dict=Depends(require_partner)):
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True): raise HTTPException(status_code=403,detail='Partner account inactive')
    return _network_partner_public(p)

@app.get("/api/v1/partner/dashboard")
async def partner_dashboard(claims:dict=Depends(require_partner)):
    pid=claims.get('partner_id')
    p=supabase.table('network_partners').select('*').eq('id',pid).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')

    demo_business = _ensure_partner_demo_business(p)

    # Deliberately limited: no real client customer rows, customer PII, staff PII,
    # balances, fraud detail, or transaction payloads are exposed to partners.
    businesses=(
        supabase.table('businesses')
        .select('public_id,name,business_type,address,plan,status,created_at,subscription_expires_at,setup_kit_status')
        .eq('partner_id',pid)
        .order('created_at',desc=True).execute().data or []
    )
    commissions=(
        supabase.table('partner_commissions')
        .select('public_id,business_id,gross_amount,commission_amount,status,earned_at,paid_at')
        .eq('partner_id',pid).order('earned_at',desc=True).limit(200).execute().data or []
    )
    name_by_id={}
    try:
        for b in supabase.table('businesses').select('id,name').eq('partner_id',pid).execute().data or []:
            name_by_id[b['id']]=b['name']
    except Exception:
        pass
    for c in commissions:
        c['business_name']=name_by_id.get(c.get('business_id'),'Business')
        c.pop('business_id',None)

    earned=sum(float(c.get('commission_amount') or 0) for c in commissions)
    unpaid=sum(float(c.get('commission_amount') or 0) for c in commissions if c.get('status') in ('earned','approved'))

    return {
        'partner':_network_partner_public(p),
        'demo': _partner_demo_payload(p, demo_business),
        'businesses':businesses,
        'commissions':commissions,
        'stats':{
            'businesses':len(businesses),
            'active_businesses':sum(1 for b in businesses if str(b.get('status','')).upper()=='ACTIVE'),
            'pending_businesses':sum(1 for b in businesses if str(b.get('status','')).upper()=='PENDING'),
            'commission_earned':round(earned,2),
            'commission_unpaid':round(unpaid,2),
        }
    }


@app.get("/api/v1/partner/demo-access")
async def partner_demo_access(claims:dict=Depends(require_partner)):
    """Issue a short-lived owner-scoped token for THIS partner's demo only.

    This reuses the existing owner-secured card editor and owner-mode cashier
    instead of creating a second, weaker set of demo transaction endpoints.
    """
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)
    token=create_owner_session_token(business)
    payload=_partner_demo_payload(p,business)
    payload['owner_token']=token
    payload['owner_name']='Agyaman Demo Cashier'
    return payload


@app.get("/api/v1/partner/demo/cashiers")
async def partner_demo_cashiers(claims:dict=Depends(require_partner)):
    """List cashier accounts belonging only to this partner's Agyaman demo."""
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)
    rows=(
        supabase.table('staff')
        .select('public_id,name,email,role,is_active,created_at')
        .eq('business_id',business.get('id'))
        .eq('role','cashier')
        .order('created_at',desc=True)
        .execute().data or []
    )
    return {'business_slug':business.get('public_id'),'business_name':business.get('name'),'cashiers':rows}


@app.post("/api/v1/partner/demo/cashiers")
async def partner_demo_create_cashier(req:PartnerDemoCashierCreate, claims:dict=Depends(require_partner)):
    """Create a normal cashier credential for the partner's Agyaman demo.

    This cashier logs into the SAME /staff/verify-pin flow as a real business,
    so camera scanning, session security, transaction audit and stamp activity
    are demonstrated exactly as they are in production.
    """
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)

    name=(req.name or '').strip()
    email=(req.email or '').strip().lower()
    pin=str(req.pin or '').strip()
    if not name:
        raise HTTPException(status_code=400,detail='Cashier name is required')
    if '@' not in email:
        raise HTTPException(status_code=400,detail='Enter a valid cashier email')
    if not re.fullmatch(r'\d{4,8}', pin):
        raise HTTPException(status_code=400,detail='Cashier PIN must be 4 to 8 digits')

    existing=(
        supabase.table('staff').select('id,public_id')
        .eq('business_id',business.get('id')).ilike('email',email)
        .limit(1).execute().data or []
    )
    if existing:
        raise HTTPException(status_code=409,detail='That cashier email already exists for Agyaman Express')

    payload={
        'business_id':business.get('id'),
        'public_id':generate_public_id(),
        'name':name,
        'email':email,
        'phone':None,
        'role':'cashier',
        'branch_id':None,
        'pin':pin,
        'is_active':True,
        'created_at':datetime.utcnow().isoformat(),
    }
    rows=supabase.table('staff').insert(payload).execute().data or []
    row=(rows or [payload])[0]
    return {
        'success':True,
        'business_slug':business.get('public_id'),
        'cashier':{k:row.get(k) for k in ('public_id','name','email','role','is_active','created_at')},
    }


@app.patch("/api/v1/partner/demo/cashiers/{staff_public_id}")
async def partner_demo_update_cashier(staff_public_id:str, req:PartnerDemoCashierUpdate, claims:dict=Depends(require_partner)):
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)
    rows=(
        supabase.table('staff').select('*')
        .eq('business_id',business.get('id')).eq('public_id',staff_public_id)
        .limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404,detail='Demo cashier not found')
    data={k:v for k,v in req.model_dump(exclude_unset=True).items() if v is not None}
    if 'email' in data:
        data['email']=str(data['email']).strip().lower()
        if '@' not in data['email']:
            raise HTTPException(status_code=400,detail='Enter a valid cashier email')
    if 'pin' in data:
        data['pin']=str(data['pin']).strip()
        if not re.fullmatch(r'\d{4,8}', data['pin']):
            raise HTTPException(status_code=400,detail='Cashier PIN must be 4 to 8 digits')
    if 'name' in data:
        data['name']=str(data['name']).strip()
    data['role']='cashier'
    updated=supabase.table('staff').update(data).eq('id',rows[0]['id']).execute().data or []
    row=(updated or [{**rows[0],**data}])[0]
    return {'success':True,'cashier':{k:row.get(k) for k in ('public_id','name','email','role','is_active','created_at')}}


@app.delete("/api/v1/partner/demo/cashiers/{staff_public_id}")
async def partner_demo_delete_cashier(staff_public_id:str, claims:dict=Depends(require_partner)):
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)
    rows=(
        supabase.table('staff').select('id')
        .eq('business_id',business.get('id')).eq('public_id',staff_public_id)
        .limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404,detail='Demo cashier not found')
    supabase.table('staff').delete().eq('id',rows[0]['id']).execute()
    return {'success':True}


@app.get("/api/v1/partner/demo/customers")
async def partner_demo_customers(claims:dict=Depends(require_partner)):
    """List only customers belonging to this partner's isolated Agyaman demo."""
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)
    rows=(
        supabase.table('customers')
        .select('public_id,name,stamp_count,points_balance,vip_points,multipass_sessions_remaining,membership_status,created_at,updated_at')
        .eq('business_id',business.get('id'))
        .order('created_at',desc=True)
        .limit(100).execute().data or []
    )
    return {'business_slug':business.get('public_id'),'customers':rows}


@app.post("/api/v1/partner/demo/notify-latest")
async def partner_demo_notify_latest(claims:dict=Depends(require_partner)):
    """Send a real Wallet demo notification to the latest Agyaman demo customer."""
    p=supabase.table('network_partners').select('*').eq('id',claims.get('partner_id')).maybe_single().execute().data
    if not p or not p.get('is_active',True):
        raise HTTPException(status_code=403,detail='Partner account inactive')
    business=_ensure_partner_demo_business(p)
    rows=(
        supabase.table('customers').select('*')
        .eq('business_id',business.get('id'))
        .order('created_at',desc=True).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=404,detail='No demo customer yet. Scan the Demo Join QR and add the card to Wallet first.')
    customer=rows[0]
    program=safe_get_loyalty_program(business.get('id')) or {}

    stamp = int(customer.get('stamp_count') or 0)
    next_target = int(program.get('stamp_goal') or 10)
    body = (
        f"Thanks for trying LoyaltyTree! Your Agyaman Express card is live. "
        f"You currently have {stamp} stamp{'s' if stamp != 1 else ''}. "
        f"Keep collecting toward {next_target}."
    )
    now=datetime.utcnow()
    msg_id=f"partner-demo-{customer.get('id')}-{int(now.timestamp())}"

    # Change the latest announcement value as well as pushing Google. PassKit
    # uses the announcement field's changed value when the device refetches,
    # which makes the Apple demo visible instead of sending an empty refresh.
    try:
        supabase.table('announcements').update({'is_active':False,'updated_at':now.isoformat()}).eq('business_id',business.get('id')).eq('is_active',True).execute()
        supabase.table('announcements').insert({
            'business_id': business.get('id'),
            'title': 'Agyaman Express Demo 🌱',
            'message': body,
            'type': 'info',
            'is_active': True,
            'created_at': now.isoformat(),
            'updated_at': now.isoformat(),
        }).execute()
    except Exception as exc:
        print(f"PARTNER DEMO announcement warning: {exc}")

    google_result = sync_wallet_object(
        customer, business, program,
        notify_header='Agyaman Express Demo 🌱',
        notify_body=body,
        notify_message_id=msg_id,
    )
    apple_result = sync_apple_wallet_pass(customer)

    return {
        'success': True,
        'customer': {'public_id':customer.get('public_id'),'name':customer.get('name')},
        'message': body,
        'google': google_result,
        'apple': apple_result,
    }


@app.get("/api/v1/public/partners")
async def public_list_partners(response: Response):
    # Partner logos are public homepage content. Prevent browser/CDN caching so
    # additions and replacement logos appear as soon as the admin saves them.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"

    fields = (
        "public_id,name,logo_url,sector,plan_segment,website_url,"
        "sort_order,is_active,updated_at"
    )
    try:
        res = (
            supabase.table("platform_partners")
            .select(fields)
            .eq("is_active", True)
            .order("plan_segment")
            .order("sort_order")
            .order("name")
            .execute()
        )
        return res.data or []
    except Exception as ordered_error:
        # Some older PostgREST/Supabase deployments reject chained ordering or
        # briefly retain an old schema cache. Retry with a simpler query rather
        # than silently making the whole homepage partner section disappear.
        print(f"PUBLIC PARTNERS ordered query failed: {ordered_error}")
        try:
            fallback = (
                supabase.table("platform_partners")
                .select(fields)
                .eq("is_active", True)
                .execute()
            )
            rows = fallback.data or []
            return sorted(
                rows,
                key=lambda row: (
                    str(row.get("plan_segment") or "partners"),
                    int(row.get("sort_order") or 0),
                    str(row.get("name") or "").lower(),
                ),
            )
        except Exception as fallback_error:
            print(f"PUBLIC PARTNERS fallback query failed: {fallback_error}")
            raise HTTPException(
                status_code=500,
                detail=f"Could not load homepage partners: {friendly_db_error(fallback_error)}",
            )

@app.get("/api/v1/admin/partners")
async def admin_list_partners(_: bool = Depends(require_admin)):
    try:
        res = supabase.table("platform_partners").select("*").order(
            "plan_segment"
        ).order("sort_order").order("name").execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/admin/partners")
async def admin_create_partner(partner: PartnerCreate, _: bool = Depends(require_admin)):
    payload = partner.model_dump()
    payload.update({
        "public_id": str(uuid.uuid4()),
        "name": payload["name"].strip(),
        "sector": (payload.get("sector") or "").strip() or None,
        "website_url": (payload.get("website_url") or "").strip() or None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    })
    try:
        res = supabase.table("platform_partners").insert(payload).execute()
        return (res.data or [payload])[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.patch("/api/v1/admin/partners/{partner_public_id}")
async def admin_update_partner(partner_public_id: str, partner: PartnerUpdate, _: bool = Depends(require_admin)):
    payload = {k: v for k, v in partner.model_dump().items() if v is not None}
    if "name" in payload:
        payload["name"] = payload["name"].strip()
    if "sector" in payload:
        payload["sector"] = (payload.get("sector") or "").strip() or None
    if "website_url" in payload:
        payload["website_url"] = (payload.get("website_url") or "").strip() or None
    payload["updated_at"] = datetime.utcnow().isoformat()
    try:
        res = supabase.table("platform_partners").update(payload).eq("public_id", partner_public_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Partner not found")
        return res.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.delete("/api/v1/admin/partners/{partner_public_id}")
async def admin_delete_partner(partner_public_id: str, _: bool = Depends(require_admin)):
    try:
        supabase.table("platform_partners").delete().eq("public_id", partner_public_id).execute()
        return {"message": "Partner removed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/admin/partners/cloudinary-signature")
async def admin_partner_logo_signature(_: bool = Depends(require_admin)):
    if not CLOUDINARY_API_KEY or not CLOUDINARY_API_SECRET:
        raise HTTPException(status_code=503, detail="Image uploads are not configured")
    timestamp = int(time.time())
    folder = "loyaltytree/platform-partners"
    params = {"folder": folder, "timestamp": timestamp, "upload_preset": CLOUDINARY_UPLOAD_PRESET}
    to_sign = "&".join(f"{key}={params[key]}" for key in sorted(params))
    signature = hashlib.sha1((to_sign + CLOUDINARY_API_SECRET).encode("utf-8")).hexdigest()
    return {
        "timestamp": timestamp, "signature": signature, "api_key": CLOUDINARY_API_KEY,
        "cloud_name": CLOUDINARY_CLOUD_NAME, "upload_preset": CLOUDINARY_UPLOAD_PRESET,
        "folder": folder,
    }

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
    subscription_price = get_price_for_plan(plan, branch_count)
    kit_due = bool(business.get('setup_kit_requested')) and not bool(business.get('setup_kit_paid'))
    setup_kit_price = 150 if kit_due else 0
    price = subscription_price + setup_kit_price
    plan_label = SUBSCRIPTION_PLANS.get(plan, {}).get('label', plan)
    description = f"LoyaltyTree {plan_label} subscription - {business.get('name', '')}"
    if kit_due:
        description += " + Sintra Board QR / PR Kit"

    checkout = create_qrph_checkout(
        amount_php=price,
        description=description,
        billing_name=business.get('name') or 'Business Owner',
        billing_email=business.get('email') or '',
        billing_phone=business.get('phone'),
        metadata={
            'business_public_id': public_id,
            'plan': plan,
            'setup_kit_included': 'true' if kit_due else 'false',
        },
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
            if str(metadata.get('setup_kit_included', '')).lower() == 'true':
                business_update.update({
                    'setup_kit_paid': True,
                    'setup_kit_status': 'paid',
                })
                try:
                    supabase.table('setup_kit_orders').update({
                        'payment_status': 'paid',
                        'fulfillment_status': 'paid',
                        'paid_at': now.isoformat(),
                        'updated_at': now.isoformat(),
                    }).eq('business_id', business.get('id')).neq('fulfillment_status', 'cancelled').execute()
                except Exception as e:
                    print(f"WEBHOOK setup kit order update error: {e}")
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

            # Partner commission ledger: idempotent per PayMongo payment intent.
            # Partners never receive customer data; this ledger only references
            # the business and subscription payment.
            if business.get('partner_id') and payment_intent_id and not business.get('is_demo'):
                try:
                    partner = supabase.table('network_partners').select('*').eq('id', business.get('partner_id')).maybe_single().execute().data
                    if partner and partner.get('is_active', True):
                        amount_centavos = resource_attrs.get('amount') or 0
                        gross_php = float(amount_centavos) / 100.0
                        if partner.get('commission_type') == 'fixed':
                            commission_php = float(partner.get('commission_value') or 0)
                        else:
                            commission_php = gross_php * float(partner.get('commission_value') or 0) / 100.0
                        supabase.table('partner_commissions').upsert({
                            'public_id': 'pc_' + hashlib.sha256(str(payment_intent_id).encode()).hexdigest()[:24],
                            'partner_id': partner.get('id'), 'business_id': business.get('id'),
                            'paymongo_payment_intent_id': payment_intent_id,
                            'gross_amount': round(gross_php,2), 'commission_amount': round(commission_php,2),
                            'status': 'earned', 'earned_at': now.isoformat(),
                        }, on_conflict='paymongo_payment_intent_id').execute()
                except Exception as e:
                    print(f"PARTNER COMMISSION ledger error: {e}")

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
async def get_customer_api(public_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    customer = safe_get_customer(public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = safe_get_business_by_id(customer.get('business_id'))
    program = safe_get_loyalty_program(customer.get('business_id')) if business else None
    current_card_type = (
        program.get('card_type')
        if program and program.get('card_type') in ('stamp', 'points', 'membership', 'vip', 'multipass')
        else None
    )

    if program and program.get('card_type') == 'membership':
        customer['membership_effective_status'] = membership_effective_status(customer)
        membership_summary = get_membership_summary(customer.get('business_id'), customer.get('id'))
        customer['membership_visit_count'] = membership_summary.get('total_visits', 0)
        customer['membership_last_visit_at'] = membership_summary.get('last_service_date')
    if program and program.get('card_type') == 'vip':
        customer['vip_tier'] = get_vip_tier(customer, program)
        customer['vip_next_tier'] = get_next_vip_tier(customer, program)

    return {
        "current_card_type": current_card_type,
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

    program = safe_get_loyalty_program(business.get('id'))
    if program and program.get('card_type') == 'membership':
        for c in customers:
            c['membership_effective_status'] = membership_effective_status(c)
            membership_summary = get_membership_summary(business.get('id'), c.get('id'))
            c['membership_visit_count'] = membership_summary.get('total_visits', 0)
            c['membership_last_visit_at'] = membership_summary.get('last_service_date')
    if program and program.get('card_type') == 'vip':
        for c in customers:
            c['vip_tier'] = get_vip_tier(c, program)
            c['vip_next_tier'] = get_next_vip_tier(c, program)

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
    for date_field in ('birthday', 'last_order_date', 'membership_start_date', 'membership_expires_at'):
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
        update_data['reward_unlocked'] = bool(
            get_available_stamp_rewards({**customer, 'stamp_count': update_data['stamp_count']}, program)
        )

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
                updated_customer = res.data[0] if res.data else {**customer, **retry_data}
                update_data = retry_data
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

    # Owner-dashboard stamp edits use this generic customer PATCH endpoint.
    # Keep those manual corrections in the same Stamp Activity audit trail as
    # /stamp/adjust so removals (and manual additions) never disappear from history.
    if 'stamp_count' in update_data:
        old_count = int(customer.get('stamp_count') or 0)
        new_count = int(updated_customer.get('stamp_count') or 0)
        delta = new_count - old_count
        if delta != 0:
            try:
                supabase.table('stamp_adjustments').insert({
                    'business_id': business.get('id'),
                    'customer_id': customer.get('id'),
                    'staff_id': None,
                    'branch_id': None,
                    'delta': delta,
                    'old_count': old_count,
                    'new_count': new_count,
                    'reason': 'Owner correction',
                    'created_at': datetime.utcnow().isoformat(),
                }).execute()
            except Exception as e:
                # Balance correction is already persisted; expose audit failures in
                # Render logs without rolling back the owner's successful edit.
                print(f"STAMP ADJUSTMENT audit warning (owner customer edit): {e}")

    if 'points_balance' in update_data:
        old_points = int(customer.get('points_balance') or 0)
        new_points = int(updated_customer.get('points_balance') or 0)
        points_delta = new_points - old_points
        if points_delta != 0:
            audit_row = start_transaction_audit(
                business_id=business.get('id'),
                customer_id=customer.get('id'),
                staff_id=None,
                branch_id=None,
                actor_type='owner',
                action='points_adjust',
                delta=points_delta,
                balance_before=old_points,
                reason='Owner manual points correction',
                metadata={
                    'card_type': 'points',
                    'source': 'owner_customer_edit',
                },
            )
            complete_transaction_audit(
                audit_row,
                balance_after=new_points,
                response_json={
                    'points_balance': new_points,
                    'points_delta': points_delta,
                    'source': 'owner_customer_edit',
                },
            )

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
async def get_staff(public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("staff").select("*").eq("business_id", business.get("id")).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/staff/stamp-counts")
async def get_staff_stamp_counts(public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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
async def get_branch_stamp_counts(public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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
async def list_branches(public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    try:
        res = supabase.table("branches").select("*").eq("business_id", business.get("id")).order("created_at").execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/business/{public_id}/branches")
async def create_branch(public_id: str, branch: BranchCreate, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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
async def update_branch(public_id: str, branch_public_id: str, update: BranchUpdate, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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
async def update_staff(public_id: str, staff_public_id: str, update: StaffUpdate, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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
async def delete_staff(public_id: str, staff_public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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
    'X of Y active announcements' without duplicating the plan
    matrix on the frontend."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    plan = business.get('plan', 'starter')
    features = get_plan_features(plan)

    limit = get_effective_announcement_limit(business)
    try:
        active_announcements = count_active_announcements(business.get('id'))
    except HTTPException:
        active_announcements = 0

    return {
        "plan": plan,
        "plan_label": SUBSCRIPTION_PLANS.get(plan, {}).get("label", plan),
        "features": features,
        "usage": {
            "active_announcements": active_announcements,
            "announcements_limit": limit,
            # Backward-compatible alias for older frontends; semantics are now active slots, not monthly posts.
            "announcements_used_this_month": active_announcements,
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
    """Parse either our Supabase ISO timestamps or an RFC HTTP date.

    Apple Wallet sends If-Modified-Since as an HTTP date (for example
    'Thu, 13 Aug 2026 03:40:12 GMT'), while our database stores ISO-8601.
    Normalize both to naive UTC datetimes so the existing comparisons in
    this file keep working consistently.
    """
    if not value:
        return None
    raw = str(value).strip()
    try:
        parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        pass
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _http_date(value=None) -> str:
    """Return an RFC 7231/IMF-fixdate suitable for Last-Modified."""
    parsed = _parse_ts(value) if value else datetime.utcnow()
    if parsed is None:
        parsed = datetime.utcnow()
    aware = parsed.replace(tzinfo=timezone.utc)
    return format_datetime(aware, usegmt=True)

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
    # Age breakdown - all-time distribution. Prefer the explicitly stored
    # customers.age value; when it is missing, derive age from birthday so
    # older customer records can still be included. Unknown/invalid values
    # stay visible instead of being silently dropped.
    age_counts = {
        "under_18": 0,
        "18_24": 0,
        "25_34": 0,
        "35_44": 0,
        "45_54": 0,
        "55_64": 0,
        "65_plus": 0,
        "unknown": 0,
    }

    def _customer_age(customer: dict) -> Optional[int]:
        raw_age = customer.get("age")
        try:
            if raw_age is not None and str(raw_age).strip() != "":
                age_value = int(raw_age)
                return age_value if 0 <= age_value <= 120 else None
        except (TypeError, ValueError):
            pass

        birthday = customer.get("birthday")
        if not birthday:
            return None
        try:
            birthday_date = datetime.fromisoformat(str(birthday).replace("Z", "+00:00")).date()
        except (TypeError, ValueError):
            try:
                birthday_date = datetime.strptime(str(birthday)[:10], "%Y-%m-%d").date()
            except (TypeError, ValueError):
                return None

        today = now.date()
        derived_age = today.year - birthday_date.year - (
            (today.month, today.day) < (birthday_date.month, birthday_date.day)
        )
        return derived_age if 0 <= derived_age <= 120 else None

    for c in customers:
        age_value = _customer_age(c)
        if age_value is None:
            age_counts["unknown"] += 1
        elif age_value < 18:
            age_counts["under_18"] += 1
        elif age_value <= 24:
            age_counts["18_24"] += 1
        elif age_value <= 34:
            age_counts["25_34"] += 1
        elif age_value <= 44:
            age_counts["35_44"] += 1
        elif age_value <= 54:
            age_counts["45_54"] += 1
        elif age_value <= 64:
            age_counts["55_64"] += 1
        else:
            age_counts["65_plus"] += 1

    demographics_block = {
        "gender": gender_counts,
        "age": age_counts,
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
async def get_loyalty_config(public_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))
    if not program:
        return {
            "card_type": "stamp",
            "stamp_goal": 8,
            "reward_name": "Free Service",
            "stamp_rewards": [{"id": "legacy-final", "stamps": 8, "reward_name": "Free Service"}],
            "stamp_once_per_day": False,
            "stamp_reset_after_final": True,
            "primary_color": "#3b82f6",
            "reward_expiry_days": 30,
            "program_logo_url": None,
            "hero_image_url": None,
            "card_name": None,
            "wallet_style": "modern",
            "wallet_secondary_color": None,
            "wallet_show_background": True,
            "description": None,
            "google_wallet_class_id": None,
            "points_per_amount": 10,
            "points_amount_pesos": 100,
            "points_prizes": [],
            "membership_services": [],
            "membership_duration_days": 30,
            "membership_price": 0,
            "membership_terms": None,
            "membership_quick_checkin": False,
            "vip_points_per_amount": 10,
            "vip_amount_pesos": 100,
            "vip_tiers": [],
            # No loyalty_programs row saved yet - this is placeholder defaults,
            # not a real choice the business made. is_configured lets the
            # editor tell "brand new business, nothing chosen yet" apart from
            # "already picked a card type" (see LoyaltyCardCustomizer's
            # picker-skip logic) without guessing off field values that could
            # legitimately be defaults either way.
            "is_configured": False,
        }
    return {**program, "is_configured": True}


@app.get("/api/v1/business/{public_id}/cashier-program")
async def get_cashier_program(public_id: str, response: Response):
    """Cashier-facing alias of loyalty-config.

    All card types use the same source that already works for Points:
    loyalty_programs.card_type plus that row's settings.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get("id"))
    if not program:
        raise HTTPException(
            status_code=404,
            detail="No loyalty program is saved for this business. Open Edit Card and save the card first.",
        )

    card_type = program.get("card_type")
    allowed = ("stamp", "points", "membership", "vip", "multipass")
    if card_type not in allowed:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid saved card type: {card_type or 'none'}",
        )

    return {
        **program,
        "card_type": card_type,
    }

@app.post("/api/v1/business/{public_id}/loyalty-config")
async def save_loyalty_config(public_id: str, config: LoyaltyConfig, background_tasks: BackgroundTasks, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    data = {
        'business_id': business.get('id'),
        'card_type': config.card_type,
        'stamp_goal': config.stamp_goal,
        'reward_name': config.reward_name,
        'stamp_once_per_day': bool(config.stamp_once_per_day),
        'stamp_reset_after_final': bool(config.stamp_reset_after_final),
        'primary_color': config.primary_color,
        'wallet_style': config.wallet_style,
        'wallet_secondary_color': config.wallet_secondary_color,
        'wallet_show_background': bool(config.wallet_show_background),
        'reward_expiry_days': config.reward_expiry_days,
        'updated_at': datetime.utcnow().isoformat(),
    }

    if config.card_type == 'stamp':
        milestones = []
        seen = set()
        for item in (config.stamp_rewards or []):
            threshold = int(item.stamps)
            if threshold in seen:
                raise HTTPException(status_code=400, detail=f"Only one stamp reward can use the {threshold}-stamp milestone")
            seen.add(threshold)
            milestones.append({
                'id': item.id or uuid.uuid4().hex[:12],
                'stamps': threshold,
                'reward_name': item.reward_name.strip(),
            })
        if not milestones:
            milestones = [{
                'id': 'legacy-final',
                'stamps': int(config.stamp_goal),
                'reward_name': (config.reward_name or 'Free Service').strip(),
            }]
        milestones.sort(key=lambda x: x['stamps'])
        data['stamp_rewards'] = milestones
        # Keep legacy fields synchronized with the final milestone for Wallet/old clients.
        data['stamp_goal'] = milestones[-1]['stamps']
        data['reward_name'] = milestones[-1]['reward_name']

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
    if config.card_type == 'vip':
        data['vip_points_per_amount'] = config.vip_points_per_amount or 0
        data['vip_amount_pesos'] = config.vip_amount_pesos or 100
        tiers=[]
        last=-1
        for i,t in enumerate(config.vip_tiers or []):
            threshold=max(0,int(t.get('threshold') or 0))
            if threshold < last:
                raise HTTPException(status_code=400, detail='VIP tier thresholds must increase in order')
            last=threshold
            tiers.append({
                'id': str(t.get('id') or uuid.uuid4().hex[:12]),
                'name': str(t.get('name') or f'Tier {i+1}').strip(),
                'threshold': threshold,
                'color': str(t.get('color') or '#64748b'),
                'discount_percent': max(0,min(100,float(t.get('discount_percent') or 0))),
                'benefits': [str(x).strip() for x in (t.get('benefits') or []) if str(x).strip()],
                'active': t.get('active') is not False,
            })
        data['vip_tiers'] = tiers
    if config.card_type == 'membership':
        if config.membership_services is not None:
            data['membership_services'] = [s.strip() for s in config.membership_services if s and s.strip()]
        data['membership_duration_days'] = config.membership_duration_days or 30
        data['membership_price'] = config.membership_price or 0
        data['membership_terms'] = (config.membership_terms or '').strip() or None
        data['membership_quick_checkin'] = bool(config.membership_quick_checkin)
    if config.google_review_url is not None:
        features = get_plan_features(business.get('plan'))
        if not features.get('google_review_prompt'):
            raise HTTPException(
                status_code=403,
                detail="The Google review prompt is available on the Growth and Pro plans. Upgrade to set a review link."
            )
        data['google_review_url'] = config.google_review_url

    try:
        existing = (
            supabase.table("loyalty_programs")
            .select("id")
            .eq("business_id", business.get("id"))
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .order("id", desc=True)
            .limit(1)
            .execute()
        )
        rows = existing.data or []

        if rows:
            # Older deployments may have duplicate loyalty_programs rows.
            # Synchronize all of them instead of deleting records, so every
            # legacy lookup returns the same selected card type.
            supabase.table("loyalty_programs").update(data).eq(
                "business_id", business.get("id")
            ).execute()
        else:
            data['created_at'] = datetime.utcnow().isoformat()
            supabase.table("loyalty_programs").insert(data).execute()

        persisted = safe_get_loyalty_program(business.get("id"))
        persisted_type = (persisted or {}).get("card_type")

        if persisted_type != config.card_type:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Card type did not persist. Requested {config.card_type}, "
                    f"but database returned {persisted_type or 'none'}."
                ),
            )

        # Apple Wallet does NOT require the owner to republish a class. Once the
        # saved configuration is durable, wake only this business's installed
        # Apple passes in the background. Google keeps its explicit Publish flow,
        # avoiding the old duplicate Google/Apple fan-out problem.
        background_tasks.add_task(
            refresh_business_apple_wallet_passes,
            business.get("id"),
            "loyalty_config_saved",
        )

        return {
            "message": "Configuration saved",
            "card_type": persisted_type,
            "program": persisted,
            "apple_wallet_refresh": "queued",
        }
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

@app.post("/api/v1/signup/cloudinary-signature")
async def get_signup_cloudinary_signature():
    """Short-lived signed Cloudinary upload parameters for a business logo
    before the business account exists.

    The signup page cannot use the normal business-scoped signature endpoint
    because there is no public_id until /register succeeds. The browser still
    never receives CLOUDINARY_API_SECRET; it only receives a timestamped
    signature for this one signed upload preset and a server-selected folder.
    """
    if not CLOUDINARY_API_KEY or not CLOUDINARY_API_SECRET:
        raise HTTPException(status_code=503, detail="Cloudinary is not configured on this server")

    timestamp = int(datetime.utcnow().timestamp())
    # Use a random, server-generated folder so a pre-registration upload is
    # isolated and the client cannot choose/overwrite another business folder.
    upload_token = uuid.uuid4().hex
    folder = f'signup-logos/{upload_token}'
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
    elif purpose == 'reservation':
        folder = f'reservation-receipts/{public_id}'
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
        'engine_number': vehicle.engine_number,
        'chassis_number': vehicle.chassis_number,
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

            # A verified reservation payment reserves the selected unit.
            if (
                newly_decided
                and update_data.get("status") == "approved"
                and application.get("role") == "reservation"
                and application.get("vehicle_id")
            ):
                supabase.table("vehicles").update({
                    "status": "reserved",
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", application.get("vehicle_id")).eq("business_id", business.get("id")).execute()
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

@app.get("/api/v1/business/{public_id}/reservation-settings")
async def get_reservation_settings(public_id: str):
    """Public read used by the showroom reservation popup."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return {
        "reservation_amount": business.get("showroom_reservation_amount"),
        "payment_note": business.get("showroom_reservation_payment_note") or "",
    }

@app.post("/api/v1/business/{public_id}/reservation-settings")
async def save_reservation_settings(public_id: str, settings: CLReservationSettingsUpdate):
    """Owner-managed payment instructions shown in the reservation popup."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    update_data = {
        "showroom_reservation_amount": settings.reservation_amount,
        "showroom_reservation_payment_note": settings.payment_note,
    }
    try:
        supabase.table("businesses").update(update_data).eq("id", business.get("id")).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    return {
        "reservation_amount": settings.reservation_amount,
        "payment_note": settings.payment_note or "",
    }

@app.post("/api/v1/business/{public_id}/cl-reservation")
async def create_cl_reservation(public_id: str, reservation: CLReservationCreate):
    """Public reservation-payment submission from the showroom."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    vehicle = safe_get_vehicle(reservation.vehicle_public_id)
    if not vehicle or vehicle.get("business_id") != business.get("id"):
        raise HTTPException(status_code=404, detail="Vehicle not found for this business")
    if vehicle.get("status") not in ("available", "reserved"):
        raise HTTPException(status_code=400, detail="This vehicle is no longer available for reservation")

    vehicle_label = " ".join(
        str(x).strip() for x in [vehicle.get("year"), vehicle.get("make"), vehicle.get("model")] if x
    )
    application_data = {
        "business_id": business.get("id"),
        "public_id": generate_public_id(),
        "role": "reservation",
        "name": reservation.name.strip(),
        "phone": reservation.contact_number.strip(),
        "address": reservation.address.strip(),
        "reservation_contact_number": reservation.contact_number.strip(),
        "reservation_address": reservation.address.strip(),
        "status": "pending",
        "vehicle_id": vehicle.get("id"),
        "vehicle_label": vehicle_label,
        "reservation_receipt_url": reservation.receipt_url,
        "reservation_amount": business.get("showroom_reservation_amount"),
        "reservation_payment_note": business.get("showroom_reservation_payment_note"),
    }
    try:
        res = supabase.table("cl_applications").insert(application_data).execute()
        return res.data[0] if res.data else application_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))


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

    is_active = ann.is_active if ann.is_active is not None else True
    not_expired = not ann.end_date or str(ann.end_date)[:10] >= datetime.utcnow().date().isoformat()
    limit = get_effective_announcement_limit(business)
    if is_active and not_expired and limit is not None:
        used = count_active_announcements(business.get('id'))
        if used >= limit:
            plan_label = SUBSCRIPTION_PLANS.get(business.get('plan', 'starter'), {}).get('label', 'your plan')
            raise HTTPException(
                status_code=403,
                detail=f"{plan_label} allows up to {limit} active announcements at a time. Deactivate or delete one before activating another, or upgrade your plan."
            )
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

    # If this edit will leave the announcement active, enforce the active-slot cap.
    resulting_active = update_data.get('is_active', existing.data.get('is_active', True))
    resulting_end_date = update_data.get('end_date', existing.data.get('end_date'))
    not_expired = not resulting_end_date or str(resulting_end_date)[:10] >= datetime.utcnow().date().isoformat()
    limit = get_effective_announcement_limit(business)
    if resulting_active and not_expired and limit is not None:
        used_elsewhere = count_active_announcements(business.get('id'), exclude_id=announcement_id)
        if used_elsewhere >= limit:
            plan_label = SUBSCRIPTION_PLANS.get(business.get('plan', 'starter'), {}).get('label', 'your plan')
            raise HTTPException(
                status_code=403,
                detail=f"{plan_label} allows up to {limit} active announcements at a time. Deactivate or delete one before activating this announcement."
            )

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
async def invite_staff(public_id: str, invite: StaffInvite, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
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

    join_base = (FRONTEND_URL or BASE_URL).rstrip('/')
    join_url = f'{join_base}/join/{public_id}'
    svg = generate_qr_svg(join_url)
    return JSONResponse({
        "svg": svg,
        "join_url": join_url,
        "business_name": business.get("name", ""),
    })

@app.post("/api/v1/business/{public_id}/nfc/resolve")
async def resolve_nfc_member(public_id: str, req: NfcResolveRequest, authorization: str = Header(default="")):
    """Resolve a trial NFC membership tap after cashier authentication.

    Safety rules for the first rollout:
      * membership cards only
      * the LoyaltyTree super admin must explicitly enable the trial
      * a real cashier session must exist before the member is revealed
      * resolving a tap NEVER records a visit by itself

    The cashier must still press the membership activity/check-in action.
    """
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'membership':
        raise HTTPException(status_code=403, detail="NFC trial is available only for membership cards")
    if not bool(program.get('nfc_trial_enabled')):
        raise HTTPException(status_code=403, detail="NFC trial is not enabled for this membership card")

    session_claims = get_staff_session_claims(public_id, authorization)
    if not session_claims or not session_claims.get('staff_id'):
        raise HTTPException(status_code=401, detail="Cashier login required before NFC tap")

    customer_public_id = verify_contactless_member_token(req.token)
    if not customer_public_id:
        raise HTTPException(status_code=400, detail="Invalid NFC member token")

    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    source = req.source or 'terminal'
    response_payload = {
        "success": True,
        "customer_public_id": customer.get('public_id'),
        "customer_name": customer.get('name') or 'Member',
        "source": source,
        "nfc_trial": True,
        "next_action": "confirm_membership_activity",
    }

    # Audit identification separately from the eventual membership_visit. This
    # lets us investigate trial taps without counting a tap as a real visit.
    audit_row = start_transaction_audit(
        business_id=business.get('id'),
        customer_id=customer.get('id'),
        staff_id=session_claims.get('staff_id'),
        branch_id=session_claims.get('branch_id'),
        actor_type='staff',
        action='nfc_member_identified',
        metadata={'card_type': 'membership', 'source': source, 'trial': True},
    )
    complete_transaction_audit(
        audit_row,
        response_json={'customer_public_id': customer.get('public_id'), 'source': source},
        metadata={'card_type': 'membership', 'source': source, 'trial': True},
    )
    return response_payload



def get_stamp_rewards(program: Optional[dict]) -> List[dict]:
    """Normalized ascending stamp milestones with legacy single-goal fallback."""
    raw = (program or {}).get('stamp_rewards')
    rewards = []
    if isinstance(raw, list):
        for i, item in enumerate(raw):
            try:
                stamps = int((item or {}).get('stamps') or 0)
                name = str((item or {}).get('reward_name') or '').strip()
            except Exception:
                continue
            if stamps > 0 and name:
                rewards.append({
                    'id': str((item or {}).get('id') or f'milestone-{stamps}-{i}'),
                    'stamps': stamps,
                    'reward_name': name[:100],
                })
    if not rewards:
        goal = int((program or {}).get('stamp_goal') or 8)
        rewards = [{
            'id': 'legacy-final',
            'stamps': goal,
            'reward_name': str((program or {}).get('reward_name') or 'Free Service')[:100],
        }]
    # one reward per threshold, ascending
    dedup = {}
    for r in rewards:
        dedup[r['stamps']] = r
    return [dedup[k] for k in sorted(dedup)]

def get_stamp_claims(customer_id: int) -> List[dict]:
    try:
        res = (supabase.table('stamp_reward_claims').select('*')
               .eq('customer_id', customer_id).execute())
        return res.data or []
    except Exception as e:
        print(f"STAMP CLAIM lookup warning: {e}")
        return []

def get_available_stamp_rewards(customer: dict, program: Optional[dict]) -> List[dict]:
    count = int(customer.get('stamp_count') or 0)
    claimed_ids = {str(x.get('milestone_id')) for x in get_stamp_claims(customer.get('id'))}
    return [r for r in get_stamp_rewards(program)
            if count >= int(r['stamps']) and str(r['id']) not in claimed_ids]

def stamped_today(business_id: int, customer_id: int) -> bool:
    """Uses stamp_events so the once-a-day rule is server enforced across cashiers/devices."""
    today = datetime.utcnow().date()
    start = datetime.combine(today, datetime.min.time()).isoformat()
    end = datetime.combine(today + timedelta(days=1), datetime.min.time()).isoformat()
    try:
        res = (supabase.table('stamp_events').select('id')
               .eq('business_id', business_id).eq('customer_id', customer_id)
               .gte('created_at', start).lt('created_at', end).limit(1).execute())
        return bool(res.data)
    except Exception as e:
        print(f"STAMP DAILY LIMIT lookup error: {e}")
        # Fail closed when the business explicitly enabled the rule.
        raise HTTPException(status_code=503, detail="Could not verify today's stamp limit. Please try again.")



def _audit_actor(staff_id=None, as_owner=False):
    if staff_id:
        return 'staff'
    if as_owner:
        return 'owner'
    return 'system'


def get_completed_idempotent_response(business_id, idempotency_key):
    """Return a previously completed response for a safe client retry."""
    key = (idempotency_key or '').strip()
    if not key:
        return None
    try:
        res = (supabase.table('transaction_audit')
               .select('status,response_json,transaction_id')
               .eq('business_id', business_id)
               .eq('idempotency_key', key)
               .maybe_single()
               .execute())
        row = res.data
        if not row:
            return None
        if row.get('status') == 'success' and row.get('response_json') is not None:
            payload = dict(row.get('response_json') or {})
            payload['duplicate_prevented'] = True
            payload['transaction_id'] = str(row.get('transaction_id') or payload.get('transaction_id') or '')
            return payload
        if row.get('status') == 'processing':
            raise HTTPException(status_code=409, detail="This transaction is already being processed. Please wait.")
    except HTTPException:
        raise
    except Exception as e:
        # During rollout, do not break loyalty transactions if the migration
        # has not been run yet; make the missing audit layer obvious in logs.
        print(f"TRANSACTION AUDIT idempotency lookup warning: {e}")
    return None


def start_transaction_audit(*, business_id, customer_id=None, staff_id=None, branch_id=None,
                            actor_type='system', action, idempotency_key=None,
                            delta=None, balance_before=None, reason=None, metadata=None):
    """Reserve an idempotency key and create the immutable transaction envelope."""
    key = (idempotency_key or '').strip() or None
    row = {
        'business_id': business_id,
        'customer_id': customer_id,
        'staff_id': staff_id,
        'branch_id': branch_id,
        'actor_type': actor_type,
        'action': action,
        'status': 'processing',
        'idempotency_key': key,
        'delta': delta,
        'balance_before': balance_before,
        'reason': reason,
        'metadata': metadata or {},
    }
    try:
        res = supabase.table('transaction_audit').insert(row).execute()
        return (res.data or [None])[0]
    except Exception as e:
        # Unique-key collision = retry. Return the completed original if possible.
        if key:
            previous = get_completed_idempotent_response(business_id, key)
            if previous is not None:
                return {'_duplicate_response': previous}
        print(f"TRANSACTION AUDIT start warning: {e}")
        return None


def complete_transaction_audit(audit_row, *, balance_after=None, response_json=None, metadata=None):
    if not audit_row or audit_row.get('_duplicate_response'):
        return
    audit_id = audit_row.get('id')
    if not audit_id:
        return
    patch = {
        'status': 'success',
        'balance_after': balance_after,
        'response_json': response_json or {},
        'completed_at': datetime.utcnow().isoformat(),
    }
    if metadata is not None:
        patch['metadata'] = metadata
    try:
        supabase.table('transaction_audit').update(patch).eq('id', audit_id).execute()
    except Exception as e:
        print(f"TRANSACTION AUDIT complete warning: {e}")


def fail_transaction_audit(audit_row, error):
    if not audit_row or audit_row.get('_duplicate_response') or not audit_row.get('id'):
        return
    try:
        supabase.table('transaction_audit').update({
            'status': 'failed',
            'reason': str(error)[:500],
            'completed_at': datetime.utcnow().isoformat(),
        }).eq('id', audit_row.get('id')).execute()
    except Exception as e:
        print(f"TRANSACTION AUDIT failure-log warning: {e}")



def _audit_name_maps(business_id: int):
    """Small lookup maps used by the owner audit/security dashboard."""
    def rows(table, cols):
        try:
            return supabase.table(table).select(cols).eq('business_id', business_id).execute().data or []
        except Exception:
            return []
    customers = rows('customers', 'id,public_id,name')
    staff = rows('staff', 'id,public_id,name')
    branches = rows('branches', 'id,public_id,name')
    return (
        {str(x.get('id')): x for x in customers},
        {str(x.get('id')): x for x in staff},
        {str(x.get('id')): x for x in branches},
    )


def _audit_enrich(row: dict, customer_map: dict, staff_map: dict, branch_map: dict) -> dict:
    item = dict(row or {})
    customer = customer_map.get(str(item.get('customer_id'))) or {}
    cashier = staff_map.get(str(item.get('staff_id'))) or {}
    branch = branch_map.get(str(item.get('branch_id'))) or {}
    item['customer_name'] = customer.get('name')
    item['customer_public_id'] = customer.get('public_id')
    item['staff_name'] = cashier.get('name')
    item['staff_public_id'] = cashier.get('public_id')
    item['branch_name'] = branch.get('name')
    item['branch_public_id'] = branch.get('public_id')
    return item


@app.get('/api/v1/business/{public_id}/transaction-audit')
def owner_transaction_audit(public_id: str, limit: int = 200, status: Optional[str] = None,
                            action: Optional[str] = None, branch_public_id: Optional[str] = None,
                            staff_public_id: Optional[str] = None, customer_public_id: Optional[str] = None,
                            date_from: Optional[str] = None, date_to: Optional[str] = None, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    """Owner-facing all-card transaction ledger. Read-only; newest first."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    business_id = business.get('id')
    if business_id is None:
        raise HTTPException(status_code=500, detail="Business record is missing its internal ID")
    limit = max(1, min(int(limit or 200), 500))
    customer_map, staff_map, branch_map = _audit_name_maps(business_id)

    q = supabase.table('transaction_audit').select('*').eq('business_id', business_id)
    if status:
        q = q.eq('status', status)
    if action:
        q = q.eq('action', action)
    if branch_public_id:
        match = next((x for x in branch_map.values() if x.get('public_id') == branch_public_id), None)
        if not match: return {'transactions': [], 'total': 0}
        q = q.eq('branch_id', match.get('id'))
    if staff_public_id:
        match = next((x for x in staff_map.values() if x.get('public_id') == staff_public_id), None)
        if not match: return {'transactions': [], 'total': 0}
        q = q.eq('staff_id', match.get('id'))
    if customer_public_id:
        match = next((x for x in customer_map.values() if x.get('public_id') == customer_public_id), None)
        if not match: return {'transactions': [], 'total': 0}
        q = q.eq('customer_id', match.get('id'))
    if date_from:
        q = q.gte('created_at', f'{date_from[:10]}T00:00:00')
    if date_to:
        q = q.lt('created_at', f'{date_to[:10]}T23:59:59.999999')
    try:
        rows = q.order('created_at', desc=True).limit(limit).execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))
    enriched = [_audit_enrich(r, customer_map, staff_map, branch_map) for r in rows]
    return {'transactions': enriched, 'total': len(enriched)}


@app.get('/api/v1/business/{public_id}/fraud-alerts')
def owner_fraud_alerts(public_id: str, hours: int = 24, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    """Explainable owner alerts derived from the all-card transaction audit ledger."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    business_id = business.get('id')
    if business_id is None:
        raise HTTPException(status_code=500, detail="Business record is missing its internal ID")
    hours = max(1, min(int(hours or 24), 24 * 30))
    since = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    customer_map, staff_map, branch_map = _audit_name_maps(business_id)
    try:
        rows = (supabase.table('transaction_audit').select('*')
                .eq('business_id', business_id).gte('created_at', since)
                .order('created_at', desc=True).limit(1000).execute().data or [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    alerts = []
    successful = [r for r in rows if r.get('status') == 'success']
    failed = [r for r in rows if r.get('status') == 'failed']

    # Many successful loyalty mutations by one cashier in a rolling review window.
    by_staff = {}
    for r in successful:
        if r.get('staff_id') is not None:
            by_staff.setdefault(str(r.get('staff_id')), []).append(r)
    for sid, items in by_staff.items():
        if len(items) >= 25:
            who = (staff_map.get(sid) or {}).get('name') or 'Unknown cashier'
            alerts.append({'type':'high_velocity','severity':'high','title':'High cashier activity',
                           'message':f'{who} completed {len(items)} loyalty transactions in the last {hours} hours.',
                           'staff_public_id':(staff_map.get(sid) or {}).get('public_id'),'count':len(items)})

    # Repeated activity on the same customer can indicate duplicate scans or abuse.
    by_customer = {}
    for r in successful:
        if r.get('customer_id') is not None:
            by_customer.setdefault(str(r.get('customer_id')), []).append(r)
    for cid, items in by_customer.items():
        if len(items) >= 8:
            who = (customer_map.get(cid) or {}).get('name') or 'Unknown customer'
            alerts.append({'type':'repeat_customer','severity':'medium','title':'Repeated customer activity',
                           'message':f'{who} had {len(items)} successful loyalty transactions in the last {hours} hours.',
                           'customer_public_id':(customer_map.get(cid) or {}).get('public_id'),'count':len(items)})

    # Manual corrections are legitimate, but clusters deserve owner review.
    adjustment_words = ('adjust','manual','remove','correction','override')
    adjustments = [r for r in successful if any(w in str(r.get('action') or '').lower() for w in adjustment_words)
                   or any(w in str(r.get('reason') or '').lower() for w in adjustment_words)]
    if len(adjustments) >= 5:
        alerts.append({'type':'manual_adjustments','severity':'medium','title':'Frequent manual adjustments',
                       'message':f'{len(adjustments)} manual/adjustment transactions were recorded in the last {hours} hours.',
                       'count':len(adjustments)})

    if len(failed) >= 5:
        alerts.append({'type':'failed_transactions','severity':'medium','title':'Repeated failed transactions',
                       'message':f'{len(failed)} loyalty transactions failed in the last {hours} hours.', 'count':len(failed)})

    missing_tx = [r for r in successful if not r.get('transaction_id')]
    if missing_tx:
        alerts.append({'type':'missing_transaction_id','severity':'high','title':'Transaction integrity warning',
                       'message':f'{len(missing_tx)} successful transactions have no transaction ID.', 'count':len(missing_tx)})

    alerts.sort(key=lambda x: {'high':0,'medium':1,'low':2}.get(x.get('severity'), 3))
    return {'alerts': alerts, 'total': len(alerts), 'reviewed_transactions': len(rows),
            'window_hours': hours, 'generated_at': datetime.utcnow().isoformat()}

def sync_stamp_wallets_background(customer: dict, business: dict, program: dict,
                                  reward_unlocked: bool, new_count: int, goal: int):
    """Durably queue Wallet refresh after the cashier transaction."""
    result = enqueue_wallet_sync(customer, business, 'stamp_reward' if reward_unlocked else 'stamp_add')
    print(f"STAMP WALLET QUEUE RESULT: {result}")


def sync_loyalty_wallets_background(
    customer: dict,
    business: dict,
    program: dict,
    reason: str = 'loyalty_update',
    notify_header: Optional[str] = None,
    notify_body: Optional[str] = None,
    notify_message_id: Optional[str] = None,
):
    """Refresh Google + Apple Wallet after the cashier response is sent.

    The database transaction is already complete before this runs, so Google
    or Apple latency can never hold up checkout. If either provider fails,
    enqueue the customer's pass in the existing durable retry queue.
    """
    customer_snapshot = dict(customer or {})
    business_snapshot = dict(business or {})
    program_snapshot = dict(program or {})

    try:
        google_result = sync_wallet_object(
            customer_snapshot,
            business_snapshot,
            program_snapshot,
            notify_header=notify_header,
            notify_body=notify_body,
            notify_message_id=notify_message_id,
        )
        apple_result = sync_apple_wallet_pass(customer_snapshot)

        failed = (
            (isinstance(google_result, dict) and google_result.get('status') == 'error')
            or (isinstance(apple_result, dict) and apple_result.get('status') == 'error')
        )
        if failed:
            queued = enqueue_wallet_sync(customer_snapshot, business_snapshot, reason)
            print(
                f"BACKGROUND WALLET SYNC provider failure; queued retry: "
                f"google={google_result}, apple={apple_result}, queue={queued}"
            )
        else:
            print(
                f"BACKGROUND WALLET SYNC complete: reason={reason}, "
                f"customer={customer_snapshot.get('public_id')}"
            )
    except Exception as exc:
        queued = enqueue_wallet_sync(customer_snapshot, business_snapshot, reason)
        print(f"BACKGROUND WALLET SYNC error: {exc}; queued retry={queued}")


@app.post("/api/v1/business/{public_id}/stamp")
async def add_stamp(public_id: str, req: StampRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
    print(f"STAMP REQUEST: business={public_id}, customer={req.customer_public_id}")

    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response

    stamping_staff_id = None
    stamping_branch_id = None

    session_claims = get_staff_session_claims(public_id, authorization)
    if session_claims:
        stamping_staff_id = session_claims.get('staff_id')
        stamping_branch_id = session_claims.get('branch_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        try:
            staff_res = (
                supabase.table("staff").select("*")
                .eq("business_id", business.get("id"))
                .eq("pin", req.staff_pin)
                .execute()
            )
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

    rewards = get_stamp_rewards(program)
    goal = int(rewards[-1]['stamps'])
    if bool((program or {}).get('stamp_once_per_day')) and stamped_today(business.get('id'), customer.get('id')):
        raise HTTPException(status_code=409, detail="This customer already received a stamp today. One stamp per day is enabled.")

    old_count = int(customer.get('stamp_count') or 0)
    if old_count >= goal:
        raise HTTPException(status_code=409, detail=f"Maximum stamp milestone reached ({goal}/{goal}). Redeem any available reward; additional normal stamps are disabled.")
    new_count = old_count + 1
    newly_reached = [r for r in rewards if old_count < int(r['stamps']) <= new_count]
    available_rewards = get_available_stamp_rewards({**customer, 'stamp_count': new_count}, program)
    reward_unlocked = bool(available_rewards or newly_reached)
    updated_at = datetime.utcnow().isoformat()

    audit_row = start_transaction_audit(
        business_id=business.get('id'),
        customer_id=customer.get('id'),
        staff_id=stamping_staff_id,
        branch_id=stamping_branch_id,
        actor_type=_audit_actor(stamping_staff_id, req.as_owner),
        action='stamp_add',
        idempotency_key=x_idempotency_key,
        delta=1,
        balance_before=old_count,
        metadata={'card_type': 'stamp', 'goal': goal},
    )
    if audit_row and audit_row.get('_duplicate_response'):
        return audit_row['_duplicate_response']

    # Database first. Wallets must only ever reflect a stamp that was actually
    # persisted; never return a fake success when RLS/schema problems blocked it.
    update_data = {
        'stamp_count': new_count,
        'reward_unlocked': reward_unlocked,
        'updated_at': updated_at,
    }
    try:
        result = (
            supabase.table("customers")
            .update(update_data)
            .eq("id", customer.get("id"))
            .execute()
        )
    except Exception as e:
        error_msg = str(e)

        # Backward compatibility for an older database that has not yet added
        # reward_unlocked. The important fix here is that after this retry we
        # CONTINUE into Google/Apple sync instead of returning early.
        if 'reward_unlocked' in error_msg.lower():
            try:
                fallback_update = {
                    'stamp_count': new_count,
                    'updated_at': updated_at,
                }
                result = (
                    supabase.table("customers")
                    .update(fallback_update)
                    .eq("id", customer.get("id"))
                    .execute()
                )
                print("STAMP DB: reward_unlocked column unavailable; stamp persisted with compatibility fallback")
            except Exception as e2:
                raise HTTPException(status_code=500, detail=friendly_db_error(e2))
        else:
            if "row-level security" in error_msg.lower() or "rls" in error_msg.lower():
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Stamp was NOT saved because Supabase Row Level Security blocked the update. "
                        "Use the server-side service_role key or correct the RLS policy."
                    ),
                )
            raise HTTPException(status_code=500, detail=friendly_db_error(e))

    persisted = (result.data[0] if getattr(result, 'data', None) else None) or {
        **customer,
        'stamp_count': new_count,
        'reward_unlocked': reward_unlocked,
        'updated_at': updated_at,
    }
    # Ensure compatibility-fallback rows still carry the newly calculated
    # values while building the Google/Apple representations.
    persisted['stamp_count'] = new_count
    persisted['reward_unlocked'] = reward_unlocked
    persisted['updated_at'] = persisted.get('updated_at') or updated_at

    print(f"STAMP DB: customer={persisted.get('public_id')} count={new_count}/{goal} persisted")


    try:
        log_stamp_event(
            business.get('id'),
            customer.get('id'),
            stamping_staff_id,
            stamping_branch_id
        )
    except Exception as e:
        # The loyalty balance itself is already safely saved. Keep the cashier
        # transaction successful, but make the analytics failure visible in logs.
        print(f"STAMP EVENT LOG error: {e}")

    # The database balance and stamp event are already committed here.
    # Queue Wallet refresh only now, so Google/APNs latency cannot delay cashier confirmation.
    background_tasks.add_task(
        sync_stamp_wallets_background,
        dict(persisted), dict(business), dict(program or {}),
        reward_unlocked, new_count, goal,
    )
    print(f"STAMP FAST RESPONSE: customer={persisted.get('public_id')} count={new_count}/{goal}; wallet sync queued")

    response_payload = {
        "message": "Stamp added!",
        "stamp_count": new_count,
        "reward_unlocked": reward_unlocked,
        "newly_reached_rewards": newly_reached,
        "available_rewards": get_available_stamp_rewards(persisted, program),
        "stamp_once_per_day": bool((program or {}).get('stamp_once_per_day')),
        "active_coupon": safe_get_active_coupon(customer.get('id')),
        "wallet_sync": {"status": "queued"},
    }
    if audit_row and audit_row.get('transaction_id'):
        response_payload["transaction_id"] = str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row, balance_after=new_count, response_json=response_payload)
    return response_payload



@app.post("/api/v1/business/{public_id}/stamp/adjust")
async def adjust_stamp(public_id: str, req: StampAdjustRequest, background_tasks: BackgroundTasks, authorization: str = Header(default="")):
    """Audited cashier/owner correction. Delta may be + or -, and Wallets are resynced."""
    if req.delta == 0:
        raise HTTPException(status_code=400, detail="Adjustment must add or remove at least one stamp")
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(req.customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    staff_id = None
    branch_id = None
    claims = get_staff_session_claims(public_id, authorization)
    if claims:
        staff_id = claims.get('staff_id')
        branch_id = claims.get('branch_id')
    elif req.as_owner:
        pass
    else:
        if not req.staff_pin:
            raise HTTPException(status_code=400, detail="Staff PIN required")
        staff_res = (supabase.table('staff').select('*').eq('business_id', business.get('id'))
                     .eq('pin', req.staff_pin).execute())
        if not staff_res.data:
            raise HTTPException(status_code=403, detail="Invalid staff PIN")
        staff_id = staff_res.data[0].get('id')
        branch_id = staff_res.data[0].get('branch_id')

    program = safe_get_loyalty_program(business.get('id'))
    if program and program.get('card_type') != 'stamp':
        raise HTTPException(status_code=400, detail="Stamp adjustments are only available for Stamp Cards")

    old_count = int(customer.get('stamp_count') or 0)
    new_count = max(0, old_count + int(req.delta))
    actual_delta = new_count - old_count
    available = get_available_stamp_rewards({**customer, 'stamp_count': new_count}, program)
    reward_unlocked = bool(available)

    update_data = {
        'stamp_count': new_count,
        'reward_unlocked': reward_unlocked,
        'updated_at': datetime.utcnow().isoformat(),
    }
    try:
        res = supabase.table('customers').update(update_data).eq('id', customer.get('id')).execute()
        persisted = res.data[0] if res.data else {**customer, **update_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    try:
        supabase.table('stamp_adjustments').insert({
            'business_id': business.get('id'),
            'customer_id': customer.get('id'),
            'staff_id': staff_id,
            'branch_id': branch_id,
            'delta': actual_delta,
            'old_count': old_count,
            'new_count': new_count,
            'reason': (req.reason or 'Cashier correction').strip()[:200],
            'created_at': datetime.utcnow().isoformat(),
        }).execute()
    except Exception as e:
        print(f"STAMP ADJUSTMENT audit warning: {e}")

    audit_row = start_transaction_audit(
        business_id=business.get('id'),
        customer_id=customer.get('id'),
        staff_id=staff_id,
        branch_id=branch_id,
        actor_type=_audit_actor(staff_id, req.as_owner),
        action='stamp_adjust',
        delta=actual_delta,
        balance_before=old_count,
        reason=(req.reason or 'Cashier correction').strip()[:200],
        metadata={'card_type': 'stamp'},
    )

    background_tasks.add_task(
        sync_loyalty_wallets_background,
        dict(persisted), dict(business), dict(program or {}),
        'stamp_adjust',
        "Stamp balance corrected",
        f"Your stamp balance is now {new_count}.",
        f"stamp-adjust-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
    )
    response_payload = {
        'message': 'Stamp balance updated',
        'stamp_count': new_count,
        'delta': actual_delta,
        'reward_unlocked': reward_unlocked,
        'available_rewards': get_available_stamp_rewards(persisted, program),
        'wallet_sync': {'status': 'queued'},
    }
    if audit_row and audit_row.get('transaction_id'):
        response_payload['transaction_id'] = str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row, balance_after=new_count, response_json=response_payload)
    return response_payload


@app.post("/api/v1/business/{public_id}/vip-sale")
async def add_vip_sale(public_id: str, req: VIPSaleRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
    business = safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(req.customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    
    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response
    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'vip':
        raise HTTPException(status_code=400, detail="This business is not using a VIP card")
    staff_id = branch_id = None
    claims = get_staff_session_claims(public_id, authorization)
    if claims:
        staff_id = claims.get('staff_id')
        branch_id = claims.get('branch_id')
    elif not req.as_owner:
        if not req.staff_pin: raise HTTPException(status_code=400, detail="Staff PIN required")
        sr = supabase.table('staff').select('*').eq('business_id', business.get('id')).eq('pin', req.staff_pin).execute()
        if not sr.data: raise HTTPException(status_code=403, detail="Invalid staff PIN")
        staff_id=sr.data[0].get('id'); branch_id=sr.data[0].get('branch_id')
    rate = float(program.get('vip_points_per_amount') or 0)
    base = float(program.get('vip_amount_pesos') or 100)
    earned = max(0, int((float(req.amount_spent) / base) * rate))
    old_tier=get_vip_tier(customer, program)
    old_balance=int(customer.get('vip_points') or 0)
    balance=old_balance+earned
    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),staff_id=staff_id,branch_id=branch_id,actor_type=_audit_actor(staff_id,req.as_owner),action='vip_sale',idempotency_key=x_idempotency_key,delta=earned,balance_before=old_balance,metadata={'card_type':'vip','amount_spent':float(req.amount_spent)})
    if audit_row and audit_row.get('_duplicate_response'): return audit_row['_duplicate_response']
    supabase.table('customers').update({'vip_points':balance,'updated_at':datetime.utcnow().isoformat()}).eq('id',customer.get('id')).execute()
    customer['vip_points']=balance
    new_tier=get_vip_tier(customer, program); next_tier=get_next_vip_tier(customer, program)
    log_vip_event(business.get('id'),customer.get('id'),'sale',earned,balance,req.amount_spent,old_tier.get('name'),new_tier.get('name'),staff_id,branch_id)
    background_tasks.add_task(
        sync_loyalty_wallets_background,
        dict(customer), dict(business), dict(program),
        'vip_sale',
        'VIP status updated',
        f"You earned {earned} VIP points. You are now {new_tier.get('name')} VIP.",
        f"vip-{customer.get('id')}-{balance}-{int(datetime.utcnow().timestamp())}",
    )
    response_payload = {
        'message': f'{earned} VIP points added',
        'amount_spent': float(req.amount_spent),
        'points_earned': earned,
        'vip_points': balance,
        'tier': new_tier,
        'next_tier': next_tier,
        'upgraded': old_tier.get('id') != new_tier.get('id'),
        'earning_rule': {
            'vip_points': rate,
            'per_pesos': base,
        },
        'active_coupon': safe_get_active_coupon(customer.get('id')),
    }
    if audit_row and audit_row.get('transaction_id'):
        response_payload['transaction_id'] = str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row, balance_after=balance, response_json=response_payload)
    return response_payload

@app.post("/api/v1/business/{public_id}/vip-adjust")
async def adjust_vip_points(public_id: str, req: VIPAdjustRequest, background_tasks: BackgroundTasks):
    business=safe_get_business(public_id); customer=safe_get_customer(req.customer_public_id)
    if not business or not customer or customer.get('business_id') != business.get('id'): raise HTTPException(status_code=404, detail='Customer not found')
    program=safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type')!='vip': raise HTTPException(status_code=400, detail='Not a VIP program')
    old=get_vip_tier(customer,program); old_balance=int(customer.get('vip_points') or 0); balance=max(0,old_balance+req.points_delta)
    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),actor_type='owner',action='vip_adjust',delta=balance-old_balance,balance_before=old_balance,reason=req.note,metadata={'card_type':'vip'})
    supabase.table('customers').update({'vip_points':balance,'updated_at':datetime.utcnow().isoformat()}).eq('id',customer.get('id')).execute(); customer['vip_points']=balance
    new=get_vip_tier(customer,program); log_vip_event(business.get('id'),customer.get('id'),'adjustment',req.points_delta,balance,old_tier=old.get('name'),new_tier=new.get('name'),note=req.note)
    background_tasks.add_task(
        sync_loyalty_wallets_background,
        dict(customer), dict(business), dict(program),
        'vip_adjust',
    )
    response_payload={'vip_points':balance,'tier':new,'next_tier':get_next_vip_tier(customer,program)}
    if audit_row and audit_row.get('transaction_id'): response_payload['transaction_id']=str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row,balance_after=balance,response_json=response_payload)
    return response_payload

@app.post("/api/v1/business/{public_id}/points-sale")
async def add_points_sale(public_id: str, req: PointsSaleRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
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

    
    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response
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
        sale_branch_id = session_claims.get('branch_id')
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

    old_balance=int(customer.get('points_balance') or 0)
    new_balance=old_balance+points_earned

    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),staff_id=sale_staff_id,branch_id=sale_branch_id,actor_type=_audit_actor(sale_staff_id,req.as_owner),action='points_sale',idempotency_key=x_idempotency_key,delta=points_earned,balance_before=old_balance,metadata={'card_type':'points','amount_spent':float(req.amount_spent)})
    if audit_row and audit_row.get('_duplicate_response'): return audit_row['_duplicate_response']

    try:
        update_data = {
            'points_balance': new_balance,
            'updated_at': datetime.utcnow().isoformat(),
        }
        supabase.table("customers").update(update_data).eq("id", customer.get("id")).execute()
        customer['points_balance'] = new_balance
        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(customer), dict(business), dict(program),
            'points_sale',
            "Points added ⭐",
            f"You now have {new_balance} points!",
            f"points-{customer.get('id')}-{new_balance}-{int(datetime.utcnow().timestamp())}",
        )
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

    response_payload = {
        "message": f"{points_earned} points added!",
        "amount_spent": req.amount_spent,
        "points_earned": points_earned,
        "points_balance": new_balance,
        "active_coupon": safe_get_active_coupon(customer.get('id')),
    }
    if audit_row and audit_row.get('transaction_id'): response_payload['transaction_id']=str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row,balance_after=new_balance,response_json=response_payload)
    return response_payload

@app.post("/api/v1/business/{public_id}/points-redeem")
async def redeem_points_prize(public_id: str, req: PointsRedeemRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
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

    
    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response
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
        redeeming_branch_id = session_claims.get('branch_id')
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

    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),staff_id=redeeming_staff_id,branch_id=redeeming_branch_id,actor_type=_audit_actor(redeeming_staff_id,req.as_owner),action='points_redeem',idempotency_key=x_idempotency_key,delta=-int(prize_cost),balance_before=int(current_balance),metadata={'card_type':'points','prize_name':prize.get('name')})
    if audit_row and audit_row.get('_duplicate_response'): return audit_row['_duplicate_response']

    try:
        new_balance = current_balance - prize_cost
        supabase.table("customers").update({
            'points_balance': new_balance,
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", customer.get("id")).execute()
        customer['points_balance'] = new_balance
        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(customer), dict(business), dict(program),
            'points_redeem',
            "Prize redeemed 🎁",
            f"{prize.get('name', 'Prize')} redeemed - you now have {new_balance} points.",
            f"points-redeem-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        log_redemption_event(
            business.get('id'), customer.get('id'), redeeming_staff_id, redeeming_branch_id,
            prize_name=prize.get('name'), points_spent=prize_cost,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    response_payload = {
        "message": f"{prize.get('name', 'Prize')} redeemed!",
        "success": True,
        "prize_name": prize.get('name'),
        "points_spent": prize_cost,
        "points_balance": new_balance,
    }
    if audit_row and audit_row.get('transaction_id'): response_payload['transaction_id']=str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row,balance_after=new_balance,response_json=response_payload)
    return response_payload

@app.post("/api/v1/business/{public_id}/multipass/issue")
async def issue_multipass(public_id: str, req: MultipassIssueRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
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

    
    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response
    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'multipass':
        raise HTTPException(status_code=400, detail="This business is not on a multi-pass card")

    issuing_staff_id = None
    issuing_branch_id = None

    # Same staff-session / owner / legacy-PIN auth pattern as /stamp and /points-sale.
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        issuing_staff_id = session_claims.get('staff_id')
        issuing_branch_id = session_claims.get('branch_id')
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
    old_remaining=int(customer.get('multipass_sessions_remaining') or 0)
    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),staff_id=issuing_staff_id,branch_id=issuing_branch_id,actor_type=_audit_actor(issuing_staff_id,req.as_owner),action='multipass_issue',idempotency_key=x_idempotency_key,delta=int(session_count)-old_remaining,balance_before=old_remaining,metadata={'card_type':'multipass'})
    if audit_row and audit_row.get('_duplicate_response'): return audit_row['_duplicate_response']
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
        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(customer), dict(business), dict(program),
            'multipass_issue',
            "New pass activated 🎟️",
            f"You have {session_count} sessions - valid until {expires_at}.",
            f"multipass-issue-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
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

    response_payload = {
        "message": f"{session_count}-session pass issued!",
        "sessions_remaining": session_count,
        "sessions_total": session_count,
        "multipass_expires_at": expires_at,
    }
    if audit_row and audit_row.get('transaction_id'): response_payload['transaction_id']=str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row,balance_after=session_count,response_json=response_payload)
    return response_payload

@app.post("/api/v1/business/{public_id}/multipass/use")
async def use_multipass_session(public_id: str, req: MultipassUseRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
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

    
    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response
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
        using_branch_id = session_claims.get('branch_id')
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
    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),staff_id=using_staff_id,branch_id=using_branch_id,actor_type=_audit_actor(using_staff_id,req.as_owner),action='multipass_use',idempotency_key=x_idempotency_key,delta=-1,balance_before=int(sessions_remaining),metadata={'card_type':'multipass'})
    if audit_row and audit_row.get('_duplicate_response'): return audit_row['_duplicate_response']

    try:
        supabase.table("customers").update({
            'multipass_sessions_remaining': new_remaining,
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", customer.get("id")).execute()
        customer['multipass_sessions_remaining'] = new_remaining
        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(customer), dict(business), dict(program),
            'multipass_use',
            "Session used ✅" if new_remaining > 0 else "Pass complete 🎉",
            (f"{new_remaining} sessions left." if new_remaining > 0
             else "You've used all your sessions - come back to buy a new pass!"),
            f"multipass-use-{customer.get('id')}-{new_remaining}-{int(datetime.utcnow().timestamp())}",
        )
        log_multipass_event(business.get('id'), customer.get('id'), 'used', new_remaining, using_staff_id, using_branch_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    response_payload = {
        "message": "Session used!",
        "sessions_remaining": new_remaining,
        "sessions_total": customer.get('multipass_total_sessions', 0),
        "active_coupon": safe_get_active_coupon(customer.get('id')),
    }
    if audit_row and audit_row.get('transaction_id'): response_payload['transaction_id']=str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row,balance_after=new_remaining,response_json=response_payload)
    return response_payload


@app.post("/api/v1/business/{public_id}/membership/action")
async def membership_action(public_id: str, req: MembershipActionRequest, background_tasks: BackgroundTasks):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(req.customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'membership':
        raise HTTPException(status_code=400, detail="This business is not using a membership card")

    old_status = membership_effective_status(customer)
    action = req.action
    duration = req.duration_days or program.get('membership_duration_days') or 30
    today = datetime.utcnow().date().isoformat()
    update_data = {'updated_at': datetime.utcnow().isoformat()}

    if action == 'activate':
        update_data.update({
            'membership_status': 'active',
            'membership_start_date': customer.get('membership_start_date') or today,
            'membership_expires_at': add_days_to_date(None, duration),
        })
    elif action == 'renew':
        update_data.update({
            'membership_status': 'active',
            'membership_start_date': customer.get('membership_start_date') or today,
            'membership_expires_at': add_days_to_date(customer.get('membership_expires_at'), duration),
        })
    elif action == 'suspend':
        update_data['membership_status'] = 'suspended'
    elif action == 'reactivate':
        update_data['membership_status'] = 'active'
        if not customer.get('membership_expires_at') or old_status == 'expired':
            update_data['membership_expires_at'] = add_days_to_date(None, duration)
        update_data['membership_start_date'] = customer.get('membership_start_date') or today
    elif action == 'cancel':
        update_data['membership_status'] = 'cancelled'
    elif action == 'lifetime':
        update_data.update({
            'membership_status': 'lifetime',
            'membership_start_date': customer.get('membership_start_date') or today,
            'membership_expires_at': None,
        })

    try:
        res = supabase.table('customers').update(update_data).eq('id', customer.get('id')).execute()
        updated = (res.data or [{**customer, **update_data}])[0]
        new_status = membership_effective_status(updated)
        log_membership_history(
            business.get('id'), customer.get('id'), action, old_status, new_status,
            updated.get('membership_expires_at'), req.price_paid,
            (req.payment_method or '').strip() or None,
            (req.note or '').strip() or None,
        )
        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(updated), dict(business), dict(program),
            'membership_action',
            "Membership updated",
            (
                f"Your membership is now {new_status.upper()}."
                + (f" Valid until {updated.get('membership_expires_at')}." if updated.get('membership_expires_at') else "")
            ),
            f"membership-action-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        return {
            'message': 'Membership updated',
            'customer': updated,
            'effective_status': new_status,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

def attach_activity_location_names(rows: list) -> list:
    """Attach cashier and branch labels to per-customer activity rows.
    Missing staff/branch records are tolerated so old activity remains visible."""
    try:
        staff_ids = {row.get('staff_id') for row in rows if row.get('staff_id')}
        branch_ids = {row.get('branch_id') for row in rows if row.get('branch_id')}
        staff_by_id, branch_by_id = {}, {}
        if staff_ids:
            staff_rows = supabase.table('staff').select('id,name').in_('id', list(staff_ids)).execute().data or []
            staff_by_id = {row.get('id'): row.get('name') for row in staff_rows}
        if branch_ids:
            branch_rows = supabase.table('branches').select('id,name').in_('id', list(branch_ids)).execute().data or []
            branch_by_id = {row.get('id'): row.get('name') for row in branch_rows}
        for row in rows:
            row['staff_name'] = staff_by_id.get(row.get('staff_id'))
            row['branch_name'] = branch_by_id.get(row.get('branch_id'))
    except Exception:
        for row in rows:
            row.setdefault('staff_name', None)
            row.setdefault('branch_name', None)
    return rows


@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/stamp-history")
async def get_customer_stamp_history(public_id: str, customer_public_id: str):
    """Every recorded stamp for one customer, including date, cashier and branch."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    try:
        stamp_rows = (
            supabase.table('stamp_events')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .execute()
        ).data or []
        adjustment_rows = (
            supabase.table('stamp_adjustments')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .execute()
        ).data or []

        # Normalize both sources into one owner-visible Stamp Activity timeline.
        for row in stamp_rows:
            row['activity_type'] = 'stamp'
            row['delta'] = 1
        for row in adjustment_rows:
            row['activity_type'] = 'adjustment'

        rows = stamp_rows + adjustment_rows
        rows = attach_activity_location_names(rows)
        rows.sort(key=lambda r: r.get('created_at') or '', reverse=True)

        # Stamp numbers apply only to normal scan/add-stamp events. Corrections
        # show their explicit old_count -> new_count balance instead.
        normal_stamps = sorted(
            [r for r in rows if r.get('activity_type') == 'stamp'],
            key=lambda r: r.get('created_at') or ''
        )
        for number, row in enumerate(normal_stamps, start=1):
            row['stamp_number'] = number
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))


@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/multipass-history")
async def get_multipass_history(public_id: str, customer_public_id: str):
    """Customer-visible/owner-visible issue and use history, newest first."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    try:
        rows = (
            supabase.table('multipass_events')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .order('created_at', desc=True)
            .execute()
        ).data or []
        return attach_activity_location_names(rows)
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))


@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/points-history")
async def get_points_history(public_id: str, customer_public_id: str):
    """Complete points activity for one customer, newest first.

    Includes:
      - points earned from purchases (points_events)
      - owner/manual point corrections (transaction_audit: points_adjust)
      - prize redemptions/deductions (transaction_audit: points_redeem)

    Older purchase history remains visible because points_events is preserved,
    while newer balance movements use transaction_audit for reliable before /
    after balances and actor information.
    """
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    try:
        # Existing sale/earning events.
        sale_rows = (
            supabase.table('points_events')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .order('created_at', desc=True)
            .execute()
        ).data or []

        activities = []
        for row in sale_rows:
            activities.append({
                **row,
                'activity_type': 'sale',
                'points_delta': int(row.get('points_earned') or 0),
            })

        # Manual owner corrections and prize redemptions.
        audit_rows = (
            supabase.table('transaction_audit')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .eq('status', 'success')
            .in_('action', ['points_adjust', 'points_redeem'])
            .order('created_at', desc=True)
            .execute()
        ).data or []

        for row in audit_rows:
            metadata = row.get('metadata') if isinstance(row.get('metadata'), dict) else {}
            action = row.get('action')
            delta = int(row.get('delta') or 0)
            activities.append({
                'id': f"audit-{row.get('id')}",
                'activity_type': 'adjustment' if action == 'points_adjust' else 'redemption',
                'action': action,
                'created_at': row.get('completed_at') or row.get('created_at'),
                'staff_id': row.get('staff_id'),
                'branch_id': row.get('branch_id'),
                'actor_type': row.get('actor_type') or 'system',
                'points_delta': delta,
                'points_earned': delta if delta > 0 else 0,
                'points_spent': abs(delta) if delta < 0 else 0,
                'balance_before': row.get('balance_before'),
                'points_balance': row.get('balance_after'),
                'balance_after': row.get('balance_after'),
                'reason': row.get('reason'),
                'prize_name': metadata.get('prize_name'),
                'metadata': metadata,
            })

        activities = attach_activity_location_names(activities)
        activities.sort(
            key=lambda r: str(r.get('created_at') or ''),
            reverse=True,
        )
        return activities
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))


@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/vip-history")
async def get_vip_history(public_id: str, customer_public_id: str):
    """Every recorded VIP points/tier movement for one customer, including
    date, cashier and branch - same shape/pattern as stamp-history, just
    against vip_events (see log_vip_event)."""
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    try:
        rows = (
            supabase.table('vip_events')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .order('created_at', desc=True)
            .execute()
        ).data or []
        return attach_activity_location_names(rows)
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}/membership-history")
async def get_membership_history(public_id: str, customer_public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customer = safe_get_customer(customer_public_id)
    if not customer or customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")
    try:
        res = (
            supabase.table('membership_history')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('customer_id', customer.get('id'))
            .order('created_at', desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))


# MEMBERSHIP CARD - visit notes ("leaves")
#
# Unlike stamp/points/multipass, a membership card has no running balance -
# there's nothing on the customer row to increment. Every cashier visit just
# appends a dated note (service_name + optional note) to membership_events,
# and the owner dashboard reads that history back per member - like a
# patient chart. Wallet-pass sync, cashier UI, and analytics wiring come later;
# this is just the record-keeping backbone.

@app.post("/api/v1/business/{public_id}/membership/note")
async def add_membership_note(public_id: str, req: MembershipNoteRequest, background_tasks: BackgroundTasks, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
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

    
    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response
    program = safe_get_loyalty_program(business.get('id'))
    if not program or program.get('card_type') != 'membership':
        raise HTTPException(status_code=400, detail="This business is not on a membership card")
    effective_status = membership_effective_status(customer)
    if effective_status not in ('active', 'lifetime'):
        raise HTTPException(
            status_code=400,
            detail=f"Membership is {effective_status}. Activate or renew it before logging a visit."
        )

    noting_staff_id = None
    noting_branch_id = None

    # Same staff-session / owner / legacy-PIN auth pattern as /stamp, /points-sale, /multipass.
    session_claims = get_staff_session_claims(public_id, authorization)

    if session_claims:
        noting_staff_id = session_claims.get('staff_id')
        noting_branch_id = session_claims.get('branch_id')
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

    service_name = (req.service_name or '').strip() or 'Visit'
    old_visits=int((get_membership_summary(business.get('id'),customer.get('id')) or {}).get('total_visits') or 0)
    entry_source = req.entry_source or 'manual'
    audit_row=start_transaction_audit(business_id=business.get('id'),customer_id=customer.get('id'),staff_id=noting_staff_id,branch_id=noting_branch_id,actor_type=_audit_actor(noting_staff_id,req.as_owner),action='membership_visit',idempotency_key=x_idempotency_key,delta=1,balance_before=old_visits,metadata={'card_type':'membership','service_name':service_name,'entry_source':entry_source})
    if audit_row and audit_row.get('_duplicate_response'): return audit_row['_duplicate_response']
    service_date = req.service_date or datetime.utcnow().date().isoformat()

    try:
        leaf = log_membership_event(
            business.get('id'), customer.get('id'), service_name,
            (req.note or '').strip() or None, service_date, noting_staff_id, noting_branch_id,
        )
        if leaf is None:
            raise Exception("insert failed")
        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(customer), dict(business), dict(program),
            'membership_visit',
            "Membership visit recorded",
            "Your latest visit has been added to your LoyaltyTree card.",
            f"membership-visit-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
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

    response_payload = {
        "message": "Visit noted",
        "leaf": leaf,
    }
    if audit_row and audit_row.get('transaction_id'): response_payload['transaction_id']=str(audit_row.get('transaction_id'))
    complete_transaction_audit(audit_row,balance_after=old_visits+1,response_json=response_payload)
    return response_payload

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
async def verify_staff_pin(public_id: str, req: PinVerify, request: Request):
    """Verify a cashier PIN with a server-side three-strike device lock.

    A browser-generated device_id is preferred. Older clients fall back to a
    hash of IP + user-agent so the security layer is backward compatible.
    Three failed attempts for the same business/device lock cashier login until
    the next midnight in Asia/Manila. A successful login resets the counter.
    """
    _check_auth_bruteforce('cashier', request, req.email)
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    email = req.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    raw_device_id = (req.device_id or '').strip()
    if raw_device_id:
        device_id = raw_device_id[:160]
    else:
        client_ip = request.client.host if request.client else 'unknown'
        user_agent = request.headers.get('user-agent', '')[:300]
        device_id = 'legacy-' + hashlib.sha256(f'{client_ip}|{user_agent}'.encode()).hexdigest()[:40]

    # Philippine-local calendar day: lock means "for the rest of today", not
    # an arbitrary 24 hours from the third mistake. Store timestamps in UTC.
    try:
        from zoneinfo import ZoneInfo
        ph_tz = ZoneInfo('Asia/Manila')
        now_local = datetime.now(ph_tz)
    except Exception:
        ph_tz = timezone(timedelta(hours=8))
        now_local = datetime.now(ph_tz)
    today_local = now_local.date().isoformat()
    next_midnight_local = (now_local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    lock_until_utc = next_midnight_local.astimezone(timezone.utc).isoformat()
    now_utc = datetime.now(timezone.utc).isoformat()

    try:
        device_res = (supabase.table('cashier_devices')
            .select('*')
            .eq('business_id', business.get('id'))
            .eq('device_id', device_id)
            .limit(1).execute())
        device = (device_res.data or [None])[0]

        if device:
            locked_until = device.get('locked_until')
            if locked_until:
                try:
                    lock_dt = datetime.fromisoformat(str(locked_until).replace('Z', '+00:00'))
                    if lock_dt.tzinfo is None:
                        lock_dt = lock_dt.replace(tzinfo=timezone.utc)
                    if lock_dt > datetime.now(timezone.utc):
                        raise HTTPException(
                            status_code=423,
                            detail='This cashier device is locked after 3 incorrect login attempts. Try again tomorrow or ask the business owner to unlock it.',
                        )
                except HTTPException:
                    raise
                except Exception:
                    pass

        # Find the staff account by email first. This lets us count a wrong PIN
        # without revealing whether the email itself exists.
        staff_res = (supabase.table('staff').select('*')
            .eq('business_id', business.get('id')).ilike('email', email).limit(1).execute())
        staff = (staff_res.data or [None])[0]
        pin_ok = bool(staff) and hmac.compare_digest(str(staff.get('pin') or ''), str(req.pin or ''))

        if not pin_ok:
            _record_auth_failure('cashier', request, email)
            previous_attempts = 0
            if device and device.get('attempt_date') == today_local:
                previous_attempts = int(device.get('failed_attempts') or 0)
            failed_attempts = previous_attempts + 1
            payload = {
                'business_id': business.get('id'),
                'device_id': device_id,
                'staff_id': staff.get('id') if staff else None,
                'attempted_email': email[:320],
                'failed_attempts': failed_attempts,
                'attempt_date': today_local,
                'last_failed_at': now_utc,
                'updated_at': now_utc,
                'locked_until': lock_until_utc if failed_attempts >= 3 else None,
            }
            if device:
                supabase.table('cashier_devices').update(payload).eq('id', device.get('id')).execute()
            else:
                payload['public_id'] = str(uuid.uuid4())
                supabase.table('cashier_devices').insert(payload).execute()

            if failed_attempts >= 3:
                raise HTTPException(
                    status_code=423,
                    detail='Too many incorrect attempts. This cashier device is locked until tomorrow. The business owner can unlock it from the Team dashboard.',
                )
            remaining = 3 - failed_attempts
            raise HTTPException(status_code=403, detail=f'Invalid email or PIN. {remaining} attempt{"s" if remaining != 1 else ""} remaining before this device is locked for today.')

        if not staff.get('is_active', True):
            raise HTTPException(status_code=403, detail='This staff account is inactive')

        # Correct credentials clear today's failed-attempt counter.
        success_payload = {
            'business_id': business.get('id'),
            'device_id': device_id,
            'staff_id': staff.get('id'),
            'attempted_email': email[:320],
            'failed_attempts': 0,
            'attempt_date': today_local,
            'locked_until': None,
            'last_success_at': now_utc,
            'updated_at': now_utc,
        }
        if device:
            supabase.table('cashier_devices').update(success_payload).eq('id', device.get('id')).execute()
        else:
            success_payload['public_id'] = str(uuid.uuid4())
            supabase.table('cashier_devices').insert(success_payload).execute()

        response = {
            'success': True,
            'name': staff.get('name', ''),
            'role': staff.get('role', 'cashier'),
            'device_id': device_id,
        }
        _clear_auth_failures('cashier', request, email)
        if STAFF_SESSION_SECRET:
            response['session_token'] = create_staff_session_token(
                public_id, staff.get('id'), staff.get('role', 'cashier'),
                staff.get('name', ''), staff.get('branch_id'),
            )
            response['expires_in_hours'] = STAFF_SESSION_TTL_HOURS
        return response
    except HTTPException:
        raise
    except Exception as e:
        # A missing migration should fail closed with a useful deployment hint
        # instead of silently bypassing the lockout.
        if 'cashier_devices' in str(e):
            raise HTTPException(status_code=503, detail='Cashier security database migration has not been installed yet')
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/business/{public_id}/cashier-devices")
async def get_cashier_devices(public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    try:
        devices = (supabase.table('cashier_devices').select('*')
            .eq('business_id', business.get('id')).order('updated_at', desc=True).execute()).data or []
        staff_rows = (supabase.table('staff').select('id,public_id,name,email')
            .eq('business_id', business.get('id')).execute()).data or []
        staff_by_id = {s.get('id'): s for s in staff_rows}
        now = datetime.now(timezone.utc)
        out = []
        for d in devices:
            s = staff_by_id.get(d.get('staff_id')) or {}
            lock_dt = None
            if d.get('locked_until'):
                try:
                    lock_dt = datetime.fromisoformat(str(d['locked_until']).replace('Z', '+00:00'))
                    if lock_dt.tzinfo is None: lock_dt = lock_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    lock_dt = None
            out.append({
                'public_id': d.get('public_id'),
                'device_id': d.get('device_id'),
                'device_label': 'Cashier device ' + str(d.get('device_id') or '')[-6:].upper(),
                'staff_public_id': s.get('public_id'),
                'staff_name': s.get('name') or d.get('attempted_email') or 'Unknown cashier',
                'staff_email': s.get('email') or d.get('attempted_email'),
                'failed_attempts': d.get('failed_attempts') or 0,
                'locked': bool(lock_dt and lock_dt > now),
                'locked_until': d.get('locked_until'),
                'last_failed_at': d.get('last_failed_at'),
                'last_success_at': d.get('last_success_at'),
            })
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/cashier-devices/{device_public_id}/unlock")
async def unlock_cashier_device(public_id: str, device_public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    try:
        existing = (supabase.table('cashier_devices').select('id')
            .eq('business_id', business.get('id')).eq('public_id', device_public_id).limit(1).execute()).data or []
        if not existing:
            raise HTTPException(status_code=404, detail='Cashier device not found')
        supabase.table('cashier_devices').update({
            'failed_attempts': 0, 'locked_until': None,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }).eq('id', existing[0]['id']).execute()
        return {'success': True, 'message': 'Cashier device unlocked'}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.post("/api/v1/business/{public_id}/reward/redeem")
async def redeem_reward(public_id: str, req: RedeemRequest, authorization: str = Header(default=""), x_idempotency_key: str = Header(default="", alias="X-Idempotency-Key")):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = safe_get_customer(req.customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if customer.get('business_id') != business.get('id'):
        raise HTTPException(status_code=404, detail="Customer not found for this business")

    previous_response = get_completed_idempotent_response(business.get('id'), x_idempotency_key)
    if previous_response is not None:
        return previous_response

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

    program = safe_get_loyalty_program(business.get('id'))
    rewards = get_stamp_rewards(program)
    available = get_available_stamp_rewards(customer, program)
    if not available:
        raise HTTPException(status_code=400, detail="No reward available to redeem")

    # Redeem the earliest earned, unredeemed milestone. Redemption NEVER
    # subtracts or resets stamps; progress remains continuous up to the
    # highest configured milestone.
    reward = available[0]
    audit_row = start_transaction_audit(
        business_id=business.get('id'),
        customer_id=customer.get('id'),
        staff_id=redeeming_staff_id,
        branch_id=redeeming_branch_id,
        actor_type=_audit_actor(redeeming_staff_id, req.as_owner),
        action='stamp_reward_redeem',
        idempotency_key=x_idempotency_key,
        delta=0,
        balance_before=int(customer.get('stamp_count') or 0),
        metadata={
            'card_type': 'stamp',
            'milestone_id': str(reward.get('id')),
            'milestone_stamps': int(reward.get('stamps') or 0),
            'reward_name': reward.get('reward_name'),
        },
    )
    if audit_row and audit_row.get('_duplicate_response'):
        return audit_row['_duplicate_response']

    try:
        supabase.table('stamp_reward_claims').insert({
            'business_id': business.get('id'),
            'customer_id': customer.get('id'),
            'milestone_id': str(reward['id']),
            'milestone_stamps': int(reward['stamps']),
            'reward_name': reward['reward_name'],
            'staff_id': redeeming_staff_id,
            'branch_id': redeeming_branch_id,
            'redeemed_at': datetime.utcnow().isoformat(),
        }).execute()

        new_count = int(customer.get('stamp_count') or 0)
        customer['stamp_count'] = new_count
        remaining = get_available_stamp_rewards(customer, program)
        customer['reward_unlocked'] = bool(remaining)
        supabase.table("customers").update({
            'stamp_count': new_count,
            'reward_unlocked': customer['reward_unlocked'],
            'updated_at': datetime.utcnow().isoformat(),
        }).eq("id", customer.get("id")).execute()

        background_tasks.add_task(
            sync_loyalty_wallets_background,
            dict(customer), dict(business), dict(program),
            'stamp_reward_redeem',
            "Reward redeemed 🎁",
            "Your loyalty reward was redeemed successfully.",
            f"reward-redeem-{customer.get('id')}-{int(datetime.utcnow().timestamp())}",
        )
        log_redemption_event(
            business.get('id'), customer.get('id'), redeeming_staff_id,
            redeeming_branch_id, prize_name=reward['reward_name']
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    review_url = None
    features = get_plan_features(business.get('plan'))
    if features.get('google_review_prompt') and program:
        review_url = program.get('google_review_url')

    response_payload = {"message": f"{reward['reward_name']} redeemed!", "success": True, "reward": reward, "stamp_count": customer.get("stamp_count", 0), "google_review_url": review_url}
    if audit_row and audit_row.get('transaction_id'):
        response_payload["transaction_id"] = str(audit_row.get('transaction_id'))
    complete_transaction_audit(
        audit_row,
        balance_after=int(customer.get('stamp_count') or 0),
        response_json=response_payload,
    )
    return response_payload

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

    design = wallet_20_design(business, program)
    vip_tier = get_vip_tier(customer, program or {}) if card_type == 'vip' else None
    rendered_primary_color = (vip_tier or {}).get('color') or design['background']
    png_bytes = generate_personalized_hero_image_bytes(
        rendered_primary_color, reward_name, stamps, stamp_goal, description,
        card_type=card_type, points_balance=points_balance,
        sessions_remaining=sessions_remaining, sessions_total=sessions_total,
        total_visits=(membership_summary['total_visits'] if membership_summary else 0),
        last_service_name=(membership_summary['last_service_name'] if membership_summary else None),
        vip_points=int(customer.get('vip_points') or 0),
        vip_tier_name=(vip_tier or {}).get('name'),
        membership_status=membership_effective_status(customer) if card_type == 'membership' else None,
        membership_expires_at=customer.get('membership_expires_at'),
        secondary_color=design['secondary'],
        wallet_style=design['style'],
        business_name=business.get('name'),
        card_label=design['card_label'],
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

    vip_tier_class_ids = []
    if (program or {}).get('card_type') == 'vip':
        vip_tier_class_ids = [
            google_wallet_vip_class_id(business, program or {}, tier)
            for tier in normalize_vip_tiers(program or {})
        ]

    return {
        "class_id": class_id,
        "business_name": business.get("name", ""),
        "program": program,
        "google_class_exists": google_data is not None,
        "google_class_data": google_data,
        "vip_tier_class_ids": vip_tier_class_ids,
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

    program = safe_get_loyalty_program(business.get('id')) or {}
    base_class_id = _google_wallet_base_class_id(business, program)
    review_status = 'UNDER_REVIEW'

    access_token = get_google_access_token()
    if not access_token:
        raise HTTPException(status_code=500, detail="Could not get Google access token. Check GOOGLE_WALLET_CREDENTIALS.")

    def parse_response(resp):
        try:
            return resp.json()
        except Exception:
            return {"raw_response": resp.text[:2000]}

    def upsert_class(client, loyalty_class):
        target_id = loyalty_class['id']
        resp = client.put(
            f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{target_id}',
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

            # Handle create/update race without making the owner tap Publish twice.
            if resp.status_code == 409:
                resp = client.put(
                    f'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/{target_id}',
                    headers={"Authorization": f"Bearer {access_token}"},
                    json=loyalty_class
                )
                result = parse_response(resp)

        print(f"Google Wallet class upsert {target_id}: {resp.status_code} - {result}")
        return resp, result

    try:
        import httpx

        class_specs = []
        if program.get('card_type') == 'vip':
            tiers = normalize_vip_tiers(program)
            if not tiers:
                tiers = [get_vip_tier({}, program)]

            for tier in tiers:
                class_specs.append({
                    'class_id': google_wallet_vip_class_id(business, program, tier),
                    'color': tier.get('color') or '#111827',
                    'tier_name': tier.get('name') or 'VIP',
                })
        else:
            class_specs.append({
                'class_id': base_class_id,
                'color': None,
                'tier_name': None,
            })

        published_ids = []
        google_results = {}

        with httpx.Client() as client:
            for spec in class_specs:
                loyalty_class = build_loyalty_class(
                    business,
                    program,
                    review_status=review_status,
                    class_id_override=spec['class_id'],
                    background_color_override=spec['color'],
                    vip_tier_name=spec['tier_name'],
                )
                resp, result = upsert_class(client, loyalty_class)
                google_results[spec['class_id']] = result

                if resp.status_code not in (200, 201):
                    error_detail = result.get('error', result) if isinstance(result, dict) else result
                    raise HTTPException(
                        status_code=500,
                        detail=f"Google API error for {spec['class_id']} ({resp.status_code}): {error_detail}"
                    )
                published_ids.append(spec['class_id'])

        # Keep the stable root in DB. VIP tier class IDs are deterministic
        # children of this ID, so no schema migration is needed.
        db_data = {
            'google_wallet_class_id': base_class_id,
            'updated_at': datetime.utcnow().isoformat(),
        }
        if program and program.get('id'):
            supabase.table("loyalty_programs").update(db_data).eq("business_id", business.get("id")).execute()
        else:
            db_data.update({
                'business_id': business.get('id'),
                'stamp_goal': 8,
                'reward_name': 'Free Service',
                'primary_color': '#3b82f6',
                'reward_expiry_days': 30,
                'created_at': datetime.utcnow().isoformat(),
            })
            supabase.table("loyalty_programs").insert(db_data).execute()

        # Refresh existing objects only after every required class exists.
        current_program = safe_get_loyalty_program(business.get('id')) or program
        asyncio.create_task(refresh_existing_member_wallets(business, current_program))

        return {
            "success": True,
            "message": (
                f"VIP Wallet published with {len(published_ids)} tier classes. Existing member cards are refreshing automatically."
                if program.get('card_type') == 'vip'
                else "Wallet 2.0 published. Existing member cards are refreshing automatically."
            ),
            "class_id": base_class_id,
            "vip_tier_class_ids": published_ids if program.get('card_type') == 'vip' else [],
            "review_status": review_status,
            "google_response": google_results,
        }

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
            "business_type": normalize_business_type(business.get('business_type')),
            "business_category": business_category_meta(business.get('business_type')),
            "wallet_design": wallet_20_design(business, program),
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
    google_wallet_url = ("https://pay.google.com/gp/v/save/" + google_jwt) if google_jwt else ""
    apple_wallet_url = BASE_URL + '/api/v1/cl-customer/' + customer_public_id + '/apple-wallet-pass'
    unified_wallet_html = (
        '<button type="button" id="addWalletBtn" class="wallet-btn apple-btn" style="border:0;cursor:pointer;">Add to Wallet</button>'
        '<div id="walletChoice" style="display:none;margin-bottom:12px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;"></div>'
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
        + unified_wallet_html + showroom_html +
        '</div><script>'
        'const appleWalletUrl=' + json.dumps(apple_wallet_url) + ';'
        'const googleWalletUrl=' + json.dumps(google_wallet_url) + ';'
        'document.getElementById("addWalletBtn").onclick=function(){'
        'var ua=navigator.userAgent||"";var platform=navigator.platform||"";var touch=navigator.maxTouchPoints||0;'
        'var isApple=/iPhone|iPad|iPod/i.test(ua)||(platform==="MacIntel"&&touch>1);var isAndroid=/Android/i.test(ua);'
        'if(isApple){window.location.href=appleWalletUrl;return;}'
        'if(isAndroid){if(googleWalletUrl){window.location.href=googleWalletUrl;}else{alert("Google Wallet is not available for this card right now.");}return;}'
        'var c=document.getElementById("walletChoice");c.style.display=c.style.display==="block"?"none":"block";'
        'c.innerHTML="<a href=\'"+appleWalletUrl+"\' class=\'wallet-btn apple-btn\'>Apple Wallet</a>"+'
        '(googleWalletUrl?"<a href=\'"+googleWalletUrl+"\' class=\'wallet-btn google-btn\'>Google Wallet</a>":"");'
        '};'
        '</script></body></html>'
    )
    return HTMLResponse(html)

# CUSTOMER JOIN PAGE

@app.get("/join/{business_public_id}", response_class=HTMLResponse)
async def customer_join_page(business_public_id: str):
    # Existing/printed LoyaltyTree QR codes point at the backend BASE_URL.
    # When FRONTEND_URL is configured, forward them to the React join page,
    # which contains the required privacy consent UI.
    if FRONTEND_URL:
        frontend = FRONTEND_URL.rstrip('/')
        return RedirectResponse(url=f"{frontend}/join/{business_public_id}", status_code=307)
    try:
        business = safe_get_business(business_public_id)
        if not business:
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not found</h1><p>This link is invalid.</p></div>")

        if business.get('status', '').upper() != 'ACTIVE':
            return HTMLResponse("<div style='text-align:center;padding:40px;font-family:sans-serif;'><h1>Business not active</h1><p>This business is not accepting new members yet.</p></div>")

        program = safe_get_loyalty_program(business.get('id'))
        
        primary_color = program.get('primary_color', '#3b82f6') if program else '#3b82f6'
        card_type = (program.get('card_type') if program else None) or 'stamp'
        reward_name = program.get('reward_name', 'Free Service') if program else 'Free Service'
        stamp_goal = int(program.get('stamp_goal', 8) or 8) if program else 8
        card_name = program.get('card_name') if program else None
        description = program.get('description') if program else None
        biz_name = business.get('name', '')

        # Build the Join-page reward directly from the business's active loyalty
        # program instead of always falling back to the legacy 8-stamp reward.
        reward_preview_html = ''
        earning_rule_html = ''
        earning_rule_text = ''

        if card_type == 'points':
            prizes = [
                p for p in ((program or {}).get('points_prizes') or [])
                if isinstance(p, dict) and str(p.get('name') or '').strip()
                and float(p.get('points_cost') or 0) > 0
            ]
            prizes.sort(key=lambda p: float(p.get('points_cost') or 0))
            if prizes:
                first_prize = prizes[0]
                points_cost = int(float(first_prize.get('points_cost') or 0))
                prize_name = html_lib.escape(str(first_prize.get('name') or 'Reward'))
                reward_preview_html = (
                    '<div class="reward-preview">'
                    '<h3>&#127873; ' + prize_name + '</h3>'
                    '<p>Collect ' + f'{points_cost:,}' + ' points to unlock your reward</p>'
                    '</div>'
                )

            points_per_amount = float((program or {}).get('points_per_amount') or 0)
            points_amount_pesos = float((program or {}).get('points_amount_pesos') or 0)
            if points_per_amount > 0 and points_amount_pesos > 0:
                points_text = (
                    str(int(points_per_amount))
                    if points_per_amount.is_integer()
                    else f'{points_per_amount:g}'
                )
                pesos_text = (
                    str(int(points_amount_pesos))
                    if points_amount_pesos.is_integer()
                    else f'{points_amount_pesos:g}'
                )
                point_word = 'point' if points_per_amount == 1 else 'points'
                earning_rule_text = (
                    points_text + ' ' + point_word +
                    ' for every ' + pesos_text + ' pesos'
                )
                earning_rule_html = (
                    '<p class="earning-rule">' + earning_rule_text + '</p>'
                )

        elif card_type == 'stamp':
            milestones = [
                r for r in ((program or {}).get('stamp_rewards') or [])
                if isinstance(r, dict) and str(r.get('reward_name') or '').strip()
                and int(r.get('stamps') or 0) > 0
            ]
            milestones.sort(key=lambda r: int(r.get('stamps') or 0))
            if milestones:
                first_reward = milestones[0]
                stamp_goal = int(first_reward.get('stamps') or stamp_goal)
                reward_name = str(first_reward.get('reward_name') or reward_name)

            reward_preview_html = (
                '<div class="reward-preview">'
                '<h3>&#127873; ' + html_lib.escape(str(reward_name)) + '</h3>'
                '<p>Collect ' + str(stamp_goal) + ' stamps to unlock your reward</p>'
                '</div>'
            )
        # Older Points cards sometimes stored the earn rule in `description`
        # as well. Since we now render the earn rule from the real points
        # settings above, suppress the description only when it is the same
        # sentence, preventing duplicated text on the Join page.
        display_description = description
        if card_type == 'points' and description and earning_rule_text:
            normalize = lambda s: ' '.join(str(s or '').strip().lower().split()).rstrip('.')
            if normalize(description) == normalize(earning_rule_text):
                display_description = None

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
            '.reward-preview p{color:#64748b;font-size:13px}''.earning-rule{color:#64748b;font-size:13px;margin:-8px 0 24px;text-align:center}'
            '.program-description{color:#64748b;font-size:13px;line-height:1.6;margin-bottom:24px;text-align:center}'
            'input{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;'
            'font-size:16px;margin-bottom:12px;outline:none}'
            'input:focus{border-color:' + primary_color + '}'
            'select{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;'
            'font-size:16px;margin-bottom:12px;outline:none;background:white;color:#1e293b}'
            'select:focus{border-color:' + primary_color + '}'
            '.consent-box{margin:4px 0 12px;padding:14px;border:1px solid #dbe4ea;border-radius:12px;background:#f8fafc;text-align:left}'
            '.consent-title{font-size:13px;font-weight:800;color:#0f172a;margin-bottom:7px}'
            '.consent-text{font-size:12px;line-height:1.55;color:#64748b;margin-bottom:10px}'
            '.consent-row{display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.5;color:#334155;font-weight:600;cursor:pointer}'
            '.consent-row input{width:18px;height:18px;margin:1px 0 0;flex:0 0 auto;accent-color:' + primary_color + '}'
            '.consent-details{margin-top:8px;font-size:11px;line-height:1.5;color:#64748b}'
            '.consent-details summary{cursor:pointer;color:' + primary_color + ';font-weight:700}'
            '.consent-error{display:none;margin-top:8px;color:#dc2626;font-size:12px;font-weight:700}'
            'button:disabled{opacity:.5;cursor:not-allowed}'
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
            + reward_preview_html
            + earning_rule_html
            + ('<p class="program-description">' + html_lib.escape(display_description) + '</p>' if display_description else '') +
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
            '<div class="consent-box">'
            '<div class="consent-title">Privacy &amp; Membership Consent</div>'
            '<p class="consent-text">By joining, you agree that the information you provide may be collected and used by this business and LoyaltyTree to create and manage your digital loyalty membership, provide rewards and membership services, and send relevant membership or promotional updates.</p>'
            '<label class="consent-row" for="privacyConsent">'
            '<input type="checkbox" id="privacyConsent" required>'
            '<span>I have read and agree to the Privacy &amp; Membership Consent, and I confirm that the information I provided is accurate.</span>'
            '</label>'
            '<details class="consent-details"><summary>Read more</summary><div style="padding-top:7px;">Your information will be handled in accordance with applicable privacy requirements. You may request access, correction, or deletion of your personal information, subject to applicable legal and operational requirements.</div></details>'
            '<div id="consentError" class="consent-error">Please check the box before joining.</div>'
            '</div>'
            '<button type="submit" id="joinButton" disabled>Join &amp; Get Your Card &#127793;</button>'
            '</form></div>'
            '<script>'
            '(function(){'
            'const API_BASE=' + json.dumps(BASE_URL) + ';'
            'const BIZ_ID=' + json.dumps(business_public_id) + ';'
            'const BIZ_NAME=' + biz_name_json + ';'
            'const CARD_NAME=' + display_name_json + ';'
            'const consent=document.getElementById("privacyConsent");'
            'const joinButton=document.getElementById("joinButton");'
            'const consentError=document.getElementById("consentError");'
            'consent.addEventListener("change",function(){joinButton.disabled=!consent.checked;consentError.style.display="none";});'
            'document.getElementById("signupForm").addEventListener("submit",async function(e){'
            'e.preventDefault();'
            'if(!consent.checked){consentError.style.display="block";return;}'
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
            'body:JSON.stringify({name:name,address:address||null,age:age?parseInt(age,10):null,phone:phone,email:email||null,birthday:birthday||null,occupation:occupation||null,gender:gender||null,privacy_consent:true,privacy_consent_version:"2026-08-09-v1"})'
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
            '"<button type=\'button\' id=\'addWalletBtn\' class=\'wallet-btn apple-btn\' style=\'border:0;cursor:pointer;\'>Add to Wallet</button>"+'
            '"<div id=\'wallet-choice-container\' style=\'display:none;margin-bottom:12px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;\'></div>"+'
            '"<button onclick=\'doShare()\' class=\'share-btn\'>&#128279; Share Card</button>"+'
            '"<p style=\'font-size:12px;color:#94a3b8;margin-top:16px;\'>Show this QR to your cashier on every visit to earn stamps.</p>";'
            'document.getElementById("card").innerHTML=cardHtml;'
            'window.__ltGoogleWalletUrl="";'
            'window.__ltAppleWalletUrl=API_BASE+"/api/v1/customer/"+data.public_id+"/apple-wallet-pass";'
            'window.addToWallet=function(){'
            'var ua=navigator.userAgent||"";var platform=navigator.platform||"";var touch=navigator.maxTouchPoints||0;'
            'var isApple=/iPhone|iPad|iPod/i.test(ua)||(platform==="MacIntel"&&touch>1);'
            'var isAndroid=/Android/i.test(ua);'
            'if(isApple){window.location.href=window.__ltAppleWalletUrl;return;}'
            'if(isAndroid){if(window.__ltGoogleWalletUrl){window.location.href=window.__ltGoogleWalletUrl;}else{alert("Your Google Wallet card is still being prepared. Please try again in a moment.");}return;}'
            'var c=document.getElementById("wallet-choice-container");'
            'c.style.display=c.style.display==="block"?"none":"block";'
            'c.innerHTML="<a href=\'"+escapeHtml(window.__ltAppleWalletUrl)+"\' class=\'wallet-btn apple-btn\' style=\'margin-bottom:8px;\'>Apple Wallet</a>"+'
            '(window.__ltGoogleWalletUrl?"<a href=\'"+escapeHtml(window.__ltGoogleWalletUrl)+"\' class=\'wallet-btn\' style=\'margin-bottom:0;\'>Google Wallet</a>":"<div style=\'color:#64748b;font-size:12px;padding:8px;\'>Google Wallet is still being prepared.</div>");'
            '};'
            'document.getElementById("addWalletBtn").onclick=window.addToWallet;'
            'window.doShare=function(){'
            'navigator.share({title:"My "+CARD_NAME,text:"My card for "+BIZ_NAME,url:walletUrl});'
            '};'
            'console.log("Fetching wallet pass for: "+data.public_id);'
            'fetch(API_BASE+"/api/v1/customer/"+data.public_id+"/wallet-pass")'
            '.then(function(r){console.log("Wallet API status: "+r.status);return r.json();})'
            '.then(function(walletData){'
            'console.log("Wallet data:",walletData);'
            'if(walletData.save_url){window.__ltGoogleWalletUrl=walletData.save_url;}'
            '})'
            '.catch(function(err){'
            'console.error("Wallet fetch error:",err);'
            'window.__ltGoogleWalletUrl="";'
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
async def customer_signup(business_public_id: str, signup: CustomerSignup, background_tasks: BackgroundTasks):
    if not signup.privacy_consent:
        raise HTTPException(
            status_code=400,
            detail="Privacy & Membership Consent is required before joining."
        )
    if not signup.privacy_consent_version:
        raise HTTPException(
            status_code=400,
            detail="Privacy consent version is required."
        )

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
        'privacy_consent': True,
        'privacy_consent_at': datetime.utcnow().isoformat(),
        'privacy_consent_version': signup.privacy_consent_version,
        'stamp_count': 0,
        'points_balance': 0,
        'created_at': datetime.utcnow().isoformat(),
        'updated_at': datetime.utcnow().isoformat(),
    }

    program = safe_get_loyalty_program(business.get('id'))
    if program and program.get('card_type') == 'multipass':
        session_count = int(program.get('multipass_session_count') or 12)
        validity_days = int(program.get('multipass_validity_days') or 90)
        customer_data.update({
            'multipass_sessions_remaining': session_count,
            'multipass_total_sessions': session_count,
            'multipass_expires_at': (datetime.utcnow() + timedelta(days=validity_days)).date().isoformat(),
        })

    try:
        insert_res = supabase.table("customers").insert(customer_data).execute()
        inserted_customer = (insert_res.data or [None])[0]
        if inserted_customer and program and program.get('card_type') == 'multipass':
            log_multipass_event(
                business.get('id'), inserted_customer.get('id'), 'issued',
                inserted_customer.get('multipass_sessions_remaining') or 0,
            )
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

    # Prepare the signed Apple pass after the HTTP response is sent. The
    # success page normally gives this task enough time to finish before the
    # customer taps Add to Wallet, turning that tap into a cache hit.
    if inserted_customer:
        background_tasks.add_task(
            _prewarm_apple_pkpass,
            inserted_customer,
            business,
            program or {},
        )

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
            '"<button type=\'button\' id=\'addWalletBtn\' class=\'wallet-btn apple-btn\' style=\'border:0;cursor:pointer;\'>Add to Wallet</button>"+'
            '"<div id=\'wallet-choice-container\' style=\'display:none;margin-bottom:12px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;\'></div>"+'
            '"<p style=\'font-size:12px;color:#94a3b8;margin-top:16px;\'>Show this card to the dealership when you make a payment.</p>";'
            'document.getElementById("card").innerHTML=cardHtml;'
            'window.__ltGoogleWalletUrl="";window.__ltAppleWalletUrl=API_BASE+"/api/v1/cl-customer/"+data.public_id+"/apple-wallet-pass";'
            'window.addToWallet=function(){var ua=navigator.userAgent||"";var platform=navigator.platform||"";var touch=navigator.maxTouchPoints||0;var isApple=/iPhone|iPad|iPod/i.test(ua)||(platform==="MacIntel"&&touch>1);var isAndroid=/Android/i.test(ua);if(isApple){window.location.href=window.__ltAppleWalletUrl;return;}if(isAndroid){if(window.__ltGoogleWalletUrl){window.location.href=window.__ltGoogleWalletUrl;}else{alert("Your Google Wallet card is still being prepared. Please try again in a moment.");}return;}var c=document.getElementById("wallet-choice-container");c.style.display=c.style.display==="block"?"none":"block";c.innerHTML="<a href=\'"+escapeHtml(window.__ltAppleWalletUrl)+"\' class=\'wallet-btn apple-btn\' style=\'margin-bottom:8px;\'>Apple Wallet</a>"+(window.__ltGoogleWalletUrl?"<a href=\'"+escapeHtml(window.__ltGoogleWalletUrl)+"\' class=\'wallet-btn\' style=\'margin-bottom:0;\'>Google Wallet</a>":"<div style=\'color:#64748b;font-size:12px;padding:8px;\'>Google Wallet is still being prepared.</div>");};'
            'document.getElementById("addWalletBtn").onclick=window.addToWallet;'
            'fetch(API_BASE+"/api/v1/cl-customer/"+data.public_id+"/wallet-pass")'
            '.then(function(r){return r.json();})'
            '.then(function(walletData){'
            'if(walletData.save_url){window.__ltGoogleWalletUrl=walletData.save_url;}'
            '})'
            '.catch(function(err){'
            'window.__ltGoogleWalletUrl="";'
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


/* ================= SHOWROOM V2 — WOLF CARS ================= */
:root{--wc-gold:#c79a2b;--wc-gold-dark:#9f7720;--wc-gold-soft:#fbf6e8;--wc-ink:#171717;--wc-muted:#6f6f6f;--wc-line:#e9e7e1;--wc-bg:#fafaf8}
body{background:var(--wc-bg)!important;color:var(--wc-ink)!important;padding-bottom:0!important;overflow-x:hidden}
.site-nav-v2{position:sticky;top:0;z-index:80;background:rgba(255,255,255,.96);border-bottom:1px solid var(--wc-line);backdrop-filter:blur(14px)}
.site-nav-v2-inner{max-width:1180px;margin:auto;height:76px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.site-brand-v2{display:flex;align-items:center;gap:12px;text-decoration:none;min-width:0}
.site-logo-v2{width:48px;height:48px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;border-radius:50%;background:#fff;border:2px solid var(--wc-gold);box-shadow:0 5px 16px rgba(29,26,19,.10)}
.site-logo-v2 img{width:100%;height:100%;object-fit:cover;border-radius:50%}.site-logo-v2 .logo-fallback{font-weight:900;color:var(--wc-gold)}
.site-brand-v2>span:last-child{display:flex;flex-direction:column;line-height:1.05}.site-brand-v2 strong{font-size:16px;letter-spacing:.08em;text-transform:uppercase}.site-brand-v2 small{font-size:10px;color:#8a8a8a;margin-top:5px;letter-spacing:.04em;text-transform:uppercase}
.site-links-v2{display:flex;align-items:center;gap:25px}.site-links-v2 a{font-size:13px;font-weight:700;color:#4e4e4e;text-decoration:none;white-space:nowrap}.site-links-v2 a:hover{color:var(--wc-gold-dark)}
.nav-agent-btn{border:1px solid #d8d4ca;background:#fff;color:var(--wc-ink);padding:10px 16px;border-radius:10px;font:700 13px inherit;cursor:pointer}.nav-agent-btn:hover{border-color:var(--wc-gold);background:var(--wc-gold-soft)}
.hero-v2{background:#fff;border-bottom:1px solid var(--wc-line)}
.hero-v2-inner{max-width:1180px;margin:auto;min-height:610px;padding:72px 24px 64px;display:grid;grid-template-columns:minmax(0,.92fr) minmax(460px,1.08fr);align-items:center;gap:66px}
.hero-v2-copy{min-width:0}.hero-eyebrow-v2{display:inline-flex;align-items:center;gap:9px;color:var(--wc-gold-dark);font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin-bottom:20px}.hero-eyebrow-v2 span{width:7px;height:7px;border-radius:50%;background:var(--wc-gold);box-shadow:0 0 0 5px rgba(199,154,43,.13)}
.hero-v2 h1{font-size:clamp(43px,5vw,70px);line-height:1.02;letter-spacing:-.055em;font-weight:850;max-width:650px}.hero-v2 h1 em{font-style:normal;color:var(--wc-gold)}
.hero-v2-copy>p{font-size:16px;line-height:1.75;color:var(--wc-muted);max-width:590px;margin-top:24px}
.hero-cta-row-v2{display:flex;gap:12px;margin-top:30px}.btn-gold,.btn-outline{min-height:50px;padding:0 23px;border-radius:11px;font:800 14px inherit;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer;transition:.18s ease}.btn-gold{background:var(--wc-gold);color:#111;border:1px solid var(--wc-gold)}.btn-gold:hover{background:var(--wc-gold-dark);border-color:var(--wc-gold-dark);color:#fff;transform:translateY(-1px)}.btn-outline{background:#fff;color:var(--wc-ink);border:1px solid #d8d4ca}.btn-outline:hover{border-color:var(--wc-gold);background:var(--wc-gold-soft)}
.hero-proof{display:flex;gap:20px;flex-wrap:wrap;margin-top:24px}.hero-proof span{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#4f4f4f}.hero-proof i{font-style:normal;color:var(--wc-gold-dark);font-size:14px}
.hero-stats-v2{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:38px;padding-top:25px;border-top:1px solid var(--wc-line);max-width:600px}.hero-stats-v2>div{padding-right:18px}.hero-stats-v2>div+div{padding-left:18px;border-left:1px solid var(--wc-line)}.hero-stats-v2 strong{display:block;font-size:21px;line-height:1.1}.hero-stats-v2 span{display:block;font-size:10.5px;line-height:1.35;color:#898989;text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
.hero-v2-visual{min-width:0}.hero-car-frame{position:relative;min-height:430px;border-radius:28px;overflow:hidden;background:linear-gradient(145deg,#f1f1ee,#e5e3dc);box-shadow:0 32px 70px rgba(29,26,19,.16)}.hero-car-image{width:100%;height:100%;min-height:430px;display:block;object-fit:cover}.hero-car-frame:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 52%,rgba(0,0,0,.68));pointer-events:none}
.hero-car-caption{position:absolute;z-index:3;left:24px;right:24px;bottom:20px;color:#fff;display:flex;align-items:flex-end;justify-content:space-between;gap:18px}.hero-car-caption div{display:flex;flex-direction:column}.hero-car-caption span{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#e7d59e}.hero-car-caption strong{font-size:17px;margin-top:5px}.hero-car-caption>b{font-size:14px;color:#f5d675;text-align:right}.hero-car-empty{display:flex;align-items:center;justify-content:center}.hero-empty-mark{width:150px;height:150px;display:flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;background:#fff;border:3px solid var(--wc-gold);box-shadow:0 14px 34px rgba(29,26,19,.14)}.hero-empty-mark img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.trust-strip{background:#fff!important;border-bottom:1px solid var(--wc-line)}.trust-grid{max-width:1180px!important;padding:0 24px!important}.trust-item{padding:28px 24px!important}.trust-icon{color:var(--wc-gold-dark)!important}.trust-title{color:var(--wc-ink)!important}.trust-text{color:var(--wc-muted)!important}
.home-section{max-width:1180px!important;margin-top:78px!important;padding:0 24px!important}.home-kicker{color:var(--wc-gold-dark)!important}.home-heading{color:var(--wc-ink)!important}.home-copy{color:var(--wc-muted)!important}
.inventory-shell{padding-bottom:28px}.inventory-toolbar{max-width:1180px!important;margin-top:42px!important;padding:0 24px!important}.stats-strip h2{font-size:30px!important;letter-spacing:-.035em}.stats-strip span{color:var(--wc-muted)!important}
.search-input{border-color:var(--wc-line)!important;border-radius:12px!important;box-shadow:0 8px 24px rgba(30,26,18,.04)}.search-input:focus{border-color:var(--wc-gold)!important;box-shadow:0 0 0 3px rgba(199,154,43,.12)}
.filter-chip{border-color:var(--wc-line)!important;color:#686868!important}.filter-chip.active{background:var(--wc-ink)!important;border-color:var(--wc-ink)!important;color:#fff!important}.filter-chip:hover{border-color:var(--wc-gold)!important;color:var(--wc-ink)!important}
.car-grid{max-width:1180px!important;padding:0 24px!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:24px!important;margin-top:24px!important}.car-card{border:1px solid var(--wc-line)!important;border-radius:18px!important;box-shadow:0 8px 26px rgba(29,26,19,.055)!important;background:#fff!important}.car-card:hover{transform:translateY(-5px)!important;box-shadow:0 22px 48px rgba(29,26,19,.13)!important;border-color:#ddd3b5!important}.car-gallery,.no-image{aspect-ratio:16/10!important}.car-info{padding:18px 18px 17px!important}.car-info h3{font-size:17px!important}.car-meta{color:var(--wc-muted)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.car-price-row{border-top:1px solid var(--wc-line)!important;margin-top:15px!important;padding-top:15px!important;gap:12px}.car-price{color:var(--wc-gold-dark)!important;font-size:18px!important}.car-view-btn{margin-left:auto;border:0;background:var(--wc-ink);color:#fff;border-radius:9px;padding:9px 13px;font:800 11.5px inherit;cursor:pointer;white-space:nowrap}.car-view-btn:hover{background:var(--wc-gold-dark)}
.process-card{border-color:var(--wc-line)!important;box-shadow:0 8px 25px rgba(29,26,19,.04)}.process-n{background:var(--wc-gold-soft)!important;color:var(--wc-gold-dark)!important}.agent-cta-section{background:var(--wc-ink)!important;border:0!important;box-shadow:none!important}.agent-cta-section .home-kicker{color:#dfbf69!important}.agent-cta-section .home-heading,.agent-cta-section .home-copy,.agent-cta-benefits{color:#fff!important}.agent-cta-section .hero-primary-btn{background:var(--wc-gold)!important;color:#111!important;border:0!important}
.connect-section{margin-top:80px!important;background:#f3f1eb!important;padding:70px 0!important}.contact-wrap{margin:0!important}.contact-note{max-width:760px!important;width:100%;border-color:var(--wc-line)!important;border-radius:22px!important;box-shadow:none!important;padding:34px!important}.connect-title{font-size:25px!important}.connect-fb-btn{background:var(--wc-ink)!important;box-shadow:none!important}.connect-apply-link{background:#fff!important;border:1px solid var(--wc-line)!important}.connect-apply-link:hover{border-color:var(--wc-gold)!important;background:var(--wc-gold-soft)!important}
.location-wrap{max-width:1180px!important;padding:0 24px!important;margin-top:78px!important}.location-map{border-color:var(--wc-line)!important}.location-directions-btn{background:var(--wc-gold)!important;color:#111!important}.footer{max-width:none!important;margin-top:70px!important;padding:28px 20px!important;background:var(--wc-ink);color:#aaa!important;border:0!important}
.vehicle-modal-call-btn,.agent-modal-submit{background:var(--wc-gold)!important;color:#111!important}.vehicle-modal-requirements li::before{background:var(--wc-gold)!important}.agent-modal-view input:focus{border-color:var(--wc-gold)!important}.agent-modal-switch a{color:var(--wc-gold-dark)!important}
@media(max-width:980px){.site-links-v2 a{display:none}.hero-v2-inner{grid-template-columns:1fr 1fr;gap:34px;padding-top:54px}.hero-v2 h1{font-size:48px}.car-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:700px){
  .site-nav-v2-inner{height:64px;padding:0 16px}.site-logo-v2{width:40px;height:40px}.site-brand-v2 strong{font-size:13px}.site-brand-v2 small{display:none}.nav-agent-btn{padding:9px 12px;font-size:11px}
  .hero-v2-inner{display:flex;flex-direction:column;min-height:0;padding:38px 16px 42px;gap:30px}.hero-v2-copy,.hero-v2-visual{width:100%}.hero-eyebrow-v2{font-size:9.5px;margin-bottom:14px}.hero-v2 h1{font-size:clamp(36px,11vw,50px);line-height:1.04}.hero-v2-copy>p{font-size:14px;line-height:1.6;margin-top:18px}.hero-cta-row-v2{display:grid;grid-template-columns:1fr;margin-top:24px}.btn-gold,.btn-outline{width:100%;min-height:50px}.hero-proof{display:grid;grid-template-columns:1fr;gap:9px;margin-top:20px}.hero-stats-v2{grid-template-columns:repeat(3,minmax(0,1fr));margin-top:26px;padding-top:20px}.hero-stats-v2>div{padding-right:8px}.hero-stats-v2>div+div{padding-left:10px}.hero-stats-v2 strong{font-size:16px}.hero-stats-v2 span{font-size:8px}.hero-car-frame,.hero-car-image{min-height:250px}.hero-car-frame{border-radius:19px}.hero-car-caption{left:15px;right:15px;bottom:13px}.hero-car-caption strong{font-size:13px}.hero-car-caption>b{font-size:11px}
  .trust-grid{grid-template-columns:1fr 1fr!important;padding:0!important}.trust-item{padding:20px 14px!important;min-width:0}.trust-item:nth-child(2){border-right:0!important}.trust-item:nth-child(-n+2){border-bottom:1px solid var(--wc-line)}.trust-title{font-size:11.5px!important}.trust-text{font-size:10px!important}
  .home-section{margin-top:54px!important;padding:0 16px!important}.home-heading{font-size:29px!important}.inventory-toolbar{padding:0 16px!important;margin-top:32px!important}.stats-strip{padding:0!important}.stats-strip h2{font-size:25px!important}.search-wrap{padding:0!important}.filter-bar{padding:0!important;flex-wrap:nowrap!important;overflow-x:auto!important;scrollbar-width:none}.filter-bar::-webkit-scrollbar{display:none}.filter-chip{flex:0 0 auto!important}
  .car-grid{grid-template-columns:1fr!important;padding:0 16px!important;gap:18px!important}.car-card{width:100%!important;min-width:0!important}.car-gallery,.no-image{aspect-ratio:16/10!important}.car-info{padding:15px!important}.car-price-row{align-items:center}.car-view-btn{padding:9px 12px}
  .process-grid{grid-template-columns:1fr!important}.agent-cta-section{margin-left:16px!important;margin-right:16px!important;padding:28px 22px!important}.agent-cta-benefits{display:grid!important;grid-template-columns:1fr!important}.agent-cta-btn{width:100%!important;margin-top:20px!important}
  .connect-section{margin-top:58px!important;padding:44px 16px!important}.contact-wrap{padding:0!important}.contact-note{padding:25px 18px!important}.connect-apply-row{display:grid!important;grid-template-columns:1fr!important}.connect-apply-link{width:100%;min-height:44px}.location-wrap{padding:0 16px!important;margin-top:54px!important}.location-map iframe{height:245px!important}
  .vehicle-modal,.agent-modal{padding:0!important;align-items:flex-end!important}.vehicle-modal-card,.agent-modal-card{border-radius:20px 20px 0 0!important;max-height:92vh!important}.agent-modal-scroll{max-height:92vh!important}.vehicle-modal-specs{grid-template-columns:1fr 1fr!important}
}
@media(max-width:380px){.hero-v2 h1{font-size:34px}.hero-stats-v2{grid-template-columns:1fr;gap:12px}.hero-stats-v2>div,.hero-stats-v2>div+div{padding:0;border:0}.hero-stats-v2 span{font-size:9px}.trust-grid{grid-template-columns:1fr!important}.trust-item{border-right:0!important;border-bottom:1px solid var(--wc-line)!important}.trust-item:last-child{border-bottom:0!important}.vehicle-modal-specs{grid-template-columns:1fr!important}}


/* Reservation popup polish */
#reservation-modal .agent-modal-card{
  width:min(92vw,560px);
  max-height:min(92vh,860px);
  border-radius:28px;
  overflow:hidden;
}
#reservation-modal .agent-modal-scroll{
  padding:34px 34px 30px;
}
#reservation-modal .agent-modal-title{
  font-size:32px;
  line-height:1.12;
  margin-bottom:6px;
}
#reservation-modal .agent-modal-sub{
  font-size:17px;
  color:#737373;
  margin-bottom:20px;
}
#reservation-modal .reservation-payment-box{
  background:linear-gradient(180deg,#fffdf7 0%,#faf6ea 100%);
  border:1px solid #e2cf9d;
  box-shadow:0 8px 24px rgba(24,24,24,.05);
  border-radius:20px;
  padding:22px;
  margin:18px 0 22px;
  text-align:left;
}
#reservation-modal .reservation-amount{
  font-size:30px;
  line-height:1.15;
  font-weight:850;
  color:#171717;
  margin-top:5px;
}
#reservation-modal .reservation-note{
  font-size:15px;
  line-height:1.65;
  color:#4b4b4b;
  margin-top:5px;
}
.reservation-field{
  margin-bottom:15px;
}
.reservation-field label{
  display:block;
  margin:0 0 7px;
  color:#262626;
  font-size:13px;
  line-height:1.2;
  font-weight:750;
}
.reservation-control{
  display:block;
  box-sizing:border-box;
  width:100%;
  min-width:0;
  border:1px solid #ded9cc;
  border-radius:15px;
  background:#fff;
  color:#171717;
  padding:15px 16px;
  font:inherit;
  font-size:15px;
  line-height:1.4;
  outline:none;
  box-shadow:0 1px 0 rgba(0,0,0,.02);
  transition:border-color .18s ease,box-shadow .18s ease,background .18s ease;
}
.reservation-control::placeholder{color:#a3a3a3}
.reservation-control:focus{
  border-color:#c79a22;
  box-shadow:0 0 0 4px rgba(199,154,34,.13);
  background:#fffefb;
}
.reservation-textarea{
  min-height:100px;
  resize:vertical;
}
.reservation-file-wrap{
  position:relative;
  min-height:78px;
  border:1.5px dashed #d3c38f;
  border-radius:16px;
  background:#fffdf8;
  overflow:hidden;
  display:flex;
  align-items:center;
}
.reservation-file-input{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  opacity:0;
  cursor:pointer;
  z-index:2;
}
.reservation-file-copy{
  width:100%;
  padding:16px 18px;
  display:flex;
  flex-direction:column;
  gap:4px;
  pointer-events:none;
}
.reservation-file-copy strong{
  font-size:15px;
  color:#171717;
}
.reservation-file-copy span{
  font-size:12px;
  color:#777;
}
#reservation-modal .agent-modal-submit{
  width:100%;
  min-height:54px;
  border-radius:15px;
  margin-top:6px;
  font-size:16px;
  font-weight:850;
}
@media(max-width:600px){
  #reservation-modal{
    align-items:flex-end;
    padding:0;
  }
  #reservation-modal .agent-modal-card{
    width:100%;
    max-width:none;
    max-height:94vh;
    border-radius:24px 24px 0 0;
  }
  #reservation-modal .agent-modal-scroll{
    padding:28px 20px calc(24px + env(safe-area-inset-bottom));
  }
  #reservation-modal .agent-modal-title{font-size:27px}
  #reservation-modal .reservation-payment-box{padding:18px}
  #reservation-modal .reservation-amount{font-size:25px}
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


  // ---- Reservation payment popup ---------------------------------------
  var inquiryReserve = document.getElementById('inquiry-reserve');
  var reservationModal = document.getElementById('reservation-modal');
  var reservationModalClose = document.getElementById('reservation-modal-close');
  var reservationForm = document.getElementById('reservation-form');
  var reservationVehicleTitle = document.getElementById('reservation-vehicle-title');
  var reservationAmount = document.getElementById('reservation-amount');
  var reservationPaymentNote = document.getElementById('reservation-payment-note');
  var reservationName = document.getElementById('reservation-name');
  var reservationContactNumber = document.getElementById('reservation-contact-number');
  var reservationAddress = document.getElementById('reservation-address');
  var reservationReceipt = document.getElementById('reservation-receipt');
  var reservationError = document.getElementById('reservation-error');
  var reservationSubmit = document.getElementById('reservation-submit');
  var reservationFormView = document.getElementById('reservation-form-view');
  var reservationSuccessView = document.getElementById('reservation-success-view');
  var reservationSuccessClose = document.getElementById('reservation-success-close');
  var reservationCurVehiclePublicId = null;

  function showReservationView(view){
    if (reservationFormView) reservationFormView.style.display = view === 'form' ? '' : 'none';
    if (reservationSuccessView) reservationSuccessView.style.display = view === 'success' ? '' : 'none';
  }
  function closeReservationModal(){
    if (reservationModal) reservationModal.classList.remove('open');
  }
  async function openReservationModal(car){
    if (!reservationModal) return;
    reservationCurVehiclePublicId = (car && car.public_id) || inquiryCurVehiclePublicId || null;
    if (reservationVehicleTitle) reservationVehicleTitle.textContent = car && car.title ? car.title : (inquiryVehicleTitle ? inquiryVehicleTitle.textContent.replace(/^For:\\s*/, '') : '');
    if (reservationError) reservationError.style.display = 'none';
    showReservationView('form');
    reservationModal.classList.add('open');
    try {
      var settingsRes = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/reservation-settings');
      var settings = await settingsRes.json();
      if (settingsRes.ok) {
        if (reservationAmount) {
          reservationAmount.textContent = settings.reservation_amount != null
            ? ('₱' + Number(settings.reservation_amount).toLocaleString())
            : 'Amount set by the dealership';
        }
        if (reservationPaymentNote) {
          reservationPaymentNote.textContent = settings.payment_note || 'Contact the dealership for reservation payment instructions.';
        }
      }
    } catch (e) {
      if (reservationPaymentNote) reservationPaymentNote.textContent = 'Contact the dealership for reservation payment instructions.';
    }
  }

  if (inquiryReserve) inquiryReserve.addEventListener('click', function(){
    var car = vCurCar || null;
    closeInquiryModal();
    openReservationModal(car);
  });
  if (reservationModalClose) reservationModalClose.addEventListener('click', closeReservationModal);
  if (reservationSuccessClose) reservationSuccessClose.addEventListener('click', closeReservationModal);
  if (reservationModal) reservationModal.addEventListener('click', function(e){ if (e.target === reservationModal) closeReservationModal(); });


  if (reservationReceipt) reservationReceipt.addEventListener('change', function(){
    var copy = reservationReceipt.closest('.reservation-file-wrap');
    if (!copy) return;
    var title = copy.querySelector('.reservation-file-copy strong');
    var sub = copy.querySelector('.reservation-file-copy span');
    var file = reservationReceipt.files && reservationReceipt.files[0];
    if (file) {
      if (title) title.textContent = file.name;
      if (sub) sub.textContent = 'Receipt selected — tap to replace';
      copy.classList.add('has-file');
    } else {
      if (title) title.textContent = 'Upload receipt';
      if (sub) sub.textContent = 'JPG or PNG, up to 10 MB';
      copy.classList.remove('has-file');
    }
  });

  if (reservationForm) reservationForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var name = reservationName ? reservationName.value.trim() : '';
    var contactNumber = reservationContactNumber ? reservationContactNumber.value.trim() : '';
    var address = reservationAddress ? reservationAddress.value.trim() : '';
    var receiptFile = reservationReceipt && reservationReceipt.files ? reservationReceipt.files[0] : null;
    if (reservationError) reservationError.style.display = 'none';
    if (!name || !contactNumber || !address || !receiptFile || !reservationCurVehiclePublicId) {
      if (reservationError) {
        reservationError.textContent = 'Enter your name, contact number, complete address, and upload the payment receipt.';
        reservationError.style.display = '';
      }
      return;
    }
    if (reservationSubmit) { reservationSubmit.disabled = true; reservationSubmit.textContent = 'Uploading receipt…'; }
    try {
      var sigRes = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/cloudinary-signature?purpose=reservation', { method: 'POST' });
      var sig = await sigRes.json();
      if (!sigRes.ok) throw new Error(sig.detail || 'Could not prepare receipt upload');
      var receiptUrl = await uploadInquiryPhoto(receiptFile, sig);
      if (reservationSubmit) reservationSubmit.textContent = 'Submitting…';
      var res = await fetch(inquiryConfig.api_base + '/api/v1/business/' + inquiryConfig.business_public_id + '/cl-reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          contact_number: contactNumber,
          address: address,
          vehicle_public_id: reservationCurVehiclePublicId,
          receipt_url: receiptUrl
        })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Reservation submission failed');
      reservationForm.reset();
      showReservationView('success');
    } catch (err) {
      if (reservationError) {
        reservationError.textContent = (err && err.message) || 'Network error. Please try again.';
        reservationError.style.display = '';
      }
    } finally {
      if (reservationSubmit) { reservationSubmit.disabled = false; reservationSubmit.textContent = 'Submit reservation'; }
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

SHOWROOM_CSS += r'''


.reservation-payment-box{background:#faf8f1;border:1px solid #e5d7b5;border-radius:14px;padding:16px;margin:14px 0 16px}
.reservation-amount{font-size:24px;font-weight:800;color:#171717}
.reservation-note{white-space:pre-wrap;font-size:14px;line-height:1.6;color:#444}

/* Clean showroom v4: compact benefits strip and inventory-first flow */
.benefit-strip{background:#fff;border-top:1px solid #eee8db;border-bottom:1px solid #eee8db}
.benefit-strip-inner{max-width:1180px;margin:0 auto;padding:20px 24px;display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr;align-items:center;gap:18px}
.benefit-chip{display:flex;align-items:center;justify-content:center;gap:10px;color:#181818;font-size:14px;letter-spacing:.01em;text-align:center}
.benefit-icon{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#f6edda;color:#a97d1d;font-weight:900;flex:0 0 auto}
.benefit-divider{width:1px;height:30px;background:#e8ddc6}
@media(max-width:760px){
  .benefit-strip-inner{grid-template-columns:1fr 1fr;gap:10px;padding:14px 16px}
  .benefit-divider{display:none}
  .benefit-chip{justify-content:flex-start;border:1px solid #eee8db;border-radius:12px;padding:12px;background:#fff;font-size:12px;min-width:0}
  .benefit-icon{width:24px;height:24px}
}
@media(max-width:380px){.benefit-strip-inner{grid-template-columns:1fr}.benefit-chip{font-size:13px}}

'''

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

        logo_html = ('<img src="' + html_lib.escape(logo_url) + '" alt="' + html_lib.escape(biz_name) + ' logo"/>') if logo_url else '<span class="logo-fallback">WC</span>'

        # Showroom V2 uses a real live inventory image in the hero. Nothing is
        # duplicated or hard-coded outside the existing vehicles query: when
        # inventory changes, this visual changes with it automatically.
        featured_vehicle = next((v for v in vehicles if v.get('status') == 'available'), vehicles[0] if vehicles else None)
        featured_images = []
        if featured_vehicle:
            featured_images = featured_vehicle.get('image_urls') or ([featured_vehicle.get('image_url')] if featured_vehicle.get('image_url') else [])
            featured_images = [u for u in featured_images if u]
        featured_image_url = featured_images[0] if featured_images else None
        featured_title = ''
        featured_price = ''
        if featured_vehicle:
            featured_title = f"{featured_vehicle.get('year') or ''} {featured_vehicle.get('make') or ''} {featured_vehicle.get('model') or ''}".strip()
            if featured_vehicle.get('payment_type') == 'monthly_amortization':
                dp = featured_vehicle.get('downpayment')
                monthly = featured_vehicle.get('monthly_amortization_amount')
                featured_price = (f"₱{dp:,.0f} DP" if dp is not None else '') + (f" · ₱{monthly:,.0f}/month" if monthly else '')
            else:
                featured_price = f"₱{(featured_vehicle.get('price') or 0):,.0f}"

        if featured_image_url:
            featured_visual_html = (
                '<div class="hero-car-frame">'
                '<img class="hero-car-image" src="' + html_lib.escape(featured_image_url) + '" alt="' + html_lib.escape(featured_title or 'Featured vehicle') + '">'
                ''
                '<div class="hero-car-caption"><div><span>Featured unit</span><strong>' + html_lib.escape(featured_title) + '</strong></div>'
                + ('<b>' + html_lib.escape(featured_price) + '</b>' if featured_price else '') + '</div>'
                '</div>'
            )
        else:
            featured_visual_html = (
                '<div class="hero-car-frame hero-car-empty"><div class="hero-empty-mark">' + logo_html + '</div>'
                '<div class="hero-car-caption"><div><span>Live inventory</span><strong>New units coming soon</strong></div></div></div>'
            )

        hero_html = (
            '<main class="hero-v2">'
            '<div class="hero-v2-inner">'
            '<div class="hero-v2-copy">'
            '<div class="hero-eyebrow-v2"><span></span>Verified dealership inventory</div>'
            '<h1>Drive home your next car—<em>without the usual delays.</em></h1>'
            '<p>Browse ready-to-deliver cash and rent-to-own vehicles, review complete details, and send your inquiry online.</p>'
            '<div class="hero-cta-row-v2">'
            '<a href="#inventory" class="btn-gold">Browse Available Cars</a>'
            '<button id="sell-car-btn" class="btn-outline" type="button">Sell a Car</button>'
            '</div>'
            '<div class="hero-proof">'
            '<span><i>&#10003;</i>No bank approval required</span>'
            '<span><i>&#10003;</i>Ready to deliver for sure buyers</span>'
            '</div>'
            '</div>'
            '<div class="hero-v2-visual">' + featured_visual_html + '</div>'
            '</div></main>'
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
                    nav_html = ('<button class="gal-btn prev" aria-label="Previous photo">&#10094;</button>'
                                '<button class="gal-btn next" aria-label="Next photo">&#10095;</button>') if multi else ''
                    dots_html = ('<div class="gal-dots">' + ''.join(
                        '<span class="dot' + (' active' if i == 0 else '') + '"></span>' for i in range(len(imgs))
                    ) + '</div>') if multi else ''
                    count_html = ('<span class="gal-count">1/' + str(len(imgs)) + '</span>') if multi else ''
                    badge = '<span class="badge reserved">Reserved</span>' if v.get('status') == 'reserved' else ''
                    gallery_html = (
                        '<div class="car-gallery">' + badge +
                        '<div class="gal-track">' + gal_imgs_html + '</div>' +
                        nav_html + dots_html + count_html +
                        '</div>'
                    )
                else:
                    badge = '<span class="badge reserved">Reserved</span>' if v.get('status') == 'reserved' else ''
                    gallery_html = '<div style="position:relative">' + badge + '<div class="no-image">&#128663;</div></div>'

                price = v.get('price') or 0
                payment_type = v.get('payment_type')
                monthly_amount = v.get('monthly_amortization_amount')
                if payment_type == 'monthly_amortization':
                    price_str = (f"₱{monthly_amount:,.0f}/month" if monthly_amount else "Contact us for pricing")
                else:
                    price_str = f"₱{price:,.0f}"
                meta_bits = []
                meta_bits_plain = []
                if v.get('color'):
                    meta_bits.append(html_lib.escape(str(v.get('color'))))
                    meta_bits_plain.append(str(v.get('color')))
                if v.get('mileage') is not None:
                    meta_bits.append(f"{v.get('mileage'):,} km")
                    meta_bits_plain.append(f"{v.get('mileage'):,} km")
                if v.get('location'):
                    meta_bits.append(html_lib.escape(str(v.get('location'))))
                    meta_bits_plain.append(str(v.get('location')))
                meta = ' &middot; '.join(meta_bits)
                meta_plain = ' · '.join(meta_bits_plain)

                # Fuller spec sheet shown only in the tap-to-view details
                # modal (kept off the grid card itself so cards stay compact).
                specs_data = []
                if v.get('transmission'):
                    specs_data.append({'label': 'Transmission', 'value': str(v.get('transmission')).capitalize()})
                if v.get('fuel_type'):
                    specs_data.append({'label': 'Fuel type', 'value': str(v.get('fuel_type')).capitalize()})
                if v.get('mileage') is not None:
                    specs_data.append({'label': 'Mileage', 'value': f"{v.get('mileage'):,} km"})
                if v.get('color'):
                    specs_data.append({'label': 'Color', 'value': str(v.get('color'))})
                if v.get('plate_end_in'):
                    specs_data.append({'label': 'Plate ends in', 'value': str(v.get('plate_end_in'))})
                if v.get('location'):
                    specs_data.append({'label': 'Location', 'value': str(v.get('location'))})

                # Financing details - only shown (and only meaningful) when
                # this unit is offered on monthly amortization rather than
                # a straight cash sale.
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

                cards.append(
                    '<div class="car-card" data-idx="' + str(idx) + '" data-status="' + html_lib.escape(v.get('status') or '') +
                    '" data-make="' + html_lib.escape((v.get('make') or '').strip()) +
                    '" data-search="' + html_lib.escape((title_plain + ' ' + meta_plain).lower()) + '">' +
                    gallery_html +
                    '<div class="car-info">' +
                    '<h3>' + title + '</h3>' +
                    ('<p class="car-meta">' + meta + '</p>' if meta else '') +
                    '<div class="car-price-row"><span class="car-price">' + price_str + '</span>'
                    '<button type="button" class="car-view-btn">View details</button></div>'
                    '</div></div>'
                )

                # Plain (unescaped) copy for the tap-to-view details modal - the
                # JS sets these via textContent/img.src, not innerHTML, so no
                # HTML-escaping is needed here, only JSON-escaping below.
                cars_data.append({
                    'public_id': v.get('public_id'),
                    'title': title_plain,
                    'meta': meta_plain,
                    'specs': specs_data,
                    'price': price_str,
                    'status': v.get('status') or '',
                    'imgs': raw_imgs,
                })
            grid_html = '<div class="car-grid">' + ''.join(cards) + '</div>' + (
                '<div id="no-results" class="empty-state" style="display:none">'
                '<div class="icon">&#128269;</div><p>No vehicles match your search.</p></div>'
                if len(vehicles) >= 5 else ''
            )
            cars_json = json.dumps(cars_data).replace('</', '<\\/')
        else:
            grid_html = '<div class="empty-state"><div class="icon">&#128663;</div><p>No vehicles available right now - check back soon!</p></div>'
            cars_json = '[]'

        lightbox_html = (
            '<div id="lightbox" class="lightbox">'
            '<button id="lightbox-close" class="lightbox-close" aria-label="Close">&times;</button>'
            '<button id="lightbox-prev" class="lightbox-nav prev" aria-label="Previous">&#10094;</button>'
            '<img id="lightbox-img" class="lightbox-img" src="" alt="Vehicle photo">'
            '<button id="lightbox-next" class="lightbox-nav next" aria-label="Next">&#10095;</button>'
            '<div id="lightbox-counter" class="lightbox-counter"></div>'
            '</div>'
        )

        inquire_btn_html = (
            '<button type="button" id="vehicle-modal-inquire" class="vehicle-modal-call-btn">Inquire to buy this car</button>'
        )
        vehicle_modal_html = (
            '<div id="vehicle-modal" class="vehicle-modal">'
            '<div class="vehicle-modal-card">'
            '<button id="vehicle-modal-close" class="vehicle-modal-close" aria-label="Close">&times;</button>'
            '<div class="vehicle-modal-gallery">'
            '<img id="vehicle-modal-img" src="" alt="Vehicle photo">'
            '<button id="vehicle-modal-prev" class="vehicle-modal-nav prev" aria-label="Previous photo">&#10094;</button>'
            '<button id="vehicle-modal-next" class="vehicle-modal-nav next" aria-label="Next photo">&#10095;</button>'
            '<span id="vehicle-modal-count" class="vehicle-modal-count"></span>'
            '</div>'
            '<div class="vehicle-modal-body">'
            '<h3 id="vehicle-modal-title"></h3>'
            '<p id="vehicle-modal-meta" class="vehicle-modal-meta"></p>'
            '<div id="vehicle-modal-specs" class="vehicle-modal-specs"></div>'
            '<div class="vehicle-modal-requirements">'
            '<h4>Requirements</h4>'
            '<ul>'
            '<li>2 valid IDs</li>'
            '<li>Proof of income</li>'
            '<li>Downpayment</li>'
            '</ul>'
            '</div>'
            '<div class="vehicle-modal-price-row">'
            '<span id="vehicle-modal-price" class="vehicle-modal-price"></span>'
            '<span id="vehicle-modal-badge" class="badge reserved" style="display:none;position:static">Reserved</span>'
            '</div>'
            + inquire_btn_html +
            '</div></div></div>'
            '<script id="cars-data" type="application/json">' + cars_json + '</script>'
        )

        # Agent Login / Sign Up popup - opened from the "Agent Login" button
        # top-right of the hero. Three views toggled by SHOWROOM_JS: login
        # form, sign-up form (posts to POST /api/v1/business/{id}/cl-agent-
        # signup, which creates real credentials in cl_agents), and a
        # logged-in placeholder (no real session/agent dashboard yet).
        agent_modal_html = (
            '<div id="agent-modal" class="agent-modal">'
            '<div class="agent-modal-card">'
            '<button id="agent-modal-close" class="agent-modal-close" type="button" aria-label="Close">&times;</button>'
            '<div class="agent-modal-scroll">'

            '<div id="agent-login-view" class="agent-modal-view">'
            '<h3 class="agent-modal-title">Agent Login</h3>'
            '<p class="agent-modal-sub">Log in to your agent account.</p>'
            '<form id="agent-login-form">'
            '<input type="email" id="agent-login-email" placeholder="Email" required autocomplete="username">'
            '<input type="password" id="agent-login-password" placeholder="Password" required autocomplete="current-password">'
            '<div id="agent-login-error" class="agent-modal-error" style="display:none"></div>'
            '<button type="submit" class="agent-modal-submit">Log in</button>'
            '</form>'
            '<div class="agent-modal-switch">New agent? <a href="#" id="agent-show-signup">Sign up</a></div>'
            '</div>'

            '<div id="agent-signup-view" class="agent-modal-view" style="display:none">'
            '<h3 class="agent-modal-title">Agent Sign Up</h3>'
            '<p class="agent-modal-sub">Create your agent account.</p>'
            '<form id="agent-signup-form">'
            '<input type="text" id="agent-signup-name" placeholder="Full name" required autocomplete="name">'
            '<input type="tel" id="agent-signup-phone" placeholder="Phone number" autocomplete="tel">'
            '<input type="text" id="agent-signup-address" placeholder="Address" autocomplete="street-address">'
            '<input type="email" id="agent-signup-email" placeholder="Email" required autocomplete="email">'
            '<input type="password" id="agent-signup-password" placeholder="Password (min 6 characters)" required minlength="6" autocomplete="new-password">'

            '<div class="agent-camera-block">'
            '<label class="agent-camera-label">Selfie &mdash; camera only, no uploads</label>'
            '<div class="agent-camera-frame" id="agent-selfie-frame">'
            '<div class="agent-camera-placeholder" id="agent-selfie-placeholder">&#128247;</div>'
            '<video id="agent-selfie-video" class="agent-camera-video" style="display:none" autoplay playsinline muted></video>'
            '<img id="agent-selfie-preview" class="agent-camera-preview" style="display:none" alt="Selfie preview">'
            '</div>'
            '<canvas id="agent-selfie-canvas" style="display:none"></canvas>'
            '<div class="agent-camera-actions">'
            '<button type="button" id="agent-selfie-start" class="agent-camera-btn">Open camera</button>'
            '<button type="button" id="agent-selfie-capture" class="agent-camera-btn" style="display:none">Take photo</button>'
            '<button type="button" id="agent-selfie-retake" class="agent-camera-btn agent-camera-btn-secondary" style="display:none">Retake</button>'
            '</div>'
            '<div id="agent-selfie-status" class="agent-camera-status"></div>'
            '</div>'

            '<div class="agent-camera-block">'
            '<label class="agent-camera-label">Photo of a valid ID &mdash; camera only, no uploads</label>'
            '<div class="agent-camera-frame" id="agent-id-frame">'
            '<div class="agent-camera-placeholder" id="agent-id-placeholder">&#128247;</div>'
            '<video id="agent-id-video" class="agent-camera-video" style="display:none" autoplay playsinline muted></video>'
            '<img id="agent-id-preview" class="agent-camera-preview" style="display:none" alt="ID photo preview">'
            '</div>'
            '<canvas id="agent-id-canvas" style="display:none"></canvas>'
            '<div class="agent-camera-actions">'
            '<button type="button" id="agent-id-start" class="agent-camera-btn">Open camera</button>'
            '<button type="button" id="agent-id-capture" class="agent-camera-btn" style="display:none">Take photo</button>'
            '<button type="button" id="agent-id-retake" class="agent-camera-btn agent-camera-btn-secondary" style="display:none">Retake</button>'
            '</div>'
            '<div id="agent-id-status" class="agent-camera-status"></div>'
            '</div>'

            '<div id="agent-signup-error" class="agent-modal-error" style="display:none"></div>'
            '<button type="submit" id="agent-signup-submit" class="agent-modal-submit">Create account</button>'
            '</form>'
            '<div class="agent-modal-switch">Already have an account? <a href="#" id="agent-show-login">Log in</a></div>'
            '</div>'

            '<div id="agent-loggedin-view" class="agent-modal-view" style="display:none">'
            '<div class="agent-modal-success-icon">&#9989;</div>'
            '<h3 class="agent-modal-title">You&rsquo;re logged in</h3>'
            '<p class="agent-modal-sub" id="agent-loggedin-name"></p>'
            '<p class="agent-modal-hint">Your agent dashboard is coming soon.</p>'
            '<button type="button" id="agent-logout-btn" class="agent-modal-submit agent-modal-secondary">Log out</button>'
            '</div>'

            '</div></div></div>'
            '<script id="agent-config" type="application/json">'
            + json.dumps({'api_base': BASE_URL, 'business_public_id': business_public_id}) +
            '</script>'
        )

        # "Inquire to buy this car" popup - opened from the vehicle detail
        # modal's "Inquire to buy this car" button (see inquire_btn_html
        # above). Posts to POST /api/v1/business/{id}/cl-buyer-inquiry
        # (see CLBuyerInquiry) which lands it directly in cl_applications
        # (role='buyer') for the owner to approve/reject on the
        # dashboard's Applications tab. Reuses the agent-modal-* CSS
        # classes for layout/input styling so it matches the Agent Login
        # popup. The trade-in block only shows once "Make an offer" is
        # checked - see the inquiry-* JS in SHOWROOM_JS.
        inquiry_modal_html = (
            '<div id="inquiry-modal" class="agent-modal">'
            '<div class="agent-modal-card" style="max-width:420px">'
            '<button id="inquiry-modal-close" class="agent-modal-close" type="button" aria-label="Close">&times;</button>'
            '<div class="agent-modal-scroll">'

            '<div id="inquiry-form-view" class="agent-modal-view">'
            '<h3 class="agent-modal-title">Inquire to buy this car</h3>'
            '<p class="agent-modal-sub" id="inquiry-vehicle-title"></p>'
            '<form id="inquiry-form">'
            '<input type="text" id="inquiry-name" placeholder="Full name" required autocomplete="name">'
            '<input type="tel" id="inquiry-phone" placeholder="Phone number" required autocomplete="tel">'
            '<input type="text" id="inquiry-address" placeholder="Address" autocomplete="street-address">'

            '<div class="inquiry-field-label">Valid ID #1</div>'
            '<input type="file" id="inquiry-id1" accept="image/*" required>'
            '<div class="inquiry-field-label">Valid ID #2</div>'
            '<input type="file" id="inquiry-id2" accept="image/*" required>'
            '<div class="inquiry-field-label">Proof of billing</div>'
            '<input type="file" id="inquiry-billing" accept="image/*" required>'
            '<div class="inquiry-field-label">Proof of income</div>'
            '<input type="file" id="inquiry-income" accept="image/*" required>'

            '<div class="inquiry-field-label">Agent</div>'
            '<input type="text" id="inquiry-agent" placeholder="Which agent recommended you? (optional)">'

            '<label class="inquiry-checkbox-row">'
            '<input type="checkbox" id="inquiry-make-offer"> Make an offer'
            '</label>'

            '<div id="inquiry-tradein" class="inquiry-tradein">'
            '<input type="text" id="inquiry-tradein-make" placeholder="Trade-in make">'
            '<input type="text" id="inquiry-tradein-model" placeholder="Trade-in model">'
            '<input type="text" id="inquiry-tradein-year" placeholder="Year">'
            '<input type="number" id="inquiry-tradein-mileage" placeholder="Mileage (km)" min="0">'
            '<input type="number" id="inquiry-add-cash" placeholder="Add cash amount (₱)" min="0" step="0.01">'
            '<div class="inquiry-field-label">Who adds cash?</div>'
            '<div class="inquiry-radio-row">'
            '<label><input type="radio" name="inquiry-add-cash-by" value="buyer"> Buyer</label>'
            '<label><input type="radio" name="inquiry-add-cash-by" value="seller"> Seller</label>'
            '</div>'
            '</div>'

            '<div id="inquiry-error" class="agent-modal-error" style="display:none"></div>'
            '<button type="submit" id="inquiry-submit" class="agent-modal-submit">Submit</button>'
            '<button type="button" id="inquiry-reserve" class="agent-modal-submit agent-modal-secondary">Reserve this car</button>'
            '</form>'
            '<p class="inquiry-contact-line">Call us at '
            '<a href="tel:09551996574">0955-199-6574</a> or '
            '<a href="tel:09097030170">0909-703-0170</a><br><br>'
            'or message us here at: '
            '<a href="https://www.facebook.com/share/1JYgDr75Hm/?mibextid=wwXIfr" '
            'target="_blank" rel="noopener noreferrer">Wolf Cars Facebook</a></p>'
            '</div>'

            '<div id="inquiry-success-view" class="agent-modal-view" style="display:none">'
            '<div class="agent-modal-success-icon">&#9989;</div>'
            '<h3 class="agent-modal-title">Application submitted</h3>'
            '<p class="agent-modal-sub">Your application is pending review. The dealership will contact you once it&rsquo;s approved.</p>'
            '<button type="button" id="inquiry-success-close" class="agent-modal-submit agent-modal-secondary">Close</button>'
            '</div>'

            '</div></div></div>'
        )


        reservation_modal_html = (
            '<div id="reservation-modal" class="agent-modal">'
            '<div class="agent-modal-card" style="max-width:430px">'
            '<button id="reservation-modal-close" class="agent-modal-close" type="button" aria-label="Close">&times;</button>'
            '<div class="agent-modal-scroll">'

            '<div id="reservation-form-view" class="agent-modal-view">'
            '<h3 class="agent-modal-title">Send reservation</h3>'
            '<p class="agent-modal-sub" id="reservation-vehicle-title"></p>'
            '<div class="reservation-payment-box">'
            '<div class="inquiry-field-label">Reservation amount</div>'
            '<div id="reservation-amount" class="reservation-amount">Amount set by the dealership</div>'
            '<div class="inquiry-field-label" style="margin-top:12px">Where to send payment</div>'
            '<div id="reservation-payment-note" class="reservation-note">Loading payment instructions…</div>'
            '</div>'
            '<form id="reservation-form">'
            '<div class="reservation-field">'
            '<label for="reservation-name">Full name</label>'
            '<input class="reservation-control" type="text" id="reservation-name" placeholder="Enter your full name" required autocomplete="name">'
            '</div>'
            '<div class="reservation-field">'
            '<label for="reservation-contact-number">Contact number</label>'
            '<input class="reservation-control" type="tel" id="reservation-contact-number" placeholder="e.g. 0917 123 4567" required autocomplete="tel">'
            '</div>'
            '<div class="reservation-field">'
            '<label for="reservation-address">Complete address</label>'
            '<textarea class="reservation-control reservation-textarea" id="reservation-address" placeholder="House number, street, barangay, city or municipality, province" required autocomplete="street-address"></textarea>'
            '</div>'
            '<div class="reservation-field">'
            '<label for="reservation-receipt">Reservation payment receipt</label>'
            '<div class="reservation-file-wrap">'
            '<input class="reservation-file-input" type="file" id="reservation-receipt" accept="image/*" required>'
            '<div class="reservation-file-copy"><strong>Upload receipt</strong><span>JPG or PNG, up to 10 MB</span></div>'
            '</div>'
            '</div>'
            '<div id="reservation-error" class="agent-modal-error" style="display:none"></div>'
            '<button type="submit" id="reservation-submit" class="agent-modal-submit">Submit reservation</button>'
            '</form>'
            '</div>'

            '<div id="reservation-success-view" class="agent-modal-view" style="display:none">'
            '<div class="agent-modal-success-icon">&#9989;</div>'
            '<h3 class="agent-modal-title">Reservation submitted</h3>'
            '<p class="agent-modal-sub">Your payment receipt was sent for verification. The dealership will contact you after review.</p>'
            '<button type="button" id="reservation-success-close" class="agent-modal-submit agent-modal-secondary">Close</button>'
            '</div>'

            '</div></div></div>'
        )

        # "Sell your car" popup - opened from the "Sell your car" button in
        # the hero (see hero_html above), not tied to any vehicle already
        # in inventory. Posts to POST /api/v1/business/{id}/cl-sell-your-
        # car (see CLSellerInquiry) which lands it directly in
        # cl_applications (role='seller') for the owner to approve/reject
        # on the dashboard's Applications tab -> Sellers Application.
        # Reuses the agent-modal-*/inquiry-* CSS classes for layout/input
        # styling so it matches the other popups. The photo picker lets the
        # visitor pick up to VEHICLE_MAX_PHOTOS images (not the camera,
        # same as the buyer inquiry's documents) - see the sell-* JS in
        # SHOWROOM_JS. The amortization block only shows once "Monthly
        # amortization" is checked.
        sell_modal_html = (
            '<div id="sell-modal" class="agent-modal">'
            '<div class="agent-modal-card" style="max-width:420px">'
            '<button id="sell-modal-close" class="agent-modal-close" type="button" aria-label="Close">&times;</button>'
            '<div class="agent-modal-scroll">'

            '<div id="sell-form-view" class="agent-modal-view">'
            '<h3 class="agent-modal-title">Sell your car</h3>'
            '<p class="agent-modal-sub">Tell us about your vehicle and we&rsquo;ll get back to you.</p>'
            '<form id="sell-form">'
            '<input type="text" id="sell-name" placeholder="Full name" required autocomplete="name">'
            '<input type="tel" id="sell-phone" placeholder="Phone number" required autocomplete="tel">'
            '<input type="text" id="sell-address" placeholder="Address" autocomplete="street-address">'

            '<div class="inquiry-field-label">Photos of the vehicle (up to 10)</div>'
            '<div class="sell-photo-count" id="sell-photo-count">0 / 10 photos added</div>'
            '<div class="sell-photos-grid" id="sell-photos-grid">'
            '<button type="button" id="sell-photo-add" class="sell-photo-add">+ Add<br>photo</button>'
            '</div>'
            '<input type="file" id="sell-photos-input" accept="image/*" multiple style="display:none">'

            '<input type="text" id="sell-make" placeholder="Make">'
            '<input type="text" id="sell-model" placeholder="Model">'
            '<input type="text" id="sell-year" placeholder="Year">'

            '<div class="inquiry-field-label">Transmission</div>'
            '<div class="inquiry-radio-row">'
            '<label><input type="radio" name="sell-transmission" value="automatic"> Automatic</label>'
            '<label><input type="radio" name="sell-transmission" value="manual"> Manual</label>'
            '</div>'

            '<input type="number" id="sell-mileage" placeholder="Mileage (km)" min="0">'
            '<input type="number" id="sell-price" placeholder="Cash / downpayment offer (₱)" min="0" step="0.01">'

            '<div class="inquiry-field-label">Who&rsquo;s selling?</div>'
            '<div class="inquiry-radio-row">'
            '<label><input type="radio" name="sell-type" value="owner" required> Owner</label>'
            '<label><input type="radio" name="sell-type" value="third_party" required> 3rd party</label>'
            '</div>'

            '<label class="inquiry-checkbox-row">'
            '<input type="checkbox" id="sell-has-amortization"> Monthly amortization'
            '</label>'

            '<div id="sell-amortization" class="inquiry-tradein">'
            '<input type="number" id="sell-amortization-amount" placeholder="Monthly amortization (₱)" min="0" step="0.01">'
            '<div class="inquiry-field-label">Due date</div>'
            '<input type="date" id="sell-amortization-due-date">'
            '<div class="inquiry-field-label">Next due</div>'
            '<input type="date" id="sell-amortization-next-due">'
            '<input type="number" id="sell-amortization-months-remaining" placeholder="Months remaining" min="0">'
            '</div>'

            '<div id="sell-error" class="agent-modal-error" style="display:none"></div>'
            '<button type="submit" id="sell-submit" class="agent-modal-submit">Submit</button>'
            '</form>'
            '<p class="inquiry-contact-line">Call us at '
            '<a href="tel:09551996574">0955-199-6574</a> or '
            '<a href="tel:09097030170">0909-703-0170</a></p>'
            '</div>'

            '<div id="sell-success-view" class="agent-modal-view" style="display:none">'
            '<div class="agent-modal-success-icon">&#9989;</div>'
            '<h3 class="agent-modal-title">Application submitted</h3>'
            '<p class="agent-modal-sub">Your application is pending review. The dealership will contact you once it&rsquo;s approved.</p>'
            '<button type="button" id="sell-success-close" class="agent-modal-submit agent-modal-secondary">Close</button>'
            '</div>'

            '</div></div></div>'
        )

        nav_html = (
            '<nav class="site-nav-v2"><div class="site-nav-v2-inner">'
            '<a class="site-brand-v2" href="#top"><span class="site-logo-v2">' + logo_html + '</span>'
            '<span><strong>' + html_lib.escape(biz_name) + '</strong><small>Premium pre-owned vehicles</small></span></a>'
            '<div class="site-links-v2">'
            '<a href="#inventory">Available Cars</a><a href="#how-it-works">How It Works</a>'
            '<a href="#location">Visit Us</a><a href="#connect">Contact</a>'
            '<button id="agent-login-btn" class="nav-agent-btn" type="button">Agent Login</button>'
            '</div></div></nav>'
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
        intro_html = (
            '<section class="home-section"><div class="home-kicker">Your next vehicle</div>'
            '<h2 class="home-heading">Cars ready for serious buyers</h2>'
            '<p class="home-copy">Choose from cash-sale and monthly-amortization vehicles. Tap any unit to review its photos, specifications, price, payment details, and application requirements.</p></section>'
        )
        process_html = (
            '<section id="how-it-works" class="home-section process-section"><div class="home-kicker">Simple process</div>'
            '<h2 class="home-heading">From browsing to your next car</h2>'
            '<div class="process-grid">'
            '<div class="process-card"><div class="process-n">1</div><h3>Browse available units</h3><p>Filter the live inventory and open a vehicle to review its photos, specifications, price, and payment terms.</p></div>'
            '<div class="process-card"><div class="process-n">2</div><h3>Inquire about a car</h3><p>Submit your details directly from the selected vehicle. You may also include a trade-in upgrade or downgrade offer.</p></div>'
            '<div class="process-card"><div class="process-n">3</div><h3>Complete the deal</h3><p>Our team reviews serious inquiries, confirms availability, and assists with approval and delivery.</p></div>'
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
            + nav_html + hero_html + trust_html + '<section id="inventory" class="inventory-shell"><div class="inventory-toolbar">' + stats_html + search_html + filter_html + make_filter_html + '</div>' + grid_html + '</section>' + agent_cta_html + payment_html + location_html + footer_html + lightbox_html + vehicle_modal_html + agent_modal_html + inquiry_modal_html + reservation_modal_html + sell_modal_html +
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
:root{--ink:#171717;--muted:#6b7280;--line:#e7e5e4;--gold:#c99a1a;--gold-dark:#a97910;--paper:#f7f7f5;--white:#fff}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--paper);color:var(--ink);padding-bottom:56px;-webkit-font-smoothing:antialiased}

.agent-header{background:#fff;color:var(--ink);padding:14px 22px;position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:13px;border-bottom:1px solid var(--line);box-shadow:0 4px 16px rgba(23,23,23,.035)}
.agent-header img{width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #d4af37;background:#fff}
.agent-header-text{flex:1;min-width:0}
.agent-header-text h1{font-size:16px;font-weight:800;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}
.agent-header-text p{font-size:11.5px;color:var(--muted);margin-top:2px}

.agent-toolbar{max-width:1180px;margin:20px auto 0;padding:0 22px}
.agent-search{width:100%;padding:13px 16px 13px 43px;border:1px solid var(--line);border-radius:12px;font-size:14px;font-family:inherit;color:var(--ink);background:#fff url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>') no-repeat 14px center/16px 16px;outline:none;box-shadow:0 6px 20px rgba(23,23,23,.035)}
.agent-search:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,154,26,.12)}
.agent-filter-bar{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;margin-top:12px;padding-bottom:4px;scrollbar-width:thin}
.agent-filter-bar::-webkit-scrollbar{height:5px}.agent-filter-bar::-webkit-scrollbar-thumb{background:var(--line);border-radius:999px}
.agent-chip{flex:0 0 auto;border:1px solid var(--line);background:#fff;color:var(--muted);font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:999px;cursor:pointer;transition:all .15s ease}
.agent-chip:hover{border-color:#d8cfba;color:var(--ink)}
.agent-chip.active{background:var(--ink);border-color:var(--ink);color:#fff}

.agent-grid{max-width:1180px;margin:18px auto 0;padding:0 22px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.agent-card{background:#fff;border-radius:18px;overflow:hidden;border:1px solid var(--line);cursor:pointer;box-shadow:0 8px 26px rgba(23,23,23,.045);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.agent-card:hover{transform:translateY(-4px);border-color:#d8cfba;box-shadow:0 16px 36px rgba(23,23,23,.1)}
.agent-card-img{position:relative;aspect-ratio:4/3;background:linear-gradient(135deg,#f5f5f4,#e7e5e4)}
.agent-card-img img{width:100%;height:100%;object-fit:cover;display:block}.agent-card-noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:38px;color:#a8a29e}
.agent-status-badge{position:absolute;top:10px;left:10px;font-size:10px;font-weight:800;text-transform:capitalize;padding:5px 10px;border-radius:999px;letter-spacing:.03em;box-shadow:0 4px 12px rgba(0,0,0,.14)}
.agent-status-available{background:#ecfdf5;color:#047857}.agent-status-reserved{background:#fffbeb;color:#a16207}.agent-status-financed{background:#eff6ff;color:#1d4ed8}.agent-status-sold{background:#f5f5f4;color:#78716c}
.agent-card-info{padding:14px 15px 16px}.agent-card-info h3{font-size:15px;font-weight:800;letter-spacing:-.01em;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.agent-card-meta{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.agent-card-price{font-size:16px;font-weight:850;color:var(--gold-dark);margin-top:9px}

.agent-empty{max-width:1180px;margin:64px auto;text-align:center;color:#8a8a8a;padding:0 22px}.agent-empty .icon{font-size:40px;margin-bottom:10px}
.agent-modal{display:none;position:fixed;inset:0;background:rgba(23,23,23,.62);z-index:900;align-items:flex-end;justify-content:center;padding:0}.agent-modal.open{display:flex}
.agent-modal-card{background:#fff;border-radius:22px 22px 0 0;max-width:500px;width:100%;max-height:92vh;overflow-y:auto;position:relative;-webkit-overflow-scrolling:touch}
.agent-modal-close{position:absolute;top:12px;right:12px;z-index:3;width:35px;height:35px;border-radius:50%;border:none;background:rgba(23,23,23,.72);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.agent-modal-gallery{position:relative;aspect-ratio:4/3;background:#e7e5e4}.agent-modal-gallery img{width:100%;height:100%;object-fit:cover;display:block}
.agent-modal-nav{position:absolute;top:50%;transform:translateY(-50%);width:35px;height:35px;border-radius:50%;border:none;background:rgba(23,23,23,.58);color:#fff;font-size:13px;cursor:pointer}.agent-modal-nav.prev{left:10px}.agent-modal-nav.next{right:10px}
.agent-modal-count{position:absolute;bottom:10px;right:10px;background:rgba(23,23,23,.64);color:#fff;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px}
.agent-modal-body{padding:21px 22px 25px}.agent-modal-body h3{font-size:20px;font-weight:850;letter-spacing:-.015em;margin-bottom:4px}.agent-modal-meta{font-size:13px;color:var(--muted);margin-bottom:15px}
.agent-modal-specs{display:grid;grid-template-columns:1fr 1fr;gap:11px 17px;margin-bottom:15px}.agent-modal-spec-label{font-size:10.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.agent-modal-spec-value{font-size:13.5px;font-weight:650;color:var(--ink)}
.agent-modal-note{background:#fffbeb;border:1px solid #f0d58a;border-radius:11px;padding:11px 12px;font-size:12.5px;color:#7c4a03;margin-bottom:14px}.agent-modal-note b{font-weight:800}
.agent-modal-price-row{display:flex;align-items:center;gap:10px;padding-top:15px;border-top:1px solid var(--line);margin-bottom:16px}.agent-modal-price{font-size:22px;font-weight:850;color:var(--ink);letter-spacing:-.015em}
.agent-copy-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--gold);color:#171717;border:1px solid var(--gold);border-radius:12px;padding:14px;font-size:14.5px;font-weight:800;font-family:inherit;cursor:pointer;transition:all .15s ease}.agent-copy-btn:hover{background:var(--gold-dark);border-color:var(--gold-dark);color:#fff}.agent-copy-btn.copied{background:#15803d;border-color:#15803d;color:#fff}
.agent-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(0);background:var(--ink);color:#fff;padding:11px 20px;border-radius:999px;font-size:13px;font-weight:700;z-index:1000;box-shadow:0 10px 24px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}.agent-toast.show{opacity:1;transform:translateX(-50%) translateY(-6px)}
@media(min-width:640px){.agent-modal{align-items:center;padding:24px}.agent-modal-card{border-radius:22px;max-height:88vh}}
@media(max-width:520px){.agent-header{padding:12px 15px}.agent-toolbar,.agent-grid{padding-left:14px;padding-right:14px}.agent-grid{grid-template-columns:1fr;gap:14px}.agent-card{border-radius:15px}.agent-modal-specs{grid-template-columns:1fr 1fr}.agent-copy-btn{min-width:0!important}}
"""

AGENT_JS = """
(function(){
  var BUSINESS_PUBLIC_ID = document.body.getAttribute('data-business-public-id') || '';
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
    if (!currentCar || !currentCar.public_id || !currentCar.imgs || !currentCar.imgs.length) return;
    var originalText = saveImagesBtn.textContent;
    saveImagesBtn.disabled = true;
    saveImagesBtn.textContent = 'Preparing ZIP...';
    showToast('Preparing all vehicle images');

    var downloadUrl = '/api/v1/business/' + encodeURIComponent(BUSINESS_PUBLIC_ID)
      + '/vehicles/' + encodeURIComponent(currentCar.public_id) + '/download-images';
    var a = document.createElement('a');
    a.href = downloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(function(){
      saveImagesBtn.disabled = false;
      saveImagesBtn.textContent = originalText;
      showToast('ZIP download started');
    }, 1200);
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

@app.get("/api/v1/business/{business_public_id}/vehicles/{vehicle_public_id}/download-images")
async def download_agent_vehicle_images(business_public_id: str, vehicle_public_id: str):
    """Download every photo for one dealership vehicle as a single ZIP.

    The agent page uses this instead of relying on the browser's `download`
    attribute for Cloudinary URLs, which is commonly ignored for cross-origin
    files and opens each image in a new tab instead.
    """
    business = safe_get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    vehicle = safe_get_vehicle(vehicle_public_id)
    if not vehicle or vehicle.get("business_id") != business.get("id"):
        raise HTTPException(status_code=404, detail="Vehicle not found")

    image_urls = vehicle.get("image_urls") or ([vehicle.get("image_url")] if vehicle.get("image_url") else [])
    image_urls = [url for url in image_urls if url][:VEHICLE_MAX_PHOTOS]
    if not image_urls:
        raise HTTPException(status_code=404, detail="This vehicle has no images")

    import httpx
    zip_buffer = BytesIO()
    safe_title = re.sub(
        r"[^a-zA-Z0-9]+",
        "-",
        f"{vehicle.get('year') or ''}-{vehicle.get('make') or ''}-{vehicle.get('model') or ''}"
    ).strip("-") or "vehicle"

    downloaded = 0
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for index, url in enumerate(image_urls, start=1):
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].lower()
                    extension = {
                        "image/jpeg": ".jpg",
                        "image/jpg": ".jpg",
                        "image/png": ".png",
                        "image/webp": ".webp",
                        "image/gif": ".gif",
                    }.get(content_type)
                    if not extension:
                        url_path = str(url).split("?", 1)[0].lower()
                        extension = next((ext for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif") if url_path.endswith(ext)), ".jpg")
                        if extension == ".jpeg":
                            extension = ".jpg"
                    archive.writestr(f"{safe_title}-{index}{extension}", response.content)
                    downloaded += 1
                except Exception as exc:
                    print(f"Vehicle image ZIP skipped {url}: {exc}")

    if downloaded == 0:
        raise HTTPException(status_code=502, detail="Could not download the vehicle images")

    zip_buffer.seek(0)
    filename = f"{safe_title}-images.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )

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
        '<style>' + AGENT_CSS + '</style></head><body data-business-public-id="' + html_lib.escape(business_public_id) + '">'
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
        return HTMLResponse("<div style='padding:40px;text-align:center;font-family:sans-serif'><h1>Card not found</h1></div>")

    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        return HTMLResponse("<div style='padding:40px;text-align:center;font-family:sans-serif'><h1>Business not found</h1></div>")

    program = safe_get_loyalty_program(business.get('id')) or {}
    design = wallet_20_design(business, program)
    card_type = program.get('card_type', 'stamp')
    business_name = business.get('name') or 'LoyaltyTree'
    customer_name = customer.get('name') or 'Member'
    logo_url = program.get('program_logo_url') or business.get('logo_url')
    hero_url = program.get('hero_image_url') if design['show_background'] else None
    description = program.get('description') or ''
    reward_name = program.get('reward_name') or 'Reward'

    labels = {
        'stamp': 'STAMP CARD',
        'points': 'POINTS CARD',
        'membership': 'MEMBERSHIP CARD',
        'multipass': 'MULTIPASS',
        'vip': 'VIP CARD',
    }
    card_label = labels.get(card_type, 'LOYALTY CARD')

    metric_label = 'STAMPS'
    metric_value = ''
    metric_sub = ''
    details = []

    if card_type == 'points':
        points = int(customer.get('points_balance') or 0)
        metric_label, metric_value, metric_sub = 'POINTS BALANCE', f'{points:,}', 'points'
        details = [('Reward', reward_name)]
    elif card_type == 'multipass':
        remaining = int(customer.get('multipass_sessions_remaining') or 0)
        total = int(customer.get('multipass_total_sessions') or program.get('multipass_session_count') or 0)
        metric_label, metric_value, metric_sub = 'SESSIONS LEFT', f'{remaining} / {total}', 'sessions'
        details = [('Valid until', customer.get('multipass_expires_at') or 'No expiry')]
    elif card_type == 'membership':
        status = membership_effective_status(customer).upper()
        summary = get_membership_summary(business.get('id'), customer.get('id'))
        metric_label, metric_value, metric_sub = 'STATUS', status, 'member'
        details = [
            ('Active until', customer.get('membership_expires_at') or ('Lifetime' if status == 'LIFETIME' else '—')),
            ('Member since', str(customer.get('membership_started_at') or '—')[:10]),
            ('Visits', str(int((summary or {}).get('total_visits') or 0))),
        ]
    elif card_type == 'vip':
        tier = get_vip_tier(customer, program)
        next_tier = get_next_vip_tier(customer, program)
        points = int(customer.get('vip_points') or 0)
        metric_label = 'VIP TIER'
        metric_value = str(tier.get('name') or 'VIP').upper()
        metric_sub = f'{points:,} VIP points'
        details = [('Next tier', str((next_tier or {}).get('name') or 'Top tier'))]
    else:
        goal = int(program.get('stamp_goal') or 8)
        current = min(int(customer.get('stamp_count') or 0), goal)
        metric_value = f'{current} / {goal}'
        remaining = max(goal - current, 0)
        metric_sub = reward_name if remaining == 0 else f'{remaining} more to {reward_name}'
        details = [('Reward', reward_name)]

    if description:
        details.append(('About', description))
    category = design['category']
    details.append(('Business type', f"{category['icon']} {category['label']}"))

    details_html = ''.join(
        '<div class="detail"><span>' + html_lib.escape(str(k)) + '</span><strong>' + html_lib.escape(str(v)) + '</strong></div>'
        for k, v in details[:4]
    )

    logo_html = (
        '<img class="logo" src="' + html_lib.escape(logo_url) + '" alt="Logo">'
        if logo_url else
        '<div class="logo fallback">' + html_lib.escape(category['icon']) + '</div>'
    )
    hero_html = (
        '<img class="hero" src="' + html_lib.escape(hero_url) + '" alt="">'
        if hero_url else ''
    )

    qr_image = "https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=" + quote(
        f"{BASE_URL}/stamp/{customer_public_id}", safe=""
    )

    obj = build_loyalty_object(customer, business, program)
    jwt_token = create_google_wallet_jwt(obj)
    google_wallet_url = (
        "https://pay.google.com/gp/v/save/" + jwt_token
        if jwt_token else ""
    )
    apple_wallet_url = (
        BASE_URL + "/api/v1/customer/" + customer_public_id + "/apple-wallet-pass"
    )

    active_class = ' active' if metric_value in ('ACTIVE', 'LIFETIME') else ''

    html = f'''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html_lib.escape(business_name)}</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#080b12;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}}
.wrap{{max-width:1120px;margin:auto;padding:24px 16px 44px}}
.top{{display:flex;justify-content:space-between;color:#8390a5;font-size:12px;margin-bottom:14px}}
.top b{{color:#fff}}
.card{{position:relative;overflow:hidden;isolation:isolate;aspect-ratio:1.72/1;min-height:320px;border-radius:28px;padding:clamp(22px,4vw,44px);background:linear-gradient(135deg,{design["background"]},{design["secondary"]});border:1px solid rgba(255,255,255,.14);box-shadow:0 28px 80px rgba(0,0,0,.46)}}
.hero{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-3}}
.card:before{{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,6,16,.86),rgba(3,6,16,.63) 52%,rgba(3,6,16,.26));z-index:-2}}
.grid{{height:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,29%);gap:clamp(18px,4vw,48px)}}
.left{{display:flex;flex-direction:column;min-width:0}}.brand{{display:flex;align-items:center;gap:13px}}
.logo{{width:58px;height:58px;border-radius:16px;object-fit:cover;background:#fff;border:1px solid rgba(255,255,255,.3)}}.fallback{{display:grid;place-items:center;font-size:27px;background:rgba(255,255,255,.12)}}
.biz{{font-size:clamp(20px,3vw,34px);font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.type{{font-size:10px;letter-spacing:1.4px;font-weight:800;color:rgba(255,255,255,.62);margin-top:6px}}
.member{{margin-top:auto}}.eyebrow{{font-size:9px;letter-spacing:1.3px;font-weight:800;color:rgba(255,255,255,.58)}}.name{{font-size:clamp(25px,4.5vw,48px);font-weight:720;line-height:1.06;margin:7px 0 20px}}
.metric{{font-size:clamp(30px,5vw,54px);font-weight:850;line-height:.95;margin-top:6px}}.metric.active{{color:#4ade80}}.sub{{font-size:11px;color:rgba(255,255,255,.72);margin-top:7px}}
.right{{display:flex;flex-direction:column;justify-content:center;align-items:flex-end}}.qrbox{{width:min(100%,260px);padding:11px;background:#fff;border-radius:19px;box-shadow:0 14px 35px rgba(0,0,0,.28)}}.qrbox img{{display:block;width:100%;aspect-ratio:1/1}}.scan{{font-size:9px;letter-spacing:1.2px;font-weight:800;color:rgba(255,255,255,.62);margin:10px auto 0}}
.details{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}}.detail{{background:#111827;border:1px solid #202a3b;border-radius:13px;padding:12px 13px;min-width:0}}.detail span{{display:block;color:#75839a;font-size:9px;text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px}}.detail strong{{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}}
.actions{{display:grid;grid-template-columns:1fr;gap:10px;margin-top:13px}}
.btn,.share{{border:0;border-radius:12px;padding:14px;text-align:center;text-decoration:none;font-weight:750;font-size:13px;cursor:pointer}}
.wallet{{background:#fff;color:#050505;width:100%}}
.share{{background:#151b28;color:#dbe4f1;border:1px solid #273247}}
.wallet-chooser{{display:none;background:#111827;border:1px solid #273247;border-radius:13px;padding:10px;margin-top:-2px}}
.wallet-chooser.open{{display:grid;gap:8px}}
.wallet-choice{{display:block;width:100%;border:0;border-radius:10px;padding:12px;text-align:center;text-decoration:none;font-weight:750;font-size:13px;cursor:pointer}}
.wallet-choice.apple{{background:#fff;color:#050505}}
.wallet-choice.google{{background:#1a73e8;color:#fff}}
.wallet-choice.disabled{{opacity:.5;cursor:not-allowed}}
.wallet-note{{font-size:10px;color:#8390a5;text-align:center;margin:1px 0 0}}
@media(max-width:680px){{.wrap{{padding:12px 9px 30px}}.card{{min-height:245px;aspect-ratio:1.58/1;padding:16px;border-radius:20px}}.grid{{grid-template-columns:minmax(0,1fr) 34%;gap:11px}}.logo{{width:39px;height:39px;border-radius:10px}}.biz{{font-size:17px}}.type{{font-size:7px}}.name{{font-size:21px;margin:5px 0 11px}}.metric{{font-size:25px}}.sub{{font-size:8px}}.qrbox{{padding:7px;border-radius:11px}}.scan{{font-size:6px;margin-top:6px}}.details{{grid-template-columns:1fr 1fr}}}}
</style></head>
<body><main class="wrap">
<div class="top"><b>🌳 LoyaltyTree</b><span>{html_lib.escape(card_label)}</span></div>
<section class="card">{hero_html}<div class="grid">
<div class="left"><div class="brand">{logo_html}<div><div class="biz">{html_lib.escape(business_name)}</div><div class="type">{html_lib.escape(card_label)}</div></div></div>
<div class="member"><div class="eyebrow">MEMBER</div><div class="name">{html_lib.escape(customer_name)}</div><div class="eyebrow">{html_lib.escape(metric_label)}</div><div class="metric{active_class}">{html_lib.escape(metric_value)}</div><div class="sub">{html_lib.escape(metric_sub)}</div></div></div>
<div class="right"><div class="qrbox"><img src="{qr_image}" alt="Member QR"></div><div class="scan">PRESENT TO CHECK IN</div></div>
</div></section>
<section class="details">{details_html}</section>
<section class="actions">
<button class="btn wallet" id="add-wallet" type="button">Add to Wallet</button>
<div class="wallet-chooser" id="wallet-chooser">
  <a class="wallet-choice apple" id="apple-wallet-choice" href="{html_lib.escape(apple_wallet_url)}">Apple Wallet</a>
  <a class="wallet-choice google{' disabled' if not google_wallet_url else ''}" id="google-wallet-choice" href="{html_lib.escape(google_wallet_url) if google_wallet_url else '#'}">Google Wallet</a>
  <div class="wallet-note">Choose the wallet for this device.</div>
</div>
<button class="share" id="share">Share Card</button>
</section>
</main><script>
const appleWalletUrl={json.dumps(apple_wallet_url)};
const googleWalletUrl={json.dumps(google_wallet_url)};
const walletChooser=document.getElementById("wallet-chooser");

document.getElementById("add-wallet").onclick=()=>{{
  const ua=navigator.userAgent||"";
  const platform=navigator.platform||"";
  const touchPoints=navigator.maxTouchPoints||0;
  const isAppleMobile=/iPhone|iPad|iPod/i.test(ua)||(platform==="MacIntel"&&touchPoints>1);
  const isAndroid=/Android/i.test(ua);

  if(isAppleMobile){{
    window.location.href=appleWalletUrl;
    return;
  }}
  if(isAndroid){{
    if(googleWalletUrl){{
      window.location.href=googleWalletUrl;
    }}else{{
      alert("Google Wallet is not available for this card right now.");
    }}
    return;
  }}

  walletChooser.classList.toggle("open");
}};

document.getElementById("google-wallet-choice").onclick=(e)=>{{
  if(!googleWalletUrl){{
    e.preventDefault();
    alert("Google Wallet is not available for this card right now.");
  }}
}};

document.getElementById("share").onclick=async()=>{{const p={{title:{json.dumps(business_name)},text:"My LoyaltyTree card",url:location.href}};if(navigator.share){{try{{await navigator.share(p)}}catch(e){{}}}}else{{await navigator.clipboard.writeText(location.href);alert("Card link copied")}}}};
</script></body></html>'''
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

    # multipass/vip/membership are only computed when that program type is
    # actually active - keeps this cheap and avoids calling vip-tier helpers
    # against a program dict that isn't shaped like a VIP program.
    default_vip_tier = {'id': 'vip', 'name': 'VIP', 'threshold': 0, 'color': '#111827', 'discount_percent': 0, 'benefits': []}
    vip_tier_data = get_vip_tier(customer, program) if (program and card_type == 'vip') else default_vip_tier
    vip_next_tier_data = get_next_vip_tier(customer, program) if (program and card_type == 'vip') else None

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
        'multipass_sessions_remaining': customer.get('multipass_sessions_remaining', 0) or 0,
        'multipass_total_sessions': customer.get('multipass_total_sessions', 0) or 0,
        'multipass_expires_at': customer.get('multipass_expires_at'),
        'vip_points': int(customer.get('vip_points') or 0),
        'vip_tier': vip_tier_data,
        'vip_next_tier': vip_next_tier_data,
        'membership_status': membership_effective_status(customer),
    }
    data_json = json.dumps(data)
    page_title = {'points': 'Add Points', 'multipass': 'Use Session', 'vip': 'Add VIP Sale', 'membership': 'Log Visit'}.get(card_type, 'Add Stamp')

    head = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        '<title>' + page_title + ' - ' + html_lib.escape(business.get('name', '')) + '</title>'
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
        'let multipassRemaining=DATA.multipass_sessions_remaining;'
        'let multipassTotal=DATA.multipass_total_sessions;'
        'let vipPoints=DATA.vip_points;'
        'let vipTier=DATA.vip_tier;'
        'let vipNextTier=DATA.vip_next_tier;'
        'let membershipStatus=DATA.membership_status;'
        'let cachedPin=null;'
        'const app=document.getElementById("app");'
        'const sessionKey="loyaltree_cashier_"+DATA.business_public_id;'
        'const deviceKey="loyaltree_cashier_device_id";'
        'function getDeviceId(){try{let id=localStorage.getItem(deviceKey);if(!id){id=(crypto&&crypto.randomUUID)?crypto.randomUUID():("web-"+Date.now()+"-"+Math.random().toString(36).slice(2));localStorage.setItem(deviceKey,id);}return id;}catch(e){return "web-"+Date.now()+"-"+Math.random().toString(36).slice(2);}}'

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
        'method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email,pin:pin,device_id:getDeviceId()})'
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

        'function renderMultipassBody(){'
        'const today=new Date().toISOString().slice(0,10);'
        'const expired=DATA.multipass_expires_at&&DATA.multipass_expires_at<today;'
        'if(expired){'
        'return "<div class=\'msg msg-err\'>This pass expired on "+escapeHtml(DATA.multipass_expires_at)+". Issue a new pass from the dashboard.</div>";'
        '}'
        'if(multipassRemaining<=0){'
        'return "<div class=\'msg msg-err\'>No sessions left on this pass. Issue a new pass from the dashboard.</div>";'
        '}'
        'return "<button class=\'btn-primary\' id=\'multipassBtn\'>Use 1 Session</button>";'
        '}'

        'function renderVipBody(){'
        'const tier=vipTier||{};'
        'const tierHtml="<div style=\'text-align:center;margin-bottom:14px\'>"+'
        '"<div style=\'display:inline-block;padding:6px 16px;border-radius:999px;background:"+(tier.color||"#111827")+";color:white;font-weight:700;font-size:13px\'>"+escapeHtml(tier.name||"VIP")+"</div>"+'
        '(vipNextTier?"<div style=\'font-size:12px;color:#94a3b8;margin-top:6px\'>"+Math.max(0,vipNextTier.threshold-vipPoints)+" pts to "+escapeHtml(vipNextTier.name)+"</div>":"")+'
        '"</div>";'
        'return tierHtml+'
        '"<input id=\'vipAmount\' type=\'number\' inputmode=\'decimal\' min=\'0\' placeholder=\'Amount spent\'>"+'
        '"<button class=\'btn-primary\' id=\'vipBtn\'>Add VIP Sale</button>";'
        '}'

        'function renderMembershipBody(){'
        'if(membershipStatus!=="active"&&membershipStatus!=="lifetime"){'
        'return "<div class=\'msg msg-err\'>Membership is "+escapeHtml(membershipStatus)+". Activate or renew it from the dashboard before logging a visit.</div>";'
        '}'
        'return "<input id=\'serviceName\' type=\'text\' placeholder=\'Service (e.g. Teeth cleaning)\'>"+'
        '"<input id=\'serviceNote\' type=\'text\' placeholder=\'Note (optional)\'>"+'
        '"<button class=\'btn-primary\' id=\'membershipBtn\'>Log Visit</button>";'
        '}'

        'function attachBodyListeners(){'
        'if(cardType==="points"){'
        'const pointsBtn=document.getElementById("pointsBtn");'
        'if(pointsBtn)pointsBtn.addEventListener("click",doPoints);'
        'const prizeBtns=document.querySelectorAll(".prizeRedeemBtn");'
        'for(let i=0;i<prizeBtns.length;i++){'
        'prizeBtns[i].addEventListener("click",function(e){doRedeemPrize(e.currentTarget.getAttribute("data-prize-id"));});'
        '}'
        '}else if(cardType==="multipass"){'
        'const multipassBtn=document.getElementById("multipassBtn");'
        'if(multipassBtn)multipassBtn.addEventListener("click",doMultipass);'
        '}else if(cardType==="vip"){'
        'const vipBtn=document.getElementById("vipBtn");'
        'if(vipBtn)vipBtn.addEventListener("click",doVip);'
        '}else if(cardType==="membership"){'
        'const membershipBtn=document.getElementById("membershipBtn");'
        'if(membershipBtn)membershipBtn.addEventListener("click",doMembershipNote);'
        '}else{'
        'const stampBtn=document.getElementById("stampBtn");'
        'if(stampBtn)stampBtn.addEventListener("click",doStamp);'
        'const redeemBtn=document.getElementById("redeemBtn");'
        'if(redeemBtn)redeemBtn.addEventListener("click",doRedeem);'
        '}'
        '}'

        'function renderCard(staffName,msg){'
        'const bodyHtml=cardType==="points"?renderPointsBody():cardType==="multipass"?renderMultipassBody():cardType==="vip"?renderVipBody():cardType==="membership"?renderMembershipBody():renderStampBody();'
        'const couponHtml=couponText?"<div class=\'coupon\'>&#127903; "+escapeHtml(couponText)+"</div>":"";'
        'const statsHtml=cardType==="points"?(pointsBalance+" points"):cardType==="multipass"?(multipassRemaining+" / "+multipassTotal+" sessions"):cardType==="vip"?(escapeHtml((vipTier&&vipTier.name)||"VIP")+" &bull; "+vipPoints+" pts"):cardType==="membership"?("Membership: "+escapeHtml(membershipStatus)):(stampCount+" / "+DATA.stamp_goal+" stamps");'
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

        'async function doMultipass(){'
        'const btn=document.getElementById("multipassBtn");'
        'btn.disabled=true;btn.textContent="Using...";'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/multipass/use",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'multipassRemaining=d.sessions_remaining;multipassTotal=d.sessions_total;'
        'renderCard(s?s.name:"",{ok:true,text:"Session used! "+multipassRemaining+" left."});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not use session"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error - session not used"});'
        '}'
        '}'

        'async function doVip(){'
        'const input=document.getElementById("vipAmount");'
        'const amount=parseFloat(input?input.value:"");'
        'if(!amount||amount<=0){renderCard(getSession()?getSession().name:"",{ok:false,text:"Enter an amount spent first"});return;}'
        'const btn=document.getElementById("vipBtn");'
        'btn.disabled=true;btn.textContent="Adding...";'
        'const s=getSession();'
        'try{'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/vip-sale",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,amount_spent:amount,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'vipPoints=d.vip_points;vipTier=d.tier;vipNextTier=d.next_tier;'
        'renderCard(s?s.name:"",{ok:true,text:"+"+d.points_earned+" VIP points! Now "+(d.tier&&d.tier.name?d.tier.name:"VIP")+"."});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not add VIP sale"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error - sale not added"});'
        '}'
        '}'

        'async function doMembershipNote(){'
        'const nameInput=document.getElementById("serviceName");'
        'const noteInput=document.getElementById("serviceNote");'
        'const serviceName=(nameInput?nameInput.value:"").trim();'
        'if(!serviceName){renderCard(getSession()?getSession().name:"",{ok:false,text:"Enter the service name first"});return;}'
        'const btn=document.getElementById("membershipBtn");'
        'btn.disabled=true;btn.textContent="Logging...";'
        'const s=getSession();'
        'try{'
        'const noteVal=(noteInput?noteInput.value:"").trim();'
        'const res=await fetch("/api/v1/business/"+DATA.business_public_id+"/membership/note",{'
        'method:"POST",headers:authHeaders(),'
        'body:JSON.stringify({customer_public_id:DATA.customer_public_id,service_name:serviceName,'
        'note:noteVal?noteVal:undefined,'
        'staff_pin:getSession()?undefined:cachedPin})'
        '});'
        'const d=await res.json();'
        'if(res.ok){'
        'renderCard(s?s.name:"",{ok:true,text:"Visit logged: "+serviceName});'
        '}else if(res.status===401){'
        'clearSession();renderLogin(d.detail||"Session expired - log in again");'
        '}else{'
        'renderCard(s?s.name:"",{ok:false,text:d.detail||"Could not log visit"});'
        '}'
        '}catch(e){'
        'renderCard(s?s.name:"",{ok:false,text:"Network error - visit not logged"});'
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

@app.get("/api/v1/public/business/{public_id}/join-config")
async def public_business_join_config(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    program = safe_get_loyalty_program(business.get('id')) or {}
    category = business_category_meta(business.get('business_type'))
    return {
        'public_id': business.get('public_id'),
        'name': business.get('name'),
        'logo_url': business.get('logo_url'),
        'business_type': normalize_business_type(business.get('business_type')),
        'category': category,
        'card_type': program.get('card_type', 'stamp'),
        'primary_color': program.get('primary_color') or category['color'],
        'card_name': program.get('card_name'),
    }

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

    google_class_ready = True
    if card_type == 'vip':
        google_class_ready = ensure_google_wallet_vip_class(customer, business, program or {})
        if not google_class_ready:
            print(
                "WALLET-PASS: VIP tier Google class is not ready for "
                f"{loyalty_object.get('classId')}"
            )

    jwt_token = create_google_wallet_jwt(loyalty_object) if google_class_ready else ''
    save_url = f"https://pay.google.com/gp/v/save/{jwt_token}" if jwt_token else None
    if not jwt_token:
        if card_type == 'vip' and not google_class_ready:
            print("WALLET-PASS: Google Save URL withheld because VIP tier class could not be created")
        else:
            print("WALLET-PASS: Google JWT generation failed (check GOOGLE_WALLET_CREDENTIALS)")

    print(f"WALLET-PASS: Prepared pass data for customer {customer_public_id}")

    contactless_ready = bool(contactless_member_token(customer_public_id))
    nfc_trial_active = bool(card_type == 'membership' and program and program.get('nfc_trial_enabled'))
    nfc_status = {
        'trial_enabled': nfc_trial_active,
        'membership_only': True,
        'token_ready': contactless_ready,
        'google_smart_tap_configured': bool(nfc_trial_active and contactless_ready and GOOGLE_SMART_TAP_ENABLED and GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID),
        'apple_nfc_configured': bool(nfc_trial_active and contactless_ready and APPLE_NFC_ENABLED and APPLE_NFC_ENCRYPTION_PUBLIC_KEY),
        'qr_fallback_enabled': True,
    }

    return {
        'nfc_status': nfc_status,
        # Shape WalletPass.jsx renders the card from. card_type tells the
        # frontend whether to render the stamp grid or the points balance -
        # stamps/goal/reward_unlocked stay stamp-only, points_balance/
        # points_prizes stay points-only, so either UI can be built without
        # the other's fields being misleadingly present.
        "pass_data": {
            "business_name": business.get('name', ''),
            "business_type": normalize_business_type(business.get('business_type')),
            "business_category": business_category_meta(business.get('business_type')),
            "customer_name": customer.get('name', ''),
            "customer_id": customer_public_id,
            "card_type": card_type,
            "card_name": program.get('card_name') if program else None,
            "description": program.get('description') if program else None,
            "program_logo_url": (program.get('program_logo_url') if program else None) or business.get('logo_url'),
            "hero_image_url": program.get('hero_image_url') if program else None,
            "wallet_design": wallet_20_design(business, program),
            "stamps": customer.get('stamp_count', 0),
            "goal": stamp_goal,
            "reward_name": reward_name,
            "points_balance": customer.get('points_balance', 0),
            "points_prizes": points_prizes,
            "sessions_remaining": sessions_remaining,
            "sessions_total": sessions_total,
            "multipass_description": multipass_description,
            "multipass_expires_at": multipass_expires_at,
            "multipass_expired": multipass_expired,
            "membership_services": membership_services,
            "membership_status": customer.get('membership_status'),
            "membership_effective_status": membership_effective_status(customer) if card_type == 'membership' else None,
            "membership_started_at": customer.get('membership_started_at'),
            "membership_expires_at": customer.get('membership_expires_at'),
            "membership_terms": program.get('membership_terms') if program else None,
            "total_visits": (membership_summary['total_visits'] if membership_summary else 0),
            "last_service_name": (membership_summary['last_service_name'] if membership_summary else None),
            "last_service_date": (membership_summary['last_service_date'] if membership_summary else None),
            "vip_points": customer.get('vip_points', 0),
            "vip_tier": get_vip_tier(customer, program or {}) if card_type == 'vip' else None,
            "vip_next_tier": get_next_vip_tier(customer, program or {}) if card_type == 'vip' else None,
            "primary_color": primary_color,
            "reward_unlocked": bool(customer.get('reward_unlocked')),
            "qr_code": f"{BASE_URL}/stamp/{customer_public_id}",
        },
        "save_url": save_url,
        "google_class_ready": google_class_ready,
        "google_class_id": loyalty_object.get("classId"),
        "apple_pass_url": f"{BASE_URL}/api/v1/customer/{customer_public_id}/apple-wallet-pass",
        "loyalty_object": loyalty_object,
    }

@app.get("/api/v1/customer/{customer_public_id}/apple-wallet-pass")
async def get_apple_wallet_pass(customer_public_id: str):
    """Direct .pkpass download - optimized for the first Add to Wallet tap.

    The route logs phase timings so a slow client/network interaction is not
    mistaken for slow pass generation.
    """
    t0 = time.perf_counter()
    print(f"APPLE PASS START: {customer_public_id}")
    customer = safe_get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    program = safe_get_loyalty_program(business.get('id'))
    announcement = get_latest_active_announcement(business.get('id'))
    t_data = time.perf_counter()

    pkpass_bytes = _get_cached_apple_pkpass(customer, business, program or {}, announcement)
    cache_hit = pkpass_bytes is not None
    if not cache_hit:
        pkpass_bytes = build_pkpass_bytes(customer, business, program or {}, announcement)
        if pkpass_bytes:
            _cache_apple_pkpass(customer, business, program or {}, announcement, pkpass_bytes)

    t_build = time.perf_counter()
    print(
        f"APPLE PASS READY: {customer_public_id} "
        f"cache={'HIT' if cache_hit else 'MISS'} "
        f"data_ms={(t_data-t0)*1000:.0f} build_ms={(t_build-t_data)*1000:.0f} "
        f"total_ms={(t_build-t0)*1000:.0f} bytes={len(pkpass_bytes) if pkpass_bytes else 0}"
    )
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
        headers={
            "Content-Disposition": f'attachment; filename="{customer_public_id}.pkpass"',
            "Cache-Control": "no-store",
            "Content-Length": str(len(pkpass_bytes)),
        },
    )

# CUSTOMER SATISFACTION
class SatisfactionFeedbackSubmit(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    service_rating: Optional[int] = Field(default=None, ge=1, le=5)
    quality_rating: Optional[int] = Field(default=None, ge=1, le=5)
    value_rating: Optional[int] = Field(default=None, ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=1200)

def _feedback_summary(rows: list) -> dict:
    ratings=[int(r.get("rating") or 0) for r in rows if int(r.get("rating") or 0) in (1,2,3,4,5)]
    def avg(key):
        vals=[int(r.get(key) or 0) for r in rows if int(r.get(key) or 0) in (1,2,3,4,5)]
        return round(sum(vals)/len(vals),2) if vals else None
    return {"response_count":len(ratings),"average_rating":round(sum(ratings)/len(ratings),2) if ratings else None,"positive_percent":round(sum(1 for x in ratings if x>=4)*100/len(ratings),1) if ratings else 0,"service_average":avg("service_rating"),"quality_average":avg("quality_rating"),"value_average":avg("value_rating")}

@app.get("/feedback/{customer_public_id}", response_class=HTMLResponse)
async def customer_satisfaction_page(customer_public_id: str):
    customer=safe_get_customer(customer_public_id)
    if not customer: raise HTTPException(status_code=404, detail="Customer not found")
    business=safe_get_business_by_id(customer.get("business_id"))
    if not business: raise HTTPException(status_code=404, detail="Business not found")
    biz=html_lib.escape(str(business.get("name") or business.get("business_name") or "Business")); name=html_lib.escape(str(customer.get("name") or "Customer"))
    page=f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Rate your experience</title><style>*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a}}main{{max-width:620px;margin:0 auto;min-height:100vh;background:white;padding:28px 20px}}header{{text-align:center;padding:20px 0 28px}}h1{{margin:6px 0}}p{{color:#64748b}}.stars{{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0 24px}}button.star{{font-size:25px;padding:14px 4px;background:white;border:1px solid #dbe4ea;border-radius:12px}}button.star.on{{background:#ecfdf5;border-color:#14b8a6}}.cats{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}}.cat{{border:1px solid #e2e8f0;border-radius:12px;padding:10px}}.mini{{display:flex;gap:4px;margin-top:7px}}.mini button{{flex:1;border:0;border-radius:7px;padding:7px 2px}}.mini button.on{{background:#ccfbf1;color:#0f766e;font-weight:800}}textarea{{width:100%;min-height:110px;margin-top:18px;padding:12px;border:1px solid #cbd5e1;border-radius:12px}}#send{{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;background:#0d9488;color:white;font-weight:800}}#thanks{{display:none;text-align:center;padding:40px 10px}}@media(max-width:520px){{.cats{{grid-template-columns:1fr}}}}</style></head><body><main><header><b>{biz}</b><h1>How was your experience?</h1><p>Hi {name}. Your feedback helps us serve you better.</p></header><form id='f'><b>Overall experience</b><div class='stars' id='stars'>{''.join(f"<button type='button' class='star' data-v='{i}'>⭐</button>" for i in range(1,6))}</div><div class='cats'>{''.join(f"<div class='cat'><b>{label}</b><div class='mini' data-k='{key}'>"+''.join(f"<button type='button' data-v='{i}'>{i}</button>" for i in range(1,6))+"</div></div>" for label,key in [('Service','service_rating'),('Quality','quality_rating'),('Value','value_rating')])}</div><textarea id='comment' maxlength='1200' placeholder='Tell us more (optional)'></textarea><button id='send' disabled>Submit Feedback</button><p id='msg'></p></form><div id='thanks'><h2>🌱 Thank you!</h2><p>Your feedback has been shared with {biz}.</p></div></main><script>const s={{rating:null,service_rating:null,quality_rating:null,value_rating:null}};document.querySelectorAll('.star').forEach(b=>b.onclick=()=>{{s.rating=+b.dataset.v;document.querySelectorAll('.star').forEach(x=>x.classList.toggle('on',+x.dataset.v<=s.rating));send.disabled=false}});document.querySelectorAll('.mini').forEach(g=>g.querySelectorAll('button').forEach(b=>b.onclick=()=>{{s[g.dataset.k]=+b.dataset.v;g.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))}}));f.onsubmit=async e=>{{e.preventDefault();send.disabled=true;send.textContent='Sending…';try{{let r=await fetch('/api/v1/customer/{customer_public_id}/feedback',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{...s,comment:comment.value.trim()||null}})}});let d=await r.json().catch(()=>({{}}));if(!r.ok)throw Error(d.detail||'Could not submit feedback');f.style.display='none';thanks.style.display='block'}}catch(e){{msg.textContent=e.message;send.disabled=false;send.textContent='Submit Feedback'}}}};</script></body></html>"""
    return HTMLResponse(page)

@app.post("/api/v1/customer/{customer_public_id}/feedback")
async def submit_customer_satisfaction(customer_public_id: str, item: SatisfactionFeedbackSubmit):
    if not supabase: raise HTTPException(status_code=503, detail="Database not connected")
    customer=safe_get_customer(customer_public_id)
    if not customer: raise HTTPException(status_code=404, detail="Customer not found")
    business=safe_get_business_by_id(customer.get("business_id"))
    if not business: raise HTTPException(status_code=404, detail="Business not found")
    row={"public_id":str(uuid.uuid4()),"business_id":business.get("id"),"customer_id":customer.get("id"),"rating":item.rating,"service_rating":item.service_rating,"quality_rating":item.quality_rating,"value_rating":item.value_rating,"comment":(item.comment or "").strip() or None,"source":"wallet","created_at":datetime.now(timezone.utc).isoformat()}
    try:
        result=supabase.table("customer_feedback").insert(row).execute(); return {"ok":True,"feedback_public_id":(result.data or [row])[0].get("public_id")}
    except Exception as e: raise HTTPException(status_code=500, detail=friendly_db_error(e))

@app.get("/api/v1/business/{public_id}/feedback")
async def get_business_satisfaction(public_id: str, authorization: str = Header(default='')):
    require_owner_session(public_id, authorization)
    if not supabase: raise HTTPException(status_code=503, detail="Database not connected")
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404, detail="Business not found")
    try:
        rows=supabase.table("customer_feedback").select("*").eq("business_id",business.get("id")).order("created_at",desc=True).limit(250).execute().data or []
        ids=list({r.get("customer_id") for r in rows if r.get("customer_id")}); customers=supabase.table("customers").select("id,public_id,name").in_("id",ids).execute().data or [] if ids else []; by={c.get("id"):c for c in customers}
        return {"summary":_feedback_summary(rows),"feedback":[{**r,"customer_name":(by.get(r.get("customer_id")) or {}).get("name") or "Customer"} for r in rows]}
    except Exception as e: raise HTTPException(status_code=500, detail=friendly_db_error(e))

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

    # Apple expects this endpoint to return ONLY passes that changed after
    # passesUpdatedSince. Returning every registered serial on every poll makes
    # Wallet fetch unchanged .pkpass files and produces the device-log warning
    # "Server requested update ... but the pass was unchanged."
    since_ts = _parse_ts(passesUpdatedSince)
    changed_serials = []
    newest_ts = since_ts

    for serial in serials:
        try:
            if serial.startswith('cl-'):
                customer = safe_get_cl_customer(serial[len('cl-'):])
                if not customer:
                    continue
                business = safe_get_business_by_id(customer.get('business_id'))
                contract = get_active_contract_for_cl_customer(customer.get('id'))
                announcement = get_latest_cl_announcement(business.get('id')) if business else None
                raw_values = [
                    customer.get('updated_at'),
                    (contract or {}).get('updated_at'),
                    (announcement or {}).get('updated_at') or (announcement or {}).get('created_at'),
                    _apple_pass_dirty_at(serial),
                ]
            else:
                customer = safe_get_customer(serial)
                if not customer:
                    continue
                business = safe_get_business_by_id(customer.get('business_id'))
                program = safe_get_loyalty_program(business.get('id')) if business else None
                announcement = get_latest_active_announcement(business.get('id')) if business else None
                raw_values = [
                    customer.get('updated_at'),
                    business.get('updated_at') if business else None,
                    (program or {}).get('updated_at') or (program or {}).get('created_at'),
                    (announcement or {}).get('updated_at') or (announcement or {}).get('created_at'),
                    _apple_pass_dirty_at(serial),
                ]

            pass_times = [_parse_ts(v) for v in raw_values if v]
            pass_times = [t for t in pass_times if t]
            pass_ts = max(pass_times) if pass_times else None

            # No update tag from Wallet means initial sync: return all passes.
            # Otherwise return only genuinely newer passes. HTTP dates only have
            # second precision, so compare at second precision too.
            if since_ts is None or (pass_ts and pass_ts.replace(microsecond=0) > since_ts.replace(microsecond=0)):
                changed_serials.append(serial)
            if pass_ts and (newest_ts is None or pass_ts > newest_ts):
                newest_ts = pass_ts
        except Exception as e:
            # A single stale/bad registration must not break updates for every
            # other pass on the device. Skip it and log for cleanup.
            print(f"APPLE WALLET update-list skip {serial}: {e}")

    if not changed_serials:
        return Response(status_code=204)

    # lastUpdated is an opaque update tag to Wallet. ISO UTC is convenient
    # because this server can parse it on the next passesUpdatedSince request.
    marker = (newest_ts or datetime.utcnow()).replace(tzinfo=None).isoformat()
    return {"serialNumbers": changed_serials, "lastUpdated": marker}

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
        if (last_modified_ts and since_ts and
                last_modified_ts.replace(microsecond=0) <= since_ts.replace(microsecond=0)):
            return Response(status_code=304)

        pkpass_bytes = build_cl_pkpass_bytes(customer, business, contract, announcement, reminder_text)
        if pkpass_bytes is None:
            raise HTTPException(status_code=500, detail="Could not build pass")
        return Response(
            content=pkpass_bytes,
            media_type="application/vnd.apple.pkpass",
            headers={"Last-Modified": _http_date(last_modified)},
        )

    customer = safe_get_customer(serial_number)
    if not customer:
        raise HTTPException(status_code=404, detail="Not found")
    business = safe_get_business_by_id(customer.get('business_id'))
    if not business:
        raise HTTPException(status_code=404, detail="Not found")

    announcement = get_latest_active_announcement(business.get('id'))
    program = safe_get_loyalty_program(business.get('id'))

    # IMPORTANT: Last-Modified must represent the *whole generated pass*, not
    # only the customer row. Apple sends If-Modified-Since after an APNs wake.
    # If a layout/banner/reward/tier change marks a pass dirty but this endpoint
    # compares only customer.updated_at, Wallet receives 304 and keeps the old
    # design forever. Include every source that can change pass.json/artwork.
    customer_ts = _parse_ts(customer.get('updated_at'))
    business_ts = _parse_ts(business.get('updated_at'))
    program_ts_raw = (program or {}).get('updated_at') or (program or {}).get('created_at')
    program_ts = _parse_ts(program_ts_raw)
    ann_ts_raw = (announcement or {}).get('updated_at') or (announcement or {}).get('created_at')
    ann_ts = _parse_ts(ann_ts_raw)
    dirty_ts = _apple_pass_dirty_at(serial_number)

    candidates = [
        t for t in (customer_ts, business_ts, program_ts, ann_ts, dirty_ts)
        if t
    ]
    last_modified_ts = max(candidates) if candidates else datetime.utcnow()
    last_modified = last_modified_ts.replace(tzinfo=None).isoformat()

    # Wallet echoes our previous Last-Modified as If-Modified-Since. A 304 is
    # correct only when the phone already has a pass at least as new as the
    # newest customer/business/program/announcement/dirty timestamp.
    since_ts = _parse_ts(if_modified_since)
    if (last_modified_ts and since_ts and
            last_modified_ts.replace(microsecond=0) <= since_ts.replace(microsecond=0)):
        print(
            f"APPLE PASS UPDATE 304: serial={serial_number} "
            f"ims={if_modified_since} newest={last_modified}"
        )
        return Response(status_code=304)

    print(
        f"APPLE PASS UPDATE 200: serial={serial_number} "
        f"dirty={'yes' if dirty_ts else 'no'} ims={if_modified_since} newest={last_modified}"
    )

    pkpass_bytes = build_pkpass_bytes(customer, business, program, announcement)
    if pkpass_bytes is None:
        raise HTTPException(status_code=500, detail="Could not build pass")
    return Response(
        content=pkpass_bytes,
        media_type="application/vnd.apple.pkpass",
        headers={
            "Last-Modified": _http_date(last_modified),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Length": str(len(pkpass_bytes)),
        },
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
        retention_settings = _retention_message_settings(business)
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
                body=_render_retention_message(
                    retention_settings['birthday_message'],
                    business_name=business.get('name','us'),
                    reward_name=reward_name,
                    customer_name=customer.get('name') or 'Customer'
                ),
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
    resend_cutoff = now - timedelta(days=30)  # don't re-nudge more than once a month
    sent, skipped, errors = 0, 0, 0

    try:
        businesses = supabase.table("businesses").select("*").eq("plan", "pro").eq("status", "ACTIVE").execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=friendly_db_error(e))

    for business in businesses:
        biz_id = business.get('id')
        retention_settings = _retention_message_settings(business)
        inactivity_cutoff = now - timedelta(days=retention_settings['churn_days'])
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
                body=_render_retention_message(
                    retention_settings['win_back_message'],
                    business_name=business.get('name','us'),
                    customer_name=customer.get('name') or 'Customer',
                    days_inactive=(now-reference_date).days if reference_date else None
                ),
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

# Desktop-only polish for the public showroom's sales-agent callout.
# Appended after the original stylesheet so phone behavior remains unchanged.
SHOWROOM_CSS += r'''
@media (min-width: 901px) {
  .agent-cta-section {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: center !important;
    gap: 56px !important;
    max-width: 1180px !important;
    width: calc(100% - 48px) !important;
    box-sizing: border-box !important;
    margin: 58px auto 64px !important;
    padding: 38px 42px !important;
    min-height: 0 !important;
    overflow: visible !important;
    border-radius: 24px !important;
  }
  .agent-cta-copy {
    min-width: 0 !important;
    max-width: 820px !important;
  }
  .agent-cta-section .home-kicker {
    margin-bottom: 10px !important;
  }
  .agent-cta-section .home-heading {
    margin: 0 0 14px !important;
    font-size: clamp(34px, 3vw, 50px) !important;
    line-height: 1.04 !important;
  }
  .agent-cta-section .home-copy {
    max-width: 780px !important;
    margin: 0 !important;
    font-size: 17px !important;
    line-height: 1.65 !important;
  }
  .agent-cta-benefits {
    display: flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 10px 24px !important;
    margin: 22px 0 0 !important;
    padding: 0 !important;
    font-size: 14px !important;
    line-height: 1.4 !important;
  }
  .agent-cta-benefits span {
    display: inline-flex !important;
    align-items: center !important;
    white-space: nowrap !important;
  }
  .agent-cta-btn {
    width: 220px !important;
    min-width: 220px !important;
    min-height: 58px !important;
    margin: 0 !important;
    padding: 16px 24px !important;
    align-self: center !important;
  }
}
'''


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))


# =============================================================================
# COCKPIT ARENA MODULE
# =============================================================================
class CockpitEventCreate(BaseModel):
    title: str
    event_date: Optional[str] = None
    start_time: Optional[str] = None
    category: Optional[str] = None
    entry_fee: float = Field(default=0, ge=0)
    prize_details: Optional[str] = None
    description: Optional[str] = None
    poster_url: Optional[str] = None
    status: Literal['upcoming', 'open', 'closed', 'finished', 'cancelled'] = 'upcoming'
    is_featured: bool = False

class CockpitEventUpdate(BaseModel):
    title: Optional[str] = None
    event_date: Optional[str] = None
    start_time: Optional[str] = None
    category: Optional[str] = None
    entry_fee: Optional[float] = Field(default=None, ge=0)
    prize_details: Optional[str] = None
    description: Optional[str] = None
    poster_url: Optional[str] = None
    status: Optional[Literal['upcoming', 'open', 'closed', 'finished', 'cancelled']] = None
    is_featured: Optional[bool] = None
    champion_name: Optional[str] = None
    runner_up_name: Optional[str] = None
    third_place_name: Optional[str] = None
    result_notes: Optional[str] = None
    result_photo_url: Optional[str] = None

class CockpitAnnouncementCreate(BaseModel):
    title: str
    message: str
    publish_date: Optional[str] = None
    is_pinned: bool = False
    is_active: bool = True

class CockpitResultCreate(BaseModel):
    event_public_id: Optional[str] = None
    category: Optional[str] = None
    champion_name: Optional[str] = None
    runner_up_name: Optional[str] = None
    third_place_name: Optional[str] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None

class CockpitGalleryCreate(BaseModel):
    event_public_id: Optional[str] = None
    title: Optional[str] = None
    album_name: Optional[str] = None
    image_url: str

class CockpitSponsorCreate(BaseModel):
    name: str
    logo_url: Optional[str] = None
    website_url: Optional[str] = None
    description: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True

class CockpitSettingsUpdate(BaseModel):
    arena_name: Optional[str] = None
    tagline: Optional[str] = None
    about_text: Optional[str] = None
    hero_image_url: Optional[str] = None
    logo_url: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    address: Optional[str] = None
    facebook_url: Optional[str] = None
    map_embed_url: Optional[str] = None

def cockpit_business(public_id: str):
    business = safe_get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail='Business not found')
    if business.get('business_type') != 'cockpit':
        raise HTTPException(status_code=400, detail='Business type must be cockpit')
    return business

def cockpit_list(table: str, business_id):
    q = supabase.table(table).select('*').eq('business_id', business_id)
    if table == 'cockpit_events':
        q = q.order('event_date', desc=False)
    elif table == 'cockpit_sponsors':
        q = q.order('sort_order', desc=False)
    else:
        q = q.order('created_at', desc=True)
    return q.execute().data or []

def cockpit_event_db_id(business_id, event_public_id):
    if not event_public_id:
        return None
    res = supabase.table('cockpit_events').select('id').eq('business_id', business_id).eq('public_id', event_public_id).limit(1).execute()
    rows = res.data or []
    row = rows[0] if rows else None
    return row.get('id') if row else None

@app.get('/api/v1/business/{public_id}/cockpit/dashboard')
async def get_cockpit_dashboard(public_id: str):
    b = cockpit_business(public_id)
    settings_res = supabase.table('cockpit_settings').select('*').eq('business_id', b['id']).limit(1).execute()
    settings_rows = settings_res.data or []
    settings = settings_rows[0] if settings_rows else {}
    return {
        'business': b,
        'settings': settings,
        'events': cockpit_list('cockpit_events', b['id']),
        'announcements': cockpit_list('cockpit_announcements', b['id']),
        'results': cockpit_list('cockpit_results', b['id']),
        'gallery': cockpit_list('cockpit_gallery', b['id']),
        'sponsors': cockpit_list('cockpit_sponsors', b['id']),
    }

@app.post('/api/v1/business/{public_id}/cockpit/events')
async def add_cockpit_event(public_id: str, item: CockpitEventCreate):
    b = cockpit_business(public_id)
    row = item.model_dump()
    row.update({'business_id': b['id'], 'public_id': generate_public_id()})
    return supabase.table('cockpit_events').insert(row).execute().data[0]

@app.patch('/api/v1/business/{public_id}/cockpit/events/{event_public_id}')
async def update_cockpit_event(public_id: str, event_public_id: str, item: CockpitEventUpdate):
    b = cockpit_business(public_id)
    event_rows = (
        supabase.table('cockpit_events')
        .select('*')
        .eq('business_id', b['id'])
        .eq('public_id', event_public_id)
        .limit(1)
        .execute()
        .data or []
    )
    if not event_rows:
        raise HTTPException(status_code=404, detail='Event not found')
    event = event_rows[0]

    payload = item.model_dump()
    champion_name = (payload.pop('champion_name', None) or '').strip()
    runner_up_name = payload.pop('runner_up_name', None)
    third_place_name = payload.pop('third_place_name', None)
    result_notes = payload.pop('result_notes', None)
    result_photo_url = payload.pop('result_photo_url', None)

    event_patch = {key: value for key, value in payload.items() if value is not None}
    if event_patch:
        event_patch['updated_at'] = datetime.utcnow().isoformat()
        updated_rows = (
            supabase.table('cockpit_events')
            .update(event_patch)
            .eq('business_id', b['id'])
            .eq('public_id', event_public_id)
            .execute()
            .data or []
        )
        if updated_rows:
            event = updated_rows[0]

    result = None
    if champion_name:
        result_row = {
            'business_id': b['id'],
            'event_id': event['id'],
            'category': event.get('category'),
            'champion_name': champion_name,
            'runner_up_name': runner_up_name,
            'third_place_name': third_place_name,
            'notes': result_notes,
            'photo_url': result_photo_url or event.get('poster_url'),
        }
        existing_rows = (
            supabase.table('cockpit_results')
            .select('id')
            .eq('business_id', b['id'])
            .eq('event_id', event['id'])
            .limit(1)
            .execute()
            .data or []
        )
        if existing_rows:
            result = (
                supabase.table('cockpit_results')
                .update(result_row)
                .eq('id', existing_rows[0]['id'])
                .execute()
                .data[0]
            )
        else:
            result_row['public_id'] = generate_public_id()
            result = supabase.table('cockpit_results').insert(result_row).execute().data[0]

    return {'event': event, 'result': result}

@app.post('/api/v1/business/{public_id}/cockpit/announcements')
async def add_cockpit_announcement(public_id: str, item: CockpitAnnouncementCreate):
    b = cockpit_business(public_id)
    row = item.model_dump()
    row.update({'business_id': b['id'], 'public_id': generate_public_id()})
    return supabase.table('cockpit_announcements').insert(row).execute().data[0]

@app.post('/api/v1/business/{public_id}/cockpit/results')
async def add_cockpit_result(public_id: str, item: CockpitResultCreate):
    b = cockpit_business(public_id)
    row = item.model_dump()
    event_public_id = row.pop('event_public_id', None)
    row['event_id'] = cockpit_event_db_id(b['id'], event_public_id)
    row.update({'business_id': b['id'], 'public_id': generate_public_id()})
    return supabase.table('cockpit_results').insert(row).execute().data[0]

@app.post('/api/v1/business/{public_id}/cockpit/gallery')
async def add_cockpit_gallery(public_id: str, item: CockpitGalleryCreate):
    b = cockpit_business(public_id)
    row = item.model_dump()
    event_public_id = row.pop('event_public_id', None)
    row['event_id'] = cockpit_event_db_id(b['id'], event_public_id)
    row.update({'business_id': b['id'], 'public_id': generate_public_id()})
    return supabase.table('cockpit_gallery').insert(row).execute().data[0]

@app.post('/api/v1/business/{public_id}/cockpit/sponsors')
async def add_cockpit_sponsor(public_id: str, item: CockpitSponsorCreate):
    b = cockpit_business(public_id)
    row = item.model_dump()
    row.update({'business_id': b['id'], 'public_id': generate_public_id()})
    return supabase.table('cockpit_sponsors').insert(row).execute().data[0]

@app.put('/api/v1/business/{public_id}/cockpit/settings')
async def update_cockpit_settings(public_id: str, item: CockpitSettingsUpdate):
    b = cockpit_business(public_id)
    row = {k: v for k, v in item.model_dump().items() if v is not None}
    row.update({'business_id': b['id'], 'updated_at': datetime.utcnow().isoformat()})
    existing_res = supabase.table('cockpit_settings').select('id').eq('business_id', b['id']).limit(1).execute()
    existing_rows = existing_res.data or []
    existing = existing_rows[0] if existing_rows else None
    if existing:
        return supabase.table('cockpit_settings').update(row).eq('business_id', b['id']).execute().data[0]
    return supabase.table('cockpit_settings').insert(row).execute().data[0]

@app.delete('/api/v1/business/{public_id}/cockpit/{kind}/{item_public_id}')
async def remove_cockpit_record(public_id: str, kind: str, item_public_id: str):
    b = cockpit_business(public_id)
    tables = {
        'events': 'cockpit_events',
        'announcements': 'cockpit_announcements',
        'results': 'cockpit_results',
        'gallery': 'cockpit_gallery',
        'sponsors': 'cockpit_sponsors',
    }
    table = tables.get(kind)
    if not table:
        raise HTTPException(status_code=404, detail='Unknown cockpit record type')
    supabase.table(table).delete().eq('business_id', b['id']).eq('public_id', item_public_id).execute()
    return {'success': True}

def cockpit_public_card(title, body, image_url=None):
    image = f'<img src="{html_lib.escape(image_url)}" alt="">' if image_url else ''
    return f'<article class="card">{image}<div class="pad"><h3>{html_lib.escape(title or "")}</h3><p>{html_lib.escape(body or "")}</p></div></article>'

@app.get('/cockpit/{public_id}', response_class=HTMLResponse)
async def cockpit_public_site(public_id: str):
    b = cockpit_business(public_id)
    settings_res = supabase.table('cockpit_settings').select('*').eq('business_id', b['id']).limit(1).execute()
    settings_rows = settings_res.data or []
    settings = settings_rows[0] if settings_rows else {}
    all_events = cockpit_list('cockpit_events', b['id'])
    events = [
        event for event in all_events
        if str(event.get('status') or 'upcoming').lower() in ('upcoming', 'open')
    ]
    announcements = [x for x in cockpit_list('cockpit_announcements', b['id']) if x.get('is_active')]
    results = cockpit_list('cockpit_results', b['id'])
    gallery = cockpit_list('cockpit_gallery', b['id'])
    sponsors = [x for x in cockpit_list('cockpit_sponsors', b['id']) if x.get('is_active')]

    esc = lambda value: html_lib.escape(str(value or ''))
    arena = esc(settings.get('arena_name') or b.get('name') or 'Cockpit Arena')
    tagline = esc(settings.get('tagline') or 'Malinis at maginoong sabong ang aming tradisyon')
    hero = esc(settings.get('hero_image_url') or '')
    logo = esc(settings.get('logo_url') or b.get('logo_url') or '')
    phone = esc(settings.get('contact_phone') or b.get('phone') or '')
    email = esc(settings.get('contact_email') or b.get('email') or '')
    address = esc(settings.get('address') or b.get('address') or 'Valenzuela City')
    about = esc(settings.get('about_text') or 'Pinagkakatiwalaan, propesyonal, at may respeto. Ang opisyal na tahanan ng aming mga schedule, anunsyo, kampeon, at komunidad.')
    facebook = esc(settings.get('facebook_url') or 'https://www.facebook.com/valenzuelacockpit')

    def date_parts(value):
        try:
            dt = datetime.strptime(str(value)[:10], '%Y-%m-%d')
            return dt.strftime('%b').upper(), dt.strftime('%d'), dt.strftime('%a').upper()
        except Exception:
            return 'TBA', '--', ''

    event_cards = []
    for item in events[:3]:
        mon, day, dow = date_parts(item.get('event_date'))
        poster = esc(item.get('poster_url'))
        image_style = f"background-image:linear-gradient(90deg,rgba(8,8,8,.94),rgba(8,8,8,.25)),url('{poster}')" if poster else 'background:linear-gradient(130deg,#171717,#35110d)'
        fee = float(item.get('entry_fee') or 0)
        fee_text = f'₱{fee:,.0f}' if fee else 'To be announced'
        prize = esc(item.get('prize_details') or 'Prize details to be announced')
        event_cards.append(f'''<article class="event-card" style="{image_style}">
          <div class="date-box"><b>{mon}</b><strong>{day}</strong><span>{dow}</span></div>
          <div class="event-copy"><small>{esc(item.get('category') or 'DERBY EVENT')}</small><h3>{esc(item.get('title'))}</h3>
          <p>◷ {esc(item.get('start_time') or 'Time TBA')} &nbsp; • &nbsp; Entry fee: {fee_text}</p><div class="prize">{prize}</div></div>
        </article>''')
    events_html = ''.join(event_cards) or '<div class="empty">No upcoming events have been posted.</div>'

    schedule_rows = []
    for item in events:
        mon, day, dow = date_parts(item.get('event_date'))
        schedule_rows.append(f'<div class="schedule-row"><span>{dow or mon}</span><b>{esc(item.get("title"))}</b><em>{esc(item.get("start_time") or "TBA")}</em></div>')
    schedule_html = ''.join(schedule_rows) or '<div class="empty small">Schedule coming soon.</div>'
    schedule_pager_html = '<div class="schedule-pager" id="schedule-pager"><button type="button" id="schedule-prev">← Previous</button><span id="schedule-page-label"></span><button type="button" id="schedule-next">Next →</button></div>' if schedule_rows else ''

    announcement_rows = []
    for item in announcements[:4]:
        mon, day, dow = date_parts(item.get('publish_date') or item.get('created_at'))
        announcement_rows.append(f'''<article class="announcement-row"><div class="mini-date"><b>{mon}</b><strong>{day}</strong></div>
          <div><h4>{esc(item.get('title'))}</h4><p>{esc(item.get('message'))}</p></div></article>''')
    announcement_html = ''.join(announcement_rows) or '<div class="empty small">No announcements posted.</div>'

    # Public champions gallery: keep the newest 20 records only. Pagination is handled
    # in the browser so search can still filter across all 20 without another API call.
    result_cards = []
    for item in results[:20]:
        photo = esc(item.get('photo_url'))
        image = f'<img loading="lazy" src="{photo}" alt="Official champion">' if photo else '<div class="result-placeholder">🏆</div>'
        champion_plain = str(item.get('champion_name') or 'Champion to be announced')
        search_blob = ' '.join(str(item.get(k) or '') for k in ('champion_name','runner_up_name','third_place_name','category','notes')).lower()
        event_date = item.get('event_date') or item.get('created_at') or ''
        date_label = ''
        if event_date:
            try:
                date_label = datetime.strptime(str(event_date)[:10], '%Y-%m-%d').strftime('%b %d, %Y')
            except Exception:
                date_label = str(event_date)[:10]
        result_cards.append(f'''<article class="result-card" data-search="{esc(search_blob)}">
          <div class="result-photo">{image}</div>
          <div class="result-copy"><small>{esc(item.get('category') or 'CHAMPION')}</small>
          <h3>{esc(champion_plain)}</h3>
          <p>Runner-up: {esc(item.get('runner_up_name') or '—')}</p>
          {f'<span class="result-date">{esc(date_label)}</span>' if date_label else ''}</div></article>''')
    champions_search_html = '<div class="search-wrap"><input type="text" id="champion-search" class="search-input" placeholder="Search champions by name, category, or runner-up..."></div>' if results else ''
    no_champions_html = '<div id="no-champions" class="empty" style="display:none">No champions match your search.</div>' if results else ''
    results_html = ''.join(result_cards) or '<div class="empty">No champions have been announced yet.</div>'
    champion_pager_html = '<div class="champion-pager" id="champion-pager"><button type="button" id="champion-prev">← Back</button><span id="champion-page-label"></span><button type="button" id="champion-next">Next →</button></div>' if result_cards else ''

    gallery_html = ''.join(f'<img loading="lazy" src="{esc(x.get("image_url"))}" alt="{esc(x.get("title") or "Arena gallery")}">' for x in gallery[:12]) or '<div class="empty">Gallery photos coming soon.</div>'
    sponsor_html = ''.join(f'''<a class="sponsor" href="{esc(x.get('website_url') or '#')}" target="_blank" rel="noopener">
      {f'<img src="{esc(x.get("logo_url"))}" alt="{esc(x.get("name"))}">' if x.get('logo_url') else ''}<span>{esc(x.get('name'))}</span></a>''' for x in sponsors) or '<div class="empty small">Sponsor logos coming soon.</div>'

    hero_style = f"background-image:linear-gradient(90deg,rgba(4,4,4,.95) 0%,rgba(4,4,4,.55) 48%,rgba(4,4,4,.22) 100%),url('{hero}')" if hero else 'background:radial-gradient(circle at 70% 35%,#4d1710 0,#18100d 34%,#050505 75%)'
    logo_html = f'<img class="brand-logo" src="{logo}" alt="{arena} logo">' if logo else '<div class="brand-mark">VCSA</div>'
    fb_html = f'<a href="{facebook}" target="_blank" rel="noopener">Facebook</a>' if facebook else ''

    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{arena}</title><style>
:root{{--black:#050505;--panel:#0d0d0e;--panel2:#141414;--line:#3b2d13;--red:#c91f25;--gold:#e6a91a;--text:#f8f8f8;--muted:#aaa}}
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--black);color:var(--text);font-family:Arial,Helvetica,sans-serif}}a{{color:inherit}}button,a{{-webkit-tap-highlight-color:transparent}}
.topbar{{min-height:78px;padding:10px 3.5%;display:flex;align-items:center;justify-content:space-between;background:#050505;border-bottom:1px solid #21180b;position:sticky;top:0;z-index:20}}
.brand{{display:flex;align-items:center;gap:13px;text-decoration:none;min-width:260px}}.brand-logo{{width:62px;height:62px;object-fit:cover;border-radius:50%;background:#fff;border:2px solid var(--gold);box-shadow:0 5px 16px rgba(0,0,0,.35)}}.brand-mark{{width:58px;height:58px;border:2px solid var(--gold);border-radius:50%;display:grid;place-items:center;font-weight:900;color:var(--gold)}}
.brand-copy b{{display:block;font-size:clamp(18px,2.1vw,31px);line-height:1;color:#fff;text-transform:uppercase;font-style:italic}}.brand-copy b span{{color:var(--red)}}.brand-copy small{{display:block;color:var(--gold);font-weight:800;margin-top:5px;font-size:11px;text-transform:uppercase}}
.nav{{display:flex;align-items:center;gap:25px;font-size:12px;font-weight:800;text-transform:uppercase}}.nav a{{text-decoration:none;opacity:.9}}.nav a:hover{{color:var(--gold)}}.login{{background:var(--red);padding:13px 18px;border-radius:4px}}.menu{{display:none;background:none;border:0;color:#fff;font-size:25px}}
.hero{{min-height:530px;background-size:cover;background-position:center;display:flex;align-items:center;padding:65px 4%;border-bottom:1px solid var(--gold)}}.hero-copy{{max-width:650px}}.hero h1{{margin:0;text-transform:uppercase;font-style:italic;font-size:clamp(46px,6vw,86px);line-height:.95;text-shadow:0 3px 15px #000}}.hero h1 .gold{{color:var(--gold)}}.hero h1 .red{{color:var(--red)}}.hero p{{font-size:18px;line-height:1.6;color:#ddd;margin:25px 0}}
.actions{{display:flex;gap:13px;flex-wrap:wrap}}.btn{{display:inline-flex;align-items:center;justify-content:center;padding:14px 20px;text-transform:uppercase;text-decoration:none;font-weight:900;font-size:13px;border-radius:3px;border:1px solid var(--gold)}}.btn.primary{{background:var(--red);border-color:var(--red)}}.btn.secondary{{color:var(--gold);background:#080808cc}}
.values{{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #241d10;background:#080808}}.value{{padding:27px 24px;text-align:center;border-right:1px solid #282015}}.value:last-child{{border-right:0}}.value strong{{display:block;color:var(--gold);text-transform:uppercase;font-size:15px;margin:9px 0}}.value span{{color:#bdbdbd;font-size:12px;line-height:1.45}}
.section{{padding:52px 4%;max-width:1600px;margin:auto}}.section-head{{display:flex;align-items:end;justify-content:space-between;margin-bottom:20px}}.section h2{{margin:0;text-transform:uppercase;font-size:26px;border-left:4px solid var(--red);padding-left:12px}}.section-head a{{color:var(--red);font-weight:800;font-size:12px;text-transform:uppercase;text-decoration:none}}
.dashboard-grid{{display:grid;grid-template-columns:1.25fr .8fr 1fr .9fr;gap:15px}}.box{{background:linear-gradient(180deg,#121212,#0b0b0b);border:1px solid #32260f;border-radius:5px;padding:18px;min-height:290px}}.box h3{{margin:0 0 18px;text-transform:uppercase;font-size:18px}}
.event-list{{display:grid;gap:14px}}.event-card{{min-height:210px;background-size:cover!important;background-position:center!important;border:1px solid #54350f;border-radius:5px;padding:20px;display:flex;gap:18px;align-items:center}}.date-box,.mini-date{{width:68px;min-width:68px;border:1px solid var(--red);text-align:center;background:#0b0b0bdd}}.date-box b,.mini-date b{{display:block;background:#36100e;color:#ffb1a7;padding:5px;font-size:12px}}.date-box strong{{display:block;font-size:31px;padding-top:6px}}.date-box span{{display:block;color:#ddd;font-size:11px;padding-bottom:7px}}.event-copy small,.result-card small{{color:var(--gold);font-weight:900}}.event-copy h3{{font-size:27px;margin:5px 0 11px}}.event-copy p{{color:#ccc;font-size:12px}}.prize{{color:var(--gold);font-weight:900;margin-top:16px;text-transform:uppercase}}
.schedule-row{{display:grid;grid-template-columns:42px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid #262626;align-items:center;font-size:12px}}.schedule-row span{{color:var(--red);font-weight:900}}.schedule-row em{{font-style:normal;color:var(--gold)}}.schedule-pager{{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid #262626}}.schedule-pager button{{border:1px solid #54401c;background:#101010;color:#fff;padding:8px 12px;border-radius:6px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}}.schedule-pager button:hover:not(:disabled){{border-color:var(--gold);color:var(--gold)}}.schedule-pager button:disabled{{opacity:.35;cursor:not-allowed}}.schedule-pager span{{min-width:90px;text-align:center;color:#aaa;font-size:11px;font-weight:800}}
.announcement-row{{display:grid;grid-template-columns:55px 1fr;gap:12px;padding:11px 0;border-bottom:1px solid #262626}}.mini-date{{width:55px;min-width:55px}}.mini-date strong{{font-size:20px;padding:6px;display:block}}.announcement-row h4{{margin:0 0 5px;color:var(--gold)}}.announcement-row p{{margin:0;color:#bbb;font-size:12px;line-height:1.4}}
.member-card{{background:linear-gradient(145deg,#2a0808,#100707);border:1px solid #63311e;padding:17px;border-radius:7px;margin:20px 0;transform:rotate(-2deg)}}.member-card b{{font-size:18px}}.member-card span{{display:block;color:var(--gold);font-size:11px;margin-top:25px}}.member-card code{{display:block;margin-top:8px;color:#fff}}
.results-grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}}.result-card{{display:flex;flex-direction:column;min-width:0;background:linear-gradient(180deg,#121212,#0b0b0b);border:1px solid #493512;border-radius:10px;overflow:hidden;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}}.result-card:hover{{transform:translateY(-3px);border-color:var(--gold);box-shadow:0 12px 28px rgba(0,0,0,.35)}}.result-photo{{width:100%;aspect-ratio:4/3;background:#1d100b;overflow:hidden}}.result-card img,.result-placeholder{{width:100%;height:100%;object-fit:cover;background:#1d100b;display:grid;place-items:center;font-size:58px}}.result-copy{{padding:15px 16px 17px}}.result-card h3{{margin:6px 0 5px;text-transform:uppercase;font-size:21px}}.result-card p{{margin:0;color:#aaa;font-size:13px}}.result-date{{display:block;margin-top:11px;padding-top:10px;border-top:1px solid #292929;color:#cfcfcf;font-size:12px}}.champion-pager{{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:22px}}.champion-pager button{{border:1px solid #54401c;background:#101010;color:#fff;padding:10px 16px;border-radius:7px;font:inherit;font-weight:800;cursor:pointer}}.champion-pager button:hover:not(:disabled){{border-color:var(--gold);color:var(--gold)}}.champion-pager button:disabled{{opacity:.35;cursor:not-allowed}}.champion-pager span{{min-width:115px;text-align:center;color:#aaa;font-size:12px;font-weight:800}}
.search-wrap{{margin-bottom:16px}}.search-input{{width:100%;box-sizing:border-box;padding:13px 16px;border:1px solid #3a2a10;border-radius:5px;background:#0b0b0b;color:var(--text);font:inherit}}.search-input::placeholder{{color:#888}}.search-input:focus{{outline:none;border-color:var(--gold)}}
.gallery{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}}.gallery img{{width:100%;height:210px;object-fit:cover;border:1px solid #473515;border-radius:3px;transition:.2s}}.gallery img:hover{{transform:scale(1.02);border-color:var(--gold)}}
.about-member{{display:grid;grid-template-columns:1.4fr .8fr;gap:18px}}.about{{background:#0e0e0e;border:1px solid #342710;padding:26px}}.about p{{color:#c8c8c8;line-height:1.8}}.join{{background:linear-gradient(145deg,#1f1308,#320908);border:1px solid var(--gold);padding:26px}}.join p{{color:#ccc;line-height:1.6}}
.sponsors{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}}.sponsor{{min-height:100px;background:#101010;border:1px solid #272727;display:flex;align-items:center;justify-content:center;gap:10px;padding:15px;text-decoration:none;font-weight:800}}.sponsor img{{max-width:120px;max-height:60px;object-fit:contain}}.empty{{padding:30px;color:#888;border:1px dashed #333;text-align:center}}.empty.small{{padding:15px}}
footer{{border-top:1px solid #3b2d13;background:#050505;padding:35px 4% 20px}}.footer-grid{{display:grid;grid-template-columns:1.1fr .7fr 1fr .8fr;gap:28px;max-width:1500px;margin:auto}}footer h4{{text-transform:uppercase;margin:0 0 13px}}footer p,footer a{{color:#aaa;font-size:13px;line-height:1.7;text-decoration:none}}.copyright{{border-top:1px solid #222;margin-top:25px;padding-top:18px;text-align:center;color:#777;font-size:12px}}
@media(max-width:1050px){{.dashboard-grid{{grid-template-columns:1fr 1fr}}.results-grid{{grid-template-columns:repeat(3,minmax(0,1fr))}}.gallery{{grid-template-columns:repeat(3,1fr)}}.nav{{gap:12px}}}}
@media(max-width:760px){{.topbar{{min-height:70px}}.brand{{min-width:0}}.brand-logo,.brand-mark{{width:48px;height:48px}}.brand-copy b{{font-size:17px}}.brand-copy small{{font-size:8px}}.menu{{display:block}}.nav{{display:none;position:absolute;left:0;right:0;top:70px;background:#080808;padding:20px;flex-direction:column;align-items:stretch}}.nav.open{{display:flex}}.hero{{min-height:600px;background-position:62% center;padding:45px 6%}}.hero-copy{{padding-top:120px}}.values{{grid-template-columns:1fr 1fr}}.value{{border-bottom:1px solid #282015}}.dashboard-grid{{grid-template-columns:1fr}}.results-grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}.gallery{{grid-template-columns:1fr 1fr}}.gallery img{{height:160px}}.about-member,.footer-grid{{grid-template-columns:1fr}}.section{{padding:38px 5%}}}}
@media(max-width:480px){{.results-grid{{grid-template-columns:1fr}}.champion-pager{{gap:8px}}.champion-pager button{{padding:9px 12px}}}}
</style></head><body>
<header class="topbar"><a class="brand" href="#home">{logo_html}<span class="brand-copy"><b>{arena}</b><small>{tagline}</small></span></a>
<button class="menu" onclick="document.querySelector('.nav').classList.toggle('open')">☰</button><nav class="nav"><a href="#home">Home</a><a href="#schedule">Schedule</a><a href="#champions">Champions</a><a href="#gallery">Gallery</a><a href="#about">About Us</a><a href="#contact">Contact</a></nav></header>
<main id="home"><section class="hero" style="{hero_style}"><div class="hero-copy"><h1>Malinis at<br><span class="gold">maginoong sabong</span><br>ang aming <span class="red">tradisyon</span></h1><p>Pinagkakatiwalaan. Propesyonal. May respeto.<br><b>{arena}</b></p><div class="actions"><a class="btn primary" href="#schedule">View Schedule</a><a class="btn secondary" href="#champions">Latest Champions</a></div></div></section>
<section class="values"><div class="value">🛡️<strong>Malinis</strong><span>Sinusunod ang lahat ng patakaran at regulasyon.</span></div><div class="value">👥<strong>Propesyonal</strong><span>Pinapatakbo nang may karanasan at propesyonalismo.</span></div><div class="value">🤝<strong>May respeto</strong><span>Respeto sa mananabong, manonood, at sa laro.</span></div><div class="value">🔒<strong>Walang dayaan</strong><span>Transparente at patas ang bawat laban.</span></div></section>
<section id="schedule" class="section"><div class="section-head"><h2>Upcoming Events</h2><a href="#schedule">View all schedule</a></div><div class="event-list">{events_html}</div></section>
<section class="section"><div class="dashboard-grid"><div class="box" style="grid-column:span 2"><h3>Weekly Schedule</h3><div id="weekly-schedule">{schedule_html}</div>{schedule_pager_html}</div><div class="box" style="grid-column:span 2"><h3>Announcements</h3>{announcement_html}</div></div></section>
<section id="champions" class="section"><div class="section-head"><h2>Latest Champions</h2><a href="#champions">Up to 20 champions</a></div>{champions_search_html}<div class="results-grid" id="champion-grid">{results_html}</div>{no_champions_html}{champion_pager_html}</section>
<section id="gallery" class="section"><div class="section-head"><h2>Gallery</h2><a href="#gallery">View all photos</a></div><div class="gallery">{gallery_html}</div></section>
<section id="about" class="section"><div class="about-member"><div class="about"><h2>About {arena}</h2><p>{about}</p></div><div class="join"><h2>Stay Connected</h2><p>Follow the official Facebook page for upcoming derbies, announcements, champions, event posters, and live updates.</p><a class="btn primary" href="{facebook}" target="_blank" rel="noopener noreferrer">Follow VCSA on Facebook</a></div></div></section>
</main>
<footer id="contact"><div class="footer-grid"><div><h4>{arena}</h4><p>{tagline}</p></div><div><h4>Quick Links</h4><p><a href="#schedule">Schedule</a><br><a href="#champions">Champions</a><br><a href="#gallery">Gallery</a></p></div><div><h4>Contact Us</h4><p>{phone}<br>{email}<br>{address}</p></div><div><h4>Follow Us</h4><p>{fb_html}</p></div></div><div class="copyright">© {datetime.utcnow().year} {arena}. All rights reserved.</div></footer>
<script>document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.nav').classList.remove('open')))
var scheduleRows=Array.prototype.slice.call(document.querySelectorAll('#weekly-schedule .schedule-row'));
var schedulePrev=document.getElementById('schedule-prev');
var scheduleNext=document.getElementById('schedule-next');
var schedulePageLabel=document.getElementById('schedule-page-label');
var schedulePager=document.getElementById('schedule-pager');
var schedulePage=0;
var schedulePageSize=10;
function renderSchedule(){{
  var pages=Math.max(1,Math.ceil(scheduleRows.length/schedulePageSize));
  if(schedulePage>=pages)schedulePage=pages-1;
  if(schedulePage<0)schedulePage=0;
  scheduleRows.forEach(function(row){{row.style.display='none';}});
  var start=schedulePage*schedulePageSize;
  scheduleRows.slice(start,start+schedulePageSize).forEach(function(row){{row.style.display='grid';}});
  if(schedulePager)schedulePager.style.display=scheduleRows.length>schedulePageSize?'flex':'none';
  if(schedulePrev)schedulePrev.disabled=schedulePage===0;
  if(scheduleNext)scheduleNext.disabled=schedulePage>=pages-1;
  if(schedulePageLabel)schedulePageLabel.textContent=scheduleRows.length?('Page '+(schedulePage+1)+' of '+pages):'';
}}
if(schedulePrev)schedulePrev.addEventListener('click',function(){{if(schedulePage>0){{schedulePage--;renderSchedule();}}}});
if(scheduleNext)scheduleNext.addEventListener('click',function(){{if(schedulePage<Math.ceil(scheduleRows.length/schedulePageSize)-1){{schedulePage++;renderSchedule();}}}});
renderSchedule();

var championSearch=document.getElementById('champion-search');
var championCards=Array.prototype.slice.call(document.querySelectorAll('#champions .result-card'));
var championPrev=document.getElementById('champion-prev');
var championNext=document.getElementById('champion-next');
var championPageLabel=document.getElementById('champion-page-label');
var championPager=document.getElementById('champion-pager');
var championPage=0;
var championPageSize=8;
function renderChampions(){{
  var q=championSearch?championSearch.value.trim().toLowerCase():'';
  var matches=championCards.filter(function(card){{return !q||(card.getAttribute('data-search')||'').indexOf(q)!==-1;}});
  var pages=Math.max(1,Math.ceil(matches.length/championPageSize));
  if(championPage>=pages)championPage=pages-1;
  if(championPage<0)championPage=0;
  championCards.forEach(function(card){{card.style.display='none';}});
  var start=championPage*championPageSize;
  matches.slice(start,start+championPageSize).forEach(function(card){{card.style.display='';}});
  var empty=document.getElementById('no-champions');
  if(empty)empty.style.display=matches.length===0?'':'none';
  if(championPager)championPager.style.display=matches.length>championPageSize?'flex':'none';
  if(championPrev)championPrev.disabled=championPage===0;
  if(championNext)championNext.disabled=championPage>=pages-1;
  if(championPageLabel)championPageLabel.textContent=matches.length?('Page '+(championPage+1)+' of '+pages):'';
}}
if(championSearch)championSearch.addEventListener('input',function(){{championPage=0;renderChampions();}});
if(championPrev)championPrev.addEventListener('click',function(){{if(championPage>0){{championPage--;renderChampions();document.getElementById('champions').scrollIntoView({{behavior:'smooth',block:'start'}});}}}});
if(championNext)championNext.addEventListener('click',function(){{championPage++;renderChampions();document.getElementById('champions').scrollIntoView({{behavior:'smooth',block:'start'}});}});
renderChampions();
</script></body></html>'''
    return HTMLResponse(page)

# --- Motolite module registration ---
# Keep Motolite in its own file, but mount its routes on the main LoyaltyTree API.
# Import here after the main app/routes are defined to avoid circular-import issues.
try:
    from motolite import motolite_router
    app.include_router(motolite_router)
    print("MOTOLITE router registered at /api/v1/motolite")
except Exception as exc:
    print("MOTOLITE router registration failed:", exc)



# ============================================================
# ROADMAP #6-#10 — WALLET QUEUE / CRM / RETENTION / ANALYTICS
# ============================================================

def enqueue_wallet_sync(customer: dict, business: dict, reason: str = 'loyalty_update'):
    """Persist a Wallet refresh job so cashier success never depends on Google/Apple latency."""
    try:
        # Coalesce an already-pending job for the same customer.
        pending = (supabase.table('wallet_sync_jobs').select('id')
                   .eq('business_id', business.get('id')).eq('customer_id', customer.get('id'))
                   .in_('status', ['pending','processing']).limit(1).execute().data or [])
        if pending:
            return {'status':'queued','job_id':pending[0].get('id'),'coalesced':True}
        row=(supabase.table('wallet_sync_jobs').insert({
            'business_id':business.get('id'),'customer_id':customer.get('id'),
            'reason':reason,'status':'pending','attempts':0,'next_attempt_at':datetime.utcnow().isoformat()
        }).execute().data or [])
        return {'status':'queued','job_id':row[0].get('id') if row else None,'coalesced':False}
    except Exception as e:
        print(f'WALLET QUEUE enqueue error: {e}')
        return {'status':'queue_error','detail':str(e)}


def process_wallet_sync_queue_once(limit: int = 10):
    """Best-effort durable queue worker. Failed jobs retry with bounded exponential backoff."""
    try:
        jobs=(supabase.table('wallet_sync_jobs').select('*').in_('status',['pending','failed'])
              .lte('next_attempt_at',datetime.utcnow().isoformat()).order('created_at').limit(limit).execute().data or [])
    except Exception as e:
        print(f'WALLET QUEUE fetch error: {e}'); return
    for job in jobs:
        jid=job.get('id'); attempts=int(job.get('attempts') or 0)+1
        try:
            supabase.table('wallet_sync_jobs').update({'status':'processing','started_at':datetime.utcnow().isoformat(),'attempts':attempts,'updated_at':datetime.utcnow().isoformat()}).eq('id',jid).execute()
            customer=safe_get_customer_by_id(job.get('customer_id'))
            business=safe_get_business_by_id(job.get('business_id'))
            if not customer or not business: raise RuntimeError('Customer/business no longer exists')
            program=safe_get_loyalty_program(business.get('id')) or {}
            g=sync_wallet_object(customer,business,program)
            a=sync_apple_wallet_pass(customer)
            failed=(isinstance(g,dict) and g.get('status')=='error') or (isinstance(a,dict) and a.get('status')=='error')
            if failed: raise RuntimeError(f'Google={g}; Apple={a}')
            supabase.table('wallet_sync_jobs').update({'status':'completed','completed_at':datetime.utcnow().isoformat(),'last_error':None,'updated_at':datetime.utcnow().isoformat()}).eq('id',jid).execute()
        except Exception as e:
            max_attempts=int(job.get('max_attempts') or 5)
            terminal=attempts>=max_attempts
            delay=min(300, 5*(2**max(0,attempts-1)))
            nxt=(datetime.utcnow()+timedelta(seconds=delay)).isoformat()
            try: supabase.table('wallet_sync_jobs').update({'status':'failed' if terminal else 'pending','last_error':str(e)[:1500],'next_attempt_at':nxt,'updated_at':datetime.utcnow().isoformat()}).eq('id',jid).execute()
            except Exception: pass
            print(f'WALLET QUEUE job {jid} attempt {attempts} error: {e}')


async def wallet_queue_worker():
    while True:
        try: await asyncio.to_thread(process_wallet_sync_queue_once,10)
        except Exception as e: print(f'WALLET QUEUE worker error: {e}')
        await asyncio.sleep(5)


@app.on_event('startup')
async def start_wallet_queue_worker():
    asyncio.create_task(wallet_queue_worker())
    # A pass-layout release is rolled out to already-installed Apple Wallet
    # cards automatically. Supabase keeps a release marker, so this happens
    # once per layout version, not on every Render restart.
    asyncio.create_task(_apple_layout_release_startup())


def _crm_dataset(business_id: int):
    customers=(supabase.table('customers').select('*').eq('business_id',business_id).execute().data or [])
    tx=(supabase.table('transaction_audit').select('customer_id,staff_id,branch_id,action,status,delta,created_at,metadata')
        .eq('business_id',business_id).eq('status','success').order('created_at',desc=True).limit(10000).execute().data or [])
    return customers,tx


def _crm_metrics(customers, tx):
    now=datetime.utcnow()
    by={}
    for t in tx:
        cid=t.get('customer_id')
        if cid is None: continue
        by.setdefault(str(cid),[]).append(t)
    result=[]
    for c in customers:
        items=by.get(str(c.get('id')),[])
        dates=[_parse_ts(x.get('created_at')) for x in items if _parse_ts(x.get('created_at'))]
        dates.sort(reverse=True)
        last=dates[0] if dates else _parse_ts(c.get('created_at'))
        days=(now-last).days if last else None
        visits=len(items)
        if days is None: segment='new'
        elif days>=90: segment='inactive_90'
        elif days>=60: segment='inactive_60'
        elif days>=30: segment='at_risk'
        elif visits>=10: segment='frequent'
        elif visits>=3: segment='active'
        else: segment='new'
        branches={}
        staff={}
        for x in items:
            if x.get('branch_id') is not None: branches[str(x.get('branch_id'))]=branches.get(str(x.get('branch_id')),0)+1
            if x.get('staff_id') is not None: staff[str(x.get('staff_id'))]=staff.get(str(x.get('staff_id')),0)+1
        result.append({**c,'crm':{'segment':segment,'total_transactions':visits,
            'last_activity_at':last.isoformat() if last else None,'days_since_last_activity':days,
            'favorite_branch_id':max(branches,key=branches.get) if branches else None,
            'last_staff_id':str(items[0].get('staff_id')) if items and items[0].get('staff_id') is not None else None}})
    return result


@app.get('/api/v1/business/{public_id}/crm')
async def owner_crm(public_id:str, authorization:str=Header(default='')):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')
    customers,tx=_crm_dataset(business.get('id'))
    rows=_crm_metrics(customers,tx)
    counts={}
    for r in rows:
        s=r['crm']['segment']; counts[s]=counts.get(s,0)+1
    return {'customers':rows,'segments':counts,'total_customers':len(rows)}



class RetentionMessageSettings(BaseModel):
    birthday_message: Optional[str] = None
    win_back_message: Optional[str] = None
    churn_days: Optional[int] = None


def _get_retention_rule(business_id: int, rule_type: str):
    try:
        rows=(supabase.table('retention_rules').select('*')
              .eq('business_id',business_id).eq('rule_type',rule_type).limit(1).execute().data or [])
        return rows[0] if rows else None
    except Exception:
        return None


def _retention_message_settings(business: dict):
    birthday=_get_retention_rule(business.get('id'),'birthday')
    winback=_get_retention_rule(business.get('id'),'win_back')
    return {
        'birthday_message': (birthday or {}).get('message_template') or
            "Happy birthday from {business_name}! Stop by soon to celebrate with {reward_name}.",
        'win_back_message': (winback or {}).get('message_template') or
            "It's been a while since your last visit to {business_name} - come back and pick up where you left off!",
        'churn_days': int((winback or {}).get('days_threshold') or 30),
    }


def _render_retention_message(template: str, *, business_name: str='', reward_name: str='', customer_name: str='', days_inactive=None):
    values={
        'business_name': business_name or 'us',
        'reward_name': reward_name or 'a treat',
        'customer_name': customer_name or 'Customer',
        'days_inactive': '' if days_inactive is None else str(days_inactive),
    }
    try:
        return str(template or '').format(**values)
    except Exception:
        # Bad/missing placeholder should never break a scheduled job.
        return str(template or '')


@app.get('/api/v1/business/{public_id}/retention-settings')
async def get_retention_settings(public_id:str, authorization:str=Header(default='')):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')
    return _retention_message_settings(business)


@app.put('/api/v1/business/{public_id}/retention-settings')
async def save_retention_settings(public_id:str, req:RetentionMessageSettings, authorization:str=Header(default='')):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')

    current=_retention_message_settings(business)
    birthday=(req.birthday_message if req.birthday_message is not None else current['birthday_message']).strip()
    winback=(req.win_back_message if req.win_back_message is not None else current['win_back_message']).strip()
    churn_days=req.churn_days if req.churn_days is not None else current['churn_days']

    if not birthday or len(birthday)>500:
        raise HTTPException(status_code=400,detail='Birthday message must be 1-500 characters')
    if not winback or len(winback)>500:
        raise HTTPException(status_code=400,detail='Win-back message must be 1-500 characters')
    if churn_days < 7 or churn_days > 365:
        raise HTTPException(status_code=400,detail='Churn inactivity threshold must be between 7 and 365 days')

    now=datetime.utcnow().isoformat()
    for rule_type,message,days in [
        ('birthday',birthday,None),
        ('win_back',winback,int(churn_days)),
    ]:
        existing=_get_retention_rule(business.get('id'),rule_type)
        payload={
            'business_id':business.get('id'),'rule_type':rule_type,'enabled':True,
            'message_template':message,'days_threshold':days,'updated_at':now,
        }
        if existing:
            supabase.table('retention_rules').update(payload).eq('id',existing.get('id')).execute()
        else:
            supabase.table('retention_rules').insert(payload).execute()

    return _retention_message_settings(business)


@app.get('/api/v1/business/{public_id}/retention-opportunities')
async def retention_opportunities(public_id:str, authorization:str=Header(default='')):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')
    customers,tx=_crm_dataset(business.get('id')); rows=_crm_metrics(customers,tx)
    settings=_retention_message_settings(business)
    opportunities=[]
    for r in rows:
        seg=r['crm']['segment']; days=r['crm']['days_since_last_activity']
        if days is not None and days >= settings['churn_days']:
            opportunities.append({'customer_public_id':r.get('public_id'),'customer_name':r.get('name'),'type':'win_back','segment':seg,'days_inactive':days,
                                  'suggested_message':_render_retention_message(
                                      settings['win_back_message'],
                                      business_name=business.get('name','us'),
                                      customer_name=r.get('name') or 'Customer',
                                      days_inactive=days
                                  )})
        goal=int((safe_get_loyalty_program(business.get('id')) or {}).get('stamp_goal') or 0)
        if goal and int(r.get('stamp_count') or 0)==goal-1:
            opportunities.append({'customer_public_id':r.get('public_id'),'customer_name':r.get('name'),'type':'one_away','segment':seg,
                                  'suggested_message':"You're only 1 stamp away from your next reward!"})
    return {'opportunities':opportunities,'total':len(opportunities)}


@app.get('/api/v1/business/{public_id}/operations-analytics')
async def operations_analytics(public_id:str, authorization:str=Header(default=''), days:int=Query(default=30,ge=1,le=365)):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')
    since=(datetime.utcnow()-timedelta(days=days)).isoformat()
    tx=(supabase.table('transaction_audit').select('*').eq('business_id',business.get('id')).gte('created_at',since).execute().data or [])
    branches=(supabase.table('branches').select('id,public_id,name').eq('business_id',business.get('id')).execute().data or [])
    staff=(supabase.table('staff').select('id,public_id,name').eq('business_id',business.get('id')).execute().data or [])
    def aggregate(key):
        d={}
        for t in tx:
            k=str(t.get(key)) if t.get(key) is not None else 'unassigned'
            z=d.setdefault(k,{'transactions':0,'failed':0,'adjustments':0,'delta_total':0})
            z['transactions']+=1
            if t.get('status')=='failed': z['failed']+=1
            if any(w in str(t.get('action') or '').lower() for w in ('adjust','remove','correction','override')): z['adjustments']+=1
            try:z['delta_total']+=float(t.get('delta') or 0)
            except:pass
        return d
    bm=aggregate('branch_id'); sm=aggregate('staff_id')
    return {'days':days,'overall':{'transactions':len(tx),'failed':sum(1 for x in tx if x.get('status')=='failed')},
            'branches':[{'id':str(b.get('id')),'public_id':b.get('public_id'),'name':b.get('name'),**bm.get(str(b.get('id')),{'transactions':0,'failed':0,'adjustments':0,'delta_total':0})} for b in branches],
            'cashiers':[{'id':str(s.get('id')),'public_id':s.get('public_id'),'name':s.get('name'),**sm.get(str(s.get('id')),{'transactions':0,'failed':0,'adjustments':0,'delta_total':0})} for s in staff]}


@app.get('/api/v1/business/{public_id}/retention-analytics')
async def retention_analytics(public_id:str, authorization:str=Header(default=''), days:int=Query(default=90,ge=30,le=365)):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')
    customers,tx=_crm_dataset(business.get('id')); rows=_crm_metrics(customers,tx)
    active30=sum(1 for r in rows if r['crm']['days_since_last_activity'] is not None and r['crm']['days_since_last_activity']<30)
    active60=sum(1 for r in rows if r['crm']['days_since_last_activity'] is not None and r['crm']['days_since_last_activity']<60)
    active90=sum(1 for r in rows if r['crm']['days_since_last_activity'] is not None and r['crm']['days_since_last_activity']<90)
    repeat=sum(1 for r in rows if r['crm']['total_transactions']>=2)
    total=len(rows)
    gaps=[]
    grouped={}
    for t in tx:
        if t.get('customer_id') is not None:
            dt=_parse_ts(t.get('created_at'))
            if dt: grouped.setdefault(str(t.get('customer_id')),[]).append(dt)
    for ds in grouped.values():
        ds=sorted(ds)
        gaps += [(ds[i]-ds[i-1]).total_seconds()/86400 for i in range(1,len(ds))]
    return {'total_customers':total,'repeat_customers':repeat,'repeat_customer_rate':round(repeat/total*100,1) if total else 0,
            'active_30':active30,'active_60':active60,'active_90':active90,
            'retention_30_rate':round(active30/total*100,1) if total else 0,
            'retention_60_rate':round(active60/total*100,1) if total else 0,
            'retention_90_rate':round(active90/total*100,1) if total else 0,
            'average_days_between_activity':round(sum(gaps)/len(gaps),1) if gaps else None,
            'segments':{k:sum(1 for r in rows if r['crm']['segment']==k) for k in ('new','active','frequent','at_risk','inactive_60','inactive_90')}}


@app.get('/api/v1/business/{public_id}/wallet-queue')
async def wallet_queue_status(public_id:str, authorization:str=Header(default=''), limit:int=Query(default=100,ge=1,le=500)):
    require_owner_session(public_id,authorization)
    business=safe_get_business(public_id)
    if not business: raise HTTPException(status_code=404,detail='Business not found')
    rows=(supabase.table('wallet_sync_jobs').select('*').eq('business_id',business.get('id')).order('created_at',desc=True).limit(limit).execute().data or [])
    return {'jobs':rows,'pending':sum(1 for x in rows if x.get('status') in ('pending','processing')),
            'failed':sum(1 for x in rows if x.get('status')=='failed')}

"""Verified shared LT membership and merchant coupons, independent of local rewards.

All balance/inventory changes are service-only PostgreSQL transactions. Route
functions are synchronous so FastAPI runs SDK/email calls outside its event loop.
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import threading
import time
from typing import Literal, Optional
from urllib.parse import urlsplit
import uuid

from fastapi import Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CardEntry(StrictModel):
    customer_public_id: str = Field(min_length=1, max_length=100)
    card_token: str = Field(min_length=1, max_length=1024)


class CodeRequest(CardEntry):
    consent: Literal[True]

    @field_validator("consent", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("Explicit consent is required")
        return value


class CodeVerify(StrictModel):
    challenge_id: uuid.UUID
    code: str = Field(pattern=r"^\d{6}$")


class QrCodeRequest(StrictModel):
    email: str = Field(min_length=3, max_length=200)
    business_slug: str = Field(default="", max_length=120)
    consent: Literal[True]

    _consent = field_validator("consent", mode="before")(CodeRequest.explicit_consent.__func__)

    @field_validator("email")
    @classmethod
    def email_address(cls, value):
        email = str(value or "").strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("Enter the email on your loyalty card")
        return email

    @field_validator("business_slug")
    @classmethod
    def business_slug_value(cls, value):
        slug = str(value or "").strip()
        if slug and not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", slug):
            raise ValueError("Invalid business")
        return slug


class RedeemCodeRequest(StrictModel):
    offer_id: uuid.UUID


class ConfirmCards(StrictModel):
    customer_public_ids: list[str] = Field(min_length=1, max_length=20)

    @field_validator("customer_public_ids")
    @classmethod
    def card_ids(cls, value):
        cleaned = []
        for item in value:
            card_id = str(item or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", card_id):
                raise ValueError("Invalid card")
            cleaned.append(card_id)
        return list(dict.fromkeys(cleaned))


class BusinessApproval(StrictModel):
    approved: bool = Field(strict=True)


class LinkRequest(StrictModel):
    customer_public_id: str = Field(min_length=1, max_length=100)
    card_token: str = Field(min_length=1, max_length=1024)
    consent: Literal[True]

    _consent = field_validator("consent", mode="before")(CodeRequest.explicit_consent.__func__)


class OfferCreate(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    terms: str = Field(default="", max_length=3000)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    category: Literal["food_drink", "shopping", "wellness", "experiences", "other"] = "other"
    discount_centavos: int = Field(strict=True, ge=1, le=100_000_000)
    points_cost: int = Field(strict=True, ge=1, le=10_000_000)
    total_quantity: int = Field(strict=True, ge=1, le=1_000_000)
    per_member_limit: int = Field(default=1, strict=True, ge=1, le=100)
    min_spend_centavos: int = Field(default=0, strict=True, ge=0, le=100_000_000)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    coupon_valid_days: int = Field(default=30, strict=True, ge=1, le=365)
    status: Literal["draft", "active", "paused"] = "draft"

    @field_validator("image_url")
    @classmethod
    def https_image(cls, value):
        if not value:
            return None
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in value):
            raise ValueError("Image must be a public HTTPS URL")
        return value

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value):
        if not value.strip():
            raise ValueError("Title is required")
        return value.strip()

    @field_validator("starts_at", "ends_at")
    @classmethod
    def aware_dates(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError("Include a timezone in dates")
        return value

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("End must be after start")
        return self


class OfferPatch(StrictModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    terms: Optional[str] = Field(default=None, max_length=3000)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    category: Optional[Literal["food_drink", "shopping", "wellness", "experiences", "other"]] = None
    discount_centavos: Optional[int] = Field(default=None, strict=True, ge=1, le=100_000_000)
    points_cost: Optional[int] = Field(default=None, strict=True, ge=1, le=10_000_000)
    total_quantity: Optional[int] = Field(default=None, strict=True, ge=1, le=1_000_000)
    per_member_limit: Optional[int] = Field(default=None, strict=True, ge=1, le=100)
    min_spend_centavos: Optional[int] = Field(default=None, strict=True, ge=0, le=100_000_000)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    coupon_valid_days: Optional[int] = Field(default=None, strict=True, ge=1, le=365)
    status: Optional[Literal["draft", "active", "paused"]] = None

    _image = field_validator("image_url")(OfferCreate.https_image.__func__)
    _title = field_validator("title")(lambda v: OfferCreate.nonblank_title(v) if v is not None else v)
    _dates = field_validator("starts_at", "ends_at")(OfferCreate.aware_dates.__func__)

    @model_validator(mode="after")
    def explicit_nulls(self):
        for name in self.model_fields_set - {"image_url", "starts_at", "ends_at"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("End must be after start")
        return self


class CouponUse(StrictModel):
    customer_public_id: str = Field(min_length=1, max_length=100)
    bill_amount_centavos: int = Field(strict=True, ge=1, le=100_000_000_000)
    receipt_reference: Optional[str] = Field(default=None, max_length=100)


class SettingsUpdate(StrictModel):
    enabled: Optional[bool] = Field(default=None, strict=True)
    pesos_per_point: Optional[int] = Field(default=None, strict=True, ge=1, le=1_000_000)
    max_points_per_transaction: Optional[int] = Field(default=None, strict=True, ge=1, le=1_000_000)

    @model_validator(mode="after")
    def required_if_set(self):
        for name in self.model_fields_set - {"max_points_per_transaction"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


def normalize_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("09"):
        digits = "63" + digits[1:]
    return digits if 8 <= len(digits) <= 15 else ""


def mask_email(email):
    local, _, domain = str(email).partition("@")
    return f"{local[:1]}***@{domain[:1]}***" if domain else "***"


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_hash(value):
    return _hash(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True))


def _key(value):
    if not value or len(value) > 100 or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,100}", value):
        raise HTTPException(422, "Send a unique Idempotency-Key (8 to 100 letters, numbers, hyphens).")
    return value


def _money(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 100_000_000_000:
        raise ValueError("amount_centavos must be a positive integer")
    return value


ERRORS = {
    "unavailable": (503, "LT Benefits is not available right now."),
    "unauthorized": (401, "Open Benefits from your Wallet card and verify again."),
    "invalid_code": (400, "The code is invalid or expired."),
    "card_contact_changed": (409, "The card contact changed. Start verification again."),
    "card_link_conflict": (409, "This card cannot be linked to this account."),
    "not_found": (404, "Not found."),
    "stock_below_claimed": (409, "Quantity cannot be lower than existing claims."),
    "idempotency_conflict": (409, "This request key was already used for a different action."),
    "offer_closed": (409, "This offer is not available for claiming."),
    "out_of_stock": (409, "This offer is fully claimed."),
    "insufficient_points": (409, "Not enough LT Points."),
    "member_limit": (409, "You have reached this offer's claim limit."),
    "already_used": (409, "This coupon has already been used."),
    "coupon_expired": (409, "This coupon has expired."),
    "minimum_spend": (409, "The bill does not meet the coupon minimum or discount value."),
    "invalid_amount": (422, "Invalid amount."),
    "source_conflict": (409, "This purchase reference conflicts with an existing award."),
    "refund_exceeds_purchase": (409, "Refund exceeds the remaining purchase amount."),
}


class LTBenefitsService:
    def __init__(self, *, db, get_business, get_card_context, require_owner, require_staff,
                 require_admin, send_email, sync_member=None, log=None, enabled=None):
        self.db = db
        self.get_business = get_business
        self.get_card_context = get_card_context
        self.require_owner = require_owner
        self.require_staff = require_staff
        self.require_admin = require_admin
        self.send_email = send_email
        self.sync_member = sync_member
        self.log = log
        self._enabled_override = enabled
        self._projection_cache = OrderedDict()
        self._cache_lock = threading.Lock()

    def enabled(self):
        value = self._enabled_override
        if callable(value):
            return bool(value())
        return bool(value) if value is not None else os.getenv("LT_BENEFITS_ENABLED", "false").lower() in ("1", "true", "yes")

    def _safe_log(self, event, **fields):
        # Only caller-supplied IDs/counts and exception TYPE; never contacts, code, bearer or RPC payload.
        try:
            if self.log:
                self.log(event, **fields)
        except Exception:
            pass

    def _command(self, action, **data):
        try:
            result = self.db.rpc("ltb_command", {"p_action": action, "p_data": data}).execute().data
        except Exception as exc:
            self._safe_log("lt_benefits_unavailable", action=action, error_type=type(exc).__name__)
            raise HTTPException(503, "LT Benefits setup or connection is unavailable. Apply backend/lt_benefits.sql before enabling.") from None
        if isinstance(result, dict) and result.get("error"):
            status, detail = ERRORS.get(result["error"], (409, "This action could not be completed."))
            raise HTTPException(status, detail)
        return result

    def ready(self):
        if not self.enabled():
            raise HTTPException(503, "LT Benefits is not enabled yet.")
        settings = self._command("settings")
        if not settings or not settings.get("enabled"):
            raise HTTPException(503, "LT Benefits is not available right now.")
        return settings

    def config(self):
        result = dict(enabled=self.enabled(), available=False, pesos_per_point=500, currency="PHP")
        if not result["enabled"]:
            return result
        try:
            state = self._command("settings")
            result.update(enabled=bool(state.get("enabled")), available=bool(state.get("enabled")),
                          pesos_per_point=int(state["pesos_per_point"]))
        except HTTPException:
            result["requires_sql"] = True
        return result

    def _secret(self):
        secret = os.getenv("LT_BENEFITS_AUTH_SECRET") or os.getenv("STAFF_SESSION_SECRET")
        if not secret or len(secret) < 24:
            raise HTTPException(503, "LT Benefits verification is not configured.")
        return secret

    def _code_hash(self, challenge_id, code):
        return hmac.new(self._secret().encode(), f"lt-benefits:{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()

    def _context(self, public_id, token):
        context = self.get_card_context(public_id, token)
        customer, business = context["customer"], context["business"]
        email = str(customer.get("email") or "").strip().lower()
        phone = normalize_phone(customer.get("phone"))
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not phone:
            raise HTTPException(409, "Add a valid email and phone number to this business card before connecting Benefits. Ask the business to update your details.")
        if str(customer.get("public_id")) != str(public_id) or str(customer.get("business_id")) != str(business["id"]):
            raise HTTPException(403, "Card does not match this business.")
        return dict(customer_public_id=str(public_id), customer_id=str(customer["id"]), business_id=str(business["id"]),
                    business_slug=str(business["public_id"]), business_name=business.get("name") or "Business",
                    business_logo_url=business.get("logo_url"), email=email, phone_key=phone)

    def provision_customer(self, customer, business):
        """Create a pending profile after signup, without merging or sending mail."""
        if not self.enabled() or customer.get('lt_benefits_card_enabled') is not True:
            return None
        email = str(customer.get("email") or "").strip().lower()
        phone = normalize_phone(customer.get("phone"))
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not phone:
            return None
        try:
            return self._command("provision", email=email, phone_key=phone,
                card_context=dict(customer_public_id=str(customer.get("public_id") or ""),
                    customer_id=str(customer.get("id") or ""), business_id=str(business.get("id") or ""),
                    business_slug=str(business.get("public_id") or ""),business_name=business.get("name") or "Business",
                    business_logo_url=business.get("logo_url"),phone_key=phone))
        except HTTPException:
            return None

    def entry(self, public_id, token, authorization=""):
        self.ready()
        card = self._context(public_id, token)
        self._command("provision", email=card["email"], phone_key=card["phone_key"],
                      card_context=card)
        verified = False
        if authorization:
            try:
                member, _ = self.member(authorization)
                verified = member.get("customer_public_id") == public_id
            except HTTPException as exc:
                if exc.status_code != 401:
                    raise
        return dict(email_masked=mask_email(card["email"]), business_name=card["business_name"],
                    verified=verified, verification_required=not verified)

    def request_code(self, body, request):
        self.ready()
        card = self._context(body.customer_public_id, body.card_token)
        challenge_id = str(uuid.uuid4())
        response = dict(challenge_id=challenge_id, expires_in=600, retry_after=60,
                        email_masked=mask_email(card["email"]),
                        message="If eligible, a verification code has been sent to the email on this card.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        client = request.client.host if request.client else "unknown"
        client_hash = hmac.new(self._secret().encode(), f"client:{client}".encode(), hashlib.sha256).hexdigest()
        result = self._command("auth_request", id=challenge_id, email=card["email"],
                               code_hash=self._code_hash(challenge_id, code), client_hash=client_hash, card_context=card)
        if result.get("accepted"):
            try:
                sent = self.send_email(card["email"], "Your Loyalty Tree verification code",
                    f"<p>Your Loyalty Tree verification code is <strong>{html.escape(code)}</strong>.</p>"
                    "<p>It expires in 10 minutes. Do not share this code.</p>")
            except Exception:
                sent = False
            if not sent:
                self._command("auth_send_failed", id=challenge_id)
        return response

    def verify_code(self, body):
        self.ready()
        token = secrets.token_urlsafe(32)
        result = self._command("auth_verify", id=str(body.challenge_id), code_hash=self._code_hash(body.challenge_id, body.code), token_hash=_hash(token))
        return dict(access_token=token, token_type="bearer", expires_in=5184000,
                    member=dict(id=result["member_id"], email_masked=mask_email(result["email"])), linked=bool(result.get("linked")), customer_public_id=result.get("customer_public_id"))

    def member(self, authorization):
        self.ready()
        parts = (authorization or "").split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != "bearer" or not 30 <= len(parts[1]) <= 200:
            raise HTTPException(401, "Open Benefits from your Wallet card and verify to continue.")
        result = self._command("session", token_hash=_hash(parts[1]))
        return result, _hash(parts[1])

    def owner(self, slug, authorization, *, staff=False):
        claims = None
        try:
            claims = self.require_owner(slug, authorization)
        except HTTPException as exc:
            if not staff or exc.status_code not in (401, 403):
                raise
            claims = self.require_staff(slug, authorization)
        business = self.get_business(slug)
        if not business:
            raise HTTPException(404, "Business not found.")
        self.ready()
        return business, claims or {}

    def invalidate(self, member_id=None):
        with self._cache_lock:
            if member_id is None:
                self._projection_cache.clear()
            else:
                for key, (_, projection) in list(self._projection_cache.items()):
                    if projection and str(projection.get("member_public_id")) == str(member_id):
                        self._projection_cache.pop(key, None)

    def wallet_projection(self, customer_public_id):
        if not self.enabled():
            return None
        now = time.monotonic()
        with self._cache_lock:
            cached = self._projection_cache.get(str(customer_public_id))
            if cached and cached[0] > now:
                self._projection_cache.move_to_end(str(customer_public_id))
                return json.loads(json.dumps(cached[1]))
        try:
            projection = self._command("wallet_projection", customer_public_id=str(customer_public_id))
        except HTTPException:
            return None  # Optional projection must never break Apple Add/local Wallet rewards.
        with self._cache_lock:
            self._projection_cache[str(customer_public_id)] = (now + 10, projection)
            self._projection_cache.move_to_end(str(customer_public_id))
            while len(self._projection_cache) > 128:
                self._projection_cache.popitem(last=False)
        return json.loads(json.dumps(projection))

    def earn(self, customer_public_id, business_id, source_type, source_id, amount_centavos, currency="PHP"):
        if not self.enabled():
            return dict(status="disabled")
        _money(amount_centavos)
        data = self._source(business_id, source_type, source_id)
        result = self._command("earn", **data, customer_public_id=str(customer_public_id), amount_centavos=amount_centavos, currency=str(currency).upper())
        self.invalidate(result.get("member_id"))
        return result

    def reverse(self, business_id, source_type, source_id, refund_id, amount_centavos):
        # Refund corrections must survive an earning/feature pause. Integration
        # catches an unavailable migration without failing its legacy refund.
        _money(amount_centavos)
        if not refund_id or len(str(refund_id)) > 200:
            raise ValueError("Stable refund reference required")
        result = self._command("reverse", **self._source(business_id, source_type, source_id), refund_id=str(refund_id), amount_centavos=amount_centavos)
        self.invalidate(result.get("member_id"))
        return result

    @staticmethod
    def _source(business_id, source_type, source_id):
        if not source_type or not source_id or len(str(source_type)) > 60 or len(str(source_id)) > 200:
            raise ValueError("Stable purchase source required")
        return dict(business_id=str(business_id), source_type=str(source_type), source_id=str(source_id))

    def process_wallet_jobs(self, sync_member=None, limit=5):
        if not self.enabled():
            return 0
        callback = sync_member or self.sync_member
        if not callback:
            return 0
        jobs = self._command("wallet_jobs_claim", limit=max(1, min(int(limit), 10))) or []
        finished = 0
        for job in jobs:
            success = False
            try:
                self.invalidate(job["member_id"])
                # Callback queues existing per-card jobs; it must raise on queue failure.
                outcome = callback(job["member_id"], job["cards"])
                success = outcome is not False
                if success:
                    finished += 1
            except Exception as exc:
                self._safe_log("lt_benefits_wallet_retry", member_id=job["member_id"], error_type=type(exc).__name__)
            try:
                self._command("wallet_jobs_finish", member_id=job["member_id"], lease_token=job["lease_token"], version=job["version"], success=success)
            except HTTPException:
                pass  # Lease expiry safely retries an unacknowledged batch.
        return finished

    def maintenance(self, limit=10):
        """Bounded expiry projection refresh and expired auth cleanup; safe while paused."""
        try:
            result = self._command("maintenance", limit=max(1, min(int(limit), 10)))
            if result.get("members_updated"):
                self.invalidate()
            return result
        except HTTPException:
            return {"members_updated": 0, "available": False}

    def approved_slugs(self):
        """Businesses an admin has turned on. Everyone else stays Coming soon."""
        try:
            rows = self.db.table("businesses").select("public_id").eq("lt_benefits_approved", True).limit(500).execute().data or []
        except Exception as exc:
            self._safe_log("lt_benefits_approval_unavailable", error_type=type(exc).__name__)
            return set()
        return {str(row.get("public_id")) for row in rows if row.get("public_id")}

    def annotate_offers(self, offers):
        approved = self.approved_slugs()
        for offer in offers or []:
            if isinstance(offer, dict):
                offer["coming_soon"] = str(offer.get("business_slug") or "") not in approved
        return offers

    def assert_offer_live(self, offer_id):
        found = None
        offset = 0
        while offset < 300:
            page = self._command("catalog", limit=100, offset=offset) or {}
            offers = page.get("offers") or []
            found = next((offer for offer in offers if str(offer.get("id")) == str(offer_id)), None)
            if found or len(offers) < 100:
                break
            offset += 100
        if found and str(found.get("business_slug") or "") not in self.approved_slugs():
            raise HTTPException(409, "This benefit is coming soon.")
        return found

    def _business_map(self, business_ids):
        ids = [value for value in dict.fromkeys(str(value) for value in business_ids if value)][:40]
        if not ids:
            return {}
        rows = self.db.table("businesses").select("id,public_id,name,logo_url").in_("id", ids).execute().data or []
        return {str(row.get("id")): row for row in rows}

    def cards_for_email(self, email):
        email = str(email or "").strip().lower()
        if not email:
            return []
        rows = self.db.table("customers").select("id,public_id,name,email,phone,business_id").ilike("email", email).limit(40).execute().data or []
        rows = [row for row in rows if str(row.get("email") or "").strip().lower() == email and row.get("public_id")]
        businesses = self._business_map(row.get("business_id") for row in rows)
        cards = []
        for row in rows:
            business = businesses.get(str(row.get("business_id")))
            phone = normalize_phone(row.get("phone"))
            if not business or not business.get("public_id") or not phone:
                continue
            public_id = str(row.get("public_id"))
            cards.append({
                "customer_public_id": public_id,
                "name": str(row.get("name") or "Member").strip()[:80] or "Member",
                "business_name": business.get("name") or "Business",
                "business_slug": str(business.get("public_id")),
                "context": dict(customer_public_id=public_id, customer_id=str(row.get("id") or ""),
                    business_id=str(business.get("id") or row.get("business_id") or ""),
                    business_slug=str(business.get("public_id")), business_name=business.get("name") or "Business",
                    business_logo_url=business.get("logo_url"), phone_key=phone),
            })
        return cards

    def qr_request_code(self, body, request):
        """Email OTP from a business QR. Does not require the Wallet card link."""
        self.ready()
        email = body.email
        cards = []
        try:
            cards = self.cards_for_email(email)
        except Exception as exc:
            self._safe_log("lt_benefits_qr_lookup_failed", error_type=type(exc).__name__)
        card = next((item for item in cards if item["business_slug"] == body.business_slug), None) or (cards[0] if cards else None)
        challenge_id = str(uuid.uuid4())
        response = dict(challenge_id=challenge_id, expires_in=600, retry_after=60, email_masked=mask_email(email),
                        message="If this email is on a loyalty card, a verification code has been sent.")
        if not card:
            return response
        code = f"{secrets.randbelow(1_000_000):06d}"
        client = request.client.host if request.client else "unknown"
        client_hash = hmac.new(self._secret().encode(), f"client:{client}".encode(), hashlib.sha256).hexdigest()
        context = dict(card["context"], email=email)
        result = self._command("auth_request", id=challenge_id, email=email, code_hash=self._code_hash(challenge_id, code),
                               client_hash=client_hash, card_context=context)
        if result.get("accepted"):
            try:
                sent = self.send_email(email, "Your Loyalty Tree verification code",
                    f"<p>Your Loyalty Tree verification code is <strong>{html.escape(code)}</strong>.</p>"
                    "<p>It expires in 10 minutes. Do not share this code.</p>")
            except Exception:
                sent = False
            if not sent:
                self._command("auth_send_failed", id=challenge_id)
        return response

    def email_cards(self, authorization, business_slug=""):
        member, _ = self.member(authorization)
        me = self._command("me", member_id=member["member_id"], limit=100, offset=0) or {}
        linked = {str(card.get("customer_public_id")) for card in (me.get("cards") or [])}
        cards = []
        for card in self.cards_for_email(member.get("email")):
            cards.append({
                "customer_public_id": card["customer_public_id"],
                "name": card["name"],
                "business_name": card["business_name"],
                "business_slug": card["business_slug"],
                "included": card["customer_public_id"] in linked,
            })
        slug = str(business_slug or "").strip()
        return {
            "cards": cards,
            "business_slug": slug,
            "has_card_at_business": any(card["business_slug"] == slug for card in cards) if slug else None,
        }

    def confirm_email_cards(self, authorization, public_ids):
        """Include cards on the verified email using the same OTP link the Wallet flow already uses.

        The code is created and verified on the server. The customer already proved
        they can read this email, so they are not asked for a second code per card.
        """
        member, _ = self.member(authorization)
        email = str(member.get("email") or "").strip().lower()
        wanted = set(public_ids)
        included, failed = [], []
        for card in self.cards_for_email(email):
            if card["customer_public_id"] not in wanted:
                continue
            challenge_id = str(uuid.uuid4())
            code = f"{secrets.randbelow(1_000_000):06d}"
            context = dict(card["context"], email=email)
            try:
                result = self._command("auth_request", id=challenge_id, email=email,
                    code_hash=self._code_hash(challenge_id, code), client_hash=_hash(f"qr-confirm:{card['customer_public_id']}"), card_context=context)
                if not result.get("accepted"):
                    failed.append({"customer_public_id": card["customer_public_id"], "detail": "This card could not be included yet."})
                    continue
                verified = self._command("auth_verify", id=challenge_id, code_hash=self._code_hash(challenge_id, code), token_hash=_hash(secrets.token_urlsafe(32)))
                if str(verified.get("member_id") or "") != str(member["member_id"]):
                    failed.append({"customer_public_id": card["customer_public_id"], "detail": "This card belongs to a different Benefits profile."})
                    continue
                included.append(card["customer_public_id"])
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, str) else "This card could not be included."
                failed.append({"customer_public_id": card["customer_public_id"], "detail": detail})
        self.invalidate(member["member_id"])
        return {"included": included, "failed": failed}

    def request_redeem_code(self, authorization, offer_id):
        member, _ = self.member(authorization)
        self.assert_offer_live(offer_id)
        challenge_id = str(uuid.uuid4())
        code = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = datetime.now(timezone.utc).timestamp() + 600
        try:
            self.db.table("lt_benefit_redeem_challenges").insert({
                "id": challenge_id,
                "member_id": str(member["member_id"]),
                "offer_id": str(offer_id),
                "code_hash": self._code_hash(challenge_id, code),
                "expires_at": datetime.fromtimestamp(expires_at, timezone.utc).isoformat(),
            }).execute()
        except Exception as exc:
            self._safe_log("lt_benefits_redeem_unavailable", error_type=type(exc).__name__)
            raise HTTPException(503, "Redeem verification is not ready. Apply backend/lt_benefits_approval.sql.") from None
        email = str(member.get("email") or "").strip().lower()
        try:
            sent = self.send_email(email, "Your Loyalty Tree redeem code",
                f"<p>Your code to redeem this benefit is <strong>{html.escape(code)}</strong>.</p>"
                "<p>It expires in 10 minutes. Do not share this code.</p>")
        except Exception:
            sent = False
        if not sent:
            raise HTTPException(503, "The redeem code could not be sent. Try again.")
        return dict(challenge_id=challenge_id, expires_in=600, email_masked=mask_email(email))

    def consume_redeem_code(self, member_id, offer_id, challenge_id, code):
        if not challenge_id or not re.fullmatch(r"\d{6}", str(code or "")):
            raise HTTPException(400, "Enter the email code to redeem this benefit.")
        try:
            parsed = uuid.UUID(str(challenge_id))
        except ValueError:
            raise HTTPException(400, "Enter the email code to redeem this benefit.") from None
        try:
            rows = self.db.table("lt_benefit_redeem_challenges").select("id,member_id,offer_id,code_hash,expires_at,used_at").eq("id", str(parsed)).limit(1).execute().data or []
        except Exception as exc:
            self._safe_log("lt_benefits_redeem_unavailable", error_type=type(exc).__name__)
            raise HTTPException(503, "Redeem verification is not ready. Apply backend/lt_benefits_approval.sql.") from None
        row = rows[0] if rows else None
        expires = row.get("expires_at") if row else None
        try:
            expired = not expires or datetime.fromisoformat(str(expires).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except ValueError:
            expired = True
        expected = self._code_hash(str(parsed), str(code))
        if not row or row.get("used_at") or expired or str(row.get("member_id")) != str(member_id) or str(row.get("offer_id")) != str(offer_id) or not hmac.compare_digest(str(row.get("code_hash") or ""), expected):
            raise HTTPException(400, "The code is invalid or expired.")
        try:
            updated = self.db.table("lt_benefit_redeem_challenges").update({"used_at": datetime.now(timezone.utc).isoformat()}).eq("id", str(parsed)).is_("used_at", "null").execute().data or []
        except Exception:
            updated = []
        if not updated:
            raise HTTPException(400, "The code is invalid or expired.")
        return True


def register_lt_benefits_routes(app, *, db, get_business, get_card_context, require_owner,
                                require_staff, require_admin, send_email, sync_member=None,
                                log=None, enabled=None):
    service = LTBenefitsService(db=db, get_business=get_business, get_card_context=get_card_context,
        require_owner=require_owner, require_staff=require_staff, require_admin=require_admin,
        send_email=send_email, sync_member=sync_member, log=log, enabled=enabled)

    @app.middleware("http")
    async def benefits_privacy_headers(request: Request, call_next):
        response = await call_next(request)
        if "/lt-benefits" in request.url.path or request.url.path.startswith("/api/v1/benefits"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.get("/api/v1/benefits/config")
    def config():
        return service.config()

    @app.get("/api/v1/benefits/business-status")
    def business_status(business: str = Query("", max_length=160)):
        slug = business.strip().split("/")[0]
        return {"approved": bool(slug) and slug in service.approved_slugs()}

    @app.get("/api/v1/benefits/offers")
    def catalog(authorization: str = Header(""), limit: int = Query(24, ge=1, le=100), offset: int = Query(0, ge=0, le=10000)):
        service.member(authorization)
        result = service._command("catalog", limit=limit, offset=offset)
        result["offers"] = service.annotate_offers(result["offers"][:limit])
        return result

    @app.post("/api/v1/benefits/qr/request-code")
    def qr_request_code(body: QrCodeRequest, request: Request):
        return service.qr_request_code(body, request)

    @app.get("/api/v1/benefits/email-cards")
    def email_cards(authorization: str = Header(""), business: str = Query("", max_length=120)):
        return service.email_cards(authorization, business)

    @app.post("/api/v1/benefits/email-cards/confirm")
    def confirm_email_cards(body: ConfirmCards, authorization: str = Header("")):
        return service.confirm_email_cards(authorization, body.customer_public_ids)

    @app.post("/api/v1/benefits/redeem/request-code")
    def redeem_request_code(body: RedeemCodeRequest, authorization: str = Header("")):
        return service.request_redeem_code(authorization, body.offer_id)

    @app.post("/api/v1/benefits/entry")
    def entry(body: CardEntry, authorization: str = Header("")):
        return service.entry(body.customer_public_id, body.card_token, authorization)

    @app.post("/api/v1/benefits/auth/request-code")
    def request_code(body: CodeRequest, request: Request):
        return service.request_code(body, request)

    @app.post("/api/v1/benefits/auth/verify")
    def verify(body: CodeVerify):
        return service.verify_code(body)

    @app.get("/api/v1/benefits/me")
    def me(authorization: str = Header(""), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=10000)):
        member, _ = service.member(authorization)
        result = service._command("me", member_id=member["member_id"], limit=limit, offset=offset)
        result["member"] = dict(id=member["member_id"], email_masked=mask_email(member["email"]))
        return result

    @app.post("/api/v1/benefits/link")
    def link(body: LinkRequest, authorization: str = Header("")):
        member, _ = service.member(authorization)
        raise HTTPException(409, "Verify the OTP from this Wallet card to connect it. Existing sessions cannot link a new card without verification.")

    @app.post("/api/v1/benefits/offers/{offer_id}/claim")
    def claim(offer_id: uuid.UUID, authorization: str = Header(""), idempotency_key: str = Header("", alias="Idempotency-Key"),
              redeem_challenge: str = Header("", alias="X-Redeem-Challenge"), redeem_code: str = Header("", alias="X-Redeem-Code")):
        member, _ = service.member(authorization)
        service.assert_offer_live(offer_id)
        service.consume_redeem_code(member["member_id"], offer_id, redeem_challenge, redeem_code)
        result = service._command("claim", member_id=member["member_id"], offer_id=str(offer_id), key=_key(idempotency_key), request_hash=_canonical_hash(dict(offer_id=str(offer_id))))
        service.invalidate(member["member_id"])
        return result

    @app.post("/api/v1/benefits/logout")
    def logout(authorization: str = Header("")):
        _, token_hash = service.member(authorization)
        return service._command("logout", token_hash=token_hash)

    def business_data(business):
        return dict(business_id=str(business["id"]), business_slug=str(business["public_id"]),
                    business_name=business.get("name") or "Business", business_logo_url=business.get("logo_url"))

    @app.get("/api/v1/business/{slug}/lt-benefits/offers")
    def owner_offers(slug: str, authorization: str = Header(""), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=10000)):
        business, _ = service.owner(slug, authorization)
        result = service._command("owner_offers", business_id=str(business["id"]), limit=limit, offset=offset)
        result["offers"] = result["offers"][:limit]
        return result

    @app.post("/api/v1/business/{slug}/lt-benefits/offers")
    def create_offer(slug: str, body: OfferCreate, authorization: str = Header("")):
        business, _ = service.owner(slug, authorization)
        return service._command("offer_save", **business_data(business), offer=body.model_dump(mode="json"))

    @app.patch("/api/v1/business/{slug}/lt-benefits/offers/{offer_id}")
    def update_offer(slug: str, offer_id: uuid.UUID, body: OfferPatch, authorization: str = Header("")):
        business, _ = service.owner(slug, authorization)
        return service._command("offer_save", **business_data(business), offer_id=str(offer_id), offer=body.model_dump(mode="json", exclude_unset=True))

    @app.get("/api/v1/business/{slug}/lt-benefits/report")
    def report(slug: str, authorization: str = Header(""), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=10000)):
        business, _ = service.owner(slug, authorization)
        return service._command("report", business_id=str(business["id"]), limit=limit, offset=offset)

    @app.get("/api/v1/business/{slug}/lt-benefits/customer/{customer_public_id}")
    def cashier_customer(slug: str, customer_public_id: str, authorization: str = Header("")):
        business, _ = service.owner(slug, authorization, staff=True)
        if len(customer_public_id) > 100:
            raise HTTPException(422, "Invalid card ID")
        return service._command("cashier_customer", business_id=str(business["id"]), customer_public_id=customer_public_id)

    @app.post("/api/v1/business/{slug}/lt-benefits/coupons/{coupon_id}/use")
    def use(slug: str, coupon_id: uuid.UUID, body: CouponUse, authorization: str = Header(""), idempotency_key: str = Header("", alias="Idempotency-Key")):
        business, claims = service.owner(slug, authorization, staff=True)
        data = body.model_dump(mode="json")
        result = service._command("use", business_id=str(business["id"]), coupon_id=str(coupon_id), **data,
            staff_id=str(claims.get("staff_id") or "owner"), branch_id=str(claims["branch_id"]) if claims.get("branch_id") else None,
            key=_key(idempotency_key), request_hash=_canonical_hash(dict(coupon_id=str(coupon_id), **data)))
        service.invalidate()
        return result

    @app.get("/api/v1/admin/lt-benefits/settings")
    def admin_settings(request: Request):
        service.require_admin(request)
        return service._command("settings")

    @app.put("/api/v1/admin/lt-benefits/settings")
    def save_admin_settings(body: SettingsUpdate, request: Request):
        service.require_admin(request)
        result = service._command("settings_update", **body.model_dump(exclude_unset=True))
        service.invalidate()
        return result

    @app.get("/api/v1/admin/lt-benefits/businesses")
    def admin_benefit_businesses(request: Request):
        service.require_admin(request)
        try:
            rows = service.db.table("businesses").select("public_id,name,lt_benefits_approved").order("name").limit(300).execute().data or []
        except Exception as exc:
            service._safe_log("lt_benefits_approval_unavailable", error_type=type(exc).__name__)
            raise HTTPException(503, "Business approval is not ready. Apply backend/lt_benefits_approval.sql.") from None
        return {"businesses": [{"public_id": row.get("public_id"), "name": row.get("name") or "Business", "approved": row.get("lt_benefits_approved") is True} for row in rows if row.get("public_id")]}

    @app.put("/api/v1/admin/lt-benefits/businesses/{slug}")
    def admin_approve_benefit_business(slug: str, body: BusinessApproval, request: Request):
        service.require_admin(request)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", slug):
            raise HTTPException(422, "Invalid business")
        try:
            updated = service.db.table("businesses").update({"lt_benefits_approved": body.approved}).eq("public_id", slug).execute().data or []
        except Exception as exc:
            service._safe_log("lt_benefits_approval_unavailable", error_type=type(exc).__name__)
            raise HTTPException(503, "Business approval is not ready. Apply backend/lt_benefits_approval.sql.") from None
        if not updated:
            raise HTTPException(404, "Business not found.")
        return {"public_id": slug, "approved": body.approved}

    return service

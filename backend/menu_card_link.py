import hashlib, hmac, html, json, os, re, time, base64, secrets
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field

EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
_recent = {}

class CardEmail(BaseModel):
    email: str = Field(min_length=3, max_length=200)

class CardCode(BaseModel):
    challenge: str = Field(min_length=20, max_length=4000)
    code: str = Field(min_length=6, max_length=6)

def _secret():
    secret = os.getenv("LT_BENEFITS_AUTH_SECRET") or os.getenv("STAFF_SESSION_SECRET") or ""
    if len(secret) < 24:
        raise HTTPException(503, "Card connection is not configured.")
    return secret.encode()

def _b64(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")

def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))

def sign(payload):
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return _b64(raw) + "." + _b64(hmac.new(_secret(), raw, hashlib.sha256).digest())

def read_token(token, kind):
    try:
        body, mac = str(token or "").split(".", 1)
        raw = _unb64(body)
        expected = hmac.new(_secret(), raw, hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(mac), expected):
            raise ValueError
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(401, "This connection expired. Enter your email again.")
    if payload.get("kind") != kind or int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(401, "This connection expired. Enter your email again.")
    return payload

def mask_email(email):
    name, _, domain = email.partition("@")
    return (name[:1] or "*") + "***@" + domain

def normalize_email(value):
    email = str(value or "").strip().lower()
    if not EMAIL.fullmatch(email) or len(email) > 200:
        raise HTTPException(422, "Enter the email on your loyalty card.")
    return email

def register_menu_card_routes(app, *, db, get_business, has_feature, on_hold, send_email, frontend_url):
    def business_for(public_id):
        business = get_business(public_id)
        if not business or not has_feature(business, "qr_menu"):
            raise HTTPException(404, "This menu is not available right now.")
        if str(business.get("status") or "").upper() != "ACTIVE" or on_hold(business):
            raise HTTPException(404, "This menu is not available right now.")
        return business

    def customer_for(business, email):
        try:
            rows = db.table("customers").select("public_id,name,email").eq("business_id", business["id"]).ilike("email", email).order("created_at", desc=True).limit(5).execute().data or []
        except Exception as exc:
            raise HTTPException(503, "Card lookup is unavailable. Try again shortly.") from exc
        for row in rows:
            if str(row.get("email") or "").strip().lower() == email and row.get("public_id"):
                return row
        return None

    @app.post("/api/v1/public/menu/{public_id}/card/request")
    def request_card(public_id: str, body: CardEmail):
        business = business_for(public_id)
        email = normalize_email(body.email)
        now = time.time()
        if now - _recent.get((public_id, email), 0) < 60:
            raise HTTPException(429, "Wait a minute before asking for another code.")
        customer = customer_for(business, email)
        if not customer:
            raise HTTPException(404, "No loyalty card uses this email at this business yet.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        challenge = sign(dict(kind="challenge", business_public_id=str(business["public_id"]), email=email,
            customer_public_id=str(customer["public_id"]), name=str(customer.get("name") or "Loyalty card")[:80],
            code_hash=hashlib.sha256(f"{email}:{code}".encode()).hexdigest(), exp=int(now + 600)))
        safe_name = html.escape(str(business.get("name") or "this business"))
        sent = send_email(email, "Your Loyalty Tree card code",
            f"<p>Your code to connect your loyalty card at <strong>{safe_name}</strong> is <strong>{html.escape(code)}</strong>.</p><p>It expires in 10 minutes. This phone stays connected for 6 months.</p>")
        if not sent:
            raise HTTPException(503, "We could not send the code. Try again in a minute.")
        _recent[(public_id, email)] = now
        return dict(challenge=challenge, email_masked=mask_email(email), expires_in=600)

    @app.post("/api/v1/public/menu/{public_id}/card/verify")
    def verify_card(public_id: str, body: CardCode):
        business = business_for(public_id)
        payload = read_token(body.challenge, "challenge")
        if payload.get("business_public_id") != str(business["public_id"]) or not str(body.code).isdigit():
            raise HTTPException(401, "That code is not valid. Request a new one.")
        expected = hashlib.sha256(f"{payload['email']}:{body.code}".encode()).hexdigest()
        if not hmac.compare_digest(expected, str(payload.get("code_hash") or "")):
            raise HTTPException(401, "That code is not valid. Request a new one.")
        token = sign(dict(kind="session", business_public_id=str(business["public_id"]),
            customer_public_id=payload["customer_public_id"], email=payload["email"], name=payload["name"],
            exp=int(time.time() + 180 * 24 * 60 * 60)))
        return dict(token=token, name=payload["name"], email_masked=mask_email(payload["email"]), expires_in=180 * 24 * 60 * 60)

    @app.get("/api/v1/public/menu/{public_id}/card")
    def current_card(public_id: str, authorization: str = Header(default="")):
        business = business_for(public_id)
        parts = authorization.split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(401, "Connect your loyalty card.")
        payload = read_token(parts[1], "session")
        if payload.get("business_public_id") != str(business["public_id"]):
            raise HTTPException(401, "Connect your loyalty card.")
        return dict(name=payload.get("name") or "Loyalty card", email_masked=mask_email(payload.get("email") or ""))

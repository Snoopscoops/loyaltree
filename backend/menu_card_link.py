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

def register_menu_card_routes(app, *, db, get_business, has_feature, on_hold, send_email, frontend_url,
                              get_customer_by_public_id=None, get_program=None, get_redeemables=None,
                              uses_points=None, uses_stamps=None):
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
        name = str(payload.get("name") or "").strip()
        customer_public_id = str(payload.get("customer_public_id") or "")
        if customer_public_id:
            try:
                rows = db.table("customers").select("name").eq("business_id", business["id"]).eq("public_id", customer_public_id).limit(1).execute().data or []
            except Exception:
                rows = []
            live = str((rows[0].get("name") if rows else "") or "").strip()
            if live:
                name = live
        if name == "Loyalty card":
            name = ""
        # customer_public_id lets the tap/scan page say "Welcome back" with card progress.
        return dict(name=name, email_masked=mask_email(payload.get("email") or ""), customer_public_id=customer_public_id)

    @app.get("/api/v1/public/menu/{public_id}/card/rewards")
    def card_checkout_rewards(public_id: str, authorization: str = Header(default="")):
        """Read-only rewards for a verified member at this exact business."""
        from fastapi.responses import JSONResponse
        try:
            from .menu_checkout_rewards import checkout_rewards_payload
        except ImportError:
            from menu_checkout_rewards import checkout_rewards_payload
        business = business_for(public_id)
        parts = authorization.split(" ", 1)
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            raise HTTPException(401, "Connect your loyalty card to see rewards.")
        payload = read_token(parts[1], 'session')
        if str(payload.get('business_public_id') or '') != str(business.get('public_id')):
            raise HTTPException(401, "Connect your loyalty card to see rewards.")
        if not all([get_customer_by_public_id, get_program, get_redeemables, uses_points, uses_stamps]):
            raise HTTPException(503, "Rewards are not available right now.")
        customer_id = str(payload.get('customer_public_id') or '')
        try:
            customer = get_customer_by_public_id(customer_id)
            if not customer or str(customer.get('business_id')) != str(business.get('id')) or str(customer.get('public_id')) != customer_id:
                raise HTTPException(401, "Reconnect your loyalty card.")
            program = get_program(customer, business.get('id')) or {}
            available = get_redeemables(business, customer, program) if program else []
            body = checkout_rewards_payload(customer, program, available, uses_points, uses_stamps)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Rewards could not be loaded. Your order can still proceed.")
        return JSONResponse(content=body, headers={'Cache-Control': 'private, no-store'})


    @app.get("/api/v1/public/menu/{public_id}/card/history")
    def card_history(public_id: str, authorization: str = Header(default="")):
        """Verified connected customer's own loyalty ledger; read-only, no public enumeration.

        Never use a customer id from the query string. Every data access is
        constrained by both the business resolved from the URL and the signed
        card-session customer identity.
        """
        from fastapi.responses import JSONResponse
        business = business_for(public_id)
        parts = authorization.split(' ', 1)
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            raise HTTPException(401, "Connect your loyalty card to view history.")
        payload = read_token(parts[1], 'session')
        if str(payload.get('business_public_id') or '') != str(business.get('public_id')):
            raise HTTPException(401, "Reconnect your loyalty card.")
        if not all([get_customer_by_public_id, get_program, uses_points, uses_stamps]):
            raise HTTPException(503, "Card history is not available right now.")
        customer_public_id = str(payload.get('customer_public_id') or '')
        try:
            customer = get_customer_by_public_id(customer_public_id)
            if not customer or str(customer.get('business_id')) != str(business.get('id')) or str(customer.get('public_id')) != customer_public_id:
                raise HTTPException(401, "Reconnect your loyalty card.")
            program = get_program(customer, business.get('id')) or {}
            use_stamps = bool(program and uses_stamps(program))
            use_points = bool(program and uses_points(program))
            history = []
            def ledger(table, columns, kind, *, status=None):
                query = db.table(table).select(columns).eq('business_id', business['id']).eq('customer_id', customer['id'])
                if status:
                    query = query.eq('status', status)
                return query.order('created_at' if table != 'menu_order_redemptions' else 'completed_at', desc=True).limit(30).execute().data or []
            if use_stamps:
                for item in ledger('stamp_events', 'id,created_at', 'stamp'):
                    history.append({'id': f"stamp-{item.get('id')}", 'type': 'earned', 'label': 'Stamp earned', 'amount': 1, 'unit': 'stamps', 'created_at': item.get('created_at')})
            if use_points:
                for item in ledger('points_events', 'id,created_at,points_earned', 'points'):
                    points = int(item.get('points_earned') or 0)
                    history.append({'id': f"points-{item.get('id')}", 'type': 'earned', 'label': 'Points earned', 'amount': points, 'unit': 'points', 'created_at': item.get('created_at')})
            if use_stamps or use_points:
                for item in ledger('redemption_events', 'id,created_at,points_spent', 'redeemed'):
                    spent = int(item.get('points_spent') or 0) if use_points else 0
                    history.append({'id': f"redemption-{item.get('id')}", 'type': 'redeemed', 'label': 'Reward redeemed', 'amount': -spent if spent else None, 'unit': 'points' if spent else '', 'created_at': item.get('created_at')})
                # Checkout reward redemptions are separate from classic redemption_events.
                # Only finalized 'redeemed' rows are customer-visible; no pending/reserved entries.
                query = (db.table('menu_order_redemptions')
                    .select('order_public_id,kind,status,completed_at,required_stamps,points_cost')
                    .eq('business_id', business['id']).eq('customer_id', customer['id'])
                    .eq('status', 'redeemed').order('completed_at', desc=True).limit(30))
                for item in query.execute().data or []:
                    kind = str(item.get('kind') or '')
                    if kind not in ('stamp_reward', 'points_prize') or (kind == 'stamp_reward' and not use_stamps) or (kind == 'points_prize' and not use_points):
                        continue
                    amount = int(item.get('points_cost') or 0) if kind == 'points_prize' else None
                    history.append({'id': f"menu-redemption-{item.get('order_public_id')}", 'type': 'redeemed',
                        'label': 'Reward redeemed', 'amount': -amount if amount else None,
                        'unit': 'points' if amount else '', 'created_at': item.get('completed_at')})
            history = [item for item in history if item.get('created_at')]
            history.sort(key=lambda item: str(item['created_at']), reverse=True)
            try:
                stamp_goal = int(program.get('stamp_goal')) if use_stamps else None
                if stamp_goal is not None and stamp_goal <= 0: stamp_goal = None
            except (TypeError, ValueError, OverflowError): stamp_goal = None
            result = {'card_type': str(program.get('card_type') or '').lower()[:32],
                'card_name': str(program.get('name') or program.get('program_name') or 'Loyalty card')[:100],
                'business_name': str(business.get('name') or '')[:120],
                'points_balance': max(0, int(customer.get('points_balance') or 0)) if use_points else None,
                'stamp_count': max(0, int(customer.get('stamp_count') or 0)) if use_stamps else None,
                'stamp_goal': stamp_goal, 'points_enabled': use_points, 'stamps_enabled': use_stamps,
                'events': history[:40], 'limit': 40}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, 'Card history is temporarily unavailable. Try again later.') from exc
        return JSONResponse(result, headers={'Cache-Control': 'private, no-store'})

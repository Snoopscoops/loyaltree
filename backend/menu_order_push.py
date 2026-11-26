"""New-order push to the LoyaltyTree app through Firebase Cloud Messaging (HTTP v1).

Why: the app only polls every 20 seconds while it is open. A push wakes the phone
even when the app is closed or the screen is locked, so the owner, the managers and
the cashiers of that branch hear the order chime right away.

Setup (done by the owner, never in code or chat):
- Render env var FIREBASE_SERVICE_ACCOUNT_JSON = the whole service account JSON
  from Firebase (Project settings > Service accounts > Generate new private key).
- Supabase: run backend/owner_app_devices.sql once.

Safety:
- No env var, bad JSON, or no table yet: push is a silent no-op. Saving the order
  never waits for, or fails because of, a push.
- Android gets data-only messages so the app plays its own new-order chime.
- iOS gets an APNs alert via FCM with the bundled lt_new_order.caf sound,
  time-sensitive interruption level, and a per-branch notification thread.
- The Android app checks its own local mute/settings. For iOS, the server
  respects alerts_on and muted_branches saved during device registration.
- Tokens Firebase reports as UNREGISTERED are deleted.

Who gets a push for an order of branch B:
- every owner device of the business
- managers of branch B, and managers with no branch (they see every branch)
- cashiers of branch B
Staff rows are re-read when sending, so a moved or disabled person stops getting
pushes right away.
"""
import asyncio
import json
import os
import threading
import time
from datetime import datetime, timezone

from fastapi import Header, HTTPException, Request

ENV_NAME = 'FIREBASE_SERVICE_ACCOUNT_JSON'
PROJECT_ENV_NAME = 'FIREBASE_PROJECT_ID'
DEFAULT_PROJECT_ID = 'loyaltytree-7a81a'
TABLE = 'owner_app_devices'
SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
MAX_DEVICES = 200
ROLES = ('owner', 'manager', 'cashier')


def _rows(result):
    data = getattr(result, 'data', None) or []
    return data if isinstance(data, list) else []


def _log(message):
    print(f'[order-push] {message}')


def load_credentials(environ=None):
    """The service account from FIREBASE_SERVICE_ACCOUNT_JSON, or None (push off)."""
    raw = (environ if environ is not None else os.environ).get(ENV_NAME) or ''
    raw = raw.strip()
    if not raw:
        return None
    try:
        info = json.loads(raw)
    except ValueError:
        _log(f'{ENV_NAME} is not valid JSON, push is off')
        return None
    if not isinstance(info, dict) or not info.get('client_email') or not info.get('private_key'):
        _log(f'{ENV_NAME} has no client_email / private_key, push is off')
        return None
    # Render sometimes keeps "\n" literally inside the key when pasted on one line.
    if '\\n' in info['private_key'] and '\n' not in info['private_key']:
        info = dict(info, private_key=info['private_key'].replace('\\n', '\n'))
    return info


def _default_post(url, **kwargs):
    import httpx
    with httpx.Client(timeout=10.0) as client:
        return client.post(url, **kwargs)


class FcmSender:
    """Minimal FCM HTTP v1 client. Uses PyJWT + httpx, already used for Google Wallet."""

    def __init__(self, info, *, project_id=None, post=None, clock=time.time):
        self.info = info
        self.project_id = project_id or info.get('project_id') or DEFAULT_PROJECT_ID
        self.post = post or _default_post
        self.clock = clock
        self._token, self._expires = '', 0.0
        self._lock = threading.Lock()

    @property
    def url(self):
        return f'https://fcm.googleapis.com/v1/projects/{self.project_id}/messages:send'

    def access_token(self, force=False):
        with self._lock:
            now = self.clock()
            if self._token and not force and now < self._expires - 60:
                return self._token
            import jwt as pyjwt
            issued = int(now)
            assertion = pyjwt.encode({
                'iss': self.info['client_email'], 'sub': self.info['client_email'], 'scope': SCOPE,
                'aud': self.info.get('token_uri') or TOKEN_URL, 'iat': issued, 'exp': issued + 3600,
            }, self.info['private_key'], algorithm='RS256')
            if isinstance(assertion, bytes):
                assertion = assertion.decode('utf-8')
            resp = self.post(self.info.get('token_uri') or TOKEN_URL, data={
                'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion})
            body = resp.json() if resp is not None else {}
            token = (body or {}).get('access_token') or ''
            if not token:
                raise RuntimeError(f'Google token error {getattr(resp, "status_code", "?")}')
            self._token = token
            self._expires = now + float((body or {}).get('expires_in') or 3600)
            return token

    def send(self, device_token, data, *, platform='android'):
        """Returns 'ok', 'unregistered' (delete the token) or 'error'."""
        message = {'message': {
            'token': device_token,
            'data': {str(k): str(v if v is not None else '') for k, v in data.items()},
        }}
        if platform == 'ios':
            # FCM forwards the platform-specific alert to APNs. An iPhone can
            # display this while locked, without app code running in background.
            branch = str(data.get('branch_public_id') or 'all')[:80]
            body = ' · '.join(part for part in (
                str(data.get('note') or ''), str(data.get('total') or ''),
                str(data.get('items') or '') + ' item(s)' if data.get('items') else '',
            ) if part)[:190] or 'New Digital Menu order'
            message['message']['apns'] = {
                'headers': {'apns-push-type': 'alert', 'apns-priority': '10'},
                'payload': {'aps': {
                    'alert': {'title': str(data.get('title') or 'New order')[:120], 'body': body},
                    'sound': 'lt_new_order.caf',
                    'interruption-level': 'time-sensitive',
                    'thread-id': 'lt-orders-' + branch,
                }},
            }
        else:
            # Preserve the owner-v9 Android data-only ringtone behavior.
            message['message']['android'] = {'priority': 'HIGH', 'ttl': '3600s'}
        for attempt in range(2):
            resp = self.post(self.url, json=message, headers={
                'Authorization': f'Bearer {self.access_token(force=attempt > 0)}',
                'Content-Type': 'application/json; charset=UTF-8'})
            code = getattr(resp, 'status_code', 0)
            if code == 200:
                return 'ok'
            if code == 401 and attempt == 0:
                continue  # expired access token: mint a new one once
            return 'unregistered' if is_unregistered(resp) else 'error'
        return 'error'


def is_unregistered(resp):
    try:
        error = (resp.json() or {}).get('error') or {}
    except Exception:
        return False
    for detail in error.get('details') or []:
        if isinstance(detail, dict) and detail.get('errorCode') == 'UNREGISTERED':
            return True
    return getattr(resp, 'status_code', 0) == 404 and error.get('status') == 'NOT_FOUND'


def branch_label(name):
    name = str(name or '').strip()
    if not name:
        return 'No branch'
    return name if name.lower().endswith('branch') else f'{name} branch'


def order_message(business, order):
    """Data payload (all strings). The phone builds the notification from it."""
    number = str(order.get('order_number') or '').strip().lstrip('#')
    items = [i for i in (order.get('items') or []) if isinstance(i, dict)]
    count = 0
    for item in items:
        try:
            count += max(1, int(item.get('quantity') or 1))
        except (TypeError, ValueError):
            count += 1
    try:
        total = f"₱{float(order.get('total') or 0):,.2f}".replace('.00', '')
    except (TypeError, ValueError):
        total = ''
    service = 'Dine in' if order.get('service') == 'dine-in' else 'Pickup'
    table_no = str(order.get('table_no') or '').strip()
    note = f'{service} · Table {table_no}' if table_no else service
    if order.get('service') != 'dine-in' and order.get('pickup_label'):
        note = f"Pickup · {order.get('pickup_label')}"
    lines = '\n'.join(f"{i.get('quantity') or 1} × {str(i.get('item_name') or 'Item')[:60]}" for i in items[:8])
    title = ' · '.join(x for x in (f'New order #{number}' if number else 'New order', branch_label(order.get('branch_name'))) if x)
    return {
        'type': 'new_order',
        'business': str(business.get('public_id') or ''),
        'order_id': str(order.get('public_id') or ''),
        'order_number': number,
        'branch_public_id': str(order.get('branch_public_id') or ''),
        'branch_name': str(order.get('branch_name') or ''),
        'title': title,
        'items': str(count),
        'total': total,
        'note': note,
        'lines': lines,
        'payment_method': str(order.get('payment_method') or ''),
        'payment_status': str(order.get('payment_status') or ''),
        'created_at': str(order.get('created_at') or ''),
    }


def recipients(db, business_id, branch_public_id):
    """Device rows that should ring for an order of this branch."""
    devices = _rows(db.table(TABLE).select('*').eq('business_id', business_id).limit(MAX_DEVICES).execute())
    if not devices:
        return []
    staff_ids = sorted({d.get('staff_id') for d in devices if d.get('role') != 'owner' and d.get('staff_id') is not None})
    staff_map, branch_map, fresh = {}, {}, False
    if staff_ids:
        try:
            staff_rows = _rows(db.table('staff').select('id,business_id,branch_id,is_active,role')
                               .eq('business_id', business_id).in_('id', staff_ids).execute())
            staff_map = {s.get('id'): s for s in staff_rows}
            branch_ids = sorted({s.get('branch_id') for s in staff_rows if s.get('branch_id') is not None})
            if branch_ids:
                branch_rows = _rows(db.table('branches').select('id,public_id,is_active')
                                    .eq('business_id', business_id).in_('id', branch_ids).execute())
                branch_map = {b.get('id'): b for b in branch_rows}
            fresh = True
        except Exception as e:
            _log(f'staff lookup failed, using saved branch scope: {e}')
    wanted = str(branch_public_id or '')
    picked = []
    for device in devices:
        role = str(device.get('role') or '').lower()
        if role == 'owner':
            picked.append(device)
            continue
        if role not in ('manager', 'cashier'):
            continue
        branch = str(device.get('branch_public_id') or '')
        if fresh:
            staff = staff_map.get(device.get('staff_id'))
            if not staff or staff.get('is_active') is False:
                continue
            role = str(staff.get('role') or role).lower()
            if staff.get('branch_id') is None:
                branch = ''
            else:
                place = branch_map.get(staff.get('branch_id'))
                if not place or place.get('is_active') is False:
                    continue
                branch = str(place.get('public_id') or '')
        if branch:
            if wanted and branch == wanted:
                picked.append(device)
        elif role == 'manager':
            picked.append(device)  # manager with no branch sees every branch
    return picked


def make_order_pusher(*, db, environ=None, sender_factory=None):
    """Returns push(business, order). Safe to call from a FastAPI background task."""
    state = {'sender': None, 'key': None}
    lock = threading.Lock()

    def sender():
        env = environ if environ is not None else os.environ
        raw = env.get(ENV_NAME) or ''
        with lock:
            if state['key'] != raw:
                info = load_credentials(env)
                if info is None:
                    state['sender'] = None
                else:
                    project = env.get(PROJECT_ENV_NAME) or info.get('project_id') or DEFAULT_PROJECT_ID
                    state['sender'] = (sender_factory or FcmSender)(info, project_id=project)
                state['key'] = raw
            return state['sender']

    def push(business, order):
        try:
            fcm = sender()
            if fcm is None or not business or not order:
                return {'sent': 0, 'removed': 0, 'skipped': True}
            devices = recipients(db, business.get('id'), order.get('branch_public_id'))
            if not devices:
                return {'sent': 0, 'removed': 0, 'skipped': False}
            data = order_message(business, order)
            sent, dead = 0, []
            for device in devices:
                token = device.get('token')
                if not token:
                    continue
                platform = str(device.get('platform') or 'android').lower()
                if platform == 'ios':
                    if device.get('alerts_on') is False:
                        continue
                    muted = device.get('muted_branches') or []
                    if isinstance(muted, list) and str(order.get('branch_public_id') or '') in muted:
                        continue
                try:
                    if platform == 'ios':
                        result = fcm.send(token, data, platform='ios')
                    else:
                        result = fcm.send(token, data)
                except Exception as e:
                    _log(f'send failed: {e}')
                    result = 'error'
                if result == 'ok':
                    sent += 1
                elif result == 'unregistered':
                    dead.append(token)
            for token in dead:
                try:
                    db.table(TABLE).delete().eq('token', token).execute()
                except Exception as e:
                    _log(f'could not remove dead token: {e}')
            return {'sent': sent, 'removed': len(dead), 'skipped': False}
        except Exception as e:
            # Never let a push problem surface anywhere near order creation.
            _log(f'push skipped: {e}')
            return {'sent': 0, 'removed': 0, 'skipped': True, 'error': str(e)}

    return push


def make_booking_pusher(*, db, environ=None, sender_factory=None):
    """Owner Android devices only. Booking details never appear in lockscreen data."""
    state = {"sender": None, "key": None}
    lock = threading.Lock()

    def push(business_id, slug, branch_public_id, booking_id):
        try:
            env = environ if environ is not None else os.environ
            raw = env.get(ENV_NAME) or ""
            with lock:
                if state["key"] != raw:
                    info = load_credentials(env)
                    state["sender"] = (sender_factory or FcmSender)(info, project_id=env.get(PROJECT_ENV_NAME) or info.get("project_id") or DEFAULT_PROJECT_ID) if info else None
                    state["key"] = raw
                fcm = state["sender"]
            if fcm is None:
                return
            devices = _rows(db.table(TABLE).select("token,role,platform").eq("business_id", business_id).eq("role", "owner").eq("platform", "android").limit(MAX_DEVICES).execute())
            data = {"type": "new_booking", "business": slug, "booking_id": str(booking_id), "branch_public_id": branch_public_id}
            for device in devices:
                if device.get("role") != "owner" or device.get("platform") != "android" or not device.get("token"):
                    continue
                try:
                    outcome = fcm.send(device["token"], data)
                    if outcome == "unregistered":
                        db.table(TABLE).delete().eq("token", device["token"]).eq("business_id", business_id).execute()
                except Exception:
                    _log("booking device push failed")
        except Exception:
            _log("booking push skipped")

    return push


def _clean_token(value):
    token = str(value or '').strip()
    if not token or len(token) > 4096 or any(c.isspace() for c in token):
        raise HTTPException(status_code=400, detail='Missing device token')
    return token


def register_menu_order_push_routes(app, *, db, operator, get_business, environ=None, sender_factory=None):
    """Device token routes for the LoyaltyTree app. Returns the order pusher."""

    @app.post('/api/v1/business/{public_id}/app-devices')
    async def register_app_device(public_id: str, request: Request, authorization: str = Header(default='')):
        """Remember this phone so it rings for new orders (owner, manager or cashier)."""
        payload = await request.json() if (await request.body()) else {}
        token = _clean_token((payload or {}).get('token'))
        business, scope = await asyncio.to_thread(operator, public_id, authorization, need_branch=False)
        now = datetime.now(timezone.utc).isoformat()
        platform = str((payload or {}).get('platform') or 'android').strip().lower()
        if platform in ('iphone', 'ipad'):
            platform = 'ios'
        row = {
            'token': token,
            'business_id': business.get('id'),
            'role': scope.get('role') if scope.get('role') in ROLES else 'owner',
            'staff_id': scope.get('staff_id'),
            'branch_public_id': scope.get('branch') or '',
            'platform': platform[:20],
            'app_version': str((payload or {}).get('app_version') or '')[:40],
            'updated_at': now,
        }
        if platform == 'ios':
            alerts = (payload or {}).get('alerts_on', True)
            muted = (payload or {}).get('muted_branches', [])
            if not isinstance(alerts, bool):
                raise HTTPException(status_code=400, detail='alerts_on must be boolean')
            if (not isinstance(muted, list) or len(muted) > 100
                    or any(not isinstance(b, str) or not b.strip() or len(b) > 128 for b in muted)):
                raise HTTPException(status_code=400, detail='muted_branches must be a list of branch IDs')
            row['alerts_on'] = alerts
            row['muted_branches'] = list(dict.fromkeys(muted))
        try:
            await asyncio.to_thread(lambda: db.table(TABLE).upsert(row, on_conflict='token').execute())
        except Exception as e:
            _log(f'device register failed: {e}')
            raise HTTPException(status_code=503, detail='Order alerts are not set up on the server yet.')
        return {'success': True, 'push_ready': load_credentials(environ) is not None,
                'role': row['role'], 'branch': row['branch_public_id']}

    @app.post('/api/v1/business/{public_id}/app-devices/remove')
    async def remove_app_device(public_id: str, request: Request, authorization: str = Header(default='')):
        """Stop pushes to this phone (sign out). Works even after the 12-hour session ended,
        because only the phone itself knows its token."""
        payload = await request.json() if (await request.body()) else {}
        token = _clean_token((payload or {}).get('token'))
        business = await asyncio.to_thread(get_business, public_id)
        if not business:
            raise HTTPException(status_code=404, detail='Business not found')
        try:
            await asyncio.to_thread(lambda: db.table(TABLE).delete().eq('token', token).eq('business_id', business.get('id')).execute())
        except Exception as e:
            _log(f'device remove failed: {e}')
        return {'success': True}

    return make_order_pusher(db=db, environ=environ, sender_factory=sender_factory)

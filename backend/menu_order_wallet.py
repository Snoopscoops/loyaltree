"""Digital Menu orders on the customer's loyalty card (Apple + Google Wallet).

When a menu order is linked to a connected card (member_customer_public_id):
- Each status change updates the card so the holder gets a lock-screen note:
  received, accepted / preparing, ready, completed, cancelled.
  Apple: a CURRENT ORDER field on the back of the pass whose changeMessage is the
  note (same mechanism as Order Ahead). Google: TEXT_AND_NOTIFY addMessage for
  accepted, ready and cancelled only, capped per customer per 24 hours, because
  Google allows about 3 notifications a day per pass and messages stay in Details.
- When the order is completed (and paid), the card earns exactly what the owner
  set up for that card, through the same add_points_sale / add_stamp code the
  cashier and the POS use: points per peso, one stamp per purchase, once-per-day
  and max-stamp rules, tiers, rewards, campaigns, LT layer, audit and the normal
  wallet refresh ("Points updated: 125", "Stamp progress: 7/10").
- Never double-awards: an event row per order (unique) plus the transaction_audit
  idempotency key menu-order:<order public_id>:points|stamp.

Everything here runs in background tasks after the response, so a Wallet or
loyalty problem can never block or break the order screens.
"""
import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, HTTPException

TABLE = 'menu_order_wallet_events'
PAID = ('paid', 'paid_test')
ACTIVE = ('new', 'preparing', 'ready')
LABELS = {'new': 'RECEIVED', 'preparing': 'PREPARING', 'ready': 'READY',
          'completed': 'COMPLETED', 'cancelled': 'CANCELLED'}
# Google: about 3 TEXT_AND_NOTIFY per pass per 24h. Keep one free for the
# business's own messages (birthday, welcome) and always leave room for READY.
GOOGLE_CAP = {'preparing': 1, 'ready': 2, 'cancelled': 2}
SHOW_FINISHED_HOURS = 6
SHOW_ACTIVE_HOURS = 24


def _log(message):
    print(f'[menu-order-wallet] {message}')


def _rows(result):
    data = getattr(result, 'data', None) or []
    return data if isinstance(data, list) else []


def _parse(value):
    text = str(value or '').strip().replace(' ', 'T')
    if not text:
        return None
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        try:
            stamp = datetime.fromisoformat(text[:19])
        except ValueError:
            return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def order_number(order):
    number = str((order or {}).get('order_number') or '').strip().lstrip('#')
    return f'#{number}' if number else ''


def _safe(text):
    # changeMessage is a format string: a literal % must be doubled.
    return str(text or '').replace('%', '%%')


def step_message(order, status, business_name=''):
    """Customer-facing text for a status. Short enough for a lock screen."""
    number = order_number(order)
    name = f'Order {number}' if number else 'Your order'
    shop = str(business_name or '').strip()
    dine_in = str((order or {}).get('service') or '') == 'dine-in'
    table_no = str((order or {}).get('table_no') or '').strip()
    if status == 'new':
        return f'{name} received' + (f' by {shop}.' if shop else '.')
    if status == 'preparing':
        return f'{name} accepted. ' + (f'{shop} is preparing it now.' if shop else 'We are preparing it now.')
    if status == 'ready':
        if dine_in:
            return f'{name} is ready' + (f'. We will bring it to Table {table_no}.' if table_no else '.')
        return f'{name} is ready for pickup.'
    if status == 'completed':
        return f'{name} completed. Thank you!'
    if status == 'cancelled':
        return f'{name} was cancelled. Please ask the counter.'
    return ''


def google_header(status):
    return {'preparing': 'Order accepted', 'ready': 'Order ready', 'cancelled': 'Order cancelled'}.get(status, 'Order update')


def latest_linked_order(db, business_id, customer_public_id):
    try:
        rows = _rows(db.table('menu_counter_orders')
                     .select('public_id,order_number,status,service,table_no,created_at,payment_status')
                     .eq('business_id', business_id).eq('member_customer_public_id', customer_public_id)
                     .order('created_at', desc=True).limit(1).execute())
    except Exception:
        return None
    return rows[0] if rows else None


def apple_field(db, customer, business, now=None):
    """The CURRENT ORDER back field for the member's latest Digital Menu order, or None."""
    if not customer or not business or not customer.get('public_id'):
        return None
    order = latest_linked_order(db, business.get('id'), customer.get('public_id'))
    if not order:
        return None
    status = str(order.get('status') or 'new').lower()
    if status not in LABELS:
        return None
    created = _parse(order.get('created_at'))
    now = now or datetime.now(timezone.utc)
    window = SHOW_ACTIVE_HOURS if status in ACTIVE else SHOW_FINISHED_HOURS
    if created and now - created > timedelta(hours=window):
        return None
    number = order_number(order) or 'Order'
    return {
        'key': 'menu_order_status',
        'label': 'CURRENT ORDER',
        'value': f'{number} · {LABELS[status]}',
        'changeMessage': _safe(step_message(order, status, business.get('name'))),
    }


def make_menu_order_wallet(*, db, get_customer, get_program, uses_points, uses_stamps,
                           owner_authorization, add_points, add_stamp, points_request, stamp_request,
                           apple_refresh, google_message, clock=time.time):
    """Returns an object with order_placed(business, order) and status_changed(business, order, previous)."""
    seen = set()
    seen_lock = threading.Lock()

    def claim(order, customer, kind, step):
        """True: go ahead. False: this already happened for this order."""
        key = (str(order.get('public_id')), kind, step)
        row = {'business_id': order.get('business_id'), 'order_public_id': key[0],
               'customer_public_id': customer.get('public_id'), 'kind': kind, 'step': step}
        try:
            db.table(TABLE).insert(row).execute()
            return True
        except Exception as e:
            text = str(e).lower()
            if 'duplicate' in text or '23505' in text or 'unique' in text:
                return False
            # Table not created yet: fall back to this worker's memory.
            with seen_lock:
                if key in seen:
                    return False
                seen.add(key)
            return True

    def note(order, kind, step, values):
        try:
            (db.table(TABLE).update(values).eq('order_public_id', str(order.get('public_id')))
             .eq('kind', kind).eq('step', step).execute())
        except Exception:
            pass

    def release(order, kind, step):
        key = (str(order.get('public_id')), kind, step)
        with seen_lock:
            seen.discard(key)
        try:
            (db.table(TABLE).delete().eq('order_public_id', key[0]).eq('kind', kind).eq('step', step).execute())
        except Exception:
            pass

    def google_sent_today(customer):
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        try:
            return len(_rows(db.table(TABLE).select('id').eq('customer_public_id', customer.get('public_id'))
                             .eq('google_sent', True).gte('created_at', since).execute()))
        except Exception:
            return 0

    def member(business, order):
        public_id = str((order or {}).get('member_customer_public_id') or '')
        if not public_id or not business:
            return None
        customer = get_customer(public_id)
        if not customer or customer.get('business_id') != business.get('id'):
            return None
        return customer

    async def award(business, order, customer):
        """Earn on the completed order with the owner's own card rules. Returns a summary."""
        if str(order.get('payment_status') or '') not in PAID:
            return {'skipped': 'not_paid'}
        try:
            total = round(float(order.get('total') or 0), 2)
        except (TypeError, ValueError):
            total = 0.0
        program = get_program(customer, business.get('id'))
        if not program:
            return {'skipped': 'no_program'}
        points_on, stamps_on = bool(uses_points(program)), bool(uses_stamps(program))
        if not points_on and not stamps_on:
            return {'skipped': 'card_has_no_purchase_earning'}
        if not await asyncio.to_thread(claim, order, customer, 'award', 'completed'):
            return {'skipped': 'already_awarded'}
        try:
            return await _earn(business, order, customer, total, points_on, stamps_on)
        except Exception as e:
            # Free the claim so the next "Complete" can retry. The idempotency keys
            # still stop a second award if part of it went through.
            await asyncio.to_thread(release, order, 'award', 'completed')
            _log(f'award failed, will retry on the next completion: {e}')
            return {'skipped': 'error', 'error': str(e)}

    async def _earn(business, order, customer, total, points_on, stamps_on):
        auth = await owner_authorization(business)
        tasks = BackgroundTasks()
        base = f"menu-order:{order.get('public_id')}"
        summary = {}
        if points_on and total > 0:
            try:
                result = await add_points(business.get('public_id'),
                                          points_request(customer_public_id=customer.get('public_id'), amount_spent=total, as_owner=True),
                                          tasks, authorization=auth, x_idempotency_key=f'{base}:points')
                summary['points_earned'] = int((result or {}).get('points_earned') or 0)
                summary['points_balance'] = (result or {}).get('points_balance')
            except HTTPException as e:
                summary['points_skipped'] = str(e.detail)
        # The final stamp reward already reset the card atomically when the
        # order was completed. Do not immediately earn a stamp on that same
        # redemption order; subsequent normal purchases still earn as before.
        if stamps_on and order.get('_stamp_cycle_reset') is True:
            summary['stamp_skipped'] = 'final_stamp_reward_cycle_reset'
        elif stamps_on:
            try:
                result = await add_stamp(business.get('public_id'),
                                         stamp_request(customer_public_id=customer.get('public_id'), as_owner=True, stamp_kind='reward'),
                                         tasks, authorization=auth, x_idempotency_key=f'{base}:stamp')
                summary['stamps_earned'] = 0 if (result or {}).get('duplicate_prevented') else 1
                summary['stamp_count'] = (result or {}).get('stamp_count')
            except HTTPException as e:
                # 409: once-per-day or max stamps reached, exactly like the cashier screen.
                summary['stamp_skipped'] = str(e.detail)
        # The normal wallet refresh queued by add_points_sale / add_stamp.
        await tasks()
        await asyncio.to_thread(note, order, 'award', 'completed', {'result': summary})
        return summary

    async def status_changed(business, order, previous_status=''):
        try:
            status = str((order or {}).get('status') or '').lower()
            if status not in LABELS or status == str(previous_status or '').lower():
                return {'skipped': 'no_change'}
            customer = await asyncio.to_thread(member, business, order)
            if not customer:
                return {'skipped': 'no_card'}
            order = dict(order, business_id=order.get('business_id') or business.get('id'))
            result = {'status': status}
            if status == 'completed':
                result['award'] = await award(business, order, customer)
            if not await asyncio.to_thread(claim, order, customer, 'notice', status):
                result['notice'] = 'already_sent'
                return result
            google = False
            if status in GOOGLE_CAP and await asyncio.to_thread(google_sent_today, customer) < GOOGLE_CAP[status]:
                google = bool(await asyncio.to_thread(
                    google_message, customer, google_header(status),
                    step_message(order, status, business.get('name')),
                    f"menu-order-{status}-{order.get('public_id')}"))
            # Apple reads the new CURRENT ORDER field (changeMessage) when it refetches.
            await asyncio.to_thread(apple_refresh, customer)
            await asyncio.to_thread(note, order, 'notice', status, {'google_sent': google})
            result.update(google_sent=google, apple_refreshed=True)
            return result
        except Exception as e:
            _log(f'status update skipped: {e}')
            return {'skipped': 'error', 'error': str(e)}

    async def order_placed(business, order):
        """Puts "#123 · RECEIVED" on the Apple pass, so the next steps can notify."""
        try:
            customer = await asyncio.to_thread(member, business, order)
            if not customer:
                return {'skipped': 'no_card'}
            await asyncio.to_thread(apple_refresh, customer)
            return {'apple_refreshed': True}
        except Exception as e:
            _log(f'placed refresh skipped: {e}')
            return {'skipped': 'error', 'error': str(e)}

    class Hooks:
        pass

    hooks = Hooks()
    hooks.status_changed = status_changed
    hooks.order_placed = order_placed
    hooks.award = award
    return hooks

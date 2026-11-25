"""Receipt-scoped customer add-ons; money and inventory stay in Batch A RPCs."""
import re
import time
from decimal import Decimal
from fastapi import BackgroundTasks, Body, Header, HTTPException
from fastapi.responses import JSONResponse
try:
    from .menu_card_link import sign, read_token
    from .menu_order_adjustment_routes import counter_order_rpc, _request_id, _text
    from .menu_order_adjustments import canonical_items_total, AdjustmentRejected
except ImportError:
    from menu_card_link import sign, read_token
    from menu_order_adjustment_routes import counter_order_rpc, _request_id, _text
    from menu_order_adjustments import canonical_items_total, AdjustmentRejected

OPEN = {'new', 'preparing', 'ready'}
KIND = 'menu_addon_receipt'

def eligible(row):
    return bool(row.get('batch_a_stock_tracked') and not row.get('parent_order_public_id')
        and row.get('service') == 'dine-in' and row.get('payment_method') == 'cash'
        and row.get('branch_public_id') and not row.get('checkout_reward_kind')
        and not row.get('checkout_reward_id') and row.get('status') in OPEN)

def issue_addon_receipt(business, row):
    if not eligible(row):
        return ''
    try:
        return sign(dict(kind=KIND, business=str(business['public_id']), order=row['public_id'],
                         exp=int(time.time()) + 3 * 86400))
    except HTTPException:  # Missing signing configuration must not break ordinary checkout.
        return ''

def summary(row):
    return {k: row.get(k) for k in ('public_id', 'order_number', 'status', 'payment_status', 'payment_method')} | {'total': float(row.get('total') or 0)}

def response(data):
    return JSONResponse(data, headers={'Cache-Control': 'private, no-store', 'Pragma': 'no-cache'})

def register_customer_addon_routes(app, *, db, get_business, normalize_items, price_items, push_order):
    def parent_for(public_id, order_public_id, authorization):
        if not re.fullmatch(r'[0-9a-f]{32}', order_public_id):
            raise HTTPException(404, 'Order not found')
        if not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Order receipt required.')
        claims = read_token(authorization[7:], KIND)
        if claims.get('business') != public_id or claims.get('order') != order_public_id:
            raise HTTPException(403, 'Order receipt does not match.')
        business = get_business(public_id)
        if not business or not business.get('id'):
            raise HTTPException(404, 'Order not found')
        try:
            rows = db.table('menu_counter_orders').select('*').eq('business_id', business['id']).eq('public_id', order_public_id).limit(1).execute().data or []
        except Exception as exc:
            raise HTTPException(503, 'Order temporarily unavailable.') from exc
        if not rows or rows[0].get('parent_order_public_id'):
            raise HTTPException(404, 'Order not found')
        return business, rows[0]

    @app.get('/api/v1/public/menu/{public_id}/orders/{order_public_id}/family')
    def family(public_id: str, order_public_id: str, authorization: str = Header(default='')):
        business, parent = parent_for(public_id, order_public_id, authorization)
        try:
            children = (db.table('menu_counter_orders').select('public_id,order_number,status,payment_status,payment_method,total')
                .eq('business_id', business['id']).eq('branch_public_id', parent['branch_public_id'])
                .eq('parent_order_public_id', order_public_id).order('created_at').order('id').execute().data or [])
        except Exception as exc:
            raise HTTPException(503, 'Add-on status temporarily unavailable.') from exc
        return response({'parent': summary(parent), 'children': [summary(c) for c in children],
                         'can_add': eligible(parent), 'branch_public_id': parent.get('branch_public_id')})

    @app.post('/api/v1/public/menu/{public_id}/orders/{order_public_id}/sub-orders')
    def add(public_id: str, order_public_id: str, background_tasks: BackgroundTasks,
            payload: dict = Body(...), authorization: str = Header(default='')):
        business, parent = parent_for(public_id, order_public_id, authorization)
        request_id = _request_id(payload)
        requested = normalize_items(payload.get('items'))
        order = {'request_items': requested, 'customer_note': _text(payload, 'customer_note', 500)}
        params = dict(p_business_id=business['id'], p_branch=parent.get('branch_public_id') or '',
                      p_parent_public_id=order_public_id, p_request_id=request_id, p_actor='customer:receipt')
        # RPC checks replay before status; retry remains safe even if parent closes.
        result = counter_order_rpc(db, 'menu_create_counter_suborder', allow_empty=True, p_order=order, **params)
        if result is None:
            if not eligible(parent):
                raise HTTPException(409, 'This order is no longer open for add-ons.')
            items, total = price_items(business, parent['branch_public_id'], requested)
            try:
                subtotal = canonical_items_total(items)
                if subtotal != Decimal(str(total)) or subtotal <= 0:
                    raise AdjustmentRejected('Invalid total')
            except AdjustmentRejected as exc:
                raise HTTPException(400, 'Refresh the menu and review your cart.') from exc
            result = counter_order_rpc(db, 'menu_create_counter_suborder', p_order={**order, 'items': items, 'total': float(subtotal)}, **params)
        child = result['order']
        if result.get('changed'):
            background_tasks.add_task(push_order, business, child)
        return response({'success': True, 'order': summary(child)})

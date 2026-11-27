"""Staff-only Batch A activity on independently paid counter orders."""
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import BackgroundTasks, Body, Header, HTTPException, Request

try:
    from .menu_order_access import check_order_branch
    from .menu_order_adjustments import AdjustmentRejected, canonical_items_total
except ImportError:  # running from backend/
    from menu_order_access import check_order_branch
    from menu_order_adjustments import AdjustmentRejected, canonical_items_total


def counter_order_rpc(db, function, *, allow_empty=False, **params):
    try:
        data = db.rpc(function, params).execute().data
    except Exception as exc:
        code = getattr(exc, 'code', None)
        if code == 'P0002':
            raise HTTPException(404, 'Order not found') from exc
        if code == '42501':
            raise HTTPException(403, 'This order belongs to another branch.') from exc
        if code == '22023':
            raise HTTPException(400, getattr(exc, 'message', None) or 'Invalid order adjustment.') from exc
        if code == '23514':
            raise HTTPException(409, getattr(exc, 'message', None) or 'This order cannot be changed.') from exc
        if code == '23505':
            raise HTTPException(409, 'This action conflicts with an existing order adjustment.') from exc
        raise HTTPException(503, 'Order adjustments are temporarily unavailable.') from exc
    if data is None and allow_empty:
        return None
    if not isinstance(data, dict) or not isinstance(data.get('order'), dict) or not data['order'].get('public_id'):
        raise HTTPException(503, 'The order adjustment could not be confirmed. Retry the same request.')
    return data


def counter_order_actor(scope):
    if not scope or scope.get('role') == 'owner':
        return 'owner'
    return f"{scope['role']}:{scope['staff_id']}"


def transition_counter_order(db, business, scope, order, target, reason=None, expected_amount=None):
    extra = {'p_expected_amount': expected_amount} if target == 'paid' else {}
    return counter_order_rpc(db, 'menu_transition_counter_order',
        p_business_id=business['id'], p_branch=order.get('branch_public_id'),
        p_order_public_id=order['public_id'], p_target=target,
        p_actor=counter_order_actor(scope), p_reason=reason, **extra)


def read_counter_order(db, business, scope, order_public_id):
    try:
        rows = (db.table('menu_counter_orders').select('*').eq('business_id', business['id'])
                .eq('public_id', order_public_id).limit(1).execute().data or [])
    except Exception as exc:
        raise HTTPException(503, 'Could not load the order. Try again.') from exc
    if not rows:
        raise HTTPException(404, 'Order not found')
    check_order_branch(scope, rows[0])
    return rows[0]


def _request_id(payload):
    value = payload.get('request_id')
    if isinstance(value, str):
        try:
            request_id = UUID(value)
            if request_id.int != 0:
                return str(request_id)
        except ValueError:
            pass
    raise HTTPException(400, 'A valid request_id is required.')


def _text(payload, key, limit, *, required=False):
    value = payload.get(key, '')
    if not isinstance(value, str):
        raise HTTPException(400, f'Invalid {key}.')
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise HTTPException(400, f'Invalid {key}. Maximum {limit} characters.')
    return value


def register_menu_order_adjustment_routes(app, *, db, operator, normalize_items, price_items, order_public, push_order, verify_void):
    @app.post('/api/v1/business/{public_id}/menu-orders/{order_public_id}/sub-orders')
    def create_counter_suborder(public_id: str, order_public_id: str, background_tasks: BackgroundTasks,
                                payload: dict = Body(...), authorization: str = Header(default='')):
        business, scope = operator(public_id, authorization)
        parent = read_counter_order(db, business, scope, order_public_id)
        if parent.get('parent_order_public_id'):
            raise HTTPException(409, 'Add a sub-order to the original order.')
        request_id = _request_id(payload)
        requested_items = normalize_items(payload.get('items'))
        branch = parent.get('branch_public_id') or ''
        params = {
            'p_business_id': business['id'], 'p_branch': branch,
            'p_parent_public_id': order_public_id, 'p_request_id': request_id,
            'p_actor': counter_order_actor(scope),
        }
        order = {'request_items': requested_items, 'customer_note': _text(payload, 'customer_note', 500)}
        # Replays survive later catalog edits and never notify twice.
        result = counter_order_rpc(db, 'menu_create_counter_suborder', allow_empty=True, p_order=order, **params)
        if result is None:
            items, total = price_items(business, branch, requested_items)
            try:
                subtotal = canonical_items_total(items)
                if subtotal != Decimal(str(total)) or subtotal <= 0:
                    raise AdjustmentRejected('Server pricing total does not match the order.')
            except AdjustmentRejected as exc:
                raise HTTPException(400, 'This cart cannot be added. Refresh the menu.') from exc
            result = counter_order_rpc(db, 'menu_create_counter_suborder',
                p_order={**order, 'items': items, 'total': float(subtotal)}, **params)
        child = result['order']
        if result.get('changed'):
            background_tasks.add_task(push_order, business, child)
        return {'success': True, 'order': order_public(child)}

    @app.patch('/api/v1/business/{public_id}/menu-orders/{order_public_id}/settle-bill')
    def settle_counter_bill(public_id: str, order_public_id: str,
                            payload: dict = Body(...), authorization: str = Header(default='')):
        business, scope = operator(public_id, authorization)
        if scope.get('role') not in ('owner', 'manager', 'cashier'):
            raise HTTPException(403, 'Staff payment access required.')
        root = read_counter_order(db, business, scope, order_public_id)
        if root.get('parent_order_public_id'):
            raise HTTPException(409, 'Select the main order.')
        expected = payload.get('expected')
        if not isinstance(expected, dict) or not 1 <= len(expected) <= 100:
            raise HTTPException(400, 'Confirm the outstanding order amounts.')
        amounts = {}
        for key, value in expected.items():
            try:
                if not isinstance(key, str) or not 1 <= len(key) <= 96 or not isinstance(value, str) or len(value) > 32:
                    raise ValueError()
                amount = Decimal(value)
                if not amount.is_finite() or not 0 <= amount <= Decimal('1000000000') or amount != amount.quantize(Decimal('0.01')):
                    raise ValueError()
                # JSON numbers with cent precision; database compares numeric values.
                amounts[key] = float(amount)
            except (InvalidOperation, ValueError):
                raise HTTPException(400, 'Invalid outstanding amount.')
        result = counter_order_rpc(db, 'menu_settle_counter_bill',
            p_business_id=business['id'], p_branch=root.get('branch_public_id'),
            p_root=order_public_id, p_actor=counter_order_actor(scope), p_expected=amounts)
        return {'success': True, 'settled_count': result['settled_count'],
                'settled_total': result['settled_total']}

    @app.patch('/api/v1/business/{public_id}/menu-orders/{order_public_id}/void-item')
    def void_counter_item(public_id: str, order_public_id: str, request: Request,
                          payload: dict = Body(...), authorization: str = Header(default='')):
        business, scope = operator(public_id, authorization)
        order = read_counter_order(db, business, scope, order_public_id)
        if scope.get('role') not in ('owner', 'manager'):
            raise HTTPException(403, 'Owner or manager authorization is required to void items.')
        quantity = payload.get('quantity')
        if type(quantity) is not int or not 1 <= quantity <= 20:
            raise HTTPException(400, 'Invalid void quantity.')
        request_id = _request_id(payload)
        line_id = _text(payload, 'line_id', 32, required=True)
        reason = _text(payload, 'reason', 250, required=True)
        credential = payload.get('credential')
        if not isinstance(credential, str) or not 1 <= len(credential) <= 256:
            raise HTTPException(400, 'Enter your password or manager PIN to authorize the void.')
        verify_void(request, business, scope, credential)
        result = counter_order_rpc(db, 'menu_void_counter_order_item',
            p_business_id=business['id'], p_branch=order.get('branch_public_id') or '',
            p_order_public_id=order_public_id, p_request_id=request_id,
            p_line_id=line_id, p_quantity=quantity,
            p_reason=reason, p_actor=counter_order_actor(scope))
        return {'success': True, 'order': order_public(result['order'])}

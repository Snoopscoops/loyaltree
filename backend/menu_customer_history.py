"""Read-only, merchant-isolated digital menu order history.

Only card-session identity (public) or an authenticated owner (staff endpoint)
can choose a customer. Never treat pending cash/test payments as spending.
"""
from decimal import Decimal, InvalidOperation
from fastapi import Header, HTTPException
from fastapi.responses import JSONResponse

MAX_ORDERS = 2000
PAGE_SIZE = 200


def paid_spend(row):
    if row.get('status') != 'completed' or row.get('payment_status') != 'paid':
        return Decimal('0')
    # No verified real payment exists for QR/card testing. Legacy unknown methods
    # are not independently verifiable and must not be displayed as paid spend.
    if row.get('payment_method') != 'cash':
        return Decimal('0')
    try:
        money = Decimal(str(row.get('total')))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')
    return money.quantize(Decimal('0.01')) if money.is_finite() and money > 0 else Decimal('0')


def serialize_order(row):
    spend = paid_spend(row)
    total = row.get('total')
    try:
        total = Decimal(str(total)).quantize(Decimal('0.01'))
        total = float(total) if total.is_finite() and total >= 0 else None
    except (InvalidOperation, ValueError, TypeError):
        total = None
    return {
        'order_number': row.get('order_number') or '',
        'created_at': row.get('created_at') or '',
        'status': row.get('status') or 'unknown',
        'payment_status': row.get('payment_status') or 'unknown',
        'payment_method': row.get('payment_method') or '',
        'branch_name': row.get('branch_name') or '',
        'service': row.get('service') or '',
        'total': total,
        'verified_spent': float(spend),
        'items': [{'name': item.get('item_name') or 'Item', 'quantity': item.get('quantity') or 1}
                  for item in row.get('items') or [] if isinstance(item, dict)][:40],
    }


def read_orders(db, business_id, customer_public_id):
    rows = []
    offset = 0
    while offset < MAX_ORDERS:
        result = (db.table('menu_counter_orders').select('*')
                  .eq('business_id', business_id)
                  .eq('member_customer_public_id', customer_public_id)
                  .order('created_at', desc=True)
                  .range(offset, offset + PAGE_SIZE - 1).execute())
        page = getattr(result, 'data', None) or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    complete = len(rows) < MAX_ORDERS
    # A cancelled order still belongs in the audit timeline, but not in spend.
    spend = sum((paid_spend(row) for row in rows), Decimal('0'))
    return {
        'orders': [serialize_order(row) for row in rows],
        'summary': {
            'total_orders': len(rows),
            'completed_paid_orders': sum(1 for row in rows if paid_spend(row) > 0),
            'total_spent': float(spend.quantize(Decimal('0.01'))),
            'complete': complete,
            'scope': 'Linked digital-menu orders only',
        },
    }


def register_customer_order_history_routes(app, *, db, get_business, get_customer, operator, read_card_token):
    def ensure_member(business, customer_public_id):
        if not customer_public_id:
            raise HTTPException(401, 'Connect your loyalty card.')
        customer = get_customer(customer_public_id)
        if (not customer or str(customer.get('business_id')) != str(business['id'])
                or str(customer.get('public_id')) != str(customer_public_id)):
            raise HTTPException(404, 'Customer not found in this business.')
        return customer

    def response(business, customer_id):
        try:
            body = read_orders(db, business['id'], customer_id)
        except Exception as exc:
            raise HTTPException(503, 'Order history could not load. Try again shortly.') from exc
        return JSONResponse(body, headers={'Cache-Control': 'private, no-store'})

    @app.get('/api/v1/public/menu/{public_id}/card/orders')
    def card_orders(public_id: str, authorization: str = Header(default='')):
        business = get_business(public_id)
        if not business or str(business.get('status', '')).upper() != 'ACTIVE':
            raise HTTPException(404, 'Menu not found.')
        parts = authorization.split(' ', 1)
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            raise HTTPException(401, 'Connect your loyalty card.')
        identity = read_card_token(parts[1], 'session')
        if str(identity.get('business_public_id')) != str(business['public_id']):
            raise HTTPException(401, 'Reconnect your loyalty card.')
        customer_id = str(identity.get('customer_public_id') or '')
        ensure_member(business, customer_id)
        return response(business, customer_id)

    @app.get('/api/v1/business/{public_id}/customers/{customer_public_id}/menu-order-history')
    def owner_customer_orders(public_id: str, customer_public_id: str, authorization: str = Header(default='')):
        business, scope = operator(public_id, authorization, allow=('owner',), need_branch=False)
        if scope.get('role') != 'owner':
            raise HTTPException(403, 'Only the owner can view customer spending.')
        ensure_member(business, customer_public_id)
        return response(business, customer_public_id)

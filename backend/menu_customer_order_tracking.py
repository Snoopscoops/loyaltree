"""Minimal customer-safe status polling for Digital Menu orders.

A 128-bit random order public_id is the receipt's lookup capability. Never
accept an order number as proof of ownership or expose order/customer fields.
"""
import re
from fastapi import HTTPException
from fastapi.responses import JSONResponse

VALID = {'new', 'preparing', 'ready', 'completed', 'cancelled'}


def register_menu_customer_order_tracking_routes(app, *, db, get_business):
    @app.get('/api/v1/public/menu/{public_id}/orders/{order_public_id}/status')
    def customer_menu_order_status(public_id: str, order_public_id: str):
        if not re.fullmatch(r'[0-9a-fA-F]{32}', order_public_id):
            raise HTTPException(status_code=404, detail='Order not found')
        business = get_business(public_id)
        if not business or not business.get('id'):
            raise HTTPException(status_code=404, detail='Order not found')
        try:
            rows = (db.table('menu_counter_orders')
                    .select('status,payment_status')
                    .eq('business_id', business['id'])
                    .eq('public_id', order_public_id)
                    .limit(1).execute().data or [])
        except Exception:
            raise HTTPException(status_code=503, detail='Order status temporarily unavailable')
        if not rows:
            raise HTTPException(status_code=404, detail='Order not found')
        order = rows[0]
        status = str(order.get('status') or '').lower()
        if status not in VALID:
            raise HTTPException(status_code=503, detail='Order status temporarily unavailable')
        payment = str(order.get('payment_status') or '').lower()
        if payment not in ('paid', 'unpaid', 'paid_test'):
            payment = ''
        return JSONResponse(
            {'status': status, 'payment_status': payment},
            headers={'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache'},
        )

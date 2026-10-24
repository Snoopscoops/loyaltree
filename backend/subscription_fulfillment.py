"""Durable subscription payment boundary; never infer access from metadata.

All entitlement changes happen in one service-role PostgreSQL transaction.
Provider calls and optional email delivery stay outside that transaction.
"""
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException


def processor_centavos(value):
    try:
        amount = Decimal(str(value)) * 100
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid processor amount") from None
    if not amount.is_finite() or amount != amount.to_integral_value() or not 0 < amount <= 100_000_000_000:
        raise ValueError("Invalid processor amount")
    return int(amount)


def checkout_context(secret_key, *, setup_kit_included=False, setup_kit_amount=0):
    if not isinstance(secret_key, str) or not secret_key.startswith(('sk_live_', 'sk_test_')):
        raise HTTPException(503, 'Subscription payment processing is not configured.')
    return dict(version=1, provider='paymongo', livemode=secret_key.startswith('sk_live_'),
                setup_kit_included=bool(setup_kit_included),
                setup_kit_amount_centavos=processor_centavos(setup_kit_amount) if setup_kit_included else 0)


def ensure_checkout_ready(db):
    """Fail before creating a provider intent when the migration is missing."""
    try:
        db.table('subscription_payments').select('fulfillment_context,fulfilled_at,fulfillment_status').limit(0).execute()
    except Exception as exc:
        raise HTTPException(503, 'Subscription payment setup is unavailable. Apply subscription_fulfillment.sql before enabling checkout.') from exc


def record_checkout_attempt(db, payment, context):
    row = dict(payment, fulfillment_context=context, fulfillment_status='pending')
    processor_centavos(row.get('processor_amount'))
    if row.get('payment_provider') != 'paymongo' or not row.get('paymongo_payment_intent_id'):
        raise ValueError('Payment attempt requires a provider intent')
    try:
        result = db.table('subscription_payments').insert(row).execute()
        rows = getattr(result, 'data', None)
        if not isinstance(rows, list) or len(rows) != 1 or rows[0].get('paymongo_payment_intent_id') != row['paymongo_payment_intent_id']:
            raise RuntimeError('Payment attempt was not acknowledged')
    except Exception as exc:
        # Never hand the customer an unrecorded QR/client key. A provider
        # intent is not a successful payment and must not grant access.
        raise HTTPException(503, 'Could not save this payment attempt. No checkout was opened; please retry.') from exc
    return rows[0]


def process_subscription_event(db, *, event_type, intent_id, payment_id, amount_centavos,
                               currency, livemode, business_slug=None, payment_context=None):
    if event_type not in ('payment.paid', 'payment.failed', 'qrph.expired'):
        return dict(outcome='ignored')
    if not intent_id or not isinstance(livemode, bool):
        raise HTTPException(400, 'Invalid subscription payment event')
    # JSON boolean is an integer in Python; do not let it count as money.
    if event_type == 'payment.paid' and (isinstance(amount_centavos, bool) or not isinstance(amount_centavos, int) or amount_centavos <= 0):
        raise HTTPException(400, 'Invalid subscription payment amount')
    try:
        result = db.rpc('subscription_fulfill', dict(p_event_type=event_type, p_intent_id=str(intent_id),
            p_payment_id=str(payment_id or ''), p_amount_centavos=amount_centavos if event_type == 'payment.paid' else None,
            p_currency=str(currency or '').upper(), p_livemode=livemode,
            p_business_slug=str(business_slug or ''), p_payment_context=str(payment_context or ''))).execute()
        data = getattr(result, 'data', None)
        if not isinstance(data, dict) or data.get('outcome') not in ('fulfilled', 'replay', 'legacy_review', 'ignored', 'rejected', 'missing_attempt', 'updated'):
            raise RuntimeError('Invalid fulfillment response')
    except Exception as exc:
        raise HTTPException(503, 'Subscription payment fulfillment is temporarily unavailable; the provider should retry.') from exc
    if data['outcome'] == 'missing_attempt':
        if business_slug or payment_context == 'subscription':
            raise HTTPException(503, 'Subscription payment attempt is not available yet; the provider should retry.')
        return dict(outcome='ignored')  # unrelated event on a shared merchant account
    return data

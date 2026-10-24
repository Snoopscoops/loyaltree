"""Explicit response boundaries for public business pages and billing.

The service-role database client bypasses RLS. Public responses must therefore
be projected here, never serialized from an entire database record.
"""
from datetime import datetime, timedelta, timezone
import secrets


PUBLIC_BUSINESS_FIELDS = frozenset({
    'public_id', 'name', 'logo_url', 'hero_url', 'business_type', 'status',
    'brand_color', 'primary_color', 'secondary_color', 'background_color',
    'card_color', 'text_color', 'country_code', 'currency', 'display_currency',
})
PAYMENT_FIELDS = frozenset({
    'id', 'public_id', 'paymongo_payment_intent_id', 'plan', 'amount', 'status',
    'billing_cycle', 'payment_method', 'created_at', 'paid_at', 'display_amount',
    'display_currency', 'processor_amount', 'processor_currency',
    'fulfillment_status', 'fulfilled_at',
})


def public_business(business):
    return {key: value for key, value in business.items() if key in PUBLIC_BUSINESS_FIELDS}


def owner_business(business):
    """Owner settings may contain contacts, but never credential material."""
    def project(value):
        if isinstance(value, dict):
            return {key: project(item) for key, item in value.items()
                    if not any(marker in str(key).lower() for marker in
                               ('password', 'secret', 'token', 'credential', 'api_key', 'private_key'))
                    and key != 'auth_version'}
        if isinstance(value, list):
            return [project(item) for item in value]
        return value
    return project(business)


def public_payment(payment):
    return {key: value for key, value in payment.items() if key in PAYMENT_FIELDS}


def issue_billing_token(business, secret, *, resume_payment_intent_id=None, ttl_seconds=3600):
    """A signup capability can pay, but cannot become an owner session."""
    import jwt
    now = datetime.now(timezone.utc)
    payload = {
        'business_public_id': business['public_id'],
        'business_id': business['id'],
        'role': 'billing',
        'purpose': 'subscription_billing',
        'auth_version': business.get('auth_version', 0),
        'jti': secrets.token_urlsafe(24),
        'iat': now,
        'exp': now + timedelta(seconds=ttl_seconds),
    }
    if resume_payment_intent_id:
        payload['resume_payment_intent_id'] = resume_payment_intent_id
    return jwt.encode(payload, secret, algorithm='HS256')


def can_read_payment(claims, payment):
    """Even a valid capability must match this tenant and this checkout."""
    if str(claims.get('business_id')) != str(payment.get('business_id')):
        return False
    if claims.get('role') == 'owner':
        return True
    return bool(claims.get('role') == 'billing' and claims.get('jti') and (
        payment.get('billing_session_id') == claims['jti'] or
        (claims.get('resume_payment_intent_id') and
         payment.get('paymongo_payment_intent_id') == claims['resume_payment_intent_id'])
    ))

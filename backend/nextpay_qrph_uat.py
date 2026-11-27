"""Unwired QRPH UAT contract. Not a production route or a payment writer.

Inputs must come from server-side merchant mapping, KYB review and canonical
order pricing, never a browser or owner-supplied payment status. The same API
host serves test and live credentials; this module performs no network calls.
"""
from dataclasses import dataclass
from uuid import UUID
import hashlib
import re


class QRPHRejected(ValueError):
    pass


def _uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except (ValueError, TypeError):
        return False


@dataclass(frozen=True)
class Merchant:
    business_id: str
    merchant_id: str
    account_id: str
    environment: str
    kyb_approved: bool
    qrph_enabled: bool
    suspended: bool


def eligible(merchant, business_id, *, uat_enabled, pilot_business_ids):
    """Fail closed; no production activation from this UAT module."""
    return (isinstance(merchant, Merchant) and uat_enabled is True
            and isinstance(pilot_business_ids, (set, frozenset))
            and bool(business_id) and business_id in pilot_business_ids
            and merchant.business_id == business_id
            and merchant.environment == 'test'
            and _uuid(merchant.merchant_id) and _uuid(merchant.account_id)
            and merchant.kyb_approved is True and merchant.qrph_enabled is True
            and merchant.suspended is False)


@dataclass(frozen=True)
class Attempt:
    business_id: str
    order_id: str
    account_id: str
    amount_centavos: int
    external_id: str
    intent_id: str = ''


def prepare_attempt(merchant, business_id, order_id, amount_centavos, *,
                    uat_enabled=False, pilot_business_ids=frozenset()):
    if not eligible(merchant, business_id, uat_enabled=uat_enabled,
                    pilot_business_ids=pilot_business_ids):
        raise QRPHRejected('QRPH unavailable for this business')
    if (not isinstance(order_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}', order_id)
            or type(amount_centavos) is not int or not 0 < amount_centavos <= 9_000_000_000_000):
        raise QRPHRejected('Invalid canonical order')
    # Deterministic reference per order. Persist before any provider request;
    # recover by external ID after uncertain creation, never rotate blindly.
    ref = 'lt-uat-' + hashlib.sha256((business_id + '\0' + order_id).encode()).hexdigest()[:40]
    return Attempt(business_id, order_id, merchant.account_id, amount_centavos, ref)


def intent_request(attempt):
    return {'X-Idempotency-Key': attempt.external_id}, {
        'account_id': attempt.account_id, 'amount': attempt.amount_centavos,
        'currency': 'PHP/2', 'external_id': attempt.external_id,
        'payment_instrument_options': {'method_type': 'qrph_p2m_reference',
                                       'method_provider': 'automatic'}}


def verify_intent(attempt, provider_record, *, require_succeeded=False):
    """Only use the authenticated provider GET response, not webhook payload.

    Before persisting a binding, require the exact account/amount/reference.
    A webhook is only a wake-up signal after provider-specific signature checks.
    A successful return is evidence, NOT permission to directly mark an order
    paid: the caller still needs atomic stock/reward/order settlement and dedupe.
    """
    r = provider_record
    if (not isinstance(r, dict) or not _uuid(r.get('id'))
            or (attempt.intent_id and r['id'] != attempt.intent_id)
            or r.get('account_id') != attempt.account_id
            or r.get('external_id') != attempt.external_id
            or type(r.get('amount')) is not int or r['amount'] != attempt.amount_centavos
            or r.get('currency') != 'PHP/2'
            or r.get('status') not in ('pending', 'succeeded', 'canceled', 'expired')):
        raise QRPHRejected('Provider intent does not match stored attempt')
    if require_succeeded and (not attempt.intent_id or r['status'] != 'succeeded'):
        raise QRPHRejected('Payment not confirmed for bound intent')
    return r['id'], r['status']

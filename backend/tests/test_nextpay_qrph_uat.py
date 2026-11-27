from dataclasses import replace
from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nextpay_qrph_uat import Merchant, QRPHRejected, eligible, prepare_attempt, intent_request, verify_intent

M = Merchant('pilot', '123e4567-e89b-12d3-a456-426614174000',
             '123e4567-e89b-12d3-a456-426614174001', 'test', True, True, False)
P = {'uat_enabled': True, 'pilot_business_ids': {'pilot'}}
I = '123e4567-e89b-12d3-a456-426614174002'

@pytest.mark.parametrize('m', [None, replace(M, environment='live'), replace(M, kyb_approved=False),
    replace(M, qrph_enabled=False), replace(M, suspended=True), replace(M, account_id='bad'),
    replace(M, business_id='other'), replace(M, kyb_approved=1)])
def test_ineligible(m):
    assert not eligible(m, 'pilot', **P)
    with pytest.raises(QRPHRejected): prepare_attempt(m, 'pilot', 'order', 35000, **P)

def test_only_explicit_pilot_test():
    assert eligible(M, 'pilot', **P)
    assert not eligible(M, 'pilot', uat_enabled=False, pilot_business_ids={'pilot'})
    assert not eligible(M, 'pilot', uat_enabled=True, pilot_business_ids=set())
    assert not eligible(M, 'other', **P)

@pytest.mark.parametrize('amount', [0, -1, True, 1.5, '35000'])
def test_invalid_amount(amount):
    with pytest.raises(QRPHRejected): prepare_attempt(M, 'pilot', 'order', amount, **P)

def record(a):
    return {'id': I, 'account_id': a.account_id, 'external_id': a.external_id,
            'amount': a.amount_centavos, 'currency': 'PHP/2', 'status': 'succeeded'}

def test_exact_amount_and_stable_retries():
    a = prepare_attempt(M, 'pilot', 'order', 35000, **P)
    assert a == prepare_attempt(M, 'pilot', 'order', 35000, **P)
    h, p = intent_request(a)
    assert h['X-Idempotency-Key'] == a.external_id and p['amount'] == 35000
    assert p['account_id'] == M.account_id and p['currency'] == 'PHP/2'
    assert p['payment_instrument_options']['method_type'] == 'qrph_p2m_reference'
    assert verify_intent(a, record(a)) == (I, 'succeeded')
    with pytest.raises(QRPHRejected): verify_intent(a, record(a), require_succeeded=True)
    assert verify_intent(replace(a, intent_id=I), record(a), require_succeeded=True) == (I, 'succeeded')

@pytest.mark.parametrize('field,value', [('id', '123e4567-e89b-12d3-a456-426614174003'),
    ('account_id','other'), ('external_id','other'), ('amount',35001), ('amount',35000.0),
    ('currency','USD/2'), ('status','pending'), ('status','expired'), ('status','canceled')])
def test_wrong_or_unpaid_intent(field, value):
    a = replace(prepare_attempt(M, 'pilot', 'order', 35000, **P), intent_id=I)
    r = record(a); r[field] = value
    with pytest.raises(QRPHRejected): verify_intent(a, r, require_succeeded=True)

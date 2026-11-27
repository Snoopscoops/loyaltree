import sys
from pathlib import Path
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from merchant_payments import register_merchant_payment_routes, normalize_status


def auth(public_id, authorization):
    if not authorization:
        raise HTTPException(401)
    role, business = authorization.removeprefix('Bearer ').split(':')
    if role != 'owner' or business != public_id:
        raise HTTPException(403)
    return {'role': role, 'business_public_id': business}


def client(**kwargs):
    app = FastAPI()
    register_merchant_payment_routes(app, require_owner=auth, **kwargs)
    return TestClient(app)

PATH = '/api/v1/business/biz/merchant-payments/status'
OWNER = {'Authorization': 'Bearer owner:biz'}


def test_locked_default_even_if_keys_present(monkeypatch):
    monkeypatch.setenv('NEXTPAY_API_KEY', 'test-not-real')
    r = client().get(PATH, headers=OWNER)
    assert r.status_code == 200 and r.headers['cache-control'] == 'no-store'
    assert r.json() == {'version': 1, 'state': 'disabled', 'portal_available': False,
                       'available_centavos': None, 'pending_centavos': None, 'payout_ready': False}


@pytest.mark.parametrize('token,expected', [('',401),('manager:biz',403),('cashier:biz',403),('owner:other',403)])
def test_denied_before_provider_lookup(token, expected):
    def forbidden(_):
        pytest.fail('unauthorized provider lookup')
    assert client(read_status=forbidden).get(PATH, headers={'Authorization':'Bearer '+token} if token else {}).status_code == expected


@pytest.mark.parametrize('state', ['disabled','registration_required','verification_pending','restricted'])
def test_unverified_never_exposes_balance_or_payout(state):
    result = normalize_status({'state':state,'portal_available':True,'available_centavos':500,'payout_ready':True,'secret':'never'})
    assert result['available_centavos'] is None and not result['payout_ready'] and 'secret' not in result
    if state == 'disabled': assert not result['portal_available']


@pytest.mark.parametrize('value', [None,True,-1,1.5,'100',10**16])
def test_invalid_balance_never_enables_payout(value):
    r = normalize_status({'state':'active','portal_available':True,'available_centavos':value,'payout_ready':True})
    assert r['available_centavos'] is None and not r['payout_ready']


def test_active_exact_balance_and_verified_destination():
    r = normalize_status({'state':'active','portal_available':True,'available_centavos':12345,'pending_centavos':0,'payout_ready':True})
    assert r['available_centavos']==12345 and r['pending_centavos']==0 and r['payout_ready']


def test_no_mutation_routes_or_provider_secrets():
    c = client()
    assert c.post(PATH, headers=OWNER, json={}).status_code == 405
    assert c.post(PATH.replace('/status','/withdraw'), headers=OWNER, json={}).status_code == 404


def test_failed_provider_is_unavailable_not_zero():
    def failed(_): raise ValueError('provider details')
    r = client(read_status=failed).get(PATH, headers=OWNER)
    assert r.status_code == 503 and 'provider details' not in r.text

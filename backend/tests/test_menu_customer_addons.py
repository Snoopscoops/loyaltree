from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.menu_customer_addons import issue_addon_receipt, register_customer_addon_routes
from backend.tests.test_menu_order_adjustment_routes import AdjustmentDB, ROOT, CHILD, BUSINESS

@pytest.fixture
def routes(monkeypatch):
    monkeypatch.setenv('LT_BENEFITS_AUTH_SECRET', 'receipt-secret-for-test-only-123456789')
    db = AdjustmentDB()
    db.root.update(order_number='001')
    db.child.update(order_number='001A')
    prices, pushes = [], []
    def price(business, branch, items):
        prices.append((branch, items)); return db.child['items'], 50
    app = FastAPI()
    register_customer_addon_routes(app, db=db, get_business=lambda slug: BUSINESS if slug == 'shop' else None,
        normalize_items=lambda items: [dict(item_id=i['item_id'], quantity=i['quantity'], options=[]) for i in items],
        price_items=price, push_order=lambda *args: pushes.append(args))
    token = issue_addon_receipt(BUSINESS, db.root)
    return TestClient(app), db, prices, pushes, {'Authorization': 'Bearer ' + token}

def path(id=ROOT, action='sub-orders', business='shop'):
    return f'/api/v1/public/menu/{business}/orders/{id}/{action}'

def payload():
    return {'request_id': str(uuid4()), 'items': [{'item_id': 'latte', 'quantity': 2, 'unit_price': 0}], 'payment_status': 'paid', 'branch_public_id': 'other'}

def test_create_reprices_and_keeps_independent_unpaid_child(routes):
    client, db, prices, pushes, auth = routes
    data = payload()
    r = client.post(path(), json=data, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()['order'] == dict(public_id=CHILD, order_number='001A', status='new', payment_status='unpaid', payment_method='cash', total=50)
    assert db.calls[-1][1]['p_branch'] == 'main'
    assert db.calls[-1][1]['p_actor'] == 'customer:receipt'
    assert db.calls[-1][1]['p_order']['total'] == 50
    assert len(prices) == len(pushes) == 1
    db.replay = True
    db.root['status'] = 'completed'
    assert client.post(path(), json=data, headers=auth).status_code == 200
    assert len(prices) == len(pushes) == 1

@pytest.mark.parametrize('target,slug,authorized,expected', [(ROOT,'shop',False,401),(CHILD,'shop',True,403),(ROOT,'other',True,403)])
def test_wrong_receipt_rejected_before_db_rpc(routes,target,slug,authorized,expected):
    client, db, _, _, auth = routes
    r = client.post(path(target,business=slug), json=payload(), headers=auth if authorized else {})
    assert r.status_code == expected
    assert not db.calls

def test_family_safe_projection_and_closed_order(routes):
    client, db, _, _, auth = routes
    db.root['buyer_name'] = 'private name'
    r = client.get(path(action='family'), headers=auth)
    assert r.status_code == 200
    assert r.json()['can_add'] and r.json()['children'][0]['order_number'] == '001A'
    assert 'private name' not in r.text and 'items' not in r.json()['parent']
    assert 'no-store' in r.headers['cache-control']
    db.root['status'] = 'completed'
    assert client.get(path(action='family'), headers=auth).json()['can_add'] is False
    assert client.post(path(), json=payload(), headers=auth).status_code == 409

def test_reward_and_legacy_receipts_not_issued(routes):
    _, db, _, _, _ = routes
    assert not issue_addon_receipt(BUSINESS, dict(db.root, checkout_reward_kind='stamp'))
    assert not issue_addon_receipt(BUSINESS, dict(db.root, batch_a_stock_tracked=False))
    assert not issue_addon_receipt(BUSINESS, db.child)

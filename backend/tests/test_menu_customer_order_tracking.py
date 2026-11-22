"""Public receipt lookup must reveal only minimal status, scoped by merchant/id."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.menu_customer_order_tracking import register_menu_customer_order_tracking_routes

OID = 'a' * 32

class Result:
    def __init__(self, data):
        self.data = data

class FakeTable:
    def __init__(self, rows, fail=False):
        self.rows, self.filters, self.fail = rows, {}, fail
        self.selected = ''
    def select(self, fields):
        self.selected = fields
        return self
    def eq(self, key, value):
        self.filters[key] = value
        return self
    def limit(self, n):
        return self
    def execute(self):
        if self.fail:
            raise RuntimeError('sensitive backend error')
        return Result([{k:r.get(k) for k in self.selected.split(',')} for r in self.rows if all(r.get(k)==v for k,v in self.filters.items())])

class FakeDb:
    def __init__(self, rows, fail=False):
        self.rows, self.fail = rows, fail
        self.last = None
    def table(self, name):
        assert name == 'menu_counter_orders'
        self.last = FakeTable(self.rows, self.fail)
        return self.last

def make_client(rows=None, fail=False):
    app = FastAPI()
    db = FakeDb(rows if rows is not None else [dict(business_id=11, public_id=OID, status='preparing', payment_status='paid', buyer_name='PRIVATE', items=[1])], fail)
    register_menu_customer_order_tracking_routes(app, db=db, get_business=lambda id: {'id':11} if id=='biz' else None)
    return TestClient(app), db

def test_customer_receipt_status_minimal_private_and_not_cached():
    c, db = make_client()
    response = c.get(f'/api/v1/public/menu/biz/orders/{OID}/status')
    assert response.status_code == 200
    assert response.json() == {'status': 'preparing', 'payment_status': 'paid'}
    assert 'no-store' in response.headers['cache-control']
    assert db.last.selected == 'status,payment_status'
    assert 'PRIVATE' not in response.text

def test_wrong_merchant_and_guessable_identifier_do_not_disclose_orders():
    c, _ = make_client()
    assert c.get(f'/api/v1/public/menu/other/orders/{OID}/status').status_code == 404
    assert c.get('/api/v1/public/menu/biz/orders/LT-MWR291DK/status').status_code == 404
    assert c.get('/api/v1/public/menu/biz/orders/'+'b'*32+'/status').status_code == 404

def test_backend_failure_is_a_private_503_and_no_raw_error():
    c, _ = make_client(fail=True)
    response = c.get(f'/api/v1/public/menu/biz/orders/{OID}/status')
    assert response.status_code == 503
    assert 'sensitive backend error' not in response.text

def test_all_supported_stages_are_returned():
    for status in ('new','preparing','ready','completed','cancelled'):
        c, _ = make_client(rows=[dict(business_id=11, public_id=OID, status=status, payment_status='unpaid')])
        assert c.get(f'/api/v1/public/menu/biz/orders/{OID}/status').json() == {'status':status, 'payment_status':'unpaid'}

import os
import time
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault('STAFF_SESSION_SECRET', 'test-secret-for-menu-card-link-0123456789')

from backend.menu_card_link import register_menu_card_routes, sign  # noqa: E402


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_):
        return self

    def eq(self, field, value):
        self.rows = [r for r in self.rows if r.get(field) == value]
        return self

    def limit(self, *_):
        return self

    def execute(self):
        return Result(self.rows)


class DB:
    def table(self, name):
        return Query([{'business_id': 1, 'public_id': 'cust-9', 'name': 'Ana Cruz'}] if name == 'customers' else [])


class CurrentCardTests(unittest.TestCase):
    def test_connected_card_returns_the_customer_id_for_welcome_back(self):
        app = FastAPI()
        register_menu_card_routes(app, db=DB(), get_business=lambda pid: {'id': 1, 'public_id': pid, 'status': 'ACTIVE'},
                                  has_feature=lambda *_: True, on_hold=lambda *_: False, send_email=lambda *_: True,
                                  frontend_url='https://example.test')
        client = TestClient(app)
        token = sign(dict(kind='session', business_public_id='cafe-1', customer_public_id='cust-9', email='ana@example.com',
                          name='Ana', exp=int(time.time() + 600)))
        body = client.get('/api/v1/public/menu/cafe-1/card', headers={'Authorization': f'Bearer {token}'}).json()
        self.assertEqual((body['name'], body['customer_public_id']), ('Ana Cruz', 'cust-9'))
        self.assertEqual(client.get('/api/v1/public/menu/other/card', headers={'Authorization': f'Bearer {token}'}).status_code, 401)
        self.assertEqual(client.get('/api/v1/public/menu/cafe-1/card').status_code, 401)

"""Menu payment setup keeps the 3% fixed and never returns a payout number."""
import unittest
from types import SimpleNamespace
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from backend.menu_payments import normalize_setup, register_menu_payment_routes


def complete(**overrides):
    payload = dict(
        trade_name='NFC Test', address_line='1 Rizal Street', city='Makati', industry='Cafe',
        description='Coffee and pastries', business_age='1_to_2_years', business_size='2_to_10',
        monthly_volume='under_100k', business_tin='123-456-789-000', owner_name='Ana Cruz',
        birthday='1990-04-02', nationality='Filipino', birth_place='Quezon City', mobile='09171234567',
        email='ana@example.com', work='Owner', source_of_funds='business_sales', owner_tin='123456789000',
        owner_address='2 Mabini Street', payout_kind='gcash', payout_account_name='Ana Cruz',
        payout_account_number='09181234567')
    payload.update(overrides)
    return payload


class Database:
    def __init__(self):
        self.rows = []
    def table(self, name):
        return Query(self)


class Query:
    def __init__(self, db):
        self.db = db
        self.write = None
    def select(self, *args, **kwargs):
        return self
    def eq(self, *args, **kwargs):
        return self
    def limit(self, *args, **kwargs):
        return self
    def upsert(self, row, **kwargs):
        self.write = row
        return self
    def execute(self):
        if self.write is not None:
            self.db.rows = [self.write]
        return SimpleNamespace(data=self.db.rows)


class MenuPaymentTests(unittest.TestCase):
    def test_fee_is_three_percent_and_not_editable(self):
        record = normalize_setup(complete(platform_fee_percent=50))
        self.assertEqual(record['platform_fee_percent'], 3)
        self.assertFalse(record['platform_fee_editable'])
        self.assertNotIn('payout_account_number', record)
        self.assertEqual(record['payout_last4'], '4567')
        self.assertTrue(record['ready'])

    def test_gcash_number_must_be_a_mobile_number(self):
        record = normalize_setup(complete(payout_account_number='1234567890123456'))
        self.assertIn('GCash number', record['missing'])
        self.assertFalse(record['ready'])

    def test_bank_needs_a_bank_name(self):
        record = normalize_setup(complete(payout_kind='bank', payout_institution='', payout_account_number='1234567890'))
        self.assertIn('Bank name', record['missing'])

    def test_route_saves_last4_only(self):
        db = Database()
        app = FastAPI()
        def owner(public_id, authorization):
            if authorization != 'Bearer owner':
                raise HTTPException(401, 'Owner session required')
        register_menu_payment_routes(app, db=db, get_business=lambda value: {'id': 7, 'status': 'ACTIVE'} if value == 'cafe' else None,
            require_owner=owner, has_feature=lambda business, feature: True, on_hold=lambda business: False)
        client = TestClient(app)
        response = client.put('/api/v1/business/cafe/qr-menu/payments', headers={'Authorization': 'Bearer owner'}, json=complete())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['payout_last4'], '4567')
        self.assertNotIn('09181234567', response.text)
        self.assertEqual(db.rows[0]['payout_last4'], '4567')
        self.assertNotIn('payout_account_number', db.rows[0])
        self.assertEqual(client.get('/api/v1/business/cafe/qr-menu/payments').status_code, 401)

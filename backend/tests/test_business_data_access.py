"""Exercise production access boundaries without startup or customer services."""
import ast
import asyncio
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import inspect
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock

import jwt
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from backend import business_data_access, password_security


SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
DEFINITIONS = {node.name: node for node in ast.parse(SOURCE.read_text()).body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
SECRET = 'test-only-scoped-access-secret-that-is-not-a-live-key'


class QueryRows:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.maximum = [], None

    def select(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, maximum): self.maximum = maximum; return self
    def eq(self, key, value): self.filters.append((key, value)); return self
    def ilike(self, key, value): self.filters.append((key, value.lower())); return self

    def execute(self):
        self.db.reads.append(self.table)
        rows = [dict(row) for row in self.db.rows.get(self.table, [])
                if all(str(row.get(key)).lower() == str(value).lower() for key, value in self.filters)]
        return SimpleNamespace(data=rows[:self.maximum] if self.maximum is not None else rows, count=len(rows))


class Database:
    def __init__(self, business):
        self.rows = {
            'businesses': [business],
            'staff': [{'id': 9, 'business_id': 7, 'role': 'cashier', 'is_active': True}],
            'subscription_payments': [{
                'id': 1, 'business_id': 7, 'paymongo_payment_intent_id': 'pi_owned',
                'billing_session_id': 'signup-session', 'status': 'pending',
                'fulfillment_status': 'pending', 'amount': 350,
                'fulfillment_context': {'private': 'server-only'},
            }],
        }
        self.reads = []

    def table(self, table): return QueryRows(self, table)


def load(name, env):
    node = copy.deepcopy(DEFINITIONS[name])
    if hasattr(node, 'decorator_list'): node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), env)
    return env[name]


class BusinessDataAccessTests(unittest.TestCase):
    def setUp(self):
        self.business = {
            'id': 7, 'public_id': 'one', 'name': 'Example Business', 'logo_url': 'https://example.test/logo.png',
            'email': 'owner@example.test', 'phone': 'private-owner-phone', 'auth_version': 0,
            'password_hash': hashlib.sha256(b'correct-password').hexdigest(),
            'password_reset_token_hash': 'private-reset-hash', 'status': 'ACTIVE',
            'subscription_expires_at': '2099-01-01',
        }
        self.db = Database(self.business)
        self.read_customers = Mock(return_value=[])
        self.env = dict(
            __name__=__name__, asyncio=asyncio, datetime=datetime, Optional=Optional,
            HTTPException=HTTPException, Header=Header, Query=Query, Request=Request,
            BaseModel=BaseModel, Field=Field, STAFF_SESSION_SECRET=SECRET,
            owner_password_security=password_security, business_data_access=business_data_access,
            supabase=self.db, safe_get_business=lambda slug: self.business if slug == 'one' else None,
            business_for_access_check=lambda slug: self.business if slug == 'one' else None,
            billing_hold=lambda business: False, read_customer_rows=self.read_customers,
            safe_get_loyalty_program=lambda *_args, **_kwargs: None,
            _parse_ts=lambda value: datetime.fromisoformat(value) if value else None,
            subscription_access_expiry=lambda business: business.get('subscription_expires_at'),
            billing_branch_count=lambda business, count: count,
            business_pricing_region=lambda business: 'PH', subscription_currency=lambda business: 'PHP',
            normalize_billing_cycle=lambda cycle: cycle or 'monthly',
            get_price_for_business=lambda *_args: 350, billing_monthly_discounts=lambda _region: {},
            business_custom_monthly_price=lambda _business: None, paymongo_card_configured=lambda: False,
            PAYMONGO_SECRET_KEY='test-processor-key', business_has_plan_feature=lambda *_args: False,
            hash_password=lambda value: hashlib.sha256(value.encode()).hexdigest(),
            _check_auth_bruteforce=Mock(), _record_auth_failure=Mock(), _clear_auth_failures=Mock(),
        )
        for name in ('verify_staff_session_token', 'validate_owner_auth_version', 'require_owner_session',
                     'get_staff_session_claims', 'create_billing_session_token', 'require_billing_access',
                     '_business_access_status', '_login_lookup_one', 'BillingSessionRequest'):
            load(name, self.env)
        self.app = FastAPI()
        routes = {
            'get_business_api': ('GET', '/api/v1/business/{public_id}'),
            'get_customers': ('GET', '/api/v1/business/{public_id}/customers'),
            'get_business_access_status': ('GET', '/api/v1/business/{public_id}/subscription/access'),
            'get_subscription_status': ('GET', '/api/v1/business/{public_id}/subscription'),
            'list_subscription_payments': ('GET', '/api/v1/business/{public_id}/subscription/payments'),
            'get_subscription_payment': ('GET', '/api/v1/business/{public_id}/subscription/payments/{payment_intent_id}'),
            'recover_billing_session': ('POST', '/api/v1/auth/billing-session'),
        }
        for name, (method, path) in routes.items():
            self.app.add_api_route(path, load(name, self.env), methods=[method])
        self.app.middleware('http')(load('private_response_cache_policy', self.env))
        self.client = TestClient(self.app)

    def token(self, role='owner', **overrides):
        return jwt.encode({
            'business_id': 7, 'business_public_id': 'one', 'role': role,
            'auth_version': 0, 'staff_id': 9, 'exp': datetime.now(timezone.utc) + timedelta(minutes=5),
            **overrides,
        }, SECRET, algorithm='HS256')

    def headers(self, role='owner', **overrides):
        return {'Authorization': f'Bearer {self.token(role, **overrides)}'}

    def test_public_business_is_allowlisted_and_owner_response_excludes_credentials(self):
        public = self.client.get('/api/v1/business/one')
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.json()['name'], 'Example Business')
        self.assertNotIn('email', public.json())
        self.assertNotIn('phone', public.json())
        owner = self.client.get('/api/v1/business/one', headers=self.headers())
        self.assertEqual(owner.json()['email'], 'owner@example.test')
        self.assertEqual(owner.headers['cache-control'], 'private, no-store')
        self.assertIn('Authorization', owner.headers['vary'])
        self.assertIn('Authorization', public.headers['vary'])
        for key in ('password_hash', 'password_reset_token_hash', 'auth_version'):
            self.assertNotIn(key, public.json())
            self.assertNotIn(key, owner.json())

    def test_private_reads_reject_missing_expired_wrong_role_and_wrong_business(self):
        for suffix in ('customers', 'subscription', 'subscription/payments'):
            url = f'/api/v1/business/one/{suffix}'
            for headers, expected in (
                ({}, 401),
                ({'Authorization': 'Bearer owner-token-one'}, 401),
                (self.headers(exp=datetime.now(timezone.utc)-timedelta(seconds=1)), 401),
                (self.headers('cashier'), 403),
                (self.headers(business_public_id='other'), 403),
            ):
                with self.subTest(suffix=suffix, expected=expected):
                    self.assertEqual(self.client.get(url, headers=headers).status_code, expected)
        self.read_customers.assert_not_called()
        self.assertNotIn('subscription_payments', self.db.reads)

    def test_valid_owner_reads_and_reset_revocation(self):
        self.assertEqual(self.client.get('/api/v1/business/one/customers', headers=self.headers()).status_code, 200)
        self.assertEqual(self.client.get('/api/v1/business/one/subscription', headers=self.headers()).status_code, 200)
        history = self.client.get('/api/v1/business/one/subscription/payments', headers=self.headers()).json()
        self.assertEqual(len(history), 1)
        self.assertNotIn('fulfillment_context', history[0])
        self.assertNotIn('billing_session_id', history[0])
        self.business['auth_version'] = 1
        self.assertEqual(self.client.get('/api/v1/business/one/customers', headers=self.headers()).status_code, 401)

    def test_cashier_gets_only_minimal_access_status_and_must_remain_active(self):
        url = '/api/v1/business/one/subscription/access'
        response = self.client.get(url, headers=self.headers('cashier'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'billing_hold', 'trial_ends_at', 'last_paid_at'})
        self.db.rows['staff'][0]['is_active'] = False
        self.assertEqual(self.client.get(url, headers=self.headers('cashier')).status_code, 403)

    def test_signup_capability_cannot_read_customer_list_history_or_other_checkout(self):
        headers = self.headers('billing', purpose='subscription_billing', jti='signup-session')
        self.assertEqual(self.client.get('/api/v1/business/one/subscription', headers=headers).status_code, 200)
        self.assertIsNone(self.client.get('/api/v1/business/one/subscription', headers=headers).json()['latest_payment'])
        self.assertEqual(self.client.get('/api/v1/business/one/customers', headers=headers).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/business/one/subscription/payments', headers=headers).status_code, 403)
        url = '/api/v1/business/one/subscription/payments/pi_owned'
        self.assertEqual(self.client.get(url, headers=headers).status_code, 200)
        other_session = self.headers('billing', purpose='subscription_billing', jti='other-session')
        self.assertEqual(self.client.get(url, headers=other_session).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/business/one/subscription/access', headers=headers).status_code, 403)

    def test_review_required_payment_is_not_reported_as_completed(self):
        self.db.rows['subscription_payments'][0].update(status='paid', fulfillment_status='legacy_review')
        response = self.client.get('/api/v1/business/one/subscription/payments/pi_owned', headers=self.headers())
        self.assertEqual(response.json()['status'], 'review_required')

    def test_expired_signup_recovery_requires_password_and_scopes_existing_intent(self):
        url = '/api/v1/auth/billing-session'
        response = self.client.post(url, json={'email': 'owner@example.test', 'password': 'wrong'})
        self.assertEqual(response.status_code, 401)
        response = self.client.post(url, json={
            'email': 'owner@example.test', 'password': 'correct-password', 'payment_intent_id': 'pi_owned',
        })
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotIn('password', str(payload))
        headers = {'Authorization': 'Bearer ' + payload['billing_token']}
        result = self.client.get('/api/v1/business/one/subscription/payments/pi_owned', headers=headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get('/api/v1/business/one/customers', headers=headers).status_code, 403)
        self.assertEqual(self.client.post(url, json={
            'email': 'owner@example.test', 'password': 'correct-password', 'payment_intent_id': 'pi_someone_else',
        }).status_code, 404)

    def test_sensitive_handler_guards_run_before_database_work(self):
        names = ('get_customers', 'get_stats', 'get_analytics', 'delete_customer', 'get_setup_kit',
                 'list_cl_customers', 'list_contracts', 'list_cl_applications', 'list_cl_agents',
                 'get_customer_stamp_history', 'get_points_history', 'list_customer_coupons',
                 'create_coupon', 'create_or_update_wallet_class', 'create_or_update_cl_wallet_class')
        for name in names:
            node = copy.deepcopy(DEFINITIONS[name])
            node.decorator_list = []
            # Only resolve annotations; execute the actual production body.
            node.returns = None
            for arg in node.args.args + node.args.kwonlyargs: arg.annotation = None
            env = dict(self.env)
            exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), env)
            handler = env[name]
            arguments = {key: None for key, value in inspect.signature(handler).parameters.items()
                         if value.default is inspect.Parameter.empty}
            arguments.update(public_id='one', authorization='')
            with self.subTest(handler=name), self.assertRaises(HTTPException) as error:
                asyncio.run(handler(**arguments))
            self.assertEqual(error.exception.status_code, 401)
        self.read_customers.assert_not_called()


class BusinessProjectionTests(unittest.TestCase):
    def test_nested_owner_settings_also_remove_credentials(self):
        projected = business_data_access.owner_business({
            'name': 'Example', 'settings': {'theme': 'green', 'api_key': 'hidden'},
            'password_reset_requested_by': 'internal', 'auth_version': 1,
        })
        self.assertEqual(projected, {'name': 'Example', 'settings': {'theme': 'green'}})


if __name__ == '__main__': unittest.main()

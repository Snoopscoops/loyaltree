"""Owner revocation also applies to scan cookies and order operators."""
import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Optional
import unittest

from fastapi import Header, HTTPException

from backend.tests.test_owner_password_security import MemoryDB, business, definitions
import password_security as passwords


class OwnerConsumerTests(unittest.TestCase):
    def env(self, db):
        return definitions((
            'create_staff_session_token', 'create_owner_session_token',
            'verify_staff_session_token', 'validate_owner_auth_version',
            'get_staff_session_claims', '_oa_require_order_operator', 'cashier_session_status',
        ), {
            'HTTPException': HTTPException, 'Request': object, 'Header': Header,
            'Optional': Optional, 'datetime': datetime, 'timedelta': timedelta,
            'asyncio': asyncio, 'STAFF_SESSION_SECRET': 'local test secret, never a production credential',
            'STAFF_SESSION_TTL_HOURS': 12, 'OWNER_SESSION_TTL_HOURS': 12,
            'supabase': db, 'owner_password_security': passwords,
            'safe_get_business': lambda slug: next((row for row in db.businesses if row['public_id'] == slug), None),
            '_supabase_first_row': lambda response: (response.data or [None])[0],
        })

    def signed(self, **changes):
        import jwt
        return jwt.encode({'business_public_id': 'demo', 'business_id': 7, 'role': 'owner',
                           'exp': datetime.utcnow() + timedelta(hours=1), **changes},
                          'local test secret, never a production credential', algorithm='HS256')

    def test_owner_scan_session_uses_current_version_and_cannot_be_minted_for_a_staff_row(self):
        db = MemoryDB(business(auth_version=3))
        env = self.env(db)
        token = env['create_staff_session_token']('demo', None, 'owner', 'Owner')
        claims = env['get_staff_session_claims']('demo', f'Bearer {token}')
        self.assertEqual(claims['auth_version'], 3)
        self.assertEqual(claims['business_id'], 7)
        with self.assertRaises(HTTPException) as caught:
            env['create_staff_session_token']('demo', 99, 'owner', 'Not the owner')
        self.assertEqual(caught.exception.status_code, 403)

    def test_order_operator_owner_session_is_revoked_after_reset(self):
        db = MemoryDB(business(order_ahead_enabled=True))
        env = self.env(db)
        token = self.signed()
        self.assertEqual(env['_oa_require_order_operator']('demo', f'Bearer {token}')[0]['id'], 7)
        db.businesses[0]['auth_version'] = 1
        with self.assertRaises(HTTPException) as caught:
            env['_oa_require_order_operator']('demo', f'Bearer {token}')
        self.assertEqual(caught.exception.status_code, 401)
        with self.assertRaises(HTTPException):
            env['_oa_require_order_operator']('demo', f'Bearer {self.signed(role="billing", auth_version=1)}')

    def test_order_operator_staff_keeps_current_branch_and_role_scope(self):
        db = MemoryDB(business(order_ahead_enabled=True), staff=[{
            'id': 12, 'business_id': 7, 'role': 'manager', 'branch_id': 5,
            'name': 'Current manager', 'is_active': True,
        }])
        env = self.env(db)
        token = self.signed(role='manager', staff_id=12, branch_id=1)
        _, claims, branch_id = env['_oa_require_order_operator']('demo', f'Bearer {token}')
        self.assertEqual(branch_id, 5)
        self.assertEqual(claims['name'], 'Current manager')
        db.staff[0]['is_active'] = False
        with self.assertRaises(HTTPException):
            env['_oa_require_order_operator']('demo', f'Bearer {token}')

    def test_cookie_restore_checks_owner_reset_version_without_bearer_prefetch(self):
        db = MemoryDB(business(auth_version=2))
        env = self.env(db)
        token = self.signed(auth_version=2)
        request = SimpleNamespace(cookies={'lt_cashier_session': token})
        self.assertTrue(asyncio.run(env['cashier_session_status']('demo', request, ''))['success'])
        db.businesses[0]['auth_version'] = 3
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(env['cashier_session_status']('demo', request, ''))
        self.assertEqual(caught.exception.status_code, 401)
        request.cookies['lt_cashier_session'] = self.signed(role='billing', auth_version=3)
        with self.assertRaises(HTTPException):
            asyncio.run(env['cashier_session_status']('demo', request, ''))

    def test_staff_cookie_restore_checks_current_account_instead_of_stale_token(self):
        db = MemoryDB(business(), staff=[{
            'id': 12, 'business_id': 7, 'role': 'cashier', 'is_active': True,
            'name': 'Current name', 'businesses': {'public_id': 'demo'},
        }])
        env = self.env(db)
        token = self.signed(role='cashier', staff_id=12, name='Stale name')
        request = SimpleNamespace(cookies={'lt_cashier_session': token})
        result = asyncio.run(env['cashier_session_status']('demo', request, ''))
        self.assertEqual(result['name'], 'Current name')
        db.staff[0]['is_active'] = False
        with self.assertRaises(HTTPException):
            asyncio.run(env['cashier_session_status']('demo', request, ''))
        db.staff[0]['is_active'] = True
        db.staff[0]['role'] = 'manager'
        with self.assertRaises(HTTPException):
            asyncio.run(env['cashier_session_status']('demo', request, ''))
        db.staff[0]['role'] = 'cashier'
        db.staff[0]['businesses']['public_id'] = 'other'
        with self.assertRaises(HTTPException):
            asyncio.run(env['cashier_session_status']('demo', request, ''))


if __name__ == '__main__':
    unittest.main()

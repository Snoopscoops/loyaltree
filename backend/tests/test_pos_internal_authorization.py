"""Authenticated POS work still enters the protected canonical ledger."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import Header, HTTPException

from backend.tests.test_owner_password_security import definitions
from backend.tests.test_transaction_owner_auth import TransactionDB
import password_security as passwords


class InternalPOSAuthTests(unittest.TestCase):
    def env(self):
        db = TransactionDB()
        db.businesses[0]['auth_version'] = 3
        env = definitions((
            'create_owner_session_token', 'verify_staff_session_token',
            'validate_owner_auth_version', 'require_owner_session',
            '_pos_internal_owner_authorization', 'pos_companion_benefit_commit',
        ), {
            'HTTPException': HTTPException, 'Header': Header, 'asyncio': asyncio,
            'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone,
            'BackgroundTasks': object, 'POSCompanionReservationCommitRequest': object,
            'STAFF_SESSION_SECRET': 'local POS test signing secret only', 'OWNER_SESSION_TTL_HOURS': 12,
            'owner_password_security': passwords, 'supabase': db,
        })
        return env, db

    def test_internal_token_is_short_lived_scoped_and_uses_fresh_reset_version(self):
        env, db = self.env()
        stale_business = {**db.businesses[0], 'auth_version': 0}
        authorization = asyncio.run(env['_pos_internal_owner_authorization'](stale_business))
        claims = env['require_owner_session']('demo', authorization)
        self.assertEqual(claims['auth_version'], 3)
        self.assertEqual(claims['business_id'], 7)
        self.assertEqual(claims['exp'] - claims['iat'], 60)
        with self.assertRaises(HTTPException): env['require_owner_session']('another-business', authorization)
        with self.assertRaises(HTTPException):
            asyncio.run(env['_pos_internal_owner_authorization']({**stale_business, 'id': 99}))

    def test_verified_pos_device_can_commit_benefit_through_owner_guard(self):
        env, db = self.env()
        actions = []
        device = {'id': 'device-1', 'business_id': 7, 'integration_id': 'integration-1'}
        reservation = {'id': 'reservation-1', 'business_id': 7, 'integration_id': 'integration-1',
                       'status': 'reserved', 'customer_id': 12, 'benefit_id': 'benefit-1', 'quantity': 1}

        def authenticate(token):
            self.assertEqual(token, 'verified-device-secret')
            actions.append('device-authenticated')
            return device

        async def redeem(public_id, req, background_tasks, authorization, x_idempotency_key):
            self.assertEqual(actions, ['device-authenticated'])
            claims = env['require_owner_session'](public_id, authorization)
            self.assertEqual(claims['auth_version'], 3)
            self.assertTrue(req.as_owner)
            self.assertEqual(req.customer_public_id, 'card-demo')
            self.assertEqual(x_idempotency_key, 'pos-benefit:reservation-1')
            actions.append('protected-redemption')
            return {'redemption': {'id': 'redemption-1'}}

        original_table = db.table

        def table(name):
            if name != 'pos_benefit_reservations': return original_table(name)
            query = Mock()
            query.update.return_value = query
            query.eq.return_value = query
            query.execute.return_value = SimpleNamespace(data=[])
            return query

        db.table = table
        env.update({
            '_require_pos_device': authenticate,
            '_pos_benefit_reservation_row': lambda identifier: reservation,
            '_manual_assert_legacy_reservation': lambda identifier: None,
            '_pos_parse_timestamp': lambda value: None,
            '_pos_companion_exact_transaction': lambda *args: {'id': 'confirmed-pos-transaction'},
            '_pos_business_by_id': lambda identifier: {**db.businesses[0], 'auth_version': 0},
            'MembershipBenefitRedeemRequest': SimpleNamespace,
            'redeem_membership_benefit': redeem,
        })
        result = asyncio.run(env['pos_companion_benefit_commit'](
            'reservation-1', SimpleNamespace(external_transaction_id='sale-1'), Mock(), 'verified-device-secret'))
        self.assertEqual(actions, ['device-authenticated', 'protected-redemption'])
        self.assertTrue(result['ok'])
        self.assertEqual(result['reservation']['status'], 'committed')
        self.assertNotIn('Bearer', str(result))


if __name__ == '__main__':
    unittest.main()

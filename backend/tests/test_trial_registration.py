"""Registration failure-path regressions without database or provider access.

Extract the real register() through AST so importing the application cannot
initialize Supabase, email, or payment integrations.
"""
import ast
import asyncio
from datetime import datetime, timezone
import hashlib
import hmac
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import unittest

from fastapi import HTTPException, BackgroundTasks


SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
TRIAL = {'code': 'HALLOWEEN7', 'trial_days': 7,
         'trial_ends_at': '2026-10-22T12:30:00+00:00'}


class FakeDB:
    """Persist records and inject failures at the database boundaries."""

    def __init__(self, *, fail_agreement=False, fail_delete=False,
                 fail_rpc=False, empty_rpc=False, commit_then_raise=False,
                 fail_recovery=False, fail_cancel_business=False,
                 unknown_recovery=False):
        self.fail_agreement = fail_agreement
        self.fail_delete = fail_delete
        self.fail_rpc = fail_rpc
        self.empty_rpc = empty_rpc
        self.commit_then_raise = commit_then_raise
        self.fail_recovery = fail_recovery
        self.fail_cancel_business = fail_cancel_business
        self.unknown_recovery = unknown_recovery
        self.businesses = {}
        self.agreements = {}
        self.redemptions = {}
        self.events = []
        self.rpc_calls = []

    def table(self, table):
        db = self

        class Query:
            def __init__(self):
                self.action = None
                self.payload = None
                self.filters = {}

            def insert(self, payload):
                self.action, self.payload = 'insert', payload
                return self

            def delete(self):
                self.action = 'delete'
                return self

            def eq(self, key, value):
                self.filters[key] = value
                return self

            def execute(self):
                db.events.append((table, self.action))
                if self.action == 'delete':
                    if db.fail_delete:
                        raise RuntimeError('simulated rollback outage')
                    business_id = self.filters.get('business_id',
                                                   self.filters.get('id'))
                    if table == 'business_agreements':
                        db.agreements.pop(business_id, None)
                    elif table == 'businesses':
                        if business_id in db.agreements:
                            raise RuntimeError('agreement foreign key blocks business deletion')
                        db.businesses.pop(business_id, None)
                    return SimpleNamespace(data=[])
                if self.action != 'insert':
                    raise AssertionError(f'Unexpected operation: {table}/{self.action}')
                if table == 'businesses':
                    row = {'id': 1, **self.payload}
                    db.businesses[row['id']] = row
                    return SimpleNamespace(data=[row])
                if table == 'business_agreements':
                    if db.fail_agreement:
                        raise RuntimeError('simulated agreement storage outage')
                    row = dict(self.payload)
                    db.agreements[row['business_id']] = row
                    return SimpleNamespace(data=[row])
                if table == 'branches':
                    return SimpleNamespace(data=self.payload)
                raise AssertionError(f'Unexpected table: {table}')

        return Query()

    def rpc(self, name, payload):
        self.rpc_calls.append((name, payload))
        db = self

        class Claim:
            def execute(self):
                db.events.append((name, 'rpc'))
                business_id = payload['p_business_id']
                if name == 'cancel_pending_trial_signup':
                    if db.fail_recovery:
                        raise RuntimeError('simulated recovery outage')
                    if db.unknown_recovery:
                        return SimpleNamespace(data=None)
                    if business_id in db.redemptions:
                        return SimpleNamespace(data=dict(db.redemptions[business_id]))
                    business = db.businesses.get(business_id)
                    if business is None:
                        return SimpleNamespace(data={'cancelled': True})
                    if (business['status'] != 'PENDING'
                            or business.get('last_paid_at')
                            or business.get('trial_ends_at')):
                        raise RuntimeError('Cannot cancel an activated business')
                    # Model the SQL function transaction: failure deleting the
                    # business rolls the earlier agreement deletion back too.
                    agreement = db.agreements.pop(business_id, None)
                    if db.fail_cancel_business:
                        if agreement is not None:
                            db.agreements[business_id] = agreement
                        raise RuntimeError('simulated business deletion failure')
                    db.businesses.pop(business_id)
                    return SimpleNamespace(data={'cancelled': True})
                if name != 'redeem_business_trial':
                    raise AssertionError(f'Unexpected RPC: {name}')
                if db.fail_rpc:
                    raise RuntimeError('simulated coupon redemption failure')
                if db.empty_rpc:
                    return SimpleNamespace(data=None)
                if business_id not in db.agreements:
                    raise AssertionError('A persisted agreement is required before activation')
                db.businesses[business_id].update(
                    status='ACTIVE', trial_ends_at=TRIAL['trial_ends_at'])
                db.redemptions[business_id] = dict(TRIAL)
                if db.commit_then_raise:
                    raise RuntimeError('simulated lost redemption response')
                return SimpleNamespace(data=dict(TRIAL))

        return Claim()


def registration_namespace(db):
    node = next(n for n in ast.parse(SOURCE.read_text()).body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == 'register')
    node.decorator_list = []
    document = {'title': 'Test agreement', 'snapshot': 'Signed trial terms',
                'agreement_sha256': 'a' * 64, 'setup_kit_amount': 0}
    env = dict(
        BusinessCreate=object, Request=object, BackgroundTasks=BackgroundTasks, HTTPException=HTTPException,
        supabase=db, datetime=datetime, timezone=timezone,
        hashlib=hashlib, hmac=hmac,
        normalize_business_type=lambda value: value,
        normalize_country_code=lambda value: value,
        find_business_duplicate=lambda *args: None,
        generate_business_public_id=lambda name: 'test-cafe',
        generate_public_id=lambda: 'test-record',
        hash_password=lambda password: 'test-password-hash',
        owner_password_security=SimpleNamespace(hash_owner_password=AsyncMock(
            return_value='pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$' + '0' * 64)),
        STAFF_SESSION_SECRET='local test signing configuration',
        create_billing_session_token=lambda business: 'test-billing-session',
        _decode_signature_data_url=lambda value: b'test-signature',
        lookup_trial_coupon=lambda code: {'code': code, 'trial_days': 7},
        coupon_available=lambda row, *args: row,
        self_serve_billing_cycle=lambda value, region: value,
        normalize_billing_cycle=lambda value: value,
        pricing_region_config=lambda region: {'currency': 'PHP'},
        get_price_for_plan=lambda *args: 1050,
        build_signup_agreement_document=lambda **kwargs: dict(document),
        ensure_business_referral_code=lambda business: None,
        _agreement_request_ip_hash=lambda request: 'test-ip-hash',
        friendly_db_error=lambda error: str(error),
        SUBSCRIPTION_PLANS={'starter': {'label': 'Starter', 'max_branches': 1}},
        MARKET_CURRENCIES={'PH': 'PHP'}, SUPER_ADMIN_EMAIL='',
        send_business_getting_started_email=MagicMock(),
        print=lambda *args: None,
    )
    for name in ('LEGAL_PRESENTATION_VERSION', 'BUSINESS_AGREEMENT_VERSION',
                 'TERMS_VERSION', 'PRIVACY_VERSION', 'DPA_VERSION'):
        env[name] = 'test-v1'
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE), 'exec'), env)
    return env


def signup_payload(coupon='HALLOWEEN7'):
    agreement = SimpleNamespace(
        authority_confirmed=True, agreement_confirmed=True,
        policies_acknowledged=True, signature_data_url='test-signature',
        signer_name='Test Owner', signer_title='Owner',
        legal_presentation_version='test-v1', agreement_version='test-v1',
        terms_version='test-v1', privacy_version='test-v1', dpa_version='test-v1',
        agreement_sha256='a' * 64,
    )
    return SimpleNamespace(
        agreement=agreement, name='Test Cafe', email='owner@example.invalid',
        phone='09123456789', password='test-password', contact_person='Test Owner',
        logo_url='https://example.invalid/logo.png', business_type='coffee',
        address='Test address', plan='starter', branch_count=1,
        country_code='PH', pricing_region='PH', billing_cycle='3_months',
        trial_coupon=coupon, setup_kit_requested=False,
        partner_code=None, referral_code=None,
    )


class TrialRegistrationTests(unittest.TestCase):
    def register(self, db, coupon='HALLOWEEN7'):
        env = registration_namespace(db)
        request = SimpleNamespace(headers={'user-agent': 'Registration test'})
        self.background_tasks=BackgroundTasks()
        self.email_sender=env['send_business_getting_started_email']
        return asyncio.run(env['register'](signup_payload(coupon), request, self.background_tasks))

    def test_getting_started_email_is_queued_once_after_success_without_secrets(self):
        db=FakeDB()
        self.register(db)
        self.assertEqual(len(self.background_tasks.tasks),1)
        task=self.background_tasks.tasks[0]
        self.assertIs(task.func,self.email_sender)
        self.assertEqual(task.args[0]['email'],'owner@example.invalid')
        self.assertEqual(task.args[1],TRIAL)
        self.assertNotIn('password',task.args[0])
        self.assertNotIn('agreement',task.args[0])
        self.email_sender.assert_not_called()
        asyncio.run(self.background_tasks())
        self.email_sender.assert_called_once()
        self.assertEqual(db.businesses[1]['status'],'ACTIVE')

    def test_failed_agreement_does_not_queue_any_owner_email(self):
        with self.assertRaises(HTTPException):self.register(FakeDB(fail_agreement=True))
        self.assertEqual(self.background_tasks.tasks,[])
        self.email_sender.assert_not_called()

    def test_coupon_failure_does_not_queue_any_owner_email(self):
        with self.assertRaises(HTTPException):self.register(FakeDB(fail_rpc=True))
        self.assertEqual(self.background_tasks.tasks,[])
        self.email_sender.assert_not_called()

    def test_signed_agreement_is_persisted_before_trial_activation(self):
        db = FakeDB()
        result = self.register(db)
        self.assertLess(db.events.index(('business_agreements', 'insert')),
                        db.events.index(('redeem_business_trial', 'rpc')))
        self.assertTrue(result['success'])
        self.assertTrue(result['agreement_signed'])
        self.assertEqual(result['trial'], TRIAL)
        self.assertEqual(db.businesses[1]['status'], 'ACTIVE')
        self.assertEqual(db.agreements[1]['agreement_sha256'], 'a' * 64)
        self.assertEqual(db.rpc_calls, [('redeem_business_trial', {
            'p_code': 'HALLOWEEN7', 'p_business_id': 1, 'p_trial_days': 7})])

    def test_signup_without_coupon_remains_pending_for_payment(self):
        db = FakeDB()
        result = self.register(db, coupon=None)
        self.assertIsNone(result['trial'])
        self.assertEqual(db.businesses[1]['status'], 'PENDING')
        self.assertEqual(db.rpc_calls, [])
        self.assertIn(1, db.agreements)

    def test_missing_signing_configuration_fails_before_creating_an_account(self):
        db = FakeDB()
        env = registration_namespace(db)
        env['STAFF_SESSION_SECRET'] = ''
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(env['register'](signup_payload(), SimpleNamespace(headers={}), BackgroundTasks()))
        self.assertEqual(caught.exception.status_code, 503)
        self.assertFalse(db.businesses)
        self.assertFalse(db.events)

    def test_failed_agreement_storage_never_redeems_trial(self):
        db = FakeDB(fail_agreement=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 500)
        self.assertIn('Signed agreement could not be stored', caught.exception.detail)
        self.assertEqual(db.rpc_calls, [])
        self.assertEqual(db.businesses, {})
        self.assertEqual(db.agreements, {})

    def test_failed_agreement_and_rollback_leave_only_pending_account(self):
        db = FakeDB(fail_agreement=True, fail_delete=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 500)
        self.assertIn('Signed agreement could not be stored', caught.exception.detail)
        self.assertEqual(db.rpc_calls, [])
        self.assertEqual(db.businesses[1]['status'], 'PENDING')
        self.assertIsNone(db.businesses[1].get('trial_ends_at'))
        self.assertEqual(db.agreements, {})

    def test_failed_coupon_redemption_cleans_up_account_and_agreement(self):
        db = FakeDB(fail_rpc=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn('Coupon could not be redeemed', caught.exception.detail)
        self.assertEqual(db.businesses, {})
        self.assertEqual(db.agreements, {})

    def test_failed_coupon_recovery_preserves_clear_original_error(self):
        db = FakeDB(fail_rpc=True, fail_recovery=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn('could not confirm your signup', caught.exception.detail)
        self.assertEqual(str(caught.exception.__cause__),
                         'simulated coupon redemption failure')
        self.assertEqual(db.businesses[1]['status'], 'PENDING')
        self.assertIsNone(db.businesses[1].get('trial_ends_at'))
        self.assertIn(1, db.agreements)

    def test_lost_redemption_response_recovers_committed_trial(self):
        db = FakeDB(commit_then_raise=True)
        result = self.register(db)
        self.assertTrue(result['success'])
        self.assertEqual(result['trial'], TRIAL)
        self.assertEqual(db.businesses[1]['status'], 'ACTIVE')
        self.assertIn(1, db.agreements)
        self.assertEqual(db.redemptions, {1: TRIAL})
        self.assertEqual([name for name, payload in db.rpc_calls],
                         ['redeem_business_trial', 'cancel_pending_trial_signup'])
        self.assertFalse(any(action == 'delete' for table, action in db.events))

    def test_recovery_outage_preserves_signed_committed_trial(self):
        db = FakeDB(commit_then_raise=True, fail_recovery=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn('Try signing in', caught.exception.detail)
        self.assertEqual(str(caught.exception.__cause__),
                         'simulated lost redemption response')
        self.assertEqual(db.businesses[1]['status'], 'ACTIVE')
        self.assertIn(1, db.agreements)
        self.assertEqual(db.redemptions, {1: TRIAL})
        self.assertFalse(any(action == 'delete' for table, action in db.events))

    def test_pending_cancellation_failure_preserves_both_records(self):
        db = FakeDB(fail_rpc=True, fail_cancel_business=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(db.businesses[1]['status'], 'PENDING')
        self.assertIn(1, db.agreements)
        self.assertEqual(db.redemptions, {})
        self.assertFalse(any(action == 'delete' for table, action in db.events))

    def test_unknown_recovery_result_never_reports_success(self):
        db = FakeDB(fail_rpc=True, unknown_recovery=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(db.businesses[1]['status'], 'PENDING')
        self.assertIn(1, db.agreements)

    def test_unconfirmed_coupon_response_does_not_report_success(self):
        db = FakeDB(empty_rpc=True)
        with self.assertRaises(HTTPException) as caught:
            self.register(db)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn('Coupon could not be redeemed', caught.exception.detail)
        self.assertEqual(db.businesses, {})
        self.assertEqual(db.agreements, {})


if __name__ == '__main__':
    unittest.main()

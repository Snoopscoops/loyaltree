"""Business setup email copy and failure handling; no provider sends."""
import ast
from pathlib import Path
from typing import Optional
import unittest
from unittest.mock import MagicMock
from backend.business_welcome_email import build_business_getting_started_email

SOURCE=Path(__file__).resolve().parents[1]/'main.py'

class BusinessWelcomeEmailTests(unittest.TestCase):
    def message(self, **changes):
        values=dict(business_name='Test Cafe',contact_person='Test Owner',
                    email='owner@example.invalid',site_url='https://test.example.invalid/',
                    support_email='support@example.invalid',trial=None)
        return build_business_getting_started_email(**{**values,**changes})

    def test_trial_includes_actual_duration_and_philippine_end_time(self):
        subject,body=self.message(trial={'trial_days':14,'trial_ends_at':'2026-10-22T01:00:00Z'})
        self.assertIn('quick start guide',subject)
        self.assertIn('14-day free trial is active',body)
        self.assertIn('Oct 22, 2026 at 09:00 AM (Philippine time)',body)
        self.assertIn('https://test.example.invalid/login?onboarding=1',body)
        self.assertIn('More → Billing',body)
        self.assertNotIn('First, finish',body)

    def test_pending_payment_instructions_precede_the_setup_steps(self):
        _,body=self.message()
        self.assertIn('First, finish <strong>Pay &amp; Activate</strong>',body)
        self.assertIn('After payment is confirmed',body)
        self.assertIn('After activation, follow these five steps',body)
        self.assertIn('Read the setup guide',body)
        self.assertNotIn('free trial is active',body)
        self.assertNotIn('/signup',body)

    def test_guide_uses_existing_dashboard_labels(self):
        _,body=self.message()
        for label in ('Setup Guide','Operate → Team','share its join QR','More → Setup Guide'):
            self.assertIn(label,body)
        self.assertIn('/how-it-works/businesses',body)
        self.assertIn('Apple Wallet or Google Wallet',body)

    def test_business_supplied_text_is_escaped(self):
        _,body=self.message(business_name='<script>alert(1)</script>',
                            contact_person='<img src=x>',email='a&b@example.invalid')
        self.assertNotIn('<script>',body)
        self.assertNotIn('<img src=x>',body)
        self.assertIn('&lt;script&gt;',body)
        self.assertIn('a&amp;b@example.invalid',body)
        self.assertNotIn('owner-token-',body)

    def test_bad_trial_date_keeps_a_useful_billing_instruction(self):
        _,body=self.message(trial={'trial_days':7,'trial_ends_at':'invalid'})
        self.assertIn('the end date shown in More → Billing',body)

    def sender(self, send_email):
        node=next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='send_business_getting_started_email')
        environment=dict(Optional=Optional,build_business_getting_started_email=build_business_getting_started_email,
                         FRONTEND_URL='',PUBLIC_JOIN_BASE_URL='https://test.example.invalid',
                         TRANSACTIONAL_REPLY_TO='support@example.invalid',LOYALTYTREE_LEGAL_EMAIL='support@example.invalid',
                         send_email=send_email,log_event=MagicMock(),print=MagicMock())
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),'exec'),environment)
        return environment['send_business_getting_started_email'],environment

    def test_provider_failure_is_best_effort_and_never_logs_recipient(self):
        send=MagicMock(return_value=False)
        fn,environment=self.sender(send)
        self.assertFalse(fn({'public_id':'test','name':'Test Cafe','email':'owner@example.invalid'}))
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0],'owner@example.invalid')
        self.assertEqual(send.call_args.kwargs['reply_to'],'support@example.invalid')
        self.assertNotIn('owner@example.invalid',str(environment['log_event'].call_args))

    def test_unexpected_provider_exception_does_not_escape(self):
        fn,environment=self.sender(MagicMock(side_effect=TimeoutError('test email outage')))
        self.assertFalse(fn({'public_id':'test','name':'Test Cafe','email':'owner@example.invalid'}))
        self.assertFalse(environment['log_event'].call_args.kwargs['sent'])

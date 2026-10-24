"""A request body's owner flag cannot replace an authenticated owner session."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import Header, HTTPException

from backend.tests.test_owner_password_security import MemoryDB, NODES, SOURCE, business, definitions
import password_security as passwords


TRANSACTIONS = (
    'add_stamp', 'adjust_stamp', 'add_vip_sale', 'add_points_sale',
    'redeem_points_prize', 'issue_multipass', 'use_multipass_session',
    'redeem_membership_benefit', 'record_employee_attendance',
    'add_membership_note', 'redeem_reward', 'redeem_coupon',
)


class TransactionDB(MemoryDB):
    def __init__(self):
        super().__init__(business(), staff=[{'id': 9, 'business_id': 7, 'pin': '1234', 'branch_id': 4}])
        self.customer = {'id': 12, 'public_id': 'card-demo', 'business_id': 7, 'stamp_count': 3}
        self.adjustments = []

    def table(self, name):
        if name not in ('customers', 'stamp_adjustments'): return super().table(name)
        db = self

        class Query:
            def select(self, *args): return self
            def limit(self, *args): return self
            def update(self, value): self.value = value; return self
            def insert(self, value): self.value = value; return self
            def eq(self, *args): return self
            def execute(self):
                if name == 'customers':
                    if hasattr(self, 'value'): db.customer.update(self.value)
                    return SimpleNamespace(data=[deepcopy(db.customer)])
                db.adjustments.append(deepcopy(self.value))
                return SimpleNamespace(data=[self.value])
        return Query()


def load_transactions(env):
    nodes = [deepcopy(NODES[name]) for name in TRANSACTIONS]
    for node in nodes:
        node.decorator_list = []
        node.returns = None
        for arg in node.args.args + node.args.kwonlyargs + node.args.posonlyargs:
            arg.annotation = None
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)


class OwnerAssertionTests(unittest.TestCase):
    def env(self):
        db = TransactionDB()
        env = definitions(('get_staff_session_claims', 'require_owner_session', 'validate_owner_auth_version', '_audit_actor'), {
            'HTTPException': HTTPException, 'asyncio': asyncio, 'Header': Header,
            'datetime': datetime, 'owner_password_security': passwords, 'supabase': db,
            'verify_staff_session_token': lambda token: {
                'business_public_id': 'demo', 'business_id': 7,
                'role': token, **({'staff_id': 9, 'branch_id': 4} if token == 'cashier' else {}),
            },
            'safe_get_business': Mock(return_value=db.businesses[0]),
            'safe_get_customer': Mock(side_effect=lambda public_id: deepcopy(db.customer)),
            'safe_get_customer_program': lambda *args: {'card_type': 'stamp', 'stamp_goal': 8},
            'program_reward_uses_stamps': lambda value: True,
            'tier_stamps_enabled': lambda value: False,
            'get_available_stamp_rewards': lambda *args: [],
            'start_transaction_audit': Mock(return_value={'transaction_id': 'test-adjustment'}),
            'complete_transaction_audit': Mock(), 'sync_loyalty_wallets_background': Mock(),
            'print': lambda *args: None,
        })
        load_transactions(env)
        return env, db

    def call(self, env, name, req, authorization=''):
        kwargs = {'public_id': 'demo', 'req': req, 'authorization': authorization}
        if any(arg.arg == 'background_tasks' for arg in NODES[name].args.args):
            kwargs['background_tasks'] = Mock()
        return asyncio.run(env[name](**kwargs))

    def test_every_owner_assertion_requires_authentication_before_reads_or_mutations(self):
        for name in TRANSACTIONS:
            with self.subTest(endpoint=name):
                env, db = self.env()
                with self.assertRaises(HTTPException) as caught:
                    self.call(env, name, SimpleNamespace(as_owner=True))
                self.assertEqual(caught.exception.status_code, 401)
                self.assertEqual(db.customer['stamp_count'], 3)
                self.assertFalse(db.adjustments)
                env['safe_get_business'].assert_not_called()
                env['safe_get_customer'].assert_not_called()

    def test_cashier_cannot_assert_owner_privileges_with_a_valid_staff_token(self):
        for name in TRANSACTIONS:
            with self.subTest(endpoint=name):
                env, db = self.env()
                with self.assertRaises(HTTPException) as caught:
                    self.call(env, name, SimpleNamespace(as_owner=True), 'Bearer cashier')
                self.assertEqual(caught.exception.status_code, 403)
                self.assertEqual(db.customer['stamp_count'], 3)
                self.assertFalse(db.adjustments)
                env['safe_get_business'].assert_not_called()

    def test_valid_owner_signed_cashier_and_legacy_pin_adjustments_keep_working(self):
        for owner, authorization, pin, expected_actor in (
            (True, 'Bearer owner', '', 'owner'),
            (False, 'Bearer cashier', '', 'staff'),
            (False, '', '1234', 'staff'),
        ):
            with self.subTest(authentication=authorization or 'legacy PIN'):
                env, db = self.env()
                req = SimpleNamespace(as_owner=owner, customer_public_id='card-demo',
                                      staff_pin=pin, delta=1, stamp_kind='reward', reason='Correction')
                result = self.call(env, 'adjust_stamp', req, authorization)
                self.assertEqual(result['stamp_count'], 4)
                self.assertEqual(db.customer['stamp_count'], 4)
                self.assertEqual(len(db.adjustments), 1)
                self.assertEqual(env['start_transaction_audit'].call_args.kwargs['actor_type'], expected_actor)
                env['complete_transaction_audit'].assert_called_once()


if __name__ == '__main__':
    unittest.main()

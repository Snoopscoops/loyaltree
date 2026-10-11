"""Isolated billing regression tests; no live DB or payment-provider access.

Load the real definitions through AST to avoid main.py's integration startup.
Run: python -m unittest discover -s backend/tests
"""
import ast
import asyncio
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Optional, Literal
import unittest
from unittest.mock import MagicMock
from pydantic import BaseModel, Field, ValidationError

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
TREE = ast.parse(SOURCE.read_text())
NAMES = {'branch_price_bracket', 'normalize_billing_cycle', 'get_price_for_plan',
         'business_custom_monthly_price', 'billing_branch_count', 'get_price_for_business',
         'AdminBusinessUpdate', 'admin_update_business', 'get_subscription_status', 'create_subscription_checkout'}

def namespace():
    env = dict(Optional=Optional, Literal=Literal, BaseModel=BaseModel, Field=Field,
               datetime=datetime, HTTPException=HTTPException, SubscriptionCheckoutRequest=SimpleNamespace,
               Depends=lambda value: None, require_admin=lambda: True,
               SUBSCRIPTION_PLANS={'starter': {}},
               price_tiers_for_region=lambda *args: {'1': 100, '2': 200, '3': 250, '5': 400},
               business_pricing_region=lambda b: 'PH', business_currency=lambda b: 'PHP',
               business_has_plan_feature=lambda *args: False,
               PAYMONGO_SECRET_KEY='', paymongo_card_configured=lambda: False)
    nodes = []
    for node in TREE.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {'BILLING_CYCLE_CONFIG', 'ANNUAL_BILLABLE_MONTHS'} for t in node.targets):
            nodes.append(node)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in NAMES:
            node.decorator_list = []
            nodes.append(node)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env

class BillingBranchTests(unittest.TestCase):
    def setUp(self):
        self.env = namespace()
        self.business = {'id': 1, 'plan': 'starter', 'billing_branch_count': 3}
        self.env['safe_get_business'] = lambda _: self.business
        self.db = MagicMock()
        self.db.table.return_value.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(count=1, data=[])
        self.env['supabase'] = self.db

    def test_override_prices_all_cycles_and_extra_branches(self):
        price = self.env['get_price_for_business']
        for cycle, multiplier in [('monthly', 1), ('3_months', 3), ('6_months', 6), ('annual', 10)]:
            self.assertEqual(price(self.business, cycle, 1), 250 * multiplier)
        self.business['billing_branch_count'] = 6
        self.assertEqual(price(self.business, 'monthly', 1), 500)

    def test_automatic_fallback_and_custom_price(self):
        self.business['billing_branch_count'] = None
        price = self.env['get_price_for_business']
        self.assertEqual(price(self.business, 'monthly', 2), 200)
        self.assertEqual(price(self.business, 'monthly', 0), 100)
        self.business.update(billing_branch_count=6, custom_monthly_price=777)
        self.assertEqual(price(self.business, 'annual', 1), 7770)

    def test_validation(self):
        model = self.env['AdminBusinessUpdate']
        for invalid in [0, -1, 10001, 1.5, True, '3']:
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                model(billing_branch_count=invalid)
        for valid in [1, 10000]:
            self.assertEqual(model(billing_branch_count=valid).billing_branch_count, valid)

    def patch(self, **data):
        return asyncio.run(self.env['admin_update_business']('biz', self.env['AdminBusinessUpdate'](**data), True))

    def test_save_and_reset_only_update_business(self):
        self.patch(billing_branch_count=4)
        payload = self.db.table.return_value.update.call_args.args[0]
        self.assertEqual(payload['billing_branch_count'], 4)
        self.assertEqual(set(payload), {'billing_branch_count', 'updated_at'})
        self.patch(clear_billing_branch_count=True)
        self.assertIsNone(self.db.table.return_value.update.call_args.args[0]['billing_branch_count'])
        self.assertTrue(all(call.args == ('businesses',) for call in self.db.table.call_args_list))

    def test_conflicting_and_special_updates_rejected(self):
        with self.assertRaises(HTTPException):
            self.patch(billing_branch_count=2, clear_billing_branch_count=True)
        self.business['billing_mode'] = 'special'
        with self.assertRaises(HTTPException):
            self.patch(billing_branch_count=2)
        self.db.table.assert_not_called()

    def test_owner_billing_shows_adjusted_count_and_price(self):
        result = asyncio.run(self.env['get_subscription_status']('biz'))
        self.assertEqual(result['branch_count'], 3)
        self.assertEqual(result['configured_branch_count'], 1)
        self.assertEqual(result['pricing']['monthly'], 250)
        self.assertEqual(result['pricing']['annual'], 2500)

    def test_checkout_uses_override_and_preserves_physical_kit_quantity(self):
        checkout = MagicMock(return_value={'intent_id': 'test-payment'})
        self.env.update(self_serve_billing_cycle=lambda *args: '3_months',
                        fx_to_php=lambda amount, currency: (amount, 1),
                        billing_cycle_label=lambda _: '3 Months',
                        SETUP_KIT_PRICE_PER_BRANCH=150, SUBSCRIPTION_QR_EXPIRES_SECONDS=900,
                        create_qrph_checkout=checkout, generate_public_id=lambda: 'payment')
        self.business['setup_kit_requested'] = True
        result = asyncio.run(self.env['create_subscription_checkout']('biz'))
        self.assertEqual(result['subscription_amount'], 750)
        self.assertEqual(result['amount'], 900)  # one physical kit + three operating branches
        self.assertEqual(checkout.call_args.kwargs['metadata']['setup_kit_branch_count'], '1')
        payment = self.db.table.return_value.insert.call_args.args[0]
        self.assertEqual(payment['branch_count'], 3)
        self.assertEqual(payment['amount'], 900)

    def test_admin_authorization_dependency_remains(self):
        route = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'admin_update_business')
        self.assertIn('Depends(require_admin)', ast.unparse(route.args))

if __name__ == '__main__':
    unittest.main()

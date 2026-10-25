"""Coming-soon cannot expose an LT Wallet action through a native build hook."""
import ast
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from backend.lt_benefits import public_launch_enabled
from backend import lt_benefits_wallet as wallet


class LaunchWalletGateTests(unittest.TestCase):
    def test_native_wallet_requires_both_explicit_feature_and_public_launch(self):
        path=Path(__file__).resolve().parents[1]/'main.py'
        names={'lt_benefits_feature_enabled','lt_benefits_enabled','lt_benefits_wallet_action'}
        nodes=[n for n in ast.parse(path.read_text()).body if isinstance(n,ast.FunctionDef) and n.name in names]
        env=dict(os=os,lt_wallet=wallet,lt_benefits_public_launch_enabled=public_launch_enabled,
                 FRONTEND_URL='https://frontend.example.invalid',_order_ahead_signing_secret=lambda:'synthetic-signing-secret')
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),env)
        customer=dict(public_id='synthetic-card',lt_benefits_card_enabled=True)
        business=dict(public_id='synthetic-cafe')
        for feature,launch in [('true',''),('true','false'),('false','true')]:
            with self.subTest(feature=feature,launch=launch),patch.dict(os.environ,{
                'LT_BENEFITS_ENABLED':feature,'LT_BENEFITS_PUBLIC_LAUNCH':launch}):
                self.assertFalse(env['lt_benefits_enabled']())
                self.assertIsNone(env['lt_benefits_wallet_action'](customer,business))
        with patch.dict(os.environ,{'LT_BENEFITS_ENABLED':'true','LT_BENEFITS_PUBLIC_LAUNCH':'true'}):
            self.assertTrue(env['lt_benefits_enabled']())
            self.assertIsNotNone(env['lt_benefits_wallet_action'](customer,business))

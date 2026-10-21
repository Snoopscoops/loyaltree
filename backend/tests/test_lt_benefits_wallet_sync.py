"""Real class refresh/sync regressions without credentials, app startup or providers."""
import ast
import asyncio
from copy import deepcopy
import os
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from backend import lt_benefits_wallet as wallet


SOURCE = Path(os.environ.get('LT_WALLET_MAIN_SOURCE', Path(__file__).resolve().parents[1] / 'main.py'))
if not SOURCE.is_file():
    SOURCE = Path('/Users/user24/Desktop/loyaltree/backend/main.py')
NAMES = {'republish_wallet_class_and_refresh', 'sync_wallet_object', '_wallet_provider_sync_failed'}
NODES = [node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES]
if {node.name for node in NODES} != NAMES:
    raise AssertionError('Production Wallet refresh/sync helpers missing')
for node in NODES:
    node.decorator_list = []
CODE = compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec')
BUSINESS = {'id': 10, 'public_id': 'synthetic-cafe', 'name': 'Updated Cafe'}
CUSTOMER = {'id': 20, 'public_id': 'synthetic-card', 'lt_benefits_card_enabled': True,
            'stamp_count': 4, 'points_balance': 150}
SUFFIX = wallet.GOOGLE_CLASS_SUFFIX


class Client:
    def __init__(self, current_class='issuer.legacy', move_status=500, patch_status=200):
        self.current_class, self.move_status, self.patch_status = current_class, move_status, patch_status
        self.calls = []
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def response(self, code, body=None):
        return SimpleNamespace(status_code=code, text='Synthetic provider response', json=lambda: deepcopy(body or {}))
    def get(self, url, **kwargs):
        self.calls.append(('get', url, kwargs, threading.get_ident()))
        return self.response(200, {'classId': self.current_class, 'messages': []})
    def put(self, url, **kwargs):
        self.calls.append(('put', url, kwargs, threading.get_ident()))
        return self.response(200 if '/loyaltyClass/' in url else self.move_status)
    def patch(self, url, **kwargs):
        self.calls.append(('patch', url, kwargs, threading.get_ident()))
        return self.response(self.patch_status)


def fixture(*, enabled=True, current_class='issuer.legacy', desired_class=None, move_status=500):
    client = Client(current_class=current_class, move_status=move_status)
    desired_class = desired_class or 'issuer.legacy' + SUFFIX
    state, prepared, upserts = [enabled], [], []
    desired = {'id': 'issuer.synthetic-card', 'classId': desired_class, 'accountName': 'Synthetic Member',
               'loyaltyPoints': {'label': 'STORE POINTS', 'balance': {'int': 150}},
               'textModulesData': [{'id': 'lt_points', 'header': 'LT POINTS', 'body': '7'}],
               'linksModuleData': {'uris': []}, 'state': 'active'}
    def build_class(business, program, **kwargs):
        return {'id': kwargs['class_id_override'], 'issuerName': business['name'],
                'hexBackgroundColor': kwargs.get('background_color_override'),
                'programName': program.get('program_name'), 'tier': kwargs.get('vip_tier_name')}
    def upsert(request_client, payload, token):
        assert request_client is client
        assert token == 'synthetic-provider-token'
        upserts.append((deepcopy(payload), threading.get_ident()))
        return client.response(200), {'id': payload['id']}
    env = dict(asyncio=asyncio, lt_wallet=wallet, lt_benefits_enabled=lambda: state[0],
        GOOGLE_WALLET_ISSUER_ID='issuer', get_google_access_token=lambda: 'synthetic-provider-token',
        program_has_tier=lambda p: p.get('card_type') in ('vip', 'hybrid'),
        normalize_vip_tiers=lambda p: p.get('vip_tiers') or [],
        google_wallet_tier_class_id=lambda b, p, t: f"issuer.legacy-{p['card_type']}-{t['id']}",
        get_vip_tier=lambda *a: {'id': 'member', 'name': 'Member'},
        build_loyalty_class=build_class, pooled_client=lambda **kw: client,
        upsert_loyalty_class=upsert,
        refresh_existing_member_wallets=AsyncMock(),
        ensure_google_wallet_tier_class=lambda *a: prepared.append(True) or True,
        build_loyalty_object=lambda *a: deepcopy(desired),
        _google_wallet_preserved_messages=lambda messages: deepcopy(messages),
        send_wallet_object_message=lambda *a: True, print=lambda *a: None)
    exec(CODE, env)
    return SimpleNamespace(env=env, client=client, state=state, prepared=prepared, upserts=upserts, desired=desired)


class BenefitsWalletSyncTests(unittest.TestCase):
    def test_automatic_design_refresh_updates_every_legacy_and_lt_sibling_class(self):
        main_thread = threading.get_ident()
        for card_type in ('stamp', 'vip', 'hybrid'):
            for enabled in (False, True):
                with self.subTest(card_type=card_type, feature_enabled=enabled):
                    harness = fixture(enabled=enabled)
                    program = {'card_type': card_type, 'google_wallet_class_id': 'issuer.legacy',
                               'program_name': 'Updated Rewards', 'vip_tiers': [
                                   {'id': 'silver', 'name': 'Silver', 'color': '#c0c0c0'},
                                   {'id': 'gold', 'name': 'Gold', 'color': '#b09030'}]}
                    asyncio.run(harness.env['republish_wallet_class_and_refresh'](BUSINESS, program))
                    legacy = [call for call in harness.client.calls if call[0] == 'put']
                    expected = ['issuer.legacy'] if card_type == 'stamp' else [f'issuer.legacy-{card_type}-silver', f'issuer.legacy-{card_type}-gold']
                    self.assertEqual([call[2]['json']['id'] for call in legacy], expected)
                    self.assertEqual([payload['id'] for payload, _ in harness.upserts], [value + SUFFIX for value in expected] if enabled else [])
                    for call in legacy:
                        self.assertEqual(call[2]['json']['issuerName'], 'Updated Cafe')
                        self.assertEqual(call[2]['json']['programName'], 'Updated Rewards')
                        self.assertNotEqual(call[3], main_thread)
                    for payload, worker_thread in harness.upserts:
                        counterpart = next(call[2]['json'] for call in legacy if call[2]['json']['id'] + SUFFIX == payload['id'])
                        self.assertEqual({key: value for key, value in payload.items() if key != 'id'},
                                         {key: value for key, value in counterpart.items() if key != 'id'})
                        self.assertNotEqual(worker_thread, main_thread)
                    harness.env['refresh_existing_member_wallets'].assert_awaited_once_with(BUSINESS, program)

    def test_failed_lt_class_move_keeps_member_update_and_remains_retryable(self):
        harness = fixture()
        result = harness.env['sync_wallet_object'](CUSTOMER, BUSINESS, {'card_type': 'stamp'})
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['stage'], 'class_move')
        self.assertTrue(result['retryable'])
        self.assertTrue(result['member_updated'])
        self.assertEqual(result['http_status'], 500)
        self.assertEqual(result['member_http_status'], 200)
        self.assertTrue(harness.env['_wallet_provider_sync_failed'](result, 'google'))
        patch = next(call[2]['json'] for call in harness.client.calls if call[0] == 'patch')
        self.assertEqual(patch['loyaltyPoints']['balance']['int'], 150)
        self.assertEqual(patch['textModulesData'], harness.desired['textModulesData'])
        self.assertNotIn('classId', patch)
        self.assertEqual(len(harness.prepared), 1)

    def test_retry_can_finish_pending_lt_class_move_without_replacing_object_identity(self):
        harness = fixture()
        first = harness.env['sync_wallet_object'](CUSTOMER, BUSINESS, {'card_type': 'stamp'})
        self.assertTrue(harness.env['_wallet_provider_sync_failed'](first, 'google'))
        harness.client.move_status = 200
        result = harness.env['sync_wallet_object'](CUSTOMER, BUSINESS, {'card_type': 'stamp'})
        self.assertEqual(result['status'], 'updated')
        self.assertFalse(harness.env['_wallet_provider_sync_failed'](result, 'google'))
        moves = [call for call in harness.client.calls if call[0] == 'put']
        self.assertEqual(len(moves), 2)
        self.assertTrue(all(call[2]['json']['id'] == 'issuer.synthetic-card' for call in moves))
        self.assertTrue(all(call[2]['json']['classId'] == 'issuer.legacy' + SUFFIX for call in moves))

    def test_leaving_lt_class_also_retries_after_a_failed_move(self):
        harness = fixture(enabled=False, current_class='issuer.legacy' + SUFFIX, desired_class='issuer.legacy')
        result = harness.env['sync_wallet_object'](CUSTOMER, BUSINESS, {'card_type': 'stamp'})
        self.assertEqual(result['status'], 'error')
        self.assertTrue(result['member_updated'])
        self.assertTrue(result['retryable'])

    def test_legacy_tier_fallback_keeps_existing_success_behavior(self):
        harness = fixture(enabled=False, current_class='issuer.legacy-vip-silver', desired_class='issuer.legacy-vip-gold')
        result = harness.env['sync_wallet_object'](CUSTOMER, BUSINESS, {'card_type': 'vip'})
        self.assertEqual(result['status'], 'updated')
        self.assertEqual(result['stage'], 'fallback_patch')
        self.assertFalse(harness.env['_wallet_provider_sync_failed'](result, 'google'))
        self.assertNotIn('retryable', result)

    def test_class_preparation_failure_does_not_submit_a_migration_or_incomplete_member_update(self):
        harness = fixture()
        harness.env['ensure_google_wallet_tier_class'] = lambda *a: False
        result = harness.env['sync_wallet_object'](CUSTOMER, BUSINESS, {'card_type': 'stamp'})
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['stage'], 'class')
        self.assertEqual([call[0] for call in harness.client.calls], ['get'])


if __name__ == '__main__':
    unittest.main()

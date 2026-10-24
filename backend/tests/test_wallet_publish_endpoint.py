"""Wallet publish endpoint regressions without app initialization or providers.

Extract the production endpoint and its stable-ID helpers through AST so the
tests cannot initialize Supabase, credentials, or Google Wallet integrations.
"""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import re
import sys
import threading
from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch
import unittest

from fastapi import HTTPException, Query, Header
import httpx


LOCAL_SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
SOURCE = (LOCAL_SOURCE if LOCAL_SOURCE.is_file()
          else Path('/Users/user24/Desktop/loyaltree/backend/main.py'))
BUSINESS = {'id': 42, 'public_id': 'test-cafe', 'name': 'Test Cafe'}
PROGRAM = {'id': 7, 'public_id': 'coffee-card', 'is_default': True,
           'card_type': 'stamp', 'google_wallet_class_id': 'issuer.legacy-card'}
FUNCTION_NAMES = {
    '_google_wallet_base_class_id', '_google_wallet_safe_fragment',
    'google_wallet_vip_class_id', 'google_wallet_hybrid_tier_class_id',
    'google_wallet_tier_class_id', 'create_or_update_wallet_class',
}
SOURCE_FUNCTIONS = [node for node in ast.parse(SOURCE.read_text()).body
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and node.name in FUNCTION_NAMES]


class FakeDB:
    def __init__(self, events):
        self.events = events
        self.writes = []
        self.failure = None

    def table(self, name):
        db = self

        class Mutation:
            def __init__(self):
                self.action = None
                self.payload = None
                self.filters = {}

            def update(self, payload):
                self.action, self.payload = 'update', dict(payload)
                return self

            def insert(self, payload):
                self.action, self.payload = 'insert', dict(payload)
                return self

            def eq(self, key, value):
                self.filters[key] = value
                return self

            def execute(self):
                db.events.append(('db', name))
                if db.failure:
                    raise db.failure
                db.writes.append((name, self.action, self.payload, self.filters))
                return SimpleNamespace(data=[self.payload])

        return Mutation()


def endpoint_namespace(program, outcomes, events):
    nodes = deepcopy(SOURCE_FUNCTIONS)
    if {node.name for node in nodes} != FUNCTION_NAMES:
        raise AssertionError('Production wallet endpoint or ID helpers missing')
    for node in nodes:
        node.decorator_list = []

    db = FakeDB(events)
    worker_ids = {'token': [], 'publish': []}
    tasks = []
    client = SimpleNamespace(name='fake-no-network-client')
    context = MagicMock()
    context.__enter__.return_value = client
    response_iter = iter(outcomes)

    def token():
        worker_ids['token'].append(threading.get_ident())
        return 'fake-token'

    def upsert(request_client, payload, access_token):
        worker_ids['publish'].append(threading.get_ident())
        if request_client is not client or access_token != 'fake-token':
            raise AssertionError('Unexpected HTTP client or token')
        events.append(('upsert', payload['id']))
        outcome = next(response_iter)
        if isinstance(outcome, BaseException):
            raise outcome
        result = {'id': payload['id']} if outcome in (200, 201) else {
            'error': {'message': 'simulated rejected class'}}
        return SimpleNamespace(status_code=outcome), result

    async def refresh(*args, **kwargs):
        events.append(('refresh', kwargs.get('refresh_apple')))

    def schedule(coroutine):
        task = asyncio.create_task(coroutine)
        tasks.append(task)
        return task

    def build_class(business, card_program, **kwargs):
        return {'id': kwargs['class_id_override'],
                'issuerName': business['name'],
                'programName': 'Test Rewards',
                'reviewStatus': kwargs['review_status']}

    upsert_mock = MagicMock(side_effect=upsert)
    def scoped_owner(public_id, authorization):
        # Publish tests start after owner verification; actual auth failures are
        # exercised through HTTP in the access-control suite.
        if public_id != BUSINESS['public_id'] or authorization != 'Bearer fixture-owner':
            raise HTTPException(401, 'Synthetic owner session required')
        return {'role': 'owner', 'business_slug': public_id}
    env = dict(
        Optional=Optional, Query=Query, Header=Header, HTTPException=HTTPException,
        require_owner_session=MagicMock(side_effect=scoped_owner),
        asyncio=SimpleNamespace(to_thread=asyncio.to_thread, create_task=schedule),
        httpx=httpx, datetime=datetime, re=re,
        GOOGLE_WALLET_ISSUER_ID='issuer',
        safe_get_business=MagicMock(return_value=dict(BUSINESS)),
        safe_get_loyalty_program=MagicMock(return_value=dict(program)),
        business_has_plan_feature=lambda *args: True,
        get_google_access_token=MagicMock(side_effect=token),
        upsert_loyalty_class=upsert_mock,
        program_has_tier=lambda value: value.get('card_type') in ('vip', 'hybrid'),
        hybrid_tier_enabled=lambda value: value.get('card_type') == 'hybrid',
        normalize_vip_tiers=lambda value: list(value.get('vip_tiers', [])),
        get_vip_tier=lambda customer, value: {'id': 'fallback', 'name': 'Member'},
        build_loyalty_class=MagicMock(side_effect=build_class),
        pooled_client=MagicMock(return_value=context),
        supabase=db, generate_public_id=lambda: 'new-program',
        refresh_existing_member_wallets=AsyncMock(side_effect=refresh),
        print=lambda *args: None,
        log_event=MagicMock(), lt_benefits_enabled=lambda: False,
    )
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    return SimpleNamespace(env=env, db=db, threads=worker_ids, tasks=tasks,
                           helper=upsert_mock, client=client)


class WalletPublishEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def invoke(self, harness):
        # Support a function-local import as well as the module-level import.
        fake_module = SimpleNamespace(upsert_loyalty_class=harness.helper)
        with (patch.dict(sys.modules, {'wallet_class_publish': fake_module}),
              patch('traceback.print_exc')):
            result = await harness.env['create_or_update_wallet_class'](
                BUSINESS['public_id'], program_id=(
                    harness.env['safe_get_loyalty_program'].return_value.get('public_id')),
                authorization='Bearer fixture-owner')
            if harness.tasks:
                await asyncio.gather(*harness.tasks)
            return result

    def assert_no_local_publication(self, harness):
        self.assertEqual(harness.db.writes, [])
        self.assertEqual(harness.tasks, [])
        harness.env['refresh_existing_member_wallets'].assert_not_called()

    async def test_success_preserves_existing_id_then_persists_and_refreshes_once(self):
        events = []
        harness = endpoint_namespace(PROGRAM, [200], events)
        main_thread = threading.get_ident()
        result = await self.invoke(harness)
        self.assertTrue(result['success'])
        harness.env['log_event'].assert_called_once_with('wallet_publish_success',
            business_slug=BUSINESS['public_id'], program_id=PROGRAM['public_id'], class_count=1)
        self.assertEqual(result['class_id'], 'issuer.legacy-card')
        self.assertEqual(result['tier_class_ids'], [])
        self.assertEqual(events, [('upsert', 'issuer.legacy-card'),
                                  ('db', 'loyalty_programs'), ('refresh', False)])
        self.assertEqual(harness.db.writes, [(
            'loyalty_programs', 'update',
            {'google_wallet_class_id': 'issuer.legacy-card'}, {'id': 7})])
        self.assertEqual(len(harness.tasks), 1)
        harness.env['refresh_existing_member_wallets'].assert_called_once_with(
            BUSINESS, PROGRAM, refresh_apple=False)
        self.assertTrue(harness.threads['token'])
        self.assertTrue(harness.threads['publish'])
        self.assertNotIn(main_thread, harness.threads['token'])
        self.assertNotIn(main_thread, harness.threads['publish'])

    async def test_all_tier_classes_complete_before_metadata_and_member_refresh(self):
        events = []
        program = dict(PROGRAM, card_type='vip', vip_tiers=[
            {'id': 'silver', 'name': 'Silver'}, {'id': 'gold', 'name': 'Gold'}])
        harness = endpoint_namespace(program, [200, 201], events)
        result = await self.invoke(harness)
        tier_ids = ['issuer.legacy-card-vip-silver', 'issuer.legacy-card-vip-gold']
        self.assertEqual(result['tier_class_ids'], tier_ids)
        self.assertEqual(result['vip_tier_class_ids'], tier_ids)
        self.assertEqual(result['class_id'], 'issuer.legacy-card')
        self.assertEqual(events, [('upsert', tier_ids[0]), ('upsert', tier_ids[1]),
                                  ('db', 'loyalty_programs'), ('refresh', False)])
        self.assertEqual(len(harness.db.writes), 1)
        self.assertEqual(len(harness.tasks), 1)

    async def test_partial_tier_failure_does_not_persist_or_refresh(self):
        events = []
        program = dict(PROGRAM, card_type='vip', vip_tiers=[
            {'id': 'silver', 'name': 'Silver'}, {'id': 'gold', 'name': 'Gold'}])
        harness = endpoint_namespace(program, [200, 400], events)
        with self.assertRaises(HTTPException) as raised:
            await self.invoke(harness)
        self.assertGreaterEqual(raised.exception.status_code, 400)
        self.assertIn('simulated rejected class', str(raised.exception.detail))
        self.assertEqual(len(events), 2)
        self.assert_no_local_publication(harness)

    async def test_empty_read_timeout_is_clear_gateway_timeout(self):
        harness = endpoint_namespace(PROGRAM, [httpx.ReadTimeout('')], [])
        with self.assertRaises(HTTPException) as raised:
            await self.invoke(harness)
        error = raised.exception
        self.assertEqual(error.status_code, 504)
        self.assertTrue(str(error.detail).strip())
        self.assertIn('google', str(error.detail).lower())
        self.assertEqual(error.headers.get('Retry-After'), '10')
        self.assert_no_local_publication(harness)

    async def test_other_transport_error_is_clear_service_unavailable(self):
        harness = endpoint_namespace(PROGRAM, [httpx.ConnectError('')], [])
        with self.assertRaises(HTTPException) as raised:
            await self.invoke(harness)
        error = raised.exception
        self.assertEqual(error.status_code, 503)
        self.assertTrue(str(error.detail).strip())
        self.assertIn('google', str(error.detail).lower())
        self.assert_no_local_publication(harness)

    async def test_token_failure_does_not_publish_or_modify_database(self):
        harness = endpoint_namespace(PROGRAM, [], [])
        harness.env['get_google_access_token'].side_effect = lambda: ''
        with self.assertRaises(HTTPException) as raised:
            await self.invoke(harness)
        self.assertEqual(raised.exception.status_code, 500)
        harness.helper.assert_not_called()
        self.assert_no_local_publication(harness)

    async def test_database_timeout_is_not_reported_as_google_wallet_timeout(self):
        harness = endpoint_namespace(PROGRAM, [200], [])
        harness.db.failure = httpx.ReadTimeout('simulated database save timeout')
        with self.assertRaises(HTTPException) as raised:
            await self.invoke(harness)
        self.assertEqual(raised.exception.status_code, 500)
        self.assertNotIn('google', str(raised.exception.detail).lower())
        self.assertEqual(harness.tasks, [])
        harness.env['refresh_existing_member_wallets'].assert_not_called()

    async def test_new_default_program_is_created_only_after_wallet_success(self):
        events = []
        harness = endpoint_namespace({}, [201], events)
        result = await self.invoke(harness)
        self.assertEqual(result['class_id'], 'issuer.test-cafe')
        self.assertEqual(events, [('upsert', 'issuer.test-cafe'),
                                  ('db', 'loyalty_programs'), ('refresh', False)])
        name, action, payload, filters = harness.db.writes[0]
        self.assertEqual((name, action), ('loyalty_programs', 'insert'))
        self.assertEqual(payload['google_wallet_class_id'], 'issuer.test-cafe')
        self.assertEqual(payload['business_id'], BUSINESS['id'])
        self.assertTrue(payload['is_default'])


if __name__ == '__main__':
    unittest.main()

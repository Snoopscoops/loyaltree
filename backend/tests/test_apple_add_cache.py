"""Apple add/prewarm races, freshness and latency without DB/provider writes."""
import ast
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import threading
import time
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Query
from fastapi.responses import Response
from backend import wallet_memory as memory
from backend import lt_benefits_wallet

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
NAMES = {'_apple_pkpass_fingerprint', '_get_cached_apple_pkpass', '_cache_apple_pkpass',
         '_build_and_cache_apple_pkpass', '_get_or_build_apple_pkpass', '_prewarm_apple_pkpass',
         'get_apple_wallet_pass', '_prepare_apple_pkpass'}
NODES = [node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES]
# Keep the real synchronization decorator; only remove FastAPI route registration.
for node in NODES:
    if isinstance(node, ast.AsyncFunctionDef): node.decorator_list = []
CODE = compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec')


def fixture():
    customer = {'public_id': 'synthetic-member', 'business_id': 1, 'stamp_count': 1}
    business = {'public_id': 'synthetic-cafe', 'id': 1, 'order_ahead_enabled': True}
    program = {'card_type': 'stamp', 'updated_at': '2026-10-20T00:00:00'}
    clock, revision, builds = [0], [None], []
    cache = memory.BoundedTTLCache('apple_add_test', max_bytes=4096, max_items=8, ttl=3600, clock=lambda: clock[0])
    def build(*args):
        builds.append(args)
        return f'signed-fixture-{len(builds)}'.encode()
    env = dict(Optional=Optional, hashlib=hashlib, json=json, time=time, asyncio=asyncio,
               apple_builds=SimpleNamespace(run=asyncio.to_thread),
               lt_wallet=lt_benefits_wallet, lt_benefits_enabled=lambda: False,
               Query=Query, HTTPException=HTTPException, Response=Response, wallet_work=memory.wallet_work,
               _APPLE_PKPASS_CACHE=cache, _APPLE_PKPASS_CACHE_TTL_SECONDS=3600,
               _apple_pass_dirty_at=lambda serial: revision[0], APPLE_PASS_REGISTRATION_RELEASE='fixture',
               APPLE_PASS_WEB_SERVICE_URL='https://example.invalid', APPLE_PASS_TYPE_IDENTIFIER='pass.fixture',
               APPLE_PASS_AUTH_SECRET='fixture', APPLE_TEAM_IDENTIFIER='FIXTURE',
               build_pkpass_bytes=build, get_latest_active_announcement_for_customer=lambda *args: None,
               safe_get_customer=lambda *args: customer, safe_get_business_by_id=lambda *args: business,
               safe_get_customer_program=lambda *args: program, print=lambda *args: None)
    exec(CODE, env)
    return env, customer, business, program, revision, clock, builds


class AppleAddCacheTests(unittest.TestCase):
    def setUp(self):
        self.emission = patch.object(memory, '_emit').start()
        self.addCleanup(patch.stopall)
        self.env, self.customer, self.business, self.program, self.revision, self.clock, self.builds = fixture()

    def get(self, **changes):
        return self.env['_get_or_build_apple_pkpass'](
            changes.get('customer', self.customer), changes.get('business', self.business),
            changes.get('program', self.program), changes.get('announcement'))

    def test_signup_prewarm_and_five_concurrent_adds_render_sign_only_once(self):
        release, all_missed = threading.Event(), threading.Event()
        seen, guard = set(), threading.Lock()
        original_get = self.env['_get_cached_apple_pkpass']
        original_build = self.env['build_pkpass_bytes']
        def get_cached(*args):
            value = original_get(*args)
            if value is None:
                with guard:
                    seen.add(threading.get_ident())
                    if len(seen) == 6: all_missed.set()
            return value
        def slow_build(*args):
            if not release.wait(3): raise TimeoutError('Test did not release first render')
            return original_build(*args)
        self.env['_get_cached_apple_pkpass'] = get_cached
        self.env['build_pkpass_bytes'] = slow_build
        with ThreadPoolExecutor(max_workers=6) as pool:
            prewarm = pool.submit(self.env['_prewarm_apple_pkpass'], self.customer, self.business, self.program)
            adds = [pool.submit(self.get) for _ in range(5)]
            try:
                self.assertTrue(all_missed.wait(2), 'All duplicate requests must observe the cold cache')
            finally: release.set()
            prewarm.result(2)
            results = [task.result(2) for task in adds]
        self.assertEqual(len(self.builds), 1)
        # Either prewarm or a real tap may acquire the render lock first.
        self.assertTrue(all(data == b'signed-fixture-1' for data, _ in results))
        self.assertLessEqual(sum(not cache_hit for _, cache_hit in results), 1)

    def test_order_ahead_signup_warms_store_card_and_following_add_is_cache_hit(self):
        self.env['_get_or_build_apple_event_pkpass'] = lambda *args: self.fail('Legacy event renderer must not run')
        self.env['_prewarm_apple_pkpass'](self.customer, self.business, self.program)
        self.assertEqual(self.get(), (b'signed-fixture-1', True))
        self.assertEqual(len(self.builds), 1)

    def test_valid_cached_pass_does_not_wait_for_an_unrelated_render(self):
        self.get()
        acquired, release = threading.Event(), threading.Event()
        def unrelated_render():
            with memory.RENDER_LOCK:
                acquired.set(); release.wait(3)
        with ThreadPoolExecutor(max_workers=2) as pool:
            busy = pool.submit(unrelated_render)
            try:
                self.assertTrue(acquired.wait(1))
                self.assertEqual(pool.submit(self.get).result(.5), (b'signed-fixture-1', True))
            finally: release.set()
            busy.result(1)

    def test_stamps_design_announcement_and_push_revision_invalidate_cached_pass(self):
        self.get()
        customer = {**self.customer, 'stamp_count': 2}
        self.assertFalse(self.get(customer=customer)[1])
        self.assertTrue(self.get(customer=customer)[1])
        program = {**self.program, 'updated_at': '2026-10-20T00:01:00'}
        self.assertFalse(self.get(customer=customer, program=program)[1])
        announcement = {'id': 7, 'updated_at': '2026-10-20T00:02:00'}
        self.assertFalse(self.get(customer=customer, program=program, announcement=announcement)[1])
        self.revision[0] = '2026-10-20T00:03:00'
        self.assertFalse(self.get(customer=customer, program=program, announcement=announcement)[1])
        self.assertTrue(self.get(customer=customer, program=program, announcement=announcement)[1])
        self.assertEqual(len(self.builds), 5)

    def test_cache_expiry_and_failed_build_allow_fresh_retry(self):
        self.get()
        self.clock[0] = 3601
        self.assertEqual(self.get(), (b'signed-fixture-2', False))
        self.env['_APPLE_PKPASS_CACHE'].clear()
        original = self.env['build_pkpass_bytes']
        self.env['build_pkpass_bytes'] = lambda *args: None
        self.assertEqual(self.get(), (None, False))
        self.assertEqual(len(self.env['_APPLE_PKPASS_CACHE']), 0)
        self.env['build_pkpass_bytes'] = original
        self.assertEqual(self.get(), (b'signed-fixture-3', False))

    def test_hour_cache_and_only_edited_cards_content_is_invalidated(self):
        other = {**self.customer, 'public_id': 'other-member'}
        first = self.get()[0]
        second = self.get(customer=other)[0]
        self.clock[0] = 3599
        self.assertEqual(self.get(), (first, True))
        self.assertEqual(self.get(customer=other), (second, True))
        self.assertFalse(self.get(customer={**self.customer, 'name': 'Changed name'})[1])
        self.assertEqual(self.get(customer=other), (second, True))
        self.assertFalse(self.get(customer={**self.customer, 'lt_coupon_count': 1})[1])

    def test_passkit_update_uses_the_same_finished_pass_cache_as_add(self):
        route = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'apple_get_updated_pass')
        calls = [n for n in ast.walk(route) if isinstance(n, ast.Call)]
        self.assertTrue(any(isinstance(c.func, ast.Name) and c.func.id == '_prepare_apple_pkpass' for c in calls))
        self.assertFalse(any(isinstance(a, ast.Name) and a.id == 'build_pkpass_bytes' for c in calls for a in c.args))

    def test_prewarm_failures_do_not_escape_or_poison_following_add(self):
        original = self.env['build_pkpass_bytes']
        def failed(*args): raise RuntimeError('Synthetic signing failure')
        self.env['build_pkpass_bytes'] = failed
        self.env['_prewarm_apple_pkpass'](self.customer, self.business, self.program)
        self.assertEqual(len(self.env['_APPLE_PKPASS_CACHE']), 0)
        self.env['build_pkpass_bytes'] = original
        self.assertEqual(self.get(), (b'signed-fixture-1', False))


class AppleAddResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_add_moves_cache_checks_off_loop_and_keeps_download_headers_and_bytes(self):
        env, customer, business, program, *_ = fixture()
        loop_thread, called_threads = threading.get_ident(), []
        def prepared(*args):
            called_threads.append(threading.get_ident())
            return b'signed-fixture', True
        env['_get_or_build_apple_pkpass'] = prepared
        response = await env['get_apple_wallet_pass'](customer['public_id'])
        self.assertEqual(response.body, b'signed-fixture')
        self.assertEqual(response.media_type, 'application/vnd.apple.pkpass')
        self.assertEqual(response.headers['content-length'], '14')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['x-loyaltytree-apple-cache'], 'HIT')
        self.assertIn(customer['public_id'], response.headers['content-disposition'])
        self.assertEqual(len(called_threads), 1)
        self.assertNotEqual(called_threads[0], loop_thread)

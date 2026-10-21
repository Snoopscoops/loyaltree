"""Memory regressions use synthetic artwork and fake HTTP, never live passes."""
import ast
import asyncio
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import threading
import time
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image
from fastapi import Response
from backend import wallet_memory as memory


def image_bytes(size=(4000, 3000), mode='RGB', format='JPEG'):
    color = (80, 120, 90, 100) if mode == 'RGBA' else (80, 120, 90)
    with Image.new(mode, size, color) as image, BytesIO() as out:
        image.save(out, format=format)
        return out.getvalue()


class WalletMemoryTests(unittest.TestCase):
    def test_hard_limits_apply_even_when_all_cached_passes_are_fresh(self):
        cache = memory.BoundedTTLCache('test_limits', max_bytes=4096, max_items=3, ttl=90)
        for index in range(100):
            cache[str(index)] = (time.monotonic(), 'fingerprint', b'x' * 1000)
            self.assertLessEqual(cache.stats()['bytes'], 4096)
            self.assertLessEqual(len(cache), 3)
        self.assertIsNone(cache.get('0'))
        self.assertIsNotNone(cache.get('99'))
        cache['oversized'] = b'x' * 5000
        self.assertIsNone(cache.get('oversized'))

    def test_expired_keys_are_released_without_revisiting_their_urls(self):
        clock = [0]
        cache = memory.BoundedTTLCache('test_expiry', max_bytes=4096, max_items=10, ttl=90, clock=lambda: clock[0])
        cache['never-read-again'] = b'x' * 1000
        clock[0] = 91
        cache['new'] = b'new'
        self.assertEqual(list(cache), ['new'])
        self.assertLess(cache.stats()['bytes'], 1000)
        cache['new'] = b'replacement'
        self.assertEqual(cache.pop('new'), b'replacement')
        self.assertEqual(cache.stats()['bytes'], 0)

    def test_jpeg_decodes_to_wallet_dimensions_and_transparent_png_stays_transparent(self):
        with memory.decode_wallet_image(image_bytes()) as image:
            self.assertEqual(image.mode, 'RGBA')
            self.assertLessEqual(image.width, 1200)
            self.assertLessEqual(image.height, 1200)
            self.assertAlmostEqual(image.width / image.height, 4 / 3)
        # A large JPEG remains usable when native draft downsampling makes its
        # decode small enough; reject only after that allocation-saving step.
        with patch.object(memory, 'MAX_IMAGE_PIXELS', 4_000_000):
            with memory.decode_wallet_image(image_bytes()) as image:
                self.assertLessEqual(image.width, 1200)
        with memory.decode_wallet_image(image_bytes((600, 300), 'RGBA', 'PNG')) as image:
            self.assertEqual(image.getpixel((0, 0)), (80, 120, 90, 100))
        with patch.object(memory, 'MAX_IMAGE_PIXELS', 100):
            with self.assertRaises(ValueError): memory.decode_wallet_image(image_bytes((20, 20)))
        with self.assertRaises(ValueError): memory.decode_wallet_image(b'x' * (memory.MAX_IMAGE_BYTES + 1))

    def test_production_remote_art_loader_retains_compressed_bytes_not_native_images(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        names = {'_load_remote_wallet_image', '_hero_to_png'}
        nodes = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in names]
        content = image_bytes()
        response = SimpleNamespace(content=content, raise_for_status=lambda: None)
        calls = []
        class Client:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def get(self, url, **kwargs): calls.append(kwargs); return response
        cache = memory.BoundedTTLCache('test_loader', max_bytes=4 * 1024 * 1024, max_items=24, ttl=900)
        env = dict(Optional=Optional, BytesIO=BytesIO, Image=Image, MAX_IMAGE_BYTES=memory.MAX_IMAGE_BYTES,
                   decode_wallet_image=memory.decode_wallet_image, _STAMP_REMOTE_IMAGE_CACHE=cache,
                   _STAMP_REMOTE_IMAGE_CACHE_MAX=24, pooled_client=lambda **kwargs: Client())
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), env)
        for index in range(3):
            with env['_load_remote_wallet_image'](f'https://example.invalid/{index}') as image:
                self.assertLessEqual(image.width, 1200)
        with env['_load_remote_wallet_image']('https://example.invalid/0') as image:
            self.assertEqual(image.mode, 'RGBA')
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(isinstance(value, bytes) for value in cache.values()))
        self.assertLess(cache.stats()['bytes'], 1024 * 1024)
        self.assertEqual(calls[0]['extensions']['lt_max_response_bytes'], memory.MAX_IMAGE_BYTES)

    def test_renderers_serialize_and_diagnostics_never_expose_input_or_output(self):
        active, peak, events = 0, 0, []
        guard = threading.Lock()
        @memory.wallet_work('test_pass', business_arg=1)
        def build(customer, business):
            nonlocal active, peak
            with guard:
                active += 1; peak = max(peak, active)
            time.sleep(.01)
            with guard: active -= 1
            return b'private signed pass'
        with patch.object(memory, '_emit', side_effect=lambda **fields: events.append(fields)):
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: build({'email': 'private@example.invalid'}, {'public_id': 'test-cafe'}), range(8)))
        self.assertEqual(peak, 1)
        self.assertEqual(results, [b'private signed pass'] * 8)
        self.assertEqual(sum(e['stage'] == 'after' for e in events), 8)
        self.assertNotIn('private', str(events))
        self.assertEqual({e['business_slug'] for e in events}, {'test-cafe'})
        @memory.wallet_work('failed')
        def failed(): raise ValueError('original failure')
        with patch.object(memory, '_emit', side_effect=lambda **fields: events.append(fields)):
            with self.assertRaisesRegex(ValueError, 'original failure'): failed()
        self.assertEqual(events[-1]['outcome'], 'failed')

    def test_current_rss_and_container_limit_are_read_without_customer_data(self):
        usage = memory.memory_usage()
        self.assertGreater(usage['rss_peak_mb'], 0)
        self.assertGreater(usage['pid'], 0)
        self.assertTrue(set(usage) <= {'pid', 'rss_peak_mb', 'rss_mb', 'threads', 'container_memory_mb', 'container_limit_mb', 'python_heap_mb', 'python_heap_peak_mb', 'cpu_total_seconds', 'trace_overhead_mb'})

    def test_measurement_failure_cannot_fail_a_pass_or_replace_its_exception(self):
        @memory.wallet_work('safe_diagnostics')
        def success(): return b'signed pass'
        @memory.wallet_work('safe_diagnostics')
        def failure(): raise ValueError('original operation failure')
        with patch.object(memory, 'memory_usage', side_effect=OSError('private measurement path')), \
             patch.object(memory, 'cache_stats', side_effect=RuntimeError('cache unavailable')), \
             patch.object(memory, '_emit'):
            self.assertEqual(success(), b'signed pass')
            with self.assertRaisesRegex(ValueError, 'original operation failure'): failure()

    def test_actual_store_card_packaging_preserves_pass_json_manifest_and_asset_sizes(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        names = {'_hero_to_png', '_cover_image_to_size', 'apple_icon_from_logo_bytes',
                 'apple_logo_from_image_bytes', 'apple_strip_from_image_bytes', '_resize_png_bytes', 'build_pkpass_bytes'}
        nodes = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in names]
        for node in nodes: node.decorator_list = []
        expected = {'serialNumber': 'synthetic-card', 'storeCard': {'secondaryFields': [{'key': 'stamps', 'value': '3'}]}}
        logo = image_bytes((600, 300), 'RGBA', 'PNG')
        env = dict(Optional=Optional, Image=Image, BytesIO=BytesIO, hashlib=hashlib, json=json, zipfile=zipfile,
                   _lt_cobrand_logo=lambda data: data, lt_wallet=SimpleNamespace(card_enabled=lambda *args,**kwargs:False), lt_benefits_enabled=lambda:False,
                   decode_wallet_image=memory.decode_wallet_image, APPLE_PASS_TYPE_IDENTIFIER='test.pass', APPLE_TEAM_IDENTIFIER='TEST',
                   get_apple_pass_credentials=lambda: True, wallet_20_design=lambda *args: {'background': '#123456', 'show_background': True},
                   program_has_tier=lambda *args: False, _fetch_image_bytes=lambda *args: logo,
                   build_apple_pass_json=lambda *args: json.loads(json.dumps(expected)), _apple_pass_dirty_at=lambda *args: None,
                   wallet_progress_state=lambda *args: None, _strip_bottom_rgb=lambda *args: None,
                   sign_pkpass_manifest=lambda content: hashlib.sha256(content).digest())
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), env)
        data = env['build_pkpass_bytes']({'public_id': 'synthetic-card'}, {'public_id': 'test-cafe'}, {'hero_image_url': 'https://example.invalid/photo'})
        self.assertTrue(data)
        with BytesIO(data) as stream, zipfile.ZipFile(stream) as archive:
            actual = json.loads(archive.read('pass.json'))
            self.assertEqual(actual['storeCard'], expected['storeCard'])
            self.assertEqual(actual['serialNumber'], 'synthetic-card')
            manifest = json.loads(archive.read('manifest.json'))
            for name, digest in manifest.items(): self.assertEqual(hashlib.sha1(archive.read(name)).hexdigest(), digest)
            for name, size in {'icon@3x.png': (87, 87), 'logo@3x.png': (480, 150), 'strip@3x.png': (1125, 369), 'strip.png': (375, 123)}.items():
                with BytesIO(archive.read(name)) as content, Image.open(content) as image:
                    self.assertEqual(image.size, size)


class WalletLogoResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_logo_download_and_render_leave_the_event_loop_available(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        node = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'get_wallet_logo')
        node.decorator_list = []
        loop_thread = threading.get_ident()
        workers = []
        def download(*args, **kwargs):
            workers.append(threading.get_ident())
            return b'synthetic source'
        def render(*args, **kwargs):
            workers.append(threading.get_ident())
            return b'synthetic PNG'
        env = dict(Optional=Optional, asyncio=asyncio, Response=Response,
                   safe_get_business=lambda *args: {'id': 1, 'name': 'Test', 'logo_url': 'https://example.invalid/logo'},
                   _fetch_image_bytes=download, google_wallet_logo_png_bytes=render)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), env)
        result = await env['get_wallet_logo']('test-cafe')
        self.assertEqual(result.body, b'synthetic PNG')
        self.assertEqual(len(workers), 2)
        self.assertTrue(all(worker != loop_thread for worker in workers))

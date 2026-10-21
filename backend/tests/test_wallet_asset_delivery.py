"""Native delivery/cache regressions with synthetic PNGs and fake HTTP only."""
import ast
from io import BytesIO
import hashlib
import json
import os
from pathlib import Path
import time
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock
import zipfile

from PIL import Image, ImageDraw
from backend import lt_benefits_wallet as lt_wallet
from backend import wallet_cloudinary as wallet_artwork
from backend import wallet_memory as memory


SOURCE = Path(os.getenv("LT_WALLET_MAIN", str(Path(__file__).resolve().parents[1] / "main.py")))
NAMES = {'_hex_to_rgb', '_hero_to_png', '_cover_image_to_size', '_fetch_image_bytes',
         '_load_remote_wallet_image', 'apple_icon_from_logo_bytes', 'apple_logo_from_image_bytes',
         'apple_strip_from_image_bytes', '_resize_png_bytes', 'generate_apple_icon_bytes',
         'generate_apple_logo_bytes', '_apple_loyalty_brand_assets', '_apple_static_strip_assets', 'build_pkpass_bytes'}
NODES = [node for node in ast.parse(SOURCE.read_text()).body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
for node in NODES: node.decorator_list = []
CODE = compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec')
LOGO_URL = 'https://res.cloudinary.com/test-account/image/upload/v99/nested/logo.png'
HERO_URL = 'https://res.cloudinary.com/test-account/image/upload/v99/nested/banner.jpg'


def png(size, color=(30, 90, 60, 255), *, logo=False):
    with Image.new('RGBA', size, (0, 0, 0, 0) if logo else color) as image, BytesIO() as buffer:
        if logo:
            ImageDraw.Draw(image).rectangle((size[0] // 6, size[1] // 3, size[0] * 5 // 6, size[1] * 2 // 3), fill=color)
        image.save(buffer, 'PNG')
        return buffer.getvalue()


class FakeResponse:
    def __init__(self, content, status=200): self.content, self.status_code = content, status
    def raise_for_status(self):
        if self.status_code >= 400: raise OSError('private upstream failure')


class FakeClient:
    def __init__(self, calls, replies): self.calls, self.replies = calls, replies
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, Exception): raise reply
        return reply


def fixture(replies=None):
    calls = []
    responses = replies or [FakeResponse(png((480, 240), logo=True))]
    cache = memory.BoundedTTLCache('asset_delivery_test', max_bytes=8 * 1024 * 1024, max_items=64, ttl=900)
    remote = memory.BoundedTTLCache('asset_remote_test', max_bytes=4 * 1024 * 1024, max_items=24, ttl=900)
    env = dict(Optional=Optional, Image=Image, BytesIO=BytesIO, hashlib=hashlib, json=json, time=time,
        zipfile=zipfile, wallet_artwork=wallet_artwork, lt_wallet=lt_wallet, lt_benefits_enabled=lambda: True,
        decode_wallet_image=memory.decode_wallet_image, MAX_IMAGE_BYTES=memory.MAX_IMAGE_BYTES,
        _APPLE_IMAGE_CACHE=cache, _APPLE_IMAGE_CACHE_TTL_SECONDS=900, _STAMP_REMOTE_IMAGE_CACHE=remote,
        pooled_client=lambda **kwargs: FakeClient(calls, responses), log_event=Mock(), print=lambda *args: None,
        _lt_cobrand_logo=lambda data: lt_wallet.co_brand_png(data, png((96, 96), (80, 140, 30, 255))))
    exec(CODE, env)
    return env, calls, cache, remote


def assert_dimensions(test, assets, expected):
    test.assertEqual(set(assets), set(expected))
    for key, size in expected.items():
        test.assertIsInstance(assets[key], bytes)
        with Image.open(BytesIO(assets[key])) as image:
            test.assertEqual(image.size, size, key)


BRAND_SIZES = {'icon.png': (29, 29), 'icon@2x.png': (58, 58), 'icon@3x.png': (87, 87),
               'logo.png': (160, 50), 'logo@2x.png': (320, 100), 'logo@3x.png': (480, 150)}
STRIP_SIZES = {'strip.png': (375, 123), 'strip@2x.png': (750, 246), 'strip@3x.png': (1125, 369)}


class WalletAssetDeliveryTests(unittest.TestCase):
    def test_native_fetch_derives_cloudinary_source_before_caching_and_leaves_external_unchanged(self):
        env, calls, cache, _ = fixture()
        first = env['_fetch_image_bytes'](LOGO_URL)
        self.assertEqual(calls[0][0], wallet_artwork.delivery_url(LOGO_URL, 'apple_logo_source'))
        self.assertIn('c_limit,h_960,w_960/f_png', calls[0][0])
        self.assertIs(first, env['_fetch_image_bytes'](LOGO_URL))
        self.assertEqual(len(calls), 1)
        external = 'https://example.invalid/public-logo.png'
        env['_fetch_image_bytes'](external)
        self.assertEqual(calls[-1][0], external)
        self.assertNotIn(LOGO_URL, cache)
        self.assertEqual(calls[0][1]['extensions']['lt_max_response_bytes'], memory.MAX_IMAGE_BYTES)

    def test_remote_hero_and_progress_sources_use_separate_small_profiles_and_compressed_cache(self):
        env, calls, _, remote = fixture([FakeResponse(png((400, 200)))])
        with env['_load_remote_wallet_image'](HERO_URL) as image:
            self.assertEqual(image.mode, 'RGBA')
        with env['_load_remote_wallet_image'](LOGO_URL, profile='progress_icon_source') as image:
            self.assertEqual(image.size, (400, 200))
        self.assertEqual(calls[0][0], wallet_artwork.delivery_url(HERO_URL, 'google_hero_source'))
        self.assertEqual(calls[1][0], wallet_artwork.delivery_url(LOGO_URL, 'progress_icon_source'))
        with env['_load_remote_wallet_image'](HERO_URL) as image: self.assertEqual(image.size, (400, 200))
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(isinstance(value, bytes) for value in remote.values()))
        self.assertLess(remote.stats()['bytes'], 100000)

    def test_branding_reused_across_members_retains_alpha_and_separates_lt_opt_in(self):
        env, calls, cache, _ = fixture()
        business = {'public_id': 'test-cafe', 'name': 'Test Cafe', 'logo_url': LOGO_URL}
        first = env['_apple_loyalty_brand_assets']({'public_id': 'first'}, business, {}, '#123456')
        second = env['_apple_loyalty_brand_assets']({'public_id': 'second', 'points_balance': 900}, business, {}, '#123456')
        self.assertIs(first, second)
        self.assertEqual(len(calls), 1)
        assert_dimensions(self, first, BRAND_SIZES)
        with Image.open(BytesIO(first['logo@3x.png'])) as logo:
            self.assertEqual(logo.mode, 'RGBA'); self.assertEqual(logo.getpixel((479, 149))[3], 0)
            self.assertGreater(logo.getpixel((0, 75))[3], 0)
        with Image.open(BytesIO(first['icon@3x.png'])) as icon:
            self.assertEqual(icon.mode, 'RGB'); self.assertEqual(icon.getpixel((0, 0)), (255, 255, 255))
        branded = env['_apple_loyalty_brand_assets']({'public_id': 'third', 'lt_benefits_card_enabled': True}, business, {}, '#123456')
        self.assertNotEqual(branded['logo@3x.png'], first['logo@3x.png'])
        self.assertEqual(branded['icon@3x.png'], first['icon@3x.png'])
        self.assertEqual(sum(key.startswith('apple-brand-png-v1:') for key in cache), 2)
        self.assertTrue(all(isinstance(value, bytes) for value in branded.values()))

    def test_brand_cache_separates_new_source_color_and_business_wordmark(self):
        env, _, cache, _ = fixture()
        base = {'name': 'Test Cafe', 'logo_url': LOGO_URL}
        for business, color in ((base, '#123456'), (base, '#654321'),
                                ({**base, 'name': 'Other Cafe'}, '#123456'),
                                ({**base, 'logo_url': LOGO_URL.replace('v99', 'v100')}, '#123456')):
            env['_apple_loyalty_brand_assets']({}, business, {}, color)
        self.assertEqual(sum(key.startswith('apple-brand-png-v1:') for key in cache), 4)

    def test_failed_cdn_generated_branding_is_not_saved_as_successful_shared_brand_cache(self):
        env, _, cache, _ = fixture()
        env['_fetch_image_bytes'] = Mock(return_value=None)
        business = {'name': 'Test Cafe', 'logo_url': LOGO_URL}
        fallback = env['_apple_loyalty_brand_assets']({}, business, {}, '#123456')
        assert_dimensions(self, fallback, BRAND_SIZES)
        self.assertFalse(any(key.startswith('apple-brand-png-v1:') for key in cache))
        env['_fetch_image_bytes'].return_value = png((480, 240), logo=True)
        repaired = env['_apple_loyalty_brand_assets']({}, business, {}, '#123456')
        self.assertNotEqual(repaired['logo@3x.png'], fallback['logo@3x.png'])
        self.assertEqual(sum(key.startswith('apple-brand-png-v1:') for key in cache), 1)

    def test_static_cloudinary_strip_reuses_exact_three_x_bytes_and_all_cached_sizes(self):
        raw = png((1125, 369)); env, calls, cache, _ = fixture([FakeResponse(raw)])
        env['apple_strip_from_image_bytes'] = Mock(side_effect=AssertionError('Exact Cloudinary strip must not rerender'))
        first = env['_apple_static_strip_assets'](HERO_URL)
        assert_dimensions(self, first, STRIP_SIZES)
        self.assertIs(first['strip@3x.png'], raw)
        self.assertIs(env['_apple_static_strip_assets'](HERO_URL), first)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], wallet_artwork.delivery_url(HERO_URL, 'apple_strip_3x'))
        self.assertTrue(any(key.startswith('apple-static-strip-v1:') for key in cache))

    def test_external_static_strip_preserves_existing_crop_path_and_failure_is_retryable(self):
        env, calls, cache, _ = fixture([FakeResponse(png((600, 300)))])
        original = env['apple_strip_from_image_bytes']; render = Mock(side_effect=original)
        env['apple_strip_from_image_bytes'] = render
        external = 'https://example.invalid/banner.png'
        assert_dimensions(self, env['_apple_static_strip_assets'](external), STRIP_SIZES)
        self.assertEqual(calls[0][0], external); self.assertEqual(render.call_count, 1)
        env['_fetch_image_bytes'] = Mock(return_value=None)
        self.assertEqual(env['_apple_static_strip_assets'](HERO_URL), {})
        self.assertNotIn('apple-static-strip-v1:' + hashlib.sha256(HERO_URL.encode()).hexdigest(), cache)
        self.assertEqual(env['_apple_static_strip_assets'](None), {})

    def test_same_size_png_resize_skips_native_decode(self):
        raw = png((87, 87)); env, _, _, _ = fixture()
        env['decode_wallet_image'] = Mock(side_effect=AssertionError('No decode for exact dimensions'))
        self.assertIs(env['_resize_png_bytes'](raw, 87, 87), raw)

    def test_two_customer_passes_share_brand_and_static_art_without_sharing_private_pass_json(self):
        logo, hero = png((480, 240), logo=True), png((1125, 369))
        env, calls, _, _ = fixture([FakeResponse(logo), FakeResponse(hero)])
        env.update(APPLE_PASS_TYPE_IDENTIFIER='pass.fixture', APPLE_TEAM_IDENTIFIER='TEST', get_apple_pass_credentials=lambda: True,
            wallet_20_design=lambda *args: {'background': '#123456', 'show_background': True}, program_has_tier=lambda *args: False,
            wallet_progress_state=lambda *args: None, _apple_pass_dirty_at=lambda *args: None, _strip_bottom_rgb=lambda *args: None,
            build_apple_pass_json=lambda customer, *args: {'serialNumber': customer['public_id'], 'storeCard': {'primaryFields': [{'key': 'points', 'value': customer['points_balance']}]}},
            sign_pkpass_manifest=lambda raw: hashlib.sha256(raw).digest(),
            generate_apple_strip_bytes=Mock(side_effect=AssertionError('Prepared static strip must avoid dynamic renderer')))
        business = {'name': 'Test Cafe', 'logo_url': LOGO_URL}; program = {'hero_image_url': HERO_URL}
        passes = [env['build_pkpass_bytes']({'public_id': identifier, 'points_balance': points}, business, program)
                  for identifier, points in (('member-a', 10), ('member-b', 90))]
        decoded = []
        for raw in passes:
            with zipfile.ZipFile(BytesIO(raw)) as archive:
                decoded.append((json.loads(archive.read('pass.json')), {name: archive.read(name) for name in (*BRAND_SIZES, *STRIP_SIZES)}))
        self.assertEqual(len(calls), 2)
        self.assertEqual(decoded[0][1], decoded[1][1])
        self.assertNotEqual(decoded[0][0]['serialNumber'], decoded[1][0]['serialNumber'])
        self.assertNotEqual(decoded[0][0]['storeCard'], decoded[1][0]['storeCard'])

    def test_dynamic_progress_cannot_reuse_static_customer_independent_strip(self):
        env, _, _, _ = fixture()
        dynamic = png((1125, 369), (70, 130, 40, 255))
        env.update(APPLE_PASS_TYPE_IDENTIFIER='pass.fixture', APPLE_TEAM_IDENTIFIER='TEST', get_apple_pass_credentials=lambda: True,
            wallet_20_design=lambda *args: {'background': '#123456', 'show_background': True}, program_has_tier=lambda *args: False,
            wallet_progress_state=lambda *args: {'filled_slots': 2}, _apple_pass_dirty_at=lambda *args: None, _strip_bottom_rgb=lambda *args: None,
            build_apple_pass_json=lambda customer, *args: {'serialNumber': 'dynamic', 'storeCard': {}},
            sign_pkpass_manifest=lambda raw: hashlib.sha256(raw).digest(),
            _apple_static_strip_assets=Mock(side_effect=AssertionError('Dynamic progress cannot use static artwork')),
            generate_apple_strip_bytes=Mock(return_value=dynamic))
        raw = env['build_pkpass_bytes']({}, {'name': 'Test Cafe', 'logo_url': LOGO_URL}, {'hero_image_url': HERO_URL})
        with zipfile.ZipFile(BytesIO(raw)) as archive: self.assertEqual(archive.read('strip@3x.png'), dynamic)
        self.assertEqual(env['generate_apple_strip_bytes'].call_count, 1)


if __name__ == '__main__': unittest.main()

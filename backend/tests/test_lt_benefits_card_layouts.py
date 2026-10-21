"""Card opt-in/layout regressions execute real builders without app/provider startup."""
import ast
from copy import deepcopy
import hashlib
import html
from io import BytesIO
import json
from pathlib import Path
import re
from typing import Optional
import unittest
from urllib.parse import quote
import zipfile

from backend import lt_benefits_wallet as wallet


SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
if not SOURCE.is_file():
    SOURCE = Path('/Users/user24/Desktop/loyaltree/backend/main.py')
NAMES = {'_google_wallet_base_class_id', '_google_wallet_safe_fragment',
         'google_wallet_vip_class_id', 'google_wallet_hybrid_tier_class_id',
         'google_wallet_tier_class_id', 'google_wallet_class_id_for_customer',
         'build_loyalty_class', 'lt_benefits_wallet_action',
         'build_apple_pass_json', 'build_pkpass_bytes'}


def builder_code():
    nodes = [node for node in ast.parse(SOURCE.read_text()).body
             if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    missing = NAMES - {node.name for node in nodes}
    if missing:
        raise AssertionError('Production card builders missing: ' + ', '.join(sorted(missing)))
    for node in nodes:
        node.decorator_list = []
    return compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec')


CODE = builder_code()
BUSINESS = {'id': 10, 'public_id': 'synthetic-cafe', 'name': 'Synthetic Cafe', 'logo_url': 'https://example.invalid/logo.png'}
PROGRAM = {'card_type': 'stamp', 'is_default': True, 'card_name': 'Cafe Rewards', 'stamp_goal': 8, 'reward_name': 'Free coffee'}
CUSTOMER = {'id': 20, 'public_id': 'synthetic-card', 'name': 'Synthetic Member', 'business_id': 10,
            'stamp_count': 3, 'lt_member_id': 'synthetic-member', 'lt_points_balance': 7, 'lt_points_version': 2}
ORDER_ACTION = {'label': 'Order Ahead', 'url': 'https://example.invalid/order?card=synthetic-card'}


def fixture(enabled=True, order=True):
    state, logos = [enabled], []
    def brand(value):
        logos.append(value)
        return value + b':lt-brand'
    def logo_uri(business, program, source, color, variant, *, benefits=False):
        return f'https://example.invalid/{variant}.png?lt={int(benefits)}'
    env = dict(Optional=Optional, lt_wallet=wallet, lt_benefits_enabled=lambda: state[0],
        GOOGLE_WALLET_ISSUER_ID='issuer', BASE_URL='https://example.invalid',
        FRONTEND_URL='https://theloyaltytree.com', _order_ahead_signing_secret=lambda: 'synthetic-signing-secret-only',
        re=re, quote=quote, html_lib=html, json=json, hashlib=hashlib, BytesIO=BytesIO, zipfile=zipfile,
        wallet_20_design=lambda *a: {'background': '#123456', 'card_label': 'Cafe Rewards', 'show_background': False},
        wallet_20_program_name=lambda *a: 'Cafe Rewards', google_wallet_program_logo_uri=logo_uri,
        program_has_tier=lambda p: p.get('card_type') in ('vip', 'hybrid'),
        hybrid_tier_enabled=lambda p: p.get('card_type') == 'hybrid',
        get_vip_tier=lambda c, p: {'id': 'gold', 'name': 'Gold', 'color': '#b09030'},
        program_has_membership=lambda p: False, GOOGLE_SMART_TAP_ENABLED=False,
        GOOGLE_SMART_TAP_REDEMPTION_ISSUER_ID='',
        effective_loyalty_type=lambda p: 'stamp', program_reward_uses_points=lambda p: False,
        program_reward_uses_stamps=lambda p: True, get_next_vip_tier=lambda *a: None,
        _normalize_hex_color=lambda value, fallback: value or fallback,
        _hex_to_rgb=lambda value: (18, 52, 86), _announcement_notification_header=lambda *a: 'Cafe update',
        card_cycle_reset_on_date=lambda *a: None, normalize_stamp_display_style=lambda p: 'number',
        wallet_stamp_balance_and_module=lambda p, stamps, goal, **kw: (f'{stamps} / {goal}', None),
        normalize_stamp_icon=lambda p: 'star', get_current_card_redeemables=lambda *a: [],
        get_recent_activity=lambda *a, **kw: [], business_currency=lambda b: 'PHP',
        order_ahead_wallet_action=lambda *a: deepcopy(ORDER_ACTION) if order else None,
        _oa_apple_order_status_field=lambda *a: None, program_wallet_actions=lambda p: [],
        loyaltytree_business_cta_url=lambda *a: 'https://example.invalid/business',
        membership_expiry_reminder_stage=lambda *a: None,
        normalize_wallet_detail_font_scale=lambda p: 1, contactless_member_token=lambda p: None,
        apple_geofence_locations=lambda b: [], APPLE_PASS_TYPE_IDENTIFIER='pass.synthetic',
        APPLE_TEAM_IDENTIFIER='SYNTHETIC', APPLE_PASS_WEB_SERVICE_URL='https://example.invalid/apple',
        apple_pass_auth_token=lambda p: 'synthetic-pass-token', APPLE_NFC_ENABLED=False,
        APPLE_NFC_ENCRYPTION_PUBLIC_KEY='', APPLE_NFC_REQUIRES_AUTHENTICATION=False,
        get_apple_pass_credentials=lambda: True, _fetch_image_bytes=lambda url: b'merchant-image',
        apple_icon_from_logo_bytes=lambda data, size: b'merchant-icon',
        apple_logo_from_image_bytes=lambda data, width, height: b'merchant-logo',
        _resize_png_bytes=lambda data, width, height: data + f':{width}x{height}'.encode(),
        _lt_cobrand_logo=brand, _apple_pass_dirty_at=lambda serial: None,
        wallet_progress_state=lambda *a: None, sign_pkpass_manifest=lambda data: b'synthetic-signature')
    exec(CODE, env)
    return env, state, logos


def customer(flag):
    return {**CUSTOMER, 'lt_benefits_card_enabled': flag}


class BenefitsCardLayoutTests(unittest.TestCase):
    def test_only_explicit_true_cards_receive_benefits_entry_and_global_switch_still_applies(self):
        env, switch, _ = fixture()
        for flag in (None, False, 0, 1, 'true'):
            with self.subTest(flag=flag):
                self.assertIsNone(env['lt_benefits_wallet_action'](customer(flag), BUSINESS))
        self.assertIsNotNone(env['lt_benefits_wallet_action'](customer(True), BUSINESS))
        switch[0] = False
        self.assertIsNone(env['lt_benefits_wallet_action'](customer(True), BUSINESS))

    def test_old_apple_cards_keep_exact_layout_actions_and_rewards_when_feature_enabled(self):
        env, switch, _ = fixture()
        for flag in (None, False):
            with self.subTest(flag=flag):
                switch[0] = False
                legacy = env['build_apple_pass_json'](customer(flag), BUSINESS, PROGRAM)
                switch[0] = True
                current = env['build_apple_pass_json'](customer(flag), BUSINESS, PROGRAM)
                self.assertEqual(current, legacy)
                self.assertEqual(current['featuredActions'], [{'identifier': 'loyaltree-order-ahead', 'type': 'order', 'url': ORDER_ACTION['url']}])
                self.assertFalse(any(field.get('key', '').startswith('lt_') for group in current['storeCard'].values() for field in group))

    def test_actual_apple_builder_adds_membership_action_front_points_and_older_ios_back_link(self):
        env, _, _ = fixture()
        legacy = env['build_apple_pass_json'](customer(None), BUSINESS, PROGRAM)
        upgraded = env['build_apple_pass_json'](customer(True), BUSINESS, PROGRAM)
        actions = upgraded['featuredActions']
        self.assertEqual([action['type'] for action in actions], ['membershipBenefits', 'order'])
        self.assertEqual(actions[1], legacy['featuredActions'][0])
        self.assertLessEqual(len(actions), 2)
        back = {field['key']: field for field in upgraded['storeCard']['backFields']}
        self.assertIn('lt_benefits', back)
        self.assertIn('https://theloyaltytree.com/benefits?', back['lt_benefits']['attributedValue'])
        self.assertIn('order_ahead', back)
        front = [field for area, fields in upgraded['storeCard'].items() if area != 'backFields' for field in fields]
        self.assertIn({'key': 'lt_points', 'label': 'LT POINTS', 'value': '7'}, front)
        for area, fields in legacy['storeCard'].items():
            for field in fields:
                self.assertIn(field, upgraded['storeCard'][area])
        self.assertEqual(upgraded['barcodes'], legacy['barcodes'])
        self.assertEqual(upgraded['serialNumber'], legacy['serialNumber'])

    def test_benefits_action_is_bounded_and_back_link_exists_without_order_ahead(self):
        env, _, _ = fixture(order=False)
        result = env['build_apple_pass_json'](customer(True), BUSINESS, PROGRAM)
        self.assertEqual(len(result['featuredActions']), 1)
        self.assertEqual(result['featuredActions'][0]['type'], 'membershipBenefits')
        target = env['lt_benefits_wallet_action'](customer(True), BUSINESS)
        result['featuredActions'] += [{'identifier': 'order', 'type': 'order', 'url': ORDER_ACTION['url']},
                                      {'identifier': 'extra', 'type': 'order', 'url': 'https://example.invalid/extra'}]
        result = wallet.apply_apple(result, customer(True), target)
        self.assertEqual(len(result['featuredActions']), 2)
        self.assertEqual(result['featuredActions'][0]['identifier'], 'loyaltree-benefits')
        self.assertEqual(result['featuredActions'][1]['identifier'], 'order')
        self.assertTrue(any(field['key'] == 'lt_benefits' for field in result['storeCard']['backFields']))

    def test_google_class_ids_are_isolated_for_classic_vip_and_hybrid_cards(self):
        env, switch, _ = fixture()
        for card_type, expected in [('stamp', 'issuer.synthetic-cafe'), ('vip', 'issuer.synthetic-cafe-vip-gold'),
                                    ('hybrid', 'issuer.synthetic-cafe-hybrid-tier-gold')]:
            program = {**PROGRAM, 'card_type': card_type}
            with self.subTest(card_type=card_type):
                for flag in (None, False):
                    self.assertEqual(env['google_wallet_class_id_for_customer'](customer(flag), BUSINESS, program), expected)
                self.assertEqual(env['google_wallet_class_id_for_customer'](customer(True), BUSINESS, program), expected + wallet.GOOGLE_CLASS_SUFFIX)
                switch[0] = False
                self.assertEqual(env['google_wallet_class_id_for_customer'](customer(True), BUSINESS, program), expected)
                switch[0] = True
        program = {**PROGRAM, 'is_default': False, 'public_id': 'secondary/program'}
        self.assertEqual(env['google_wallet_class_id_for_customer'](customer(None), BUSINESS, program), 'issuer.synthetic-cafe-p-secondary-program')
        self.assertEqual(env['google_wallet_class_id_for_customer'](customer(True), BUSINESS, program), 'issuer.synthetic-cafe-p-secondary-program' + wallet.GOOGLE_CLASS_SUFFIX)

    def test_actual_google_builder_does_not_change_shared_legacy_class_layout_or_logo(self):
        env, switch, _ = fixture()
        for card_type in ('stamp', 'vip', 'hybrid'):
            program = {**PROGRAM, 'card_type': card_type}
            legacy_id = env['google_wallet_class_id_for_customer'](customer(None), BUSINESS, program)
            with self.subTest(card_type=card_type):
                switch[0] = False
                legacy = env['build_loyalty_class'](BUSINESS, program, class_id_override=legacy_id, vip_tier_name='Gold')
                switch[0] = True
                unchanged = env['build_loyalty_class'](BUSINESS, program, class_id_override=legacy_id, vip_tier_name='Gold')
                self.assertEqual(unchanged, legacy)
                self.assertNotIn('classTemplateInfo', unchanged)
                upgraded = env['build_loyalty_class'](BUSINESS, program, class_id_override=legacy_id + wallet.GOOGLE_CLASS_SUFFIX, vip_tier_name='Gold')
                self.assertIn('classTemplateInfo', upgraded)
                self.assertEqual(upgraded['id'], legacy_id + wallet.GOOGLE_CLASS_SUFFIX)
                for field in ('issuerName', 'programName', 'hexBackgroundColor', 'accountNameLabel', 'programLogo'):
                    self.assertEqual(upgraded[field], legacy[field])
                self.assertTrue(legacy['wideProgramLogo']['sourceUri']['uri'].endswith('lt=0'))
                self.assertTrue(upgraded['wideProgramLogo']['sourceUri']['uri'].endswith('lt=1'))

    def test_actual_apple_packaging_cobrands_only_enabled_cards_and_preserves_scan_identity(self):
        env, switch, brand_calls = fixture()
        for flag, enabled, expected_calls in [(None, True, 0), (False, True, 0), (True, False, 0), (True, True, 1)]:
            with self.subTest(flag=flag, feature_enabled=enabled):
                switch[0] = enabled
                brand_calls.clear()
                data = env['build_pkpass_bytes'](customer(flag), BUSINESS, PROGRAM)
                self.assertEqual(len(brand_calls), expected_calls)
                with zipfile.ZipFile(BytesIO(data)) as archive:
                    logo = archive.read('logo@3x.png')
                    self.assertEqual(logo, b'merchant-logo:lt-brand' if expected_calls else b'merchant-logo')
                    actual = json.loads(archive.read('pass.json'))
                    self.assertEqual(actual['serialNumber'], CUSTOMER['public_id'])
                    self.assertEqual(actual['barcodes'][0]['message'], 'https://example.invalid/stamp/synthetic-card')
                    manifest = json.loads(archive.read('manifest.json'))
                    self.assertEqual(manifest['logo@3x.png'], hashlib.sha1(logo).hexdigest())


if __name__ == '__main__':
    unittest.main()

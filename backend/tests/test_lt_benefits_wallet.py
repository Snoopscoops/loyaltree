"""Pure Wallet contract tests: synthetic passes/artwork and no external services."""
from copy import deepcopy
import ast
import hashlib
import hmac
from io import BytesIO
from pathlib import Path
import re
from urllib.parse import parse_qs, urlsplit
import unittest
from unittest.mock import patch

from PIL import Image
from backend import lt_benefits_wallet as wallet


CUSTOMER = {
    'public_id': 'test-customer-card', 'lt_benefits_card_enabled': True, 'lt_member_id': 'test-lt-member',
    'lt_points_balance': 260, 'lt_points_version': 12,
    'lt_points_updated_at': '2026-10-21T01:00:00Z', 'lt_coupon_count': 2,
}
BUSINESS = {'public_id': 'test-merchant', 'name': 'Synthetic Merchant'}
SECRET = 'test-only-signing-key-with-no-real-access'


def action():
    return wallet.wallet_action(CUSTOMER, BUSINESS, 'https://theloyaltytree.com', SECRET, enabled=True)


def apple_pass(full=False):
    return {
        'serialNumber': CUSTOMER['public_id'],
        'barcodes': [{'format': 'PKBarcodeFormatQR', 'message': 'https://example.invalid/stamp/test-customer-card'}],
        'userInfo': {'merchantOrderStatus': 'ready'},
        'storeCard': {
            'headerFields': [{'key': 'merchant_tier', 'label': 'TIER', 'value': 'Gold'}],
            'primaryFields': [{'key': 'merchant_points', 'label': 'STORE POINTS', 'value': 150}],
            'secondaryFields': [{'key': 'merchant_stamps', 'label': 'STAMPS', 'value': '3 / 8'}],
            'auxiliaryFields': [{'key': 'merchant_membership', 'label': 'MEMBERSHIP', 'value': 'Active'}]
                + ([{'key': 'merchant_expiry', 'label': 'EXPIRES', 'value': '2027-01-01'},
                    {'key': 'merchant_visits', 'label': 'VISITS', 'value': 9}] if full else []),
            'backFields': [{'key': 'merchant_terms', 'label': 'STORE TERMS', 'value': 'Existing merchant terms'},
                           {'key': 'merchant_order', 'label': 'ORDER STATUS', 'value': 'Ready for pickup'}],
        },
    }


def google_pass(hybrid=False):
    value = {
        'id': 'issuer.synthetic-member', 'classId': 'issuer.synthetic-class',
        'accountName': 'Synthetic Member',
        'barcode': {'type': 'QR_CODE', 'value': 'https://example.invalid/stamp/test-customer-card'},
        'loyaltyPoints': {'label': 'STORE STAMPS', 'balance': {'string': '3 / 8'}},
        'textModulesData': [{'id': 'merchant_terms', 'header': 'STORE TERMS', 'body': 'Existing merchant terms'}],
        'linksModuleData': {'uris': [{'uri': 'https://example.invalid/order', 'description': 'My order'}]},
    }
    if hybrid:
        value['secondaryLoyaltyPoints'] = {'label': 'MEMBERSHIP', 'balance': {'string': 'Gold · Active'}}
    return value


def png(size, color):
    with Image.new('RGBA', size, color) as image, BytesIO() as output:
        image.save(output, 'PNG')
        return output.getvalue()


class BenefitsWalletTests(unittest.TestCase):
    def test_disabled_or_incomplete_action_keeps_existing_passes_exactly_unchanged(self):
        self.assertIsNone(wallet.wallet_action(CUSTOMER, BUSINESS, 'https://example.invalid', SECRET))
        for customer, business, secret in [({}, BUSINESS, SECRET), (CUSTOMER, {}, SECRET), (CUSTOMER, BUSINESS, '')]:
            self.assertIsNone(wallet.wallet_action(customer, business, 'https://example.invalid', secret, enabled=True))
        for build, adapt in [(apple_pass, wallet.apply_apple), (google_pass, wallet.apply_google)]:
            existing = build()
            before = deepcopy(existing)
            self.assertIs(adapt(existing, CUSTOMER, None), existing)
            self.assertEqual(existing, before)

    def test_signed_reference_is_scoped_to_card_business_secret_and_benefits_domain(self):
        token = wallet.card_token(CUSTOMER['public_id'], BUSINESS['public_id'], SECRET)
        self.assertTrue(wallet.verify_card_token(CUSTOMER['public_id'], BUSINESS['public_id'], token, SECRET))
        for customer, business, secret in [('another-card', BUSINESS['public_id'], SECRET),
                                           (CUSTOMER['public_id'], 'another-merchant', SECRET),
                                           (CUSTOMER['public_id'], BUSINESS['public_id'], 'another-test-key')]:
            self.assertFalse(wallet.verify_card_token(customer, business, token, secret))
        # Existing Order Ahead signatures have a different purpose/domain.
        legacy = hmac.new(SECRET.encode(), f"{CUSTOMER['public_id']}|{BUSINESS['public_id']}".encode(), hashlib.sha256).hexdigest()
        self.assertNotEqual(token, legacy)
        self.assertFalse(wallet.verify_card_token(CUSTOMER['public_id'], BUSINESS['public_id'], legacy, SECRET))
        self.assertFalse(wallet.verify_card_token(CUSTOMER['public_id'], BUSINESS['public_id'], None, SECRET))

    def test_action_uses_the_benefits_destination_without_including_the_signing_secret(self):
        target = wallet.wallet_action(CUSTOMER, BUSINESS, 'https://theloyaltytree.com/', SECRET, enabled=True)
        self.assertEqual(target['label'], 'Loyalty Tree Benefits')
        parsed = urlsplit(target['url'])
        self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ('https', 'theloyaltytree.com', '/benefits'))
        query = parse_qs(parsed.query)
        self.assertEqual(set(query), {'card', 'token'})
        self.assertEqual(query['card'], [CUSTOMER['public_id']])
        self.assertTrue(wallet.verify_card_token(CUSTOMER['public_id'], BUSINESS['public_id'], query['token'][0], SECRET))
        self.assertNotIn(SECRET, target['url'])

    def test_denormalized_projection_handles_unlinked_zero_and_refund_balances(self):
        self.assertFalse(wallet.projection({})['linked'])
        self.assertTrue(wallet.projection({**CUSTOMER, 'lt_points_balance': 0})['linked'])
        self.assertEqual(wallet.projection({**CUSTOMER, 'lt_points_balance': -20})['balance'], 0)
        state = wallet.projection(CUSTOMER)
        self.assertEqual((state['balance'], state['version'], state['coupon_count']), (260, 12, 2))

    def test_apple_hybrid_pass_preserves_every_existing_merchant_field_and_scan_value(self):
        for full in (False, True):
            with self.subTest(full_field_budget=full):
                existing = apple_pass(full)
                before = deepcopy(existing)
                result = wallet.apply_apple(existing, CUSTOMER, action())
                self.assertEqual(result['serialNumber'], before['serialNumber'])
                self.assertEqual(result['barcodes'], before['barcodes'])
                self.assertEqual(result['userInfo']['merchantOrderStatus'], 'ready')
                for area, fields in before['storeCard'].items():
                    for field in fields:
                        self.assertIn(field, result['storeCard'][area])
                all_fields = [field for fields in result['storeCard'].values() for field in fields]
                self.assertTrue(any(field.get('label') == 'LT POINTS' and str(field.get('value')) == '260' for field in all_fields))
                self.assertTrue(any('2 claimed' in str(field.get('value')) for field in all_fields))
                self.assertEqual(result['userInfo']['loyaltyTreePointsVersion'], '12')
                self.assertTrue(any(action()['url'].replace('&', '&amp;') in str(field.get('attributedValue')) for field in all_fields))

    def test_unlinked_passes_offer_connection_instead_of_showing_a_stale_numeric_lt_balance(self):
        customer = {**CUSTOMER, 'lt_member_id': None, 'lt_coupon_count': 0}
        apple = wallet.apply_apple(apple_pass(), customer, action())
        fields = [field for group in apple['storeCard'].values() for field in group]
        lt = [field for field in fields if field.get('key') in ('lt_points', 'lt_points_detail')]
        self.assertTrue(lt)
        self.assertFalse(any(str(field.get('value')) == '260' for field in lt))
        google = wallet.apply_google(google_pass(), customer, action())
        self.assertIn('Connect', next(row['body'] for row in google['textModulesData'] if row['id'] == 'lt_points'))

    def test_apple_link_is_html_attribute_escaped(self):
        target = {'label': wallet.LABEL, 'url': 'https://theloyaltytree.com/benefits?card=test&token=abc&extra="quoted"'}
        result = wallet.apply_apple(apple_pass(), CUSTOMER, target)
        link = next(field['attributedValue'] for field in result['storeCard']['backFields'] if field.get('key') == 'lt_benefits')
        self.assertIn('&amp;', link)
        self.assertIn('&quot;', link)
        self.assertNotIn('extra="quoted"', link)

    def test_google_hybrid_keeps_merchant_points_membership_links_and_customer_barcode(self):
        existing = google_pass(hybrid=True)
        before = deepcopy(existing)
        result = wallet.apply_google(existing, CUSTOMER, action())
        for key in ('loyaltyPoints', 'secondaryLoyaltyPoints', 'barcode', 'id', 'classId', 'accountName'):
            self.assertEqual(result[key], before[key])
        self.assertIn(before['textModulesData'][0], result['textModulesData'])
        self.assertIn(before['linksModuleData']['uris'][0], result['linksModuleData']['uris'])
        modules = {row['id']: row for row in result['textModulesData']}
        self.assertEqual(modules['lt_points']['body'], '260')
        self.assertIn('2 claimed', modules['lt_coupons']['body'])
        self.assertTrue(any(row['uri'] == action()['url'] and row['description'] == wallet.LABEL for row in result['linksModuleData']['uris']))

    def test_google_class_references_resolve_for_classic_and_hybrid_objects(self):
        # A class template must not reference a missing status module on a
        # classic card that has no secondaryLoyaltyPoints field.
        def fields(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key == 'fieldPath':
                        yield item
                    else:
                        yield from fields(item)
            elif isinstance(value, list):
                for item in value:
                    yield from fields(item)
        for hybrid in (False, True):
            obj = wallet.apply_google(google_pass(hybrid), CUSTOMER, action())
            original = {'id': 'issuer.synthetic-class', 'issuerName': 'Synthetic Merchant', 'programName': 'Merchant Rewards', 'reviewStatus': 'UNDER_REVIEW'}
            cls = wallet.apply_google_class(deepcopy(original))
            for key, value in original.items():
                self.assertEqual(cls[key], value)
            modules = {row['id'] for row in obj['textModulesData']}
            references = [match.group(1) for path in fields(cls) if (match := re.fullmatch(r"object\.textModulesData\['([^']+)'\]", path))]
            self.assertTrue(references)
            self.assertIn('lt_points', references)
            # Google suppresses an optional empty item. Do not fabricate a
            # merchant status for classic cards that do not have one.
            missing = set(references) - modules
            self.assertTrue(missing.issubset({'lt_merchant_status'}))

    def test_existing_projection_is_sufficient_without_database_or_network_work(self):
        with patch('socket.create_connection', side_effect=AssertionError('No network in pass adapter')), \
                patch('socket.socket.connect', side_effect=AssertionError('No network in pass adapter')):
            target = action()
            wallet.apply_apple(apple_pass(True), CUSTOMER, target)
            wallet.apply_google(google_pass(True), CUSTOMER, target)
            self.assertEqual(wallet.projection(CUSTOMER)['balance'], 260)

    def test_cobranding_keeps_small_wallet_asset_dimensions_and_both_brand_colors(self):
        merchant = png((160, 50), (220, 45, 30, 255))
        brand = png((32, 32), (20, 100, 50, 255))
        output = wallet.co_brand_png(merchant, brand)
        self.assertIsInstance(output, bytes)
        with Image.open(BytesIO(output)) as image:
            self.assertEqual(image.size, (160, 50))
            with image.convert('RGBA') as converted:
                colors = {color[:3] for count, color in converted.getcolors(10000)}
            self.assertIn((220, 45, 30), colors)
            self.assertIn((20, 100, 50), colors)
        for size in ((1, 1), (3, 2), (320, 100)):
            with self.subTest(size=size), Image.open(BytesIO(wallet.co_brand_png(png(size, (220, 45, 30, 255)), brand))) as image:
                self.assertEqual(image.size, size)

    def test_unavailable_cobrand_art_does_not_break_a_valid_merchant_logo(self):
        source = Path(wallet.__file__).with_name('main.py')
        node = next(node for node in ast.parse(source.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == '_lt_cobrand_logo')
        warnings = []
        environment = dict(__file__=str(source), lt_benefits_enabled=lambda: True,
                           hashlib=hashlib, _APPLE_IMAGE_CACHE={}, lt_wallet=wallet,
                           log_event=lambda *args, **fields: warnings.append((args, fields)))
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), environment)
        merchant = png((160, 50), (220, 45, 30, 255))
        with patch('pathlib.Path.read_bytes', return_value=b'not an image'):
            output = environment['_lt_cobrand_logo'](merchant)
        self.assertEqual(output, merchant)
        self.assertTrue(warnings)
        with Image.open(BytesIO(output)) as image:
            self.assertEqual(image.size, (160, 50))
            with image.convert('RGBA') as converted:
                self.assertEqual(converted.getpixel((80, 25)), (220, 45, 30, 255))

    def test_purchase_source_normalization_joins_same_sale_engines_without_long_key_collisions(self):
        self.assertEqual(wallet.normalized_purchase_source('receipt-123:points'), 'receipt-123')
        self.assertEqual(wallet.normalized_purchase_source('receipt-123:stamp'), 'receipt-123')
        self.assertEqual(wallet.normalized_purchase_source('receipt-123:tier'), 'receipt-123')
        left, right = 'x' * 200 + 'a', 'x' * 200 + 'b'
        self.assertLessEqual(len(wallet.normalized_purchase_source(left)), 180)
        self.assertNotEqual(wallet.normalized_purchase_source(left), wallet.normalized_purchase_source(right))
        self.assertEqual(wallet.normalized_purchase_source(left), wallet.normalized_purchase_source(left))


if __name__ == '__main__':
    unittest.main()

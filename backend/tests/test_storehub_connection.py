"""StoreHub account linking, transaction permissions and redemption safeguards."""
import ast
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


FUNCTIONS = {
    'StoreHubAuthenticationError', 'StoreHubCredentialDenied', '_normalize_storehub_store_name',
    '_storehub_list', '_storehub_store_summary', '_storehub_outlets_from_transactions',
    '_storehub_read_connection_transactions', '_storehub_discover_outlets_with_credentials',
    '_storehub_test_previous_credentials', '_storehub_connection_result', 'connect_storehub_account',
    'storehub_connection_test', 'storehub_transactions_preview', '_pos_public_integration', 'start_pos_integration',
    '_pos_storehub_register_required', '_angkan_storehub_redemption_blocked',
    '_require_angkan_storehub_redemption_ready', 'companion_angkan_reserve',
    'pos_companion_points_reserve', 'pos_go_live', 'companion_redemption_confirm', 'apply_storehub_redemption_discount',
}


class StoreHubConnectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / 'main.py'
        parsed = ast.parse(path.read_text())
        statements = [node for node in parsed.body if getattr(node, 'name', None) in FUNCTIONS]
        for node in statements:
            node.decorator_list = []
        cls.code = compile(ast.Module(body=statements, type_ignores=[]), str(path), 'exec')

    def setUp(self):
        self.outlets = [{'id': 'outlet', 'name': 'Angkan'}]
        self.saved = {
            'id': 'integration', 'provider': 'storehub', 'mode': 'live', 'status': 'live',
            'external_account_name': 'angkan', 'credentials_ciphertext': 'encrypted-value',
            'config': {'storehub_outlets': self.outlets, 'real_api_tested': True},
        }
        self.decrypt = Mock(return_value={'store_name': 'angkan', 'api_token': 'saved-token'})
        self.write = Mock()
        self.write.table.return_value.insert.return_value.execute.return_value.data = []
        self.encrypt = Mock(return_value='encrypted-new-value')
        self.calls = []
        self.responses = {}
        self.ns = dict(HTTPException=HTTPException, Optional=Optional, datetime=datetime, timedelta=timedelta,
            timezone=timezone, re=re, asyncio=asyncio, Header=lambda **_: None, POSStoreHubConnectRequest=object,
            POSStoreHubConnectionTestRequest=object, POSStoreHubPreviewRequest=object, POSIntegrationCreate=object, POSAngkanReserve=object,
            POSCompanionPointsReserveRequest=object, POSGoLiveRequest=object, POSManualRewardConfirm=object,
            POSRedemptionApplyRequest=object,
            _require_pos_pro_business=Mock(return_value={'id': 7, 'public_id': 'angkan-c5a1'}),
            _require_pos_device=Mock(return_value={'business_id': 7, 'provider': 'storehub'}),
            _pos_business_by_id=Mock(return_value={'public_id': 'angkan-c5a1'}),
            _pos_credentials_cipher=Mock(), _get_pos_integration=Mock(return_value=self.saved),
            _decrypt_pos_credentials=self.decrypt, _encrypt_pos_credentials=self.encrypt,
            _merge_pos_config=lambda row, patch: {**(row.get('config') or {}), **patch},
            _pos_loyalty_contract=Mock(return_value={}), _storehub_request_with_credentials=self.request,
            supabase=self.write)
        exec(self.code, self.ns)

    def request(self, name, token, path, **kwargs):
        self.calls.append((name, token, path))
        result = self.responses[(token, path)]
        if isinstance(result, Exception):
            raise result
        return result

    def connect(self, name='angkan', token='new-token'):
        return self.ns['connect_storehub_account']('business', SimpleNamespace(store_name=name, api_token=token))

    def check_saved(self):
        return self.ns['storehub_connection_test']('business', SimpleNamespace(provider='storehub'))

    def deny(self, token, endpoint):
        self.responses[token, endpoint] = self.ns['StoreHubAuthenticationError'](403, endpoint)

    def allow(self, token, endpoint, payload=None):
        self.responses[token, endpoint] = (self.outlets if endpoint == '/stores' else []) if payload is None else payload

    def no_writes(self):
        self.write.assert_not_called()
        self.encrypt.assert_not_called()

    def test_stores_success_and_transactions_403_links_account_only(self):
        self.ns['_get_pos_integration'].return_value = None
        self.allow('new-token', '/stores')
        self.deny('new-token', '/transactions')
        result = self.connect()
        self.assertTrue(result['account_linked'])
        self.assertFalse(result['transactions_verified'])
        self.assertEqual(result['transaction_status'], 'denied')
        self.assertEqual(result['stores'], self.outlets)
        self.assertEqual([call[2] for call in self.calls], ['/stores', '/transactions'])
        payload = self.write.table.return_value.insert.call_args.args[0]
        self.assertFalse(payload['config']['real_api_tested'])
        self.assertFalse(payload['capabilities']['transactions_read'])
        self.assertFalse(payload['config']['redemption_enabled'])
        self.assertFalse(payload['config']['simulator'])
        self.assertNotIn('credentials_ciphertext', result['integration'])

    def test_stores_denied_and_transactions_success_uses_outlet_fallback(self):
        self.deny('saved-token', '/stores')
        self.allow('saved-token', '/transactions', {'transactions': [{'storeId': 'fallback', 'storeName': 'Other outlet'}]})
        result = self.check_saved()
        self.assertTrue(result['account_linked'])
        self.assertTrue(result['transactions_verified'])
        self.assertFalse(result['stores_verified'])
        self.assertEqual(result['outlet_source'], 'transactions')
        self.assertEqual(result['stores'][0]['id'], 'fallback')
        self.no_writes()

    def test_both_endpoints_successful_verifies_transactions_and_prefers_stores(self):
        self.allow('saved-token', '/stores')
        self.allow('saved-token', '/transactions', {'transactions': [{'storeId': 'fallback'}]})
        result = self.check_saved()
        self.assertTrue(result['transactions_verified'])
        self.assertTrue(result['stores_verified'])
        self.assertEqual(result['outlet_source'], 'stores')
        self.assertEqual(result['stores'], self.outlets)
        self.no_writes()

    def test_both_endpoints_denied_do_not_claim_success_or_persist(self):
        self.ns['_get_pos_integration'].return_value = None
        self.deny('new-token', '/stores')
        self.deny('new-token', '/transactions')
        with self.assertRaisesRegex(self.ns['StoreHubCredentialDenied'], 'both'):
            self.connect()
        self.no_writes()

    def test_invalid_submitted_token_falls_back_to_working_saved_token(self):
        self.deny('new-token', '/stores')
        self.deny('new-token', '/transactions')
        self.allow('saved-token', '/stores')
        self.allow('saved-token', '/transactions')
        result = self.connect('https://ANGKAN.storehubhq.com/')
        self.assertTrue(result['used_saved_credentials'])
        self.assertTrue(result['transactions_verified'])
        self.assertEqual(result['stores'], self.outlets)
        self.assertEqual(self.calls, [('angkan', 'saved-token', '/stores'), ('angkan', 'saved-token', '/transactions')])
        self.assertNotIn('credentials_ciphertext', result['integration'])
        self.assertNotIn('saved-token', str(result))
        self.no_writes()

    def test_existing_token_is_not_replaced_even_when_submitted_token_works(self):
        for token in ('new-token', 'saved-token'):
            self.allow(token, '/stores')
            self.allow(token, '/transactions')
        result = self.connect()
        self.assertTrue(result['used_saved_credentials'])
        self.assertTrue(result['transactions_verified'])
        self.no_writes()

    def test_different_account_cannot_use_saved_credentials_or_modify_link(self):
        with self.assertRaisesRegex(HTTPException, 'already has a saved'):
            self.connect('another-account')
        self.assertEqual(self.calls, [])
        self.no_writes()

    def test_saved_failure_preserves_existing_metadata_without_claiming_verified(self):
        self.allow('saved-token', '/stores')
        self.deny('saved-token', '/transactions')
        result = self.check_saved()
        self.assertFalse(result['transactions_verified'])
        self.assertEqual(result['transaction_status'], 'denied')
        self.assertTrue(self.saved['config']['real_api_tested'])
        self.assertFalse(result['integration']['config']['real_api_tested'])
        self.assertFalse(result['integration']['capabilities']['transactions_read'])
        self.no_writes()

    def test_timeout_only_leaves_an_existing_account_linked(self):
        self.allow('saved-token', '/stores')
        self.responses['saved-token', '/transactions'] = HTTPException(504, 'timeout')
        result = self.check_saved()
        self.assertTrue(result['account_linked'])
        self.assertFalse(result['transactions_verified'])
        self.assertEqual(result['transaction_status'], 'timeout')
        self.no_writes()

    def test_unverified_account_and_timeout_cannot_save_credentials(self):
        self.ns['_get_pos_integration'].return_value = None
        self.deny('new-token', '/stores')
        self.responses['new-token', '/transactions'] = HTTPException(504, 'timeout')
        with self.assertRaises(HTTPException) as error:
            self.connect()
        self.assertEqual(error.exception.status_code, 504)
        self.no_writes()

    def test_unrecognized_success_payload_does_not_verify_transactions(self):
        self.allow('saved-token', '/stores')
        self.allow('saved-token', '/transactions', {'message': 'unexpected response'})
        result = self.check_saved()
        self.assertFalse(result['transactions_verified'])
        self.assertEqual(result['transaction_status'], 'unavailable')
        self.no_writes()

    def test_preview_reads_with_paging_without_persisting_data(self):
        fetch = Mock(return_value=({}, [], {}))
        self.ns['_storehub_fetch_recent_transaction_rows'] = fetch
        self.ns['_storehub_recent_rows'] = lambda rows, limit: rows
        result = self.ns['storehub_transactions_preview']('business', SimpleNamespace(days=1, limit=5))
        self.assertTrue(result['read_only'])
        self.assertTrue(fetch.call_args.kwargs['deep_probe'])
        self.assertFalse(fetch.call_args.kwargs['persist_paging_hint'])
        self.no_writes()

    def test_real_merchant_cannot_be_replaced_by_simulator(self):
        with self.assertRaisesRegex(HTTPException, 'saved StoreHub connection'):
            asyncio.run(self.ns['start_pos_integration']('business', SimpleNamespace(provider='storehub', mode='test')))
        self.no_writes()

    def test_go_live_rechecks_transaction_access_before_any_write(self):
        self.deny('saved-token', '/transactions')
        with self.assertRaises(self.ns['StoreHubCredentialDenied']):
            asyncio.run(self.ns['pos_go_live']('business', SimpleNamespace(provider='storehub')))
        self.no_writes()

    def test_fingerprint_and_legacy_reservation_cannot_open_angkan_redemption(self):
        request = SimpleNamespace(cart_fingerprint='a' * 64, gross_amount=350, discount_points=100)
        with self.assertRaisesRegex(HTTPException, 'server verification'):
            self.ns['companion_angkan_reserve'](request)
        with self.assertRaisesRegex(HTTPException, 'server verification'):
            self.ns['pos_companion_points_reserve'](request)
        with self.assertRaisesRegex(HTTPException, 'server verification'):
            self.ns['companion_redemption_confirm']('existing-code', request)
        with self.assertRaisesRegex(HTTPException, 'server verification'):
            asyncio.run(self.ns['apply_storehub_redemption_discount']('business', 'existing-reservation', request))
        self.no_writes()

    def test_owner_authorization_failure_has_no_storehub_or_database_side_effects(self):
        self.ns['_require_pos_pro_business'].side_effect = HTTPException(403, 'access denied')
        with self.assertRaises(HTTPException):
            self.connect()
        self.assertEqual(self.calls, [])
        self.no_writes()

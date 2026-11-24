"""Exercise the StoreHub handshake and saved-token recovery without live credentials."""
import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from typing import Optional
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
    '_storehub_test_previous_credentials', 'connect_storehub_account', '_pos_public_integration',
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
        self.saved = {
            'status': 'live', 'external_account_name': 'angkan',
            'credentials_ciphertext': 'encrypted-value',
            'config': {'storehub_outlets': [{'id': 'outlet', 'name': 'Angkan'}]},
        }
        self.decrypt = Mock(return_value={'store_name': 'angkan', 'api_token': 'saved-token'})
        self.write = Mock()
        self.encrypt = Mock()
        self.calls = []
        self.responses = {}
        self.ns = dict(HTTPException=HTTPException, Optional=Optional, datetime=datetime, timedelta=timedelta,
            timezone=timezone, re=re, Header=lambda **_: None, POSStoreHubConnectRequest=object,
            _require_pos_pro_business=Mock(return_value={'id': 7}), _pos_credentials_cipher=Mock(),
            _get_pos_integration=Mock(return_value=self.saved), _decrypt_pos_credentials=self.decrypt,
            _encrypt_pos_credentials=self.encrypt, _pos_loyalty_contract=Mock(return_value={}),
            _storehub_request_with_credentials=self.request, supabase=self.write)
        exec(self.code, self.ns)

    def request(self, name, token, path, **kwargs):
        self.calls.append((name, token, path))
        result = self.responses[(token, path)]
        if isinstance(result, Exception):
            raise result
        return result

    def connect(self, name='angkan', token='new-token'):
        return self.ns['connect_storehub_account']('business', SimpleNamespace(store_name=name, api_token=token))

    def reject(self, token):
        self.responses[token, '/transactions'] = self.ns['StoreHubAuthenticationError'](403, '/transactions')

    def test_same_account_can_read_with_saved_token_when_replacement_is_rejected(self):
        self.reject('new-token')
        self.responses['saved-token', '/transactions'] = {'transactions': []}
        result = self.connect('https://ANGKAN.storehubhq.com/')
        self.assertTrue(result['used_saved_credentials'])
        self.assertEqual(result['stores'], self.saved['config']['storehub_outlets'])
        self.assertEqual(self.calls, [('ANGKAN', 'new-token', '/transactions'), ('angkan', 'saved-token', '/transactions')])
        self.assertNotIn('credentials_ciphertext', result['integration'])
        self.assertNotIn('saved-token', str(result))
        self.encrypt.assert_not_called()
        self.write.assert_not_called()

    def test_no_retry_on_different_account(self):
        self.reject('new-token')
        with self.assertRaises(self.ns['StoreHubCredentialDenied']):
            self.connect('other-store')
        self.assertEqual(len(self.calls), 1)
        self.write.assert_not_called()

    def test_no_second_read_with_an_identical_token(self):
        self.reject('saved-token')
        with self.assertRaises(self.ns['StoreHubCredentialDenied']):
            self.connect(token='saved-token')
        self.assertEqual(len(self.calls), 1)
        self.write.assert_not_called()

    def test_rejected_saved_token_does_not_claim_success(self):
        self.reject('new-token')
        self.reject('saved-token')
        with self.assertRaisesRegex(self.ns['StoreHubCredentialDenied'], 'both'):
            self.connect()
        self.write.assert_not_called()
        self.encrypt.assert_not_called()

    def test_no_recovery_when_disconnected(self):
        self.saved['status'] = 'disconnected'
        self.reject('new-token')
        with self.assertRaises(self.ns['StoreHubCredentialDenied']):
            self.connect()
        self.decrypt.assert_not_called()
        self.write.assert_not_called()

    def test_outlet_permission_is_optional_when_transactions_are_readable(self):
        self.responses['new-token', '/transactions'] = {'transactions': [{'storeId': 'outlet', 'storeName': 'Angkan'}]}
        self.responses['new-token', '/stores'] = self.ns['StoreHubAuthenticationError'](403, '/stores')
        discover = self.ns['_storehub_discover_outlets_with_credentials']
        stores, source, _ = discover('angkan', 'new-token')
        self.assertEqual((stores, source), (self.saved['config']['storehub_outlets'], 'transactions'))

    def test_stores_alone_cannot_confirm_transaction_access(self):
        self.reject('new-token')
        self.responses['new-token', '/stores'] = self.saved['config']['storehub_outlets']
        with self.assertRaises(self.ns['StoreHubCredentialDenied']):
            self.ns['_storehub_discover_outlets_with_credentials']('angkan', 'new-token')
        self.assertEqual(len(self.calls), 1)

    def test_unrecognized_payload_is_not_a_verified_connection(self):
        self.responses['new-token', '/transactions'] = {'message': 'unexpected response'}
        with self.assertRaisesRegex(HTTPException, 'unexpected response'):
            self.connect()
        self.decrypt.assert_not_called()
        self.encrypt.assert_not_called()
        self.write.assert_not_called()

"""Fail-closed StoreHub probe checks; AST-only (no DB/HTTP/credentials)."""
import ast
from pathlib import Path
from datetime import datetime, timezone, timedelta

import pytest


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def probe(stores_response, transactions_response):
    source = Path(__file__).resolve().parents[1] / 'main.py'
    tree = ast.parse(source.read_text())
    names = {'StoreHubAuthenticationError', 'StoreHubCredentialDenied',
             '_storehub_read_connection_transactions', '_storehub_discover_outlets_with_credentials'}
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    assert len(nodes) == 4
    for n in nodes:
        n.decorator_list = []
    code = compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(source), 'exec')

    def request(store_name, api_token, path, params=None, timeout=20):
        value = stores_response if path == '/stores' else transactions_response
        if value == 'DENIED':
            raise env['StoreHubAuthenticationError'](403, path)
        if isinstance(value, BaseException):
            raise value
        return value

    env = {
        'HTTPException': HTTPException,
        'Optional': __import__('typing').Optional,
        'datetime': datetime, 'timezone': timezone, 'timedelta': timedelta,
        '_storehub_request_with_credentials': request,
        '_storehub_list': lambda payload: payload if isinstance(payload, list) else next(
            (payload[k] for k in ('data', 'items', 'results', 'stores', 'transactions') if isinstance(payload.get(k), list)), []),
        '_storehub_store_summary': lambda row: {'id': row.get('id'), 'name': row.get('name')},
        '_storehub_outlets_from_transactions': lambda rows: [
            {'id': row['storeId'], 'name': row['storeId']} for row in rows if row.get('storeId')],
    }
    exec(code, env)
    return env['_storehub_discover_outlets_with_credentials'], env


def denied():
    return 'DENIED'


def test_outlets_visible_when_transactions_denied():
    route, env = probe([{'id': 'store-1', 'name': 'ANGKAN'}], denied())
    result = route('angkan', 'fake-token')
    assert result['stores'] == [{'id': 'store-1', 'name': 'ANGKAN'}]
    assert result['transactions_verified'] is False
    assert result['transaction_status'] == 'denied'
    assert result['outlet_source'] == 'stores'


def test_transaction_feed_fallback_when_stores_denied():
    route, env = probe(denied(), [{'storeId': 'store-2'}])
    result = route('angkan', 'fake-token')
    assert result['stores'][0]['id'] == 'store-2'
    assert result['transactions_verified'] is True
    assert result['outlet_source'] == 'transactions'


def test_both_permissions_denied_rejected():
    route, env = probe(denied(), denied())
    with pytest.raises(env['StoreHubCredentialDenied']) as caught:
        route('angkan', 'fake-token')
    assert caught.value.status_code == 422


def test_transaction_timeout_keeps_stores_mapping_but_not_verification():
    route, env = probe([{'id': 'store-3'}], HTTPException(504, 'timeout'))
    result = route('angkan', 'fake-token')
    assert result['transaction_status'] == 'timeout'
    assert result['transactions_verified'] is False
    assert result['stores'][0]['id'] == 'store-3'


def test_verified_requires_transactions_reply():
    route, env = probe([{'id': 'store-1'}], [])
    result = route('angkan', 'fake-token')
    assert result['transaction_status'] == 'verified'
    assert result['transactions_verified'] is True


def test_invalid_transaction_shape_does_not_verify():
    route, env = probe([{'id': 'store-1'}], {'unexpected': 'shape'})
    result = route('angkan', 'fake-token')
    assert result['transactions_verified'] is False
    assert result['transaction_status'] == 'unavailable'

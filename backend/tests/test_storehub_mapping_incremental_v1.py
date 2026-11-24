"""Isolated StoreHub mapping regression tests; never imports the live FastAPI app.

No secrets, external HTTP requests or Supabase credentials are needed. The route
function is extracted from main.py and executed with an in-memory DB stand-in.
"""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


BRANCHES = {
    'b1': {'id': 101, 'public_id': 'b1', 'business_id': 77, 'name': 'Branch One'},
    'b2': {'id': 102, 'public_id': 'b2', 'business_id': 77, 'name': 'Branch Two'},
}
INTEGRATION = {
    'id': 999, 'provider': 'storehub', 'mode': 'test', 'credentials_ciphertext': 'encrypted-value-not-a-secret',
    'config': {'storehub_outlets': [{'id': 'store-1'}, {'id': 'store-2'}], 'storehub_transaction_status': 'denied'},
}


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.conditions = []
        self.action = 'select'
        self.value = None

    def select(self, *_):
        return self

    def eq(self, field, value):
        self.conditions.append((field, value))
        return self

    def limit(self, *_):
        return self

    def update(self, value):
        self.action, self.value = 'update', value
        return self

    def insert(self, value):
        self.action, self.value = 'insert', value
        return self

    def execute(self):
        data = self.db.data.setdefault(self.table, [])
        matching = [row for row in data if all(str(row.get(key)) == str(value) for key, value in self.conditions)]
        if self.action == 'select':
            return SimpleNamespace(data=[dict(row) for row in matching])
        self.db.writes.append((self.table, self.action, self.value))
        if self.action == 'update':
            for row in matching:
                row.update(self.value)
            return SimpleNamespace(data=matching)
        if self.action == 'insert':
            new = {**self.value, 'id': len(data) + 1}
            data.append(new)
            return SimpleNamespace(data=[new])
        raise AssertionError('unsupported action')


class Database:
    def __init__(self, existing=None):
        self.data = {
            'pos_branch_mappings': [dict(row) for row in (existing or [])],
            'pos_integrations': [dict(INTEGRATION)],
        }
        self.writes = []

    def table(self, table):
        return Query(self, table)


def load_route(db):
    path = Path(__file__).resolve().parents[1] / 'main.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    func = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'save_pos_branch_mappings')
    func.decorator_list = []
    # Type annotations and default Header value are resolved by a minimal env.
    module = ast.fix_missing_locations(ast.Module(body=[func], type_ignores=[]))

    def mapped_rows(business_id, integration_id):
        return [{**row, 'branch_public_id': 'b1' if row.get('branch_id') == 101 else 'b2'}
                for row in db.data['pos_branch_mappings']]

    env = {
        'POSBranchMappingsUpdate': object,
        'Header': lambda default='': default,
        'HTTPException': HTTPException,
        '_require_pos_pro_business': lambda *_: {'id': 77},
        '_get_pos_integration': lambda *_: INTEGRATION,
        'safe_get_branch': lambda key: BRANCHES.get(key),
        '_storehub_is_placeholder_location_id': lambda key: key.startswith('test-'),
        '_pos_device_profile': lambda _: {'recommended_scanner_method': 'external_scanner', 'label': 'POS', 'built_in_camera': False},
        '_pos_branch_rows': mapped_rows,
        '_merge_pos_config': lambda integration, patch: {**integration['config'], **patch},
        '_pos_schema_error': lambda exc: exc,
        'supabase': db,
    }
    exec(compile(module, str(path), 'exec'), env)
    return env['save_pos_branch_mappings']


def request(branch='b1', outlet='store-1', preserve=True):
    row = SimpleNamespace(branch_public_id=branch, external_branch_id=outlet,
                          external_branch_name='Existing StoreHub outlet', device_model='other',
                          scanner_method='external_scanner', checkout_mode='companion')
    return SimpleNamespace(provider='storehub', preserve_other_mappings=preserve, mappings=[row])


def existing_mapping(branch_id=102, outlet='store-2'):
    return {'id': 20, 'business_id': 77, 'branch_id': branch_id,
            'integration_id': 999, 'external_branch_id': outlet,
            'external_branch_name': outlet, 'settings': {}, 'is_active': True}


def run(route, req):
    return asyncio.run(route('merchant', req))


def test_single_branch_save_preserves_second_branch_when_transactions_denied():
    db = Database([existing_mapping()])
    result = run(load_route(db), request())
    assert result['branch_mappings']
    original = next(row for row in db.data['pos_branch_mappings'] if row['branch_id'] == 102)
    assert original['is_active'] is True
    assert original['external_branch_id'] == 'store-2'
    assert not any(table == 'pos_branch_mappings' and action == 'update' and values == {'is_active': False}
                   for table, action, values in db.writes)


def test_duplicate_active_outlet_is_rejected_without_writes():
    db = Database([existing_mapping()])
    with pytest.raises(HTTPException) as caught:
        run(load_route(db), request(outlet='store-2'))
    assert caught.value.status_code == 409
    assert db.writes == []


def test_advanced_bulk_editor_retains_original_replace_semantics():
    db = Database([existing_mapping()])
    run(load_route(db), request(preserve=False))
    old = next(row for row in db.data['pos_branch_mappings'] if row['branch_id'] == 102)
    assert old['is_active'] is False


def test_unknown_outlet_does_not_modify_existing_mapping():
    db = Database([existing_mapping()])
    with pytest.raises(HTTPException) as caught:
        run(load_route(db), request(outlet='fake-outlet'))
    assert caught.value.status_code == 400
    assert db.writes == []

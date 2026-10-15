"""StoreHub device binding tests without server startup, credentials or live I/O."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock

LOCAL_SOURCE = Path(__file__).with_name('main.py')
SOURCE = LOCAL_SOURCE if LOCAL_SOURCE.is_file() else Path(__file__).resolve().parents[1] / 'main.py'
NODES = {node.name: node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


class HTTPError(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class Query:
    def __init__(self, database, table):
        self.database, self.name = database, table
        self.filters, self.maximum, self.operation, self.payload = [], None, 'read', None

    def select(self, columns):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def is_(self, key, value):
        self.filters.append((key, None))
        return self

    def in_(self, key, values):
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def order(self, key, desc=False):
        return self

    def update(self, payload):
        self.operation, self.payload = 'update', deepcopy(payload)
        return self

    def insert(self, payload):
        self.operation, self.payload = 'insert', deepcopy(payload)
        return self

    def execute(self):
        table = self.database.tables.setdefault(self.name, [])
        rows = [row for row in table if all(str(row.get(key)) == str(value) for key, value in self.filters)]
        if self.maximum is not None:
            rows = rows[:self.maximum]
        if self.operation == 'insert':
            if self.database.insert_error and self.name == 'pos_devices':
                raise self.database.insert_error
            self.payload.setdefault('id', f'created-{len(table) + 1}')
            table.append(self.payload)
            rows = [self.payload]
        elif self.operation == 'update':
            for row in rows:
                row.update(self.payload)
        return SimpleNamespace(data=deepcopy(rows))


class Database:
    def __init__(self):
        self.tables = {}
        self.ready, self.insert_error = True, None
        self.rpc_calls = []

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, deepcopy(params)))
        def execute():
            if name == 'pos_claim_companion_transaction_customer':
                tx = next((row for row in self.tables.get('pos_transactions', []) if str(row.get('id')) == params['p_transaction_id']), None)
                if not tx or (tx.get('customer_id') is not None and str(tx['customer_id']) != params['p_customer_id']):
                    raise HTTPError(409, 'different member')
                tx['customer_id'] = int(params['p_customer_id'])
                return SimpleNamespace(data=deepcopy(tx))
            if name == 'pos_storehub_register_guard_ready':
                return SimpleNamespace(data=self.ready)
            device = next((row for row in self.tables.get('pos_devices', []) if str(row['id']) == params['p_device_id']), None)
            if name == 'pos_assign_storehub_register':
                metadata = {**device.get('metadata', {}), 'external_terminal_id': params['p_register_id']}
                device['metadata'] = metadata
                return SimpleNamespace(data=deepcopy(device))
            if name == 'pos_record_storehub_registers':
                device['metadata'] = {**device.get('metadata', {}), 'seen_register_ids': params['p_register_ids'],
                                      'seen_register_outlet_id': params['p_external_branch_id']}
                return SimpleNamespace(data=deepcopy(device['metadata']))
            raise AssertionError(name)
        return SimpleNamespace(execute=execute)


def load(names, environment):
    definitions = [deepcopy(NODES[name]) for name in names]
    for node in definitions:
        node.decorator_list = []
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(SOURCE), 'exec'), environment)
    return environment


HELPERS = ['_pos_register_id', '_pos_device_register_id', '_pos_device_seen_register_ids', '_pos_public_device',
           '_pos_storehub_register_required', '_pos_transaction_register_id', '_pos_assert_transaction_register',
           '_pos_device_cache_invalidate', '_pos_register_database_error', '_pos_require_register_guard',
           '_pos_assert_register_available', '_pos_register_management_scope', '_pos_current_register_device',
           '_pos_record_storehub_registers', '_storehub_register_id', '_pos_parse_timestamp']


def device(identifier='device-1', register_id='register-1', branch_id=11, **changes):
    value = {'id': identifier, 'business_id': 7, 'integration_id': 'integration-1', 'branch_id': branch_id,
             'mapping_id': 'mapping-1', 'provider': 'storehub', 'status': 'active', 'device_token_hash': 'secret-hash',
             'display_name': identifier, 'metadata': {'external_terminal_id': register_id} if register_id else {}}
    return {**value, **changes}


class Harness:
    def __init__(self):
        self.db = Database()
        self.business = {'id': 7, 'public_id': 'business-1', 'name': 'ANGKAN', 'plan': 'pro'}
        self.branch = {'id': 11, 'public_id': 'branch-1', 'business_id': 7, 'name': 'Branch', 'is_active': True}
        self.mapping = {'id': 'mapping-1', 'business_id': 7, 'branch_id': 11, 'integration_id': 'integration-1',
                        'external_branch_id': 'outlet-1', 'external_branch_name': 'Outlet', 'is_active': True, 'settings': {}}
        self.integration = {'id': 'integration-1', 'business_id': 7, 'provider': 'storehub', 'mode': 'live',
                            'status': 'live', 'config': {'real_api_tested': True, 'storehub_outlets': [{'id': 'outlet-1'}]}}
        self.manager_branch = None
        self.db.tables = {'pos_devices': [device()], 'pos_branch_mappings': [deepcopy(self.mapping)], 'pos_transactions': []}
        self.env = {
            'HTTPException': HTTPError, 'Optional': Optional, 'datetime': datetime, 'timedelta': timedelta,
            'timezone': timezone, 'Header': lambda **kwargs: '',
            'POSDeviceActivationCodeCreate': object, 'ManagerCompanionActivationCodeCreate': object,
            'POSCompanionActivateRequest': object, 'POSDeviceRegisterUpdate': object,
            'POSCompanionOfflineEvent': object,
            'BackgroundTasks': object,
            'supabase': self.db, '_pos_schema_error': lambda exc: HTTPError(500, str(exc)),
            '_POS_DEVICE_CACHE_LOCK': Lock(), '_POS_DEVICE_AUTH_CACHE': {},
            '_companion_debug': Mock(), 'business_has_plan_feature': lambda business, feature: True,
            '_manager_can_manage_companion': lambda manager: True,
            'require_announcement_session': lambda public_id, auth: ('manager' if self.manager_branch else 'owner', self.business, {}, self.manager_branch),
            '_require_pos_pro_business': lambda public_id, auth: self.business,
            'require_branch_manager_session': lambda public_id, auth: ({}, self.business, {'id': 21}, self.branch),
            'safe_get_branch': lambda public_id: self.branch if public_id == 'branch-1' else None,
            '_get_pos_integration': lambda business_id, provider: self.integration,
            '_companion_mock_mapping': lambda row: deepcopy(self.mapping),
            '_pos_device_profile': lambda model: {'label': model},
            '_pos_loyalty_contract': lambda business: {}, '_pos_redemption_config': lambda integration: {},
            '_companion_is_mock_transaction': lambda tx: tx.get('source') == 'mock_bridge',
            '_companion_pending_offline_receipt_ids': lambda *args: set(),
            'POS_COMPANION_SESSION_TTL_SECONDS': 300,
            '_pos_secret_hash': lambda value: f'hash:{value}',
            'secrets': SimpleNamespace(randbelow=lambda value: 123456, token_urlsafe=lambda value: 'new-device-token'),
            '_manager_companion_mapping': lambda business, branch: (self.mapping, self.integration),
            '_pos_business_by_id': lambda business_id: self.business,
            '_validate_manager_activation_scope': Mock(),
            '_pos_companion_preview_payload': lambda activation: {'business': self.business, 'outlets': [{'id': 'outlet-1', 'name': 'Outlet'}]},
        }
        self.env['_offline_sale_rpc'] = lambda name, params: self.db.rpc(name, params).execute().data
        load(HELPERS, self.env)

    def load(self, *names):
        load(names, self.env)
        return self.env

    def assert_error(self, test, status, callable, *args, **kwargs):
        with test.assertRaises(HTTPError) as caught:
            callable(*args, **kwargs)
        test.assertEqual(caught.exception.status_code, status)
        return caught.exception


class RegisterBindingTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()

    def test_register_id_normalizes_opaque_ids_and_rejects_blank(self):
        normalize = self.h.env['_pos_register_id']
        self.assertEqual(normalize(' Reg-AbC '), 'Reg-AbC')
        self.h.assert_error(self, 400, normalize, '   ', required=True)
        self.h.assert_error(self, 400, normalize, 'x' * 121)

    def test_duplicate_active_register_is_blocked_but_other_branch_allowed(self):
        check = self.h.env['_pos_assert_register_available']
        self.h.assert_error(self, 409, check, 7, 'integration-1', 11, 'register-1')
        check(7, 'integration-1', 11, 'register-1', 'device-1')
        check(7, 'integration-1', 12, 'register-1')
        check(7, 'integration-2', 11, 'register-1')
        self.h.db.tables['pos_devices'][0]['status'] = 'revoked'
        check(7, 'integration-1', 11, 'register-1')

    def test_database_race_is_a_clear_conflict(self):
        error = self.h.env['_pos_register_database_error'](Exception('23505 unique constraint pos_devices_storehub_register_active_uidx'))
        self.assertEqual(error.status_code, 409)
        self.assertIn('another active POS machine', error.detail)

    def test_guard_blocks_pairing_when_migration_missing(self):
        self.h.db.ready = False
        self.h.assert_error(self, 503, self.h.env['_pos_require_register_guard'])
        self.h.db.ready = True
        self.h.env['_pos_require_register_guard']()

    def test_public_device_hides_authentication_hash_and_stale_outlet_ids(self):
        row = device(metadata={'external_terminal_id': ' register-1 ', 'seen_register_ids': ['r2'], 'seen_register_outlet_id': 'old-outlet'})
        public = self.h.env['_pos_public_device'](row, self.h.mapping)
        self.assertNotIn('device_token_hash', public)
        self.assertEqual(public['external_terminal_id'], 'register-1')
        self.assertEqual(public['seen_register_ids'], [])

    def test_discovery_merges_without_overwriting_saved_binding(self):
        row = deepcopy(self.h.db.tables['pos_devices'][0])
        self.h.env['_pos_record_storehub_registers'](row, 'outlet-1', ['other-register', 'register-1'])
        self.assertEqual(row['metadata']['external_terminal_id'], 'register-1')
        self.assertEqual(row['metadata']['seen_register_ids'], ['other-register', 'register-1'])
        before = len(self.h.db.rpc_calls)
        self.h.env['_pos_record_storehub_registers'](row, 'outlet-1', ['other-register'])
        self.assertEqual(len(self.h.db.rpc_calls), before)

    def test_current_binding_comes_from_database_not_authentication_cache(self):
        cached = device(register_id='old-register')
        current = self.h.env['_pos_current_register_device'](cached)
        self.assertEqual(current['metadata']['external_terminal_id'], 'register-1')
        self.h.db.tables['pos_devices'][0]['status'] = 'revoked'
        self.h.assert_error(self, 401, self.h.env['_pos_current_register_device'], cached)

    def test_multi_device_unbound_branch_fails_closed_but_peek_is_allowed(self):
        self.h.db.tables['pos_devices'] = [device(register_id=''), device('device-2', 'register-2')]
        self.h.assert_error(self, 409, self.h.env['_pos_current_register_device'], device(register_id=''))
        current = self.h.env['_pos_current_register_device'](device(register_id=''), require_unambiguous=False)
        self.assertFalse(current['metadata'])
        self.h.db.tables['pos_devices'] = [device(register_id='')]
        self.assertEqual(self.h.env['_pos_current_register_device'](device(register_id=''))['id'], 'device-1')

    def test_pure_simulator_keeps_unbound_multi_device_flow(self):
        self.h.integration.update({'mode': 'test', 'config': {'simulator': True, 'real_api_tested': False}})
        self.h.db.tables['pos_devices'] = [device(register_id=''), device('device-2', '')]
        self.assertEqual(self.h.env['_pos_current_register_device'](device(register_id=''))['id'], 'device-1')
        self.assertFalse(self.h.env['_pos_storehub_register_required'](self.h.integration))
        self.h.integration['config']['real_api_tested'] = True
        self.assertTrue(self.h.env['_pos_storehub_register_required'](self.h.integration))

    def test_simulator_code_can_be_created_without_register_or_migration(self):
        self.h.integration.update({'mode': 'test', 'config': {'simulator': True, 'real_api_tested': False}})
        self.h.db.ready = False
        env = self.h.load('create_pos_device_activation_code', 'create_manager_companion_activation_code')
        req = SimpleNamespace(provider='storehub', external_terminal_id=None, branch_public_id='branch-1',
                              external_branch_id='outlet-1', external_branch_name='Outlet', device_name=None,
                              expires_in_minutes=15, max_uses=1)
        result = env['create_pos_device_activation_code']('business-1', req, 'owner-auth')
        self.assertFalse(result['register_required'])
        self.assertIsNone(result['external_terminal_id'])
        result = env['create_manager_companion_activation_code']('business-1', None, 'manager-auth')
        self.assertFalse(result['register_required'])

    def test_candidates_reject_wrong_or_missing_register_using_fresh_binding(self):
        env = self.h.load('_companion_session_candidates')
        now = datetime.now(timezone.utc)
        session = {'scanned_at': now.isoformat(), 'expires_at': (now + timedelta(minutes=5)).isoformat(), 'customer_id': 99}
        def transaction(identifier, register):
            return {'id': identifier, 'integration_id': 'integration-1', 'branch_id': 11, 'transaction_type': 'sale',
                    'status': 'received', 'gross_amount': 125, 'transacted_at': now.isoformat(),
                    'processing_metadata': {'bridge_external_terminal_id': register}}
        rows = [transaction('right', 'register-1'), transaction('wrong', 'cached-register'), transaction('missing', None)]
        result = env['_companion_session_candidates'](device(register_id='cached-register'), session, rows)
        self.assertEqual([row['id'] for row in result], ['right'])

    def test_candidates_skip_receipts_reserved_for_an_earlier_offline_sale(self):
        env = self.h.load('_companion_session_candidates')
        env['_companion_pending_offline_receipt_ids'] = lambda *args: {'earlier'}
        now = datetime.now(timezone.utc)
        session = {'scanned_at': now.isoformat(), 'expires_at': (now + timedelta(minutes=5)).isoformat(), 'customer_id': 99}
        rows = [{'id': identifier, 'integration_id': 'integration-1', 'branch_id': 11,
                 'transaction_type': 'sale', 'status': 'received', 'gross_amount': 125,
                 'transacted_at': now.isoformat(), 'processing_metadata': {'bridge_external_terminal_id': 'register-1'}}
                for identifier in ('earlier', 'current')]
        self.assertEqual([row['id'] for row in env['_companion_session_candidates'](device(), session, rows)], ['current'])

    def test_owner_code_locks_branch_outlet_register_and_device_name(self):
        env = self.h.load('create_pos_device_activation_code')
        req = SimpleNamespace(provider='storehub', external_terminal_id=' register-2 ', branch_public_id='branch-1',
                              external_branch_id='outlet-1', external_branch_name='Outlet', device_name='Counter 2',
                              expires_in_minutes=15, max_uses=1)
        result = env['create_pos_device_activation_code']('business-1', req, 'owner-auth')
        self.assertEqual(result['external_terminal_id'], 'register-2')
        metadata = self.h.db.tables['pos_device_activation_codes'][0]['metadata']
        self.assertEqual(metadata['allowed_branch_id'], 11)
        self.assertEqual(metadata['allowed_external_branch_id'], 'outlet-1')
        self.assertEqual(metadata['allowed_external_terminal_id'], 'register-2')
        self.assertEqual(metadata['device_name'], 'Counter 2')
        req.external_branch_id = 'other-outlet'
        self.h.assert_error(self, 409, env['create_pos_device_activation_code'], 'business-1', req, 'owner-auth')
        req.branch_public_id = 'someone-elses-branch'
        self.h.assert_error(self, 404, env['create_pos_device_activation_code'], 'business-1', req, 'owner-auth')

    def test_manager_code_uses_only_assigned_branch_and_requires_permission(self):
        env = self.h.load('create_manager_companion_activation_code')
        result = env['create_manager_companion_activation_code']('business-1', SimpleNamespace(external_terminal_id='register-2', device_name=None), 'manager-auth')
        self.assertEqual(result['branch_public_id'], 'branch-1')
        self.assertIsNone(result['device_name'])
        self.h.env['_manager_can_manage_companion'] = lambda manager: False
        self.h.assert_error(self, 403, env['create_manager_companion_activation_code'], 'business-1', SimpleNamespace(external_terminal_id='register-3'), 'manager-auth')

    def test_activation_copies_locked_register_without_apk_field(self):
        activation = {'id': 'code-1', 'business_id': 7, 'provider': 'storehub', 'used_count': 0,
                      'metadata': {'allowed_branch_id': 11, 'allowed_branch_public_id': 'branch-1',
                                   'allowed_external_branch_id': 'outlet-1', 'allowed_external_terminal_id': 'register-2', 'device_name': 'Counter 2'}}
        self.h.env['_pos_activation_row'] = lambda code: deepcopy(activation)
        env = self.h.load('activate_pos_companion_device')
        req = SimpleNamespace(activation_code='123456', branch_public_id='branch-1', external_branch_id='outlet-1',
                              external_branch_name=None, external_terminal_id=None, hardware_model='other', scanner_method='hardware',
                              checkout_mode='floating', overlay_enabled=False, app_version='old-apk')
        result = env['activate_pos_companion_device'](req)
        self.assertEqual(result['device']['external_terminal_id'], 'register-2')
        self.assertEqual(result['device']['display_name'], 'Counter 2')
        self.assertNotIn('device_token_hash', result['device'])
        req.external_terminal_id = 'different-register'
        self.h.assert_error(self, 403, env['activate_pos_companion_device'], req)

    def test_real_storehub_unbound_activation_rejects_legacy_code_before_any_write(self):
        self.h.db.ready = False
        self.h.env['_pos_activation_row'] = lambda code: {'id': 'old-code', 'business_id': 7, 'provider': 'storehub', 'metadata': {}}
        env = self.h.load('activate_pos_companion_device')
        req = SimpleNamespace(activation_code='123456', branch_public_id='branch-1', external_branch_id='outlet-1',
                              external_branch_name=None, external_terminal_id=None, hardware_model='other', scanner_method='hardware',
                              checkout_mode='floating', overlay_enabled=False, app_version='old-apk')
        before = deepcopy(self.h.db.tables)
        error = self.h.assert_error(self, 400, env['activate_pos_companion_device'], req)
        self.assertIn('Generate a new pairing code', error.detail)
        self.assertIn('Register ID', error.detail)
        self.assertEqual(self.h.db.tables, before)
        self.assertFalse(self.h.db.rpc_calls)

    def test_pure_simulator_activation_keeps_legacy_unbound_code_compatible(self):
        self.h.integration.update({'mode': 'test', 'config': {'simulator': True, 'real_api_tested': False}})
        self.h.db.ready = False
        self.h.env['_pos_activation_row'] = lambda code: {'id': 'old-code', 'business_id': 7, 'provider': 'storehub', 'metadata': {}}
        env = self.h.load('activate_pos_companion_device')
        req = SimpleNamespace(activation_code='123456', branch_public_id='branch-1', external_branch_id='outlet-1',
                              external_branch_name=None, external_terminal_id=None, hardware_model='other', scanner_method='hardware',
                              checkout_mode='floating', overlay_enabled=False, app_version='old-apk')
        result = env['activate_pos_companion_device'](req)
        self.assertIsNone(result['device']['external_terminal_id'])
        self.assertEqual(result['device']['status'], 'active')
        self.assertFalse(any(name == 'pos_storehub_register_guard_ready' for name, params in self.h.db.rpc_calls))

    def test_loyverse_activation_still_allows_no_storehub_register(self):
        self.h.integration['provider'] = 'loyverse'
        self.h.db.ready = False
        self.h.env['_pos_activation_row'] = lambda code: {'id': 'loyverse-code', 'business_id': 7, 'provider': 'loyverse', 'metadata': {}}
        env = self.h.load('activate_pos_companion_device')
        req = SimpleNamespace(activation_code='123456', branch_public_id='branch-1', external_branch_id='outlet-1',
                              external_branch_name=None, external_terminal_id=None, hardware_model='other', scanner_method='hardware',
                              checkout_mode='floating', overlay_enabled=False, app_version='old-apk')
        result = env['activate_pos_companion_device'](req)
        self.assertIsNone(result['device']['external_terminal_id'])
        self.assertEqual(result['device']['provider'], 'loyverse')
        self.assertFalse(any(name == 'pos_storehub_register_guard_ready' for name, params in self.h.db.rpc_calls))

    def test_real_storehub_legacy_code_with_supplied_id_records_id_on_active_insert(self):
        self.h.env['_pos_activation_row'] = lambda code: {'id': 'old-code', 'business_id': 7, 'provider': 'storehub', 'metadata': {}}
        env = self.h.load('activate_pos_companion_device')
        req = SimpleNamespace(activation_code='123456', branch_public_id='branch-1', external_branch_id='outlet-1',
                              external_branch_name=None, external_terminal_id=' register-2 ', hardware_model='other', scanner_method='hardware',
                              checkout_mode='floating', overlay_enabled=False, app_version='new-apk')
        result = env['activate_pos_companion_device'](req)
        created = self.h.db.tables['pos_devices'][-1]
        self.assertEqual(created['status'], 'active')
        self.assertEqual(created['metadata']['external_terminal_id'], 'register-2')
        self.assertEqual(created['metadata']['activation_code_id'], 'old-code')
        self.assertEqual(result['device']['external_terminal_id'], 'register-2')
        self.assertTrue(any(name == 'pos_storehub_register_guard_ready' for name, params in self.h.db.rpc_calls))

    def test_activation_duplicate_race_returns_409(self):
        self.h.db.insert_error = Exception('23505 pos_devices_storehub_register_active_uidx')
        self.h.env['_pos_activation_row'] = lambda code: {'id': 'code', 'business_id': 7, 'provider': 'storehub', 'metadata': {'allowed_external_terminal_id': 'register-2'}}
        env = self.h.load('activate_pos_companion_device')
        req = SimpleNamespace(activation_code='123456', branch_public_id='branch-1', external_branch_id='outlet-1',
                              external_branch_name=None, external_terminal_id=None, hardware_model='other', scanner_method='hardware',
                              checkout_mode='floating', overlay_enabled=False, app_version='old-apk')
        self.h.assert_error(self, 409, env['activate_pos_companion_device'], req)

    def test_register_edit_is_atomic_sanitized_and_invalidates_cache(self):
        env = self.h.load('set_pos_device_register')
        env['_POS_DEVICE_AUTH_CACHE'] = {'token': (999999999, device())}
        self.h.db.tables['pos_devices'][0]['metadata']['seen_register_ids'] = ['register-1']
        result = asyncio.run(env['set_pos_device_register']('business-1', 'device-1', SimpleNamespace(external_terminal_id='new-register'), 'owner-auth'))
        self.assertEqual(result['device']['metadata']['seen_register_ids'], ['register-1'])
        self.assertEqual(result['device']['external_terminal_id'], 'new-register')
        self.assertNotIn('device_token_hash', result['device'])
        self.assertFalse(env['_POS_DEVICE_AUTH_CACHE'])
        self.assertTrue(any(name == 'pos_assign_storehub_register' for name, params in self.h.db.rpc_calls))

    def test_manager_cannot_assign_another_branch_register(self):
        self.h.manager_branch = {**self.h.branch, 'id': 12}
        env = self.h.load('set_pos_device_register')
        with self.assertRaises(HTTPError) as caught:
            asyncio.run(env['set_pos_device_register']('business-1', 'device-1', SimpleNamespace(external_terminal_id='new-register'), 'manager-auth'))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertFalse(self.h.db.rpc_calls)

    def test_exact_receipt_paths_reject_wrong_missing_or_unmapped_register(self):
        env = self.h.load('_pos_companion_exact_transaction')
        transaction = {'id': 'transaction-1', 'integration_id': 'integration-1', 'branch_id': 11,
                       'external_transaction_id': 'sale-1', 'processing_metadata': {'bridge_external_terminal_id': 'other-register'}}
        self.h.db.tables['pos_transactions'] = [transaction]
        self.h.assert_error(self, 409, env['_pos_companion_exact_transaction'], device(), 'sale-1')
        transaction['processing_metadata'] = {}
        self.h.assert_error(self, 409, env['_pos_companion_exact_transaction'], device(), 'sale-1')
        transaction['raw_payload'] = {'registerId': 'register-1', 'terminalId': 'different-alias'}
        self.assertEqual(env['_pos_companion_exact_transaction'](device(register_id='old-cached-register'), 'sale-1')['id'], 'transaction-1')
        transaction['branch_id'] = None
        self.h.assert_error(self, 409, env['_pos_companion_exact_transaction'], device(), 'sale-1')

    def test_offline_exact_receipt_does_not_link_or_ack_wrong_register(self):
        env = self.h.load('_pos_offline_resolve_and_match')
        customer = {'id': 99, 'public_id': 'customer-1', 'business_id': 7}
        env.update({'_pos_scan_customer_public_id': lambda value: value, 'safe_get_customer': lambda value: customer,
                    '_pos_companion_program_rows': lambda customer, business_id: [],
                    'safe_get_customer_program': lambda customer, business_id: {}, 'program_reward_uses_points': lambda program: False})
        event = SimpleNamespace(client_event_id='offline-event-1', event_type='earn', customer_ref='customer-1',
                                external_transaction_id='sale-1', reservation_id=None, currency='PHP', gross_amount=125,
                                occurred_at=datetime.now(timezone.utc), metadata={})
        for status in ('received', 'loyalty_applied'):
            for register in ('other-register', None):
                with self.subTest(status=status, register=register):
                    tx = {'id': 'transaction-1', 'integration_id': 'integration-1', 'branch_id': 11,
                          'external_transaction_id': 'sale-1', 'status': status,
                          'processing_metadata': {'bridge_external_terminal_id': register}}
                    self.h.db.tables['pos_transactions'] = [tx]
                    self.h.assert_error(self, 409, env['_pos_offline_resolve_and_match'], device(), event)
                    self.assertNotIn('customer_id', tx)
                    self.assertFalse(self.h.db.tables.get('pos_companion_offline_events'))
        tx['processing_metadata']['bridge_external_terminal_id'] = 'register-1'
        tx['status'] = 'received'
        result = env['_pos_offline_resolve_and_match'](device(register_id='stale-register'), event)
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(tx['customer_id'], 99)

    def test_transaction_preview_exposes_canonical_register(self):
        env = self.h.load('_storehub_transaction_summary')
        result = env['_storehub_transaction_summary']({'storeId': 'outlet-1', 'registerId': 'correct', 'terminalId': 'wrong'})
        self.assertEqual(result['register_id'], 'correct')

    def test_process_rechecks_changed_register_before_mutation_or_duplicate_ack(self):
        env = self.h.load('_companion_claim_transaction_customer', '_companion_process_transaction')
        background_tasks = Mock()
        self.h.db.tables['pos_devices'][0]['metadata']['external_terminal_id'] = 'new-register'
        session = {'id': 'session-1', 'customer_id': 99}
        for status in ('received', 'loyalty_applied'):
            with self.subTest(status=status):
                transaction = {'id': 'transaction-1', 'integration_id': 'integration-1', 'branch_id': 11,
                               'customer_id': 99, 'status': status, 'transaction_type': 'sale',
                               'processing_metadata': {'bridge_external_terminal_id': 'register-1'}}
                with self.assertRaises(HTTPError) as caught:
                    asyncio.run(env['_companion_process_transaction'](device(), session, transaction, background_tasks))
                self.assertEqual(caught.exception.status_code, 409)
                self.assertFalse(self.h.db.tables.get('pos_companion_sessions'))
                self.assertFalse(self.h.db.tables.get('customers'))
                background_tasks.add_task.assert_not_called()
        self.h.env['_companion_session_public'] = lambda row: row
        self.h.db.tables['pos_companion_sessions'] = [deepcopy(session)]
        transaction['processing_metadata']['bridge_external_terminal_id'] = 'new-register'
        transaction['business_id'] = 7
        self.h.db.tables['pos_transactions'] = [deepcopy(transaction)]
        result = asyncio.run(env['_companion_process_transaction'](device(), session, transaction, background_tasks))
        self.assertTrue(result['duplicate_prevented'])
        self.assertEqual(result['session']['status'], 'completed')

    def test_discovery_is_outlet_scoped_and_uses_canonical_register_id(self):
        self.h.env['_storehub_is_placeholder_location_id'] = lambda outlet: False
        fetch = Mock(return_value=({}, [
            {'storeId': 'outlet-1', 'registerId': 'canonical', 'terminalId': 'wrong-alias'},
            {'storeId': 'other-outlet', 'registerId': 'other-register'},
        ], {}))
        self.h.env['_storehub_fetch_recent_transaction_rows'] = fetch
        env = self.h.load('discover_pos_storehub_registers')
        result = env['discover_pos_storehub_registers']('business-1', 'branch-1', 'owner-auth')
        self.assertIn('canonical', result['seen_register_ids'])
        self.assertNotIn('other-register', result['seen_register_ids'])
        self.assertNotIn('wrong-alias', result['seen_register_ids'])
        self.assertEqual(fetch.call_args.kwargs['external_branch_id'], 'outlet-1')
        self.assertFalse(self.h.db.tables['pos_transactions'])
        self.h.manager_branch = self.h.branch
        self.h.assert_error(self, 403, env['discover_pos_storehub_registers'], 'business-1', 'other-branch', 'manager-auth')


if __name__ == '__main__':
    unittest.main()

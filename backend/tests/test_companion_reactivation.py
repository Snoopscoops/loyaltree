"""Manager recovery routes without server startup or external calls."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest

from test_pos_register_binding import Harness, HTTPError, device


class ReactivationTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        self.h.db.tables['pos_devices'][0]['device_token_hash'] = 'a' * 64
        self.h.db.tables['pos_devices'][0]['activated_at'] = '2026-10-09T01:00:00Z'
        self.request = SimpleNamespace(reactivate_device_id='device-1', external_terminal_id='register-1', device_name='Ignored rename')

    def generate(self):
        env = self.h.load('create_manager_companion_activation_code')
        return env['create_manager_companion_activation_code']('business-1', self.request, 'manager-auth')

    def test_generation_keeps_current_device_and_creates_scoped_code_only(self):
        original = deepcopy(self.h.db.tables['pos_devices'])
        result = self.generate()
        self.assertEqual(original, self.h.db.tables['pos_devices'])
        self.assertEqual(result['reactivate_device_id'], 'device-1')
        self.assertEqual(result['device_name'], 'device-1')
        self.assertNotIn('reactivate_expected_token_hash', result)
        payload = self.h.db.tables['pos_device_activation_codes'][0]
        scope = payload['metadata']
        self.assertEqual(payload['max_uses'], 1)
        self.assertEqual(scope['reactivate_expected_token_hash'], 'a' * 64)
        self.assertEqual(scope['reactivate_integration_id'], 'integration-1')
        self.assertEqual(scope['reactivate_mapping_id'], 'mapping-1')
        self.assertEqual(scope['allowed_external_terminal_id'], 'register-1')

    def test_generation_can_reuse_the_saved_register_without_an_apk_field(self):
        self.request.external_terminal_id = None
        self.assertEqual(self.generate()['external_terminal_id'], 'register-1')

    def test_reactivation_cannot_change_the_saved_register(self):
        self.request.external_terminal_id = 'new-register'
        self.h.assert_error(self, 409, self.generate)
        self.assertFalse(self.h.db.tables.get('pos_device_activation_codes'))

    def test_unknown_other_branch_or_business_target_is_rejected(self):
        for changes in ({'id': 'other'}, {'branch_id': 12}, {'business_id': 8}):
            with self.subTest(changes=changes):
                self.h.db.tables['pos_devices'] = [device(**changes)]
                self.h.assert_error(self, 409, self.generate)
        self.assertFalse(self.h.db.tables.get('pos_device_activation_codes'))

    def test_inactive_remapped_provider_or_missing_binding_is_rejected(self):
        original = deepcopy(self.h.db.tables['pos_devices'][0])
        mutations = ({'status': 'disabled'}, {'revoked_at': '2026-10-01'}, {'provider': 'loyverse'},
                     {'integration_id': 'other'}, {'mapping_id': 'other'}, {'device_token_hash': ''}, {'metadata': {}})
        for changes in mutations:
            with self.subTest(changes=changes):
                self.h.db.tables['pos_devices'] = [{**original, **changes}]
                self.h.assert_error(self, 409, self.generate)
        self.assertFalse(self.h.db.tables.get('pos_device_activation_codes'))

    def test_other_device_with_same_register_still_blocks_generation(self):
        self.h.db.tables['pos_devices'].append(device('device-2', 'register-1'))
        self.h.assert_error(self, 409, self.generate)
        self.assertFalse(self.h.db.tables.get('pos_device_activation_codes'))

    def test_add_pos_still_rejects_existing_register(self):
        self.request.reactivate_device_id = None
        self.h.assert_error(self, 409, self.generate)

    def test_manager_permission_still_required_for_reactivation(self):
        self.h.env['_manager_can_manage_companion'] = lambda manager: False
        self.h.assert_error(self, 403, self.generate)
        self.assertFalse(self.h.db.tables.get('pos_device_activation_codes'))

    def test_consumed_reactivation_code_cannot_preview_again(self):
        self.generate()
        env = self.h.load('_pos_activation_row')
        row = self.h.db.tables['pos_device_activation_codes'][0]
        self.assertIsNotNone(env['_pos_activation_row']('223456'))
        row['used_count'] = 1
        self.assertIsNone(env['_pos_activation_row']('223456'))

    def test_manager_device_response_names_actual_provider(self):
        env = self.h.load('_manager_companion_devices')
        self.h.db.tables['pos_devices'].append(device('device-2', 'unused', provider='loyverse'))
        result = env['_manager_companion_devices'](self.h.business, self.h.branch)
        self.assertEqual([row['provider'] for row in result], ['storehub', 'loyverse'])
        self.assertEqual(result[0]['integration_id'], 'integration-1')
        self.assertEqual(result[0]['mapping_id'], 'mapping-1')
        self.assertTrue(all('device_token_hash' not in row for row in result))

    def activate_environment(self):
        self.generate()
        activation = deepcopy(self.h.db.tables['pos_device_activation_codes'][0])
        self.h.env['_pos_activation_row'] = lambda code: activation
        env = self.h.load('activate_pos_companion_device')
        request = SimpleNamespace(activation_code='223456', branch_public_id='branch-1', external_branch_id='outlet-1',
                                  external_branch_name=None, external_terminal_id=None, hardware_model='sunmi_d3_pro',
                                  scanner_method='hardware', checkout_mode='floating', overlay_enabled=True, app_version='0.7.0')
        return env, request

    def test_existing_apk_activation_rotates_with_rpc_and_keeps_response_contract(self):
        env, request = self.activate_environment()
        original_rpc = self.h.db.rpc
        captured = []
        def rpc(name, params):
            if name != 'pos_reactivate_companion_device':
                return original_rpc(name, params)
            captured.append((name, params))
            current = self.h.db.tables['pos_devices'][0]
            current['device_token_hash'] = params['p_device_token_hash']
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=deepcopy(current)))
        self.h.db.rpc = rpc
        self.h.env['_POS_DEVICE_AUTH_CACHE']['old-token'] = (float('inf'), device())
        result = env['activate_pos_companion_device'](request)
        self.assertEqual(len(self.h.db.tables['pos_devices']), 1)
        self.assertEqual(result['device']['id'], 'device-1')
        self.assertEqual(result['device']['external_terminal_id'], 'register-1')
        self.assertEqual(result['device_token'], 'new-device-token')
        self.assertEqual(set(result), {'ok','device_token','device','business','branch','outlet','loyalty_contract','redemption_config','message'})
        self.assertNotIn('device_token_hash', result['device'])
        self.assertFalse(self.h.env['_POS_DEVICE_AUTH_CACHE'])
        self.assertEqual(captured[0][1]['p_code_hash'], 'hash:223456')
        self.assertEqual(captured[0][1]['p_device_token_hash'], 'hash:new-device-token')
        self.assertEqual(captured[0][1]['p_app_version'], '0.7.0')

    def test_missing_rpc_is_a_clear_setup_error_without_device_write(self):
        env, request = self.activate_environment()
        original = deepcopy(self.h.db.tables['pos_devices'])
        self.h.db.rpc = lambda name, params: SimpleNamespace(execute=lambda: (_ for _ in ()).throw(Exception('PGRST202 could not find the function')))
        error = self.h.assert_error(self, 503, env['activate_pos_companion_device'], request)
        self.assertIn('Supabase', error.detail)
        self.assertEqual(original, self.h.db.tables['pos_devices'])

    def test_rpc_scope_failure_has_conflict_and_does_not_insert_a_device(self):
        env, request = self.activate_environment()
        self.h.db.rpc = lambda name, params: SimpleNamespace(execute=lambda: (_ for _ in ()).throw(Exception('P0001 Companion reactivation scope changed')))
        self.h.assert_error(self, 409, env['activate_pos_companion_device'], request)
        self.assertEqual(len(self.h.db.tables['pos_devices']), 1)

    def test_activation_cannot_move_to_another_register_before_rpc(self):
        env, request = self.activate_environment()
        request.external_terminal_id = 'register-2'
        before = len(self.h.db.rpc_calls)
        self.h.assert_error(self, 403, env['activate_pos_companion_device'], request)
        self.assertEqual(before, len(self.h.db.rpc_calls))


if __name__ == '__main__':
    unittest.main()

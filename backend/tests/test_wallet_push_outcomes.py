"""Synthetic provider tests for truthful, private notification acknowledgement."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock

from backend.apple_delivery import DeliveryCount

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
NAMES = {'_log_google_push_outcome', 'send_wallet_class_message', 'send_wallet_object_message',
    'sync_cl_wallet_object', 'sync_cl_apple_wallet_pass', 'create_cl_announcement'}
NODES = [node for node in ast.parse(SOURCE.read_text()).body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES]
for node in NODES:
    node.decorator_list = []
CODE = compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec')


def fixture(status=200, error=None):
    response = SimpleNamespace(status_code=status,
        json=lambda: {'error': {'status': 'RESOURCE_EXHAUSTED', 'message': 'private email@customer.test token'}},
        text='private raw provider body')
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=False)
    client.post = Mock(side_effect=error, return_value=response)
    env = dict(Optional=Optional, CLAnnouncementCreate=object, Header=lambda **kwargs: None,
        get_google_access_token=Mock(return_value='private-provider-token'),
        pooled_client=lambda: client, log_event=Mock())
    exec(CODE, env)
    return env, client


class GooglePushOutcomeTests(unittest.TestCase):
    def test_success_is_provider_acceptance_never_phone_delivery(self):
        env, client = fixture()
        self.assertTrue(env['send_wallet_class_message']('private-class', 'Private title', 'Private body', 'private-id'))
        event = env['log_event'].call_args
        self.assertEqual(event.args, ('google_push_summary', 'info'))
        self.assertEqual(event.kwargs['google_accepted'], 1)
        self.assertEqual(event.kwargs['delivery_status'], 'unconfirmed')
        self.assertEqual(event.kwargs['count_basis'], 'provider_requests')
        self.assertNotIn('private', str(event))
        self.assertEqual(client.post.call_count, 1)

    def test_failure_keeps_status_and_allowlisted_code_without_provider_body(self):
        env, _ = fixture(429)
        self.assertFalse(env['send_wallet_object_message']('private-object', 'Title', 'Body', 'message'))
        fields = env['log_event'].call_args.kwargs
        self.assertEqual((fields['status'], fields['error_code'], fields['failed']), (429, 'RESOURCE_EXHAUSTED', 1))
        self.assertNotIn('private', str(fields))
        self.assertNotIn('customer', str(fields))

    def test_timeout_logs_type_only_and_missing_credentials_are_skipped(self):
        env, client = fixture(error=TimeoutError('https://private-token/email@customer.test'))
        self.assertFalse(env['send_wallet_object_message']('object', 'Title', 'Body', 'message'))
        self.assertEqual(env['log_event'].call_args.kwargs['error_type'], 'TimeoutError')
        self.assertNotIn('private', str(env['log_event'].call_args))
        env['get_google_access_token'].return_value = None
        self.assertFalse(env['send_wallet_class_message']('class', 'Title', 'Body', 'message'))
        fields = env['log_event'].call_args.kwargs
        self.assertEqual((fields['attempted'], fields['failed'], fields['skipped']), (0, 0, 1))
        self.assertEqual(client.post.call_count, 1)

    def test_cl_sync_propagates_actual_notification_result(self):
        env, client = fixture()
        client.patch.return_value = SimpleNamespace(status_code=200)
        env['build_cl_wallet_object'] = Mock(return_value={'id': 'private-object'})
        env['send_wallet_object_message'] = Mock(return_value=False)
        self.assertFalse(env['sync_cl_wallet_object']({}, {}, {}, notify_header='Title', notify_message_id='message'))
        env['send_wallet_object_message'].return_value = True
        self.assertTrue(env['sync_cl_wallet_object']({}, {}, {}, notify_header='Title', notify_message_id='message'))

    def test_cl_broadcast_retains_partial_and_queued_counts(self):
        env, _ = fixture()
        table = Mock()
        table.select.return_value = table.eq.return_value = table.insert.return_value = table.update.return_value = table
        table.execute.side_effect = [SimpleNamespace(count=3), SimpleNamespace(data=[{'id': 12}]), SimpleNamespace(data=[])]
        env.update(asyncio=asyncio, require_owner_session=Mock(),
            safe_get_business=Mock(return_value={'id': 1, 'public_id': 'one', 'name': 'One'}),
            supabase=SimpleNamespace(table=lambda name: table), generate_public_id=lambda: 'generated',
            GOOGLE_WALLET_ISSUER_ID='issuer', send_wallet_class_message=Mock(return_value=False),
            push_cl_apple_wallet_announcement=Mock(return_value=DeliveryCount(1,
                targets=2, attempted=2, retryable_failed=1, queued=1)))
        announcement = SimpleNamespace(customer_public_id=None, title='Title', message='Message')
        result = asyncio.run(env['create_cl_announcement']('one', announcement, 'Bearer owner'))
        fields = env['log_event'].call_args.kwargs
        self.assertEqual(result['sent_count'], 1)
        self.assertEqual((fields['apple_ok'], fields['apple_failed'], fields['apple_queued']), (1, 1, 1))
        self.assertIsNone(fields['google_failed'])  # False may mean no saved pass/configuration.
        self.assertEqual(fields['google_not_accepted'], 1)
        self.assertEqual(result['delivery_status'], 'unconfirmed')


if __name__ == '__main__':
    unittest.main()

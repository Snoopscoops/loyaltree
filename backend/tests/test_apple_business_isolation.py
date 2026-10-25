"""A shared phone token must never expand the business's pass audience."""
import ast
import hashlib
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from backend.apple_delivery import AppleDelivery

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'


class BusinessIsolationTests(unittest.TestCase):
    def test_announcement_and_card_edit_only_dirty_sending_business(self):
        customers = [dict(public_id='swoosh-1', business_id=1), dict(public_id='laybare-1', business_id=2)]
        registrations = [dict(serial_number='swoosh-1', push_token='shared-phone', pass_type_identifier='pass.test'),
                         dict(serial_number='laybare-1', push_token='shared-phone', pass_type_identifier='pass.test')]
        marked, queries = [], []
        class Query:
            def __init__(self, table): self.table, self.filters = table, []
            def select(self, *a): return self
            def eq(self, k, v): self.filters.append((k, [v])); return self
            def in_(self, k, v):
                if k == 'push_token': raise AssertionError('Device tokens must not select serials')
                self.filters.append((k, v)); return self
            def execute(self):
                queries.append((self.table, self.filters))
                rows = customers if self.table == 'customers' else registrations
                return SimpleNamespace(data=[r for r in rows if all(r.get(k) in v for k, v in self.filters)])
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.post.return_value = SimpleNamespace(status_code=200)
        env = dict(supabase=SimpleNamespace(table=Query), APPLE_PASS_TYPE_IDENTIFIER='pass.test',
            memory_pressure=SimpleNamespace(paused=lambda: False), _APPLE_DEFERRED_PUSHES={},
            APPLE_PUSH_BATCH_SIZE=20, APPLE_PUSH_BATCH_DELAY_SECONDS=.25,
            _maybe_trim_memory=Mock(),
            APPLE_ORDER_AHEAD_EVENT_BETA_PREFIX='oa-', Optional=__import__('typing').Optional,
            _mark_apple_pass_dirty=lambda serials: marked.extend(serials),
            _APPLE_PKPASS_CACHE={}, get_apple_push_cert_files=lambda: ('cert', 'key'),
            pooled_client=lambda **kw: client, _record_apple_delivery=Mock(), log_event=Mock(),
            print=Mock(), time=SimpleNamespace(sleep=Mock()), build_pkpass_bytes=Mock(),hashlib=hashlib)
        delivery=AppleDelivery(db=lambda:env['supabase'],client=lambda cert:client,cert=env['get_apple_push_cert_files'],
            paused=env['memory_pressure'].paused,log=env['log_event'],fallback=env['_APPLE_DEFERRED_PUSHES'],sleep=Mock())
        env['_apple_push_service']=lambda:delivery
        names = {'_send_apple_wallet_pushes', 'push_apple_wallet_announcement', 'refresh_business_apple_wallet_passes', '_push_apple_wallet_to_customer_public_ids'}
        nodes = [deepcopy(n) for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in names]
        for n in nodes: n.decorator_list = []
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
        for send in (lambda: env['push_apple_wallet_announcement'](1),
                     lambda: env['refresh_business_apple_wallet_passes'](1),
                     lambda: env['_push_apple_wallet_to_customer_public_ids'](['swoosh-1'])):
            marked.clear()
            send()
            self.assertEqual(marked, ['swoosh-1'])
        env['build_pkpass_bytes'].assert_not_called()
        self.assertEqual(client.post.call_count, 3)
        self.assertTrue(queries)


if __name__ == '__main__': unittest.main()

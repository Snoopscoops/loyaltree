import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock
from backend.apple_delivery import AppleDelivery

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'


class PushBatchTests(unittest.TestCase):
    def fixture(self, paused=None):
        node = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == '_send_apple_wallet_pushes')
        node.decorator_list=[]
        client=MagicMock(); client.__enter__.return_value=client
        client.post.return_value=SimpleNamespace(status_code=200)
        sleep=Mock()
        env=dict(memory_pressure=SimpleNamespace(paused=paused or Mock(return_value=False)),
            _APPLE_DEFERRED_PUSHES={}, APPLE_PUSH_BATCH_SIZE=20, APPLE_PUSH_BATCH_DELAY_SECONDS=.25,
            APPLE_PASS_TYPE_IDENTIFIER='pass.test', pooled_client=lambda **kw:client,
            get_apple_push_cert_files=lambda:('cert','key'), log_event=Mock(),
            _record_apple_delivery=Mock(), time=SimpleNamespace(sleep=sleep))
        env['_maybe_trim_memory'] = Mock()
        delivery=AppleDelivery(db=lambda:None,client=lambda cert:client,cert=env['get_apple_push_cert_files'],
            paused=env['memory_pressure'].paused,log=env['log_event'],fallback=env['_APPLE_DEFERRED_PUSHES'],sleep=sleep)
        env['_apple_push_service']=lambda:delivery
        env['delivery']=delivery
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(SOURCE),'exec'),env)
        return env,client,sleep

    def test_sixty_eight_apple_tokens_are_deduplicated_and_sent_in_twenty_token_batches(self):
        env,client,sleep=self.fixture()
        positions=[]
        sleep.side_effect=lambda delay:positions.append(client.post.call_count)
        self.assertEqual(env['_send_apple_wallet_pushes']([str(i) for i in range(68)]+['0']),68)
        self.assertEqual(positions,[20,40,60])
        self.assertEqual(sleep.call_count,3)
        env['_record_apple_delivery'].assert_called_once_with(68,68)

    def test_pressure_mid_burst_defers_remaining_tokens(self):
        env,client,sleep=self.fixture()
        env['delivery'].paused=lambda:client.post.call_count>=20
        self.assertEqual(env['_send_apple_wallet_pushes']([str(i) for i in range(68)]),20)
        self.assertEqual(client.post.call_count,20)
        self.assertEqual(len(env['_APPLE_DEFERRED_PUSHES']),48)


if __name__ == '__main__': unittest.main()

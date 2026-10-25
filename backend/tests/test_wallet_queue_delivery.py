"""Runtime queue contract: no providers before lease ownership, no unsafe fallback."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

SOURCE=Path(__file__).resolve().parents[1]/'main.py'
NODES=[node for node in ast.parse(SOURCE.read_text()).body if isinstance(node,ast.FunctionDef)
    and node.name in {'process_wallet_sync_queue_once','_wallet_provider_sync_failed'}]
CODE=compile(ast.Module(body=NODES,type_ignores=[]),str(SOURCE),'exec')


def fixture(apple=None, recovered=False):
    job=dict(id=223,business_id=1,customer_id=2,reason='lt_benefits',lease_token='synthetic-lease',
        attempts=2,recovered_from_lease=recovered)
    command=Mock(side_effect=lambda action,**data:{'jobs':[job]} if action=='claim' else {'accepted':True})
    env=dict(_wallet_queue_command=command,log_event=Mock(),
        memory_pressure=SimpleNamespace(paused=lambda:False),upgrade_delivery_budget=SimpleNamespace(take=lambda:True),
        safe_get_customer_by_id=Mock(return_value=dict(id=2,business_id=1)),
        safe_get_business_by_id=Mock(return_value=dict(id=1,public_id='one')),
        safe_get_customer_program=Mock(return_value={}),
        sync_apple_wallet_pass=Mock(return_value=apple or {'status':'push_sent'}),
        sync_wallet_object=Mock(return_value={'status':'updated'}),log_wallet_sync=Mock())
    exec(CODE,env)
    return env,job,command


class WalletQueueTests(unittest.TestCase):
    def test_missing_claim_migration_leaves_jobs_unmodified_and_never_calls_providers(self):
        env,job,command=fixture();command.side_effect=RuntimeError('RPC missing')
        env['process_wallet_sync_queue_once']()
        env['sync_apple_wallet_pass'].assert_not_called();env['sync_wallet_object'].assert_not_called()
        self.assertEqual(command.call_count,1)
        self.assertEqual(env['log_event'].call_args.args,('wallet_queue_unavailable','warning'))

    def test_durable_partial_delivery_hands_off_to_target_outbox_without_resending_every_device(self):
        env,job,command=fixture({'status':'push_partial','retry_required':False,'queued':1},recovered=True)
        env['process_wallet_sync_queue_once']()
        command.assert_any_call('finish',id='223',lease_token='synthetic-lease',outcome='completed')
        env['log_event'].assert_any_call('wallet_queue_recovered',recovered=1,expired_failed=0)

    def test_unpersisted_partial_delivery_keeps_upstream_job_retryable(self):
        env,job,command=fixture({'status':'push_partial','retry_required':True})
        env['process_wallet_sync_queue_once']()
        command.assert_any_call('finish',id='223',lease_token='synthetic-lease',outcome='retry',error_type='RuntimeError')
        self.assertNotIn('completed',str(command.call_args_list))

    def test_customer_business_mismatch_never_sends_a_push(self):
        env,job,command=fixture();env['safe_get_customer_by_id'].return_value={'business_id':99}
        env['process_wallet_sync_queue_once']()
        env['sync_apple_wallet_pass'].assert_not_called();env['sync_wallet_object'].assert_not_called()

    def test_memory_deferral_preserves_retry_budget_and_lease_ownership(self):
        env,job,command=fixture();job['reason']='lt_benefits_admin_upgrade_v1'
        env['memory_pressure'].paused=lambda:True
        env['process_wallet_sync_queue_once']()
        command.assert_any_call('finish',id='223',lease_token='synthetic-lease',outcome='deferred')
        env['sync_apple_wallet_pass'].assert_not_called()

    def test_stale_acknowledgement_is_logged_and_does_not_overwrite_current_owner(self):
        env,job,command=fixture()
        command.side_effect=lambda action,**data:{'jobs':[job]} if action=='claim' else {'accepted':False}
        env['process_wallet_sync_queue_once']()
        env['log_event'].assert_called_once_with('wallet_queue_lease_lost','warning',job_id=223)


if __name__=='__main__':unittest.main()

"""Provider fakes: durable handoff/restart, partial outcomes and bounded work."""
import ast
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from backend.apple_delivery import AppleDelivery


class Outbox:
    def __init__(self): self.rows, self.calls, self.fail = {}, [], set()
    def rpc(self, name, args):
        action, data = args['p_action'], args['p_data']
        self.calls.append((action, deepcopy(data)))
        def execute():
            if action in self.fail: raise ConnectionError('private service key must not appear in logs')
            if action == 'enqueue':
                jobs=[]
                for token in data['tokens']:
                    key=(data['business_id'],data['pass_type_identifier'],token)
                    row=next((r for r in self.rows.values() if r['key']==key),None)
                    if row is None:
                        row=dict(id=len(self.rows)+1,key=key,push_token=token,revision=0,attempts=0)
                        self.rows[row['id']]=row
                    row.update(business_id=data['business_id'],business_slug=data.get('business_slug'),
                        pass_type_identifier=data['pass_type_identifier'],revision=row['revision']+1,status='pending')
                    jobs.append({'id':row['id']})
                result={'jobs':jobs}
            elif action == 'claim':
                jobs=[]
                for row in self.rows.values():
                    if row['status']!='pending' or ('ids' in data and row['id'] not in data['ids']): continue
                    row.update(status='processing',lease='lease-'+str(row['id']),attempts=row['attempts']+1)
                    jobs.append(deepcopy(row))
                    if len(jobs)>=data['limit']:break
                result={'jobs':jobs}
            else:
                terminal=0
                for outcome in data['outcomes']:
                    row=self.rows[outcome['id']]
                    if row['lease']!=outcome['lease']:continue
                    if outcome['outcome'] in ('accepted','rejected'):
                        row['status']='completed' if outcome['outcome']=='accepted' else 'failed';terminal+=1
                    else:row['status']='pending'
                result={'terminal':terminal}
            return SimpleNamespace(data=result)
        return SimpleNamespace(execute=execute)


class Provider:
    def __init__(self, outcomes=None): self.outcomes, self.calls = outcomes or {}, []
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def post(self,url,**kwargs):
        token=url.rsplit('/',1)[-1];self.calls.append(token)
        values=self.outcomes.get(token,[])
        value=values.pop(0) if values else 200
        if isinstance(value,Exception):raise value
        status, reason=value if isinstance(value,tuple) else (value,'ServiceUnavailable')
        return SimpleNamespace(status_code=status,json=lambda:{'reason':reason})


def service(db, provider, paused=lambda:False, fallback=None, log=None, sleep=None):
    return AppleDelivery(db=lambda:db,client=lambda cert:provider,cert=lambda:('cert','key'),
        paused=paused,log=log or Mock(),fallback=fallback if fallback is not None else {},sleep=sleep or Mock())


class AppleDeliveryTests(unittest.TestCase):
    def test_partial_failure_retries_only_missed_target_after_service_restart(self):
        db,provider=Outbox(),Provider({'private-missed':[503,200]})
        first=service(db,provider).send(['private-ok','private-missed'],pass_type='pass.test',business_id=1,business_slug='one')
        self.assertEqual(int(first),1)
        self.assertEqual(first.wallet_result()['status'],'push_partial')
        self.assertFalse(first.wallet_result()['retry_required'])
        self.assertEqual(first.details['queued'],1)
        self.assertEqual(service(db,provider).drain('pass.test'),1)
        self.assertEqual(provider.calls,['private-ok','private-missed','private-missed'])
        self.assertTrue(all(r['status']=='completed' for r in db.rows.values()))

    def test_memory_pause_is_durable_before_any_provider_call(self):
        db,provider=Outbox(),Provider()
        result=service(db,provider,paused=lambda:True).send(['private-one'],pass_type='pass.test',business_id=1)
        self.assertEqual(provider.calls,[])
        self.assertEqual(result.wallet_result()['status'],'push_queued')
        self.assertEqual(result.details['deferred'],1)
        self.assertEqual(service(db,provider).drain('pass.test'),1)

    def test_missing_migration_retains_bounded_fallback_and_requires_upstream_retry(self):
        db,provider,fallback,log=Outbox(),Provider({'private-missed':[ConnectionError('https://private-token')]}),{},Mock()
        db.fail.add('enqueue')
        result=service(db,provider,fallback=fallback,log=log).send(['private-ok','private-missed'],pass_type='pass.test',business_id=1)
        self.assertTrue(result.wallet_result()['retry_required'])
        self.assertEqual(len(fallback),1)
        self.assertNotIn('https://private-token',str(log.call_args_list))
        self.assertNotIn('private-missed',str(log.call_args_list))
        db.fail.clear()
        self.assertEqual(service(db,provider,fallback=fallback).drain('pass.test'),1)
        self.assertFalse(fallback)

    def test_lost_acknowledgement_keeps_lease_and_exposes_uncertain_queue_state(self):
        db,provider=Outbox(),Provider();db.fail.add('finish')
        result=service(db,provider).send(['private-one'],pass_type='pass.test',business_id=1)
        self.assertEqual(result,1)
        self.assertEqual(result.details['acknowledgement_uncertain'],1)
        self.assertEqual(result.details['queued'],1)
        self.assertEqual(next(iter(db.rows.values()))['status'],'processing')

    def test_sixty_eight_devices_use_four_bounded_provider_batches_and_nine_rpc_calls(self):
        db,provider=Outbox(),Provider();positions=[]
        result=service(db,provider,sleep=lambda delay:positions.append(len(provider.calls))).send(
            [str(n) for n in range(68)]+['0'],pass_type='pass.test',business_id=1)
        self.assertEqual(result,68);self.assertEqual(positions,[20,40,60])
        self.assertEqual(len(db.calls),9)
        self.assertEqual([len(d['outcomes']) for a,d in db.calls if a=='finish'],[20,20,20,8])

    def test_permanent_token_rejection_is_distinct_from_retryable_provider_failure(self):
        db,provider,log=Outbox(),Provider({'private-token':[(410,'Unregistered')]}),Mock()
        result=service(db,provider,log=log).send(['private-token'],pass_type='pass.test',business_id=1)
        self.assertEqual(result.wallet_result()['status'],'push_rejected')
        self.assertEqual(result.details['permanent_failed'],1)
        self.assertFalse(result.wallet_result()['retry_required'])
        self.assertEqual(result.details['queued'],0)
        summary=log.call_args.kwargs
        self.assertEqual(summary['delivery_status'],'unconfirmed')
        self.assertEqual(summary['outcomes'],[dict(outcome='rejected',status=410,reason='Unregistered',count=1)])
        self.assertNotIn('private-token',str(log.call_args_list))

    def test_business_scope_is_preserved_even_when_two_businesses_share_a_device(self):
        db,provider=Outbox(),Provider()
        first=service(db,provider,paused=lambda:True)
        first.send(['shared'],pass_type='pass.test',business_id=1,business_slug='one')
        first.send(['shared'],pass_type='pass.test',business_id=2,business_slug='two')
        self.assertEqual(len(db.rows),2)
        self.assertEqual({r['business_id'] for r in db.rows.values()},{'1','2'})

    def test_partial_unpersisted_failures_remain_retryable_but_durable_pending_is_not_resent_wholesale(self):
        source=Path(__file__).resolve().parents[1]/'main.py'
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='_wallet_provider_sync_failed')
        env={};exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),env)
        failed=env['_wallet_provider_sync_failed']
        self.assertTrue(failed({'status':'push_partial'},'apple'))
        self.assertTrue(failed({'status':'push_partial','retry_required':True},'apple'))
        self.assertFalse(failed({'status':'push_partial','retry_required':False,'queued':1},'apple'))


if __name__=='__main__':unittest.main()

"""Worker and application seams: no credentials, app startup or live I/O."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import sys
import unittest
from unittest.mock import AsyncMock, Mock
import uuid
BACKEND=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BACKEND))
from storehub_redemption_codes import RedemptionCodeError, RedemptionCodeService, quote, public_code
from test_storehub_offline_sales import Database
SOURCE=BACKEND/'main.py'
NODES={n.name:n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
NOW=datetime.now(timezone.utc)
class HTTPError(Exception):
    def __init__(self,status_code,detail):super().__init__(detail);self.status_code=status_code;self.detail=detail

def load(name,env):
    n=deepcopy(NODES[name]);n.decorator_list=[]
    exec(compile(ast.Module(body=[n],type_ignores=[]),str(SOURCE),'exec'),env)
    return env[name]

def code(**changes):
    return dict(dict(id='code',lease_token='lease',code='LT-ABC123ABC123',status='confirmed',kind='points',
      device_id='device',session_id='session',customer_id=11,earning_customer_id=10,reservation_id='hold',
      business_id=1,branch_id=50,integration_id='int',external_branch_id='outlet',external_terminal_id='register',
      scanned_at=(NOW-timedelta(minutes=2)).isoformat(),confirmed_at=NOW.isoformat(),expires_at=(NOW+timedelta(days=1)).isoformat(),
      gross_amount='200',discount_amount='50',expected_total='150',currency='PHP',receipt_reference='INV-12345',
      name='Reward',payload={'customer_public_id':'employee'}),**changes)
def sale(**changes):
    return dict(dict(id='tx',external_transaction_id='external',external_receipt_number='INV-12345',transaction_type='sale',status='received',
      external_branch_id='outlet',external_terminal_id='register',net_amount='150',currency='PHP',transacted_at=NOW.isoformat(),
      raw_payload={'discount':50}),**changes)
class Worker:
    def __init__(self,c=None,rows=None):
        self.code=c or code();self.jobs=[self.code];self.rows=[sale()] if rows is None else rows;self.complete=True
        self.calls=[];self.context=Mock(return_value={});self.process=AsyncMock(return_value={'ok':True})
        self.release=Mock();self.abort=Mock();self.reverse=Mock();self.finish_error=False
    def rpc(self,name,args):
        self.calls.append((name,args))
        if name=='pos_claim_redemption_codes':return [self.jobs.pop(0)] if self.jobs else []
        if name=='pos_claim_redemption_receipt':return sale()
        if name=='pos_finish_redemption_code':
            if self.finish_error:raise RuntimeError('lost lease')
            return args
        raise AssertionError(name)
    def service(self):return RedemptionCodeService(rpc=self.rpc,context=self.context,fetch=lambda *_:(self.rows,self.complete),
        materialize=lambda row,_:row,process=self.process,release=self.release,abort=self.abort,reverse=self.reverse)
    def finished(self):return [a for n,a in self.calls if n=='pos_finish_redemption_code'][-1]

class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_reward_is_processed_only_after_single_verified_receipt(self):
        for kind in ('points','coupon','benefit'):
            h=Worker(code(kind=kind));await h.service().run_once();h.process.assert_awaited_once()
            self.assertEqual(h.finished()['p_status'],'redeemed');self.assertEqual(h.calls[1][0],'pos_claim_redemption_receipt')
    async def test_no_receipt_or_missing_discount_stays_pending_without_deduction(self):
        for rows in ([],[sale(raw_payload={})],[sale(net_amount=151)]):
            h=Worker(rows=rows);await h.service().run_once();h.process.assert_not_called();self.assertEqual(h.finished()['p_status'],'confirmed')
    async def test_multiple_receipts_and_incomplete_feed_require_review(self):
        h=Worker(rows=[sale(),sale(external_transaction_id='second')]);await h.service().run_once()
        self.assertEqual(h.finished()['p_status'],'needs_review');h.process.assert_not_called()
        h=Worker();h.complete=False;await h.service().run_once();self.assertEqual(h.finished()['p_status'],'needs_review');h.process.assert_not_called()
    async def test_pending_void_releases_without_consuming(self):
        h=Worker(rows=[sale(raw_payload={'isCancelled':True},transaction_type='void')]);await h.service().run_once()
        h.abort.assert_called_once();h.process.assert_not_called();h.release.assert_not_called()
    async def test_voided_committed_receipt_recovers_even_if_device_is_inactive(self):
        for status in ('redeemed','needs_review','confirmed'):
            h=Worker(code(status=status,void_detected=True));h.context.side_effect=AssertionError('must not need active device')
            await h.service().run_once();h.reverse.assert_called_once();h.context.assert_not_called()
    async def test_unused_expiry_releases_even_if_device_is_inactive(self):
        h=Worker(code(status='reserved',confirmed_at=None,expires_at=(NOW-timedelta(seconds=1)).isoformat()))
        h.context.side_effect=AssertionError('not needed');await h.service().run_once()
        h.release.assert_called_once();h.context.assert_not_called();self.assertEqual(h.finished()['p_status'],'expired')
    async def test_access_error_keeps_reward_held_for_review(self):
        h=Worker();h.context.side_effect=RedemptionCodeError('branch reassigned',review=True)
        await h.service().run_once();self.assertEqual(h.finished()['p_status'],'needs_review');h.release.assert_not_called()
    async def test_transient_process_failure_retries_without_claiming_success(self):
        h=Worker();h.process.side_effect=TimeoutError('retry');await h.service().run_once()
        self.assertEqual(h.finished()['p_status'],'confirmed');h.release.assert_not_called()
    async def test_lost_final_ack_does_not_crash_batch_or_release_consumed_reward(self):
        h=Worker();h.finish_error=True;await h.service().run_once();h.process.assert_awaited_once();h.release.assert_not_called()
    async def test_two_worker_instances_do_not_process_one_claim_twice(self):
        h=Worker();await asyncio.gather(h.service().run_once(),h.service().run_once());h.process.assert_awaited_once()

class ApplicationTests(unittest.IsolatedAsyncioTestCase):
    async def test_verified_reward_uses_original_earning_member_and_durable_wallet_queue(self):
        for kind in ('points','coupon','benefit'):
            db=Database();db.tables['customers']=[{'id':10,'public_id':'loyalty'},{'id':11,'public_id':'employee'}]
            engine=AsyncMock(return_value={'loyalty_result':{'points_earned':1}});calls=[]
            def rpc(name,params):calls.append(name);return {'status':'committed'}
            env={'BackgroundTasks':lambda:object(),'supabase':db,'_manual_code_rpc':rpc,'_companion_process_transaction':engine,
                 'safe_get_customer':lambda key:next((r for r in db.tables['customers'] if r['public_id']==key),None),
                 'enqueue_wallet_sync':lambda *args:{'status':'queued','job_id':'job'},'RedemptionCodeError':RedemptionCodeError}
            fn=load('_manual_process',env);c=code(kind=kind)
            await fn(c,{'session':{'result':{'manual_redemption_code_id':c['id']}},'device':{},'business':{}},sale())
            self.assertEqual(calls,['pos_commit_code_reward']);args,kwargs=engine.call_args
            self.assertEqual(args[1]['customer_id'],10);self.assertFalse(kwargs['persist_session']);self.assertEqual(kwargs['manual_redemption_code_id'],'code')
            if kind=='points':self.assertEqual(args[1]['result']['redemption_reservation_id'],'hold')
    async def test_failed_wallet_queue_is_retried_before_final_success(self):
        db=Database();db.tables['customers']=[{'id':10,'public_id':'loyalty'}]
        fn=load('_manual_process',{'BackgroundTasks':lambda:object(),'supabase':db,'_manual_code_rpc':lambda *_:{'status':'committed'},
            '_companion_process_transaction':AsyncMock(return_value={}), 'safe_get_customer':lambda _:db.tables['customers'][0],
            'enqueue_wallet_sync':lambda *_:{'status':'queue_error'},'RedemptionCodeError':RedemptionCodeError})
        with self.assertRaisesRegex(RuntimeError,'retry'):await fn(code(),{'session':{},'device':{},'business':{}},sale())
    async def test_historical_fetch_uses_created_dates_and_keeps_voids(self):
        fetch=Mock(return_value=({},[{'refId':'sale','transactionType':'Sale'},{'refId':'void','transactionType':'Sale','isCancelled':True}],{}))
        fn=load('_manual_fetch',{'_pos_parse_timestamp':lambda t:datetime.fromisoformat(t),'timedelta':timedelta,'datetime':datetime,'timezone':timezone,
            'RedemptionCodeError':RedemptionCodeError,'STOREHUB_TX_PROBE_SLEEP_SECONDS':0,'STOREHUB_TX_PAGE_SIZE':5000,
            '_storehub_fetch_recent_transaction_rows':fetch,'_companion_normalize_provider_transaction':lambda _,r:{'transaction_type':'void' if r.get('isCancelled') else 'sale'}})
        rows,complete=fn(code(),{'integration':{}});self.assertTrue(complete);self.assertEqual(len(rows),2)
        self.assertFalse(fetch.call_args.kwargs['use_paging_hint']);self.assertFalse(fetch.call_args.kwargs['deep_probe'])
    async def test_old_commit_endpoints_reject_code_reservations(self):
        db=Database();db.tables['pos_redemption_codes']=[{'id':'code','reservation_id':'hold','status':'confirmed'}]
        fn=load('_manual_assert_legacy_reservation',{'supabase':db,'HTTPException':HTTPError})
        with self.assertRaises(HTTPError) as error:fn('hold')
        self.assertEqual(error.exception.status_code,409)
    async def test_reserve_builds_server_priced_scoped_payload_for_all_three_types(self):
        for kind in ('points','coupon','benefit'):
            device={'id':'device','business_id':1};session={'id':'session','customer_id':10}
            option={'id':'option','kind':kind,'customer_public_id':'employee','reward_id':'reward','name':'Reward','value_mode':'fixed','value':'50'}
            ctx={'business':{},'mapping':{'external_branch_id':'outlet'}};member={'id':11,'public_id':'employee'}
            config={'hold_minutes':10,'value_per_point':1};requests=[]
            def rpc(name,payload):requests.append((name,payload));return code(kind=kind)
            env={'Header':lambda **_:None,'POSManualRewardReserve':object,'_require_pos_device':lambda _:device,
              '_companion_active_session':lambda _:session,'_manual_options':lambda *_:(ctx,[member],[],[option],config),
              '_loyalty_today':lambda:NOW.date(),'uuid':uuid,'redemption_code_quote':quote,'RedemptionCodeError':RedemptionCodeError,'HTTPException':HTTPError,
              'safe_get_customer_program':lambda *_:{'id':2,'card_type':'employee'},'hashlib':hashlib,'json':json,'Decimal':Decimal,
              '_pos_device_register_id':lambda _:'register','business_currency':lambda _:'PHP',
              'safe_get_active_coupons':lambda _:[{'id':5,'public_id':'reward','birthday_verification_required':True}],
              'get_employee_benefit_statuses':lambda *_:[{'id':'reward','available':True,'benefit_type':'fixed_discount','value':50,'usage_limit':1}],
              '_benefit_window':lambda *_:(NOW,NOW+timedelta(days=1),None),'_manual_code_rpc':rpc,
              '_manual_last_session':lambda _:session,'_companion_session_public':lambda row:row,'public_code':public_code}
            fn=load('companion_redemption_reserve',env)
            req=SimpleNamespace(option_id='option',request_id=str(uuid.uuid4()),gross_amount=Decimal('200'),item_amount=None,birthday_verified=False)
            if kind=='coupon':
                with self.assertRaises(HTTPError) as err:fn(req,'token')
                self.assertEqual(err.exception.status_code,400);self.assertEqual(requests,[])
                req.birthday_verified=True
            result=fn(req,'token');payload=requests[0][1]['p_payload']
            self.assertEqual(payload['expected_total'],'150.00');self.assertEqual(payload['customer_id'],11)
            self.assertEqual(payload['earning_customer_id'],11 if kind=='points' else 10)
            self.assertEqual(requests[0][1]['p_device_id'],'device');self.assertEqual(result['code']['kind'],kind)

if __name__=='__main__':unittest.main()

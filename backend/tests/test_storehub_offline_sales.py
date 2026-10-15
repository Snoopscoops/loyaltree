"""Offline reconciliation tests: no credentials, providers, app startup or live DB."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import threading
import sys
import unittest
from uuid import uuid4

BACKEND = Path(__file__).resolve().parent
if not (BACKEND / 'main.py').exists():
    BACKEND = BACKEND.parent
sys.path.insert(0, str(BACKEND))
SOURCE = BACKEND / 'main.py'

from storehub_offline_sales import (OfflineSalesService, OfflineSaleError,
    normalize_event, matching_sales, overlaps_amount_event, public_event, money)

NOW = datetime(2026, 10, 15, 10, 0, tzinfo=timezone.utc)


def context():
    return dict(device_id='dev-1', business_id='7', branch_id='11', integration_id='int-1',
                business_public_id='angkan', branch_public_id='gateway',
                external_branch_id='outlet-1', external_terminal_id='register-1', currency='PHP')


def event(**changes):
    return {**context(), 'client_event_id': str(uuid4()), 'customer_ref': 'member-1',
            'scanned_at': (NOW - timedelta(days=2, minutes=2)).isoformat(),
            'completed_at': (NOW - timedelta(days=2)).isoformat(),
            'receipt_reference': '', 'receipt_match_mode': 'amount', 'final_amount': '250.00',
            'pending_redemption': False, **changes}


def saved_event(**changes):
    return {**normalize_event(event(), context(), NOW), 'id': str(uuid4()),
            'status': 'pending', 'lease_token': str(uuid4()), 'attempts': 1, **changes}


def sale(**changes):
    return {'id': 'tx-1', 'external_transaction_id': 'provider-1', 'external_receipt_number': 'ANG-0012345',
            'transaction_type': 'sale', 'status': 'received', 'external_branch_id': 'outlet-1',
            'external_terminal_id': 'register-1', 'currency': 'PHP', 'gross_amount': '300.00',
            'net_amount': '250.00', 'eligible_amount': '250.00',
            'transacted_at': (NOW - timedelta(days=2, seconds=20)).isoformat(),
            'raw_payload': {'isCancelled': False, 'transactionType': 'Sale'}, **changes}


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.payload, self.operation = [], None, 'select'
        self.maximum = None
    def select(self, *_): return self
    def insert(self, payload): self.payload, self.operation = payload, 'insert'; return self
    def eq(self, key, value):
        def equal(row):
            actual=row.get(key)
            if isinstance(actual,(dict,list)) and isinstance(value,str):
                import json
                try: return actual==json.loads(value)
                except ValueError: return False
            return str(actual)==str(value)
        self.filters.append(equal); return self
    def is_(self, key, value): self.filters.append(lambda row: row.get(key) is None); return self
    def in_(self, key, values): self.filters.append(lambda row: row.get(key) in values); return self
    def gt(self, key, value): self.filters.append(lambda row: row.get(key) is not None and row.get(key) > value); return self
    def gte(self, key, value): self.filters.append(lambda row: row.get(key) is not None and row.get(key) >= value); return self
    def lte(self, key, value): self.filters.append(lambda row: row.get(key) is not None and row.get(key) <= value); return self
    def limit(self, limit): self.maximum = limit; return self
    def update(self, payload): self.payload, self.operation = payload, 'update'; return self
    def execute(self):
        with self.db.lock:
            if self.operation == 'update' and self.db.before_update:
                callback=self.db.before_update; self.db.before_update=None; callback()
            if self.operation == 'insert':
                self.payload.setdefault('id','inserted')
                self.db.tables.setdefault(self.table,[]).append(self.payload)
                return SimpleNamespace(data=[deepcopy(self.payload)])
            selected = [row for row in self.db.tables.get(self.table, []) if all(test(row) for test in self.filters)]
            if self.maximum is not None: selected = selected[:self.maximum]
            if self.operation == 'update':
                for row in selected: row.update(self.payload)
            return SimpleNamespace(data=deepcopy(selected))


class Database:
    def __init__(self): self.tables, self.lock, self.before_update = {}, threading.Lock(), None
    def table(self, table): return Query(self, table)


class Harness:
    def __init__(self, rows=None, complete=True):
        self.db, self.rows, self.complete = Database(), rows or [sale()], complete
        self.events, self.calls, self.processed, self.fetch_calls = [], [], [], []
        self.enqueue_error, self.process_error, self.claim_error = None, None, None
        self.claimed_ids = set()
        self.receipt_owners, self.materialized = {}, {}
        self.context_value = context()
    def rpc(self, name, params):
        self.calls.append((name, deepcopy(params)))
        if name == 'pos_offline_sales_enqueue_batch':
            return [self.rpc('pos_offline_sale_enqueue', {'p_event': row}) for row in params['p_events']]
        if name == 'pos_offline_sale_enqueue':
            if self.enqueue_error: raise self.enqueue_error
            data = params['p_event']
            existing = next((row for row in self.events if row['client_event_id'] == data['client_event_id']), None)
            if existing:
                if existing['event_hash'] != data['event_hash']: raise RuntimeError('already used for a different sale')
                return existing
            row = {**deepcopy(data), 'id': str(uuid4()), 'status': 'pending'}
            self.events.append(row)
            return row
        if name == 'pos_claim_offline_sales':
            rows = [row for row in self.events if row['status'] in ('pending', 'awaiting_storehub') and row['id'] not in self.claimed_ids][:params['p_limit']]
            for row in rows:
                row.update(lease_token=str(uuid4()), attempts=1)
                self.claimed_ids.add(row['id'])
            return deepcopy(rows)
        if name == 'pos_claim_offline_sale_transaction':
            if self.claim_error: raise self.claim_error
            owner=self.receipt_owners.get(params['p_transaction_id'])
            if owner and owner != params['p_event_id']: raise RuntimeError('StoreHub sale is already claimed by another offline event')
            self.receipt_owners[params['p_transaction_id']]=params['p_event_id']
            return {**self.materialized[params['p_transaction_id']], 'customer_id': params['p_customer_id']}
        if name == 'pos_finish_offline_sale':
            row = next(row for row in self.events if row['id'] == params['p_event_id'])
            row.update(status=params['p_status'], message=params['p_message'], result=params['p_result'])
            return row
        raise AssertionError(name)
    def scope(self, device, original):
        for key in ('device_id', 'business_public_id', 'branch_public_id', 'external_branch_id', 'external_terminal_id'):
            if original.get(key) != self.context_value[key]: raise OfflineSaleError('scope changed', review=True)
        return self.context_value
    def fetch(self, record, ctx):
        self.fetch_calls.append((record, ctx))
        return self.rows, self.complete
    def materialize(self, row, ctx):
        transaction={**row, 'id':row.get('id') or 'tx-1'}
        self.materialized[transaction['id']]=transaction
        return transaction
    async def process(self, record, ctx, member, transaction):
        if self.process_error: raise self.process_error
        self.processed.append(transaction)
        return {'points_earned': 25, 'provider_total': transaction['net_amount']}
    def service(self):
        self.db.tables['storehub_offline_sales'] = self.events
        return OfflineSalesService(db=self.db, rpc=self.rpc, context=self.scope,
            customer=lambda *_: {'id': 'cust-1'}, fetch=self.fetch,
            materialize=self.materialize, process=self.process)
    def queue(self, **changes):
        return self.service().enqueue({'id': 'dev-1'}, [event(**changes)])[0]
    def run(self):
        self.claimed_ids.clear()
        return asyncio.run(self.service().run_once())


class NormalizeTests(unittest.TestCase):
    def test_original_times_survive_days_of_offline(self):
        row = normalize_event(event(), context(), NOW)
        self.assertLess(datetime.fromisoformat(row['completed_at']), NOW - timedelta(days=1))
    def test_unchanged_retry_hash(self):
        data = event()
        self.assertEqual(normalize_event(data, context(), NOW)['event_hash'], normalize_event(data, context(), NOW)['event_hash'])
    def test_changed_customer_or_amount_changes_hash(self):
        data = event()
        original = normalize_event(data, context(), NOW)['event_hash']
        self.assertNotEqual(original, normalize_event({**data, 'customer_ref':'other'}, context(), NOW)['event_hash'])
        self.assertNotEqual(original, normalize_event({**data, 'final_amount':'251'}, context(), NOW)['event_hash'])
    def test_all_five_scope_fields_are_required(self):
        for key in ('device_id', 'business_public_id', 'branch_public_id', 'external_branch_id', 'external_terminal_id'):
            with self.subTest(key=key), self.assertRaises(OfflineSaleError):
                normalize_event(event(**{key:'other'}), context(), NOW)
    def test_nonfinite_or_zero_amount_rejected(self):
        for value in ('NaN', 'Infinity', '-1', '0', '1000000001'):
            with self.subTest(value=value), self.assertRaises(OfflineSaleError):
                normalize_event(event(final_amount=value), context(), NOW)
    def test_future_and_backward_or_naive_time_rejected(self):
        for changes in ({'completed_at':NOW+timedelta(minutes=6)},
                        {'completed_at':NOW-timedelta(days=3)}, {'scanned_at':'2026-10-13T09:58:00'}):
            with self.subTest(changes=changes), self.assertRaises(OfflineSaleError):
                normalize_event(event(**changes), context(), NOW)
    def test_pending_redemption_rejected(self):
        with self.assertRaises(OfflineSaleError): normalize_event(event(pending_redemption=True), context(), NOW)
    def test_optional_receipt_and_explicit_modes(self):
        for mode, receipt in [('amount',''), ('suffix5','12345'), ('full','ANG-0012345')]:
            self.assertEqual(normalize_event(event(receipt_match_mode=mode,receipt_reference=receipt), context(), NOW)['receipt_match_mode'],mode)
    def test_invalid_receipt_combinations_rejected(self):
        for mode, receipt in [('amount','12345'), ('suffix5','1234'), ('full',''), ('guess','')]:
            with self.subTest(mode=mode), self.assertRaises(OfflineSaleError):
                normalize_event(event(receipt_match_mode=mode,receipt_reference=receipt), context(), NOW)
    def test_currency_must_match(self):
        with self.assertRaises(OfflineSaleError): normalize_event(event(currency='USD'),context(),NOW)
    def test_uuid_required(self):
        with self.assertRaises(OfflineSaleError): normalize_event(event(client_event_id='short'),context(),NOW)


class MatchingTests(unittest.TestCase):
    def setUp(self): self.event = saved_event()
    def test_exact_authoritative_final_amount(self):
        self.assertEqual(len(matching_sales(self.event,[sale()])),1)
        self.assertEqual(matching_sales(self.event,[sale(net_amount='249.99')]),[])
    def test_wrong_outlet_register_currency(self):
        for changes in ({'external_branch_id':'other'}, {'external_terminal_id':''}, {'currency':'USD'}):
            with self.subTest(changes=changes): self.assertEqual(matching_sales(self.event,[sale(**changes)]),[])
    def test_void_refund_failed_not_eligible(self):
        for changes in ({'transaction_type':'void'}, {'transaction_type':'refund'}, {'status':'failed'}, {'raw_payload':{'isCancelled':True}}):
            with self.subTest(changes=changes): self.assertEqual(matching_sales(self.event,[sale(**changes)]),[])
    def test_void_copy_invalidates_same_external_reference(self):
        self.assertEqual(matching_sales(self.event,[sale(),sale(transaction_type='void')]),[])
    def test_duplicate_provider_delivery_one_candidate(self):
        self.assertEqual(len(matching_sales(self.event,[sale(),sale()])),1)
    def test_conflicting_versions_of_same_receipt_are_not_authoritative(self):
        self.assertEqual(matching_sales(self.event,[sale(),sale(net_amount='300.00')]),[])
    def test_time_padding_is_only_ten_seconds(self):
        completed=datetime.fromisoformat(self.event['completed_at'])
        self.assertEqual(len(matching_sales(self.event,[sale(transacted_at=(completed+timedelta(seconds=10)).isoformat())])),1)
        self.assertEqual(matching_sales(self.event,[sale(transacted_at=(completed+timedelta(seconds=11)).isoformat())]),[])
    def test_suffix_five_and_full_receipt(self):
        for mode, ref in [('suffix5','12345'), ('full','ANG-0012345')]:
            self.assertEqual(len(matching_sales({**self.event,'receipt_match_mode':mode,'receipt_reference':ref},[sale()])),1)
        self.assertEqual(matching_sales({**self.event,'receipt_match_mode':'full','receipt_reference':'12345'},[sale()]),[])
    def test_multiple_valid_sales_stay_multiple(self):
        self.assertEqual(len(matching_sales(self.event,[sale(),sale(external_transaction_id='provider-2')])),2)
    def test_cross_customer_overlapping_amounts_require_receipt(self):
        other={**self.event,'id':'other','customer_ref':'member-2'}
        self.assertTrue(overlaps_amount_event(self.event,other))
        self.assertFalse(overlaps_amount_event(self.event,{**other,'receipt_match_mode':'full'}))
        self.assertFalse(overlaps_amount_event(self.event,{**other,'final_amount':'251'}))
        self.assertFalse(overlaps_amount_event(self.event,{**other,'status':'processed'}))


class ServiceTests(unittest.TestCase):
    def test_ack_only_after_durable_save(self):
        h=Harness(); h.enqueue_error=RuntimeError('DB unavailable')
        self.assertFalse(h.queue()['acknowledged']); self.assertEqual(h.events,[])
    def test_upload_does_not_award(self):
        h=Harness(); self.assertTrue(h.queue()['acknowledged']); self.assertEqual(h.processed,[])
    def test_retry_same_event_returns_one_row(self):
        h=Harness(); data=event(); service=h.service()
        first=service.enqueue({},[data])[0]; second=service.enqueue({},[data])[0]
        self.assertEqual(first['id'],second['id']); self.assertEqual(len(h.events),1)
        changed=service.enqueue({},[{**data,'final_amount':'251'}])[0]
        self.assertFalse(changed['acknowledged'])
    def test_long_outage_receipt_processed_without_interactive_session(self):
        h=Harness(); h.queue(); self.assertEqual(h.run(),1)
        self.assertEqual(h.events[0]['status'],'processed'); self.assertEqual(len(h.processed),1)
        self.assertEqual(h.processed[0]['net_amount'],'250.00')
    def test_no_provider_match_keeps_pending(self):
        h=Harness(rows=[sale(net_amount='100')]); h.queue(); self.assertEqual(h.run(),0)
        self.assertEqual(h.events[0]['status'],'awaiting_storehub'); self.assertEqual(h.processed,[])
    def test_capped_feed_never_awards_even_one_match(self):
        h=Harness(complete=False); h.queue(); h.run()
        self.assertEqual(h.events[0]['status'],'needs_review'); self.assertEqual(h.processed,[])
    def test_ambiguous_feed_requires_receipt(self):
        h=Harness(rows=[sale(),sale(external_transaction_id='provider-2')]); h.queue(); h.run()
        self.assertEqual(h.events[0]['status'],'needs_review'); self.assertEqual(h.processed,[])
    def test_overlapping_customer_events_never_first_wins(self):
        h=Harness(); h.queue(); h.queue(customer_ref='member-2'); h.run()
        self.assertEqual([row['status'] for row in h.events],['needs_review','needs_review'])
        self.assertEqual(h.processed,[])
    def test_scope_change_stops_old_event(self):
        h=Harness(); h.queue(); h.context_value['external_terminal_id']='new-register'; h.run()
        self.assertEqual(h.events[0]['status'],'needs_review'); self.assertEqual(h.processed,[])
    def test_receipt_claim_conflict_never_awards(self):
        h=Harness(); h.queue(); h.claim_error=RuntimeError('StoreHub sale is already bound to a different customer'); h.run()
        self.assertEqual(h.events[0]['status'],'needs_review'); self.assertEqual(h.processed,[])
    def test_transient_worker_error_retries(self):
        h=Harness(); h.queue(); h.process_error=RuntimeError('temporary network error'); h.run()
        self.assertEqual(h.events[0]['status'],'awaiting_storehub')
    def test_processed_event_not_awarded_again(self):
        h=Harness(); h.queue(); h.run(); h.run(); self.assertEqual(len(h.processed),1)
    def test_two_offline_events_for_same_receipt_only_process_once(self):
        h=Harness(); h.queue(receipt_reference='ANG-0012345',receipt_match_mode='full')
        h.queue(receipt_reference='ANG-0012345',receipt_match_mode='full')
        h.run(); self.assertEqual(len(h.processed),1)
        self.assertEqual([row['status'] for row in h.events],['processed','needs_review'])
    def test_batch_claims_and_processes_distinct_receipts(self):
        h=Harness(rows=[sale(),sale(id='tx-2',external_transaction_id='provider-2',external_receipt_number='SECOND')])
        h.queue(receipt_reference='ANG-0012345',receipt_match_mode='full')
        h.queue(receipt_reference='SECOND',receipt_match_mode='full')
        h.run(); self.assertEqual(len(h.processed),2)
    def test_waiting_for_saved_offline_receipt_is_retryable(self):
        class Conflict(Exception): status_code=409
        h=Harness(); h.queue(); h.process_error=Conflict('This receipt is reserved for a saved offline sale. Please wait for offline verification.')
        h.run(); self.assertEqual(h.events[0]['status'],'awaiting_storehub')
    def test_full_receipt_requested_only_for_ambiguity(self):
        h=Harness(complete=False); h.queue(); h.run()
        self.assertFalse(public_event(h.events[0])['requires_full_receipt'])
        h=Harness(rows=[sale(),sale(id='tx-2',external_transaction_id='provider-2')]); h.queue(); h.run()
        self.assertTrue(public_event(h.events[0])['requires_full_receipt'])
    def test_online_inflight_idempotency_conflict_is_retryable(self):
        class Conflict(Exception):
            status_code=409
        h=Harness(); h.queue(); h.process_error=Conflict('This transaction is already being processed. Please wait.')
        h.run(); self.assertEqual(h.events[0]['status'],'awaiting_storehub')
    def test_other_409_conflict_still_requires_review(self):
        class Conflict(Exception):
            status_code=409
        h=Harness(); h.queue(); h.process_error=Conflict('A different member owns this sale.')
        h.run(); self.assertEqual(h.events[0]['status'],'needs_review')
    def test_same_day_distinct_windows_do_not_reuse_provider_subset(self):
        h=Harness()
        h.queue(receipt_reference='ANG-0012345',receipt_match_mode='full')
        later_scanned=(NOW-timedelta(days=2)+timedelta(hours=1)).isoformat()
        later_done=(NOW-timedelta(days=2)+timedelta(hours=1,minutes=2)).isoformat()
        h.queue(receipt_reference='LATER',receipt_match_mode='full',scanned_at=later_scanned,completed_at=later_done)
        def distinct_fetch(record,ctx):
            h.fetch_calls.append(record)
            if record['receipt_reference']=='LATER':
                return [sale(id='tx-2',external_transaction_id='provider-2', external_receipt_number='LATER',transacted_at=later_done)],True
            return [sale()],True
        h.fetch=distinct_fetch
        h.run()
        self.assertEqual(len(h.fetch_calls),2)
        self.assertEqual([row['status'] for row in h.events],['processed','processed'])
    def test_worker_does_not_lease_future_events_before_current_finishes(self):
        h=Harness(rows=[sale(),sale(id='tx-2',external_transaction_id='provider-2',external_receipt_number='SECOND')])
        h.queue(receipt_match_mode='full',receipt_reference='ANG-0012345')
        h.queue(receipt_match_mode='full',receipt_reference='SECOND')
        service=h.service()
        async def verify_lease_order(record,ctx,customer,transaction):
            claims=[params for name,params in h.calls if name=='pos_claim_offline_sales']
            finishes=[params for name,params in h.calls if name=='pos_finish_offline_sale']
            self.assertTrue(all(params['p_limit']==1 for params in claims))
            self.assertEqual(len(claims),len(finishes)+1)
            return {}
        service.process=verify_lease_order
        asyncio.run(service.run_once())
        self.assertEqual([row['status'] for row in h.events],['processed','processed'])
    def test_public_status_does_not_expose_scope_or_token(self):
        row=public_event({**saved_event(),'device_token_hash':'secret'})
        self.assertNotIn('device_token_hash',row); self.assertNotIn('scope',row)


class SharedCustomerClaimTests(unittest.TestCase):
    def setUp(self):
        self.db=Database(); self.db.tables['pos_transactions']=[dict(id='tx',integration_id='i',business_id=7,
            customer_id=None,transaction_type='sale',status='received',raw_payload={})]
        source=ast.parse(SOURCE.read_text())
        node=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='_companion_claim_transaction_customer')
        class HTTPError(Exception):
            def __init__(self,status_code,detail): self.status_code=status_code; super().__init__(detail)
        self.error=HTTPError
        env={'supabase':self.db,'HTTPException':HTTPError,'_pos_schema_error':lambda exc:exc}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'claim','exec'),env)
        self.claim=env[node.name]
        self.device=dict(integration_id='i',business_id=7)
    def test_same_customer_retry_allowed_other_customer_blocked(self):
        self.claim(self.device,{'customer_id':1},{'id':'tx'})
        self.claim(self.device,{'customer_id':1},{'id':'tx'})
        with self.assertRaises(self.error): self.claim(self.device,{'customer_id':2},{'id':'tx'})
    def test_two_simultaneous_members_have_only_one_winner(self):
        barrier=threading.Barrier(2); winners=[]
        def attempt(customer):
            barrier.wait()
            try: self.claim(self.device,{'customer_id':customer},{'id':'tx'}); winners.append(customer)
            except self.error: pass
        threads=[threading.Thread(target=attempt,args=(customer,)) for customer in (1,2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(len(winners),1)
    def test_voided_or_cancelled_receipt_cannot_claim(self):
        for patch in ({'status':'voided'},{'raw_payload':{'isCancelled':True}}):
            self.db.tables['pos_transactions'][0].update({'customer_id':None,'status':'received','raw_payload':{},**patch})
            with self.assertRaises(self.error): self.claim(self.device,{'customer_id':1},{'id':'tx'})
    def test_other_business_receipt_is_not_mutated(self):
        with self.assertRaises(self.error): self.claim({**self.device,'business_id':8},{'customer_id':1},{'id':'tx'})
        self.assertIsNone(self.db.tables['pos_transactions'][0]['customer_id'])


class ProviderUpsertCancellationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node=next(node for node in ast.parse(SOURCE.read_text()).body if isinstance(node,ast.FunctionDef) and node.name=='_companion_upsert_bridge_transaction')
    def setUp(self):
        self.db=Database()
        self.record={'id':'tx','integration_id':'i','business_id':7,'branch_id':11,'provider':'storehub',
                     'external_transaction_id':'provider-1','external_receipt_number':'receipt','status':'received',
                     'transaction_type':'sale','customer_id':None,'updated_at':'2026-10-14T10:00:00Z',
                     'gross_amount':250,'net_amount':250,'raw_payload':{'isCancelled':False},'processing_metadata':{}}
        self.db.tables['pos_transactions']=[self.record]
        self.normalized={'external_transaction_id':'provider-1','external_receipt_number':'receipt','external_branch_id':'outlet',
                         'external_terminal_id':'register','transaction_type':'sale','gross_amount':300,'net_amount':300,
                         'eligible_amount':300,'transacted_at':NOW.isoformat(),'raw_payload':{'isCancelled':False}}
        env={'supabase':self.db,'Optional':__import__('typing').Optional,'datetime':datetime,'timezone':timezone,
             '_pos_schema_error':lambda exc:exc,'business_currency':lambda business:'PHP',
             '_pos_business_by_id':lambda _: {},'_companion_money_value':money,'json':__import__('json')}
        exec(compile(ast.Module(body=[self.node],type_ignores=[]),'upsert','exec'),env)
        self.upsert=env[self.node.name]
    def call(self):
        return self.upsert({'business_id':7,'integration_id':'i','provider':'storehub'},self.normalized,
                           {'external_branch_id':'outlet','branch_id':11})
    def test_stale_sale_never_revives_existing_void_or_refund(self):
        for status,kind in [('voided','void'),('refunded','refund')]:
            self.record.update(status=status,transaction_type=kind,raw_payload={'isCancelled':True})
            returned=self.call()
            self.assertEqual(returned['status'],status)
            self.assertEqual(self.record['transaction_type'],kind)
    def test_concurrent_void_wins_over_sale_snapshot(self):
        def void(): self.record.update(status='voided',transaction_type='void',raw_payload={'isCancelled':True},updated_at='2026-10-14T10:01:00Z')
        self.db.before_update=void
        returned=self.call()
        self.assertEqual(returned['status'],'voided'); self.assertEqual(self.record['transaction_type'],'void')
    def test_concurrent_void_changes_type_even_without_version_bump(self):
        self.record['status']='loyalty_applied'
        def void(): self.record.update(transaction_type='void',raw_payload={'isCancelled':True})
        self.db.before_update=void
        returned=self.call()
        self.assertEqual(returned['transaction_type'],'void')
    def test_concurrent_customer_claim_metadata_is_not_erased(self):
        def claim(): self.record.update(customer_id=2,processing_metadata={'offline_sale_event_id':'other'})
        self.db.before_update=claim
        returned=self.call()
        self.assertEqual(returned['customer_id'],2)
        self.assertEqual(returned['processing_metadata']['offline_sale_event_id'],'other')


class MainIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = {node.name: node for node in ast.parse(SOURCE.read_text()).body
                     if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    def load(self, name, env):
        node=deepcopy(self.nodes[name]); node.decorator_list=[]
        exec(compile(ast.Module(body=[node],type_ignores=[]),'integration','exec'),env)
        return env[name]
    def test_live_connectivity_probe_does_not_downgrade_integration(self):
        db=Database(); integration={'id':'i','status':'live','mode':'live'}
        db.tables['pos_integrations']=[integration]
        fn=self.load('pos_companion_connectivity',{'Header':lambda **_:None,'supabase':db,
            '_require_pos_device':lambda _: {'provider':'storehub','business_id':7},
            '_get_pos_integration':lambda *_:integration,'_storehub_get':lambda *_:{},
            'datetime':datetime,'timezone':timezone})
        self.assertEqual(fn(False,'token')['state'],'online')
        self.assertTrue(fn(True,'token')['provider_online'])
        self.assertEqual(integration['status'],'live')
    def test_historical_fetch_uses_original_day_without_today_cursor(self):
        calls=[]
        def fetch(integration,**kwargs):
            calls.append(kwargs); return {},[{'refId':'ref','transactionType':'Sale'}],{}
        fn=self.load('_offline_sale_fetch',{'_pos_parse_timestamp':lambda value:datetime.fromisoformat(value),
            'timedelta':timedelta,'datetime':datetime,'timezone':timezone,'OfflineSaleError':OfflineSaleError,'STOREHUB_TX_PROBE_SLEEP_SECONDS':0,'STOREHUB_TX_PAGE_SIZE':5000,
            '_storehub_fetch_recent_transaction_rows':fetch,
            '_companion_normalize_provider_transaction':lambda *_:{'transaction_type':'sale'}})
        record=saved_event(); ctx={**context(),'integration':{}}
        rows,complete=fn(record,ctx)
        self.assertTrue(complete); self.assertEqual(len(rows),1)
        self.assertEqual(calls[0]['start'].date(),datetime.fromisoformat(record['scanned_at']).date())
        self.assertFalse(calls[0]['use_paging_hint']); self.assertFalse(calls[0]['deep_probe'])
    def test_incomplete_historical_page_is_not_assumed_unique(self):
        fn=self.load('_offline_sale_fetch',{'_pos_parse_timestamp':lambda value:datetime.fromisoformat(value),
            'timedelta':timedelta,'datetime':datetime,'timezone':timezone,'OfflineSaleError':OfflineSaleError,'STOREHUB_TX_PROBE_SLEEP_SECONDS':0,'STOREHUB_TX_PAGE_SIZE':2,
            '_storehub_fetch_recent_transaction_rows':lambda *args,**kwargs:({},[{'refId':'a'},{'refId':'b'}],{}),
            '_companion_normalize_provider_transaction':lambda *_:None})
        self.assertFalse(fn(saved_event(),{**context(),'integration':{}})[1])
    def test_created_date_lookup_includes_sale_uploaded_after_outage(self):
        requests=[]
        class Frozen(datetime):
            @classmethod
            def now(cls,tz=None): return NOW
        def created_date_feed(integration,**kwargs):
            requests.append(kwargs)
            created=NOW-timedelta(hours=1)
            raw={'refId':'delayed','transactionType':'Sale','createdAt':created.isoformat()}
            return {},[raw] if kwargs['end']>=created else [],{}
        fn=self.load('_offline_sale_fetch',{'_pos_parse_timestamp':lambda value:datetime.fromisoformat(value),
            'timedelta':timedelta,'datetime':Frozen,'timezone':timezone,'OfflineSaleError':OfflineSaleError,
            'STOREHUB_TX_PROBE_SLEEP_SECONDS':0,'STOREHUB_TX_PAGE_SIZE':5000,
            '_storehub_fetch_recent_transaction_rows':created_date_feed,
            '_companion_normalize_provider_transaction':lambda *_:{'transaction_type':'sale'}})
        rows,complete=fn(saved_event(),{**context(),'integration':{}})
        self.assertTrue(complete); self.assertEqual(len(rows),1)
        self.assertEqual(requests[0]['end'],NOW)
    def test_old_outage_requires_owner_review_without_unbounded_queries(self):
        def unexpected(*args,**kwargs): raise AssertionError('should not call provider')
        fn=self.load('_offline_sale_fetch',{'_pos_parse_timestamp':lambda value:datetime.fromisoformat(value),
            'timedelta':timedelta,'datetime':datetime,'timezone':timezone,'OfflineSaleError':OfflineSaleError,
            'STOREHUB_TX_PROBE_SLEEP_SECONDS':0,'STOREHUB_TX_PAGE_SIZE':5000,
            '_storehub_fetch_recent_transaction_rows':unexpected})
        with self.assertRaises(OfflineSaleError):
            fn(saved_event(scanned_at=(NOW-timedelta(days=60)).isoformat()),{**context(),'integration':{}})
    def test_storehub_claim_uses_atomic_pending_offline_guard_rpc(self):
        calls=[]
        def rpc(name,params): calls.append((name,params)); return {'id':'tx','customer_id':1}
        fn=self.load('_companion_claim_transaction_customer',{'HTTPException':Exception,'_offline_sale_rpc':rpc,
            '_companion_is_mock_transaction':lambda tx:False})
        result=fn({'id':'device','provider':'storehub'},{'customer_id':1},{'id':'tx'})
        self.assertEqual(result['customer_id'],1)
        self.assertEqual(calls[0][0],'pos_claim_companion_transaction_customer')
    def test_pending_offline_receipt_is_hidden_from_the_next_online_checkout(self):
        db=Database(); saved=saved_event()
        db.tables['storehub_offline_sales']=[saved]
        earlier=sale(id='earlier', processing_metadata={
            'bridge_external_branch_id':'outlet-1','bridge_external_terminal_id':'register-1'})
        later=sale(id='later', external_transaction_id='later-sale',
            transacted_at=(datetime.fromisoformat(saved['completed_at'])+timedelta(minutes=1)).isoformat(),
            processing_metadata={'bridge_external_branch_id':'outlet-1','bridge_external_terminal_id':'register-1'})
        fn=self.load('_companion_pending_offline_receipt_ids',{'supabase':db,
            '_companion_is_mock_transaction':lambda tx:False,
            '_pos_parse_timestamp':lambda value:datetime.fromisoformat(value),
            'datetime':datetime,'timezone':timezone,'timedelta':timedelta,
            'POS_COMPANION_SESSION_TTL_SECONDS':300,'_pos_schema_error':lambda exc:exc,
            '_pos_transaction_register_id':lambda tx:tx['processing_metadata']['bridge_external_terminal_id'],
            'offline_sale_matches':matching_sales})
        session={'scanned_at':(datetime.fromisoformat(saved['completed_at'])+timedelta(seconds=2)).isoformat(),
                 'expires_at':(datetime.fromisoformat(saved['completed_at'])+timedelta(minutes=5)).isoformat()}
        self.assertEqual(fn({'provider':'storehub','integration_id':'int-1','branch_id':11},session,[earlier,later]),{'earlier'})
    def test_mock_checkout_retains_existing_claim_without_storehub_rpc(self):
        db=Database(); db.tables['pos_transactions']=[dict(id='mock',integration_id='i',business_id=7,
            customer_id=None,transaction_type='sale',status='received',raw_payload={})]
        fn=self.load('_companion_claim_transaction_customer',{'supabase':db,
            'HTTPException':Exception,'_pos_schema_error':lambda exc:exc,
            '_companion_is_mock_transaction':lambda tx:True,
            '_offline_sale_rpc':lambda *args: self.fail('mock must not call StoreHub claim RPC')})
        self.assertEqual(fn({'provider':'storehub','integration_id':'i','business_id':7},
            {'customer_id':1},{'id':'mock'})['customer_id'],1)
    def test_rpc_batch_and_claim_preserve_all_rows(self):
        class RPC:
            def execute(self): return SimpleNamespace(data=[{'id':'one'},{'id':'two'}])
        db=SimpleNamespace(rpc=lambda *_:RPC())
        fn=self.load('_offline_sale_rpc',{'supabase':db})
        for name in ('pos_claim_offline_sales','pos_offline_sales_enqueue_batch'):
            self.assertEqual(len(fn(name,{})),2)
        self.assertEqual(fn('pos_finish_offline_sale',{})['id'],'one')
    def test_native_receipt_request_shapes_are_present(self):
        source=SOURCE.read_text()
        for fragment in ("receipt_match_mode: Literal['amount', 'suffix5', 'full']", "'/api/v1/pos-companion/offline-sales/sync'",
                         "'/api/v1/pos-companion/offline-sales/status'", "'/api/v1/pos-companion/offline-sales/{event_id}/receipt'"):
            self.assertIn(fragment,source)


if __name__=='__main__': unittest.main()

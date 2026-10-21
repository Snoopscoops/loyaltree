"""Confirmed LT purchase/void adapters; fake database only, no provider calls."""
from copy import deepcopy
from types import SimpleNamespace
import unittest

try:
    from backend import lt_benefits_transactions as subject
    from backend.storehub_voids import StoreHubVoidSync
except ImportError:
    import lt_benefits_transactions as subject
    from storehub_voids import StoreHubVoidSync


class Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.patch, self.cap = db, name, [], None, 100
    def select(self, *_): return self
    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value);return self
    def in_(self, key, values):
        self.filters.append(lambda row: row.get(key) in values);return self
    def contains(self, key, values):
        self.filters.append(lambda row: all((row.get(key) or {}).get(k)==v for k,v in values.items()));return self
    def order(self, *_): return self
    def limit(self, value): self.cap=value;return self
    def update(self, value): self.patch=value;return self
    def execute(self):
        rows = [row for row in self.db.rows.get(self.name, []) if all(fn(row) for fn in self.filters)][:self.cap]
        if self.patch:
            for row in rows:row.update(deepcopy(self.patch))
        return SimpleNamespace(data=deepcopy(rows))


class DB:
    def __init__(self, rows=None): self.rows=deepcopy(rows or {});self.calls=[]
    def table(self, name):self.calls.append(name);return Query(self,name)


class Benefits:
    def __init__(self):self.calls=[];self.failure=False;self.result={"status":"reversed"}
    def reverse(self, *args):
        self.calls.append(args)
        if self.failure:raise RuntimeError("temporarily unavailable")
        return dict(self.result)


def transaction(**changes):
    base=dict(id="tx-1",business_id="business-1",customer_id="customer-1",provider="storehub",integration_id="integration-1",
        external_transaction_id="receipt-1",status="voided",currency="PHP",net_amount="975.00",
        processing_metadata={"void_wallet_sync_pending":True})
    base.update(changes);return base


def authorized_metadata(**changes):
    value=subject.pos_purchase_metadata(transaction(),customer_public_id="card-1")
    value.update(changes);return value


def audit(action="points_sale", key="companion:storehub:integration-1:receipt-1:points", **changes):
    row=dict(id="audit-1",transaction_id="audit-ref-1",business_id="business-1",customer_id="customer-1",status="success",action=action,
        idempotency_key=key,metadata={"lt_purchase_authorized":True,"lt_amount_centavos":97500})
    row.update(changes);return row


class PurchaseSnapshotTests(unittest.TestCase):
    def test_engine_and_provider_paths_share_one_purchase(self):
        expected="pos:storehub:integration-1:receipt-1"
        for key in ("companion:storehub:integration-1:receipt-1:points","pos:storehub:integration-1:receipt-1:stamp",
                    "companion:storehub:integration-1:receipt-1:tier"):
            self.assertEqual(subject.canonical_purchase_source(key),expected)
        self.assertEqual(subject.pos_purchase_source(transaction()),expected)

    def test_preserves_provider_receipt_that_itself_ends_in_engine_word(self):
        tx=transaction(external_transaction_id="receipt-1:stamp")
        value=subject.pos_purchase_metadata(tx,customer_public_id="card-1")
        self.assertEqual(value["lt_purchase_source"],"pos:storehub:integration-1:receipt-1:stamp")
        self.assertEqual(subject.LTTransactionReconciler.audit_purchase(audit(metadata=value))["lt_purchase_source"],value["lt_purchase_source"])

    def test_long_receipts_have_bounded_collision_resistant_sources(self):
        a=subject.pos_purchase_source(transaction(external_transaction_id="x"*400+"a"))
        b=subject.pos_purchase_source(transaction(external_transaction_id="x"*400+"b"))
        self.assertLessEqual(len(a),180);self.assertNotEqual(a,b)

    def test_actual_net_is_independent_of_merchant_gross_earning_amount(self):
        snapshot=subject.pos_purchase_metadata(transaction(net_amount="975.00",eligible_amount=1200,gross_amount=1250),customer_public_id="card-1")
        self.assertEqual(snapshot["lt_amount_centavos"],97500)
        self.assertEqual(snapshot["lt_customer_public_id"],"card-1")

    def test_no_gross_fallback_for_missing_net_and_no_fraction_rounding(self):
        with self.assertRaises(ValueError):subject.pos_purchase_metadata(transaction(net_amount=None,gross_amount=1000),customer_public_id="card-1")
        for value in ("1.001",True,"NaN","Infinity",-1):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):subject.centavos(value)
        self.assertEqual(subject.centavos("0.00"),0)

    def test_only_server_authorized_purchase_actions_are_retriable(self):
        for row in (audit(action="points_adjust"),audit(metadata={"lt_purchase_authorized":False,"lt_amount_centavos":1000}),audit(metadata={})): 
            self.assertIsNone(subject.LTTransactionReconciler.audit_purchase(row))
        with self.assertRaises(ValueError):subject.LTTransactionReconciler.audit_purchase(audit(metadata={"lt_purchase_authorized":True,"lt_amount_centavos":1.5}))


class RefundAdapterTests(unittest.TestCase):
    def setUp(self):
        self.db=DB();self.benefits=Benefits();self.logs=[]
        self.service=subject.LTTransactionReconciler(db=self.db,benefits=self.benefits,enabled=True,
            log=lambda event,**fields:self.logs.append((event,fields)))

    def test_persisted_snapshot_needs_no_audit_lookup_and_survives_pause(self):
        self.service.enabled=False
        tx=transaction(processing_metadata={"void_wallet_sync_pending":True,**authorized_metadata()})
        self.assertEqual(self.service.refund_pos(tx)["status"],"refund_recorded")
        self.assertEqual(self.db.calls,[])
        self.assertEqual(self.benefits.calls,[("business-1","purchase","pos:storehub:integration-1:receipt-1","pos-void:tx-1",97500)])
        self.assertTrue(tx["processing_metadata"]["lt_refund_processed"])

    def test_pre_feature_void_when_off_is_a_fast_noop(self):
        self.service.enabled=False
        self.assertEqual(self.service.refund_pos(transaction())["status"],"no_lt_purchase")
        self.assertEqual(self.db.calls,[]);self.assertEqual(self.benefits.calls,[])

    def test_fallback_scopes_audits_and_deduplicates_hybrid_engines(self):
        self.db.rows["transaction_audit"]=[audit(),audit("stamp_add","pos:storehub:integration-1:receipt-1:stamp",id="audit-2"),
            audit(id="other",business_id="other"),audit(id="other-customer",customer_id="other")]
        self.assertEqual(self.service.refund_pos(transaction())["sources"],1)
        self.assertEqual(len(self.benefits.calls),1)

    def test_conflicting_hybrid_snapshot_fails_before_any_refund(self):
        self.db.rows["transaction_audit"]=[audit(),audit("stamp_add","pos:storehub:integration-1:receipt-1:stamp",
            metadata={"lt_purchase_authorized":True,"lt_amount_centavos":100000})]
        with self.assertRaises(ValueError):self.service.refund_pos(transaction())
        self.assertEqual(self.benefits.calls,[])

    def test_refund_before_award_accepts_durable_tombstone(self):
        self.benefits.result={"status":"pending_refund"}
        tx=transaction(processing_metadata=authorized_metadata())
        self.assertEqual(self.service.refund_pos(tx)["status"],"refund_recorded")

    def test_unknown_service_result_and_connection_error_leave_retry_pending(self):
        for failure in (True,False):
            self.benefits.failure=failure;self.benefits.result={"status":"disabled"}
            tx=transaction(processing_metadata=authorized_metadata())
            with self.assertRaises(RuntimeError):self.service.refund_pos(tx)
            self.assertNotIn("lt_refund_processed",tx["processing_metadata"])

    def test_non_php_and_zero_purchases_never_reverse_php_points(self):
        for snapshot in (authorized_metadata(lt_purchase_currency="USD"),authorized_metadata(lt_amount_centavos=0)):
            self.service.refund_pos(transaction(processing_metadata=snapshot))
        self.assertEqual(self.benefits.calls,[])

    def test_logs_exclude_purchase_payload_and_contact(self):
        self.service.refund_pos(transaction(processing_metadata=authorized_metadata()))
        self.assertEqual(set(self.logs[-1][1]),{"transaction_id","business_id","sources"})


class VoidWorkerCallbackTests(unittest.TestCase):
    def setUp(self):
        self.tx=transaction(processing_metadata={"void_wallet_sync_pending":True,**authorized_metadata()})
        self.db=DB({"pos_transactions":[self.tx],"customers":[{"id":"customer-1","business_id":"business-1"}]})
        self.benefits=Benefits()
        self.reconciler=subject.LTTransactionReconciler(db=self.db,benefits=self.benefits,enabled=False)
        self.queue_calls=[];self.queue_ok=True
        self.worker=StoreHubVoidSync(db=self.db,rpc=lambda *a:None,fetch_rows=lambda *a:[],get_integration=lambda *a:None,
            get_mapping=lambda *a:None,get_business=lambda *a:{"id":"business-1"},access_allowed=lambda *a:True,
            enqueue_wallet=self.enqueue,log=lambda *a,**kw:None,on_void=self.reconciler.refund_pos)

    def enqueue(self,*args):
        self.queue_calls.append(args)
        return {"status":"queued","job_id":"job-1"} if self.queue_ok else None

    def test_failed_lt_refund_keeps_wallet_marker_for_next_sweep(self):
        self.benefits.failure=True
        self.assertFalse(self.worker.queue_wallet(deepcopy(self.tx)))
        self.assertTrue(self.db.rows["pos_transactions"][0]["processing_metadata"]["void_wallet_sync_pending"])
        self.assertEqual(self.queue_calls,[])
        self.benefits.failure=False
        self.worker.drain_wallet_pending({"id":None})  # No matching integration; use explicit retry below.
        self.assertTrue(self.worker.queue_wallet(deepcopy(self.tx)))
        stored=self.db.rows["pos_transactions"][0]["processing_metadata"]
        self.assertFalse(stored["void_wallet_sync_pending"]);self.assertTrue(stored["lt_refund_processed"])

    def test_queue_failure_after_refund_does_not_persist_success_marker(self):
        self.queue_ok=False
        self.assertFalse(self.worker.queue_wallet(deepcopy(self.tx)))
        stored=self.db.rows["pos_transactions"][0]["processing_metadata"]
        self.assertNotIn("lt_refund_processed",stored)
        self.assertTrue(stored["void_wallet_sync_pending"])
        self.queue_ok=True
        self.assertTrue(self.worker.queue_wallet(deepcopy(self.tx)))
        self.assertEqual(len(self.benefits.calls),2)  # Same stable refund key; SQL handles replay.


if __name__=="__main__":unittest.main()

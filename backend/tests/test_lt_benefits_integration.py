"""Execute the real main.py LT hooks in isolation; no server/provider startup."""
import ast
import asyncio
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from fastapi.responses import Response
try:
    from backend import lt_benefits_transactions as transactions
    from backend import lt_benefits_wallet as wallet
except ImportError:
    import lt_benefits_transactions as transactions
    import lt_benefits_wallet as wallet


SOURCE = Path(__file__).resolve().parents[1] / "main.py"
if not SOURCE.exists():
    SOURCE = Path("/Users/user24/Desktop/loyaltree/backend/main.py")
NAMES = {"_lt_purchase_metadata", "_lt_award_audit_purchase", "_lt_prepare_pos_purchase",
         "_lt_award_pos_purchase", "_lt_retry_purchase_awards", "lt_benefits_wallet_action", "get_customer_api"}


def integration_code():
    nodes=[node for node in ast.parse(SOURCE.read_text()).body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAMES]
    for node in nodes:node.decorator_list=[]
    missing=NAMES-{node.name for node in nodes}
    if missing:raise AssertionError("Main LT integration helpers missing: "+", ".join(sorted(missing)))
    return compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE),"exec")


CODE=integration_code()


def nested(row, key):
    if "->>" in key:
        first, second = key.split("->>", 1)
        value = (row.get(first) or {}).get(second)
        if isinstance(value, bool):return "true" if value else "false"
        return str(value) if value is not None else None
    if "->" in key:
        first, second = key.split("->", 1)
        return (row.get(first) or {}).get(second)
    return row.get(key)


class Query:
    def __init__(self, db, name):self.db,self.name,self.filters,self.patch,self.cap=db,name,[],None,100
    def select(self,*_):return self
    def eq(self,key,value):self.filters.append(lambda row:nested(row,key)==value);return self
    def is_(self,key,value):self.filters.append(lambda row:nested(row,key) is None if value=="null" else nested(row,key)==value);return self
    def order(self,*args,**kwargs):return self
    def limit(self,value):self.cap=value;return self
    def update(self,value):self.patch=deepcopy(value);return self
    def execute(self):
        if self.db.fail:raise RuntimeError("Synthetic database outage")
        rows=[row for row in self.db.rows.get(self.name,[]) if all(fn(row) for fn in self.filters)][:self.cap]
        if self.patch:
            for row in rows:row.update(deepcopy(self.patch))
        return SimpleNamespace(data=deepcopy(rows))


class DB:
    def __init__(self):self.rows={"pos_transactions":[],"transaction_audit":[]};self.calls=[];self.fail=False
    def table(self,name):self.calls.append(name);return Query(self,name)


class Benefits:
    def __init__(self):self.calls=[];self.fail=False;self.before=None;self.status="earned"
    def earn(self,*args,**kwargs):
        self.calls.append((args,kwargs))
        if self.before:self.before()
        if self.fail:raise RuntimeError("Synthetic optional LT outage")
        return {"status":self.status,"points_earned":1}


def fixture(enabled=True):
    db,benefits,state=DB(),Benefits(),[enabled]
    customer=dict(id=30,public_id="card-30",business_id=10,points_balance=50,stamp_count=3,lt_member_id="private-lt-member",lt_benefits_card_enabled=True)
    business=dict(id=10,public_id="cafe-10",name="Cafe 10",currency="PHP")
    env=dict(HTTPException=HTTPException,Response=Response,supabase=db,_lt_benefits=benefits,
        lt_transactions=transactions,lt_wallet=wallet,lt_benefits_enabled=lambda:state[0],
        _lt_require_staff=Mock(return_value={"role":"staff"}),log_event=Mock(),
        safe_get_customer_by_id=lambda _:deepcopy(customer),safe_get_customer=lambda _:deepcopy(customer),
        safe_get_business_by_id=lambda _:deepcopy(business),safe_get_customer_program=lambda *a:None,
        safe_get_active_coupon=lambda *a:None,safe_get_active_coupons=lambda *a:[],
        business_currency=lambda value:value.get("currency") or "PHP",FRONTEND_URL="https://example.invalid",
        _order_ahead_signing_secret=lambda:"synthetic-only-card-signing-secret")
    exec(CODE,env)
    return env,db,benefits,state,customer,business


def pos_tx(**changes):
    value=dict(id="pos-1",business_id=10,customer_id=30,provider="storehub",integration_id="integration-1",
        external_transaction_id="receipt-1",currency="PHP",net_amount="975.00",gross_amount="1250.00",
        eligible_amount="1250.00",status="received",processing_metadata={"existing_provider_field":True})
    value.update(changes);return value


class MainLTHookTests(unittest.TestCase):
    def setUp(self):self.env,self.db,self.benefits,self.enabled,self.customer,self.business=fixture()

    def prepare(self,tx=None,**options):
        return self.env["_lt_prepare_pos_purchase"](tx or pos_tx(),self.customer,self.business,**options)

    def test_feature_off_never_adds_lt_database_work_or_new_manual_auth(self):
        self.enabled[0]=False
        self.assertEqual(self.env["_lt_purchase_metadata"]("cafe-10","",975),{})
        self.env["_lt_require_staff"].assert_not_called()
        prepared=self.prepare()
        self.assertFalse(prepared["processing_metadata"]["lt_purchase_authorized"])
        self.env["_lt_award_pos_purchase"]({**prepared,"status":"loyalty_applied"})
        self.env["_lt_retry_purchase_awards"]()
        self.assertFalse(self.db.calls);self.assertFalse(self.benefits.calls)

    def test_failed_manual_auth_only_disables_optional_lt_metadata(self):
        self.env["_lt_require_staff"].side_effect=HTTPException(403,"Signed staff required")
        self.assertEqual(self.env["_lt_purchase_metadata"]("cafe-10","Bearer invalid",975),{})
        self.assertFalse(self.db.calls);self.assertFalse(self.benefits.calls)

    def test_manual_amount_requires_actual_nonzero_centavos(self):
        self.assertEqual(self.env["_lt_purchase_metadata"]("cafe-10","Bearer staff","975.00")["lt_amount_centavos"],97500)
        for amount in ("1.001",0,-1,"NaN",None):
            self.assertEqual(self.env["_lt_purchase_metadata"]("cafe-10","Bearer staff",amount),{})

    def test_pos_test_mode_never_records_lt_eligibility(self):
        prepared=self.prepare(test_mode=True)
        self.assertFalse(prepared["processing_metadata"]["lt_purchase_authorized"])
        self.env["_lt_award_pos_purchase"]({**prepared,"status":"loyalty_applied"})
        self.assertFalse(self.db.calls);self.assertFalse(self.benefits.calls)

    def test_pos_snapshots_net_instead_of_gross_or_merchant_eligible_amount(self):
        self.db.rows["pos_transactions"]=[pos_tx()]
        prepared=self.prepare()
        snapshot=prepared["processing_metadata"]
        self.assertEqual(snapshot["lt_amount_centavos"],97500)
        self.assertEqual(snapshot["lt_purchase_source"],"pos:storehub:integration-1:receipt-1")
        self.assertEqual(snapshot["lt_purchase_currency"],"PHP")
        self.assertTrue(snapshot["existing_provider_field"])
        self.assertEqual(self.db.rows["pos_transactions"][0]["processing_metadata"],snapshot)
        self.assertFalse(self.benefits.calls)

    def test_pos_snapshot_is_immutable_across_changed_receipt_retry_values(self):
        first=self.prepare()
        second=self.prepare({**first,"net_amount":9999,"external_transaction_id":"changed", "currency":"USD"})
        self.assertEqual(first["processing_metadata"],second["processing_metadata"])

    def test_only_confirmed_loyalty_applied_pos_rows_earn(self):
        prepared=self.prepare()
        for status in ("received","processing","failed","voided"):
            self.env["_lt_award_pos_purchase"]({**prepared,"status":status})
        self.assertFalse(self.benefits.calls)
        confirmed={**prepared,"status":"loyalty_applied"}
        self.db.rows["pos_transactions"]=[deepcopy(confirmed)]
        result=self.env["_lt_award_pos_purchase"](confirmed)
        self.assertEqual(result["status"],"earned")
        self.assertEqual(self.benefits.calls[0],(("card-30",10,"purchase","pos:storehub:integration-1:receipt-1",97500),{"currency":"PHP"}))
        self.assertTrue(self.db.rows["pos_transactions"][0]["processing_metadata"]["lt_points_processed"])

    def test_optional_lt_failure_leaves_confirmed_purchase_retriable(self):
        confirmed={**self.prepare(),"status":"loyalty_applied"}
        self.db.rows["pos_transactions"]=[deepcopy(confirmed)]
        self.benefits.fail=True
        self.assertIsNone(self.env["_lt_award_pos_purchase"](confirmed))
        self.assertNotIn("lt_points_processed",self.db.rows["pos_transactions"][0]["processing_metadata"])
        self.benefits.fail=False
        self.env["_lt_retry_purchase_awards"]()
        self.assertTrue(self.db.rows["pos_transactions"][0]["processing_metadata"]["lt_points_processed"])
        self.assertEqual(len(self.benefits.calls),2)

    def test_manual_audit_uses_saved_source_currency_and_amount(self):
        audit=dict(id="audit-1",customer_id=30,business_id=10,action="points_sale",status="success",
            idempotency_key="changed-engine-key:points",metadata={"lt_purchase_authorized":True,"lt_amount_centavos":97500,
                "lt_purchase_source":"immutable-receipt-source","lt_purchase_currency":"PHP"})
        self.business["currency"]="USD";self.db.rows["transaction_audit"]=[deepcopy(audit)]
        self.env["_lt_award_audit_purchase"](audit)
        self.assertEqual(self.benefits.calls[0],(("card-30",10,"purchase","immutable-receipt-source",97500),{"currency":"PHP"}))

    def test_no_eligibility_marker_means_no_global_points(self):
        audit=dict(id="audit-1",customer_id=30,business_id=10,action="points_sale",metadata={"amount_spent":975})
        self.env["_lt_award_audit_purchase"](audit)
        self.assertFalse(self.benefits.calls);self.assertFalse(self.db.calls)

    def test_late_award_cannot_overwrite_concurrent_void_retry_markers(self):
        confirmed={**self.prepare(),"status":"loyalty_applied"}
        self.db.rows["pos_transactions"]=[deepcopy(confirmed)]
        def void_during_lt_call():
            self.db.rows["pos_transactions"][0]["status"]="voided"
            self.db.rows["pos_transactions"][0]["processing_metadata"]["void_wallet_sync_pending"]=True
        self.benefits.before=void_during_lt_call
        self.env["_lt_award_pos_purchase"](confirmed)
        stored=self.db.rows["pos_transactions"][0]
        self.assertEqual(stored["status"],"voided")
        self.assertTrue(stored["processing_metadata"]["void_wallet_sync_pending"])

    def test_signup_wallet_benefits_link_is_optional_and_database_free(self):
        self.enabled[0]=False
        result=asyncio.run(self.env["get_customer_api"]("card-30",Response()))
        self.assertNotIn("loyalty_tree_benefits_url",result)
        self.assertNotIn("lt_member_id",result["customer"])
        self.assertEqual(result["customer"]["points_balance"],50)
        self.assertEqual(result["customer"]["stamp_count"],3)
        self.enabled[0]=True
        result=asyncio.run(self.env["get_customer_api"]("card-30",Response()))
        self.assertNotIn("loyalty_tree_benefits_url",result)
        self.assertFalse(self.db.calls)


if __name__=="__main__":unittest.main()

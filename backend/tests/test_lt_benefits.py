"""Isolated LT Benefits tests; never uses production credentials or providers."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
try:
    from backend import lt_benefits as benefits
except ImportError:
    import lt_benefits as benefits


OFFER_ID = "00000000-0000-4000-8000-000000000001"
MEMBER_ID = "00000000-0000-4000-8000-000000000002"
TOKEN = "opaque-private-customer-session-token-12345"


class FakeDB:
    def __init__(self):
        self.calls = []
        self.responses = {
            "settings": dict(enabled=True, pesos_per_point=500, rule_version=1),
            "catalog": dict(offers=[], has_more=False),
            "session": dict(member_id=MEMBER_ID, email="synthetic@example.invalid",customer_public_id="card-30"),
            "me": dict(balance_points=3, available_points=3, cards=[], coupons=[], activity=[], has_more=False),
            "auth_request": dict(accepted=True),
            "auth_verify": dict(member_id=MEMBER_ID, email="synthetic@example.invalid", linked=True),
            "link": dict(linked=True), "claim": dict(balance_points=2, coupon={"id": OFFER_ID}),
            "cashier_customer": dict(linked=True, coupons=[]),
            "use": dict(used=True, coupon={"id": OFFER_ID}, idempotent_replay=False),
            "owner_offers": dict(offers=[], has_more=False),
            "offer_save": dict(id=OFFER_ID), "report": dict(totals={}, offers=[], recent=[]),
            "wallet_jobs_claim": [], "wallet_jobs_finish": {},
            "reverse": dict(status="reversed", member_id=MEMBER_ID),
        }

    def rpc(self, name, args):
        assert name == "ltb_command"
        self.calls.append((args["p_action"], args["p_data"]))
        value = self.responses.get(args["p_action"], {})
        if isinstance(value, Exception):
            raise value
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=value))


def fixture(enabled=True):
    db, logs, emails = FakeDB(), [], []
    business = dict(id=10, public_id="synthetic-cafe", name="Synthetic Cafe")
    def owner(slug, auth):
        if auth != "Bearer signed-owner" or slug != business["public_id"]:
            raise HTTPException(403, "Owner required")
        return dict(role="owner")
    def staff(slug, auth):
        if auth != "Bearer signed-staff" or slug != business["public_id"]:
            raise HTTPException(403, "Staff required")
        return dict(role="staff", staff_id=12, branch_id=20)
    def admin(request):
        if request.headers.get("authorization") != "Bearer admin-secret":
            raise HTTPException(401, "Admin required")
    def card(public_id, token):
        if token != "signed-card-proof":
            raise HTTPException(401, "Invalid card")
        return dict(customer=dict(id=30, public_id=public_id, business_id=10, email="synthetic@example.invalid",phone="09171234567",lt_benefits_card_enabled=True), business=business)
    app = FastAPI()
    service = benefits.register_lt_benefits_routes(app, db=db, get_business=lambda _: business,
        get_card_context=card, require_owner=owner, require_staff=staff, require_admin=admin,
        send_email=lambda *a: emails.append(a) or True, enabled=enabled,
        log=lambda event, **fields: logs.append((event, fields)))
    return TestClient(app), service, db, logs, emails


class BenefitsRouteTests(unittest.TestCase):
    def setUp(self):
        self.secret = patch.dict(os.environ, {"LT_BENEFITS_AUTH_SECRET": "test-only-secret-not-production-123456789"})
        self.secret.start()
        self.addCleanup(self.secret.stop)
        self.client, self.service, self.db, self.logs, self.emails = fixture()
        self.auth = {"Authorization": "Bearer " + TOKEN}

    def test_default_off_config_never_queries_database(self):
        client, service, db, _, _ = fixture(enabled=False)
        self.assertEqual(client.get("/api/v1/benefits/config").json()["enabled"], False)
        self.assertEqual(db.calls, [])
        self.assertEqual(client.get("/api/v1/benefits/offers").status_code, 503)
        self.assertIsNone(service.wallet_projection("card"))

    def test_missing_migration_fails_closed_without_rpc_payload_or_exception_message(self):
        self.db.responses["settings"] = RuntimeError("contains email secret@example.invalid bearer-token")
        response = self.client.get("/api/v1/benefits/config")
        self.assertTrue(response.json()["requires_sql"])
        self.assertFalse(response.json()["available"])
        self.assertNotIn("secret@", json.dumps(self.logs) + response.text)
        self.assertEqual(self.logs[-1][1]["error_type"], "RuntimeError")

    def test_card_token_alone_cannot_open_member_account(self):
        self.assertEqual(self.client.get("/api/v1/benefits/me", headers={"Authorization": "Bearer signed-card-proof"}).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/benefits/me").status_code, 401)

    def test_member_session_is_hashed_and_contacts_are_masked(self):
        response = self.client.get("/api/v1/benefits/me", headers=self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("synthetic@example.invalid", response.text)
        call = next(data for action, data in self.db.calls if action == "session")
        self.assertEqual(call["token_hash"], hashlib.sha256(TOKEN.encode()).hexdigest())
        self.assertNotIn(TOKEN, json.dumps(self.db.calls))
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["referrer-policy"], "no-referrer")

    def test_request_code_never_returns_or_stores_raw_code_and_requires_consent(self):
        response = self.client.post("/api/v1/benefits/auth/request-code", json=dict(customer_public_id="card-30",card_token="signed-card-proof",consent=True))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.emails), 1)
        raw_code = re.search(r"<strong>(\d{6})</strong>", self.emails[0][2]).group(1)
        self.assertNotIn(raw_code, response.text)
        auth_data = next(data for action, data in self.db.calls if action == "auth_request")
        self.assertNotEqual(auth_data["code_hash"], raw_code)
        self.assertEqual(len(auth_data["code_hash"]), 64)
        self.assertEqual(auth_data["email"], "synthetic@example.invalid")
        self.assertEqual(self.client.post("/api/v1/benefits/auth/request-code", json=dict(customer_public_id="card-30",card_token="signed-card-proof",consent=False)).status_code, 422)

    def test_standalone_email_login_is_rejected_without_sending(self):
        for body in (dict(email="synthetic@example.invalid",consent=True),
                     dict(email="other@example.invalid",consent=True,customer_public_id="card-30",card_token="signed-card-proof")):
            self.assertEqual(self.client.post("/api/v1/benefits/auth/request-code",json=body).status_code,422)
        self.assertFalse(self.emails)
        self.assertEqual(self.client.get("/api/v1/benefits/offers").status_code,401)

    def test_card_entry_uses_saved_contact_and_requires_otp_for_another_card(self):
        response=self.client.post("/api/v1/benefits/entry",headers=self.auth,
            json=dict(customer_public_id="card-30",card_token="signed-card-proof"))
        self.assertTrue(response.json()["verified"])
        self.assertNotIn("synthetic@example.invalid",response.text)
        self.assertNotIn("0917",response.text)
        response=self.client.post("/api/v1/benefits/entry",headers=self.auth,
            json=dict(customer_public_id="card-31",card_token="signed-card-proof"))
        self.assertFalse(response.json()["verified"])
        self.assertFalse(self.emails)

    def test_profile_setup_is_automatic_best_effort_and_sends_no_email(self):
        self.service.provision_customer(dict(id=30,public_id="card-30",email="SYNTHETIC@example.invalid",phone="09171234567",lt_benefits_card_enabled=True),dict(id=10,public_id="cafe",name="Cafe"))
        action,data=self.db.calls[-1]
        self.assertEqual(action,"provision")
        self.assertEqual(data["phone_key"],"639171234567")
        self.assertFalse(self.emails)
        self.db.responses["provision"]=RuntimeError("private details")
        self.assertIsNone(self.service.provision_customer(dict(id=30,email="one@example.invalid",phone="+63 917 123 4567",lt_benefits_card_enabled=True),dict(id=10)))
        self.assertNotIn("private details",json.dumps(self.logs))

    def test_verified_session_cannot_link_a_different_existing_email(self):
        self.db.responses["session"]["email"] = "other@example.invalid"
        response = self.client.post("/api/v1/benefits/link", headers=self.auth,
            json=dict(customer_public_id="card-30", card_token="signed-card-proof", consent=True))
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("link", [action for action, _ in self.db.calls])

    def test_verify_returns_only_new_opaque_token_and_masked_member(self):
        response = self.client.post("/api/v1/benefits/auth/verify", json=dict(challenge_id=OFFER_ID, code="123456"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["expires_in"], 604800)
        self.assertNotIn("synthetic@example.invalid", response.text)
        data = next(data for action, data in self.db.calls if action == "auth_verify")
        self.assertEqual(data["token_hash"], benefits._hash(response.json()["access_token"]))
        self.assertNotIn("123456", json.dumps(data))

    def test_owner_and_staff_scope_are_required_before_cross_merchant_lookup(self):
        path = "/api/v1/business/synthetic-cafe/lt-benefits/customer/any-linked-card"
        self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(self.client.get(path, headers=self.auth).status_code, 403)
        self.assertEqual(self.client.get(path, headers={"Authorization": "Bearer signed-staff"}).status_code, 200)
        data = next(data for action, data in self.db.calls if action == "cashier_customer")
        self.assertEqual(data["business_id"], "10")
        self.assertEqual(self.client.get(path.replace("synthetic-cafe", "other"), headers={"Authorization": "Bearer signed-staff"}).status_code, 403)

    def test_staff_cannot_create_offers_or_view_owner_report(self):
        headers = {"Authorization": "Bearer signed-staff"}
        self.assertEqual(self.client.get("/api/v1/business/synthetic-cafe/lt-benefits/offers", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/api/v1/business/synthetic-cafe/lt-benefits/report", headers=headers).status_code, 403)

    def test_claim_requires_idempotency_key_and_preserves_offer_intent(self):
        path = f"/api/v1/benefits/offers/{OFFER_ID}/claim"
        self.assertEqual(self.client.post(path, headers=self.auth).status_code, 422)
        response = self.client.post(path, headers={**self.auth, "Idempotency-Key": "claim-key-123"})
        self.assertEqual(response.status_code, 200)
        data = next(data for action, data in self.db.calls if action == "claim")
        self.assertEqual(data["member_id"], MEMBER_ID)
        self.assertEqual(data["key"], "claim-key-123")
        self.assertEqual(data["request_hash"], benefits._canonical_hash(dict(offer_id=OFFER_ID)))

    def test_cashier_bill_must_be_integer_and_scoped_to_signed_session(self):
        path = f"/api/v1/business/synthetic-cafe/lt-benefits/coupons/{OFFER_ID}/use"
        headers = {"Authorization": "Bearer signed-staff", "Idempotency-Key": "coupon-use-key"}
        self.assertEqual(self.client.post(path, headers=headers, json=dict(customer_public_id="other-card", bill_amount_centavos=1.5)).status_code, 422)
        response = self.client.post(path, headers=headers, json=dict(customer_public_id="other-card", bill_amount_centavos=50000))
        self.assertEqual(response.status_code, 200)
        data = next(data for action, data in self.db.calls if action == "use")
        self.assertEqual(data["staff_id"], "12")
        self.assertEqual(data["branch_id"], "20")
        self.assertEqual(data["business_id"], "10")

    def test_admin_auth_required_and_settings_reject_float_rate(self):
        path = "/api/v1/admin/lt-benefits/settings"
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.get(path, headers={"Authorization": "Bearer admin-secret"}).status_code, 200)
        self.assertEqual(self.client.put(path, headers={"Authorization": "Bearer admin-secret"}, json=dict(pesos_per_point=500.5)).status_code, 422)

    def test_offer_validation_blocks_credentials_in_image_and_naive_dates(self):
        for image in ("http://example.invalid/x", "https://user:secret@example.invalid/x"):
            with self.assertRaises(ValueError):
                benefits.OfferCreate(title="Coupon", points_cost=1, total_quantity=1, discount_centavos=100, image_url=image)
        with self.assertRaises(ValueError):
            benefits.OfferCreate(title="Coupon", points_cost=1, total_quantity=1, discount_centavos=100, ends_at="2026-10-20T00:00:00")

    def test_refunds_still_reconcile_when_feature_is_paused(self):
        self.service._enabled_override = False
        result = self.service.reverse(10, "receipt", "sale-1", "refund-1", 50000)
        self.assertEqual(result["status"], "reversed")
        self.assertEqual(self.db.calls[-1][0], "reverse")

    def test_optional_projection_cache_is_bounded_and_cannot_be_mutated_by_caller(self):
        self.db.responses["wallet_projection"] = dict(member_public_id=MEMBER_ID, balance=3, version=2, coupons=[])
        for index in range(160):
            self.service.wallet_projection(f"card-{index}")
        self.assertEqual(len(self.service._projection_cache), 128)
        projection = self.service.wallet_projection("card-159")
        projection["coupons"].append({"title": "changed"})
        self.assertEqual(self.service.wallet_projection("card-159")["coupons"], [])
        self.service.invalidate(MEMBER_ID)
        self.assertFalse(self.service._projection_cache)

    def test_wallet_enqueue_failure_is_not_acknowledged_as_success(self):
        self.db.responses["wallet_jobs_claim"] = [dict(member_id=MEMBER_ID, lease_token=OFFER_ID, version=3, cards=[])]
        self.assertEqual(self.service.process_wallet_jobs(lambda *args: False), 0)
        self.assertFalse(self.db.calls[-1][1]["success"])
        self.assertEqual(self.service.process_wallet_jobs(lambda *args: True), 1)
        self.assertTrue(self.db.calls[-1][1]["success"])


class BenefitsSQLTests(unittest.TestCase):
    def test_migration_preserves_merchant_balances_and_uses_native_wallet_projection(self):
        sql = (Path(__file__).resolve().parents[1] / "lt_benefits.sql").read_text()
        for column in ("lt_member_id", "lt_points_balance", "lt_points_version", "lt_points_updated_at", "lt_coupon_count"):
            self.assertIn("ADD COLUMN IF NOT EXISTS " + column, sql)
        self.assertNotRegex(sql, r"(?i)SET\s+(points_balance|stamp_count)\s*=")
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)
        self.assertIn("REVOKE ALL ON FUNCTION", sql)
        self.assertIn("ENABLE ROW LEVEL SECURITY", sql)

    def test_actual_sql_transactions_if_local_pglite_is_available(self):
        module = os.getenv("LT_BENEFITS_PGLITE", "/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js")
        node = os.getenv("LT_BENEFITS_NODE", "/usr/local/bin/node")
        if not Path(module).is_file() or not Path(node).is_file():
            self.skipTest("Optional isolated PGlite runtime not installed")
        with tempfile.TemporaryDirectory(prefix="lt-benefits-sql-") as directory:
            script = Path(directory) / "check.mjs"
            script.write_text(SQL_CHECK)
            completed = subprocess.run([node, str(script), module,
                str(Path(__file__).resolve().parents[1] / "lt_benefits.sql")], capture_output=True, text=True, timeout=90)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertIn("LT Benefits SQL passed", completed.stdout)


SQL_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE customers(id bigint PRIMARY KEY,public_id text UNIQUE,business_id bigint,email text,phone text DEFAULT '09171234567',
 points_balance integer DEFAULT 0,stamp_count integer DEFAULT 0,updated_at timestamptz DEFAULT now());
 INSERT INTO customers(id,public_id,business_id,email,points_balance,stamp_count) VALUES
 (1,'card-a',10,'one@example.invalid',99,3),(2,'card-b',20,'one@example.invalid',22,7),
 (3,'card-c',10,'two@example.invalid',44,5);`);
const migration=await fs.readFile(process.argv[3],'utf8');await db.exec(migration);await db.exec(migration);
const command=async(action,data={})=>(await db.query('SELECT ltb_command($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
const expectError=async(action,data,expected)=>assert.equal((await command(action,data)).error,expected);
const card=(publicId,id,business)=>({customer_public_id:publicId,customer_id:String(id),business_id:String(business),
 business_slug:'cafe-'+business,business_name:'Cafe '+business,phone_key:'639171234567'});
const challenge='10000000-0000-4000-8000-000000000001';
await command('settings_update',{enabled:true});
// Signup creates the first profile/card but never merges another business card.
await command('provision',{email:'one@example.invalid',phone_key:'639171234567',card_context:card('card-a',1,10)});
const automatic=(await db.query("SELECT id,email_verified_at FROM ltb_members WHERE email='one@example.invalid'")).rows[0];
assert(automatic.id);assert.equal(automatic.email_verified_at,null);
await command('provision',{email:'one@example.invalid',phone_key:'639171234567',card_context:card('card-b',2,20)});
assert.equal((await db.query("SELECT lt_member_id FROM customers WHERE public_id='card-b'")).rows[0].lt_member_id,null);
assert.equal((await db.query("SELECT ltb_phone('+63 917-123-4567') p")).rows[0].p,'639171234567');
await db.exec("INSERT INTO customers(id,public_id,business_id,email,phone) VALUES(4,'card-d',10,'one@example.invalid','09181234567')");
await command('provision',{email:'one@example.invalid',phone_key:'639181234567',card_context:{...card('card-d',4,10),phone_key:'639181234567'}});
assert.equal((await db.query("SELECT count(*) n FROM ltb_members WHERE email='one@example.invalid'")).rows[0].n,2);
assert.notEqual((await db.query("SELECT lt_member_id FROM customers WHERE public_id='card-d'")).rows[0].lt_member_id,automatic.id);
assert.equal((await command('auth_request',{id:challenge,email:'one@example.invalid',code_hash:'codehash',client_hash:'ip',card_context:card('card-a',1,10)})).accepted,true);
for(let i=0;i<4;i++)await expectError('auth_verify',{id:challenge,code_hash:'wrong',token_hash:'unused'},'invalid_code');
const auth=await command('auth_verify',{id:challenge,code_hash:'codehash',token_hash:'session'});
assert.equal(auth.member_id,automatic.id);await expectError('auth_verify',{id:challenge,code_hash:'codehash',token_hash:'twice'},'invalid_code');
assert.equal((await command('auth_request',{id:'10000000-0000-4000-8000-000000000003',email:'one@example.invalid',code_hash:'x',client_hash:'ip'})).accepted,false);
const attemptsChallenge='10000000-0000-4000-8000-000000000004';
await command('auth_request',{id:attemptsChallenge,email:'attempts@example.invalid',code_hash:'correct',client_hash:'ip'});
for(let i=0;i<5;i++)await expectError('auth_verify',{id:attemptsChallenge,code_hash:'wrong',token_hash:'no-session'},'invalid_code');
await expectError('auth_verify',{id:attemptsChallenge,code_hash:'correct',token_hash:'no-session'},'invalid_code');
await command('logout',{token_hash:'session'});await expectError('session',{token_hash:'session'},'unauthorized');
await db.exec("UPDATE ltb_auth_challenges SET created_at=now()-interval '61 seconds'");
const secondCardChallenge='10000000-0000-4000-8000-000000000009';
await command('auth_request',{id:secondCardChallenge,email:'one@example.invalid',code_hash:'second-card',client_hash:'ip-b',card_context:card('card-b',2,20)});
const secondCard=await command('auth_verify',{id:secondCardChallenge,code_hash:'second-card',token_hash:'second-card-session'});
assert.equal(secondCard.member_id,auth.member_id);assert.equal(secondCard.customer_public_id,'card-b');
await expectError('link',{member_id:auth.member_id,card_context:{...card('card-d',4,10),phone_key:'639181234567'}},'card_link_conflict');
await db.exec("UPDATE customers SET phone='09191234567' WHERE public_id='card-d'");
assert.equal((await db.query("SELECT lt_member_id FROM customers WHERE public_id='card-d'")).rows[0].lt_member_id,null);
await expectError('link',{member_id:auth.member_id,card_context:card('card-c',3,10)},'card_link_conflict');
let members=(await db.query('SELECT count(*) n FROM ltb_members')).rows[0].n;assert.equal(members,2);
const purchase=(id,amount=30000,extra={})=>({customer_public_id:'card-a',business_id:'10',source_type:'receipt',source_id:id,amount_centavos:amount,currency:'PHP',...extra});
assert.equal((await command('earn',purchase('a'))).points_earned,0);
assert.equal((await command('earn',purchase('b'))).points_earned,1);
assert.equal((await command('earn',purchase('b'))).status,'replay');
await expectError('earn',purchase('b',40000),'source_conflict');
assert.equal((await command('earn',purchase('c',140000,{customer_public_id:'card-b',business_id:'20'}))).points_earned,3);
let projected=(await db.query('SELECT lt_points_balance,lt_points_version,points_balance,stamp_count FROM customers ORDER BY id')).rows;
assert.equal(projected[0].lt_points_balance,4);assert.equal(projected[1].lt_points_balance,4);
assert.equal(projected[0].points_balance,99);assert.equal(projected[0].stamp_count,3);
const offer=await command('offer_save',{business_id:'10',business_slug:'cafe-10',business_name:'Cafe 10',offer:{title:'Original coupon',
 description:'Description',terms:'Original terms',image_url:'https://example.invalid/menu.jpg',category:'food_drink',discount_centavos:500,
 points_cost:1,total_quantity:1,per_member_limit:1,min_spend_centavos:1000,status:'active',coupon_valid_days:30}});
assert(offer.id);
const claim=(key)=>({member_id:auth.member_id,offer_id:offer.id,key,request_hash:'same-offer'});
// Concurrent request burst exercises the real transactional RPC, not a mocked balance update.
const claims=await Promise.all(Array.from({length:8},(_,i)=>command('claim',claim('claim-'+i))));
assert.equal(claims.filter(x=>x.coupon).length,1);assert.equal(claims.filter(x=>x.error==='out_of_stock').length,7);
const coupon=claims.find(x=>x.coupon).coupon;
assert.equal((await command('claim',claim('claim-0'))).idempotent_replay,true);
assert.equal((await db.query('SELECT count(*) n FROM ltb_coupons')).rows[0].n,1);
await command('offer_save',{business_id:'10',offer_id:offer.id,offer:{title:'Changed title',discount_centavos:1000,terms:'Changed terms'}});
const cashier=await command('cashier_customer',{business_id:'10',customer_public_id:'card-b'});
assert.equal(cashier.coupons[0].title,'Original coupon');assert.equal(cashier.coupons[0].discount_centavos,500);
assert.equal((await command('cashier_customer',{business_id:'99',customer_public_id:'card-b'})).coupons.length,0);
const use=(key,extra={})=>({business_id:'10',coupon_id:coupon.id,customer_public_id:'card-b',bill_amount_centavos:1000,key,request_hash:key,...extra});
await expectError('use',use('small',{bill_amount_centavos:999}),'minimum_spend');
await expectError('use',use('wrong',{business_id:'20'}),'not_found');
const uses=await Promise.all(Array.from({length:6},(_,i)=>command('use',use('use-'+i))));
assert.equal(uses.filter(x=>x.used).length,1);assert.equal(uses.filter(x=>x.error==='already_used').length,5);
assert.equal((await command('use',use('use-0'))).idempotent_replay,true);
await expectError('use',use('use-0',{request_hash:'changed'}),'idempotency_conflict');
const refund=(id,amount)=>({business_id:'10',source_type:'receipt',source_id:'b',refund_id:id,amount_centavos:amount});
assert.equal((await command('reverse',refund('partial',10000))).points_reversed,1);
assert.equal((await command('reverse',refund('partial',10000))).status,'replay');
await expectError('reverse',refund('partial',20000),'source_conflict');
assert.equal((await command('reverse',refund('rest',20000))).points_reversed,0);
await expectError('reverse',refund('excess',1),'refund_exceeds_purchase');
// Pausing earning must still correct already earned purchases.
await command('settings_update',{enabled:false});
assert.equal((await command('reverse',{business_id:'10',source_type:'receipt',source_id:'a',refund_id:'paused',amount_centavos:30000})).status,'reversed');
await expectError('earn',purchase('paused'),'unavailable');
await command('settings_update',{enabled:true});
const jobs=await command('wallet_jobs_claim',{limit:5});assert(jobs.length);
const job=jobs.find(j=>j.member_id===auth.member_id);assert(job);await command('earn',purchase('newer',50000));
await command('wallet_jobs_finish',{member_id:job.member_id,lease_token:job.lease_token,version:job.version,success:true});
assert.equal((await db.query('SELECT status FROM ltb_wallet_jobs WHERE member_id=$1',[auth.member_id])).rows[0].status,'pending');

// A refund arriving before an award is remembered, including across a feature pause.
await command('settings_update',{enabled:false});
const lateRefund={business_id:'10',source_type:'receipt',source_id:'late-award',refund_id:'pre-refund',amount_centavos:50000};
assert.equal((await command('reverse',lateRefund)).status,'pending_refund');
assert.equal((await command('reverse',lateRefund)).status,'replay_pending_refund');
await expectError('reverse',{...lateRefund,amount_centavos:40000},'source_conflict');
await command('settings_update',{enabled:true});
assert.equal((await command('earn',purchase('late-award',50000))).points_earned,0);
assert.equal((await command('reverse',lateRefund)).status,'replay');
// Expired claimed coupons refresh denormalized counts once, without deleting history.
const expiring=await command('offer_save',{business_id:'10',business_slug:'cafe-10',business_name:'Cafe 10',offer:{title:'Expiring',
 discount_centavos:500,points_cost:1,total_quantity:2,status:'active'}});
const expiryClaim=await command('claim',{member_id:auth.member_id,offer_id:expiring.id,key:'expiry-key',request_hash:'expiry'});
assert(expiryClaim.coupon);
assert.equal((await db.query("SELECT lt_coupon_count FROM customers WHERE public_id='card-a'")).rows[0].lt_coupon_count,1);
await db.query("UPDATE ltb_coupons SET expires_at=now()-interval '1 second' WHERE id=$1",[expiryClaim.coupon.id]);
assert.equal((await command('maintenance',{limit:10})).members_updated,1);
assert.equal((await command('maintenance',{limit:10})).members_updated,0);
assert.equal((await db.query("SELECT lt_coupon_count FROM customers WHERE public_id='card-a'")).rows[0].lt_coupon_count,0);
// A true contact change revokes future use/earning; normalization-only edits do not.
await db.exec("UPDATE customers SET email=' ONE@EXAMPLE.INVALID ' WHERE public_id='card-a'");
assert.equal((await command('cashier_customer',{business_id:'10',customer_public_id:'card-a'})).linked,true);
await db.exec("UPDATE customers SET email='new-owner@example.invalid' WHERE public_id='card-a'");
assert.equal((await command('cashier_customer',{business_id:'10',customer_public_id:'card-a'})).linked,false);
assert.equal((await command('earn',purchase('after-contact-change',50000))).status,'unlinked');
assert.equal((await db.query("SELECT lt_member_id FROM customers WHERE public_id='card-a'")).rows[0].lt_member_id,null);
const pendingJobs=await command('wallet_jobs_claim',{limit:5});
assert(pendingJobs.flatMap(j=>j.cards).some(c=>c.customer_public_id==='card-a'));
// Existing LT member cannot silently take the changed card back with an old session.
await expectError('link',{member_id:auth.member_id,card_context:card('card-a',1,10)},'card_link_conflict');
// Another verified email can explicitly link the revoked card, after code proof.
const nextChallenge='10000000-0000-4000-8000-000000000002';
await command('auth_request',{id:nextChallenge,email:'new-owner@example.invalid',code_hash:'new-code',client_hash:'other-ip',card_context:card('card-a',1,10)});
const newOwner=await command('auth_verify',{id:nextChallenge,code_hash:'new-code',token_hash:'new-owner-session'});assert(newOwner.member_id);
assert.notEqual(newOwner.member_id,auth.member_id);
assert.equal((await db.query("SELECT lt_points_balance FROM customers WHERE public_id='card-a'")).rows[0].lt_points_balance,0);
// Rate changes keep old carry under its original immutable rule.
assert.equal((await command('earn',purchase('old-rule-remainder',30000))).points_earned,0);
await command('settings_update',{pesos_per_point:250});
assert.equal((await command('earn',purchase('new-rule-point',25000))).points_earned,1);
assert.equal((await db.query('SELECT count(*) n FROM ltb_earning_buckets WHERE member_id=$1',[newOwner.member_id])).rows[0].n,2);
await command('settings_update',{max_points_per_transaction:1});
assert.equal((await command('earn',purchase('too-large',100000))).status,'needs_review');
assert.equal((await db.query("SELECT count(*) n FROM ltb_purchases WHERE source_id='too-large'")).rows[0].n,0);
// Revocation/earning races cannot reuse the processing generation and drop a newer job.
const outstanding=(await db.query('SELECT version FROM ltb_wallet_jobs WHERE member_id=$1',[auth.member_id])).rows[0];
assert(outstanding.version>job.version);

assert.equal((await db.query("SELECT has_function_privilege('anon','ltb_command(text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
assert.equal((await db.query("SELECT has_table_privilege('authenticated','ltb_members','SELECT') allowed")).rows[0].allowed,false);
await assert.rejects(db.exec("UPDATE ltb_ledger SET points_delta=999"),/append-only/);
console.log('LT Benefits SQL passed');await db.close();
"""


if __name__ == "__main__":
    unittest.main()

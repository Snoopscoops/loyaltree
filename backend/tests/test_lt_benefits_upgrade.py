import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

try:
    from backend.lt_benefits_upgrade import LTBenefitsUpgradeService, register_lt_benefits_upgrade_routes
except ImportError:
    spec = importlib.util.spec_from_file_location("lt_card_upgrade_under_test", Path(__file__).resolve().parents[1] / "lt_benefits_upgrade.py")
    mod = importlib.util.module_from_spec(spec); sys.modules[spec.name] = mod; spec.loader.exec_module(mod)
    LTBenefitsUpgradeService, register_lt_benefits_upgrade_routes = mod.LTBenefitsUpgradeService, mod.register_lt_benefits_upgrade_routes


class Database:
    def __init__(self):
        self.calls, self.failure, self.claim = [], None, {"job": None, "cards": []}

    def rpc(self, name, data):
        self.calls.append((name, data))
        if self.failure:
            raise self.failure
        action = data["p_action"]
        result = self.claim if action == "claim" else ({"ok": True} if action in ("ack", "fail", "release") else
            {"total_cards": 3, "enabled_cards": 1, "eligible_cards": 2, "rollout": {"id": "job-1", "status": "queued", "total": 2}})
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=result))


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.db, self.logs, self.enqueued = Database(), [], []
        self.on, self.ready_calls, self.admin_calls = True, [], []
        self.admin_request = Request({"type": "http", "headers": [(b"authorization", b"Bearer platform-admin")]})
        def require_admin(request):
            self.admin_calls.append(request.headers.get("authorization"))
            if request.headers.get("authorization") != "Bearer platform-admin":
                raise HTTPException(401, "Admin authentication required")
        def enqueue(card, business, reason):
            self.enqueued.append((card, business, reason))
            return {"status": "queued", "job_id": 9, "coalesced": True}
        self.kwargs = dict(db=self.db, get_business=lambda slug: {"cafe": {"id": 10, "public_id": "cafe"}, "other": {"id": 20, "public_id": "other"}}.get(slug),
            require_admin=require_admin, enabled=lambda: self.on, ready=lambda: self.ready_calls.append(True),
            enqueue=enqueue, log=lambda event, **fields: self.logs.append((event, fields)))
        self.service = LTBenefitsUpgradeService(**self.kwargs)

    def test_routes_require_platform_admin_and_scope_each_status_to_selected_business(self):
        app = FastAPI(); register_lt_benefits_upgrade_routes(app, **self.kwargs)
        with TestClient(app) as client:
            path = "/api/v1/admin/businesses/cafe/lt-benefits/card-upgrade"
            self.assertEqual(client.get(path).status_code, 401)
            self.assertEqual(self.db.calls, [])
            response = client.get(path, headers={"Authorization": "Bearer platform-admin"})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["available"])
            self.assertEqual(self.db.calls[-1][1]["p_data"], {"business_id": "10"})
            self.assertEqual(client.post(path, json={"confirm": True}, headers={"Authorization": "Bearer platform-admin"}).status_code, 200)
            self.assertEqual(self.db.calls[-1][1]["p_data"], {"business_id": "10", "business_slug": "cafe"})
            self.assertEqual(client.get(path.replace("cafe", "other"), headers={"Authorization": "Bearer platform-admin"}).status_code, 200)
            self.assertEqual(self.db.calls[-1][1]["p_data"], {"business_id": "20"})
            self.assertEqual(client.get(path.replace("cafe", "missing"), headers={"Authorization": "Bearer platform-admin"}).status_code, 404)

    def test_owners_and_staff_cannot_read_or_start_an_upgrade_even_while_disabled(self):
        app = FastAPI(); register_lt_benefits_upgrade_routes(app, **self.kwargs)
        with TestClient(app) as client:
            path = "/api/v1/admin/businesses/cafe/lt-benefits/card-upgrade"
            for enabled in (True, False):
                self.on = enabled
                for token in (None, "signed-owner", "staff-session", "1234"):
                    headers = {"Authorization": f"Bearer {token}"} if token else {}
                    self.assertEqual(client.get(path, headers=headers).status_code, 401)
                    self.assertEqual(client.post(path, json={"confirm": True}, headers=headers).status_code, 401)
        self.assertEqual(self.db.calls, [])
        self.assertEqual(self.enqueued, [])

    def test_legacy_owner_upgrade_routes_are_removed(self):
        app = FastAPI(); register_lt_benefits_upgrade_routes(app, **self.kwargs)
        with TestClient(app) as client:
            path = "/api/v1/business/cafe/lt-benefits/card-upgrade"
            self.assertEqual(client.get(path, headers={"Authorization": "Bearer signed-owner"}).status_code, 404)
            self.assertEqual(client.post(path, json={"confirm": True}, headers={"Authorization": "Bearer signed-owner"}).status_code, 404)
        self.assertEqual(self.db.calls, [])

    def test_route_requires_explicit_strict_confirmation(self):
        app = FastAPI(); register_lt_benefits_upgrade_routes(app, **self.kwargs)
        with TestClient(app) as client:
            for body in ({}, {"confirm": False}, {"confirm": "true"}, {"confirm": 1}, {"confirm": True, "business_id": "20"}):
                response = client.post("/api/v1/admin/businesses/cafe/lt-benefits/card-upgrade", json=body, headers={"Authorization": "Bearer platform-admin"})
                self.assertEqual(response.status_code, 422, body)
        self.assertEqual(self.db.calls, [])

    def test_disabled_status_is_safe_and_start_cannot_enqueue(self):
        self.on = False
        self.assertFalse(self.service.status("cafe", self.admin_request)["available"])
        with self.assertRaises(HTTPException) as failure: self.service.start("cafe", self.admin_request, confirm=True)
        self.assertEqual(failure.exception.status_code, 503)
        self.assertEqual(self.service.tick(), {"available": False, "queued": 0})
        self.assertEqual(self.db.calls, [])

    def test_start_checks_readiness_before_mutating(self):
        def paused(): raise HTTPException(503, "Paused")
        self.service.ready = paused
        with self.assertRaises(HTTPException): self.service.start("cafe", self.admin_request, confirm=True)
        self.assertEqual(self.db.calls, [])
        self.assertFalse(self.service.status("cafe", self.admin_request)["available"])

    def test_tick_queues_only_claimed_cards_without_rendering_or_contact_data(self):
        self.db.claim = {"job": {"id": "job-1", "business_id": "10", "business_slug": "cafe"},
                         "cards": [{"id": 2, "public_id": "card-2", "business_id": 10, "program_id": 3, "lt_benefits_card_enabled": True}]}
        result = self.service.tick()
        self.assertEqual(result["queued"], 1)
        self.assertEqual(self.enqueued[0][0]["program_id"], 3)
        self.assertEqual([call[1]["p_action"] for call in self.db.calls], ["claim", "ack"])
        self.assertEqual(self.db.calls[-1][1]["p_data"]["wallet_job_id"], "9")
        self.assertNotIn("email", repr(self.db.calls))

    def test_tick_keeps_failed_card_retryable_and_sanitizes_error(self):
        self.db.claim = {"job": {"id": "job-1", "business_id": "10", "business_slug": "cafe"}, "cards": [{"id": 2}]}
        self.service.enqueue = lambda *args, **kwargs: {"status": "queue_error", "detail": "token=secret email@example.invalid"}
        result = self.service.tick()
        self.assertEqual(result["error_type"], "RuntimeError")
        self.assertEqual([call[1]["p_action"] for call in self.db.calls], ["claim", "fail"])
        self.assertNotIn("secret", repr(self.db.calls) + repr(self.logs) + repr(result))

    def test_tick_limit_is_bounded_and_releases_partial_saved_batch(self):
        for invalid in (0, 6, True, 1.5):
            with self.assertRaises(ValueError): self.service.tick(invalid)
        self.db.claim = {"job": {"id": "job-1", "business_id": "10", "business_slug": "cafe"}, "cards": [{"id": 2}, {"id": 3}]}
        self.assertEqual(self.service.tick(1)["queued"], 1)
        self.assertEqual([call[1]["p_action"] for call in self.db.calls], ["claim", "ack", "release"])

    def test_tick_with_three_card_limit_releases_resumed_five_card_batch(self):
        self.db.claim = {"job": {"id": "job-1", "business_id": "10", "business_slug": "cafe"},
                         "cards": [{"id": identifier} for identifier in range(1, 6)]}
        self.assertEqual(self.service.tick(3)["queued"], 3)
        self.assertEqual(len(self.enqueued), 3)
        self.assertEqual([call[1]["p_action"] for call in self.db.calls], ["claim", "ack", "ack", "ack", "release"])

    def test_repeated_ticks_never_queue_more_than_five_in_sixty_seconds(self):
        now = [0]
        self.service.rate.clock = lambda: now[0]
        self.db.claim = {"job": {"id": "job-1", "business_id": "10", "business_slug": "cafe"},
                         "cards": [{"id": identifier} for identifier in range(1, 6)]}
        self.assertEqual(self.service.tick(2)['queued'], 2)
        now[0] = 20
        self.assertEqual(self.service.tick(2)['queued'], 2)
        now[0] = 40
        self.assertEqual(self.service.tick(2)['queued'], 1)
        self.assertEqual(self.service.tick(2)['queued'], 0)
        now[0] = 60
        self.assertEqual(self.service.tick(2)['queued'], 2)

    def test_db_error_never_returns_exception_text(self):
        self.db.failure = OSError("credential=secret")
        with self.assertRaises(HTTPException) as failure: self.service.status("cafe", self.admin_request)
        self.assertEqual(failure.exception.status_code, 503)
        self.assertNotIn("secret", repr(self.logs) + str(failure.exception.detail))

    def test_actual_sql_preserves_old_cards_and_durable_snapshot(self):
        module = os.getenv("LT_BENEFITS_PGLITE", "/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js")
        node = os.getenv("LT_BENEFITS_NODE", "/usr/local/bin/node")
        if not Path(module).is_file() or not Path(node).is_file(): self.skipTest("Optional isolated PGlite unavailable")
        with tempfile.TemporaryDirectory(prefix="lt-card-upgrade-") as directory:
            script = Path(directory) / "check.mjs"; script.write_text(SQL_CHECK)
            result = subprocess.run([node, str(script), module, str(Path(__file__).resolve().parents[1] / "lt_benefits_upgrade.sql")],
                                    capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Card upgrade SQL passed", result.stdout)


SQL_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const db=new PGlite();
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE customers(id bigint PRIMARY KEY,public_id text,business_id bigint,program_id bigint,points_balance int,stamp_count int,updated_at timestamptz DEFAULT '2020-01-01T00:00:00Z');
 INSERT INTO customers(id,public_id,business_id,program_id,points_balance,stamp_count) VALUES
 (1,'a',10,99,33,4),(2,'b',10,98,22,5),(3,'c',10,97,11,6),(4,'other',20,66,55,8);`);
const sql=await fs.readFile(process.argv[3],'utf8');await db.exec(sql);await db.exec(sql);
const command=async(action,data={})=>(await db.query('SELECT ltb_card_upgrade_command($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
const status=async(id='10')=>command('status',{business_id:id});
assert.equal((await status()).eligible_cards,3);
assert.equal((await db.query('SELECT lt_benefits_card_enabled FROM customers WHERE id=1')).rows[0].lt_benefits_card_enabled,null);
await db.exec(`INSERT INTO customers(id,public_id,business_id) VALUES(5,'future',10)`);
assert.equal((await db.query('SELECT lt_benefits_card_enabled FROM customers WHERE id=5')).rows[0].lt_benefits_card_enabled,true);
const started=await command('start',{business_id:'10',business_slug:'cafe'});const job=started.rollout.id;
assert.equal(started.rollout.total,3);assert.equal((await command('start',{business_id:'10',business_slug:'cafe'})).rollout.id,job);
assert.equal((await status('20')).rollout,null);
const lease='00000000-0000-4000-8000-000000000001',lease2='00000000-0000-4000-8000-000000000002';
let work=await command('claim',{lease,limit:2});assert.deepEqual(work.cards.map(c=>c.id),[1,2]);
assert.equal(work.cards[0].program_id,99);assert.equal(work.cards[0].email,undefined);
assert.equal((await command('claim',{lease:lease2})).job,null);
assert.equal((await command('ack',{job_id:job,lease:lease2,customer_id:'1'})).error,'lease_lost');
assert.equal((await command('ack',{job_id:job,lease,customer_id:'2'})).error,'card_out_of_order');
await command('ack',{job_id:job,lease,customer_id:'1',wallet_job_id:'wallet-1'});
assert.equal((await status()).rollout.queued,1);
// Crash after flag update and first acknowledgement retains card 2, despite its enabled flag.
await db.exec(`UPDATE ltb_card_upgrades SET lease_until=now()-interval '1 second' WHERE id='${job}'`);
work=await command('claim',{lease:lease2,limit:5});assert.deepEqual(work.cards.map(c=>c.id),[2]);
await command('fail',{job_id:job,lease:lease2,error_type:'secret@example.invalid'});
assert.equal((await status()).rollout.error_type,'QueueError');
await db.exec(`UPDATE ltb_card_upgrades SET next_attempt_at=now()-interval '1 second' WHERE id='${job}'`);
work=await command('claim',{lease,limit:5});assert.deepEqual(work.cards.map(c=>c.id),[2]);
await command('ack',{job_id:job,lease,customer_id:'2',wallet_job_id:'wallet-2'});
// A new join beyond the snapshot stays enabled without being added to the batch.
await db.exec(`INSERT INTO customers(id,public_id,business_id) VALUES(6,'another-future',10)`);
work=await command('claim',{lease,limit:5});assert.deepEqual(work.cards.map(c=>c.id),[3]);
await command('ack',{job_id:job,lease,customer_id:'3',wallet_job_id:'wallet-3'});
await command('claim',{lease,limit:5});const done=(await status()).rollout;
assert.equal(done.status,'completed');assert.equal(done.queued,3);assert.equal(done.remaining,0);
assert.equal((await status()).enabled_cards,5);assert.equal((await status('20')).enabled_cards,0);
assert.equal((await command('start',{business_id:'10',business_slug:'cafe'})).rollout.id,job);
const untouched=(await db.query('SELECT points_balance,stamp_count,updated_at FROM customers WHERE id=1')).rows[0];
assert.equal(untouched.points_balance,33);assert.equal(untouched.stamp_count,4);assert.equal(untouched.updated_at.getUTCFullYear(),2020);
// Terminal queue errors are admin retryable without discarding the exact pending snapshot.
await command('start',{business_id:'20',business_slug:'other'});let other=(await status('20')).rollout.id;
for(let attempt=0;attempt<5;attempt++){
 await command('claim',{lease,limit:5});await command('fail',{job_id:other,lease,error_type:'ConnectError'});
 await db.exec(`UPDATE ltb_card_upgrades SET next_attempt_at=now()-interval '1 second' WHERE id='${other}'`);
}
assert.equal((await status('20')).rollout.status,'failed');
assert.equal((await command('start',{business_id:'20',business_slug:'other'})).rollout.id,other);
assert.equal((await status('20')).rollout.failed,0);
work=await command('claim',{lease,limit:5});assert.deepEqual(work.cards.map(c=>c.id),[4]);
// A failed batch loses stale rows rather than retrying deleted/reassigned cards forever.
await command('fail',{job_id:other,lease,error_type:'ConnectError'});
await db.exec(`DELETE FROM customers WHERE id=4;UPDATE ltb_card_upgrades SET next_attempt_at=now()-interval '1 second' WHERE id='${other}'`);
work=await command('claim',{lease,limit:5});assert.equal(work.job,null);
assert.equal((await status('20')).rollout.status,'completed');assert.equal((await status('20')).rollout.skipped,1);
assert.equal((await status('20')).rollout.queued,0);
await db.exec(`INSERT INTO customers(id,public_id,business_id,lt_benefits_card_enabled) VALUES
 (10,'move-a',30,false),(11,'move-b',30,false),(12,'move-c',30,false)`);
let moved=(await command('start',{business_id:'30',business_slug:'old-slug'})).rollout.id;
work=await command('claim',{lease,limit:5});assert.deepEqual(work.cards.map(c=>c.id),[10,11,12]);
await command('fail',{job_id:moved,lease,error_type:'ConnectError'});
await db.exec(`UPDATE customers SET business_id=40,lt_benefits_card_enabled=false WHERE id=11;
 DELETE FROM customers WHERE id=12;
 UPDATE ltb_card_upgrades SET status='failed',next_attempt_at=now()-interval '1 second' WHERE id='${moved}'`);
// Verified admin retry refreshes a renamed business slug and retains its checkpoint.
assert.equal((await command('start',{business_id:'30',business_slug:'new-slug'})).rollout.id,moved);
work=await command('claim',{lease:lease2,limit:5});assert.equal(work.job.business_slug,'new-slug');
assert.deepEqual(work.cards.map(c=>c.id),[10]);assert.equal((await status('30')).rollout.skipped,2);
await command('ack',{job_id:moved,lease:lease2,customer_id:'10',wallet_job_id:'wallet-10'});
await command('claim',{lease,limit:5});assert.equal((await status('30')).rollout.status,'completed');
assert.equal((await status('30')).rollout.queued,1);assert.equal((await status('30')).rollout.scanned,3);
assert.equal((await db.query('SELECT lt_benefits_card_enabled FROM customers WHERE id=11')).rows[0].lt_benefits_card_enabled,false);
// A resumed five-card snapshot can release its lease after a three-card tick.
await db.exec(`INSERT INTO customers(id,public_id,business_id,lt_benefits_card_enabled) VALUES
 (20,'partial-1',50,false),(21,'partial-2',50,false),(22,'partial-3',50,false),(23,'partial-4',50,false),(24,'partial-5',50,false)`);
let partial=(await command('start',{business_id:'50',business_slug:'partial'})).rollout.id;
await command('claim',{lease,limit:5});
await db.exec(`UPDATE ltb_card_upgrades SET lease_until=now()-interval '1 second' WHERE id='${partial}'`);
work=await command('claim',{lease:lease2,limit:3});assert.equal(work.cards.length,5);
for(const card of work.cards.slice(0,3))await command('ack',{job_id:partial,lease:lease2,customer_id:String(card.id),wallet_job_id:'wallet-'+card.id});
await command('release',{job_id:partial,lease:lease2});
work=await command('claim',{lease,limit:3});assert.deepEqual(work.cards.map(c=>c.id),[23,24]);
// Anonymous/authenticated clients cannot invoke service-role commands.
assert.equal((await db.query("SELECT has_function_privilege('anon','ltb_card_upgrade_command(text,jsonb)','EXECUTE') ok")).rows[0].ok,false);
assert.equal((await db.query("SELECT relrowsecurity enabled FROM pg_class WHERE oid='ltb_card_upgrades'::regclass")).rows[0].enabled,true);
await db.close();console.log('Card upgrade SQL passed');
"""


if __name__ == "__main__": unittest.main()

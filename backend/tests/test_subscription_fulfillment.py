"""Synthetic payment/real isolated SQL regressions; never contact providers."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime
import json
import html
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from backend import subscription_fulfillment as fulfillment


class FulfillmentAdapterTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.db.rpc.return_value.execute.return_value.data = {'outcome': 'fulfilled'}
        self.event = dict(event_type='payment.paid', intent_id='pi_synthetic', payment_id='pay_synthetic',
            amount_centavos=35000, currency='PHP', livemode=True, business_slug='synthetic', payment_context='subscription')

    def test_exact_money_and_context(self):
        self.assertEqual(fulfillment.processor_centavos('350.25'), 35025)
        for value in ('NaN', 0, True, '0.001', '-1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                fulfillment.processor_centavos(value)
        context = fulfillment.checkout_context('sk_test_synthetic', setup_kit_included=True, setup_kit_amount=150)
        self.assertEqual(context['livemode'], False)
        self.assertEqual(context['setup_kit_amount_centavos'], 15000)
        with self.assertRaises(HTTPException): fulfillment.checkout_context('')

    def test_storage_ack_required_before_exposing_checkout(self):
        payment = dict(paymongo_payment_intent_id='pi_synthetic', payment_provider='paymongo',
                       processor_amount=350, billing_session_id='synthetic-billing-session')
        self.db.table.return_value.insert.return_value.execute.return_value.data = [payment]
        self.assertEqual(fulfillment.record_checkout_attempt(self.db, payment, {'version': 1}), payment)
        self.assertEqual(self.db.table.return_value.insert.call_args.args[0]['billing_session_id'], 'synthetic-billing-session')
        self.db.table.return_value.insert.return_value.execute.return_value.data = []
        with self.assertRaises(HTTPException) as error:
            fulfillment.record_checkout_attempt(self.db, payment, {'version': 1})
        self.assertEqual(error.exception.status_code, 503)
        self.db.table.return_value.select.return_value.limit.return_value.execute.side_effect = RuntimeError('missing schema')
        with self.assertRaises(HTTPException) as error: fulfillment.ensure_checkout_ready(self.db)
        self.assertEqual(error.exception.status_code, 503)

    def test_database_or_missing_attempt_remains_retryable(self):
        self.db.rpc.return_value.execute.side_effect = RuntimeError('synthetic outage')
        with self.assertRaises(HTTPException) as error: fulfillment.process_subscription_event(self.db, **self.event)
        self.assertEqual(error.exception.status_code, 503)
        self.db.rpc.return_value.execute.side_effect = None
        self.db.rpc.return_value.execute.return_value.data = {'outcome': 'missing_attempt'}
        with self.assertRaises(HTTPException) as error: fulfillment.process_subscription_event(self.db, **self.event)
        self.assertEqual(error.exception.status_code, 503)
        self.event.update(business_slug=None, payment_context=None)
        self.assertEqual(fulfillment.process_subscription_event(self.db, **self.event), {'outcome': 'ignored'})

    def test_boolean_amount_is_not_money_and_invalid_result_is_retryable(self):
        self.event['amount_centavos'] = True
        with self.assertRaises(HTTPException): fulfillment.process_subscription_event(self.db, **self.event)
        self.db.rpc.assert_not_called()
        self.event['amount_centavos'] = 35000
        self.db.rpc.return_value.execute.return_value.data = []
        with self.assertRaises(HTTPException) as error: fulfillment.process_subscription_event(self.db, **self.event)
        self.assertEqual(error.exception.status_code, 503)


class RealWebhookBoundaryTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        node = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'paymongo_webhook')
        node = deepcopy(node); node.decorator_list = []
        self.db = MagicMock()
        self.db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
        self.process = MagicMock(return_value={'outcome': 'replay'})
        self.env = dict(Request=object, json=json, asyncio=asyncio, datetime=datetime,
            HTTPException=HTTPException, verify_paymongo_signature=lambda *a: True,
            verify_order_ahead_paymongo_signature=lambda *a: False, supabase=self.db,
            log_event=MagicMock(), print=lambda *a: None, safe_get_business_by_id=lambda _: None)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), self.env)
        self.body = {'data': {'id': 'synthetic_event', 'attributes': {'type': 'payment.paid', 'livemode': True,
            'data': {'id': 'synthetic_payment', 'attributes': {'payment_intent_id': 'pi_synthetic',
                'amount': 35000, 'currency': 'PHP', 'metadata': {'payment_context': 'subscription'}}}}}}

    def invoke(self):
        class Request:
            headers = {}
            async def body(inner): return json.dumps(self.body).encode()
        with patch.object(fulfillment, 'process_subscription_event', self.process):
            return asyncio.run(self.env['paymongo_webhook'](Request()))

    def test_duplicate_has_no_nontransactional_entitlement_write(self):
        self.assertTrue(self.invoke()['duplicate'])
        self.db.table.return_value.update.assert_not_called()

    def test_beta_signature_cannot_fulfill_subscription(self):
        self.env['verify_paymongo_signature'] = lambda *a: False
        self.env['verify_order_ahead_paymongo_signature'] = lambda *a: True
        with self.assertRaises(HTTPException) as error: self.invoke()
        self.assertEqual(error.exception.status_code, 401)
        self.process.assert_not_called()

    def test_unavailable_database_is_retryable_not_acknowledged(self):
        self.env['supabase'] = None
        with self.assertRaises(HTTPException) as error: self.invoke()
        self.assertEqual(error.exception.status_code, 503)

    def test_admin_email_failure_cannot_undo_committed_fulfillment(self):
        self.process.return_value = {'outcome': 'fulfilled', 'business_id': 1, 'business_slug': 'synthetic', 'billing_cycle': 'monthly'}
        self.env.update(safe_get_business_by_id=lambda _: {'name': 'Synthetic business'},
            SUPER_ADMIN_EMAIL='synthetic@example.invalid', html_lib=html, money_text=lambda *a: 'PHP 350',
            subscription_currency=lambda _: 'PHP', SUBSCRIPTION_PLANS={}, billing_cycle_label=lambda x: x,
            send_email=MagicMock(side_effect=RuntimeError('synthetic mail outage')))
        self.db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        self.assertEqual(self.invoke()['fulfillment'], 'fulfilled')
        self.env['send_email'].assert_called_once()
        self.env['log_event'].assert_any_call('subscription_payment_email_failed', 'warning', error_type='RuntimeError')


class RealSQLFulfillmentTests(unittest.TestCase):
    def test_transaction_rollback_replay_validation_legacy_referrals_and_permissions(self):
        module = Path(os.getenv('LT_BENEFITS_PGLITE', '/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js'))
        node = Path(os.getenv('LT_BENEFITS_NODE', '/usr/local/bin/node'))
        if not module.is_file() or not node.is_file():
            self.skipTest('Optional isolated PostgreSQL engine unavailable; migration requires validation')
        migration = Path(__file__).resolve().parents[1] / 'subscription_fulfillment.sql'
        script = r'''
import {PGlite} from MODULE;
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
const schema=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE businesses(id bigint PRIMARY KEY,public_id text,status text DEFAULT 'ACTIVE',last_paid_at date,
 subscription_expires_at date,trial_ends_at timestamptz,billing_cycle text,setup_kit_paid boolean DEFAULT false,
 setup_kit_status text,referred_by_business_id bigint,referral_rewarded_at timestamptz,
 referral_reward_payment_intent_id text,is_demo boolean DEFAULT false);
CREATE TABLE subscription_payments(id bigserial PRIMARY KEY,business_id bigint REFERENCES businesses(id),
 public_id text,paymongo_payment_intent_id text,paymongo_payment_id text,payment_provider text DEFAULT 'paymongo',
 processor_amount numeric,processor_currency text DEFAULT 'PHP',billing_cycle text DEFAULT 'monthly',
 status text DEFAULT 'pending',paid_at timestamptz);
CREATE TABLE setup_kit_orders(business_id bigint,payment_status text,fulfillment_status text,paid_at timestamptz,updated_at timestamptz);`;
const sql=fs.readFileSync(MIGRATION,'utf8');await db.exec(schema);
await db.exec("INSERT INTO businesses(id,public_id,subscription_expires_at) VALUES(1,'legacy','2099-01-01');INSERT INTO subscription_payments(business_id,paymongo_payment_intent_id,status) VALUES(1,'legacy','paid');");
await db.exec(sql);await db.exec(sql); // rerunnable, no historical credits
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const context={version:1,provider:'paymongo',livemode:true,setup_kit_included:false};
const business=async(id,extra='')=>db.exec(`INSERT INTO businesses(id,public_id${extra?',status':''}) VALUES(${id},'b${id}'${extra?`, '${extra}'`:''})`);
const attempt=async(id,intent,ctx=context,cycle='monthly')=>db.query(`INSERT INTO subscription_payments(business_id,paymongo_payment_intent_id,processor_amount,billing_cycle,fulfillment_context) VALUES($1,$2,350,$3,$4)`,[id,intent,cycle,ctx]);
const pay=async(intent,over={})=>(await row('SELECT subscription_fulfill($1,$2,$3,$4,$5,$6,$7,$8) result',[
 over.type||'payment.paid',intent,'pay_'+intent,over.amount??35000,over.currency??'PHP',over.live??true,over.business??'',over.context??'subscription'])).result;
assert.equal((await pay('legacy')).outcome,'legacy_review');
assert.equal((await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=1')).expiry,'2099-01-01');
await business(2,'PENDING');await attempt(2,'first');assert.equal((await pay('first')).outcome,'fulfilled');
const first=await row('SELECT status,subscription_expires_at::text expiry FROM businesses WHERE id=2');assert.equal(first.status,'ACTIVE');
assert.equal((await pay('first')).outcome,'replay');assert.equal((await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=2')).expiry,first.expiry);
assert.equal((await pay('first',{type:'payment.failed'})).outcome,'replay');assert.equal((await row("SELECT status FROM subscription_payments WHERE paymongo_payment_intent_id='first'")).status,'paid');
await business(3);await attempt(3,'invalid');
for(const over of [{amount:1},{currency:'USD'},{live:false},{business:'different'},{context:'order_ahead'}])assert.equal((await pay('invalid',over)).outcome,'rejected');
assert.equal((await row('SELECT subscription_expires_at FROM businesses WHERE id=3')).subscription_expires_at,null);
assert.equal((await pay('missing')).outcome,'missing_attempt');
await db.exec("INSERT INTO subscription_payments(business_id,paymongo_payment_intent_id,processor_amount) VALUES(3,'old_pending',350)");assert.equal((await pay('old_pending')).outcome,'legacy_review');
// Force a failure AFTER merchant/setup-kit changes. The entire RPC must roll back.
await business(4,'PENDING');await business(5);await db.exec("UPDATE businesses SET referred_by_business_id=5 WHERE id=4;INSERT INTO setup_kit_orders VALUES(4,'unpaid','requested',null,null)");
await attempt(4,'rollback',{...context,setup_kit_included:true});
await db.exec(`CREATE FUNCTION fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.paymongo_payment_intent_id='rollback' AND NEW.status='paid' THEN RAISE EXCEPTION 'synthetic write failure';END IF;RETURN NEW;END$$;
CREATE TRIGGER failure BEFORE UPDATE ON subscription_payments FOR EACH ROW EXECUTE FUNCTION fail_payment();`);
await assert.rejects(pay('rollback'),/synthetic write failure/);
assert.equal((await row('SELECT subscription_expires_at FROM businesses WHERE id=4')).subscription_expires_at,null);
assert.equal((await row('SELECT payment_status FROM setup_kit_orders WHERE business_id=4')).payment_status,'unpaid');
assert.equal((await row("SELECT status FROM subscription_payments WHERE paymongo_payment_intent_id='rollback'")).status,'pending');
await db.exec('DROP TRIGGER failure ON subscription_payments;');const retry=await pay('rollback');assert.equal(retry.outcome,'fulfilled');assert.equal(retry.referral_rewarded,true);
assert.equal((await row('SELECT payment_status FROM setup_kit_orders WHERE business_id=4')).payment_status,'paid');
const referredExpiry=(await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=5')).expiry;
await attempt(4,'renew');assert.equal((await pay('renew')).outcome,'fulfilled');assert.equal((await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=5')).expiry,referredExpiry);
// Different intents extend a shared paid-through date, including calendar clamping.
await business(6);await db.exec("UPDATE businesses SET subscription_expires_at='2099-01-31' WHERE id=6");
await attempt(6,'quarter',context,'3_months');await pay('quarter');assert.equal((await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=6')).expiry,'2099-04-30');
await attempt(6,'month');await pay('month');assert.equal((await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=6')).expiry,'2099-05-30');
await business(7,'SUSPENDED');await attempt(7,'suspended');await pay('suspended');assert.equal((await row('SELECT status FROM businesses WHERE id=7')).status,'SUSPENDED');
await business(8);await db.exec("UPDATE businesses SET trial_ends_at='2099-01-15T12:00:00Z' WHERE id=8");await attempt(8,'trial');await pay('trial');assert.equal((await row('SELECT subscription_expires_at::text expiry FROM businesses WHERE id=8')).expiry,'2099-02-14');
await attempt(8,'latepaid');await pay('latepaid',{type:'qrph.expired'});await pay('latepaid');assert.equal((await row("SELECT status FROM subscription_payments WHERE paymongo_payment_intent_id='latepaid'")).status,'paid');
await assert.rejects(attempt(8,'latepaid'),e=>e.code==='23505');
const sig='subscription_fulfill(text,text,text,bigint,text,boolean,text,text)';
for(const role of ['anon','authenticated'])assert.equal((await row('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,sig])).allowed,false);
assert.equal((await row('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',['service_role',sig])).allowed,true);
await db.exec('SET ROLE anon');await assert.rejects(pay('first'),e=>e.code==='42501');await db.exec('RESET ROLE');
await db.close();
// Duplicate-intent preflight must fail atomically without discarding payment rows.
const dupe=new PGlite();await dupe.exec(schema);await dupe.exec("INSERT INTO businesses(id,public_id) VALUES(1,'dupe');INSERT INTO subscription_payments(business_id,paymongo_payment_intent_id) VALUES(1,'dupe'),(1,'dupe')");
await assert.rejects(dupe.exec(sql),/require review/);await dupe.exec('ROLLBACK');assert.equal((await dupe.query('SELECT count(*)::int n FROM subscription_payments')).rows[0].n,2);
await dupe.close();console.log('Real isolated PostgreSQL fulfillment checks passed');
'''.replace('MODULE', json.dumps(module.as_uri())).replace('MIGRATION', json.dumps(str(migration)))
        with tempfile.TemporaryDirectory(prefix='lt-subscription-sql-') as directory:
            script_path = Path(directory) / 'verify.mjs'
            script_path.write_text(script)
            result = subprocess.run([str(node), str(script_path)], capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr[-6000:])


if __name__ == '__main__': unittest.main()

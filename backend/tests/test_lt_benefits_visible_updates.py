"""Visible-only native LT updates: actual isolated SQL, never real Wallet pushes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


BACKEND = Path(os.environ.get('LT_VISIBLE_SQL_ROOT', Path(__file__).resolve().parents[1]))
if not (BACKEND / 'lt_benefits.sql').is_file():
    BACKEND = Path('/Users/user24/Desktop/loyaltree/backend')


class VisibleWalletSQLTests(unittest.TestCase):
    def run_sql(self, mode):
        module = os.getenv('LT_BENEFITS_PGLITE', '/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js')
        node = os.getenv('LT_BENEFITS_NODE', '/usr/local/bin/node')
        if not Path(module).is_file() or not Path(node).is_file():
            self.skipTest('Optional isolated PGlite runtime unavailable')
        with tempfile.TemporaryDirectory(prefix='lt-visible-sql-') as directory:
            script = Path(directory) / 'check.mjs'
            script.write_text(SQL_CHECK)
            result = subprocess.run([node, str(script), module, str(BACKEND), mode],
                                    capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('Visible Wallet SQL passed: ' + mode, result.stdout)

    def test_visible_changes_only_preserve_purchase_carry_refunds_link_and_coupon_semantics(self):
        self.run_sql('visible')

    def test_lease_snapshots_retain_newer_same_card_and_revocation_updates(self):
        self.run_sql('leases')

    def test_existing_database_addon_is_rerunnable_and_retains_legacy_processing_jobs(self):
        self.run_sql('upgrade')


SQL_CHECK = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();const root=process.argv[3],mode=process.argv[4];
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE customers(id bigint PRIMARY KEY,public_id text UNIQUE,business_id bigint,email text,phone text DEFAULT '09171234567',
 points_balance integer DEFAULT 99,stamp_count integer DEFAULT 3,updated_at timestamptz DEFAULT '2020-01-01T00:00:00Z');
 INSERT INTO customers(id,public_id,business_id,email) VALUES
 (1,'card-a',10,'one@example.invalid'),(2,'card-b',20,'one@example.invalid'),(3,'card-c',10,'one@example.invalid');`);
const base=await fs.readFile(root+'/lt_benefits.sql','utf8'),addon=await fs.readFile(root+'/lt_benefits_visible_updates.sql','utf8');
await db.exec(base);await db.exec(base);
const command=async(action,data={})=>(await db.query('SELECT ltb_command($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const card=(id=1,biz=10)=>({customer_public_id:'card-'+String.fromCharCode(96+id),customer_id:String(id),business_id:String(biz),
 business_slug:'cafe-'+biz,business_name:'Cafe '+biz,phone_key:'639171234567'});
const customer=async(id='card-a')=>(await query('SELECT * FROM customers WHERE public_id=$1',[id]))[0];
const member=async(id)=>(await query('SELECT * FROM ltb_members WHERE id=$1',[id]))[0];
const jobs=async()=>command('wallet_jobs_claim',{limit:10});
const finish=async(job,extra={})=>command('wallet_jobs_finish',{member_id:job.member_id,lease_token:job.lease_token,version:job.version,success:true,...extra});
const targets=job=>job.cards.map(c=>c.customer_public_id).sort();
const drain=async(expected)=>{const work=await jobs();assert.equal(work.length,1);assert.deepEqual(targets(work[0]),[...expected].sort());await finish(work[0]);return work[0]};
const noJobs=async()=>assert.equal((await jobs()).length,0);
const earn=async(id,amount=50000,publicId='card-a',biz='10')=>command('earn',{customer_public_id:publicId,business_id:biz,
 source_type:'receipt',source_id:id,amount_centavos:amount,currency:'PHP'});
const reverse=async(id,refund,amount=50000)=>command('reverse',{business_id:'10',source_type:'receipt',source_id:id,refund_id:refund,amount_centavos:amount});
const snapshots=async()=>query('SELECT public_id,lt_member_id,lt_points_balance,lt_points_version,lt_points_updated_at,lt_coupon_count FROM customers ORDER BY id');
const assertLocalUntouched=async()=>{for(const row of await query('SELECT points_balance,stamp_count,updated_at FROM customers')){
 assert.equal(row.points_balance,99);assert.equal(row.stamp_count,3);assert.equal(row.updated_at.getUTCFullYear(),2020)}};
await command('settings_update',{enabled:true});
await command('provision',{email:'one@example.invalid',phone_key:'639171234567',card_context:card()});
const mid=(await customer()).lt_member_id;
assert(mid);assert.equal((await customer()).lt_points_balance,0);
if(mode==='upgrade'){
 await command('link',{member_id:mid,card_context:card(2,20)});
 await earn('legacy-award');
 const pending=(await jobs())[0];assert.deepEqual(targets(pending),['card-a','card-b']);
 await db.exec("UPDATE customers SET email='new@example.invalid' WHERE id=1");
 // Model a previous release with only the original outbox columns. The addon
 // must preserve an in-flight lease even when its old worker later acknowledges.
 await db.exec('ALTER TABLE ltb_wallet_jobs DROP COLUMN dirty_cards;ALTER TABLE ltb_wallet_jobs DROP COLUMN claimed_cards;');
 const financial=JSON.stringify(await query('SELECT balance_points,version FROM ltb_members ORDER BY id'));
 const purchases=JSON.stringify(await query('SELECT * FROM ltb_purchases ORDER BY id'));
 const buckets=JSON.stringify(await query('SELECT * FROM ltb_earning_buckets ORDER BY member_id'));
 await db.exec(addon);
 const first=await query('SELECT dirty_cards FROM ltb_wallet_jobs');
 assert.deepEqual(Object.keys(first[0].dirty_cards).sort(),['card-a','card-b']);
 await db.exec(addon);assert.deepEqual(await query('SELECT dirty_cards FROM ltb_wallet_jobs'),first);
 assert.equal(JSON.stringify(await query('SELECT balance_points,version FROM ltb_members ORDER BY id')),financial);
 assert.equal(JSON.stringify(await query('SELECT * FROM ltb_purchases ORDER BY id')),purchases);
 assert.equal(JSON.stringify(await query('SELECT * FROM ltb_earning_buckets ORDER BY member_id')),buckets);
 await finish(pending);
 const resumed=(await jobs())[0];assert.deepEqual(targets(resumed),['card-a','card-b']);
 await finish(resumed);await noJobs();assert.equal((await customer()).lt_member_id,null);
 assert.equal((await customer('card-b')).lt_points_balance,1);
 assert.equal((await query("SELECT has_function_privilege('anon','ltb_touch(uuid)','EXECUTE') allowed"))[0].allowed,false);
 assert.equal((await query("SELECT has_function_privilege('authenticated','ltb_command(text,jsonb)','EXECUTE') allowed"))[0].allowed,false);
 await assertLocalUntouched();
}else{
 // An addon rerun must install the exact fresh-install definitions.
 const definitions=async()=>query("SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('ltb_touch','ltb_command','ltb_revoke_changed_contact') ORDER BY proname");
 const beforeDefs=await definitions();await db.exec(addon);await db.exec(addon);assert.deepEqual(await definitions(),beforeDefs);
 await drain(['card-a']);
 if(mode==='leases'){
  await command('link',{member_id:mid,card_context:card(2,20)});await drain(['card-b']);
  await earn('first');let old=(await jobs())[0];assert.deepEqual(targets(old),['card-a','card-b']);
  const version=(await member(mid)).version;
  // A carry-only purchase during processing creates no new token/generation.
  assert.equal((await earn('carry-only',10000)).points_earned,0);
  assert.equal((await member(mid)).version,version);
  await finish(old);await noJobs();
  await earn('second');old=(await jobs())[0];await earn('third');
  await finish(old);let newer=(await jobs())[0];assert.deepEqual(targets(newer),['card-a','card-b']);
  assert(newer.version>old.version);
  await finish(old);assert.equal((await query('SELECT status FROM ltb_wallet_jobs'))[0].status,'processing');
  // Lease expiry reclaims the same targets and rejects the older acknowledgement.
  await db.exec("UPDATE ltb_wallet_jobs SET lease_until=now()-interval '1 second'");
  let reclaimed=(await jobs())[0];assert.notEqual(reclaimed.lease_token,newer.lease_token);
  await finish(newer);assert.equal((await query('SELECT status FROM ltb_wallet_jobs'))[0].status,'processing');
  await finish(reclaimed);await noJobs();
  // Linking a new card while another card is being queued must retain the new target.
  await earn('fourth');old=(await jobs())[0];
  assert.equal((await command('link',{member_id:mid,card_context:card(3,10)})).linked,true);
  await finish(old);await drain(['card-c']);await noJobs();
  // Revocation races with an in-flight balance update; unaffected cards are acked.
  await earn('fifth');old=(await jobs())[0];
  await db.exec("UPDATE customers SET email='other@example.invalid' WHERE id=1");
  await finish(old);await drain(['card-a']);await noJobs();
  assert.equal((await customer()).lt_member_id,null);
  // Failed enqueue retains precisely its original target, not a new fanout.
  await db.exec("UPDATE customers SET phone='09181234567' WHERE id=2");
  old=(await jobs())[0];assert.deepEqual(targets(old),['card-b']);await finish(old,{success:false});
  await noJobs();await db.exec("UPDATE ltb_wallet_jobs SET next_attempt_at=now()-interval '1 second'");
  await drain(['card-b']);await noJobs();
 }else{
  const initial=await snapshots(),v=(await member(mid)).version;
  const activityBefore=(await member(mid)).updated_at;
  // An already-linked OTP verification refreshes identity proof, not a pass.
  const cid='10000000-0000-4000-8000-000000000001';
  assert.equal((await command('auth_request',{id:cid,email:'one@example.invalid',code_hash:'test-code',client_hash:'client-a',card_context:card()})).accepted,true);
  const verified=await command('auth_verify',{id:cid,code_hash:'test-code',token_hash:'test-session'});assert.equal(verified.member_id,mid);
  assert((await member(mid)).email_verified_at);assert.equal((await member(mid)).version,v);
  assert((await member(mid)).updated_at>=activityBefore);assert.deepEqual(await snapshots(),initial);await noJobs();
  await command('link',{member_id:mid,card_context:card(2,20)});await drain(['card-b']);
  const stable=await snapshots(),stableVersion=(await member(mid)).version;
  await command('link',{member_id:mid,card_context:card(2,20)});await noJobs();assert.deepEqual(await snapshots(),stable);
  // Missing legacy coupon-count projection already renders as zero. Merely
  // normalizing that internal representation must not create a visible update.
  await db.exec('UPDATE customers SET lt_coupon_count=NULL WHERE id=2');
  await db.query('SELECT ltb_touch($1)',[mid]);await noJobs();
  assert.equal((await member(mid)).version,stableVersion);
  await db.exec('UPDATE customers SET lt_coupon_count=0 WHERE id=2');
  assert.equal((await earn('carry-1',10000)).points_earned,0);assert.equal((await earn('carry-2',10000)).points_earned,0);
  assert.equal((await reverse('carry-1','carry-refund',1000)).points_reversed,0);
  await noJobs();assert.deepEqual(await snapshots(),stable);assert.equal((await member(mid)).version,stableVersion);
  const bucket=(await query('SELECT * FROM ltb_earning_buckets WHERE member_id=$1',[mid]))[0];assert.equal(bucket.net_spend_centavos,19000);assert.equal(bucket.earned_points,0);
  assert.equal((await query('SELECT count(*) n FROM ltb_purchases'))[0].n,2);
  assert.deepEqual((await query('SELECT points_delta FROM ltb_ledger ORDER BY created_at')).map(r=>r.points_delta),[0,0,0]);
  assert.equal((await earn('cross-threshold',31000)).points_earned,1);await drain(['card-a','card-b']);
  assert.equal((await customer()).lt_points_balance,1);assert.equal((await customer('card-b')).lt_points_balance,1);
  assert.equal((await earn('gain-2',50000)).points_earned,1);await drain(['card-a','card-b']);
  assert.equal((await earn('gain-3',50000)).points_earned,1);await drain(['card-a','card-b']);
  const offer=await command('offer_save',{business_id:'10',business_slug:'cafe-10',business_name:'Cafe 10',offer:{
   title:'Coupon',discount_centavos:500,points_cost:1,total_quantity:5,per_member_limit:5,status:'active'}});
  const claimed=await command('claim',{member_id:mid,offer_id:offer.id,key:'claim-first',request_hash:'claim-first'});assert(claimed.coupon);
  await drain(['card-a','card-b']);assert.equal((await customer()).lt_coupon_count,1);assert.equal((await customer('card-b')).lt_coupon_count,0);
  const otherBefore=await customer('card-b');
  const used=await command('use',{business_id:'10',coupon_id:claimed.coupon.id,customer_public_id:'card-b',bill_amount_centavos:500,key:'use-first',request_hash:'use-first'});assert.equal(used.used,true);
  await drain(['card-a']);assert.equal((await customer()).lt_coupon_count,0);
  assert.equal((await customer('card-b')).lt_points_version,otherBefore.lt_points_version);
  assert.deepEqual((await customer('card-b')).lt_points_updated_at,otherBefore.lt_points_updated_at);
  await command('link',{member_id:mid,card_context:card(3,10)});await drain(['card-c']);
  const expiring=await command('claim',{member_id:mid,offer_id:offer.id,key:'claim-expiry',request_hash:'claim-expiry'});assert(expiring.coupon);
  await drain(['card-a','card-b','card-c']);const bVersion=(await customer('card-b')).lt_points_version;
  await db.query("UPDATE ltb_coupons SET expires_at=now()-interval '1 second' WHERE id=$1",[expiring.coupon.id]);
  assert.equal((await command('maintenance',{limit:10})).members_updated,1);await drain(['card-a','card-c']);
  assert.equal((await customer('card-b')).lt_points_version,bVersion);
  assert.equal((await command('maintenance',{limit:10})).members_updated,0);await noJobs();
  // Spending then refunds can create debt. Native zero remains zero until the
  // debt is fully cleared; financial history and carry continue normally.
  assert.equal((await member(mid)).balance_points,1);
  assert.equal((await reverse('gain-3','to-zero')).points_reversed,1);await drain(['card-a','card-b','card-c']);
  const zero=await snapshots(),zeroVersion=(await member(mid)).version;
  assert.equal((await reverse('gain-2','negative')).points_reversed,1);assert.equal((await member(mid)).balance_points,-1);
  await noJobs();assert.deepEqual(await snapshots(),zero);assert.equal((await member(mid)).version,zeroVersion);
  assert.equal((await earn('clear-debt')).points_earned,1);assert.equal((await member(mid)).balance_points,0);
  await noJobs();assert.deepEqual(await snapshots(),zero);
  assert.equal((await earn('visible-again')).points_earned,1);await drain(['card-a','card-b','card-c']);
  assert.equal((await customer()).lt_points_balance,1);
  const normalized=await snapshots();await db.exec("UPDATE customers SET email=' ONE@EXAMPLE.INVALID ',phone='+63 917 123 4567' WHERE id=1");
  await noJobs();assert.deepEqual(await snapshots(),normalized);
  await db.exec("UPDATE customers SET email='new@example.invalid' WHERE id=1");
  await drain(['card-a']);assert.equal((await customer()).lt_member_id,null);assert.equal((await customer()).lt_points_balance,null);
  await command('provision',{email:'new@example.invalid',phone_key:'639171234567',card_context:card()});
  await drain(['card-a']);assert.notEqual((await customer()).lt_member_id,mid);assert.equal((await customer()).lt_points_balance,0);
 }
 await assertLocalUntouched();
}
console.log('Visible Wallet SQL passed: '+mode);await db.close();
"""


if __name__ == '__main__':
    unittest.main()

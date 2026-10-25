import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const root=process.argv[3];
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE businesses(id bigint PRIMARY KEY,public_id text,name text,logo_url text);
 INSERT INTO businesses VALUES(10,'cafe-a','Cafe A',NULL),(20,'cafe-b','Cafe B',NULL);
 CREATE TABLE customers(id bigint PRIMARY KEY,public_id text UNIQUE,business_id bigint,email text,phone text,
 lt_benefits_card_enabled boolean DEFAULT true,points_balance integer DEFAULT 99,stamp_count integer DEFAULT 4,updated_at timestamptz DEFAULT now());
 INSERT INTO customers(id,public_id,business_id,email,phone,lt_benefits_card_enabled) VALUES
 (1,'a',10,'same@example.invalid','09171234567',true),(2,'b',20,'same@example.invalid','09181234567',true),
 (3,'carry-a',10,'carry@example.invalid','09171234567',true),(4,'carry-b',20,'carry@example.invalid','09181234567',true),
 (5,'optout',20,'same@example.invalid','09171234567',false),(6,'no-phone',10,'phonefree@example.invalid',NULL,true),
 (8,'coupon-a',10,'coupons@example.invalid','09171234567',true),(9,'coupon-b',20,'coupons@example.invalid','09181234567',true),
 (14,'shared-a',10,'shared@example.invalid',NULL,true),(15,'shared-b',20,'shared@example.invalid',NULL,true);`);
const base=await fs.readFile(root+'/lt_benefits.sql','utf8');await db.exec(base);
const command=async(action,data={})=>(await db.query('SELECT ltb_command($1,$2) result',[action,JSON.stringify(data)])).rows[0].result;
const context=(publicId,id,business)=>({customer_public_id:publicId,customer_id:String(id),business_id:String(business),business_slug:'cafe-'+business,business_name:'Cafe '+business});
const provision=async(publicId,id,business,email,phone)=>command('provision',{email,phone_key:phone,card_context:{...context(publicId,id,business),phone_key:phone}});
const earn=(publicId,business,source,amount)=>command('earn',{customer_public_id:publicId,business_id:String(business),source_type:'receipt',source_id:source,amount_centavos:amount,currency:'PHP'});
await command('settings_update',{enabled:true});
// Seed two real pre-migration pair profiles, including independent purchase carry.
await provision('a',1,10,'same@example.invalid','639171234567');
await provision('b',2,20,'same@example.invalid','639181234567');
assert.equal((await earn('a',10,'five',250000)).points_earned,5);
assert.equal((await earn('b',20,'two',100000)).points_earned,2);
await provision('carry-a',3,10,'carry@example.invalid','639171234567');
await provision('carry-b',4,20,'carry@example.invalid','639181234567');
assert.equal((await earn('carry-a',10,'carry-a',30000)).points_earned,0);
assert.equal((await earn('carry-b',20,'carry-b',30000)).points_earned,0);
const pairIds=(await db.query("SELECT id FROM ltb_members WHERE email='same@example.invalid' ORDER BY created_at,id")).rows.map(x=>x.id);
await provision('coupon-a',8,10,'coupons@example.invalid','639171234567');
await provision('coupon-b',9,20,'coupons@example.invalid','639181234567');
await earn('coupon-a',10,'coupon-a-purchase',250000);await earn('coupon-b',20,'coupon-b-purchase',250000);
const couponIds=(await db.query("SELECT id FROM ltb_members WHERE email='coupons@example.invalid' ORDER BY created_at,id")).rows.map(x=>x.id);
const offer=await command('offer_save',{business_id:'10',business_slug:'cafe-a',business_name:'Cafe A',offer:{title:'Historic coupon',discount_centavos:2000,points_cost:1,total_quantity:20,per_member_limit:1,status:'active'}});
const oldClaimA=await command('claim',{member_id:couponIds[0],offer_id:offer.id,key:'same-legacy-key',request_hash:'same-offer'});
const oldClaimB=await command('claim',{member_id:couponIds[1],offer_id:offer.id,key:'same-legacy-key',request_hash:'same-offer'});
assert(oldClaimA.coupon);assert(oldClaimB.coupon);
const secondOffer=await command('offer_save',{business_id:'10',business_slug:'cafe-a',business_name:'Cafe A',offer:{title:'Unique legacy claim',discount_centavos:2000,points_cost:1,total_quantity:20,per_member_limit:1,status:'active'}});
const uniqueOld=await command('claim',{member_id:couponIds[1],offer_id:secondOffer.id,key:'unique-old-key',request_hash:'second-offer'});assert(uniqueOld.coupon);
// Preserve a revoked-card clear already leased by a worker on the source alias.
await db.exec("INSERT INTO customers(id,public_id,business_id,email,phone) VALUES(11,'revoked',20,'same@example.invalid','09181234567')");
assert.equal((await command('link',{member_id:pairIds[1],card_context:context('revoked',11,20)})).linked,true);
await db.exec("UPDATE customers SET email='changed@example.invalid' WHERE public_id='revoked'");
const oldJobs=await command('wallet_jobs_claim',{limit:10});const oldLease=oldJobs.find(x=>x.member_id===pairIds[1]);
assert(oldLease.cards.some(x=>x.customer_public_id==='revoked'));
const migration=await fs.readFile(root+'/lt_benefits_email_identity.sql','utf8');
await db.exec(migration);await db.exec(migration);
assert.equal((await db.query('SELECT count(*) n FROM ltb_email_identities')).rows[0].n,0,'migration never trusts contacts');
assert.equal((await db.query("SELECT balance_points FROM ltb_members WHERE email='same@example.invalid' ORDER BY balance_points")).rows.map(x=>Number(x.balance_points)).join(','),'2,5');
const unknownChallenge='99999999-0000-4000-8000-000000000001';
assert.equal((await command('auth_request',{id:unknownChallenge,email:'unknown@example.invalid',code_hash:'correct',client_hash:'unknown',card_context:{kind:'email'}})).accepted,false);
assert.equal((await db.query('SELECT count(*) n FROM ltb_auth_challenges WHERE id=$1',[unknownChallenge])).rows[0].n,0);
assert.equal((await db.query("SELECT count(*) n FROM ltb_members WHERE email='unknown@example.invalid'")).rows[0].n,0);
// A preexisting/injected stale challenge cannot bypass current registration.
await db.query("INSERT INTO ltb_auth_challenges(id,email,code_hash,client_hash,card_context,expires_at) VALUES($1,'unknown@example.invalid','correct','unknown','{\"kind\":\"email\"}',now()+interval '10 minutes')",[unknownChallenge]);
assert.equal((await command('auth_verify',{id:unknownChallenge,code_hash:'correct',token_hash:'unknown'})).error,'invalid_code');
assert.equal((await db.query("SELECT count(*) n FROM ltb_members WHERE email='unknown@example.invalid'")).rows[0].n,0);
let challengeIndex=1;
const request=async(email,ctx={kind:'email'})=>{
 const id='10000000-0000-4000-8000-'+String(challengeIndex++).padStart(12,'0');
 await db.exec("UPDATE ltb_auth_challenges SET created_at=now()-interval '61 seconds'");
 assert.equal((await command('auth_request',{id,email,code_hash:'correct',client_hash:'client-'+id,card_context:ctx})).accepted,true);
 return id;
};
const verify=async(email,ctx)=>{const id=await request(email,ctx);const result=await command('auth_verify',{id,code_hash:'correct',token_hash:'token-'+id});assert(result.member_id,JSON.stringify(result));return {...result,token:'token-'+id};};
const badId=await request('same@example.invalid');
assert.equal((await command('auth_verify',{id:badId,code_hash:'wrong',token_hash:'bad'})).error,'invalid_code');
assert.equal((await db.query('SELECT count(*) n FROM ltb_email_identities')).rows[0].n,0);
// OTP proof is email-only; different business phones do not split the balance.
const same=await verify('same@example.invalid');
let rows=(await db.query("SELECT public_id,lt_points_balance,points_balance,stamp_count FROM customers WHERE public_id IN('a','b','optout') ORDER BY public_id")).rows;
assert.equal(Number(rows[0].lt_points_balance),7);assert.equal(Number(rows[1].lt_points_balance),7);
assert.equal(rows[2].lt_points_balance,null,'existing opt-out stays excluded');
assert(rows.every(x=>x.points_balance===99&&x.stamp_count===4),'merchant rewards stay untouched');
assert.equal((await command('me',{member_id:pairIds[1]})).balance_points,7,'old aliases resolve');
assert.equal((await earn('b',20,'two',100000)).status,'replay','original purchase idempotency survives');
const refund={business_id:'20',source_type:'receipt',source_id:'two',refund_id:'after-merge',amount_centavos:50000};
assert.equal((await command('reverse',refund)).points_reversed,1);
assert.equal((await command('reverse',refund)).status,'replay');
assert.equal((await command('me',{member_id:same.member_id})).balance_points,6);
assert.deepEqual((await db.query("SELECT lt_points_balance FROM customers WHERE public_id IN('a','b')")).rows.map(x=>Number(x.lt_points_balance)),[6,6]);
await command('wallet_jobs_finish',{member_id:pairIds[1],lease_token:oldLease.lease_token,success:false});
await db.exec('UPDATE ltb_wallet_jobs SET next_attempt_at=now()');
const retryClear=(await command('wallet_jobs_claim',{limit:10})).find(x=>x.member_id===pairIds[1]);
assert(retryClear.cards.some(x=>x.customer_public_id==='revoked'),'old clear survives alias merge and lease failure');
await command('wallet_jobs_finish',{member_id:pairIds[1],lease_token:retryClear.lease_token,success:true});
const carry=await verify('carry@example.invalid');
assert.equal((await command('me',{member_id:carry.member_id})).balance_points,1,'two partial carries create one point');
assert.equal((await command('reverse',{business_id:'10',source_type:'receipt',source_id:'carry-a',refund_id:'carry-refund',amount_centavos:30000})).points_reversed,1);
assert.equal((await command('me',{member_id:carry.member_id})).balance_points,0);
assert.equal(Number((await db.query('SELECT net_spend_centavos FROM ltb_earning_buckets WHERE member_id=$1',[carry.member_id])).rows[0].net_spend_centavos),30000);
const coupons=await verify('coupons@example.invalid');
assert.equal((await command('me',{member_id:coupons.member_id})).balance_points,7);
assert.equal((await command('me',{member_id:coupons.member_id})).coupons.length,3,'all original coupon snapshots survive');
assert.equal((await command('claim',{member_id:coupons.member_id,offer_id:offer.id,key:'new-after-merge',request_hash:'same-offer'})).error,'member_limit','alias claims count toward the canonical cap');
assert.equal((await command('claim',{member_id:coupons.member_id,offer_id:offer.id,key:'same-legacy-key',request_hash:'same-offer'})).error,'idempotency_conflict','two real historic claims sharing a key are never silently discarded');
const replayClaim=await command('claim',{member_id:couponIds[1],offer_id:secondOffer.id,key:'unique-old-key',request_hash:'second-offer'});
assert.equal(replayClaim.coupon.id,uniqueOld.coupon.id);assert.equal(replayClaim.balance_points,7,'legacy replay returns current shared balance');
assert.equal((await command('claim',{member_id:coupons.member_id,offer_id:secondOffer.id,key:'unique-old-key',request_hash:'different-offer'})).error,'idempotency_conflict');
const couponUse={business_id:'10',customer_public_id:'coupon-b',coupon_id:oldClaimB.coupon.id,bill_amount_centavos:50000,key:'use-merged',request_hash:'use-merged'};
const uses=await Promise.all(Array.from({length:5},()=>command('use',couponUse)));
assert(uses.every(x=>x.used),'retry burst preserves one redemption');
assert.equal((await db.query("SELECT count(*) n FROM ltb_coupons WHERE member_id=$1 AND status='used'",[coupons.member_id])).rows[0].n,1);
assert.equal((await command('reverse',{business_id:'20',source_type:'receipt',source_id:'coupon-b-purchase',refund_id:'historic-refund',amount_centavos:250000})).points_reversed,5,'refund of aliased purchase keeps original source');
assert.equal((await command('me',{member_id:coupons.member_id})).balance_points,2);
await provision('no-phone',6,10,'phonefree@example.invalid','');
const phonefree=await verify('phonefree@example.invalid',context('no-phone',6,10));
assert.equal((await earn('no-phone',10,'phonefree-purchase',50000)).points_earned,1);
assert.equal((await command('session',{token_hash:phonefree.token})).member_id,phonefree.member_id);
await db.exec("UPDATE customers SET phone='09991234567' WHERE public_id='no-phone'");
assert.equal((await command('session',{token_hash:phonefree.token})).member_id,phonefree.member_id,'phone edit does not revoke email identity');
await db.exec("UPDATE customers SET email='new@example.invalid' WHERE public_id='no-phone'");
assert.equal((await command('session',{token_hash:phonefree.token})).error,'unauthorized','email edit revokes card session');
assert.equal((await db.query("SELECT lt_member_id FROM customers WHERE public_id='no-phone'")).rows[0].lt_member_id,null);
await db.exec("UPDATE customers SET email='phonefree@example.invalid' WHERE public_id='no-phone'");
await provision('no-phone',6,10,'phonefree@example.invalid','');
assert.equal((await command('wallet_projection',{customer_public_id:'no-phone'})).balance,0,'reprovision cannot reopen a verified canonical pending-key profile');
await verify('phonefree@example.invalid');
assert.equal((await command('wallet_projection',{customer_public_id:'no-phone'})).balance,1);
// New unverified same-email cards cannot read the existing balance until linked.
await db.exec("INSERT INTO customers(id,public_id,business_id,email) VALUES(7,'new-card',20,'same@example.invalid')");
await provision('new-card',7,20,'same@example.invalid','');
assert.equal((await command('wallet_projection',{customer_public_id:'new-card'})).balance,0);
assert.equal((await command('link',{member_id:same.member_id,card_context:context('new-card',7,20)})).linked,true);
assert.equal((await command('wallet_projection',{customer_public_id:'new-card'})).balance,6);
// Email-away/back cannot resurrect an alias or expose an old verified balance.
await db.exec("UPDATE customers SET email='temporary@example.invalid' WHERE public_id='new-card';UPDATE customers SET email='same@example.invalid' WHERE public_id='new-card'");
await provision('new-card',7,20,'same@example.invalid','');
assert.equal((await command('wallet_projection',{customer_public_id:'new-card'})).balance,0);
assert.equal((await command('link',{member_id:same.member_id,card_context:context('new-card',7,20)})).linked,true);
await db.exec("UPDATE customers SET email='temporary@example.invalid' WHERE public_id='a';UPDATE customers SET email='same@example.invalid' WHERE public_id='a'");
await provision('a',1,10,'same@example.invalid','');
assert.equal((await command('wallet_projection',{customer_public_id:'a'})).balance,0);
await verify('same@example.invalid');
assert.equal((await command('wallet_projection',{customer_public_id:'a'})).balance,6);
// After linking, a new purchase at Business B updates BOTH cards immediately
// in the database; the durable outbox handles asynchronous device refresh.
await provision('shared-a',14,10,'shared@example.invalid','');
assert.equal((await earn('shared-a',10,'shared-five',250000)).points_earned,5);
const shared=await verify('shared@example.invalid');
assert.equal((await earn('shared-b',20,'shared-two',100000)).points_earned,2);
assert.deepEqual((await db.query("SELECT lt_points_balance FROM customers WHERE public_id IN('shared-a','shared-b')")).rows.map(x=>Number(x.lt_points_balance)),[7,7]);
assert.equal((await command('me',{member_id:shared.member_id})).balance_points,7);
// Repeated OTP and migration are idempotent; activity includes immutable alias history.
const transfers=(await db.query('SELECT count(*) n FROM ltb_identity_transfers')).rows[0].n;
await verify('same@example.invalid');await db.exec(migration);
const concurrentChallenge=await request('same@example.invalid');
const attempts=await Promise.all(Array.from({length:4},(_,i)=>command('auth_verify',{id:concurrentChallenge,code_hash:'correct',token_hash:'concurrent-'+i})));
assert.equal(attempts.filter(x=>x.member_id===same.member_id).length,1,'same challenge can be consumed once in a retry burst');
assert.equal(attempts.filter(x=>x.error==='invalid_code').length,3);
assert.equal((await db.query('SELECT count(*) n FROM ltb_identity_transfers')).rows[0].n,transfers);
assert.equal((await command('me',{member_id:same.member_id})).balance_points,6);
const activity=await command('me',{member_id:same.member_id,limit:1});assert.equal(activity.activity.length,1);assert.equal(activity.has_more,true);
assert.equal((await command('session',{token_hash:same.token})).member_id,same.member_id,'generic email session remains bound to its email');
// A failure mid-merge rolls back transfers, aliases, coupons, buckets and identity.
await db.exec("INSERT INTO customers(id,public_id,business_id,email) VALUES(10,'rollback',10,'rollback@example.invalid')");
await provision('rollback',10,10,'rollback@example.invalid','');await earn('rollback',10,'rollback-source',50000);
await db.exec(`CREATE FUNCTION reject_identity_touch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.email='rollback@example.invalid' AND NEW.email_verified_at IS NOT NULL THEN RAISE EXCEPTION 'test failure';END IF;RETURN NEW;END$$;
 CREATE TRIGGER reject_identity_touch BEFORE UPDATE ON ltb_members FOR EACH ROW EXECUTE FUNCTION reject_identity_touch();`);
const rollbackId=await request('rollback@example.invalid');
assert.equal((await command('auth_verify',{id:rollbackId,code_hash:'correct',token_hash:'rollback-token'})).error,'identity_merge_review');
assert.equal((await db.query("SELECT count(*) n FROM ltb_email_identities WHERE email='rollback@example.invalid'")).rows[0].n,0);
assert.equal((await db.query("SELECT balance_points FROM ltb_members WHERE email='rollback@example.invalid'")).rows[0].balance_points,1);
assert.equal((await db.query("SELECT consumed_at FROM ltb_auth_challenges WHERE id=$1",[rollbackId])).rows[0].consumed_at,null);
await db.exec('DROP TRIGGER reject_identity_touch ON ltb_members');
assert((await command('auth_verify',{id:rollbackId,code_hash:'correct',token_hash:'rollback-token'})).member_id,'same valid OTP can retry rolled-back merge');
// Coupon addon order is independent of this identity wrapper; run both twice.
const couponMigration=await fs.readFile(root+'/lt_benefits_coupon_limits.sql','utf8');
await db.exec(couponMigration);await db.exec(migration);await db.exec(couponMigration);
assert.equal((await command('me',{member_id:same.member_id})).balance_points,6);
for(const fn of ['ltb_identity_command(text,jsonb)','ltb_merge_verified_email(text)','ltb_resolve_member(uuid)']){
 assert.equal((await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') yes",[fn])).rows[0].yes,false);
 assert.equal((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') yes",[fn])).rows[0].yes,false);
}
assert.equal((await db.query("SELECT has_table_privilege('authenticated','ltb_email_identities','SELECT') yes")).rows[0].yes,false);
console.log('Email identity SQL passed');await db.close();

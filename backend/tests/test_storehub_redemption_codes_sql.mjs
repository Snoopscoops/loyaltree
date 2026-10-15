import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
process.on('uncaughtException',e=>{console.error(JSON.stringify({message:e.message,code:e.code,position:e.position,where:e.where,detail:e.detail}));process.exit(1)});
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const local=new URL('./',import.meta.url);
const backend=new URL('../',local);
const db=new PGlite();let passed=0;
const baseline=await fs.readFile(new URL('redemption_schema_fixture.sql',local),'utf8');
const migration=await fs.readFile(process.argv[3]||new URL('storehub_redemption_codes.sql',backend),'utf8');
const offline=await fs.readFile(process.argv[4]||new URL('storehub_offline_sales.sql',backend),'utf8');
await db.exec(baseline);
await db.exec(await fs.readFile(new URL('storehub_void_reconciliation.sql',backend),'utf8'));
for(const name of ['pos_offline_trim','pos_offline_sale_lock_scope','pos_offline_sale_assert_device']){
  const a=offline.indexOf('create or replace function public.'+name+'(');assert(a>=0,name);
  const end=name==='pos_offline_trim'?offline.indexOf('$$;',a)+3:offline.indexOf('end $$;',a)+7;
  await db.exec(offline.slice(a,end));
}
await db.exec(migration);
const ids={integration:'10000000-0000-4000-8000-000000000001',mapping:'10000000-0000-4000-8000-000000000002',
  device:'10000000-0000-4000-8000-000000000003',session:'10000000-0000-4000-8000-000000000004',tx:'10000000-0000-4000-8000-000000000005'};
let now;
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function reset(){
  await db.exec('TRUNCATE pos_points_prize_spends,pos_redemption_codes,pos_redemption_reservations,pos_coupon_reservations,pos_benefit_reservations,pos_transactions,pos_companion_sessions,customers,coupons,pos_devices,pos_branch_mappings,branches,pos_integrations,membership_benefit_redemptions,wallet_sync_jobs');
  now=(await one('SELECT now() t')).t;
  await db.query("INSERT INTO pos_integrations VALUES($1,1,'storehub')",[ids.integration]);
  await db.exec('INSERT INTO branches VALUES(50,1,true)');
  await db.query("INSERT INTO pos_branch_mappings VALUES($1,1,50,$2,true,'outlet')",[ids.mapping,ids.integration]);
  await db.query("INSERT INTO pos_devices VALUES($1,1,50,$2,$3,'storehub','active',$4)",[ids.device,ids.integration,ids.mapping,JSON.stringify({external_terminal_id:'register'})]);
  await db.exec("INSERT INTO customers(id,business_id,public_id,identity_id,program_id,points_balance) VALUES(10,1,'member',100,1,500),(11,1,'employee',100,2,0),(12,1,'other',200,1,500)");
  await db.query("INSERT INTO pos_companion_sessions(id,device_id,business_id,branch_id,integration_id,customer_id,customer_public_id,source_customer_public_id,scanned_at,expires_at) VALUES($1,$2,1,50,$3,10,'member','member',now()-interval '1 minute',now()+interval '5 minutes')",[ids.session,ids.device,ids.integration]);
  await db.exec("INSERT INTO coupons(id,public_id,business_id,customer_id,reward_text,reward_type,reward_value) VALUES(5,'reward',1,11,'Birthday coffee','fixed_discount',50)");
}
function payload(kind,patch={}){return {kind,name:kind+' reward',instruction:'Apply PHP 50 off',
  gross_amount:'200.00',discount_amount:'50.00',expected_total:'150.00',currency:'PHP',
  external_branch_id:'outlet',external_terminal_id:'register',request_hash:'a'.repeat(64),
  customer_id:kind==='points'?10:11,earning_customer_id:10,program_id:kind==='points'?1:2,
  points:50,value_per_point:1,max_percent:100,hold_minutes:10,coupon_id:5,
  reward_id:'meal',benefit_type:'fixed_discount',benefit_value:50,usage_limit:1,
  window_start:new Date(new Date(now).setUTCHours(0,0,0,0)).toISOString(),
  window_end:new Date(new Date(now).setUTCHours(24,0,0,0)).toISOString(),...patch};}
const issue=async(kind='points',patch={},request=randomUUID())=>(await one('SELECT pos_issue_redemption_code($1,$2,$3,$4) c',[ids.device,ids.session,request,JSON.stringify(payload(kind,patch))])).c;
const confirm=async(c,receipt='INV-12345')=>(await one('SELECT pos_confirm_redemption_code($1,$2,$3) c',[ids.device,c.id,receipt])).c;
const claim=async()=>(await db.query('SELECT pos_claim_redemption_codes(1) c')).rows.map(r=>r.c);
const bind=async(c)=>(await one('SELECT pos_claim_redemption_receipt($1,$2,$3) t',[c.id,c.lease_token,ids.tx])).t;
const commit=async(c)=>(await one('SELECT pos_commit_code_reward($1,$2) r',[c.id,c.lease_token])).r;
const finish=async(c,status='redeemed')=>{if(status==='redeemed'){await db.query("UPDATE pos_transactions SET status='loyalty_applied',processing_metadata=processing_metadata||jsonb_build_object('loyalty_result',CASE WHEN $1='points' THEN jsonb_build_object('redemption_reservation_id',$2::text) ELSE '{}'::jsonb END)",[c.kind,c.reservation_id]);}return (await one('SELECT pos_finish_redemption_code($1,$2,$3,$4,$5) c',[c.id,c.lease_token,status,'test','{}'])).c;};
const cancel=async(c)=>(await one('SELECT pos_cancel_redemption_code($1,$2) c',[ids.device,c.id])).c;
const bad=async(fn,pattern)=>assert.rejects(fn,pattern);
async function sale(c,patch={}){
  const data={id:ids.tx,integration_id:ids.integration,business_id:1,branch_id:50,provider:'storehub',external_transaction_id:'sale-1',
    external_receipt_number:'INV-12345',transaction_type:'sale',status:'received',currency:'PHP',net_amount:150,gross_amount:150,
    raw_payload:{storeId:'outlet',registerId:'register',discount:50,isCancelled:false,items:[{notes:c.code}]},
    processing_metadata:{},transacted_at:now,...patch};
  const keys=Object.keys(data);await db.query(`INSERT INTO pos_transactions(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,
    Object.values(data).map(v=>v&&typeof v==='object'&&!(v instanceof Date)?JSON.stringify(v):v));
}
const test=async(name,fn)=>{await fn();passed++;process.stdout.write('PASS '+name+'\n');};
try{
  await test('migration reruns and protects code table and RPCs',async()=>{
    await db.exec(migration);
    assert.equal((await one("SELECT has_table_privilege('anon','pos_redemption_codes','SELECT') ok")).ok,false);
    assert.equal((await one("SELECT has_function_privilege('authenticated','pos_issue_redemption_code(text,text,text,jsonb)','EXECUTE') ok")).ok,false);
  });
  for(const kind of ['points','coupon','benefit']){
    await test(kind+': atomic reserve, confirm, exact receipt, once-only consumption',async()=>{
      await reset();let c=await issue(kind);assert.match(c.code,/^LT-[A-F0-9]{12}$/);
      assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,500);
      assert.equal((await one('SELECT count(*) n FROM membership_benefit_redemptions')).n,0);
      assert.equal((await claim()).length,0);
      c=await confirm(c);assert.equal(c.status,'confirmed');assert.equal((await cancel(c).catch(e=>e)).code,'P0001');
      const [job]=await claim();await sale(c);await bind(job);const applied=await commit(job);assert.equal(applied.status,'committed');
      await commit(job);await finish(job);
      assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,kind==='points'?450:500);
      assert.equal((await one('SELECT status FROM coupons WHERE id=5')).status,kind==='coupon'?'redeemed':'active');
      assert.equal((await one('SELECT count(*) n FROM membership_benefit_redemptions')).n,kind==='benefit'?1:0);
      assert.equal((await confirm(c)).status,'redeemed');assert.equal((await claim()).length,0);
    });
    await test(kind+': unused cancellation releases underlying reservation',async()=>{
      await reset();const c=await issue(kind);assert.equal((await cancel(c)).status,'cancelled');
      const table={points:'pos_redemption_reservations',coupon:'pos_coupon_reservations',benefit:'pos_benefit_reservations'}[kind];
      assert.equal((await one(`SELECT status FROM ${table}`)).status,'released');
    });
    await test(kind+': failed code insertion rolls back reservation too',async()=>{
      await reset();await bad(()=>issue(kind,{expected_total:149}),/check constraint/);
      const table={points:'pos_redemption_reservations',coupon:'pos_coupon_reservations',benefit:'pos_benefit_reservations'}[kind];
      assert.equal((await one(`SELECT count(*) n FROM ${table}`)).n,0);
    });
  }
  await test('same request returns same code and conflicting replay is rejected',async()=>{
    await reset();const key=randomUUID(),a=await issue('points',{},key),b=await issue('points',{},key);assert.equal(a.id,b.id);
    await bad(()=>issue('points',{request_hash:'b'.repeat(64)},key),/different reward request/);
    assert.equal((await one('SELECT count(*) n FROM pos_redemption_reservations')).n,1);
  });
  await test('one active code per POS and identity membership boundaries are enforced',async()=>{
    await reset();await issue();await bad(()=>issue('coupon'),/current reward/);
    await reset();await bad(()=>issue('points',{customer_id:12,earning_customer_id:12}),/another customer/);
    assert.equal((await one('SELECT count(*) n FROM pos_redemption_codes')).n,0);
  });
  await test('inactive and reassigned registers cannot issue or claim',async()=>{
    await reset();await db.exec("UPDATE pos_devices SET status='disabled'");await bad(()=>issue(),/active StoreHub/);
    await reset();let c=await issue();c=await confirm(c);const[job]=await claim();await sale(c);
    await db.query('UPDATE pos_devices SET metadata=$1',[JSON.stringify({external_terminal_id:'other'})]);
    await bad(()=>bind(job),/active StoreHub/);
  });
  await test('cashier confirmation alone cannot consume a reward',async()=>{
    await reset();const c=await confirm(await issue());const[job]=await claim();await bad(()=>commit(job),/verified receipt/);
    assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,500);
  });
  await test('unconfirmed and stale leases cannot claim receipts',async()=>{
    await reset();const c=await issue();await sale(c);await bad(()=>bind({...c,lease_token:randomUUID()}),/lease expired/);
    await confirm(c);const[job]=await claim();await db.exec("UPDATE pos_redemption_codes SET lease_expires_at=now()-interval '1 second'");
    await bad(()=>bind(job),/lease expired/);
  });
  await test('wrong receipt, discount, total, currency and missing amounts fail closed',async()=>{
    for(const patch of [{external_receipt_number:'OTHER'},{net_amount:151},{currency:'USD'},{net_amount:null,gross_amount:null},
      {raw_payload:{storeId:'outlet',registerId:'register',discount:49,isCancelled:false}},
      {raw_payload:{storeId:'outlet',registerId:'other',discount:50,isCancelled:false}},
      {raw_payload:{storeId:'outlet',registerId:'register',discount:50,isCancelled:true}}]){
      await reset();const c=await confirm(await issue());const[job]=await claim();await sale(c,patch);await bad(()=>bind(job),/does not match/);
    }
  });
  await test('next customer online claim cannot steal a reserved reward receipt',async()=>{
    await reset();const c=await issue();await sale(c);
    await bad(()=>db.query('UPDATE pos_transactions SET customer_id=12 WHERE id=$1',[ids.tx]),/reserved reward code/);
    assert.equal((await one('SELECT customer_id FROM pos_transactions')).customer_id,null);
  });
  await test('coupon cannot be redeemed through a different channel while reserved',async()=>{
    await reset();await issue('coupon');await bad(()=>db.exec("UPDATE coupons SET status='redeemed' WHERE id=5"),/reserved on a StoreHub/);
    assert.equal((await one('SELECT status FROM coupons')).status,'active');
  });
  await test('pending verified void releases an unconsumed code reservation',async()=>{
    await reset();const c=await confirm(await issue('coupon'));const[job]=await claim();
    await sale(c,{transaction_type:'void',status:'voided',raw_payload:{storeId:'outlet',registerId:'register',isCancelled:true,notes:c.code}});
    const row=(await one('SELECT pos_abort_voided_redemption_code($1,$2,$3) c',[job.id,job.lease_token,ids.tx])).c;
    assert.equal(row.status,'cancelled');assert.equal((await one('SELECT status FROM pos_coupon_reservations')).status,'released');
  });
  for(const kind of ['points','coupon','benefit']){
    await test(kind+': void restores reward once, preserves used code and Wallet retry',async()=>{
      await reset();const c=await confirm(await issue(kind));const[job]=await claim();await sale(c);await bind(job);await commit(job);await finish(job);
      await db.exec("UPDATE pos_transactions SET transaction_type='void',raw_payload=raw_payload||'{\"isCancelled\":true}'::jsonb");
      await db.exec("UPDATE pos_redemption_codes SET next_attempt_at=now()");const[reverse]=await claim();assert.equal(reverse.status,'redeemed');
      const row=(await one('SELECT pos_reverse_redemption_code($1,$2) c',[reverse.id,reverse.lease_token])).c;assert.equal(row.status,'reversed');
      await db.query('SELECT pos_reverse_redemption_code($1,$2)',[reverse.id,reverse.lease_token]);
      assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,500);
      assert.equal((await one('SELECT status FROM coupons')).status,'active');
      if(kind==='benefit')assert((await one('SELECT pos_voided_at FROM membership_benefit_redemptions')).pos_voided_at);
      assert((await one('SELECT count(*) n FROM wallet_sync_jobs')).n>0);assert.equal((await claim()).length,0);
    });
  }
  await test('issued price snapshots and closed codes cannot be changed or reused',async()=>{
    await reset();const c=await issue();await bad(()=>db.exec("UPDATE pos_redemption_codes SET name='Changed'"),/snapshot cannot be changed/);
    await cancel(c);await bad(()=>db.exec("UPDATE pos_redemption_codes SET status='confirmed'"),/cannot be reused/);
  });
  await test('final acknowledgement requires both verified sale and committed reward',async()=>{
    await reset();const c=await confirm(await issue());const[job]=await claim();
    const forged=()=>db.query("SELECT pos_finish_redemption_code($1,$2,'redeemed','done','{}')",[job.id,job.lease_token]);
    await bad(forged,/completed verified receipt/);await sale(c);await bind(job);
    await db.exec("UPDATE pos_transactions SET status='loyalty_applied'");await bad(forged,/has not been committed/);
    assert.equal((await one('SELECT status FROM pos_redemption_codes')).status,'confirmed');
  });
  for(const kind of ['points','coupon','benefit']){
    await test(kind+': old commit or release buttons cannot bypass a confirmed code',async()=>{
      await reset();const c=await confirm(await issue(kind));
      const release={points:'pos_release_points_redemption',coupon:'pos_release_coupon',benefit:'pos_release_benefit'}[kind];
      await bad(()=>db.query(`SELECT ${release}($1,'old_button')`,[c.reservation_id]),/verified StoreHub void/);
      const table={points:'pos_redemption_reservations',coupon:'pos_coupon_reservations',benefit:'pos_benefit_reservations'}[kind];
      await bad(()=>db.query(`UPDATE ${table} SET status='committed' WHERE id=$1`,[c.reservation_id]),/verified receipt/);
    });
    await test(kind+': void recovers a crash after commit and before final acknowledgement',async()=>{
      await reset();const c=await confirm(await issue(kind));const[job]=await claim();await sale(c);await bind(job);await commit(job);
      await bad(()=>db.exec("UPDATE pos_transactions SET transaction_type='void'"),/code worker will reconcile/);
      await db.query('SELECT pos_record_code_void($1,$2,$3,$4)',[job.id,job.lease_token,'sale-1',JSON.stringify({refId:'sale-1',storeId:'outlet',registerId:'register',isCancelled:true,notes:c.code})]);
      await db.exec("UPDATE pos_redemption_codes SET status='needs_review',lease_expires_at=now()-interval '1 second',next_attempt_at=now()");
      const[recovery]=await claim();assert.equal(recovery.void_detected,true);
      const r=(await one('SELECT pos_reverse_redemption_code($1,$2) c',[recovery.id,recovery.lease_token])).c;
      assert.equal(r.status,'reversed');assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,500);
      if(kind==='coupon')assert.equal((await one('SELECT status FROM coupons')).status,'active');
      if(kind==='benefit')assert((await one('SELECT pos_voided_at FROM membership_benefit_redemptions')).pos_voided_at);
    });
  }
  await test('employee quota is held across other screens and restored after void',async()=>{
    await reset();let c=await confirm(await issue('benefit'));
    await bad(()=>db.exec("INSERT INTO membership_benefit_redemptions(business_id,customer_id,benefit_id,quantity,redeemed_at) VALUES(1,11,'meal',1,now())"),/reserved on a StoreHub/);
    const[job]=await claim();await sale(c);await bind(job);await commit(job);await finish(job);
    await db.exec("UPDATE pos_transactions SET transaction_type='void',raw_payload=raw_payload||'{\"isCancelled\":true}'::jsonb");
    await db.exec("UPDATE pos_redemption_codes SET next_attempt_at=now()");const[rev]=await claim();
    await db.query('SELECT pos_reverse_redemption_code($1,$2)',[rev.id,rev.lease_token]);
    await db.exec("UPDATE pos_companion_sessions SET status='waiting_for_sale',matched_pos_transaction_id=null,result='{}',scanned_at=now(),expires_at=now()+interval '5 minutes'");
    c=await issue('benefit');assert.equal(c.status,'reserved');
  });
  await test('available-points spend honors holds and retries exactly once without blocking earned-point reversals',async()=>{
    await reset();await issue('points',{points:450,discount_amount:450,gross_amount:500,expected_total:50});
    const operation=randomUUID(),spend=n=>one('SELECT pos_spend_available_prize_points(1,10,$1,$2) b',[n,operation]);
    await bad(()=>spend(51),/Not enough available points/);assert.equal((await spend(50)).b,450);assert.equal((await spend(50)).b,450);
    await bad(()=>spend(49),/another request/);
    // A genuine sale void may claw back earned points even when a new checkout has a hold.
    await db.exec('UPDATE customers SET points_balance=points_balance-10 WHERE id=10');
    assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,440);
  });
  await test('existing void worker may restore points before the code worker without double credit',async()=>{
    await reset();const c=await confirm(await issue('points'));const[job]=await claim();await sale(c);await bind(job);await commit(job);await finish(job);
    await db.exec("UPDATE pos_transactions SET points_earned=5,transaction_type='void',raw_payload=raw_payload||'{\"isCancelled\":true}'::jsonb");
    await db.exec('UPDATE customers SET points_balance=points_balance+5 WHERE id=10');
    await db.query('SELECT pos_reverse_storehub_void($1,$2)',[ids.tx,ids.integration]);
    assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,500);
    await db.exec('UPDATE pos_redemption_codes SET next_attempt_at=now()');const[rev]=await claim();
    await db.query('SELECT pos_reverse_redemption_code($1,$2)',[rev.id,rev.lease_token]);
    assert.equal((await one('SELECT points_balance FROM customers WHERE id=10')).points_balance,500);
    assert.equal((await one('SELECT status FROM pos_redemption_codes')).status,'reversed');
  });
  await test('void with another code in its notes cannot release the reserved reward',async()=>{
    await reset();const c=await confirm(await issue('coupon'));const[job]=await claim();
    await sale(c,{status:'voided',raw_payload:{storeId:'outlet',registerId:'register',isCancelled:true,notes:c.code+' LT-AAAAAAAAAAAA'}});
    await bad(()=>db.query('SELECT pos_abort_voided_redemption_code($1,$2,$3)',[job.id,job.lease_token,ids.tx]),/exact voided receipt/);
  });
  await test('future coupons and campaign coupons cannot enter this earned-reward flow',async()=>{
    await reset();await db.exec("UPDATE coupons SET starts_at=current_date+1");await bad(()=>issue('coupon'),/not usable on this date/);
    await reset();await db.exec("UPDATE coupons SET source='campaign'");await bad(()=>issue('coupon'),/campaign redemption screen/);
  });
  await test('nonstacking coupon requires the exact discount rather than other POS promotions',async()=>{
    await reset();const c=await confirm(await issue('coupon',{stacking_allowed:false}));const[job]=await claim();
    await sale(c,{raw_payload:{storeId:'outlet',registerId:'register',discount:60,isCancelled:false}});
    await bad(()=>bind(job),/does not match/);
  });
  process.stdout.write(`\n${passed} redemption-code SQL checks passed\n`);
} finally {await db.close();}

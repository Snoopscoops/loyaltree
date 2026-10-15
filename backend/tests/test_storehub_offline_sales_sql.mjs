/* Isolated PostgreSQL/PGlite checks. Never contacts a production service.
 * node test_storehub_offline_sales_sql.mjs <PGlite dist/index.js> [migration.sql]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
let migration;
for (const source of process.argv[3] ? [process.argv[3]] : [new URL('./storehub_offline_sales.sql',import.meta.url), new URL('../storehub_offline_sales.sql',import.meta.url)]) {
  try { migration = await fs.readFile(source,'utf8'); break; }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
}
assert(migration, 'Cannot locate storehub_offline_sales.sql');
let passed=0;
const identity=(kind,n)=>kind==='uuid'?`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`:String(n);
async function suite(kind,tenantKind=kind) {
  const db=new PGlite();
  const ids={business:identity(tenantKind,1),otherBusiness:identity(tenantKind,2),branch:identity(tenantKind,20),
    otherBranch:identity(tenantKind,21),integration:identity(kind,10),mapping:identity(kind,30),
    device:identity(kind,40),otherDevice:identity(kind,41),customer:identity(tenantKind,50),otherCustomer:identity(tenantKind,51),
    tx:identity(kind,60),otherTx:identity(kind,61)};
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE pos_integrations(id ${kind} PRIMARY KEY,business_id ${tenantKind},provider text);
    CREATE TABLE branches(id ${tenantKind} PRIMARY KEY,business_id ${tenantKind},is_active boolean);
    CREATE TABLE pos_branch_mappings(id ${kind} PRIMARY KEY,business_id ${tenantKind},branch_id ${tenantKind},
      integration_id ${kind},is_active boolean,external_branch_id text);
    CREATE TABLE pos_devices(id ${kind} PRIMARY KEY,business_id ${tenantKind},branch_id ${tenantKind},integration_id ${kind},
      mapping_id ${kind},provider text,status text,metadata jsonb);
    CREATE TABLE customers(id ${tenantKind} PRIMARY KEY,business_id ${tenantKind});
    CREATE TABLE pos_transactions(id ${kind} PRIMARY KEY,business_id ${tenantKind},branch_id ${tenantKind},integration_id ${kind},
      provider text,transaction_type text,status text,customer_id ${tenantKind},external_transaction_id text,
      external_receipt_number text,net_amount numeric,gross_amount numeric,currency text,transacted_at timestamptz,
      processing_metadata jsonb,raw_payload jsonb,updated_at timestamptz default now());`);
  await db.exec(migration);
  const test=async(name,fn)=>{await fn();passed++;process.stdout.write(`PASS ${kind}/tenant-${tenantKind}: ${name}\n`);};
  async function reset(){
    await db.exec('TRUNCATE storehub_offline_sales,pos_devices,pos_branch_mappings,branches,pos_integrations,customers,pos_transactions');
    await db.query("INSERT INTO pos_integrations VALUES($1,$2,'storehub')",[ids.integration,ids.business]);
    await db.query('INSERT INTO branches VALUES($1,$2,true),($3,$2,true)',[ids.branch,ids.business,ids.otherBranch]);
    await db.query("INSERT INTO pos_branch_mappings VALUES($1,$2,$3,$4,true,'outlet-1')",[ids.mapping,ids.business,ids.branch,ids.integration]);
    await db.query("INSERT INTO pos_devices VALUES($1,$2,$3,$4,$5,'storehub','active',$6)",
      [ids.device,ids.business,ids.branch,ids.integration,ids.mapping,JSON.stringify({external_terminal_id:'register-1'})]);
    await db.query('INSERT INTO customers VALUES($1,$2),($3,$2)',[ids.customer,ids.business,ids.otherCustomer]);
  }
  const event=(patch={})=>({device_id:ids.device,business_id:ids.business,branch_id:ids.branch,integration_id:ids.integration,
    client_event_id:'client-1',event_hash:'a'.repeat(64),customer_ref:'member-1',receipt_reference:'',receipt_match_mode:'amount',
    final_amount:125.50,currency:'PHP',scanned_at:'2026-10-10T02:00:00Z',completed_at:'2026-10-10T02:02:00Z',
    scope:{external_branch_id:'outlet-1',external_terminal_id:'register-1'},...patch});
  const enqueue=async(patch={})=>(await db.query('SELECT pos_offline_sale_enqueue($1) row',[JSON.stringify(event(patch))])).rows[0].row;
  const batch=async(events)=>(await db.query('SELECT pos_offline_sales_enqueue_batch($1) row',[JSON.stringify(events)])).rows.map(r=>r.row);
  const get=async(id)=>(await db.query('SELECT * FROM storehub_offline_sales WHERE id=$1',[id])).rows[0];
  const claim=async(limit=10,seconds=120)=>(await db.query('SELECT pos_claim_offline_sales($1,$2) row',[limit,seconds])).rows.map(r=>r.row);
  const finish=async(row,status='processed',message=null,result={},retry=60)=>(await db.query(
    'SELECT pos_finish_offline_sale($1,$2,$3,$4,$5,$6) row',[row.id,row.lease_token,status,message,JSON.stringify(result),retry])).rows[0].row;
  const correction=async(id,receipt,device=ids.device)=>(await db.query('SELECT pos_correct_offline_sale_receipt($1,$2,$3) row',[device,id,receipt])).rows[0].row;
  async function tx(patch={}){
    const data={id:ids.tx,business_id:ids.business,branch_id:ids.branch,integration_id:ids.integration,provider:'storehub',
      transaction_type:'sale',status:'received',customer_id:null,external_transaction_id:'sale-1',external_receipt_number:'INV-12345',
      net_amount:125.5,gross_amount:150,currency:'PHP',transacted_at:'2026-10-10T02:01:00Z',
      processing_metadata:{keep:'yes',bridge_external_branch_id:'outlet-1',bridge_external_terminal_id:'register-1'},
      raw_payload:{storeId:'outlet-1',registerId:'register-1',isCancelled:false},...patch};
    const columns=Object.keys(data);await db.query(`INSERT INTO pos_transactions(${columns.join(',')}) VALUES(${columns.map((_,n)=>`$${n+1}`).join(',')})`,
      Object.values(data).map(v=>v&&typeof v==='object'?JSON.stringify(v):v));
  }
  const bind=async(row,txId=ids.tx,customer=ids.customer)=>(await db.query(
    'SELECT pos_claim_offline_sale_transaction($1,$2,$3,$4) row',[row.id,row.lease_token,txId,customer])).rows[0].row;
  const onlineClaim=async(customer=ids.customer,txId=ids.tx,device=ids.device)=>(await db.query(
    'SELECT pos_claim_companion_transaction_customer($1,$2,$3) row',[device,txId,customer])).rows[0].row;
  const bad=async(fn,pattern)=>assert.rejects(fn,pattern);

  await test('migration is rerunnable and creates service-only durable queue',async()=>{
    await db.exec(migration);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='storehub_offline_sales'::regclass")).rows[0].relrowsecurity,true);
  });
  await test('enqueue preserves immutable original data and replay returns same queue item',async()=>{
    await reset();const a=await enqueue();const b=await enqueue();assert.equal(a.id,b.id);assert.equal(a.status,'pending');
    assert.equal(a.final_amount,125.5);assert.equal(a.original_event.event_hash,'a'.repeat(64));assert.deepEqual(a.scope,event().scope);
    assert.equal((await db.query('SELECT count(*) n FROM storehub_offline_sales')).rows[0].n,1);
  });
  await test('event UUID cannot be reused with changed payload hash',async()=>{
    await reset();await enqueue();await bad(()=>enqueue({event_hash:'b'.repeat(64)}),e=>e.code==='23505');
    assert.equal((await db.query('SELECT event_hash FROM storehub_offline_sales')).rows[0].event_hash,'a'.repeat(64));
  });
  await test('upload batch makes overlapping events visible together before worker claim',async()=>{
    await reset();const events=await batch([event(),event({client_event_id:'client-2',event_hash:'b'.repeat(64)})]);
    assert.equal(events.length,2);assert(events.every(row=>row.id));await tx();const claimed=await claim();assert.equal(claimed.length,2);
    for(const row of claimed) await bad(()=>bind(row),/Overlapping/);
  });
  await test('batch item rejection uses a savepoint and does not acknowledge or lose valid items',async()=>{
    await reset();const rows=await batch([event(),event({client_event_id:'bad',final_amount:0}),
      event({client_event_id:'client-2',event_hash:'b'.repeat(64),final_amount:130})]);
    assert.equal(rows.length,3);assert(rows[0].id);assert(rows[2].id);assert.equal(rows[1].id,'');
    assert.equal(rows[1].client_event_id,'bad');assert.equal(rows[1].acknowledged,false);assert.equal(rows[1].status,'rejected');
    assert.equal((await db.query('SELECT count(*) n FROM storehub_offline_sales')).rows[0].n,2);
  });
  await test('batch rejects malformed or unbounded batches and identifies conflicting event hashes',async()=>{
    await reset();for(const invalid of [null,{},[],Array.from({length:51},()=>event())]) await bad(()=>batch(invalid));
    await enqueue();const [conflict]=await batch([event({event_hash:'b'.repeat(64)})]);assert.equal(conflict.id,'');
    assert.equal(conflict.status,'needs_review');assert.equal(conflict.acknowledged,false);
  });
  await test('source fields and event hash remain immutable under direct accidental updates',async()=>{
    await reset();const row=await enqueue();
    for(const patch of ["event_hash='"+'b'.repeat(64)+"'",'final_amount=130',"scope='{}'",'customer_ref=\'another-member\''])
      await bad(()=>db.query(`UPDATE storehub_offline_sales SET ${patch} WHERE id=$1`,[row.id]),/immutable/);
    assert.equal((await get(row.id)).event_hash,row.event_hash);
  });
  await test('enqueue requires assigned active device and immutable internal scope',async()=>{
    for(const patch of [{device_id:ids.otherDevice},{business_id:ids.otherBusiness},{branch_id:ids.otherBranch},{integration_id:'wrong'},
      {scope:{external_branch_id:'outlet-1',external_terminal_id:'wrong'}},{scope:{external_branch_id:'wrong',external_terminal_id:'register-1'}}]){
      await reset();await bad(()=>enqueue(patch),/active StoreHub|active StoreHub branch/);
    }
    for(const mutation of ["status='disabled'","provider='loyverse'","metadata='{}'"]){
      await reset();await db.exec(`UPDATE pos_devices SET ${mutation}`);await bad(()=>enqueue(),/active StoreHub/);
    }
  });
  await test('enqueue rejects inactive or cross-business branch/integration/mapping',async()=>{
    for(const [table,mutation] of [['branches','is_active=false'],['pos_branch_mappings','is_active=false'],
      ['pos_integrations',"provider='loyverse'"],['pos_branch_mappings',`branch_id='${ids.otherBranch}'`],
      ['branches',`business_id='${ids.otherBusiness}'`]]){
      await reset();await db.exec(`UPDATE ${table} SET ${mutation}`);await bad(()=>enqueue(),/active StoreHub branch/);
    }
  });
  await test('queue constraints reject malformed receipts, hashes, currency, money and time',async()=>{
    for(const patch of [{event_hash:'short'},{customer_ref:''},{client_event_id:''},{receipt_reference:'12345'},
      {receipt_match_mode:'suffix5',receipt_reference:'1234'},{receipt_match_mode:'full',receipt_reference:''},
      {currency:'php'},{final_amount:0},{final_amount:-1},{final_amount:'Infinity'},{final_amount:'NaN'},
      {completed_at:'2026-10-09T02:02:00Z'},{completed_at:'2026-10-11T02:02:00Z'},
      {scanned_at:'-infinity'},{completed_at:'infinity'}]){
      await reset();await bad(()=>enqueue(patch));
    }
  });
  await test('claim owns lease, increments attempt and excludes concurrent claims',async()=>{
    await reset();const queued=await enqueue();const rows=await claim();assert.equal(rows.length,1);assert.equal(rows[0].id,queued.id);
    assert.equal(rows[0].attempts,1);assert.match(rows[0].lease_token,/^[a-f0-9-]{36}$/);assert.equal((await claim()).length,0);
  });
  await test('expired lease gets a new token and old worker cannot finish',async()=>{
    await reset();await enqueue();const [first]=await claim();await db.query("UPDATE storehub_offline_sales SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
    const [second]=await claim();assert.notEqual(first.lease_token,second.lease_token);assert.equal(second.attempts,2);
    await bad(()=>finish(first),e=>e.code==='40001');await finish(second,'awaiting_storehub','Waiting for provider');
  });
  await test('claim enforces bounded batch and lease arguments',async()=>{
    for(const args of [[0,120],[101,120],[1,29],[1,901],[null,120],[1,null]]) await bad(()=>claim(...args));
  });
  await test('finish retry is scheduled, needs_review stops retries and processed stores result',async()=>{
    await reset();await enqueue();let [row]=await claim();row=await finish(row,'awaiting_storehub','Not synced',{},60);
    assert.equal(row.lease_token,null);assert.equal(row.last_error,'Not synced');assert.equal((await claim()).length,0);
    await db.query('UPDATE storehub_offline_sales SET next_attempt_at=now() WHERE id=$1',[row.id]);
    [row]=await claim();row=await finish(row,'needs_review','Ambiguous');assert.equal((await claim()).length,0);
    assert.equal(row.processed_at,null);await correction(row.id,'INV-12345');[row]=await claim();
    row=await finish(row,'processed',null,{points_earned:5});assert.equal(row.status,'processed');assert.equal(row.result.points_earned,5);
    assert(row.processed_at);assert.equal(row.last_error,null);assert.equal((await claim()).length,0);
  });
  await test('finish rejects stale ownership and invalid status/result/retry without mutation',async()=>{
    await reset();await enqueue();const [row]=await claim();
    await bad(()=>finish({...row,lease_token:'wrong'}),e=>e.code==='40001');
    for(const args of [['pending',null,{},60],['processed',null,[],60],['processed',null,{},0]]) await bad(()=>finish(row,...args));
    assert.equal((await get(row.id)).status,'pending');
  });
  await test('correction requires same device and review state; original payload/hash stay auditable',async()=>{
    await reset();const queued=await enqueue();await bad(()=>correction(queued.id,'INV-12345'),/awaiting review/);
    let [row]=await claim();row=await finish(row,'needs_review','Two receipts');
    await bad(()=>correction(row.id,'INV-12345',ids.otherDevice),/awaiting review/);await bad(()=>correction(row.id,' '),/complete receipt/);
    row=await correction(row.id,' INV-12345 ');assert.equal(row.receipt_reference,'INV-12345');assert.equal(row.receipt_match_mode,'full');
    assert.equal(row.status,'pending');assert.equal(row.event_hash,queued.event_hash);assert.equal(row.original_event.receipt_reference,'');
    assert.equal(row.receipt_corrections.length,1);assert.equal(row.receipt_corrections[0].previous_mode,'amount');
    const replay=await enqueue();assert.equal(replay.id,row.id);assert.equal(replay.receipt_reference,'INV-12345');
  });
  await test('transaction claim binds customer and receipt atomically, preserving metadata; retry safe',async()=>{
    await reset();await enqueue();await tx();const [row]=await claim();let sale=await bind(row);
    assert.equal(String(sale.customer_id),ids.customer);assert.equal(sale.processing_metadata.keep,'yes');
    assert.equal(sale.processing_metadata.offline_sale_event_id,row.id);sale=await bind(row);assert.equal(String(sale.id),ids.tx);
    assert.equal((await get(row.id)).matched_transaction_id,ids.tx);assert.equal((await get(row.id)).external_transaction_id,'sale-1');
  });
  await test('canonical customer claim permits same-member retries and rejects competing members',async()=>{
    await reset();await tx();let sale=await onlineClaim();assert.equal(String(sale.customer_id),ids.customer);
    sale=await onlineClaim();assert.equal(String(sale.customer_id),ids.customer);
    await bad(()=>onlineClaim(ids.otherCustomer),e=>e.code==='23505');
    assert.equal(String((await db.query('SELECT customer_id FROM pos_transactions')).rows[0].customer_id),ids.customer);
  });
  await test('published offline sale blocks the next online customer until its own worker claims receipt',async()=>{
    await reset();await enqueue();await tx();
    // The online candidate's five-second pad can include this earlier sale.
    // Atomic customer claiming must consult durable offline work before binding.
    await bad(()=>onlineClaim(ids.otherCustomer),e=>e.code==='40001'&&/saved offline sale/.test(e.message));
    await bad(()=>onlineClaim(ids.customer),e=>e.code==='40001');
    assert.equal((await db.query('SELECT customer_id FROM pos_transactions')).rows[0].customer_id,null);
    const [row]=await claim();await bind(row);const sale=await onlineClaim();
    assert.equal(String(sale.customer_id),ids.customer);
    await bad(()=>onlineClaim(ids.otherCustomer),e=>e.code==='23505');
  });
  await test('pending and review offline reservations protect amount, suffix and exact receipt matches',async()=>{
    for(const status of ['pending','awaiting_storehub','needs_review']){
      for(const patch of [{},{receipt_match_mode:'suffix5',receipt_reference:'12345'},
        {receipt_match_mode:'full',receipt_reference:'INV-12345'}]){
        await reset();const row=await enqueue(patch);await tx();
        await db.query('UPDATE storehub_offline_sales SET status=$1 WHERE id=$2',[status,row.id]);
        await bad(()=>onlineClaim(ids.otherCustomer),e=>e.code==='40001');
      }
    }
  });
  await test('duplicate pending receipt events cannot deadlock the established offline receipt owner',async()=>{
    await reset();await enqueue({receipt_match_mode:'full',receipt_reference:'INV-12345'});
    await enqueue({client_event_id:'client-2',event_hash:'b'.repeat(64),receipt_match_mode:'full',receipt_reference:'INV-12345'});
    await tx();const rows=await claim();await bind(rows[0]);
    assert.equal(String((await onlineClaim()).customer_id),ids.customer);
    await bad(()=>bind(rows[1]),e=>e.code==='23505');
    await bad(()=>onlineClaim(ids.otherCustomer),e=>e.code==='23505');
  });
  await test('unrelated receipt, amount, time and register offline items do not block online checkout',async()=>{
    for(const patch of [{final_amount:130},{receipt_match_mode:'full',receipt_reference:'OTHER'},
      {receipt_match_mode:'suffix5',receipt_reference:'99999'},
      {scanned_at:'2026-10-10T02:03:00Z',completed_at:'2026-10-10T02:04:00Z'}]){
      await reset();await enqueue(patch);await tx();assert.equal(String((await onlineClaim()).customer_id),ids.customer);
    }
    await reset();await enqueue();await tx();
    await db.query("UPDATE pos_devices SET metadata=$1",[JSON.stringify({external_terminal_id:'register-2'})]);
    await db.query("UPDATE pos_transactions SET raw_payload=$1,processing_metadata=$2",[
      JSON.stringify({storeId:'outlet-1',registerId:'register-2',isCancelled:false}),
      JSON.stringify({bridge_external_branch_id:'outlet-1',bridge_external_terminal_id:'register-2'})]);
    assert.equal(String((await onlineClaim()).customer_id),ids.customer);
  });
  await test('canonical claim rejects changed scope, cancellation and preserved reversal evidence',async()=>{
    for(const patch of [{status:'voided'},{status:'refunded'},{transaction_type:'refund'},
      {branch_id:ids.otherBranch},{provider:'loyverse'},
      {raw_payload:{storeId:'outlet-1',registerId:'other',isCancelled:false}},
      {raw_payload:{storeId:'outlet-1',registerId:'register-1',isCancelled:true}},
      {processing_metadata:{void_reversed_at:'2026-10-10T03:00:00Z'}}]){
      await reset();await tx(patch);await bad(()=>onlineClaim(),/eligible sale/);
      assert.equal((await db.query('SELECT customer_id FROM pos_transactions')).rows[0].customer_id,null);
    }
    await reset();await tx();await bad(()=>onlineClaim('missing'),/does not belong/);
    await db.exec("UPDATE pos_devices SET status='disabled'");await bad(()=>onlineClaim(),/active StoreHub/);
  });
  await test('enqueue, correction and both claim paths share integration lock before row mutation',async()=>{
    for(const fn of ['pos_offline_sale_enqueue','pos_correct_offline_sale_receipt','pos_claim_offline_sale_transaction',
      'pos_claim_companion_transaction_customer']){
      const definition=(await db.query('SELECT pg_get_functiondef(oid) definition FROM pg_proc WHERE proname=$1',[fn])).rows[0].definition;
      const lock=definition.indexOf('perform public.pos_offline_sale_lock_scope');assert(lock>=0,fn);
      const mutation=definition.search(/for update|insert into public.storehub_offline_sales/i);
      assert(mutation>lock,`${fn}: lock must precede the event/receipt row lock or insert`);
    }
  });
  await test('full receipt match is trim-normalized but case and punctuation remain significant',async()=>{
    await reset();await enqueue({receipt_match_mode:'full',receipt_reference:' INV-12345 '});await tx();const [row]=await claim();await bind(row);
    for(const receipt of ['inv-12345','INV12345','other']){
      await reset();await enqueue({receipt_match_mode:'full',receipt_reference:receipt});await tx();const [r]=await claim();await bad(()=>bind(r),/does not match/);
    }
  });
  await test('suffix5 matches normalized receipt key, and requires matching suffix',async()=>{
    await reset();await enqueue({receipt_match_mode:'suffix5',receipt_reference:'a123B'});await tx({external_receipt_number:'INV-A-123-B'});
    const [row]=await claim();await bind(row);
    await reset();await enqueue({receipt_match_mode:'suffix5',receipt_reference:'99999'});await tx();const [r]=await claim();await bad(()=>bind(r),/does not match/);
  });
  await test('transaction financial, provider, branch, time, register and cancellation mismatches cannot claim',async()=>{
    for(const patch of [{net_amount:126},{net_amount:0},{net_amount:'NaN'},{net_amount:'Infinity'},
      {currency:'USD'},{provider:'loyverse'},{branch_id:ids.otherBranch},{transaction_type:'refund'},
      {status:'voided'},{status:'refunded'},{status:'failed'},{status:'ignored'},
      {transacted_at:'2026-10-10T01:59:49Z'},{transacted_at:'2026-10-10T02:02:11Z'},
      {transacted_at:null},{raw_payload:{storeId:'wrong',registerId:'register-1',isCancelled:false}},
      {raw_payload:{storeId:'outlet-1',registerId:'wrong',isCancelled:false}},
      {raw_payload:{storeId:'outlet-1',registerId:'register-1',isCancelled:true}},
      {raw_payload:{storeId:'outlet-1'},processing_metadata:{}}]){
      await reset();await enqueue();await tx(patch);const [row]=await claim();await bad(()=>bind(row),/does not match/);
      assert.equal((await get(row.id)).matched_transaction_id,null);
      assert.equal((await db.query('SELECT customer_id FROM pos_transactions')).rows[0].customer_id,null);
    }
  });
  await test('matching allows exact 10-second clock padding and normalized bridge scope fallback',async()=>{
    for(const time of ['2026-10-10T01:59:50Z','2026-10-10T02:02:10Z']){
      await reset();await enqueue();await tx({transacted_at:time,raw_payload:{}});const [row]=await claim();await bind(row);
    }
  });
  await test('missing net falls back to gross and net is compared as cents',async()=>{
    await reset();await enqueue();await tx({net_amount:null,gross_amount:125.5});const [row]=await claim();await bind(row);
  });
  await test('customer conflicts and nonexistent earning customer never overwrite a transaction',async()=>{
    await reset();await enqueue();await tx({customer_id:ids.otherCustomer});const [row]=await claim();
    await bad(()=>bind(row),e=>e.code==='23505');assert.equal(String((await db.query('SELECT customer_id FROM pos_transactions')).rows[0].customer_id),ids.otherCustomer);
    await bad(()=>bind(row,ids.tx,'unknown'),/does not belong/);
  });
  await test('one receipt cannot be claimed by another event, even for the same customer',async()=>{
    await reset();await enqueue({receipt_match_mode:'full',receipt_reference:'INV-12345'});
    await enqueue({client_event_id:'client-2',event_hash:'b'.repeat(64),receipt_match_mode:'full',receipt_reference:'INV-12345'});await tx();
    const rows=await claim();await bind(rows[0]);await bad(()=>bind(rows[1]),e=>e.code==='23505');
  });
  await test('one event cannot be rebound to another normalized sale',async()=>{
    await reset();await enqueue();await tx();await tx({id:ids.otherTx,external_transaction_id:'sale-2'});const [row]=await claim();
    await bind(row);await bad(()=>bind(row,ids.otherTx),e=>e.code==='23505');
  });
  await test('expired transaction claim lease cannot link customer',async()=>{
    await reset();await enqueue();await tx();const [row]=await claim();await db.query("UPDATE storehub_offline_sales SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[row.id]);
    await bad(()=>bind(row),e=>e.code==='40001');assert.equal((await db.query('SELECT customer_id FROM pos_transactions')).rows[0].customer_id,null);
  });
  await test('device reassignment or retirement after upload prevents earning and correction',async()=>{
    for(const mutation of ["status='disabled'",`branch_id='${ids.otherBranch}'`,"metadata='{\"external_terminal_id\":\"wrong\"}'"]){
      await reset();await enqueue();await tx();let [row]=await claim();await db.exec(`UPDATE pos_devices SET ${mutation}`);
      await bad(()=>bind(row),/active StoreHub/);row=await finish(row,'needs_review','Scope changed');
      await bad(()=>correction(row.id,'INV-12345'),/active StoreHub/);
    }
  });
  await test('overlapping amount-only offline sales require full receipt resolution',async()=>{
    await reset();await enqueue();await enqueue({client_event_id:'client-2',event_hash:'b'.repeat(64)});await tx();let rows=await claim();
    for(const row of rows) await bad(()=>bind(row),/Overlapping/);
    for(const row of rows) await finish(row,'needs_review','Overlap');
    await correction(rows[0].id,'INV-12345');const [corrected]=await claim();await bind(corrected);
  });
  await test('unrelated non-overlapping or different-amount offline sales do not block matching',async()=>{
    await reset();await enqueue();await enqueue({client_event_id:'client-2',event_hash:'b'.repeat(64),final_amount:130});await tx();
    const rows=await claim();const row=rows.find(r=>r.client_event_id==='client-1');await bind(row);
    await reset();await enqueue();await enqueue({client_event_id:'client-2',event_hash:'b'.repeat(64),scanned_at:'2026-10-10T02:03:00Z',completed_at:'2026-10-10T02:04:00Z'});await tx();
    const later=await claim();await bind(later.find(r=>r.client_event_id==='client-1'));
  });
  await test('RPC and table privileges exclude public, anonymous and authenticated callers',async()=>{
    const functions=['pos_offline_sale_assert_device(text,text,text,text,text,text)','pos_offline_sale_enqueue(jsonb)','pos_offline_sales_enqueue_batch(jsonb)',
      'pos_claim_offline_sales(integer,integer)','pos_finish_offline_sale(text,text,text,text,jsonb,integer)',
      'pos_correct_offline_sale_receipt(text,text,text)','pos_claim_offline_sale_transaction(text,text,text,text)',
      'pos_offline_sale_lock_scope(text)','pos_claim_companion_transaction_customer(text,text,text)'];
    for(const fn of functions){
      const row=(await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') anon,
        has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service_role`,[fn])).rows[0];
      assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.service_role,true);
    }
    await reset();await db.exec('GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;SET ROLE anon');
    try{await bad(()=>enqueue(),/permission denied for function/);await bad(()=>db.query('SELECT * FROM storehub_offline_sales'),/permission denied/);}
    finally{await db.exec('RESET ROLE');}
    await db.exec('SET ROLE service_role');try{await enqueue();assert.equal((await claim()).length,1);}finally{await db.exec('RESET ROLE');}
  });
  await db.close();
}
await suite('uuid','bigint');
await suite('bigint');
process.stdout.write(`\n${passed} offline-sale SQL checks passed\n`);

// Isolated Postgres; synthetic tokens only, no live credentials or sends.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.LT_BENEFITS_PGLITE || '/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js').href)
const sql=fs.readFileSync(new URL('../apple_wallet_delivery.sql',import.meta.url),'utf8')
const db=new PGlite()
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE TABLE wallet_sync_jobs(id bigint PRIMARY KEY,business_id integer,customer_id integer,
    reason text,status text,attempts integer,next_attempt_at timestamptz,created_at timestamptz,
    started_at timestamptz,updated_at timestamptz);
  INSERT INTO wallet_sync_jobs VALUES(223,1,1,'lt_benefits','processing',1,now()-interval '2 days',
    now()-interval '2 days',now()-interval '2 days',now()-interval '2 days');`)
 await db.exec(sql);await db.exec(sql)
 const row=async(query,args=[])=>(await db.query(query,args)).rows[0]
 const push=async(action,data={})=>(await row('SELECT apple_push_delivery_command($1,$2::jsonb) result',[action,JSON.stringify(data)])).result
 const wallet=async(action,data={})=>(await row('SELECT wallet_sync_queue_command($1,$2::jsonb) result',[action,JSON.stringify(data)])).result
 assert.equal((await row('SELECT status FROM wallet_sync_jobs WHERE id=223')).status,'processing')
 const enqueue=async(business,tokens)=>push('enqueue',{business_id:String(business),business_slug:'business-'+business,
    pass_type_identifier:'pass.test',reason:'announcement',tokens})
 const ids=(await enqueue(1,['synthetic-ok','synthetic-missed'])).jobs.map(j=>j.id)
 await enqueue(2,['synthetic-ok'])
 assert.equal(Number((await row('SELECT count(*) count FROM apple_push_deliveries')).count),3)
 let jobs=(await push('claim',{ids,limit:20})).jobs
 assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.business_id==='1'))
 assert.equal((await push('claim',{ids,limit:20})).jobs.length,0)
 const finish=(jobs,outcome)=>push('finish',{outcomes:jobs.map(j=>({id:j.id,lease:j.lease,revision:j.revision,
    outcome:typeof outcome==='function'?outcome(j):outcome,status:200}))})
 const missed=jobs.find(j=>j.push_token==='synthetic-missed')
 assert.equal((await finish(jobs,j=>j.push_token==='synthetic-ok'?'accepted':'retry')).terminal,1)
 assert.equal((await push('claim',{ids,limit:20})).jobs.length,0)
 await db.exec("UPDATE apple_push_deliveries SET next_attempt_at=now()-interval '1 second' WHERE push_token='synthetic-missed'")
 jobs=(await push('claim',{ids,limit:20})).jobs
 assert.equal(jobs.length,1);assert.equal(jobs[0].push_token,'synthetic-missed')
 const abandoned=jobs[0]
 await db.exec("UPDATE apple_push_deliveries SET lease_until=now()-interval '1 second' WHERE push_token='synthetic-missed'")
 jobs=(await push('claim',{ids,limit:20})).jobs
 assert.equal(jobs.length,1);assert.notEqual(jobs[0].lease,abandoned.lease)
 assert.equal((await finish([abandoned],'accepted')).terminal,0)
 assert.equal((await finish(jobs,'accepted')).terminal,1)
 // A newer update arriving during sending survives acknowledgement of old work.
 const newerIds=(await enqueue(1,['synthetic-ok'])).jobs.map(j=>j.id)
 const older=(await push('claim',{ids:newerIds,limit:20})).jobs
 await enqueue(1,['synthetic-ok'])
 assert.equal((await finish(older,'accepted')).terminal,0)
 assert.equal((await row("SELECT status FROM apple_push_deliveries WHERE business_id='1' AND push_token='synthetic-ok'")).status,'pending')
 // Memory deferral does not burn retry attempts. Terminal retry caps are real.
 jobs=(await push('claim',{ids:newerIds,limit:20})).jobs
 await finish(jobs,'deferred')
 assert.equal((await row("SELECT attempts FROM apple_push_deliveries WHERE business_id='1' AND push_token='synthetic-ok'")).attempts,0)
 await db.exec("UPDATE apple_push_deliveries SET attempts=7,next_attempt_at=now()-interval '1 second' WHERE business_id='1' AND push_token='synthetic-ok'")
 jobs=(await push('claim',{ids:newerIds,limit:20})).jobs
 assert.equal((await finish(jobs,'retry')).exhausted,1)
 assert.equal((await push('claim',{ids:newerIds,limit:20})).jobs.length,0)
 // Generic wallet jobs recover old processing rows with a fresh ownership lease.
 let recovered=(await wallet('claim',{limit:10})).jobs
 assert.equal(recovered.length,1);assert.equal(Number(recovered[0].id),223)
 assert.equal(recovered[0].recovered_from_lease,true)
 assert.equal((await wallet('claim',{limit:10})).jobs.length,0)
 const oldWallet=recovered[0]
 await db.exec("UPDATE wallet_sync_jobs SET lease_until=now()-interval '1 second' WHERE id=223")
 recovered=(await wallet('claim',{limit:10})).jobs
 assert.notEqual(recovered[0].lease_token,oldWallet.lease_token)
 assert.equal((await wallet('finish',{id:'223',lease_token:oldWallet.lease_token,outcome:'completed'})).accepted,false)
 await wallet('finish',{id:'223',lease_token:recovered[0].lease_token,outcome:'deferred'})
 await db.exec("UPDATE wallet_sync_jobs SET attempts=4,next_attempt_at=now()-interval '1 second' WHERE id=223")
 recovered=(await wallet('claim',{limit:10})).jobs
 await wallet('finish',{id:'223',lease_token:recovered[0].lease_token,outcome:'retry',error_type:'SyntheticProviderError'})
 assert.equal((await row('SELECT status FROM wallet_sync_jobs WHERE id=223')).status,'failed')
 assert.equal((await wallet('claim',{limit:10})).jobs.length,0)
 // Execute actual permissions: untrusted database roles cannot read tokens or run commands.
 for(const role of ['anon','authenticated']) {
  await db.exec('SET ROLE '+role)
  await assert.rejects(db.query('SELECT * FROM apple_push_deliveries'),e=>e.code==='42501')
  await assert.rejects(push('claim'),e=>e.code==='42501')
  await assert.rejects(wallet('claim'),e=>e.code==='42501')
  await db.exec('RESET ROLE')
 }
 await db.exec('SET ROLE service_role');await push('claim',{limit:20});await wallet('claim',{limit:10})
 await db.exec('RESET ROLE')
 console.log('APNs outbox and wallet lease SQL: recovery, scope, retries, coalescing and permissions passed')
} finally {await db.close()}

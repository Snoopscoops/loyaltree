/* Disposable PostgreSQL/PGlite checks. Never contacts Supabase, StoreHub or a POS.
 * node test_companion_reactivation_sql.mjs <PGlite dist/index.js> [migration.sql] [offline.sql]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.on('uncaughtException', error => {
  process.stderr.write(`${JSON.stringify({message:error.message,code:error.code,where:error.where,position:error.position})}\n`);
  process.exit(1);
});
process.on('unhandledRejection', error => { throw error; });
assert(process.argv[2], 'Pass the installed PGlite entrypoint');
const {PGlite} = await import(pathToFileURL(path.resolve(process.argv[2])).href);
async function firstExisting(candidates) {
  for(const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  throw new Error('Pass the migration and existing offline SQL file paths');
}
const migration = await fs.readFile(process.argv[3] || await firstExisting([
  new URL('../storehub_companion_reactivation.sql', import.meta.url),new URL('../storehub_companion_reactivation.sql', import.meta.url)]),'utf8');
const offline = await fs.readFile(process.argv[4] || await firstExisting([
  new URL('./storehub_offline_sales.sql', import.meta.url),new URL('../storehub_offline_sales.sql', import.meta.url),
  path.resolve('backend/storehub_offline_sales.sql')]),'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids = {integration:uuid(31),mapping:uuid(41),device:uuid(51),otherDevice:uuid(52),code:uuid(61),otherCode:uuid(62)};
const oldHash='a'.repeat(64), codeHash='b'.repeat(64), newHash='c'.repeat(64);
const signature='pos_reactivate_companion_device(text,text,text,text,text,text,boolean,text)';
let passed=0;
const db=new PGlite();

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE businesses(id integer primary key,name text,is_active boolean);
  CREATE TABLE branches(id integer primary key,business_id integer,public_id text,name text,is_active boolean);
  CREATE TABLE staff(id integer primary key,business_id integer,branch_id integer,role text,is_active boolean,permissions jsonb);
  CREATE TABLE pos_integrations(id uuid primary key,business_id integer,provider text,status text,mode text,config jsonb);
  CREATE TABLE pos_branch_mappings(id uuid primary key,business_id integer,integration_id uuid,branch_id integer,
    external_branch_id text,external_branch_name text,is_active boolean,settings jsonb);
  CREATE TABLE pos_devices(id uuid primary key,business_id integer,branch_id integer,integration_id uuid,mapping_id uuid,
    provider text,device_token_hash text unique,display_name text,hardware_model text,scanner_method text,checkout_mode text,
    overlay_enabled boolean,status text,app_version text,metadata jsonb,activated_at timestamptz default now(),
    last_seen_at timestamptz,created_at timestamptz default now());
  CREATE TABLE pos_device_activation_codes(id uuid primary key,business_id integer,provider text,code_hash text unique,
    expires_at timestamptz,max_uses integer,used_count integer,revoked_at timestamptz,metadata jsonb,created_at timestamptz default now());
  CREATE TABLE pos_companion_sessions(id uuid primary key,device_id uuid,result jsonb);
  CREATE TABLE storehub_offline_sales(id uuid primary key,device_id text,original_event jsonb,status text);
`);
for(const name of ['pos_offline_trim','pos_offline_sale_lock_scope','pos_offline_sale_assert_device']) {
  const start=offline.indexOf(`create or replace function public.${name}(`);
  assert(start>=0,`Missing actual dependency ${name}`);
  const end=offline.indexOf(name==='pos_offline_trim'?'$$;':'end $$;',start);
  assert(end>start,`Cannot extract dependency ${name}`);
  await db.exec(offline.slice(start,end+(name==='pos_offline_trim'?3:7)));
}
await db.exec(migration);

function metadata(patch={}) {
  return {purpose:'pos_companion_device_activation',generated_by:'branch_manager',manager_staff_id:21,
    allowed_branch_id:11,allowed_branch_public_id:'branch-1',allowed_external_branch_id:'outlet-1',
    allowed_external_terminal_id:'register-1',reactivate_device_id:ids.device,
    reactivate_expected_token_hash:oldHash,reactivate_integration_id:ids.integration,reactivate_mapping_id:ids.mapping,...patch};
}
async function addCode(id=ids.code,hash=codeHash,patch={}) {
  await db.query(`INSERT INTO pos_device_activation_codes
    (id,business_id,provider,code_hash,expires_at,max_uses,used_count,metadata)
    VALUES($1,1,'storehub',$2,now()+interval '15 minutes',1,0,$3)`,[id,hash,JSON.stringify(metadata(patch))]);
}
async function reset() {
  await db.exec(`TRUNCATE pos_companion_sessions,storehub_offline_sales,pos_device_activation_codes,pos_devices,
    pos_branch_mappings,pos_integrations,staff,branches,businesses`);
  await db.exec(`INSERT INTO businesses VALUES(1,'ANGKAN',true),(2,'Other',true);
    INSERT INTO branches VALUES(11,1,'branch-1','Branch 1',true),(12,1,'branch-2','Branch 2',true);
    INSERT INTO staff VALUES(21,1,11,'manager',true,'{"manage_companion_devices":true}');`);
  await db.query(`INSERT INTO pos_integrations VALUES($1,1,'storehub','connected','live','{}')`,[ids.integration]);
  await db.query(`INSERT INTO pos_branch_mappings VALUES($1,1,$2,11,'outlet-1','Outlet 1',true,'{"keep":"mapping"}')`,[ids.mapping,ids.integration]);
  await db.query(`INSERT INTO pos_devices(id,business_id,branch_id,integration_id,mapping_id,provider,
    device_token_hash,display_name,hardware_model,scanner_method,checkout_mode,overlay_enabled,status,app_version,metadata,activated_at)
    VALUES($1,1,11,$2,$3,'storehub',$4,'Existing machine','sunmi_d3_pro','hardware','floating',true,'active','0.6.0',$5,'2026-10-09T07:35:00Z')`,
    [ids.device,ids.integration,ids.mapping,oldHash,JSON.stringify({activation_code_id:'original-code',external_terminal_id:'register-1',seen_register_ids:['register-1','register-2'],keep:'audit'})]);
  await db.query(`INSERT INTO pos_companion_sessions VALUES($1,$2,'{"original":"session"}')`,[uuid(71),ids.device]);
  await db.query(`INSERT INTO storehub_offline_sales VALUES($1,$2,'{"original":"sale"}','pending')`,[uuid(81),ids.device]);
  await addCode();
}
async function reactivate(patch={}) {
  const args={activation:ids.code,hash:codeHash,token:newHash,hardware:'sunmi_d3_pro',scanner:'hardware',checkout:'floating',overlay:true,version:'0.7.0',...patch};
  return (await db.query('SELECT pos_reactivate_companion_device($1,$2,$3,$4,$5,$6,$7,$8) device',
    [args.activation,args.hash,args.token,args.hardware,args.scanner,args.checkout,args.overlay,args.version])).rows[0].device;
}
const device=async()=> (await db.query('SELECT * FROM pos_devices WHERE id=$1',[ids.device])).rows[0];
const code=async(id=ids.code)=> (await db.query('SELECT * FROM pos_device_activation_codes WHERE id=$1',[id])).rows[0];
async function unchanged() {assert.equal((await device()).device_token_hash,oldHash);assert.equal((await code()).used_count,0);}
async function test(name,fn) {await fn();passed++;process.stdout.write(`PASS ${name}\n`);}
async function rejectsWithoutUse(fn) {await assert.rejects(fn);await unchanged();}

await test('migration is rerunnable and RPC is service-role only',async()=>{
  await db.exec(migration);
  const grants=(await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') anon,
    has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
    has_function_privilege('service_role',$1,'EXECUTE') service_role`,[signature])).rows[0];
  assert.deepEqual(grants,{anon:false,authenticated:false,service_role:true});
  await reset();
  for(const role of ['anon','authenticated']) {
    await db.exec(`GRANT USAGE ON SCHEMA public TO ${role}; SET ROLE ${role}`);
    try {await assert.rejects(()=>reactivate(), /permission denied/);} finally {await db.exec('RESET ROLE');}
    await unchanged();
  }
  await db.exec('GRANT USAGE ON SCHEMA public TO service_role; SET ROLE service_role');
  try {assert.equal((await reactivate()).id,ids.device);} finally {await db.exec('RESET ROLE');}
});

await test('successful reactivation rotates same device and preserves register, original activation and saved work',async()=>{
  await reset();const before=await device();const row=await reactivate({hardware:'other',scanner:'camera',checkout:'direct',overlay:false});
  assert.equal(row.id,ids.device);assert.equal(row.device_token_hash,newHash);
  assert.equal((await db.query('SELECT count(*) n FROM pos_devices')).rows[0].n,1);
  const after=await device();
  for(const key of ['id','business_id','branch_id','integration_id','mapping_id','provider','display_name','activated_at']) assert.deepEqual(after[key],before[key],key);
  for(const key of ['activation_code_id','external_terminal_id','seen_register_ids','keep']) assert.deepEqual(after.metadata[key],before.metadata[key],key);
  assert.equal(after.hardware_model,'other');assert.equal(after.scanner_method,'camera');assert.equal(after.checkout_mode,'direct');
  assert.equal(after.overlay_enabled,false);assert.equal(after.app_version,'0.7.0');assert(after.last_seen_at);
  assert.equal(after.metadata.last_reactivation_code_id,ids.code);assert(after.metadata.last_reactivated_at);
  assert.equal(Number(after.metadata.reactivation_count),1);assert.equal((await code()).used_count,1);
  assert.deepEqual((await db.query('SELECT result FROM pos_companion_sessions')).rows[0].result,{original:'session'});
  assert.deepEqual((await db.query('SELECT original_event,status FROM storehub_offline_sales')).rows[0],{original_event:{original:'sale'},status:'pending'});
});

await test('used code cannot rotate a second time or replace first returned token',async()=>{
  await reset();await reactivate();await assert.rejects(()=>reactivate({token:'d'.repeat(64)}));
  assert.equal((await device()).device_token_hash,newHash);assert.equal((await code()).used_count,1);
});

await test('parallel code for old pairing becomes invalid after another code rotates token',async()=>{
  await reset();await addCode(ids.otherCode,'d'.repeat(64));await reactivate();
  await assert.rejects(()=>reactivate({activation:ids.otherCode,hash:'d'.repeat(64),token:'e'.repeat(64)}));
  assert.equal((await device()).device_token_hash,newHash);assert.equal((await code(ids.otherCode)).used_count,0);
});

await test('newly authorized code can reactivate same device again without multiplying records',async()=>{
  await reset();await reactivate();await addCode(ids.otherCode,'d'.repeat(64),{reactivate_expected_token_hash:newHash});
  const row=await reactivate({activation:ids.otherCode,hash:'d'.repeat(64),token:'e'.repeat(64)});
  assert.equal(row.id,ids.device);assert.equal(row.metadata.reactivation_count,2);
  assert.equal((await db.query('SELECT count(*) n FROM pos_devices')).rows[0].n,1);
});

await test('wrong, missing, revoked, expired or exhausted activation is rejected without token change',async()=>{
  for(const mutation of ["expires_at=now()-interval '1 second'","expires_at=NULL","expires_at='infinity'","revoked_at=now()","used_count=1","max_uses=0","max_uses=2","provider='loyverse'","business_id=2"]) {
    await reset();await db.exec(`UPDATE pos_device_activation_codes SET ${mutation}`);
    const before=(await code()).used_count;await assert.rejects(()=>reactivate());
    assert.equal((await device()).device_token_hash,oldHash);assert.equal((await code()).used_count,before);
  }
  await reset();await rejectsWithoutUse(()=>reactivate({activation:uuid(999)}));
  await rejectsWithoutUse(()=>reactivate({hash:'d'.repeat(64)}));
});

await test('invalid output credentials are rejected without consuming a valid code',async()=>{
  for(const token of [null,'','x','g'.repeat(64),oldHash]) {
    await reset();await rejectsWithoutUse(()=>reactivate({token}));
  }
});

await test('device identity, provider, status, register and tenant snapshots cannot be changed by a code',async()=>{
  for(const mutation of ["status='disabled'","status='revoked'","provider='loyverse'","business_id=2","branch_id=12",
    `integration_id='${uuid(999)}'`,`mapping_id='${uuid(999)}'`,"metadata=jsonb_set(metadata,'{external_terminal_id}','\"register-2\"')",
    "metadata=metadata-'external_terminal_id'",`device_token_hash='${'f'.repeat(64)}'`]) {
    await reset();await db.exec(`UPDATE pos_devices SET ${mutation}`);
    const before=await device();await assert.rejects(()=>reactivate());
    assert.equal((await device()).device_token_hash,before.device_token_hash);assert.equal((await code()).used_count,0);
  }
});

await test('malformed or mismatched code scope never falls back to another active device',async()=>{
  for(const patch of [{reactivate_device_id:ids.otherDevice},{reactivate_device_id:null},{reactivate_expected_token_hash:null},
    {reactivate_integration_id:uuid(999)},{reactivate_mapping_id:uuid(999)},{allowed_branch_id:12},
    {allowed_branch_public_id:'branch-2'},{allowed_external_branch_id:'outlet-2'},{allowed_external_terminal_id:'register-2'},
    {allowed_external_terminal_id:null},{purpose:'something_else'}]) {
    await reset();await db.query('UPDATE pos_device_activation_codes SET metadata=$1',[JSON.stringify(metadata(patch))]);
    await rejectsWithoutUse(()=>reactivate());
    assert.equal((await db.query('SELECT count(*) n FROM pos_devices')).rows[0].n,1);
  }
});

await test('current mapping, branch and integration are revalidated before code consumption',async()=>{
  for(const [table,mutation] of [
    ['pos_branch_mappings','is_active=false'],['pos_branch_mappings','business_id=2'],['pos_branch_mappings','branch_id=12'],
    ['pos_branch_mappings',`integration_id='${uuid(999)}'`],['pos_branch_mappings',"external_branch_id='outlet-2'"],
    ['branches','is_active=false'],['branches','business_id=2'],['branches',"public_id='branch-renamed'"],
    ['pos_integrations',"provider='loyverse'"],['pos_integrations','business_id=2'],
    ['pos_integrations',"status='disconnected'"],['pos_integrations',"status='error'"]]) {
    await reset();await db.exec(`UPDATE ${table} SET ${mutation}`);await rejectsWithoutUse(()=>reactivate());
  }
});

await test('owner revoking or reassigning the generating manager invalidates unused code',async()=>{
  for(const mutation of ['is_active=false',"role='staff'",'branch_id=12','business_id=2',"permissions='{}'", "permissions='null'", "permissions='{\"manage_companion_devices\":false}'", "permissions='{\"manage_companion_devices\":\"true\"}'"]) {
    await reset();await db.exec(`UPDATE staff SET ${mutation}`);await rejectsWithoutUse(()=>reactivate());
  }
  await reset();await db.exec('DELETE FROM staff');await rejectsWithoutUse(()=>reactivate());
});

await test('legacy serialized manager permissions remain compatible while optional device revocation is enforced',async()=>{
  await reset();await db.query('UPDATE staff SET permissions=to_jsonb($1::text)', ['{"manage_companion_devices":true}']);
  assert.equal((await reactivate()).device_token_hash,newHash);
  await db.exec('ALTER TABLE pos_devices ADD COLUMN revoked_at timestamptz');
  try {
    await reset();await db.exec('UPDATE pos_devices SET revoked_at=now()');
    await rejectsWithoutUse(()=>reactivate());
  } finally {await db.exec('ALTER TABLE pos_devices DROP COLUMN revoked_at');}
});

await test('pre-existing duplicate active register blocks reactivation without rotating either token',async()=>{
  await reset();await db.query(`INSERT INTO pos_devices(id,business_id,branch_id,integration_id,mapping_id,
    provider,status,device_token_hash,metadata) VALUES($1,1,11,$2,$3,'storehub','active',$4,'{"external_terminal_id":" register-1 "}')`,
    [ids.otherDevice,ids.integration,ids.mapping,'f'.repeat(64)]);
  await rejectsWithoutUse(()=>reactivate());
  assert.equal((await db.query('SELECT device_token_hash FROM pos_devices WHERE id=$1',[ids.otherDevice])).rows[0].device_token_hash,'f'.repeat(64));
});

await test('token uniqueness failure preserves both devices and code for retry',async()=>{
  await reset();await db.query(`INSERT INTO pos_devices(id,business_id,branch_id,integration_id,mapping_id,
    provider,status,device_token_hash,metadata) VALUES($1,1,11,$2,$3,'storehub','active',$4,'{"external_terminal_id":"register-2"}')`,
    [ids.otherDevice,ids.integration,ids.mapping,newHash]);
  await assert.rejects(()=>reactivate(),error=>error.code==='23505');await unchanged();
  const row=await reactivate({token:'e'.repeat(64)});assert.equal(row.device_token_hash,'e'.repeat(64));
  assert.equal((await db.query('SELECT count(*) n FROM pos_devices')).rows[0].n,2);
});

await test('failure updating activation rolls back token rotation and allows later valid activation',async()=>{
  await reset();await db.exec(`CREATE FUNCTION test_block_activation_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected activation write failure'; END $$;
    CREATE TRIGGER test_block_activation_update BEFORE UPDATE ON pos_device_activation_codes
    FOR EACH ROW EXECUTE FUNCTION test_block_activation_update();`);
  await rejectsWithoutUse(()=>reactivate());
  await db.exec('DROP TRIGGER test_block_activation_update ON pos_device_activation_codes; DROP FUNCTION test_block_activation_update()');
  assert.equal((await reactivate()).device_token_hash,newHash);assert.equal((await code()).used_count,1);
});

await test('failure updating device rolls back code consumption and allows later valid activation',async()=>{
  await reset();await db.exec(`CREATE FUNCTION test_block_device_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected device write failure'; END $$;
    CREATE TRIGGER test_block_device_update BEFORE UPDATE ON pos_devices
    FOR EACH ROW EXECUTE FUNCTION test_block_device_update();`);
  await rejectsWithoutUse(()=>reactivate());
  await db.exec('DROP TRIGGER test_block_device_update ON pos_devices; DROP FUNCTION test_block_device_update()');
  assert.equal((await reactivate()).device_token_hash,newHash);assert.equal((await code()).used_count,1);
});

await test('missing offline scope dependency fails migration before replacing activation behavior',async()=>{
  const before=(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
  await db.exec('DROP FUNCTION pos_offline_sale_assert_device(text,text,text,text,text,text)');
  await assert.rejects(()=>db.exec(migration),/existing POS activation|offline-sale migrations/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition,before);
});

await db.close();
process.stdout.write(`\n${passed} Companion reactivation SQL regression cases passed.\n`);

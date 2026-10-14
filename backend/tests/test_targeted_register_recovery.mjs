// Disposable PostgreSQL checks for the approved, scope-locked recovery.
// Never contacts Supabase or StoreHub.
// Run: node backend/tests/test_targeted_register_recovery.mjs /path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

assert(process.argv[2], 'Pass the installed PGlite entrypoint as the first argument');
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
let migration;
for (const candidate of process.argv[3] ? [process.argv[3]] : [
  new URL('../storehub_register_bindings.sql', import.meta.url),
  new URL('./organized_storehub_register_bindings.sql', import.meta.url),
]) {
  try { migration = await fs.readFile(candidate, 'utf8'); break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
assert(migration, 'Pass the migration path as the optional second argument');
const keeper = 'cea90f73-e5d8-4043-b31c-70c14b2006e0';
const old1 = '6645ea4b-3663-4a23-881e-8954ae3a965d';
const old2 = 'e1ba3c6d-66e9-46d5-8959-e8228d3d006e';
const integration = '2d34e3e4-3b55-48cd-a35e-75273319bf62';
const mapping = '00000000-0000-4000-8000-000000000001';
const outlet = '68397fe9474be40007880517';
const register = '683981062d8a2900083a998d';
const ids = [keeper, old1, old2];
let passed = 0;

async function fixture({ absent = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE pos_integrations(id uuid PRIMARY KEY, business_id bigint, provider text);
    CREATE TABLE branches(id bigint PRIMARY KEY, business_id bigint, name text, is_active boolean);
    CREATE TABLE pos_branch_mappings(id uuid PRIMARY KEY, business_id bigint, integration_id uuid,
      branch_id bigint, is_active boolean, external_branch_id text, external_branch_name text);
    CREATE TABLE pos_devices(id uuid PRIMARY KEY, business_id bigint, integration_id uuid,
      branch_id bigint, mapping_id uuid, provider text, status text NOT NULL
        CHECK (status IN ('active','disabled','revoked')), metadata jsonb,
      display_name text, hardware_model text, device_token_hash text,
      activated_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz);
  `);
  await db.query("INSERT INTO pos_integrations VALUES($1,1,'storehub')", [integration]);
  await db.exec("INSERT INTO branches VALUES(50,1,'Gateway',true)");
  await db.query('INSERT INTO pos_branch_mappings VALUES($1,1,$2,50,true,$3,\'Gateway\')', [mapping, integration, outlet]);
  if (!absent) {
    for (const [i, id] of ids.entries()) {
      const seen = ['2026-10-09 10:10:07.555309+00', '2026-10-09 08:43:26.514518+00', '2026-10-09 07:36:49.938626+00'][i];
      await db.query(`INSERT INTO pos_devices VALUES($1,1,$2,50,$3,'storehub','active',$4,
        'ANGKAN Gateway Companion','Sunmi D3',$5,$6,$7,null)`,
      [id, integration, mapping, {external_terminal_id: register, activation_code_id: `code-${i}`, unrelated: {preserve: true}},
        `token-${i}`, '2026-10-09 07:00:00+00', seen]);
    }
  }
  return db;
}
const snapshots = async db => (await db.query('SELECT to_jsonb(d) AS device FROM pos_devices d ORDER BY id')).rows.map(r => r.device);
async function failed(db, pattern) {
  const before = await snapshots(db);
  await assert.rejects(db.exec(migration), pattern);
  await db.exec('ROLLBACK');
  assert.deepEqual(await snapshots(db), before, 'Failed recovery must preserve every device row');
  assert.equal((await db.query("SELECT to_regprocedure('public.pos_normalize_storehub_register(text)') IS NULL AS absent")).rows[0].absent, true,
    'Failed recovery must roll back migration functions');
}
async function check(name, action) {
  await action(); passed++; console.log(`PASS ${name}`);
}

await check('preserves keeper and all history; disables only two verified old records', async () => {
  const db = await fixture(); const before = await snapshots(db);
  await db.exec(migration);
  const after = await snapshots(db);
  assert.equal(after.length, before.length);
  assert.deepEqual(after.find(r => r.id === keeper), before.find(r => r.id === keeper));
  for (const id of [old1, old2]) {
    const row = after.find(r => r.id === id); const original = before.find(r => r.id === id);
    assert.equal(row.status, 'disabled');
    for (const [key, value] of Object.entries(original)) {
      if (key === 'metadata' || key === 'status') continue;
      assert.deepEqual(row[key], value, `${key} must be preserved on old devices`);
    }
    for (const [key, value] of Object.entries(original.metadata)) assert.deepEqual(row.metadata[key], value);
    assert.ok(JSON.stringify(row.metadata).includes(keeper), 'Recovery metadata must identify retained device');
  }
  assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, true);
  await db.close();
});

await check('rerun is idempotent with disabled old rows', async () => {
  const db = await fixture(); await db.exec(migration); const before = await snapshots(db);
  await db.exec(migration); assert.deepEqual(await snapshots(db), before); await db.close();
});

for (const [name, patch, values] of [
  ['new heartbeat on older device', "UPDATE pos_devices SET last_seen_at=last_seen_at + interval '1 second' WHERE id=$1", [old1]],
  ['older device wrong branch', 'UPDATE pos_devices SET branch_id=51 WHERE id=$1', [old1]],
  ['older device wrong integration', "UPDATE pos_devices SET integration_id='00000000-0000-4000-8000-000000000002' WHERE id=$1", [old1]],
  ['older device wrong business', 'UPDATE pos_devices SET business_id=2 WHERE id=$1', [old1]],
  ['older device wrong provider', "UPDATE pos_devices SET provider='loyverse' WHERE id=$1", [old1]],
  ['older device wrong register', "UPDATE pos_devices SET metadata=jsonb_set(metadata,'{external_terminal_id}','\"different\"') WHERE id=$1", [old1]],
  ['keeper wrong branch', 'UPDATE pos_devices SET branch_id=51 WHERE id=$1', [keeper]],
  ['keeper wrong integration', "UPDATE pos_devices SET integration_id='00000000-0000-4000-8000-000000000002' WHERE id=$1", [keeper]],
  ['keeper wrong provider', "UPDATE pos_devices SET provider='loyverse' WHERE id=$1", [keeper]],
  ['keeper disabled', "UPDATE pos_devices SET status='disabled' WHERE id=$1", [keeper]],
  ['mapped outlet changed', "UPDATE pos_branch_mappings SET external_branch_id='another-outlet'", []],
  ['mapped integration changed', "UPDATE pos_branch_mappings SET integration_id='00000000-0000-4000-8000-000000000002'", []],
  ['mapped branch changed', 'UPDATE pos_branch_mappings SET branch_id=51', []],
  ['mapping inactive', 'UPDATE pos_branch_mappings SET is_active=false', []],
  ['missing keeper', 'DELETE FROM pos_devices WHERE id=$1', [keeper]],
  ['missing one old device', 'DELETE FROM pos_devices WHERE id=$1', [old1]],
]) {
  await check(`refuses ${name} and rolls back`, async () => {
    const db = await fixture(); await db.query(patch, values); await failed(db, /./); await db.close();
  });
}

await check('all target IDs absent installs migration without cleanup', async () => {
  const db = await fixture({absent: true}); await db.exec(migration);
  assert.deepEqual(await snapshots(db), []);
  assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, true);
  await db.close();
});

await check('later schema failure rolls back cleanup and metadata', async () => {
  const db = await fixture();
  await db.exec('CREATE INDEX pos_devices_storehub_register_active_uidx ON pos_devices(id)');
  await failed(db, /differs from the required definition/); await db.close();
});

await check('unreviewed fourth duplicate causes full rollback', async () => {
  const db = await fixture();
  await db.query(`INSERT INTO pos_devices SELECT '00000000-0000-4000-8000-000000000004',business_id,integration_id,
    branch_id,mapping_id,provider,status,metadata,display_name,hardware_model,'unreviewed-token',
    activated_at,last_seen_at,revoked_at FROM pos_devices WHERE id=$1`, [keeper]);
  await failed(db, /Duplicate active StoreHub Register IDs/); await db.close();
});

console.log(`${passed} targeted recovery checks passed`);

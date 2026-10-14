/* Disposable PostgreSQL/PGlite regressions; never contacts Supabase or StoreHub.
 * Run: node work/register-binding/test_storehub_register_sql.mjs \
 *   work/void-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js \
 *   [optional migration path]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

assert(process.argv[2], 'Pass the installed PGlite entrypoint');
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
let migration;
for (const candidate of process.argv[3] ? [process.argv[3]] : [
  new URL('./storehub_register_bindings.sql', import.meta.url),
  new URL('../storehub_register_bindings.sql', import.meta.url),
]) {
  try { migration = await fs.readFile(candidate, 'utf8'); break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
assert(migration, 'Pass the migration path as the optional second argument');
let passed = 0;
const identity = (kind, n) => kind === 'uuid'
  ? `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` : String(n);

async function schema(db, kind, tenantKind = kind, roles = true) {
  await db.exec(`${roles ? 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;' : ''}
    CREATE TABLE pos_integrations(id ${kind} PRIMARY KEY, business_id ${tenantKind}, provider text);
    CREATE TABLE branches(id ${tenantKind} PRIMARY KEY, business_id ${tenantKind}, is_active boolean);
    CREATE TABLE pos_branch_mappings(id ${kind} PRIMARY KEY, business_id ${tenantKind}, integration_id ${kind},
      branch_id ${tenantKind}, is_active boolean, external_branch_id text);
    CREATE TABLE pos_devices(id ${kind} PRIMARY KEY, business_id ${tenantKind}, integration_id ${kind},
      branch_id ${tenantKind}, mapping_id ${kind}, provider text, status text, metadata jsonb,
      display_name text, device_token_hash text);
  `);
}
async function test(name, fn) {
  await fn(); passed++; process.stdout.write(`PASS ${name}\n`);
}
async function suite(kind, tenantKind = kind) {
  const db = new PGlite();
  const ids = {
    business: identity(tenantKind, 1), otherBusiness: identity(tenantKind, 2),
    integration: identity(kind, 10), otherIntegration: identity(kind, 11),
    branch: identity(tenantKind, 20), otherBranch: identity(tenantKind, 21),
    mapping: identity(kind, 30), otherMapping: identity(kind, 31),
    device: identity(kind, 40), otherDevice: identity(kind, 41), thirdDevice: identity(kind, 42),
  };
  await schema(db, kind, tenantKind);
  await db.exec(migration);
  async function reset() {
    await db.exec('TRUNCATE pos_devices, pos_branch_mappings, branches, pos_integrations');
    await db.query(`INSERT INTO pos_integrations VALUES($1,$2,'storehub'),($3,$2,'storehub')`, [ids.integration, ids.business, ids.otherIntegration]);
    await db.query('INSERT INTO branches VALUES($1,$2,true),($3,$2,true)', [ids.branch, ids.business, ids.otherBranch]);
    await db.query(`INSERT INTO pos_branch_mappings VALUES($1,$2,$3,$4,true,'outlet-1'),($5,$2,$3,$6,true,'outlet-2')`,
      [ids.mapping, ids.business, ids.integration, ids.branch, ids.otherMapping, ids.otherBranch]);
  }
  async function device({ id = ids.device, integration = ids.integration, branch = ids.branch,
    mapping = ids.mapping, business = ids.business, register, metadata = {}, status = 'active', provider = 'storehub' } = {}) {
    const meta = { keep: 'original', ...metadata };
    if (register !== undefined) meta.external_terminal_id = register;
    await db.query('INSERT INTO pos_devices VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, business, integration, branch, mapping, provider, status, JSON.stringify(meta), `machine-${id}`, 'secret-hash']);
  }
  const assign = (register, business = ids.business, deviceId = ids.device) => db.query(
    'SELECT pos_assign_storehub_register($1,$2,$3) result', [deviceId, business, register]);
  const observe = (registers, outlet = 'outlet-1', deviceId = ids.device) => db.query(
    'SELECT pos_record_storehub_registers($1,$2,$3) result', [deviceId, outlet, JSON.stringify(registers)]);
  const metadata = async () => (await db.query('SELECT metadata FROM pos_devices WHERE id=$1', [ids.device])).rows[0].metadata;
  const check = (name, fn) => test(`${kind}/tenant-${tenantKind}: ${name}`, fn);

  await check('migration readiness and idempotent rerun', async () => {
    assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, true);
    await db.exec(migration);
    assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, true);
  });
  await check('same branch duplicate ID is rejected by database index', async () => {
    await reset(); await device({ register: 'register-1' });
    await assert.rejects(device({ id: ids.otherDevice, register: 'register-1' }), e => e.code === '23505' && /pos_devices_storehub_register_active_uidx/.test(e.message));
    assert.equal((await db.query('SELECT count(*) count FROM pos_devices')).rows[0].count, 1);
  });
  await check('whitespace cannot bypass duplicate binding', async () => {
    await reset(); await device({ register: 'register-1' });
    for (const wrapped of [' register-1 ', '\tregister-1\n', '\u00a0register-1\u00a0', '\u2003register-1\u202f', '\u001cregister-1\u001f']) {
      await assert.rejects(device({ id: ids.otherDevice, register: wrapped }), e => e.code === '23505');
    }
  });
  await check('IDs remain case sensitive and scoped per branch/integration', async () => {
    await reset(); await device({ register: 'register-1' });
    await device({ id: ids.otherDevice, register: 'Register-1' });
    await device({ id: ids.thirdDevice, branch: ids.otherBranch, mapping: ids.otherMapping, register: 'register-1' });
    await device({ id: identity(kind, 43), integration: ids.otherIntegration, register: 'register-1' });
    assert.equal((await db.query('SELECT count(*) count FROM pos_devices')).rows[0].count, 4);
  });
  await check('retired and other-provider devices do not claim StoreHub register', async () => {
    await reset(); await device({ register: 'register-1' });
    await device({ id: ids.otherDevice, register: 'register-1', status: 'revoked' });
    await device({ id: ids.thirdDevice, register: 'register-1', provider: 'loyverse' });
    await assert.rejects(db.query("UPDATE pos_devices SET status='active' WHERE id=$1", [ids.otherDevice]), e => e.code === '23505');
  });
  await check('unbound legacy StoreHub devices remain compatible', async () => {
    await reset(); await device(); await device({ id: ids.otherDevice, register: '' });
    await device({ id: ids.thirdDevice, register: '\u00a0 \t', integration: null, branch: null });
    assert.equal((await db.query('SELECT count(*) count FROM pos_devices')).rows[0].count, 3);
  });
  await check('assigned active devices require non-null scope and valid ID string', async () => {
    await reset();
    for (const invalid of [{ integration: null }, { branch: null }, { register: 123 }, { register: ['register-1'] }, { register: 'x'.repeat(121) }]) {
      await assert.rejects(device({ register: 'register-1', ...invalid }), e => e.code === '23514');
    }
  });
  await check('assignment normalizes ID and preserves discovery/preferences metadata', async () => {
    await reset(); await device({ metadata: { seen_register_ids: ['register-1'], overlay_enabled: true } });
    const assigned = (await assign('\u00a0 register-1\u3000')).rows[0].result;
    assert.equal(assigned.metadata.external_terminal_id, 'register-1');
    assert.equal(assigned.metadata.keep, 'original'); assert.equal(assigned.metadata.overlay_enabled, true);
    assert.deepEqual(assigned.metadata.seen_register_ids, ['register-1']);
    assert.equal(String(assigned.id), ids.device);
  });
  await check('assignment conflict rolls back metadata and allows same-device retry', async () => {
    await reset(); await device({ register: 'register-1', metadata: { seen_register_ids: ['register-2'] } });
    await device({ id: ids.otherDevice, register: 'register-2' });
    await assert.rejects(assign('register-2'), e => e.code === '23505');
    assert.equal((await metadata()).external_terminal_id, 'register-1');
    assert.deepEqual((await metadata()).seen_register_ids, ['register-2']);
    await assign('register-1');
  });
  await check('competing assignments leave exactly one register claim', async () => {
    await reset(); await device(); await device({ id: ids.otherDevice });
    // PGlite serializes connection queries; the database unique index, rather
    // than application preflight, is the arbiter for this lost-preflight case.
    const attempts = await Promise.allSettled([
      assign('register-1'), assign('register-1', ids.business, ids.otherDevice),
    ]);
    assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(row => row.status === 'rejected').reason.code, '23505');
    assert.equal((await db.query("SELECT count(*) count FROM pos_devices WHERE metadata->>'external_terminal_id'='register-1'")).rows[0].count, 1);
  });
  await check('assignment validates business/device/provider/status', async () => {
    await reset(); await device();
    await assert.rejects(assign('register-1', ids.otherBusiness), /belonging to this business/);
    await assert.rejects(assign('register-1', ids.business, ids.otherDevice), /belonging to this business/);
    for (const patch of ["status='revoked'", "provider='loyverse'"]) {
      await db.query(`UPDATE pos_devices SET ${patch} WHERE id=$1`, [ids.device]);
      await assert.rejects(assign('register-1'), /belonging to this business/);
      await db.query("UPDATE pos_devices SET status='active',provider='storehub' WHERE id=$1", [ids.device]);
    }
    assert.equal((await metadata()).external_terminal_id, undefined);
  });
  await check('assignment rejects blank/null/oversized IDs', async () => {
    await reset(); await device();
    for (const invalid of [null, '', '\u00a0\t\u3000', 'x'.repeat(121)]) await assert.rejects(assign(invalid), /1 to 120 characters/);
    assert.equal((await metadata()).external_terminal_id, undefined);
  });
  await check('assignment rejects mismatched or inactive mapping/branch/integration', async () => {
    for (const mutation of [
      ['pos_branch_mappings', "is_active=false"], ['pos_branch_mappings', 'business_id=$1', ids.otherBusiness],
      ['pos_branch_mappings', 'integration_id=$1', ids.otherIntegration], ['pos_branch_mappings', 'branch_id=$1', ids.otherBranch],
      ['pos_branch_mappings', "external_branch_id=' '"], ['branches', 'is_active=false'],
      ['branches', 'business_id=$1', ids.otherBusiness], ['pos_integrations', "provider='loyverse'"],
      ['pos_integrations', 'business_id=$1', ids.otherBusiness],
    ]) {
      await reset(); await device();
      await db.query(`UPDATE ${mutation[0]} SET ${mutation[1]}`, mutation[2] ? [mutation[2]] : []);
      await assert.rejects(assign('register-1'), /active branch\/outlet mapping/);
      assert.equal((await metadata()).external_terminal_id, undefined);
    }
  });
  await check('discovery trims/deduplicates and preserves assignment/preferences', async () => {
    await reset(); await device({ register: 'register-1', metadata: { overlay_enabled: true } });
    let found = (await observe([' register-1 ', 'register-2', 'register-1', '\u00a0register-3\u00a0'])).rows[0].result;
    assert.deepEqual(found.seen_register_ids, ['register-1', 'register-2', 'register-3']);
    assert.equal(found.external_terminal_id, 'register-1'); assert.equal(found.keep, 'original');
    assert.equal(found.overlay_enabled, true); assert.equal(found.seen_register_outlet_id, 'outlet-1');
    assert.match(found.seen_registers_updated_at, /^\d{4}-\d{2}-\d{2}T/);
    found = (await observe(['register-4'])).rows[0].result;
    assert.deepEqual(found.seen_register_ids, ['register-1', 'register-2', 'register-3', 'register-4']);
  });
  await check('discovery never merges IDs from previous outlet after remapping', async () => {
    await reset(); await device({ register: 'register-1', metadata: { seen_register_outlet_id: 'old-outlet', seen_register_ids: ['old-register'] } });
    const found = (await observe(['register-2'])).rows[0].result;
    assert.deepEqual(found.seen_register_ids, ['register-2']); assert.equal(found.external_terminal_id, 'register-1');
  });
  await check('discovery tolerates malformed old metadata and bounds cumulative IDs', async () => {
    await reset(); await device({ metadata: { seen_register_outlet_id: 'outlet-1', seen_register_ids: [null, 123, '', 'old-register'] } });
    const found = (await observe(Array.from({ length: 100 }, (_, n) => `register-${String(n).padStart(3, '0')}`))).rows[0].result;
    assert.equal(found.seen_register_ids.length, 100); assert.equal(found.external_terminal_id, undefined);
    assert.equal(found.seen_register_ids[0], 'old-register');
    await db.query('UPDATE pos_devices SET metadata=$1 WHERE id=$2', [JSON.stringify(['bad metadata']), ids.device]);
    assert.deepEqual((await observe(['register-1'])).rows[0].result.seen_register_ids, ['register-1']);
  });
  await check('discovery validates array shape/strings/length and rejects unknown outlet', async () => {
    await reset(); await device({ register: 'register-1' });
    for (const invalid of [null, {}, 'register-1', [123], [null], [''], ['\u00a0'], ['x'.repeat(121)], Array(101).fill('register-1')]) {
      await assert.rejects(observe(invalid));
    }
    await assert.rejects(observe(['register-2'], 'outlet-2'), /active branch\/outlet/);
    assert.equal((await metadata()).seen_register_ids, undefined);
  });
  await check('discovery rejects inactive/mismatched branch/integration/mapping', async () => {
    for (const mutation of [
      ['pos_devices', "status='revoked'"], ['pos_devices', "provider='loyverse'"],
      ['pos_branch_mappings', 'is_active=false'], ['pos_branch_mappings', 'business_id=$1', ids.otherBusiness],
      ['pos_branch_mappings', 'integration_id=$1', ids.otherIntegration], ['pos_branch_mappings', 'branch_id=$1', ids.otherBranch],
      ['branches', 'is_active=false'], ['branches', 'business_id=$1', ids.otherBusiness],
      ['pos_integrations', "provider='loyverse'"], ['pos_integrations', 'business_id=$1', ids.otherBusiness],
    ]) {
      await reset(); await device();
      await db.query(`UPDATE ${mutation[0]} SET ${mutation[1]}`, mutation[2] ? [mutation[2]] : []);
      await assert.rejects(observe(['register-1']), /active StoreHub device|active branch\/outlet/);
      assert.equal((await metadata()).seen_register_ids, undefined);
    }
  });
  await check('sequential discovery/assignment merges in either order without stale overwrite', async () => {
    await reset(); await device();
    await observe(['register-1']); await assign('register-2'); await observe(['register-3']);
    assert.equal((await metadata()).external_terminal_id, 'register-2');
    assert.deepEqual((await metadata()).seen_register_ids, ['register-1', 'register-3']);
    await assign('register-4');
    assert.deepEqual((await metadata()).seen_register_ids, ['register-1', 'register-3']);
  });
  await check('RPCs are service-role only; pure normalizer stays safe for table index maintenance', async () => {
    for (const fn of ['pos_storehub_register_guard_ready()', 'pos_assign_storehub_register(text,text,text)', 'pos_record_storehub_registers(text,text,jsonb)']) {
      const roles = (await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') anon,
        has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
        has_function_privilege('service_role',$1,'EXECUTE') service_role`, [fn])).rows[0];
      assert.equal(roles.anon, false); assert.equal(roles.authenticated, false); assert.equal(roles.service_role, true);
    }
    await reset(); await device();
    await db.exec('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; SET ROLE anon;');
    try { await assert.rejects(assign('register-1'), /permission denied for function/); }
    finally { await db.exec('RESET ROLE'); }
    await db.exec('SET ROLE service_role');
    try { await assign('register-1'); }
    finally { await db.exec('RESET ROLE'); }
    await db.exec('GRANT INSERT ON pos_devices TO authenticated; SET ROLE authenticated');
    try { await device({ id: ids.otherDevice, register: 'register-2' }); }
    finally { await db.exec('RESET ROLE'); }
    assert.equal((await metadata()).external_terminal_id, 'register-1');
  });
  await check('readiness fails if protection index/constraint is removed', async () => {
    await reset(); await device();
    await db.exec('DROP INDEX pos_devices_storehub_register_active_uidx');
    assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, false);
    await assert.rejects(assign('register-1'), /protection is not installed/);
    await db.exec(migration);
    await db.exec('ALTER TABLE pos_devices DROP CONSTRAINT pos_devices_storehub_register_scope_check');
    assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, false);
    await db.exec(migration);
  });
  await db.close();
}

async function migrationSafety() {
  const db = new PGlite();
  await schema(db, 'bigint');
  async function resetSchema() {
    await db.exec('ROLLBACK; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await schema(db, 'bigint', 'bigint', false);
  }
  const basic = `INSERT INTO pos_devices(id,business_id,integration_id,branch_id,provider,status,metadata)
    VALUES(1,10,20,30,'storehub','active','{"external_terminal_id":"register-1"}')`;
  await test('preflight duplicate bindings fail before index/functions change, devices stay intact', async () => {
    await db.exec(`${basic}; INSERT INTO pos_devices SELECT 2,business_id,integration_id,branch_id,mapping_id,provider,status,'{"external_terminal_id":" register-1 "}',display_name,device_token_hash FROM pos_devices;`);
    await assert.rejects(db.exec(migration), /Duplicate active StoreHub Register IDs/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*) count FROM pos_devices')).rows[0].count, 2);
    assert.equal((await db.query("SELECT to_regclass('pos_devices_storehub_register_active_uidx') result")).rows[0].result, null);
    assert.equal((await db.query("SELECT to_regprocedure('pos_assign_storehub_register(text,text,text)') result")).rows[0].result, null);
    await db.exec("UPDATE pos_devices SET status='revoked' WHERE id=2");
    await db.exec(migration);
  });
  for (const invalid of ['integration_id=NULL', 'branch_id=NULL', "metadata='{\"external_terminal_id\":123}'", `metadata='{"external_terminal_id":"${'x'.repeat(121)}"}'`]) {
    await test(`preflight rejects invalid active existing scope/ID: ${invalid.slice(0, 45)}`, async () => {
      await resetSchema(); await db.exec(`${basic};UPDATE pos_devices SET ${invalid}`);
      await assert.rejects(db.exec(migration), /invalid Register ID or no integration\/branch/);
      await db.exec('ROLLBACK');
      assert.equal((await db.query('SELECT count(*) count FROM pos_devices')).rows[0].count, 1);
    });
  }
  await test('preflight Unicode whitespace also recognizes duplicate active ID', async () => {
    await resetSchema(); await db.exec(basic);
    await db.query(`INSERT INTO pos_devices(id,business_id,integration_id,branch_id,provider,status,metadata)
      VALUES(2,10,20,30,'storehub','active',$1)`, [JSON.stringify({ external_terminal_id: '\u00a0register-1\u00a0' })]);
    await assert.rejects(db.exec(migration), /Duplicate active StoreHub Register IDs/);
    await db.exec('ROLLBACK');
  });
  for (const index of [
    `CREATE UNIQUE INDEX pos_devices_storehub_register_active_uidx ON pos_devices(business_id,branch_id,(metadata->>'external_terminal_id')) WHERE provider='storehub' AND status='active'`,
    `CREATE INDEX pos_devices_storehub_register_active_uidx ON pos_devices(integration_id,branch_id,(metadata->>'external_terminal_id')) WHERE provider='storehub' AND status='active'`,
    `CREATE UNIQUE INDEX pos_devices_storehub_register_active_uidx ON pos_devices(integration_id,branch_id,(metadata->>'external_terminal_id')) WHERE status='active'`,
  ]) {
    await test('migration refuses a mismatched existing named index without replacing it', async () => {
      await resetSchema(); await db.exec(index);
      const original = (await db.query("SELECT pg_get_indexdef('pos_devices_storehub_register_active_uidx'::regclass) result")).rows[0].result;
      await assert.rejects(db.exec(migration), /differs from the required definition/);
      await db.exec('ROLLBACK');
      assert.equal((await db.query("SELECT pg_get_indexdef('pos_devices_storehub_register_active_uidx'::regclass) result")).rows[0].result, original);
    });
  }
  await test('migration refuses a weak existing named scope constraint', async () => {
    await resetSchema(); await db.exec('ALTER TABLE pos_devices ADD CONSTRAINT pos_devices_storehub_register_scope_check CHECK(true)');
    await assert.rejects(db.exec(migration), /differs from the required definition/); await db.exec('ROLLBACK');
  });
  await test('migration accepts varchar provider/status columns', async () => {
    await resetSchema();
    await db.exec('ALTER TABLE pos_devices ALTER COLUMN provider TYPE varchar(40), ALTER COLUMN status TYPE varchar(40)');
    await db.exec(migration);
    assert.equal((await db.query('SELECT pos_storehub_register_guard_ready() ready')).rows[0].ready, true);
  });
  await db.close();
}
await suite('uuid');
await suite('bigint');
await suite('uuid', 'bigint');
await migrationSafety();
process.stdout.write(`\n${passed} StoreHub Register ID SQL regression cases passed.\n`);

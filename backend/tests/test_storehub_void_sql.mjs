/* Runtime PL/pgSQL regressions in a disposable, local PostgreSQL/PGlite DB.
 * Run: node work/test_storehub_void_sql.mjs /absolute/path/to/pglite/dist/index.js
 * Uses synthetic tables and an explicit test-only redemption RPC. It never
 * contacts Supabase, Wallet providers, or production credentials.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const runtime = process.argv[2];
assert(runtime, 'Pass the local PGlite package entrypoint as the first argument');
const { PGlite } = await import(pathToFileURL(runtime).href);
const migrationCandidates = process.argv[3]
  ? [process.argv[3]]
  : [new URL('./storehub_void_reconciliation.sql', import.meta.url),
     new URL('../storehub_void_reconciliation.sql', import.meta.url)];
let migration;
for (const candidate of migrationCandidates) {
  try { migration = await fs.readFile(candidate, 'utf8'); break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
assert(migration, 'Cannot locate storehub_void_reconciliation.sql; pass its path as the second argument');
let passed = 0;

function identity(kind, n) {
  return kind === 'uuid' ? `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` : String(n);
}

async function schema(db, kind, withRPC = true, customerKind = kind) {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE customers(id ${customerKind} PRIMARY KEY, business_id ${customerKind},
      points_balance integer NOT NULL, updated_at timestamptz);
    CREATE TABLE pos_transactions(id ${kind} PRIMARY KEY, integration_id ${kind},
      business_id ${customerKind}, customer_id ${customerKind}, branch_id ${customerKind},
      provider text, status text, external_transaction_id text,
      points_earned integer, points_redeemed integer, gross_amount numeric,
      redemption_reservation_id ${kind}, processing_metadata jsonb,
      updated_at timestamptz);
    CREATE TABLE pos_redemption_reservations(id ${kind} PRIMARY KEY,
      integration_id ${kind}, business_id ${customerKind}, customer_id ${customerKind},
      status text, points_reserved integer, updated_at timestamptz,
      external_transaction_id text, branch_id ${customerKind}, provider text);
    CREATE TABLE wallet_sync_jobs(id bigint PRIMARY KEY);
    CREATE TABLE points_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      business_id ${customerKind}, customer_id ${customerKind}, branch_id ${customerKind},
      amount_spent_pesos numeric, points_earned integer, created_at timestamptz);
    CREATE FUNCTION test_void_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_TABLE_NAME = 'pos_transactions'
        AND to_jsonb(NEW)->>'status' = 'voided'
        AND current_setting('void_test.status_fail', true) = 'on' THEN
        RAISE EXCEPTION 'simulated status failure';
      END IF;
      IF TG_TABLE_NAME = 'points_events'
        AND current_setting('void_test.audit_fail', true) = 'on' THEN
        RAISE EXCEPTION 'simulated audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_status_failure BEFORE UPDATE ON pos_transactions
      FOR EACH ROW EXECUTE FUNCTION test_void_failure();
    CREATE TRIGGER test_audit_failure BEFORE INSERT ON points_events
      FOR EACH ROW EXECUTE FUNCTION test_void_failure();
  `);
  if (withRPC) await db.exec(`
    CREATE FUNCTION public.pos_reverse_points_redemption(
      p_reservation_id ${kind}, p_reason text
    ) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE r public.pos_redemption_reservations%rowtype;
    BEGIN
      SELECT * INTO r FROM pos_redemption_reservations
        WHERE id = p_reservation_id FOR UPDATE;
      IF current_setting('void_test.restore_fail', true) = 'on' THEN
        RAISE EXCEPTION 'simulated restore failure';
      END IF;
      IF current_setting('void_test.restore_noop', true) = 'on' THEN
        RETURN to_jsonb(r);
      END IF;
      IF r.status = 'committed' THEN
        IF current_setting('void_test.restore_no_credit', true) IS DISTINCT FROM 'on' THEN
          UPDATE customers SET points_balance = CASE
            WHEN current_setting('void_test.restore_stale', true) = 'on'
              THEN 100 + r.points_reserved ELSE points_balance + r.points_reserved END,
            updated_at = clock_timestamp() WHERE id = r.customer_id;
        END IF;
        UPDATE pos_redemption_reservations SET status = 'reversed',
          updated_at = clock_timestamp() WHERE id = r.id RETURNING * INTO r;
      END IF;
      RETURN to_jsonb(r);
    END $$;
  `);
}

async function testSuite(kind, customerKind = kind) {
  const db = new PGlite();
  await schema(db, kind, true, customerKind);
  await db.exec(migration);
  const ids = Object.fromEntries(['tx', 'integration', 'business', 'customer', 'branch', 'reservation', 'other'].map((key, i) => [key, identity(['business', 'customer', 'branch'].includes(key) ? customerKind : kind, i + 1)]));
  async function reset({ balance = 100, points = 10, redemption = false, reservationStatus = 'committed', status = 'loyalty_applied' } = {}) {
    await db.exec(`TRUNCATE pos_transactions, customers, pos_redemption_reservations,
      points_events, storehub_void_sync_leases RESTART IDENTITY;
      SELECT set_config('void_test.restore_fail', 'off', false),
        set_config('void_test.restore_noop', 'off', false),
        set_config('void_test.restore_no_credit', 'off', false),
        set_config('void_test.restore_stale', 'off', false),
        set_config('void_test.status_fail', 'off', false),
        set_config('void_test.audit_fail', 'off', false);`);
    await db.query('INSERT INTO customers VALUES ($1, $2, $3, now())', [ids.customer, ids.business, balance]);
    const metadata = { keep: 'original-metadata' };
    if (redemption) metadata.loyalty_result = { redemption_reservation_id: ids.reservation, points_redeemed: 50 };
    await db.query(`INSERT INTO pos_transactions(id, integration_id, business_id,
      customer_id, branch_id, provider, status, external_transaction_id, points_earned,
      points_redeemed, gross_amount, processing_metadata, updated_at)
      VALUES ($1,$2,$3,$4,$5,'storehub',$6,'receipt-1',$7,$8,100,$9,now())`,
      [ids.tx, ids.integration, ids.business, ids.customer, ids.branch, status, points, redemption ? 50 : 0, JSON.stringify(metadata)]);
    if (redemption) await db.query(`INSERT INTO pos_redemption_reservations(
      id,integration_id,business_id,customer_id,status,points_reserved,updated_at,
      external_transaction_id,branch_id,provider)
      VALUES ($1,$2,$3,$4,$5,50,now(),'receipt-1',$6,'storehub')`,
      [ids.reservation, ids.integration, ids.business, ids.customer, reservationStatus, ids.branch]);
  }
  async function reverse(integration = ids.integration) {
    return (await db.query('SELECT public.pos_reverse_storehub_void($1,$2) AS result', [ids.tx, integration])).rows[0].result;
  }
  async function state() {
    return {
      balance: (await db.query('SELECT points_balance FROM customers')).rows[0].points_balance,
      tx: (await db.query('SELECT * FROM pos_transactions')).rows[0],
      audits: (await db.query('SELECT * FROM points_events')).rows,
      reservations: (await db.query('SELECT * FROM pos_redemption_reservations')).rows,
    };
  }
  async function caseTest(name, fn) {
    await fn(); passed++; process.stdout.write(`PASS ${kind}/customer-${customerKind}: ${name}\n`);
  }
  async function setFault(key, value = 'on') {
    await db.query('SELECT set_config($1,$2,false)', [`void_test.${key}`, value]);
  }
  async function unchanged() {
    const s = await state();
    assert.equal(s.balance, 100); assert.equal(s.tx.status, 'loyalty_applied');
    assert.equal(s.audits.length, 0);
    if (s.reservations.length) assert.equal(s.reservations[0].status, 'committed');
  }

  await caseTest('atomic reversal and repeated lost-response retry', async () => {
    await reset(); const first = await reverse(); const second = await reverse();
    assert.equal(first.changed, true); assert.equal(second.changed, false);
    assert.equal(String(first.customer_id), ids.customer); assert.equal(String(first.business_id), ids.business);
    assert.equal(first.transaction.processing_metadata.void_wallet_sync_pending, true);
    assert.equal(second.transaction.processing_metadata.void_wallet_sync_pending, true);
    assert.equal(second.transaction.processing_metadata.keep, 'original-metadata');
    const s = await state(); assert.equal(s.balance, 90); assert.equal(s.audits.length, 1);
    assert.equal(s.audits[0].points_earned, -10); assert.equal(Number(s.audits[0].amount_spent_pesos), -100);
  });
  await caseTest('nonnegative earnings clawback', async () => {
    await reset({ balance: 5 }); await reverse(); assert.equal((await state()).balance, 0);
  });
  await caseTest('committed redemption restored once alongside earnings', async () => {
    await reset({ redemption: true }); await reverse(); await reverse(); const s = await state();
    assert.equal(s.balance, 140); assert.equal(s.reservations[0].status, 'reversed');
    assert.equal(s.tx.processing_metadata.redemption_reversed, true); assert.equal(s.audits.length, 1);
  });
  await caseTest('low-balance clamp happens before full redemption restoration', async () => {
    await reset({ balance: 5, redemption: true }); await reverse(); assert.equal((await state()).balance, 50);
  });
  await caseTest('previously manually reversed redemption is not credited again', async () => {
    await reset({ balance: 150, redemption: true, reservationStatus: 'reversed' });
    await reverse(); assert.equal((await state()).balance, 140);
  });
  await caseTest('restore failure rolls back every mutation and supports retry', async () => {
    await reset({ redemption: true }); await setFault('restore_fail');
    await assert.rejects(reverse(), /simulated restore failure/); await unchanged();
    await setFault('restore_fail', 'off'); await reverse(); assert.equal((await state()).balance, 140);
  });
  await caseTest('restore RPC returning unchanged reservation fails safely', async () => {
    await reset({ redemption: true }); await setFault('restore_noop');
    await assert.rejects(reverse(), /did not restore/); await unchanged();
  });
  await caseTest('restore RPC marking reversed without credit rolls back', async () => {
    await reset({ redemption: true }); await setFault('restore_no_credit');
    await assert.rejects(reverse(), /expected customer balance/); await unchanged();
  });
  await caseTest('restore RPC writing stale pre-clawback balance rolls back', async () => {
    await reset({ redemption: true }); await setFault('restore_stale');
    await assert.rejects(reverse(), /expected customer balance/); await unchanged();
  });
  await caseTest('final status failure rolls back earned and restored points', async () => {
    await reset({ redemption: true }); await setFault('status_fail');
    await assert.rejects(reverse(), /simulated status failure/); await unchanged();
    await setFault('status_fail', 'off'); await reverse(); assert.equal((await state()).balance, 140);
  });
  await caseTest('audit failure rolls back balances, reservation and status', async () => {
    await reset({ redemption: true }); await setFault('audit_fail');
    await assert.rejects(reverse(), /simulated audit failure/); await unchanged();
  });
  await caseTest('missing reservation link refuses redeemed-points reversal', async () => {
    await reset(); await db.exec('UPDATE pos_transactions SET points_redeemed = 50');
    await assert.rejects(reverse(), /no reservation link/); await unchanged();
  });
  await caseTest('default zero transaction points cannot hide metadata redemption without link', async () => {
    await reset();
    await db.exec(`UPDATE pos_transactions SET points_redeemed=0,
      processing_metadata=jsonb_build_object('loyalty_result',jsonb_build_object('points_redeemed',10))`);
    await assert.rejects(reverse(), /no reservation link/); await unchanged();
  });
  await caseTest('missing linked reservation refuses reversal', async () => {
    await reset({ redemption: true }); await db.exec('DELETE FROM pos_redemption_reservations');
    await assert.rejects(reverse(), /reservation not found/); await unchanged();
  });
  for (const field of ['customer_id', 'business_id', 'integration_id']) {
    await caseTest(`reservation ${field} mismatch cannot change points`, async () => {
      await reset({ redemption: true }); await db.query(`UPDATE pos_redemption_reservations SET ${field}=$1`, [identity(field === 'integration_id' ? kind : customerKind, 7)]);
      await assert.rejects(reverse(), /does not belong/); await unchanged();
    });
  }
  await caseTest('same-member reservation bound to another receipt cannot be restored', async () => {
    await reset({ redemption: true }); await db.exec("UPDATE pos_redemption_reservations SET external_transaction_id='another-receipt'");
    await assert.rejects(reverse(), /another receipt/); await unchanged();
  });
  await caseTest('reservation from another branch cannot be restored', async () => {
    await reset({ redemption: true }); await db.query('UPDATE pos_redemption_reservations SET branch_id=$1', [identity(customerKind, 7)]);
    await assert.rejects(reverse(), /another branch/); await unchanged();
  });
  await caseTest('reservation from another provider cannot be restored', async () => {
    await reset({ redemption: true }); await db.exec("UPDATE pos_redemption_reservations SET provider='loyverse'");
    await assert.rejects(reverse(), /another POS provider/); await unchanged();
  });
  await caseTest('optional unpopulated reservation bindings remain compatible', async () => {
    await reset({ redemption: true }); await db.exec('UPDATE pos_redemption_reservations SET external_transaction_id=NULL,branch_id=NULL,provider=NULL');
    await reverse(); assert.equal((await state()).balance, 140);
  });
  await caseTest('noncommitted reservation status refuses reversal', async () => {
    await reset({ redemption: true, reservationStatus: 'reserved' });
    await assert.rejects(reverse(), /not committed/);
    const s = await state(); assert.equal(s.balance, 100); assert.equal(s.tx.status, 'loyalty_applied'); assert.equal(s.audits.length, 0);
  });
  await caseTest('foreign integration cannot reverse a transaction', async () => {
    await reset(); await assert.rejects(reverse(ids.other), /not found for this integration/); await unchanged();
  });
  await caseTest('other POS provider cannot use StoreHub reversal', async () => {
    await reset(); await db.exec("UPDATE pos_transactions SET provider='loyverse'");
    await assert.rejects(reverse(), /Only StoreHub/); await unchanged();
  });
  await caseTest('unapplied sale is unchanged', async () => {
    await reset({ status: 'received' }); assert.equal((await reverse()).changed, false);
    const s = await state(); assert.equal(s.balance, 100); assert.equal(s.audits.length, 0);
  });
  await caseTest('zero-earned sale still restores committed redemption', async () => {
    await reset({ points: 0, redemption: true }); await reverse(); const s = await state();
    assert.equal(s.balance, 150); assert.equal(s.audits.length, 0); assert.equal(s.tx.status, 'voided');
  });
  await caseTest('missing reversal RPC fails and rolls back despite preinstalled migration', async () => {
    await reset({ redemption: true }); await db.exec(`ALTER FUNCTION pos_reverse_points_redemption(${kind},text) RENAME TO hidden_test_reverse_rpc`);
    await assert.rejects(reverse(), /RPC is missing/); await unchanged();
    await db.exec(`ALTER FUNCTION hidden_test_reverse_rpc(${kind},text) RENAME TO pos_reverse_points_redemption`);
  });
  await caseTest('per-scope lease claims at most once per minute', async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 8 }, () => db.query("SELECT pos_claim_storehub_void_sync('integration:branch') AS claimed")));
    assert.equal(results.filter(r => r.rows[0].claimed).length, 1);
    assert.equal((await db.query("SELECT pos_claim_storehub_void_sync('integration:other-branch') AS claimed")).rows[0].claimed, true);
    await db.exec("UPDATE storehub_void_sync_leases SET claimed_at = clock_timestamp() - interval '61 seconds'");
    assert.equal((await db.query("SELECT pos_claim_storehub_void_sync('integration:branch') AS claimed")).rows[0].claimed, true);
  });
  await caseTest('lease rejects aggressive or invalid polling', async () => {
    for (const value of [0, 1, 59, null]) await assert.rejects(db.query("SELECT pos_claim_storehub_void_sync('scope',$1)", [value]), /at least 60/);
    for (const scope of ['', ' ', null, 'a'.repeat(301)]) await assert.rejects(db.query('SELECT pos_claim_storehub_void_sync($1)', [scope]), /valid StoreHub/);
  });
  await caseTest('public and authenticated roles cannot execute either RPC', async () => {
    const result = await db.query(`SELECT
      has_function_privilege('anon','public.pos_reverse_storehub_void(text,text)','EXECUTE') AS anon_reverse,
      has_function_privilege('authenticated','public.pos_reverse_storehub_void(text,text)','EXECUTE') AS user_reverse,
      has_function_privilege('anon','public.pos_claim_storehub_void_sync(text,integer)','EXECUTE') AS anon_lease,
      has_function_privilege('service_role','public.pos_reverse_storehub_void(text,text)','EXECUTE') AS service_reverse,
      has_function_privilege('service_role','public.pos_claim_storehub_void_sync(text,integer)','EXECUTE') AS service_lease`);
    assert.deepEqual(result.rows[0], { anon_reverse: false, user_reverse: false, anon_lease: false, service_reverse: true, service_lease: true });
  });
  await caseTest('migration can be reapplied without altering balances', async () => {
    await reset(); await db.exec(migration); await unchanged();
  });
  await caseTest('installed reversal RPC with reversed argument order is supported', async () => {
    await reset({ redemption: true });
    await db.exec(`ALTER FUNCTION pos_reverse_points_redemption(${kind},text) RENAME TO hidden_test_reverse_rpc;
      CREATE FUNCTION pos_reverse_points_redemption(p_reason text,p_reservation_id ${kind})
      RETURNS jsonb LANGUAGE SQL AS $$ SELECT hidden_test_reverse_rpc(p_reservation_id,p_reason) $$;`);
    await db.exec(migration); await reverse(); assert.equal((await state()).balance, 140);
    await db.exec(`DROP FUNCTION pos_reverse_points_redemption(text,${kind});
      ALTER FUNCTION hidden_test_reverse_rpc(${kind},text) RENAME TO pos_reverse_points_redemption;`);
  });
  await caseTest('installed reversal RPC with additional default argument is supported', async () => {
    await reset({ redemption: true });
    await db.exec(`ALTER FUNCTION pos_reverse_points_redemption(${kind},text) RENAME TO hidden_test_reverse_rpc;
      CREATE FUNCTION pos_reverse_points_redemption(p_reason text,p_reservation_id ${kind},p_extra boolean DEFAULT false)
      RETURNS jsonb LANGUAGE SQL AS $$ SELECT hidden_test_reverse_rpc(p_reservation_id,p_reason) $$;`);
    await db.exec(migration); await reverse(); assert.equal((await state()).balance, 140);
    await db.exec(`DROP FUNCTION pos_reverse_points_redemption(text,${kind},boolean);
      ALTER FUNCTION hidden_test_reverse_rpc(${kind},text) RENAME TO pos_reverse_points_redemption;`);
  });
  await db.close();
}

await testSuite('bigint');
await testSuite('uuid');
await testSuite('uuid', 'bigint');

const missing = new PGlite();
await schema(missing, 'bigint', false);
await assert.rejects(missing.exec(migration), /Existing public.pos_reverse_points_redemption/);
passed++;
await missing.exec('ROLLBACK');
assert.equal((await missing.query("SELECT to_regclass('public.storehub_void_sync_leases') AS table_name")).rows[0].table_name, null);
await missing.close();
const missingQueue = new PGlite();
await schema(missingQueue, 'bigint');
await missingQueue.exec('DROP TABLE wallet_sync_jobs');
await assert.rejects(missingQueue.exec(migration), /wallet_sync_jobs/);
passed++;
await missingQueue.exec('ROLLBACK');
await missingQueue.close();
process.stdout.write(`\n${passed} PostgreSQL/PGlite regression cases passed.\n`);
process.stdout.write('PGlite uses one PostgreSQL session; these tests verify retry atomicity and lease conflict behavior, not a real multi-session contention benchmark.\n');

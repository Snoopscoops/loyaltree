// Release integration/order checks only; component suites exercise every path.
// Disposable single-session PostgreSQL engine. No production/provider access.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const root = process.argv[3]
const sql = name => fs.readFile(`${root}/${name}`, 'utf8')
const bundle = await sql('system_followups_5_9.sql')

async function fixture() {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE businesses(id bigint PRIMARY KEY,public_id text,name text,logo_url text);
   INSERT INTO businesses VALUES(10,'cafe-a','Cafe A',NULL),(20,'cafe-b','Cafe B',NULL);
   CREATE TABLE customers(id bigint PRIMARY KEY,public_id text UNIQUE,business_id bigint,email text,phone text,
    points_balance integer DEFAULT 99,stamp_count integer DEFAULT 4,updated_at timestamptz DEFAULT now());
   INSERT INTO customers(id,public_id,business_id,email,phone) VALUES
    (1,'card-a',10,'same@example.invalid','09171234567'),(2,'card-b',20,'same@example.invalid','09181234567');
   CREATE TABLE wallet_sync_jobs(id bigint PRIMARY KEY,business_id integer,customer_id integer,reason text,status text,
    attempts integer,next_attempt_at timestamptz,created_at timestamptz,started_at timestamptz,updated_at timestamptz);
   INSERT INTO wallet_sync_jobs VALUES(9,10,1,'lt_benefits','processing',1,now()-interval '1 day',
    now()-interval '1 day',now()-interval '1 day',now()-interval '1 day');`)
  for (const name of ['lt_benefits.sql', 'lt_benefits_upgrade.sql', 'lt_benefits_visible_updates.sql']) await db.exec(await sql(name))
  await db.exec('UPDATE customers SET lt_benefits_card_enabled=true')
  return db
}
const db = await fixture()
const rpc = async (fn, action, data = {}) => (await db.query(`SELECT ${fn}($1,$2) result`, [action, JSON.stringify(data)])).rows[0].result
const command = (action, data) => rpc('ltb_command', action, data)
const context = (publicId, id, business, phone) => ({ customer_public_id: publicId, customer_id: String(id), business_id: String(business), business_slug: `cafe-${business}`, business_name: `Cafe ${business}`, phone_key: phone })
await command('settings_update', { enabled: true })
await command('provision', { email: 'same@example.invalid', phone_key: '639171234567', card_context: context('card-a', 1, 10, '639171234567') })
await command('provision', { email: 'same@example.invalid', phone_key: '639181234567', card_context: context('card-b', 2, 20, '639181234567') })
for (const [card, business, amount] of [['card-a', 10, 250000], ['card-b', 20, 100000]]) {
  const result = await command('earn', { customer_public_id: card, business_id: String(business), source_type: 'receipt', source_id: `sale-${card}`, amount_centavos: amount, currency: 'PHP' })
  assert.equal(result.points_earned, business === 10 ? 5 : 2)
}
const before = (await db.query('SELECT balance_points FROM ltb_members ORDER BY balance_points')).rows
await db.exec(bundle); await db.exec(bundle)
assert.deepEqual((await db.query('SELECT balance_points FROM ltb_members ORDER BY balance_points')).rows, before, 'SQL never silently merges existing accounts')
assert.equal((await db.query('SELECT count(*) n FROM ltb_email_identities')).rows[0].n, 0)
assert.equal((await db.query('SELECT count(*) n FROM apple_push_deliveries')).rows[0].n, 0, 'SQL never sends/enqueues pushes')
assert.equal((await db.query('SELECT status FROM wallet_sync_jobs WHERE id=9')).rows[0].status, 'processing', 'migration alone does not replay work')

const challenge = '10000000-0000-4000-8000-000000000001'
assert.equal((await command('auth_request', { id: challenge, email: 'same@example.invalid', code_hash: 'synthetic-code-hash', client_hash: 'synthetic-client', card_context: { kind: 'email' } })).accepted, true)
const verified = await command('auth_verify', { id: challenge, code_hash: 'synthetic-code-hash', token_hash: 'synthetic-session-hash' })
assert(verified.member_id)
assert.deepEqual((await db.query('SELECT lt_points_balance FROM customers ORDER BY id')).rows.map(x => Number(x.lt_points_balance)), [7, 7])
assert((await db.query('SELECT points_balance,stamp_count FROM customers')).rows.every(x => x.points_balance === 99 && x.stamp_count === 4))

const offer = await command('offer_save', { business_id: '10', business_slug: 'cafe-a', business_name: 'Cafe A', offer: {
 title: 'Integrated coupon', discount_centavos: 2000, min_spend_centavos: 15050, points_cost: 1,
 total_quantity: 5, per_member_limit: 5, weekly_limit: 1, status: 'active',
} })
assert.equal(offer.weekly_limit, 1)
const request = { member_id: verified.member_id, offer_id: offer.id, key: 'integrated-claim', request_hash: 'same-integrated-offer' }
const claimed = await command('claim', request)
assert.equal(claimed.coupon.min_spend_centavos, 15050)
assert.equal(claimed.balance_points, 6)
assert.equal((await command('claim', { ...request, key: 'second-claim' })).error, 'weekly_limit', 'identity dispatcher preserves coupon enforcement')
const replay = await command('claim', request)
assert.equal(replay.idempotent_replay, true); assert.equal(replay.coupon.id, claimed.coupon.id)
assert.equal(replay.balance_points, 6)
assert.equal((await db.query('SELECT count(*) n FROM ltb_coupons')).rows[0].n, 1)
assert.deepEqual((await db.query('SELECT lt_points_balance FROM customers ORDER BY id')).rows.map(x => Number(x.lt_points_balance)), [6, 6])
await command('offer_save', { business_id: '10', offer_id: offer.id, offer: { min_spend_centavos: 20000 } })
assert.equal((await command('claim', request)).coupon.min_spend_centavos, 15050, 'edits preserve issued snapshots')

const push = (action, data) => rpc('apple_push_delivery_command', action, data)
const enqueue = business => push('enqueue', { business_id: String(business), business_slug: `cafe-${business}`, pass_type_identifier: 'pass.synthetic', tokens: ['synthetic-shared-device'], reason: 'announcement' })
const first = await enqueue(10); await enqueue(20)
const jobs = (await push('claim', { ids: first.jobs.map(x => x.id), limit: 20 })).jobs
assert.equal(jobs.length, 1); assert.equal(jobs[0].business_id, '10')
await push('finish', { outcomes: jobs.map(j => ({ id: j.id, lease: j.lease, revision: j.revision, outcome: 'accepted', status: 200 })) })
assert.equal((await db.query("SELECT status FROM apple_push_deliveries WHERE business_id='20'")).rows[0].status, 'pending', 'one business cannot acknowledge another business push')
const recovered = await rpc('wallet_sync_queue_command', 'claim', { limit: 10 })
assert.equal(recovered.jobs.length, 1); assert.equal(Number(recovered.jobs[0].id), 9)
assert.equal(recovered.jobs[0].recovered_from_lease, true)

for (const fn of ['apple_push_delivery_command(text,jsonb)', 'wallet_sync_queue_command(text,jsonb)', 'ltb_identity_command(text,jsonb)', 'ltb_command(text,jsonb)']) {
  for (const role of ['anon', 'authenticated']) assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok', [role, fn])).rows[0].ok, false)
  assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') ok", [fn])).rows[0].ok, true)
}
await db.exec('SET ROLE service_role')
assert.equal((await rpc('ltb_identity_command', 'settings')).enabled, true)
await push('claim', { ids: [], limit: 1 })
await db.exec('RESET ROLE')
await db.close()

// Force a failure in the LAST source migration. Earlier APNs schema and coupon
// changes must also disappear; nested source COMMITs would fail this assertion.
const failed = await fixture()
await failed.exec('DROP FUNCTION ltb_link_card(uuid,jsonb); ALTER TABLE ltb_offers DROP COLUMN weekly_limit; DROP INDEX ltb_coupons_offer_week_idx')
await assert.rejects(failed.exec(bundle), /ltb_link_card/)
await failed.exec('ROLLBACK')
assert.equal((await failed.query("SELECT to_regclass('public.apple_push_deliveries') value")).rows[0].value, null)
assert.equal((await failed.query("SELECT to_regclass('public.ltb_email_identities') value")).rows[0].value, null)
assert.equal((await failed.query("SELECT count(*) n FROM information_schema.columns WHERE table_name='ltb_offers' AND column_name='weekly_limit'")).rows[0].n, 0)
assert.equal((await failed.query("SELECT count(*) n FROM information_schema.columns WHERE table_name='wallet_sync_jobs' AND column_name='lease_token'")).rows[0].n, 0)
assert.equal((await failed.query('SELECT count(*) n FROM customers')).rows[0].n, 2)
await failed.close()
console.log('Atomic follow-ups bundle SQL passed: reruns, identity/coupon/APNs coexistence, permissions and late-failure rollback')

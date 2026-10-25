// Disposable PostgreSQL engine checks; never contacts Supabase or Cloudinary.
// PGlite serializes sessions: this is not a real multi-session lock benchmark.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const base = await fs.readFile(process.argv[3], 'utf8')
const addon = await fs.readFile(process.argv[4], 'utf8')
const fresh = new PGlite()
const bootstrap = async db => db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE customers(id bigint PRIMARY KEY,public_id text UNIQUE,business_id bigint,email text,phone text,
 points_balance integer DEFAULT 0,stamp_count integer DEFAULT 0,updated_at timestamptz DEFAULT now());`)
await bootstrap(fresh)
await fresh.exec(base)
const definition = async db => (await db.query("SELECT pg_get_functiondef('public.ltb_command(text,jsonb)'::regprocedure) source")).rows[0].source
const expected = await definition(fresh)
await fresh.exec(addon)
await fresh.exec(addon)
assert.equal(await definition(fresh), expected, 'Fresh and addon dispatcher definitions must agree')

// Recreate the preceding release's four coupon fragments, leaving every other
// block intact. The addon must preserve an unrelated identity migration marker.
const updates = [...addon.matchAll(/\$(old|new)\$([\s\S]*?)\$\1\$/g)]
const old = updates.filter(x => x[1] === 'old').map(x => x[2])
const newer = updates.filter(x => x[1] === 'new').map(x => x[2])
assert.equal(old.length, 4); assert.equal(newer.length, 4)
let legacy = expected
for (let i = 0; i < newer.length; i++) {
  assert.equal(legacy.split(newer[i]).length, 2, `Expected one fresh fragment ${i}`)
  legacy = legacy.replace(newer[i], old[i])
}
legacy = legacy.replace('BEGIN\n', 'BEGIN\n -- unrelated identity patch retained\n')
await fresh.exec(legacy)
await fresh.exec('ALTER TABLE ltb_offers DROP COLUMN weekly_limit; DROP INDEX ltb_coupons_offer_week_idx;')
await fresh.exec(addon)
await fresh.exec(addon)
assert.equal((await definition(fresh)).replace(' -- unrelated identity patch retained\n', ''), expected)
assert.equal((await fresh.query("SELECT has_function_privilege('anon','ltb_command(text,jsonb)','EXECUTE') allowed")).rows[0].allowed, false)
assert.equal((await fresh.query("SELECT has_function_privilege('service_role','ltb_command(text,jsonb)','EXECUTE') allowed")).rows[0].allowed, true)

const command = async (action, data = {}) => (await fresh.query('SELECT ltb_command($1,$2) result', [action, JSON.stringify(data)])).rows[0].result
const members = (await fresh.query(`INSERT INTO ltb_members(email,balance_points)
 SELECT 'member-'||i||'@example.invalid',100 FROM generate_series(1,8) i RETURNING id`)).rows.map(x => x.id)
await command('settings_update', { enabled: true })
const offer = await command('offer_save', { business_id: '10', business_slug: 'cafe', business_name: 'Cafe', offer: {
 title: 'Weekly coupon', discount_centavos: 500, min_spend_centavos: 15050, points_cost: 1,
 total_quantity: 100, per_member_limit: 100, weekly_limit: 2, status: 'active', coupon_valid_days: 30,
 image_url: 'https://res.cloudinary.com/sample/image/upload/coupon.png',
} })
assert.equal(offer.weekly_limit, 2)
assert.equal(offer.min_spend_centavos, 15050)
const claim = i => ({ member_id: members[i % members.length], offer_id: offer.id, key: `claim-${i}`, request_hash: `offer-${offer.id}` })
const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => command('claim', claim(i))))
assert.equal(claims.filter(x => x.coupon).length, 2)
assert.equal(claims.filter(x => x.error === 'weekly_limit').length, 10)
const first = claims.findIndex(x => x.coupon)
const denied = claims.findIndex(x => x.error === 'weekly_limit')
const coupon = claims[first].coupon
const replay = await command('claim', claim(first))
assert.equal(replay.idempotent_replay, true)
assert.equal(replay.coupon.id, coupon.id)
assert.equal((await command('claim', { ...claim(first), request_hash: 'different-offer' })).error, 'idempotency_conflict')
assert.equal((await fresh.query('SELECT count(*) n FROM ltb_coupons')).rows[0].n, 2)
assert.equal(Number((await fresh.query('SELECT sum(100-balance_points) n FROM ltb_members')).rows[0].n), 2)
assert.equal((await fresh.query('SELECT count(*) n FROM ltb_ledger')).rows[0].n, 2)

// Used/expired coupons still consume this week's slot, preventing cap bypass.
await fresh.query("UPDATE ltb_coupons SET status='used',used_at=now() WHERE id=$1", [coupon.id])
await fresh.query("UPDATE ltb_coupons SET expires_at=now()-interval '1 second' WHERE id<>$1", [coupon.id])
assert.equal((await command('claim', claim(denied))).error, 'weekly_limit')
// Absolute Monday midnight is Sunday 16:00 UTC, independent of DB timezone.
const boundary = "date_trunc('week',timestamptz '2026-10-25 16:00:00+00' AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'"
const sunday = "date_trunc('week',timestamptz '2026-10-25 15:59:59+00' AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'"
assert.equal((await fresh.query(`SELECT ${boundary}=timestamptz '2026-10-25 16:00:00+00' ok, ${sunday}=timestamptz '2026-10-18 16:00:00+00' prior`)).rows[0].ok, true)
assert.equal((await fresh.query(`SELECT ${sunday}=timestamptz '2026-10-18 16:00:00+00' ok`)).rows[0].ok, true)
await fresh.exec("SET TIME ZONE 'America/Los_Angeles'")
assert.equal((await command('claim', claim(denied))).error, 'weekly_limit')
await fresh.exec("UPDATE ltb_coupons SET claimed_at=(date_trunc('week',now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')-interval '1 microsecond'")
assert((await command('claim', claim(denied))).coupon, 'Denied keys can be retried after a weekly reset')

// Edits change future claims only. Pausing/clearing the cap leaves saved
// coupon minimums and image URLs intact and does not reset lifetime stock.
const changed = await command('offer_save', { business_id: '10', offer_id: offer.id, offer: { weekly_limit: 1, min_spend_centavos: 20000, image_url: null } })
assert.equal(changed.weekly_limit, 1)
assert.equal((await command('claim', claim(20))).error, 'weekly_limit')
const unlimited = await command('offer_save', { business_id: '10', offer_id: offer.id, offer: { weekly_limit: null } })
assert.equal(unlimited.weekly_limit, null)
const next = await command('claim', claim(21))
assert.equal(next.coupon.min_spend_centavos, 20000)
assert.equal(next.coupon.image_url, null)
const saved = (await fresh.query('SELECT snapshot FROM ltb_coupons WHERE id=$1', [coupon.id])).rows[0].snapshot
assert.equal(saved.min_spend_centavos, 15050)
assert.equal(saved.image_url, offer.image_url)
assert.equal((await command('claim', claim(first))).coupon.id, coupon.id, 'Replay survives offer edits and week changes')
assert.equal((await fresh.query('SELECT claimed_count FROM ltb_offers WHERE id=$1', [offer.id])).rows[0].claimed_count, 4)
await assert.rejects(fresh.query('UPDATE ltb_offers SET weekly_limit=0 WHERE id=$1', [offer.id]), /weekly_limit_check/)

// Unknown old dispatcher versions roll back the entire addon (including its
// column addition) instead of partially applying a cap that is never enforced.
await fresh.exec(legacy.replace(old[0], old[0].replace('total_quantity=', 'total_quantity =')))
await fresh.exec('ALTER TABLE ltb_offers DROP COLUMN weekly_limit')
await assert.rejects(fresh.exec(addon), /Unknown LT Benefits coupon dispatcher version/)
await fresh.exec('ROLLBACK')
assert.equal((await fresh.query("SELECT count(*) n FROM information_schema.columns WHERE table_name='ltb_offers' AND column_name='weekly_limit'")).rows[0].n, 0)
await fresh.close()
console.log('Coupon SQL checks passed (single-session PostgreSQL engine; not a multi-session contention benchmark)')

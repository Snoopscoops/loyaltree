import test from 'node:test'
import assert from 'node:assert/strict'
import { BENEFITS_SESSION_KEY, benefitMoney, readBenefitsEntry, saveBenefitsEntry, benefitsCardReference, benefitsClaimKey, benefitsClaimState, benefitsDemoAllowed, benefitsEntryUrl, benefitsFailure, clearBenefitsClaimKey, clearBenefitsSession, filterBenefitsOffers, readBenefitsSession, safeBenefitsImage, saveBenefitsSession, scrubBenefitsReference, validBenefitsClaim, validBenefitsConfig, validBenefitsMe, validBenefitsOffers } from '../src/components/benefitsModel.js'
import { createBenefitsDemo } from '../dev/loyalty-benefits-fixtures.js'

const memoryStorage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) } }
const fixture = search => createBenefitsDemo({ development: true, hostname: 'localhost', search: search || '?demo=1', latency: 0 })
const json = async response => response.json()
const send = (api, path, body, headers = {}) => api(path, { method: 'POST', body: JSON.stringify(body), headers })
const authenticate = async api => { const challenge = await json(await send(api, '/auth/request-code', { customer_public_id: 'demo-northstar-card', card_token:'local-demo-card-proof', consent: true })); return json(await send(api, '/auth/verify', { challenge_id: challenge.challenge_id, code: '123456' })) }

test('the fictional demo cannot run on a production hostname, without DEV, or without explicit query opt-in', () => {
  assert.equal(benefitsDemoAllowed({ development: true, hostname: 'localhost', search: '?demo=1' }), true)
  assert.equal(benefitsDemoAllowed({ development: true, hostname: '127.0.0.1', search: '?demo=1' }), true)
  for (const options of [{ development: false, hostname: 'localhost', search: '?demo=1' }, { development: true, hostname: 'theloyaltytree.com', search: '?demo=1' }, { development: true, hostname: 'localhost.evil.test', search: '?demo=1' }, { development: true, hostname: 'localhost', search: '' }]) {
    assert.equal(benefitsDemoAllowed(options), false)
    assert.throws(() => createBenefitsDemo(options), /only in local development/)
  }
})

test('Wallet references require both signed parts and are removed without losing unrelated URL state', () => {
  assert.deepEqual(benefitsCardReference('?card=card_123&token=0123456789abcdef'), { customer_public_id: 'card_123', card_token: '0123456789abcdef' })
  for (const query of ['?card=card_123', '?token=0123456789abcdef', '?card=../other&token=0123456789abcdef', '?card=card&token=short']) assert.equal(benefitsCardReference(query), null)
  assert.equal(scrubBenefitsReference('https://theloyaltytree.com/benefits?card=card_123&token=secret&demo=1#cards'), '/benefits?demo=1#cards')
})

test('Benefits sessions are isolated, expiring and cleared without reading or removing the owner account token', () => {
  const storage = memoryStorage()
  storage.setItem('token', 'owner-token-untouched')
  saveBenefitsSession(storage, 'benefits-only-token', 30, 1000)
  assert.equal(readBenefitsSession(storage, 2000).token, 'benefits-only-token')
  assert.equal(readBenefitsSession(storage, 31000), null)
  clearBenefitsSession(storage)
  assert.equal(storage.getItem('token'), 'owner-token-untouched')
  assert.equal(storage.getItem(BENEFITS_SESSION_KEY), null)
  storage.setItem(BENEFITS_SESSION_KEY, benefitMoney, readBenefitsEntry, saveBenefitsEntry, 'not json')
  assert.equal(readBenefitsSession(storage), null)
})

test('claim references survive retries and reloads, remain scoped to member and offer, and rotate only after completion', () => {
  const storage = memoryStorage()
  let sequence = 0
  const key = () => `key-${++sequence}`
  assert.equal(benefitsClaimKey(storage, 'person-a', 'offer-a', key), 'key-1')
  assert.equal(benefitsClaimKey(storage, 'person-a', 'offer-a', key), 'key-1')
  assert.equal(benefitsClaimKey(storage, 'person-b', 'offer-a', key), 'key-2')
  assert.equal(benefitsClaimKey(storage, 'person-a', 'offer-b', key), 'key-3')
  clearBenefitsClaimKey(storage, 'person-a', 'offer-a')
  assert.equal(benefitsClaimKey(storage, 'person-a', 'offer-a', key), 'key-4')
})

test('offer filters combine categories, merchant search and available points without changing catalog data', async () => {
  const listing = await json(await fixture()('/offers', {headers:{Authorization:'Bearer local-demo-benefits-session'}}))
  assert.equal(validBenefitsOffers(listing), true)
  const before = structuredClone(listing.offers)
  assert.equal(filterBenefitsOffers(listing.offers, { category: 'wellness' }).length, 1)
  assert.equal(filterBenefitsOffers(listing.offers, { search: '  NORTHSTAR  ', affordable: true, points: 40 }).length, 2)
  assert.equal(filterBenefitsOffers(listing.offers, { category: 'wellness', affordable: true, points: 40 }).length, 0)
  assert.deepEqual(listing.offers, before)
  const offer = listing.offers[0], now = Date.now()
  assert.equal(benefitsClaimState(offer, null, now), 'available')
  assert.equal(benefitsClaimState(offer, 0, now), 'insufficient')
  assert.equal(benefitsClaimState({ ...offer, remaining_quantity: 0 }, 9999, now), 'sold_out')
  assert.equal(benefitsClaimState({ ...offer, status: 'paused' }, 9999, now), 'closed')
  assert.equal(benefitsClaimState({ ...offer, ends_at: new Date(now - 1000).toISOString() }, 9999, now), 'closed')
})

test('catalog images reject executable or credential-bearing URLs and preserve safe local/HTTPS images', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', '//unknown.test/x', 'https://user:secret@example.test/a.jpg', '/\\evil.test/a.jpg']) assert.equal(safeBenefitsImage(value), '')
  assert.equal(safeBenefitsImage('/homepage-assets/nyork-counter.jpg'), '/homepage-assets/nyork-counter.jpg')
  assert.equal(safeBenefitsImage('https://images.example.test/photo.jpg'), 'https://images.example.test/photo.jpg')
})

test('join success links only open the trusted Benefits destination and never replace Wallet enrollment', () => {
  assert.equal(benefitsEntryUrl('https://theloyaltytree.com/benefits?card=id&token=signed', 'https://theloyaltytree.com'), 'https://theloyaltytree.com/benefits?card=id&token=signed')
  assert.equal(benefitsEntryUrl('/benefits?card=id&token=signed', 'http://localhost:5180'), 'http://localhost:5180/benefits?card=id&token=signed')
  for (const url of ['javascript:alert(1)', 'https://evil.test/benefits', 'https://user:secret@theloyaltytree.com/benefits', 'https://theloyaltytree.com/login']) assert.equal(benefitsEntryUrl(url, 'https://theloyaltytree.com'), '')
})

test('local demo verifies, links two cards, claims idempotently, and distinguishes claiming from cashier usage without network calls', async () => {
  const api = fixture()
  assert.equal(validBenefitsConfig(await json(await api('/config'))), true)
  assert.equal((await api('/me')).status, 401)
  const verified = await authenticate(api), headers = { Authorization: `Bearer ${verified.access_token}` }
  const before = await json(await api('/me', { headers }))
  assert.equal(validBenefitsMe(before), true)
  assert.equal(before.cards.length, 2)
  const listing = await json(await api('/offers', {headers:{Authorization:'Bearer local-demo-benefits-session'}}))
  const offer = listing.offers[0], claimHeaders = { ...headers, 'Idempotency-Key': 'stable-demo-attempt' }
  const first = await json(await send(api, `/offers/${offer.id}/claim`, {}, claimHeaders))
  assert.equal(validBenefitsClaim(first), true)
  assert.equal(first.coupon.status, 'claimed')
  assert.equal(first.available_points, before.available_points - offer.points_cost)
  const second = await json(await send(api, `/offers/${offer.id}/claim`, {}, claimHeaders))
  assert.equal(second.idempotent_replay, true)
  assert.equal(second.coupon.id, first.coupon.id)
  assert.equal(second.available_points, first.available_points)
  assert.equal((await send(api, `/__demo/use/${first.coupon.id}`, {}, headers)).status, 200)
  const after = await json(await api('/me', { headers }))
  assert.equal(after.coupons.find(coupon => coupon.id === first.coupon.id).status, 'used')
  assert.equal(after.available_points, first.available_points)
  assert.equal((await send(api, '/unexpected-live-write', {}, headers)).status, 403)
})

test('malformed account/coupon payloads and unavailable catalogs do not look like a successful empty account', async () => {
  const api = fixture(), auth = await authenticate(api)
  const account = await json(await api('/me', { headers: { Authorization: `Bearer ${auth.access_token}` } }))
  for (const value of [null, {}, { ...account, cards: [null] }, { ...account, coupons: [null] }, { ...account, available_points: -1 }]) assert.equal(validBenefitsMe(value), false)
  assert.equal(validBenefitsMe({ ...account, balance_points: -5, available_points: 0 }), true)
  assert.equal(validBenefitsClaim({ balance_points: 0, available_points: 0, coupon: null }), false)
  assert.equal((await json(await fixture('?demo=1&demo_state=empty')('/offers',{headers:{Authorization:'Bearer local-demo-benefits-session'}}))).offers.length, 0)
  assert.equal((await json(await fixture('?demo=1&demo_state=unavailable')('/config'))).available, false)
  assert.match(benefitsFailure(409, 'Insufficient balance'), /more LT Points/)
  assert.match(benefitsFailure(409, 'Stock sold out'), /sold out/)
  assert.match(benefitsFailure(409, 'Claim limit reached'), /claim limit/)
})

test('Benefits keeps exact peso values and rejects zero-value financial offers', async () => {
  assert.equal(benefitMoney(2050), '₱20.5')
  assert.equal(benefitMoney(1), '₱0.01')
  const listing=await json(await fixture()('/offers',{headers:{Authorization:'Bearer local-demo-benefits-session'}}))
  assert.equal(validBenefitsOffers({...listing,offers:[{...listing.offers[0],points_cost:0}]}),false)
  assert.equal(validBenefitsOffers({...listing,offers:[{...listing.offers[0],discount_centavos:0}]}),false)
})
test('a new tab needs a Wallet entry; it cannot use a standalone email login', async () => {
 const storage=memoryStorage();assert.equal(readBenefitsEntry(storage),null)
 const reference={customer_public_id:'card-a',card_token:'0123456789abcdef'}
 saveBenefitsEntry(storage,reference);assert.deepEqual(readBenefitsEntry(storage),reference)
 const api=fixture();assert.equal((await api('/offers')).status,401)
 assert.equal((await send(api,'/auth/request-code',{email:'hello@example.test',consent:true})).status,400)
 const entry=await json(await send(api,'/entry',reference));assert.equal(entry.verified,false)
})

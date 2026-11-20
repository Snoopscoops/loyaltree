import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readKnownCard, rememberJoinedCard, forgetKnownCard, firstName, welcomeTitle, cardProgress, sameBusiness, joinCardKey } from '../src/components/joinWelcomeModel.js'

const memory = (seed = {}) => {
  const data = { ...seed }
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) }, removeItem: k => { delete data[k] } }
}

test('no saved card means the Join option stays', () => {
  assert.equal(readKnownCard(memory(), ['cafe-1']), null)
  assert.equal(readKnownCard(null, ['cafe-1']), null)
})

test('joining on this page is remembered per business', () => {
  const store = memory()
  rememberJoinedCard(store, 'cafe-1', 'cust-9', 'Ana Cruz')
  assert.deepEqual(readKnownCard(store, ['cafe-1']), { businessId: 'cafe-1', customerId: 'cust-9', name: 'Ana Cruz', token: '' })
  assert.equal(readKnownCard(store, ['other-shop']), null)
})

test('a card connected on the digital menu also counts', () => {
  const store = memory({ 'lt-menu-card:cafe-1': 'tok', 'lt-menu-card-name:cafe-1': 'Ben Reyes' })
  assert.deepEqual(readKnownCard(store, ['slug-x', 'cafe-1']), { businessId: 'cafe-1', customerId: '', name: 'Ben Reyes', token: 'tok' })
})

test('Not you clears every saved key for this business only', () => {
  const store = memory({ 'lt-menu-card:cafe-1': 'tok', 'lt-menu-card-name:cafe-1': 'Ben', 'lt-menu-card:cafe-2': 'keep' })
  rememberJoinedCard(store, 'cafe-1', 'cust-9', 'Ana')
  forgetKnownCard(store, ['cafe-1'])
  assert.equal(readKnownCard(store, ['cafe-1']), null)
  assert.equal(store.data['lt-menu-card:cafe-2'], 'keep')
})

test('a broken saved value is ignored', () => {
  assert.equal(readKnownCard(memory({ [joinCardKey('cafe-1')]: '{bad' }), ['cafe-1']), null)
})

test('welcome copy uses the first name only', () => {
  assert.equal(firstName('  Ana Maria Cruz '), 'Ana')
  assert.equal(firstName('Loyalty card'), '')
  assert.equal(welcomeTitle('Ana Cruz'), 'Welcome back, Ana!')
  assert.equal(welcomeTitle(''), 'Welcome back!')
})

test('card progress for stamps, points and unknown cards', () => {
  const stamps = cardProgress({ current_card_type: 'stamp', customer: { stamp_count: 5 }, program: { stamp_goal: 8 } })
  assert.equal(stamps.label, '5 / 8 stamps')
  assert.equal(stamps.percent, 63)
  assert.equal(stamps.note, '3 more to your reward')
  assert.match(cardProgress({ current_card_type: 'stamp', customer: { stamp_count: 9 }, program: { stamp_rewards: [{ stamps: 6 }] } }).note, /Reward ready/)
  assert.equal(cardProgress({ current_card_type: 'points', customer: { points_balance: 1250 } }).label, '1,250 points')
  assert.equal(cardProgress({ current_card_type: 'hybrid', customer: { stamp_count: 2 }, program: { hybrid_loyalty_type: 'stamp', stamp_goal: 10 } }).label, '2 / 10 stamps')
  assert.equal(cardProgress({ current_card_type: 'membership' }), null)
  assert.equal(cardProgress(null), null)
})

test('a customer from another business is not welcomed', () => {
  assert.equal(sameBusiness({ business: { public_id: 'cafe-1' } }, ['slug', 'cafe-1']), true)
  assert.equal(sameBusiness({ business: { public_id: 'other' } }, ['cafe-1']), false)
})

test('join page wires the welcome state and keeps copy rules', () => {
  const source = readFileSync(new URL('../src/components/CustomerJoin.jsx', import.meta.url), 'utf8')
  assert.match(source, /readKnownCard\(/)
  assert.match(source, /rememberJoinedCard\(/)
  assert.match(source, /Not you\? Use another card/)
  const model = readFileSync(new URL('../src/components/joinWelcomeModel.js', import.meta.url), 'utf8')
  for (const text of [source, model]) {
    assert.equal(text.includes('\u2014'), false, 'no em-dashes')
    assert.equal(/download our app/i.test(text), false)
  }
})

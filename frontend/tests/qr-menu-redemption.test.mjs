import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutRewardIsEligible, checkoutRewardSelectionPayload } from '../src/components/qrMenuRedemption.js'

const gift = { available: true, selectable: true, id: 'latte-100', kind: 'points_prize' }
test('only server-labeled points and stamp rewards are selectable at checkout', () => {
  assert.equal(checkoutRewardIsEligible(gift), true)
  assert.equal(checkoutRewardIsEligible({ ...gift, kind: 'stamp_reward' }), true)
  assert.equal(checkoutRewardIsEligible({ ...gift, available: false }), false)
  assert.equal(checkoutRewardIsEligible({ ...gift, kind: 'coupon' }), false)
  assert.equal(checkoutRewardIsEligible({ ...gift, id: '' }), false)
})
test('mock online payment never sends a reward selection', () => {
  for (const method of ['qrph', 'card', '', null]) {
    assert.deepEqual(checkoutRewardSelectionPayload(gift, method), {})
  }
  assert.deepEqual(checkoutRewardSelectionPayload(null, 'cash'), {})
})
test('cash checkout sends only type and id, not price, points, or member details', () => {
  const payload = checkoutRewardSelectionPayload({ ...gift, points_cost: 0, name: 'Forged', customer_id: 999 }, 'cash')
  assert.deepEqual(payload, { reward_selection: { kind: 'points_prize', id: 'latte-100' } })
})

// owner-v12.1: cash reward survives final HTTP serialization. Previously
// QRMenuPage constructed reward_selection but menuOrderRequest silently dropped it.
import { menuOrderRequest, sendMenuOrder } from '../src/components/qrMenuModel.js'

const rewardOrder = {
  order_id: 'LT-TEST-REWARD', payment_reference: 'REF-TEST',
  buyer_name: 'Test Member', service: 'dine-in', payment_method: 'cash',
  branch_public_id: 'branch-1', card_token: 'test.card',
  reward_selection: { kind: 'points_prize', id: 'latte-100', name: 'Forged', points_cost: 0 },
  items: [{ name: 'Coffee', quantity: 1, line_total: 150, options: [] }],
}

test('owner-v12.1: cash reward survives final HTTP serialization', async () => {
  const body = menuOrderRequest(rewardOrder)
  assert.deepEqual(body.reward_selection, { kind: 'points_prize', id: 'latte-100' })
  assert.equal(body.card_token, 'test.card')
  assert.equal('points_cost' in body.reward_selection, false)
  assert.equal('name' in body.reward_selection, false)
  const sent = []
  const response = await sendMenuOrder({
    fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body))
      return new Response(JSON.stringify({ order: { order_number: 'LT-TEST-REWARD' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
    url: 'https://example.invalid/orders', order: rewardOrder,
  })
  assert.equal(response.ok, true)
  assert.deepEqual(sent[0].reward_selection, { kind: 'points_prize', id: 'latte-100' })
})

test('owner-v12.1: stamp cash reward sent; mock online payments and absent selection omit it', () => {
  const stamped = menuOrderRequest({ ...rewardOrder, reward_selection: { kind: 'stamp_reward', id: 'stamp-5' } })
  assert.deepEqual(stamped.reward_selection, { kind: 'stamp_reward', id: 'stamp-5' })
  for (const payment_method of ['qrph', 'card', '', 'invalid']) {
    assert.equal('reward_selection' in menuOrderRequest({ ...rewardOrder, payment_method }), false)
  }
  assert.equal('reward_selection' in menuOrderRequest({ ...rewardOrder, reward_selection: null }), false)
  assert.equal('reward_selection' in menuOrderRequest({ ...rewardOrder, reward_selection: { kind: 'coupon', id: 'x' } }), false)
})

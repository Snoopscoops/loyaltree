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

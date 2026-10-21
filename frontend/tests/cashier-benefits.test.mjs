import test from 'node:test'
import assert from 'node:assert/strict'
import { cashierAttemptKey, cashierBillAmount, cashierNewAttemptKey, cashierStampBill } from '../src/components/cashierBenefitsModel.js'

test('stamp scans and ordinary stamps never become LT purchases without an explicit positive confirmed bill', () => {
  assert.deepEqual(cashierStampBill({ enabled: true, amount: '', confirmed: true }), { payload: {} })
  assert.deepEqual(cashierStampBill({ enabled: false, amount: '500', confirmed: true }), { payload: {} })
  assert.match(cashierStampBill({ enabled: true, amount: '500', confirmed: false }).error, /Confirm the purchase/)
  assert.deepEqual(cashierStampBill({ enabled: true, amount: '500.25', confirmed: true }), { payload: { amount_spent: 500.25 } })
  for (const value of ['0', '-1', 'Infinity', '1e3', '12.345', '1000000001', 'not a bill']) assert.equal(cashierBillAmount(value), null)
  assert.equal(cashierBillAmount('1000000000.00'), 1000000000)
})

test('cashier retries retain the reference for the identical purchase, with independent references for changed customers, actions or amounts', () => {
  const attempts = {}
  let sequence = 0
  const next = () => `attempt-${++sequence}`
  const payload = { customer_public_id: 'card-a', amount_spent: 500 }
  assert.equal(cashierAttemptKey(attempts, 'points-sale', payload, next), 'attempt-1')
  assert.equal(cashierAttemptKey(attempts, 'points-sale', { ...payload }, next), 'attempt-1')
  assert.equal(cashierAttemptKey(attempts, 'vip-sale', payload, next), 'attempt-2')
  assert.equal(cashierAttemptKey(attempts, 'points-sale', { ...payload, amount_spent: 750 }, next), 'attempt-3')
  assert.equal(cashierAttemptKey(attempts, 'points-sale', { ...payload, customer_public_id: 'card-b' }, next), 'attempt-4')
  delete attempts['points-sale']
  assert.equal(cashierAttemptKey(attempts, 'points-sale', payload, next), 'attempt-5')
  assert.match(cashierNewAttemptKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
})

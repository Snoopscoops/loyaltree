import test from 'node:test'
import assert from 'node:assert/strict'
import { menuOrderPhase, fetchMenuOrderPhase, ORDER_TRACKING_STEPS } from '../src/components/qrMenuOrderTracking.js'

const order = { status: 'new', payment_method: 'cash', payment_status: 'unpaid', service: 'pickup' }
const id = 'a'.repeat(32)

test('customer sees payment first, then acceptance, preparation, done, completed', () => {
  assert.equal(menuOrderPhase(order).title, 'Waiting for payment')
  assert.equal(menuOrderPhase({ ...order, payment_status: 'paid' }).title, 'Waiting for order acceptance')
  assert.equal(menuOrderPhase({ ...order, status: 'preparing', payment_status: 'paid' }).title, 'Preparing your order')
  assert.deepEqual(menuOrderPhase({ ...order, status: 'ready', payment_status: 'paid' }),
    { stage: 2, title: 'Order done', sub: 'Your order is ready for pickup.', done: true })
  assert.equal(menuOrderPhase({ ...order, status: 'completed', payment_status: 'paid' }).title, 'Order completed')
  assert.equal(ORDER_TRACKING_STEPS.length, 3)
})

test('ready dine-in, cancelled, and test payments have accurate copy', () => {
  assert.match(menuOrderPhase({ status: 'ready', service: 'dine-in' }).sub, /table/)
  assert.equal(menuOrderPhase({ status: 'cancelled' }).cancelled, true)
  assert.equal(menuOrderPhase({ status: 'new', payment_method: 'card', payment_status: 'paid_test' }).stage, 0)
})

test('read-only fetch uses receipt public id, no name/card token, and respects status', async () => {
  let gotUrl, gotOptions
  const fetchImpl = async (url, options) => {
    gotUrl = url; gotOptions = options
    return new Response(JSON.stringify({ status: 'preparing', payment_status: 'paid', buyer_name: 'NOT PUBLIC' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const result = await fetchMenuOrderPhase({ fetchImpl, apiBase: 'https://api.example.test/', businessId: 'jus', orderId: id })
  assert.deepEqual(result, { status: 'preparing', payment_status: 'paid' })
  assert.match(gotUrl, /\/api\/v1\/public\/menu\/jus\/orders\/a{32}\/status$/)
  assert.equal(gotOptions.method, 'GET')
  assert.equal(gotOptions.cache, 'no-store')
  assert.equal(gotOptions.headers.Authorization, undefined)
})

test('a visible test order number cannot be used to enumerate status', async () => {
  let called = false
  await assert.rejects(fetchMenuOrderPhase({ fetchImpl: () => {called=true}, apiBase:'https://example.test',businessId:'jus',orderId:'LT-123' }))
  assert.equal(called, false)
})

test('tracking never fabricates state on network or invalid server response', async () => {
  for (const payload of [{status:'shipped',payment_status:'paid'}, {status:'ready',payment_status:'invalid'}, null]) {
    await assert.rejects(fetchMenuOrderPhase({ fetchImpl: async () => new Response(JSON.stringify(payload), {status:200}), apiBase:'https://example.test',businessId:'jus',orderId:id }))
  }
  await assert.rejects(fetchMenuOrderPhase({ fetchImpl: async () => new Response('{}', {status:503}), apiBase:'https://example.test',businessId:'jus',orderId:id }))
})

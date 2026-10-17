import test from 'node:test'
import assert from 'node:assert/strict'
import { overviewMetrics, customerMatchesFilter } from '../src/components/ownerCustomerMetrics.js'

test('metrics use recorded visits and never derive visits from a stamp balance', () => {
  const customers = [{ public_id: 'a', stamp_count: 99, reward_unlocked: true }]
  assert.equal(overviewMetrics(null, customers)[1].value, '—')
  const metrics = overviewMetrics({ activity_available: true, total_customer_visits: 17, return_rate: 62.5, rewards_ready: 3, total_customers: 8 }, customers)
  assert.deepEqual(metrics.map(m => m.value), [8, '17', '62.5%', 3])
})
test('customer filters use the selected scope activity and earned rewards', () => {
  const customer = { public_id: 'a', reward_unlocked: true }
  const stats = { customer_activity: { a: { segment: 'at_risk', rewards_ready: false } } }
  assert.equal(customerMatchesFilter(customer, 'all', stats), true)
  assert.equal(customerMatchesFilter(customer, 'at_risk', stats), true)
  assert.equal(customerMatchesFilter(customer, 'regulars', stats), false)
  assert.equal(customerMatchesFilter(customer, 'rewards_ready', stats), false)
  assert.equal(customerMatchesFilter(customer, 'rewards_ready', null), false)
})

test('unavailable metrics and unmatched scopes never look like confirmed zeroes', () => {
  const customers = [{ public_id: 'a', reward_unlocked: true }]
  assert.deepEqual(overviewMetrics(null, [], false).map(m => m.value), ['—', '—', '—', '—'])
  const metrics = overviewMetrics({ total_customers: null, activity_available: false, rewards_available: false }, customers)
  assert.deepEqual(metrics.map(m => m.value), [1, '—', '—', '—'])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { advancedToolFromSearch, dashboardSearchForTab, datePresetRange, filterSummary, retentionGroups, toolOverview, transactionView } from '../src/components/advancedToolsModel.js'

test('advanced tool urls survive refresh and leave other tabs alone', () => {
  assert.equal(advancedToolFromSearch('?tool=retention'), 'retention')
  assert.equal(advancedToolFromSearch('?tool=billing'), null)
  assert.equal(dashboardSearchForTab('program=abc', 'security').toString(), 'program=abc&tool=security')
  assert.equal(dashboardSearchForTab('tool=security&program=abc', 'customers').get('tool'), null)
  assert.equal(dashboardSearchForTab('tool=security&program=abc', 'customers').get('program'), 'abc')
})

test('date presets and filter summaries keep the existing fields', () => {
  assert.deepEqual(datePresetRange('today', '2026-11-07'), { date_from: '2026-11-07', date_to: '2026-11-07' })
  assert.deepEqual(datePresetRange('7', '2026-11-07'), { date_from: '2026-11-01', date_to: '2026-11-07' })
  const summary = filterSummary({ status: 'failed', branch_public_id: 'makati', staff_public_id: '', date_from: '2026-11-01', date_to: '' }, { branches: [{ public_id: 'makati', name: 'Makati' }], staff: [] })
  assert.deepEqual(summary, ['Status: failed', 'Branch: Makati', 'Dates: 2026-11-01 to any end'])
})

test('transaction states distinguish loading, errors, no records, and no matches', () => {
  assert.equal(transactionView({ loading: true, transactions: [], filters: {} }), 'loading')
  assert.equal(transactionView({ error: 'down', transactions: [], filters: {} }), 'error')
  assert.equal(transactionView({ transactions: [], filters: {} }), 'empty')
  assert.equal(transactionView({ transactions: [], filters: { status: 'failed' } }), 'no-match')
  assert.equal(transactionView({ error: 'stale', transactions: [{ id: 1 }], filters: {} }), 'results')
})

test('retention groups existing opportunities without inventing scores', () => {
  const groups = retentionGroups([
    { customer_name: 'Ana', type: 'win_back', days_inactive: 40, suggested_message: 'Come back' },
    { customer_name: 'Ben', type: 'win_back', days_inactive: 70, suggested_message: 'Come back' },
    { customer_name: 'Cia', type: 'one_away', suggested_message: 'One stamp' },
  ])
  assert.equal(groups[0].count, 2)
  assert.equal(groups[0].items[0].customer_name, 'Ben')
  assert.equal(groups[1].title, 'One stamp away')
  assert.equal(groups[1].items[0].suggested_message, 'One stamp')
})

test('overview uses only loaded counts and does not hide an error', () => {
  const cards = toolOverview({ securityLoaded: true, alerts: 0, growthLoaded: false, toolErrors: { wallet: 'Queue unavailable' } })
  assert.equal(cards.find(card => card.id === 'security').state, 'No alerts in the last 24 hours')
  assert.equal(cards.find(card => card.id === 'walletqueue').state, 'Queue unavailable')
  assert.equal(cards.find(card => card.id === 'crm').state, 'Not checked yet')
})

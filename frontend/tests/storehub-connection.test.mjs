import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/components/POSIntegration.jsx', import.meta.url), 'utf8')
const start = source.indexOf('  const integrationStatus =')
const end = source.indexOf('  const providerLabel =', start)
assert(start >= 0 && end > start)
const resolve = new Function('storeHubConnection', 'storeHubRealResult', 'integration', 'provider', 'slug', 'loyverseConnection',
  source.slice(start, end) + `
  return { storeHubAccountLinked, storeHubTransactionsVerified, storeHubTransactionLabel,
    isConnected, simulatorReady, angkanRedemptionBlocked };
`)
const storeHub = (connection, result, integration = { status: 'live' }) =>
  resolve(connection, result, integration, 'storehub', 'angkan-c5a1', null)

test('an explicitly missing saved token cannot inherit old status flags', () => {
  const state = storeHub({ credentials_saved: false }, null, {
    status: 'live', config: { real_api_tested: true },
  })
  assert.equal(state.storeHubAccountLinked, false)
  assert.equal(state.isConnected, false)
})

test('a linked account remains visible when StoreHub denies transaction reads', () => {
  const state = storeHub({ credentials_saved: true, account_linked: true, transaction_status: 'verified' },
    { transaction_status: 'denied' })
  assert.equal(state.storeHubAccountLinked, true)
  assert.equal(state.storeHubTransactionsVerified, false)
  assert.equal(state.storeHubTransactionLabel, 'Transaction access denied')
  assert.equal(state.angkanRedemptionBlocked, true)
})

test('a fresh transaction check gates readiness and a stale success requires retesting', () => {
  const saved = { credentials_saved: true, account_linked: true, transaction_status: 'verified' }
  assert.equal(storeHub(saved, null).storeHubTransactionsVerified, false)
  assert.equal(storeHub(saved, { transaction_status: 'verified' }).storeHubTransactionsVerified, true)
  assert.equal(storeHub(saved, { transaction_status: 'timeout' }).storeHubTransactionLabel, 'Transaction check timed out')
})

test('a real account cannot use simulator controls even with historical simulator flags', () => {
  const integration = { status: 'connected', mode: 'test', config: { simulator: true } }
  assert.equal(storeHub({ credentials_saved: true }, null, integration).simulatorReady, false)
  assert.equal(storeHub({ credentials_saved: false }, null, integration).simulatorReady, false)
  assert.equal(resolve({ credentials_saved: false }, null, integration, 'storehub', 'isolated-test', null).simulatorReady, true)
})

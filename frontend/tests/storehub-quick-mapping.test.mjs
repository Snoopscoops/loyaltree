import test from 'node:test'
import assert from 'node:assert/strict'
import { storehubQuickSetupStep } from '../src/components/storehubQuickSetupStep.js'

const state = (patch = {}) => ({
  isConnected: true, hasSavedMapping: false, provider: 'storehub',
  simulatorReady: false, transactionsVerified: false, activeDeviceCount: 0,
  ...patch,
})

test('allows mapping despite StoreHub transactions 403', () => {
  assert.equal(storehubQuickSetupStep(state()), 2)
})
test('does not proceed to device pairing on 403 after mapping', () => {
  assert.equal(storehubQuickSetupStep(state({ hasSavedMapping: true })), 1)
})
test('permits device pairing only after transaction verification and mapping', () => {
  assert.equal(storehubQuickSetupStep(state({ hasSavedMapping: true, transactionsVerified: true })), 3)
})
test('previously paired devices reach test step only after access verification', () => {
  assert.equal(storehubQuickSetupStep(state({ hasSavedMapping: true, transactionsVerified: true, activeDeviceCount: 1 })), 4)
})
test('unlinked accounts remain on connect step', () => {
  assert.equal(storehubQuickSetupStep(state({ isConnected: false })), 1)
})
test('Loyverse retains its existing mapping/activation flow', () => {
  assert.equal(storehubQuickSetupStep(state({ provider: 'loyverse', hasSavedMapping: true })), 3)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { cardUpgradeActive, cardUpgradeProgress, cardUpgradeShouldPoll, validCardUpgradeSnapshot } from '../src/components/benefitsCardUpgradeModel.js'

const snapshot = (status = null, overrides = {}) => ({ available: true, total_cards: 284, eligible_cards: 284, enabled_cards: 0, rollout: status && { id: 'upgrade-1', status, total: 284, scanned: 100, queued: 97, failed: 3, remaining: 184, error_type: null }, ...overrides })

test('upgrade confirmation uses a complete, finite count snapshot', () => {
  assert.equal(validCardUpgradeSnapshot(snapshot()), true)
  assert.equal(validCardUpgradeSnapshot(snapshot('processing')), true)
  for (const value of [null, {}, snapshot(null, { total_cards: -1 }), snapshot(null, { total_cards: Infinity }), snapshot(null, { enabled_cards: 285 }), snapshot(null, { eligible_cards: '284' }), snapshot('delivered'), snapshot('processing', { rollout: { ...snapshot('processing').rollout, scanned: 285 } })]) assert.equal(validCardUpgradeSnapshot(value), false)
})

test('only active server jobs poll and hidden tabs stop polling', () => {
  for (const status of ['queued', 'processing']) {
    assert.equal(cardUpgradeActive(snapshot(status)), true)
    assert.equal(cardUpgradeShouldPoll(snapshot(status), 'visible'), true)
    assert.equal(cardUpgradeShouldPoll(snapshot(status), 'hidden'), false)
  }
  for (const status of [null, 'failed', 'completed']) assert.equal(cardUpgradeShouldPoll(snapshot(status), 'visible'), false)
})

test('progress reports preparation and queueing, without claiming device delivery', () => {
  const progress = cardUpgradeProgress(snapshot('processing'))
  assert.equal(progress.percent, 35)
  assert.equal(progress.canRetry, false)
  assert.match(progress.label, /Preparing/)
  assert.equal(cardUpgradeProgress(snapshot('completed', { rollout: { ...snapshot('completed').rollout, scanned: 284, queued: 284, failed: 0, remaining: 0 } })).label, 'Card updates queued')
  assert.equal(cardUpgradeProgress(snapshot('completed')).canRetry, true)
  assert.equal(cardUpgradeProgress(snapshot('failed')).canRetry, true)
  assert.equal(cardUpgradeProgress(snapshot()), null)
  assert.doesNotMatch(progress.label, /delivered|installed|received/i)
})

test('an empty completed job is finished without inventing device delivery', () => {
  assert.equal(cardUpgradeProgress(snapshot('completed', { rollout: { id: 'empty', status: 'completed', total: 0, scanned: 0, queued: 0, failed: 0, remaining: 0 } })).percent, 100)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { startVisibilityPolling } from '../src/components/visibilityPolling.js'

function harness(refresh) {
  let timer
  const listeners = new Set()
  const page = { visibilityState: 'visible', addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  const stop = startVisibilityPolling(refresh, { document: page, setTimeout: (fn, ms) => { timer = {fn, ms}; return timer }, clearTimeout: value => { if (timer === value) timer = null } })
  return { page, stop, timer: () => timer, visibility(state) { page.visibilityState = state; for (const fn of listeners) fn() } }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('dashboard refreshes wait for completion and default to 60 seconds', async () => {
  let resolve, calls = 0
  const fixture = harness(() => { calls++; return new Promise(done => { resolve = done }) })
  assert.equal(calls, 1)
  assert.equal(fixture.timer() == null, true)
  fixture.visibility('visible')
  assert.equal(calls, 1)
  resolve(); await flush()
  assert.equal(fixture.timer().ms, 60000)
  fixture.stop()
  assert.equal(fixture.timer(), null)
})

test('hidden tabs cancel polling, resume once visible and never restart after unmount', async () => {
  let calls = 0
  const fixture = harness(async () => { calls++ })
  await flush()
  fixture.visibility('hidden')
  assert.equal(fixture.timer(), null)
  fixture.visibility('visible'); await flush()
  assert.equal(calls, 2)
  fixture.stop()
  fixture.visibility('visible'); await flush()
  assert.equal(calls, 2)
  assert.equal(fixture.timer(), null)
})

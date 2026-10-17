import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureTransport, fixtureSlug, scenarios } from '../dev/owner-dashboard-fixtures.js'

const base = `http://localhost/__owner-fixtures/api/v1/business/${fixtureSlug}`
test('fixture transport blocks unmatched and production requests without native fetch', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Native fetch must never be called') }
  try {
    const records = []
    const transport = createFixtureTransport({ onRequest: record => records.push(record) })
    for (const url of ['https://api.theloyaltytree.com/api/v1/business/demo-daylight', `${base}/not-a-fixture`]) {
      const response = await transport(url)
      assert.equal(response.status, 501)
      assert.match((await response.json()).detail, /No (external |network )?request was sent/)
    }
    assert.equal(records.length, 2)
    assert.ok(records.every(record => record.status === 501))
    assert.ok(records.every(record => !('headers' in record) && !('body' in record)))
  } finally { globalThis.fetch = originalFetch }
})
test('each card scenario returns the requested type and completed onboarding fixtures', async () => {
  for (const scenario of scenarios) {
    const transport = createFixtureTransport({ scenario })
    assert.equal((await (await transport(`${base}/loyalty-config`)).json()).card_type, scenario)
    assert.equal((await (await transport(base)).json()).onboarding_completed, true)
    assert.ok(Array.isArray(await (await transport(`${base}/staff`)).json()))
  }
})
test('announcement writes and platform dismissal alter only fixture memory; payment creation is blocked', async () => {
  const transport = createFixtureTransport()
  const created = await (await transport(`${base}/announcements`, { method: 'POST', body: JSON.stringify({ title: 'Fixture title', message: 'Fixture message', target_scope: 'business' }) })).json()
  assert.equal(created.simulated, true)
  assert.equal(created._push_google_sent, 2)
  assert.equal((await (await transport(`${base}/announcements`)).json())[0].title, 'Fixture title')
  assert.equal((await (await transport(`${base}/announcements/${created.id}/notify`, { method: 'POST' })).json()).simulated, true)
  await transport(`${base}/platform-announcements/501/dismiss`, { method: 'POST' })
  assert.deepEqual(await (await transport(`${base}/platform-announcements`)).json(), [])
  assert.equal((await transport(`${base}/subscription/checkout`, { method: 'POST' })).status, 403)
  const isolated = createFixtureTransport()
  assert.equal((await (await isolated(`${base}/announcements`)).json()).length, 1)
})

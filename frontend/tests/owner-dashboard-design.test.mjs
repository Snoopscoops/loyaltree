import test from 'node:test'
import assert from 'node:assert/strict'
import { canUseOwnerDashboardRefresh } from '../src/components/ownerDashboardDesign.js'

const owner = { role: 'owner', business_slug: 'daylight', business_public_id: 'biz-daylight', public_id: 'owner-daylight', business_type: 'coffee' }

test('refresh is enabled for every standard owner by default', () => {
  assert.equal(canUseOwnerDashboardRefresh(owner), true)
  assert.equal(canUseOwnerDashboardRefresh(owner, { development: true }), true)
  for (const businesses of ['', '  ', 'all', ' ALL ', undefined, null]) {
    assert.equal(canUseOwnerDashboardRefresh(owner, { businesses }), true)
  }
  assert.equal(canUseOwnerDashboardRefresh({ ...owner, business_slug: 'another-business', business_public_id: 'another-id' }), true)
})
test('off restores the original design for all owners', () => {
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: 'off' }), false)
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: ' OFF ' }), false)
})
test('exact business identifiers enable only the selected owner', () => {
  for (const businesses of ['daylight', 'biz-daylight', 'unrelated, daylight, another']) {
    assert.equal(canUseOwnerDashboardRefresh(owner, { businesses }), true)
  }
  assert.equal(canUseOwnerDashboardRefresh({ ...owner, business_slug: 'other', business_public_id: 'biz-other', public_id: 'owner-other' }, { businesses: 'daylight' }), false)
})
test('allowlist normalizes surrounding whitespace and identifier case', () => {
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: '  DAYLIGHT  ,  OTHER ' }), true)
  assert.equal(canUseOwnerDashboardRefresh({ ...owner, business_slug: ' DayLight ' }, { businesses: 'daylight' }), true)
})
test('substrings, URL fragments, and wildcard entries do not activate businesses', () => {
  for (const businesses of ['day', 'daylight-other', 'https://example.com/daylight', '*', 'day*', '*,unrelated', 'owner-daylight']) {
    assert.equal(canUseOwnerDashboardRefresh(owner, { businesses }), false, businesses)
  }
})
test('roles outside owner never activate, even with an allowlist and dev preview', () => {
  for (const role of ['manager', 'cashier', 'super_admin', 'admin', 'partner', '', null]) {
    assert.equal(canUseOwnerDashboardRefresh({ ...owner, role }), false, String(role))
    assert.equal(canUseOwnerDashboardRefresh({ ...owner, role }, { businesses: 'daylight', development: true, preview: true }), false, String(role))
  }
  assert.equal(canUseOwnerDashboardRefresh(null, { development: true, preview: true }), false)
})
test('specialized owner dashboards retain their existing design', () => {
  for (const business_type of ['car_lending', 'lending', 'cockpit']) {
    assert.equal(canUseOwnerDashboardRefresh({ ...owner, business_type }), false)
    assert.equal(canUseOwnerDashboardRefresh({ ...owner, business_type }, { businesses: 'daylight', development: true, preview: true }), false)
  }
})
test('preview bypass requires both development and preview, without granting identity', () => {
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: 'off', development: true, preview: true }), true)
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: 'off', development: false, preview: true }), false)
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: 'off', preview: true }), false)
  assert.equal(canUseOwnerDashboardRefresh(owner, { businesses: 'off', development: 'true', preview: true }), false)
  assert.equal(canUseOwnerDashboardRefresh({ role: 'owner' }, { development: true, preview: true }), false)
})
test('the fixture can compare the old layout only in development', () => {
  assert.equal(canUseOwnerDashboardRefresh(owner, { development: true, preview: 'legacy' }), false)
  assert.equal(canUseOwnerDashboardRefresh(owner, { development: false, preview: 'legacy' }), true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWalletPassPreview } from '../src/components/walletPassPreviewModel.js'

test('stamp preview follows edited goals, milestones, icon rows and sample balance', () => {
  const form = { card_type: 'stamp', card_name: 'Coffee Club', stamp_goal: 12, stamp_rewards: [{ stamps: 12, reward_name: 'Free cake' }, { stamps: 6, reward_name: 'Free coffee' }] }
  const preview = buildWalletPassPreview(form, { businessName: 'Daylight', stampValue: '6 / 12', sampleStamps: 6, stampProgress: ['★★★★★★☆☆☆☆', '☆☆'] })
  assert.equal(preview.title, 'Coffee Club')
  assert.equal(preview.metric.value, '6 / 12')
  assert.equal(preview.appleFields[0].value, 'Free coffee · Ready to redeem')
  assert.equal(preview.auxiliaryFields[0].value, '★★★★★★☆☆☆☆ ☆☆')
  const edited = buildWalletPassPreview({ ...form, stamp_rewards: [{ stamps: 12, reward_name: 'Free lunch' }] }, { sampleStamps: 6 })
  assert.equal(edited.appleFields[0].value, 'Free lunch · 6 stamps to go')
})

test('points preview uses configured rewards, earning rules and balance cap', () => {
  const form = { card_type: 'points', points_prizes: [{ points_cost: 100, name: 'Espresso' }], points_per_amount: 20, points_amount_pesos: 150, points_cap_limit: 30 }
  const preview = buildWalletPassPreview(form)
  assert.equal(preview.metric.value, '30')
  assert.equal(preview.appleFields[0].value, 'Espresso · 70 points to go')
  assert.equal(preview.details[1].value, '20 points per ₱150 spent')
  assert.equal(buildWalletPassPreview({ ...form, points_cap_limit: '' }).metric.value, '58')
})

test('multipass preview uses edited sessions and validity rather than a fixed 5/10', () => {
  const preview = buildWalletPassPreview({ card_type: 'multipass', multipass_session_count: 18, multipass_validity_days: 120 })
  assert.deepEqual(preview.metric, { label: 'SESSIONS', value: '12 / 18' })
  assert.equal(preview.appleFields[0].value, '120 days after purchase')
  assert.equal(buildWalletPassPreview({ card_type: 'multipass', multipass_session_count: 3 }).metric.value, '2 / 3')
})

test('VIP and hybrid previews follow selected tier and enabled loyalty components', () => {
  const tier = { name: 'Platinum', threshold: 50, discount_percent: 15, benefits: ['Priority seating'] }
  const vip = buildWalletPassPreview({ card_type: 'vip', vip_progression_type: 'stamps' }, { tier })
  assert.deepEqual(vip.metric, { label: 'TIER STAMPS', value: '50' })
  assert.equal(vip.appleFields[0].value, 'Platinum')
  assert.ok(vip.details.some(field => field.value === '15% discount'))
  const hybrid = buildWalletPassPreview({ card_type: 'hybrid', hybrid_points_enabled: false, hybrid_stamps_enabled: true, hybrid_tier_enabled: true, membership_duration_days: 45 }, { tier, stampValue: '4 / 8' })
  assert.deepEqual(hybrid.metric, { label: 'STAMPS', value: '4 / 8' })
  assert.equal(hybrid.appleFields[1].value, 'ACTIVE')
  assert.ok(hybrid.details.some(field => field.value === '45 days after activation'))
  assert.ok(hybrid.details.some(field => field.label === 'CURRENT TIER' && field.value === 'Platinum'))
  const combined = buildWalletPassPreview({ card_type: 'hybrid', hybrid_stamps_enabled: true }, { stampProgress: ['★★★★☆☆☆☆'] })
  assert.equal(combined.metric.label, 'POINTS')
  assert.equal(combined.auxiliaryFields[0].value, '★★★★☆☆☆☆')
})

test('membership and employee modes keep provider identity and membership fields', () => {
  const membership = buildWalletPassPreview({ card_type: 'membership', membership_name: 'Monthly Club', membership_duration_days: 60, membership_benefits: [{ name: 'One drink daily' }] })
  assert.equal(membership.metric.value, 'ACTIVE')
  assert.equal(membership.appleFields[1].value, '60 days after activation')
  assert.ok(membership.details.some(field => field.value === 'One drink daily'))
  const employeeMembership = buildWalletPassPreview({ card_type: 'membership', membership_employee_mode: true })
  assert.equal(employeeMembership.metric.label, 'EMPLOYEE ID')
  assert.equal(employeeMembership.appleFields[0].label, 'STATUS')
  const employee = buildWalletPassPreview({ card_type: 'employee', employee_benefits: ['Staff meal'] })
  assert.equal(employee.appleFields[0].label, 'EMPLOYEE')
  assert.ok(employee.details.some(field => field.value === 'Staff meal'))
})

test('preview actions update immediately, omit inactive/invalid actions, and preserve form data', () => {
  const form = { wallet_actions: [
    { id: 'site', label: 'Website', url: 'https://example.com' },
    { id: 'book', label: 'Book now', url: 'https://example.com/book', primary: true },
    { label: 'Disabled', url: 'https://example.com/off', enabled: false },
    { label: 'Unsafe', url: 'javascript:alert(1)' },
    { label: '', url: 'https://example.com/blank' },
  ] }
  const original = JSON.stringify(form)
  const preview = buildWalletPassPreview(form)
  assert.deepEqual(preview.actions.map(action => action.label), ['Website', 'Book now'])
  assert.equal(preview.primaryAction.id, 'book')
  assert.equal(JSON.stringify(form), original)
  const edited = buildWalletPassPreview({ ...form, wallet_actions: form.wallet_actions.map(action => ({ ...action, enabled: action.id !== 'book' })) })
  assert.equal(edited.primaryAction.id, 'site')
})

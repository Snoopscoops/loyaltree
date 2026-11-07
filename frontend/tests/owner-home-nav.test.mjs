import test from 'node:test'
import assert from 'node:assert/strict'
import { OWNER_SECTIONS, HOME_FEATURES, destinations, missingDestinations, homeSummaryMetrics, showSetupRecommendation, homeAttention, joinQrImageUrl, sectionForTab, visibleItems } from '../src/components/ownerHomeNav.js'

test('every previous destination stays one level inside the five sections', () => {
  assert.deepEqual(OWNER_SECTIONS.map(section => section.label), ['Home', 'Customers', 'Orders & Menu', 'Marketing', 'Settings'])
  assert.deepEqual(missingDestinations(), [])
  assert.equal(sectionForTab('billboard').id, 'marketing')
  assert.equal(visibleItems(OWNER_SECTIONS[2], { orderAheadEnabled: false }).some(item => item.id === 'orderahead'), false)
  assert.equal(visibleItems(OWNER_SECTIONS[2], { orderAheadEnabled: true }).some(item => item.id === 'orderahead'), true)
})

test('home highlights the four requested tools and keeps three existing metrics', () => {
  assert.deepEqual(HOME_FEATURES.map(feature => feature.label), ['Digital Menu', 'Digital Billboard', 'Notifications', 'LT Points'])
  assert.deepEqual(destinations().filter(id => ['qrmenu', 'billboard', 'announcements', 'ltbenefits'].includes(id)).sort(), ['announcements', 'billboard', 'ltbenefits', 'qrmenu'])
  const summary = homeSummaryMetrics([
    { label: 'Total customers', value: 12, hint: 'scope' },
    { label: 'Total customer visits', value: 40, hint: 'visits' },
    { label: 'Return rate', value: '25.0%', hint: 'two or more days' },
    { label: 'Rewards ready', value: 3, hint: 'ready now' },
  ])
  assert.deepEqual(summary.map(metric => metric.label), ['Customers', 'Return rate', 'Rewards ready'])
  assert.equal(summary[1].value, '25.0%')
})

test('setup advice and the join QR follow the active program', () => {
  assert.equal(showSetupRecommendation({ program: { card_type: 'stamp' } }), false)
  assert.equal(showSetupRecommendation({ program: {} }), true)
  assert.equal(showSetupRecommendation({ program: { card_type: 'stamp' }, requested: true }), true)
  assert.equal(homeAttention({ needsRenewal: true, rewardsReady: 2 }).length, 2)
  assert.equal(homeAttention({ rewardsReady: 0, activityMissing: false }).length, 0)
  const first = joinQrImageUrl('https://theloyaltytree.com/join/jus5479')
  const second = joinQrImageUrl('https://theloyaltytree.com/join/jus5479__p__abc')
  assert.notEqual(first, second)
  assert.equal(joinQrImageUrl(''), '')
})

export const OWNER_SECTIONS = Object.freeze([
  { id: 'home', label: 'Home', icon: 'home', items: [
    { id: 'tree', label: 'Home' },
    { id: 'analytics', label: 'Analytics', action: 'analytics' },
  ]},
  { id: 'customers', label: 'Customers', icon: 'people', items: [
    { id: 'customers', label: 'Customer list' },
    { id: 'scan', label: 'Add a stamp', action: 'scan' },
    { id: 'crm', label: 'Segments' },
    { id: 'retention', label: 'Retention' },
    { id: 'security', label: 'Transactions & security' },
  ]},
  { id: 'orders', label: 'Orders & Menu', icon: 'bag', items: [
    { id: 'qrmenu', label: 'Digital Menu', featured: true },
    { id: 'orderahead', label: 'Order Ahead', requires: 'orderAhead' },
    { id: 'giftcards', label: 'Gift cards' },
    { id: 'pos', label: 'Integrations' },
    { id: 'operations', label: 'Branch operations' },
  ]},
  { id: 'marketing', label: 'Marketing', icon: 'campaign', items: [
    { id: 'billboard', label: 'Digital Billboard', featured: true },
    { id: 'announcements', label: 'Notifications', action: 'announcements', featured: true },
    { id: 'ltbenefits', label: 'LT Points', featured: true },
    { id: 'campaigns', label: 'Campaigns' },
    { id: 'satisfaction', label: 'Satisfaction' },
    { id: 'referrals', label: 'Referrals' },
  ]},
  { id: 'settings', label: 'Settings', icon: 'setup', items: [
    { id: 'program', label: 'Loyalty card' },
    { id: 'staff', label: 'Team & locations' },
    { id: 'billing', label: 'Billing' },
    { id: 'walletqueue', label: 'Wallet queue' },
    { id: 'advanced', label: 'Advanced tools' },
    { id: 'setup', label: 'Setup guide', action: 'setup' },
    { id: 'support', label: 'Help & support', action: 'support' },
  ]},
])

export const HOME_FEATURES = Object.freeze([
  { id: 'qrmenu', label: 'Digital Menu', text: 'Customers see your menu after they scan your QR.', tab: 'qrmenu' },
  { id: 'billboard', label: 'Digital Billboard', text: 'Nearby Loyalty Tree members can see this business.', tab: 'billboard' },
  { id: 'announcements', label: 'Notifications', text: 'Send an update to customers who already have your card.', action: 'announcements' },
  { id: 'ltbenefits', label: 'LT Points', text: 'Set coupons customers can claim with their LT Points.', tab: 'ltbenefits' },
])

const PREVIOUS_DESTINATIONS = [
  'tree', 'customers', 'program', 'analytics', 'announcements', 'billboard', 'staff', 'qrmenu', 'orderahead',
  'giftcards', 'ltbenefits', 'pos', 'campaigns', 'satisfaction', 'billing', 'referrals', 'security',
  'walletqueue', 'crm', 'retention', 'operations', 'advanced', 'setup', 'support', 'scan',
]

export function visibleItems(section, { orderAheadEnabled = false } = {}) {
  return section.items.filter(item => item.requires !== 'orderAhead' || orderAheadEnabled)
}

export function sectionForTab(tab) {
  return OWNER_SECTIONS.find(section => section.items.some(item => item.id === tab)) || OWNER_SECTIONS[0]
}

export function destinations() {
  return OWNER_SECTIONS.flatMap(section => section.items.map(item => item.id))
}

export function missingDestinations() {
  return PREVIOUS_DESTINATIONS.filter(id => !destinations().includes(id))
}

export function homeSummaryMetrics(metrics = []) {
  const labels = { 'Total customers': 'Customers', 'Return rate': 'Return rate', 'Rewards ready': 'Rewards ready' }
  return ['Total customers', 'Return rate', 'Rewards ready'].map(label => {
    const metric = metrics.find(item => item.label === label)
    return metric ? { ...metric, label: labels[label] } : null
  }).filter(Boolean)
}

export function showSetupRecommendation({ program, requested = false } = {}) {
  return Boolean(requested || !program?.card_type)
}

export function homeAttention({ needsRenewal = false, renewalText = '', rewardsReady = 0, activityMissing = false } = {}) {
  const items = []
  if (needsRenewal) items.push({ id: 'renewal', text: renewalText || 'Renew your subscription', tab: 'billing' })
  const ready = Number(rewardsReady)
  if (Number.isFinite(ready) && ready > 0) items.push({ id: 'rewards', text: `${ready} rewards are ready to redeem`, tab: 'customers' })
  if (activityMissing) items.push({ id: 'activity', text: 'Some visit history is unavailable. Return rate may be incomplete.', tab: 'analytics' })
  return items
}

export function joinQrImageUrl(joinUrl, size = 280) {
  if (!joinUrl) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(joinUrl)}`
}

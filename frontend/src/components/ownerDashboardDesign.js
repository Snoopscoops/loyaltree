// Presentation rollout only. API authorization and plan permissions remain on
// their existing paths; this flag never grants access to a business or feature.
export function canUseOwnerDashboardRefresh(user, { businesses = 'all', development = false, preview = false } = {}) {
  if (user?.role !== 'owner') return false
  if (['car_lending', 'lending', 'cockpit'].includes(user.business_type)) return false
  const identifiers = [user.business_slug, user.business_public_id]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLowerCase())
  if (!identifiers.length) return false
  if (development === true && preview === 'legacy') return false
  if (development === true && preview === true) return true
  const rollout = String(businesses ?? 'all').trim().toLowerCase()
  if (!rollout || rollout === 'all') return true
  if (rollout === 'off') return false
  const allowed = new Set(rollout.split(',').map(value => value.trim()).filter(value => value && value !== '*'))
  return identifiers.some(value => allowed.has(value))
}

export const OWNER_DASHBOARD_TABS = Object.freeze([
  'tree', 'customers', 'staff', 'orderahead', 'giftcards', 'pos', 'satisfaction',
  'campaigns', 'program', 'billing', 'referrals', 'security', 'walletqueue',
  'crm', 'retention', 'operations', 'analytics',
])

export function ownerDashboardTab(value) {
  return OWNER_DASHBOARD_TABS.includes(value) ? value : 'tree'
}

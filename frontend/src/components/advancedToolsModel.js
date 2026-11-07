export const ADVANCED_TOOL_IDS = Object.freeze(['advanced', 'security', 'walletqueue', 'crm', 'retention', 'operations'])

export const EMPTY_AUDIT_FILTERS = Object.freeze({
  status: '', branch_public_id: '', staff_public_id: '', date_from: '', date_to: '',
})

export function advancedToolFromSearch(search = '') {
  const value = new URLSearchParams(String(search).replace(/^\?/, '')).get('tool')
  return ADVANCED_TOOL_IDS.includes(value) ? value : null
}

export function dashboardSearchForTab(search, tab) {
  const params = new URLSearchParams(typeof search === 'string' ? search.replace(/^\?/, '') : search)
  if (ADVANCED_TOOL_IDS.includes(tab)) params.set('tool', tab)
  else params.delete('tool')
  return params
}

export function localIsoDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function shiftIsoDate(iso, days) {
  const [year, month, day] = String(iso).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function datePresetRange(preset, today) {
  if (preset === 'today') return { date_from: today, date_to: today }
  if (preset === '7') return { date_from: shiftIsoDate(today, -6), date_to: today }
  if (preset === '30') return { date_from: shiftIsoDate(today, -29), date_to: today }
  return null
}

export function filtersAreActive(filters = {}) {
  return Object.values(filters).some(value => String(value || '').trim())
}

export function filterSummary(filters = {}, { branches = [], staff = [] } = {}) {
  const parts = []
  if (filters.status) parts.push(`Status: ${filters.status}`)
  const branch = branches.find(item => item.public_id === filters.branch_public_id)
  if (filters.branch_public_id) parts.push(`Branch: ${branch?.name || 'Selected branch'}`)
  const cashier = staff.find(item => item.public_id === filters.staff_public_id)
  if (filters.staff_public_id) parts.push(`Cashier: ${cashier?.name || 'Selected cashier'}`)
  if (filters.date_from || filters.date_to) parts.push(`Dates: ${filters.date_from || 'Any start'} to ${filters.date_to || 'any end'}`)
  return parts
}

export function transactionView({ loading, error, transactions, filters }) {
  const rows = Array.isArray(transactions) ? transactions : []
  if (loading && rows.length === 0) return 'loading'
  if (error && rows.length === 0) return 'error'
  if (rows.length === 0 && filtersAreActive(filters)) return 'no-match'
  if (rows.length === 0) return 'empty'
  return 'results'
}

export function retentionGroups(opportunities = []) {
  const groups = new Map()
  for (const item of opportunities) {
    const type = item?.type || 'other'
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type).push(item)
  }
  const title = { win_back: 'Win back', one_away: 'One stamp away' }
  return [...groups.entries()].map(([type, items]) => ({
    type,
    title: title[type] || type.replaceAll('_', ' '),
    count: items.length,
    items: [...items].sort((a, b) => (b.days_inactive || 0) - (a.days_inactive || 0)),
  }))
}

function checked(loaded, error, text) {
  if (!loaded && error) return error
  if (!loaded) return 'Not checked yet'
  return text
}

export function toolOverview({
  securityLoaded = false, securityError = '', alerts = 0,
  growthLoaded = false, toolErrors = {}, wallet = {}, crm = {}, retention = {}, operations = {}, opportunities = 0,
} = {}) {
  const waiting = Number(wallet.pending) || 0
  const failed = Number(wallet.failed) || 0
  const members = Number.isFinite(crm.total_customers) ? crm.total_customers : (crm.customers || []).length
  const branchDays = operations.days || 30
  return [
    { id: 'security', title: 'Transactions & security', purpose: 'Review card activity and unusual patterns.', state: checked(securityLoaded, securityError, alerts ? `${alerts} alert${alerts === 1 ? '' : 's'} in the last 24 hours` : 'No alerts in the last 24 hours') },
    { id: 'walletqueue', title: 'Wallet queue', purpose: 'See card updates still waiting for Apple or Google.', state: checked(growthLoaded, toolErrors.wallet, waiting || failed ? `${waiting} waiting · ${failed} failed` : 'Nothing waiting') },
    { id: 'crm', title: 'Customer segments', purpose: 'See members grouped by how recently they visited.', state: checked(growthLoaded, toolErrors.crm, `${members} member${members === 1 ? '' : 's'}`) },
    { id: 'retention', title: 'Retention', purpose: 'See who came back and who may need a message.', state: checked(growthLoaded, toolErrors.retention, `${Number(retention.repeat_customer_rate) || 0}% came back · ${opportunities} to review`) },
    { id: 'operations', title: 'Branch operations', purpose: 'Compare branches and cashiers.', state: checked(growthLoaded, toolErrors.operations, `${operations.overall?.transactions || 0} transactions in ${branchDays} days`) },
  ]
}

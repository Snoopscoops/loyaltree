export const CUSTOMER_SEGMENTS = Object.freeze([
  { key: 'regulars', label: 'Regulars', color: '#0d9488' },
  { key: 'first_time', label: 'First-time visitors', color: '#a9d9c7' },
  { key: 'occasional', label: 'Occasional visitors', color: '#f2bf50' },
  { key: 'at_risk', label: 'At risk', color: '#c67556' },
])

export function customerMatchesFilter(customer, filter, stats) {
  const activity = stats?.customer_activity?.[customer.public_id]
  if (filter === 'all') return true
  if (filter === 'rewards_ready') return !stats || stats.rewards_available === false ? false : activity?.rewards_ready ?? Boolean(customer.reward_unlocked)
  return activity?.segment === filter
}

export function overviewMetrics(stats, customers = [], customersAvailable = true) {
  const activityAvailable = stats?.activity_available === true
  return [
    { value: stats?.total_customers ?? (customersAvailable ? customers.length : '—'), label: 'Total customers', hint: 'Customer cards in the selected program scope' },
    { value: activityAvailable ? Number(stats.total_customer_visits || 0).toLocaleString() : '—', label: 'Total customer visits', hint: activityAvailable ? 'Recorded visit days · one per customer per local day' : 'Visit history is currently unavailable' },
    { value: activityAvailable ? `${Number(stats.return_rate || 0).toFixed(1)}%` : '—', label: 'Return rate', hint: 'Visited on 2+ days ÷ customers with a recorded visit' },
    { value: !stats || stats.rewards_available === false ? '—' : stats?.rewards_ready ?? (customersAvailable ? customers.filter(c => c.reward_unlocked).length : '—'), label: 'Rewards ready', hint: 'Customers with an earned reward available now' },
  ]
}

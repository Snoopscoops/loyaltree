export function validCustomerDemographics(report) {
  const count = value => Number.isInteger(value) && value >= 0
  const percentage = value => value === null || (Number.isFinite(value) && value >= 0 && value <= 100)
  if (!report || !Number.isFinite(Date.parse(report.generated_at)) || !report.summary || !report.methodology) return false
  for (const key of ['customers', 'memberships', 'businesses', 'businesses_with_customers', 'employee_memberships_excluded', 'unlinked_memberships']) {
    if (!count(report.summary[key])) return false
  }
  if (report.summary.average_customers_per_business !== null && !(Number.isFinite(report.summary.average_customers_per_business) && report.summary.average_customers_per_business >= 0)) return false
  if (!['counting', 'age', 'responses', 'location'].every(key => typeof report.methodology[key] === 'string')) return false
  for (const field of ['age', 'gender', 'occupation']) {
    const data = report[field]
    if (!data || typeof data.available !== 'boolean' || !count(data.sample_size) || !count(data.missing) || !percentage(data.coverage_percent) || !Array.isArray(data.rows)) return false
    if (!data.rows.every(row => row && typeof row === 'object' && typeof row.key === 'string' && typeof row.label === 'string' && (row.count === null || count(row.count)) && percentage(row.percent))) return false
    if (data.largest_group != null && !(typeof data.largest_group.label === 'string' && count(data.largest_group.count) && percentage(data.largest_group.percent))) return false
  }
  return true
}

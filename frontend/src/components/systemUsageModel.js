const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const number = value => Number.isFinite(value) && value >= 0
const count = value => Number.isInteger(value) && value >= 0
const optional = (value, check = number) => value === null || check(value)
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const text = value => typeof value === 'string'
const has = (value, fields, check = number) => object(value) && fields.every(field => check(value[field]))
const rows = (value, check) => Array.isArray(value) && value.every(row => object(row) && check(row))

export function validSystemUsage(report) {
  if (!object(report) || !date(report.generated_at) || !object(report.process)) return false
  const process = report.process
  if (!count(process.pid) || !date(process.started_at) || !number(process.uptime_seconds) || process.scope !== 'current_process' || !number(process.sample_interval_seconds)) return false
  const memory = value => has(value, ['rss_mb', 'container_memory_mb', 'container_limit_mb', 'cpu_percent', 'python_heap_mb', 'trace_overhead_mb'], optional) && optional(value.rss_peak_mb) && count(value.threads)
  if (!memory(process.current)) return false
  if (!has(report.summary, ['requests', 'status_2xx', 'status_4xx', 'status_5xx', 'inflight', 'peak_inflight', 'response_bytes'], count) || !has(report.summary, ['avg_ms', 'max_ms'])) return false
  if (!rows(report.samples, row => date(row.ts) && memory(row) && count(row.inflight))) return false
  if (!rows(report.startup, row => text(row.name) && date(row.ts) && number(row.elapsed_ms) && has(row, ['rss_mb', 'rss_peak_mb', 'python_heap_mb', 'cpu_total_seconds'], optional))) return false
  if (!rows(report.endpoints, row => text(row.method) && text(row.endpoint) && has(row, ['requests', 'status_2xx', 'status_4xx', 'status_5xx', 'response_bytes', 'largest_response_bytes', 'rss_observations'], count) && has(row, ['avg_ms', 'max_ms', 'avg_work_ms']) && optional(row.observed_rss_max_rise_mb))) return false
  if (!rows(report.businesses, row => text(row.business_slug) && has(row, ['requests', 'response_bytes', 'status_5xx'], count) && has(row, ['avg_ms', 'max_ms']))) return false
  if (!rows(report.wallet_jobs, row => text(row.operation) && has(row, ['calls', 'failed'], count) && has(row, ['avg_ms', 'max_ms', 'avg_wait_ms', 'max_wait_ms']) && optional(row.observed_rss_max_rise_mb))) return false
  if (!rows(report.recent_wallet_jobs, row => date(row.ts) && text(row.operation) && optional(row.business_slug, text) && has(row, ['duration_ms', 'wait_ms']) && text(row.outcome) && has(row, ['rss_before_mb', 'rss_after_mb'], optional) && optional(row.observed_rss_change_mb, Number.isFinite))) return false
  if (!rows(report.caches, row => text(row.name) && has(row, ['items', 'bytes', 'max_bytes'], count))) return false
  if (!rows(report.retained_maps, row => text(row.name) && count(row.items))) return false
  const trace = report.trace
  if (!object(trace) || typeof trace.enabled !== 'boolean' || typeof trace.running !== 'boolean' || !['environment', 'manual', 'off'].includes(trace.source) || !optional(trace.deadline, date) || !optional(trace.started_at, date) || !optional(trace.overhead_mb)) return false
  if (trace.last_capture !== null && (!object(trace.last_capture) || !date(trace.last_capture.finished_at) || !number(trace.last_capture.duration_seconds) || !text(trace.last_capture.scope) || !optional(trace.last_capture.error, text) || !rows(trace.last_capture.top_allocations, row => text(row.file) && count(row.line) && has(row, ['bytes', 'count'], count)))) return false
  return object(report.limits) && Array.isArray(report.notes) && report.notes.every(text)
}

export function usageValue(value, suffix = '', digits = 1) {
  return Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${suffix}` : 'Unavailable'
}

export function usageBytes(value) {
  if (!Number.isFinite(value)) return 'Unavailable'
  return value >= 1024 * 1024 ? usageValue(value / (1024 * 1024), ' MiB') : usageValue(value / 1024, ' KiB')
}

export function usageRequestError(status, profiling = false) {
  if (status === 401 || status === 403) return 'Your admin session cannot access system usage. Sign in again with an admin account.'
  if (status === 409 && profiling) return 'Allocation capture could not start. Another capture may be running or memory headroom may be low. Refresh the readings before trying again.'
  if (status === 503) return profiling ? 'Allocation profiling is temporarily unavailable. Please try again shortly.' : 'System usage is temporarily unavailable. Please try again shortly.'
  return profiling ? 'Could not start the allocation capture. Please try again.' : 'Could not load system usage. Please try again.'
}

// Position readings by elapsed wall time and leave sleep/unavailable gaps blank.
export function usageMemoryChart(samples) {
  const values = samples.filter(row => Number.isFinite(row.rss_mb) && date(row.ts))
  if (values.length < 2) return null
  const timestamps = samples.filter(row => date(row.ts)).map(row => Date.parse(row.ts))
  const first = Math.min(...timestamps), last = Math.max(...timestamps)
  const minimum = Math.min(...values.map(row => row.rss_mb))
  const maximum = Math.max(...values.map(row => row.rss_mb))
  const low = Math.max(0, minimum - 5), high = Math.max(low + 10, maximum + 5)
  let previous = null
  const path = samples.map(row => {
    const timestamp = Date.parse(row.ts)
    if (!Number.isFinite(row.rss_mb) || !Number.isFinite(timestamp)) { previous = null; return '' }
    const move = previous === null || timestamp - previous > 90000 || timestamp < previous
    const point = `${20 + (timestamp - first) / Math.max(last - first, 1) * 860},${135 - (row.rss_mb - low) / (high - low) * 110}`
    previous = timestamp
    return `${move ? 'M' : 'L'}${point}`
  }).filter(Boolean).join(' ')
  return { path, minimum, maximum, first, last }
}

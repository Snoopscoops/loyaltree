import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { usageBytes, usageMemoryChart, usageRequestError, usageValue, validSystemUsage } from '../src/components/systemUsageModel.js'

const reports = JSON.parse(readFileSync(new URL('../dev/system-usage-sample.json', import.meta.url)))

test('complete, empty and unavailable usage measurements remain renderable', () => {
  for (const report of Object.values(reports)) assert.equal(validSystemUsage(report), true)
  assert.equal(reports.unavailable.process.current.rss_mb, null)
  assert.equal(reports.empty.samples.length, 0)
  assert.equal(reports.complete.process.current.cpu_percent > 100, true)
  assert.equal(reports.complete.recent_wallet_jobs[0].observed_rss_change_mb < 0, true)
})

test('malformed usage reports cannot reach the admin render', () => {
  for (const value of [null, {}, [], { generated_at: 'invalid' }]) assert.equal(validSystemUsage(value), false)
  const invalidCases = [
    value => { value.process.current.threads = -1 },
    value => { value.process.current.rss_mb = undefined },
    value => { value.process.current.cpu_percent = -2 },
    value => { value.summary.requests = '10' },
    value => { value.summary.response_bytes = Infinity },
    value => { value.samples[0] = null },
    value => { value.endpoints[0].endpoint = null },
    value => { value.trace.last_capture.top_allocations[0] = null },
    value => { value.trace.last_capture.top_allocations[0].bytes = -10 },
    value => { value.trace.deadline = 'not a date' },
    value => { value.notes = [null] },
  ]
  for (const mutate of invalidCases) { const value = structuredClone(reports.complete); mutate(value); assert.equal(validSystemUsage(value), false) }
})

test('unavailable readings are distinct from measured zero and process CPU may exceed one core', () => {
  assert.equal(usageValue(null, ' MB'), 'Unavailable')
  assert.equal(usageValue(undefined), 'Unavailable')
  assert.equal(usageValue(0, ' MB'), '0 MB')
  assert.equal(usageValue(215, '%'), '215%')
  assert.equal(usageBytes(null), 'Unavailable')
  assert.equal(usageBytes(1024), '1 KiB')
  assert.equal(usageBytes(1048576), '1 MiB')
})

test('usage and profiling failures provide safe actionable text for permission, conflict and unavailable statuses', () => {
  assert.match(usageRequestError(403), /admin session/)
  assert.match(usageRequestError(409, true), /memory headroom/)
  assert.match(usageRequestError(503, true), /temporarily unavailable/)
  assert.match(usageRequestError(503), /System usage/)
  assert.match(usageRequestError(undefined, true), /Could not start/)
  assert.match(usageRequestError(500), /Could not load/)
})

test('nullable OS measurements and zero-duration safety-stop captures remain visible', () => {
  const report = structuredClone(reports.complete)
  report.startup[0].cpu_total_seconds = null
  report.trace.last_capture = { finished_at: report.generated_at, duration_seconds: 0, scope: 'current_process', top_allocations: [], error: 'Tracing stopped automatically because container memory is high.' }
  assert.equal(validSystemUsage(report), true)
  report.trace.last_capture.duration_seconds = -1
  assert.equal(validSystemUsage(report), false)
})

test('memory chart uses elapsed sample timestamps and breaks across Render sleep gaps', () => {
  const at = seconds => new Date(Date.UTC(2026, 9, 20) + seconds * 1000).toISOString()
  const rows = [0, 30, 90, 240].map(seconds => ({ ts: at(seconds), rss_mb: 250 }))
  const chart = usageMemoryChart(rows)
  const segments = chart.path.split(' ')
  assert.deepEqual(segments.map(segment => Number(segment.slice(1).split(',')[0])), [20, 127.5, 342.5, 880])
  assert.deepEqual(segments.map(segment => segment[0]), ['M', 'L', 'L', 'M'])
  assert.equal(chart.last - chart.first, 240000)
  assert.equal(chart.minimum, 250)
  assert.equal(chart.maximum, 250)
})

test('memory chart does not connect unavailable readings or a backwards clock change', () => {
  const at = seconds => new Date(Date.UTC(2026, 9, 20) + seconds * 1000).toISOString()
  const rows = [{ ts: at(0), rss_mb: 250 }, { ts: at(30), rss_mb: null }, { ts: at(60), rss_mb: 255 }, { ts: at(50), rss_mb: 253 }]
  assert.deepEqual(usageMemoryChart(rows).path.split(' ').map(segment => segment[0]), ['M', 'M', 'M'])
  assert.equal(usageMemoryChart([]), null)
  assert.equal(usageMemoryChart([{ ts: at(0), rss_mb: null }]), null)
})

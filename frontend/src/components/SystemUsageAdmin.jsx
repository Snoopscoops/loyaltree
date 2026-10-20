import React, { useEffect, useRef, useState } from 'react'
import { startVisibilityPolling } from './visibilityPolling'
import { usageBytes, usageMemoryChart, usageRequestError, usageValue, validSystemUsage } from './systemUsageModel'
import './system-usage-admin.css'

const ms = value => usageValue(value, ' ms')
const mb = value => usageValue(value, ' MiB')
const integer = value => usageValue(value, '', 0)
const time = value => new Date(value).toLocaleTimeString()

function Metric({ label, value, detail }) {
  return <div className="lt-usage-metric"><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>
}

function DataTable({ title, hint, columns, rows, empty = 'No observations yet.' }) {
  return <section className="lt-usage-panel"><header><h3>{title}</h3>{hint && <p>{hint}</p>}</header>
    {!rows.length ? <p className="lt-usage-empty">{empty}</p> : <div className="lt-usage-table-wrap" tabIndex={0} role="region" aria-label={`${title} table`}><table><thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody></table></div>}
  </section>
}

function MemoryChart({ samples }) {
  const chart = usageMemoryChart(samples)
  if (!chart) return <p className="lt-usage-empty">Collecting memory samples. The server samples every 30 seconds; history starts again after a restart.</p>
  return <><div className="lt-usage-chart"><svg viewBox="0 0 900 155" role="img" aria-label={`Process RSS history, ${mb(chart.minimum)} to ${mb(chart.maximum)}`}><path d="M20,135 L880,135" stroke="#dbe7df" fill="none"/><path d={chart.path} stroke="#0f766e" strokeWidth="3" fill="none" vectorEffect="non-scaling-stroke"/></svg></div><div className="lt-usage-chart-labels"><span>{time(chart.first)}</span><span>Process RSS · {mb(chart.minimum)}–{mb(chart.maximum)} · Gaps over 90 seconds are left blank</span><span>{time(chart.last)}</span></div></>
}

export default function SystemUsageAdmin({ authFetch, sessionKey }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [profiling, setProfiling] = useState(false)
  const latestFetch = useRef(authFetch)
  const refresh = useRef(() => {})
  const profileRequest = useRef(null)
  latestFetch.current = authFetch
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    let running = false
    setReport(null); setLoading(true); setError(''); setProfileError(''); setProfileMessage(''); setProfiling(false)
    const load = async () => {
      if (running || !active) return
      running = true; setLoading(true)
      try {
        const response = await latestFetch.current('/api/v1/admin/system-usage', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(usageRequestError(response.status))
        const body = await response.json()
        if (!validSystemUsage(body)) throw new Error('The system usage response was incomplete. Please refresh shortly.')
        if (active) { setReport(body); setError(''); if (!body.trace.running && body.trace.last_capture) setProfileMessage('') }
      } catch (failure) {
        if (active && failure.name !== 'AbortError') setError(failure.message?.startsWith('The system usage') || failure.message?.startsWith('Your admin') || failure.message?.startsWith('System usage') ? failure.message : usageRequestError())
      } finally { running = false; if (active) setLoading(false) }
    }
    refresh.current = load
    const stop = startVisibilityPolling(load, { intervalMs: 30000 })
    return () => { active = false; controller.abort(); profileRequest.current?.abort(); stop(); refresh.current = () => {} }
  }, [sessionKey])
  const startProfile = async () => {
    if (profileRequest.current) return
    const controller = new AbortController()
    profileRequest.current = controller
    setProfiling(true); setProfileError(''); setProfileMessage('')
    try {
      const response = await latestFetch.current('/api/v1/admin/system-usage/profile?seconds=30', { method: 'POST', signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(usageRequestError(response.status, true))
      if (!controller.signal.aborted) { setProfileMessage('Allocation capture started. Results appear after 30 seconds.'); await refresh.current() }
    } catch (failure) {
      if (!controller.signal.aborted) setProfileError(failure.message?.startsWith('Your admin') || failure.message?.startsWith('Allocation capture') || failure.message?.startsWith('Allocation profiling') ? failure.message : usageRequestError(undefined, true))
    } finally {
      if (profileRequest.current === controller) { profileRequest.current = null; if (!controller.signal.aborted) setProfiling(false) }
    }
  }
  const current = report?.process.current
  const trace = report?.trace
  return <section className="lt-admin-usage">
    <header className="lt-usage-heading"><div><p className="lt-usage-eyebrow">SERVER PERFORMANCE</p><h2>System usage</h2><p>See memory, startup costs and request workload to find the next optimization.</p></div><button type="button" disabled={loading} onClick={() => refresh.current()}>{loading ? 'Refreshing…' : 'Refresh'}</button></header>
    {error && <p role="alert" className="lt-usage-error">{error}{report && ' Showing the last successful reading below.'}</p>}
    {!report && loading && <p role="status" className="lt-usage-empty">Loading current process measurements…</p>}
    {report && <>
      <p className="lt-usage-scope">Current process · PID {report.process.pid} · Started {new Date(report.process.started_at).toLocaleString()} · Uptime {usageValue(report.process.uptime_seconds / 60, ' min')}<br/>Counters and history reset when this process restarts. Other workers are not included.</p>
      <div className="lt-usage-metrics">
        <Metric label="Process memory (RSS)" value={mb(current.rss_mb)} detail={`Peak since startup: ${mb(current.rss_peak_mb)}`} />
        <Metric label="Container memory" value={mb(current.container_memory_mb)} detail={`Container limit: ${mb(current.container_limit_mb)}`} />
        <Metric label="Process CPU" value={usageValue(current.cpu_percent, '%')} detail={`${integer(current.threads)} threads · One CPU core = 100%`} />
        <Metric label="Requests since startup" value={integer(report.summary.requests)} detail={`${integer(report.summary.inflight)} in flight · Peak ${integer(report.summary.peak_inflight)}`} />
      </div>
      <div className="lt-usage-summary"><span>2xx <strong>{integer(report.summary.status_2xx)}</strong></span><span>4xx <strong>{integer(report.summary.status_4xx)}</strong></span><span>5xx <strong>{integer(report.summary.status_5xx)}</strong></span><span>Avg response <strong>{ms(report.summary.avg_ms)}</strong></span><span>Max response <strong>{ms(report.summary.max_ms)}</strong></span><span>Response data <strong>{usageBytes(report.summary.response_bytes)}</strong></span></div>
      <section className="lt-usage-panel"><header><h3>Recent memory</h3><p>RSS is memory resident in this process. Container usage also includes other memory counted by the hosting platform.</p></header><MemoryChart samples={report.samples}/></section>
      <DataTable title="Startup checkpoints" hint="Compare memory and elapsed time across startup stages to identify expensive imports and initialization." rows={report.startup} columns={[
        { key: 'name', label: 'Stage' }, { key: 'elapsed_ms', label: 'Elapsed', render: row => ms(row.elapsed_ms) }, { key: 'rss_mb', label: 'RSS', render: row => mb(row.rss_mb) }, { key: 'rss_peak_mb', label: 'Peak RSS', render: row => mb(row.rss_peak_mb) }, { key: 'python_heap_mb', label: 'Traced Python', render: row => mb(row.python_heap_mb) }, { key: 'cpu_total_seconds', label: 'CPU time', render: row => usageValue(row.cpu_total_seconds, ' s') },
      ]}/>
      <DataTable title="Endpoint workload" hint="Response time ends at the final response chunk; ASGI lifetime also includes background work. RSS rises are process-wide observations; they do not measure memory allocated by an endpoint or business." rows={report.endpoints} columns={[
        { key: 'endpoint', label: 'Route', render: row => <span className="lt-usage-route">{row.method} {row.endpoint}</span> }, { key: 'requests', label: 'Requests', render: row => integer(row.requests) }, { key: 'status_5xx', label: '5xx' }, { key: 'avg_ms', label: 'Avg response', render: row => ms(row.avg_ms) }, { key: 'max_ms', label: 'Max response', render: row => ms(row.max_ms) }, { key: 'avg_work_ms', label: 'Avg ASGI lifetime', render: row => ms(row.avg_work_ms) }, { key: 'response_bytes', label: 'Response data', render: row => usageBytes(row.response_bytes) }, { key: 'observed_rss_max_rise_mb', label: 'Max observed RSS rise', render: row => <>{mb(row.observed_rss_max_rise_mb)}<small>{integer(row.rss_observations)} observations</small></> },
      ]}/>
      <DataTable title="Business request activity" hint="Request volume and response time for business routes. These are workload measurements, not customer counts or business memory allocations." rows={report.businesses} columns={[
        { key: 'business_slug', label: 'Business' }, { key: 'requests', label: 'Requests', render: row => integer(row.requests) }, { key: 'status_5xx', label: '5xx' }, { key: 'avg_ms', label: 'Avg time', render: row => ms(row.avg_ms) }, { key: 'max_ms', label: 'Max time', render: row => ms(row.max_ms) }, { key: 'response_bytes', label: 'Response data', render: row => usageBytes(row.response_bytes) },
      ]}/>
      <DataTable title="Wallet rendering" hint="Work duration excludes time waiting for the rendering slot. Wait time is shown separately. RSS changes include any concurrent activity in this process." rows={report.wallet_jobs} columns={[
        { key: 'operation', label: 'Operation' }, { key: 'calls', label: 'Calls' }, { key: 'failed', label: 'Failed' }, { key: 'avg_ms', label: 'Avg work', render: row => ms(row.avg_ms) }, { key: 'max_ms', label: 'Max work', render: row => ms(row.max_ms) }, { key: 'avg_wait_ms', label: 'Avg wait', render: row => ms(row.avg_wait_ms) }, { key: 'max_wait_ms', label: 'Max wait', render: row => ms(row.max_wait_ms) }, { key: 'observed_rss_max_rise_mb', label: 'Max observed RSS rise', render: row => mb(row.observed_rss_max_rise_mb) },
      ]}/>
      <details className="lt-usage-details"><summary>Recent Wallet jobs ({report.recent_wallet_jobs.length})</summary><DataTable title="Recent Wallet jobs" rows={report.recent_wallet_jobs} columns={[
        { key: 'ts', label: 'Time', render: row => time(row.ts) }, { key: 'business_slug', label: 'Business', render: row => row.business_slug || 'Unassigned' }, { key: 'operation', label: 'Operation' }, { key: 'outcome', label: 'Outcome' }, { key: 'duration_ms', label: 'Work', render: row => ms(row.duration_ms) }, { key: 'wait_ms', label: 'Wait', render: row => ms(row.wait_ms) }, { key: 'observed_rss_change_mb', label: 'Observed RSS change', render: row => mb(row.observed_rss_change_mb) },
      ]}/></details>
      <div className="lt-usage-two-columns"><DataTable title="Wallet caches" hint="Current retained bytes and the configured hard limit for each cache." rows={report.caches} columns={[
        { key: 'name', label: 'Cache' }, { key: 'items', label: 'Items' }, { key: 'bytes', label: 'Used', render: row => usageBytes(row.bytes) }, { key: 'max_bytes', label: 'Limit', render: row => usageBytes(row.max_bytes) },
      ]}/><DataTable title="Retained maps" hint="Tracked in-process maps. Rising counts across readings can help identify growth." rows={report.retained_maps} columns={[{ key: 'name', label: 'Map' }, { key: 'items', label: 'Items' }]}/></div>
      <section className="lt-usage-panel lt-usage-profiling"><header><h3>Python allocation profiling</h3><p>Take a snapshot of retained Python allocations after 30 seconds of tracing, grouped by file and line. These are allocations retained since tracing started, not per-request changes. Native image buffers and all resident memory are not included. Profiling adds overhead while active.</p></header>
        <div className="lt-usage-profile-actions"><button type="button" onClick={startProfile} disabled={profiling || trace.running}>{profiling ? 'Starting capture…' : trace.running ? 'Capture running…' : 'Capture allocations · 30 s'}</button><span>Tracing {trace.enabled ? `on (${trace.source})` : 'off'} · Python heap {mb(current.python_heap_mb)} · Trace overhead {mb(trace.overhead_mb)}</span></div>
        {trace.running && <p role="status" className="lt-usage-notice">Capture running{trace.deadline ? ` until ${time(trace.deadline)}` : ''}. Results update automatically while this tab is visible.</p>}
        {profileMessage && !trace.running && <p role="status" className="lt-usage-notice">{profileMessage}</p>}
        {profileError && <p role="alert" className="lt-usage-error">{profileError}</p>}
        {trace.last_capture ? <><p className="lt-usage-caption">Last capture: {new Date(trace.last_capture.finished_at).toLocaleString()} · {usageValue(trace.last_capture.duration_seconds, ' s')} · Scope: {trace.last_capture.scope}</p>{trace.last_capture.error ? <p className="lt-usage-notice">The last capture could not finish. Try another capture when the server is stable.</p> : <DataTable title="Largest retained Python allocations" hint="Current retained allocations since tracing started. File names and line numbers only; native allocations are excluded." rows={trace.last_capture.top_allocations} empty="No retained allocations were observed in this capture." columns={[{ key: 'file', label: 'File', render: row => <span className="lt-usage-route">{row.file}:{row.line}</span> }, { key: 'bytes', label: 'Retained size', render: row => usageBytes(row.bytes) }, { key: 'count', label: 'Allocations' }]}/>}</> : <p className="lt-usage-caption">No allocation capture completed yet.</p>}
      </section>
      {!!report.notes.length && <div className="lt-usage-notes">{report.notes.map((note, index) => <p key={index}>{note}</p>)}</div>}
      <p className="lt-usage-updated">Reading {new Date(report.generated_at).toLocaleString()} · Refreshes every 30 seconds while visible · No customer profiles are loaded</p>
    </>}
  </section>
}

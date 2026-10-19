import React, { useEffect, useRef, useState } from 'react'
import { validCustomerDemographics } from './customerDemographicsModel'
import './customer-demographics-admin.css'

const number = value => Number(value || 0).toLocaleString()

function Distribution({ title, data }) {
  return <section className="lt-demo-distribution">
    <header><h3>{title}</h3><span>{data.coverage_percent == null ? 'No customers yet' : `${data.coverage_percent}% coverage`}</span></header>
    <p>{number(data.sample_size)} provided · {number(data.missing)} missing or invalid</p>
    {!data.available ? <div className="lt-demo-empty">Not enough publishable data yet. At least 10 valid responses are needed, with small groups protected.</div> : <>
      <div className="lt-demo-bars">{data.rows.map(row => <div key={row.key}>
        <div className="lt-demo-bar-label"><span>{row.label}</span><strong>{row.count == null ? 'Hidden' : `${number(row.count)} · ${row.percent}%`}</strong></div>
        {row.count != null && <div className="lt-demo-bar-track" aria-hidden="true"><span style={{ width: `${row.percent}%` }} /></div>}
      </div>)}</div>
      {data.suppressed && <p className="lt-demo-protected">Some groups are hidden to protect small samples. Visible percentages may not add up to 100%.</p>}
    </>}
    <footer>Percentages use valid responses for this field.</footer>
  </section>
}

export default function CustomerDemographicsAdmin({ authFetch, sessionKey }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const latestFetch = useRef(authFetch)
  latestFetch.current = authFetch
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true); setError(''); setReport(null)
    latestFetch.current('/api/v1/admin/customer-demographics', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.detail || 'Could not load customer demographics.'); if (!validCustomerDemographics(body)) throw new Error('The report response was incomplete. Please reload the report.'); return body })
      .then(body => { if (active) setReport(body) })
      .catch(value => { if (active && value.name !== 'AbortError') setError(value.message || 'Could not load customer demographics.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [reload, sessionKey])
  const summary = report?.summary
  return <section className="lt-admin-demographics">
    <header className="lt-demo-heading">
      <div><p className="lt-demo-eyebrow">CUSTOMERS OF YOUR BUSINESSES</p><h2>Customer demographics</h2><p>Aggregate customer profiles across non-demo businesses. Each business’s customers contribute to the overall mix.</p></div>
      <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>{loading ? 'Loading…' : 'Reload report'}</button>
    </header>
    {loading && <p role="status" className="lt-demo-state">Preparing customer demographics…</p>}
    {error && <p role="alert" className="lt-demo-error">{error}</p>}
    {report && <>
      {report.stale && <p role="status" className="lt-demo-warning">The latest scan could not finish. Showing the last successful report from {new Date(report.generated_at).toLocaleString()}.</p>}
      {!!report.source_fields_missing?.length && <p className="lt-demo-warning">Some fields are unavailable in the saved records. Their coverage is shown below; unavailable fields are not estimated.</p>}
      <div className="lt-demo-metrics">
        <div><span>Business customers</span><strong>{number(summary.customers)}</strong><p>{number(summary.memberships)} customer card memberships</p></div>
        <div><span>Businesses with customers</span><strong>{number(summary.businesses_with_customers)}</strong><p>Out of {number(summary.businesses)} non-demo businesses</p></div>
        <div><span>Avg. customers / business</span><strong>{summary.average_customers_per_business == null ? '—' : number(summary.average_customers_per_business)}</strong><p>Includes businesses with no customers</p></div>
        <div><span>Largest age group</span><strong>{report.age.largest_group?.label || '—'}</strong><p>{report.age.largest_group ? `${report.age.largest_group.percent}% of valid age responses` : 'No publishable leading group yet'}</p></div>
      </div>
      <div className="lt-demo-chart-grid"><Distribution title="Age groups" data={report.age} /><Distribution title="Gender responses" data={report.gender} /><Distribution title="Occupation" data={report.occupation} /></div>
      <div className="lt-demo-methodology">
        <h3>How to read this report</h3>
        <p>{report.methodology.counting}</p><p>{report.methodology.age}</p><p>{report.methodology.responses}</p>
        <p>{number(summary.employee_memberships_excluded)} employee-only card memberships excluded. {number(summary.unlinked_memberships)} legacy memberships have no shared identity.</p>
        <p>{report.methodology.location}</p>
      </div>
      <p className="lt-demo-updated">Generated {new Date(report.generated_at).toLocaleString()} · Cached for up to 5 minutes · Aggregate counts only</p>
    </>}
  </section>
}

import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AdminDashboard from '../src/components/AdminDashboard'
import reports from './customer-demographics-sample.json'

if (!import.meta.env.DEV) {
  document.getElementById('root').textContent = 'This local preview is unavailable in production.'
} else {
  let scenario = 'complete'
  let reportCalls = 0
  // Fixture transport only. No native fetch, credentials or customer records.
  window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), window.location.origin)
    const done = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    if (options.method && options.method !== 'GET') return done({ detail: 'Writes are disabled in this local preview.' }, 403)
    if (url.pathname === '/__admin-fixtures/api/v1/admin/customer-demographics') {
      reportCalls += 1
      window.dispatchEvent(new Event('demographics-fixture-request'))
      return scenario === 'error' ? done({ detail: 'Customer demographics are temporarily unavailable. Please try again shortly.' }, 503) : done(scenario === 'malformed' ? {} : reports[scenario])
    }
    if (url.pathname === '/__admin-fixtures/api/v1/admin/overview') return done({ total_businesses: 3, total_customers: 60 })
    if (url.pathname === '/__admin-fixtures/api/v1/admin/plans') return done({})
    if (url.pathname.startsWith('/__admin-fixtures/api/v1/admin/')) return done([])
    return done({ detail: 'Unmatched route blocked by the local fixture.' }, 501)
  }
  function Preview() {
    const [current, setCurrent] = useState('complete')
    const [calls, setCalls] = useState(0)
    React.useEffect(() => { const update = () => setCalls(reportCalls); window.addEventListener('demographics-fixture-request', update); return () => window.removeEventListener('demographics-fixture-request', update) }, [])
    return <>
      <aside style={{ background: '#173f35', color: '#fff', padding: '12px 20px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <strong>Local admin preview · Fictional aggregate data</strong>
        <label>Report scenario <select aria-label="Report scenario" value={current} onChange={event => { scenario = event.target.value; setCurrent(scenario) }}><option value="complete">Complete data</option><option value="small">Small sample</option><option value="stale">Cached data</option><option value="error">Upstream unavailable</option><option value="malformed">Incomplete response</option></select></label>
        <span>Report API calls: {calls}</span>
      </aside>
      <AdminDashboard API_BASE="/__admin-fixtures" user={{ token: 'local-admin-fixture', role: 'admin' }} onLogout={() => {}} />
      <p style={{ margin: 24, fontSize: 12, color: '#64748b' }}>After changing the scenario, use Reload report. No live business data is loaded.</p>
    </>
  }
  createRoot(document.getElementById('root')).render(<Preview />)
}

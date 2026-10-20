import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import SystemUsageAdmin from '../src/components/SystemUsageAdmin'
import reports from './system-usage-sample.json'

if (!import.meta.env.DEV) {
  document.getElementById('root').textContent = 'This local preview is unavailable in production.'
} else {
  // Fully fake transport: no native fetch, credentials, live reads or writes.
  let scenario = 'complete'
  let profileStatus = 'success'
  let calls = 0
  let captureDeadline = 0
  const fixtureFetch = async (input, options = {}) => {
    calls += 1
    window.dispatchEvent(new Event('usage-fixture-request'))
    const url = new URL(String(input), window.location.origin)
    const done = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    if (url.pathname === '/api/v1/admin/system-usage/profile' && options.method === 'POST') {
      if (profileStatus !== 'success') return done({ detail: 'Simulated profile error; never show raw server details.' }, Number(profileStatus))
      captureDeadline = Date.now() + 30000
      return done({ running: true }, 202)
    }
    if (url.pathname !== '/api/v1/admin/system-usage' || (options.method && options.method !== 'GET')) return done({}, 403)
    if (scenario === 'error') return done({ detail: 'Simulated server error; never show raw server details.' }, 503)
    if (scenario === 'malformed') return done({ process: {} })
    const report = structuredClone(reports[scenario])
    if (captureDeadline > Date.now()) {
      report.trace.enabled = true; report.trace.source = 'manual'; report.trace.running = true
      report.trace.started_at = new Date(captureDeadline - 30000).toISOString(); report.trace.deadline = new Date(captureDeadline).toISOString()
    }
    return done(report)
  }
  window.fetch = async () => new Response('{}', { status: 403 })
  function Preview() {
    const [current, setCurrent] = useState('complete')
    const [profile, setProfile] = useState('success')
    const [requests, setRequests] = useState(0)
    React.useEffect(() => { const update = () => setRequests(calls); window.addEventListener('usage-fixture-request', update); update(); return () => window.removeEventListener('usage-fixture-request', update) }, [])
    return <><aside style={{ background: '#173f35', color: '#fff', padding: '12px 20px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, fontSize: 12 }}>
      <strong>Local preview · Fictional measurements</strong>
      <label>Scenario <select aria-label="Report scenario" value={current} onChange={event => { scenario = event.target.value; setCurrent(scenario) }}><option value="complete">Complete</option><option value="empty">No observations</option><option value="unavailable">Partial measurements</option><option value="error">Server unavailable</option><option value="malformed">Incomplete report</option></select></label>
      <label>Capture response <select aria-label="Capture response" value={profile} onChange={event => { profileStatus = event.target.value; setProfile(profileStatus) }}><option value="success">Success</option><option value="403">403</option><option value="409">409</option><option value="503">503</option></select></label><span>Fixture calls: {requests}</span>
    </aside><main style={{ maxWidth: 1260, margin: '20px auto', padding: '0 12px' }}><SystemUsageAdmin authFetch={fixtureFetch} sessionKey="local-fixture"/></main><p style={{ margin: 24, fontSize: 12, color: '#64748b' }}>Change the scenario, then use Refresh. All data and capture responses are fictional.</p></>
  }
  createRoot(document.getElementById('root')).render(<Preview/> )
}

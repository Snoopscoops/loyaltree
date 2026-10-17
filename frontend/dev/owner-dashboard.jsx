import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import OwnerDashboard from '../src/components/OwnerDashboard.jsx'
import AnalyticsDashboard from '../src/components/AnalyticsDashboard.jsx'
import { createFixtureTransport, fixtureSlug, fixtureUser, qrImage, scenarios } from './owner-dashboard-fixtures.js'

// The dev HTML is deliberately not an App route or a production build entry.
// The guard also prevents accidental rendering through a production import.
if (!import.meta.env.DEV) {
  document.getElementById('root').textContent = 'This test workspace is available only in the local development server.'
} else {
  const params = new URLSearchParams(window.location.search)
  const scenario = scenarios.includes(params.get('scenario')) ? params.get('scenario') : 'stamp'
  const refresh = params.get('design') !== 'legacy'
  const records = []
  const addRecord = record => { records.push(record); if (records.length > 400) records.shift(); window.dispatchEvent(new Event('owner-fixture-request')) }
  // Install synchronously before React renders. No native transport is retained.
  window.fetch = createFixtureTransport({ scenario, onRequest: addRecord })
  // Direct QR <img> requests are blocked by CSP, then replaced locally. This
  // keeps wallet previews useful without sending sample identifiers to a vendor.
  new MutationObserver(() => {
    document.querySelectorAll('img[src^="https://api.qrserver.com/"]').forEach(img => { img.src = qrImage })
  }).observe(document.getElementById('root'), { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  window.open = url => { addRecord({ ts: new Date().toISOString(), method: 'OPEN', path: String(url || 'empty preview window'), status: 'blocked' }); return null }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]')
    if (!link) return
    const target = new URL(link.href, window.location.href)
    if (target.origin !== window.location.origin && !['blob:', 'data:'].includes(target.protocol)) {
      event.preventDefault()
      addRecord({ ts: new Date().toISOString(), method: 'LINK', path: target.pathname, status: 'blocked' })
    }
  }, true)
  localStorage.setItem(`loyaltree_onboarding_seen_${fixtureSlug}`, '1')
  // The fixture has its own fake business storage key; no live session is read.
  localStorage.removeItem(`loyaltree_selected_program_${fixtureSlug}`)
  const API_BASE = `${window.location.origin}/__owner-fixtures`

  class FixtureBoundary extends React.Component {
    state = { error: '' }
    static getDerivedStateFromError(error) { return { error: error.message } }
    render() { return this.state.error ? <section role="alert" style={{ padding: 32 }}><h1>Local fixture error</h1><p>{this.state.error}</p><p>Production services were not contacted.</p></section> : this.props.children }
  }

  function ScannerPlaceholder() {
    const { state } = useLocation()
    const navigate = useNavigate()
    return <main style={{ padding: 32, maxWidth: 700, margin: 'auto' }}><h1>Scanner navigation verified</h1><p>This local route never opens a camera or records customer activity.</p><dl><dt>Owner mode</dt><dd>{String(state?.ownerMode === true)}</dd><dt>Business</dt><dd>{state?.businessSlug || 'None'}</dd><dt>Program</dt><dd>{state?.programPublicId || 'None'}</dd></dl><button onClick={() => navigate('/dashboard')}>Back to dashboard</button></main>
  }

  function FixtureWorkspace() {
    const [requestLog, setRequestLog] = useState([...records])
    const [logOpen, setLogOpen] = useState(false)
    const [signedOut, setSignedOut] = useState(false)
    const navigate = useNavigate()
    const location = useLocation()
    useEffect(() => {
      const update = () => setRequestLog([...records])
      window.addEventListener('owner-fixture-request', update)
      return () => window.removeEventListener('owner-fixture-request', update)
    }, [])
    useEffect(() => {
      const controls = document.querySelector('.lt-fixture-tools')
      const measure = () => document.documentElement.style.setProperty('--lt-fixture-tools-height', `${controls.getBoundingClientRect().height}px`)
      const observer = new ResizeObserver(measure)
      observer.observe(controls)
      measure()
      return () => { observer.disconnect(); document.documentElement.style.removeProperty('--lt-fixture-tools-height') }
    }, [])
    const change = (key, value) => {
      const query = new URLSearchParams(window.location.search)
      query.set(key, value)
      window.location.assign(`${window.location.pathname}?${query}`)
    }
    return <>
      <style>{`
        .lt-fixture-tools{position:sticky;top:0;z-index:10000;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 16px;background:#102d25;color:#fff;font-size:11px;border-bottom:1px solid #648a70}
        .lt-fixture-tools~.lt-owner-refresh .lt-owner-sidebar{top:var(--lt-fixture-tools-height,48px)}
        .lt-fixture-tools label{display:flex;align-items:center;gap:6px}.lt-fixture-tools button,.lt-fixture-tools select{padding:6px 9px;border:1px solid #557566;border-radius:6px;background:#173f35;color:white;font-size:11px}
        .lt-fixture-tools button:focus-visible,.lt-fixture-tools select:focus-visible{outline:3px solid #d7e6ba;outline-offset:2px}.lt-fixture-tools small{color:#ccdbd0;margin-left:auto}
        .lt-fixture-log{position:fixed;inset:0;z-index:12000;background:#10251ecc;display:flex;align-items:center;justify-content:center;padding:20px}
        .lt-fixture-log section{background:white;color:#173f35;width:min(900px,100%);max-height:85vh;overflow:auto;border-radius:12px;padding:20px}.lt-fixture-log header{display:flex;justify-content:space-between;gap:20px;align-items:center}.lt-fixture-log h2{margin:0}.lt-fixture-log table{width:100%;border-collapse:collapse;font-size:11px;overflow-wrap:anywhere}.lt-fixture-log td,.lt-fixture-log th{text-align:left;padding:9px 6px;border-bottom:1px solid #e0e6df}.lt-fixture-log td:first-child{white-space:nowrap}.lt-fixture-log button{padding:8px 12px}
        @media(max-width:600px){.lt-fixture-tools{gap:7px;padding:8px 10px}.lt-fixture-tools small{display:none}.lt-fixture-tools strong{width:100%}.lt-fixture-log{padding:8px}.lt-fixture-log section{padding:12px}}
      `}</style>
      <aside className="lt-fixture-tools" aria-label="Local test workspace controls">
        <strong>Local test workspace</strong>
        <label>Card scenario<select aria-label="Card scenario" value={scenario} onChange={e => change('scenario', e.target.value)}>{scenarios.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Dashboard design<select aria-label="Dashboard design" value={refresh ? 'refresh' : 'legacy'} onChange={e => change('design', e.target.value)}><option value="refresh">Refresh</option><option value="legacy">Existing</option></select></label>
        <button onClick={() => setLogOpen(true)}>Request log ({requestLog.length})</button>
        {location.pathname !== '/dashboard' && <button onClick={() => navigate('/dashboard')}>Dashboard</button>}
        <small>Fictional data · No charges or wallet pushes</small>
      </aside>
      <FixtureBoundary>
        {signedOut ? <main style={{ padding: 32 }}><h1>Local logout verified</h1><button onClick={() => setSignedOut(false)}>Return to sample owner</button></main> : <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<OwnerDashboard API_BASE={API_BASE} user={fixtureUser} onLogout={() => setSignedOut(true)} designPreview={refresh ? true : 'legacy'} />} />
          <Route path="/analytics" element={<AnalyticsDashboard API_BASE={API_BASE} user={fixtureUser} designPreview={refresh ? true : 'legacy'} />} />
          <Route path="/scanner" element={<ScannerPlaceholder />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>}
      </FixtureBoundary>
      {logOpen && <div className="lt-fixture-log" onClick={() => setLogOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="fixture-log-title" onClick={e => e.stopPropagation()}><header><h2 id="fixture-log-title">Captured local requests</h2><button autoFocus onClick={() => setLogOpen(false)}>Close request log</button></header><p>All API responses are fictional. Unmatched routes are blocked locally. Headers and request bodies are never recorded here.</p><table><thead><tr><th>Method</th><th>Route</th><th>Result</th></tr></thead><tbody>{requestLog.map((record, i) => <tr key={i}><td>{record.method}</td><td>{record.path}</td><td>{record.status}</td></tr>)}</tbody></table></section></div>}
    </>
  }
  const root = createRoot(document.getElementById('root'))
  root.render(<MemoryRouter initialEntries={['/dashboard']}><FixtureWorkspace /></MemoryRouter>)
  if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
}

import React, { useEffect, useRef, useState } from 'react'
import { QRMenuBrowser } from './QRMenuPage'
import MenuPaymentsSetup from './MenuPaymentsSetup'
import { validMenuPayload } from './qrMenuModel'
import { requestJsonResponse } from './requestTimeout'
import './qr-menu.css'

export default function QRMenuSection({ API_BASE, user, business, authFetch, renderBuilder, onUpgrade }) {
  const [tab, setTab] = useState('builder')
  const [setup, setSetup] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const scope = useRef(new AbortController())
  const slug = user.business_slug
  const base = `${API_BASE}/api/v1/business/${encodeURIComponent(slug)}/qr-menu`
  const load = async () => {
    const signal = scope.current.signal
    setError('')
    try {
      const { response, payload } = await requestJsonResponse(authFetch, base, { signal })
      const data = payload || {}
      if (!response.ok) { setLocked(response.status === 403); throw new Error(data.detail || 'Could not load QR Menu') }
      if (!Array.isArray(data.branches)) throw new Error('Could not load QR Menu. Please try again.')
      setSetup(data)
      setLocked(false)
    } catch (value) { if (!signal.aborted) setError(value.message) }
  }
  useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    setSetup(null); setPreview(null); setSaving(false); setLocked(false); load()
    return () => controller.abort()
  }, [base, user.token])
  const loadPreview = async () => {
    const signal = scope.current.signal
    setError(''); setPreview(null)
    try {
      const { response, payload } = await requestJsonResponse(authFetch, `${base}/preview`, { cache: 'no-store', signal })
      const data = payload || {}
      if (!response.ok || !validMenuPayload(data)) throw new Error(data.detail || 'Could not load preview')
      setPreview(data)
    } catch (value) { if (!signal.aborted) setError(value.message) }
  }
  const chooseTab = value => { setTab(value); if (value === 'preview') loadPreview() }
  const publish = async () => {
    const signal = scope.current.signal
    setSaving(true); setError(''); setNotice('')
    try {
      const { response, payload } = await requestJsonResponse(authFetch, base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_published: !setup.is_published }), signal })
      const data = payload || {}
      if (!response.ok || !Array.isArray(data.branches)) throw new Error(data.detail || 'Could not save publication. Refresh the menu before trying again.')
      setSetup(data)
      setNotice(data.is_published ? 'Your QR Menu is published. You can share the same QR whenever your menu changes.' : 'Your QR Menu is unpublished. You can publish it again using the same QR.')
    } catch (value) { if (!signal.aborted) setError(value.message) }
    finally { if (!signal.aborted) setSaving(false) }
  }
  if (locked) return <section className="lt-qr-owner"><p className="lt-qr-eyebrow"><span>Growth & Pro</span></p><h2>Your menu, one scan away.</h2><p>{error}</p><button type="button" className="lt-qr-primary" onClick={onUpgrade}>View plans</button></section>
  return <section className="lt-qr-owner">
    <header className="lt-qr-owner-header">
      <div>
        <p className="lt-qr-eyebrow"><span>Growth & Pro</span><i className="lt-qr-dot" /><span>Digital Pass & Order Suite</span></p>
        <h2>QR Menu</h2>
        <p>A welcoming, instant-load digital menu for anyone who scans your QR stand. No account or download needed.</p>
      </div>
      {setup && <div className="lt-qr-publish-controls">
        <span className={`lt-qr-status${setup.is_published ? ' is-live' : ''}`}>{setup.is_published ? 'Published · Live' : 'Not published'}</span>
        {setup.public_url && <a className="lt-qr-quiet" href={setup.public_url} target="_blank" rel="noreferrer">View menu</a>}
        <button type="button" className="lt-qr-primary" disabled={saving} onClick={publish}>{saving ? 'Saving…' : setup.is_published ? 'Unpublish menu' : 'Publish menu'}</button>
      </div>}
    </header>
    {error && <div className="lt-qr-error" role="alert">{error} <button type="button" onClick={tab === 'preview' ? loadPreview : load}>Try again</button></div>}
    {notice && <p role="status" className="lt-qr-owner-notice">{notice}</p>}
    {!setup ? !error && <p role="status">Loading QR Menu…</p> : <>
      <div className="lt-qr-owner-tabs" aria-label="QR Menu sections">
        <button type="button" aria-pressed={tab === 'builder'} onClick={() => chooseTab('builder')}>Menu builder</button>
        <button type="button" aria-pressed={tab === 'preview'} onClick={() => chooseTab('preview')}>Customer preview</button>
        <button type="button" aria-pressed={tab === 'share'} onClick={() => chooseTab('share')}>Payments <span className="lt-qr-chip">Order Ahead</span></button>
      </div>
      {tab === 'builder' && <>
        <div className="lt-qr-sync"><p>This is your shared live catalog. Saved changes also appear in <b>Order Ahead</b> wherever it is enabled.</p></div>
        <div className="lt-qr-catalog-editor">{renderBuilder(() => { setPreview(null) })}</div>
      </>}
      {tab === 'preview' && <div className="lt-qr-preview-frame"><p className="lt-qr-preview-caption">What customers see</p>{preview ? <QRMenuBrowser data={preview} preview /> : !error && <p className="lt-qr-preview-caption" role="status">Loading customer preview…</p>}</div>}
      {tab === 'share' && <MenuPaymentsSetup API_BASE={API_BASE} slug={slug} authFetch={authFetch} />}
    </>}
  </section>
}

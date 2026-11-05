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
    const signal=scope.current.signal
    setError('')
    try { const {response,payload} = await requestJsonResponse(authFetch,base,{signal}); const data=payload||{}; if (!response.ok) { setLocked(response.status === 403); throw new Error(data.detail || 'Could not load QR Menu') }; if(!Array.isArray(data.branches))throw new Error('Could not load QR Menu. Please try again.'); setSetup(data); setLocked(false) }
    catch (value) { if(!signal.aborted)setError(value.message) }
  }
  useEffect(() => {
    const controller=new AbortController();scope.current=controller
    setSetup(null);setPreview(null);setSaving(false);setLocked(false);load()
    return()=>controller.abort()
  }, [base, user.token])
  const loadPreview = async () => {
    const signal=scope.current.signal
    setError(''); setPreview(null)
    try { const {response,payload} = await requestJsonResponse(authFetch,`${base}/preview`, { cache: 'no-store',signal }); const data=payload||{}; if (!response.ok || !validMenuPayload(data)) throw new Error(data.detail || 'Could not load preview'); setPreview(data) }
    catch (value) { if(!signal.aborted)setError(value.message) }
  }
  const chooseTab = value => { setTab(value); if (value === 'preview') loadPreview() }
  const publish = async () => {
    const signal=scope.current.signal
    setSaving(true); setError(''); setNotice('')
    try { const {response,payload} = await requestJsonResponse(authFetch,base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_published: !setup.is_published }),signal }); const data=payload||{}; if (!response.ok || !Array.isArray(data.branches)) throw new Error(data.detail || 'Could not save publication. Refresh the menu before trying again.'); setSetup(data); setNotice(data.is_published ? 'Your QR Menu is published. You can share the same QR whenever your menu changes.' : 'Your QR Menu is unpublished. You can publish it again using the same QR.') }
    catch (value) { if(!signal.aborted)setError(value.message) }
    finally { if(!signal.aborted)setSaving(false) }
  }
  if (locked) return <section className="lt-qr-owner"><p className="lt-qr-eyebrow">GROWTH & PRO</p><h2>Your menu, one scan away.</h2><p>{error}</p><button type="button" className="lt-qr-primary" onClick={onUpgrade}>View plans</button></section>
  return <section className="lt-qr-owner">
    <header className="lt-qr-owner-header"><div><p className="lt-qr-eyebrow">GROWTH & PRO</p><h2>QR Menu</h2><p>A welcoming menu for anyone who scans. No customer account needed.</p></div>{setup && <div className="lt-qr-publish-controls"><span className={`lt-qr-status${setup.is_published ? ' is-live' : ''}`}>{setup.is_published ? 'Published' : 'Not published'}</span><button type="button" className="lt-qr-primary" disabled={saving} onClick={publish}>{saving ? 'Saving…' : setup.is_published ? 'Unpublish menu' : 'Publish menu'}</button></div>}</header>
    {error && <div className="lt-qr-error" role="alert">{error} <button type="button" onClick={tab === 'preview' ? loadPreview : load}>Try again</button></div>}
    {notice && <p role="status" className="lt-qr-owner-notice">{notice}</p>}
    {!setup ? !error && <p role="status">Loading QR Menu…</p> : <>
      <div className="lt-qr-owner-tabs" aria-label="QR Menu sections">{[['builder','Menu builder'],['preview','Customer preview'],['share','Payments']].map(([value,label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => chooseTab(value)}>{label}</button>)}</div>
      {tab === 'builder' && <><p className="lt-qr-owner-hint">This is your shared menu catalog. Saved changes also appear in Order Ahead wherever it is enabled.</p><div className="lt-qr-catalog-editor">{renderBuilder(() => { setPreview(null) })}</div></>}
      {tab === 'preview' && <div className="lt-qr-preview-frame"><p className="lt-qr-preview-caption">What customers see</p>{preview ? <QRMenuBrowser data={preview} preview /> : !error && <p className="lt-qr-preview-caption" role="status">Loading customer preview…</p>}</div>}
      {tab === 'share' && <MenuPaymentsSetup API_BASE={API_BASE} slug={slug} authFetch={authFetch} />}
    </>}
  </section>
}

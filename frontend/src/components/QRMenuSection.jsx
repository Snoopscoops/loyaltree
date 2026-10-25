import React, { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { QRMenuBrowser } from './QRMenuPage'
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
  const [branch, setBranch] = useState('')
  const [notice, setNotice] = useState('')
  const qr = useRef(null)
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
  const url = setup?.branches.find(value => value.public_id === branch)?.public_url || setup?.public_url || ''
  const download = () => {
    const svg = qr.current?.querySelector('svg')
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = objectUrl; anchor.download = `loyalty-tree-menu-${slug}${branch ? `-${branch}` : ''}.svg`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
  const copy = async () => { try { await navigator.clipboard.writeText(url); setNotice('Menu link copied.') } catch { setNotice('Select and copy the menu link below.') } }
  if (locked) return <section className="lt-qr-owner"><p className="lt-qr-eyebrow">GROWTH & PRO</p><h2>Your menu, one scan away.</h2><p>{error}</p><button type="button" className="lt-qr-primary" onClick={onUpgrade}>View plans</button></section>
  return <section className="lt-qr-owner">
    <header className="lt-qr-owner-header"><div><p className="lt-qr-eyebrow">GROWTH & PRO</p><h2>QR Menu</h2><p>A welcoming menu for anyone who scans. No customer account needed.</p></div>{setup && <div className="lt-qr-publish-controls"><span className={`lt-qr-status${setup.is_published ? ' is-live' : ''}`}>{setup.is_published ? 'Published' : 'Not published'}</span><button type="button" className="lt-qr-primary" disabled={saving} onClick={publish}>{saving ? 'Saving…' : setup.is_published ? 'Unpublish menu' : 'Publish menu'}</button></div>}</header>
    {error && <div className="lt-qr-error" role="alert">{error} <button type="button" onClick={tab === 'preview' ? loadPreview : load}>Try again</button></div>}
    {notice && <p role="status" className="lt-qr-owner-notice">{notice}</p>}
    {!setup ? !error && <p role="status">Loading QR Menu…</p> : <>
      <div className="lt-qr-owner-tabs" aria-label="QR Menu sections">{[['builder','Menu builder'],['preview','Customer preview'],['share','QR & sharing']].map(([value,label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => chooseTab(value)}>{label}</button>)}</div>
      {tab === 'builder' && <><p className="lt-qr-owner-hint">This is your shared menu catalog. Saved changes also appear in Order Ahead wherever it is enabled.</p><div className="lt-qr-catalog-editor">{renderBuilder(() => { setPreview(null) })}</div></>}
      {tab === 'preview' && <div className="lt-qr-preview-frame">{preview ? <QRMenuBrowser data={preview} preview /> : !error && <p role="status">Loading customer preview…</p>}</div>}
      {tab === 'share' && <div className="lt-qr-share-layout"><div className="lt-qr-share-copy"><h3>One QR. Your latest menu.</h3><p>Print it once. Item, price, and availability changes appear on the same link.</p>{!setup.is_published && <p className="lt-qr-owner-hint">Publish your menu before customers can open this QR.</p>}<label>QR destination<select aria-label="QR destination" value={branch} onChange={event => setBranch(event.target.value)}><option value="">Business menu · choose a location</option>{setup.branches.map(value => <option key={value.public_id} value={value.public_id}>{value.name}</option>)}</select></label><label>Public menu link<input aria-label="Public menu link" readOnly value={url} onFocus={event => event.target.select()} /></label><div className="lt-qr-share-actions"><button type="button" onClick={copy}>Copy link</button><a href={url} target="_blank" rel="noreferrer">Open menu ↗</a><button type="button" onClick={download}>Download QR (SVG)</button></div><p className="lt-qr-owner-hint">Put the QR on your counter, tables, or social posts. Browsing does not issue stamps or create orders.</p></div><div className="lt-qr-print-card"><p className="lt-qr-eyebrow">TAKE A LOOK</p><h3>{business.name || business.business_name || 'Our menu'}</h3><div ref={qr}><QRCodeSVG value={url} size={210} level="M" includeMargin title="Scan to view our menu" /></div><strong>Scan for our menu</strong><p>Fresh favorites, one scan away.</p><small>Powered by Loyalty Tree</small></div></div>}
    </>}
  </section>
}

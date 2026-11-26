import React, { useEffect, useState } from 'react'
import './customer-dashboard.css'
import { NativeBookingOwner } from './NativeBookings.jsx'
import { tiktokUrl, isTikTokLink } from './guestTikTok.js'

const EMPTY = {
  cover_url: '',
  wifi_published: false,
  wifi_name: '',
  wifi_password: '',
  socials_published: false,
  links: [],
  instagram_url: '',
  facebook_url: '',
  tiktok_url: '',
  review_url: '',
  book_published: false,
  book_url: '',
  book_note: '',
  reserve_published: false,
  reserve_url: '',
}

function socialKind(link) {
  if (isTikTokLink(link)) return 'tiktok'
  const text = `${link?.label || ''} ${link?.url || ''}`.toLowerCase()
  if (text.includes('instagram')) return 'instagram'
  if (text.includes('facebook') || text.includes('fb.com') || text.includes('fb.me')) return 'facebook'
  return ''
}

function socialFields(data) {
  const links = Array.isArray(data?.links) ? data.links : []
  const pick = kind => links.find(link => socialKind(link) && socialKind(link) === kind)?.url || ''
  return { instagram_url: pick('instagram'), facebook_url: pick('facebook'), tiktok_url: pick('tiktok') }
}

function socialPayload(form) {
  const links = (Array.isArray(form.links) ? form.links : []).filter(link => !socialKind(link))
  const instagram = String(form.instagram_url || '').trim()
  const facebook = String(form.facebook_url || '').trim()
  if (instagram) links.push({ label: 'Instagram', url: instagram })
  if (facebook) links.push({ label: 'Facebook', url: facebook })
  const tiktok = String(form.tiktok_url || '').trim()
  if (tiktok && !tiktokUrl(tiktok)) throw new Error('Enter a valid HTTPS TikTok link (tiktok.com).')
  if (tiktok) links.push({ label: 'TikTok', url: tiktok })
  if (links.length > 4) throw new Error('Maximum four social links. Contact support to remove an unlisted link.')
  const { instagram_url, facebook_url, tiktok_url, ...rest } = form
  return { ...rest, links }
}

function detailOf(data, fallback) {
  return typeof data?.detail === 'string' ? data.detail : fallback
}

function StatusBox({ on, onText, offText, detail, onToggle }) {
  return (
    <div className="lt-cd-status">
      <div>
        <b>{on ? onText : offText}</b>
        <span>{detail}</span>
      </div>
      <button type="button" className={on ? 'lt-cd-outline' : 'lt-cd-show'} onClick={onToggle}>{on ? 'Hide' : 'Show'}</button>
    </div>
  )
}

export default function CustomerDashboard({ API_BASE, user, onOpen }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const authFetch = (url, options = {}) => fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${user.token}` },
  })

  const load = async () => {
    setError('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/guest-page`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not load the customer dashboard'))
      setForm({
        ...EMPTY,
        ...data,
        links: Array.isArray(data.links) ? data.links : [],
        ...socialFields(data),
      })
      setDirty(false)
    } catch (err) {
      setError(err.message || 'Could not load the customer dashboard')
    }
  }

  useEffect(() => {
    if (user?.business_slug && user?.token) load()
  }, [user?.business_slug, user?.token])

  const patch = next => { setForm(current => ({ ...current, ...next })); setDirty(true); setStatus('') }

  const uploadCover = async file => {
    if (!file) return
    setSaving(true)
    setStatus('')
    try {
      const sr = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/cloudinary-signature?purpose=branding`, { method: 'POST' })
      const sig = await sr.json()
      if (!sr.ok) throw new Error(detailOf(sig, 'Could not prepare the photo'))
      const body = new FormData()
      body.append('file', file)
      body.append('api_key', sig.api_key)
      body.append('timestamp', sig.timestamp)
      body.append('signature', sig.signature)
      body.append('upload_preset', sig.upload_preset)
      body.append('folder', sig.folder)
      const ur = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, { method: 'POST', body })
      const up = await ur.json()
      if (!ur.ok) throw new Error(up.error?.message || 'Photo upload failed')
      patch({ cover_url: up.secure_url || up.url || '' })
      setStatus('Photo added. Save to show it on the scan page.')
    } catch (err) {
      setStatus(err.message || 'Photo upload failed')
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setStatus('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/guest-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(socialPayload(form)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not save'))
      setForm({ ...EMPTY, ...data, links: data.links || [], ...socialFields(data) })
      setDirty(false)
      setStatus('Saved. Customers will see this the next time they scan.')
    } catch (err) {
      setStatus(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <section className="lt-cd"><p className="lt-cd-status-line bad">{error}</p><button className="lt-cd-retry" onClick={load}>Try again</button></section>
  if (!form) return <section className="lt-cd"><p className="lt-cd-hint">Loading customer dashboard...</p></section>

  const good = status.startsWith('Saved') || status.startsWith('Photo added')

  return (
    <section className="lt-cd" aria-label="Customer dashboard">
      <header className="lt-cd-head">
        <p className="lt-cd-kicker">Customer dashboard</p>
        <h1>What people see after they scan</h1>
        <p>Edit one part at a time. Digital Menu, Digital Billboard, and LT Points stay in their own pages.</p>
      </header>

      <section className="lt-cd-card">
        <h2 className="lt-cd-step">1 · Cover photo</h2>
        <p className="lt-cd-note">The wide photo at the top of the scan page. Leave it empty to use the loyalty card photo.</p>
        {form.cover_url
          ? <img className="lt-cd-cover" src={form.cover_url} alt="" />
          : <div className="lt-cd-cover lt-cd-cover-empty">No cover photo yet. The loyalty card photo will be used.</div>}
        <div className="lt-cd-row">
          <label className="lt-cd-file">
            {form.cover_url ? 'Replace photo' : 'Add photo'}
            <input type="file" accept="image/*" hidden disabled={saving} onChange={e => { uploadCover(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {form.cover_url ? <button type="button" className="lt-cd-remove" onClick={() => patch({ cover_url: '' })}>Remove</button> : null}
        </div>
      </section>

      <section className="lt-cd-card">
        <h2 className="lt-cd-step">2 · Wi-Fi</h2>
        <StatusBox
          on={form.wifi_published}
          onText="Shown on the scan page"
          offText="Hidden"
          detail="Anyone who scans the QR can see the password."
          onToggle={() => patch({ wifi_published: !form.wifi_published })}
        />
        <label className="lt-cd-field">Network name
          <input maxLength={80} value={form.wifi_name} onChange={e => patch({ wifi_name: e.target.value })} placeholder="Cafe Wi-Fi" />
        </label>
        <label className="lt-cd-field">Password
          <input maxLength={80} value={form.wifi_password} onChange={e => patch({ wifi_password: e.target.value })} placeholder="Optional" />
        </label>
      </section>

      <section className="lt-cd-card">
        <h2 className="lt-cd-step">3 · Socials and reviews</h2>
        <StatusBox
          on={form.socials_published}
          onText="Shown on the scan page"
          offText="Hidden"
          detail="Use full links that start with https://"
          onToggle={() => patch({ socials_published: !form.socials_published })}
        />
        <label className="lt-cd-field">Instagram
          <input value={form.instagram_url} onChange={e => patch({ instagram_url: e.target.value })} placeholder="https://instagram.com/yourplace" />
        </label>
        <label className="lt-cd-field">Facebook
          <input value={form.facebook_url} onChange={e => patch({ facebook_url: e.target.value })} placeholder="https://facebook.com/yourplace" />
        </label>
        <label className="lt-cd-field">TikTok
          <input type="url" inputMode="url" autoCapitalize="none" maxLength={300} value={form.tiktok_url} onChange={e => patch({ tiktok_url: e.target.value })} placeholder="https://www.tiktok.com/@yourplace" />
        </label>
        <label className="lt-cd-field">Google review
          <input value={form.review_url} onChange={e => patch({ review_url: e.target.value })} placeholder="https://g.page/..." />
        </label>
        <p className="lt-cd-hint">Leave one blank to hide it. Customers see a logo, not a text link.</p>
      </section>

      <NativeBookingOwner key={user.business_slug} API_BASE={API_BASE} user={user} />
      <details className="lt-cd-card">
        <summary className="lt-cd-step" style={{cursor:"pointer"}}>Advanced · External reservation links</summary>
        <p className="lt-cd-hint">Optional: keep your existing external booking pages. Native booking settings above are saved separately.</p>
        <h2 className="lt-cd-step">Book our place</h2>
        <StatusBox
          on={form.book_published}
          onText="Shown on the menu"
          offText="Hidden"
          detail="Opens your events or venue page. Use a link that starts with https://"
          onToggle={() => patch({ book_published: !form.book_published })}
        />
        <label className="lt-cd-field">Link
          <input value={form.book_url} onChange={e => patch({ book_url: e.target.value })} placeholder="https://..." />
        </label>
        <label className="lt-cd-field">Short note
          <input maxLength={40} value={form.book_note} onChange={e => patch({ book_note: e.target.value })} placeholder="Events and space" />
        </label>
        <h2 className="lt-cd-step" style={{marginTop:24}}>Reserve a table</h2>
        <StatusBox
          on={form.reserve_published}
          onText="Shown on the menu"
          offText="Hidden"
          detail="Opens your reservation page."
          onToggle={() => patch({ reserve_published: !form.reserve_published })}
        />
        <label className="lt-cd-field">Link
          <input value={form.reserve_url} onChange={e => patch({ reserve_url: e.target.value })} placeholder="https://..." />
        </label>
      </details>

      <section className="lt-cd-card">
        <h2 className="lt-cd-step">Already on the scan page</h2>
        <div className="lt-cd-pills">
          <button type="button" className="lt-cd-pill" onClick={() => onOpen?.('qrmenu')}>Digital Menu</button>
          <button type="button" className="lt-cd-pill" onClick={() => onOpen?.('billboard')}>Digital Billboard</button>
          <button type="button" className="lt-cd-pill" onClick={() => onOpen?.('ltbenefits')}>LT Points</button>
        </div>
        <p className="lt-cd-hint">The loyalty card button is always there. LT Benefits stays coming soon until you launch it.</p>
      </section>

      <div>
        <button type="button" className="lt-cd-save" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving...' : 'Save customer dashboard'}</button>
        {dirty ? <p className="lt-cd-hint">Not saved yet.</p> : null}
      </div>
      {status ? <p className={good ? 'lt-cd-status-line good' : 'lt-cd-status-line bad'}>{status}</p> : null}
    </section>
  )
}

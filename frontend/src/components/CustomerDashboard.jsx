import React, { useEffect, useState } from 'react'
import './digital-billboard.css'

const EMPTY = {
  cover_url: '',
  wifi_published: false,
  wifi_name: '',
  wifi_password: '',
  socials_published: false,
  links: [{ label: '', url: '' }],
  review_url: '',
}

function detailOf(data, fallback) {
  return typeof data?.detail === 'string' ? data.detail : fallback
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
        links: Array.isArray(data.links) && data.links.length ? data.links : [{ label: '', url: '' }],
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
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not save'))
      setForm({ ...EMPTY, ...data, links: data.links?.length ? data.links : [{ label: '', url: '' }] })
      setDirty(false)
      setStatus('Saved. Customers will see this the next time they scan.')
    } catch (err) {
      setStatus(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <section className="lt-billboard"><p className="lt-status bad">{error}</p><button className="lt-secondary" onClick={load}>Try again</button></section>
  if (!form) return <section className="lt-billboard"><p className="lt-quiet">Loading customer dashboard...</p></section>

  const setLink = (index, key, value) => patch({
    links: form.links.map((link, linkIndex) => linkIndex === index ? { ...link, [key]: value } : link),
  })

  return (
    <section className="lt-billboard" aria-label="Customer dashboard">
      <header className="lt-billboard-head">
        <p className="lt-kicker">Customer dashboard</p>
        <h1>What people see after they scan</h1>
        <p>Edit one part at a time. Digital Menu, Digital Billboard, and LT Points stay in their own pages.</p>
      </header>

      <div className="lt-billboard-card">
        <p className="lt-step">1 · Cover photo</p>
        <p className="lt-quiet">The wide photo at the top of the scan page. Leave it empty to use the loyalty card photo.</p>
        {form.cover_url ? <img src={form.cover_url} alt="" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 14, marginTop: 12 }} /> : null}
        <div className="lt-actions">
          <label className="lt-secondary" style={{ display: 'inline-block' }}>
            {form.cover_url ? 'Replace photo' : 'Add photo'}
            <input type="file" accept="image/*" hidden onChange={e => { uploadCover(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {form.cover_url ? <button type="button" className="lt-text-btn" onClick={() => patch({ cover_url: '' })}>Remove</button> : null}
        </div>
      </div>

      <div className="lt-billboard-card">
        <p className="lt-step">2 · Wi-Fi</p>
        <div className="lt-power" style={{ marginTop: 12 }}>
          <div>
            <b>{form.wifi_published ? 'Shown on the scan page' : 'Hidden'}</b>
            <div className="lt-quiet">Anyone who scans the QR can see the password.</div>
          </div>
          <button type="button" className={form.wifi_published ? 'lt-secondary' : 'lt-primary'} onClick={() => patch({ wifi_published: !form.wifi_published })}>
            {form.wifi_published ? 'Hide' : 'Show'}
          </button>
        </div>
        <label className="lt-field">Network name
          <input maxLength={80} value={form.wifi_name} onChange={e => patch({ wifi_name: e.target.value })} placeholder="Cafe Wi-Fi" />
        </label>
        <label className="lt-field">Password
          <input maxLength={80} value={form.wifi_password} onChange={e => patch({ wifi_password: e.target.value })} placeholder="Optional" />
        </label>
      </div>

      <div className="lt-billboard-card">
        <p className="lt-step">3 · Socials and reviews</p>
        <div className="lt-power" style={{ marginTop: 12 }}>
          <div>
            <b>{form.socials_published ? 'Shown on the scan page' : 'Hidden'}</b>
            <div className="lt-quiet">Use full links that start with https://</div>
          </div>
          <button type="button" className={form.socials_published ? 'lt-secondary' : 'lt-primary'} onClick={() => patch({ socials_published: !form.socials_published })}>
            {form.socials_published ? 'Hide' : 'Show'}
          </button>
        </div>
        {form.links.map((link, index) => (
          <div key={index}>
            <label className="lt-field">Name
              <input maxLength={40} value={link.label} onChange={e => setLink(index, 'label', e.target.value)} placeholder="Facebook" />
            </label>
            <label className="lt-field">Link
              <input value={link.url} onChange={e => setLink(index, 'url', e.target.value)} placeholder="https://" />
            </label>
            {form.links.length > 1 ? <button type="button" className="lt-text-btn" onClick={() => patch({ links: form.links.filter((_, linkIndex) => linkIndex !== index) })}>Remove</button> : null}
          </div>
        ))}
        <div className="lt-actions">
          <button type="button" className="lt-secondary" disabled={form.links.length >= 4} onClick={() => patch({ links: [...form.links, { label: '', url: '' }] })}>Add a link</button>
        </div>
        <label className="lt-field">Review link
          <input value={form.review_url} onChange={e => patch({ review_url: e.target.value })} placeholder="https://g.page/..." />
        </label>
      </div>

      <div className="lt-billboard-card">
        <p className="lt-step">Already on the scan page</p>
        <div className="lt-actions">
          <button type="button" className="lt-secondary" onClick={() => onOpen?.('qrmenu')}>Digital Menu</button>
          <button type="button" className="lt-secondary" onClick={() => onOpen?.('billboard')}>Digital Billboard</button>
          <button type="button" className="lt-secondary" onClick={() => onOpen?.('ltbenefits')}>LT Points</button>
        </div>
        <p className="lt-quiet">The loyalty card button is always there. LT Benefits stays coming soon until you launch it.</p>
      </div>

      <div className="lt-savebar">
        <button type="button" className="lt-primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving...' : 'Save customer dashboard'}</button>
        {dirty ? <span className="lt-quiet">Not saved yet.</span> : null}
      </div>
      {status ? <p className={status.startsWith('Saved') || status.startsWith('Photo added') ? 'lt-status good' : 'lt-status bad'}>{status}</p> : null}
    </section>
  )
}

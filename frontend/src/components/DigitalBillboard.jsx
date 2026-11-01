import React, { useEffect, useState } from 'react'
import { NearbyPinMap } from './OwnerAutomations'
import './digital-billboard.css'

function readMapPoint(raw) {
  const text = String(raw || '').trim()
  const at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) return { latitude: Number(at[1]), longitude: Number(at[2]) }
  const query = text.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (query) return { latitude: Number(query[1]), longitude: Number(query[2]) }
  const pair = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (pair) return { latitude: Number(pair[1]), longitude: Number(pair[2]) }
  return null
}

function detailOf(data, fallback) {
  return typeof data?.detail === 'string' ? data.detail : fallback
}

export default function DigitalBillboard({ API_BASE, user, active = true }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [openIndex, setOpenIndex] = useState(0)

  const authFetch = (url, options = {}) => fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${user.token}` },
  })

  const load = async () => {
    setError('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not load Digital Billboard'))
      setForm({
        feature_enabled: !!data.feature_enabled,
        access_message: data.access_message || 'Nearby alerts are not included on this plan.',
        enabled: !!data.enabled,
        message: data.message || 'You are near us. Open your Loyalty Tree card.',
        radius_meters: Math.min(150, Number(data.radius_meters) || 150),
        max_per_day: data.max_per_day || 1,
        max_per_week: data.max_per_week || 3,
        pins: data.pins || [],
        branches: data.branches || [],
        limits: { ...(data.limits || {}), min_radius_meters: data.limits?.min_radius_meters || 100, max_radius_meters: 150, max_pins: data.limits?.max_pins || 10 },
      })
      setDirty(false)
    } catch (err) {
      setError(err.message || 'Could not load Digital Billboard')
    }
  }

  useEffect(() => {
    if (user?.business_slug && user?.token) load()
  }, [user?.business_slug, user?.token])

  const patch = (next) => { setForm(current => ({ ...current, ...next })); setDirty(true); setStatus('') }
  const patchPin = (index, pinPatch) => setForm(current => ({
    ...current,
    pins: current.pins.map((pin, pinIndex) => pinIndex === index ? { ...pin, ...pinPatch } : pin),
  })) || setDirty(true)

  const pinLimit = Math.min(form?.limits?.max_pins || 1, (form?.branches || []).length || 1)

  const save = async () => {
    if (!form?.feature_enabled) return
    if (form.enabled && !(form.pins || []).length) {
      setStatus('Add a branch pin before turning this on.')
      return
    }
    setSaving(true)
    setStatus('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !!form.enabled,
          message: form.message,
          radius_meters: Number(form.radius_meters),
          max_per_day: Number(form.max_per_day),
          max_per_week: Number(form.max_per_week),
          pins: (form.pins || []).map(pin => ({
            branch_public_id: pin.branch_public_id || '',
            label: pin.label || '',
            message: form.message || '',
            latitude: pin.latitude === '' ? null : Number(pin.latitude),
            longitude: pin.longitude === '' ? null : Number(pin.longitude),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not save'))
      setForm(current => ({ ...current, ...data, branches: data.branches || current.branches, limits: data.limits || current.limits }))
      setDirty(false)
      setStatus('Saved. Members see the new pin after their card updates.')
    } catch (err) {
      setStatus(err.message || 'Could not save')
    }
    setSaving(false)
  }

  const sendTest = async () => {
    if (dirty) { setStatus('Save first, then send a test.'); return }
    setStatus('Sending a test to saved cards...')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence/test`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Test failed'))
      const apple = data.apple_pushes_sent || 0
      setStatus(`Test sent. iPhone cards woken: ${apple}. Android: ${data.google_class_notified ? 'sent' : 'not sent'}.`)
    } catch (err) {
      setStatus(err.message || 'Test failed')
    }
  }

  const useMyLocation = (index) => {
    if (!navigator.geolocation) { setStatus('This phone cannot share its location.'); return }
    navigator.geolocation.getCurrentPosition(
      pos => patchPin(index, { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) }),
      () => setStatus('Location permission was denied. Paste a Maps link instead.'),
    )
  }

  const readLink = async (index, raw) => {
    const typed = readMapPoint(raw)
    if (typed) { patchPin(index, typed); return }
    setStatus('Reading the Maps link...')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence/resolve-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: raw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not read that link'))
      patchPin(index, { latitude: data.latitude, longitude: data.longitude })
      setStatus('Pin placed. Save when you are done.')
    } catch (err) {
      setStatus(err.message || 'Could not read that link')
    }
  }

  if (error) return <section className="lt-billboard"><p className="lt-status bad">{error}</p><button className="lt-secondary" onClick={load}>Try again</button></section>
  if (!form) return <section className="lt-billboard"><p className="lt-quiet">Loading Digital Billboard...</p></section>
  if (!form.feature_enabled) return <section className="lt-billboard"><div className="lt-locked">{form.access_message}</div></section>

  const minRadius = form.limits?.min_radius_meters || 100
  const maxRadius = 150

  return (
    <section className="lt-billboard" aria-label="Digital Billboard">
      <header className="lt-billboard-head">
        <h1>Digital Billboard</h1>
        <p>Members nearby can see this business on their Loyalty Tree card.</p>
      </header>
      <div className="lt-billboard-facts">
        <div><strong>iPhone</strong><span>Can show the branch name.</span></div>
        <div><strong>Android</strong><span>Says you are near, with your card logo.</span></div>
      </div>
      <div className="lt-billboard-card">
        <div className="lt-switch">
          <div><b>Nearby alerts</b><div className="lt-quiet">Off until you save at least one pin.</div></div>
          <button type="button" className={form.enabled ? 'on' : 'off'} onClick={() => patch({ enabled: !form.enabled })}>{form.enabled ? 'On' : 'Off'}</button>
        </div>
        <label className="lt-field">What the iPhone says
          <input maxLength={120} value={form.message} onChange={e => patch({ message: e.target.value })} />
        </label>
        <label className="lt-field">How close
          <div className="lt-distance">
            <input type="range" min={minRadius} max={maxRadius} step="10" value={form.radius_meters} onChange={e => patch({ radius_meters: Number(e.target.value) })} />
            <span className="lt-quiet">{form.radius_meters} m</span>
          </div>
        </label>
        <p className="lt-quiet">Up to 150 meters, about a short walk. One pin per branch, up to {pinLimit}.</p>
      </div>
      <div className="lt-pins">
        {(form.pins || []).map((pin, index) => (
          <article className="lt-pin" key={index}>
            <div className="lt-pin-top">
              <span>Location {index + 1}</span>
              <button type="button" className="lt-text-btn" onClick={() => { if (window.confirm('Remove this location?')) patch({ pins: form.pins.filter((_, pinIndex) => pinIndex !== index) }) }}>Remove</button>
            </div>
            <label className="lt-field">Branch
              <select value={pin.branch_public_id || ''} onChange={e => patchPin(index, { branch_public_id: e.target.value })}>
                <option value="">Choose a branch</option>
                {form.branches.map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}
              </select>
            </label>
            <div className="lt-actions">
              <button type="button" className="lt-secondary" onClick={() => setOpenIndex(openIndex === index ? -1 : index)}>{openIndex === index ? 'Hide map' : 'Show map'}</button>
              <button type="button" className="lt-secondary" onClick={() => useMyLocation(index)}>Use my location</button>
            </div>
            {openIndex === index && <div style={{ marginTop: 12 }}><NearbyPinMap active={active} latitude={pin.latitude} longitude={pin.longitude} radius={form.radius_meters} onMove={(latitude, longitude) => patchPin(index, { latitude, longitude })} /></div>}
            <label className="lt-field">Or paste a Google Maps link
              <input placeholder="https://maps.google.com/..." onBlur={e => { const raw = e.target.value.trim(); if (raw) readLink(index, raw) }} />
            </label>
          </article>
        ))}
      </div>
      <div className="lt-actions">
        <button type="button" className="lt-secondary" disabled={(form.pins || []).length >= pinLimit} onClick={() => patch({ pins: [...form.pins, { branch_public_id: form.branches[0]?.public_id || '', label: '', message: form.message, latitude: '', longitude: '' }] })}>Add a location</button>
        <button type="button" className="lt-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
        <button type="button" className="lt-secondary" onClick={sendTest}>Send a test</button>
      </div>
      {status && <p className={status.startsWith('Saved') || status.startsWith('Test sent') || status.startsWith('Pin placed') ? 'lt-status good' : 'lt-status bad'}>{status}</p>}
    </section>
  )
}

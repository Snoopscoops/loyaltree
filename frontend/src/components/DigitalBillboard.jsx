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

function appleLockScreenLine(message) {
  const text = String(message || '').replace(/\s+/g, ' ').trim()
  const generic = [
    '',
    "you're near us. open your loyaltytree card.",
    "you are near us. open your loyalty tree card.",
    "you're near us. open your loyalty tree card.",
  ].includes(text.toLowerCase())
  return generic ? 'You’re near {branch name}' : text
}

function hasPin(pin) {
  return pin && pin.latitude !== '' && pin.latitude != null && pin.longitude !== '' && pin.longitude != null
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
  const patchPin = (index, pinPatch) => {
    setForm(current => ({
      ...current,
      pins: current.pins.map((pin, pinIndex) => pinIndex === index ? { ...pin, ...pinPatch } : pin),
    }))
    setDirty(true)
    setStatus('')
  }

  const pinLimit = Math.min(form?.limits?.max_pins || 1, (form?.branches || []).length || 1)

  const save = async (next = form) => {
    if (!next?.feature_enabled) return
    if (next.enabled && !(next.pins || []).some(hasPin)) {
      setStatus('Add a location before turning alerts on.')
      return
    }
    setSaving(true)
    setStatus('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !!next.enabled,
          message: next.message,
          radius_meters: Number(next.radius_meters),
          max_per_day: Number(next.max_per_day),
          max_per_week: Number(next.max_per_week),
          pins: (next.pins || []).filter(hasPin).map(pin => ({
            branch_public_id: pin.branch_public_id || '',
            label: pin.label || '',
            message: next.message || '',
            latitude: Number(pin.latitude),
            longitude: Number(pin.longitude),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Could not save'))
      setForm(current => ({ ...current, ...data, branches: data.branches || current.branches, limits: data.limits || current.limits }))
      setDirty(false)
      setStatus(next.enabled
        ? 'Alerts are on. Saved cards pick this up the next time they refresh.'
        : 'Alerts are off. Saved cards drop the pin the next time they refresh.')
    } catch (err) {
      setStatus(err.message || 'Could not save')
    }
    setSaving(false)
  }

  const sendTest = async () => {
    if (!form?.enabled) { setStatus('Turn nearby alerts on before sending a test.'); return }
    if (dirty) { setStatus('Save the message and locations first, then send a test.'); return }
    setStatus('Sending a test to saved cards...')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence/test`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(detailOf(data, 'Test failed'))
      const apple = data.apple_pushes_sent || 0
      const stored = data.google_locations_stored ?? 0
      const sent = data.google_locations_sent ?? 0
      setStatus(`Test sent. iPhone cards woken: ${apple}. Android: ${data.google_class_notified ? 'sent' : 'not sent'}. Google pins stored: ${stored} of ${sent}.`)
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
  const placed = (form.pins || []).filter(hasPin).length
  const powerCopy = !form.enabled
    ? 'No nearby alerts. Your pins stay saved.'
    : placed
      ? 'People near a saved pin can get an alert.'
      : 'Add a location before this can alert anyone.'

  return (
    <section className={form.enabled ? 'lt-billboard is-on' : 'lt-billboard is-off'} aria-label="Digital Billboard">
      <header className="lt-billboard-head">
        <p className="lt-kicker">Digital Billboard</p>
        <h1>Nearby alerts</h1>
        <p>Three steps. Turn off saves by itself.</p>
      </header>

      <div className="lt-power">
        <div>
          <p className="lt-step">1 · On or off</p>
          <b>{form.enabled ? 'Alerts are on' : 'Alerts are off'}</b>
          <div className="lt-quiet">{powerCopy}</div>
        </div>
        <button type="button" className={form.enabled ? 'lt-secondary' : 'lt-primary'} disabled={saving} onClick={() => save({ ...form, enabled: !form.enabled })}>
          {saving ? 'Saving...' : form.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <div className="lt-billboard-card">
        <p className="lt-step">2 · What people see</p>
        <label className="lt-field">Message on iPhone
          <input maxLength={120} value={form.message} onChange={e => patch({ message: e.target.value })} />
        </label>
        <p className="lt-quiet">Lock screen: “{appleLockScreenLine(form.message)}”. {String(form.message || '').length}/120. Android only says someone is nearby.</p>
        <label className="lt-field">How close, up to 150 m
          <div className="lt-distance">
            <input type="range" min={minRadius} max={maxRadius} step="10" value={form.radius_meters} onChange={e => patch({ radius_meters: Number(e.target.value) })} />
            <span>{form.radius_meters} m</span>
          </div>
        </label>
      </div>

      <div className="lt-pins">
        <p className="lt-step">3 · Where · {placed} of {pinLimit} placed</p>
        {(form.pins || []).map((pin, index) => (
          <article className="lt-pin" key={index}>
            <div className="lt-pin-top">
              <span>Location {index + 1}{hasPin(pin) ? '' : ' · not placed'}</span>
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
            {openIndex === index && <div className="lt-map"><NearbyPinMap active={active} latitude={pin.latitude} longitude={pin.longitude} radius={form.radius_meters} onMove={(latitude, longitude) => patchPin(index, { latitude, longitude })} /></div>}
            <label className="lt-field">Or paste a Google Maps link
              <input placeholder="https://maps.google.com/..." onBlur={e => { const raw = e.target.value.trim(); if (raw) readLink(index, raw) }} />
            </label>
          </article>
        ))}
      </div>

      <div className="lt-savebar">
        <button type="button" className="lt-secondary" disabled={(form.pins || []).length >= pinLimit} onClick={() => patch({ pins: [...form.pins, { branch_public_id: form.branches[0]?.public_id || '', label: '', message: form.message, latitude: '', longitude: '' }] })}>Add a location</button>
        <button type="button" className="lt-primary" disabled={saving || !dirty} onClick={() => save()}>{saving ? 'Saving...' : 'Save message and locations'}</button>
        <button type="button" className="lt-secondary" disabled={!form.enabled || dirty || saving} onClick={sendTest}>Send a test</button>
        {dirty && <span className="lt-quiet">Message or locations are not saved yet.</span>}
      </div>
      {status && <p className={status.startsWith('Alerts are') || status.startsWith('Test sent') || status.startsWith('Pin placed') ? 'lt-status good' : 'lt-status bad'}>{status}</p>}
    </section>
  )
}

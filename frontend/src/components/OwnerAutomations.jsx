import React, { useState, useEffect } from 'react'
import './owner-automations.css'

function parseMapPoint(raw) {
  const text = String(raw || '').trim()
  const at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) return { latitude: Number(at[1]), longitude: Number(at[2]) }
  const q = text.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (q) return { latitude: Number(q[1]), longitude: Number(q[2]) }
  const pair = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (pair) return { latitude: Number(pair[1]), longitude: Number(pair[2]) }
  return null
}

export function NearbyPinMap({ latitude, longitude, radius, onMove, active = true }) {
  const holder = React.useRef(null)
  const mapRef = React.useRef(null)
  const markerRef = React.useRef(null)
  const circleRef = React.useRef(null)
  const lat = Number(latitude)
  const lng = Number(longitude)
  const hasPoint = latitude !== '' && longitude !== '' && latitude != null && longitude != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const latest = React.useRef(null)
  latest.current = { lat, lng, hasPoint, radius, onMove }
  React.useEffect(() => {
    let cancelled = false
    const boot = () => {
      if (cancelled || !holder.current || !window.L || mapRef.current) return
      // Location can change while Leaflet is loading (for example, a phone lookup).
      const current = latest.current
      const center = current.hasPoint ? [current.lat, current.lng] : [14.5995, 120.9842]
      const map = window.L.map(holder.current, { scrollWheelZoom: false }).setView(center, current.hasPoint ? 16 : 12)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map)
      const marker = window.L.marker(center, { draggable: true }).addTo(map)
      const circle = window.L.circle(center, { radius: Number(current.radius) || 150, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.18 }).addTo(map)
      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        circle.setLatLng(pos)
        latest.current.onMove(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)))
      })
      map.on('click', event => {
        marker.setLatLng(event.latlng)
        circle.setLatLng(event.latlng)
        latest.current.onMove(Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6)))
      })
      mapRef.current = map
      markerRef.current = marker
      circleRef.current = circle
      setTimeout(() => map.invalidateSize(), 200)
    }
    if (!document.getElementById('lt-leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'lt-leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    if (window.L) boot()
    else if (!document.getElementById('lt-leaflet-js')) {
      const script = document.createElement('script')
      script.id = 'lt-leaflet-js'
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = boot
      document.body.appendChild(script)
    } else {
      const timer = setInterval(() => { if (window.L) { clearInterval(timer); boot() } }, 200)
      return () => { cancelled = true; clearInterval(timer) }
    }
    return () => { cancelled = true }
  }, [])
  React.useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])
  React.useEffect(() => {
    if (!mapRef.current || !hasPoint) return
    const pos = [lat, lng]
    markerRef.current?.setLatLng(pos)
    circleRef.current?.setLatLng(pos)
    circleRef.current?.setRadius(Number(radius) || 150)
    mapRef.current.panTo(pos)
  }, [lat, lng, radius, hasPoint])
  React.useEffect(() => { if (active) mapRef.current?.invalidateSize() }, [active])
  const mapsUrl = hasPoint ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : 'https://www.google.com/maps'
  return (
    <div style={{gridColumn:'1 / -1'}}>
      <div ref={holder} style={{height:280,borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}} />
      <div style={{display:'flex',justifyContent:'space-between',gap:8,marginTop:8,flexWrap:'wrap'}}>
        <span style={{fontSize:12,color:'#64748b'}}>{hasPoint ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Click the map or drop the business pin.'}</span>
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={{fontSize:12,fontWeight:800,color:'#0f766e'}}>Open in Google Maps</a>
      </div>
    </div>
  )
}


// The same owner retention and geofence endpoints power these controls; opening
// this editor does not send a notification or change any automation setting.
export default function OwnerAutomations({ API_BASE, user, active = true }) {
  const [retentionSettings, setRetentionSettings] = useState({
    birthday_message: 'Happy birthday, {first_name}! 🎉 {business_name} wishes you a wonderful day!',
    birthday_enabled: true,
    birthday_send_timing: 'birthday',
    birthday_reward_enabled: false,
    birthday_reward_type: 'custom',
    birthday_reward_name: '',
    birthday_reward_description: '',
    birthday_reward_message: 'Happy birthday, {first_name}! 🎉 Enjoy {reward_name} from {business_name}. Valid until {expiry_date}.',
    birthday_reward_min_membership_days: 30,
    birthday_reward_min_visits: 2,
    birthday_reward_validity_days: 7,
    birthday_reward_staff_verification: false,
    birthday_reward_one_per_year: true,
    win_back_message: "It's been a while since your last visit to {business_name} - come back and pick up where you left off!",
    churn_days: 30,
  })
  const [savingRetentionSettings, setSavingRetentionSettings] = useState(false)
  const [retentionSettingsMessage, setRetentionSettingsMessage] = useState('')
  const [automationStats, setAutomationStats] = useState({ tracking: 'log', birthday: {}, win_back: {}, recent: [] })
  const [geofence, setGeofence] = useState({ feature_enabled: false, access_message: 'Geo-based notifications are included in Philippines Pro, UAE Pro, or an agreed Special setup.', enabled: false, message: "You're near us. Open your LoyaltyTree card.", radius_meters: 100, max_per_day: 1, max_per_week: 3, pins: [], branches: [], limits: { min_radius_meters: 100, max_radius_meters: 1000, max_pins: 10 } })
  const [geofenceStatus, setGeofenceStatus] = useState('')
  const [savingGeofence, setSavingGeofence] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [geofenceLoaded, setGeofenceLoaded] = useState(false)
  const [geofenceError, setGeofenceError] = useState('')

  const authFetch = (url, options = {}) => fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${user.token}` },
  })

  const fetchRetentionSettings = async () => {
    setSettingsError('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/retention-settings`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load birthday and churn settings')
      setRetentionSettings(data)
      setSettingsLoaded(true)
    } catch (err) {
      setSettingsError(err.message || 'Could not load birthday and churn settings')
    }
  }

  useEffect(() => {
    setSettingsLoaded(false)
    setGeofenceLoaded(false)
    if (!user?.business_slug || !user?.token) return
    fetchRetentionSettings()
    fetchAutomationStats()
    fetchGeofence()
  }, [user?.business_slug, user?.token])

  const fetchAutomationStats = async () => {
    if (!user?.business_slug || !user?.token) return
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/automation-stats`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setAutomationStats(data)
    } catch (err) { /* stats are optional; leave previous numbers */ }
  }


  const fetchGeofence = async () => {
    if (!user?.business_slug || !user?.token) return
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load location notification settings')
      setGeofenceLoaded(true)
      setGeofenceError('')
      setGeofence({
        feature_enabled: data.feature_enabled === true,
        access_message: data.access_message || 'Geo-based notifications are included in Philippines Pro, UAE Pro, or an agreed Special setup.',
        enabled: !!data.enabled,
        message: data.message || "You're near us. Open your LoyaltyTree card.",
        radius_meters: data.radius_meters || 150,
        max_per_day: data.max_per_day || 1,
        max_per_week: data.max_per_week || 3,
        pins: Array.isArray(data.pins) ? data.pins : [],
        branches: Array.isArray(data.branches) ? data.branches : [],
        limits: data.limits || { min_radius_meters: 100, max_radius_meters: 1000, max_pins: 10 },
      })
    } catch (err) { setGeofenceError(err.message || 'Could not load location notification settings') }
  }

  const deleteGeofencePin = async (index) => {
    if (!geofenceLoaded || !geofence.feature_enabled) return
    const pins = (geofence.pins || []).filter((_, pinIndex) => pinIndex !== index)
    const next = { ...geofence, pins, enabled: pins.length ? geofence.enabled : false }
    setGeofence(next)
    setSavingGeofence(true)
    setGeofenceStatus('')
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
          pins: pins.map(pin => ({
            branch_public_id: pin.branch_public_id || null,
            label: pin.label || '',
            message: pin.message || next.message || '',
            latitude: Number(pin.latitude),
            longitude: Number(pin.longitude),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not delete location')
      setGeofence(current => ({ ...current, ...data, branches: data.branches || current.branches, limits: data.limits || current.limits }))
      setGeofenceStatus(pins.length ? 'Location deleted. Save is already done.' : 'Location deleted and nearby notifications turned off.')
    } catch (err) {
      setGeofenceStatus(err.message || 'Could not delete location')
    } finally {
      setSavingGeofence(false)
    }
  }

  const saveGeofence = async () => {
    if (!geofenceLoaded || !geofence.feature_enabled) return
    setSavingGeofence(true)
    setGeofenceStatus('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !!geofence.enabled,
          message: geofence.message,
          radius_meters: Number(geofence.radius_meters),
          max_per_day: Number(geofence.max_per_day),
          max_per_week: Number(geofence.max_per_week),
          pins: (geofence.pins || []).map(pin => ({
            branch_public_id: pin.branch_public_id || null,
            label: pin.label || '',
            message: pin.message || geofence.message || '',
            latitude: Number(pin.latitude),
            longitude: Number(pin.longitude),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save nearby notification')
      setGeofence(current => ({ ...current, ...data, branches: data.branches || current.branches, limits: data.limits || current.limits }))
      setGeofenceStatus('Saved. Customers need an updated Wallet pass before the new pin is on their card.')
    } catch (err) {
      setGeofenceStatus(err.message || 'Save failed')
    }
    setSavingGeofence(false)
  }

  const updateGeofencePin = (index, patch) => setGeofence(current => ({
    ...current,
    pins: current.pins.map((pin, i) => i === index ? { ...pin, ...patch } : pin),
  }))

  const useGeofenceLocation = (index) => {
    if (!navigator.geolocation) {
      setGeofenceStatus('This browser cannot read the current location.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => updateGeofencePin(index, { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) }),
      () => setGeofenceStatus('Location permission was denied. Enter the pin manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const testGeofenceNotification = async () => {
    if (!geofenceLoaded || !geofence.feature_enabled) return
    setGeofenceStatus('Sending test to saved Apple and Google cards...')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence/test`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Test notification failed')
      setGeofenceStatus(`Test sent to saved cards. Apple wakes: ${data.apple_pushes_sent || 0}. Google class: ${data.google_class_notified ? 'sent' : 'not sent'}. Wallet cannot filter by who is standing inside the radius.`)
    } catch (err) {
      setGeofenceStatus(err.message || 'Test notification failed')
    }
  }

  const saveRetentionSettings = async () => {
    if (!settingsLoaded) return
    setSavingRetentionSettings(true)
    setRetentionSettingsMessage('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/retention-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retentionSettings),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save retention messages')
      setRetentionSettings(data)
      setRetentionSettingsMessage('Saved ✓')
    } catch (err) {
      setRetentionSettingsMessage(err.message || 'Save failed')
    }
    setSavingRetentionSettings(false)
  }


  return (
    <div className="lt-owner-automations">
      {!settingsLoaded && !settingsError && <p role="status" style={styles.mutedText}>Loading automation settings…</p>}
      {settingsError && <p role="alert" style={styles.errorText}>{settingsError} <button type="button" style={styles.actionBtnCompact} onClick={fetchRetentionSettings}>Retry</button></p>}
    <>
        <div style={styles.section}>
          <h2 className="an-section-title" style={styles.sectionTitle}>Automations</h2>
          <div style={{...styles.mutedText,marginBottom:16}}>Birthday greetings, churn messages, and location notifications for your business. These settings apply to all programs.</div>

          <div style={{...styles.insightCard,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:12}}>
              <div>
                <h4 style={{...styles.insightTitle,marginBottom:4}}>📨 Messages Sent</h4>
                <div style={styles.mutedText}>Birthday and win-back messages delivered to customers' wallet cards.</div>
              </div>
              <button type="button" style={styles.actionBtnCompact} onClick={fetchAutomationStats}>Refresh</button>
            </div>
            <div className="an-overview-grid" style={{...styles.overviewGrid,marginBottom:14}}>
              <MiniMetric label="🎂 Birthday · This Month" value={automationStats.birthday?.this_month || 0} />
              <MiniMetric label="🎂 Birthday · This Year" value={automationStats.birthday?.this_year || 0} />
              <MiniMetric label="🎂 Birthday · All Time" value={automationStats.birthday?.total || 0} />
              <MiniMetric label="🔁 Win-Back · Last 7 Days" value={automationStats.win_back?.last_7_days || 0} />
              <MiniMetric label="🔁 Win-Back · Last 30 Days" value={automationStats.win_back?.last_30_days || 0} />
              <MiniMetric label="🔁 Win-Back · All Time" value={automationStats.win_back?.total || 0} />
            </div>
            {automationStats.tracking === 'estimate' && (
              <div style={{...styles.mutedText,marginBottom:12}}>Showing estimates from customer records. Exact counts and the recent-messages list start once the message log is enabled.</div>
            )}
            <div style={{...styles.settingTitle,marginBottom:8}}>Recent messages</div>
            {(automationStats.recent || []).length === 0 ? <div style={styles.noData}>No automated messages sent yet.</div> :
              automationStats.recent.map((m,i)=>(
                <div key={`${m.sent_at}-${i}`} style={styles.auditRow}>
                  <div>
                    <strong>{m.automation_type === 'birthday' ? '🎂' : '🔁'} {m.customer_name}</strong>
                    <div style={styles.mutedText}>{m.body}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span style={{...styles.statusPill,...styles.statusGood}}>{m.automation_type === 'birthday' ? 'Birthday' : 'Win-back'}</span>
                    <div style={styles.mutedText}>{m.sent_at ? new Date(m.sent_at.endsWith('Z') || m.sent_at.includes('+') ? m.sent_at : m.sent_at + 'Z').toLocaleString() : ''}</div>
                  </div>
                </div>
              ))}
          </div>

        <div style={{...styles.insightCard, marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:14}}>
            <div>
              <h4 style={{...styles.insightTitle,marginBottom:4}}>🎂 Birthday Automation</h4>
              <div style={styles.mutedText}>Choose an early send timing to greet customers before their birthday. When Birthday Rewards are enabled, the coupon is issued on the same scheduled run.</div>
            </div>
            <button className="an-actionbtn" style={styles.actionBtn} disabled={savingRetentionSettings || !settingsLoaded} onClick={saveRetentionSettings}>
              {savingRetentionSettings ? 'Saving…' : 'Save Birthday Settings'}
            </button>
          </div>

          <div style={styles.settingRow}>
            <div>
              <div style={styles.settingTitle}>Birthday Greetings</div>
              <div style={styles.mutedText}>Send a personalized Wallet message to birthday celebrants.</div>
            </div>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={retentionSettings.birthday_enabled !== false} onChange={e=>setRetentionSettings(s=>({...s,birthday_enabled:e.target.checked}))} />
              {retentionSettings.birthday_enabled !== false ? 'On' : 'Off'}
            </label>
          </div>

          {retentionSettings.birthday_enabled !== false && <>
            <div style={styles.formGrid2}>
              <div>
                <label style={styles.editorLabel}>Send Timing</label>
                <select style={styles.editorSelect} aria-label="Birthday send timing" value={retentionSettings.birthday_send_timing || 'birthday'} onChange={e=>setRetentionSettings(s=>({...s,birthday_send_timing:e.target.value}))}>
                  <option value="birthday">On the birthday</option>
                  <option value="1_day_before">1 day before</option>
                  <option value="3_days_before">3 days before</option>
                  <option value="7_days_before">7 days before</option>
                  <option value="month_start">Start of birthday month</option>
                </select>
              </div>
            </div>
            {retentionSettings.birthday_send_timing !== 'birthday' && (
              <div style={{...styles.editorHelp,marginBottom:12}}>
                The greeting and enabled birthday coupon are issued on the selected pre-birthday date. The coupon stays active through the birthday plus the validity period below.
              </div>
            )}

            <label style={styles.editorLabel}>Birthday Greeting</label>
            <textarea
              aria-label="Birthday greeting"
              value={retentionSettings.birthday_message || ''}
              onChange={e=>setRetentionSettings(s=>({...s,birthday_message:e.target.value}))}
              maxLength={500}
              rows={3}
              style={styles.editorTextarea}
            />
            <div style={styles.editorHelp}>Personalize with {'{first_name}'}. Also available: {'{customer_name}'}, {'{business_name}'}.</div>

            <div style={{...styles.settingRow,marginTop:16,paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
              <div>
                <div style={styles.settingTitle}>🎁 Birthday Rewards</div>
                <div style={styles.mutedText}>Optional. Eligible customers receive a one-time coupon through the existing Loyalty Tree coupon system.</div>
              </div>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" checked={retentionSettings.birthday_reward_enabled === true} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_enabled:e.target.checked}))} />
                {retentionSettings.birthday_reward_enabled === true ? 'On' : 'Off'}
              </label>
            </div>

            {retentionSettings.birthday_reward_enabled === true && <div style={styles.rewardPanel}>
              <div style={styles.formGrid2}>
                <div>
                  <label style={styles.editorLabel}>Reward Type</label>
                  <select style={styles.editorSelect} value={retentionSettings.birthday_reward_type || 'custom'} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_type:e.target.value}))}>
                    <option value="free_item">Free Item</option>
                    <option value="discount">Discount</option>
                    <option value="custom">Custom Perk</option>
                  </select>
                </div>
                <div>
                  <label style={styles.editorLabel}>Reward Name</label>
                  <input style={styles.editorInput} maxLength={120} placeholder="e.g. Free Birthday Drink" value={retentionSettings.birthday_reward_name || ''} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_name:e.target.value}))} />
                </div>
              </div>

              <label style={styles.editorLabel}>Reward Description</label>
              <input style={styles.editorInput} maxLength={240} placeholder="e.g. Any regular handcrafted beverage" value={retentionSettings.birthday_reward_description || ''} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_description:e.target.value}))} />

              <label style={{...styles.editorLabel,marginTop:12}}>Reward Message</label>
              <textarea
                value={retentionSettings.birthday_reward_message || ''}
                onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_message:e.target.value}))}
                maxLength={500}
                rows={3}
                style={styles.editorTextarea}
              />
              <div style={styles.editorHelp}>Available: {'{first_name}'}, {'{business_name}'}, {'{reward_name}'}, {'{reward_description}'}, {'{expiry_date}'}.</div>

              <div style={{...styles.formGrid2,marginTop:12}}>
                <div>
                  <label style={styles.editorLabel}>Minimum Membership Age</label>
                  <select style={styles.editorSelect} value={retentionSettings.birthday_reward_min_membership_days ?? 30} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_min_membership_days:Number(e.target.value)}))}>
                    <option value={0}>No waiting period</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
                <div>
                  <label style={styles.editorLabel}>Minimum Qualifying Visit Days</label>
                  <input type="number" min="0" max="10000" style={styles.editorInput} value={retentionSettings.birthday_reward_min_visits ?? 2} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_min_visits:Number(e.target.value)}))} />
                </div>
                <div>
                  <label style={styles.editorLabel}>Valid Through Birthday +</label>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <input type="number" min="1" max="365" style={{...styles.editorInput,width:100}} value={retentionSettings.birthday_reward_validity_days ?? 7} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_validity_days:Number(e.target.value)}))} />
                    <span style={styles.mutedText}>days after birthday</span>
                  </div>
                </div>
                <div>
                  <label style={styles.editorLabel}>Anti-Abuse</label>
                  <div style={{fontSize:13,color:'#166534',fontWeight:700}}>✓ One reward per customer per birthday year</div>
                  <label style={{...styles.checkboxLabel,marginTop:8,justifyContent:'flex-start'}}>
                    <input type="checkbox" checked={retentionSettings.birthday_reward_staff_verification === true} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_staff_verification:e.target.checked}))} />
                    Ask staff to verify birthday / ID at redemption
                  </label>
                </div>
              </div>
            </div>}
          </>}

          {retentionSettingsMessage && <div style={{marginTop:10,fontSize:13,fontWeight:700,color:retentionSettingsMessage.includes('Saved')?'#166534':'#b91c1c'}}>{retentionSettingsMessage}</div>}
        </div>

          <div style={{...styles.insightCard,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:14}}>
              <div>
                <h4 style={{...styles.insightTitle,marginBottom:4}}>🔁 Churn / Win-Back Automation</h4>
                <div style={styles.mutedText}>Automatically nudge customers who stopped coming back. Each customer gets at most one win-back message every 30 days.</div>
              </div>
              <button className="an-actionbtn" style={styles.actionBtn} disabled={savingRetentionSettings || !settingsLoaded} onClick={saveRetentionSettings}>
                {savingRetentionSettings ? 'Saving…' : 'Save Win-Back Settings'}
              </button>
            </div>
          <label style={styles.editorLabel}>Churn / Win-Back Message</label>
          <textarea
            aria-label="Churn / win-back message"
            value={retentionSettings.win_back_message || ''}
            onChange={e=>setRetentionSettings(s=>({...s,win_back_message:e.target.value}))}
            maxLength={500}
            rows={3}
            style={styles.editorTextarea}
          />
          <div style={styles.editorHelp}>Available: {'{business_name}'}, {'{first_name}'}, {'{customer_name}'}, {'{days_inactive}'}</div>

          <div style={{height:14}} />
          <label style={styles.editorLabel}>Mark Customer as Churn Risk After</label>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <input
              type="number"
              min="7"
              max="365"
              aria-label="Churn risk after days"
              value={retentionSettings.churn_days || 30}
              onChange={e=>setRetentionSettings(s=>({...s,churn_days:Number(e.target.value)}))}
              style={styles.editorNumber}
            />
            <span style={styles.mutedText}>days without loyalty activity</span>
          </div>
          {retentionSettingsMessage && <div style={{marginTop:10,fontSize:13,fontWeight:700,color:retentionSettingsMessage.includes('Saved')?'#166534':'#b91c1c'}}>{retentionSettingsMessage}</div>}

          </div>
          <div style={{...styles.insightCard,marginTop:16}}>
            <div style={styles.settingRow}>
              <div>
                <div style={styles.settingTitle}>📍 Nearby notification</div>
                <div style={styles.mutedText}>Pin the branch, set the radius, then write the lock-screen message. Apple shows it when the saved card is nearby. Google gets the same pin as a merchant location.</div>
              </div>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" disabled={!geofenceLoaded || !geofence.feature_enabled} checked={geofence.enabled === true} onChange={e=>setGeofence(s=>({...s,enabled:e.target.checked}))} />
                {geofence.enabled ? 'On' : 'Off'}
              </label>
            </div>
            {geofenceError && <p role="alert" style={styles.errorText}>{geofenceError} <button type="button" style={styles.actionBtnCompact} onClick={fetchGeofence}>Retry</button></p>}
            {geofence.feature_enabled && geofenceLoaded ? <>
            <label style={styles.editorLabel}>Notification message</label>
            <input style={styles.editorInput} aria-label="Location notification message" maxLength={120} value={geofence.message || ''} onChange={e=>setGeofence(s=>({...s,message:e.target.value}))} />
            <div style={styles.formGrid2}>
              <label style={styles.editorLabel}>Radius
                {Number(geofence.limits?.min_radius_meters) === Number(geofence.limits?.max_radius_meters) ? (
                  <div style={styles.mutedText}>Fixed at {geofence.limits?.min_radius_meters || 100} m for Philippines accounts.</div>
                ) : (
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <input type="range" min={geofence.limits?.min_radius_meters || 100} max={geofence.limits?.max_radius_meters || 1000} step="10" value={geofence.radius_meters || 150} onChange={e=>setGeofence(s=>({...s,radius_meters:Number(e.target.value)}))} style={{flex:1}} />
                  <input type="number" min={geofence.limits?.min_radius_meters || 100} max={geofence.limits?.max_radius_meters || 1000} style={{...styles.editorInput,width:90}} value={geofence.radius_meters} onChange={e=>setGeofence(s=>({...s,radius_meters:e.target.value}))} />
                  <span style={styles.mutedText}>m</span>
                </div>
                )}
              </label>
              <label style={styles.editorLabel}>Max times / day
                <input type="number" min="1" max="5" style={styles.editorInput} value={geofence.max_per_day} onChange={e=>setGeofence(s=>({...s,max_per_day:e.target.value}))} />
              </label>
              <label style={styles.editorLabel}>Max times / week
                <input type="number" min="1" max="20" style={styles.editorInput} value={geofence.max_per_week} onChange={e=>setGeofence(s=>({...s,max_per_week:e.target.value}))} />
              </label>
            </div>
            <div style={styles.editorHelp}>{Number(geofence.limits?.min_radius_meters) === Number(geofence.limits?.max_radius_meters) ? `Philippines radius is fixed at ${geofence.limits?.min_radius_meters || 100} m.` : `Allowed radius: ${geofence.limits?.min_radius_meters || 100}–${geofence.limits?.max_radius_meters || 1000} m. Apple is most reliable at 100–200 m.`} Max {geofence.limits?.max_pins || 10} pins. Day/week caps are your policy; Wallet suppresses repeats itself and will not hard-stop at that number.</div>
            <div style={styles.editorHelp}>One location per branch. This account can save {Math.min(geofence.limits?.max_pins || 1, (geofence.branches || []).length || 1)} pin{(Math.min(geofence.limits?.max_pins || 1, (geofence.branches || []).length || 1)) === 1 ? '' : 's'}.</div>
            {(geofence.pins || []).map((pin, index) => (
              <div key={index} style={{...styles.formGrid2,marginTop:10}}>
                <select style={styles.editorSelect} value={pin.branch_public_id || ''} onChange={e=>updateGeofencePin(index,{branch_public_id:e.target.value})}>
                  <option value="">Branch</option>
                  {(geofence.branches || []).map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}
                </select>
                <input style={styles.editorInput} placeholder="Paste a Google Maps share link" onBlur={async e=>{ const raw = e.target.value.trim(); if (!raw) return; const point = parseMapPoint(raw); if (point) { updateGeofencePin(index, point); return } setGeofenceStatus('Reading the Maps link...'); try { const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence/resolve-link`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: raw }) }); const data = await res.json().catch(()=>({})); if (!res.ok) throw new Error(data.detail || 'Could not read that link'); updateGeofencePin(index, { latitude: data.latitude, longitude: data.longitude }); setGeofenceStatus('Pin placed from the Google Maps link. Save location and message.') } catch (err) { setGeofenceStatus(err.message || 'Could not read that link') } }} />
                <input style={styles.editorInput} maxLength={120} placeholder="Message at this location" value={pin.message || ''} onChange={e=>updateGeofencePin(index,{message:e.target.value})} />
                <button type="button" style={styles.actionBtnCompact} onClick={()=>useGeofenceLocation(index)}>Use my location</button>
                <NearbyPinMap active={active} latitude={pin.latitude} longitude={pin.longitude} radius={geofence.radius_meters} onMove={(latitude, longitude)=>updateGeofencePin(index,{latitude,longitude})} />
                <button type="button" style={styles.actionBtn} disabled={savingGeofence} onClick={saveGeofence}>{savingGeofence ? 'Saving…' : 'Save location and message'}</button>
                <button type="button" style={styles.actionBtnCompact} onClick={testGeofenceNotification}>Test notification to saved cards</button>
                <button type="button" style={{...styles.actionBtnCompact,color:'#b91c1c',borderColor:'#fecaca'}} disabled={savingGeofence} onClick={()=>deleteGeofencePin(index)}>Delete location</button>
              </div>
            ))}
            <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
              <button type="button" style={styles.actionBtnCompact} onClick={()=>setGeofence(s=>({...s,pins:[...(s.pins||[]),{branch_public_id:'',label:'',message:s.message||'',latitude:'',longitude:''}]}))} disabled={(geofence.pins||[]).length >= Math.min(geofence.limits?.max_pins || 1, (geofence.branches || []).length || 1)}>Add branch location</button>
            </div>
            {geofenceStatus && <div style={{marginTop:10,fontSize:13,fontWeight:700,color:geofenceStatus.startsWith('Saved')?'#166534':'#b91c1c'}}>{geofenceStatus}</div>}
            </> : <p style={styles.mutedText}>{geofence.access_message}</p>}
          </div>
        </div>
    </>
    </div>
  )
}

function MiniMetric({ label, value, danger = false }) {
  return (
    <div className="an-statcard" data-danger={danger ? "true" : undefined} style={{...styles.statCard, borderTop:`4px solid ${danger ? '#ef4444' : '#0d9488'}`}}>
      <div className="an-statvalue" style={{...styles.statValue, color: danger ? '#b91c1c' : '#1e293b'}}>{value}</div>
      <div style={styles.statTitle}>{label}</div>
    </div>
  )
}

const styles = {
  actionBtn: {
    padding: '8px 16px',
    background: '#173f35',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  actionBtnCompact: {
    border:'1px solid #99f6e4', background:'#f2f7f4', color:'#173f35', borderRadius:9,
    padding:'8px 11px', fontSize:12, fontWeight:850, cursor:'pointer', whiteSpace:'nowrap',
  },
  auditRow: {
    display:'flex',
    justifyContent:'space-between',
    gap:12,
    alignItems:'center',
    padding:'10px 0',
    borderBottom:'1px solid #f1f5f9',
  },
  checkboxLabel: {
    display:'flex',
    alignItems:'center',
    justifyContent:'flex-end',
    gap:7,
    fontSize:13,
    fontWeight:700,
    color:'#475569',
    cursor:'pointer',
  },
  editorHelp: {
    marginTop:5,
    fontSize:11,
    color:'#94a3b8',
  },
  editorInput: {
    width:'100%',
    boxSizing:'border-box',
    border:'1px solid #cbd5e1',
    borderRadius:9,
    padding:'9px 10px',
    fontSize:13,
    color:'#1e293b',
    fontFamily:'inherit',
  },
  editorLabel: {
    display:'block',
    fontSize:13,
    fontWeight:700,
    color:'#334155',
    marginBottom:6,
  },
  editorNumber: {
    width:100,
    border:'1px solid #cbd5e1',
    borderRadius:9,
    padding:'9px 10px',
    fontSize:14,
  },
  editorSelect: {
    width:'100%',
    boxSizing:'border-box',
    border:'1px solid #cbd5e1',
    borderRadius:9,
    padding:'9px 10px',
    fontSize:13,
    color:'#1e293b',
    background:'white',
  },
  editorTextarea: {
    width:'100%',
    boxSizing:'border-box',
    border:'1px solid #cbd5e1',
    borderRadius:10,
    padding:'10px 12px',
    fontSize:13,
    color:'#1e293b',
    resize:'vertical',
    fontFamily:'inherit',
  },
  errorText: {
    gridColumn:'1 / -1',
    fontSize:12,
    color:'#b91c1c',
  },
  formGrid2: {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',
    gap:12,
    marginBottom:12,
  },
  insightCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  insightTitle: {
    margin: '0 0 12px 0',
    fontSize: 14,
    fontWeight: 600,
    color: '#64748b',
  },
  mutedText: {
    fontSize:12,
    color:'#64748b',
    marginTop:3,
  },
  noData: {
    textAlign: 'center',
    color: '#94a3b8',
    padding: 40,
    fontSize: 14,
  },
  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  rewardPanel: {
    marginTop:12,
    padding:14,
    border:'1px solid #ccfbf1',
    borderRadius:12,
    background:'#f2f7f4',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 16,
  },
  settingRow: {
    display:'flex',
    justifyContent:'space-between',
    alignItems:'center',
    gap:14,
    flexWrap:'wrap',
    marginBottom:14,
  },
  settingTitle: {
    fontSize:14,
    fontWeight:800,
    color:'#1e293b',
  },
  statCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  statTitle: {
    fontSize: 13,
    color: '#64748b',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 4,
  },
  statusGood: { background:'#dcfce7', color:'#166534' },
  statusPill: {
    display:'inline-block',
    padding:'4px 8px',
    borderRadius:999,
    fontSize:11,
    fontWeight:700,
    textTransform:'capitalize',
    background:'#e2e8f0',
    color:'#475569',
    whiteSpace:'nowrap',
  },
}

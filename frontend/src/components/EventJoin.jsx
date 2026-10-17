import React, { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

export default function EventJoin({ API_BASE }) {
  const { eventId } = useParams()
  const [searchParams] = useSearchParams()
  const lockedLevel = searchParams.get('level') || ''
  const [event, setEvent] = useState(null)
  const [levels, setLevels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedLevel, setSelectedLevel] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [gender, setGender] = useState('')
  const [ageBracket, setAgeBracket] = useState('')
  const [employment, setEmployment] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [ticket, setTicket] = useState(null)

  useEffect(() => {
    if (!eventId) return
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`${API_BASE}/api/v1/public/events/${eventId}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.detail || 'Event not found')
        setEvent(data.event || data)
        setLevels(data.access_levels || [])
        if (lockedLevel && (data.access_levels || []).some(l => l.public_id === lockedLevel)) {
          setSelectedLevel(lockedLevel)
        } else if ((data.access_levels || []).length === 1) {
          setSelectedLevel(data.access_levels[0].public_id)
        }
      } catch (e) {
        setError(e.message || 'Could not load event')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [eventId, API_BASE])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedLevel || !name.trim() || !agreed) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/public/events/${eventId}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_level_public_id: selectedLevel,
          attendee_name: name.trim(),
          attendee_email: email.trim() || null,
          attendee_phone: phone.trim() || null,
          address: address.trim() || null,
          gender: gender || null,
          age_bracket: ageBracket || null,
          employment_status: employment || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not claim ticket')
      setTicket(data)
    } catch (e) {
      setError(e.message || 'Could not claim ticket')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div style={styles.page}><p>Loading event…</p></div>
  if (error && !event) return <div style={styles.page}><p style={{ color: '#dc2626' }}>{error}</p></div>
  if (!event) return <div style={styles.page}><p>Event not found.</p></div>

  if (ticket) {
    const ticketId = ticket.ticket?.public_id || ticket.ticket_public_id
    const addToWallet = async () => {
      const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent)
      if (isApple) {
        window.location.href = `${API_BASE}/api/v1/public/tickets/${ticketId}/apple`
      } else {
        try {
          const res = await fetch(`${API_BASE}/api/v1/public/tickets/${ticketId}/google`)
          const data = await res.json().catch(() => ({}))
          if (data.add_to_wallet_url) window.location.href = data.add_to_wallet_url
        } catch {}
      }
    }
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, background: '#0d9488', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 28 }}>✓</div>
            <h2 style={{ margin: '0 0 6px', color: '#0f766e' }}>Ticket Claimed!</h2>
            <p style={{ margin: '0 0 16px', color: '#64748b' }}>Your ticket for <strong>{event.name}</strong> is ready.</p>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>Add it to your wallet, then show the QR at the entrance.</p>
          {ticketId && <button onClick={addToWallet} style={styles.walletBtn}>Add to Wallet</button>}
          <button onClick={() => { setTicket(null); setName(''); setEmail(''); setPhone(''); setAddress(''); setGender(''); setAgeBracket(''); setEmployment(''); setAgreed(false) }} style={{ ...styles.submit, background: '#e2e8f0', color: '#334155', marginTop: 12 }}>
            Claim another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: '#0d9488', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 24 }}>
            {event.name?.slice(0, 1) || 'E'}
          </div>
          <h2 style={{ margin: 0, fontSize: 22 }}>{event.name}</h2>
          {event.event_date && <p style={{ color: '#64748b', margin: '6px 0 0', fontSize: 13 }}>{new Date(event.event_date).toLocaleString()}</p>}
          {event.venue && <p style={{ color: '#64748b', margin: '2px 0 0', fontSize: 13 }}>{event.venue}</p>}
        </div>

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Access Level</label>
          <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value)} required disabled={!!lockedLevel} style={styles.input}>
            <option value="">Select level</option>
            {levels.map(lvl => (
              <option key={lvl.public_id} value={lvl.public_id}>{lvl.name}</option>
            ))}
          </select>

          <label style={styles.label}>Full Name</label>
          <input value={name} onChange={e => setName(e.target.value)} required placeholder="Juan Dela Cruz" style={styles.input} />

          <label style={styles.label}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" style={styles.input} />

          <label style={styles.label}>Phone Number</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="09xx xxx xxxx" style={styles.input} />

          <label style={styles.label}>Address</label>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="City / Province" style={styles.input} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={styles.label}>Gender</label>
              <select value={gender} onChange={e => setGender(e.target.value)} style={styles.input}>
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="prefer_not">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label style={styles.label}>Age Bracket</label>
              <select value={ageBracket} onChange={e => setAgeBracket(e.target.value)} style={styles.input}>
                <option value="">Select</option>
                <option value="18-24">18–24</option>
                <option value="25-34">25–34</option>
                <option value="35-44">35–44</option>
                <option value="45-54">45–54</option>
                <option value="55+">55+</option>
              </select>
            </div>
          </div>

          <label style={styles.label}>Employment Status</label>
          <select value={employment} onChange={e => setEmployment(e.target.value)} style={styles.input}>
            <option value="">Select</option>
            <option value="employed">Employed</option>
            <option value="self_employed">Self-employed</option>
            <option value="student">Student</option>
            <option value="unemployed">Unemployed</option>
            <option value="retired">Retired</option>
          </select>

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 14 }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} required style={{ marginTop: 2 }} />
            <span>I agree to the <a href="/terms" target="_blank" style={{ color: '#0d9488' }}>Terms and Conditions</a> and consent to the collection of my information for this event.</span>
          </label>

          {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</p>}

          <button type="submit" disabled={submitting || !agreed} style={styles.submit}>
            {submitting ? 'Claiming…' : 'Claim Ticket'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { background: '#fff', borderRadius: 16, padding: 28, maxWidth: 440, width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 12, marginBottom: 4 },
  input: { width: '100%', padding: '12px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' },
  submit: { width: '100%', padding: 14, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, marginTop: 18, cursor: 'pointer' },
  walletBtn: { display: 'block', width: '100%', padding: 14, background: '#0d9488', color: '#fff', textAlign: 'center', borderRadius: 10, fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 15, marginTop: 16 },
}

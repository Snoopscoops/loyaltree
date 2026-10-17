import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

export default function EventJoin({ API_BASE }) {
  const { eventId } = useParams()
  const [event, setEvent] = useState(null)
  const [levels, setLevels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedLevel, setSelectedLevel] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
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
        if ((data.access_levels || []).length === 1) {
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
    if (!selectedLevel || !name.trim()) return
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
          send_email_confirmation: sendEmail && !!email.trim(),
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
          <h2 style={{ marginTop: 0, color: '#0f766e' }}>Ticket claimed!</h2>
          <p>Your ticket for <strong>{event.name}</strong> is ready.</p>
          <p style={{ fontSize: 13, color: '#64748b' }}>Add it to your wallet, then show the QR code at the entrance.</p>
          {ticketId && (
            <button onClick={addToWallet} style={styles.walletBtn}>
              Add to Wallet
            </button>
          )}
          <button onClick={() => { setTicket(null); setName(''); setEmail(''); setPhone('') }} style={{ ...styles.submit, background: '#e2e8f0', color: '#334155', marginTop: 12 }}>
            Claim another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={{ marginTop: 0 }}>{event.name}</h2>
        {event.event_date && <p style={{ color: '#64748b', margin: '4px 0' }}>{new Date(event.event_date).toLocaleString()}</p>}
        {event.venue && <p style={{ color: '#64748b', margin: '4px 0' }}>{event.venue}</p>}

        <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
          <label style={styles.label}>Access level</label>
          <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value)} required style={styles.input}>
            <option value="">Select level</option>
            {levels.map(lvl => (
              <option key={lvl.public_id} value={lvl.public_id}>
                {lvl.name}{lvl.ticket_price > 0 ? ` — ₱${lvl.ticket_price}` : ' — Free'}
              </option>
            ))}
          </select>

          <label style={styles.label}>Your name</label>
          <input value={name} onChange={e => setName(e.target.value)} required placeholder="Full name" style={styles.input} />

          <label style={styles.label}>Email <span style={{ color: '#94a3b8' }}>(optional)</span></label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" style={styles.input} />

          <label style={styles.label}>Phone <span style={{ color: '#94a3b8' }}>(optional)</span></label>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="09xx" style={styles.input} />

          {email && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
              <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} />
              Send email confirmation (+₱2)
            </label>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}

          <button type="submit" disabled={submitting} style={styles.submit}>
            {submitting ? 'Claiming…' : 'Claim Ticket'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { background: '#fff', borderRadius: 16, padding: 28, maxWidth: 420, width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 12, marginBottom: 4 },
  input: { width: '100%', padding: '12px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box' },
  submit: { width: '100%', padding: 14, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, marginTop: 18, cursor: 'pointer' },
  walletBtn: { display: 'block', width: '100%', padding: 14, background: '#0d9488', color: '#fff', textAlign: 'center', borderRadius: 10, textDecoration: 'none', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: 15, marginTop: 16 },
}

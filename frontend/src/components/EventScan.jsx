import React, { useState } from 'react'

export default function EventScan({ API_BASE, user, authFetch }) {
  const [qr, setQr] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  const slug = user?.business_slug

  const handleScan = async (e) => {
    e.preventDefault()
    if (!qr.trim() || !slug) return
    setScanning(true)
    setError('')
    setResult(null)
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${slug}/events/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_payload: qr.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Scan failed')
      setResult(data)
      setQr('')
    } catch (e) {
      setError(e.message || 'Could not scan ticket')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={{ marginTop: 0, fontSize: 20 }}>🎟️ Scan Event Ticket</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Enter or scan the ticket QR to allow entry.</p>

        <form onSubmit={handleScan} style={{ marginTop: 16 }}>
          <input
            value={qr}
            onChange={e => setQr(e.target.value)}
            placeholder="lt-ticket:tkt_..."
            autoFocus
            style={styles.input}
          />
          <button type="submit" disabled={scanning || !qr.trim()} style={styles.submit}>
            {scanning ? 'Scanning…' : 'Scan Ticket'}
          </button>
        </form>

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{error}</p>}

        {result && (
          <div style={{ marginTop: 16, background: '#f0fdfa', borderRadius: 12, padding: 14 }}>
            <div style={{ color: '#0f766e', fontWeight: 700 }}>✓ Entry Allowed</div>
            <div style={{ fontSize: 14, marginTop: 6 }}><b>{result.attendee_name || 'Attendee'}</b></div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Ticket: {result.ticket_public_id}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{new Date(result.scanned_at).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { background: '#fff', borderRadius: 16, padding: 28, maxWidth: 420, width: '100%', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' },
  input: { width: '100%', padding: '14px 16px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 15, boxSizing: 'border-box' },
  submit: { width: '100%', padding: 14, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, marginTop: 12, cursor: 'pointer' },
}

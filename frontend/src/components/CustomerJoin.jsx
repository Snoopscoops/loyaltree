import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

function CustomerJoin({ API_BASE }) {
  const { businessSlug } = useParams()
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/customer/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_slug: businessSlug, ...form })
      })
      const data = await res.json()
      if (res.ok) {
        setSubmitted(true)
      } else {
        setError(data.detail || 'Something went wrong')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={styles.title}>You&apos;re In!</h1>
          <p style={styles.subtitle}>Your loyalty card has been created.</p>
          <div style={styles.infoBox}>
            <p style={styles.infoLabel}>Your Member ID</p>
            <p style={styles.infoValue}>Show this QR code on every visit</p>
          </div>
          <button 
            onClick={() => navigate(`/wallet/${businessSlug}`)}
            style={styles.walletBtn}
          >
            📱 View My Digital Card
          </button>
          <p style={styles.hint}>
            Save this to your phone or add to Google Wallet
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logoBox}>
          <span style={styles.logoIcon}>🌳</span>
        </div>
        <h1 style={styles.title}>Join Rewards</h1>
        <p style={styles.subtitle}>Get stamps. Earn rewards. It&apos;s that simple.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Full Name</label>
            <input
              placeholder="John Doe"
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              style={styles.input}
              required
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Phone Number</label>
            <input
              placeholder="+1 234 567 8900"
              value={form.phone}
              onChange={e => setForm({...form, phone: e.target.value})}
              style={styles.input}
              required
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email <span style={styles.optional}>(optional)</span></label>
            <input
              placeholder="john@email.com"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              style={styles.input}
              type="email"
            />
          </div>
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Creating...' : 'Get My Loyalty Card'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}

        <p style={styles.terms}>
          By joining, you agree to receive updates about your rewards.<br/>
          No spam, ever.
        </p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f766e 0%, #134e4a 50%, #0f172a 100%)',
    padding: 20,
  },
  card: {
    background: 'white',
    borderRadius: 24,
    padding: '48px 40px',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    textAlign: 'center',
  },
  logoBox: {
    width: 64,
    height: 64,
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 24px',
  },
  logoIcon: {
    fontSize: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    color: '#0f172a',
    margin: '0 0 8px',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 15,
    margin: '0 0 32px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    textAlign: 'left',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: 500,
    color: '#334155',
  },
  optional: {
    color: '#94a3b8',
    fontWeight: 400,
  },
  input: {
    padding: '14px 16px',
    borderRadius: 12,
    border: '1.5px solid #e2e8f0',
    fontSize: 15,
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s',
  },
  button: {
    padding: '16px',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 8,
  },
  error: {
    padding: '12px 16px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 10,
    fontSize: 14,
    marginTop: 12,
  },
  terms: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 20,
    lineHeight: 1.6,
  },
  infoBox: {
    background: '#f0fdf4',
    borderRadius: 12,
    padding: 20,
    margin: '24px 0',
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#065f46',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    margin: '0 0 4px',
  },
  infoValue: {
    fontSize: 14,
    color: '#059669',
    margin: 0,
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 1.6,
    marginTop: 16,
  },
  walletBtn: {
    width: '100%',
    padding: '16px',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 20,
  },
}

export default CustomerJoin

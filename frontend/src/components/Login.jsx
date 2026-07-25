import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function LoginPage({ API_BASE, onLogin }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login') // login, signup
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    phone: '',
    business_type: 'restaurant',
    plan: 'starter'
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingNotice, setPendingNotice] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setPendingNotice('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password
        })
      })
      const data = await res.json()
      if (res.ok) {
        onLogin(data)
        if (data.role === 'owner') navigate('/dashboard')
        else if (data.role === 'super_admin') navigate('/admin')
        else navigate('/scanner')
      } else if (res.status === 403) {
        // Account exists and password matched, but the business isn't
        // approved/active yet - show a softer notice instead of a hard error.
        setPendingNotice(data.detail || 'Your account is not active yet.')
      } else {
        setError(data.detail || 'Login failed')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setPendingNotice('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          business_type: form.business_type,
          plan: form.plan
        })
      })
      const data = await res.json()
      if (res.ok) {
        // New businesses start out PENDING and can't log in until an admin
        // approves them, so don't try to auto-login - just switch back to
        // the login form and show a clear pending-approval notice.
        setMode('login')
        setPendingNotice("Application submitted! We'll email you once your account is approved.")
      } else {
        setError(data.detail || 'Signup failed')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <span style={styles.logo}>🌳</span>
          <h1 style={styles.title}>LoyaltyTree</h1>
          <p style={styles.tagline}>Where businesses grow with customers</p>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {pendingNotice && <div style={styles.pendingNotice}>⏳ {pendingNotice}</div>}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={styles.form}>
            <input
              style={styles.input}
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={e => setForm({...form, password: e.target.value})}
              required
            />
            <button type="submit" style={styles.btn} disabled={loading}>
              {loading ? 'Growing...' : '🌱 Sign In'}
            </button>
            <p style={styles.switch}>
              New here? <button type="button" style={styles.link} onClick={() => { setMode('signup'); setError(''); setPendingNotice('') }}>Plant your tree</button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignup} style={styles.form}>
            <input
              style={styles.input}
              placeholder="Business Name"
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              required
            />
            <input
              style={styles.input}
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password (min 8 chars)"
              value={form.password}
              onChange={e => setForm({...form, password: e.target.value})}
              required
            />
            <input
              style={styles.input}
              placeholder="Phone"
              value={form.phone}
              onChange={e => setForm({...form, phone: e.target.value})}
            />
            <select
              style={styles.input}
              value={form.business_type}
              onChange={e => setForm({...form, business_type: e.target.value})}
            >
              <option value="restaurant">Restaurant</option>
              <option value="cafe">Cafe</option>
              <option value="retail">Retail</option>
              <option value="salon">Salon</option>
              <option value="gym">Gym</option>
              <option value="other">Other</option>
            </select>
            <button type="submit" style={styles.btn} disabled={loading}>
              {loading ? 'Planting...' : '🌳 Create Account'}
            </button>
            <p style={styles.switch}>
              Already growing? <button type="button" style={styles.link} onClick={() => { setMode('login'); setError(''); setPendingNotice('') }}>Sign in</button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0fdf4 0%, #d1fae5 50%, #a7f3d0 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: 'white',
    borderRadius: 24,
    padding: '32px 24px',
    width: '100%',
    maxWidth: 400,
    boxSizing: 'border-box',
    boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
  },
  brand: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 56,
    display: 'block',
    marginBottom: 8,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: '#0f766e',
  },
  tagline: {
    margin: '8px 0 0 0',
    fontSize: 14,
    color: '#0d9488',
  },
  error: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: 12,
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  pendingNotice: {
    background: '#fef3c7',
    color: '#92400e',
    padding: 12,
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    padding: '14px 16px',
    border: '2px solid #e2e8f0',
    borderRadius: 12,
    fontSize: 16,
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
    width: '100%',
  },
  btn: {
    padding: '16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
  },
  switch: {
    textAlign: 'center',
    fontSize: 14,
    color: '#64748b',
    margin: '8px 0 0 0',
  },
  link: {
    background: 'none',
    border: 'none',
    color: '#0d9488',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
  },
}

export default LoginPage

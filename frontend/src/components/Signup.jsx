import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

function Signup({ API_BASE }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    business_type: 'spa',
    plan: 'starter'
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess('Account created! Redirecting...')
        setTimeout(() => navigate('/'), 2000)
      } else {
        setError(data.detail || 'Signup failed')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 56, textAlign: 'center', marginBottom: 16 }}>🎉</div>
          <h1 style={styles.title}>Welcome Aboard!</h1>
          <p style={styles.subtitle}>{success}</p>
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
        <h1 style={styles.title}>Get Started</h1>
        <p style={styles.subtitle}>Create your business account</p>

        <form onSubmit={handleSignup} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Business Name</label>
            <input name="name" value={form.name} onChange={handleChange} style={styles.input} placeholder="Serenity Spa" required />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} style={styles.input} placeholder="you@business.com" required />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input name="password" type="password" value={form.password} onChange={handleChange} style={styles.input} placeholder="Min 8 characters" required minLength={8} />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Phone</label>
            <input name="phone" value={form.phone} onChange={handleChange} style={styles.input} placeholder="+1 234 567 8900" />
          </div>
          <div style={styles.row}>
            <div style={{ ...styles.inputGroup, flex: 1 }}>
              <label style={styles.label}>Type</label>
              <select name="business_type" value={form.business_type} onChange={handleChange} style={styles.select}>
                <option value="spa">Spa</option>
                <option value="salon">Salon</option>
                <option value="fitness">Fitness</option>
                <option value="restaurant">Restaurant</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ ...styles.inputGroup, flex: 1 }}>
              <label style={styles.label}>Plan</label>
              <select name="plan" value={form.plan} onChange={handleChange} style={styles.select}>
                <option value="starter">Starter $29</option>
                <option value="growth">Growth $79</option>
                <option value="pro">Pro $199</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}

        <p style={styles.footer}>
          Already have an account? <Link to="/" style={styles.link}>Sign in</Link>
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
    borderRadius: 20,
    padding: '48px 40px',
    width: '100%',
    maxWidth: 440,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
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
    textAlign: 'center',
    color: '#0f172a',
    fontSize: 28,
    fontWeight: 700,
    margin: '0 0 8px',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 15,
    margin: '0 0 32px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
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
  input: {
    padding: '12px 16px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 15,
    outline: 'none',
    fontFamily: 'inherit',
  },
  select: {
    padding: '12px 16px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 15,
    outline: 'none',
    background: 'white',
    fontFamily: 'inherit',
  },
  row: {
    display: 'flex',
    gap: 12,
  },
  button: {
    padding: '14px',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
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
  footer: {
    textAlign: 'center',
    color: '#64748b',
    fontSize: 14,
    marginTop: 24,
  },
  link: {
    color: '#0d9488',
    fontWeight: 600,
    textDecoration: 'none',
  },
}

export default Signup

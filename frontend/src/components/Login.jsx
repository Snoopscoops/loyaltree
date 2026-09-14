import React, { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import logo256 from './logo-256.png'

function LoginPage({ API_BASE, onLogin }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('expired') === '1'
  const resetToken = searchParams.get('reset') || ''
  const [forgotMode, setForgotMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetNotice, setResetNotice] = useState('')
  const [resetForm, setResetForm] = useState({ password: '', confirmPassword: '' })
  const [form, setForm] = useState({
    email: '',
    password: '',
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
        if (data.role === 'owner') navigate('/dashboard', { replace: true })
        else if (data.role === 'super_admin') navigate('/admin', { replace: true })
        else if (data.role === 'partner') navigate('/partner', { replace: true })
        else if (data.role === 'agent') {
          window.location.assign(data.redirect_url || `${API_BASE}/agent/${data.business_slug}`)
        } else navigate('/scanner', { replace: true })
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

  const requestPasswordReset = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResetNotice('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not send reset email')
      setResetNotice(data.message || 'If that email belongs to a LoyaltyTree business account, a reset link has been sent.')
    } catch (err) {
      setError(err.message || 'Network error')
    }
    setLoading(false)
  }

  const confirmPasswordReset = async (e) => {
    e.preventDefault()
    setError('')
    setResetNotice('')
    if (resetForm.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (resetForm.password !== resetForm.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, new_password: resetForm.password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not reset password')
      setResetNotice(data.message || 'Password updated. You can now sign in.')
      setResetForm({ password: '', confirmPassword: '' })
    } catch (err) {
      setError(err.message || 'Network error')
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <img src={logo256} alt="LoyaltyTree" style={styles.logo} />
          <h1 style={styles.title}>LoyaltyTree</h1>
          <p style={styles.tagline}>Where businesses grow with customers</p>
        </div>

        {!resetToken && !forgotMode && sessionExpired && !error && !pendingNotice && (
          <div style={styles.sessionNotice}>Your session expired. Please sign in again.</div>
        )}
        {error && <div style={styles.error}>{error}</div>}
        {pendingNotice && !resetToken && !forgotMode && <div style={styles.pendingNotice}>⏳ {pendingNotice}</div>}
        {resetNotice && <div style={styles.sessionNotice}>{resetNotice}</div>}

        {resetToken ? (
          <form onSubmit={confirmPasswordReset} style={styles.form}>
            <div style={styles.resetHeading}>Create a new password</div>
            <p style={styles.resetCopy}>Use at least 8 characters. This reset link can only be used once.</p>
            <input
              style={styles.input}
              type="password"
              placeholder="New password"
              value={resetForm.password}
              onChange={e => setResetForm({...resetForm, password: e.target.value})}
              minLength={8}
              autoComplete="new-password"
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Confirm new password"
              value={resetForm.confirmPassword}
              onChange={e => setResetForm({...resetForm, confirmPassword: e.target.value})}
              minLength={8}
              autoComplete="new-password"
              required
            />
            <button type="submit" style={styles.btn} disabled={loading}>
              {loading ? 'Updating...' : 'Reset Password'}
            </button>
            <button type="button" style={styles.textButton} onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </button>
          </form>
        ) : forgotMode ? (
          <form onSubmit={requestPasswordReset} style={styles.form}>
            <div style={styles.resetHeading}>Forgot your password?</div>
            <p style={styles.resetCopy}>Enter the registered business email. We’ll send a secure reset link if the account exists.</p>
            <input
              style={styles.input}
              type="email"
              placeholder="Registered business email"
              value={resetEmail}
              onChange={e => setResetEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <button type="submit" style={styles.btn} disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <button type="button" style={styles.textButton} onClick={() => { setForgotMode(false); setError(''); setResetNotice('') }}>
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} style={styles.form}>
            <input
              style={styles.input}
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              autoComplete="email"
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={e => setForm({...form, password: e.target.value})}
              autoComplete="current-password"
              required
            />
            <button type="button" style={styles.forgotButton} onClick={() => { setForgotMode(true); setResetEmail(form.email); setError(''); setPendingNotice(''); setResetNotice('') }}>
              Forgot password?
            </button>
            <button type="submit" style={styles.btn} disabled={loading}>
              {loading ? 'Growing...' : '🌱 Sign In'}
            </button>
            <p style={styles.switch}>
              New here? <Link to="/signup" style={styles.link}>Plant your tree</Link>
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
    width: 72,
    height: 72,
    borderRadius: '50%',
    display: 'block',
    margin: '0 auto 8px',
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
  sessionNotice: {
    background: '#ecfeff',
    color: '#115e59',
    padding: 12,
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 1.5,
    border: '1px solid #99f6e4',
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
  forgotButton: {
    alignSelf: 'flex-end',
    background: 'none',
    border: 'none',
    color: '#0d9488',
    fontSize: 13,
    fontWeight: 650,
    cursor: 'pointer',
    padding: '0 2px 2px',
  },
  textButton: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '6px 0 0',
  },
  resetHeading: {
    fontSize: 20,
    fontWeight: 750,
    color: '#0f172a',
    textAlign: 'center',
  },
  resetCopy: {
    margin: '-2px 0 4px',
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.5,
    textAlign: 'center',
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
    textDecoration: 'none',
  },
}

export default LoginPage

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
        if (data.role === 'owner' || data.role === 'manager') navigate('/dashboard', { replace: true })
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
    <div style={styles.shell}>
      <section style={styles.left}>
        <div style={styles.brand}><img src={logo256} alt="" style={styles.mark} /> LoyaltyTree</div>
        <h1 style={styles.hero}>Your cards.<br />One LT Points balance.</h1>
        <p style={styles.heroCopy}>Customers scan a QR. No app. The same email connects every business card to one shared balance.</p>
        <div style={styles.proof}><div><strong>61</strong><span>businesses on board</span></div><div><strong>8,000+</strong><span>wallet cards</span></div><div><strong>₱350</strong><span>from month two</span></div></div>
      </section>
      <section style={styles.right}>
        <div style={styles.switchTop}>New business? <Link to="/signup" style={styles.link}>Create account</Link></div>
        <h2 style={styles.heading}>{resetToken ? 'New password' : forgotMode ? 'Reset password' : 'Sign in'}</h2>
        <p style={styles.sub}>{resetToken ? 'Use at least 8 characters. This link works once.' : forgotMode ? 'We’ll email a reset link if the account exists.' : 'Business dashboard. Not the customer wallet.'}</p>
        {!resetToken && !forgotMode && sessionExpired && !error && !pendingNotice && <div style={styles.notice}>Your session expired. Please sign in again.</div>}
        {error && <div style={styles.error}>{error}</div>}
        {pendingNotice && !resetToken && !forgotMode && <div style={styles.pending}>{pendingNotice}</div>}
        {resetNotice && <div style={styles.notice}>{resetNotice}</div>}
        {resetToken ? (
          <form onSubmit={confirmPasswordReset} style={styles.form}>
            <label style={styles.label}>New password<input style={styles.input} type="password" value={resetForm.password} onChange={e => setResetForm({...resetForm, password: e.target.value})} minLength={8} autoComplete="new-password" required /></label>
            <label style={styles.label}>Confirm password<input style={styles.input} type="password" value={resetForm.confirmPassword} onChange={e => setResetForm({...resetForm, confirmPassword: e.target.value})} minLength={8} autoComplete="new-password" required /></label>
            <button type="submit" style={styles.btn} disabled={loading}>{loading ? 'Updating…' : 'Reset password'}</button>
            <button type="button" style={styles.textButton} onClick={() => navigate('/login', { replace: true })}>Back to sign in</button>
          </form>
        ) : forgotMode ? (
          <form onSubmit={requestPasswordReset} style={styles.form}>
            <label style={styles.label}>Business email<input style={styles.input} type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} autoComplete="email" required /></label>
            <button type="submit" style={styles.btn} disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
            <button type="button" style={styles.textButton} onClick={() => { setForgotMode(false); setError(''); setResetNotice('') }}>Back to sign in</button>
          </form>
        ) : (
          <form onSubmit={handleLogin} style={styles.form}>
            <label style={styles.label}>Email<input style={styles.input} type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} autoComplete="email" required /></label>
            <label style={styles.label}>Password<input style={styles.input} type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} autoComplete="current-password" required /></label>
            <button type="button" style={styles.forgotButton} onClick={() => { setForgotMode(true); setResetEmail(form.email); setError(''); setPendingNotice(''); setResetNotice('') }}>Forgot password</button>
            <button type="submit" style={styles.btn} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}
      </section>
    </div>
  )
}

const styles = {
  shell: { minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.05fr .95fr', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', color: '#102d28', background: '#f8f6ef' },
  left: { background: '#073f36', color: '#fff', padding: '36px 48px', display: 'flex', flexDirection: 'column' },
  brand: { display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 },
  mark: { width: 28, height: 28, borderRadius: '50%' },
  hero: { margin: '72px 0 12px', fontSize: 'clamp(40px, 5vw, 58px)', lineHeight: .98, letterSpacing: '-1.6px', fontWeight: 700, maxWidth: 520 },
  heroCopy: { margin: 0, maxWidth: 420, color: '#d5e2db', fontSize: 17, lineHeight: 1.55 },
  proof: { marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, paddingTop: 48 },
  right: { padding: '36px 56px', display: 'flex', flexDirection: 'column' },
  switchTop: { marginLeft: 'auto', fontSize: 14, color: '#5d726a' },
  heading: { margin: '56px 0 8px', fontSize: 32, letterSpacing: '-.8px' },
  sub: { margin: '0 0 28px', color: '#5d726a', fontSize: 15 },
  form: { display: 'grid', gap: 14, maxWidth: 420 },
  label: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 650 },
  input: { height: 46, border: '1px solid #e4eee8', borderRadius: 10, padding: '0 14px', font: 'inherit', background: '#fff', color: '#102d28' },
  btn: { height: 48, border: 0, borderRadius: 10, background: '#073f36', color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer' },
  forgotButton: { border: 0, background: 'none', color: '#073f36', font: 'inherit', fontWeight: 650, cursor: 'pointer', padding: 0, textAlign: 'left' },
  textButton: { border: 0, background: 'none', color: '#5d726a', font: 'inherit', fontWeight: 650, cursor: 'pointer', padding: 0, textAlign: 'left' },
  link: { color: '#073f36', fontWeight: 700, textDecoration: 'none' },
  error: { color: '#9f2d2d', fontSize: 13, fontWeight: 650 },
  notice: { color: '#166534', fontSize: 13, fontWeight: 650 },
  pending: { color: '#8b7047', fontSize: 13, fontWeight: 650 },
}

export default LoginPage

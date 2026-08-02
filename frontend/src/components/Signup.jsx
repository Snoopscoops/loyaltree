import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import SubscriptionPayment from './SubscriptionPayment'
import logo128 from './logo-128.png'

// Mirrors the backend's branch_price_bracket() - price scales with branch
// count independently of which plan (feature tier) is chosen.
function branchBracket(branchCount) {
  const n = Number(branchCount) || 1
  if (n <= 1) return '1'
  if (n <= 3) return '2-3'
  return '5'
}

function priceFor(planData, branchCount) {
  if (!planData) return null
  const bracket = branchBracket(branchCount)
  return planData.price_tiers?.[bracket] ?? planData.price_month
}

function Signup({ API_BASE }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    logo_url: '',
    address: '',
    business_type: 'spa',
    branch_count: 1,
    plan: 'starter',
  })
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 'form' -> 'choice' (account is live on a free trial - pay now or wait) -> 'payment' (optional, pay early) -> 'activated'
  const [step, setStep] = useState('form')
  const [businessSlug, setBusinessSlug] = useState('')
  const [trialExpiresAt, setTrialExpiresAt] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/plans`)
      .then(res => res.json())
      .then(setPlans)
      .catch(() => {}) // tier hint just won't show a price if this fails - signup still works
  }, [API_BASE])

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const branchCount = Number(form.branch_count) || 1
  const selectedPlanData = plans?.[form.plan]
  const selectedExceedsCap = selectedPlanData?.max_branches != null && branchCount > selectedPlanData.max_branches

  const handleSignup = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, branch_count: branchCount })
      })
      const data = await res.json()
      if (res.ok) {
        setBusinessSlug(data.business_slug)
        setTrialExpiresAt(data.trial_expires_at || '')
        setStep('choice')
      } else {
        setError(data.detail || 'Signup failed')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  if (step === 'activated') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 56, textAlign: 'center', marginBottom: 16 }}>✅</div>
          <h1 style={styles.title}>You're All Set!</h1>
          <p style={styles.subtitle}>Payment received - you're all paid up. Sign in to get started.</p>
          <button type="button" onClick={() => navigate('/login')} style={styles.button}>
            Go to Sign In
          </button>
        </div>
      </div>
    )
  }

  if (step === 'choice') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 56, textAlign: 'center', marginBottom: 16 }}>🎉</div>
          <h1 style={styles.title}>Your Free Trial Has Started!</h1>
          <p style={styles.subtitle}>
            Your account is live right now - no payment needed yet.
            {trialExpiresAt && <> Free access runs through <strong>{trialExpiresAt}</strong>.</>}
          </p>

          <button type="button" onClick={() => navigate('/login')} style={styles.button}>
            Start Using My Free Trial
          </button>
          <button type="button" onClick={() => setStep('payment')} style={styles.secondaryButton}>
            Pay Now Instead
          </button>

          <p style={styles.footer}>
            You can always pay later from your dashboard before the trial ends.
          </p>
        </div>
      </div>
    )
  }

  if (step === 'payment') {
    return (
      <div style={styles.page}>
        <SubscriptionPayment
          API_BASE={API_BASE}
          businessSlug={businessSlug}
          title="Pay Now"
          subtitle="Your account is already live on a free trial - paying now just locks in your plan and skips any interruption once the trial ends."
          successMessage="🎉 Payment received - you're all paid up!"
          onPaid={() => setStep('activated')}
        />
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src={logo128} alt="LoyaltyTree" style={styles.logoBox} />
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
          <div style={styles.inputGroup}>
            <label style={styles.label}>Business Address</label>
            <input name="address" value={form.address} onChange={handleChange} style={styles.input} placeholder="123 Main St, City" />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Logo URL (optional)</label>
            <input name="logo_url" value={form.logo_url} onChange={handleChange} style={styles.input} placeholder="https://your-cdn.com/logo.png" />
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
              <label style={styles.label}>Number of Branches</label>
              <input
                name="branch_count"
                type="number"
                min={1}
                max={50}
                value={form.branch_count}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Plan</label>
            <div style={styles.planOptions}>
              {plans && Object.entries(plans).map(([key, p]) => {
                const price = priceFor(p, branchCount)
                const exceedsCap = p.max_branches != null && branchCount > p.max_branches
                const selected = form.plan === key
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setForm({ ...form, plan: key })}
                    style={{
                      ...styles.planOption,
                      ...(selected ? styles.planOptionSelected : {}),
                    }}
                  >
                    <span style={styles.planOptionName}>{p.label}</span>
                    <span style={styles.planOptionPrice}>₱{price?.toLocaleString()}/mo</span>
                    {exceedsCap && (
                      <span style={styles.planOptionWarning}>Supports up to {p.max_branches} branch{p.max_branches !== 1 ? 'es' : ''}</span>
                    )}
                  </button>
                )
              })}
            </div>
            {selectedExceedsCap && (
              <div style={styles.planCapNotice}>
                {selectedPlanData.label} supports up to {selectedPlanData.max_branches} branch{selectedPlanData.max_branches !== 1 ? 'es' : ''} - reduce your branch count or choose a higher plan.
              </div>
            )}
          </div>

          <button type="submit" disabled={loading || selectedExceedsCap} style={styles.button}>
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}

        <p style={styles.footer}>
          Already have an account? <Link to="/login" style={styles.link}>Sign in</Link>
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
    borderRadius: '50%',
    display: 'block',
    margin: '0 auto 24px',
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
  planOptions: {
    display: 'flex',
    gap: 8,
  },
  planOption: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '10px 8px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    background: 'white',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  planOptionSelected: {
    border: '1.5px solid #0d9488',
    background: '#f0fdfa',
  },
  planOptionName: {
    fontSize: 13,
    fontWeight: 700,
    color: '#0f766e',
  },
  planOptionPrice: {
    fontSize: 12.5,
    fontWeight: 600,
    color: '#0d9488',
  },
  planOptionWarning: {
    fontSize: 10.5,
    color: '#d97706',
    textAlign: 'center',
  },
  planCapNotice: {
    fontSize: 12.5,
    color: '#d97706',
    marginTop: 6,
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
  secondaryButton: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px',
    background: 'white',
    color: '#0f766e',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 10,
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

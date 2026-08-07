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
    setup_kit_requested: false,
    kit_recipient_name: '',
    kit_contact_number: '',
    kit_delivery_address: '',
    kit_delivery_instructions: '',
  })
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 'form' -> 'choice' (one-day setup access is live) -> 'payment' -> 'activated'
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
    if (form.setup_kit_requested) {
      if (!form.logo_url.trim()) return setError('Business logo URL is required for the physical QR kit.')
      if (!form.kit_recipient_name.trim() || !form.kit_contact_number.trim() || !form.kit_delivery_address.trim()) {
        return setError('Complete recipient and delivery details are required for the physical QR kit.')
      }
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          branch_count: branchCount,
          setup_kit_requested: Boolean(form.setup_kit_requested),
        })
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
          <h1 style={styles.title}>Your Setup Access Is Ready</h1>
          <p style={styles.subtitle}>
            Your account is active for one day so you can set up your card, branding, staff, and QR code.
            {trialExpiresAt && <> Setup access ends on <strong>{trialExpiresAt}</strong>.</>}
          </p>

          {form.setup_kit_requested && (
            <div style={styles.kitConfirmation}>
              <strong>Physical QR / PR Kit requested — ₱150</strong>
              <span>Includes a Sintra board QR display. Delivery is expected within 3–5 days after payment confirmation.</span>
            </div>
          )}

          <button type="button" onClick={() => navigate('/login')} style={styles.button}>
            Continue to 1-Day Setup
          </button>
          <button type="button" onClick={() => setStep('payment')} style={styles.secondaryButton}>
            Pay and Activate Plan
          </button>

          <p style={styles.footer}>
            Complete payment within the setup period to keep the account active without interruption.
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
          subtitle={form.setup_kit_requested
            ? "Your total includes your selected monthly plan plus the ₱150 Sintra board QR / PR Kit. Delivery is expected within 3–5 days after payment confirmation."
            : "Pay now to activate your selected monthly plan before the one-day setup access ends."}
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
                <option value="retail">Retail</option>
                <option value="clinic">Clinic / Wellness</option>
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

          <div style={styles.kitCard}>
            <label style={styles.kitLabel}>
              <input
                type="checkbox"
                checked={form.setup_kit_requested}
                onChange={e => setForm({...form, setup_kit_requested: e.target.checked})}
                style={styles.checkbox}
              />
              <span style={styles.kitCopy}>
                <strong>Physical QR / PR Kit — ₱150 one-time</strong>
                <span>Sintra board QR display delivered to your business doorstep within 3–5 days after payment confirmation.</span>
              </span>
            </label>
          </div>

          {form.setup_kit_requested && (
            <div style={styles.kitDeliveryCard}>
              <strong style={styles.kitDeliveryTitle}>Delivery information</strong>
              <span style={styles.kitDeliveryHint}>The QR is generated automatically. Confirm who will receive the printed kit.</span>
              <label style={styles.label}>Recipient name</label>
              <input name="kit_recipient_name" value={form.kit_recipient_name} onChange={handleChange} style={styles.input} required />
              <label style={styles.label}>Delivery contact number</label>
              <input name="kit_contact_number" value={form.kit_contact_number} onChange={handleChange} style={styles.input} required />
              <label style={styles.label}>Complete delivery address</label>
              <textarea name="kit_delivery_address" value={form.kit_delivery_address} onChange={handleChange} style={{...styles.input,minHeight:80,resize:'vertical'}} required />
              <label style={styles.label}>Delivery instructions (optional)</label>
              <textarea name="kit_delivery_instructions" value={form.kit_delivery_instructions} onChange={handleChange} style={{...styles.input,minHeight:60,resize:'vertical'}} />
            </div>
          )}

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
  kitCard: {
    border: '1.5px solid #99f6e4',
    background: '#f0fdfa',
    borderRadius: 12,
    padding: 14,
  },
  kitLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    cursor: 'pointer',
  },
  checkbox: {
    width: 18,
    height: 18,
    marginTop: 2,
    accentColor: '#0d9488',
  },
  kitCopy: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    color: '#134e4a',
    fontSize: 13,
    lineHeight: 1.45,
  },
  kitDeliveryCard: {
    display: 'flex', flexDirection: 'column', gap: 7, padding: 16,
    border: '1px solid #ccfbf1', borderRadius: 12, background: '#f8fffe',
  },
  kitDeliveryTitle: { color: '#134e4a', fontSize: 15 },
  kitDeliveryHint: { color: '#64748b', fontSize: 12.5, lineHeight: 1.45, marginBottom: 4 },
  kitConfirmation: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 14,
    marginBottom: 16,
    borderRadius: 12,
    background: '#f0fdfa',
    border: '1px solid #99f6e4',
    color: '#134e4a',
    fontSize: 13,
    lineHeight: 1.45,
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

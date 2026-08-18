import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

function CustomerJoin({ API_BASE }) {
  const { businessSlug } = useParams()
  const [form, setForm] = useState({
    name: '',
    address: '',
    age: '',
    phone: '',
    email: '',
    birthday: '',
    occupation: '',
    gender: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Wallet data (Google save_url + Apple pass URL) for the two "Add to
  // Wallet" buttons on the success screen - fetched right after signup so
  // customers can add the card in one tap instead of clicking through to
  // the separate /wallet/{id} page first.
  const [walletData, setWalletData] = useState(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [businessInfo,setBusinessInfo]=useState(null)
  const [privacyConsent,setPrivacyConsent]=useState(false)

  useEffect(()=>{
    fetch(`${API_BASE}/api/v1/public/business/${businessSlug}/join-config`)
      .then(r=>r.ok?r.json():null).then(setBusinessInfo).catch(()=>setBusinessInfo(null))
  },[API_BASE,businessSlug])

  useEffect(() => {
    if (!submitted || !customerId) return
    setWalletLoading(true)
    fetch(`${API_BASE}/api/v1/customer/${customerId}/wallet-pass`)
      .then(r => r.json())
      .then(data => {
        setWalletData(data)
        setWalletLoading(false)
      })
      .catch(() => {
        // Apple Wallet link below doesn't depend on this fetch, so it
        // still works even if this call fails - only the Google Wallet
        // button needs the JWT this returns.
        setWalletLoading(false)
      })
  }, [submitted, customerId, API_BASE])

  const appleWalletUrl = `${API_BASE}/api/v1/customer/${customerId}/apple-wallet-pass`
  const [walletChoiceOpen, setWalletChoiceOpen] = useState(false)

  const openGoogleWallet = () => {
    if (walletData?.save_url && walletData.save_url.includes('pay.google.com')) {
      window.location.href = walletData.save_url
    } else if (walletLoading) {
      alert('Your Google Wallet card is still being prepared. Please try again in a moment.')
    } else {
      alert('Google Wallet is not available for this card right now.')
    }
  }

  const openAppleWallet = () => {
    window.location.href = appleWalletUrl
  }

  const addToWallet = () => {
    const ua = navigator.userAgent || ''
    const platform = navigator.platform || ''
    const touchPoints = navigator.maxTouchPoints || 0
    const isAppleMobile = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
    const isAndroid = /Android/i.test(ua)

    if (isAppleMobile) return openAppleWallet()
    if (isAndroid) return openGoogleWallet()
    setWalletChoiceOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!privacyConsent) {
      setError('Please review and accept the Privacy & Membership Consent before continuing.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/join/${businessSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          address: form.address || null,
          age: form.age ? parseInt(form.age, 10) : null,
          phone: form.phone,
          email: form.email || null,
          birthday: form.birthday || null,
          occupation: form.occupation || null,
          gender: form.gender || null,
          privacy_consent: true,
          privacy_consent_version: '2026-08-09-v1',
        })
      })
      const data = await res.json()
      if (res.ok) {
        setCustomerId(data.public_id)
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

          <div style={{
            ...styles.walletPreview,
            background: businessInfo?.primary_color || '#0d9488',
          }}>
            {businessInfo?.logo_url && <img src={businessInfo.logo_url} alt="" style={styles.walletPreviewLogo}/>}
            <div style={styles.walletPreviewMeta}>
              <small>{businessInfo?.category?.label || 'LoyaltyTree'}</small>
              <strong>{businessInfo?.name || 'Your loyalty card'}</strong>
              <span>{businessInfo?.card_name || `${String(businessInfo?.card_type || 'stamp').toUpperCase()} CARD`}</span>
            </div>
            <div style={styles.walletPreviewMember}>Your Wallet 2.0 card is ready</div>
          </div>

          <button type="button" onClick={addToWallet} style={{ ...styles.walletBtn, ...styles.unifiedWalletBtn }}>
            Add to Wallet
          </button>
          {walletChoiceOpen && (
            <div style={styles.walletChooser}>
              <div style={styles.walletChooserTitle}>Choose your wallet</div>
              <button type="button" onClick={openAppleWallet} style={{ ...styles.walletChoiceBtn, ...styles.appleBtn }}>Apple Wallet</button>
              <button type="button" onClick={openGoogleWallet} disabled={walletLoading} style={{ ...styles.walletChoiceBtn, ...styles.googleBtn, ...(walletLoading ? styles.walletChoiceDisabled : {}) }}>
                {walletLoading ? 'Preparing Google Wallet…' : 'Google Wallet'}
              </button>
            </div>
          )}
          <button
            onClick={() => { window.location.href = `${API_BASE}/wallet/${customerId}` }}
            style={{ ...styles.walletBtn, ...styles.secondaryBtn, marginTop: 10 }}
          >
            📱 View My Digital Card
          </button>
          <p style={styles.hint}>
            We&apos;ll automatically open the wallet made for your phone.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{...styles.logoBox,background:businessInfo?.primary_color||styles.logoBox.background}}>
          {businessInfo?.logo_url?<img src={businessInfo.logo_url} alt="" style={styles.businessLogo}/>:<span style={styles.logoIcon}>{businessInfo?.category?.icon||'🌳'}</span>}
        </div>
        <h1 style={styles.title}>{businessInfo?.name?`Join ${businessInfo.name}`:'Join Rewards'}</h1>
        <p style={styles.subtitle}>{businessInfo?.category?.label?`${businessInfo.category.label} · `:''}Add your loyalty card to your phone and use it every visit.</p>

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
            <label style={styles.label}>Address <span style={styles.optional}>(optional)</span></label>
            <input
              placeholder="123 Main St"
              value={form.address}
              onChange={e => setForm({...form, address: e.target.value})}
              style={styles.input}
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Age <span style={styles.optional}>(optional)</span></label>
            <input
              placeholder="25"
              value={form.age}
              onChange={e => setForm({...form, age: e.target.value})}
              style={styles.input}
              type="number"
              min="0"
              max="120"
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Number</label>
            <input
              placeholder="+1 234 567 8900"
              value={form.phone}
              onChange={e => setForm({...form, phone: e.target.value})}
              style={styles.input}
              required
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Birthday <span style={styles.optional}>(optional, MM/DD/YYYY)</span></label>
            <input
              value={form.birthday}
              onChange={e => setForm({...form, birthday: e.target.value})}
              style={styles.input}
              type="date"
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Occupation <span style={styles.optional}>(optional)</span></label>
            <select
              value={form.occupation}
              onChange={e => setForm({...form, occupation: e.target.value})}
              style={styles.input}
            >
              <option value="">Select one</option>
              <option value="working">Working</option>
              <option value="business_owner">Business Owner</option>
              <option value="unemployed">Unemployed</option>
            </select>
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Gender <span style={styles.optional}>(optional)</span></label>
            <select
              value={form.gender}
              onChange={e => setForm({...form, gender: e.target.value})}
              style={styles.input}
            >
              <option value="">Select one</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="rather_not_say">Rather not say</option>
            </select>
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
          <div style={styles.consentBox}>
            <div style={styles.consentTitle}>Privacy & Membership Consent</div>
            <p style={styles.consentText}>
              By joining, you agree that the information you provide may be collected and used by this business and LoyaltyTree to create and manage your digital loyalty membership, provide rewards and membership services, and send relevant membership or promotional updates.
            </p>
            <p style={styles.consentText}>
              Your information will be handled in accordance with applicable privacy requirements. You may request access, correction, or deletion of your personal information, subject to applicable legal and operational requirements.
            </p>
            <label style={styles.consentCheckRow}>
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={e => setPrivacyConsent(e.target.checked)}
                style={styles.consentCheckbox}
              />
              <span>
                I have read and agree to the Privacy & Membership Consent, and I confirm that the information I provided is accurate.
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || !privacyConsent}
            style={{
              ...styles.button,
              ...(loading || !privacyConsent ? styles.buttonDisabled : {}),
            }}
          >
            {loading ? 'Creating...' : 'Get My Loyalty Card'}
          </button>
        </form>

        {error && <div style={styles.error}>{error}</div>}

        <p style={styles.terms}>
          LoyaltyTree helps the business manage your loyalty membership and digital card. Please contact the business if you want to review or update the information connected to your membership.
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
  businessLogo:{width:'100%',height:'100%',objectFit:'cover',borderRadius:'inherit'},
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
  consentBox: {
    padding: '14px 15px',
    border: '1px solid #dbe4ea',
    background: '#f8fafc',
    borderRadius: 12,
    marginTop: 2,
  },
  consentTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: 7,
  },
  consentText: {
    margin: '0 0 8px',
    color: '#64748b',
    fontSize: 12,
    lineHeight: 1.55,
  },
  consentCheckRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 9,
    color: '#334155',
    fontSize: 12,
    lineHeight: 1.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  consentCheckbox: {
    marginTop: 2,
    width: 16,
    height: 16,
    accentColor: '#0d9488',
    flexShrink: 0,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
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
  walletPreview:{position:'relative',overflow:'hidden',borderRadius:18,padding:18,minHeight:150,color:'#fff',textAlign:'left',marginBottom:18,boxShadow:'0 16px 35px rgba(15,23,42,.18)'},
  walletPreviewLogo:{width:44,height:44,borderRadius:12,objectFit:'cover',background:'#fff',marginBottom:18},
  walletPreviewMeta:{display:'flex',flexDirection:'column',gap:3},
  walletPreviewMember:{position:'absolute',right:16,bottom:15,fontSize:11,fontWeight:800,opacity:.8},
  walletBtn: {
    display: 'block',
    boxSizing: 'border-box',
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
    textAlign: 'center',
    textDecoration: 'none',
  },
  unifiedWalletBtn: { background: '#111827' },
  walletChooser: { marginTop:10,padding:12,border:'1.5px solid #e2e8f0',borderRadius:12,background:'#f8fafc' },
  walletChooserTitle: { fontSize:12,fontWeight:800,color:'#64748b',marginBottom:8 },
  walletChoiceBtn: { display:'block',width:'100%',boxSizing:'border-box',border:'none',borderRadius:10,padding:'12px 14px',color:'#fff',fontSize:14,fontWeight:800,cursor:'pointer',marginTop:7 },
  appleBtn: { background:'#000000' },
  googleBtn: { background:'#4285f4' },
  walletChoiceDisabled: { opacity:.55,cursor:'not-allowed' },
  secondaryBtn: {
    background: 'white',
    color: '#0f766e',
    border: '1.5px solid #e2e8f0',
  },
}

export default CustomerJoin

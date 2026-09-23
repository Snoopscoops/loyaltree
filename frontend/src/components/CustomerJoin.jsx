import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

const EMPLOYEE_POSITION_OPTIONS = [
  'Manager', 'Supervisor / Team Lead', 'Admin / Office Staff', 'Cashier',
  'Service Crew', 'Barista / Beverage Staff', 'Kitchen Staff', 'Server / Waitstaff',
  'Sales Staff', 'Receptionist / Front Desk', 'Trainer / Coach', 'Therapist / Wellness Staff',
  'Barber / Stylist', 'Security', 'Maintenance / Utility', 'Driver / Rider', 'Other',
]

const BIRTHDAY_MONTHS = [
  ['1', 'January'], ['2', 'February'], ['3', 'March'], ['4', 'April'],
  ['5', 'May'], ['6', 'June'], ['7', 'July'], ['8', 'August'],
  ['9', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
]

function birthdayDayCount(monthValue) {
  const month = Number(monthValue)
  if (month === 2) return 29
  if ([4, 6, 9, 11].includes(month)) return 30
  return 31
}

function CustomerJoin({ API_BASE }) {
  const { businessSlug } = useParams()
  const [form, setForm] = useState({
    name: '',
    address: '',
    age: '',
    phone: '',
    email: '',
    birthday_month: '',
    birthday_day: '',
    occupation: '',
    gender: '',
    employee_id_number: '',
    employee_position: '',
    employee_start_date: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [welcomeRewardIssued, setWelcomeRewardIssued] = useState(null)
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
  // Legacy Employee Card records remain readable, but new employee programs now use Membership.
  const isEmployeeCard = businessInfo?.card_type === 'employee'
  const isEmployeeMembership = businessInfo?.card_type === 'membership' && businessInfo?.membership_employee_mode === true
  const isEmployeeExperience = isEmployeeCard || isEmployeeMembership

  const rewardSummary = (() => {
    if (!businessInfo) return null
    const rawType = businessInfo.card_type || 'stamp'
    const type = rawType === 'hybrid' ? (businessInfo.hybrid_loyalty_type === 'stamp' ? 'stamp' : 'points') : rawType

    if (type === 'points') {
      const prizes = [...(businessInfo.points_prizes || [])]
        .filter(p => p && p.name && Number(p.points_cost) > 0)
        .sort((a,b) => Number(a.points_cost) - Number(b.points_cost))
      const prize = prizes[0]
      if (!prize) return null
      return {
        title: prize.name,
        requirement: `Collect ${Number(prize.points_cost).toLocaleString()} points to unlock your reward`,
      }
    }

    if (type === 'stamp') {
      const milestones = [...(businessInfo.stamp_rewards || [])]
        .filter(r => r && r.reward_name && Number(r.stamps) > 0)
        .sort((a,b) => Number(a.stamps) - Number(b.stamps))
      const reward = milestones[0]
      const goal = reward ? Number(reward.stamps) : Number(businessInfo.stamp_goal || 0)
      const name = reward?.reward_name || businessInfo.reward_name
      if (!name || !goal) return null
      return { title: name, requirement: `Collect ${goal} stamps to unlock your reward` }
    }

    return null
  })()

  const welcomeRewardPreview = (() => {
    const w = businessInfo?.welcome_reward
    if (!w?.enabled) return null
    const type = w.type || 'redeemable'
    const value = Number(w.value || 0)
    const title = w.name || (type==='points' ? `${value} Welcome Points` : type==='stamps' ? `${value} Welcome Stamps` : 'Welcome Reward')
    const when = w.trigger === 'first_purchase' ? 'Unlocks after your first successful purchase' : 'Added when you join'
    return { title, when, type, value }
  })()

  const earningRule = (() => {
    if (!businessInfo) return null
    const loyaltyType = businessInfo.card_type === 'hybrid' ? (businessInfo.hybrid_loyalty_type === 'stamp' ? 'stamp' : 'points') : businessInfo.card_type
    if (loyaltyType === 'points') {
      const points = Number(businessInfo.points_per_amount || 0)
      const pesos = Number(businessInfo.points_amount_pesos || 0)
      if (points > 0 && pesos > 0) {
        if (points === 1) return `1 point for every ${pesos.toLocaleString()} pesos`
        return `${points.toLocaleString()} points for every ${pesos.toLocaleString()} pesos`
      }
    }
    return null
  })()

  const hybridMembership = (() => {
    if (!businessInfo || businessInfo.card_type !== 'hybrid') return null
    return {
      name: businessInfo.membership_name || 'Membership',
      price: Number(businessInfo.membership_price || 0),
      duration: Number(businessInfo.membership_duration_days || 30),
      enrollment: businessInfo.subscription_enrollment_mode === 'automatic' ? 'automatic' : 'manual',
      benefits: Array.isArray(businessInfo.membership_benefits) && businessInfo.membership_benefits.length
        ? businessInfo.membership_benefits
        : (Array.isArray(businessInfo.membership_services) ? businessInfo.membership_services.map((name,i)=>({id:`legacy-${i}`,name})) : []),
    }
  })()

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
    if (isEmployeeExperience && !form.employee_id_number.trim()) {
      setError('Employee ID number is required.')
      return
    }
    if (isEmployeeMembership && !form.employee_position) {
      setError('Please select a position.')
      return
    }
    if (!form.birthday_month || !form.birthday_day) {
      setError('Birthday month and day are required.')
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
          birthday_month: parseInt(form.birthday_month, 10),
          birthday_day: parseInt(form.birthday_day, 10),
          occupation: isEmployeeExperience ? null : (form.occupation || null),
          gender: isEmployeeExperience ? null : (form.gender || null),
          employee_id_number: isEmployeeExperience ? form.employee_id_number.trim() : null,
          employee_position: isEmployeeExperience ? (form.employee_position || null) : null,
          employee_start_date: isEmployeeExperience ? (form.employee_start_date || null) : null,
          privacy_consent: true,
          privacy_consent_version: '2026-08-09-v1',
        })
      })
      const data = await res.json()
      if (res.ok) {
        setCustomerId(data.public_id)
        setWelcomeRewardIssued(data.welcome_reward || null)
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
    const brandColor = businessInfo?.primary_color || '#0f766e'

    return (
      <div style={styles.page}>
        <div style={styles.successShell}>
          <section style={{...styles.successHero, background:`linear-gradient(145deg, ${brandColor} 0%, #0f172a 100%)`}}>
            <div style={styles.successBadge}>MEMBERSHIP CREATED</div>
            <div style={styles.successIcon}>✓</div>
            <h1 style={styles.successTitle}>You&apos;re all set.</h1>
            <p style={styles.successSubtitle}>
              {isEmployeeMembership
                ? `Your ${businessInfo?.name || 'business'} Employee Membership is ready.`
                : isEmployeeCard
                  ? `Your ${businessInfo?.name || 'business'} Employee Card is ready.`
                  : `Your ${businessInfo?.name || 'loyalty'} card is ready to use.`}
            </p>

            <div style={styles.walletPreview}>
              <div style={styles.walletPreviewTop}>
                {businessInfo?.logo_url
                  ? <img src={businessInfo.logo_url} alt="" style={styles.walletPreviewLogo}/>
                  : <div style={styles.walletPreviewFallback}>{businessInfo?.category?.icon || '🌳'}</div>}
                <div style={styles.walletPreviewMeta}>
                  <small>{businessInfo?.category?.label || 'LOYALTYTREE'}</small>
                  <strong>{businessInfo?.name || 'Your loyalty card'}</strong>
                  <span>{businessInfo?.card_name || (businessInfo?.card_type==='hybrid' ? 'HYBRID CARD' : `${String(businessInfo?.card_type || 'stamp').toUpperCase()} CARD`)}</span>
                </div>
              </div>
              <div style={styles.walletPreviewBottom}>
                <span>{isEmployeeExperience ? 'Employee ID' : 'Member'}</span>
                <strong>{isEmployeeExperience ? form.employee_id_number : form.name}</strong>
              </div>
            </div>
          </section>

          <section style={styles.successContent}>
            {welcomeRewardIssued?.issued && (
              <div style={styles.successReward}>
                <div style={styles.successRewardIcon}>🎁</div>
                <div>
                  <div style={styles.successRewardTitle}>Welcome reward added</div>
                  <div style={styles.successRewardText}>
                    {welcomeRewardIssued.name || 'Welcome Reward'}
                    {welcomeRewardIssued.points_awarded ? ` · +${welcomeRewardIssued.points_awarded} points` : ''}
                    {welcomeRewardIssued.stamps_awarded ? ` · +${welcomeRewardIssued.stamps_awarded} stamp${welcomeRewardIssued.stamps_awarded===1?'':'s'}` : ''}
                  </div>
                </div>
              </div>
            )}

            <div style={styles.successStepLabel}>NEXT STEP</div>
            <h2 style={styles.successContentTitle}>Save your card to your phone</h2>
            <p style={styles.successContentText}>
              One tap adds your LoyaltyTree card to the wallet built into your phone. No separate app needed.
            </p>

            <button type="button" onClick={addToWallet} style={styles.primaryWalletBtn}>
              <span style={{fontSize:20}}>◫</span>
              Add to Wallet
            </button>

            {walletChoiceOpen && (
              <div style={styles.walletChooser}>
                <div style={styles.walletChooserTitle}>Choose your wallet</div>
                <button type="button" onClick={openAppleWallet} style={{...styles.walletChoiceBtn, ...styles.appleBtn}}>
                  Apple Wallet
                </button>
                <button
                  type="button"
                  onClick={openGoogleWallet}
                  disabled={walletLoading}
                  style={{...styles.walletChoiceBtn, ...styles.googleBtn, ...(walletLoading ? styles.walletChoiceDisabled : {})}}
                >
                  {walletLoading ? 'Preparing Google Wallet…' : 'Google Wallet'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => { window.location.href = `${API_BASE}/wallet/${customerId}` }}
              style={styles.secondaryWalletBtn}
            >
              View My Digital Card
            </button>

            <div style={styles.secureNote}>
              <span>✓</span>
              <span>Your card stays on your phone and can be shown on every visit.</span>
            </div>
          </section>
        </div>
      </div>
    )
  }

  const brandColor = businessInfo?.primary_color || '#0f766e'
  const programLabel = businessInfo?.card_type === 'hybrid'
    ? `Membership + ${businessInfo?.hybrid_loyalty_type === 'stamp' ? 'Stamps' : 'Points'}`
    : businessInfo?.card_name || `${String(businessInfo?.card_type || 'loyalty').replace('_',' ')} card`

  return (
    <div style={styles.page}>
      <div style={styles.joinShell}>
        <section style={{...styles.heroPanel, background:`linear-gradient(145deg, ${brandColor} 0%, #0f172a 100%)`}}>
          <div>
            <div style={styles.heroTopline}>
              <div style={styles.heroLogoWrap}>
                {businessInfo?.logo_url
                  ? <img src={businessInfo.logo_url} alt="" style={styles.businessLogo}/>
                  : <span style={styles.logoIcon}>{businessInfo?.category?.icon || '🌳'}</span>}
              </div>
              <div style={styles.heroTag}>POWERED BY LOYALTYTREE</div>
            </div>

            <div style={styles.heroEyebrow}>{programLabel}</div>
            <h1 style={styles.heroTitle}>
              {businessInfo?.name
                ? (isEmployeeExperience ? `${businessInfo.name} Employee Membership` : `Join ${businessInfo.name}`)
                : (isEmployeeExperience ? 'Employee Membership' : 'Join Rewards')}
            </h1>
            <p style={styles.heroSubtitle}>
              {isEmployeeMembership
                ? 'Your employee membership, available directly on your phone.'
                : isEmployeeCard
                  ? 'Your employee card, available directly on your phone.'
                  : 'Join in less than a minute, save your card to Apple Wallet or Google Wallet, and use it every visit.'}
            </p>
          </div>

          <div style={styles.heroHighlights}>
            {welcomeRewardPreview && (
              <div style={styles.heroHighlight}>
                <span style={styles.heroHighlightIcon}>🎁</span>
                <div style={styles.heroHighlightText}>
                  <strong>{welcomeRewardPreview.title}</strong>
                  <span>{welcomeRewardPreview.when}</span>
                </div>
              </div>
            )}
            {rewardSummary && (
              <div style={styles.heroHighlight}>
                <span style={styles.heroHighlightIcon}>✦</span>
                <div style={styles.heroHighlightText}>
                  <strong>{rewardSummary.title}</strong>
                  <span>{rewardSummary.requirement}</span>
                </div>
              </div>
            )}
            {earningRule && (
              <div style={styles.heroHighlight}>
                <span style={styles.heroHighlightIcon}>↗</span>
                <div style={styles.heroHighlightText}>
                  <strong>Earn every visit</strong>
                  <span>{earningRule}</span>
                </div>
              </div>
            )}
            {!welcomeRewardPreview && !rewardSummary && !earningRule && (
              <div style={styles.heroHighlight}>
                <span style={styles.heroHighlightIcon}>◫</span>
                <div style={styles.heroHighlightText}>
                  <strong>No app download</strong>
                  <span>Your membership lives in the wallet already on your phone.</span>
                </div>
              </div>
            )}
          </div>

          {hybridMembership && (
            <div style={styles.membershipStrip}>
              <div style={styles.membershipStripLabel}>{hybridMembership.name}</div>
              <div style={styles.membershipStripValue}>
                {hybridMembership.price > 0
                  ? `₱${hybridMembership.price.toLocaleString()} / ${hybridMembership.duration} days`
                  : `${hybridMembership.duration}-day membership`}
              </div>
              <div style={styles.membershipStripText}>
                {hybridMembership.enrollment === 'automatic'
                  ? 'Membership activates automatically when you join.'
                  : 'Join now. The business activates membership access after approval or payment.'}
              </div>
            </div>
          )}

          <div style={styles.heroFooter}>
            <span>Apple Wallet</span>
            <span style={styles.heroFooterDot}>•</span>
            <span>Google Wallet</span>
            <span style={styles.heroFooterDot}>•</span>
            <span>No app required</span>
          </div>
        </section>

        <section style={styles.formPanel}>
          <div style={styles.formHeader}>
            <div style={styles.stepPill}>1-MINUTE SIGN UP</div>
            <h2 style={styles.formTitle}>{isEmployeeExperience ? 'Enter your employee details' : 'Create your digital loyalty card'}</h2>
            <p style={styles.formSubtitle}>
              Required fields are kept to a minimum. Optional details help the business personalize your rewards.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.fieldGrid}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Full name</label>
                <input
                  placeholder="Your full name"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>{isEmployeeExperience ? 'Mobile number' : 'Phone number'}</label>
                <input
                  placeholder="+63 9XX XXX XXXX"
                  value={form.phone}
                  onChange={e => setForm({...form, phone: e.target.value})}
                  style={styles.input}
                  inputMode="tel"
                  required
                />
              </div>

              {isEmployeeExperience && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Employee ID</label>
                  <input
                    placeholder="e.g. ANG-00124"
                    value={form.employee_id_number}
                    onChange={e => setForm({...form, employee_id_number: e.target.value})}
                    style={styles.input}
                    required
                  />
                </div>
              )}

              <div style={styles.inputGroup}>
                <label style={styles.label}>Email <span style={styles.optional}>optional</span></label>
                <input
                  placeholder="you@email.com"
                  value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  style={styles.input}
                  type="email"
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Birthday</label>
                <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.4fr) minmax(0,1fr)',gap:10}}>
                  <select
                    value={form.birthday_month}
                    onChange={e => {
                      const month = e.target.value
                      const maxDay = birthdayDayCount(month)
                      const currentDay = Number(form.birthday_day || 0)
                      setForm({
                        ...form,
                        birthday_month: month,
                        birthday_day: currentDay > maxDay ? '' : form.birthday_day,
                      })
                    }}
                    style={styles.input}
                    required
                  >
                    <option value="">Month</option>
                    {BIRTHDAY_MONTHS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <select
                    value={form.birthday_day}
                    onChange={e => setForm({...form, birthday_day: e.target.value})}
                    style={styles.input}
                    required
                    disabled={!form.birthday_month}
                  >
                    <option value="">Day</option>
                    {Array.from({length: birthdayDayCount(form.birthday_month)}, (_, i) => i + 1).map(day => (
                      <option key={day} value={String(day)}>{day}</option>
                    ))}
                  </select>
                </div>
                <div style={{fontSize:11,color:'#64748b',marginTop:6}}>
                  Month and day only. Birth year is not collected.
                </div>
              </div>

              {!isEmployeeExperience && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Age <span style={styles.optional}>optional</span></label>
                  <input
                    placeholder="25"
                    value={form.age}
                    onChange={e => setForm({...form, age: e.target.value})}
                    style={styles.input}
                    type="number"
                    min="0"
                    max="120"
                    inputMode="numeric"
                  />
                </div>
              )}

              {!isEmployeeExperience && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Occupation <span style={styles.optional}>optional</span></label>
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
              )}

              {!isEmployeeExperience && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Gender <span style={styles.optional}>optional</span></label>
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
              )}

              {isEmployeeExperience && (
                <>
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>
                      Position {!isEmployeeMembership && <span style={styles.optional}>optional</span>}
                    </label>
                    <select
                      value={form.employee_position}
                      onChange={e => setForm({...form, employee_position: e.target.value})}
                      style={styles.input}
                      required={isEmployeeMembership}
                    >
                      <option value="">Select position</option>
                      {EMPLOYEE_POSITION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>Start date <span style={styles.optional}>optional</span></label>
                    <input
                      value={form.employee_start_date}
                      onChange={e => setForm({...form, employee_start_date: e.target.value})}
                      style={styles.input}
                      type="date"
                    />
                  </div>
                </>
              )}

              {!isEmployeeExperience && (
                <div style={{...styles.inputGroup, ...styles.fullWidth}}>
                  <label style={styles.label}>Address <span style={styles.optional}>optional</span></label>
                  <input
                    placeholder="City / municipality"
                    value={form.address}
                    onChange={e => setForm({...form, address: e.target.value})}
                    style={styles.input}
                  />
                </div>
              )}
            </div>

            <label style={styles.consentCard}>
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={e => setPrivacyConsent(e.target.checked)}
                style={styles.consentCheckbox}
              />
              <span>
                <strong style={styles.consentTitle}>Privacy & membership consent</strong>
                <span style={styles.consentText}>
                  By joining, you agree that the information you provide may be collected and used by this business and LoyaltyTree to create and manage your digital loyalty membership, provide rewards and membership services, and send relevant membership or promotional updates.
                </span>
                <span style={{...styles.consentText, marginTop:5}}>
                  Your information will be handled in accordance with applicable privacy requirements. You may request access, correction, or deletion of your personal information, subject to applicable legal and operational requirements.
                </span>
                <span style={{...styles.consentText, marginTop:5, color:'#334155', fontWeight:700}}>
                  I have read and agree to the Privacy & Membership Consent, and I confirm that the information I provided is accurate.
                </span>
              </span>
            </label>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="submit"
              disabled={loading || !privacyConsent}
              style={{
                ...styles.button,
                background: `linear-gradient(135deg, ${brandColor}, #0f172a)`,
                ...(loading || !privacyConsent ? styles.buttonDisabled : {}),
              }}
            >
              <span>{loading ? 'Creating your card…' : (isEmployeeMembership ? 'Get My Employee Membership' : isEmployeeCard ? 'Get My Employee Card' : 'Create My Loyalty Card')}</span>
              {!loading && <span style={{fontSize:18}}>→</span>}
            </button>
          </form>

          <div style={styles.formFooter}>
            <span style={styles.formFooterShield}>✓</span>
            <span>
              Secure signup · No app download · Add to Wallet after joining<br/>
              LoyaltyTree helps the business manage your loyalty membership and digital card.
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f4f7f8',
    padding: 'clamp(12px, 3vw, 32px)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#0f172a',
    boxSizing: 'border-box',
  },
  joinShell: {
    width: '100%',
    maxWidth: 1080,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    background: '#ffffff',
    border: '1px solid #e6ecef',
    borderRadius: 28,
    overflow: 'hidden',
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.10)',
  },
  heroPanel: {
    color: '#ffffff',
    padding: 'clamp(28px, 5vw, 54px)',
    minHeight: 560,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  heroTopline: {display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:46},
  heroLogoWrap: {
    width:58,height:58,borderRadius:18,display:'flex',alignItems:'center',justifyContent:'center',
    overflow:'hidden',background:'rgba(255,255,255,.14)',border:'1px solid rgba(255,255,255,.18)',
    boxShadow:'0 10px 30px rgba(0,0,0,.16)',
  },
  businessLogo:{width:'100%',height:'100%',objectFit:'cover'},
  logoIcon:{fontSize:30},
  heroTag:{fontSize:10,fontWeight:850,letterSpacing:'1.5px',opacity:.72,textAlign:'right'},
  heroEyebrow:{
    display:'inline-flex',width:'fit-content',padding:'7px 10px',borderRadius:999,
    background:'rgba(255,255,255,.12)',border:'1px solid rgba(255,255,255,.16)',
    fontSize:11,fontWeight:800,letterSpacing:'.5px',textTransform:'uppercase',marginBottom:16,
  },
  heroTitle:{
    fontSize:'clamp(32px, 5vw, 52px)',lineHeight:1.02,letterSpacing:'-2px',
    margin:'0 0 18px',maxWidth:520,
  },
  heroSubtitle:{fontSize:15,lineHeight:1.75,color:'rgba(255,255,255,.78)',maxWidth:500,margin:0},
  heroHighlights:{display:'grid',gap:10,marginTop:36},
  heroHighlight:{
    display:'flex',alignItems:'flex-start',gap:12,padding:'13px 14px',borderRadius:16,
    background:'rgba(255,255,255,.10)',border:'1px solid rgba(255,255,255,.12)',
    backdropFilter:'blur(8px)',
  },
  heroHighlightIcon:{
    width:30,height:30,borderRadius:10,background:'rgba(255,255,255,.14)',
    display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
  },
  heroHighlightText:{display:'flex',flexDirection:'column',gap:3,fontSize:12,lineHeight:1.45,color:'rgba(255,255,255,.74)'},
  membershipStrip:{
    marginTop:14,borderRadius:16,padding:'14px 15px',background:'rgba(255,255,255,.10)',
    border:'1px solid rgba(255,255,255,.12)',
  },
  membershipStripLabel:{fontSize:12,fontWeight:800,opacity:.75,textTransform:'uppercase',letterSpacing:'.5px'},
  membershipStripValue:{fontSize:17,fontWeight:850,marginTop:4},
  membershipStripText:{fontSize:12,lineHeight:1.55,opacity:.74,marginTop:5},
  heroFooter:{
    display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,marginTop:34,
    fontSize:11,fontWeight:750,color:'rgba(255,255,255,.62)',
  },
  heroFooterDot:{opacity:.45},

  formPanel:{padding:'clamp(26px, 5vw, 54px)',background:'#ffffff',alignSelf:'stretch'},
  formHeader:{marginBottom:26},
  stepPill:{color:'#64748b',fontSize:10,fontWeight:850,letterSpacing:'1.35px',marginBottom:11},
  formTitle:{
    margin:'0 0 9px',fontSize:'clamp(24px, 3.2vw, 32px)',lineHeight:1.12,
    letterSpacing:'-.9px',color:'#0f172a',
  },
  formSubtitle:{margin:0,color:'#64748b',fontSize:13,lineHeight:1.65},
  form:{display:'flex',flexDirection:'column',gap:18},
  fieldGrid:{
    display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 190px), 1fr))',gap:14,
  },
  fullWidth:{gridColumn:'1 / -1'},
  inputGroup:{display:'flex',flexDirection:'column',gap:7},
  label:{fontSize:12,fontWeight:750,color:'#334155'},
  optional:{color:'#94a3b8',fontWeight:550,marginLeft:4},
  input:{
    width:'100%',boxSizing:'border-box',padding:'13px 14px',borderRadius:12,
    border:'1px solid #dfe7eb',background:'#fbfcfd',fontSize:14,color:'#0f172a',
    outline:'none',fontFamily:'inherit',minHeight:47,
  },
  consentCard:{
    display:'flex',alignItems:'flex-start',gap:11,padding:'14px 15px',
    border:'1px solid #e2e8f0',background:'#f8fafc',borderRadius:14,cursor:'pointer',
  },
  consentCheckbox:{marginTop:2,width:17,height:17,accentColor:'#0f766e',flexShrink:0},
  consentTitle:{display:'block',fontSize:12,color:'#0f172a',marginBottom:4},
  consentText:{display:'block',color:'#64748b',fontSize:11,lineHeight:1.55,fontWeight:500},
  button:{
    width:'100%',minHeight:52,border:'none',borderRadius:14,color:'#fff',
    fontSize:14,fontWeight:850,cursor:'pointer',display:'flex',alignItems:'center',
    justifyContent:'space-between',gap:12,padding:'0 18px',
    boxShadow:'0 12px 24px rgba(15,23,42,.14)',
  },
  buttonDisabled:{opacity:.48,cursor:'not-allowed',boxShadow:'none'},
  error:{
    padding:'12px 14px',background:'#fff1f2',border:'1px solid #fecdd3',
    color:'#be123c',borderRadius:12,fontSize:12,lineHeight:1.5,
  },
  formFooter:{
    marginTop:18,display:'flex',alignItems:'center',justifyContent:'center',gap:7,
    color:'#94a3b8',fontSize:10,textAlign:'center',lineHeight:1.45,
  },
  formFooterShield:{color:'#0f766e',fontWeight:900},

  successShell:{
    width:'100%',maxWidth:900,margin:'0 auto',display:'grid',
    gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 330px), 1fr))',
    background:'#fff',borderRadius:28,overflow:'hidden',border:'1px solid #e6ecef',
    boxShadow:'0 24px 70px rgba(15, 23, 42, 0.10)',
  },
  successHero:{padding:'clamp(28px, 5vw, 50px)',color:'#fff',display:'flex',flexDirection:'column',justifyContent:'center'},
  successBadge:{fontSize:10,fontWeight:850,letterSpacing:'1.4px',opacity:.7,marginBottom:22},
  successIcon:{
    width:52,height:52,borderRadius:17,display:'flex',alignItems:'center',justifyContent:'center',
    background:'rgba(255,255,255,.15)',border:'1px solid rgba(255,255,255,.18)',
    fontSize:25,fontWeight:900,marginBottom:20,
  },
  successTitle:{margin:'0 0 8px',fontSize:'clamp(31px, 5vw, 46px)',lineHeight:1,letterSpacing:'-1.5px'},
  successSubtitle:{margin:'0 0 28px',color:'rgba(255,255,255,.74)',fontSize:14,lineHeight:1.65},
  walletPreview:{
    borderRadius:19,padding:18,minHeight:165,background:'rgba(255,255,255,.12)',
    border:'1px solid rgba(255,255,255,.16)',display:'flex',flexDirection:'column',
    justifyContent:'space-between',boxShadow:'0 18px 40px rgba(0,0,0,.16)',
  },
  walletPreviewTop:{display:'flex',alignItems:'flex-start',gap:12},
  walletPreviewLogo:{width:44,height:44,borderRadius:13,objectFit:'cover',background:'#fff'},
  walletPreviewFallback:{
    width:44,height:44,borderRadius:13,background:'rgba(255,255,255,.15)',
    display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,
  },
  walletPreviewMeta:{display:'flex',flexDirection:'column',gap:2},
  walletPreviewBottom:{display:'flex',flexDirection:'column',gap:2,marginTop:28},
  successContent:{padding:'clamp(28px, 5vw, 50px)',display:'flex',flexDirection:'column',justifyContent:'center'},
  successReward:{
    display:'flex',gap:11,alignItems:'center',padding:'12px 13px',borderRadius:14,
    border:'1px solid #bbf7d0',background:'#f0fdf4',marginBottom:22,
  },
  successRewardIcon:{fontSize:22},
  successRewardTitle:{fontSize:12,fontWeight:850,color:'#166534'},
  successRewardText:{fontSize:11,color:'#15803d',marginTop:2},
  successStepLabel:{fontSize:10,fontWeight:850,letterSpacing:'1.4px',color:'#94a3b8',marginBottom:9},
  successContentTitle:{margin:'0 0 9px',fontSize:27,letterSpacing:'-.7px',color:'#0f172a'},
  successContentText:{margin:'0 0 24px',color:'#64748b',fontSize:13,lineHeight:1.65},
  primaryWalletBtn:{
    width:'100%',minHeight:52,border:'none',borderRadius:14,background:'#111827',
    color:'#fff',fontSize:14,fontWeight:850,cursor:'pointer',display:'flex',
    alignItems:'center',justifyContent:'center',gap:9,
  },
  secondaryWalletBtn:{
    width:'100%',minHeight:48,border:'1px solid #dfe7eb',borderRadius:13,
    background:'#fff',color:'#334155',fontSize:13,fontWeight:800,cursor:'pointer',marginTop:10,
  },
  walletChooser:{marginTop:10,padding:12,border:'1px solid #e2e8f0',borderRadius:13,background:'#f8fafc'},
  walletChooserTitle:{fontSize:11,fontWeight:800,color:'#64748b',marginBottom:8},
  walletChoiceBtn:{
    display:'block',width:'100%',border:'none',borderRadius:10,padding:'12px 14px',
    color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',marginTop:7,
  },
  appleBtn:{background:'#000000'},
  googleBtn:{background:'#4285f4'},
  walletChoiceDisabled:{opacity:.55,cursor:'not-allowed'},
  secureNote:{display:'flex',alignItems:'flex-start',gap:7,marginTop:18,color:'#94a3b8',fontSize:10,lineHeight:1.5},
}

export default CustomerJoin

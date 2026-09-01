import React, { useState, useEffect } from 'react'

const DESCRIPTION_LIMIT = 140

// Drop this into OwnerDashboard, e.g.:
//   import LoyaltyCardCustomizer from './LoyaltyCardCustomizer'
//   <LoyaltyCardCustomizer API_BASE={API_BASE} user={user} onSaved={loadData} />
// It reads/writes the same /loyalty-config endpoint main.py already exposes,
// and the "publish" button also hits /wallet-class, same as before.
// onSaved is optional - call it (e.g. your existing loadData) to refresh any
// parent state that depends on the program, such as OwnerDashboard's
// `program` used for the customer card preview modal.
function LoyaltyCardCustomizer({ API_BASE, user, onSaved, guided = false }) {
  const [form, setForm] = useState({
    card_type: 'stamp', // includes 'hybrid' = Membership + Points/Stamp on one card
    hybrid_loyalty_type: 'points',
    subscription_enrollment_mode: 'manual',
    card_name: '',
    primary_color: '#0d9488',
    reward_name: '',
    stamp_goal: 8,
    stamp_rewards: [{ id: 'legacy-final', stamps: 8, reward_name: 'Free Service' }],
    stamp_once_per_day: false,
    stamp_reset_after_final: true,
    reward_expiry_days: 30,
    card_expiration_enabled: false,
    card_validity_days: 365,
    program_logo_url: '',
    hero_image_url: '',
    wallet_style: 'gradient',
    wallet_secondary_color: '#14b8a6',
    wallet_show_background: true,
    description: '',
    google_review_url: '',
    // Points card only
    points_per_amount: 10,
    points_amount_pesos: 100,
    points_cap_limit: '',
    points_prizes: [],
    // Membership / Hybrid subscription
    membership_name: '',
    membership_duration_days: 30,
    membership_price: 0,
    membership_services: [], // legacy display compatibility
    membership_benefits: [],
    membership_terms: '',
    // VIP card only
    vip_points_per_amount: 10,
    vip_amount_pesos: 100,
    vip_tiers: [
      { id: 'bronze', name: 'Bronze', threshold: 0, color: '#92400e', discount_percent: 0, benefits: ['Member-only offers'], active: true },
      { id: 'silver', name: 'Silver', threshold: 1000, color: '#64748b', discount_percent: 5, benefits: ['5% discount'], active: true },
      { id: 'gold', name: 'Gold', threshold: 3000, color: '#ca8a04', discount_percent: 10, benefits: ['10% discount', 'Priority service'], active: true },
    ],
    // Multipass card only
    multipass_session_count: 12,
    multipass_validity_days: 90,
  })
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [walletClassId, setWalletClassId] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // Photo upload state, keyed by form field ('program_logo_url' /
  // 'hero_image_url'). Same signed-Cloudinary-upload flow the vehicle
  // photo uploader (AddVehicleModal) uses - see uploadImage() below.
  const [imageUpload, setImageUpload] = useState({
    program_logo_url: { uploading: false, error: '' },
    hero_image_url: { uploading: false, error: '' },
  })
  // 'picker' shows the Stamp vs Points choice first; 'form' shows the
  // full editor for whichever type is selected. Starts on 'form' once
  // fetchConfig confirms a card type was already saved (is_configured) -
  // re-showing the picker every time would be redundant for a business
  // that already chose at onboarding. Only a genuinely new business (no
  // saved program yet) lands on 'picker'. Owners can still get back to
  // the picker any time via the "Change card type" button in the form.
  const [step, setStep] = useState('picker')
  const [guidedStep, setGuidedStep] = useState(0)
  const [guidedError, setGuidedError] = useState('')
  const [guidedMobile, setGuidedMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 640)

  useEffect(() => {
    const onResize = () => setGuidedMobile(window.innerWidth <= 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // New-prize draft form (points card)
  const [prizeDraft, setPrizeDraft] = useState({ name: '', points_cost: '', description: '' })
  const [prizeError, setPrizeError] = useState('')
  const [stampRewardDraft, setStampRewardDraft] = useState({ stamps: '', reward_name: '' })
  const [stampRewardError, setStampRewardError] = useState('')
  const [benefitDraft, setBenefitDraft] = useState({
    name: '', benefit_type: 'free_item', value: '', description: '',
    usage_limit: '1', reset_period: 'daily', unlimited: false,
  })
  const [benefitError, setBenefitError] = useState('')

  useEffect(() => {
    fetchConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchConfig = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config?_=${Date.now()}`,
        { cache: 'no-store' }
      )
      const data = await res.json()
      if (res.ok) {
        setForm(f => ({
          ...f,
          card_type: ['stamp', 'points', 'membership', 'multipass', 'vip', 'hybrid'].includes(data.card_type) ? data.card_type : 'stamp',
          hybrid_loyalty_type: ['points','stamp'].includes(data.hybrid_loyalty_type) ? data.hybrid_loyalty_type : 'points',
          subscription_enrollment_mode: data.subscription_enrollment_mode === 'automatic' ? 'automatic' : 'manual',
          card_name: data.card_name || '',
          primary_color: data.primary_color || '#0d9488',
          reward_name: data.reward_name || '',
          stamp_goal: data.stamp_goal || 8,
          stamp_rewards: Array.isArray(data.stamp_rewards) && data.stamp_rewards.length
            ? data.stamp_rewards
            : [{ id: 'legacy-final', stamps: data.stamp_goal || 8, reward_name: data.reward_name || 'Free Service' }],
          stamp_once_per_day: data.stamp_once_per_day === true,
          stamp_reset_after_final: data.stamp_reset_after_final !== false,
          reward_expiry_days: data.reward_expiry_days || 30,
          card_expiration_enabled: data.card_expiration_enabled === true,
          card_validity_days: data.card_validity_days ?? 365,
          program_logo_url: data.program_logo_url || '',
          hero_image_url: data.hero_image_url || '',
          wallet_style: data.wallet_style || 'gradient',
          wallet_secondary_color: data.wallet_secondary_color || '#14b8a6',
          wallet_show_background: data.wallet_show_background !== false,
          description: data.description || '',
          google_review_url: data.google_review_url || '',
          points_per_amount: data.points_per_amount ?? 10,
          points_amount_pesos: data.points_amount_pesos ?? 100,
          points_cap_limit: data.points_cap_limit ?? '',
          points_prizes: Array.isArray(data.points_prizes) ? data.points_prizes : [],
          membership_name: data.membership_name || '',
          membership_duration_days: data.membership_duration_days ?? 30,
          membership_price: data.membership_price ?? 0,
          membership_services: Array.isArray(data.membership_services) ? data.membership_services : [],
          membership_benefits: Array.isArray(data.membership_benefits) && data.membership_benefits.length
            ? data.membership_benefits
            : (Array.isArray(data.membership_services) ? data.membership_services : []).map((name, i) => ({
                id: `legacy-${i+1}`, name, benefit_type: 'custom', value: null, description: null,
                usage_limit: null, reset_period: 'never', active: true,
              })),
          membership_terms: data.membership_terms || '',
          vip_points_per_amount: data.vip_points_per_amount ?? 10,
          vip_amount_pesos: data.vip_amount_pesos ?? 100,
          vip_tiers: Array.isArray(data.vip_tiers) && data.vip_tiers.length ? data.vip_tiers : f.vip_tiers,
          multipass_session_count: data.multipass_session_count ?? 12,
          multipass_validity_days: data.multipass_validity_days ?? 90,
        }))
        setWalletClassId(data.google_wallet_class_id || null)
        // Already chose a card type (at onboarding or a previous edit) -
        // skip straight to the editor instead of making them re-pick.
        if (data.is_configured && !guided) setStep('form')
      } else {
        setError(data.detail || 'Failed to load your card settings')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  const update = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
    setSaved(false)
  }

  const IMAGE_UPLOAD_MAX_MB = 8

  // Uploads a photo picked from the device to Cloudinary and stores the
  // resulting URL in the given form field. Same two-step flow as
  // AddVehicleModal's vehicle photo uploader: (1) ask our server for a
  // short-lived signature scoped to this business, (2) upload the file
  // straight to Cloudinary using that signature - the file itself never
  // passes through our server.
  const uploadImage = async (field, file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setImageUpload(u => ({ ...u, [field]: { uploading: false, error: 'Please choose an image file' } }))
      return
    }
    if (file.size > IMAGE_UPLOAD_MAX_MB * 1024 * 1024) {
      setImageUpload(u => ({ ...u, [field]: { uploading: false, error: `Image must be under ${IMAGE_UPLOAD_MAX_MB}MB` } }))
      return
    }
    setImageUpload(u => ({ ...u, [field]: { uploading: true, error: '' } }))
    try {
      const sigRes = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/cloudinary-signature?purpose=branding`, {
        method: 'POST',
      })
      const sig = await sigRes.json()
      if (!sigRes.ok) throw new Error(sig.detail || 'Could not start upload')

      const body = new FormData()
      body.append('file', file)
      body.append('api_key', sig.api_key)
      body.append('timestamp', sig.timestamp)
      body.append('signature', sig.signature)
      body.append('upload_preset', sig.upload_preset)
      body.append('folder', sig.folder)

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
        method: 'POST',
        body,
      })
      const uploaded = await uploadRes.json()
      if (!uploadRes.ok || !uploaded.secure_url) throw new Error((uploaded.error && uploaded.error.message) || 'Upload failed')

      update(field, uploaded.secure_url)
      setImageUpload(u => ({ ...u, [field]: { uploading: false, error: '' } }))
    } catch (err) {
      setImageUpload(u => ({ ...u, [field]: { uploading: false, error: err.message || 'Upload failed, try again' } }))
    }
  }

  const buildPayload = () => ({
    card_type: form.card_type,
    hybrid_loyalty_type: form.hybrid_loyalty_type || 'points',
    subscription_enrollment_mode: form.subscription_enrollment_mode === 'automatic' ? 'automatic' : 'manual',
    card_name: form.card_name || null,
    primary_color: form.primary_color,
    reward_name: form.reward_name || 'Free Service',
    stamp_goal: Number(form.stamp_goal) || 8,
    stamp_rewards: (form.stamp_rewards || []).map(r => ({
      id: r.id || Math.random().toString(16).slice(2, 14),
      stamps: Number(r.stamps) || 1,
      reward_name: (r.reward_name || 'Reward').trim(),
    })).sort((a,b) => a.stamps - b.stamps),
    stamp_once_per_day: form.stamp_once_per_day === true,
    stamp_reset_after_final: form.stamp_reset_after_final !== false,
    reward_expiry_days: Number(form.reward_expiry_days) || 30,
    card_expiration_enabled: form.card_expiration_enabled === true,
    card_validity_days: Math.max(1, Math.min(3650, Number(form.card_validity_days) || 365)),
    program_logo_url: form.program_logo_url || null,
    hero_image_url: form.hero_image_url || null,
    wallet_style: form.wallet_style || 'gradient',
    wallet_secondary_color: form.wallet_secondary_color || null,
    wallet_show_background: form.wallet_show_background !== false,
    description: form.description || '',
    google_review_url: form.google_review_url || null,
    points_per_amount: Number(form.points_per_amount) || 0,
    points_amount_pesos: Number(form.points_amount_pesos) || 1,
    points_cap_limit: form.points_cap_limit === '' || form.points_cap_limit == null
      ? null
      : Math.max(1, Math.floor(Number(form.points_cap_limit) || 1)),
    points_prizes: form.points_prizes,
    membership_name: form.membership_name || null,
    membership_duration_days: Number(form.membership_duration_days) || 30,
    membership_price: Number(form.membership_price) || 0,
    membership_benefits: (form.membership_benefits || []).map(b => ({
      id: b.id || Math.random().toString(16).slice(2, 14),
      name: (b.name || 'Benefit').trim(),
      benefit_type: b.benefit_type || 'custom',
      value: b.value === '' || b.value == null ? null : Number(b.value),
      description: b.description || null,
      usage_limit: b.usage_limit == null ? null : Math.max(1, Number(b.usage_limit) || 1),
      reset_period: b.reset_period || 'daily',
      active: b.active !== false,
    })),
    membership_services: (form.membership_benefits || []).map(b => (b.name || '').trim()).filter(Boolean),
    membership_terms: form.membership_terms || null,
    vip_points_per_amount: Number(form.vip_points_per_amount) || 0,
    vip_amount_pesos: Number(form.vip_amount_pesos) || 100,
    vip_tiers: form.vip_tiers,
    multipass_session_count: Number(form.multipass_session_count) || 12,
    multipass_validity_days: Number(form.multipass_validity_days) || 90,
  })

  const addPrize = () => {
    setPrizeError('')
    const cost = parseInt(prizeDraft.points_cost, 10)
    if (!prizeDraft.name.trim()) {
      setPrizeError('Enter a prize name')
      return
    }
    if (!cost || cost < 1) {
      setPrizeError('Enter a points cost of at least 1')
      return
    }
    update('points_prizes', [
      ...form.points_prizes,
      {
        id: Math.random().toString(16).slice(2, 14),
        name: prizeDraft.name.trim(),
        points_cost: cost,
        description: prizeDraft.description.trim() || null,
      },
    ])
    setPrizeDraft({ name: '', points_cost: '', description: '' })
  }

  const removePrize = (id) => {
    update('points_prizes', form.points_prizes.filter(p => p.id !== id))
  }

  const benefitRuleLabel = (benefit) => {
    if (benefit.usage_limit == null) return 'Unlimited while membership is active'
    const unit = benefit.reset_period === 'daily' ? 'day'
      : benefit.reset_period === 'weekly' ? 'week'
      : benefit.reset_period === 'monthly' ? 'month'
      : benefit.reset_period === 'membership_cycle' ? 'membership cycle'
      : 'membership'
    return `${benefit.usage_limit} use${Number(benefit.usage_limit) === 1 ? '' : 's'} per ${unit}`
  }

  const addMembershipBenefit = () => {
    setBenefitError('')
    const name = benefitDraft.name.trim()
    if (!name) { setBenefitError('Enter a benefit name'); return }
    const needsValue = ['percentage_discount','fixed_discount'].includes(benefitDraft.benefit_type)
    const value = benefitDraft.value === '' ? null : Number(benefitDraft.value)
    if (needsValue && (!(value >= 0) || (benefitDraft.benefit_type === 'percentage_discount' && value > 100))) {
      setBenefitError(benefitDraft.benefit_type === 'percentage_discount' ? 'Enter a percentage from 0 to 100' : 'Enter a valid discount amount')
      return
    }
    const benefit = {
      id: Math.random().toString(16).slice(2, 14),
      name, benefit_type: benefitDraft.benefit_type, value,
      description: benefitDraft.description.trim() || null,
      usage_limit: benefitDraft.unlimited ? null : Math.max(1, Number(benefitDraft.usage_limit) || 1),
      reset_period: benefitDraft.unlimited ? 'never' : benefitDraft.reset_period,
      active: true,
    }
    update('membership_benefits', [...(form.membership_benefits || []), benefit])
    setBenefitDraft({ name:'', benefit_type:'free_item', value:'', description:'', usage_limit:'1', reset_period:'daily', unlimited:false })
  }

  const removeMembershipBenefit = (id) => update('membership_benefits', (form.membership_benefits || []).filter(b => b.id !== id))

  const postConfig = async () => {
    const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(user?.token ? { 'Authorization': `Bearer ${user.token}` } : {}),
      },
      body: JSON.stringify(buildPayload())
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || 'Failed to save changes')

    if (data.card_type !== form.card_type) {
      throw new Error(
        `The server did not save the selected card type. Selected: ${form.card_type}; saved: ${data.card_type || 'none'}.`
      )
    }

    return data
  }

  const handlePublish = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (publishing) return

    setPublishing(true)
    setError('')
    setSaved(false)

    try {
      // One tap does both jobs: persist the latest editor settings first,
      // then publish/update the Google Wallet class.
      const savedData = await postConfig()
      setForm(current => ({ ...current, card_type: savedData.card_type }))

      // The Google Wallet class endpoint can occasionally fail on the first
      // create/update request while the just-saved config/class state settles.
      // Retry transient server/rate-limit errors automatically so the owner
      // still only taps Publish once.
      let published = null
      let lastError = null

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 650 * attempt))
        }

        try {
          const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/wallet-class`, {
            method: 'POST',
            headers: (user?.token ? { 'Authorization': `Bearer ${user.token}` } : {}),
          })
          const data = await res.json().catch(() => ({}))

          if (res.ok && data.success) {
            published = data
            break
          }

          const detail = data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : `HTTP ${res.status}`
          lastError = new Error(`Publish failed: ${detail}`)

          // Validation/configuration failures will not improve by retrying.
          if (![409, 429, 500, 502, 503, 504].includes(res.status)) break
        } catch (err) {
          lastError = err
        }
      }

      if (!published) throw lastError || new Error('Publish failed')

      setWalletClassId(published.class_id)
      setSaved(true)
      if (onSaved) await onSaved()
      setTimeout(() => setSaved(false), 3500)
    } catch (err) {
      setError(err.message || 'Network error publishing card design')
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return <div style={styles.loading}>Loading your card settings...</div>
  }

  const stampGoal = Math.min(20, Math.max(3, Number(form.stamp_goal) || 8))
  const previewFilled = Math.ceil(stampGoal / 2)
  const multipassSessionCount = Math.min(200, Math.max(2, Number(form.multipass_session_count) || 12))
  const multipassPreviewUsed = Math.ceil(multipassSessionCount / 3)
  const displayName = form.card_name || `${user?.business_name || 'Your Business'} Rewards`
  const isHybrid = form.card_type === 'hybrid'
  const effectiveLoyaltyType = isHybrid ? (form.hybrid_loyalty_type || 'points') : form.card_type
  const hasMembership = form.card_type === 'membership' || isHybrid

  const walletPreset = form.wallet_style === 'minimal' ? 'classic' : (form.wallet_style || 'gradient')
  const previewVipTier = (form.vip_tiers || []).find(t => String(t.name || '').toLowerCase() === 'gold') || (form.vip_tiers || [])[0] || {}
  const previewPrimary = form.card_type === 'vip' ? (previewVipTier.color || '#111827') : (form.primary_color || '#0d9488')
  const previewSecondary = form.card_type === 'vip'
    ? (previewVipTier.secondary_color || form.wallet_secondary_color || '#111827')
    : (form.wallet_secondary_color || '#14b8a6')
  const walletPreviewBackground = walletPreset === 'classic'
    ? previewPrimary
    : walletPreset === 'premium'
    ? `linear-gradient(135deg,#050505 0%,${previewPrimary} 135%)`
    : `linear-gradient(135deg,${previewPrimary} 0%,${previewSecondary} 100%)`
  const previewResetDate = (() => {
    if (!form.card_expiration_enabled || !['stamp','points','vip'].includes(effectiveLoyaltyType)) return ''
    const d = new Date()
    d.setDate(d.getDate() + Math.max(1, Number(form.card_validity_days) || 365) + 1)
    return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
  })()

  const guidedCardLabel = form.card_type === 'hybrid'
    ? `Hybrid Card · ${effectiveLoyaltyType === 'points' ? 'Membership + Points' : 'Membership + Stamps'}`
    : form.card_type === 'points'
    ? 'Points Card'
    : form.card_type === 'membership'
    ? 'Membership Card'
    : form.card_type === 'vip'
    ? 'VIP Card'
    : form.card_type === 'multipass'
    ? 'Multi-Pass'
    : 'Stamp Card'

  const guidedNext = () => {
    setGuidedError('')
    if (guidedStep === 1 && !String(form.card_name || '').trim()) {
      setGuidedError('Give your card a name before continuing.')
      return
    }
    if (guidedStep === 2 && !String(form.description || '').trim()) {
      setGuidedError('Add a short card description before continuing.')
      return
    }
    setGuidedStep(s => Math.min(6, s + 1))
  }

  const guidedBack = () => {
    setGuidedError('')
    setGuidedStep(s => Math.max(0, s - 1))
  }

  const guidedPublish = async () => {
    setGuidedError('')
    try {
      await handlePublish({ preventDefault: () => {} })
    } catch (err) {
      setGuidedError(err?.message || 'Could not publish your card.')
    }
  }

  if (guided) {
    const businessName = user?.business_name || 'your business'
    const guidedTitles = [
      'Choose your card type',
      'What’s your card name?',
      'What should customers know about it?',
      `Set up your ${guidedCardLabel}`,
      'Choose your card colors',
      'Add your branding',
      'Review and publish',
    ]

    return (
      <div style={{...styles.page, maxWidth:920, margin:'0 auto', padding: guidedMobile ? '4px 0 10px' : styles.page.padding}}>
        <div style={{marginBottom:18}}>
          <div style={{fontSize:12,fontWeight:850,color:'#0d9488',textTransform:'uppercase',letterSpacing:.7}}>
            Card setup · {guidedStep + 1} of 7
          </div>
          <h2 style={{...styles.title,margin:'5px 0 5px'}}>{guidedTitles[guidedStep]}</h2>
          <div style={{display:'flex',gap:5,marginTop:10}}>
            {Array.from({length:7}).map((_,i)=><span key={i} style={{
              height:7,flex:1,borderRadius:99,background:i<=guidedStep?'#0d9488':'#e2e8f0'
            }}/>)}
          </div>
        </div>

        {guidedError && <div style={{...styles.error,marginBottom:14}}>{guidedError}</div>}
        {error && <div style={{...styles.error,marginBottom:14}}>{error}</div>}

        <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:guidedMobile?14:18,padding:guidedMobile?14:22,minWidth:0,overflow:'hidden'}}>
          {guidedStep === 0 && (
            <>
              <p style={{margin:'0 0 18px',color:'#64748b',lineHeight:1.6}}>
                Welcome <b>{businessName}</b> to LoyaltyTree! First, choose how you want customers to earn or use benefits.
              </p>
              <div style={{...styles.pickerGrid,gridTemplateColumns:guidedMobile?'1fr':'repeat(auto-fit, minmax(260px, 1fr))',gap:guidedMobile?10:20,marginBottom:0}}>
                {[
                  ['stamp','🎟️','Stamp Card','Customers collect stamps and unlock rewards at milestones.'],
                  ['points','💎','Points Card','Customers earn points from spending and redeem them for prizes.'],
                  ['membership','🏋️','Membership Card','For active memberships, subscriptions, access and benefits.'],
                  ['hybrid','✨','Hybrid Card','Combine a membership/subscription with either Points or Stamps on one Wallet card.'],
                  ['vip','👑','VIP Card','Customers build VIP status and automatically move through tiers.'],
                  ['multipass','🎫','Multi-Pass','Customers receive a fixed number of sessions or visits that count down.'],
                ].map(([type,icon,label,desc])=>(
                  <button key={type} type="button" onClick={()=>update('card_type',type)}
                    style={{...styles.pickerCard,padding:guidedMobile?'16px 15px':'28px 24px',...(form.card_type===type?{borderColor:'#0d9488',background:'#f0fdfa',boxShadow:'0 0 0 2px rgba(13,148,136,.08)'}:{})}}>
                    <span style={styles.pickerCardIcon}>{icon}</span>
                    <span style={styles.pickerCardLabel}>{label}</span>
                    <span style={styles.pickerCardDesc}>{desc}</span>
                    {form.card_type===type && <span style={styles.pickerCardBadge}>Selected</span>}
                  </button>
                ))}
              </div>
            </>
          )}

          {guidedStep === 1 && (
            <>
              <p style={{margin:'0 0 16px',color:'#64748b',lineHeight:1.6}}>
                Your business name is <b>{businessName}</b>, but your loyalty card can have its own name.
                For example, a business called “JUS Beverage Manufacturing” could call its card “JUS Rewards”.
              </p>
              <label style={styles.label}>Card name</label>
              <input autoFocus style={{...styles.input,fontSize:17,padding:'14px 15px'}}
                value={form.card_name} onChange={e=>update('card_name',e.target.value)}
                placeholder={`${businessName} Rewards`} maxLength={80}/>
              <p style={styles.hint}>This will be the main title customers see on their digital card.</p>
            </>
          )}

          {guidedStep === 2 && (
            <>
              <p style={{margin:'0 0 16px',color:'#64748b',lineHeight:1.6}}>
                Now add a short description. Tell customers what this card is for or what they can look forward to.
              </p>
              <label style={styles.label}>Card description</label>
              <textarea autoFocus style={{...styles.textarea,fontSize:15}} rows={4}
                value={form.description} maxLength={DESCRIPTION_LIMIT}
                onChange={e=>update('description',e.target.value)}
                placeholder={hasMembership
                  ? 'Membership benefits plus rewards every time customers visit.'
                  : form.card_type==='multipass'
                  ? 'Use your sessions whenever you visit.'
                  : 'Earn rewards every time you visit.'}/>
              <p style={styles.hint}>{form.description.length}/{DESCRIPTION_LIMIT} characters</p>
            </>
          )}

          {guidedStep === 3 && (
            <>
              <p style={{margin:'0 0 18px',color:'#64748b',lineHeight:1.6}}>
                Great. Now let’s set the basic rules for your <b>{guidedCardLabel}</b>.
              </p>

              {isHybrid && (
                <div style={{...styles.fieldGroup,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:12,padding:14,marginBottom:18}}>
                  <label style={styles.label}>Loyalty side of this Hybrid Card</label>
                  <div style={{display:'grid',gridTemplateColumns:guidedMobile?'1fr':'1fr 1fr',gap:10}}>
                    <button type="button" onClick={()=>update('hybrid_loyalty_type','points')} style={{...styles.pickerCard,padding:14,...(effectiveLoyaltyType==='points'?{borderColor:'#0d9488',background:'#f0fdfa'}:{})}}>
                      <span style={styles.pickerCardIcon}>💎</span><span style={styles.pickerCardLabel}>Membership + Points</span>
                    </button>
                    <button type="button" onClick={()=>update('hybrid_loyalty_type','stamp')} style={{...styles.pickerCard,padding:14,...(effectiveLoyaltyType==='stamp'?{borderColor:'#0d9488',background:'#f0fdfa'}:{})}}>
                      <span style={styles.pickerCardIcon}>🎟️</span><span style={styles.pickerCardLabel}>Membership + Stamps</span>
                    </button>
                  </div>
                  <p style={{...styles.hint,margin:'8px 0 0'}}>Customers keep one card. Membership status and the selected loyalty balance appear together.</p>
                </div>
              )}

              {effectiveLoyaltyType==='stamp' && <>
                <p style={{...styles.hint,margin:'0 0 14px'}}>Set one or more reward milestones. Customers keep progressing after an intermediate reward until they reach the highest milestone.</p>
                {(form.stamp_rewards || []).map((r,i) => (
                  <div key={r.id || i} style={{display:'flex',flexDirection:guidedMobile?'column':'row',gap:8,alignItems:guidedMobile?'stretch':'center',padding:'10px 0',borderBottom:'1px solid #eef2f7'}}>
                    <div style={{display:'grid',gridTemplateColumns:guidedMobile?'1fr':'120px minmax(180px,1fr)',gap:8,flex:1,minWidth:0}}>
                      <input style={{...styles.input,width:'100%',boxSizing:'border-box'}} type="number" min="1" max="500" value={r.stamps}
                        onChange={e=>{
                          const next=(form.stamp_rewards||[]).map((x,j)=>j===i?{...x,stamps:e.target.value}:x)
                          update('stamp_rewards',next)
                          const sorted=[...next].sort((a,b)=>Number(a.stamps)-Number(b.stamps)); const final=sorted[sorted.length-1]
                          if(final){ update('stamp_goal',Number(final.stamps)||8); update('reward_name',final.reward_name||'Reward') }
                        }}/>
                      <input style={{...styles.input,width:'100%',boxSizing:'border-box'}} value={r.reward_name}
                        onChange={e=>{
                          const next=(form.stamp_rewards||[]).map((x,j)=>j===i?{...x,reward_name:e.target.value}:x)
                          update('stamp_rewards',next)
                          const sorted=[...next].sort((a,b)=>Number(a.stamps)-Number(b.stamps)); const final=sorted[sorted.length-1]
                          if(final){ update('reward_name',final.reward_name||'Reward') }
                        }} placeholder="Reward, e.g. Free Drink"/>
                    </div>
                    <button type="button" onClick={()=>{
                      const next=(form.stamp_rewards||[]).filter((_,j)=>j!==i)
                      if(!next.length) return setGuidedError('Keep at least one stamp milestone.')
                      update('stamp_rewards',next)
                      const sorted=[...next].sort((a,b)=>Number(a.stamps)-Number(b.stamps)); const final=sorted[sorted.length-1]
                      update('stamp_goal',Number(final.stamps)||8); update('reward_name',final.reward_name||'Reward')
                    }} style={{...styles.prizeRemoveBtn,alignSelf:guidedMobile?'flex-end':'center'}}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={()=>{
                  const current=[...(form.stamp_rewards||[])].sort((a,b)=>Number(a.stamps)-Number(b.stamps))
                  const max=current.length?Number(current[current.length-1].stamps)||0:0
                  update('stamp_rewards',[...current,{id:Math.random().toString(16).slice(2,14),stamps:max+5,reward_name:''}])
                }} style={{...styles.addPrizeBtn,width:guidedMobile?'100%':'auto',marginTop:12}}>+ Add Reward Milestone</button>
                <label style={{display:'flex',gap:10,alignItems:'flex-start',marginTop:18,fontSize:13,fontWeight:700,lineHeight:1.4}}>
                  <input type="checkbox" checked={form.stamp_once_per_day===true} onChange={e=>update('stamp_once_per_day',e.target.checked)} style={{marginTop:2}}/>
                  <span>Limit each customer to 1 stamp per day</span>
                </label>
              </>}

              {effectiveLoyaltyType==='points' && <>
                <label style={styles.label}>How customers earn points</label>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span>Earn</span>
                  <input style={{...styles.input,width:guidedMobile?'100%':95}} type="number" min="1" value={form.points_per_amount} onChange={e=>update('points_per_amount',e.target.value)}/>
                  <span>points for every ₱</span>
                  <input style={{...styles.input,width:guidedMobile?'100%':110}} type="number" min="1" value={form.points_amount_pesos} onChange={e=>update('points_amount_pesos',e.target.value)}/>
                  <span>spent</span>
                </div>

                <div style={{marginTop:18}}>
                  <label style={styles.label}>Maximum points balance <span style={{fontWeight:500,color:'#94a3b8'}}>(optional)</span></label>
                  <input
                    style={{...styles.input,width:guidedMobile?'100%':190}}
                    type="number"
                    min="1"
                    step="1"
                    value={form.points_cap_limit}
                    onChange={e=>update('points_cap_limit',e.target.value)}
                    placeholder="No limit"
                  />
                  <p style={{...styles.hint,margin:'7px 0 0'}}>
                    Leave blank for unlimited points. At the cap, purchases stop adding points until the member redeems some.
                  </p>
                </div>

                <div style={{marginTop:20}}>
                  <label style={styles.label}>Points rewards</label>
                  <p style={{...styles.hint,margin:'0 0 12px'}}>Add the prizes customers can redeem with their points.</p>
                  {(form.points_prizes || []).map((p,i)=>(
                    <div key={p.id || i} style={{display:'flex',flexDirection:guidedMobile?'column':'row',gap:8,alignItems:guidedMobile?'stretch':'center',padding:'10px 0',borderBottom:'1px solid #eef2f7'}}>
                      <input style={{...styles.input,flex:1}} value={p.name || ''} placeholder="Reward, e.g. Free Drink"
                        onChange={e=>update('points_prizes',(form.points_prizes||[]).map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                      <input style={{...styles.input,width:guidedMobile?'100%':150}} type="number" min="1" value={p.points_cost || ''}
                        placeholder="Points"
                        onChange={e=>update('points_prizes',(form.points_prizes||[]).map((x,j)=>j===i?{...x,points_cost:Number(e.target.value)}:x))}/>
                      <button type="button" style={{...styles.prizeRemoveBtn,alignSelf:guidedMobile?'flex-end':'center'}}
                        onClick={()=>update('points_prizes',(form.points_prizes||[]).filter((_,j)=>j!==i))}>✕</button>
                    </div>
                  ))}
                  <button type="button" style={{...styles.addPrizeBtn,width:guidedMobile?'100%':'auto',marginTop:12}}
                    onClick={()=>update('points_prizes',[...(form.points_prizes||[]),{id:Math.random().toString(16).slice(2,14),name:'',points_cost:100}])}>
                    + Add Points Reward
                  </button>
                </div>
              </>}

              {hasMembership && <>
                <label style={styles.label}>Default membership duration</label>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <input style={{...styles.input,width:guidedMobile?'100%':130}} type="number" min="1" max="3650" value={form.membership_duration_days} onChange={e=>update('membership_duration_days',e.target.value)}/>
                  <span>days</span>
                </div>
                <label style={{...styles.label,marginTop:14}}>Default membership price</label>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span>₱</span>
                  <input style={{...styles.input,width:guidedMobile?'100%':160}} type="number" min="0" step="any" value={form.membership_price} onChange={e=>update('membership_price',e.target.value)}/>
                </div>

                <label style={{...styles.label,marginTop:18}}>Member rewards / benefits</label>
                <p style={{...styles.hint,margin:'0 0 10px'}}>Enter one included perk or reward per line.</p>
                <textarea style={{...styles.textarea,width:'100%',boxSizing:'border-box'}} rows={guidedMobile?5:4}
                  value={(form.membership_services || []).join('\n')}
                  onChange={e=>update('membership_services',e.target.value.split('\n').map(v=>v.trim()).filter(Boolean))}
                  placeholder={'Free monthly service\n10% member discount\nPriority booking'}/>
              </>}

              {form.card_type==='vip' && <>
                <label style={styles.label}>VIP earning rule</label>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span>Earn</span>
                  <input style={{...styles.input,width:guidedMobile?'100%':95}} type="number" min="1" value={form.vip_points_per_amount} onChange={e=>update('vip_points_per_amount',e.target.value)}/>
                  <span>VIP points for every ₱</span>
                  <input style={{...styles.input,width:guidedMobile?'100%':110}} type="number" min="1" value={form.vip_amount_pesos} onChange={e=>update('vip_amount_pesos',e.target.value)}/>
                  <span>spent</span>
                </div>

                <div style={{marginTop:20}}>
                  <label style={styles.label}>VIP tier rewards</label>
                  <p style={{...styles.hint,margin:'0 0 12px'}}>Set what customers unlock when they reach each VIP tier.</p>
                  {(form.vip_tiers || []).map((tier,i)=>(
                    <div key={tier.id || i} style={{padding:'12px',marginBottom:10,border:'1px solid #e2e8f0',borderRadius:12,background:'#f8fafc'}}>
                      <div style={{display:'grid',gridTemplateColumns:guidedMobile?'1fr':'1fr 130px 120px',gap:8}}>
                        <input style={styles.input} value={tier.name || ''} placeholder="Tier name"
                          onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,name:e.target.value}:t))}/>
                        <input style={styles.input} type="number" min="0" value={tier.threshold || 0} placeholder="Points"
                          onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,threshold:Number(e.target.value)}:t))}/>
                        <input style={styles.input} type="number" min="0" max="100" value={tier.discount_percent || 0} placeholder="Discount %"
                          onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,discount_percent:Number(e.target.value)}:t))}/>
                      </div>
                      <textarea style={{...styles.textarea,width:'100%',boxSizing:'border-box',marginTop:8}} rows={3}
                        value={(tier.benefits || []).join('\n')}
                        onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,benefits:e.target.value.split('\n').map(v=>v.trim()).filter(Boolean)}:t))}
                        placeholder={'One reward per line\nFree upgrade\nPriority service'}/>
                      <button type="button" style={{...styles.prizeRemoveBtn,marginTop:8}}
                        onClick={()=>update('vip_tiers',form.vip_tiers.filter((_,j)=>j!==i))}>Remove tier</button>
                    </div>
                  ))}
                  <button type="button" style={{...styles.addPrizeBtn,width:guidedMobile?'100%':'auto'}}
                    onClick={()=>update('vip_tiers',[...(form.vip_tiers||[]),{id:Math.random().toString(16).slice(2,14),name:'New Tier',threshold:0,color:'#64748b',discount_percent:0,benefits:[],active:true}])}>
                    + Add VIP Tier
                  </button>
                </div>
              </>}

              {form.card_type==='multipass' && <>
                <label style={styles.label}>Sessions / visits included</label>
                <input style={{...styles.input,width:guidedMobile?'100%':150}} type="number" min="2" max="200" value={form.multipass_session_count} onChange={e=>update('multipass_session_count',e.target.value)}/>
                <p style={styles.hint}>For Multi-Pass, the included sessions are the customer's redeemable benefit. Each use reduces the remaining session count.</p>
                <label style={{...styles.label,marginTop:14}}>Pass validity</label>
                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <input style={{...styles.input,width:guidedMobile?'100%':150}} type="number" min="1" value={form.multipass_validity_days} onChange={e=>update('multipass_validity_days',e.target.value)}/>
                  <span>days</span>
                </div>
              </>}
            </>
          )}

          {guidedStep === 4 && (
            <>
              <p style={{margin:'0 0 18px',color:'#64748b',lineHeight:1.6}}>
                Pick the main color customers will associate with your card. You can fine-tune the Wallet style later.
              </p>
              <label style={styles.label}>Primary color</label>
              <div style={{display:'flex',gap:12,alignItems:'center'}}>
                <input type="color" value={form.primary_color || '#0d9488'} onChange={e=>update('primary_color',e.target.value)}
                  style={{width:58,height:48,border:'1px solid #cbd5e1',borderRadius:10,padding:4,background:'#fff'}}/>
                <input style={{...styles.input,maxWidth:180}} value={form.primary_color || '#0d9488'} onChange={e=>update('primary_color',e.target.value)}/>
              </div>
              <div style={{marginTop:18,borderRadius:16,padding:20,color:'#fff',background:`linear-gradient(135deg,${form.primary_color || '#0d9488'},${form.wallet_secondary_color || '#14b8a6'})`}}>
                <div style={{fontSize:12,opacity:.85}}>{businessName}</div>
                <div style={{fontSize:22,fontWeight:850,marginTop:4}}>{form.card_name || `${businessName} Rewards`}</div>
                <div style={{fontSize:13,opacity:.9,marginTop:22}}>{guidedCardLabel}</div>
              </div>
            </>
          )}

          {guidedStep === 5 && (
            <>
              <p style={{margin:'0 0 18px',color:'#64748b',lineHeight:1.6}}>
                Add your logo and optional background image. You can skip either one and add it later from Edit Card.
              </p>
              <label style={styles.label}>Business / card logo</label>
              <input type="file" accept="image/*" onChange={e=>uploadImage('program_logo_url',e.target.files?.[0])}/>
              {imageUpload.program_logo_url.uploading && <p style={styles.hint}>Uploading logo…</p>}
              {form.program_logo_url && <img src={form.program_logo_url} alt="Logo preview" style={{width:72,height:72,objectFit:'cover',borderRadius:14,marginTop:10,border:'1px solid #e2e8f0'}}/>}
              <div style={{height:18}}/>
              <label style={styles.label}>Card background / hero image <span style={{fontWeight:500,color:'#94a3b8'}}>(optional)</span></label>
              <input type="file" accept="image/*" onChange={e=>uploadImage('hero_image_url',e.target.files?.[0])}/>
              {imageUpload.hero_image_url.uploading && <p style={styles.hint}>Uploading image…</p>}
              {form.hero_image_url && <img src={form.hero_image_url} alt="Background preview" style={{width:'100%',maxWidth:360,height:130,objectFit:'cover',borderRadius:14,marginTop:10,border:'1px solid #e2e8f0'}}/>}
            </>
          )}

          {guidedStep === 6 && (
            <>
              <p style={{margin:'0 0 18px',color:'#64748b',lineHeight:1.6}}>
                Here’s what we’ll publish. You can change any advanced setting later from <b>Edit Card</b>.
              </p>
              <div style={{display:'grid',gap:10}}>
                <div style={{padding:13,borderRadius:12,background:'#f8fafc'}}><b>Card type:</b> {guidedCardLabel}</div>
                <div style={{padding:13,borderRadius:12,background:'#f8fafc'}}><b>Card name:</b> {form.card_name || `${businessName} Rewards`}</div>
                <div style={{padding:13,borderRadius:12,background:'#f8fafc'}}><b>Description:</b> {form.description || '—'}</div>
                <div style={{padding:13,borderRadius:12,background:'#f8fafc',display:'flex',alignItems:'center',gap:9}}>
                  <b>Color:</b><span style={{width:22,height:22,borderRadius:6,background:form.primary_color,border:'1px solid #cbd5e1'}}/> {form.primary_color}
                </div>
              </div>
              <div style={{marginTop:18,padding:14,borderRadius:12,background:'#f0fdfa',border:'1px solid #99f6e4',color:'#0f766e',fontSize:13,lineHeight:1.55}}>
                Publishing saves your card settings and prepares the Wallet card configuration. After this, LoyaltyTree will guide you to cashier and customer QR setup.
              </div>
            </>
          )}
        </div>

        <div style={{display:'flex',flexDirection:guidedMobile?'column-reverse':'row',justifyContent:'space-between',gap:10,marginTop:16,flexWrap:'wrap'}}>
          <button type="button" onClick={guidedBack} disabled={guidedStep===0 || publishing}
            style={{...styles.typeChangeBtn,padding:'11px 18px',width:guidedMobile?'100%':'auto',opacity:guidedStep===0?.45:1}}>
            ← Back
          </button>

          {guidedStep < 6 ? (
            <button type="button" onClick={guidedNext} style={{...styles.pickerContinueBtn,margin:0,width:guidedMobile?'100%':'auto',minWidth:guidedMobile?0:170}}>
              {guidedStep===0 ? `Choose ${guidedCardLabel} →` : 'Continue →'}
            </button>
          ) : (
            <button type="button" onClick={guidedPublish} disabled={publishing} style={{...styles.publishBtn,flex:guidedMobile?'1 1 auto':'0 1 240px',width:guidedMobile?'100%':'auto'}}>
              {publishing ? 'Publishing…' : '✓ Publish Card & Continue'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (step === 'picker') {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h2 style={styles.title}>🎨 Choose Your Card</h2>
          <p style={styles.subtitle}>Choose how your business serves customers. Your business runs one active card at a time.</p>
        </div>

        <div style={styles.pickerGrid}>
          <button
            type="button"
            onClick={() => update('card_type', 'stamp')}
            style={{
              ...styles.pickerCard,
              ...(form.card_type === 'stamp' ? { borderColor: form.primary_color || '#0d9488', background: '#f0fdfa' } : {}),
            }}
          >
            <span style={styles.pickerCardIcon}>🎟️</span>
            <span style={styles.pickerCardLabel}>Stamp Card</span>
            <span style={styles.pickerCardDesc}>Customers collect a stamp on every visit and unlock a reward after a set number of stamps.</span>
            {form.card_type === 'stamp' && <span style={styles.pickerCardBadge}>Selected</span>}
          </button>

          <button
            type="button"
            onClick={() => update('card_type', 'points')}
            style={{
              ...styles.pickerCard,
              ...(form.card_type === 'points' ? { borderColor: form.primary_color || '#0d9488', background: '#f0fdfa' } : {}),
            }}
          >
            <span style={styles.pickerCardIcon}>💎</span>
            <span style={styles.pickerCardLabel}>Points Card</span>
            <span style={styles.pickerCardDesc}>Customers earn points based on how much they spend, then redeem points for prizes you set.</span>
            {form.card_type === 'points' && <span style={styles.pickerCardBadge}>Selected</span>}
          </button>


          <button
            type="button"
            onClick={() => update('card_type', 'membership')}
            style={{
              ...styles.pickerCard,
              ...(form.card_type === 'membership' ? { borderColor: form.primary_color || '#0d9488', background: '#f0fdfa' } : {}),
            }}
          >
            <span style={styles.pickerCardIcon}>🏋️</span>
            <span style={styles.pickerCardLabel}>Membership Card</span>
            <span style={styles.pickerCardDesc}>For subscriptions and access-based businesses such as gyms, clubs, coworking spaces, clinics, and monthly service plans.</span>
            {form.card_type === 'membership' && <span style={styles.pickerCardBadge}>Selected</span>}
          </button>

          <button
            type="button"
            onClick={() => update('card_type', 'hybrid')}
            style={{
              ...styles.pickerCard,
              ...(form.card_type === 'hybrid' ? { borderColor: form.primary_color || '#0d9488', background: '#f0fdfa' } : {}),
            }}
          >
            <span style={styles.pickerCardIcon}>✨</span>
            <span style={styles.pickerCardLabel}>Hybrid Card</span>
            <span style={styles.pickerCardDesc}>One Wallet card combining Membership / Subscription with Points or Stamps.</span>
            {form.card_type === 'hybrid' && <span style={styles.pickerCardBadge}>Selected</span>}
          </button>

          <button type="button" onClick={() => update('card_type','vip')} style={{...styles.pickerCard,...(form.card_type==='vip'?{borderColor:form.primary_color||'#0d9488',background:'#fefce8'}:{})}}><span style={styles.pickerCardIcon}>👑</span><span style={styles.pickerCardLabel}>VIP Card</span><span style={styles.pickerCardDesc}>Customers earn non-spendable VIP points, rise through tiers automatically, and unlock stronger benefits.</span>{form.card_type==='vip'&&<span style={styles.pickerCardBadge}>Selected</span>}</button>

          <button
            type="button"
            onClick={() => update('card_type', 'multipass')}
            style={{
              ...styles.pickerCard,
              ...(form.card_type === 'multipass' ? { borderColor: form.primary_color || '#0d9488', background: '#f0fdfa' } : {}),
            }}
          >
            <span style={styles.pickerCardIcon}>🎫</span>
            <span style={styles.pickerCardLabel}>Multi-Pass</span>
            <span style={styles.pickerCardDesc}>Customers buy a bulk session pack (e.g. 12 sessions for the price of 10) that counts down as they're used.</span>
            {form.card_type === 'multipass' && <span style={styles.pickerCardBadge}>Selected</span>}
          </button>
        </div>

        <button type="button" onClick={() => setStep('form')} style={styles.pickerContinueBtn}>
          Continue with {form.card_type === 'hybrid' ? 'Hybrid Card' : form.card_type === 'points' ? 'Points Card' : form.card_type === 'membership' ? 'Membership Card' : form.card_type === 'vip' ? 'VIP Card' : form.card_type === 'multipass' ? 'Multi-Pass' : 'Stamp Card'} →
        </button>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <style>{`
        @media (max-width: 900px) {
          .lc-grid { grid-template-columns: 1fr !important; grid-template-areas: 'preview' 'form' !important; }
          .lc-preview-sticky { position: static !important; }
        }
      `}</style>

      <div style={styles.header}>
        <h2 style={styles.title}>🎨 Customize Your Card</h2>
        <p style={styles.subtitle}>Changes here update what customers see on their wallet pass and join page.</p>
      </div>

      <div className="lc-grid" style={styles.grid}>
        {/* Live preview */}
        <div style={{ ...styles.previewCol, gridArea: 'preview' }}>
          <div className="lc-preview-sticky" style={styles.previewSticky}>
            <div style={styles.previewLabel}>Live preview</div>
            <div style={styles.card}>
              <div style={{ ...styles.cardHeader, background: form.card_type === 'vip' ? ((form.vip_tiers||[]).find(t=>String(t.name||'').toLowerCase()==='gold')?.color || (form.vip_tiers||[])[0]?.color || '#111827') : (form.primary_color || '#0d9488') }}>
                <span style={styles.cardHeaderTitle}>
                  {form.card_type === 'hybrid'
                    ? `Membership + ${effectiveLoyaltyType === 'points' ? 'Points' : 'Stamps'}`
                    : form.card_type === 'points'
                    ? 'Points Rewards'
                    : form.card_type === 'membership'
                    ? 'Membership'
                    : form.card_type === 'vip'
                    ? 'VIP Status'
                    : form.card_type === 'multipass'
                    ? `${Number(form.multipass_session_count) || 12}-Session Pass`
                    : (form.reward_name || 'Free Service')}
                </span>
                <span style={styles.cardHeaderSub}>{displayName}</span>
              </div>
              {form.hero_image_url ? (
                <img src={form.hero_image_url} alt="" style={styles.cardHero} onError={e => { e.target.style.display = 'none' }} />
              ) : null}
              <div style={styles.cardBody}>
                {form.program_logo_url ? (
                  <img src={form.program_logo_url} alt="" style={styles.cardLogo} onError={e => { e.target.style.display = 'none' }} />
                ) : null}
                {form.card_type === 'hybrid' ? (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                      <div style={{...styles.previewPrizeRow,display:'block',textAlign:'center'}}><small style={{display:'block',color:'#64748b'}}>MEMBERSHIP</small><b style={{color:form.primary_color||'#0d9488'}}>ACTIVE</b></div>
                      <div style={{...styles.previewPrizeRow,display:'block',textAlign:'center'}}><small style={{display:'block',color:'#64748b'}}>{effectiveLoyaltyType==='points'?'POINTS':'STAMPS'}</small><b style={{color:form.primary_color||'#0d9488'}}>{effectiveLoyaltyType==='points'?'240':`5 / ${stampGoal}`}</b></div>
                    </div>
                    <div style={styles.cardFoot}>
                      {Number(form.membership_price)>0?`₱${Number(form.membership_price).toLocaleString()} / ${Number(form.membership_duration_days)||30} days · `:''}
                      {effectiveLoyaltyType==='points'?`Earn ${Number(form.points_per_amount)||0} pts per ₱${Number(form.points_amount_pesos)||0}`:`${stampGoal} stamps to final reward`}
                    </div>
                    {Array.isArray(form.membership_services) && form.membership_services.length > 0 && (
                      <div style={styles.previewPrizeList}>{form.membership_services.slice(0,2).map((benefit,i)=><div key={i} style={styles.previewPrizeRow}><span>✓ {benefit}</span></div>)}</div>
                    )}
                  </>
                ) : form.card_type === 'points' ? (
                  <>
                    <div style={styles.previewPointsBalance}>
                      <span style={{ color: form.primary_color || '#0d9488' }}>240</span> pts
                    </div>
                    <div style={styles.cardFoot}>
                      Earn {Number(form.points_per_amount) || 0} pts per ₱{Number(form.points_amount_pesos) || 0} spent
                      {form.points_cap_limit !== '' && (
                        <><br />Maximum balance: {Number(form.points_cap_limit).toLocaleString()} pts</>
                      )}
                    </div>
                    {form.points_prizes.length > 0 && (
                      <div style={styles.previewPrizeList}>
                        {form.points_prizes.slice(0, 3).map(p => (
                          <div key={p.id} style={styles.previewPrizeRow}>
                            <span>{p.name}</span>
                            <span style={{ color: form.primary_color || '#0d9488', fontWeight: 700 }}>{p.points_cost} pts</span>
                          </div>
                        ))}
                        {form.points_prizes.length > 3 && (
                          <div style={styles.previewMoreText}>+{form.points_prizes.length - 3} more</div>
                        )}
                      </div>
                    )}
                  </>
                ) : form.card_type === 'membership' ? (
                  <>
                    <div style={styles.previewPointsBalance}>
                      <span style={{ color: form.primary_color || '#0d9488' }}>ACTIVE</span>
                    </div>
                    <div style={styles.cardFoot}>
                      valid for {Number(form.membership_duration_days) || 30} days
                      {Number(form.membership_price) > 0 ? ` · ₱${Number(form.membership_price).toLocaleString()}` : ''}
                    </div>
                    {Array.isArray(form.membership_services) && form.membership_services.length > 0 && (
                      <div style={styles.previewPrizeList}>
                        {form.membership_services.slice(0, 4).map((benefit, i) => (
                          <div key={i} style={styles.previewPrizeRow}>
                            <span>✓ {benefit}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : form.card_type === 'vip' ? (
                  <>
                    <div style={styles.previewPointsBalance}><span style={{color:(form.vip_tiers||[]).find(t=>String(t.name||'').toLowerCase()==='gold')?.color || (form.vip_tiers||[])[0]?.color || '#111827'}}>GOLD VIP</span></div>
                    <div style={styles.cardFoot}>3,450 VIP points · progressing automatically</div>
                    <div style={styles.previewPrizeList}>{(form.vip_tiers||[]).slice(0,4).map((t,i)=><div key={t.id||i} style={styles.previewPrizeRow}><span>{t.name}</span><span>{t.threshold} pts</span></div>)}</div>
                  </>
                ) : form.card_type === 'multipass' ? (
                  <>
                    <div style={styles.previewPointsBalance}>
                      <span style={{ color: form.primary_color || '#0d9488' }}>{multipassSessionCount - multipassPreviewUsed}</span> sessions left
                    </div>
                    <div style={styles.stampGrid}>
                      {Array.from({ length: Math.min(multipassSessionCount, 20) }).map((_, i) => (
                        <div
                          key={i}
                          style={{
                            ...styles.stampDot,
                            background: i < multipassPreviewUsed ? '#e2e8f0' : (form.primary_color || '#0d9488'),
                          }}
                        />
                      ))}
                    </div>
                    <div style={styles.cardFoot}>valid {form.multipass_validity_days || 90} days after purchase</div>
                  </>
                ) : (
                  <>
                    <div style={styles.stampGrid}>
                      {Array.from({ length: stampGoal }).map((_, i) => (
                        <div
                          key={i}
                          style={{
                            ...styles.stampDot,
                            background: i < previewFilled ? (form.primary_color || '#0d9488') : '#e2e8f0',
                          }}
                        />
                      ))}
                    </div>
                    <div style={styles.cardFoot}>{previewFilled} of {stampGoal} stamps</div>
                  </>
                )}
              </div>
            </div>

            {/* The bit you asked for: a short description shown below the card */}
            {form.description ? (
              <p style={styles.cardDescription}>{form.description}</p>
            ) : (
              <p style={styles.cardDescriptionPlaceholder}>Add a short description below &mdash; it'll appear right here, under the card.</p>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handlePublish} style={{ ...styles.form, gridArea: 'form' }}>
          {error && <div style={styles.error}>{error}</div>}
          {saved && <div style={styles.success}>✓ Card published successfully</div>}

          <div style={styles.typeSummary}>
            <span style={styles.typeSummaryText}>
              {form.card_type === 'hybrid' ? `✨ Hybrid Card · Membership + ${effectiveLoyaltyType === 'points' ? 'Points' : 'Stamps'}` : form.card_type === 'points' ? '💎 Points Card' : form.card_type === 'membership' ? '🏋️ Membership Card' : form.card_type === 'vip' ? '👑 VIP Card' : form.card_type === 'multipass' ? '🎫 Multi-Pass' : '🎟️ Stamp Card'}
            </span>
            <button type="button" onClick={() => setStep('picker')} style={styles.typeChangeBtn}>
              Change card type
            </button>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Card name</label>
            <input
              style={styles.input}
              placeholder={`${user?.business_name || 'Your Business'} Rewards`}
              value={form.card_name}
              onChange={e => update('card_name', e.target.value)}
            />
            <p style={styles.hint}>Shown as the card's title. Leave blank to use "[Business name] Rewards".</p>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Description</label>
            <textarea
              style={styles.textarea}
              placeholder={
                hasMembership
                  ? 'e.g. Monthly membership benefits plus loyalty rewards.'
                  : 'e.g. Collect a stamp on every visit and get a free coffee on us!'
              }
              value={form.description}
              maxLength={DESCRIPTION_LIMIT}
              onChange={e => update('description', e.target.value)}
              rows={3}
            />
            <p style={styles.hint}>
              A short line shown below the card &mdash; a good spot for how the reward works, or any terms.{' '}
              <span style={{ color: form.description.length >= DESCRIPTION_LIMIT ? '#ef4444' : '#94a3b8' }}>
                {form.description.length}/{DESCRIPTION_LIMIT}
              </span>
            </p>
          </div>

          {isHybrid && (
            <div style={{...styles.pointsSection,border:'1px solid #cbd5e1',background:'#f8fafc'}}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Hybrid loyalty type</label>
                <p style={styles.hint}>Membership is always included. Choose the rewards balance customers will also see on the same card.</p>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
                  <button type="button" onClick={()=>update('hybrid_loyalty_type','points')} style={{...styles.pickerCard,padding:16,...(effectiveLoyaltyType==='points'?{borderColor:'#0d9488',background:'#f0fdfa'}:{})}}>
                    <span style={styles.pickerCardIcon}>💎</span>
                    <span style={styles.pickerCardLabel}>Membership + Points</span>
                    <span style={styles.pickerCardDesc}>Earn from spending and redeem configured prizes.</span>
                  </button>
                  <button type="button" onClick={()=>update('hybrid_loyalty_type','stamp')} style={{...styles.pickerCard,padding:16,...(effectiveLoyaltyType==='stamp'?{borderColor:'#0d9488',background:'#f0fdfa'}:{})}}>
                    <span style={styles.pickerCardIcon}>🎟️</span>
                    <span style={styles.pickerCardLabel}>Membership + Stamps</span>
                    <span style={styles.pickerCardDesc}>Track visit/purchase stamps beside subscription status.</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {isHybrid && (
            <div style={{...styles.pointsSection,border:'1px solid #99f6e4',background:'#f0fdfa'}}>
              <div style={{...styles.wallet20Eyebrow,marginBottom:6}}>1 · Membership / Subscription</div>
              <h3 style={{margin:'0 0 6px',fontSize:18,color:'#0f172a'}}>Set up the subscription side</h3>
              <p style={{...styles.hint,margin:'0 0 18px'}}>Hybrid keeps this membership and the loyalty rewards below on one customer card. Membership benefits are recurring entitlements, separate from promotional coupons.</p>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>How should customers become subscribers?</label>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10}}>
                  <button type="button" onClick={()=>update('subscription_enrollment_mode','automatic')} style={{...styles.pickerCard,padding:15,...(form.subscription_enrollment_mode==='automatic'?{borderColor:'#0d9488',background:'#fff'}:{})}}>
                    <span style={styles.pickerCardIcon}>⚡</span><span style={styles.pickerCardLabel}>Automatic Enrollment</span>
                    <span style={styles.pickerCardDesc}>Everyone who joins immediately receives an active membership for the configured duration. Best for free/included memberships.</span>
                  </button>
                  <button type="button" onClick={()=>update('subscription_enrollment_mode','manual')} style={{...styles.pickerCard,padding:15,...(form.subscription_enrollment_mode!=='automatic'?{borderColor:'#0d9488',background:'#fff'}:{})}}>
                    <span style={styles.pickerCardIcon}>👤</span><span style={styles.pickerCardLabel}>Manual Enrollment</span>
                    <span style={styles.pickerCardDesc}>Customers join the loyalty card first. You choose who gets subscription access. Recommended for paid plans.</span>
                  </button>
                </div>
                {form.subscription_enrollment_mode==='automatic' && Number(form.membership_price||0)>0 && <p style={{...styles.hint,color:'#b45309',fontWeight:700}}>Automatic enrollment will activate the membership even before payment is verified. Use Manual for paid subscriptions unless membership is intentionally included/free.</p>}
              </div>

              <div style={styles.row}>
                <div style={{...styles.fieldGroup,flex:1}}>
                  <label style={styles.label}>Membership Name</label>
                  <input style={styles.input} value={form.membership_name} onChange={e=>update('membership_name',e.target.value)} placeholder="Coffee Club"/>
                </div>
                <div style={{...styles.fieldGroup,flex:1}}>
                  <label style={styles.label}>Duration</label>
                  <div style={styles.colorRow}><input style={styles.input} type="number" min="1" max="3650" value={form.membership_duration_days} onChange={e=>update('membership_duration_days',e.target.value)}/><span style={styles.unit}>days</span></div>
                </div>
                <div style={{...styles.fieldGroup,flex:1}}>
                  <label style={styles.label}>Price</label>
                  <div style={styles.colorRow}><span style={styles.unit}>₱</span><input style={styles.input} type="number" min="0" step="any" value={form.membership_price} onChange={e=>update('membership_price',e.target.value)}/></div>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Benefits</label>
                <p style={styles.hint}>Add benefits such as “1 free coffee per day”, “1 free sandwich per week”, or “10% off pastries”. LT3 tracks each redemption and automatically restores availability when its rule resets.</p>
                {(form.membership_benefits || []).map((b,i)=><div key={b.id||i} style={styles.prizeRow}>
                  <div style={{minWidth:0}}>
                    <div style={styles.prizeName}>{b.name}</div>
                    <div style={styles.prizeDesc}>{benefitRuleLabel(b)}{b.benefit_type==='percentage_discount'&&b.value!=null?` · ${b.value}% discount`:b.benefit_type==='fixed_discount'&&b.value!=null?` · ₱${Number(b.value).toLocaleString()} discount`:''}</div>
                    {b.description && <div style={styles.prizeDesc}>{b.description}</div>}
                  </div>
                  <button type="button" style={styles.prizeRemoveBtn} onClick={()=>removeMembershipBenefit(b.id)}>✕</button>
                </div>)}

                <div style={styles.prizeForm}>
                  <input style={styles.input} placeholder="Benefit name, e.g. Free Brewed Coffee" value={benefitDraft.name} onChange={e=>setBenefitDraft(d=>({...d,name:e.target.value}))}/>
                  <div style={styles.row}>
                    <select style={{...styles.input,flex:1}} value={benefitDraft.benefit_type} onChange={e=>setBenefitDraft(d=>({...d,benefit_type:e.target.value,value:''}))}>
                      <option value="free_item">Free item / service</option><option value="percentage_discount">Percentage discount</option><option value="fixed_discount">Fixed discount</option><option value="custom">Custom benefit</option>
                    </select>
                    {['percentage_discount','fixed_discount'].includes(benefitDraft.benefit_type) && <input style={{...styles.input,width:150}} type="number" min="0" max={benefitDraft.benefit_type==='percentage_discount'?100:undefined} step="any" placeholder={benefitDraft.benefit_type==='percentage_discount'?'Discount %':'₱ discount'} value={benefitDraft.value} onChange={e=>setBenefitDraft(d=>({...d,value:e.target.value}))}/>} 
                  </div>
                  <input style={styles.input} placeholder="Description (optional)" value={benefitDraft.description} onChange={e=>setBenefitDraft(d=>({...d,description:e.target.value}))}/>
                  <label style={{display:'flex',gap:9,alignItems:'center',fontSize:13,fontWeight:700}}><input type="checkbox" checked={benefitDraft.unlimited} onChange={e=>setBenefitDraft(d=>({...d,unlimited:e.target.checked}))}/> Unlimited uses while membership is active</label>
                  {!benefitDraft.unlimited && <div style={styles.row}>
                    <input style={{...styles.input,width:120}} type="number" min="1" value={benefitDraft.usage_limit} onChange={e=>setBenefitDraft(d=>({...d,usage_limit:e.target.value}))}/>
                    <span style={styles.earnRateText}>use(s) per</span>
                    <select style={{...styles.input,flex:1}} value={benefitDraft.reset_period} onChange={e=>setBenefitDraft(d=>({...d,reset_period:e.target.value}))}>
                      <option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option><option value="membership_cycle">Membership cycle</option><option value="never">Membership lifetime / never resets</option>
                    </select>
                  </div>}
                  {benefitError && <div style={styles.error}>{benefitError}</div>}
                  <button type="button" onClick={addMembershipBenefit} style={styles.addPrizeBtn}>+ Add Benefit</button>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Membership terms</label>
                <textarea style={styles.textarea} rows={4} value={form.membership_terms} onChange={e=>update('membership_terms',e.target.value)} placeholder="Optional renewal, usage, or subscription rules."/>
              </div>
            </div>
          )}

          {isHybrid && <div style={{...styles.wallet20Eyebrow,margin:'4px 0 8px'}}>2 · {effectiveLoyaltyType === 'points' ? 'Points Rewards' : 'Stamp Rewards'}</div>}

          {effectiveLoyaltyType === 'stamp' ? (
            <div style={styles.pointsSection}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Stamp rewards</label>
                <p style={styles.hint}>Add milestones such as 10 stamps → Free Drink and 20 stamps → Grand Prize. Customers keep their stamps after intermediate rewards.</p>
                {(form.stamp_rewards || []).map((r, i) => (
                  <div key={r.id || i} style={styles.prizeRow}>
                    <div>
                      <div style={styles.prizeName}>{r.stamps} stamps → {r.reward_name}</div>
                      <div style={styles.prizeDesc}>{i === (form.stamp_rewards || []).length - 1 ? 'Final milestone' : 'Intermediate reward · stamp count continues'}</div>
                    </div>
                    <button type="button" style={styles.prizeRemoveBtn} onClick={() => {
                      const next = form.stamp_rewards.filter((_, j) => j !== i)
                      update('stamp_rewards', next)
                      if (next.length) {
                        const final = [...next].sort((a,b)=>Number(a.stamps)-Number(b.stamps)).slice(-1)[0]
                        update('stamp_goal', final.stamps); update('reward_name', final.reward_name)
                      }
                    }}>✕</button>
                  </div>
                ))}
                <div style={styles.prizeForm}>
                  <div style={styles.row}>
                    <input style={{...styles.input,width:130}} type="number" min="1" max="500" placeholder="Stamps" value={stampRewardDraft.stamps} onChange={e=>setStampRewardDraft(d=>({...d,stamps:e.target.value}))}/>
                    <input style={{...styles.input,flex:1}} placeholder="Reward, e.g. Free Drink" value={stampRewardDraft.reward_name} onChange={e=>setStampRewardDraft(d=>({...d,reward_name:e.target.value}))}/>
                  </div>
                  {stampRewardError && <div style={styles.error}>{stampRewardError}</div>}
                  <button type="button" style={styles.addPrizeBtn} onClick={() => {
                    setStampRewardError('')
                    const stamps = Number(stampRewardDraft.stamps)
                    const name = stampRewardDraft.reward_name.trim()
                    if (!stamps || stamps < 1) return setStampRewardError('Enter a valid stamp milestone')
                    if (!name) return setStampRewardError('Enter the reward name')
                    if ((form.stamp_rewards || []).some(r => Number(r.stamps) === stamps)) return setStampRewardError('That stamp milestone already has a reward')
                    const next = [...(form.stamp_rewards || []), {id:Math.random().toString(16).slice(2,14),stamps,reward_name:name}].sort((a,b)=>Number(a.stamps)-Number(b.stamps))
                    update('stamp_rewards', next)
                    const final = next[next.length-1]
                    update('stamp_goal', final.stamps); update('reward_name', final.reward_name)
                    setStampRewardDraft({stamps:'',reward_name:''})
                  }}>+ Add Stamp Reward</button>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Stamp rules</label>
                <label style={{display:'flex',gap:10,alignItems:'center',fontSize:13,fontWeight:700}}>
                  <input type="checkbox" checked={form.stamp_once_per_day === true} onChange={e=>update('stamp_once_per_day',e.target.checked)}/>
                  Maximum 1 stamp per customer per day
                </label>
                <p style={styles.hint}>When enabled, the backend blocks a second stamp for the same customer until the next day, even from another cashier/device.</p>
                <label style={{display:'flex',gap:10,alignItems:'center',fontSize:13,fontWeight:700}}>
                  <input type="checkbox" checked={form.stamp_reset_after_final !== false} onChange={e=>update('stamp_reset_after_final',e.target.checked)}/>
                  Reset stamps after the final reward is redeemed
                </label>
              </div>
            </div>
          ) : form.card_type === 'membership' ? (
            <div style={styles.pointsSection}>
              <div style={styles.row}>
                <div style={{ ...styles.fieldGroup, flex: 1 }}>
                  <label style={styles.label}>Default membership duration</label>
                  <div style={styles.colorRow}>
                    <input
                      style={styles.input}
                      type="number"
                      min={1}
                      max={3650}
                      value={form.membership_duration_days}
                      onChange={e => update('membership_duration_days', e.target.value)}
                    />
                    <span style={styles.unit}>days</span>
                  </div>
                  <p style={styles.hint}>Used when activating or renewing a member.</p>
                </div>
                <div style={{ ...styles.fieldGroup, flex: 1 }}>
                  <label style={styles.label}>Default price</label>
                  <div style={styles.colorRow}>
                    <span style={styles.unit}>₱</span>
                    <input
                      style={styles.input}
                      type="number"
                      min={0}
                      step="any"
                      value={form.membership_price}
                      onChange={e => update('membership_price', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Perks / benefits</label>
                <textarea
                  style={styles.textarea}
                  rows={6}
                  value={(form.membership_services || []).join('\n')}
                  onChange={e => update(
                    'membership_services',
                    e.target.value.split('\n').map(v => v.trim()).filter(Boolean)
                  )}
                  placeholder={'Unlimited gym access\nLocker use\nFree fitness assessment'}
                />
                <p style={styles.hint}>Enter one perk per line. These appear on the membership card and cashier screen.</p>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Membership terms</label>
                <textarea
                  style={styles.textarea}
                  rows={4}
                  value={form.membership_terms}
                  onChange={e => update('membership_terms', e.target.value)}
                  placeholder="Optional rules, renewal terms, and usage conditions."
                />
              </div>
            </div>
          ) : form.card_type === 'vip' ? (
            <div style={styles.pointsSection}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>VIP points earning rule</label>
                <div style={styles.earnRateRow}>
                  <span style={styles.earnRateText}>Earn</span>
                  <input
                    style={styles.earnRateInput}
                    type="number"
                    min={0}
                    step="any"
                    value={form.vip_points_per_amount}
                    onChange={e => update('vip_points_per_amount', e.target.value)}
                  />
                  <span style={styles.earnRateText}>VIP points for every ₱</span>
                  <input
                    style={styles.earnRateInput}
                    type="number"
                    min={1}
                    step="any"
                    value={form.vip_amount_pesos}
                    onChange={e => update('vip_amount_pesos', e.target.value)}
                  />
                  <span style={styles.earnRateText}>spent</span>
                </div>
                <p style={styles.hint}>
                  Cashiers enter the customer’s purchase amount. VIP points are calculated automatically and are used only for tier progression.
                </p>
              </div>
              <div style={styles.fieldGroup}><label style={styles.label}>VIP tiers</label>{(form.vip_tiers||[]).map((tier,i)=><div key={tier.id||i} style={{...styles.prizeForm,marginBottom:10}}><div style={styles.row}><input style={{...styles.input,flex:1}} value={tier.name} onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,name:e.target.value}:t))} placeholder="Tier name"/><input style={{...styles.input,width:130}} type="number" min={0} value={tier.threshold} onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,threshold:Number(e.target.value)}:t))} placeholder="Points"/><input type="color" style={styles.colorSwatch} value={tier.color||'#64748b'} onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,color:e.target.value}:t))}/></div><div style={styles.row}><input style={{...styles.input,width:150}} type="number" min={0} max={100} value={tier.discount_percent||0} onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,discount_percent:Number(e.target.value)}:t))} placeholder="Discount %"/><textarea style={{...styles.textarea,flex:1}} rows={3} value={(tier.benefits||[]).join('\n')} onChange={e=>update('vip_tiers',form.vip_tiers.map((t,j)=>j===i?{...t,benefits:e.target.value.split('\n').filter(Boolean)}:t))} placeholder="One benefit per line"/><button type="button" onClick={()=>update('vip_tiers',form.vip_tiers.filter((_,j)=>j!==i))} style={styles.prizeRemoveBtn}>✕</button></div></div>)}<button type="button" style={styles.addPrizeBtn} onClick={()=>update('vip_tiers',[...(form.vip_tiers||[]),{id:Math.random().toString(16).slice(2),name:'New Tier',threshold:0,color:'#64748b',discount_percent:0,benefits:[],active:true}])}>+ Add Tier</button><p style={styles.hint}>Thresholds must increase from lowest to highest. VIP points are not spent.</p></div>
            </div>
          ) : form.card_type === 'multipass' ? (
            <div style={styles.pointsSection}>
              <div style={styles.row}>
                <div style={{ ...styles.fieldGroup, flex: 1 }}>
                  <label style={styles.label}>Sessions per pass</label>
                  <input
                    style={styles.input}
                    type="number"
                    min={2}
                    max={200}
                    value={form.multipass_session_count}
                    onChange={e => update('multipass_session_count', e.target.value)}
                  />
                  <p style={styles.hint}>e.g. 12 sessions sold at the price of 10 &mdash; set the total count here, not the price.</p>
                </div>
                <div style={{ ...styles.fieldGroup, width: 130 }}>
                  <label style={styles.label}>Valid for</label>
                  <div style={styles.colorRow}>
                    <input
                      style={styles.input}
                      type="number"
                      min={1}
                      value={form.multipass_validity_days}
                      onChange={e => update('multipass_validity_days', e.target.value)}
                    />
                    <span style={styles.unit}>days</span>
                  </div>
                  <p style={styles.hint}>From the day a pass is issued.</p>
                </div>
              </div>
            </div>
          ) : (
            <div style={styles.pointsSection}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Points earn rate</label>
                <div style={styles.earnRateRow}>
                  <span style={styles.earnRateText}>Customers earn</span>
                  <input
                    style={styles.earnRateInput}
                    type="number"
                    min={0}
                    step="any"
                    value={form.points_per_amount}
                    onChange={e => update('points_per_amount', e.target.value)}
                  />
                  <span style={styles.earnRateText}>points per ₱</span>
                  <input
                    style={styles.earnRateInput}
                    type="number"
                    min={1}
                    step="any"
                    value={form.points_amount_pesos}
                    onChange={e => update('points_amount_pesos', e.target.value)}
                  />
                  <span style={styles.earnRateText}>spent</span>
                </div>
                <p style={styles.hint}>Adjustable any time — a change only affects points earned on transactions going forward.</p>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Points balance cap <span style={{fontWeight:500,color:'#94a3b8'}}>(optional)</span></label>

                <label style={{
                  display:'flex',
                  alignItems:'center',
                  gap:10,
                  fontSize:13,
                  fontWeight:700,
                  color:'#334155',
                  cursor:'pointer'
                }}>
                  <input
                    type="checkbox"
                    checked={form.points_cap_limit !== ''}
                    onChange={e => update('points_cap_limit', e.target.checked ? 500 : '')}
                  />
                  Set a maximum points balance
                </label>

                {form.points_cap_limit !== '' && (
                  <div style={{...styles.row, marginTop:10}}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      type="number"
                      min={1}
                      step={1}
                      value={form.points_cap_limit}
                      onChange={e => update('points_cap_limit', e.target.value)}
                      placeholder="e.g. 500"
                    />
                    <span style={styles.unit}>points max</span>
                  </div>
                )}

                <p style={styles.hint}>
                  {form.points_cap_limit === ''
                    ? 'No cap is enabled. Members can keep earning points without a maximum balance.'
                    : 'Once a member reaches this balance, new purchases stop adding points until they redeem some.'}
                </p>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Prizes to claim with points</label>
                {form.points_prizes.length > 0 && (
                  <div style={styles.prizeList}>
                    {form.points_prizes.map(p => (
                      <div key={p.id} style={styles.prizeRow}>
                        <div>
                          <div style={styles.prizeName}>{p.name}</div>
                          {p.description && <div style={styles.prizeDesc}>{p.description}</div>}
                        </div>
                        <div style={styles.prizeRight}>
                          <span style={styles.prizeCost}>{p.points_cost} pts</span>
                          <button type="button" onClick={() => removePrize(p.id)} style={styles.prizeRemoveBtn}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={styles.prizeForm}>
                  <input
                    style={styles.input}
                    placeholder="Prize name, e.g. Free Coffee"
                    value={prizeDraft.name}
                    onChange={e => setPrizeDraft(d => ({ ...d, name: e.target.value }))}
                  />
                  <div style={styles.row}>
                    <input
                      style={{ ...styles.input, width: 130 }}
                      type="number"
                      min={1}
                      placeholder="Points cost"
                      value={prizeDraft.points_cost}
                      onChange={e => setPrizeDraft(d => ({ ...d, points_cost: e.target.value }))}
                    />
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      placeholder="Description (optional)"
                      value={prizeDraft.description}
                      onChange={e => setPrizeDraft(d => ({ ...d, description: e.target.value }))}
                    />
                  </div>
                  {prizeError && <div style={styles.error}>{prizeError}</div>}
                  <button type="button" onClick={addPrize} style={styles.addPrizeBtn}>+ Add Prize</button>
                </div>
                <p style={styles.hint}>Customers redeem points for whichever prize they can afford — add as many tiers as you like.</p>
              </div>
            </div>
          )}

          <div style={styles.wallet20Box}>
            <div style={styles.wallet20TitleRow}>
              <div>
                <div style={styles.wallet20Eyebrow}>Card Cycle</div>
                <h3 style={styles.wallet20Title}>Card expiration</h3>
              </div>
              <span style={styles.wallet20Badge}>{form.card_expiration_enabled ? 'Enabled' : 'Optional'}</span>
            </div>

            <label style={{display:'flex',gap:10,alignItems:'flex-start',fontSize:13,fontWeight:800,cursor:'pointer',marginBottom:12}}>
              <input
                type="checkbox"
                checked={form.card_expiration_enabled === true}
                onChange={e => update('card_expiration_enabled', e.target.checked)}
                style={{marginTop:2}}
              />
              <span>
                Automatically expire each customer's card
                <span style={{display:'block',fontWeight:500,color:'#64748b',marginTop:4,lineHeight:1.5}}>
                  Each member gets their own cycle starting from enrollment. Turning this on for the first time starts existing members from today.
                </span>
              </span>
            </label>

            {form.card_expiration_enabled && (
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Card valid for</label>
                <div style={{...styles.colorRow,maxWidth:190}}>
                  <input
                    style={styles.input}
                    type="number"
                    min={1}
                    max={3650}
                    value={form.card_validity_days}
                    onChange={e => update('card_validity_days', e.target.value)}
                  />
                  <span style={styles.unit}>days</span>
                </div>
                <p style={styles.hint}>
                  {effectiveLoyaltyType === 'stamp'
                    ? (isHybrid ? 'At expiry, the Hybrid card’s stamp balance resets to 0. Membership expiry remains controlled by the membership subscription dates.' : 'At expiry, stamps reset to 0 and reward milestones become available again in the new cycle.')
                    : effectiveLoyaltyType === 'points'
                    ? (isHybrid ? 'At expiry, the Hybrid card’s points balance resets to 0. Membership expiry remains controlled by the membership subscription dates.' : 'At expiry, the current points balance resets to 0. Purchase/redemption history is kept.')
                    : form.card_type === 'vip'
                    ? 'At expiry, VIP points reset to 0 and the member returns to the starting tier. VIP history is kept.'
                    : form.card_type === 'multipass'
                    ? 'At expiry, the current multi-pass becomes unusable even if sessions remain. A new pass must be issued.'
                    : 'At expiry, the membership becomes EXPIRED and must be renewed or reactivated.'}
                </p>
                <p style={styles.hint}>Changing the number of days affects new/next cycles; it does not wipe current balances when you save.</p>
              </div>
            )}
          </div>

          <div style={styles.wallet20Box}>
            <div style={styles.wallet20TitleRow}>
              <div>
                <div style={styles.wallet20Eyebrow}>Card Design</div>
                <h3 style={styles.wallet20Title}>Make it look like your business</h3>
              </div>
              <span style={styles.wallet20Badge}>Apple + Google</span>
            </div>

            <div style={styles.walletExplain}>
              <strong>One design, both wallets.</strong>
              <span>Choose the look you want once. LoyaltyTree adapts it automatically for Apple Wallet and Google Wallet, so you do not need separate designs.</span>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>1. Choose a look</label>
              <div style={styles.walletStyleGrid}>
                {[
                  ['classic','Classic','One clean brand color'],
                  ['gradient','Gradient','Two brand colors · recommended'],
                  ['premium','Dark Premium','Dark base with your brand color'],
                ].map(([value,label,desc]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => update('wallet_style', value)}
                    style={{...styles.walletStyleBtn,...(walletPreset===value?styles.walletStyleBtnActive:{})}}
                  >
                    <b>{label}</b>
                    <small>{desc}</small>
                  </button>
                ))}
              </div>
              <p style={styles.hint}>Gradient gives the closest matching branded look across the website, Apple Wallet and Google Wallet.</p>
            </div>

            {form.card_type !== 'vip' ? (
              <div style={styles.fieldGroup}>
                <label style={styles.label}>2. Choose your brand colors</label>
                <div style={styles.simpleColorGrid}>
                  <div>
                    <span style={styles.miniLabel}>Main color</span>
                    <div style={styles.colorRow}>
                      <input type="color" style={styles.colorSwatch} value={form.primary_color} onChange={e=>update('primary_color',e.target.value)}/>
                      <input style={{...styles.input,flex:1}} value={form.primary_color} onChange={e=>update('primary_color',e.target.value)}/>
                    </div>
                  </div>
                  {walletPreset === 'gradient' && (
                    <div>
                      <span style={styles.miniLabel}>Accent color</span>
                      <div style={styles.colorRow}>
                        <input type="color" style={styles.colorSwatch} value={form.wallet_secondary_color || '#14b8a6'} onChange={e=>update('wallet_secondary_color',e.target.value)}/>
                        <input style={{...styles.input,flex:1}} value={form.wallet_secondary_color || ''} onChange={e=>update('wallet_secondary_color',e.target.value)}/>
                      </div>
                    </div>
                  )}
                </div>
                <p style={styles.hint}>
                  {walletPreset === 'classic'
                    ? 'Your main color becomes the clean native card color.'
                    : walletPreset === 'premium'
                    ? 'Your main color is blended with a dark premium base.'
                    : 'Main + accent create the two-tone branded header. Native wallet areas use the closest matching main color.'}
                </p>
              </div>
            ) : (
              <div style={styles.vipColorNotice}>
                <strong>VIP colors follow the member's tier.</strong><br/>
                Bronze, Silver, Gold and your custom tiers keep their own main colors. The accent color below gives every tier the same branded two-tone finish.
                {walletPreset === 'gradient' && (
                  <div style={{...styles.colorRow,marginTop:10}}>
                    <input type="color" style={styles.colorSwatch} value={form.wallet_secondary_color || '#111827'} onChange={e=>update('wallet_secondary_color',e.target.value)}/>
                    <input style={{...styles.input,flex:1}} value={form.wallet_secondary_color || ''} onChange={e=>update('wallet_secondary_color',e.target.value)}/>
                  </div>
                )}
              </div>
            )}

            <div style={styles.fieldGroup}>
              <label style={styles.label}>3. Add your logo</label>
              <div style={styles.uploadRow}>
                <input style={styles.input} placeholder="https://..." value={form.program_logo_url} onChange={e=>update('program_logo_url',e.target.value)}/>
                <label style={{...styles.uploadBtn,...(imageUpload.program_logo_url.uploading?styles.uploadBtnDisabled:{})}}>
                  {imageUpload.program_logo_url.uploading?'Uploading…':'📤 Upload logo'}
                  <input type="file" accept="image/*" style={styles.uploadInputHidden} disabled={imageUpload.program_logo_url.uploading} onChange={e=>{uploadImage('program_logo_url',e.target.files[0]);e.target.value=''}}/>
                </label>
              </div>
              {form.program_logo_url && <img src={form.program_logo_url} alt="" style={styles.uploadPreview} onError={e=>{e.target.style.display='none'}}/>}
              {imageUpload.program_logo_url.error && <p style={styles.uploadError}>{imageUpload.program_logo_url.error}</p>}
              <p style={styles.hint}>Use a square or circular logo with a clean background. LoyaltyTree places it appropriately on both wallet cards.</p>
            </div>

            <details style={styles.optionalBranding}>
              <summary>Optional: add a photo banner</summary>
              <div style={{...styles.fieldGroup,marginTop:12}}>
                <div style={styles.uploadRow}>
                  <input style={styles.input} placeholder="https://..." value={form.hero_image_url} onChange={e=>update('hero_image_url',e.target.value)}/>
                  <label style={{...styles.uploadBtn,...(imageUpload.hero_image_url.uploading?styles.uploadBtnDisabled:{})}}>
                    {imageUpload.hero_image_url.uploading?'Uploading…':'📤 Upload photo'}
                    <input type="file" accept="image/*" style={styles.uploadInputHidden} disabled={imageUpload.hero_image_url.uploading} onChange={e=>{uploadImage('hero_image_url',e.target.files[0]);e.target.value=''}}/>
                  </label>
                </div>
                {form.hero_image_url && <img src={form.hero_image_url} alt="" style={styles.uploadPreviewWide} onError={e=>{e.target.style.display='none'}}/>}
                {imageUpload.hero_image_url.error && <p style={styles.uploadError}>{imageUpload.hero_image_url.error}</p>}
                <p style={styles.hint}>Optional. A wide business photo can appear as branded artwork where the wallet platform supports it.</p>
              </div>
            </details>

            <div style={styles.walletPlatformNote}>
              <div><b> Apple Wallet</b><span>Uses your main color plus LoyaltyTree's branded artwork for the closest match.</span></div>
              <div><b>Google Wallet</b><span>Uses your main native color plus the matching branded hero/header treatment.</span></div>
            </div>

            <div style={styles.previewLabel}>Approximate customer view</div>
            <div style={{...styles.wallet20Preview,background:walletPreviewBackground}}>
              {form.hero_image_url && <img src={form.hero_image_url} alt="" style={styles.wallet20PreviewBg}/>}
              <div style={styles.wallet20PreviewShade}/>
              <div style={styles.wallet20PreviewTop}>
                <div style={styles.wallet20PreviewBrand}>
                  {form.program_logo_url?<img src={form.program_logo_url} alt="" style={styles.wallet20PreviewLogo}/>:<span style={styles.wallet20PreviewLogoFallback}>🌳</span>}
                  <div><b>{form.card_name||'Your Business Card'}</b><small>{form.card_type.toUpperCase()}</small></div>
                </div>
                <span style={styles.wallet20PreviewMenu}>•••</span>
              </div>
              <div style={styles.wallet20PreviewBottom}>
                <div style={styles.wallet20PreviewInfo}>
                  <div><small>MEMBER</small><strong>John Customer</strong></div>
                  <div style={styles.wallet20PreviewMetric}>
                    <small>{form.card_type==='hybrid'?(effectiveLoyaltyType==='points'?'POINTS':'STAMPS'):form.card_type==='points'?'POINTS':form.card_type==='multipass'?'SESSIONS LEFT':form.card_type==='membership'?'STATUS':form.card_type==='vip'?'VIP TIER':'STAMPS'}</small>
                    <strong>{form.card_type==='hybrid'?(effectiveLoyaltyType==='points'?'2,850':'5 / 8'):form.card_type==='points'?'2,850':form.card_type==='multipass'?'5 / 10':form.card_type==='membership'?'ACTIVE':form.card_type==='vip'?'GOLD':'5 / 8'}</strong>
                  </div>
                </div>
                <div style={styles.wallet20PreviewQrBox}>
                  <img style={styles.wallet20PreviewQr} alt="QR preview" src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(`${API_BASE}/join/${user?.business_slug||'preview'}`)}`}/>
                </div>
              </div>
              {isHybrid && (
                <div style={{...styles.wallet20ResetPreview,marginBottom:8}}>
                  <span>☕ MEMBERSHIP</span><strong>ACTIVE · {Number(form.membership_duration_days)||30} DAYS</strong>
                </div>
              )}
              {previewResetDate && (
                <div style={styles.wallet20ResetPreview}>
                  <span>🔄 RESET ON</span>
                  <strong>{previewResetDate}</strong>
                </div>
              )}
            </div>
            <p style={styles.hint}>Preview is intentionally approximate: Apple and Google control parts of their native layout. LoyaltyTree keeps your logo, colors and customer information as consistent as each platform allows.</p>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Google review link</label>
            <input
              style={styles.input}
              placeholder="https://g.page/r/..."
              value={form.google_review_url}
              onChange={e => update('google_review_url', e.target.value)}
            />
            <p style={styles.hint}>Growth &amp; Pro plans only &mdash; prompted right after a customer redeems a reward.</p>
          </div>

          <div style={styles.walletStatus}>
            <span>🎫 Google Wallet card</span>
            <span style={{ color: walletClassId ? '#0d9488' : '#94a3b8', fontWeight: 700 }}>
              {walletClassId ? 'Published' : 'Not published yet'}
            </span>
          </div>

          <div style={styles.btnRow}>
            <button
              type="submit"
              style={styles.publishBtn}
              disabled={publishing}
            >
              {publishing ? 'Publishing card...' : (walletClassId ? '🔄 Publish Card Changes' : '🎨 Publish Card')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#0f172a',
    maxWidth: 1000,
    margin: '0 auto',
  },
  loading: {
    textAlign: 'center',
    padding: 60,
    fontSize: 16,
    color: '#64748b',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    margin: '0 0 6px',
    fontSize: 22,
    fontWeight: 800,
    color: '#0f172a',
  },
  subtitle: {
    margin: 0,
    fontSize: 14,
    color: '#64748b',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '300px 1fr',
    gridTemplateAreas: "'preview form'",
    gap: 28,
    alignItems: 'start',
  },
  previewCol: {},
  previewSticky: {
    position: 'sticky',
    top: 20,
  },
  previewLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  card: {
    background: 'white',
    borderRadius: 20,
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(15,23,42,0.12)',
    border: '1px solid #e2e8f0',
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '14px 16px',
    color: 'white',
  },
  cardHeaderTitle: {
    fontWeight: 700,
    fontSize: 15,
  },
  cardHeaderSub: {
    fontSize: 11.5,
    opacity: 0.85,
  },
  cardHero: {
    width: '100%',
    height: 90,
    objectFit: 'cover',
    display: 'block',
  },
  cardBody: {
    padding: 16,
  },
  cardLogo: {
    width: 40,
    height: 40,
    borderRadius: 10,
    objectFit: 'cover',
    marginBottom: 10,
  },
  stampGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(22px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  stampDot: {
    width: '100%',
    aspectRatio: '1',
    borderRadius: '50%',
  },
  cardFoot: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.4,
  },
  cardDescription: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 1.6,
    color: '#475569',
    textAlign: 'center',
    padding: '0 8px',
  },
  cardDescriptionPlaceholder: {
    marginTop: 14,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: '#cbd5e1',
    textAlign: 'center',
    fontStyle: 'italic',
    padding: '0 8px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 24,
  },
  row: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: '#334155',
  },
  input: {
    padding: '11px 14px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    width: '100%',
  },
  textarea: {
    padding: '11px 14px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
    width: '100%',
  },
  hint: {
    margin: 0,
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 1.5,
  },
  uploadRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'stretch',
  },
  uploadBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    color: '#0d9488',
    background: '#f0fdfa',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  uploadBtnDisabled: {
    opacity: 0.6,
    cursor: 'default',
  },
  uploadInputHidden: {
    display: 'none',
  },
  uploadPreview: {
    marginTop: 4,
    width: 64,
    height: 64,
    objectFit: 'cover',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
  },
  uploadPreviewWide: {
    marginTop: 4,
    width: '100%',
    maxHeight: 120,
    objectFit: 'cover',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
  },
  uploadError: {
    margin: 0,
    fontSize: 12,
    color: '#dc2626',
    lineHeight: 1.5,
  },
  colorRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  colorSwatch: {
    width: 44,
    height: 44,
    padding: 0,
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    cursor: 'pointer',
    flexShrink: 0,
  },
  unit: {
    fontSize: 13,
    color: '#64748b',
  },
  pickerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 20,
    maxWidth: 720,
    margin: '0 auto',
  },
  pickerCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    position: 'relative',
    padding: '28px 24px',
    borderRadius: 18,
    border: '2px solid #e2e8f0',
    background: 'white',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: '0 4px 14px rgba(15,23,42,0.05)',
    transition: 'all 0.15s',
  },
  pickerCardIcon: {
    fontSize: 34,
    marginBottom: 4,
  },
  pickerCardLabel: {
    fontSize: 17,
    fontWeight: 800,
    color: '#0f172a',
  },
  pickerCardDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 1.5,
  },
  pickerCardBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    fontSize: 11,
    fontWeight: 700,
    color: '#0f766e',
    background: '#ccfbf1',
    padding: '4px 10px',
    borderRadius: 999,
  },
  pickerContinueBtn: {
    display: 'block',
    margin: '28px auto 0',
    padding: '14px 28px',
    borderRadius: 12,
    border: 'none',
    background: '#0d9488',
    color: 'white',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  typeSummary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  typeSummaryText: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
  },
  typeChangeBtn: {
    background: 'none',
    border: 'none',
    color: '#0d9488',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  pointsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    padding: 16,
    background: '#f8fafc',
    borderRadius: 14,
    border: '1px solid #e2e8f0',
  },
  earnRateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  earnRateText: {
    fontSize: 14,
    color: '#334155',
  },
  earnRateInput: {
    width: 72,
    padding: '10px 10px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    textAlign: 'center',
  },
  prizeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 12,
  },
  prizeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
  },
  prizeName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: '#0f172a',
  },
  prizeDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  prizeRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  prizeCost: {
    fontSize: 13,
    fontWeight: 700,
    color: '#0d9488',
    whiteSpace: 'nowrap',
  },
  prizeRemoveBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    border: 'none',
    background: '#fef2f2',
    color: '#dc2626',
    fontSize: 13,
    cursor: 'pointer',
  },
  prizeForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 14,
    background: 'white',
    border: '1.5px dashed #cbd5e1',
    borderRadius: 12,
  },
  addPrizeBtn: {
    alignSelf: 'flex-start',
    padding: '10px 18px',
    borderRadius: 10,
    border: 'none',
    background: '#0d9488',
    color: 'white',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  previewPointsBalance: {
    fontSize: 26,
    fontWeight: 800,
    color: '#0f172a',
    textAlign: 'center',
    margin: '4px 0 10px',
  },
  previewPrizeList: {
    marginTop: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderTop: '1px solid #f1f5f9',
    paddingTop: 10,
  },
  previewPrizeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#334155',
  },
  previewMoreText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
  vipColorNotice:{margin:'0 0 14px',padding:'11px 13px',borderRadius:10,background:'#f8fafc',border:'1px solid #e2e8f0',color:'#475569',fontSize:12,lineHeight:1.55,fontWeight:600},
  walletExplain:{display:'flex',flexDirection:'column',gap:4,padding:'12px 14px',margin:'12px 0 16px',borderRadius:12,background:'#f8fafc',border:'1px solid #e2e8f0',color:'#475569',fontSize:12,lineHeight:1.55},
  simpleColorGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12},
  miniLabel:{display:'block',fontSize:11,fontWeight:800,color:'#64748b',marginBottom:6},
  optionalBranding:{margin:'4px 0 16px',padding:'12px 14px',border:'1px solid #e2e8f0',borderRadius:12,background:'#fff',color:'#334155',fontSize:12},
  walletPlatformNote:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10,margin:'12px 0 16px'},

    wallet20Box:{border:'1px solid #dbeafe',background:'#f8fbff',borderRadius:16,padding:16,marginBottom:18},
  wallet20TitleRow:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:14},
  wallet20Eyebrow:{fontSize:10.5,fontWeight:900,letterSpacing:.9,textTransform:'uppercase',color:'#2563eb'},
  wallet20Title:{margin:'3px 0 0',fontSize:17,color:'#0f172a'},
  wallet20Badge:{padding:'5px 9px',borderRadius:999,background:'#dbeafe',color:'#1d4ed8',fontSize:10,fontWeight:800},
  walletStyleGrid:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14},
  walletStyleBtn:{padding:'11px 10px',border:'1px solid #cbd5e1',borderRadius:10,background:'#fff',color:'#475569',fontWeight:700,cursor:'pointer',display:'flex',flexDirection:'column',gap:3,textAlign:'left'},
  walletStyleBtnActive:{borderColor:'#2563eb',background:'#eff6ff',color:'#1d4ed8',boxShadow:'0 0 0 2px rgba(37,99,235,.08)'},
  walletToggle:{display:'flex',alignItems:'flex-start',gap:9,flex:1,minWidth:220,padding:'10px 0',color:'#334155',fontSize:12,cursor:'pointer'},
  wallet20Preview:{height:220,borderRadius:18,overflow:'hidden',position:'relative',padding:18,color:'#fff',marginTop:8,boxShadow:'0 18px 40px rgba(15,23,42,.18)'},
  wallet20PreviewBg:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'},
  wallet20PreviewShade:{position:'absolute',inset:0,background:'linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.58))'},
  wallet20PreviewTop:{position:'relative',zIndex:2,display:'flex',justifyContent:'space-between',alignItems:'flex-start'},
  wallet20PreviewBrand:{display:'flex',gap:10,alignItems:'center'},
  wallet20PreviewLogo:{width:40,height:40,borderRadius:10,objectFit:'cover',background:'#fff'},
  wallet20PreviewLogoFallback:{width:40,height:40,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(255,255,255,.16)'},
  wallet20PreviewMenu:{fontWeight:900,letterSpacing:2},
  wallet20PreviewBottom:{position:'absolute',zIndex:2,left:18,right:18,bottom:18,display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:16},
  wallet20PreviewInfo:{display:'flex',flexDirection:'column',gap:12,minWidth:0},
  wallet20PreviewMetric:{},
  wallet20PreviewQrBox:{width:64,height:64,flexShrink:0,background:'#fff',borderRadius:12,padding:6,boxShadow:'0 8px 22px rgba(0,0,0,.28)'},
  wallet20PreviewQr:{display:'block',width:'100%',height:'100%'},
  wallet20ResetPreview:{marginTop:14,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.18)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,fontSize:11,color:'rgba(255,255,255,.72)',letterSpacing:.8,fontWeight:800},
  walletStatus: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    color: '#475569',
    background: '#f8fafc',
    borderRadius: 10,
    padding: '10px 14px',
  },
  btnRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  saveBtn: {
    padding: '13px 20px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    flex: 1,
  },
  publishBtn: {
    padding: '13px 20px',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    flex: 1,
  },
  error: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 13,
  },
  success: {
    background: '#dcfce7',
    color: '#166534',
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
  },
}

export default LoyaltyCardCustomizer

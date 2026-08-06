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
function LoyaltyCardCustomizer({ API_BASE, user, onSaved }) {
  const [form, setForm] = useState({
    card_type: 'stamp', // 'stamp' | 'points' | 'membership' | 'multipass' | 'vip' - one active card at a time
    card_name: '',
    primary_color: '#0d9488',
    reward_name: '',
    stamp_goal: 8,
    reward_expiry_days: 30,
    program_logo_url: '',
    hero_image_url: '',
    description: '',
    google_review_url: '',
    // Points card only
    points_per_amount: 10,
    points_amount_pesos: 100,
    points_prizes: [],
    // Membership card only
    membership_duration_days: 30,
    membership_price: 0,
    membership_services: [],
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
  const [saving, setSaving] = useState(false)
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
  // full editor for whichever type is selected. Always starts on the
  // picker so the owner explicitly confirms the type every time they
  // open the editor, even if one was already saved.
  const [step, setStep] = useState('picker')

  // New-prize draft form (points card)
  const [prizeDraft, setPrizeDraft] = useState({ name: '', points_cost: '', description: '' })
  const [prizeError, setPrizeError] = useState('')

  useEffect(() => {
    fetchConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchConfig = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`)
      const data = await res.json()
      if (res.ok) {
        setForm(f => ({
          ...f,
          card_type: ['stamp', 'points', 'membership', 'multipass', 'vip'].includes(data.card_type) ? data.card_type : 'stamp',
          card_name: data.card_name || '',
          primary_color: data.primary_color || '#0d9488',
          reward_name: data.reward_name || '',
          stamp_goal: data.stamp_goal || 8,
          reward_expiry_days: data.reward_expiry_days || 30,
          program_logo_url: data.program_logo_url || '',
          hero_image_url: data.hero_image_url || '',
          description: data.description || '',
          google_review_url: data.google_review_url || '',
          points_per_amount: data.points_per_amount ?? 10,
          points_amount_pesos: data.points_amount_pesos ?? 100,
          points_prizes: Array.isArray(data.points_prizes) ? data.points_prizes : [],
          membership_duration_days: data.membership_duration_days ?? 30,
          membership_price: data.membership_price ?? 0,
          membership_services: Array.isArray(data.membership_services) ? data.membership_services : [],
          membership_terms: data.membership_terms || '',
          vip_points_per_amount: data.vip_points_per_amount ?? 10,
          vip_amount_pesos: data.vip_amount_pesos ?? 100,
          vip_tiers: Array.isArray(data.vip_tiers) && data.vip_tiers.length ? data.vip_tiers : f.vip_tiers,
          multipass_session_count: data.multipass_session_count ?? 12,
          multipass_validity_days: data.multipass_validity_days ?? 90,
        }))
        setWalletClassId(data.google_wallet_class_id || null)
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
    card_name: form.card_name || null,
    primary_color: form.primary_color,
    reward_name: form.reward_name || 'Free Service',
    stamp_goal: Number(form.stamp_goal) || 8,
    reward_expiry_days: Number(form.reward_expiry_days) || 30,
    program_logo_url: form.program_logo_url || null,
    hero_image_url: form.hero_image_url || null,
    description: form.description || '',
    google_review_url: form.google_review_url || null,
    points_per_amount: Number(form.points_per_amount) || 0,
    points_amount_pesos: Number(form.points_amount_pesos) || 1,
    points_prizes: form.points_prizes,
    membership_duration_days: Number(form.membership_duration_days) || 30,
    membership_price: Number(form.membership_price) || 0,
    membership_services: Array.isArray(form.membership_services) ? form.membership_services : [],
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
    return data
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await postConfig()
      setSaved(true)
      if (onSaved) onSaved()
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err.message || 'Network error')
    }
    setSaving(false)
  }

  const handlePublish = async () => {
    setPublishing(true)
    setError('')
    setSaved(false)
    try {
      await postConfig()
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/wallet-class`, {
        method: 'POST',
        headers: (user?.token ? { 'Authorization': `Bearer ${user.token}` } : {}),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setWalletClassId(data.class_id)
        setSaved(true)
        if (onSaved) onSaved()
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(data.detail ? `Publish failed: ${JSON.stringify(data.detail)}` : 'Publish failed')
      }
    } catch (err) {
      setError(err.message || 'Network error publishing card design')
    }
    setPublishing(false)
  }

  if (loading) {
    return <div style={styles.loading}>Loading your card settings...</div>
  }

  const stampGoal = Math.min(20, Math.max(3, Number(form.stamp_goal) || 8))
  const previewFilled = Math.ceil(stampGoal / 2)
  const multipassSessionCount = Math.min(200, Math.max(2, Number(form.multipass_session_count) || 12))
  const multipassPreviewUsed = Math.ceil(multipassSessionCount / 3)
  const displayName = form.card_name || `${user?.business_name || 'Your Business'} Rewards`

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
          Continue with {form.card_type === 'points' ? 'Points Card' : form.card_type === 'membership' ? 'Membership Card' : form.card_type === 'vip' ? 'VIP Card' : form.card_type === 'multipass' ? 'Multi-Pass' : 'Stamp Card'} →
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
              <div style={{ ...styles.cardHeader, background: form.primary_color || '#0d9488' }}>
                <span style={styles.cardHeaderTitle}>
                  {form.card_type === 'points'
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
                {form.card_type === 'points' ? (
                  <>
                    <div style={styles.previewPointsBalance}>
                      <span style={{ color: form.primary_color || '#0d9488' }}>240</span> pts
                    </div>
                    <div style={styles.cardFoot}>
                      Earn {Number(form.points_per_amount) || 0} pts per ₱{Number(form.points_amount_pesos) || 0} spent
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
                    <div style={styles.previewPointsBalance}><span style={{color:form.primary_color||'#0d9488'}}>GOLD VIP</span></div>
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
                    <div style={styles.cardFoot}>{previewFilled} of {stampGoal} stamps &middot; expires {form.reward_expiry_days || 30} days after earned</div>
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
        <form onSubmit={handleSave} style={{ ...styles.form, gridArea: 'form' }}>
          {error && <div style={styles.error}>{error}</div>}
          {saved && <div style={styles.success}>✓ Saved</div>}

          <div style={styles.typeSummary}>
            <span style={styles.typeSummaryText}>
              {form.card_type === 'points' ? '💎 Points Card' : form.card_type === 'membership' ? '🏋️ Membership Card' : form.card_type === 'vip' ? '👑 VIP Card' : form.card_type === 'multipass' ? '🎫 Multi-Pass' : '🎟️ Stamp Card'}
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
                form.card_type === 'membership'
                  ? 'e.g. Monthly access membership with exclusive perks.'
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

          {form.card_type === 'stamp' ? (
            <div style={styles.row}>
              <div style={{ ...styles.fieldGroup, flex: 1 }}>
                <label style={styles.label}>Reward name</label>
                <input
                  style={styles.input}
                  placeholder="Free Coffee"
                  value={form.reward_name}
                  onChange={e => update('reward_name', e.target.value)}
                  required
                />
              </div>
              <div style={{ ...styles.fieldGroup, width: 110 }}>
                <label style={styles.label}>Stamp goal</label>
                <input
                  style={styles.input}
                  type="number"
                  min={3}
                  max={20}
                  value={form.stamp_goal}
                  onChange={e => update('stamp_goal', e.target.value)}
                />
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

          <div style={styles.row}>
            <div style={{ ...styles.fieldGroup, flex: 1 }}>
              <label style={styles.label}>Card color</label>
              <div style={styles.colorRow}>
                <input
                  type="color"
                  style={styles.colorSwatch}
                  value={form.primary_color}
                  onChange={e => update('primary_color', e.target.value)}
                />
                <input
                  style={{ ...styles.input, flex: 1 }}
                  value={form.primary_color}
                  onChange={e => update('primary_color', e.target.value)}
                />
              </div>
            </div>
            {form.card_type === 'stamp' && (
              <div style={{ ...styles.fieldGroup, width: 150 }}>
                <label style={styles.label}>Reward expiry</label>
                <div style={styles.colorRow}>
                  <input
                    style={styles.input}
                    type="number"
                    min={1}
                    value={form.reward_expiry_days}
                    onChange={e => update('reward_expiry_days', e.target.value)}
                  />
                  <span style={styles.unit}>days</span>
                </div>
              </div>
            )}
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Logo</label>
            <div style={styles.uploadRow}>
              <input
                style={styles.input}
                placeholder="https://..."
                value={form.program_logo_url}
                onChange={e => update('program_logo_url', e.target.value)}
              />
              <label style={{...styles.uploadBtn, ...(imageUpload.program_logo_url.uploading ? styles.uploadBtnDisabled : {})}}>
                {imageUpload.program_logo_url.uploading ? 'Uploading…' : '📤 Upload'}
                <input
                  type="file"
                  accept="image/*"
                  style={styles.uploadInputHidden}
                  disabled={imageUpload.program_logo_url.uploading}
                  onChange={e => { uploadImage('program_logo_url', e.target.files[0]); e.target.value = '' }}
                />
              </label>
            </div>
            {form.program_logo_url && (
              <img src={form.program_logo_url} alt="" style={styles.uploadPreview} onError={e => { e.target.style.display = 'none' }} />
            )}
            {imageUpload.program_logo_url.error && <p style={styles.uploadError}>{imageUpload.program_logo_url.error}</p>}
            <p style={styles.hint}>Square image works best. Shown on the wallet pass and join page. Paste a URL or upload a photo.</p>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Hero / banner image</label>
            <div style={styles.uploadRow}>
              <input
                style={styles.input}
                placeholder="https://..."
                value={form.hero_image_url}
                onChange={e => update('hero_image_url', e.target.value)}
              />
              <label style={{...styles.uploadBtn, ...(imageUpload.hero_image_url.uploading ? styles.uploadBtnDisabled : {})}}>
                {imageUpload.hero_image_url.uploading ? 'Uploading…' : '📤 Upload'}
                <input
                  type="file"
                  accept="image/*"
                  style={styles.uploadInputHidden}
                  disabled={imageUpload.hero_image_url.uploading}
                  onChange={e => { uploadImage('hero_image_url', e.target.files[0]); e.target.value = '' }}
                />
              </label>
            </div>
            {form.hero_image_url && (
              <img src={form.hero_image_url} alt="" style={styles.uploadPreviewWide} onError={e => { e.target.style.display = 'none' }} />
            )}
            {imageUpload.hero_image_url.error && <p style={styles.uploadError}>{imageUpload.hero_image_url.error}</p>}
            <p style={styles.hint}>Wide banner image shown at the top of the Google Wallet pass. Optional. Paste a URL or upload a photo.</p>
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
            <button type="submit" style={styles.saveBtn} disabled={saving || publishing}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={handlePublish}
              style={styles.publishBtn}
              disabled={saving || publishing}
            >
              {publishing ? 'Publishing...' : (walletClassId ? '🔄 Save & re-publish to Wallet' : '🎨 Save & publish to Wallet')}
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

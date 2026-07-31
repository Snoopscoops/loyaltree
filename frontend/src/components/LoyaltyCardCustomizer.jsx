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
    card_type: 'stamp', // 'stamp' | 'points' - a business runs ONE active card at a time
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
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [walletClassId, setWalletClassId] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

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
          card_type: data.card_type === 'points' ? 'points' : 'stamp',
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
  const displayName = form.card_name || `${user?.business_name || 'Your Business'} Rewards`

  return (
    <div style={styles.page}>
      <style>{`
        @media (max-width: 900px) {
          .lc-grid { grid-template-columns: 1fr !important; grid-template-areas: 'preview' 'form' !important; }
          .lc-preview-sticky { position: static !important; }
        }
      `}</style>

      <div style={styles.header}>
        <h2 style={styles.title}>🎨 Customize Your Loyalty Card</h2>
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
                  {form.card_type === 'points' ? 'Points Rewards' : (form.reward_name || 'Free Service')}
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

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Card type</label>
            <div style={styles.typeRow}>
              <button
                type="button"
                onClick={() => update('card_type', 'stamp')}
                style={{
                  ...styles.typeBtn,
                  ...(form.card_type === 'stamp' ? { borderColor: form.primary_color, background: '#f0fdfa' } : {}),
                }}
              >
                <span style={styles.typeBtnIcon}>🎟️</span>
                <span style={styles.typeBtnLabel}>Stamp Card</span>
                <span style={styles.typeBtnDesc}>Collect a stamp per visit</span>
              </button>
              <button
                type="button"
                onClick={() => update('card_type', 'points')}
                style={{
                  ...styles.typeBtn,
                  ...(form.card_type === 'points' ? { borderColor: form.primary_color, background: '#f0fdfa' } : {}),
                }}
              >
                <span style={styles.typeBtnIcon}>💎</span>
                <span style={styles.typeBtnLabel}>Points Card</span>
                <span style={styles.typeBtnDesc}>Earn points per peso spent</span>
              </button>
            </div>
            <p style={styles.hint}>Your business runs one active card at a time. Switching type here changes what customers see.</p>
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
              placeholder="e.g. Collect a stamp on every visit and get a free coffee on us!"
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
            <label style={styles.label}>Logo URL</label>
            <input
              style={styles.input}
              placeholder="https://..."
              value={form.program_logo_url}
              onChange={e => update('program_logo_url', e.target.value)}
            />
            <p style={styles.hint}>Square image works best. Shown on the wallet pass and join page.</p>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Hero / banner image URL</label>
            <input
              style={styles.input}
              placeholder="https://..."
              value={form.hero_image_url}
              onChange={e => update('hero_image_url', e.target.value)}
            />
            <p style={styles.hint}>Wide banner image shown at the top of the Google Wallet pass. Optional.</p>
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
  typeRow: {
    display: 'flex',
    gap: 12,
  },
  typeBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    padding: '14px 16px',
    borderRadius: 12,
    border: '1.5px solid #e2e8f0',
    background: 'white',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s',
  },
  typeBtnIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  typeBtnLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
  },
  typeBtnDesc: {
    fontSize: 12,
    color: '#64748b',
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

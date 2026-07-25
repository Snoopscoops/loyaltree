import React, { useState, useEffect } from 'react'

const DESCRIPTION_LIMIT = 140

// Drop this into OwnerDashboard, e.g.:
//   import LoyaltyCardCustomizer from './LoyaltyCardCustomizer'
//   <LoyaltyCardCustomizer API_BASE={API_BASE} user={user} />
// It reads/writes the same /loyalty-config endpoint main.py already exposes.
function LoyaltyCardCustomizer({ API_BASE, user }) {
  const [form, setForm] = useState({
    card_name: '',
    primary_color: '#0d9488',
    reward_name: '',
    stamp_goal: 8,
    reward_expiry_days: 30,
    program_logo_url: '',
    hero_image_url: '',
    description: '',
    google_review_url: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

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
          card_name: data.card_name || '',
          primary_color: data.primary_color || '#0d9488',
          reward_name: data.reward_name || '',
          stamp_goal: data.stamp_goal || 8,
          reward_expiry_days: data.reward_expiry_days || 30,
          program_logo_url: data.program_logo_url || '',
          hero_image_url: data.hero_image_url || '',
          description: data.description || '',
          google_review_url: data.google_review_url || '',
        }))
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

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { 'Authorization': `Bearer ${user.token}` } : {}),
        },
        body: JSON.stringify({
          card_name: form.card_name || null,
          primary_color: form.primary_color,
          reward_name: form.reward_name || 'Free Service',
          stamp_goal: Number(form.stamp_goal) || 8,
          reward_expiry_days: Number(form.reward_expiry_days) || 30,
          program_logo_url: form.program_logo_url || null,
          hero_image_url: form.hero_image_url || null,
          description: form.description || '',
          google_review_url: form.google_review_url || null,
        })
      })
      const data = await res.json()
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } else {
        setError(data.detail || 'Failed to save changes')
      }
    } catch (err) {
      setError('Network error')
    }
    setSaving(false)
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
                <span style={styles.cardHeaderTitle}>{form.reward_name || 'Free Service'}</span>
                <span style={styles.cardHeaderSub}>{displayName}</span>
              </div>
              {form.hero_image_url ? (
                <img src={form.hero_image_url} alt="" style={styles.cardHero} onError={e => { e.target.style.display = 'none' }} />
              ) : null}
              <div style={styles.cardBody}>
                {form.program_logo_url ? (
                  <img src={form.program_logo_url} alt="" style={styles.cardLogo} onError={e => { e.target.style.display = 'none' }} />
                ) : null}
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

          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
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
  saveBtn: {
    padding: '13px 20px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 4,
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

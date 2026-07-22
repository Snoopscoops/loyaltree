import React, { useState, useEffect } from 'react'

function LoyaltySettings({ API_BASE, businessSlug, onClose, onSave }) {
  const [config, setConfig] = useState({
    stamp_goal: 8,
    reward_name: 'Free Service',
    reward_description: '',
    reward_value_cents: 0,
    stamp_expiry_days: 0,
    reward_expiry_days: 30,
    primary_color: '#0d9488',
    secondary_color: '#0f172a',
    milestone_push: true,
    reward_unlocked_push: true,
    geofence_push: false,
    winback_push: true,
    winback_days: 30,
  })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/loyalty-config`)
      if (res.ok) {
        const data = await res.json()
        setConfig(prev => ({ ...prev, ...data }))
      }
    } catch (err) {
      console.log('No existing config, using defaults')
    }
  }

  const handleChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/loyalty-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      if (res.ok) {
        setSaved(true)
        onSave?.()
        setTimeout(() => setSaved(false), 2000)
      }
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const colors = [
    '#0d9488', '#059669', '#10b981', '#22c55e',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
    '#ec4899', '#f43f5e', '#f97316', '#f59e0b',
    '#ef4444', '#78716c', '#475569', '#0f172a',
  ]

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>🎴 Loyalty Program Settings</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          {/* Stamp Goal */}
          <Section title="Stamp Goal">
            <div style={styles.goalSelector}>
              {[5, 6, 8, 10, 12, 15, 20].map(n => (
                <button
                  key={n}
                  onClick={() => handleChange('stamp_goal', n)}
                  style={{
                    ...styles.goalBtn,
                    background: config.stamp_goal === n ? config.primary_color : '#f1f5f9',
                    color: config.stamp_goal === n ? 'white' : '#475569',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <p style={styles.hint}>Customers need {config.stamp_goal} stamps to unlock a reward</p>
          </Section>

          {/* Reward Settings */}
          <Section title="Reward">
            <div style={styles.inputGroup}>
              <label style={styles.label}>Reward Name</label>
              <input
                value={config.reward_name}
                onChange={e => handleChange('reward_name', e.target.value)}
                style={styles.input}
                placeholder="e.g. Free Massage, 50% Off, Free Coffee"
              />
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Description</label>
              <textarea
                value={config.reward_description}
                onChange={e => handleChange('reward_description', e.target.value)}
                style={styles.textarea}
                placeholder="Describe what the customer gets..."
                rows={3}
              />
            </div>
            <div style={styles.row}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Value ($)</label>
                <input
                  type="number"
                  value={config.reward_value_cents / 100}
                  onChange={e => handleChange('reward_value_cents', Math.round(parseFloat(e.target.value || 0) * 100))}
                  style={styles.input}
                  placeholder="0.00"
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Reward Expires (days)</label>
                <input
                  type="number"
                  value={config.reward_expiry_days}
                  onChange={e => handleChange('reward_expiry_days', parseInt(e.target.value) || 30)}
                  style={styles.input}
                />
              </div>
            </div>
          </Section>

          {/* Brand Colors */}
          <Section title="Brand Colors">
            <div style={styles.colorGrid}>
              {colors.map(c => (
                <button
                  key={c}
                  onClick={() => handleChange('primary_color', c)}
                  style={{
                    ...styles.colorBtn,
                    background: c,
                    border: config.primary_color === c ? '3px solid #0f172a' : '3px solid transparent',
                  }}
                />
              ))}
            </div>
            <div style={styles.previewCard}>
              <div style={{...styles.previewHeader, background: config.primary_color}}>
                <span style={styles.previewEmoji}>🎁</span>
                <span style={styles.previewTitle}>{config.reward_name}</span>
              </div>
              <div style={styles.previewBody}>
                <div style={styles.previewStamps}>
                  {Array.from({length: Math.min(config.stamp_goal, 10)}).map((_, i) => (
                    <div key={i} style={{...styles.previewStamp, background: i < 3 ? config.primary_color : '#e2e8f0'}}>
                      {i < 3 && '⭐'}
                    </div>
                  ))}
                  {config.stamp_goal > 10 && <span style={styles.previewMore}>+{config.stamp_goal - 10}</span>}
                </div>
                <p style={styles.previewText}>{config.stamp_goal - 3} more stamps to unlock!</p>
              </div>
            </div>
          </Section>

          {/* Notifications */}
          <Section title="🔔 Push Notifications">
            <Toggle
              label="Milestone reminders"
              desc="Notify customers at 50%, 75% progress"
              checked={config.milestone_push}
              onChange={v => handleChange('milestone_push', v)}
            />
            <Toggle
              label="Reward unlocked"
              desc="Instant alert when reward is earned"
              checked={config.reward_unlocked_push}
              onChange={v => handleChange('reward_unlocked_push', v)}
            />
            <Toggle
              label="Win-back reminders"
              desc="Re-engage inactive customers"
              checked={config.winback_push}
              onChange={v => handleChange('winback_push', v)}
            />
            {config.winback_push && (
              <div style={styles.nested}>
                <label style={styles.label}>After how many days of inactivity?</label>
                <input
                  type="number"
                  value={config.winback_days}
                  onChange={e => handleChange('winback_days', parseInt(e.target.value) || 30)}
                  style={{...styles.input, width: 100}}
                />
              </div>
            )}
            <Toggle
              label="Geofence alerts"
              desc="Notify when near your business"
              checked={config.geofence_push}
              onChange={v => handleChange('geofence_push', v)}
            />
          </Section>

          {/* Subscription */}
          <Section title="💳 Subscription">
            <div style={styles.planCards}>
              {[
                { id: 'starter', name: 'Starter', price: '$29/mo', features: ['1 location', '100 customers', 'Basic analytics'] },
                { id: 'growth', name: 'Growth', price: '$79/mo', features: ['3 locations', 'Unlimited customers', 'Advanced analytics', 'SMS notifications'] },
                { id: 'pro', name: 'Pro', price: '$199/mo', features: ['Unlimited locations', 'White-label app', 'API access', 'Priority support'] },
              ].map(plan => (
                <div
                  key={plan.id}
                  onClick={() => handleChange('plan', plan.id)}
                  style={{
                    ...styles.planCard,
                    borderColor: config.plan === plan.id ? config.primary_color : '#e2e8f0',
                    background: config.plan === plan.id ? '#f0fdf4' : 'white',
                  }}
                >
                  <div style={styles.planName}>{plan.name}</div>
                  <div style={styles.planPrice}>{plan.price}</div>
                  <ul style={styles.planFeatures}>
                    {plan.features.map((f, i) => <li key={i} style={styles.planFeature}>✓ {f}</li>)}
                  </ul>
                  {config.plan === plan.id && <div style={styles.planBadge}>Current</div>}
                </div>
              ))}
            </div>
          </Section>
        </div>

        <div style={styles.footer}>
          {saved && <span style={styles.savedMsg}>✅ Saved!</span>}
          <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
          <button onClick={handleSave} disabled={loading} style={styles.saveBtn}>
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <div style={styles.toggleRow}>
      <div style={styles.toggleInfo}>
        <div style={styles.toggleLabel}>{label}</div>
        <div style={styles.toggleDesc}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          ...styles.toggleBtn,
          background: checked ? '#0d9488' : '#cbd5e1',
        }}
      >
        <div style={{
          ...styles.toggleKnob,
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
        }} />
      </button>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modal: {
    background: 'white',
    borderRadius: 20,
    width: '100%',
    maxWidth: 640,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e2e8f0',
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: 'none',
    background: '#f1f5f9',
    color: '#64748b',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 24px',
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    margin: '0 0 16px',
  },
  goalSelector: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  goalBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    border: 'none',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    margin: '10px 0 0',
  },
  inputGroup: {
    marginBottom: 14,
    flex: 1,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  row: {
    display: 'flex',
    gap: 12,
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: 8,
    marginBottom: 16,
  },
  colorBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    cursor: 'pointer',
  },
  previewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    maxWidth: 280,
  },
  previewHeader: {
    padding: '16px 20px',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  previewEmoji: {
    fontSize: 24,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: 700,
  },
  previewBody: {
    padding: 20,
    background: 'white',
  },
  previewStamps: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    marginBottom: 10,
  },
  previewStamp: {
    width: 28,
    height: 28,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
  },
  previewMore: {
    fontSize: 12,
    color: '#94a3b8',
    marginLeft: 4,
  },
  previewText: {
    fontSize: 13,
    color: '#64748b',
    margin: 0,
  },
  toggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  toggleInfo: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: '#0f172a',
  },
  toggleDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  toggleBtn: {
    width: 44,
    height: 24,
    borderRadius: 12,
    border: 'none',
    position: 'relative',
    cursor: 'pointer',
    transition: 'background 0.2s',
    flexShrink: 0,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: 'white',
    position: 'absolute',
    top: 2,
    left: 2,
    transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  nested: {
    padding: '12px 0 12px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  planCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  planCard: {
    border: '2px solid #e2e8f0',
    borderRadius: 14,
    padding: 16,
    cursor: 'pointer',
    position: 'relative',
    transition: 'all 0.2s',
  },
  planName: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
  },
  planPrice: {
    fontSize: 20,
    fontWeight: 800,
    color: '#0d9488',
    margin: '4px 0 12px',
  },
  planFeatures: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  planFeature: {
    fontSize: 12,
    color: '#475569',
    padding: '3px 0',
  },
  planBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    background: '#0d9488',
    color: 'white',
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: '0 12px 0 10px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    padding: '16px 24px',
    borderTop: '1px solid #e2e8f0',
  },
  savedMsg: {
    color: '#059669',
    fontSize: 14,
    fontWeight: 500,
    marginRight: 'auto',
  },
  cancelBtn: {
    padding: '10px 20px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    background: 'white',
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '10px 24px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default LoyaltySettings

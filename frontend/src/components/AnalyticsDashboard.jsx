import React, { useState, useEffect } from 'react'

function AnalyticsDashboard({ API_BASE, user }) {
  const [timeRange, setTimeRange] = useState('7d')
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [branchStats, setBranchStats] = useState([])
  const [walletQueue, setWalletQueue] = useState({ jobs: [], pending: 0, failed: 0 })
  const [crmData, setCrmData] = useState({ customers: [], segments: {}, total_customers: 0 })
  const [retentionData, setRetentionData] = useState({})
  const [retentionOps, setRetentionOps] = useState([])
  const [auditTransactions, setAuditTransactions] = useState([])
  const [fraudAlerts, setFraudAlerts] = useState([])
  const [extendedLoading, setExtendedLoading] = useState(true)
  const [extendedError, setExtendedError] = useState('')
  const [retentionSettings, setRetentionSettings] = useState({
    birthday_message: 'Happy birthday from {business_name}! Stop by soon to celebrate with {reward_name}.',
    win_back_message: "It's been a while since your last visit to {business_name} - come back and pick up where you left off!",
    churn_days: 30,
  })
  const [savingRetentionSettings, setSavingRetentionSettings] = useState(false)
  const [retentionSettingsMessage, setRetentionSettingsMessage] = useState('')

  useEffect(() => {
    fetchAnalytics()
  }, [timeRange])

  useEffect(() => {
    // All-time, not scoped to timeRange - this is "which branch is driving
    // activity overall", a separate question from the trend charts above.
    fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches/stamp-counts`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
      .then(res => res.json())
      .then(data => setBranchStats(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [user.business_slug])

  useEffect(() => {
    fetchExtendedAnalytics()
  }, [user.business_slug, user.token])

  const authFetch = (url, options = {}) => {
    const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${user.token}` }
    return fetch(url, { ...options, headers })
  }

  const fetchExtendedAnalytics = async () => {
    if (!user?.business_slug || !user?.token) return
    setExtendedLoading(true)
    setExtendedError('')
    const base = `${API_BASE}/api/v1/business/${user.business_slug}`
    try {
      const [walletRes, crmRes, retentionRes, opportunityRes, auditRes, fraudRes, settingsRes] = await Promise.all([
        authFetch(`${base}/wallet-queue?limit=100`),
        authFetch(`${base}/crm`),
        authFetch(`${base}/retention-analytics?days=90`),
        authFetch(`${base}/retention-opportunities`),
        authFetch(`${base}/transaction-audit?limit=100`),
        authFetch(`${base}/fraud-alerts?hours=24`),
        authFetch(`${base}/retention-settings`),
      ])

      const [wallet, crm, retention, opportunities, audit, fraud, settings] = await Promise.all([
        walletRes.json().catch(() => ({})),
        crmRes.json().catch(() => ({})),
        retentionRes.json().catch(() => ({})),
        opportunityRes.json().catch(() => ({})),
        auditRes.json().catch(() => ({})),
        fraudRes.json().catch(() => ({})),
        settingsRes.json().catch(() => ({})),
      ])

      if (walletRes.ok) setWalletQueue(wallet)
      if (crmRes.ok) setCrmData(crm)
      if (retentionRes.ok) setRetentionData(retention)
      if (opportunityRes.ok) setRetentionOps(Array.isArray(opportunities.opportunities) ? opportunities.opportunities : [])
      if (auditRes.ok) setAuditTransactions(Array.isArray(audit.transactions) ? audit.transactions : [])
      if (fraudRes.ok) setFraudAlerts(Array.isArray(fraud.alerts) ? fraud.alerts : [])
      if (settingsRes.ok) setRetentionSettings(settings)

      const failed = [
        [walletRes, wallet], [crmRes, crm], [retentionRes, retention],
        [opportunityRes, opportunities], [auditRes, audit], [fraudRes, fraud], [settingsRes, settings],
      ].find(([res]) => !res.ok)
      if (failed) setExtendedError(failed[1]?.detail || 'Some extended analytics could not be loaded.')
    } catch (err) {
      setExtendedError('Could not load CRM, Wallet Queue, Retention, or Transaction Security.')
    }
    setExtendedLoading(false)
  }

  const saveRetentionSettings = async () => {
    setSavingRetentionSettings(true)
    setRetentionSettingsMessage('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/retention-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retentionSettings),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save retention messages')
      setRetentionSettings(data)
      setRetentionSettingsMessage('Saved ✓')
      await fetchExtendedAnalytics()
    } catch (err) {
      setRetentionSettingsMessage(err.message || 'Save failed')
    }
    setSavingRetentionSettings(false)
  }

  const fetchAnalytics = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/analytics?range=${timeRange}`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await res.json()
      if (res.ok) {
        setAnalytics(data)
      } else {
        setError(data.detail || 'Failed to load analytics')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  if (loading) return (
    <div style={styles.container}>
      <div style={styles.loading}>Loading analytics...</div>
    </div>
  )

  if (error) return (
    <div style={styles.container}>
      <div style={styles.error}>{error}</div>
    </div>
  )

  if (!analytics) return null

  const { overview, trends, customers, demographics, stamps, rewards, revenue } = analytics
  const isPoints = overview.card_type === 'points'
  const isMultipass = overview.card_type === 'multipass'
  const isMembership = overview.card_type === 'membership'
  const isVip = overview.card_type === 'vip'

  return (
    <div className="an-container" style={styles.container}>
      <style>{`
        @media (max-width: 768px) {
          .an-container { padding: 16px !important; }
          .an-header { flex-direction: column; align-items: stretch !important; gap: 12px !important; margin-bottom: 20px !important; }
          .an-title { font-size: 21px !important; }
          .an-timerange {
            display: flex; flex-wrap: nowrap !important; overflow-x: auto;
            -webkit-overflow-scrolling: touch; padding-bottom: 4px;
            margin: 0 -16px !important; padding-left: 16px; padding-right: 16px;
          }
          .an-timerange::-webkit-scrollbar { display: none; }
          .an-rangebtn { white-space: nowrap; flex-shrink: 0; padding: 9px 14px !important; font-size: 13px !important; }
          .an-overview-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .an-statcard { padding: 14px !important; }
          .an-stat-icon { font-size: 20px !important; }
          .an-statvalue { font-size: 22px !important; }
          .an-charts-row { grid-template-columns: 1fr !important; gap: 12px !important; }
          .an-chart-card { padding: 16px !important; }
          .an-insights-grid { grid-template-columns: 1fr !important; }
          .an-revenue-grid { grid-template-columns: 1fr !important; }
          .an-health-grid { grid-template-columns: 1fr !important; }
          .an-bignumber { font-size: 26px !important; }
          .an-section-title { font-size: 17px !important; margin-bottom: 12px !important; }
          .an-actionbtn { width: 100% !important; padding: 11px 16px !important; }
          .an-module-grid { grid-template-columns: 1fr !important; }
          .an-table-row { grid-template-columns: 1fr !important; gap: 4px !important; }
        }
        @media (max-width: 420px) {
          .an-overview-grid { grid-template-columns: 1fr 1fr !important; }
          .an-title { font-size: 19px !important; }
        }
      `}</style>
      <div className="an-header" style={styles.header}>
        <h1 className="an-title" style={styles.title}>📊 Analytics Dashboard</h1>
        <div className="an-timerange" style={styles.timeRange}>
          {['7d', '30d', '90d', 'all'].map(range => (
            <button
              key={range}
              className="an-rangebtn"
              onClick={() => setTimeRange(range)}
              style={{
                ...styles.rangeBtn,
                background: timeRange === range ? '#0d9488' : '#f1f5f9',
                color: timeRange === range ? 'white' : '#64748b'
              }}
            >
              {range === '7d' ? 'Last 7 Days' : range === '30d' ? 'Last 30 Days' : range === '90d' ? 'Last 90 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="an-overview-grid" style={styles.overviewGrid}>
        <StatCard 
          title="Total Customers" 
          value={overview.total_customers} 
          change={overview.customer_change}
          icon="👥" 
          color="#0d9488"
        />
        <StatCard 
          title="Active Members" 
          value={overview.active_members} 
          change={overview.active_change}
          icon="⭐" 
          color="#3b82f6"
        />
        {isPoints ? (
          <StatCard
            title="Points Issued"
            value={overview.total_points_earned ?? 0}
            change={overview.points_change}
            icon="💎"
            color="#f59e0b"
          />
        ) : (
          <StatCard
            title={isVip ? 'VIP Points Issued' : isMembership ? 'Member Visits' : isMultipass ? 'Sessions Used' : 'Stamps Issued'}
            value={overview.total_stamps}
            change={overview.stamp_change}
            icon={isVip ? '👑' : isMembership ? '✅' : isMultipass ? '🎫' : '🎯'}
            color="#f59e0b"
          />
        )}
        <StatCard 
          title={isVip ? 'Tier Upgrades' : isMembership ? 'Membership Actions' : isMultipass ? 'Packs Completed' : 'Rewards Redeemed'}
          value={overview.total_rewards} 
          change={overview.reward_change}
          icon="🎁" 
          color="#ec4899"
        />
        {isPoints ? (
          <StatCard
            title="Avg. Points/Customer"
            value={overview.active_members ? Math.round(((overview.total_points_earned ?? 0) / overview.active_members) * 10) / 10 : 0}
            change={overview.points_change}
            icon="📈"
            color="#8b5cf6"
          />
        ) : (
          <StatCard
            title={isVip ? 'Avg. VIP Points/Customer' : isMembership ? 'Avg. Visits/Member' : isMultipass ? 'Avg. Sessions/Customer' : 'Avg. Stamps/Customer'}
            value={overview.avg_stamps_per_customer}
            change={overview.avg_change}
            icon="📈"
            color="#8b5cf6"
          />
        )}
        <StatCard 
          title="New Customers" 
          value={overview.new_customers} 
          change={overview.customer_change}
          icon="🆕" 
          color="#10b981"
        />
        {isPoints && (
          <StatCard
            title="Transactions"
            value={overview.total_stamps}
            change={overview.stamp_change}
            icon="🧾"
            color="#0ea5e9"
          />
        )}
      </div>

      {/* Charts Row */}
      <div className="an-charts-row" style={styles.chartsRow}>
        <div className="an-chart-card" style={styles.chartCard}>
          <h3 style={styles.chartTitle}>📈 Customer Growth</h3>
          <LineChart data={trends.customers} color="#0d9488" />
        </div>
        <div className="an-chart-card" style={styles.chartCard}>
          <h3 style={styles.chartTitle}>{isPoints ? '💎 Points Activity' : isMembership ? '✅ Member Visits' : isMultipass ? '🎫 Session Activity' : '🎯 Stamp Activity'}</h3>
          <LineChart data={trends.stamps} color="#f59e0b" />
        </div>
      </div>

      {/* Second Charts Row */}
      <div className="an-charts-row" style={styles.chartsRow}>
        <div className="an-chart-card" style={styles.chartCard}>
          <h3 style={styles.chartTitle}>{isMembership ? '📅 Membership Activity' : isMultipass ? '✅ Packs Completed' : '🎁 Reward Redemptions'}</h3>
          <BarChart data={trends.rewards} color="#ec4899" />
        </div>
        <div className="an-chart-card" style={styles.chartCard}>
          <h3 style={styles.chartTitle}>📅 Activity by Day of Week</h3>
          <Heatmap data={trends.peak_hours} />
        </div>
      </div>

      {/* Customer Insights */}
      <div style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>👥 Customer Insights</h2>
        <div className="an-insights-grid" style={styles.insightsGrid}>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Top Customers</h4>
            {customers.top_customers?.map((c, i) => (
              <div key={i} style={styles.customerRow}>
                <span style={styles.rank}>#{i + 1}</span>
                <span style={styles.customerName}>{c.name}</span>
                <span style={styles.customerStamps}>{c.stamps} {c.metric === 'points_balance' ? 'pts' : c.metric === 'sessions_used' ? 'sessions' : 'stamps'}</span>
              </div>
            ))}
          </div>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Retention Rate</h4>
            <div className="an-bignumber" style={styles.bigNumber}>{customers.retention_rate}%</div>
            <p style={styles.insightDesc}>of customers returned within 30 days</p>
            <div style={styles.retentionBar}>
              <div style={{...styles.retentionFill, width: `${customers.retention_rate}%`}}></div>
            </div>
          </div>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Churn Risk</h4>
            <div className="an-bignumber" style={{...styles.bigNumber, color: '#ef4444'}}>{customers.churn_risk}</div>
            <p style={styles.insightDesc}>customers haven't visited in 30+ days</p>
            <button className="an-actionbtn" style={styles.actionBtn}>Send Win-Back Offer</button>
          </div>
          {demographics?.gender && (() => {
            const g = demographics.gender
            const total = (g.male || 0) + (g.female || 0) + (g.rather_not_say || 0)
            const pct = (n) => total ? Math.round((n / total) * 100) : 0
            const rows = [
              { label: 'Male', value: g.male || 0, color: '#3b82f6' },
              { label: 'Female', value: g.female || 0, color: '#ec4899' },
              { label: 'Rather not say', value: g.rather_not_say || 0, color: '#94a3b8' },
            ]
            return (
              <div style={styles.insightCard}>
                <h4 style={styles.insightTitle}>Gender Breakdown</h4>
                {rows.map(r => (
                  <div key={r.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginBottom: 4 }}>
                      <span>{r.label}</span>
                      <span>{r.value} ({pct(r.value)}%)</span>
                    </div>
                    <div style={styles.retentionBar}>
                      <div style={{ ...styles.retentionFill, width: `${pct(r.value)}%`, background: r.color }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
          {demographics?.age && (() => {
            const a = demographics.age
            const rows = [
              { label: 'Under 18', value: a.under_18 || 0 },
              { label: '18–24', value: a['18_24'] || 0 },
              { label: '25–34', value: a['25_34'] || 0 },
              { label: '35–44', value: a['35_44'] || 0 },
              { label: '45–54', value: a['45_54'] || 0 },
              { label: '55–64', value: a['55_64'] || 0 },
              { label: '65+', value: a['65_plus'] || 0 },
              { label: 'Unknown', value: a.unknown || 0 },
            ]
            const total = rows.reduce((sum, row) => sum + row.value, 0)
            const pct = (n) => total ? Math.round((n / total) * 100) : 0
            const knownRows = rows.filter(row => row.label !== 'Unknown')
            const largestGroup = knownRows.reduce(
              (best, row) => row.value > best.value ? row : best,
              { label: 'No data yet', value: 0 }
            )

            return (
              <div style={styles.insightCard}>
                <div style={{display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', marginBottom:12}}>
                  <div>
                    <h4 style={{...styles.insightTitle, marginBottom:4}}>Age Breakdown</h4>
                    <div style={{fontSize:12, color:'#94a3b8'}}>Based on saved age or birthday</div>
                  </div>
                  {largestGroup.value > 0 && (
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11, color:'#94a3b8'}}>Largest group</div>
                      <strong style={{fontSize:13, color:'#0d9488'}}>{largestGroup.label}</strong>
                    </div>
                  )}
                </div>
                {rows.map(r => (
                  <div key={r.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginBottom: 4 }}>
                      <span>{r.label}</span>
                      <span>{r.value} ({pct(r.value)}%)</span>
                    </div>
                    <div style={styles.retentionBar}>
                      <div style={{
                        ...styles.retentionFill,
                        width: `${pct(r.value)}%`,
                        background: r.label === 'Unknown' ? '#cbd5e1' : '#0d9488',
                      }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Revenue Insights */}
      <div style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>💰 Revenue Impact</h2>
        {revenue.tracked ? (
          <div className="an-revenue-grid" style={styles.revenueGrid}>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>{isPoints ? 'Points-Driven Revenue' : 'Stamp-Driven Revenue'}</h4>
              <div className="an-bignumber" style={styles.bigNumber}>₱{revenue.stamp_revenue}</div>
              <p style={styles.insightDesc}>{isPoints ? 'Revenue from point-earning transactions' : 'Revenue from stamp-earning transactions'}</p>
            </div>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>Reward Cost</h4>
              {revenue.reward_cost != null ? (
                <>
                  <div className="an-bignumber" style={{...styles.bigNumber, color: '#ef4444'}}>${revenue.reward_cost}</div>
                  <p style={styles.insightDesc}>Estimated cost of redeemed rewards</p>
                </>
              ) : (
                <p style={styles.insightDesc}>Not tracked yet — prizes don't currently record a cost.</p>
              )}
            </div>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>Net Program Value</h4>
              {revenue.net_value != null ? (
                <>
                  <div className="an-bignumber" style={{...styles.bigNumber, color: '#10b981'}}>${revenue.net_value}</div>
                  <p style={styles.insightDesc}>Revenue minus reward costs</p>
                </>
              ) : (
                <p style={styles.insightDesc}>Needs reward cost data to calculate.</p>
              )}
            </div>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>Avg. Transaction</h4>
              <div className="an-bignumber" style={styles.bigNumber}>₱{revenue.avg_transaction}</div>
              <p style={styles.insightDesc}>{isPoints ? 'Average spend per point-earning transaction' : 'Average spend per stamp transaction'}</p>
            </div>
          </div>
        ) : (
          <div style={styles.insightCard}>
            <p style={styles.insightDesc}>
              Revenue isn't tracked yet — {isMultipass ? 'issuing or using a pass' : 'stamping and redeeming a reward'} doesn't currently record a dollar
              amount anywhere, so this section can't show real numbers without guessing. Add a transaction
              amount to the {isMultipass ? 'pass' : 'stamp'} flow to unlock this.
            </p>
          </div>
        )}
      </div>

      {/* Program Health */}
      <div style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>🏥 Program Health</h2>
        <div className="an-health-grid" style={styles.healthGrid}>
          <HealthMetric 
            label={isPoints ? 'Prize Eligibility Rate' : isMultipass ? 'Pack Completion Rate' : 'Stamp Completion Rate'}
            value={stamps.completion_rate} 
            target={75}
            color="#f59e0b"
          />
          <HealthMetric 
            label="Reward Redemption Rate" 
            value={rewards.redemption_rate} 
            target={60}
            color="#ec4899"
          />
          <HealthMetric 
            label="Customer Engagement" 
            value={customers.engagement_rate} 
            target={50}
            color="#3b82f6"
          />
          <HealthMetric 
            label="Program Adoption" 
            value={overview.adoption_rate} 
            target={40}
            color="#0d9488"
          />
        </div>
      </div>

      {/* Branch Performance - separate from the aggregate Overview above;
          only worth showing once there's more than one branch to compare */}
      {branchStats.length > 1 && (
        <div style={styles.section}>
          <h2 className="an-section-title" style={styles.sectionTitle}>🏢 Branch Performance</h2>
          <div className="an-insights-grid" style={styles.insightsGrid}>
            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>{isPoints ? 'Transactions by Branch' : isMultipass ? 'Sessions by Branch' : 'Stamps by Branch'}</h4>
              {[...branchStats].sort((a, b) => b.stamp_count - a.stamp_count).map((b, i) => (
                <div key={b.branch_public_id} style={styles.customerRow}>
                  <span style={styles.rank}>#{i + 1}</span>
                  <span style={styles.customerName}>{b.name}</span>
                  <span style={styles.customerStamps}>{b.stamp_count} {b.card_type === 'points' ? 'transactions' : b.card_type === 'multipass' ? 'sessions' : 'stamps'}</span>
                </div>
              ))}
            </div>
            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>{isMultipass ? 'Packs Completed by Branch' : 'Redemptions by Branch'}</h4>
              {[...branchStats].sort((a, b) => b.redemption_count - a.redemption_count).map((b, i) => (
                <div key={b.branch_public_id} style={styles.customerRow}>
                  <span style={styles.rank}>#{i + 1}</span>
                  <span style={styles.customerName}>{b.name}</span>
                  <span style={styles.customerStamps}>{b.redemption_count} {isMultipass ? 'completed' : 'redeemed'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Wallet Queue — operational analytics, not an Owner Dashboard tab */}
      <div id="wallet-queue-analytics" style={styles.section}>
        <div style={styles.moduleHeading}>
          <div>
            <h2 className="an-section-title" style={{...styles.sectionTitle, marginBottom:4}}>👛 Wallet Queue</h2>
            <div style={styles.moduleSub}>Google / Apple wallet synchronization health</div>
          </div>
          <button className="an-actionbtn" style={styles.actionBtn} onClick={fetchExtendedAnalytics}>↻ Refresh</button>
        </div>
        <div className="an-overview-grid" style={styles.overviewGrid}>
          <MiniMetric label="Pending / Processing" value={walletQueue.pending || 0} />
          <MiniMetric label="Failed" value={walletQueue.failed || 0} danger={(walletQueue.failed || 0) > 0} />
          <MiniMetric label="Recent Jobs" value={(walletQueue.jobs || []).length} />
        </div>
        <div style={styles.insightCard}>
          {(walletQueue.jobs || []).length === 0 ? (
            <div style={styles.noData}>No wallet sync jobs yet.</div>
          ) : (walletQueue.jobs || []).slice(0, 12).map(job => (
            <div className="an-table-row" key={job.id} style={styles.analyticsRow}>
              <span><b>#{job.id}</b> · {job.reason || 'wallet update'}</span>
              <span style={styles.mutedText}>{job.status} · {job.attempts || 0}/{job.max_attempts || 5} attempts</span>
              <span style={{...styles.statusPill, ...(job.status === 'failed' ? styles.statusBad : job.status === 'completed' ? styles.statusGood : styles.statusWarn)}}>{job.status}</span>
              {job.last_error && <span style={styles.errorText}>{job.last_error}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* CRM */}
      <div id="crm-analytics" style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>👥 Customer CRM</h2>
        <div className="an-overview-grid" style={styles.overviewGrid}>
          <MiniMetric label="Total CRM Customers" value={crmData.total_customers || (crmData.customers || []).length} />
          {Object.entries(crmData.segments || {}).map(([segment, count]) => (
            <MiniMetric key={segment} label={segment.replaceAll('_', ' ')} value={count} />
          ))}
        </div>
        <div className="an-module-grid" style={styles.moduleGrid}>
          {(crmData.customers || []).slice(0, 30).map(c => (
            <div key={c.public_id} style={styles.insightCard}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'}}>
                <div>
                  <strong style={{color:'#1e293b'}}>{c.name || c.email || 'Customer'}</strong>
                  <div style={styles.mutedText}>{c.email || c.phone || c.public_id}</div>
                </div>
                <span style={styles.statusPill}>{(c.crm?.segment || 'new').replaceAll('_',' ')}</span>
              </div>
              <div style={{marginTop:10,fontSize:13,color:'#475569'}}>
                {c.crm?.total_transactions || 0} transactions · last activity {c.crm?.days_since_last_activity ?? '—'} days ago
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction / Security */}
      <div id="transaction-security-analytics" style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>🛡️ Transaction & Security Analytics</h2>
        <div className="an-overview-grid" style={styles.overviewGrid}>
          <MiniMetric label="Recent Transactions" value={auditTransactions.length} />
          <MiniMetric label="Security Alerts" value={fraudAlerts.length} danger={fraudAlerts.length > 0} />
          <MiniMetric label="Failed Transactions" value={auditTransactions.filter(t => t.status === 'failed').length} danger={auditTransactions.some(t => t.status === 'failed')} />
          <MiniMetric label="Adjustments" value={auditTransactions.filter(t => /adjust|remove|correction|override/i.test(t.action || '')).length} />
        </div>
        <div className="an-charts-row" style={styles.chartsRow}>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Security Alerts — last 24 hours</h4>
            {fraudAlerts.length === 0 ? <div style={styles.noData}>No suspicious activity detected.</div> :
              fraudAlerts.slice(0, 12).map((a, i) => (
                <div key={a.id || i} style={styles.securityAlert}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                    <strong>{a.title || a.type || 'Security alert'}</strong>
                    <span style={{...styles.statusPill,...((a.severity || '').toLowerCase()==='high' ? styles.statusBad : styles.statusWarn)}}>{a.severity || 'review'}</span>
                  </div>
                  <div style={styles.mutedText}>{a.description || a.message || a.detail || 'Review the related transactions.'}</div>
                </div>
              ))}
          </div>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Recent Transaction Audit</h4>
            {auditTransactions.length === 0 ? <div style={styles.noData}>No audit transactions yet.</div> :
              auditTransactions.slice(0, 20).map((t, i) => (
                <div key={t.transaction_id || t.id || i} style={styles.auditRow}>
                  <div>
                    <strong>{(t.action || 'transaction').replaceAll('_',' ')}</strong>
                    <div style={styles.mutedText}>{t.customer_name || t.customer_public_id || 'Customer'} · {t.branch_name || 'Overall'} · {t.staff_name || t.actor_type || 'System'}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span style={{...styles.statusPill,...(t.status==='failed' ? styles.statusBad : styles.statusGood)}}>{t.status || 'success'}</span>
                    <div style={styles.mutedText}>{t.balance_before ?? '—'} → {t.balance_after ?? '—'}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Retention */}
      <div id="retention-analytics" style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>🔁 Retention Analytics</h2>

        <div style={{...styles.insightCard, marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:14}}>
            <div>
              <h4 style={{...styles.insightTitle,marginBottom:4}}>✍️ Automated Message Settings</h4>
              <div style={styles.mutedText}>Businesses can personalize the birthday greeting and churn / win-back message.</div>
            </div>
            <button className="an-actionbtn" style={styles.actionBtn} disabled={savingRetentionSettings} onClick={saveRetentionSettings}>
              {savingRetentionSettings ? 'Saving…' : 'Save Messages'}
            </button>
          </div>

          <label style={styles.editorLabel}>Birthday Greeting</label>
          <textarea
            value={retentionSettings.birthday_message || ''}
            onChange={e=>setRetentionSettings(s=>({...s,birthday_message:e.target.value}))}
            maxLength={500}
            rows={3}
            style={styles.editorTextarea}
          />
          <div style={styles.editorHelp}>Available: {'{business_name}'}, {'{customer_name}'}, {'{reward_name}'}</div>

          <div style={{height:14}} />

          <label style={styles.editorLabel}>Churn / Win-Back Message</label>
          <textarea
            value={retentionSettings.win_back_message || ''}
            onChange={e=>setRetentionSettings(s=>({...s,win_back_message:e.target.value}))}
            maxLength={500}
            rows={3}
            style={styles.editorTextarea}
          />
          <div style={styles.editorHelp}>Available: {'{business_name}'}, {'{customer_name}'}, {'{days_inactive}'}</div>

          <div style={{height:14}} />
          <label style={styles.editorLabel}>Mark Customer as Churn Risk After</label>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <input
              type="number"
              min="7"
              max="365"
              value={retentionSettings.churn_days || 30}
              onChange={e=>setRetentionSettings(s=>({...s,churn_days:Number(e.target.value)}))}
              style={styles.editorNumber}
            />
            <span style={styles.mutedText}>days without loyalty activity</span>
          </div>
          {retentionSettingsMessage && <div style={{marginTop:10,fontSize:13,fontWeight:700,color:retentionSettingsMessage.includes('Saved')?'#166534':'#b91c1c'}}>{retentionSettingsMessage}</div>}
        </div>

        <div className="an-overview-grid" style={styles.overviewGrid}>
          <MiniMetric label="Repeat Customer Rate" value={`${retentionData.repeat_customer_rate || 0}%`} />
          <MiniMetric label="Active ≤30 Days" value={`${retentionData.retention_30_rate || 0}%`} />
          <MiniMetric label="Active ≤60 Days" value={`${retentionData.retention_60_rate || 0}%`} />
          <MiniMetric label="Active ≤90 Days" value={`${retentionData.retention_90_rate || 0}%`} />
          <MiniMetric label="Avg. Days Between Activity" value={retentionData.average_days_between_activity ?? '—'} />
          <MiniMetric label="Retention Opportunities" value={retentionOps.length} />
        </div>
        <div className="an-module-grid" style={styles.moduleGrid}>
          {retentionOps.length === 0 ? <div style={styles.insightCard}><div style={styles.noData}>No retention opportunities detected right now.</div></div> :
            retentionOps.slice(0, 30).map((o, i) => (
              <div key={`${o.customer_public_id || 'customer'}-${i}`} style={styles.insightCard}>
                <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
                  <strong>{o.customer_name || 'Customer'}</strong>
                  <span style={styles.statusPill}>{(o.type || 'retention').replaceAll('_',' ')}</span>
                </div>
                <div style={{...styles.mutedText,marginTop:8}}>{o.suggested_message}</div>
                {o.days_inactive != null && <div style={{fontSize:12,color:'#b45309',marginTop:7}}>{o.days_inactive} days inactive</div>}
              </div>
            ))}
        </div>
      </div>

      {extendedLoading && <div style={styles.moduleNotice}>Loading extended analytics…</div>}
      {extendedError && <div style={{...styles.moduleNotice,color:'#b45309'}}>{extendedError}</div>}

    </div>
  )
}

// Sub-components
function MiniMetric({ label, value, danger = false }) {
  return (
    <div className="an-statcard" style={{...styles.statCard, borderTop:`4px solid ${danger ? '#ef4444' : '#0d9488'}`}}>
      <div className="an-statvalue" style={{...styles.statValue, color: danger ? '#b91c1c' : '#1e293b'}}>{value}</div>
      <div style={styles.statTitle}>{label}</div>
    </div>
  )
}

function StatCard({ title, value, change, icon, color }) {
  const isPositive = change >= 0
  return (
    <div className="an-statcard" style={{...styles.statCard, borderTop: `4px solid ${color}`}}>
      <div style={styles.statHeader}>
        <span className="an-stat-icon" style={styles.statIcon}>{icon}</span>
        <span style={{...styles.change, color: isPositive ? '#10b981' : '#ef4444'}}>
          {isPositive ? '↑' : '↓'} {Math.abs(change)}%
        </span>
      </div>
      <div className="an-statvalue" style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
    </div>
  )
}

function LineChart({ data, color }) {
  if (!data || data.length === 0) return <div style={styles.noData}>No data available</div>

  const max = Math.max(...data.map(d => d.value))
  const min = Math.min(...data.map(d => d.value))
  const range = max - min || 1

  return (
    <div style={styles.chartContainer}>
      <svg viewBox="0 0 300 100" style={styles.svg}>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          points={data.map((d, i) => {
            const x = (i / (data.length - 1)) * 300
            const y = 100 - ((d.value - min) / range) * 80 - 10
            return `${x},${y}`
          }).join(' ')}
        />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * 300
          const y = 100 - ((d.value - min) / range) * 80 - 10
          return <circle key={i} cx={x} cy={y} r="3" fill={color} />
        })}
      </svg>
      <div style={styles.chartLabels}>
        {data.filter((_, i) => i % Math.ceil(data.length / 5) === 0).map((d, i) => (
          <span key={i} style={styles.chartLabel}>{d.label}</span>
        ))}
      </div>
    </div>
  )
}

function BarChart({ data, color }) {
  if (!data || data.length === 0) return <div style={styles.noData}>No data available</div>

  const max = Math.max(...data.map(d => d.value))

  return (
    <div style={styles.chartContainer}>
      <div style={styles.bars}>
        {data.map((d, i) => (
          <div key={i} style={styles.barWrapper}>
            <div style={{
              ...styles.bar,
              height: `${(d.value / max) * 100}%`,
              background: color
            }}></div>
            <span style={styles.barLabel}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heatmap({ data }) {
  if (!data || data.length === 0) return <div style={styles.noData}>No data available</div>

  const max = Math.max(...data.map(d => d.value))

  return (
    <div style={styles.heatmap}>
      {data.map((d, i) => (
        <div key={i} style={styles.heatmapCell}>
          <div style={{
            ...styles.heatmapBlock,
            background: `rgba(13, 148, 136, ${d.value / max})`,
          }} title={`${d.label}: ${d.value} visits`}></div>
          <span style={styles.heatmapLabel}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

function HealthMetric({ label, value, target, color }) {
  const isGood = value >= target
  return (
    <div style={styles.healthCard}>
      <div style={styles.healthHeader}>
        <span style={styles.healthLabel}>{label}</span>
        <span style={{...styles.healthStatus, color: isGood ? '#10b981' : '#f59e0b'}}>
          {isGood ? '✅ Good' : '⚠️ Needs Attention'}
        </span>
      </div>
      <div style={styles.healthBar}>
        <div style={{...styles.healthFill, width: `${Math.min(value, 100)}%`, background: color}}></div>
      </div>
      <div style={styles.healthNumbers}>
        <span style={styles.healthValue}>{value}%</span>
        <span style={styles.healthTarget}>Target: {target}%</span>
      </div>
    </div>
  )
}

const styles = {
  container: {
    padding: 24,
    maxWidth: 1200,
    margin: '0 auto',
    background: '#f8fafc',
    minHeight: '100vh',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    flexWrap: 'wrap',
    gap: 16,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: '#1e293b',
  },
  timeRange: {
    display: 'flex',
    gap: 8,
  },
  rangeBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  statCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  statHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statIcon: {
    fontSize: 24,
  },
  change: {
    fontSize: 13,
    fontWeight: 600,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 4,
  },
  statTitle: {
    fontSize: 13,
    color: '#64748b',
  },
  chartsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 16,
    marginBottom: 24,
  },
  chartCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  chartTitle: {
    margin: '0 0 16px 0',
    fontSize: 16,
    fontWeight: 600,
    color: '#1e293b',
  },
  chartContainer: {
    height: 150,
  },
  svg: {
    width: '100%',
    height: '80%',
  },
  chartLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#94a3b8',
  },
  chartLabel: {
    fontSize: 11,
  },
  noData: {
    textAlign: 'center',
    color: '#94a3b8',
    padding: 40,
    fontSize: 14,
  },
  bars: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: 120,
    gap: 8,
  },
  barWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  bar: {
    width: '100%',
    borderRadius: '4px 4px 0 0',
    transition: 'height 0.5s ease',
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    color: '#94a3b8',
  },
  heatmap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  heatmapCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  heatmapBlock: {
    width: '100%',
    aspectRatio: '1',
    borderRadius: 4,
  },
  heatmapLabel: {
    fontSize: 10,
    color: '#94a3b8',
  },
  section: {
    marginBottom: 24,
  },
  moduleHeading: {
    display:'flex',
    alignItems:'center',
    justifyContent:'space-between',
    gap:12,
    flexWrap:'wrap',
    marginBottom:16,
  },
  moduleSub: {
    fontSize:13,
    color:'#64748b',
  },
  moduleGrid: {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))',
    gap:12,
  },
  analyticsRow: {
    display:'grid',
    gridTemplateColumns:'minmax(180px,1.4fr) minmax(170px,1fr) auto',
    gap:12,
    alignItems:'center',
    padding:'10px 0',
    borderBottom:'1px solid #f1f5f9',
  },
  auditRow: {
    display:'flex',
    justifyContent:'space-between',
    gap:12,
    alignItems:'center',
    padding:'10px 0',
    borderBottom:'1px solid #f1f5f9',
  },
  securityAlert: {
    padding:'11px 0',
    borderBottom:'1px solid #f1f5f9',
  },
  statusPill: {
    display:'inline-block',
    padding:'4px 8px',
    borderRadius:999,
    fontSize:11,
    fontWeight:700,
    textTransform:'capitalize',
    background:'#e2e8f0',
    color:'#475569',
    whiteSpace:'nowrap',
  },
  statusGood: { background:'#dcfce7', color:'#166534' },
  statusWarn: { background:'#fef3c7', color:'#92400e' },
  statusBad: { background:'#fee2e2', color:'#991b1b' },
  mutedText: {
    fontSize:12,
    color:'#64748b',
    marginTop:3,
  },
  errorText: {
    gridColumn:'1 / -1',
    fontSize:12,
    color:'#b91c1c',
  },
  moduleNotice: {
    textAlign:'center',
    padding:12,
    fontSize:13,
    color:'#64748b',
  },
  editorLabel: {
    display:'block',
    fontSize:13,
    fontWeight:700,
    color:'#334155',
    marginBottom:6,
  },
  editorTextarea: {
    width:'100%',
    boxSizing:'border-box',
    border:'1px solid #cbd5e1',
    borderRadius:10,
    padding:'10px 12px',
    fontSize:13,
    color:'#1e293b',
    resize:'vertical',
    fontFamily:'inherit',
  },
  editorNumber: {
    width:100,
    border:'1px solid #cbd5e1',
    borderRadius:9,
    padding:'9px 10px',
    fontSize:14,
  },
  editorHelp: {
    marginTop:5,
    fontSize:11,
    color:'#94a3b8',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 16,
  },
  insightsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 16,
  },
  insightCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  insightTitle: {
    margin: '0 0 12px 0',
    fontSize: 14,
    fontWeight: 600,
    color: '#64748b',
  },
  customerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  rank: {
    fontSize: 12,
    fontWeight: 700,
    color: '#0d9488',
    width: 24,
  },
  customerName: {
    flex: 1,
    fontSize: 14,
    color: '#1e293b',
  },
  customerStamps: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 500,
  },
  bigNumber: {
    fontSize: 36,
    fontWeight: 700,
    color: '#1e293b',
    marginBottom: 4,
  },
  insightDesc: {
    fontSize: 13,
    color: '#64748b',
    margin: '0 0 12px 0',
  },
  retentionBar: {
    height: 8,
    background: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  retentionFill: {
    height: '100%',
    background: '#0d9488',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  actionBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  revenueGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
  },
  revenueCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  healthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 16,
  },
  healthCard: {
    background: 'white',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  healthHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  healthLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1e293b',
  },
  healthStatus: {
    fontSize: 12,
    fontWeight: 600,
  },
  healthBar: {
    height: 8,
    background: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  healthFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  healthNumbers: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
  },
  healthValue: {
    fontWeight: 700,
    color: '#1e293b',
  },
  healthTarget: {
    color: '#94a3b8',
  },
  loading: {
    textAlign: 'center',
    padding: 60,
    fontSize: 16,
    color: '#64748b',
  },
  error: {
    textAlign: 'center',
    padding: 60,
    fontSize: 16,
    color: '#ef4444',
  },
}

export default AnalyticsDashboard

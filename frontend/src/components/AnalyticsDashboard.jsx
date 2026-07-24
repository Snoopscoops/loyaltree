import React, { useState, useEffect } from 'react'

function AnalyticsDashboard({ API_BASE, user }) {
  const [timeRange, setTimeRange] = useState('7d')
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAnalytics()
  }, [timeRange])

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

  const { overview, trends, customers, stamps, rewards, revenue } = analytics

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>📊 Analytics Dashboard</h1>
        <div style={styles.timeRange}>
          {['7d', '30d', '90d', 'all'].map(range => (
            <button
              key={range}
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
      <div style={styles.overviewGrid}>
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
        <StatCard 
          title="Stamps Issued" 
          value={overview.total_stamps} 
          change={overview.stamp_change}
          icon="🎯" 
          color="#f59e0b"
        />
        <StatCard 
          title="Rewards Redeemed" 
          value={overview.total_rewards} 
          change={overview.reward_change}
          icon="🎁" 
          color="#ec4899"
        />
        <StatCard 
          title="Avg. Stamps/Customer" 
          value={overview.avg_stamps_per_customer} 
          change={overview.avg_change}
          icon="📈" 
          color="#8b5cf6"
        />
        <StatCard 
          title="Program ROI" 
          value={`${overview.roi}%`} 
          change={overview.roi_change}
          icon="💰" 
          color="#10b981"
        />
      </div>

      {/* Charts Row */}
      <div style={styles.chartsRow}>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>📈 Customer Growth</h3>
          <LineChart data={trends.customers} color="#0d9488" />
        </div>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>🎯 Stamp Activity</h3>
          <LineChart data={trends.stamps} color="#f59e0b" />
        </div>
      </div>

      {/* Second Charts Row */}
      <div style={styles.chartsRow}>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>🎁 Reward Redemptions</h3>
          <BarChart data={trends.rewards} color="#ec4899" />
        </div>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>⏰ Peak Hours</h3>
          <Heatmap data={trends.peak_hours} />
        </div>
      </div>

      {/* Customer Insights */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>👥 Customer Insights</h2>
        <div style={styles.insightsGrid}>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Top Customers</h4>
            {customers.top_customers?.map((c, i) => (
              <div key={i} style={styles.customerRow}>
                <span style={styles.rank}>#{i + 1}</span>
                <span style={styles.customerName}>{c.name}</span>
                <span style={styles.customerStamps}>{c.stamps} stamps</span>
              </div>
            ))}
          </div>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Retention Rate</h4>
            <div style={styles.bigNumber}>{customers.retention_rate}%</div>
            <p style={styles.insightDesc}>of customers returned within 30 days</p>
            <div style={styles.retentionBar}>
              <div style={{...styles.retentionFill, width: `${customers.retention_rate}%`}}></div>
            </div>
          </div>
          <div style={styles.insightCard}>
            <h4 style={styles.insightTitle}>Churn Risk</h4>
            <div style={{...styles.bigNumber, color: '#ef4444'}}>{customers.churn_risk}</div>
            <p style={styles.insightDesc}>customers haven't visited in 30+ days</p>
            <button style={styles.actionBtn}>Send Win-Back Offer</button>
          </div>
        </div>
      </div>

      {/* Revenue Insights */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>💰 Revenue Impact</h2>
        <div style={styles.revenueGrid}>
          <div style={styles.revenueCard}>
            <h4 style={styles.insightTitle}>Stamp-Driven Revenue</h4>
            <div style={styles.bigNumber}>${revenue.stamp_revenue}</div>
            <p style={styles.insightDesc}>Revenue from stamp-earning transactions</p>
          </div>
          <div style={styles.revenueCard}>
            <h4 style={styles.insightTitle}>Reward Cost</h4>
            <div style={{...styles.bigNumber, color: '#ef4444'}}>${revenue.reward_cost}</div>
            <p style={styles.insightDesc}>Estimated cost of redeemed rewards</p>
          </div>
          <div style={styles.revenueCard}>
            <h4 style={styles.insightTitle}>Net Program Value</h4>
            <div style={{...styles.bigNumber, color: '#10b981'}}>${revenue.net_value}</div>
            <p style={styles.insightDesc}>Revenue minus reward costs</p>
          </div>
          <div style={styles.revenueCard}>
            <h4 style={styles.insightTitle}>Avg. Transaction</h4>
            <div style={styles.bigNumber}>${revenue.avg_transaction}</div>
            <p style={styles.insightDesc}>Average spend per stamp transaction</p>
          </div>
        </div>
      </div>

      {/* Program Health */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>🏥 Program Health</h2>
        <div style={styles.healthGrid}>
          <HealthMetric 
            label="Stamp Completion Rate" 
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
    </div>
  )
}

// Sub-components
function StatCard({ title, value, change, icon, color }) {
  const isPositive = change >= 0
  return (
    <div style={{...styles.statCard, borderTop: `4px solid ${color}`}}>
      <div style={styles.statHeader}>
        <span style={styles.statIcon}>{icon}</span>
        <span style={{...styles.change, color: isPositive ? '#10b981' : '#ef4444'}}>
          {isPositive ? '↑' : '↓'} {Math.abs(change)}%
        </span>
      </div>
      <div style={styles.statValue}>{value}</div>
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
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

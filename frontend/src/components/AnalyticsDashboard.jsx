import React, { useState, useEffect } from 'react'
import InterBranchAnalytics from './InterBranchAnalytics'

function AnalyticsDashboard({ API_BASE, user }) {
  const [timeRange, setTimeRange] = useState('7d')
  const [selectedBranch, setSelectedBranch] = useState('all')
  const [selectedWeekday, setSelectedWeekday] = useState('all')
  const [selectedHour, setSelectedHour] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [walletQueue, setWalletQueue] = useState({ jobs: [], pending: 0, failed: 0 })
  const [crmData, setCrmData] = useState({ customers: [], segments: {}, total_customers: 0 })
  const [retentionData, setRetentionData] = useState({})
  const [retentionOps, setRetentionOps] = useState([])
  const [birthdayData, setBirthdayData] = useState({
    as_of: '',
    counts: { today: 0, this_month: 0, next_7_days: 0, next_30_days: 0, all: 0 },
    customers: [],
    diagnostics: {},
  })
  const [birthdayFilter, setBirthdayFilter] = useState('month')
  const [auditTransactions, setAuditTransactions] = useState([])
  const [fraudAlerts, setFraudAlerts] = useState([])
  const [extendedLoading, setExtendedLoading] = useState(true)
  const [extendedError, setExtendedError] = useState('')
  const [retentionSettings, setRetentionSettings] = useState({
    birthday_message: 'Happy birthday, {first_name}! 🎉 {business_name} wishes you a wonderful day!',
    birthday_enabled: true,
    birthday_send_timing: 'birthday',
    birthday_reward_enabled: false,
    birthday_reward_type: 'custom',
    birthday_reward_name: '',
    birthday_reward_description: '',
    birthday_reward_message: 'Happy birthday, {first_name}! 🎉 Enjoy {reward_name} from {business_name}. Valid until {expiry_date}.',
    birthday_reward_min_membership_days: 30,
    birthday_reward_min_visits: 2,
    birthday_reward_validity_days: 7,
    birthday_reward_staff_verification: false,
    birthday_reward_one_per_year: true,
    win_back_message: "It's been a while since your last visit to {business_name} - come back and pick up where you left off!",
    churn_days: 30,
  })
  const [savingRetentionSettings, setSavingRetentionSettings] = useState(false)
  const [retentionSettingsMessage, setRetentionSettingsMessage] = useState('')
  const [automationStats, setAutomationStats] = useState({ tracking: 'log', birthday: {}, win_back: {}, recent: [] })
  const [redemptionDrilldown, setRedemptionDrilldown] = useState({ open: false, loading: false, error: '', rows: [], total: 0 })
  const [geofence, setGeofence] = useState({ enabled: false, message: "You're near us. Open your LoyaltyTree card.", radius_meters: 150, max_per_day: 1, max_per_week: 3, pins: [], branches: [], limits: { min_radius_meters: 100, max_radius_meters: 1000, max_pins: 10 } })
  const [geofenceStatus, setGeofenceStatus] = useState('')
  const [savingGeofence, setSavingGeofence] = useState(false)

  useEffect(() => {
    fetchAnalytics()
  }, [timeRange, selectedBranch])

  useEffect(() => {
    setSelectedHour(null)
  }, [timeRange, selectedBranch, selectedWeekday])

  useEffect(() => {
    fetchExtendedAnalytics()
    fetchAutomationStats()
    fetchGeofence()
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
      const [walletRes, crmRes, retentionRes, opportunityRes, auditRes, fraudRes, settingsRes, birthdayRes] = await Promise.all([
        authFetch(`${base}/wallet-queue?limit=100`),
        authFetch(`${base}/crm`),
        authFetch(`${base}/retention-analytics?days=90`),
        authFetch(`${base}/retention-opportunities`),
        authFetch(`${base}/transaction-audit?limit=100`),
        authFetch(`${base}/fraud-alerts?hours=24`),
        authFetch(`${base}/retention-settings`),
        authFetch(`${base}/birthday-celebrants`),
      ])

      const [wallet, crm, retention, opportunities, audit, fraud, settings, birthdays] = await Promise.all([
        walletRes.json().catch(() => ({})),
        crmRes.json().catch(() => ({})),
        retentionRes.json().catch(() => ({})),
        opportunityRes.json().catch(() => ({})),
        auditRes.json().catch(() => ({})),
        fraudRes.json().catch(() => ({})),
        settingsRes.json().catch(() => ({})),
        birthdayRes.json().catch(() => ({})),
      ])

      if (walletRes.ok) setWalletQueue(wallet)
      if (crmRes.ok) setCrmData(crm)
      if (retentionRes.ok) setRetentionData(retention)
      if (opportunityRes.ok) setRetentionOps(Array.isArray(opportunities.opportunities) ? opportunities.opportunities : [])
      if (auditRes.ok) setAuditTransactions(Array.isArray(audit.transactions) ? audit.transactions : [])
      if (fraudRes.ok) setFraudAlerts(Array.isArray(fraud.alerts) ? fraud.alerts : [])
      if (settingsRes.ok) setRetentionSettings(settings)
      if (birthdayRes.ok) setBirthdayData({
        as_of: birthdays.as_of || '',
        counts: birthdays.counts || { today: 0, this_month: 0, next_7_days: 0, next_30_days: 0, all: 0 },
        customers: Array.isArray(birthdays.customers) ? birthdays.customers : [],
        diagnostics: birthdays.diagnostics || {},
      })

      const failed = [
        [walletRes, wallet], [crmRes, crm], [retentionRes, retention],
        [opportunityRes, opportunities], [auditRes, audit], [fraudRes, fraud], [settingsRes, settings], [birthdayRes, birthdays],
      ].find(([res]) => !res.ok)
      if (failed) setExtendedError(failed[1]?.detail || 'Some extended analytics could not be loaded.')
    } catch (err) {
      setExtendedError('Could not load CRM, Wallet Queue, Retention, or Transaction Security.')
    }
    setExtendedLoading(false)
  }

  const fetchAutomationStats = async () => {
    if (!user?.business_slug || !user?.token) return
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/automation-stats`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setAutomationStats(data)
    } catch (err) { /* stats are optional; leave previous numbers */ }
  }


  const fetchGeofence = async () => {
    if (!user?.business_slug || !user?.token) return
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      setGeofence({
        enabled: !!data.enabled,
        message: data.message || "You're near us. Open your LoyaltyTree card.",
        radius_meters: data.radius_meters || 150,
        max_per_day: data.max_per_day || 1,
        max_per_week: data.max_per_week || 3,
        pins: Array.isArray(data.pins) ? data.pins : [],
        branches: Array.isArray(data.branches) ? data.branches : [],
        limits: data.limits || { min_radius_meters: 100, max_radius_meters: 1000, max_pins: 10 },
      })
    } catch (err) { /* nearby settings are optional until the column exists */ }
  }

  const saveGeofence = async () => {
    setSavingGeofence(true)
    setGeofenceStatus('')
    try {
      const res = await authFetch(`${API_BASE}/api/v1/business/${user.business_slug}/geofence`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !!geofence.enabled,
          message: geofence.message,
          radius_meters: Number(geofence.radius_meters),
          max_per_day: Number(geofence.max_per_day),
          max_per_week: Number(geofence.max_per_week),
          pins: (geofence.pins || []).map(pin => ({
            branch_public_id: pin.branch_public_id || null,
            label: pin.label || '',
            message: pin.message || geofence.message || '',
            latitude: Number(pin.latitude),
            longitude: Number(pin.longitude),
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save nearby notification')
      setGeofence(current => ({ ...current, ...data, branches: data.branches || current.branches, limits: data.limits || current.limits }))
      setGeofenceStatus('Saved. Customers need an updated Wallet pass before the new pin is on their card.')
    } catch (err) {
      setGeofenceStatus(err.message || 'Save failed')
    }
    setSavingGeofence(false)
  }

  const updateGeofencePin = (index, patch) => setGeofence(current => ({
    ...current,
    pins: current.pins.map((pin, i) => i === index ? { ...pin, ...patch } : pin),
  }))

  const useGeofenceLocation = (index) => {
    if (!navigator.geolocation) {
      setGeofenceStatus('This browser cannot read the current location.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => updateGeofencePin(index, { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) }),
      () => setGeofenceStatus('Location permission was denied. Enter the pin manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
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

  const openRedemptionDrilldown = async () => {
    setRedemptionDrilldown({ open: true, loading: true, error: '', rows: [], total: 0 })
    try {
      const base = `${API_BASE}/api/v1/business/${user.business_slug}`
      const branchQuery = selectedBranch !== 'all' ? `&branch_id=${encodeURIComponent(selectedBranch)}` : ''
      const res = await authFetch(`${base}/analytics/redemptions?range=${encodeURIComponent(timeRange)}${branchQuery}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load redemption details')
      setRedemptionDrilldown({
        open: true,
        loading: false,
        error: '',
        rows: Array.isArray(data.redemptions) ? data.redemptions : [],
        total: Number(data.total || 0),
      })
    } catch (err) {
      setRedemptionDrilldown({ open: true, loading: false, error: err.message || 'Could not load redemption details', rows: [], total: 0 })
    }
  }

  const closeRedemptionDrilldown = () => setRedemptionDrilldown(current => ({ ...current, open: false }))

  const fetchAnalytics = async () => {
    setLoading(true)
    try {
      const branchQuery = selectedBranch !== 'all' ? `&branch_id=${encodeURIComponent(selectedBranch)}` : ''
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/analytics?range=${timeRange}${branchQuery}`, {
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

  const {
    overview, trends, customers, demographics, stamps, rewards, revenue,
    scope = {}, branches = [], branch_performance = [], time_analytics = {},
  } = analytics
  const birthdayRows = (birthdayData.customers || []).filter(c => {
    if (birthdayFilter === 'all') return true
    if (birthdayFilter === 'today') return c.is_today
    if (birthdayFilter === '7d') return Number(c.days_until) >= 0 && Number(c.days_until) <= 7
    if (birthdayFilter === '30d') return Number(c.days_until) >= 0 && Number(c.days_until) <= 30
    return c.in_this_month
  })
  const birthdayFilterLabel =
    birthdayFilter === 'all' ? 'All Saved Birthdays' :
    birthdayFilter === 'today' ? 'Today' :
    birthdayFilter === '7d' ? 'Next 7 Days' :
    birthdayFilter === '30d' ? 'Next 30 Days' : 'This Month'
  const isPoints = overview.card_type === 'points'
  const isMultipass = overview.card_type === 'multipass'
  const isMembership = overview.card_type === 'membership'
  const isVip = overview.card_type === 'vip'
  const branchScoped = scope?.branch_filtered === true
  const branchScopeName = scope?.branch_name || ''
  const timeWeekdays = Array.isArray(time_analytics?.weekdays) ? time_analytics.weekdays : []
  const allHourRows = Array.isArray(time_analytics?.hours) ? time_analytics.hours : []
  const selectedWeekdayRow = selectedWeekday === 'all'
    ? null
    : timeWeekdays.find(row => String(row.day) === String(selectedWeekday))
  const displayedHourRows = selectedWeekdayRow?.hours || allHourRows
  const busiestHour = [...displayedHourRows].sort((a,b) => {
    const aPrimary = time_analytics?.sales_tracked ? Number(a.sales_count || 0) : Number(a.activity_count || 0)
    const bPrimary = time_analytics?.sales_tracked ? Number(b.sales_count || 0) : Number(b.activity_count || 0)
    return bPrimary - aPrimary
  })[0] || null
  const effectiveSelectedHour = selectedHour == null ? busiestHour?.hour : selectedHour
  const selectedTimeRow = displayedHourRows.find(row => Number(row.hour) === Number(effectiveSelectedHour)) || busiestHour || null
  const timeHasData = displayedHourRows.some(row =>
    Number(row.activity_count || 0) > 0 || Number(row.sales_count || 0) > 0 || Number(row.reward_count || 0) > 0
  )
  const demographicWindowAnalytics = time_analytics?.demographic_windows || {}
  const ageWindowStart = effectiveSelectedHour == null
    ? null
    : Math.floor(Number(effectiveSelectedHour) / Number(demographicWindowAnalytics.bucket_hours || 2)) * Number(demographicWindowAnalytics.bucket_hours || 2)
  const selectedAgeWeekday = selectedWeekday === 'all'
    ? null
    : (Array.isArray(demographicWindowAnalytics.weekdays) ? demographicWindowAnalytics.weekdays : [])
        .find(row => String(row.day) === String(selectedWeekday))
  const selectedAgeWindow = ageWindowStart == null
    ? null
    : (selectedAgeWeekday?.windows || demographicWindowAnalytics.hours || [])
        .find(row => Number(row.start_hour) === Number(ageWindowStart)) || null
  const selectedAgeCounts = selectedAgeWindow?.age || null
  const timeAgeRows = selectedAgeCounts ? [
    ['Under 18', selectedAgeCounts.under_18],
    ['18–24', selectedAgeCounts['18_24']],
    ['25–34', selectedAgeCounts['25_34']],
    ['35–44', selectedAgeCounts['35_44']],
    ['45–54', selectedAgeCounts['45_54']],
    ['55–64', selectedAgeCounts['55_64']],
    ['65+', selectedAgeCounts['65_plus']],
  ].filter(([,value]) => value != null) : []
  const selectedGenderCounts = selectedAgeWindow?.gender || null
  const timeGenderRows = selectedGenderCounts ? [
    ['Female', selectedGenderCounts.female],['Male', selectedGenderCounts.male],['LGBTQ+', selectedGenderCounts.lgbtq],['Prefer not to say', selectedGenderCounts.rather_not_say],
  ].filter(([,value]) => value != null) : []

  // Keep the default owner view concise. Deeper metrics remain available in
  // Customers / Activity / Reports instead of competing for attention at once.
  const posEnhanced = Boolean(
    analytics?.pos_integrated || analytics?.pos?.connected || analytics?.pos_connected ||
    String(analytics?.data_source || '').toLowerCase().includes('pos')
  )
  const dataSourceLabel = posEnhanced ? 'Loyalty Tree + POS' : 'Loyalty Tree Activity'
  const dataSourceDescription = posEnhanced
    ? 'Enhanced transaction and loyalty analytics'
    : 'Based on card joins, loyalty activity, redemptions and membership activity — not claimed as sales.'
  const scopeDescription = branchScoped
    ? `${branchScopeName} · customers are counted here when they have recorded activity at this branch.`
    : 'All branches combined.'

  const peakActivityRows = Array.isArray(trends?.peak_hours) ? trends.peak_hours.filter(row => row && Number.isFinite(Number(row.value))) : []
  const sortedPeakActivity = [...peakActivityRows].sort((a,b) => Number(b.value || 0) - Number(a.value || 0))
  const peakActivity = sortedPeakActivity[0] || null
  const quietActivity = sortedPeakActivity.length ? sortedPeakActivity[sortedPeakActivity.length - 1] : null

  const ageRows = demographics?.age ? [
    ['Under 18', demographics.age.under_18],['18–24', demographics.age['18_24']],['25–34', demographics.age['25_34']],
    ['35–44', demographics.age['35_44']],['45–54', demographics.age['45_54']],['55–64', demographics.age['55_64']],['65+', demographics.age['65_plus']],
  ].filter(([,value]) => value != null) : []
  const largestAgeGroup = ageRows.reduce((best,row) => Number(row[1]) > Number(best?.[1] || 0) ? row : best, null)

  const genderRows = demographics?.gender ? [
    ['Female', demographics.gender.female],['Male', demographics.gender.male],['LGBTQ+', demographics.gender.lgbtq],['Prefer not to say', demographics.gender.rather_not_say],
  ].filter(([,value]) => value != null) : []
  const demographicPrivacy = demographics?.privacy || {}
  const joinerDemographics = analytics?.joiner_demographics || {}
  const joinerPrivacy = joinerDemographics?.privacy || {}
  const joinerDailyRows = Array.isArray(joinerDemographics?.daily) ? joinerDemographics.daily : []
  const joinerAgeRows = joinerDemographics?.age ? [
    ['Under 18', joinerDemographics.age.under_18],['18–24', joinerDemographics.age['18_24']],['25–34', joinerDemographics.age['25_34']],
    ['35–44', joinerDemographics.age['35_44']],['45–54', joinerDemographics.age['45_54']],['55–64', joinerDemographics.age['55_64']],['65+', joinerDemographics.age['65_plus']],
  ].filter(([,value]) => value != null) : []
  const joinerGenderRows = joinerDemographics?.gender ? [
    ['Female', joinerDemographics.gender.female],['Male', joinerDemographics.gender.male],['LGBTQ+', joinerDemographics.gender.lgbtq],['Prefer not to say', joinerDemographics.gender.rather_not_say],
  ].filter(([,value]) => value != null) : []
  const topJoinerAge = joinerAgeRows.reduce((best,row) => Number(row[1] || 0) > Number(best?.[1] || 0) ? row : best, null)
  const topJoinerGender = joinerGenderRows.reduce((best,row) => Number(row[1] || 0) > Number(best?.[1] || 0) ? row : best, null)
  const joinerRangeLabel = timeRange === '7d' ? 'Last 7 Days' : timeRange === '30d' ? 'Last 30 Days' : timeRange === '90d' ? 'Last 90 Days' : 'All Time'
  const joinerMixText = (counts, kind) => {
    if (!counts) return 'Below privacy threshold'
    const rows = kind === 'age'
      ? [['Under 18',counts.under_18],['18–24',counts['18_24']],['25–34',counts['25_34']],['35–44',counts['35_44']],['45–54',counts['45_54']],['55–64',counts['55_64']],['65+',counts['65_plus']]]
      : [['Female',counts.female],['Male',counts.male],['LGBTQ+',counts.lgbtq],['Prefer not to say',counts.rather_not_say]]
    const visible = rows.filter(([,value]) => value != null && Number(value) > 0)
    return visible.length ? visible.map(([label,value]) => `${label}: ${Number(value).toLocaleString()}`).join(' · ') : 'No visible demographic cells'
  }

  // Location reporting intentionally uses only aggregate city/municipality/barangay
  // fields when present. Raw street addresses are never surfaced in Analytics.
  const areaCounts = {}
  ;(crmData.customers || []).forEach(c => {
    const area = [
      c.city, c.municipality, c.customer_city, c.customer_municipality,
      c.address_city, c.address_municipality, c.address?.city, c.address?.municipality,
      c.barangay, c.address_barangay, c.address?.barangay,
    ].find(value => String(value || '').trim())
    if (!area) return
    const label = String(area).trim()
    areaCounts[label] = (areaCounts[label] || 0) + 1
  })
  const locationPrivacyMinimum = 5
  const areaEntries = Object.entries(areaCounts).sort((a,b) => b[1] - a[1])
  const topAreas = areaEntries.filter(([,count]) => Number(count) >= locationPrivacyMinimum).slice(0,5)
  const hiddenSmallAreaCount = areaEntries.filter(([,count]) => Number(count) < locationPrivacyMinimum).reduce((sum,[,count]) => sum + Number(count || 0), 0)
  if (hiddenSmallAreaCount >= locationPrivacyMinimum && topAreas.length < 5) topAreas.push(['Other / small groups', hiddenSmallAreaCount])
  const demographicsSafeToShow = Boolean(demographicPrivacy.age_available || demographicPrivacy.gender_available)

  const headlineActivity = isPoints
    ? Number(overview.total_stamps || 0)
    : Number(overview.total_stamps || 0)
  const headlineActivityLabel = isPoints ? 'Transactions / Point Activity' : isMembership ? 'Member Visits' : isMultipass ? 'Sessions Used' : isVip ? 'Tier Activity' : 'Stamps Issued'

  const insightItems = []
  if (peakActivity) insightItems.push({
    icon:'⏰',
    title:`Peak activity: ${peakActivity.label}`,
    text:`${Number(peakActivity.value || 0).toLocaleString()} recorded Loyalty Tree activit${Number(peakActivity.value || 0) === 1 ? 'y' : 'ies'} in this peak period.`,
  })
  if (Number(customers?.retention_rate || 0) > 0) insightItems.push({
    icon:'🔁',
    title:`${Number(customers.retention_rate || 0)}% 30-day retention`,
    text:'This is the share of customers who returned within 30 days.',
  })
  if (Number(customers?.churn_risk || 0) > 0) insightItems.push({
    icon:'⚠️',
    title:`${Number(customers.churn_risk || 0).toLocaleString()} customers may need a win-back`,
    text:'These customers have no recorded loyalty activity for 30+ days.',
  })
  if (largestAgeGroup && Number(largestAgeGroup[1]) > 0) insightItems.push({
    icon:'👥',
    title:`Largest saved age group: ${largestAgeGroup[0]}`,
    text:`${Number(largestAgeGroup[1]).toLocaleString()} customer profiles currently fall in this privacy-safe visible age band.`,
  })
  if (!posEnhanced) insightItems.push({
    icon:'ℹ️',
    title:'Activity analytics, not sales analytics',
    text:'Connect a supported POS to unlock stronger revenue, average-order and sales-by-time insights.',
  })

  const suggestedActions = []
  if (Number(customers?.churn_risk || 0) > 0) suggestedActions.push({
    title:`Review ${Number(customers.churn_risk || 0).toLocaleString()} at-risk customers`,
    detail:'Use win-back messaging for customers with 30+ days of inactivity.',
    action:'Review retention',
    onClick:()=>{ setActiveTab('activity'); setAdvancedOpen(true) },
  })
  if (Number(birthdayData.counts?.next_30_days || 0) > 0) suggestedActions.push({
    title:`${Number(birthdayData.counts.next_30_days).toLocaleString()} birthdays in the next 30 days`,
    detail:'Review upcoming celebrants and birthday reward eligibility.',
    action:'View customers',
    onClick:()=>setActiveTab('customers'),
  })
  if (retentionOps.length > 0) suggestedActions.push({
    title:`${retentionOps.length.toLocaleString()} retention opportunities detected`,
    detail:'Loyalty Tree found customers who may benefit from a timely follow-up.',
    action:'Review opportunities',
    onClick:()=>{ setActiveTab('activity'); setAdvancedOpen(true) },
  })
  if (quietActivity && peakActivity && Number(quietActivity.value || 0) < Number(peakActivity.value || 0) * .6) suggestedActions.push({
    title:`Consider an off-peak offer around ${quietActivity.label}`,
    detail:'Recorded activity is materially lower here than the current peak period.',
    action:'View activity',
    onClick:()=>setActiveTab('activity'),
  })

  const reportRangeLabel = 'Last 7 Days'
  const reportDate = new Date().toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})
  const escapeReportHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]))
  const printableReportHtml = () => {
    const metricRows = [
      ['Total customers', overview.total_customers ?? 0],
      ['Active members', overview.active_members ?? 0],
      ['New customers', overview.new_customers ?? 0],
      [headlineActivityLabel, headlineActivity],
      ['Rewards / redemptions', overview.total_rewards ?? 0],
      ['30-day retention', `${customers?.retention_rate || 0}%`],
    ]
    const ageHtml = demographicPrivacy.age_available && ageRows.length ? ageRows.map(([label,value])=>`<tr><td>${escapeReportHtml(label)}</td><td>${Number(value||0).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="2">No saved age data yet.</td></tr>'
    const genderHtml = demographicPrivacy.gender_available && genderRows.length ? genderRows.map(([label,value])=>`<tr><td>${escapeReportHtml(label)}</td><td>${Number(value||0).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="2">Not enough saved gender data to show a private aggregate yet.</td></tr>'
    const areaHtml = topAreas.length ? topAreas.map(([label,value])=>`<tr><td>${escapeReportHtml(label)}</td><td>${Number(value||0).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="2">No aggregate city / municipality data yet.</td></tr>'
    const insightsHtml = insightItems.slice(0,5).map(item=>`<li><strong>${escapeReportHtml(item.title)}</strong><br><span>${escapeReportHtml(item.text)}</span></li>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>Loyalty Tree Weekly Report</title><style>body{font-family:Arial,sans-serif;color:#0f172a;margin:38px;line-height:1.5}h1{margin:0}h2{margin-top:28px;border-bottom:1px solid #e2e8f0;padding-bottom:7px}small,.muted{color:#64748b}table{width:100%;border-collapse:collapse;margin:10px 0 18px}td{padding:8px 6px;border-bottom:1px solid #f1f5f9}td:last-child{text-align:right;font-weight:700}.source{display:inline-block;padding:6px 10px;border-radius:999px;background:#ecfdf5;color:#047857;font-weight:700}li{margin:9px 0}.footer{margin-top:34px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b}@media print{body{margin:18mm}.no-print{display:none}}</style></head><body><h1>Loyalty Tree Weekly Report</h1><div class="muted">${escapeReportHtml(reportRangeLabel)} · Generated ${escapeReportHtml(reportDate)}</div><p><span class="source">Data source: ${escapeReportHtml(dataSourceLabel)}</span></p><h2>Weekly Summary</h2><table>${metricRows.map(([a,b])=>`<tr><td>${escapeReportHtml(a)}</td><td>${escapeReportHtml(b)}</td></tr>`).join('')}</table><h2>Customer Demographics</h2><h3>Age</h3><table>${ageHtml}</table><h3>Gender</h3><table>${genderHtml}</table><h3>Top Customer Areas</h3><table>${areaHtml}</table><h2>Peak Activity</h2><p><strong>${escapeReportHtml(peakActivity?.label || 'No peak activity available')}</strong>${peakActivity ? ` · ${Number(peakActivity.value||0).toLocaleString()} recorded activities` : ''}</p><h2>Insights & Suggestions</h2><ul>${insightsHtml || '<li>No suggestions available yet.</li>'}</ul><div class="footer">${escapeReportHtml(dataSourceDescription)} Individual street addresses are not included in demographic reporting.</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`
  }
  const printWeeklyReport = () => {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.open()
    win.document.write(printableReportHtml())
    win.document.close()
  }

  const selectTab = tab => {
    setActiveTab(tab)
    if (tab === 'interbranch' && selectedBranch !== 'all') setSelectedBranch('all')
    if (tab === 'reports' && timeRange !== '7d') setTimeRange('7d')
  }

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
          .an-tabs { width:100%; overflow-x:auto; flex-wrap:nowrap !important; -webkit-overflow-scrolling:touch; }
          .an-tabs::-webkit-scrollbar { display:none; }
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
          .an-header select { width: 100% !important; min-width: 0 !important; }
        }
        @media (max-width: 420px) {
          .an-overview-grid { grid-template-columns: 1fr 1fr !important; }
          .an-title { font-size: 19px !important; }
        }
      `}</style>
      <div className="an-header" style={styles.header}>
        <div>
          <h1 className="an-title" style={styles.title}>📊 Analytics Dashboard</h1>
          <div style={{...styles.mutedText,marginTop:4}}>{scopeDescription}</div>
        </div>
        <div style={styles.analyticsHeaderControls}>
          {activeTab !== 'interbranch' && Array.isArray(branches) && branches.length > 0 && (
            <label style={styles.branchFilterLabel}>
              <span style={styles.miniLabel}>Branch</span>
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                style={styles.branchSelect}
              >
                <option value="all">All Branches</option>
                {branches.map(branch => (
                  <option key={branch.public_id} value={branch.public_id}>
                    {branch.name}{branch.is_active === false ? ' (Inactive)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {activeTab === 'reports' ? (
            <div style={{...styles.sourceBadge,background:'#ecfdf5',borderColor:'#a7f3d0',color:'#047857'}}>Weekly · Last 7 Days</div>
          ) : (
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
          )}
        </div>
      </div>

      <div style={styles.analyticsTopBar}>
        <div className="an-tabs" style={styles.tabs}>
          {[
            ['overview','Overview'],
            ['customers','Customers'],
            ['interbranch','Inter-Branch'],
            ['automations','Automations'],
            ['activity','Activity'],
            ['reports','Reports'],
          ].map(([key,label]) => (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              style={{...styles.tabBtn,...(activeTab===key?styles.tabBtnActive:{})}}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={styles.sourceBadgeWrap}>
          <span style={{...styles.sourceBadge,...(posEnhanced?styles.sourceBadgePos:{})}}>● {dataSourceLabel}</span>
          <span style={styles.sourceHint}>{dataSourceDescription}</span>
        </div>
      </div>

      {activeTab === 'interbranch' && (
        <InterBranchAnalytics
          API_BASE={API_BASE}
          user={user}
          timeRange={timeRange}
          branches={branches}
        />
      )}

      {activeTab === 'overview' && <>
        <div className="an-overview-grid" style={styles.overviewGrid}>
          <StatCard title="Active Members" value={overview.active_members ?? 0} change={overview.active_change} icon="⭐" color="#0d9488" />
          <StatCard title={branchScoped ? "New Known Customers" : "New Customers"} value={overview.new_customers ?? 0} change={overview.customer_change} icon="🆕" color="#10b981" />
          <StatCard title={headlineActivityLabel} value={headlineActivity} change={overview.stamp_change} icon={isMembership?'✅':isMultipass?'🎫':isVip?'👑':isPoints?'💎':'🎯'} color="#3b82f6" />
          <StatCard title={isVip?'Tier Upgrades':isMembership?'Membership Actions':isMultipass?'Packs Completed':'Rewards Redeemed'} value={overview.total_rewards ?? 0} change={overview.reward_change} icon="🎁" color="#ec4899" onClick={openRedemptionDrilldown} hint="View redemptions" />
          <StatCard title="30-Day Retention" value={`${customers?.retention_rate || 0}%`} icon="🔁" color="#8b5cf6" />
          <StatCard title="Churn Risk" value={customers?.churn_risk || 0} icon="⚠️" color={Number(customers?.churn_risk||0)>0?'#f59e0b':'#10b981'} />
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeadingRow}>
            <div>
              <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>What matters this period</h2>
              <div style={styles.mutedText}>A short summary instead of a wall of numbers.</div>
            </div>
          </div>
          <div className="an-insights-grid" style={styles.insightsGrid}>
            {insightItems.slice(0,3).map((item,i)=>(
              <div key={`${item.title}-${i}`} style={styles.insightCard}>
                <div style={{fontSize:22,marginBottom:8}}>{item.icon}</div>
                <h4 style={styles.insightTitle}>{item.title}</h4>
                <div style={styles.insightDesc}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeadingRow}>
            <div>
              <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>Recommended actions</h2>
              <div style={styles.mutedText}>Suggestions are based on recorded Loyalty Tree activity and only appear when there is something actionable.</div>
            </div>
          </div>
          {suggestedActions.length === 0 ? (
            <div style={styles.insightCard}><div style={styles.noData}>No urgent action detected for this period.</div></div>
          ) : (
            <div style={{display:'grid',gap:10}}>
              {suggestedActions.slice(0,3).map((item,i)=>(
                <div key={`${item.title}-${i}`} style={styles.actionSuggestion}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:850,color:'#1e293b'}}>{item.title}</div>
                    <div style={{...styles.mutedText,marginTop:3}}>{item.detail}</div>
                  </div>
                  <button type="button" style={styles.actionBtnCompact} onClick={item.onClick}>{item.action}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {Number(birthdayData.counts?.next_30_days || 0) > 0 && (
          <div style={{...styles.insightCard,borderLeft:'4px solid #f59e0b',marginBottom:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div>
                <strong style={{color:'#1e293b'}}>🎂 {birthdayData.counts.next_30_days} upcoming birthday{Number(birthdayData.counts.next_30_days)===1?'':'s'}</strong>
                <div style={styles.mutedText}>Birthday details stay out of the Overview until you need them.</div>
              </div>
              <button type="button" style={styles.actionBtnCompact} onClick={()=>setActiveTab('customers')}>View customers</button>
            </div>
          </div>
        )}
      </>}

      {activeTab === 'activity' && <>
        <div style={styles.section}>
          <div style={styles.sectionHeadingRow}>
            <div>
              <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>Peak activity</h2>
              <div style={styles.mutedText}>{posEnhanced ? 'POS-enhanced timing view when transaction timestamps are available.' : 'Based on Loyalty Tree card activity timestamps.'}</div>
            </div>
          </div>
          <div className="an-overview-grid" style={styles.overviewGrid}>
            <MiniMetric label="Peak period" value={peakActivity?.label || '—'} />
            <MiniMetric label="Peak activity" value={peakActivity ? Number(peakActivity.value||0).toLocaleString() : '—'} />
            <MiniMetric label="Quiet period" value={quietActivity?.label || '—'} />
            <MiniMetric label="Data source" value={posEnhanced ? 'POS + LT' : 'LT Activity'} />
          </div>
        </div>

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

        <div className="an-charts-row" style={styles.chartsRow}>
          <div className="an-chart-card" style={styles.chartCard}>
            <h3 style={styles.chartTitle}>{isMembership ? '📅 Membership Activity' : isMultipass ? '✅ Packs Completed' : '🎁 Reward Redemptions'}</h3>
            <BarChart data={trends.rewards} color="#ec4899" />
          </div>
          <div className="an-chart-card" style={styles.chartCard}>
            <h3 style={styles.chartTitle}>📅 Activity by recorded period</h3>
            <Heatmap data={trends.peak_hours} />
          </div>
        </div>
      </>}

      {activeTab === 'customers' && <>
        <div style={styles.section}>
          <div style={styles.sectionHeadingRow}>
            <div>
              <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>🆕 New Joiner Demographics</h2>
              <div style={styles.mutedText}>
                Registrations grouped by join date · {joinerRangeLabel} · {joinerDemographics?.timezone || 'Asia/Manila'}.
                {branchScoped ? ' This branch view means newly registered customers who have recorded activity at this branch.' : ''}
              </div>
            </div>
            <span style={styles.statusPill}>🔒 Aggregate only</span>
          </div>

          <div className="an-overview-grid" style={styles.overviewGrid}>
            <MiniMetric label={branchScoped ? 'New known customers' : 'New joiners'} value={Number(joinerDemographics?.total_joiners || 0).toLocaleString()} />
            <MiniMetric label="Joined today" value={Number(joinerDemographics?.today?.total_joiners || 0).toLocaleString()} />
            <MiniMetric label="Top age bracket" value={topJoinerAge?.[0] || '—'} />
            <MiniMetric label="Top gender group" value={topJoinerGender?.[0] || '—'} />
          </div>

          <div className="an-charts-row" style={styles.chartsRow}>
            <div style={styles.insightCard}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h4 style={styles.insightTitle}>Age of new joiners</h4><span style={styles.statusPill}>Selected range</span></div>
              {!joinerPrivacy.age_available || !joinerAgeRows.length ? <div style={styles.noData}>Not enough new-joiner age responses to show a private aggregate yet.</div> : <>
                {joinerAgeRows.map(([label,value])=><div key={label} style={styles.customerRow}><span style={styles.customerName}>{label}</span><strong>{Number(value||0).toLocaleString()}</strong></div>)}
                {joinerPrivacy.age_suppressed && <div style={styles.mutedText}>Small brackets plus one additional bracket are suppressed to prevent reconstruction.</div>}
              </>}
            </div>
            <div style={styles.insightCard}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h4 style={styles.insightTitle}>Gender of new joiners</h4><span style={styles.statusPill}>Selected range</span></div>
              {!joinerPrivacy.gender_available || !joinerGenderRows.length ? <div style={styles.noData}>Not enough new-joiner gender responses to show a private aggregate yet.</div> : <>
                {joinerGenderRows.map(([label,value])=><div key={label} style={styles.customerRow}><span style={styles.customerName}>{label}</span><strong>{Number(value||0).toLocaleString()}</strong></div>)}
                {joinerPrivacy.gender_suppressed && <div style={styles.mutedText}>Small groups plus one additional category are suppressed to prevent reconstruction.</div>}
              </>}
            </div>
          </div>

          <div style={styles.insightCard}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:10}}>
              <div>
                <h4 style={{...styles.insightTitle,marginBottom:4}}>Daily joiner mix</h4>
                <div style={styles.mutedText}>Join counts remain visible. Age and gender are hidden automatically when a day's sample is too small.</div>
              </div>
              {joinerDemographics?.daily_truncated && <span style={styles.statusPill}>Daily view: latest 90 days</span>}
            </div>
            {!joinerDailyRows.length ? <div style={styles.noData}>No registrations in this view yet.</div> : (
              <div style={{overflowX:'auto'}}>
                <div style={{minWidth:760}}>
                  {[...joinerDailyRows].reverse().map(day => (
                    <div key={day.date} style={{display:'grid',gridTemplateColumns:'120px 90px minmax(220px,1fr) minmax(220px,1fr)',gap:12,alignItems:'start',padding:'11px 0',borderBottom:'1px solid #f1f5f9',fontSize:12}}>
                      <strong style={{color:'#1e293b'}}>{day.date ? new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '—'}</strong>
                      <span style={{fontWeight:850,color:'#0f766e'}}>{Number(day.total_joiners || 0).toLocaleString()} join{Number(day.total_joiners || 0)===1?'':'s'}</span>
                      <span style={{color:'#475569'}}><b>Age:</b> {joinerMixText(day.age,'age')}</span>
                      <span style={{color:'#475569'}}><b>Gender:</b> {joinerMixText(day.gender,'gender')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{...styles.mutedText,marginTop:10}}>{joinerDemographics?.scope?.note || 'New joiners are grouped by customer registration timestamp.'}</div>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionHeadingRow}>
            <div>
              <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>Customer profile</h2>
              <div style={styles.mutedText}>Demographics are aggregated. Individual street addresses are never displayed here.</div>
            </div>
          </div>
          <div className="an-insights-grid" style={styles.insightsGrid}>
            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>New vs. returning</h4>
              <div style={styles.customerRow}><span style={styles.customerName}>{branchScoped ? 'New known customers' : 'New customers'}</span><strong>{Number(overview.new_customers||0).toLocaleString()}</strong></div>
              <div style={styles.customerRow}><span style={styles.customerName}>30-day retention</span><strong>{Number(customers.retention_rate||0)}%</strong></div>
              <div style={styles.customerRow}><span style={styles.customerName}>Churn risk</span><strong>{Number(customers.churn_risk||0).toLocaleString()}</strong></div>
            </div>

            <div style={styles.insightCard}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h4 style={styles.insightTitle}>Gender</h4><span style={styles.statusPill}>🔒 Aggregate only</span></div>
              {!demographicPrivacy.gender_available || !genderRows.length ? <div style={styles.noData}>Not enough gender responses to show a private aggregate yet.</div> : <>
                {genderRows.map(([label,value])=><div key={label} style={styles.customerRow}><span style={styles.customerName}>{label}</span><strong>{Number(value||0).toLocaleString()}</strong></div>)}
                {demographicPrivacy.gender_suppressed && <div style={styles.mutedText}>Small groups plus one additional category are suppressed to prevent reconstruction.</div>}
              </>}
            </div>

            <div style={styles.insightCard}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h4 style={styles.insightTitle}>Age brackets</h4><span style={styles.statusPill}>🔒 Aggregate only</span></div>
              {!demographicPrivacy.age_available || !ageRows.length ? <div style={styles.noData}>Not enough age-bracket responses to show a private aggregate yet.</div> : <>
                {ageRows.map(([label,value])=><div key={label} style={styles.customerRow}><span style={styles.customerName}>{label}</span><strong>{Number(value||0).toLocaleString()}</strong></div>)}
                {demographicPrivacy.age_suppressed && <div style={styles.mutedText}>Small brackets plus one additional bracket are suppressed to prevent reconstruction.</div>}
              </>}
            </div>

            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>Top customer areas</h4>
              {topAreas.length === 0 ? (
                <div style={styles.noData}>No aggregate city / municipality data available yet.</div>
              ) : topAreas.map(([label,value],i)=>(
                <div key={label} style={styles.customerRow}>
                  <span style={styles.rank}>#{i+1}</span>
                  <span style={styles.customerName}>{label}</span>
                  <strong>{Number(value).toLocaleString()}</strong>
                </div>
              ))}
              <div style={{...styles.mutedText,marginTop:10}}>Small location segments can be grouped later to protect customer privacy.</div>
            </div>

            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>Top customers by loyalty activity</h4>
              {(customers.top_customers || []).length === 0 ? <div style={styles.noData}>No customer activity yet.</div> : (customers.top_customers || []).slice(0,5).map((c,i)=>(
                <div key={`${c.name||'customer'}-${i}`} style={styles.customerRow}>
                  <span style={styles.rank}>#{i+1}</span>
                  <span style={styles.customerName}>{c.name || 'Customer'}</span>
                  <span style={styles.customerStamps}>{c.stamps} {c.metric === 'points_balance' ? 'pts' : c.metric === 'sessions_used' ? 'sessions' : 'activity'}</span>
                </div>
              ))}
            </div>

            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>Upcoming birthdays</h4>
              <div className="an-bignumber" style={styles.bigNumber}>{birthdayData.counts?.next_30_days || 0}</div>
              <div style={styles.insightDesc}>saved birthdays in the next 30 days</div>
              {(birthdayData.customers || []).slice(0,3).map(c=>(
                <div key={`${c.customer_public_id}-${c.birthday}`} style={{...styles.customerRow,marginTop:8}}>
                  <span style={styles.customerName}>{c.customer_name}</span>
                  <span style={styles.mutedText}>{c.is_today?'Today':`${c.days_until}d`}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>}

      {activeTab === 'activity' && <>

      {/* Time-Based Analytics */}
      <div style={styles.section}>
        <div style={styles.sectionHeadingRow}>
          <div>
            <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>🕒 Time-Based Analytics</h2>
            <div style={styles.mutedText}>
              {time_analytics?.sales_tracked
                ? `Sales and customer activity by local hour · ${time_analytics?.timezone || 'Asia/Manila'}`
                : `Customer activity by local hour · ${time_analytics?.timezone || 'Asia/Manila'}`}
            </div>
          </div>
          <span style={styles.statusPill}>
            {time_analytics?.demographics_are_purchase_linked ? 'Purchase-linked demographics' : 'Activity demographics'}
          </span>
        </div>

        <div style={styles.timeDayFilters}>
          <button
            type="button"
            onClick={() => setSelectedWeekday('all')}
            style={{...styles.timeDayBtn,...(selectedWeekday==='all'?styles.timeDayBtnActive:{})}}
          >
            All Days
          </button>
          {timeWeekdays.map(day => (
            <button
              key={day.day}
              type="button"
              onClick={() => setSelectedWeekday(String(day.day))}
              style={{...styles.timeDayBtn,...(String(selectedWeekday)===String(day.day)?styles.timeDayBtnActive:{})}}
            >
              {String(day.label || '').slice(0,3)}
            </button>
          ))}
        </div>

        {!timeHasData ? (
          <div style={styles.noData}>No time-based activity recorded for this range yet.</div>
        ) : (
          <>
            <div style={styles.hourGrid}>
              {displayedHourRows.map(row => {
                const isSelected = Number(row.hour) === Number(effectiveSelectedHour)
                const primaryCount = time_analytics?.sales_tracked ? Number(row.sales_count || 0) : Number(row.activity_count || 0)
                return (
                  <button
                    key={row.hour}
                    type="button"
                    onClick={() => setSelectedHour(Number(row.hour))}
                    style={{...styles.hourButton,...(isSelected?styles.hourButtonActive:{})}}
                    title={`${row.label}: ${primaryCount} ${time_analytics?.sales_tracked ? 'sales' : 'activities'}`}
                  >
                    <span style={styles.hourLabel}>{row.label}</span>
                    <strong style={styles.hourValue}>{primaryCount.toLocaleString()}</strong>
                    <small style={styles.hourMeta}>
                      {time_analytics?.sales_tracked
                        ? (Number(row.sales_amount || 0) > 0 ? `₱${Number(row.sales_amount || 0).toLocaleString(undefined,{maximumFractionDigits:0})}` : 'sales')
                        : `${Number(row.unique_customers || 0)} customers`}
                    </small>
                  </button>
                )
              })}
            </div>

            {selectedTimeRow && (
              <div className="an-charts-row" style={{...styles.chartsRow,marginTop:16}}>
                <div style={styles.insightCard}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start',marginBottom:12}}>
                    <div>
                      <h4 style={{...styles.insightTitle,marginBottom:3}}>
                        {selectedWeekdayRow ? selectedWeekdayRow.label : 'All Days'} · {selectedTimeRow.label}
                      </h4>
                      <div style={styles.mutedText}>
                        {time_analytics?.sales_tracked ? 'Recorded sales and loyalty activity in this time slot.' : 'Recorded Loyalty Tree activity in this time slot.'}
                      </div>
                    </div>
                    {busiestHour && Number(busiestHour.hour) === Number(selectedTimeRow.hour) && <span style={styles.statusPill}>Peak Hour</span>}
                  </div>

                  <div style={styles.timeMetricGrid}>
                    <MiniMetric label="Loyalty Activities" value={Number(selectedTimeRow.activity_count || 0).toLocaleString()} />
                    <MiniMetric label="Unique Customers" value={Number(selectedTimeRow.unique_customers || 0).toLocaleString()} />
                    <MiniMetric label="Rewards" value={Number(selectedTimeRow.reward_count || 0).toLocaleString()} />
                    {time_analytics?.sales_tracked && <MiniMetric label="Recorded Sales" value={Number(selectedTimeRow.sales_count || 0).toLocaleString()} />}
                    {time_analytics?.sales_tracked && <MiniMetric label="Sales Value" value={`₱${Number(selectedTimeRow.sales_amount || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`} />}
                  </div>
                </div>

                <div style={styles.insightCard}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start',marginBottom:8}}>
                    <h4 style={{...styles.insightTitle,marginBottom:0}}>{time_analytics?.demographics_are_purchase_linked ? 'Buyer demographics' : 'Customer demographics'}</h4>
                    <span style={styles.statusPill}>🔒 Aggregate only</span>
                  </div>
                  <div style={{...styles.mutedText,marginBottom:12}}>{selectedAgeWindow ? `${selectedWeekdayRow ? selectedWeekdayRow.label : 'All Days'} · ${selectedAgeWindow.label}` : 'Select an hour to view its two-hour demographic window.'}</div>
                  <div className="an-charts-row" style={{...styles.chartsRow,marginBottom:0}}>
                    <div><div style={styles.miniLabel}>Age brackets</div>
                      {!selectedAgeWindow?.age_available || !timeAgeRows.length ? <div style={{...styles.noData,padding:18}}>At least {Number(selectedAgeWindow?.minimum_sample || demographicWindowAnalytics?.minimum_sample || 10)} age-bracket responses are required.</div> : <>
                        {timeAgeRows.map(([label,value])=><div key={label} style={styles.customerRow}><span style={styles.customerName}>{label}</span><strong>{Number(value||0).toLocaleString()}</strong></div>)}
                        {selectedAgeWindow.age_suppressed && <div style={styles.mutedText}>Small brackets plus one additional bracket are suppressed.</div>}
                      </>}
                    </div>
                    <div><div style={styles.miniLabel}>Gender</div>
                      {!selectedAgeWindow?.gender_available || !timeGenderRows.length ? <div style={{...styles.noData,padding:18}}>At least {Number(selectedAgeWindow?.minimum_sample || demographicWindowAnalytics?.minimum_sample || 10)} gender responses are required.</div> : <>
                        {timeGenderRows.map(([label,value])=><div key={label} style={styles.customerRow}><span style={styles.customerName}>{label}</span><strong>{Number(value||0).toLocaleString()}</strong></div>)}
                        {selectedAgeWindow.gender_suppressed && <div style={styles.mutedText}>Small groups plus one additional category are suppressed.</div>}
                      </>}
                    </div>
                  </div>
                  <div style={{...styles.mutedText,marginTop:12}}>{time_analytics?.demographics_are_purchase_linked ? 'Based only on linked purchase records. No customer list or drill-down is provided from demographic reports.' : 'Based on recorded loyalty activity. No customer list or drill-down is provided from demographic reports.'}</div>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{...styles.mutedText,marginTop:12}}>
          {time_analytics?.sales_source === 'pos'
            ? 'Sales-by-time uses recorded POS transactions. Anonymous POS sales can contribute to sales totals, but demographic breakdowns only use customer-linked transactions.'
            : time_analytics?.sales_source === 'points_recorded_amount'
              ? 'Sales-by-time uses recorded spend from Points transactions.'
              : 'No purchase amount is recorded for this program yet. Connect POS or record spend with Points to unlock buyer-by-time analytics.'}
        </div>
      </div>

      {/* Revenue Insights */}
      <div style={styles.section}>
        <h2 className="an-section-title" style={styles.sectionTitle}>{posEnhanced ? '💰 POS Sales Insights' : '💰 Recorded Transaction Value'}</h2>
        {revenue.tracked ? (
          <div className="an-revenue-grid" style={styles.revenueGrid}>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>{posEnhanced ? (isPoints ? 'Points-Linked Sales' : 'Loyalty-Linked Sales') : 'Recorded Loyalty Value'}</h4>
              <div className="an-bignumber" style={styles.bigNumber}>₱{revenue.stamp_revenue}</div>
              <p style={styles.insightDesc}>{posEnhanced ? 'Confirmed POS value linked to Loyalty Tree members' : 'Transaction value recorded by Loyalty Tree; this is not labeled total business sales.'}</p>
            </div>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>Reward Cost</h4>
              {revenue.reward_cost != null ? (
                <>
                  <div className="an-bignumber" style={{...styles.bigNumber, color: '#ef4444'}}>₱{revenue.reward_cost}</div>
                  <p style={styles.insightDesc}>Estimated cost of redeemed rewards</p>
                </>
              ) : (
                <p style={styles.insightDesc}>Not tracked yet — prizes don't currently record a cost.</p>
              )}
            </div>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>{posEnhanced ? 'Net Program Value' : 'Net Tracked Value'}</h4>
              {revenue.net_value != null ? (
                <>
                  <div className="an-bignumber" style={{...styles.bigNumber, color: '#10b981'}}>₱{revenue.net_value}</div>
                  <p style={styles.insightDesc}>Revenue minus reward costs</p>
                </>
              ) : (
                <p style={styles.insightDesc}>Needs reward cost data to calculate.</p>
              )}
            </div>
            <div style={styles.revenueCard}>
              <h4 style={styles.insightTitle}>{posEnhanced ? 'Average Order Value' : 'Avg. Recorded Transaction'}</h4>
              <div className="an-bignumber" style={styles.bigNumber}>₱{revenue.avg_transaction}</div>
              <p style={styles.insightDesc}>{posEnhanced ? 'Average confirmed POS transaction linked to Loyalty Tree' : 'Average value only among transactions where an amount was recorded.'}</p>
            </div>
          </div>
        ) : (
          <div style={styles.insightCard}>
            <p style={styles.insightDesc}>
              Purchase value is not available for this program yet. Loyalty Tree can still report real card activity, retention, demographics and redemptions without guessing. Connect a supported POS to unlock stronger sales, average-order and sales-by-time analytics.
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

      {/* Branch Performance */}
      {Array.isArray(branch_performance) && branch_performance.length > 1 && (
        <div style={styles.section}>
          <div style={styles.sectionHeadingRow}>
            <div>
              <h2 className="an-section-title" style={{...styles.sectionTitle,marginBottom:4}}>🏢 Branch Performance</h2>
              <div style={styles.mutedText}>Compare branches inside the selected date range. Sales value appears only when a real transaction amount was recorded.</div>
            </div>
          </div>
          <div style={styles.branchTableWrap}>
            <div style={{...styles.branchTableRow,...styles.branchTableHeader}}>
              <span>Branch</span>
              <span>Active Customers</span>
              <span>Activities</span>
              <span>Rewards</span>
              <span>Tracked Sales</span>
              <span>Avg. Transaction</span>
              <span>Top Staff</span>
            </div>
            {branch_performance.map((branch, i) => (
              <div key={branch.branch_public_id || `${branch.name}-${i}`} style={styles.branchTableRow}>
                <span>
                  <strong>{branch.name || 'Branch'}</strong>
                  {branch.address && <small style={styles.branchSubtext}>{branch.address}</small>}
                </span>
                <span>{Number(branch.active_customers || 0).toLocaleString()}</span>
                <span>{Number(branch.activities || 0).toLocaleString()}</span>
                <span>{Number(branch.rewards || 0).toLocaleString()}</span>
                <span>{branch.tracked_sales == null ? '—' : `₱${Number(branch.tracked_sales || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`}</span>
                <span>{branch.avg_transaction == null ? '—' : `₱${Number(branch.avg_transaction || 0).toLocaleString(undefined,{maximumFractionDigits:2})}`}</span>
                <span>{branch.top_staff?.name || '—'}{branch.top_staff?.activities ? <small style={styles.branchSubtext}>{branch.top_staff.activities} actions</small> : null}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </>}

      {activeTab === 'activity' && (
        <details open={advancedOpen} onToggle={e=>setAdvancedOpen(e.currentTarget.open)} style={styles.advancedDetails}>
          <summary style={styles.advancedSummary}>
            <span>Advanced analytics & operations</span>
            <span style={styles.mutedText}>Wallet health, CRM, security and retention analytics</span>
          </summary>
          <div style={{paddingTop:18}}>
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

        <div id="birthday-celebrants-detail" style={{...styles.insightCard,marginBottom:16,scrollMarginTop:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap',marginBottom:14}}>
            <div>
              <h4 style={{...styles.insightTitle,marginBottom:4}}>🎉 Birthday Celebrants</h4>
              <div style={styles.mutedText}>See this month's celebrants and upcoming birthdays. Reward eligibility uses unique qualifying visit days, so same-day adjustments or redemptions do not inflate eligibility.</div>
            </div>
            <div style={styles.birthdayFilterBar}>
              {[
                ['all','All Birthdays',birthdayData.counts?.all || birthdayData.diagnostics?.resolved_people_with_birthday || 0],
                ['month','This Month',birthdayData.counts?.this_month || 0],
                ['today','Today',birthdayData.counts?.today || 0],
                ['7d','Next 7 Days',birthdayData.counts?.next_7_days || 0],
                ['30d','Next 30 Days',birthdayData.counts?.next_30_days || 0],
              ].map(([key,label,count])=>(
                <button key={key} type="button" onClick={()=>setBirthdayFilter(key)} style={{...styles.filterChip,...(birthdayFilter===key?styles.filterChipActive:{})}}>{label} · {count}</button>
              ))}
            </div>
          </div>

          <div className="an-overview-grid" style={{...styles.overviewGrid,marginBottom:14}}>
            <MiniMetric label="Saved Birthdays" value={birthdayData.counts?.all || birthdayData.diagnostics?.resolved_people_with_birthday || 0} />
            <MiniMetric label="This Month" value={birthdayData.counts?.this_month || 0} />
            <MiniMetric label="Today" value={birthdayData.counts?.today || 0} />
            <MiniMetric label="Next 30 Days" value={birthdayData.counts?.next_30_days || 0} />
          </div>

          <div style={{fontSize:12,color:'#64748b',marginBottom:10}}>
            Birthday data: {birthdayData.diagnostics?.resolved_people_with_birthday ?? birthdayData.counts?.all ?? 0} people ·
            {' '}{birthdayData.diagnostics?.total_membership_rows ?? '—'} membership rows
            {(birthdayData.diagnostics?.unreadable_birthday_rows || 0) > 0 ? ` · ${birthdayData.diagnostics.unreadable_birthday_rows} unreadable` : ''}
          </div>
          <div style={{fontSize:12,fontWeight:700,color:'#475569',marginBottom:8}}>{birthdayFilterLabel}</div>
          {birthdayRows.length === 0 ? <div style={styles.noData}>No birthday celebrants in this view.</div> : (
            <div>
              {birthdayRows.map(c=>(
                <div key={`${c.customer_public_id}-${c.birthday}`} style={styles.birthdayRow}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontWeight:800,color:'#1e293b'}}>{c.customer_name}</div>
                    <div style={styles.mutedText}>
                      🎂 {c.birthday ? new Date(`${c.birthday}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '—'}
                      {c.is_today ? ' · Today!' : c.days_until >= 0 ? ` · ${c.days_until} day${c.days_until===1?'':'s'} away` : ''}
                      {c.total_visits != null ? ` · ${c.total_visits} recorded visit${c.total_visits===1?'':'s'}` : ''}
                    </div>
                    {c.last_visit_at && <div style={styles.mutedText}>Last qualifying visit: {new Date(c.last_visit_at).toLocaleDateString()}</div>}
                  </div>
                  <div style={{textAlign:'right',minWidth:150}}>
                    {!retentionSettings.birthday_reward_enabled ? (
                      <span style={styles.statusPill}>Greeting only</span>
                    ) : c.reward_status ? (
                      <>
                        <span style={{...styles.statusPill,...(c.reward_status==='redeemed'?styles.statusGood:c.reward_status==='issued'?styles.statusWarn:{})}}>Reward {c.reward_status}</span>
                        {c.reward_expires_at && <div style={styles.mutedText}>Expires {c.reward_expires_at}</div>}
                      </>
                    ) : c.reward_eligible ? (
                      <span style={{...styles.statusPill,...styles.statusGood}}>Reward eligible</span>
                    ) : (
                      <>
                        <span style={{...styles.statusPill,...styles.statusBad}}>Not eligible</span>
                        {!!c.reward_eligibility_reasons?.length && <div style={{...styles.mutedText,maxWidth:240}}>{c.reward_eligibility_reasons.join(' · ')}</div>}
                      </>
                    )}
                    {c.verification_required && <div style={styles.mutedText}>ID verification requested</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
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

          </div>
        </details>
      )}


      {activeTab === 'automations' && <>
        <div style={styles.section}>
          <h2 className="an-section-title" style={styles.sectionTitle}>⚙️ Automations</h2>
          <div style={{...styles.mutedText,marginBottom:16}}>Edit the messages that LoyaltyTree sends for you, and see how many have gone out.</div>

          <div style={{...styles.insightCard,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:12}}>
              <div>
                <h4 style={{...styles.insightTitle,marginBottom:4}}>📨 Messages Sent</h4>
                <div style={styles.mutedText}>Birthday and win-back messages delivered to customers' wallet cards.</div>
              </div>
              <button type="button" style={styles.actionBtnCompact} onClick={fetchAutomationStats}>Refresh</button>
            </div>
            <div className="an-overview-grid" style={{...styles.overviewGrid,marginBottom:14}}>
              <MiniMetric label="🎂 Birthday · This Month" value={automationStats.birthday?.this_month || 0} />
              <MiniMetric label="🎂 Birthday · This Year" value={automationStats.birthday?.this_year || 0} />
              <MiniMetric label="🎂 Birthday · All Time" value={automationStats.birthday?.total || 0} />
              <MiniMetric label="🔁 Win-Back · Last 7 Days" value={automationStats.win_back?.last_7_days || 0} />
              <MiniMetric label="🔁 Win-Back · Last 30 Days" value={automationStats.win_back?.last_30_days || 0} />
              <MiniMetric label="🔁 Win-Back · All Time" value={automationStats.win_back?.total || 0} />
            </div>
            {automationStats.tracking === 'estimate' && (
              <div style={{...styles.mutedText,marginBottom:12}}>Showing estimates from customer records. Exact counts and the recent-messages list start once the message log is enabled.</div>
            )}
            <div style={{...styles.settingTitle,marginBottom:8}}>Recent messages</div>
            {(automationStats.recent || []).length === 0 ? <div style={styles.noData}>No automated messages sent yet.</div> :
              automationStats.recent.map((m,i)=>(
                <div key={`${m.sent_at}-${i}`} style={styles.auditRow}>
                  <div>
                    <strong>{m.automation_type === 'birthday' ? '🎂' : '🔁'} {m.customer_name}</strong>
                    <div style={styles.mutedText}>{m.body}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span style={{...styles.statusPill,...styles.statusGood}}>{m.automation_type === 'birthday' ? 'Birthday' : 'Win-back'}</span>
                    <div style={styles.mutedText}>{m.sent_at ? new Date(m.sent_at.endsWith('Z') || m.sent_at.includes('+') ? m.sent_at : m.sent_at + 'Z').toLocaleString() : ''}</div>
                  </div>
                </div>
              ))}
          </div>

        <div style={{...styles.insightCard, marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:14}}>
            <div>
              <h4 style={{...styles.insightTitle,marginBottom:4}}>🎂 Birthday Automation</h4>
              <div style={styles.mutedText}>Choose an early send timing to greet customers before their birthday. When Birthday Rewards are enabled, the coupon is issued on the same scheduled run.</div>
            </div>
            <button className="an-actionbtn" style={styles.actionBtn} disabled={savingRetentionSettings} onClick={saveRetentionSettings}>
              {savingRetentionSettings ? 'Saving…' : 'Save Birthday Settings'}
            </button>
          </div>

          <div style={styles.settingRow}>
            <div>
              <div style={styles.settingTitle}>Birthday Greetings</div>
              <div style={styles.mutedText}>Send a personalized Wallet message to birthday celebrants.</div>
            </div>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={retentionSettings.birthday_enabled !== false} onChange={e=>setRetentionSettings(s=>({...s,birthday_enabled:e.target.checked}))} />
              {retentionSettings.birthday_enabled !== false ? 'On' : 'Off'}
            </label>
          </div>

          {retentionSettings.birthday_enabled !== false && <>
            <div style={styles.formGrid2}>
              <div>
                <label style={styles.editorLabel}>Send Timing</label>
                <select style={styles.editorSelect} value={retentionSettings.birthday_send_timing || 'birthday'} onChange={e=>setRetentionSettings(s=>({...s,birthday_send_timing:e.target.value}))}>
                  <option value="birthday">On the birthday</option>
                  <option value="1_day_before">1 day before</option>
                  <option value="3_days_before">3 days before</option>
                  <option value="7_days_before">7 days before</option>
                  <option value="month_start">Start of birthday month</option>
                </select>
              </div>
            </div>
            {retentionSettings.birthday_send_timing !== 'birthday' && (
              <div style={{...styles.editorHelp,marginBottom:12}}>
                The greeting and enabled birthday coupon are issued on the selected pre-birthday date. The coupon stays active through the birthday plus the validity period below.
              </div>
            )}

            <label style={styles.editorLabel}>Birthday Greeting</label>
            <textarea
              value={retentionSettings.birthday_message || ''}
              onChange={e=>setRetentionSettings(s=>({...s,birthday_message:e.target.value}))}
              maxLength={500}
              rows={3}
              style={styles.editorTextarea}
            />
            <div style={styles.editorHelp}>Personalize with {'{first_name}'}. Also available: {'{customer_name}'}, {'{business_name}'}.</div>

            <div style={{...styles.settingRow,marginTop:16,paddingTop:16,borderTop:'1px solid #e2e8f0'}}>
              <div>
                <div style={styles.settingTitle}>🎁 Birthday Rewards</div>
                <div style={styles.mutedText}>Optional. Eligible customers receive a one-time coupon through the existing Loyalty Tree coupon system.</div>
              </div>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" checked={retentionSettings.birthday_reward_enabled === true} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_enabled:e.target.checked}))} />
                {retentionSettings.birthday_reward_enabled === true ? 'On' : 'Off'}
              </label>
            </div>

            {retentionSettings.birthday_reward_enabled === true && <div style={styles.rewardPanel}>
              <div style={styles.formGrid2}>
                <div>
                  <label style={styles.editorLabel}>Reward Type</label>
                  <select style={styles.editorSelect} value={retentionSettings.birthday_reward_type || 'custom'} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_type:e.target.value}))}>
                    <option value="free_item">Free Item</option>
                    <option value="discount">Discount</option>
                    <option value="custom">Custom Perk</option>
                  </select>
                </div>
                <div>
                  <label style={styles.editorLabel}>Reward Name</label>
                  <input style={styles.editorInput} maxLength={120} placeholder="e.g. Free Birthday Drink" value={retentionSettings.birthday_reward_name || ''} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_name:e.target.value}))} />
                </div>
              </div>

              <label style={styles.editorLabel}>Reward Description</label>
              <input style={styles.editorInput} maxLength={240} placeholder="e.g. Any regular handcrafted beverage" value={retentionSettings.birthday_reward_description || ''} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_description:e.target.value}))} />

              <label style={{...styles.editorLabel,marginTop:12}}>Reward Message</label>
              <textarea
                value={retentionSettings.birthday_reward_message || ''}
                onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_message:e.target.value}))}
                maxLength={500}
                rows={3}
                style={styles.editorTextarea}
              />
              <div style={styles.editorHelp}>Available: {'{first_name}'}, {'{business_name}'}, {'{reward_name}'}, {'{reward_description}'}, {'{expiry_date}'}.</div>

              <div style={{...styles.formGrid2,marginTop:12}}>
                <div>
                  <label style={styles.editorLabel}>Minimum Membership Age</label>
                  <select style={styles.editorSelect} value={retentionSettings.birthday_reward_min_membership_days ?? 30} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_min_membership_days:Number(e.target.value)}))}>
                    <option value={0}>No waiting period</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
                <div>
                  <label style={styles.editorLabel}>Minimum Qualifying Visit Days</label>
                  <input type="number" min="0" max="10000" style={styles.editorInput} value={retentionSettings.birthday_reward_min_visits ?? 2} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_min_visits:Number(e.target.value)}))} />
                </div>
                <div>
                  <label style={styles.editorLabel}>Valid Through Birthday +</label>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <input type="number" min="1" max="365" style={{...styles.editorInput,width:100}} value={retentionSettings.birthday_reward_validity_days ?? 7} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_validity_days:Number(e.target.value)}))} />
                    <span style={styles.mutedText}>days after birthday</span>
                  </div>
                </div>
                <div>
                  <label style={styles.editorLabel}>Anti-Abuse</label>
                  <div style={{fontSize:13,color:'#166534',fontWeight:700}}>✓ One reward per customer per birthday year</div>
                  <label style={{...styles.checkboxLabel,marginTop:8,justifyContent:'flex-start'}}>
                    <input type="checkbox" checked={retentionSettings.birthday_reward_staff_verification === true} onChange={e=>setRetentionSettings(s=>({...s,birthday_reward_staff_verification:e.target.checked}))} />
                    Ask staff to verify birthday / ID at redemption
                  </label>
                </div>
              </div>
            </div>}
          </>}

          {retentionSettingsMessage && <div style={{marginTop:10,fontSize:13,fontWeight:700,color:retentionSettingsMessage.includes('Saved')?'#166534':'#b91c1c'}}>{retentionSettingsMessage}</div>}
        </div>

          <div style={{...styles.insightCard,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:14}}>
              <div>
                <h4 style={{...styles.insightTitle,marginBottom:4}}>🔁 Churn / Win-Back Automation</h4>
                <div style={styles.mutedText}>Automatically nudge customers who stopped coming back. Each customer gets at most one win-back message every 30 days.</div>
              </div>
              <button className="an-actionbtn" style={styles.actionBtn} disabled={savingRetentionSettings} onClick={saveRetentionSettings}>
                {savingRetentionSettings ? 'Saving…' : 'Save Win-Back Settings'}
              </button>
            </div>
          <label style={styles.editorLabel}>Churn / Win-Back Message</label>
          <textarea
            value={retentionSettings.win_back_message || ''}
            onChange={e=>setRetentionSettings(s=>({...s,win_back_message:e.target.value}))}
            maxLength={500}
            rows={3}
            style={styles.editorTextarea}
          />
          <div style={styles.editorHelp}>Available: {'{business_name}'}, {'{first_name}'}, {'{customer_name}'}, {'{days_inactive}'}</div>

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

          <div style={{...styles.insightCard,marginTop:16}}>
            <div style={styles.settingRow}>
              <div>
                <div style={styles.settingTitle}>📍 Nearby notification</div>
                <div style={styles.mutedText}>Pin the branch, set the radius, then write the lock-screen message. Apple shows it when the saved card is nearby. Google gets the same pin as a merchant location.</div>
              </div>
              <label style={styles.checkboxLabel}>
                <input type="checkbox" checked={geofence.enabled === true} onChange={e=>setGeofence(s=>({...s,enabled:e.target.checked}))} />
                {geofence.enabled ? 'On' : 'Off'}
              </label>
            </div>
            <label style={styles.editorLabel}>Notification message</label>
            <input style={styles.editorInput} maxLength={120} value={geofence.message || ''} onChange={e=>setGeofence(s=>({...s,message:e.target.value}))} />
            <div style={styles.formGrid2}>
              <label style={styles.editorLabel}>Radius in meters
                <input type="number" min={geofence.limits?.min_radius_meters || 100} max={geofence.limits?.max_radius_meters || 1000} style={styles.editorInput} value={geofence.radius_meters} onChange={e=>setGeofence(s=>({...s,radius_meters:e.target.value}))} />
              </label>
              <label style={styles.editorLabel}>Max times / day
                <input type="number" min="1" max="5" style={styles.editorInput} value={geofence.max_per_day} onChange={e=>setGeofence(s=>({...s,max_per_day:e.target.value}))} />
              </label>
              <label style={styles.editorLabel}>Max times / week
                <input type="number" min="1" max="20" style={styles.editorInput} value={geofence.max_per_week} onChange={e=>setGeofence(s=>({...s,max_per_week:e.target.value}))} />
              </label>
            </div>
            <div style={styles.editorHelp}>Allowed radius: {geofence.limits?.min_radius_meters || 100}–{geofence.limits?.max_radius_meters || 1000} m. Apple is most reliable at 100–200 m. Max {geofence.limits?.max_pins || 10} pins. Day/week caps are your policy; Wallet suppresses repeats itself and will not hard-stop at that number.</div>
            <div style={styles.editorHelp}>One location per branch. This account can save {Math.min(geofence.limits?.max_pins || 1, (geofence.branches || []).length || 1)} pin{(Math.min(geofence.limits?.max_pins || 1, (geofence.branches || []).length || 1)) === 1 ? '' : 's'}.</div>
            {(geofence.pins || []).map((pin, index) => (
              <div key={index} style={{...styles.formGrid2,marginTop:10}}>
                <select style={styles.editorSelect} value={pin.branch_public_id || ''} onChange={e=>updateGeofencePin(index,{branch_public_id:e.target.value})}>
                  <option value="">Branch</option>
                  {(geofence.branches || []).map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}
                </select>
                <input style={styles.editorInput} placeholder="Latitude" value={pin.latitude ?? ''} onChange={e=>updateGeofencePin(index,{latitude:e.target.value})} />
                <input style={styles.editorInput} placeholder="Longitude" value={pin.longitude ?? ''} onChange={e=>updateGeofencePin(index,{longitude:e.target.value})} />
                <input style={styles.editorInput} maxLength={120} placeholder="Message at this location" value={pin.message || ''} onChange={e=>updateGeofencePin(index,{message:e.target.value})} />
                <button type="button" style={styles.actionBtnCompact} onClick={()=>useGeofenceLocation(index)}>Use my location</button>
                <button type="button" style={styles.actionBtn} disabled={savingGeofence} onClick={saveGeofence}>{savingGeofence ? 'Saving…' : 'Save location and message'}</button>
              </div>
            ))}
            <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
              <button type="button" style={styles.actionBtnCompact} onClick={()=>setGeofence(s=>({...s,pins:[...(s.pins||[]),{branch_public_id:'',label:'',message:s.message||'',latitude:'',longitude:''}]}))} disabled={(geofence.pins||[]).length >= Math.min(geofence.limits?.max_pins || 1, (geofence.branches || []).length || 1)}>Add branch location</button>
            </div>
            {geofenceStatus && <div style={{marginTop:10,fontSize:13,fontWeight:700,color:geofenceStatus.startsWith('Saved')?'#166534':'#b91c1c'}}>{geofenceStatus}</div>}
          </div>
          </div>
        </div>
      </>}

      {activeTab === 'reports' && (
        <div style={styles.section}>
          <div style={styles.reportHero}>
            <div>
              <div style={styles.eyebrow}>WEEKLY REPORT</div>
              <h2 style={{...styles.sectionTitle,margin:'4px 0 6px'}}>Latest 7-day business report</h2>
              <div style={styles.mutedText}>Generated from the live Analytics data. No email is sent — the owner chooses when to view or save it.</div>
            </div>
            <button type="button" style={styles.primaryActionBtn} onClick={printWeeklyReport}>Print / Save PDF</button>
          </div>

          <div style={{...styles.insightCard,marginBottom:16}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <strong style={{color:'#1e293b'}}>{reportRangeLabel}</strong>
                <div style={styles.mutedText}>Generated {reportDate}</div>
              </div>
              <span style={{...styles.sourceBadge,...(posEnhanced?styles.sourceBadgePos:{})}}>● {dataSourceLabel}</span>
            </div>
          </div>

          <div className="an-overview-grid" style={styles.overviewGrid}>
            <MiniMetric label="Active members" value={overview.active_members ?? 0} />
            <MiniMetric label="New customers" value={overview.new_customers ?? 0} />
            <MiniMetric label={headlineActivityLabel} value={headlineActivity} />
            <MiniMetric label="Rewards / redemptions" value={overview.total_rewards ?? 0} />
            <MiniMetric label="30-day retention" value={`${customers?.retention_rate || 0}%`} />
            <MiniMetric label="Peak activity" value={peakActivity?.label || '—'} />
          </div>

          <div className="an-charts-row" style={styles.chartsRow}>
            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>Customer profile snapshot</h4>
              <div style={styles.customerRow}><span style={styles.customerName}>Largest age group</span><strong>{largestAgeGroup?.[0] || '—'}</strong></div>
              <div style={styles.customerRow}><span style={styles.customerName}>Top customer area</span><strong>{topAreas?.[0]?.[0] || '—'}</strong></div>
              <div style={styles.customerRow}><span style={styles.customerName}>Upcoming birthdays</span><strong>{birthdayData.counts?.next_30_days || 0}</strong></div>
            </div>
            <div style={styles.insightCard}>
              <h4 style={styles.insightTitle}>Insights & suggestions</h4>
              {insightItems.slice(0,4).map((item,i)=>(
                <div key={`${item.title}-${i}`} style={{padding:'9px 0',borderBottom:i<Math.min(insightItems.length,4)-1?'1px solid #f1f5f9':'none'}}>
                  <div style={{fontWeight:800,color:'#1e293b'}}>{item.icon} {item.title}</div>
                  <div style={{...styles.mutedText,marginTop:2}}>{item.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.reportNote}>
            This report reflects the current 7-day Analytics data. Use <strong>Print / Save PDF</strong> to keep a copy for managers, partners or internal records.
          </div>
        </div>
      )}

      {redemptionDrilldown.open && (
        <div style={styles.modalBackdrop} onMouseDown={e => { if (e.target === e.currentTarget) closeRedemptionDrilldown() }}>
          <div style={styles.modalCard} role="dialog" aria-modal="true" aria-label="Redemption details">
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{margin:0,color:'#1e293b'}}>🎁 Redemption Details</h3>
                <div style={styles.mutedText}>{timeRange === 'all' ? 'All time' : `Last ${timeRange.replace('d','')} days`} · {redemptionDrilldown.total} redemption{redemptionDrilldown.total===1?'':'s'}</div>
              </div>
              <button type="button" onClick={closeRedemptionDrilldown} style={styles.modalClose}>×</button>
            </div>

            {redemptionDrilldown.loading ? <div style={styles.noData}>Loading redemptions…</div> :
             redemptionDrilldown.error ? <div style={{...styles.noData,color:'#b91c1c'}}>{redemptionDrilldown.error}</div> :
             redemptionDrilldown.rows.length === 0 ? <div style={styles.noData}>No redemptions in this period.</div> : (
              <div style={styles.redemptionList}>
                {redemptionDrilldown.rows.map((r,i) => (
                  <div key={r.id || `${r.customer_public_id || 'customer'}-${r.redeemed_at || i}`} style={styles.redemptionRow}>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontWeight:850,color:'#1e293b'}}>{r.customer_name || 'Customer'}</div>
                      <div style={{fontSize:13,color:'#475569',marginTop:2}}>{r.reward_name || 'Redeemable reward'}</div>
                      <div style={styles.mutedText}>
                        {[r.program_name, r.branch_name, r.staff_name ? `by ${r.staff_name}` : null].filter(Boolean).join(' · ') || 'Loyalty redemption'}
                      </div>
                    </div>
                    <div style={{textAlign:'right',minWidth:120}}>
                      {r.points_spent != null && <div style={{fontWeight:800,color:'#ec4899'}}>{Number(r.points_spent).toLocaleString()} pts</div>}
                      {r.quantity != null && Number(r.quantity) > 1 && <div style={{fontWeight:800,color:'#ec4899'}}>×{r.quantity}</div>}
                      <div style={styles.mutedText}>{r.redeemed_at ? new Date(r.redeemed_at).toLocaleString() : '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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

function StatCard({ title, value, change, icon, color, onClick, hint }) {
  const hasChange = Number.isFinite(Number(change))
  const numericChange = Number(change || 0)
  const isPositive = numericChange >= 0
  const clickable = typeof onClick === 'function'
  return (
    <div
      className="an-statcard"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }) : undefined}
      style={{...styles.statCard, borderTop: `4px solid ${color}`, cursor: clickable ? 'pointer' : 'default', transition:'transform .15s ease, box-shadow .15s ease'}}
      title={hint || undefined}
    >
      <div style={styles.statHeader}>
        <span className="an-stat-icon" style={styles.statIcon}>{icon}</span>
        {hasChange && <span style={{...styles.change, color: isPositive ? '#10b981' : '#ef4444'}}>
          {isPositive ? '↑' : '↓'} {Math.abs(numericChange)}%
        </span>}
      </div>
      <div className="an-statvalue" style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
      {hint && <div style={{fontSize:11,color:'#0d9488',fontWeight:750,marginTop:7}}>{hint} →</div>}
    </div>
  )
}

function LineChart({ data, color }) {
  if (!data || data.length === 0) return <div style={styles.noData}>No data available</div>

  const max = Math.max(...data.map(d => Number(d.value || 0)))
  const min = Math.min(...data.map(d => Number(d.value || 0)))
  const range = max - min || 1
  const denominator = Math.max(1, data.length - 1)

  return (
    <div style={styles.chartContainer}>
      <svg viewBox="0 0 300 100" style={styles.svg}>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          points={data.map((d, i) => {
            const x = (i / denominator) * 300
            const y = 100 - ((d.value - min) / range) * 80 - 10
            return `${x},${y}`
          }).join(' ')}
        />
        {data.map((d, i) => {
          const x = (i / denominator) * 300
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

  const max = Math.max(1, ...data.map(d => Number(d.value || 0)))

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

  const max = Math.max(1, ...data.map(d => Number(d.value || 0)))

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
  settingRow: {
    display:'flex',
    justifyContent:'space-between',
    alignItems:'center',
    gap:14,
    flexWrap:'wrap',
    marginBottom:14,
  },
  settingTitle: {
    fontSize:14,
    fontWeight:800,
    color:'#1e293b',
  },
  checkboxLabel: {
    display:'flex',
    alignItems:'center',
    justifyContent:'flex-end',
    gap:7,
    fontSize:13,
    fontWeight:700,
    color:'#475569',
    cursor:'pointer',
  },
  formGrid2: {
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',
    gap:12,
    marginBottom:12,
  },
  editorInput: {
    width:'100%',
    boxSizing:'border-box',
    border:'1px solid #cbd5e1',
    borderRadius:9,
    padding:'9px 10px',
    fontSize:13,
    color:'#1e293b',
    fontFamily:'inherit',
  },
  editorSelect: {
    width:'100%',
    boxSizing:'border-box',
    border:'1px solid #cbd5e1',
    borderRadius:9,
    padding:'9px 10px',
    fontSize:13,
    color:'#1e293b',
    background:'white',
  },
  rewardPanel: {
    marginTop:12,
    padding:14,
    border:'1px solid #ccfbf1',
    borderRadius:12,
    background:'#f0fdfa',
  },
  birthdayFilterBar: {
    display:'flex',
    gap:6,
    flexWrap:'wrap',
  },
  filterChip: {
    border:'1px solid #cbd5e1',
    background:'white',
    color:'#475569',
    borderRadius:999,
    padding:'7px 10px',
    fontSize:11,
    fontWeight:700,
    cursor:'pointer',
  },
  filterChipActive: {
    background:'#0d9488',
    color:'white',
    borderColor:'#0d9488',
  },
  birthdayRow: {
    display:'flex',
    justifyContent:'space-between',
    alignItems:'center',
    gap:14,
    padding:'12px 0',
    borderBottom:'1px solid #f1f5f9',
    flexWrap:'wrap',
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
  modalBackdrop: {
    position:'fixed', inset:0, background:'rgba(15,23,42,.46)', zIndex:9999,
    display:'grid', placeItems:'center', padding:16,
  },
  modalCard: {
    width:'min(760px, 96vw)', maxHeight:'82vh', overflow:'hidden', background:'white',
    borderRadius:16, boxShadow:'0 24px 70px rgba(15,23,42,.28)', display:'grid', gridTemplateRows:'auto 1fr',
  },
  modalHeader: {
    display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12,
    padding:'18px 20px', borderBottom:'1px solid #e2e8f0',
  },
  modalClose: {
    border:'none', background:'#f1f5f9', color:'#475569', width:36, height:36, borderRadius:10,
    cursor:'pointer', fontSize:24, lineHeight:1,
  },
  redemptionList: { overflowY:'auto', padding:14, display:'grid', gap:8 },
  redemptionRow: {
    display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:14,
    padding:14, border:'1px solid #e2e8f0', borderRadius:12, background:'#fff',
  },

  analyticsHeaderControls: {
    display:'flex', alignItems:'flex-end', justifyContent:'flex-end', gap:12, flexWrap:'wrap',
  },
  branchFilterLabel: {
    display:'grid', gap:5, minWidth:190,
  },
  miniLabel: {
    fontSize:11, fontWeight:850, color:'#64748b', textTransform:'uppercase', letterSpacing:'.04em',
  },
  branchSelect: {
    minWidth:190, border:'1px solid #cbd5e1', borderRadius:9, background:'#fff', color:'#334155',
    padding:'9px 11px', fontSize:13, fontWeight:700,
  },
  branchTableWrap: {
    overflowX:'auto', background:'#fff', border:'1px solid #e2e8f0', borderRadius:12,
    boxShadow:'0 1px 3px rgba(15,23,42,.05)',
  },
  branchTableRow: {
    minWidth:900, display:'grid', gridTemplateColumns:'minmax(180px,1.5fr) repeat(5,minmax(110px,1fr)) minmax(140px,1fr)',
    gap:12, alignItems:'center', padding:'12px 14px', borderBottom:'1px solid #f1f5f9',
    fontSize:12.5, color:'#334155',
  },
  branchTableHeader: {
    background:'#f8fafc', fontWeight:850, color:'#64748b', textTransform:'uppercase', fontSize:10.5, letterSpacing:'.03em',
  },
  branchSubtext: {
    display:'block', marginTop:2, color:'#94a3b8', fontSize:10.5, fontWeight:500,
  },
  timeDayFilters: {
    display:'flex', gap:6, flexWrap:'wrap', marginBottom:12,
  },
  timeDayBtn: {
    border:'1px solid #cbd5e1', background:'#fff', color:'#475569', borderRadius:999,
    padding:'7px 10px', fontSize:11, fontWeight:800, cursor:'pointer',
  },
  timeDayBtnActive: {
    background:'#0d9488', color:'#fff', borderColor:'#0d9488',
  },
  hourGrid: {
    display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(82px,1fr))', gap:8,
  },
  hourButton: {
    border:'1px solid #e2e8f0', background:'#fff', borderRadius:10, padding:'10px 8px',
    cursor:'pointer', textAlign:'left', display:'grid', gap:3, minHeight:76,
  },
  hourButtonActive: {
    borderColor:'#0d9488', background:'#f0fdfa', boxShadow:'0 0 0 1px #0d9488',
  },
  hourLabel: {
    fontSize:10.5, fontWeight:800, color:'#64748b',
  },
  hourValue: {
    fontSize:20, color:'#1e293b', lineHeight:1,
  },
  hourMeta: {
    fontSize:10, color:'#94a3b8',
  },
  timeMetricGrid: {
    display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10,
  },
  timeDemoGrid: {
    display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:18,
  },

  analyticsTopBar: {
    display:'flex', justifyContent:'space-between', alignItems:'center', gap:14, flexWrap:'wrap',
    marginBottom:22, padding:'10px 0 2px',
  },
  tabs: {
    display:'flex', alignItems:'center', gap:6, padding:5, background:'#e2e8f0', borderRadius:12,
  },
  tabBtn: {
    border:'none', background:'transparent', color:'#64748b', padding:'9px 14px', borderRadius:9,
    fontSize:13, fontWeight:800, cursor:'pointer', whiteSpace:'nowrap',
  },
  tabBtnActive: {
    background:'#fff', color:'#0f766e', boxShadow:'0 1px 3px rgba(15,23,42,.10)',
  },
  sourceBadgeWrap: {
    display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8, flexWrap:'wrap',
  },
  sourceBadge: {
    display:'inline-flex', alignItems:'center', padding:'6px 10px', borderRadius:999, background:'#f1f5f9',
    border:'1px solid #e2e8f0', color:'#475569', fontSize:11.5, fontWeight:850,
  },
  sourceBadgePos: { background:'#ecfdf5', borderColor:'#a7f3d0', color:'#047857' },
  sourceHint: { fontSize:11.5, color:'#94a3b8', maxWidth:360 },
  sectionHeadingRow: {
    display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap', marginBottom:14,
  },
  actionSuggestion: {
    display:'flex', justifyContent:'space-between', alignItems:'center', gap:14, flexWrap:'wrap',
    background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'14px 16px',
    boxShadow:'0 1px 2px rgba(15,23,42,.04)',
  },
  actionBtnCompact: {
    border:'1px solid #99f6e4', background:'#f0fdfa', color:'#0f766e', borderRadius:9,
    padding:'8px 11px', fontSize:12, fontWeight:850, cursor:'pointer', whiteSpace:'nowrap',
  },
  barLabelRow: {
    display:'flex', justifyContent:'space-between', gap:10, fontSize:12.5, color:'#475569', marginBottom:4,
  },
  advancedDetails: {
    background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:'0 16px', marginBottom:24,
    boxShadow:'0 1px 3px rgba(15,23,42,.05)',
  },
  advancedSummary: {
    cursor:'pointer', padding:'15px 0', fontWeight:850, color:'#1e293b', display:'flex',
    justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap',
  },
  reportHero: {
    display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap',
    padding:'18px 20px', borderRadius:16, background:'linear-gradient(135deg,#f0fdfa,#f8fafc)',
    border:'1px solid #ccfbf1', marginBottom:16,
  },
  eyebrow: { fontSize:11, fontWeight:900, letterSpacing:'.12em', color:'#0f766e' },
  primaryActionBtn: {
    border:'none', background:'#0d9488', color:'#fff', borderRadius:10, padding:'11px 15px',
    fontSize:13, fontWeight:850, cursor:'pointer', boxShadow:'0 4px 12px rgba(13,148,136,.18)',
  },
  reportNote: {
    marginTop:8, padding:'12px 14px', borderRadius:12, background:'#fffbeb', border:'1px solid #fde68a',
    color:'#92400e', fontSize:12.5, lineHeight:1.55,
  },

}

export default AnalyticsDashboard

import React, { useState, useEffect } from 'react'
import PlatformAnnouncementsAdmin from './PlatformAnnouncementsAdmin'

const STATUS_OPTIONS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']

const BUSINESS_TYPE_OPTIONS=[
  ['spa','🌿 Spa'],['salon','✂️ Salon / Barber'],['fitness','🏋️ Gym / Fitness'],['restaurant','🍽️ Restaurant / Food'],
  ['coffee','☕ Coffee Shop / Café'],['retail','🛍️ Retail / Store'],['clinic','🩺 Clinic / Wellness'],['laundry','🧺 Laundry Shop'],
  ['gas_station','⛽ Gasoline Station'],['car_wash','🚿 Car Wash'],['pharmacy','💊 Pharmacy'],['bakery','🥐 Bakery'],['hotel','🏨 Hotel / Resort'],
  ['other','🏪 Other Business'],['car_lending','🚗 Car Lending / Showroom'],['cockpit','🏆 Cockpit Arena']
]
const businessTypeLabel=v=>BUSINESS_TYPE_OPTIONS.find(([k])=>k===v)?.[1]||'🏪 Other Business'
const kitStatusLabel=s=>({requested:'Requested',paid:'Paid',preparing:'Preparing',ready_to_ship:'Ready to ship',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled'})[String(s||'').toLowerCase()]||'Not requested'
const kitStatusStyle=s=>({requested:{background:'#fff7ed',color:'#9a3412'},paid:{background:'#ecfdf5',color:'#166534'},preparing:{background:'#fefce8',color:'#854d0e'},ready_to_ship:{background:'#eff6ff',color:'#1d4ed8'},shipped:{background:'#eef2ff',color:'#4338ca'},delivered:{background:'#dcfce7',color:'#166534'},cancelled:{background:'#fef2f2',color:'#b91c1c'}}[String(s||'').toLowerCase()]||{background:'#f1f5f9',color:'#64748b'})


function AdminDashboard({ API_BASE, user, onLogout }) {
  const token = user?.token

  const [overview, setOverview] = useState(null)
  const [plans, setPlans] = useState({})
  const [businesses, setBusinesses] = useState([])
  const [pendingApps, setPendingApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [businessTypeFilter,setBusinessTypeFilter]=useState('')
  const [sortByAddress, setSortByAddress] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', phone: '', business_type: 'car_lending', address: '', branch_count: 1 })
  const [creating, setCreating] = useState(false)
  const [partners, setPartners] = useState([])
  const [partnerForm, setPartnerForm] = useState({
    name: '', logo_url: '', sector: '', plan_segment: 'partners',
    website_url: '', is_active: true, sort_order: 0,
  })
  const [partnerUploading, setPartnerUploading] = useState(false)
  const [partnerSaving, setPartnerSaving] = useState(false)
  const [partnerRowUploading, setPartnerRowUploading] = useState(null)
  const [setupKitOrders,setSetupKitOrders]=useState([])
  const [kitSearch,setKitSearch]=useState('')
  const [networkPartners,setNetworkPartners]=useState([])
  const [networkPartnerSaving,setNetworkPartnerSaving]=useState(false)
  const [networkPartnerForm,setNetworkPartnerForm]=useState({name:'',email:'',password:'',partner_type:'city',region:'',city:'',partner_code:'',commission_type:'percent',commission_value:10,is_active:true})
  const [platformAnalytics,setPlatformAnalytics]=useState(null)
  const [analyticsDays,setAnalyticsDays]=useState(30)
  const [analyticsLoading,setAnalyticsLoading]=useState(false)
  const [analyticsError,setAnalyticsError]=useState('')

  const authedFetch = async (path, opts = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        'Authorization': `Bearer ${token}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (res.status === 401) {
      onLogout?.()
      window.location.replace('/login?expired=1')
    }
    return res
  }

  const loadPlatformAnalytics = async () => {
    if (!token) return
    setAnalyticsLoading(true)
    setAnalyticsError('')
    try {
      const res = await authedFetch(`/api/v1/admin/platform-analytics?days=${analyticsDays}`, { cache:'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load platform analytics')
      setPlatformAnalytics(data)
    } catch (err) {
      setAnalyticsError(err.message || 'Could not load platform analytics')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const loadData = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (planFilter) params.set('plan', planFilter)

      const [ovRes, plansRes, bizRes, pendingRes, partnersRes, kitRes, networkPartnersRes] = await Promise.all([
        authedFetch('/api/v1/admin/overview'),
        authedFetch('/api/v1/admin/plans'),
        authedFetch(`/api/v1/admin/businesses?${params.toString()}`),
        authedFetch('/api/v1/admin/businesses?status=PENDING'),
        authedFetch('/api/v1/admin/partners'),
        authedFetch('/api/v1/admin/setup-kit-orders'),
        authedFetch('/api/v1/admin/network-partners'),
      ])
      if (ovRes.status === 401 || bizRes.status === 401) { onLogout(); return }
      setOverview(await ovRes.json().catch(() => null))
      setPlans(await plansRes.json().catch(() => ({})))
      setBusinesses(await bizRes.json().catch(() => []))
      setPendingApps(await pendingRes.json().catch(() => []))
      setPartners(await partnersRes.json().catch(() => []))
      setSetupKitOrders(await kitRes.json().catch(() => []))
      setNetworkPartners(await networkPartnersRes.json().catch(() => []))
    } catch (err) {
      console.error('Admin load error:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    setLoading(true)
    loadData()
  }, [token, statusFilter, planFilter])

  // Debounce search so we're not firing a request per keystroke
  useEffect(() => {
    if (!token) return
    const t = setTimeout(loadData, 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!token) return
    loadPlatformAnalytics()
  }, [token, analyticsDays])

  const openDetail = async (biz) => {
    setSelected(biz)
    setDetail(null)
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${biz.public_id}`)
      setDetail(await res.json())
    } catch (err) {
      console.error(err)
    }
  }

  const updateBusiness = async (public_id, patch) => {
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${public_id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Update failed')
      setMessage(`Updated ${public_id}`)
      loadData()
      if (selected?.public_id === public_id) openDetail(selected)
    } catch (err) {
      setMessage(err.message)
    }
    setTimeout(() => setMessage(''), 3000)
  }

  const approveApplication = (public_id) => updateBusiness(public_id, { status: 'ACTIVE' })
  const rejectApplication = (public_id) => updateBusiness(public_id, { status: 'REJECTED' })

  const deleteBusiness = async (public_id) => {
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${public_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setMessage(`Removed ${public_id}`)
      setConfirmDelete(null)
      setSelected(null)
      setDetail(null)
      loadData()
    } catch (err) {
      setMessage(err.message)
    }
    setTimeout(() => setMessage(''), 3000)
  }

  const createBusiness = async () => {
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password.trim()) {
      setMessage('Name, email, and password are required')
      setTimeout(() => setMessage(''), 3000)
      return
    }
    setCreating(true)
    try {
      const res = await authedFetch('/api/v1/admin/businesses', {
        method: 'POST',
        body: JSON.stringify({
          ...createForm,
          branch_count: Number(createForm.branch_count) || 1,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Creation failed')
      setMessage(`Created ${createForm.name} - share these login details with the owner`)
      setShowCreateModal(false)
      setCreateForm({ name: '', email: '', password: '', phone: '', business_type: 'car_lending', address: '', branch_count: 1 })
      loadData()
    } catch (err) {
      setMessage(err.message)
    }
    setCreating(false)
    setTimeout(() => setMessage(''), 4000)
  }



  const updateSetupKitOrder=async(order,patch)=>{
    try{
      const res=await authedFetch(`/api/v1/admin/setup-kit-orders/${order.public_id}`,{method:'PATCH',body:JSON.stringify(patch)})
      const data=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(data.detail||'Could not update QR kit order')
      setSetupKitOrders(rows=>rows.map(row=>row.public_id===order.public_id?data:row))
      setMessage('QR kit order updated')
    }catch(err){setMessage(err.message)}
  }

  const uploadPartnerImageToCloudinary = async (file) => {
    if (!file) throw new Error('Choose a logo image')
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file')
    if (file.size > 8 * 1024 * 1024) throw new Error('Logo must be under 8 MB')

    const sigRes = await authedFetch('/api/v1/admin/partners/cloudinary-signature', { method: 'POST' })
    const sigText = await sigRes.text()
    let sig = {}
    try { sig = sigText ? JSON.parse(sigText) : {} } catch (_) {}

    if (!sigRes.ok) {
      throw new Error(
        sig.detail ||
        `Could not start logo upload (${sigRes.status}). Check the backend Cloudinary configuration.`
      )
    }
    if (!sig.cloud_name || !sig.api_key || !sig.signature || !sig.timestamp) {
      throw new Error('The backend returned an incomplete Cloudinary upload signature')
    }

    const body = new FormData()
    body.append('file', file)
    body.append('api_key', sig.api_key)
    body.append('timestamp', String(sig.timestamp))
    body.append('signature', sig.signature)
    if (sig.upload_preset) body.append('upload_preset', sig.upload_preset)
    if (sig.folder) body.append('folder', sig.folder)

    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
      method: 'POST',
      body,
    })
    const uploadedText = await uploadRes.text()
    let uploaded = {}
    try { uploaded = uploadedText ? JSON.parse(uploadedText) : {} } catch (_) {}

    if (!uploadRes.ok || !uploaded.secure_url) {
      throw new Error(
        uploaded?.error?.message ||
        `Cloudinary logo upload failed (${uploadRes.status})`
      )
    }
    return uploaded.secure_url
  }

  const uploadPartnerLogo = async (file) => {
    if (!file) return
    setPartnerUploading(true)
    try {
      const logoUrl = await uploadPartnerImageToCloudinary(file)
      setPartnerForm(prev => ({ ...prev, logo_url: logoUrl }))
      setMessage('Partner logo uploaded')
    } catch (err) {
      setMessage(err.message)
    }
    setPartnerUploading(false)
  }

  const replacePartnerLogo = async (partner, file) => {
    if (!file) return
    setPartnerRowUploading(partner.public_id)
    try {
      const logoUrl = await uploadPartnerImageToCloudinary(file)
      await updatePartner(partner, { logo_url: logoUrl })
      setMessage(`${partner.name} logo updated on the homepage`)
    } catch (err) {
      setMessage(err.message)
    }
    setPartnerRowUploading(null)
  }

  const createPartner = async (e) => {
    e.preventDefault()
    if (!partnerForm.name.trim() || !partnerForm.logo_url) return setMessage('Partner name and logo are required')
    setPartnerSaving(true)
    try {
      const res = await authedFetch('/api/v1/admin/partners', {
        method: 'POST',
        body: JSON.stringify({
          ...partnerForm, name: partnerForm.name.trim(),
          sector: partnerForm.sector.trim() || null,
          website_url: partnerForm.website_url.trim() || null,
          sort_order: Number(partnerForm.sort_order) || 0,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not add partner')
      setPartnerForm({ name: '', logo_url: '', sector: '', plan_segment: 'partners', website_url: '', is_active: true, sort_order: 0 })
      setMessage('Partner added to homepage')
      loadData()
    } catch (err) { setMessage(err.message) }
    setPartnerSaving(false)
  }

  const updatePartner = async (partner, patch) => {
    try {
      const res = await authedFetch(`/api/v1/admin/partners/${partner.public_id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Partner update failed')
      loadData()
    } catch (err) { setMessage(err.message) }
  }

  const deletePartner = async (partner) => {
    if (!window.confirm(`Remove ${partner.name} from the homepage?`)) return
    try {
      const res = await authedFetch(`/api/v1/admin/partners/${partner.public_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not remove partner')
      setMessage('Partner removed')
      loadData()
    } catch (err) { setMessage(err.message) }
  }

  if (loading) {
    return <div style={styles.loadingScreen}>Loading platform data…</div>
  }

  const createNetworkPartner=async(e)=>{e.preventDefault();setNetworkPartnerSaving(true);try{const res=await authedFetch('/api/v1/admin/network-partners',{method:'POST',body:JSON.stringify({...networkPartnerForm,commission_value:Number(networkPartnerForm.commission_value)||0,partner_code:networkPartnerForm.partner_code.toUpperCase()})});const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d.detail||'Could not create partner');setNetworkPartnerForm({name:'',email:'',password:'',partner_type:'city',region:'',city:'',partner_code:'',commission_type:'percent',commission_value:10,is_active:true});setMessage('City/region partner created');loadData()}catch(err){setMessage(err.message)}setNetworkPartnerSaving(false)}
  const patchNetworkPartner=async(p,patch)=>{try{const res=await authedFetch(`/api/v1/admin/network-partners/${p.public_id}`,{method:'PATCH',body:JSON.stringify(patch)});const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d.detail||'Partner update failed');setMessage('Partner updated');loadData()}catch(err){setMessage(err.message)}}

  const filteredCount = businesses.length
  const latestKitByBusiness=setupKitOrders.reduce((m,o)=>{if(o.business_public_id&&!m[o.business_public_id])m[o.business_public_id]=o;return m},{})
  const businessKitStatus=b=>latestKitByBusiness[b.public_id]?.fulfillment_status||b.setup_kit_status||(b.setup_kit_requested?(b.setup_kit_paid?'paid':'requested'):'')
  const onboardingLabel=b=>b.onboarding_completed?'Live':(String(b.status||'').toUpperCase()!=='ACTIVE'?'Awaiting payment':b.onboarding_step>=8?'Ready to launch':b.onboarding_step>=7?'Dashboard intro':b.onboarding_step>=6?'Adding team':'Configuring card')
  const joinUrl=b=>b.join_url||`${window.location.origin}/join/${b.public_id}`
  const categoryBusinesses=businessTypeFilter?businesses.filter(b=>b.business_type===businessTypeFilter):businesses
  const displayBusinesses = sortByAddress
    ? [...categoryBusinesses].sort((a, b) => (a.address || '\uffff').localeCompare(b.address || '\uffff'))
    : categoryBusinesses

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={{ fontSize: 28 }}>🌳</span>
          <div>
            <h1 style={styles.brandName}>LoyaltyTree Admin</h1>
            <p style={styles.brandTagline}>{overview?.total_businesses ?? 0} businesses on the platform</p>
          </div>
        </div>
        <button onClick={onLogout} style={styles.logoutBtn}>Log out</button>
      </header>

      {message && <div style={styles.toast}>{message}</div>}

      <div style={styles.body}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={() => setShowCreateModal(true)} style={styles.approveBtn}>+ Create business</button>
        </div>


        <section style={styles.analyticsSection}>
          <div style={styles.analyticsHeader}>
            <div>
              <div style={styles.analyticsEyebrow}>PLATFORM ANALYTICS</div>
              <h2 style={styles.analyticsTitle}>Site visits & conversions</h2>
              <p style={styles.analyticsSubtitle}>First-party LoyaltyTree traffic, applications, customer joins and Wallet actions. No raw IP addresses are stored.</p>
            </div>
            <div style={styles.analyticsControls}>
              <select value={analyticsDays} onChange={e=>setAnalyticsDays(Number(e.target.value))} style={styles.select}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 12 months</option>
              </select>
              <button onClick={loadPlatformAnalytics} disabled={analyticsLoading} style={styles.viewBtn}>{analyticsLoading?'Refreshing…':'↻ Refresh'}</button>
            </div>
          </div>

          {analyticsError && <div style={styles.analyticsError}>{analyticsError}</div>}

          <div style={styles.analyticsMetricGrid}>
            <AnalyticsMetric label="Page views" value={(platformAnalytics?.total_page_views ?? 0).toLocaleString()} hint={`${platformAnalytics?.views_today ?? 0} today`} />
            <AnalyticsMetric label="Unique visitors" value={(platformAnalytics?.unique_visitors ?? 0).toLocaleString()} hint={`${platformAnalytics?.unique_sessions ?? 0} sessions`} />
            <AnalyticsMetric label="Apply clicks" value={(platformAnalytics?.apply_clicks ?? 0).toLocaleString()} hint={`${platformAnalytics?.business_apply_conversion_rate ?? 0}% → signup`} />
            <AnalyticsMetric label="Business signups" value={(platformAnalytics?.business_signups ?? 0).toLocaleString()} hint={`Last ${analyticsDays} days`} />
            <AnalyticsMetric label="Join-page visits" value={(platformAnalytics?.join_page_views ?? 0).toLocaleString()} hint={`${platformAnalytics?.customer_join_conversion_rate ?? 0}% → joined`} />
            <AnalyticsMetric label="Customer joins" value={(platformAnalytics?.customer_join_completions ?? 0).toLocaleString()} hint={`${platformAnalytics?.customers_created ?? 0} customer records created`} />
          </div>

          <div style={styles.analyticsFunnelGrid}>
            <div style={styles.analyticsFunnelCard}>
              <div style={styles.analyticsCardTitle}>Business acquisition</div>
              <div style={styles.analyticsFunnelRow}><span>Apply My Business clicks</span><b>{platformAnalytics?.apply_clicks ?? 0}</b></div>
              <div style={styles.analyticsFunnelArrow}>↓</div>
              <div style={styles.analyticsFunnelRow}><span>Business registrations</span><b>{platformAnalytics?.business_signups ?? 0}</b></div>
              <div style={styles.analyticsConversion}>{platformAnalytics?.business_apply_conversion_rate ?? 0}% conversion</div>
            </div>
            <div style={styles.analyticsFunnelCard}>
              <div style={styles.analyticsCardTitle}>Customer acquisition</div>
              <div style={styles.analyticsFunnelRow}><span>Business join-page visits</span><b>{platformAnalytics?.join_page_views ?? 0}</b></div>
              <div style={styles.analyticsFunnelArrow}>↓</div>
              <div style={styles.analyticsFunnelRow}><span>Completed customer joins</span><b>{platformAnalytics?.customer_join_completions ?? 0}</b></div>
              <div style={styles.analyticsConversion}>{platformAnalytics?.customer_join_conversion_rate ?? 0}% conversion</div>
            </div>
            <div style={styles.analyticsFunnelCard}>
              <div style={styles.analyticsCardTitle}>High-intent actions</div>
              <div style={styles.analyticsFunnelRow}><span>Pricing opens</span><b>{platformAnalytics?.pricing_views ?? 0}</b></div>
              <div style={styles.analyticsFunnelRow}><span>Contact clicks</span><b>{platformAnalytics?.contact_clicks ?? 0}</b></div>
              <div style={styles.analyticsFunnelRow}><span>Google Wallet</span><b>{platformAnalytics?.wallet_google_clicks ?? 0}</b></div>
              <div style={styles.analyticsFunnelRow}><span>Apple Wallet</span><b>{platformAnalytics?.wallet_apple_clicks ?? 0}</b></div>
            </div>
          </div>

          <div style={styles.analyticsTrendCard}>
            <div style={styles.analyticsCardTitle}>Traffic trend</div>
            <div style={styles.analyticsTrend}>
              {(platformAnalytics?.daily || []).map(day => {
                const maxViews=Math.max(1,...(platformAnalytics?.daily||[]).map(d=>Number(d.views||0)))
                const height=Math.max(4,Math.round((Number(day.views||0)/maxViews)*100))
                return <div key={day.date} style={styles.analyticsBarSlot} title={`${day.date}: ${day.views} views · ${day.unique_visitors} unique`}>
                  <div style={{...styles.analyticsBar,height:`${height}%`}} />
                  <span style={styles.analyticsBarLabel}>{String(day.date).slice(5)}</span>
                </div>
              })}
              {!platformAnalytics?.daily?.length && <div style={styles.analyticsEmpty}>Traffic will appear here after the updated tracking is deployed.</div>}
            </div>
          </div>

          <div style={styles.analyticsBreakdownGrid}>
            <AnalyticsBreakdown title="Top pages" rows={platformAnalytics?.top_pages} />
            <AnalyticsBreakdown title="Traffic sources" rows={platformAnalytics?.sources} />
            <AnalyticsBreakdown title="Devices" rows={platformAnalytics?.devices} />
            <AnalyticsBreakdown title="Browsers" rows={platformAnalytics?.browsers} />
          </div>

          <div style={styles.analyticsLocationCard}>
            <div style={styles.analyticsLocationHeader}>
              <div>
                <div style={styles.analyticsCardTitle}>📍 Visitor locations</div>
                <div style={styles.analyticsLocationNote}>
                  Approximate city / province-region from IP analytics only. No GPS permission and no raw IP addresses are stored.
                </div>
              </div>
              <span style={styles.analyticsCoverageBadge}>{platformAnalytics?.geo_coverage_percent ?? 0}% located</span>
            </div>
            <div style={styles.analyticsBreakdownGrid}>
              <AnalyticsBreakdown title="Top provinces / regions" rows={platformAnalytics?.top_regions} />
              <AnalyticsBreakdown title="Top cities" rows={platformAnalytics?.top_cities} />
              <AnalyticsBreakdown title="Top countries" rows={platformAnalytics?.top_countries} />
            </div>
          </div>

          {!!platformAnalytics?.top_business_join_pages?.length && (
            <div style={styles.analyticsListCard}>
              <div style={styles.analyticsCardTitle}>Top business join pages</div>
              {platformAnalytics.top_business_join_pages.map(row=>
                <div key={row.business_id} style={styles.analyticsRankRow}>
                  <span><b>{row.business_name}</b><small style={styles.analyticsRankSub}> /join/{row.business_public_id}</small></span>
                  <b>{row.views.toLocaleString()} visits</b>
                </div>
              )}
            </div>
          )}

          <div style={styles.analyticsListCard}>
            <div style={styles.analyticsCardTitle}>Recent public activity</div>
            {(platformAnalytics?.recent || []).slice(0,12).map((row,i)=>
              <div key={`${row.created_at}-${i}`} style={styles.analyticsRecentRow}>
                <span style={styles.analyticsEventBadge}>{String(row.event_name||'event').replaceAll('_',' ')}</span>
                <span style={styles.analyticsRecentPath}>{row.path || row.page_name || '—'}</span>
                <span style={styles.analyticsRecentMeta}>{row.source || 'direct'} · {row.device_type || 'unknown'}{row.location ? ` · ${row.location}` : ''} · {row.created_at ? new Date(row.created_at).toLocaleString() : ''}</span>
              </div>
            )}
            {!platformAnalytics?.recent?.length && <div style={styles.analyticsEmpty}>No tracked public activity yet.</div>}
          </div>
        </section>


        <section style={styles.partnerAdminSection}>
          <h2 style={styles.partnerAdminTitle}>🌎 Region / City Partner Network</h2>
          <p style={styles.partnerAdminSubtitle}>Create local LoyaltyTree operators with controlled access to assigned businesses, onboarding/setup status and commission activity. They cannot access customer personal data.</p>
          <form onSubmit={createNetworkPartner} style={styles.partnerForm}>
            <div style={styles.partnerFormGrid}>
              <div><label style={styles.partnerLabel}>Partner name</label><input style={styles.input} value={networkPartnerForm.name} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,name:e.target.value})} required/></div>
              <div><label style={styles.partnerLabel}>Login email</label><input style={styles.input} type="email" value={networkPartnerForm.email} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,email:e.target.value})} required/></div>
              <div><label style={styles.partnerLabel}>Temporary password</label><input style={styles.input} type="password" minLength="8" value={networkPartnerForm.password} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,password:e.target.value})} required/></div>
              <div><label style={styles.partnerLabel}>Partner type</label><select style={styles.select} value={networkPartnerForm.partner_type} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,partner_type:e.target.value,city:e.target.value==='region'?'':networkPartnerForm.city})}><option value="city">City Partner</option><option value="region">Region Partner</option></select></div>
              <div><label style={styles.partnerLabel}>Region</label><input style={styles.input} value={networkPartnerForm.region} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,region:e.target.value})} placeholder="Region II" required/></div>
              {networkPartnerForm.partner_type==='city'&&<div><label style={styles.partnerLabel}>City</label><input style={styles.input} value={networkPartnerForm.city} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,city:e.target.value})} placeholder="Cauayan City" required/></div>}
              <div><label style={styles.partnerLabel}>Partner code</label><input style={styles.input} value={networkPartnerForm.partner_code} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,partner_code:e.target.value.toUpperCase()})} placeholder="LT-CAUAYAN" required/></div>
              <div><label style={styles.partnerLabel}>Commission</label><div style={{display:'flex',gap:6}}><select style={{...styles.select,width:110}} value={networkPartnerForm.commission_type} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,commission_type:e.target.value})}><option value="percent">Percent</option><option value="fixed">Fixed ₱</option></select><input style={styles.input} type="number" min="0" step="0.01" value={networkPartnerForm.commission_value} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,commission_value:e.target.value})}/></div></div>
            </div><button style={styles.approveBtn} disabled={networkPartnerSaving}>{networkPartnerSaving?'Creating…':'+ Create local partner'}</button>
          </form>
          <div style={{...styles.partnerList,marginTop:16}}>{networkPartners.map(p=><div key={p.public_id} style={styles.partnerRow}><div style={{flex:1,minWidth:220}}><b>{p.name}</b><div style={{fontSize:12,color:'#64748b',marginTop:4}}>{p.partner_type==='region'?'Region':'City'} · {p.city?`${p.city}, `:''}{p.region}</div><div style={{fontSize:12,color:'#0f766e',fontWeight:700,marginTop:4}}>{p.partner_code} · {p.business_count||0} businesses</div></div><div style={{fontSize:12,minWidth:150}}>Earned <b>₱{Number(p.commission_earned||0).toLocaleString()}</b><br/>Unpaid <b>₱{Number(p.commission_unpaid||0).toLocaleString()}</b></div><button style={p.is_active?styles.rejectBtn:styles.approveBtn} onClick={()=>patchNetworkPartner(p,{is_active:!p.is_active})}>{p.is_active?'Deactivate':'Activate'}</button></div>)}{!networkPartners.length&&<div style={styles.partnerEmpty}>No city or region partners yet.</div>}</div>
        </section>

        <section style={styles.kitAdminSection}>
          <div style={styles.kitAdminHeader}><div><h2 style={styles.partnerAdminTitle}>📦 QR / PR Kit Orders</h2><p style={styles.partnerAdminSubtitle}>Logo, generated QR, delivery address, and fulfillment tracking.</p></div><input style={{...styles.input,maxWidth:300}} value={kitSearch} onChange={e=>setKitSearch(e.target.value)} placeholder="Search kit orders..."/></div>
          <div style={styles.kitOrderGrid}>
            {setupKitOrders.filter(o=>!kitSearch.trim()||[o.business_name,o.recipient_name,o.delivery_address,o.tracking_number,o.fulfillment_status].some(v=>String(v||'').toLowerCase().includes(kitSearch.toLowerCase()))).map(order=><article key={order.public_id} style={styles.kitOrderCard}>
              <div style={styles.kitOrderTop}><div><b>{order.business_name}</b><div style={styles.bizEmail}>{order.business_email}</div></div><span style={styles.kitBadge}>{order.payment_status}</span></div>
              <div style={styles.kitAssets}><div style={styles.kitAssetBox}>{order.logo_url?<img src={order.logo_url} alt="Logo" style={styles.kitLogo}/>:<span>No logo</span>}{order.logo_url&&<a href={order.logo_url} target="_blank" rel="noreferrer" style={styles.kitDownload}>Download logo</a>}</div><div style={styles.kitAssetBox}><img src={order.qr_image_url} alt="QR" style={styles.kitQr}/><a href={order.qr_image_url} target="_blank" rel="noreferrer" style={styles.kitDownload}>Download QR</a></div></div>
              <div style={styles.kitAddress}><b>{order.recipient_name}</b><span>{order.contact_number}</span><span>{order.delivery_address}</span>{order.delivery_instructions&&<em>{order.delivery_instructions}</em>}</div>
              <select style={styles.select} value={order.fulfillment_status||'requested'} onChange={e=>updateSetupKitOrder(order,{fulfillment_status:e.target.value})}><option value="requested">Requested</option><option value="paid">Paid</option><option value="preparing">Preparing</option><option value="ready_to_ship">Ready to ship</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select>
              <input style={styles.input} defaultValue={order.courier||''} placeholder="Courier" onBlur={e=>updateSetupKitOrder(order,{courier:e.target.value.trim()||null})}/>
              <input style={styles.input} defaultValue={order.tracking_number||''} placeholder="Tracking number" onBlur={e=>updateSetupKitOrder(order,{tracking_number:e.target.value.trim()||null})}/>
              <textarea style={{...styles.input,minHeight:65}} defaultValue={order.admin_notes||''} placeholder="Admin notes" onBlur={e=>updateSetupKitOrder(order,{admin_notes:e.target.value.trim()||null})}/>
            </article>)}
          </div>
          {!setupKitOrders.length&&<div style={styles.partnerEmpty}>No QR / PR kit orders yet.</div>}
        </section>

        <section style={styles.partnerAdminSection}>
          <h2 style={styles.partnerAdminTitle}>🤝 Homepage Partners</h2>
          <p style={styles.partnerAdminSubtitle}>
            Add logos to “Thank you for trusting us,” choose the business sector, and place each logo under Partners, Growth Plan, or Starter Plan.
          </p>
          <form onSubmit={createPartner} style={styles.partnerForm}>
            <div style={styles.partnerFormGrid}>
              <div><label style={styles.partnerLabel}>Partner name</label><input style={styles.input} value={partnerForm.name} onChange={e => setPartnerForm({...partnerForm,name:e.target.value})} required /></div>
              <div><label style={styles.partnerLabel}>Sector</label><input style={styles.input} value={partnerForm.sector} onChange={e => setPartnerForm({...partnerForm,sector:e.target.value})} placeholder="Fitness, Restaurant, Retail..." /></div>
              <div><label style={styles.partnerLabel}>Plan section</label><select style={styles.select} value={partnerForm.plan_segment} onChange={e => setPartnerForm({...partnerForm,plan_segment:e.target.value})}><option value="partners">Partners</option><option value="growth">Growth Plan</option><option value="starter">Starter Plan</option></select></div>
              <div><label style={styles.partnerLabel}>Display order</label><input style={styles.input} type="number" min="0" value={partnerForm.sort_order} onChange={e => setPartnerForm({...partnerForm,sort_order:e.target.value})} /></div>
              <div style={{gridColumn:'1 / -1'}}><label style={styles.partnerLabel}>Website (optional)</label><input style={styles.input} value={partnerForm.website_url} onChange={e => setPartnerForm({...partnerForm,website_url:e.target.value})} placeholder="https://..." /></div>
              <div style={{gridColumn:'1 / -1'}}>
                <label style={styles.partnerLabel}>Logo</label>
                <div style={styles.partnerUploadRow}>
                  <input style={styles.input} value={partnerForm.logo_url} onChange={e => setPartnerForm({...partnerForm,logo_url:e.target.value})} placeholder="Upload or paste logo URL" />
                  <label style={styles.partnerUploadBtn}>{partnerUploading?'Uploading…':'📤 Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={partnerUploading} style={{display:'none'}} onChange={e=>{uploadPartnerLogo(e.target.files?.[0]);e.target.value=''}} /></label>
                </div>
                {partnerForm.logo_url && <img src={partnerForm.logo_url} alt="" style={styles.partnerPreview} />}
              </div>
            </div>
            <button type="submit" style={styles.approveBtn} disabled={partnerSaving||partnerUploading}>{partnerSaving?'Adding…':'+ Add homepage partner'}</button>
          </form>
          <div style={styles.partnerList}>
            {[
              { key: 'partners', title: 'Partners', badge: '#1e293b' },
              { key: 'growth', title: 'Growth Plan Partners', badge: '#0d9488' },
              { key: 'starter', title: 'Starter Plan Partners', badge: '#475569' },
            ].map(group => {
              const groupPartners = partners.filter(p => p.plan_segment === group.key)
              return (
                <div key={group.key} style={styles.partnerGroup}>
                  <div style={styles.partnerGroupHeader}>
                    <span style={{...styles.partnerGroupBadge, background: group.badge}}>
                      {group.title}
                    </span>
                    <span style={styles.partnerGroupCount}>{groupPartners.length} partner{groupPartners.length === 1 ? '' : 's'}</span>
                  </div>

                  {groupPartners.length === 0 ? (
                    <div style={styles.partnerEmpty}>No partners assigned to this plan yet.</div>
                  ) : (
                    groupPartners.map(p => (
                      <div key={p.public_id} style={styles.partnerRow}>
                        <div style={styles.partnerLogoManager}>
                          <img src={p.logo_url} alt={`${p.name} logo`} style={styles.partnerRowLogo} />
                          <label style={styles.partnerReplaceLogoBtn}>
                            {partnerRowUploading === p.public_id ? 'Uploading…' : 'Replace logo'}
                            <input
                              type="file"
                              accept="image/*"
                              disabled={partnerRowUploading === p.public_id}
                              style={{display: 'none'}}
                              onChange={e => {
                                replacePartnerLogo(p, e.target.files?.[0])
                                e.target.value = ''
                              }}
                            />
                          </label>
                        </div>

                        <div style={{flex: 1, minWidth: 190}}>
                          <input
                            defaultValue={p.name}
                            onBlur={e => {
                              const value = e.target.value.trim()
                              if (value && value !== p.name) updatePartner(p, {name: value})
                            }}
                            style={{...styles.input, marginBottom: 6, fontWeight: 750}}
                            aria-label="Partner name"
                          />
                          <input
                            defaultValue={p.website_url || ''}
                            onBlur={e => updatePartner(p, {website_url: e.target.value.trim() || null})}
                            placeholder="Website link (optional)"
                            style={{...styles.input, fontSize: 12}}
                          />
                        </div>

                        <div style={styles.partnerRowControls}>
                          <label style={styles.partnerMiniLabel}>Plan section</label>
                          <select
                            value={p.plan_segment}
                            onChange={e => updatePartner(p, {plan_segment: e.target.value})}
                            style={styles.select}
                          >
                            <option value="partners">Partners</option>
                            <option value="growth">Growth Plan</option>
                            <option value="starter">Starter Plan</option>
                          </select>
                        </div>

                        <div style={styles.partnerRowControls}>
                          <label style={styles.partnerMiniLabel}>Sector</label>
                          <input
                            defaultValue={p.sector || ''}
                            onBlur={e => updatePartner(p, {sector: e.target.value.trim() || null})}
                            placeholder="Business sector"
                            style={styles.input}
                          />
                        </div>

                        <div style={{...styles.partnerRowControls, maxWidth: 100}}>
                          <label style={styles.partnerMiniLabel}>Order</label>
                          <input
                            type="number"
                            min="0"
                            defaultValue={p.sort_order || 0}
                            onBlur={e => updatePartner(p, {sort_order: Number(e.target.value) || 0})}
                            style={styles.input}
                          />
                        </div>

                        <div style={styles.partnerActionStack}>
                          <button
                            onClick={() => updatePartner(p, {is_active: !p.is_active})}
                            style={{
                              ...styles.viewBtn,
                              color: p.is_active ? '#166534' : '#64748b',
                              borderColor: p.is_active ? '#86efac' : '#cbd5e1',
                            }}
                          >
                            {p.is_active ? 'Visible on homepage' : 'Hidden'}
                          </button>
                          <button onClick={() => deletePartner(p)} style={styles.deleteBtn}>Remove</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Applications - pending business signups awaiting approval */}
        {pendingApps.length > 0 && (
          <div style={styles.applicationsSection}>
            <h2 style={styles.sectionTitle}>
              Applications <span style={styles.pendingCountBadge}>{pendingApps.length}</span>
            </h2>
            <p style={styles.sectionSubtitle}>New businesses waiting for approval before they can sign in.</p>
            <div style={styles.applicationsList}>
              {pendingApps.map(b => (
                <div key={b.public_id} style={styles.applicationCard}>
                  {b.logo_url && <img src={b.logo_url} alt="" style={styles.bizLogo} />}
                  <div style={styles.applicationInfo}>
                    <div style={styles.bizName}>{b.name}</div>
                    <div style={styles.bizEmail}>{b.email}</div>
                    <div style={styles.bizPhone}>
                      {b.business_type} · {b.created_at ? new Date(b.created_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <div style={styles.applicationActions}>
                    <button onClick={() => openDetail(b)} style={styles.viewBtn}>View</button>
                    <button onClick={() => approveApplication(b.public_id)} style={styles.approveBtn}>Approve</button>
                    <button onClick={() => rejectApplication(b.public_id)} style={styles.rejectBtn}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overview cards */}
        <div style={styles.statsGrid}>
          <StatCard label="Total businesses" value={overview?.total_businesses ?? '—'} />
          <StatCard label="Active" value={overview?.status_breakdown?.ACTIVE ?? 0} accent="#0d9488" />
          <StatCard label="Pending" value={overview?.status_breakdown?.PENDING ?? 0} accent="#d97706" />
          <StatCard label="Suspended" value={overview?.status_breakdown?.SUSPENDED ?? 0} accent="#dc2626" />
          <StatCard label="Rejected" value={overview?.status_breakdown?.REJECTED ?? 0} accent="#64748b" />
          <StatCard label="Total customers" value={overview?.total_customers ?? 0} />
          <StatCard label="Stamps (30d)" value={overview?.stamps_30d ?? 0} />
          <StatCard label="Redemptions (30d)" value={overview?.redemptions_30d ?? 0} />
          {overview?.card_type_breakdown?.points > 0 && (
            <>
              <StatCard label="Points businesses" value={overview.card_type_breakdown.points} accent="#7c3aed" />
              <StatCard label="Points sales (30d)" value={overview?.points_sales_30d ?? 0} accent="#7c3aed" />
              <StatCard label="Points issued (30d)" value={(overview?.points_issued_30d ?? 0).toLocaleString()} accent="#7c3aed" />
              <StatCard label="Points outstanding" value={(overview?.total_points_outstanding ?? 0).toLocaleString()} accent="#7c3aed" />
            </>
          )}
          {overview?.card_type_breakdown?.multipass > 0 && (
            <>
              <StatCard label="Multipass businesses" value={overview.card_type_breakdown.multipass} accent="#d97706" />
              <StatCard label="Sessions issued (30d)" value={(overview?.sessions_issued_30d ?? 0).toLocaleString()} accent="#d97706" />
              <StatCard label="Sessions used (30d)" value={(overview?.sessions_used_30d ?? 0).toLocaleString()} accent="#d97706" />
              <StatCard label="Sessions outstanding" value={(overview?.total_sessions_outstanding ?? 0).toLocaleString()} accent="#d97706" />
            </>
          )}
        </div>

        {overview?.plan_breakdown && (
          <div style={styles.planBar}>
            {Object.entries(overview.plan_breakdown).map(([plan, count]) => (
              <span key={plan} style={styles.planPill}>
                {plans[plan]?.label || plan}{plans[plan]?.price_month != null ? ` · ₱${plans[plan].price_month.toLocaleString()}/mo` : ''}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        )}

        <PlatformAnnouncementsAdmin API_BASE={API_BASE} token={token} />

        {/* Filters */}
        <div style={styles.filterRow}>
          <input
            style={{ ...styles.input, maxWidth: 280 }}
            placeholder="Search by name, email, or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            onClick={() => setSortByAddress(s => !s)}
            style={{ ...styles.select, cursor: 'pointer', background: sortByAddress ? '#0d9488' : 'white', color: sortByAddress ? 'white' : '#334155' }}
          >
            📍 Sort by location{sortByAddress ? ' ✓' : ''}
          </button>
          <select style={styles.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={styles.select} value={planFilter} onChange={e => setPlanFilter(e.target.value)}>
            <option value="">All plans</option>
            {Object.entries(plans).map(([key, p]) => <option key={key} value={key}>{p.label}{p.price_month != null ? ` (₱${p.price_month.toLocaleString()}/mo)` : ''}</option>)}
          </select>
          <select value={businessTypeFilter} onChange={e=>setBusinessTypeFilter(e.target.value)} style={styles.filterSelect}>
            <option value="">All business types</option>
            {BUSINESS_TYPE_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select>
          <span style={styles.resultCount}>{filteredCount} shown</span>
        </div>

        {/* Businesses table */}
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Business</th>
                <th style={styles.th}>Location</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Plan</th>
                <th style={styles.th}>Paid</th>
                <th style={styles.th}>Expires</th>
                <th style={styles.th}>Customers</th>
                <th style={styles.th}>Staff</th>
                <th style={styles.th}>Card</th>
                <th style={styles.th}>PR Kit</th>
                <th style={styles.th}>Onboarding</th>
                <th style={styles.th}>Activity (30d)</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {displayBusinesses.map(b => (
                <tr key={b.public_id} style={styles.tr}>
                  <td style={styles.td}>
                    <div onClick={() => openDetail(b)} style={styles.bizCell}>
                      {b.logo_url && <img src={b.logo_url} alt="" style={styles.bizLogo} />}
                      <div>
                        <div style={styles.bizName}>{b.name}</div>
                        <div style={styles.bizEmail}>{b.email}</div>
                        {b.phone && <div style={styles.bizPhone}>{b.phone}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={styles.td}>
                    {b.address ? <span style={styles.bizPhone}>{b.address}</span> : <span style={styles.resultCount}>—</span>}
                  </td>
                  <td style={styles.td}><span style={styles.categoryBadge}>{businessTypeLabel(b.business_type)}</span></td>
                  <td style={styles.td}>
                    <select
                      value={b.status}
                      onChange={e => updateBusiness(b.public_id, { status: e.target.value })}
                      style={{ ...styles.statusSelect, ...statusStyle(b.status) }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <select
                      value={b.plan}
                      onChange={e => updateBusiness(b.public_id, { plan: e.target.value })}
                      style={styles.planSelect}
                    >
                      {Object.entries(plans).map(([key, p]) => <option key={key} value={key}>{p.label}{p.price_month != null ? ` (₱${p.price_month.toLocaleString()}/mo)` : ''}</option>)}
                    </select>
                    {b.price_month != null && (
                      <div style={styles.rowPriceHint}>₱{b.price_month.toLocaleString()}/mo · {b.branch_count} branch{b.branch_count !== 1 ? 'es' : ''}</div>
                    )}
                  </td>
                  <td style={styles.td}>{b.last_paid_at ? new Date(b.last_paid_at).toLocaleDateString() : '—'}</td>
                  <td style={styles.td}>
                    {b.subscription_expires_at ? (
                      <span style={{ fontWeight: 600, ...subscriptionStatusStyle(b.subscription_status) }}>
                        {new Date(b.subscription_expires_at).toLocaleDateString()}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={styles.td}>{b.customer_count}</td>
                  <td style={styles.td}>{b.staff_count}</td>
                  <td style={styles.td}>
                    <span style={cardTypeBadgeStyle(b.card_type)}>
                      {b.card_type === 'points' ? '⭐ Points' : b.card_type === 'membership' ? '🪪 Membership' : b.card_type === 'vip' ? '👑 VIP' : b.card_type === 'multipass' ? '🎫 Multipass' : '🎟️ Stamp'}
                    </span>
                  </td>
                  <td style={styles.td}><span style={{...styles.kitTableBadge,...kitStatusStyle(businessKitStatus(b))}}>{businessKitStatus(b)==='delivered'?'✓ ':''}{kitStatusLabel(businessKitStatus(b))}</span></td>
                  <td style={styles.td}><span style={styles.onboardingBadge}>{onboardingLabel(b)}</span><div style={styles.rowPriceHint}>Step {b.onboarding_step||0}/9</div></td>
                  <td style={styles.td}>
                    {b.stamps_30d}
                    <div style={styles.rowPriceHint}>
                      {b.card_type === 'points' ? 'points sales' : b.card_type === 'multipass' ? 'sessions used' : 'stamps'}
                      {b.card_type === 'points' && b.points_balance_outstanding != null && (
                        <> · {b.points_balance_outstanding.toLocaleString()} pts outstanding</>
                      )}
                      {b.card_type === 'multipass' && b.sessions_outstanding != null && (
                        <> · {b.sessions_outstanding.toLocaleString()} sessions outstanding</>
                      )}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <button onClick={() => openDetail(b)} style={styles.viewBtn}>View</button>
                    <button onClick={() => setConfirmDelete(b)} style={styles.deleteBtn}>Remove</button>
                  </td>
                </tr>
              ))}
              {displayBusinesses.length === 0 && (
                <tr><td style={styles.td} colSpan={14}>No businesses match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div style={styles.modalOverlay} onClick={() => { setSelected(null); setDetail(null) }}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.businessDetailHero}>{detail?.logo_url?<img src={detail.logo_url} alt="Business logo" style={styles.businessDetailLogo}/>:<div style={styles.businessDetailLogoFallback}>🏪</div>}<div><h2 style={styles.modalTitle}>{detail?.name || selected.name}</h2><div style={styles.bizEmail}>{detail?.contact_person||'No contact person'} · {detail?.business_type?businessTypeLabel(detail.business_type):''}</div></div></div>
            {!detail ? (
              <p>Loading…</p>
            ) : (
              <div style={styles.detailGrid}>
                <DetailRow label="Public ID" value={detail.public_id} />
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Name</span>
                  <input
                    type="text"
                    defaultValue={detail.name || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.name || '') && e.target.value.trim()) {
                        updateBusiness(selected.public_id, { name: e.target.value })
                      }
                    }}
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Email</span>
                  <input
                    type="email"
                    defaultValue={detail.email || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.email || '') && e.target.value.trim()) {
                        updateBusiness(selected.public_id, { email: e.target.value })
                      }
                    }}
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Phone</span>
                  <input
                    type="text"
                    defaultValue={detail.phone || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.phone || '')) {
                        updateBusiness(selected.public_id, { phone: e.target.value })
                      }
                    }}
                    placeholder="No phone on file"
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Contact person</span>
                  <input type="text" defaultValue={detail.contact_person || ''} onBlur={e=>{if(e.target.value!==(detail.contact_person||''))updateBusiness(selected.public_id,{contact_person:e.target.value})}} placeholder="Owner / manager" style={styles.addressInput}/>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Business type</span>
                  <select
                    value={detail.business_type || 'other'}
                    onChange={e => updateBusiness(selected.public_id, { business_type: e.target.value })}
                    style={styles.dateInput}
                  >
                    {BUSINESS_TYPE_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Logo URL</span>
                  <input
                    type="text"
                    defaultValue={detail.logo_url || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.logo_url || '')) {
                        updateBusiness(selected.public_id, { logo_url: e.target.value })
                      }
                    }}
                    placeholder="No logo on file"
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Address</span>
                  <input
                    type="text"
                    defaultValue={detail.address || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.address || '')) {
                        updateBusiness(selected.public_id, { address: e.target.value })
                      }
                    }}
                    placeholder="No address on file"
                    style={styles.addressInput}
                  />
                </div>
                <DetailRow label="Status" value={detail.status} />
                <DetailRow label="Plan" value={detail.plan_label} />
                <DetailRow label="Branches" value={detail.branch_count} />
                <DetailRow label="Onboarding" value={`${onboardingLabel(detail)} · Step ${detail.onboarding_step||0}/9`} />
                <div style={styles.detailRow}><span style={styles.detailLabel}>Customer Join QR</span><div style={styles.joinQrAdmin}><img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl(detail))}`} alt="Business join QR" style={styles.joinQrImage}/><div><button style={styles.viewBtn} onClick={()=>navigator.clipboard?.writeText(joinUrl(detail))}>Copy join link</button><div style={styles.joinUrlText}>{joinUrl(detail)}</div></div></div></div>
                <DetailRow label="Price" value={detail.price_month != null ? `₱${detail.price_month.toLocaleString()}/mo` : '—'} />
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>
                    Announcements/mo
                    {detail.plan_features?.announcements_per_month != null && (
                      <span style={styles.announcementBase}> (plan base: {detail.plan_features.announcements_per_month})</span>
                    )}
                  </span>
                  {detail.plan_features?.announcements_per_month == null ? (
                    <span style={styles.detailValue}>Unlimited</span>
                  ) : (
                    <div style={styles.announcementAdjustRow}>
                      <button
                        type="button"
                        onClick={() => updateBusiness(selected.public_id, { announcement_limit_adjustment: (detail.announcement_limit_adjustment || 0) - 1 })}
                        style={styles.stepBtn}
                      >
                        −
                      </button>
                      <span style={styles.announcementAdjustValue}>
                        {detail.announcements_per_month_effective}
                        {detail.announcement_limit_adjustment ? (
                          <span style={styles.announcementBase}>
                            {' '}({detail.announcement_limit_adjustment > 0 ? '+' : ''}{detail.announcement_limit_adjustment} admin)
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateBusiness(selected.public_id, { announcement_limit_adjustment: (detail.announcement_limit_adjustment || 0) + 1 })}
                        disabled={detail.announcements_per_month_effective >= 99}
                        style={{ ...styles.stepBtn, ...(detail.announcements_per_month_effective >= 99 ? styles.stepBtnDisabled : {}) }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Last paid</span>
                  <input
                    type="date"
                    value={detail.last_paid_at ? detail.last_paid_at.slice(0, 10) : ''}
                    onChange={e => updateBusiness(selected.public_id, { last_paid_at: e.target.value })}
                    style={styles.dateInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Subscription expires</span>
                  <input
                    type="date"
                    value={detail.subscription_expires_at ? detail.subscription_expires_at.slice(0, 10) : ''}
                    onChange={e => updateBusiness(selected.public_id, { subscription_expires_at: e.target.value })}
                    style={styles.dateInput}
                  />
                </div>
                {detail.subscription_expires_at && (
                  <DetailRow
                    label="Subscription status"
                    value={<span style={subscriptionStatusStyle(detail.subscription_status)}>{subscriptionStatusLabel(detail.subscription_status)}</span>}
                  />
                )}
                <DetailRow label="Customers" value={detail.customer_count} />
                <DetailRow label="Staff" value={detail.staff_count} />
                <DetailRow label="Card type" value={detail.card_type === 'points' ? '⭐ Points' : detail.card_type === 'multipass' ? '🎫 Multipass' : '🎟️ Stamp'} />
                {detail.card_type === 'points' ? (
                  <>
                    <DetailRow label="Points sales (30d)" value={detail.stamps_30d} />
                    <DetailRow label="Points issued (30d)" value={(detail.points_issued_30d ?? 0).toLocaleString()} />
                    <DetailRow label="Points outstanding" value={(detail.points_balance_outstanding ?? 0).toLocaleString()} />
                  </>
                ) : detail.card_type === 'multipass' ? (
                  <>
                    <DetailRow label="Sessions issued (30d)" value={(detail.sessions_issued_30d ?? 0).toLocaleString()} />
                    <DetailRow label="Sessions used (30d)" value={(detail.sessions_used_30d ?? 0).toLocaleString()} />
                    <DetailRow label="Sessions outstanding" value={(detail.sessions_outstanding ?? 0).toLocaleString()} />
                  </>
                ) : (
                  <DetailRow label="Stamps (30d)" value={detail.stamps_30d} />
                )}
                <DetailRow label="Redemptions (30d)" value={detail.redemptions_30d} />
                <DetailRow label="Created" value={detail.created_at ? new Date(detail.created_at).toLocaleDateString() : '—'} />
                {detail.loyalty_program && detail.card_type === 'points' ? (
                  <>
                    <DetailRow label="Points rate" value={`${detail.loyalty_program.points_per_amount ?? 0} pts per ₱${detail.loyalty_program.points_amount_pesos ?? 0}`} />
                    {(detail.loyalty_program.points_prizes || []).length > 0 && (
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Prize catalog</span>
                        <div style={{ textAlign: 'right' }}>
                          {detail.loyalty_program.points_prizes.map((p, i) => (
                            <div key={p.id || i} style={styles.detailValue}>
                              {p.name} — {p.points_cost} pts
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : detail.loyalty_program && detail.card_type === 'multipass' ? (
                  <>
                    <DetailRow label="Sessions per pass" value={detail.loyalty_program.multipass_session_count} />
                    <DetailRow label="Pass validity" value={`${detail.loyalty_program.multipass_validity_days ?? 0} days`} />
                    {detail.loyalty_program.description && (
                      <DetailRow label="What sessions are for" value={detail.loyalty_program.description} />
                    )}
                  </>
                ) : detail.loyalty_program && (
                  <>
                    <DetailRow label="Reward" value={detail.loyalty_program.reward_name} />
                    <DetailRow label="Stamp goal" value={detail.loyalty_program.stamp_goal} />
                  </>
                )}
              </div>
            )}
            <button onClick={() => { setSelected(null); setDetail(null) }} style={styles.closeBtn}>Close</button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={styles.modalOverlay} onClick={() => setConfirmDelete(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Remove {confirmDelete.name}?</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>
              This permanently deletes the business along with its customers, staff, announcements, and stamp/redemption history. This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button onClick={() => deleteBusiness(confirmDelete.public_id)} style={styles.confirmDeleteBtn}>
                Yes, delete permanently
              </button>
              <button onClick={() => setConfirmDelete(null)} style={styles.closeBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Create business (admin-provisioned, e.g. invite-only types like Car Lending) */}
      {showCreateModal && (
        <div style={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Create business</h2>
            <div style={styles.detailGrid}>
              <input style={styles.input} placeholder="Business name" value={createForm.name}
                onChange={e => setCreateForm({ ...createForm, name: e.target.value })} />
              <input style={styles.input} placeholder="Email (login)" value={createForm.email}
                onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
              <input style={styles.input} placeholder="Temporary password" value={createForm.password}
                onChange={e => setCreateForm({ ...createForm, password: e.target.value })} />
              <input style={styles.input} placeholder="Phone (optional)" value={createForm.phone}
                onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} />
              <input style={styles.input} placeholder="Address (optional)" value={createForm.address}
                onChange={e => setCreateForm({ ...createForm, address: e.target.value })} />
              <select style={styles.select} value={createForm.business_type}
                onChange={e => setCreateForm({ ...createForm, business_type: e.target.value })}>
                {BUSINESS_TYPE_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select>
              <input style={styles.input} type="number" min="1" placeholder="Branch count" value={createForm.branch_count}
                onChange={e => setCreateForm({ ...createForm, branch_count: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button onClick={createBusiness} disabled={creating} style={styles.approveBtn}>
                {creating ? 'Creating…' : 'Create business'}
              </button>
              <button onClick={() => setShowCreateModal(false)} style={styles.closeBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function AnalyticsMetric({label,value,hint}) {
  return <div style={styles.analyticsMetricCard}>
    <div style={styles.analyticsMetricLabel}>{label}</div>
    <div style={styles.analyticsMetricValue}>{value}</div>
    <div style={styles.analyticsMetricHint}>{hint}</div>
  </div>
}

function AnalyticsBreakdown({title,rows=[]}) {
  const max=Math.max(1,...(rows||[]).map(r=>Number(r.count||0)))
  return <div style={styles.analyticsBreakdownCard}>
    <div style={styles.analyticsCardTitle}>{title}</div>
    {(rows||[]).slice(0,8).map(row=><div key={row.label} style={styles.analyticsBreakdownRow}>
      <div style={styles.analyticsBreakdownLabel}><span>{row.label || 'Unknown'}</span><b>{Number(row.count||0).toLocaleString()}</b></div>
      <div style={styles.analyticsBreakdownTrack}><div style={{...styles.analyticsBreakdownFill,width:`${Math.max(3,(Number(row.count||0)/max)*100)}%`}} /></div>
    </div>)}
    {!rows?.length&&<div style={styles.analyticsEmpty}>No data yet.</div>}
  </div>
}

function StatCard({ label, value, accent }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color: accent || '#0f172a' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={styles.detailValue}>{value}</span>
    </div>
  )
}

function statusStyle(status) {
  if (status === 'ACTIVE') return { background: '#dcfce7', color: '#166534' }
  if (status === 'SUSPENDED') return { background: '#fee2e2', color: '#991b1b' }
  if (status === 'REJECTED') return { background: '#f1f5f9', color: '#475569' }
  return { background: '#fef3c7', color: '#92400e' }
}

function cardTypeBadgeStyle(cardType) {
  const base = {
    display: 'inline-block', padding: '3px 9px', borderRadius: 20,
    fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
  }
  if (cardType === 'points') return { ...base, background: '#ede9fe', color: '#6d28d9' }
  if (cardType === 'multipass') return { ...base, background: '#fef3c7', color: '#92400e' }
  return { ...base, background: '#f1f5f9', color: '#475569' }
}

function subscriptionStatusStyle(status) {
  if (status === 'expired') return { color: '#dc2626' }
  if (status === 'expiring_soon') return { color: '#d97706' }
  if (status === 'active') return { color: '#0d9488' }
  return { color: '#94a3b8' }
}

function subscriptionStatusLabel(status) {
  if (status === 'expired') return 'Expired'
  if (status === 'expiring_soon') return 'Expiring soon'
  if (status === 'active') return 'Active'
  return 'No expiry set'
}

const styles = {
  loginContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loginCard: {
    background: 'white',
    borderRadius: 16,
    padding: 40,
    width: 360,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  loginBrand: { textAlign: 'center', marginBottom: 24 },
  loginTitle: { margin: '8px 0 4px', fontSize: 22, fontWeight: 700, color: '#0f172a' },
  loginSubtitle: { margin: 0, fontSize: 13, color: '#64748b' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  loginBtn: {
    padding: '12px', background: '#0f172a', color: 'white', border: 'none',
    borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 8,
  },
  errorText: { color: '#dc2626', fontSize: 13, margin: 0 },
  loadingScreen: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#64748b', fontSize: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 24px', background: '#0f172a', color: 'white',
    position: 'sticky', top: 0, zIndex: 100,
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  brandName: { margin: 0, fontSize: 18, fontWeight: 700, color: 'white' },
  brandTagline: { margin: 0, fontSize: 12, color: '#94a3b8' },
  logoutBtn: {
    padding: '8px 16px', background: 'transparent', color: '#cbd5e1',
    border: '1px solid #334155', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  toast: {
    position: 'fixed', top: 80, right: 24, padding: '12px 20px', background: '#0d9488',
    color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 200,
  },
  body: { padding: '24px', maxWidth: 1200, margin: '0 auto' },
  partnerAdminSection: { background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding:20, marginBottom:20, boxShadow:'0 8px 24px rgba(15,23,42,.04)' },
  partnerAdminTitle: { margin:0, fontSize:17, color:'#0f172a' },
  partnerAdminSubtitle: { margin:'5px 0 16px', color:'#64748b', fontSize:13, lineHeight:1.5 },
  partnerForm: { borderTop:'1px solid #f1f5f9', paddingTop:16 },
  partnerFormGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:14 },
  partnerLabel: { display:'block', marginBottom:5, fontSize:12, fontWeight:700, color:'#334155' },
  partnerUploadRow: { display:'flex', gap:8, alignItems:'stretch' },
  partnerUploadBtn: { display:'flex', alignItems:'center', justifyContent:'center', whiteSpace:'nowrap', padding:'0 15px', background:'#f0fdfa', color:'#0f766e', border:'1px solid #99f6e4', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer' },
  partnerPreview: { width:76, height:58, objectFit:'contain', marginTop:8, borderRadius:8, border:'1px solid #e2e8f0', background:'#f8fafc', padding:5 },
  partnerList: { display:'flex', flexDirection:'column', gap:18, marginTop:18 },
  partnerGroup: { border:'1px solid #e2e8f0', borderRadius:14, padding:14, background:'#f8fafc' },
  partnerGroupHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:12 },
  partnerGroupBadge: { color:'white', borderRadius:999, padding:'6px 12px', fontSize:12, fontWeight:800 },
  partnerGroupCount: { color:'#64748b', fontSize:12, fontWeight:700 },
  partnerEmpty: { padding:'18px 12px', borderRadius:10, background:'white', color:'#94a3b8', fontSize:13, textAlign:'center' },
  partnerRow: { display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', border:'1px solid #e2e8f0', borderRadius:12, padding:12, background:'white', marginTop:8 },
  partnerLogoManager: { width:94, display:'flex', flexDirection:'column', alignItems:'stretch', gap:6 },
  partnerRowLogo: { width:82, height:62, objectFit:'contain', background:'#f8fafc', borderRadius:9, border:'1px solid #e2e8f0', padding:6 },
  partnerReplaceLogoBtn: { display:'block', textAlign:'center', padding:'6px 7px', background:'#f0fdfa', color:'#0f766e', border:'1px solid #99f6e4', borderRadius:7, fontSize:10.5, fontWeight:800, cursor:'pointer' },
  partnerRowControls: { width:155, minWidth:135 },
  partnerMiniLabel: { display:'block', marginBottom:4, fontSize:10.5, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:.35 },
  partnerActionStack: { display:'flex', flexDirection:'column', gap:6, marginLeft:'auto' },

  applicationsSection: {
    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14,
    padding: '18px 20px', marginBottom: 20,
  },
  sectionTitle: {
    margin: 0, fontSize: 16, fontWeight: 700, color: '#92400e',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  pendingCountBadge: {
    background: '#f59e0b', color: 'white', borderRadius: 999,
    fontSize: 12, fontWeight: 700, padding: '2px 9px',
  },
  sectionSubtitle: { margin: '4px 0 14px', fontSize: 13, color: '#b45309' },
  applicationsList: { display: 'flex', flexDirection: 'column', gap: 10 },
  applicationCard: {
    display: 'flex', alignItems: 'center', gap: 12, background: 'white',
    border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px',
    flexWrap: 'wrap',
  },
  applicationInfo: { flex: 1, minWidth: 180 },
  applicationActions: { display: 'flex', gap: 8, flexShrink: 0 },
  approveBtn: {
    padding: '6px 14px', background: '#0d9488', color: 'white',
    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  rejectBtn: {
    padding: '6px 14px', background: 'transparent', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 12, marginBottom: 16,
  },
  statCard: {
    background: 'white', borderRadius: 12, padding: '16px 18px',
    border: '1px solid #e2e8f0',
  },
  statValue: { fontSize: 24, fontWeight: 700 },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  planBar: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  planPill: {
    padding: '6px 12px', background: '#ccfbf1', color: '#0f766e',
    borderRadius: 20, fontSize: 12, fontWeight: 600,
  },
  filterRow: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  resultCount: { fontSize: 12, color: '#94a3b8', marginLeft: 'auto' },
  input: {
    padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  select: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 13, background: 'white', cursor: 'pointer',
  },
  tableWrap: { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left', padding: '12px 16px', fontSize: 12, fontWeight: 600,
    color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '12px 16px', fontSize: 13, color: '#0f172a', verticalAlign: 'middle' },
  bizCell: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  bizLogo: { width: 32, height: 32, borderRadius: 8, objectFit: 'cover' },
  bizName: { fontWeight: 600, fontSize: 13 },
  bizEmail: { fontSize: 12, color: '#94a3b8' },
  bizPhone: { fontSize: 12, color: '#94a3b8' },
  statusSelect: {
    padding: '4px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
  },
  planSelect: {
    padding: '4px 8px', borderRadius: 8, fontSize: 12, border: '1px solid #e2e8f0',
    background: '#f8fafc', cursor: 'pointer',
  },
  rowPriceHint: {
    fontSize: 11, color: '#94a3b8', marginTop: 4,
  },
  viewBtn: {
    padding: '6px 10px', background: 'transparent', color: '#0d9488',
    border: '1px solid #a7f3d0', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginRight: 6,
  },
  deleteBtn: {
    padding: '6px 10px', background: 'transparent', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16,
  },
  modal: {
    background: 'white', borderRadius: 16, padding: 28, width: 440,
    maxHeight: '85vh', overflow: 'auto',
  },
  modalTitle: { margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#0f172a' },
  detailGrid: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 },
  detailRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: 13,
    padding: '6px 0', borderBottom: '1px solid #f1f5f9',
  },
  detailLabel: { color: '#64748b' },
  detailValue: { color: '#0f172a', fontWeight: 600 },
  dateInput: {
    padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 12, color: '#0f172a', cursor: 'pointer',
  },
  addressInput: {
    padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 12, color: '#0f172a', width: 200, textAlign: 'right',
  },
  announcementAdjustRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  announcementAdjustValue: {
    color: '#0f172a', fontWeight: 600, fontSize: 13, minWidth: 20, textAlign: 'center',
  },
  announcementBase: {
    color: '#94a3b8', fontWeight: 400, fontSize: 11.5,
  },
  stepBtn: {
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: '1px solid #e2e8f0', borderRadius: 6, background: 'white',
    color: '#334155', fontSize: 14, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
  },
  stepBtnDisabled: {
    color: '#cbd5e1', cursor: 'not-allowed', background: '#f8fafc',
  },
  closeBtn: {
    padding: '10px 16px', background: '#f1f5f9', color: '#334155',
    border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  confirmDeleteBtn: {
    padding: '10px 16px', background: '#dc2626', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: 1,
  },
  kitAdminSection:{background:'#fff',border:'1px solid #99f6e4',borderRadius:18,padding:22,marginBottom:24},
  kitAdminHeader:{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap',marginBottom:16},
  kitOrderGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(330px,1fr))',gap:16},
  kitOrderCard:{border:'1px solid #e2e8f0',borderRadius:15,padding:15,display:'flex',flexDirection:'column',gap:9},
  kitOrderTop:{display:'flex',justifyContent:'space-between',gap:10},
  kitBadge:{padding:'5px 9px',borderRadius:999,background:'#dcfce7',color:'#166534',fontSize:10,fontWeight:900,textTransform:'uppercase'},
  kitAssets:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9},
  kitAssetBox:{minHeight:125,background:'#f8fafc',borderRadius:10,padding:9,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'#94a3b8',fontSize:11},
  kitLogo:{maxWidth:'100%',maxHeight:70,objectFit:'contain'},
  kitQr:{width:92,height:92},
  kitDownload:{color:'#0d9488',fontSize:11,fontWeight:800,textDecoration:'none'},
  kitAddress:{display:'flex',flexDirection:'column',gap:3,background:'#f0fdfa',borderRadius:10,padding:11,fontSize:12,lineHeight:1.45},
  categoryBadge:{display:'inline-flex',padding:'5px 8px',borderRadius:999,background:'#f8fafc',border:'1px solid #e2e8f0',fontSize:10.5,fontWeight:800,color:'#475569',whiteSpace:'nowrap'},
  kitTableBadge:{display:'inline-flex',padding:'5px 8px',borderRadius:999,fontSize:10.5,fontWeight:800,whiteSpace:'nowrap'},
  analyticsSection:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:18,padding:20,marginBottom:22,boxShadow:'0 12px 34px rgba(15,23,42,.05)'},
  analyticsHeader:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginBottom:18},
  analyticsEyebrow:{fontSize:10,fontWeight:850,letterSpacing:1.3,color:'#0f766e',marginBottom:5},
  analyticsTitle:{margin:0,fontSize:22,color:'#0f172a',letterSpacing:'-.3px'},
  analyticsSubtitle:{margin:'6px 0 0',fontSize:12.5,color:'#64748b',lineHeight:1.55,maxWidth:760},
  analyticsControls:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'},
  analyticsError:{padding:'11px 13px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:10,fontSize:12.5,marginBottom:14},
  analyticsMetricGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:14},
  analyticsLocationCard:{background:'#f8fafc',border:'1px solid #dbe4ea',borderRadius:15,padding:14,margin:'14px 0'},
  analyticsLocationHeader:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:12,flexWrap:'wrap'},
  analyticsLocationNote:{fontSize:12,color:'#64748b',lineHeight:1.5,marginTop:4,maxWidth:720},
  analyticsCoverageBadge:{display:'inline-flex',alignItems:'center',padding:'6px 9px',borderRadius:999,background:'#ecfdf5',color:'#047857',fontSize:11,fontWeight:800,whiteSpace:'nowrap'},

  analyticsMetricCard:{border:'1px solid #e2e8f0',borderRadius:13,padding:'14px 15px',background:'#f8fafc'},
  analyticsMetricLabel:{fontSize:10.5,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:.55},
  analyticsMetricValue:{fontSize:28,fontWeight:850,color:'#0f172a',marginTop:4,lineHeight:1.1},
  analyticsMetricHint:{fontSize:10.5,color:'#94a3b8',marginTop:5},
  analyticsFunnelGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:10,marginBottom:14},
  analyticsFunnelCard:{border:'1px solid #e2e8f0',borderRadius:13,padding:15,background:'#fff'},
  analyticsCardTitle:{fontSize:12.5,fontWeight:800,color:'#0f172a',marginBottom:11},
  analyticsFunnelRow:{display:'flex',justifyContent:'space-between',gap:12,fontSize:12.5,color:'#475569',padding:'5px 0'},
  analyticsFunnelArrow:{textAlign:'center',color:'#94a3b8',fontSize:12},
  analyticsConversion:{marginTop:8,padding:'7px 9px',borderRadius:8,background:'#ecfdf5',color:'#0f766e',fontSize:11,fontWeight:800,textAlign:'center'},
  analyticsTrendCard:{border:'1px solid #e2e8f0',borderRadius:13,padding:15,marginBottom:14,overflow:'hidden'},
  analyticsTrend:{height:170,display:'flex',alignItems:'flex-end',gap:4,overflowX:'auto',paddingTop:12},
  analyticsBarSlot:{height:'100%',minWidth:18,flex:'1 0 18px',maxWidth:34,display:'flex',flexDirection:'column',justifyContent:'flex-end',alignItems:'stretch',gap:5},
  analyticsBar:{minHeight:4,borderRadius:'6px 6px 2px 2px',background:'linear-gradient(180deg,#14b8a6,#0f766e)'},
  analyticsBarLabel:{fontSize:8.5,color:'#94a3b8',textAlign:'center',whiteSpace:'nowrap'},
  analyticsBreakdownGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginBottom:14},
  analyticsBreakdownCard:{border:'1px solid #e2e8f0',borderRadius:13,padding:15,minWidth:0},
  analyticsBreakdownRow:{marginBottom:9},
  analyticsBreakdownLabel:{display:'flex',justifyContent:'space-between',gap:10,fontSize:11.5,color:'#475569',marginBottom:4,overflow:'hidden'},
  analyticsBreakdownTrack:{height:5,borderRadius:99,background:'#f1f5f9',overflow:'hidden'},
  analyticsBreakdownFill:{height:'100%',borderRadius:99,background:'#14b8a6'},
  analyticsListCard:{border:'1px solid #e2e8f0',borderRadius:13,padding:15,marginTop:10},
  analyticsRankRow:{display:'flex',justifyContent:'space-between',gap:12,padding:'9px 0',borderBottom:'1px solid #f1f5f9',fontSize:12.5,color:'#334155'},
  analyticsRankSub:{display:'block',fontWeight:400,color:'#94a3b8',marginTop:2},
  analyticsRecentRow:{display:'grid',gridTemplateColumns:'150px minmax(160px,1fr) minmax(220px,1.4fr)',gap:10,alignItems:'center',padding:'8px 0',borderBottom:'1px solid #f1f5f9',fontSize:11.5},
  analyticsEventBadge:{display:'inline-block',background:'#ecfdf5',color:'#0f766e',borderRadius:999,padding:'4px 8px',fontWeight:750,textTransform:'capitalize',width:'fit-content'},
  analyticsRecentPath:{color:'#334155',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  analyticsRecentMeta:{color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  analyticsEmpty:{fontSize:12,color:'#94a3b8',padding:'12px 0'},

  onboardingBadge:{display:'inline-block',padding:'5px 8px',borderRadius:999,background:'#ecfdf5',color:'#0f766e',fontSize:10.5,fontWeight:800,whiteSpace:'nowrap'},
  businessDetailHero:{display:'flex',alignItems:'center',gap:14,marginBottom:18},
  businessDetailLogo:{width:64,height:64,borderRadius:14,objectFit:'contain',border:'1px solid #e2e8f0',background:'#fff'},
  businessDetailLogoFallback:{width:64,height:64,borderRadius:14,display:'grid',placeItems:'center',fontSize:28,background:'#f1f5f9'},
  joinQrAdmin:{display:'flex',gap:12,alignItems:'center',justifyContent:'flex-end',flexWrap:'wrap'},
  joinQrImage:{width:112,height:112,borderRadius:10,border:'1px solid #e2e8f0'},
  joinUrlText:{maxWidth:250,fontSize:10,color:'#94a3b8',wordBreak:'break-all',marginTop:6},

}

export default AdminDashboard

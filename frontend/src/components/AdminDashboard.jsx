import React, { useState, useEffect } from 'react'
import PlatformAnnouncementsAdmin from './PlatformAnnouncementsAdmin'
import GiftCardPrintRequestsAdmin from './GiftCardPrintRequestsAdmin'

const STATUS_OPTIONS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']

const BUSINESS_TYPE_OPTIONS=[
  ['spa','🌿 Spa'],['salon','✂️ Salon / Barber'],['fitness','🏋️ Gym / Fitness'],['restaurant','🍽️ Restaurant / Food'],
  ['coffee','☕ Coffee Shop / Café'],['retail','🛍️ Retail / Store'],['clinic','🩺 Clinic / Wellness'],['laundry','🧺 Laundry Shop'],
  ['gas_station','⛽ Gasoline Station'],['car_wash','🚿 Car Wash'],['pharmacy','💊 Pharmacy'],['bakery','🥐 Bakery'],['hotel','🏨 Hotel / Resort'],
  ['other','🏪 Other Business'],['car_lending','🚗 Car Lending / Showroom'],['lending','💼 Lending / Loan Management'],['cockpit','🏆 Cockpit Arena']
]
const businessTypeLabel=v=>BUSINESS_TYPE_OPTIONS.find(([k])=>k===v)?.[1]||'🏪 Other Business'
const kitStatusLabel=s=>({requested:'Requested',paid:'Paid',preparing:'Preparing',ready_to_ship:'Ready to ship',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled'})[String(s||'').toLowerCase()]||'Not requested'
const kitStatusStyle=s=>({requested:{background:'#fff7ed',color:'#9a3412'},paid:{background:'#ecfdf5',color:'#166534'},preparing:{background:'#fefce8',color:'#854d0e'},ready_to_ship:{background:'#eff6ff',color:'#1d4ed8'},shipped:{background:'#eef2ff',color:'#4338ca'},delivered:{background:'#dcfce7',color:'#166534'},cancelled:{background:'#fef2f2',color:'#b91c1c'}}[String(s||'').toLowerCase()]||{background:'#f1f5f9',color:'#64748b'})

const SPECIAL_BILLING_CYCLE_MONTHS={monthly:1,'3_months':3,'6_months':6,annual:12}
function specialInvoicePreview(f){
  const months=SPECIAL_BILLING_CYCLE_MONTHS[f.billing_cycle]||1
  const monthly=f.pricing_model==='per_branch'?Number(f.monthly_rate||0)*Number(f.contracted_branch_count||1):Number(f.monthly_rate||0)
  const cycle=f.cycle_amount_override!==''?Number(f.cycle_amount_override||0):monthly*months
  const commercial=Math.max(0,cycle+Number(f.setup_fee||0))
  const rate=Number(f.vat_rate||0)
  if(f.tax_treatment!=='vat_registered'||rate<=0)return {net:commercial,vat:0,total:commercial}
  if(f.price_includes_vat){
    const net=commercial/(1+rate/100)
    return {net,vat:commercial-net,total:commercial}
  }
  const vat=commercial*rate/100
  return {net:commercial,vat,total:commercial+vat}
}
const specialBillingCycleLabel=v=>({monthly:'Monthly','3_months':'3 Months','6_months':'6 Months',annual:'Annual'})[v]||v

const OA_DESIGN_DEFAULTS = {
  template:'modern', primary_color:'#0f766e', background_color:'#f8fafc', surface_color:'#ffffff', text_color:'#0f172a', muted_color:'#64748b',
  header_style:'logo_name', logo_shape:'rounded', branch_card_style:'soft', button_style:'text', show_banner:true, show_greeting:true,
  branch_heading:'Which branch will you pick up from?', branch_cta_label:'Choose branch', category_style:'pills', product_layout:'image_top', image_shape:'rounded',
  product_card_style:'soft', add_button_style:'plus', show_product_description:true, sticky_cart:true, menu_heading:'Menu',
}


function AdminDashboard({ API_BASE, user, onLogout }) {
  const token = user?.token
  const [activeAdminTab, setActiveAdminTab] = useState('overview')

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
  const [orderAheadAdmin, setOrderAheadAdmin] = useState(null)
  const [orderAheadSaving, setOrderAheadSaving] = useState(false)
  const [orderAheadDesign, setOrderAheadDesign] = useState({...OA_DESIGN_DEFAULTS})
  const [showOrderAheadDesign, setShowOrderAheadDesign] = useState(false)
  const [orderAheadDesignSaving, setOrderAheadDesignSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [passwordResetSending, setPasswordResetSending] = useState('')
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
  const [partnerExpenses,setPartnerExpenses]=useState([])
  const [expenseReviewing,setExpenseReviewing]=useState('')
  const [specialBusinesses,setSpecialBusinesses]=useState([])
  const [specialInvoices,setSpecialInvoices]=useState([])
  const [specialSaving,setSpecialSaving]=useState(false)
  const [specialInvoiceBusy,setSpecialInvoiceBusy]=useState('')
  const [paymentReceivedModal,setPaymentReceivedModal]=useState(null)
  const [paymentReceivedSaving,setPaymentReceivedSaving]=useState(false)
  const [paymentReceivedForm,setPaymentReceivedForm]=useState({
    payment_date:new Date().toISOString().slice(0,10),
    payment_method:'bank_transfer',
    payment_reference:'',
    amount_received:'',
    remarks:'',
  })
  const [editingSpecialId,setEditingSpecialId]=useState('')
  const [specialForm,setSpecialForm]=useState({
    business_name:'',business_email:'',business_password:'',business_phone:'',business_type:'other',business_address:'',feature_plan:'pro',
    billing_email:'',billing_contact_name:'',billing_tin:'',billing_address:'',
    pricing_model:'flat',contracted_branch_count:1,monthly_rate:0,cycle_amount_override:'',setup_fee:0,billing_cycle:'monthly',due_days:7,
    tax_treatment:'non_vat',vat_rate:12,price_includes_vat:false,vat_exemption_basis:'',
    auto_invoice:true,next_invoice_date:new Date().toISOString().slice(0,10),
    contract_start_date:new Date().toISOString().slice(0,10),contract_end_date:'',
    invoice_description:'LoyaltyTree custom service subscription',payment_instructions:'',is_active:true,
  })
  const [networkPartnerSaving,setNetworkPartnerSaving]=useState(false)
  const [networkPartnerForm,setNetworkPartnerForm]=useState({name:'',email:'',password:'',partner_type:'city',region:'',province:'',city:'',partner_code:'',commission_type:'percent',commission_value:10,is_active:true})
  const [networkPartnerAssignForm,setNetworkPartnerAssignForm]=useState({partner_public_id:'',business_public_id:''})
  const [networkPartnerAssigning,setNetworkPartnerAssigning]=useState(false)
  const [platformAnalytics,setPlatformAnalytics]=useState(null)
  const [analyticsDays,setAnalyticsDays]=useState(30)
  const [analyticsLoading,setAnalyticsLoading]=useState(false)
  const [analyticsError,setAnalyticsError]=useState('')
  const [clientPerformance,setClientPerformance]=useState(null)
  const [clientPerfDays,setClientPerfDays]=useState(30)
  const [clientPerfLoading,setClientPerfLoading]=useState(false)
  const [clientPerfError,setClientPerfError]=useState('')
  const [clientPerfTypeFilter,setClientPerfTypeFilter]=useState('')
  const [clientPerfTrendFilter,setClientPerfTrendFilter]=useState('')
  const [showClientPresentation,setShowClientPresentation]=useState(false)
  const [presentationAnonymized,setPresentationAnonymized]=useState(true)
  const [referralSearch,setReferralSearch]=useState('')
  const [referralData,setReferralData]=useState(null)
  const [referralLoading,setReferralLoading]=useState(false)
  const [referralError,setReferralError]=useState('')

  const [helpInsights,setHelpInsights]=useState(null)
  const [helpDays,setHelpDays]=useState(30)
  const [helpLoading,setHelpLoading]=useState(false)
  const [helpError,setHelpError]=useState('')
  const [helpReviewing,setHelpReviewing]=useState('')

  const [walletRefresh,setWalletRefresh]=useState({busy:false,msg:'',businessId:'',apple:true})
  const runWalletRefresh = async () => {
    const scope = walletRefresh.businessId.trim() || 'ALL active businesses'
    if (!window.confirm(`Refresh every issued wallet card for ${scope}${walletRefresh.apple ? ' (including Apple push)' : ' (Google only)'}?`)) return
    setWalletRefresh(w=>({...w,busy:true,msg:''}))
    try {
      const qs = new URLSearchParams()
      if (walletRefresh.businessId.trim()) qs.set('business_public_id', walletRefresh.businessId.trim())
      qs.set('apple', walletRefresh.apple ? 'true' : 'false')
      const res = await authedFetch(`/api/v1/admin/refresh-all-wallets?${qs.toString()}`, { method:'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not start the refresh')
      setWalletRefresh(w=>({...w,busy:false,msg:`Started for ${data.scope}. It runs in the background; check the server logs for “WALLET REFRESH ALL: finished”.`}))
    } catch (err) {
      setWalletRefresh(w=>({...w,busy:false,msg:err.message || 'Could not start the refresh'}))
    }
  }

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

  const loadClientPerformance = async () => {
    if (!token) return
    setClientPerfLoading(true)
    setClientPerfError('')
    try {
      const res = await authedFetch(`/api/v1/admin/client-performance?days=${clientPerfDays}`, { cache:'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load client performance')
      setClientPerformance(data)
    } catch (err) {
      setClientPerfError(err.message || 'Could not load client performance')
    } finally {
      setClientPerfLoading(false)
    }
  }


  const loadReferralRewards = async (term = referralSearch) => {
    if (!token) return
    setReferralLoading(true)
    setReferralError('')
    try {
      const qs = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : ''
      const res = await authedFetch(`/api/v1/admin/referrals${qs}`, { cache:'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load referral rewards')
      setReferralData(data)
    } catch (err) {
      setReferralError(err.message || 'Could not load referral rewards')
    } finally {
      setReferralLoading(false)
    }
  }

  const loadHelpInsights = async () => {
    if (!token) return
    setHelpLoading(true)
    setHelpError('')
    try {
      const res = await authedFetch(`/api/v1/admin/help-insights?days=${helpDays}`, { cache:'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load Help Questions')
      setHelpInsights(data)
    } catch (err) {
      setHelpError(err.message || 'Could not load Help Questions')
    } finally {
      setHelpLoading(false)
    }
  }

  const updateHelpQuestionStatus = async (question, reviewStatus) => {
    if (!question?.key) return

    const promptText = reviewStatus === 'resolved'
      ? 'Optional note: what answer / FAQ update did you add?'
      : reviewStatus === 'reviewed'
        ? 'Optional review note:'
        : 'Optional note:'

    const note = window.prompt(promptText, question.admin_note || '')
    if (note === null) return

    setHelpReviewing(question.key)
    try {
      const res = await authedFetch(
        `/api/v1/admin/help-question-groups?normalized_question=${encodeURIComponent(question.key)}`,
        {
          method:'PATCH',
          body:JSON.stringify({
            review_status: reviewStatus,
            admin_note: note.trim() || null,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not update Help question')
      setMessage(
        reviewStatus === 'resolved'
          ? 'Help question marked resolved / added to FAQ'
          : reviewStatus === 'reviewed'
            ? 'Help question marked reviewed'
            : 'Help question reopened'
      )
      await loadHelpInsights()
    } catch (err) {
      setMessage(err.message || 'Could not update Help question')
    } finally {
      setHelpReviewing('')
      setTimeout(() => setMessage(''), 3500)
    }
  }

  const loadData = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (planFilter) params.set('plan', planFilter)

      const [ovRes, plansRes, bizRes, pendingRes, partnersRes, kitRes, networkPartnersRes, partnerExpensesRes, specialBusinessesRes, specialInvoicesRes] = await Promise.all([
        authedFetch('/api/v1/admin/overview'),
        authedFetch('/api/v1/admin/plans'),
        authedFetch(`/api/v1/admin/businesses?${params.toString()}`),
        authedFetch('/api/v1/admin/businesses?status=PENDING'),
        authedFetch('/api/v1/admin/partners'),
        authedFetch('/api/v1/admin/setup-kit-orders'),
        authedFetch('/api/v1/admin/network-partners'),
        authedFetch('/api/v1/admin/partner-operational-expenses'),
        authedFetch('/api/v1/admin/special-businesses'),
        authedFetch('/api/v1/admin/special-invoices'),
      ])
      if (ovRes.status === 401 || bizRes.status === 401) { onLogout(); return }
      setOverview(await ovRes.json().catch(() => null))
      setPlans(await plansRes.json().catch(() => ({})))
      setBusinesses(await bizRes.json().catch(() => []))
      setPendingApps(await pendingRes.json().catch(() => []))
      setPartners(await partnersRes.json().catch(() => []))
      setSetupKitOrders(await kitRes.json().catch(() => []))
      setNetworkPartners(await networkPartnersRes.json().catch(() => []))
      const expensePayload=await partnerExpensesRes.json().catch(() => [])
      setPartnerExpenses(partnerExpensesRes.ok&&Array.isArray(expensePayload)?expensePayload:[])
      const specialBusinessPayload=await specialBusinessesRes.json().catch(() => [])
      setSpecialBusinesses(specialBusinessesRes.ok&&Array.isArray(specialBusinessPayload)?specialBusinessPayload:[])
      const specialInvoicePayload=await specialInvoicesRes.json().catch(() => [])
      setSpecialInvoices(specialInvoicesRes.ok&&Array.isArray(specialInvoicePayload)?specialInvoicePayload:[])
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
    if (!token || activeAdminTab !== 'platform') return
    loadPlatformAnalytics()
  }, [token, analyticsDays, activeAdminTab])

  useEffect(() => {
    if (!token || activeAdminTab !== 'performance') return
    loadClientPerformance()
  }, [token, clientPerfDays, activeAdminTab])

  useEffect(() => {
    if (!token || activeAdminTab !== 'help') return
    loadHelpInsights()
  }, [token, helpDays, activeAdminTab])

  useEffect(() => {
    if (!token || activeAdminTab !== 'referrals') return
    loadReferralRewards(referralSearch)
  }, [token, activeAdminTab])

  const openDetail = async (biz) => {
    setSelected(biz)
    setDetail(null)
    setOrderAheadAdmin(null)
    setOrderAheadDesign({...OA_DESIGN_DEFAULTS})
    try {
      const [res, oaRes] = await Promise.all([
        authedFetch(`/api/v1/admin/businesses/${biz.public_id}`),
        authedFetch(`/api/v1/admin/businesses/${biz.public_id}/order-ahead`),
      ])
      const detailData = await res.json().catch(() => null)
      const oaData = await oaRes.json().catch(() => null)
      setDetail(detailData)
      if (oaRes.ok) {
        setOrderAheadAdmin(oaData)
        setOrderAheadDesign({...OA_DESIGN_DEFAULTS, ...(oaData?.design || {})})
      }
    } catch (err) {
      console.error(err)
    }
  }

  const saveOrderAheadAdmin = async (enabled, buttonLabel) => {
    if (!selected?.public_id) return
    setOrderAheadSaving(true)
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${selected.public_id}/order-ahead`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled, button_label: (buttonLabel || 'Order Ahead').trim() || 'Order Ahead' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not update Order Ahead')
      setMessage(data.message || 'Order Ahead updated')
      await openDetail(selected)
      loadData()
    } catch (err) {
      setMessage(err.message || 'Could not update Order Ahead')
    } finally {
      setOrderAheadSaving(false)
      setTimeout(() => setMessage(''), 3500)
    }
  }

  const saveOrderAheadDesign = async (patch = null) => {
    if (!selected?.public_id) return
    const payload = patch || orderAheadDesign
    setOrderAheadDesignSaving(true)
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${selected.public_id}/order-ahead/design`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save Order Ahead UI')
      setOrderAheadDesign({...OA_DESIGN_DEFAULTS, ...(data.design || {})})
      setOrderAheadAdmin(prev => prev ? ({...prev, design:data.design}) : prev)
      setMessage(data.message || 'Order Ahead UI saved')
    } catch (err) {
      setMessage(err.message || 'Could not save Order Ahead UI')
    } finally {
      setOrderAheadDesignSaving(false)
      setTimeout(() => setMessage(''), 3500)
    }
  }

  const resetOrderAheadDesign = async () => {
    await saveOrderAheadDesign({ reset:true })
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

  const sendBusinessPasswordReset = async (business) => {
    if (!business?.public_id || !business?.email) return
    const ok = window.confirm(`Send a password reset link to ${business.email}?\n\nThe link will only be sent to the registered business email.`)
    if (!ok) return
    setPasswordResetSending(business.public_id)
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${business.public_id}/password-reset-email`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not send password reset email')
      setMessage(data.message || `Password reset email sent to ${business.email}`)
      if (selected?.public_id === business.public_id) await openDetail(business)
    } catch (err) {
      setMessage(err.message || 'Could not send password reset email')
    } finally {
      setPasswordResetSending('')
      setTimeout(() => setMessage(''), 4500)
    }
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

  const networkPartnerErrorMessage=(detail)=>{
    if(Array.isArray(detail)){
      return detail.map(item=>{
        const field=Array.isArray(item?.loc)?item.loc[item.loc.length-1]:'field'
        return `${String(field||'field').replaceAll('_',' ')}: ${item?.msg||'Invalid value'}`
      }).join(' · ')
    }
    return typeof detail==='string'?detail:'Could not create partner'
  }
  const createNetworkPartner=async(e)=>{
    e.preventDefault()
    const form={
      ...networkPartnerForm,
      name:networkPartnerForm.name.trim(),
      email:networkPartnerForm.email.trim().toLowerCase(),
      region:networkPartnerForm.region.trim(),
      province:networkPartnerForm.province.trim()||null,
      city:networkPartnerForm.city.trim()||null,
      partner_code:networkPartnerForm.partner_code.trim().toUpperCase(),
      commission_value:Number(networkPartnerForm.commission_value)||0,
    }
    if(form.name.length<2)return setMessage('Partner name must be at least 2 characters')
    if(form.password.length<8)return setMessage('Temporary password must be at least 8 characters')
    if(form.region.length<2)return setMessage('Enter the partner region')
    if(form.partner_type==='province'&&!form.province)return setMessage('Province is required for a province partner')
    if(form.partner_type==='city'&&!form.city)return setMessage('City is required for a city partner')
    if(form.partner_code.length<3)return setMessage('Partner code must be at least 3 characters')
    if(form.partner_type==='region'){form.province=null;form.city=null}
    if(form.partner_type==='province')form.city=null

    setNetworkPartnerSaving(true)
    try{
      const res=await authedFetch('/api/v1/admin/network-partners',{method:'POST',body:JSON.stringify(form)})
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(networkPartnerErrorMessage(d.detail))
      setNetworkPartnerForm({name:'',email:'',password:'',partner_type:'city',region:'',province:'',city:'',partner_code:'',commission_type:'percent',commission_value:10,is_active:true})
      setMessage('Local partner created')
      loadData()
    }catch(err){
      setMessage(err.message||'Could not create partner')
    }finally{
      setNetworkPartnerSaving(false)
    }
  }
  const patchNetworkPartner=async(p,patch)=>{try{const res=await authedFetch(`/api/v1/admin/network-partners/${p.public_id}`,{method:'PATCH',body:JSON.stringify(patch)});const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d.detail||'Partner update failed');setMessage('Partner updated');loadData()}catch(err){setMessage(err.message)}}

  const reviewPartnerExpense=async(expense,status)=>{
    const action=status==='approved'?'Approve':'Reject'
    let adminNotes=''
    if(status==='rejected'){
      const entered=window.prompt('Reason for rejection (optional):','')
      if(entered===null)return
      adminNotes=entered.trim()
    }else if(!window.confirm(`Approve ${expense.partner_name||'partner'} expense of ₱${Number(expense.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}?`)){
      return
    }
    setExpenseReviewing(expense.public_id)
    try{
      const res=await authedFetch(`/api/v1/admin/partner-operational-expenses/${expense.public_id}`,{method:'PATCH',body:JSON.stringify({status,admin_notes:adminNotes||null})})
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||`${action} expense failed`)
      setMessage(`Expense ${status}`)
      await loadData()
    }catch(err){setMessage(err.message||`${action} expense failed`)}
    finally{setExpenseReviewing('');setTimeout(()=>setMessage(''),3500)}
  }

  const assignNetworkPartnerBusiness=async(e)=>{
    e.preventDefault()
    const partnerPublicId=networkPartnerAssignForm.partner_public_id
    const businessPublicId=networkPartnerAssignForm.business_public_id
    if(!partnerPublicId||!businessPublicId){
      setMessage('Choose both a partner and a business')
      setTimeout(()=>setMessage(''),3000)
      return
    }

    const partner=networkPartners.find(p=>p.public_id===partnerPublicId)
    const business=businesses.find(b=>b.public_id===businessPublicId)

    const ok=window.confirm(
      `Assign ${business?.name||'this business'} to ${partner?.name||'this partner'}?\n\nIf the business is already assigned to another partner, this will reassign it.`
    )
    if(!ok)return

    setNetworkPartnerAssigning(true)
    try{
      const res=await authedFetch(
        `/api/v1/admin/businesses/${businessPublicId}/network-partner/${partnerPublicId}`,
        {method:'PATCH'}
      )
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||'Could not assign business')
      setMessage(`${business?.name||'Business'} assigned to ${partner?.name||'partner'}`)
      setNetworkPartnerAssignForm({partner_public_id:'',business_public_id:''})
      await loadData()
    }catch(err){
      setMessage(err.message||'Could not assign business')
    }finally{
      setNetworkPartnerAssigning(false)
      setTimeout(()=>setMessage(''),4000)
    }
  }

  const resetSpecialForm=()=>{
    setEditingSpecialId('')
    setSpecialForm({
      business_name:'',business_email:'',business_password:'',business_phone:'',business_type:'other',business_address:'',feature_plan:'pro',
      billing_email:'',billing_contact_name:'',billing_tin:'',billing_address:'',
      pricing_model:'flat',contracted_branch_count:1,monthly_rate:0,cycle_amount_override:'',setup_fee:0,billing_cycle:'monthly',due_days:7,
      tax_treatment:'non_vat',vat_rate:12,price_includes_vat:false,vat_exemption_basis:'',
      auto_invoice:true,next_invoice_date:new Date().toISOString().slice(0,10),
      contract_start_date:new Date().toISOString().slice(0,10),contract_end_date:'',
      invoice_description:'LoyaltyTree custom service subscription',payment_instructions:'',is_active:true,
    })
  }

  const saveSpecialBusiness=async e=>{
    e.preventDefault()
    if(!editingSpecialId){
      if(!specialForm.business_name.trim()||!specialForm.business_email.trim()||specialForm.business_password.length<8){
        setMessage('Business name, email, and a password of at least 8 characters are required')
        return
      }
    }
    if(specialForm.tax_treatment==='vat_exempt'&&!specialForm.vat_exemption_basis.trim()){
      setMessage('Enter the VAT exemption basis/reference')
      return
    }
    setSpecialSaving(true)
    try{
      const payload={
        ...specialForm,
        contracted_branch_count:Number(specialForm.contracted_branch_count)||1,
        monthly_rate:Number(specialForm.monthly_rate)||0,
        cycle_amount_override:specialForm.cycle_amount_override===''?null:Number(specialForm.cycle_amount_override),
        setup_fee:Number(specialForm.setup_fee)||0,
        due_days:Number(specialForm.due_days)||7,
        vat_rate:specialForm.tax_treatment==='vat_registered'?Number(specialForm.vat_rate||0):0,
        price_includes_vat:specialForm.tax_treatment==='vat_registered'&&!!specialForm.price_includes_vat,
        next_invoice_date:specialForm.next_invoice_date||null,
        contract_start_date:specialForm.contract_start_date||null,
        contract_end_date:specialForm.contract_end_date||null,
      }
      if(editingSpecialId){
        ;['business_name','business_email','business_password','business_phone','business_type','business_address','feature_plan'].forEach(k=>delete payload[k])
      }
      const res=await authedFetch(editingSpecialId?`/api/v1/admin/special-businesses/${editingSpecialId}`:'/api/v1/admin/special-businesses',{
        method:editingSpecialId?'PATCH':'POST',body:JSON.stringify(payload)
      })
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(typeof d.detail==='string'?d.detail:'Could not save special business')
      setMessage(editingSpecialId?'Special billing updated':`${d.business_name||specialForm.business_name} created as a Special Business`)
      resetSpecialForm()
      await loadData()
    }catch(err){setMessage(err.message||'Could not save special business')}
    setSpecialSaving(false)
  }

  const editSpecialBusiness=p=>{
    setEditingSpecialId(p.public_id)
    setSpecialForm({
      business_name:p.business_name||'',business_email:p.business_email||'',business_password:'',business_phone:'',business_type:'other',business_address:'',feature_plan:'pro',
      billing_email:p.billing_email||'',billing_contact_name:p.billing_contact_name||'',billing_tin:p.billing_tin||'',billing_address:p.billing_address||'',
      pricing_model:p.pricing_model||'flat',contracted_branch_count:p.contracted_branch_count||1,monthly_rate:p.monthly_rate||0,cycle_amount_override:p.cycle_amount_override??'',
      setup_fee:p.setup_fee||0,billing_cycle:p.billing_cycle||'monthly',due_days:p.due_days||7,
      tax_treatment:p.tax_treatment||'non_vat',vat_rate:p.vat_rate??12,price_includes_vat:!!p.price_includes_vat,vat_exemption_basis:p.vat_exemption_basis||'',
      auto_invoice:p.auto_invoice!==false,next_invoice_date:p.next_invoice_date||'',contract_start_date:p.contract_start_date||'',contract_end_date:p.contract_end_date||'',
      invoice_description:p.invoice_description||'',payment_instructions:p.payment_instructions||'',is_active:p.is_active!==false,
    })
    setActiveAdminTab('special')
    window.scrollTo({top:0,behavior:'smooth'})
  }

  const generateSpecialInvoice=async p=>{
    if(!window.confirm(`Generate and email an invoice for ${p.business_name}?`))return
    setSpecialInvoiceBusy(p.public_id)
    try{
      const res=await authedFetch(`/api/v1/admin/special-businesses/${p.public_id}/generate-invoice`,{method:'POST'})
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||'Could not generate invoice')
      setMessage(`${d.invoice_number||'Invoice'} generated and email ${d.email_status==='sent'?'sent':'attempted'}`)
      await loadData()
    }catch(err){setMessage(err.message||'Could not generate invoice')}
    setSpecialInvoiceBusy('')
  }

  const resendSpecialInvoice=async inv=>{
    setSpecialInvoiceBusy(inv.public_id)
    try{
      const res=await authedFetch(`/api/v1/admin/special-invoices/${inv.public_id}/resend`,{method:'POST'})
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||'Could not resend invoice')
      setMessage(d.email_status==='sent'?'Invoice email resent':'Invoice email send failed')
      await loadData()
    }catch(err){setMessage(err.message||'Could not resend invoice')}
    setSpecialInvoiceBusy('')
  }

  const openPaymentReceived=inv=>{
    setPaymentReceivedModal(inv)
    setPaymentReceivedForm({
      payment_date:new Date().toISOString().slice(0,10),
      payment_method:'bank_transfer',
      payment_reference:'',
      amount_received:Number(inv.total_amount||0).toFixed(2),
      remarks:'',
    })
  }

  const confirmPaymentReceived=async e=>{
    e.preventDefault()
    const inv=paymentReceivedModal
    if(!inv)return
    const amount=Number(paymentReceivedForm.amount_received||0)
    if(!(amount>0)){setMessage('Enter the amount received');return}
    setPaymentReceivedSaving(true)
    setSpecialInvoiceBusy(inv.public_id)
    try{
      const res=await authedFetch(`/api/v1/admin/special-invoices/${inv.public_id}/confirm-payment`,{
        method:'POST',
        body:JSON.stringify({...paymentReceivedForm,amount_received:amount,send_receipt:true}),
      })
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||'Could not confirm payment')
      const ar=d.acknowledgement_receipt
      setMessage(ar?.email_status==='sent'
        ? `${ar.receipt_number||'Acknowledgement receipt'} generated and emailed`
        : `${ar?.receipt_number||'Acknowledgement receipt'} generated; email send failed`)
      setPaymentReceivedModal(null)
      await loadData()
    }catch(err){setMessage(err.message||'Could not confirm payment')}
    setPaymentReceivedSaving(false)
    setSpecialInvoiceBusy('')
  }

  const resendSpecialReceipt=async receipt=>{
    if(!receipt?.public_id)return
    setSpecialInvoiceBusy(receipt.public_id)
    try{
      const res=await authedFetch(`/api/v1/admin/special-receipts/${receipt.public_id}/resend`,{method:'POST'})
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||'Could not resend acknowledgement receipt')
      setMessage(d.email_status==='sent'?'Acknowledgement receipt emailed':'Acknowledgement receipt email failed')
      await loadData()
    }catch(err){setMessage(err.message||'Could not resend acknowledgement receipt')}
    setSpecialInvoiceBusy('')
  }

  const voidSpecialInvoice=async inv=>{
    const note=window.prompt('Reason for voiding (optional)','')||''
    setSpecialInvoiceBusy(inv.public_id)
    try{
      const res=await authedFetch(`/api/v1/admin/special-invoices/${inv.public_id}`,{
        method:'PATCH',body:JSON.stringify({status:'void',admin_notes:note})
      })
      const d=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(d.detail||'Could not void invoice')
      setMessage('Invoice voided')
      await loadData()
    }catch(err){setMessage(err.message||'Could not void invoice')}
    setSpecialInvoiceBusy('')
  }

  const filteredCount = businessTypeFilter ? businesses.filter(b => b.business_type === businessTypeFilter).length : businesses.length
  const latestKitByBusiness=setupKitOrders.reduce((m,o)=>{if(o.business_public_id&&!m[o.business_public_id])m[o.business_public_id]=o;return m},{})
  const businessKitStatus=b=>latestKitByBusiness[b.public_id]?.fulfillment_status||b.setup_kit_status||(b.setup_kit_requested?(b.setup_kit_paid?'paid':'requested'):'')
  const onboardingLabel=b=>b.onboarding_completed?'Live':(String(b.status||'').toUpperCase()!=='ACTIVE'?'Awaiting payment':b.onboarding_step>=8?'Ready to launch':b.onboarding_step>=7?'Dashboard intro':b.onboarding_step>=6?'Adding team':'Configuring card')
  const joinUrl=b=>b.join_url||`${window.location.origin}/join/${b.public_id}`
  const categoryBusinesses=businessTypeFilter?businesses.filter(b=>b.business_type===businessTypeFilter):businesses
  const displayBusinesses = sortByAddress
    ? [...categoryBusinesses].sort((a, b) => (a.address || '\uffff').localeCompare(b.address || '\uffff'))
    : categoryBusinesses

  const clientPerfRows = (clientPerformance?.businesses || []).filter(row => {
    if (clientPerfTypeFilter && row.business_type !== clientPerfTypeFilter) return false
    if (clientPerfTrendFilter && row.trend !== clientPerfTrendFilter) return false
    return true
  })
  const presentationSummary = clientPerfRows.reduce((acc,row) => {
    const crm=row.crm||{}, activity=row.activity||{}
    acc.clients += 1
    acc.total_customers += Number(crm.total_customers||0)
    acc.active_members += Number(crm.active_members||0)
    acc.new_customers += Number(crm.new_customers||0)
    acc.returning_members += Number(crm.returning_members||0)
    acc.at_risk_customers += Number(crm.at_risk_customers||0)
    acc.redemptions += Number(activity.redemptions||0)
    acc.activity_events += Number(activity.events||0)
    acc.membership_renewals += Number(activity.membership_renewals||0)
    if (row.pos?.connected) acc.pos_connected += 1
    if (row.trend === 'improving') acc.improving += 1
    return acc
  }, {clients:0,total_customers:0,active_members:0,new_customers:0,returning_members:0,at_risk_customers:0,redemptions:0,activity_events:0,membership_renewals:0,pos_connected:0,improving:0})
  presentationSummary.returning_rate = presentationSummary.active_members
    ? Math.round((presentationSummary.returning_members / presentationSummary.active_members) * 1000) / 10
    : 0

  const adminTabs = [
    { key:'overview', label:'Overview', icon:'⌂', description:'Platform health, applications and the few numbers that need attention.' },
    { key:'businesses', label:'Businesses', icon:'▦', description:'Search, manage and open individual client accounts.' },
    { key:'special', label:'Special Businesses', icon:'₱', description:'Custom contracts, branch-based pricing and automated invoice delivery.' },
    { key:'performance', label:'Client Performance', icon:'↗', description:'CRM and retention movement across LoyaltyTree clients.' },
    { key:'platform', label:'Platform Analytics', icon:'◫', description:'Website traffic, acquisition, join conversion and Wallet activity.' },
    { key:'help', label:'Help Questions', icon:'?', description:'See what owners and managers ask most, review unanswered questions, and grow the FAQ from real usage.' },
    { key:'operations', label:'Operations', icon:'⚙', description:'Announcements, print requests and QR / PR kit fulfillment.' },
    { key:'partners', label:'Partners', icon:'◎', description:'Region / province / city operators, expense approvals and homepage partner management.' },
    { key:'referrals', label:'Referrals', icon:'↗', description:'See which businesses earned the 1-month referral bonus.' },
  ]
  const activeAdminTabMeta = adminTabs.find(tab => tab.key === activeAdminTab) || adminTabs[0]

  return (
    <div style={styles.container}>
      <style>{`
        .admin-tab-nav::-webkit-scrollbar { display: none; }
        @media (max-width: 760px) {
          .admin-shell-body { padding: 16px !important; }
          .admin-tab-nav { margin-left: -16px !important; margin-right: -16px !important; padding-left: 16px !important; padding-right: 16px !important; }
          .admin-tab-button { flex: 0 0 auto; }
          .admin-tab-heading { align-items: flex-start !important; flex-direction: column !important; }
        }
        @media print {
          body * { visibility: hidden !important; }
          .client-presentation-sheet, .client-presentation-sheet * { visibility: visible !important; }
          .client-presentation-sheet { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: none !important; max-height: none !important; overflow: visible !important; box-shadow: none !important; border: 0 !important; }
          .client-presentation-actions { display: none !important; }
        }
      `}</style>
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

      <div className="admin-shell-body" style={styles.body}>
        <div style={styles.adminTopActions}>
          <button onClick={() => setShowCreateModal(true)} style={styles.approveBtn}>+ Create business</button>
        </div>

        <div className="admin-tab-nav" style={styles.adminTabNav}>
          {adminTabs.map(tab => {
            const active = activeAdminTab === tab.key
            const badge =
              tab.key === 'businesses'
                ? businesses.length
                : tab.key === 'overview' && pendingApps.length
                  ? pendingApps.length
                  : tab.key === 'help' && helpInsights?.open_unanswered_groups
                    ? helpInsights.open_unanswered_groups
                    : null
            return (
              <button
                key={tab.key}
                type="button"
                className="admin-tab-button"
                onClick={() => setActiveAdminTab(tab.key)}
                style={{...styles.adminTabButton,...(active ? styles.adminTabButtonActive : {})}}
              >
                <span style={styles.adminTabIcon}>{tab.icon}</span>
                <span>{tab.label}</span>
                {badge != null && <span style={{...styles.adminTabBadge,...(active ? styles.adminTabBadgeActive : {})}}>{badge}</span>}
              </button>
            )
          })}
        </div>

        <div className="admin-tab-heading" style={styles.adminTabHeading}>
          <div>
            <div style={styles.adminTabEyebrow}>SUPER ADMIN</div>
            <h2 style={styles.adminTabTitle}>{activeAdminTabMeta.label}</h2>
            <p style={styles.adminTabDescription}>{activeAdminTabMeta.description}</p>
          </div>
          {activeAdminTab === 'businesses' && <div style={styles.adminTabContext}>{businesses.length} loaded client{businesses.length===1?'':'s'}</div>}
          {activeAdminTab === 'special' && <div style={styles.adminTabContext}>{specialBusinesses.length} special billing account{specialBusinesses.length===1?'':'s'} · {specialInvoices.filter(i=>i.status==='overdue').length} overdue</div>}
          {activeAdminTab === 'overview' && pendingApps.length > 0 && <div style={{...styles.adminTabContext,color:'#92400e',background:'#fffbeb',borderColor:'#fde68a'}}>{pendingApps.length} application{pendingApps.length===1?'':'s'} waiting</div>}
          {activeAdminTab === 'help' && <div style={{...styles.adminTabContext,color:helpInsights?.open_unanswered_groups?'#92400e':'#166534',background:helpInsights?.open_unanswered_groups?'#fffbeb':'#ecfdf5',borderColor:helpInsights?.open_unanswered_groups?'#fde68a':'#bbf7d0'}}>{helpInsights?.open_unanswered_groups ?? 0} unanswered group{helpInsights?.open_unanswered_groups===1?'':'s'}</div>}
        </div>

        {activeAdminTab === 'platform' && (
        <section style={styles.analyticsSection}>
          <div style={styles.analyticsHeader}>
            <div>
              <div style={styles.analyticsEyebrow}>PLATFORM ANALYTICS</div>
              <h2 style={styles.analyticsTitle}>Growth & visitor insights</h2>
              <p style={styles.analyticsSubtitle}>A cleaner view of public traffic, conversions, customer joins and Wallet activity. Visitor location is approximate and no raw IP addresses are stored.</p>
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
            <AnalyticsMetric label="Unique visitors" value={(platformAnalytics?.unique_visitors ?? 0).toLocaleString()} hint={`${platformAnalytics?.unique_sessions ?? 0} sessions`} />
            <AnalyticsMetric label="Page views" value={(platformAnalytics?.total_page_views ?? 0).toLocaleString()} hint={`${platformAnalytics?.views_today ?? 0} today`} />
            <AnalyticsMetric label="Business signups" value={(platformAnalytics?.business_signups ?? 0).toLocaleString()} hint={`${platformAnalytics?.business_apply_conversion_rate ?? 0}% of apply clicks`} />
            <AnalyticsMetric label="Customer joins" value={(platformAnalytics?.customer_join_completions ?? 0).toLocaleString()} hint={`${platformAnalytics?.customer_join_conversion_rate ?? 0}% of join-page visits`} />
          </div>

          <div style={styles.analyticsSnapshotGrid}>
            <div style={styles.analyticsInsightCard}>
              <div style={styles.analyticsCardTitle}>Business acquisition</div>
              <div style={styles.analyticsInsightValue}>{platformAnalytics?.business_apply_conversion_rate ?? 0}%</div>
              <div style={styles.analyticsInsightSub}>Apply click → business signup</div>
              <div style={styles.analyticsInsightRows}>
                <div style={styles.analyticsInsightRow}><span>Apply clicks</span><b>{(platformAnalytics?.apply_clicks ?? 0).toLocaleString()}</b></div>
                <div style={styles.analyticsInsightRow}><span>Registrations</span><b>{(platformAnalytics?.business_signups ?? 0).toLocaleString()}</b></div>
              </div>
            </div>
            <div style={styles.analyticsInsightCard}>
              <div style={styles.analyticsCardTitle}>Customer acquisition</div>
              <div style={styles.analyticsInsightValue}>{platformAnalytics?.customer_join_conversion_rate ?? 0}%</div>
              <div style={styles.analyticsInsightSub}>Join page → completed customer join</div>
              <div style={styles.analyticsInsightRows}>
                <div style={styles.analyticsInsightRow}><span>Join-page visits</span><b>{(platformAnalytics?.join_page_views ?? 0).toLocaleString()}</b></div>
                <div style={styles.analyticsInsightRow}><span>Completed joins</span><b>{(platformAnalytics?.customer_join_completions ?? 0).toLocaleString()}</b></div>
              </div>
            </div>
            <div style={styles.analyticsInsightCard}>
              <div style={styles.analyticsCardTitle}>High-intent actions</div>
              <div style={styles.analyticsMiniGrid}>
                <div style={styles.analyticsMiniStat}><span>Pricing</span><b>{(platformAnalytics?.pricing_views ?? 0).toLocaleString()}</b></div>
                <div style={styles.analyticsMiniStat}><span>Contact</span><b>{(platformAnalytics?.contact_clicks ?? 0).toLocaleString()}</b></div>
                <div style={styles.analyticsMiniStat}><span>Google Wallet</span><b>{(platformAnalytics?.wallet_google_clicks ?? 0).toLocaleString()}</b></div>
                <div style={styles.analyticsMiniStat}><span>Apple Wallet</span><b>{(platformAnalytics?.wallet_apple_clicks ?? 0).toLocaleString()}</b></div>
              </div>
            </div>
          </div>

          <div style={styles.analyticsPrimaryGrid}>
            <div style={{...styles.analyticsTrendCard,marginBottom:0}}>
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
                {!platformAnalytics?.daily?.length && <div style={styles.analyticsEmpty}>Traffic will appear here after public analytics events are recorded.</div>}
              </div>
            </div>

            <div style={styles.analyticsSummaryCard}>
              <div style={styles.analyticsCardTitle}>Visitor snapshot</div>
              <div style={styles.analyticsSummaryRow}><span>Sessions</span><b>{(platformAnalytics?.unique_sessions ?? 0).toLocaleString()}</b></div>
              <div style={styles.analyticsSummaryRow}><span>Views today</span><b>{(platformAnalytics?.views_today ?? 0).toLocaleString()}</b></div>
              <div style={styles.analyticsSummaryRow}><span>Location coverage</span><b>{platformAnalytics?.geo_coverage_percent ?? 0}%</b></div>
              <div style={styles.analyticsSummaryRow}><span>Wallet card views</span><b>{(platformAnalytics?.wallet_card_views ?? 0).toLocaleString()}</b></div>
              {platformAnalytics?.sample_truncated && <div style={styles.analyticsSampleNote}>Large dataset: report is showing the newest tracked sample.</div>}
            </div>
          </div>

          <div style={styles.analyticsSectionHeading}>
            <div>
              <div style={styles.analyticsSectionHeadingTitle}>Visitor locations</div>
              <div style={styles.analyticsSectionHeadingSub}>Approximate location by unique visitor, based on server-side IP geolocation. No GPS permission is requested.</div>
            </div>
            <span style={styles.analyticsCoverageBadge}>{platformAnalytics?.geo_coverage_percent ?? 0}% location coverage</span>
          </div>
          <div style={styles.analyticsLocationGrid}>
            <AnalyticsBreakdown title="Top cities" rows={(platformAnalytics?.top_cities || []).slice(0,6)} />
            <AnalyticsBreakdown title="Top regions" rows={(platformAnalytics?.top_regions || []).slice(0,6)} />
            <AnalyticsBreakdown title="Top countries" rows={(platformAnalytics?.top_countries || []).slice(0,6)} />
          </div>

          <div style={styles.analyticsSectionHeading}>
            <div>
              <div style={styles.analyticsSectionHeadingTitle}>Traffic details</div>
              <div style={styles.analyticsSectionHeadingSub}>Where visitors came from and how they browsed LoyaltyTree.</div>
            </div>
          </div>
          <div style={styles.analyticsBreakdownGrid}>
            <AnalyticsBreakdown title="Top pages" rows={platformAnalytics?.top_pages} />
            <AnalyticsBreakdown title="Traffic sources" rows={platformAnalytics?.sources} />
            <AnalyticsBreakdown title="Devices" rows={platformAnalytics?.devices} />
            <AnalyticsBreakdown title="Browsers" rows={platformAnalytics?.browsers} />
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
            <div style={styles.analyticsSectionHeadingInline}>
              <div>
                <div style={styles.analyticsCardTitle}>Recent public activity</div>
                <div style={styles.analyticsSectionHeadingSub}>Latest tracked events, including approximate visitor location when available.</div>
              </div>
            </div>
            {(platformAnalytics?.recent || []).slice(0,12).map((row,i)=>
              <div key={`${row.created_at}-${i}`} style={styles.analyticsRecentRow}>
                <span style={styles.analyticsEventBadge}>{String(row.event_name||'event').replaceAll('_',' ')}</span>
                <span style={styles.analyticsRecentPath}>{row.path || row.page_name || '—'}</span>
                <span style={styles.analyticsRecentMeta}>
                  <strong style={styles.analyticsRecentLocation}>📍 {row.location || 'Location unavailable'}</strong>
                  <small>{row.source || 'direct'} · {row.device_type || 'unknown'} · {row.browser || 'Other'} · {row.created_at ? new Date(row.created_at).toLocaleString() : ''}</small>
                </span>
              </div>
            )}
            {!platformAnalytics?.recent?.length && <div style={styles.analyticsEmpty}>No tracked public activity yet.</div>}
          </div>
        </section>
        )}

        {activeAdminTab === 'help' && (
        <section style={styles.analyticsSection}>
          <div style={styles.analyticsHeader}>
            <div>
              <div style={styles.analyticsEyebrow}>HELP CENTER LEARNING</div>
              <h2 style={styles.analyticsTitle}>Questions owners and managers actually ask</h2>
              <p style={styles.analyticsSubtitle}>
                Typed questions and FAQ clicks are recorded here so the Help Center can improve from real usage. Prioritize repeated unanswered questions, add the answer to HelpChat, then mark the question resolved.
              </p>
            </div>
            <div style={styles.analyticsControls}>
              <select value={helpDays} onChange={e=>setHelpDays(Number(e.target.value))} style={styles.select}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 12 months</option>
              </select>
              <button onClick={loadHelpInsights} disabled={helpLoading} style={styles.viewBtn}>{helpLoading?'Refreshing…':'↻ Refresh'}</button>
            </div>
          </div>

          {helpError && <div style={styles.analyticsError}>{helpError}</div>}

          <div style={styles.analyticsMetricGrid}>
            <AnalyticsMetric label="Questions / clicks" value={(helpInsights?.total_events ?? 0).toLocaleString()} hint={`${helpInsights?.typed_questions ?? 0} typed · ${helpInsights?.faq_clicks ?? 0} FAQ clicks`} />
            <AnalyticsMetric label="Unanswered" value={(helpInsights?.unanswered_events ?? 0).toLocaleString()} hint={`${helpInsights?.open_unanswered_groups ?? 0} open question groups`} />
            <AnalyticsMetric label="Answered" value={(helpInsights?.answered_events ?? 0).toLocaleString()} hint="matched to an existing FAQ" />
            <AnalyticsMetric label="Unique questions" value={(helpInsights?.unique_questions ?? 0).toLocaleString()} hint={`last ${helpDays} days`} />
          </div>

          <div style={styles.analyticsListCard}>
            <div style={styles.analyticsSectionHeadingInline}>
              <div>
                <div style={styles.analyticsCardTitle}>Needs review</div>
                <div style={styles.analyticsSectionHeadingSub}>Repeated unanswered questions come first. Review these daily and turn the useful ones into new FAQ entries.</div>
              </div>
            </div>

            <div style={{overflowX:'auto',marginTop:10}}>
              <table style={styles.expenseTable}>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Asked</th>
                    <th>Businesses</th>
                    <th>Role</th>
                    <th>Last asked</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(helpInsights?.unanswered_questions || []).map(row=>
                    <tr key={row.key}>
                      <td style={{minWidth:300}}>
                        <b>{row.sample_question}</b>
                        {row.admin_note&&<small style={{...styles.expenseSub,color:'#0f766e'}}>Admin note: {row.admin_note}</small>}
                      </td>
                      <td><b>{Number(row.unanswered_count||0).toLocaleString()}×</b><small style={styles.expenseSub}>{Number(row.count||0).toLocaleString()} total</small></td>
                      <td>{Number(row.business_count||0).toLocaleString()}</td>
                      <td>{(row.roles||[]).map(role=><span key={role} style={{...styles.adminTabContext,padding:'4px 7px',marginRight:4,textTransform:'capitalize'}}>{role}</span>)}</td>
                      <td>{row.last_asked_at?new Date(row.last_asked_at).toLocaleString():'—'}</td>
                      <td><span style={row.review_status==='reviewed'?styles.expensePending:styles.expenseRejected}>{row.review_status||'open'}</span></td>
                      <td>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          <button
                            style={styles.refreshBtn}
                            disabled={helpReviewing===row.key}
                            onClick={()=>updateHelpQuestionStatus(row,'reviewed')}
                          >Reviewed</button>
                          <button
                            style={styles.approveBtn}
                            disabled={helpReviewing===row.key}
                            onClick={()=>updateHelpQuestionStatus(row,'resolved')}
                          >Resolved / Added to FAQ</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {!helpLoading && !(helpInsights?.unanswered_questions || []).length && (
              <div style={styles.analyticsEmpty}>No unanswered questions in this period. The current FAQ handled everything recorded.</div>
            )}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:12,marginTop:12}}>
            <div style={{...styles.analyticsListCard,marginTop:0}}>
              <div style={styles.analyticsCardTitle}>Most asked questions</div>
              <div style={styles.analyticsSectionHeadingSub}>Overall frequency — answered and unanswered combined.</div>
              {(helpInsights?.top_questions || []).slice(0,15).map((row,index)=>
                <div key={row.key} style={styles.analyticsRankRow}>
                  <span>
                    <b>{index+1}. {row.sample_question}</b>
                    <small style={styles.analyticsRankSub}>
                      {row.unanswered_count||0} unanswered · {row.answered_count||0} answered · {row.business_count||0} businesses
                    </small>
                  </span>
                  <b>{Number(row.count||0).toLocaleString()}×</b>
                </div>
              )}
              {!helpLoading && !(helpInsights?.top_questions || []).length && <div style={styles.analyticsEmpty}>No questions recorded yet.</div>}
            </div>

            <div style={{...styles.analyticsListCard,marginTop:0}}>
              <div style={styles.analyticsCardTitle}>Most opened FAQs</div>
              <div style={styles.analyticsSectionHeadingSub}>Shows which prepared answers are used most often.</div>
              {(helpInsights?.top_faqs || []).slice(0,15).map((row,index)=>
                <div key={row.article_id || index} style={styles.analyticsRankRow}>
                  <span><b>{index+1}. {row.title || row.article_id || 'FAQ'}</b></span>
                  <b>{Number(row.count||0).toLocaleString()}×</b>
                </div>
              )}
              {!helpLoading && !(helpInsights?.top_faqs || []).length && <div style={styles.analyticsEmpty}>No FAQ clicks recorded yet.</div>}
            </div>
          </div>

          <div style={styles.analyticsListCard}>
            <div style={styles.analyticsCardTitle}>Recent Help activity</div>
            <div style={styles.analyticsSectionHeadingSub}>Latest typed questions and FAQ clicks across businesses.</div>
            <div style={{overflowX:'auto',marginTop:10}}>
              <table style={styles.expenseTable}>
                <thead><tr><th>Time</th><th>Business</th><th>Role</th><th>Question</th><th>Result</th></tr></thead>
                <tbody>
                  {(helpInsights?.recent || []).slice(0,30).map((row,index)=>
                    <tr key={`${row.public_id||row.created_at}-${index}`}>
                      <td>{row.created_at?new Date(row.created_at).toLocaleString():'—'}</td>
                      <td><b>{row.business_name||'Unknown business'}</b><small style={styles.expenseSub}>{row.current_page||'—'}</small></td>
                      <td style={{textTransform:'capitalize'}}>{row.user_role||'—'}</td>
                      <td style={{minWidth:280}}>{row.question_text}</td>
                      <td>
                        <span style={row.answered?styles.expenseApproved:styles.expenseRejected}>{row.answered?'answered':'unanswered'}</span>
                        <small style={styles.expenseSub}>{row.source==='faq_click'?'FAQ click':row.matched_article_title||'Typed question'}</small>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!helpLoading && !(helpInsights?.recent || []).length && <div style={styles.analyticsEmpty}>No Help activity recorded yet.</div>}
          </div>
        </section>
        )}

        {activeAdminTab === 'performance' && (
        <section style={styles.clientPerformanceSection}>
          <div style={styles.analyticsHeader}>
            <div>
              <div style={styles.analyticsEyebrow}>CLIENT PERFORMANCE</div>
              <h2 style={styles.analyticsTitle}>CRM health across LoyaltyTree clients</h2>
              <p style={styles.analyticsSubtitle}>
                Internal, aggregate client evidence for operations and case studies. Non-POS clients are measured from LoyaltyTree card activity only; customer-level personal data is never shown here.
              </p>
            </div>
            <div style={styles.analyticsControls}>
              <select value={clientPerfDays} onChange={e=>setClientPerfDays(Number(e.target.value))} style={styles.select}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={180}>Last 6 months</option>
                <option value={365}>Last 12 months</option>
              </select>
              <button onClick={loadClientPerformance} disabled={clientPerfLoading} style={styles.viewBtn}>{clientPerfLoading?'Refreshing…':'↻ Refresh'}</button>
              <button onClick={()=>setShowClientPresentation(true)} disabled={!clientPerfRows.length} style={styles.approveBtn}>Presentation snapshot</button>
            </div>
          </div>

          {clientPerfError && <div style={styles.analyticsError}>{clientPerfError}</div>}
          <div style={styles.analyticsMetricGrid}>
            <AnalyticsMetric label="Active clients" value={(clientPerformance?.client_count ?? 0).toLocaleString()} hint={`${clientPerformance?.summary?.trend_counts?.improving ?? 0} improving`} />
            <AnalyticsMetric label="Active members" value={(clientPerformance?.summary?.active_members ?? 0).toLocaleString()} hint={`across ${clientPerfDays} days`} />
            <AnalyticsMetric label="Returning members" value={(clientPerformance?.summary?.returning_members ?? 0).toLocaleString()} hint={`${clientPerformance?.summary?.returning_rate ?? 0}% of active members`} />
            <AnalyticsMetric label="New members" value={(clientPerformance?.summary?.new_customers ?? 0).toLocaleString()} hint="joined in selected period" />
            <AnalyticsMetric label="Redemptions" value={(clientPerformance?.summary?.redemptions ?? 0).toLocaleString()} hint="recorded reward usage" />
            <AnalyticsMetric label="POS connected" value={(clientPerformance?.summary?.pos_connected_clients ?? 0).toLocaleString()} hint={`${clientPerformance?.summary?.pos_live_clients ?? 0} live`} />
          </div>

          <div style={styles.clientPerformanceToolbar}>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              <select value={clientPerfTypeFilter} onChange={e=>setClientPerfTypeFilter(e.target.value)} style={styles.select}>
                <option value="">All business types</option>
                {BUSINESS_TYPE_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
              </select>
              <select value={clientPerfTrendFilter} onChange={e=>setClientPerfTrendFilter(e.target.value)} style={styles.select}>
                <option value="">All CRM trends</option>
                <option value="improving">Improving</option>
                <option value="stable">Stable</option>
                <option value="needs_attention">Needs attention</option>
                <option value="limited_data">Limited data</option>
              </select>
            </div>
            <div style={styles.analyticsSectionHeadingSub}>
              Showing {clientPerfRows.length} client{clientPerfRows.length===1?'':'s'} · no customer PII
            </div>
          </div>

          {clientPerfLoading && !clientPerformance ? (
            <div style={styles.analyticsEmpty}>Loading client CRM performance…</div>
          ) : clientPerfRows.length === 0 ? (
            <div style={styles.analyticsEmpty}>No client performance data matches these filters yet.</div>
          ) : (
            <div style={styles.clientPerformanceGrid}>
              {clientPerfRows.map(row => {
                const crm=row.crm||{}, activity=row.activity||{}, movement=row.movement||{}
                const source = row.pos?.connected
                  ? `LoyaltyTree + ${(row.pos.providers||[]).map(p=>p==='storehub'?'StoreHub':p==='loyverse'?'Loyverse':p).join(' + ')}${row.pos.live?'':' · test'}`
                  : 'LoyaltyTree Activity'
                return <article key={row.business_public_id} style={styles.clientPerformanceCard}>
                  <div style={styles.clientPerformanceCardHeader}>
                    <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
                      {row.logo_url ? <img src={row.logo_url} alt="" style={styles.clientPerformanceLogo}/> : <div style={styles.clientPerformanceLogoFallback}>🏪</div>}
                      <div style={{minWidth:0}}>
                        <div style={styles.clientPerformanceName}>{row.business_name}</div>
                        <div style={styles.clientPerformanceMeta}>{businessTypeLabel(row.business_type)} · {String(row.plan||'starter').toUpperCase()}</div>
                      </div>
                    </div>
                    <span style={{...styles.clientTrendBadge,...clientTrendStyle(row.trend)}}>{clientTrendLabel(row.trend)}</span>
                  </div>
                  <div style={styles.clientSourceBadge}>● {source}</div>
                  <div style={styles.clientMetricGrid}>
                    <ClientMetric label="Active" value={crm.active_members||0} />
                    <ClientMetric label="New" value={crm.new_customers||0} />
                    <ClientMetric label="Returning" value={crm.returning_members||0} />
                    <ClientMetric label="Returning share" value={`${crm.returning_rate||0}%`} />
                    <ClientMetric label="Activity" value={activity.events||0} />
                    <ClientMetric label="Redemptions" value={activity.redemptions||0} />
                  </div>
                  <div style={styles.clientMovementRow}>
                    <ClientMovement label="Activity" value={movement.activity_change_percent} suffix="%" />
                    <ClientMovement label="Active members" value={movement.active_member_change_percent} suffix="%" />
                    <ClientMovement label="Returning share" value={movement.returning_rate_change_points} suffix=" pts" />
                  </div>
                  <div style={styles.clientHealthFooter}>
                    <span>{crm.at_risk_customers||0} inactive / at-risk</span>
                    {activity.membership_renewals > 0 && <span>{activity.membership_renewals} renewal{activity.membership_renewals===1?'':'s'}</span>}
                  </div>
                  {!!row.trend_reasons?.length && <div style={styles.clientReasons}>{row.trend_reasons.slice(0,2).map((reason,i)=><div key={i}>• {reason}</div>)}</div>}
                </article>
              })}
            </div>
          )}

          <div style={styles.clientMethodologyNote}>
            <b>Presentation rule:</b> without live POS data, describe these as loyalty activity, returning-member activity, redemptions and CRM movement — not sales or revenue.
          </div>
        </section>
        )}

        {activeAdminTab === 'partners' && (
        <section style={styles.partnerAdminSection}>
          <h2 style={styles.partnerAdminTitle}>🌎 Region / Province / City Partner Network</h2>
          <p style={styles.partnerAdminSubtitle}>Create local LoyaltyTree operators at region, province, or city level with controlled access to assigned businesses, onboarding/setup status and commission activity. They cannot access customer personal data.</p>
          <form onSubmit={createNetworkPartner} style={styles.partnerForm}>
            <div style={styles.partnerFormGrid}>
              <div><label style={styles.partnerLabel}>Partner name</label><input style={styles.input} minLength="2" value={networkPartnerForm.name} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,name:e.target.value})} required/></div>
              <div><label style={styles.partnerLabel}>Login email</label><input style={styles.input} type="email" value={networkPartnerForm.email} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,email:e.target.value})} required/></div>
              <div><label style={styles.partnerLabel}>Temporary password</label><input style={styles.input} type="password" minLength="8" value={networkPartnerForm.password} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,password:e.target.value})} required/></div>
              <div><label style={styles.partnerLabel}>Partner type</label><select style={styles.select} value={networkPartnerForm.partner_type} onChange={e=>{const type=e.target.value;setNetworkPartnerForm({...networkPartnerForm,partner_type:type,province:type==='region'?'':networkPartnerForm.province,city:type==='city'?networkPartnerForm.city:''})}}><option value="city">City Partner</option><option value="province">Province Partner</option><option value="region">Region Partner</option></select></div>
              <div><label style={styles.partnerLabel}>Region</label><input style={styles.input} minLength="2" value={networkPartnerForm.region} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,region:e.target.value})} placeholder="Region III" required/></div>
              {networkPartnerForm.partner_type!=='region'&&<div><label style={styles.partnerLabel}>Province {networkPartnerForm.partner_type==='city'?'(optional for NCR / independent cities)':''}</label><input style={styles.input} value={networkPartnerForm.province} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,province:e.target.value})} placeholder="Pampanga" required={networkPartnerForm.partner_type==='province'}/></div>}
              {networkPartnerForm.partner_type==='city'&&<div><label style={styles.partnerLabel}>City</label><input style={styles.input} value={networkPartnerForm.city} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,city:e.target.value})} placeholder="Angeles City" required/></div>}
              <div><label style={styles.partnerLabel}>Partner code</label><input style={styles.input} minLength="3" value={networkPartnerForm.partner_code} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,partner_code:e.target.value.toUpperCase()})} placeholder={networkPartnerForm.partner_type==='province'?'LT-PAMPANGA':networkPartnerForm.partner_type==='region'?'LT-R3':'LT-ANGELES'} required/></div>
              <div><label style={styles.partnerLabel}>Commission</label><div style={{display:'flex',gap:6}}><select style={{...styles.select,width:110}} value={networkPartnerForm.commission_type} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,commission_type:e.target.value})}><option value="percent">Percent</option><option value="fixed">Fixed ₱</option></select><input style={styles.input} type="number" min="0" step="0.01" value={networkPartnerForm.commission_value} onChange={e=>setNetworkPartnerForm({...networkPartnerForm,commission_value:e.target.value})}/></div></div>
            </div><button style={styles.approveBtn} disabled={networkPartnerSaving}>{networkPartnerSaving?'Creating…':'+ Create local partner'}</button>
          </form>
          <form onSubmit={assignNetworkPartnerBusiness} style={{...styles.partnerForm,marginTop:16}}>
            <div style={{fontWeight:800,fontSize:14,color:'#0f172a',marginBottom:10}}>Assign business to partner</div>
            <div style={styles.partnerFormGrid}>
              <div>
                <label style={styles.partnerLabel}>Partner</label>
                <select
                  style={styles.select}
                  value={networkPartnerAssignForm.partner_public_id}
                  onChange={e=>setNetworkPartnerAssignForm({...networkPartnerAssignForm,partner_public_id:e.target.value})}
                  required
                >
                  <option value="">Choose partner</option>
                  {networkPartners.filter(p=>p.is_active).map(p=>
                    <option key={p.public_id} value={p.public_id}>
                      {p.name} · {p.partner_code}
                    </option>
                  )}
                </select>
              </div>
              <div>
                <label style={styles.partnerLabel}>Business</label>
                <select
                  style={styles.select}
                  value={networkPartnerAssignForm.business_public_id}
                  onChange={e=>setNetworkPartnerAssignForm({...networkPartnerAssignForm,business_public_id:e.target.value})}
                  required
                >
                  <option value="">Choose business</option>
                  {businesses
                    .slice()
                    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
                    .map(b=>
                      <option key={b.public_id} value={b.public_id}>
                        {b.name}{b.address?` · ${b.address}`:''}
                      </option>
                    )}
                </select>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}>
              <button style={styles.approveBtn} disabled={networkPartnerAssigning}>
                {networkPartnerAssigning?'Assigning…':'Assign Business'}
              </button>
              <span style={{fontSize:12,color:'#64748b'}}>
                Assigning an already-linked business will move it to the selected partner.
              </span>
            </div>
          </form>

          <div style={{...styles.partnerList,marginTop:16}}>{networkPartners.map(p=>{const typeLabel=p.partner_type==='region'?'Region':p.partner_type==='province'?'Province':'City';const territory=[p.city,p.province,p.region].filter(Boolean).join(', ');return <div key={p.public_id} style={styles.partnerRow}><div style={{flex:1,minWidth:220}}><b>{p.name}</b><div style={{fontSize:12,color:'#64748b',marginTop:4}}>{typeLabel} · {territory}</div><div style={{fontSize:12,color:'#0f766e',fontWeight:700,marginTop:4}}>{p.partner_code} · {p.business_count||0} businesses</div></div><div style={{fontSize:12,minWidth:150}}>Earned <b>₱{Number(p.commission_earned||0).toLocaleString()}</b><br/>Unpaid <b>₱{Number(p.commission_unpaid||0).toLocaleString()}</b></div><button style={p.is_active?styles.rejectBtn:styles.approveBtn} onClick={()=>patchNetworkPartner(p,{is_active:!p.is_active})}>{p.is_active?'Deactivate':'Activate'}</button></div>})}{!networkPartners.length&&<div style={styles.partnerEmpty}>No region, province, or city partners yet.</div>}</div>

          <div style={styles.expenseReviewSection}>
            <div style={styles.expenseReviewHead}>
              <div>
                <h3 style={{...styles.partnerAdminTitle,fontSize:15}}>🧾 Operational Expense Approvals</h3>
                <p style={{...styles.partnerAdminSubtitle,marginBottom:0}}>Partners submit operating costs here for your approval. Approved expenses remain separate from their commission ledger.</p>
              </div>
              <div style={styles.expenseSummaryPills}>
                <span style={{...styles.adminTabContext,color:'#92400e',background:'#fffbeb',borderColor:'#fde68a'}}>{partnerExpenses.filter(x=>x.status==='pending').length} pending</span>
                <span style={styles.adminTabContext}>₱{partnerExpenses.filter(x=>x.status==='pending').reduce((sum,x)=>sum+Number(x.amount||0),0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} pending value</span>
              </div>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={styles.expenseTable}>
                <thead><tr><th>Partner</th><th>Date</th><th>Expense</th><th>Amount</th><th>Status</th><th>Proof</th><th>Action</th></tr></thead>
                <tbody>{[...partnerExpenses].sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')||new Date(b.submitted_at||0)-new Date(a.submitted_at||0)).map(x=><tr key={x.public_id}>
                  <td><b>{x.partner_name||'Partner'}</b><small style={styles.expenseSub}>{x.partner_code||''}</small></td>
                  <td>{x.expense_date?new Date(`${x.expense_date}T00:00:00`).toLocaleDateString(): '—'}</td>
                  <td><b>{String(x.category||'Expense').replaceAll('_',' ')}</b><small style={styles.expenseSub}>{x.description}{x.reference_no?` · Ref: ${x.reference_no}`:''}</small>{x.admin_notes&&<small style={{...styles.expenseSub,color:'#b45309'}}>Admin note: {x.admin_notes}</small>}</td>
                  <td><b>₱{Number(x.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></td>
                  <td><span style={x.status==='approved'?styles.expenseApproved:x.status==='rejected'?styles.expenseRejected:styles.expensePending}>{String(x.status||'pending').replaceAll('_',' ')}</span></td>
                  <td>{x.receipt_url?<a href={x.receipt_url} target="_blank" rel="noreferrer" style={{color:'#0f766e',fontWeight:800}}>View proof ↗</a>:'—'}</td>
                  <td>{x.status==='pending'?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button style={styles.approveBtn} disabled={expenseReviewing===x.public_id} onClick={()=>reviewPartnerExpense(x,'approved')}>Approve</button><button style={styles.rejectBtn} disabled={expenseReviewing===x.public_id} onClick={()=>reviewPartnerExpense(x,'rejected')}>Reject</button></div>:<span style={{fontSize:11,color:'#64748b'}}>{x.reviewed_at?`Reviewed ${new Date(x.reviewed_at).toLocaleDateString()}`:'Reviewed'}</span>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {!partnerExpenses.length&&<div style={styles.partnerEmpty}>No operational expense submissions yet.</div>}
          </div>
        </section>
        )}

        {activeAdminTab === 'operations' && (
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
        )}

        {activeAdminTab === 'partners' && (
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
        )}

        {/* Applications - pending business signups awaiting approval */}
        {activeAdminTab === 'overview' && pendingApps.length > 0 && (
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

        {/* Overview cards — deliberately limited to six headline metrics */}
        {activeAdminTab === 'overview' && (
          <>
            <div style={styles.statsGrid}>
              <StatCard label="Total businesses" value={overview?.total_businesses ?? '—'} />
              <StatCard label="Active" value={overview?.status_breakdown?.ACTIVE ?? 0} accent="#0d9488" />
              <StatCard label="Pending" value={overview?.status_breakdown?.PENDING ?? 0} accent="#d97706" />
              <StatCard label="Total customers" value={overview?.total_customers ?? 0} />
              <StatCard label="Recorded activity · 30d" value={overview?.stamps_30d ?? 0} accent="#2563eb" />
              <StatCard label="Redemptions · 30d" value={overview?.redemptions_30d ?? 0} accent="#7c3aed" />
            </div>

            <div style={styles.overviewStatusStrip}>
              <span style={styles.overviewStatusLabel}>Account status</span>
              <span style={styles.overviewStatusPill}>Active <b>{overview?.status_breakdown?.ACTIVE ?? 0}</b></span>
              <span style={styles.overviewStatusPill}>Suspended <b>{overview?.status_breakdown?.SUSPENDED ?? 0}</b></span>
              <span style={styles.overviewStatusPill}>Rejected <b>{overview?.status_breakdown?.REJECTED ?? 0}</b></span>
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

          </>
        )}

        {activeAdminTab === 'operations' && (
          <>
            <PlatformAnnouncementsAdmin API_BASE={API_BASE} token={token} />
            <GiftCardPrintRequestsAdmin API_BASE={API_BASE} token={token} />
            <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:20,marginTop:16}}>
              <h3 style={{margin:'0 0 6px',fontSize:17}}>👛 Refresh wallet cards</h3>
              <div style={{fontSize:13,color:'#64748b',lineHeight:1.6,marginBottom:14}}>
                Re-sync cards that customers already saved so pass changes (new links, wording) reach them. Runs in the background, one business at a time. Leave the business ID empty to refresh everyone.
              </div>
              <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
                <input
                  value={walletRefresh.businessId}
                  onChange={e=>setWalletRefresh(w=>({...w,businessId:e.target.value}))}
                  placeholder="Business public ID (optional)"
                  style={{padding:'10px 12px',border:'1px solid #cbd5e1',borderRadius:10,fontSize:14,minWidth:240}}
                />
                <label style={{display:'flex',gap:6,alignItems:'center',fontSize:13,color:'#334155'}}>
                  <input type="checkbox" checked={walletRefresh.apple} onChange={e=>setWalletRefresh(w=>({...w,apple:e.target.checked}))} />
                  Include Apple Wallet push
                </label>
                <button style={styles.approveBtn} disabled={walletRefresh.busy} onClick={runWalletRefresh}>
                  {walletRefresh.busy ? 'Starting…' : 'Refresh cards'}
                </button>
              </div>
              {walletRefresh.msg && <div style={{marginTop:12,fontSize:13,color:walletRefresh.msg.startsWith('Started')?'#166534':'#b91c1c',fontWeight:700}}>{walletRefresh.msg}</div>}
            </div>
          </>
        )}

        {activeAdminTab === 'special' && (
        <section style={styles.specialSection}>
          <div style={styles.specialHeader}>
            <div>
              <div style={styles.analyticsEyebrow}>CUSTOM COMMERCIAL ACCOUNTS</div>
              <h2 style={styles.analyticsTitle}>Special Businesses & Automated Invoices</h2>
              <p style={styles.analyticsSubtitle}>Create enterprise/custom accounts directly here. Set branch count, negotiated pricing, invoice tax treatment, and automated billing without using the normal Starter / Growth / Pro price list.</p>
            </div>
            <div style={styles.specialMetricRow}>
              <span style={styles.adminTabContext}>{specialBusinesses.filter(x=>x.is_active).length} active</span>
              <span style={{...styles.adminTabContext,color:'#b45309',background:'#fffbeb',borderColor:'#fde68a'}}>{specialInvoices.filter(x=>x.status==='overdue').length} overdue</span>
            </div>
          </div>

          <form onSubmit={saveSpecialBusiness} style={styles.specialFormCard}>
            <div style={styles.sectionHead}>
              <div>
                <div style={styles.analyticsEyebrow}>{editingSpecialId?'EDIT SPECIAL BILLING':'CREATE SPECIAL BUSINESS'}</div>
                <h3 style={{margin:'3px 0 4px'}}>{editingSpecialId?specialForm.business_name:'Business account + commercial billing'}</h3>
                <p style={{...styles.analyticsSubtitle,margin:0}}>{editingSpecialId?'Update pricing, tax treatment, and invoice schedule.':'This creates a brand-new LoyaltyTree business account and its custom billing contract in one step.'}</p>
              </div>
              {editingSpecialId&&<button type="button" style={styles.refreshBtn} onClick={resetSpecialForm}>Cancel edit</button>}
            </div>

            {!editingSpecialId&&<>
              <div style={{...styles.analyticsEyebrow,marginTop:16}}>BUSINESS ACCOUNT</div>
              <div style={styles.specialFormGrid}>
                <label style={styles.specialField}><span>Business name</span><input style={styles.input} value={specialForm.business_name} onChange={e=>setSpecialForm(f=>({...f,business_name:e.target.value}))} required/></label>
                <label style={styles.specialField}><span>Owner / login email</span><input type="email" style={styles.input} value={specialForm.business_email} onChange={e=>setSpecialForm(f=>({...f,business_email:e.target.value,billing_email:f.billing_email||e.target.value}))} required/></label>
                <label style={styles.specialField}><span>Initial password</span><input type="password" minLength="8" style={styles.input} value={specialForm.business_password} onChange={e=>setSpecialForm(f=>({...f,business_password:e.target.value}))} required/></label>
                <label style={styles.specialField}><span>Phone</span><input style={styles.input} value={specialForm.business_phone} onChange={e=>setSpecialForm(f=>({...f,business_phone:e.target.value}))}/></label>
                <label style={styles.specialField}><span>Business type</span><input style={styles.input} value={specialForm.business_type} onChange={e=>setSpecialForm(f=>({...f,business_type:e.target.value}))} placeholder="restaurant, cafe, gym, salon…"/></label>
                <label style={styles.specialField}><span>Product feature access</span><select style={styles.select} value={specialForm.feature_plan} onChange={e=>setSpecialForm(f=>({...f,feature_plan:e.target.value}))}><option value="starter">Starter features</option><option value="growth">Growth features</option><option value="pro">Pro features</option></select></label>
                <label style={{...styles.specialField,gridColumn:'1 / -1'}}><span>Business address</span><input style={styles.input} value={specialForm.business_address} onChange={e=>setSpecialForm(f=>({...f,business_address:e.target.value,billing_address:f.billing_address||e.target.value}))}/></label>
              </div>
            </>}

            <div style={{...styles.analyticsEyebrow,marginTop:18}}>COMMERCIAL TERMS</div>
            <div style={styles.specialFormGrid}>
              <label style={styles.specialField}><span>Billing email</span><input type="email" style={styles.input} value={specialForm.billing_email} onChange={e=>setSpecialForm(f=>({...f,billing_email:e.target.value}))} required/></label>
              <label style={styles.specialField}><span>Billing contact</span><input style={styles.input} value={specialForm.billing_contact_name} onChange={e=>setSpecialForm(f=>({...f,billing_contact_name:e.target.value}))} placeholder="Accounting / contact person"/></label>
              <label style={styles.specialField}><span>Customer TIN (optional)</span><input style={styles.input} value={specialForm.billing_tin} onChange={e=>setSpecialForm(f=>({...f,billing_tin:e.target.value}))} placeholder="TIN shown on invoice"/></label>
              <label style={styles.specialField}><span>Pricing model</span><select style={styles.select} value={specialForm.pricing_model} onChange={e=>setSpecialForm(f=>({...f,pricing_model:e.target.value}))}><option value="flat">Flat monthly price</option><option value="per_branch">Price per branch / month</option></select></label>
              <label style={styles.specialField}><span>Contracted branches</span><input type="number" min="1" max="10000" style={styles.input} value={specialForm.contracted_branch_count} onChange={e=>setSpecialForm(f=>({...f,contracted_branch_count:e.target.value}))}/></label>
              <label style={styles.specialField}><span>{specialForm.pricing_model==='per_branch'?'Price / branch / month':'Flat price / month'}</span><input type="number" min="0" step="0.01" style={styles.input} value={specialForm.monthly_rate} onChange={e=>setSpecialForm(f=>({...f,monthly_rate:e.target.value}))}/></label>
              <label style={styles.specialField}><span>One-time / setup fee</span><input type="number" min="0" step="0.01" style={styles.input} value={specialForm.setup_fee} onChange={e=>setSpecialForm(f=>({...f,setup_fee:e.target.value}))}/></label>
              <label style={styles.specialField}><span>Billing cycle</span><select style={styles.select} value={specialForm.billing_cycle} onChange={e=>setSpecialForm(f=>({...f,billing_cycle:e.target.value}))}><option value="monthly">Monthly</option><option value="3_months">Every 3 months</option><option value="6_months">Every 6 months</option><option value="annual">Annual</option></select></label>
              <label style={styles.specialField}><span>Exact cycle amount override (optional)</span><input type="number" min="0" step="0.01" style={styles.input} value={specialForm.cycle_amount_override} onChange={e=>setSpecialForm(f=>({...f,cycle_amount_override:e.target.value}))} placeholder="Leave blank to calculate from monthly rate"/></label>
              <label style={styles.specialField}><span>Payment due after</span><div style={{display:'flex',alignItems:'center',gap:8}}><input type="number" min="1" max="90" style={styles.input} value={specialForm.due_days} onChange={e=>setSpecialForm(f=>({...f,due_days:e.target.value}))}/><small>days</small></div></label>
              <label style={{...styles.specialField,gridColumn:'1 / -1'}}><span>Billing address</span><input style={styles.input} value={specialForm.billing_address} onChange={e=>setSpecialForm(f=>({...f,billing_address:e.target.value}))}/></label>
            </div>

            <div style={{...styles.analyticsEyebrow,marginTop:18}}>INVOICE TAX TREATMENT</div>
            <div style={styles.specialFormGrid}>
              <label style={styles.specialField}><span>Tax treatment</span><select style={styles.select} value={specialForm.tax_treatment} onChange={e=>setSpecialForm(f=>({...f,tax_treatment:e.target.value}))}>
                <option value="vat_registered">VAT taxable</option>
                <option value="non_vat">Non-VAT</option>
                <option value="vat_exempt">VAT-exempt transaction</option>
              </select></label>
              {specialForm.tax_treatment==='vat_registered'&&<label style={styles.specialField}><span>VAT rate (%)</span><input type="number" min="0" max="100" step="0.01" style={styles.input} value={specialForm.vat_rate} onChange={e=>setSpecialForm(f=>({...f,vat_rate:e.target.value}))}/></label>}
              {specialForm.tax_treatment==='vat_registered'&&<label style={styles.specialCheckbox}><input type="checkbox" checked={specialForm.price_includes_vat} onChange={e=>setSpecialForm(f=>({...f,price_includes_vat:e.target.checked}))}/> Negotiated price is VAT-inclusive</label>}
              {specialForm.tax_treatment==='vat_exempt'&&<label style={{...styles.specialField,gridColumn:'1 / -1'}}><span>VAT exemption basis / reference</span><input style={styles.input} value={specialForm.vat_exemption_basis} onChange={e=>setSpecialForm(f=>({...f,vat_exemption_basis:e.target.value}))} placeholder="Required — legal/exemption basis or reference"/></label>}
            </div>

            <div style={{...styles.analyticsEyebrow,marginTop:18}}>CONTRACT & DELIVERY</div>
            <div style={styles.specialFormGrid}>
              <label style={styles.specialField}><span>Contract start</span><input type="date" style={styles.input} value={specialForm.contract_start_date} onChange={e=>setSpecialForm(f=>({...f,contract_start_date:e.target.value}))}/></label>
              <label style={styles.specialField}><span>Contract end (optional)</span><input type="date" style={styles.input} value={specialForm.contract_end_date} onChange={e=>setSpecialForm(f=>({...f,contract_end_date:e.target.value}))}/></label>
              <label style={styles.specialField}><span>Next invoice date</span><input type="date" style={styles.input} value={specialForm.next_invoice_date} onChange={e=>setSpecialForm(f=>({...f,next_invoice_date:e.target.value}))}/></label>
              <label style={{...styles.specialField,gridColumn:'1 / -1'}}><span>Invoice description</span><input style={styles.input} value={specialForm.invoice_description} onChange={e=>setSpecialForm(f=>({...f,invoice_description:e.target.value}))} placeholder="e.g. LoyaltyTree Enterprise - up to 60 branches"/></label>
              <label style={{...styles.specialField,gridColumn:'1 / -1'}}><span>Payment instructions</span><textarea style={{...styles.input,minHeight:76}} value={specialForm.payment_instructions} onChange={e=>setSpecialForm(f=>({...f,payment_instructions:e.target.value}))} placeholder="Bank transfer / payment instructions shown on the invoice"/></label>
            </div>

            {(()=>{
              const p=specialInvoicePreview(specialForm)
              return <div style={{...styles.specialCalc,marginTop:14}}>
                <span>Net / sales amount: <b>₱{p.net.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></span>
                <span>VAT: <b>₱{p.vat.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></span>
                <span>Invoice total: <b>₱{p.total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></span>
              </div>
            })()}

            <div style={styles.specialFormFooter}>
              <label style={styles.specialCheckbox}><input type="checkbox" checked={specialForm.auto_invoice} onChange={e=>setSpecialForm(f=>({...f,auto_invoice:e.target.checked}))}/> Automatically generate & email on the next invoice date</label>
              <label style={styles.specialCheckbox}><input type="checkbox" checked={specialForm.is_active} onChange={e=>setSpecialForm(f=>({...f,is_active:e.target.checked}))}/> Active custom billing</label>
              <button type="submit" style={styles.approveBtn} disabled={specialSaving}>{specialSaving?'Saving…':editingSpecialId?'Save changes':'+ Create Special Business'}</button>
            </div>
          </form>

          <div style={styles.specialProfileGrid}>
            {specialBusinesses.map(p=><article key={p.public_id} style={styles.specialProfileCard}>
              <div style={styles.sectionHead}><div><b style={{fontSize:15}}>{p.business_name}</b><div style={styles.bizEmail}>{p.billing_email}</div></div><span style={p.is_active?styles.expenseApproved:styles.expenseRejected}>{p.is_active?'active':'inactive'}</span></div>
              <div style={styles.specialProfileStats}>
                <div><span>Branches</span><b>{p.contracted_branch_count}</b></div>
                <div><span>Monthly</span><b>₱{Number(p.monthly_total||0).toLocaleString()}</b></div>
                <div><span>Cycle</span><b>{specialBillingCycleLabel(p.billing_cycle)}</b></div>
                <div><span>Next invoice</span><b>{p.next_invoice_date||'—'}</b></div>
              </div>
              <div style={styles.specialProfileMeta}>{p.pricing_model==='per_branch'?`₱${Number(p.monthly_rate||0).toLocaleString()} per branch / month`:`₱${Number(p.monthly_rate||0).toLocaleString()} flat / month`}{p.cycle_amount_override!=null?` · Exact ${specialBillingCycleLabel(p.billing_cycle)} amount ₱${Number(p.cycle_amount_override).toLocaleString()}`:''}{Number(p.setup_fee||0)>0?` · Setup ₱${Number(p.setup_fee).toLocaleString()}`:''} · {p.tax_treatment==='vat_registered'?`VAT ${Number(p.vat_rate||0)}%${p.price_includes_vat?' inclusive':' exclusive'}`:p.tax_treatment==='vat_exempt'?'VAT-exempt':'Non-VAT'}</div>
              <div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:12}}>
                <button style={styles.refreshBtn} onClick={()=>editSpecialBusiness(p)}>Edit</button>
                <button style={styles.approveBtn} disabled={specialInvoiceBusy===p.public_id} onClick={()=>generateSpecialInvoice(p)}>{specialInvoiceBusy===p.public_id?'Generating…':'Generate & Email Now'}</button>
              </div>
            </article>)}
            {!specialBusinesses.length&&<div style={styles.partnerEmpty}>No special billing accounts yet.</div>}
          </div>

          <div style={{...styles.specialFormCard,marginTop:18}}>
            <div style={styles.sectionHead}><div><div style={styles.analyticsEyebrow}>INVOICE LEDGER</div><h3 style={{margin:'3px 0 4px'}}>Special business invoices</h3></div><span style={styles.adminTabContext}>{specialInvoices.length} invoices</span></div>
            <div style={{overflowX:'auto',marginTop:12}}>
              <table style={styles.expenseTable}>
                <thead><tr><th>Invoice</th><th>Business</th><th>Period</th><th>Amount</th><th>Due</th><th>Status</th><th>Email</th><th>Action</th></tr></thead>
                <tbody>{specialInvoices.map(inv=><tr key={inv.public_id}>
                  <td><b>{inv.invoice_number}</b><small style={styles.expenseSub}>{inv.issue_date}</small></td>
                  <td><b>{inv.business_name}</b><small style={styles.expenseSub}>{inv.billing_email}</small></td>
                  <td>{inv.period_start}<small style={styles.expenseSub}>to {inv.period_end}</small></td>
                  <td><b>₱{Number(inv.total_amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b><small style={styles.expenseSub}>{inv.tax_treatment==='vat_registered'?`VAT ₱${Number(inv.vat_amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:inv.tax_treatment==='vat_exempt'?'VAT-exempt':'Non-VAT'}</small></td>
                  <td>{inv.due_date}</td>
                  <td><span style={inv.status==='paid'?styles.expenseApproved:inv.status==='overdue'?styles.expenseRejected:styles.expensePending}>{inv.status}</span></td>
                  <td><span style={inv.email_status==='sent'?styles.expenseApproved:inv.email_status==='failed'?styles.expenseRejected:styles.expensePending}>{inv.email_status}</span></td>
                  <td><div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    <a href={`${API_BASE}/api/v1/public/special-invoices/${inv.access_token}`} target="_blank" rel="noreferrer" style={{...styles.refreshBtn,textDecoration:'none'}}>View</a>
                    {inv.status!=='void'&&<button style={styles.refreshBtn} disabled={specialInvoiceBusy===inv.public_id} onClick={()=>resendSpecialInvoice(inv)}>Resend</button>}
                    {!['paid','void'].includes(inv.status)&&<button style={styles.approveBtn} disabled={specialInvoiceBusy===inv.public_id} onClick={()=>openPaymentReceived(inv)}>Payment Received</button>}
                    {inv.status==='paid'&&!inv.acknowledgement_receipt&&<button style={styles.approveBtn} disabled={specialInvoiceBusy===inv.public_id} onClick={()=>openPaymentReceived(inv)}>Create AR</button>}
                    {inv.acknowledgement_receipt&&<>
                      <a href={`${API_BASE}/api/v1/public/special-receipts/${inv.acknowledgement_receipt.access_token}`} target="_blank" rel="noreferrer" style={{...styles.refreshBtn,textDecoration:'none'}}>View AR</a>
                      <button style={styles.refreshBtn} disabled={specialInvoiceBusy===inv.acknowledgement_receipt.public_id} onClick={()=>resendSpecialReceipt(inv.acknowledgement_receipt)}>Resend AR</button>
                    </>}
                    {inv.status!=='void'&&inv.status!=='paid'&&<button style={styles.rejectBtn} disabled={specialInvoiceBusy===inv.public_id} onClick={()=>voidSpecialInvoice(inv)}>Void</button>}
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
            {!specialInvoices.length&&<div style={styles.partnerEmpty}>No special invoices generated yet.</div>}
          </div>
        </section>
        )}


        {activeAdminTab === 'referrals' && (
          <section style={styles.analyticsSection}>
            <div style={styles.analyticsHeader}>
              <div>
                <div style={styles.analyticsEyebrow}>REFERRAL REWARDS</div>
                <h2 style={styles.analyticsTitle}>Who got the 1 month bonus</h2>
                <p style={styles.analyticsSubtitle}>Search a business name, email, or code. A row marked Bonus given means that referrer already received 1 free month because the referred business paid.</p>
              </div>
              <form style={styles.analyticsControls} onSubmit={e=>{e.preventDefault();loadReferralRewards(referralSearch)}}>
                <input value={referralSearch} onChange={e=>setReferralSearch(e.target.value)} placeholder="Search business or code" style={{...styles.input,width:260}} />
                <button type="submit" style={styles.approveBtn}>{referralLoading?'Checking…':'Search'}</button>
              </form>
            </div>
            {referralError && <div style={styles.analyticsError}>{referralError}</div>}
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Referrer</th>
                    <th style={styles.th}>Code</th>
                    <th style={styles.th}>Referred business</th>
                    <th style={styles.th}>Signed up</th>
                    <th style={styles.th}>Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {(referralData?.referrals || []).length === 0 ? (
                    <tr><td style={styles.td} colSpan={5}>{referralLoading?'Loading…':'No referral rewards yet for this search.'}</td></tr>
                  ) : (referralData.referrals || []).map(row => (
                    <tr key={`${row.referrer_public_id}-${row.business_public_id}`} style={styles.tr}>
                      <td style={styles.td}><b>{row.referrer_name}</b><div style={styles.bizEmail}>{row.referrer_public_id}</div></td>
                      <td style={styles.td}>{row.referrer_code || '—'}</td>
                      <td style={styles.td}>{row.business_name}<div style={styles.bizEmail}>{row.business_email}</div></td>
                      <td style={styles.td}>{String(row.signed_up_at || '').slice(0,10) || '—'}</td>
                      <td style={styles.td}>{row.bonus_given ? `Given ${String(row.bonus_given_at || '').slice(0,10)}` : row.paid ? 'Paid, bonus pending' : 'Not yet — waiting for payment'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {activeAdminTab === 'businesses' && (
        <>
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
                    <select
                      value={b.billing_cycle || 'monthly'}
                      onChange={e => updateBusiness(b.public_id, { billing_cycle: e.target.value })}
                      style={{ ...styles.planSelect, marginTop: 6 }}
                    >
                      <option value="monthly">Monthly billing</option>
                      <option value="3_months">3-month billing</option>
                      <option value="6_months">6-month billing</option>
                      <option value="annual">1-year billing · 2 months free</option>
                    </select>
                    {b.price_current != null && (
                      <div style={styles.rowPriceHint}>
                        ₱{b.price_current.toLocaleString()}/{({monthly:'30 days','3_months':'3 months','6_months':'6 months',annual:'year'}[b.billing_cycle || 'monthly'] || '30 days')} · {b.branch_count} branch{b.branch_count !== 1 ? 'es' : ''}
                      </div>
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
                      {b.card_type === 'points' ? '⭐ Points' : b.card_type === 'membership' ? '🪪 Subscription' : b.card_type === 'vip' ? '👑 Tier' : b.card_type === 'hybrid' ? '✨ 2-in-1' : b.card_type === 'multipass' ? '🎫 Multi-Pass' : '🎟️ Stamp'}
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
        </>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div style={styles.modalOverlay} onClick={() => { setShowOrderAheadDesign(false); setSelected(null); setDetail(null); setOrderAheadAdmin(null) }}>
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
                <div style={{...styles.detailRow, alignItems:'flex-start'}}>
                  <span style={styles.detailLabel}>Password security</span>
                  <div style={{width:'100%',maxWidth:260,textAlign:'right'}}>
                    <button
                      type="button"
                      onClick={() => sendBusinessPasswordReset(detail)}
                      disabled={passwordResetSending === detail.public_id || !detail.email}
                      style={{
                        ...styles.viewBtn, width:'100%', padding:'9px 10px', fontWeight:800,
                        background: detail.email ? '#f0fdfa' : '#f8fafc',
                        color: detail.email ? '#0f766e' : '#94a3b8',
                        border: `1px solid ${detail.email ? '#99f6e4' : '#e2e8f0'}`,
                        cursor: detail.email ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {passwordResetSending === detail.public_id ? 'Sending…' : '🔐 Send Password Reset Email'}
                    </button>
                    {detail.email ? (
                      <div style={{fontSize:10.5,color:'#64748b',lineHeight:1.45,marginTop:6}}>
                        Sent only to <strong>{detail.email}</strong>. Super Admin never sees or sets the owner’s password.
                      </div>
                    ) : (
                      <div style={{fontSize:10.5,color:'#b45309',lineHeight:1.45,marginTop:6,fontWeight:700}}>
                        No registered login email — add a valid business login email above first.
                      </div>
                    )}
                    {detail.password_reset_requested_at && (
                      <div style={{fontSize:10.5,color:'#64748b',marginTop:5}}>
                        Last reset email: {new Date(detail.password_reset_requested_at).toLocaleString()}
                        {detail.password_reset_requested_by ? ` · ${detail.password_reset_requested_by === 'super_admin' ? 'Super Admin' : 'Owner'}` : ''}
                      </div>
                    )}
                    {detail.password_changed_at && (
                      <div style={{fontSize:10.5,color:'#047857',marginTop:4}}>
                        Password last changed: {new Date(detail.password_changed_at).toLocaleString()}
                      </div>
                    )}
                  </div>
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
                <div style={{...styles.detailRow, alignItems:'flex-start'}}>
                  <span style={styles.detailLabel}>Order Ahead beta</span>
                  <div style={{width:'100%',maxWidth:390,textAlign:'left'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:10}}>
                      <div>
                        <div style={{fontWeight:800,color:orderAheadAdmin?.enabled?'#047857':'#64748b'}}>{orderAheadAdmin?.enabled?'Enabled':'Disabled'}</div>
                        <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Super Admin controls access. Enabling republishes member Wallet passes.</div>
                      </div>
                      <button
                        type="button"
                        disabled={orderAheadSaving || !orderAheadAdmin}
                        onClick={()=>saveOrderAheadAdmin(!orderAheadAdmin?.enabled, orderAheadAdmin?.button_label)}
                        style={{...styles.viewBtn,background:orderAheadAdmin?.enabled?'#fef2f2':'#ecfdf5',color:orderAheadAdmin?.enabled?'#b91c1c':'#047857',border:`1px solid ${orderAheadAdmin?.enabled?'#fecaca':'#a7f3d0'}`}}
                      >
                        {orderAheadSaving?'Saving…':orderAheadAdmin?.enabled?'Turn Off':'Turn On'}
                      </button>
                    </div>
                    <label style={{display:'block',fontSize:11,fontWeight:750,color:'#64748b',marginBottom:5}}>Wallet action label</label>
                    <div style={{display:'flex',gap:8}}>
                      <input
                        style={{...styles.input,flex:1,minWidth:0}}
                        value={orderAheadAdmin?.button_label || 'Order Ahead'}
                        maxLength={30}
                        onChange={e=>setOrderAheadAdmin(prev=>({...prev,button_label:e.target.value}))}
                        disabled={!orderAheadAdmin}
                      />
                      <button
                        type="button"
                        style={styles.viewBtn}
                        disabled={orderAheadSaving || !orderAheadAdmin}
                        onClick={()=>saveOrderAheadAdmin(!!orderAheadAdmin?.enabled, orderAheadAdmin?.button_label)}
                      >Save label</button>
                    </div>
                    <div style={{fontSize:11,color:orderAheadAdmin?.token_secret_configured?'#047857':'#b45309',marginTop:7}}>
                      {orderAheadAdmin?.token_secret_configured?'✓ Secure Wallet link signing configured':'⚠ ORDER_AHEAD_TOKEN_SECRET is not configured'}
                    </div>
                    {orderAheadAdmin?.enabled && <div style={{fontSize:11,color:'#0f766e',marginTop:7}}>Owner dashboard will show the Order Ahead setup tab for this business.</div>}
                    {orderAheadAdmin?.enabled && (
                      <button
                        type="button"
                        onClick={()=>setShowOrderAheadDesign(true)}
                        style={{...styles.viewBtn,width:'100%',marginTop:10,padding:'9px 12px',fontWeight:800,background:'#f0fdfa'}}
                      >Edit Order Ahead UI</button>
                    )}
                  </div>
                </div>
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
            <button onClick={() => { setShowOrderAheadDesign(false); setSelected(null); setDetail(null); setOrderAheadAdmin(null) }} style={styles.closeBtn}>Close</button>
          </div>
        </div>
      )}

      {/* Super Admin Order Ahead Design Studio */}
      {showOrderAheadDesign && selected && (
        <div style={{...styles.modalOverlay,zIndex:450}} onClick={()=>setShowOrderAheadDesign(false)}>
          <div style={styles.orderAheadDesignModal} onClick={e=>e.stopPropagation()}>
            <div style={styles.oaDesignHeader}>
              <div>
                <div style={styles.oaDesignEyebrow}>SUPER ADMIN ONLY</div>
                <h2 style={{...styles.modalTitle,marginBottom:4}}>Order Ahead Design Studio</h2>
                <div style={{fontSize:12,color:'#64748b'}}>{detail?.name || selected?.name} · owners cannot edit these controls</div>
              </div>
              <button style={styles.closeBtn} onClick={()=>setShowOrderAheadDesign(false)}>Close</button>
            </div>

            <div style={styles.oaDesignGrid}>
              <div style={styles.oaDesignControls}>
                <DesignSection title="Layout">
                  <DesignSelect label="Template" value={orderAheadDesign.template} onChange={v=>setOrderAheadDesign(d=>({...d,template:v}))} options={[["modern","Modern"],["minimal","Minimal"],["bold","Bold"]]}/>
                  <DesignSelect label="Header" value={orderAheadDesign.header_style} onChange={v=>setOrderAheadDesign(d=>({...d,header_style:v}))} options={[["logo_name","Logo + business name"],["banner","Banner + logo"],["compact","Compact"]]}/>
                  <DesignSelect label="Logo shape" value={orderAheadDesign.logo_shape} onChange={v=>setOrderAheadDesign(d=>({...d,logo_shape:v}))} options={[["rounded","Rounded"],["circle","Circle"],["square","Square"]]}/>
                  <DesignSelect label="Branch cards" value={orderAheadDesign.branch_card_style} onChange={v=>setOrderAheadDesign(d=>({...d,branch_card_style:v}))} options={[["soft","Soft cards"],["outline","Outline"],["flat","Flat"]]}/>
                  <DesignSelect label="Action style" value={orderAheadDesign.button_style} onChange={v=>setOrderAheadDesign(d=>({...d,button_style:v}))} options={[["text","Text + arrow"],["filled","Filled button"],["outline","Outline button"]]}/>
                </DesignSection>

                <DesignSection title="Brand colors">
                  <div style={styles.oaColorGrid}>
                    <DesignColor label="Primary" value={orderAheadDesign.primary_color} onChange={v=>setOrderAheadDesign(d=>({...d,primary_color:v}))}/>
                    <DesignColor label="Background" value={orderAheadDesign.background_color} onChange={v=>setOrderAheadDesign(d=>({...d,background_color:v}))}/>
                    <DesignColor label="Cards" value={orderAheadDesign.surface_color} onChange={v=>setOrderAheadDesign(d=>({...d,surface_color:v}))}/>
                    <DesignColor label="Text" value={orderAheadDesign.text_color} onChange={v=>setOrderAheadDesign(d=>({...d,text_color:v}))}/>
                    <DesignColor label="Muted text" value={orderAheadDesign.muted_color} onChange={v=>setOrderAheadDesign(d=>({...d,muted_color:v}))}/>
                  </div>
                </DesignSection>

                <DesignSection title="Customer copy">
                  <label style={styles.oaDesignLabel}>Branch heading</label>
                  <input style={styles.input} maxLength={80} value={orderAheadDesign.branch_heading || ''} onChange={e=>setOrderAheadDesign(d=>({...d,branch_heading:e.target.value}))}/>
                  <label style={{...styles.oaDesignLabel,marginTop:10}}>Branch action</label>
                  <input style={styles.input} maxLength={40} value={orderAheadDesign.branch_cta_label || ''} onChange={e=>setOrderAheadDesign(d=>({...d,branch_cta_label:e.target.value}))}/>
                  <label style={styles.oaToggleRow}><input type="checkbox" checked={!!orderAheadDesign.show_banner} onChange={e=>setOrderAheadDesign(d=>({...d,show_banner:e.target.checked}))}/><span>Show business banner when available</span></label>
                  <label style={styles.oaToggleRow}><input type="checkbox" checked={!!orderAheadDesign.show_greeting} onChange={e=>setOrderAheadDesign(d=>({...d,show_greeting:e.target.checked}))}/><span>Show member greeting</span></label>
                </DesignSection>

                <DesignSection title="Menu UI">
                  <label style={styles.oaDesignLabel}>Menu heading</label>
                  <input style={{...styles.input,marginBottom:10}} maxLength={60} value={orderAheadDesign.menu_heading || ''} onChange={e=>setOrderAheadDesign(d=>({...d,menu_heading:e.target.value}))}/>
                  <DesignSelect label="Categories" value={orderAheadDesign.category_style} onChange={v=>setOrderAheadDesign(d=>({...d,category_style:v}))} options={[["pills","Pills"],["tabs","Tabs"],["plain","Plain"]]}/>
                  <DesignSelect label="Product layout" value={orderAheadDesign.product_layout} onChange={v=>setOrderAheadDesign(d=>({...d,product_layout:v}))} options={[["image_top","Image grid"],["image_left","Image left list"],["compact","Compact list"]]}/>
                  <DesignSelect label="Product cards" value={orderAheadDesign.product_card_style} onChange={v=>setOrderAheadDesign(d=>({...d,product_card_style:v}))} options={[["soft","Soft cards"],["outline","Outline"],["flat","Flat"]]}/>
                  <DesignSelect label="Product image" value={orderAheadDesign.image_shape} onChange={v=>setOrderAheadDesign(d=>({...d,image_shape:v}))} options={[["rounded","Rounded"],["square","Square"]]}/>
                  <DesignSelect label="Add button" value={orderAheadDesign.add_button_style} onChange={v=>setOrderAheadDesign(d=>({...d,add_button_style:v}))} options={[["plus","+ icon"],["text","Add text"],["filled","+ Add filled"]]}/>
                  <label style={styles.oaToggleRow}><input type="checkbox" checked={!!orderAheadDesign.show_product_description} onChange={e=>setOrderAheadDesign(d=>({...d,show_product_description:e.target.checked}))}/><span>Show product descriptions</span></label>
                  <label style={styles.oaToggleRow}><input type="checkbox" checked={!!orderAheadDesign.sticky_cart} onChange={e=>setOrderAheadDesign(d=>({...d,sticky_cart:e.target.checked}))}/><span>Show sticky cart bar after adding an item</span></label>
                  <div style={{fontSize:11,color:'#94a3b8',lineHeight:1.45}}>Owners edit products, prices and options. Only Super Admin controls this layout.</div>
                </DesignSection>

                <div style={styles.oaDesignActions}>
                  <button disabled={orderAheadDesignSaving} style={styles.oaPrimaryBtn} onClick={()=>saveOrderAheadDesign()}>{orderAheadDesignSaving?'Saving…':'Save UI'}</button>
                  <button disabled={orderAheadDesignSaving} style={styles.closeBtn} onClick={resetOrderAheadDesign}>Reset to LoyaltyTree default</button>
                </div>
              </div>

              <div style={styles.oaPreviewPane}>
                <div style={styles.oaPreviewSticky}>
                  <div style={styles.oaPreviewTitle}>LIVE MOBILE PREVIEW</div>
                  <OrderAheadPreview business={detail || selected} design={orderAheadDesign}/>
                  <div style={{fontSize:10.5,color:'#94a3b8',textAlign:'center',marginTop:10,lineHeight:1.45}}>Preview uses sample branch/menu content. The real customer page uses the business's live branches and branding.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClientPresentation && (
        <div style={{...styles.modalOverlay,zIndex:500}} onClick={()=>setShowClientPresentation(false)}>
          <div className="client-presentation-sheet" style={styles.clientPresentationSheet} onClick={e=>e.stopPropagation()}>
            <div className="client-presentation-actions" style={styles.clientPresentationActions}>
              <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,color:'#475569'}}>
                <input type="checkbox" checked={presentationAnonymized} onChange={e=>setPresentationAnonymized(e.target.checked)} />
                Anonymize client names
              </label>
              <button style={styles.viewBtn} onClick={()=>window.print()}>Print / Save PDF</button>
              <button style={styles.closeBtn} onClick={()=>setShowClientPresentation(false)}>Close</button>
            </div>

            <div style={styles.presentationEyebrow}>LOYALTYTREE CLIENT PERFORMANCE</div>
            <h2 style={styles.presentationTitle}>{clientPerfDays}-Day CRM & Retention Snapshot</h2>
            <p style={styles.presentationSubtitle}>
              Aggregated LoyaltyTree client activity. Metrics are based on recorded loyalty/card activity unless a live POS connection is explicitly identified.
            </p>

            <div style={styles.presentationMetricGrid}>
              <PresentationMetric label="Clients in view" value={presentationSummary.clients} />
              <PresentationMetric label="Active members" value={presentationSummary.active_members.toLocaleString()} />
              <PresentationMetric label="Returning members" value={presentationSummary.returning_members.toLocaleString()} />
              <PresentationMetric label="Returning-member share" value={`${presentationSummary.returning_rate}%`} />
              <PresentationMetric label="New members" value={presentationSummary.new_customers.toLocaleString()} />
              <PresentationMetric label="Reward redemptions" value={presentationSummary.redemptions.toLocaleString()} />
            </div>

            <div style={styles.presentationCalloutGrid}>
              <div style={styles.presentationCallout}><strong>{presentationSummary.improving}</strong><span>clients with improving CRM movement</span></div>
              <div style={styles.presentationCallout}><strong>{presentationSummary.pos_connected}</strong><span>clients connected to a POS provider</span></div>
              <div style={styles.presentationCallout}><strong>{presentationSummary.membership_renewals}</strong><span>membership renewals recorded</span></div>
            </div>

            <div style={styles.presentationSectionTitle}>Client evidence</div>
            <div style={styles.presentationClientGrid}>
              {clientPerfRows
                .slice()
                .sort((a,b)=>Number(b.crm?.active_members||0)-Number(a.crm?.active_members||0))
                .slice(0,8)
                .map((row,index)=>{
                  const crm=row.crm||{}, activity=row.activity||{}
                  const name=presentationAnonymized ? `${businessTypeLabel(row.business_type).replace(/^\\S+\\s*/,'')} Client ${index+1}` : row.business_name
                  return <div key={row.business_public_id} style={styles.presentationClientCard}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'}}>
                      <div>
                        <div style={{fontWeight:850,color:'#0f172a'}}>{name}</div>
                        <div style={{fontSize:10.5,color:'#64748b',marginTop:2}}>{row.pos?.connected?'LoyaltyTree + POS':'LoyaltyTree Activity'}</div>
                      </div>
                      <span style={{...styles.clientTrendBadge,...clientTrendStyle(row.trend)}}>{clientTrendLabel(row.trend)}</span>
                    </div>
                    <div style={styles.presentationEvidenceRow}><span>Active members</span><b>{crm.active_members||0}</b></div>
                    <div style={styles.presentationEvidenceRow}><span>Returning share</span><b>{crm.returning_rate||0}%</b></div>
                    <div style={styles.presentationEvidenceRow}><span>New members</span><b>{crm.new_customers||0}</b></div>
                    <div style={styles.presentationEvidenceRow}><span>Redemptions</span><b>{activity.redemptions||0}</b></div>
                  </div>
                })}
            </div>

            <div style={styles.presentationFootnote}>
              Methodology: “Returning member” means active during the selected period with earlier recorded LoyaltyTree activity. Client-level personal data is excluded. Non-POS metrics should not be described as sales or revenue.
            </div>
          </div>
        </div>
      )}

      {paymentReceivedModal && (
        <div style={styles.modalOverlay} onClick={()=>!paymentReceivedSaving&&setPaymentReceivedModal(null)}>
          <form style={styles.modal} onSubmit={confirmPaymentReceived} onClick={e=>e.stopPropagation()}>
            <div style={styles.analyticsEyebrow}>PAYMENT CONFIRMATION</div>
            <h2 style={styles.modalTitle}>Payment Received</h2>
            <p style={{color:'#64748b',fontSize:12.5,lineHeight:1.5,marginTop:-8}}>
              Confirm only after Loyalty Tree has actually received the payment. This marks <b>{paymentReceivedModal.invoice_number}</b> as paid and automatically generates and emails an acknowledgement receipt.
            </p>
            <div style={{...styles.specialCalc,margin:'12px 0'}}>
              Invoice total: <b>₱{Number(paymentReceivedModal.total_amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b>
            </div>
            <div style={styles.detailGrid}>
              <label style={styles.specialField}><span>Payment date</span><input required type="date" style={styles.input} value={paymentReceivedForm.payment_date} onChange={e=>setPaymentReceivedForm(f=>({...f,payment_date:e.target.value}))}/></label>
              <label style={styles.specialField}><span>Payment method</span><select style={styles.select} value={paymentReceivedForm.payment_method} onChange={e=>setPaymentReceivedForm(f=>({...f,payment_method:e.target.value}))}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="gcash">GCash</option>
                <option value="paymongo">PayMongo</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select></label>
              <label style={styles.specialField}><span>Amount received</span><input required type="number" min="0.01" step="0.01" style={styles.input} value={paymentReceivedForm.amount_received} onChange={e=>setPaymentReceivedForm(f=>({...f,amount_received:e.target.value}))}/></label>
              <label style={styles.specialField}><span>Reference / transaction no.</span><input style={styles.input} value={paymentReceivedForm.payment_reference} onChange={e=>setPaymentReceivedForm(f=>({...f,payment_reference:e.target.value}))} placeholder="Bank ref, GCash ref, PayMongo ID…"/></label>
              <label style={styles.specialField}><span>Remarks</span><textarea style={{...styles.input,minHeight:72}} value={paymentReceivedForm.remarks} onChange={e=>setPaymentReceivedForm(f=>({...f,remarks:e.target.value}))} placeholder="Optional payment note"/></label>
            </div>
            {Number(paymentReceivedForm.amount_received||0)!==Number(paymentReceivedModal.total_amount||0)&&(
              <div style={styles.backendNote}>Amount received differs from the invoice total. You can still confirm intentionally; the acknowledgement receipt will show the actual amount received.</div>
            )}
            <div style={{display:'flex',gap:10,marginTop:14,flexWrap:'wrap'}}>
              <button type="submit" style={styles.approveBtn} disabled={paymentReceivedSaving}>{paymentReceivedSaving?'Confirming…':'Confirm Payment Received & Send AR'}</button>
              <button type="button" style={styles.closeBtn} disabled={paymentReceivedSaving} onClick={()=>setPaymentReceivedModal(null)}>Cancel</button>
            </div>
          </form>
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


function ClientMetric({label,value}) {
  return <div style={styles.clientMetric}><span style={{fontSize:9.5,color:'#94a3b8',fontWeight:750}}>{label}</span><b style={{fontSize:13,color:'#0f172a'}}>{Number.isFinite(Number(value)) && typeof value !== 'string' ? Number(value).toLocaleString() : value}</b></div>
}

function ClientMovement({label,value,suffix=''}) {
  const missing = value == null
  const n = Number(value || 0)
  const positive = !missing && n > 0
  const negative = !missing && n < 0
  return <div style={styles.clientMovement}>
    <span>{label}</span>
    <b style={{color:positive?'#047857':negative?'#b91c1c':'#64748b'}}>
      {missing ? 'New' : `${positive?'+':''}${n}${suffix}`}
    </b>
  </div>
}

function PresentationMetric({label,value}) {
  return <div style={styles.presentationMetric}><div style={{fontSize:25,fontWeight:900,color:'#0f172a'}}>{value}</div><span style={{fontSize:10.5,color:'#64748b',fontWeight:750}}>{label}</span></div>
}

function clientTrendLabel(trend) {
  return trend==='improving' ? 'Improving' : trend==='needs_attention' ? 'Needs attention' : trend==='limited_data' ? 'Limited data' : 'Stable'
}

function clientTrendStyle(trend) {
  if (trend==='improving') return {background:'#dcfce7',color:'#166534',borderColor:'#86efac'}
  if (trend==='needs_attention') return {background:'#fef2f2',color:'#b91c1c',borderColor:'#fecaca'}
  if (trend==='limited_data') return {background:'#f8fafc',color:'#64748b',borderColor:'#e2e8f0'}
  return {background:'#eff6ff',color:'#1d4ed8',borderColor:'#bfdbfe'}
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

function DesignSection({title,children}) {
  return <div style={styles.oaDesignSection}><div style={styles.oaDesignSectionTitle}>{title}</div>{children}</div>
}
function DesignSelect({label,value,onChange,options}) {
  return <label style={{display:'block',marginBottom:10}}><span style={styles.oaDesignLabel}>{label}</span><select style={{...styles.select,width:'100%'}} value={value || ''} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
}
function DesignColor({label,value,onChange}) {
  return <label style={styles.oaColorField}><span style={styles.oaDesignLabel}>{label}</span><div style={{display:'flex',alignItems:'center',gap:7}}><input type="color" value={value || '#000000'} onChange={e=>onChange(e.target.value)} style={styles.oaColorPicker}/><input value={value || ''} maxLength={7} onChange={e=>onChange(e.target.value)} style={{...styles.input,padding:'7px 8px',fontSize:11}}/></div></label>
}
function OrderAheadPreview({business,design}) {
  const [screen,setScreen]=useState('menu')
  const d={...OA_DESIGN_DEFAULTS,...(design||{})}
  const logoRadius=d.logo_shape==='circle'?999:d.logo_shape==='square'?4:14
  const branchRadius=d.branch_card_style==='flat'?9:d.branch_card_style==='outline'?13:18
  const productRadius=d.product_card_style==='flat'?8:d.product_card_style==='outline'?12:16
  const shadow=d.product_card_style==='soft'?'0 8px 20px rgba(15,23,42,.07)':'none'
  const sampleImage='linear-gradient(135deg,#e2e8f0,#cbd5e1)'
  const products=[['Iced Latte','₱140'],['Spanish Latte','₱160'],['Croissant','₱95'],['Cold Brew','₱130']]
  const addLabel=d.add_button_style==='text'?'Add':d.add_button_style==='filled'?'+ Add':'+'
  return <div>
    <div style={{display:'flex',justifyContent:'center',gap:6,marginBottom:9}}><button onClick={()=>setScreen('branch')} style={{fontSize:10,padding:'5px 8px',borderRadius:999,border:'1px solid #cbd5e1',background:screen==='branch'?'#0f172a':'#fff',color:screen==='branch'?'#fff':'#475569'}}>Branch</button><button onClick={()=>setScreen('menu')} style={{fontSize:10,padding:'5px 8px',borderRadius:999,border:'1px solid #cbd5e1',background:screen==='menu'?'#0f172a':'#fff',color:screen==='menu'?'#fff':'#475569'}}>Menu</button></div>
    <div style={{...styles.oaPhone,background:d.background_color,color:d.text_color}}>
      <div style={styles.oaPhoneNotch}></div><div style={styles.oaPhoneBody}>
        {d.show_banner && <div style={{height:64,borderRadius:14,background:sampleImage,marginBottom:10,overflow:'hidden'}}>{business?.loyalty_program?.hero_image_url&&<img src={business.loyalty_program.hero_image_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>}</div>}
        <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:13}}>{business?.logo_url?<img src={business.logo_url} alt="" style={{width:38,height:38,borderRadius:logoRadius,objectFit:'cover',border:'1px solid #e2e8f0'}}/>:<div style={{width:38,height:38,borderRadius:logoRadius,display:'grid',placeItems:'center',background:'#e2e8f0'}}>🏪</div>}<div><div style={{fontWeight:850,fontSize:15}}>{business?.name||'Business Name'}</div>{d.show_greeting&&<div style={{fontSize:9.5,color:d.muted_color}}>Hi, Member · Order Ahead</div>}</div></div>
        {screen==='branch'?<><div style={{fontWeight:800,fontSize:12,marginBottom:7}}>{d.branch_heading}</div>{[['Main Branch','123 Sample Street'],['Mall Branch','Level 2']].map(([n,a])=><div key={n} style={{background:d.surface_color,border:d.branch_card_style==='flat'?'1px solid transparent':'1px solid #e2e8f0',borderRadius:branchRadius,padding:10,marginBottom:7}}><div style={{fontWeight:800,fontSize:12}}>{n}</div><div style={{fontSize:9.5,color:d.muted_color,marginTop:2}}>{a}</div><div style={{color:d.primary_color,fontSize:10,fontWeight:800,marginTop:7}}>{d.branch_cta_label} ›</div></div>)}</>:<>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'end',marginBottom:8}}><div><div style={{fontWeight:900,fontSize:15}}>{d.menu_heading||'Menu'}</div><div style={{fontSize:9.5,color:d.muted_color}}>Main Branch</div></div></div>
          <div style={{display:'flex',gap:5,overflow:'hidden',marginBottom:9}}>{['All','Coffee','Pastries'].map((c,i)=><span key={c} style={{whiteSpace:'nowrap',fontSize:9.5,fontWeight:800,padding:'6px 8px',borderRadius:d.category_style==='pills'?999:6,background:i===0?d.primary_color:d.surface_color,color:i===0?'#fff':d.text_color,border:'1px solid #e2e8f0'}}>{c}</span>)}</div>
          <div style={{display:'grid',gridTemplateColumns:d.product_layout==='image_top'?'1fr 1fr':'1fr',gap:7}}>{products.map(([n,p],i)=><div key={n} style={{background:d.surface_color,border:d.product_card_style==='flat'?'1px solid transparent':'1px solid #e2e8f0',borderRadius:productRadius,boxShadow:shadow,overflow:'hidden',display:d.product_layout==='image_top'?'block':'grid',gridTemplateColumns:d.product_layout==='image_left'?'62px 1fr':d.product_layout==='compact'?'48px 1fr':'1fr'}}><div style={{height:d.product_layout==='image_top'?66:d.product_layout==='compact'?48:62,background:sampleImage}}></div><div style={{padding:7,minWidth:0}}><div style={{fontSize:10.5,fontWeight:850}}>{n}</div>{d.show_product_description&&<div style={{fontSize:8.5,color:d.muted_color,marginTop:2}}>Sample product description</div>}<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:5}}><span style={{fontSize:9.5,fontWeight:850}}>{p}</span><span style={{fontSize:9,fontWeight:900,background:d.primary_color,color:'#fff',borderRadius:999,padding:d.add_button_style==='plus'?'3px 6px':'3px 7px'}}>{addLabel}</span></div></div></div>)}</div>
          {d.sticky_cart&&<div style={{marginTop:9,background:d.primary_color,color:'#fff',borderRadius:11,padding:'8px 9px',display:'flex',justifyContent:'space-between',fontSize:9.5,fontWeight:850}}><span>2 items</span><span>₱300 · View Cart</span></div>}
        </>}
      </div>
    </div>
  </div>
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
  adminTopActions:{display:'flex',justifyContent:'flex-end',alignItems:'center',marginBottom:14},
  adminTabNav:{display:'flex',gap:7,overflowX:'auto',WebkitOverflowScrolling:'touch',padding:'5px',marginBottom:16,background:'#e9eef5',border:'1px solid #dbe3ec',borderRadius:14,scrollbarWidth:'none'},
  adminTabButton:{display:'flex',alignItems:'center',gap:7,minHeight:40,padding:'9px 12px',border:'1px solid transparent',borderRadius:10,background:'transparent',color:'#64748b',fontSize:12.5,fontWeight:800,cursor:'pointer',whiteSpace:'nowrap'},
  adminTabButtonActive:{background:'#fff',color:'#0f172a',borderColor:'#dbe3ec',boxShadow:'0 2px 8px rgba(15,23,42,.07)'},
  adminTabIcon:{fontSize:14,lineHeight:1,color:'inherit'},
  adminTabBadge:{display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:20,height:20,padding:'0 6px',borderRadius:999,background:'#cbd5e1',color:'#475569',fontSize:10,fontWeight:900},
  adminTabBadgeActive:{background:'#ccfbf1',color:'#0f766e'},
  adminTabHeading:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,marginBottom:18,padding:'2px 2px 0'},
  adminTabEyebrow:{fontSize:10,fontWeight:900,letterSpacing:'.11em',color:'#0f766e'},
  adminTabTitle:{margin:'3px 0 3px',fontSize:22,color:'#0f172a',letterSpacing:'-.02em'},
  adminTabDescription:{margin:0,color:'#64748b',fontSize:13,lineHeight:1.5,maxWidth:680},
  adminTabContext:{padding:'7px 10px',border:'1px solid #dbe3ec',background:'#fff',color:'#475569',fontSize:11.5,fontWeight:800,borderRadius:999,whiteSpace:'nowrap'},
  overviewStatusStrip:{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'12px 14px',margin:'-4px 0 14px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:12},
  overviewStatusLabel:{fontSize:11,fontWeight:900,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em',marginRight:2},
  overviewStatusPill:{fontSize:11.5,color:'#475569',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:999,padding:'6px 9px'},
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

  expenseReviewSection:{marginTop:22,paddingTop:18,borderTop:'1px solid #e2e8f0'},
  expenseReviewHead:{display:'flex',justifyContent:'space-between',gap:14,alignItems:'flex-start',flexWrap:'wrap',marginBottom:12},
  expenseSummaryPills:{display:'flex',gap:7,flexWrap:'wrap'},
  expenseTable:{width:'100%',minWidth:920,borderCollapse:'collapse',fontSize:12},
  expenseSub:{display:'block',marginTop:3,color:'#94a3b8',fontWeight:500,maxWidth:320,lineHeight:1.35},
  expensePending:{display:'inline-flex',padding:'4px 8px',borderRadius:999,background:'#fffbeb',color:'#92400e',fontSize:10.5,fontWeight:900,textTransform:'capitalize'},
  expenseApproved:{display:'inline-flex',padding:'4px 8px',borderRadius:999,background:'#ecfdf5',color:'#047857',fontSize:10.5,fontWeight:900,textTransform:'capitalize'},
  expenseRejected:{display:'inline-flex',padding:'4px 8px',borderRadius:999,background:'#fef2f2',color:'#b91c1c',fontSize:10.5,fontWeight:900,textTransform:'capitalize'},

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
  specialSection:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:20,padding:22,marginBottom:24,boxShadow:'0 10px 30px rgba(15,23,42,.045)'},
  specialHeader:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:14,flexWrap:'wrap',marginBottom:18},
  specialMetricRow:{display:'flex',gap:7,flexWrap:'wrap'},
  specialFormCard:{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:16,padding:17,marginBottom:16},
  specialFormGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:11,marginTop:14},
  specialField:{display:'grid',gap:5,fontSize:10.5,fontWeight:850,color:'#64748b',textTransform:'uppercase',letterSpacing:.35},
  specialFormFooter:{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginTop:14,paddingTop:13,borderTop:'1px solid #e2e8f0'},
  specialCheckbox:{display:'flex',gap:7,alignItems:'center',fontSize:11.5,fontWeight:750,color:'#475569',textTransform:'none',letterSpacing:0},
  specialCalc:{marginLeft:'auto',fontSize:12,color:'#475569'},
  specialProfileGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:11},
  specialProfileCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:15,background:'#fff'},
  specialProfileStats:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:7,marginTop:12},
  specialProfileMeta:{fontSize:11,color:'#64748b',marginTop:9,lineHeight:1.45},
  analyticsSection:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:20,padding:22,marginBottom:24,boxShadow:'0 10px 30px rgba(15,23,42,.045)'},
  analyticsHeader:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginBottom:18},
  analyticsEyebrow:{fontSize:10,fontWeight:850,letterSpacing:1.3,color:'#0f766e',marginBottom:5},
  analyticsTitle:{margin:0,fontSize:23,color:'#0f172a',letterSpacing:'-.35px'},
  analyticsSubtitle:{margin:'6px 0 0',fontSize:12.5,color:'#64748b',lineHeight:1.55,maxWidth:760},
  analyticsControls:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'},
  analyticsError:{padding:'11px 13px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:10,fontSize:12.5,marginBottom:14},
  analyticsMetricGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginBottom:12},
  analyticsMetricCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:'15px 16px',background:'#f8fafc'},
  analyticsMetricLabel:{fontSize:10.5,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:.55},
  analyticsMetricValue:{fontSize:30,fontWeight:850,color:'#0f172a',marginTop:5,lineHeight:1.05},
  analyticsMetricHint:{fontSize:10.5,color:'#94a3b8',marginTop:6},
  analyticsSnapshotGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:10,marginBottom:12},
  analyticsInsightCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:16,background:'#fff',minWidth:0},
  analyticsCardTitle:{fontSize:12.5,fontWeight:850,color:'#0f172a',marginBottom:11},
  analyticsInsightValue:{fontSize:27,fontWeight:900,color:'#0f766e',lineHeight:1},
  analyticsInsightSub:{fontSize:11,color:'#64748b',marginTop:5,marginBottom:10},
  analyticsInsightRows:{display:'grid',gap:6},
  analyticsInsightRow:{display:'flex',justifyContent:'space-between',gap:10,fontSize:11.5,color:'#475569'},
  analyticsMiniGrid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8},
  analyticsMiniStat:{display:'flex',flexDirection:'column',gap:4,padding:'9px 10px',borderRadius:10,background:'#f8fafc',fontSize:10.5,color:'#64748b'},
  analyticsPrimaryGrid:{display:'grid',gridTemplateColumns:'minmax(0,2fr) minmax(220px,.72fr)',gap:10,marginBottom:18},
  analyticsTrendCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:16,marginBottom:14,overflow:'hidden'},
  analyticsTrend:{height:175,display:'flex',alignItems:'flex-end',gap:4,overflowX:'auto',paddingTop:12},
  analyticsBarSlot:{height:'100%',minWidth:18,flex:'1 0 18px',maxWidth:36,display:'flex',flexDirection:'column',justifyContent:'flex-end',alignItems:'stretch',gap:5},
  analyticsBar:{minHeight:4,borderRadius:'6px 6px 2px 2px',background:'linear-gradient(180deg,#14b8a6,#0f766e)'},
  analyticsBarLabel:{fontSize:8.5,color:'#94a3b8',textAlign:'center',whiteSpace:'nowrap'},
  analyticsSummaryCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:16,background:'#f8fafc'},
  analyticsSummaryRow:{display:'flex',justifyContent:'space-between',gap:10,padding:'9px 0',borderBottom:'1px solid #e2e8f0',fontSize:12,color:'#475569'},
  analyticsSampleNote:{marginTop:10,padding:'8px 9px',borderRadius:9,background:'#fff7ed',color:'#9a3412',fontSize:10.5,lineHeight:1.45},
  analyticsSectionHeading:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-end',flexWrap:'wrap',margin:'18px 0 10px'},
  analyticsSectionHeadingInline:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:10},
  analyticsSectionHeadingTitle:{fontSize:14.5,fontWeight:900,color:'#0f172a'},
  analyticsSectionHeadingSub:{fontSize:11,color:'#64748b',marginTop:3,lineHeight:1.45},
  analyticsCoverageBadge:{display:'inline-flex',padding:'6px 9px',borderRadius:999,background:'#ecfdf5',color:'#047857',fontSize:10.5,fontWeight:850,border:'1px solid #a7f3d0'},
  analyticsLocationGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginBottom:4},
  analyticsBreakdownGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginBottom:14},
  analyticsBreakdownCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:15,minWidth:0,background:'#fff'},
  analyticsBreakdownRow:{marginBottom:9},
  analyticsBreakdownLabel:{display:'flex',justifyContent:'space-between',gap:10,fontSize:11.5,color:'#475569',marginBottom:4,overflow:'hidden'},
  analyticsBreakdownTrack:{height:5,borderRadius:99,background:'#f1f5f9',overflow:'hidden'},
  analyticsBreakdownFill:{height:'100%',borderRadius:99,background:'#14b8a6'},
  analyticsListCard:{border:'1px solid #e2e8f0',borderRadius:14,padding:16,marginTop:10},
  analyticsRankRow:{display:'flex',justifyContent:'space-between',gap:12,padding:'9px 0',borderBottom:'1px solid #f1f5f9',fontSize:12.5,color:'#334155'},
  analyticsRankSub:{display:'block',fontWeight:400,color:'#94a3b8',marginTop:2},
  analyticsRecentRow:{display:'grid',gridTemplateColumns:'145px minmax(150px,1fr) minmax(240px,1.5fr)',gap:12,alignItems:'center',padding:'9px 0',borderBottom:'1px solid #f1f5f9',fontSize:11.5},
  analyticsEventBadge:{display:'inline-block',background:'#ecfdf5',color:'#0f766e',borderRadius:999,padding:'4px 8px',fontWeight:750,textTransform:'capitalize',width:'fit-content'},
  analyticsRecentPath:{color:'#334155',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  analyticsRecentMeta:{display:'flex',flexDirection:'column',gap:3,color:'#94a3b8',minWidth:0,overflow:'hidden'},
  analyticsRecentLocation:{color:'#475569',fontSize:11.5,fontWeight:750,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  analyticsEmpty:{fontSize:12,color:'#94a3b8',padding:'12px 0'},

  clientPerformanceSection:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:20,padding:22,marginBottom:24,boxShadow:'0 10px 30px rgba(15,23,42,.045)'},
  clientPerformanceToolbar:{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap',padding:'11px 0 14px',borderTop:'1px solid #f1f5f9',marginTop:4},
  clientPerformanceGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:11},
  clientPerformanceCard:{border:'1px solid #e2e8f0',borderRadius:15,padding:15,background:'#fff',minWidth:0},
  clientPerformanceCardHeader:{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'},
  clientPerformanceLogo:{width:38,height:38,borderRadius:9,objectFit:'contain',border:'1px solid #e2e8f0',background:'#fff'},
  clientPerformanceLogoFallback:{width:38,height:38,borderRadius:9,display:'grid',placeItems:'center',background:'#f1f5f9',fontSize:18},
  clientPerformanceName:{fontSize:13.5,fontWeight:900,color:'#0f172a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},
  clientPerformanceMeta:{fontSize:10.5,color:'#94a3b8',marginTop:3},
  clientTrendBadge:{display:'inline-flex',padding:'5px 8px',borderRadius:999,border:'1px solid #e2e8f0',fontSize:9.5,fontWeight:900,whiteSpace:'nowrap'},
  clientSourceBadge:{display:'inline-flex',marginTop:10,padding:'5px 8px',borderRadius:999,background:'#f0fdfa',color:'#0f766e',fontSize:9.5,fontWeight:850},
  clientMetricGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginTop:11},
  clientMetric:{background:'#f8fafc',borderRadius:9,padding:'8px 9px',display:'flex',flexDirection:'column',gap:3,minWidth:0},
  clientMovementRow:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:7,marginTop:8},
  clientMovement:{borderTop:'1px solid #f1f5f9',paddingTop:7,display:'flex',flexDirection:'column',gap:3,fontSize:9.5,color:'#94a3b8'},
  clientHealthFooter:{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',fontSize:10.5,color:'#64748b',marginTop:10},
  clientReasons:{fontSize:10.5,color:'#475569',lineHeight:1.5,marginTop:9,paddingTop:9,borderTop:'1px dashed #e2e8f0'},
  clientMethodologyNote:{marginTop:14,padding:'10px 12px',borderRadius:10,background:'#f8fafc',fontSize:10.5,color:'#64748b',lineHeight:1.5},
  clientPresentationSheet:{background:'#fff',borderRadius:18,width:'min(980px,96vw)',maxHeight:'92vh',overflow:'auto',padding:28,boxShadow:'0 30px 80px rgba(15,23,42,.28)'},
  clientPresentationActions:{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:9,flexWrap:'wrap',marginBottom:18},
  presentationEyebrow:{fontSize:10,fontWeight:900,letterSpacing:1.5,color:'#0f766e',marginBottom:6},
  presentationTitle:{fontSize:28,fontWeight:900,color:'#0f172a',margin:'0 0 6px'},
  presentationSubtitle:{fontSize:12.5,color:'#64748b',lineHeight:1.55,margin:'0 0 18px',maxWidth:760},
  presentationMetricGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:14},
  presentationMetric:{padding:15,border:'1px solid #e2e8f0',borderRadius:13,background:'#f8fafc'},
  presentationCalloutGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:20},
  presentationCallout:{padding:'12px 14px',borderRadius:12,background:'#f0fdfa',color:'#0f766e',display:'flex',alignItems:'baseline',gap:8,fontSize:11.5},
  presentationSectionTitle:{fontSize:15,fontWeight:900,color:'#0f172a',margin:'18px 0 10px'},
  presentationClientGrid:{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10},
  presentationClientCard:{border:'1px solid #e2e8f0',borderRadius:12,padding:13},
  presentationEvidenceRow:{display:'flex',justifyContent:'space-between',gap:10,padding:'6px 0',borderBottom:'1px solid #f8fafc',fontSize:11.5,color:'#475569'},
  presentationFootnote:{marginTop:20,paddingTop:12,borderTop:'1px solid #e2e8f0',fontSize:10,color:'#94a3b8',lineHeight:1.5},
  orderAheadDesignModal:{background:'#fff',borderRadius:20,width:'min(1080px,96vw)',maxHeight:'92vh',overflow:'auto',boxShadow:'0 30px 80px rgba(15,23,42,.25)'},
  oaDesignHeader:{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',padding:'22px 24px 16px',borderBottom:'1px solid #e2e8f0',position:'sticky',top:0,background:'#fff',zIndex:2},
  oaDesignEyebrow:{fontSize:9.5,fontWeight:900,letterSpacing:1.3,color:'#0f766e',marginBottom:5},
  oaDesignGrid:{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(320px,420px)',minHeight:560},
  oaDesignControls:{padding:22,background:'#f8fafc'},
  oaDesignSection:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:14,padding:15,marginBottom:12},
  oaDesignSectionTitle:{fontSize:12.5,fontWeight:850,color:'#0f172a',marginBottom:12},
  oaDesignLabel:{display:'block',fontSize:10.5,fontWeight:800,color:'#64748b',marginBottom:5,textTransform:'uppercase',letterSpacing:.35},
  oaColorGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:10},
  oaColorField:{display:'block'},
  oaColorPicker:{width:36,height:34,padding:0,border:'1px solid #e2e8f0',borderRadius:8,background:'#fff',cursor:'pointer'},
  oaToggleRow:{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#334155',marginTop:11,cursor:'pointer'},
  oaDesignActions:{display:'flex',gap:9,flexWrap:'wrap',paddingTop:4},
  oaPrimaryBtn:{padding:'10px 16px',background:'#0f766e',color:'#fff',border:'none',borderRadius:9,fontSize:12.5,fontWeight:850,cursor:'pointer'},
  oaPreviewPane:{padding:22,background:'#fff',borderLeft:'1px solid #e2e8f0'},
  oaPreviewSticky:{position:'sticky',top:84},
  oaPreviewTitle:{fontSize:9.5,fontWeight:900,letterSpacing:1.1,color:'#64748b',textAlign:'center',marginBottom:10},
  oaPhone:{width:300,maxWidth:'100%',margin:'0 auto',border:'8px solid #0f172a',borderRadius:34,minHeight:520,boxShadow:'0 20px 45px rgba(15,23,42,.18)',overflow:'hidden',position:'relative'},
  oaPhoneNotch:{width:88,height:18,borderRadius:'0 0 12px 12px',background:'#0f172a',position:'absolute',top:0,left:'50%',transform:'translateX(-50%)',zIndex:2},
  oaPhoneBody:{padding:'30px 15px 20px'},
  onboardingBadge:{display:'inline-block',padding:'5px 8px',borderRadius:999,background:'#ecfdf5',color:'#0f766e',fontSize:10.5,fontWeight:800,whiteSpace:'nowrap'},
  businessDetailHero:{display:'flex',alignItems:'center',gap:14,marginBottom:18},
  businessDetailLogo:{width:64,height:64,borderRadius:14,objectFit:'contain',border:'1px solid #e2e8f0',background:'#fff'},
  businessDetailLogoFallback:{width:64,height:64,borderRadius:14,display:'grid',placeItems:'center',fontSize:28,background:'#f1f5f9'},
  joinQrAdmin:{display:'flex',gap:12,alignItems:'center',justifyContent:'flex-end',flexWrap:'wrap'},
  joinQrImage:{width:112,height:112,borderRadius:10,border:'1px solid #e2e8f0'},
  joinUrlText:{maxWidth:250,fontSize:10,color:'#94a3b8',wordBreak:'break-all',marginTop:6},

}

export default AdminDashboard

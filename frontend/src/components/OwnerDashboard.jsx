import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Announcements from './Announcements'
import PlatformPromoBanner from './PlatformPromoBanner'
import LoyaltyCardCustomizer from './LoyaltyCardCustomizer'
import SubscriptionPayment from './SubscriptionPayment'
import logo192 from './logo-192.png'
import logo64 from './logo-64.png'

// Turns an ISO timestamp into a short relative label like "2 days ago"
function formatLastStamped(isoString) {
  if (!isoString) return 'Never stamped'
  const then = new Date(isoString)
  if (isNaN(then.getTime())) return 'Never stamped'
  const diffMs = Date.now() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Stamped today'
  if (diffDays === 1) return 'Stamped yesterday'
  if (diffDays < 30) return `Stamped ${diffDays} days ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `Stamped ${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`
  const diffYears = Math.floor(diffMonths / 12)
  return `Stamped ${diffYears} year${diffYears !== 1 ? 's' : ''} ago`
}

const INDUSTRY_META = {
  spa:{icon:'🌿',label:'Spa',recommend:'Membership or VIP',focus:'repeat visits and membership activity'},
  salon:{icon:'✂️',label:'Salon / Barber',recommend:'VIP, Stamps or Points',focus:'repeat appointments and reward activity'},
  fitness:{icon:'🏋️',label:'Gym / Fitness',recommend:'Membership or Multipass',focus:'check-ins, visit frequency and expiring memberships'},
  restaurant:{icon:'🍽️',label:'Restaurant / Food',recommend:'Stamps or Points',focus:'repeat visits and reward claims'},
  coffee:{icon:'☕',label:'Coffee Shop / Café',recommend:'Stamps or Points',focus:'visit frequency and reward progress'},
  retail:{icon:'🛍️',label:'Retail / Store',recommend:'Points or VIP',focus:'points activity and repeat customers'},
  clinic:{icon:'🩺',label:'Clinic / Wellness',recommend:'Membership or Multipass',focus:'visit history, services and active memberships'},
  laundry:{icon:'🧺',label:'Laundry Shop',recommend:'Stamps or Points',focus:'repeat visits, service frequency and redemptions'},
  gas_station:{icon:'⛽',label:'Gasoline Station',recommend:'Points or VIP',focus:'repeat motorists, points earned and redemptions'},
  car_wash:{icon:'🚿',label:'Car Wash',recommend:'Stamps or Multipass',focus:'repeat washes and session usage'},
  pharmacy:{icon:'💊',label:'Pharmacy',recommend:'Points or VIP',focus:'repeat customers and points activity'},
  bakery:{icon:'🥐',label:'Bakery',recommend:'Stamps or Points',focus:'repeat visits and reward progress'},
  hotel:{icon:'🏨',label:'Hotel / Resort',recommend:'VIP or Membership',focus:'VIP activity and repeat guests'},
  other:{icon:'🏪',label:'Business',recommend:'Choose the card that matches repeat behavior',focus:'customer activity and retention'},
}

function OwnerDashboard({ API_BASE, user, onLogout }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('tree')
  const [business, setBusiness] = useState(null)
  const [customers, setCustomers] = useState([])
  const [staff, setStaff] = useState([])
  const [branches, setBranches] = useState([])
  const [stats, setStats] = useState(null)
  const [program, setProgram] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showCardModal, setShowCardModal] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [deletingCustomer, setDeletingCustomer] = useState(false)
  const [showStaffEditModal, setShowStaffEditModal] = useState(false)
  const [staffEditForm, setStaffEditForm] = useState({})
  const [savingStaff, setSavingStaff] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState(false)
  const [qrImageUrl, setQrImageUrl] = useState(null)

  // One-time coupon state - at most one active coupon per customer,
  // scoped to whichever customer is currently open in the Edit modal.
  const [activeCoupon, setActiveCoupon] = useState(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [showCouponForm, setShowCouponForm] = useState(false)
  const [couponText, setCouponText] = useState('')
  const [couponExpiry, setCouponExpiry] = useState('')
  const [couponError, setCouponError] = useState('')
  const [couponSaving, setCouponSaving] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', phone: '', role: 'cashier', branch_public_id: '' })
  const [newBranchName, setNewBranchName] = useState('')
  const [savingBranch, setSavingBranch] = useState(false)
  const [message, setMessage] = useState('')
  const [stampCounts, setStampCounts] = useState({}) // staff public_id -> stamps added
  const [customerSearch, setCustomerSearch] = useState('')
  const [staffSearch, setStaffSearch] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [announcementsChecked, setAnnouncementsChecked] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(false)
  const [membershipSettings, setMembershipSettings] = useState({
    membership_duration_days: 30,
    membership_price: 0,
    membership_services_text: '',
    membership_terms: '',
    membership_quick_checkin: false,
  })
  const [savingMembershipSettings, setSavingMembershipSettings] = useState(false)
  const [membershipActionLoading, setMembershipActionLoading] = useState(false)
  const [memberHistory, setMemberHistory] = useState([])
  const [memberHistoryLoading, setMemberHistoryLoading] = useState(false)
  const [memberVisitService, setMemberVisitService] = useState('')
  const [memberVisitNote, setMemberVisitNote] = useState('')
  const [setupKit, setSetupKit] = useState(null)
  const [setupKitForm, setSetupKitForm] = useState({recipient_name:'',contact_number:'',delivery_address:'',delivery_instructions:'',logo_url:''})
  const [savingSetupKit, setSavingSetupKit] = useState(false)

  // Frontend URL for customer-facing pages
  const FRONTEND_URL = 'https://loyaltree-btw1.onrender.com'
  const VIBER_SUPPORT_NUMBER = '639397992144'

  const contactLoyaltyTreeSupport = async () => {
    const businessName = business?.business_name || user?.business_name || 'Not available'
    const businessId = business?.public_id || business?.business_slug || user?.business_slug || 'Not available'
    const supportMessage = [
      'Hi Alfred! I need assistance with my LoyaltyTree account.',
      '',
      `Business: ${businessName}`,
      `Business ID: ${businessId}`,
      '',
      'Concern:',
      'Please describe your concern here.'
    ].join('\n')

    // Personal-number Viber chat links do not reliably support a `text=`
    // parameter on Safari/iOS. Copy the prefilled support message first,
    // then open Alfred's Viber chat with the OS-appropriate number format.
    try {
      await navigator.clipboard.writeText(supportMessage)
      setMessage('Support message copied — paste it in Viber after the chat opens.')
    } catch (_) {
      // Clipboard can be blocked by browser permissions; Viber can still open.
    }

    const isApple = /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent)
    const viberNumber = isApple ? `+${VIBER_SUPPORT_NUMBER}` : VIBER_SUPPORT_NUMBER
    const viberUrl = `viber://chat?number=${viberNumber}`

    // Must happen directly from the button click so Safari treats it as an
    // app-opening user gesture instead of a scripted redirect.
    window.location.assign(viberUrl)
  }

  const onboardingKey = user?.business_slug ? `loyaltree_onboarding_seen_${user.business_slug}` : null
  const announcementsCheckedKey = user?.business_slug ? `loyaltree_checked_announcements_${user.business_slug}` : null
  const analyticsCheckedKey = user?.business_slug ? `loyaltree_checked_analytics_${user.business_slug}` : null
  const isActive = (business?.status || '').toUpperCase() === 'ACTIVE'

  const cardSetUp = !!program?.google_wallet_class_id
  const cashierSetUp = staff.length > 0

  useEffect(() => {
    if (announcementsCheckedKey) setAnnouncementsChecked(localStorage.getItem(announcementsCheckedKey) === '1')
    if (analyticsCheckedKey) setAnalyticsChecked(localStorage.getItem(analyticsCheckedKey) === '1')
  }, [announcementsCheckedKey, analyticsCheckedKey])

  const markAnnouncementsChecked = () => {
    if (announcementsCheckedKey) localStorage.setItem(announcementsCheckedKey, '1')
    setAnnouncementsChecked(true)
  }
  const markAnalyticsChecked = () => {
    if (analyticsCheckedKey) localStorage.setItem(analyticsCheckedKey, '1')
    setAnalyticsChecked(true)
  }

  useEffect(() => {
    if (!user?.business_slug) return
    loadData()

    // Stamps and redemptions happen from the cashier's device, a separate
    // session, so this dashboard has no way to know data changed unless it
    // asks again. Poll periodically to keep Leaves/Rings/Fruits current.
    const interval = setInterval(loadData, 15000)
    return () => clearInterval(interval)
  }, [user])

  // Automatically guide a newly signed-up business, and keep prompting on
  // later visits while no card has been selected/published yet. Once a card
  // exists, the guide continues from cashier setup instead of restarting.
  useEffect(() => {
    if (loading || !isActive || !onboardingKey) return
    if (activeTab !== 'tree') return

    const seen = localStorage.getItem(onboardingKey) === '1'
    const firstIncompleteStep = !cardSetUp ? 0 : !cashierSetUp ? 1 : 2

    if (!seen || !cardSetUp || !cashierSetUp) {
      setOnboardingStep(firstIncompleteStep)
      setShowOnboarding(true)
    }
  }, [loading, isActive, onboardingKey, activeTab, cardSetUp, cashierSetUp])

  const closeOnboarding = () => {
    if (onboardingKey && cardSetUp && cashierSetUp) {
      localStorage.setItem(onboardingKey, '1')
    }
    setShowOnboarding(false)
  }

  const loadData = async () => {
    try {
      const [bizRes, custRes, staffRes, statsRes, progRes, stampCountRes, branchRes, subRes, kitRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/stats`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/stamp-counts`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/subscription`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/setup-kit`),
      ])

      const bizData = await bizRes.json().catch(() => null)
      const custData = await custRes.json().catch(() => [])
      const staffData = await staffRes.json().catch(() => [])
      const statsData = await statsRes.json().catch(() => null)
      const progData = await progRes.json().catch(() => null)
      const stampCountData = await stampCountRes.json().catch(() => [])
      const branchData = await branchRes.json().catch(() => [])
      const subData = await subRes.json().catch(() => null)
      const kitData = await kitRes.json().catch(() => null)

      setBusiness(bizData)
      setCustomers(custData)
      setStaff(staffData)
      setStats(statsData)
      setProgram(progData)
      if (progData?.card_type === 'membership') {
        setMembershipSettings({
          membership_duration_days: progData.membership_duration_days || 30,
          membership_price: progData.membership_price || 0,
          membership_services_text: Array.isArray(progData.membership_services) ? progData.membership_services.join('\n') : '',
          membership_terms: progData.membership_terms || '',
          membership_quick_checkin: !!progData.membership_quick_checkin,
        })
      }
      setBranches(Array.isArray(branchData) ? branchData : [])
      setSubscription(subData)
      setSetupKit(kitData && !kitData.detail ? kitData : null)
      if (kitData && !kitData.detail) setSetupKitForm({
        recipient_name:kitData.recipient_name||'',contact_number:kitData.contact_number||'',
        delivery_address:kitData.delivery_address||'',delivery_instructions:kitData.delivery_instructions||'',
        logo_url:kitData.logo_url||bizData?.logo_url||''
      })

      if (Array.isArray(stampCountData)) {
        const map = {}
        stampCountData.forEach(row => { map[row.staff_public_id] = row.stamp_count })
        setStampCounts(map)
      }
    } catch (err) {
      console.error('Load error:', err)
    }
    setLoading(false)
  }

  const inviteStaff = async (e) => {
    e.preventDefault()
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm)
      })
      if (res.ok) {
        setMessage('Staff invited! PIN: 0000')
        setShowInviteModal(false)
        setInviteForm({ name: '', email: '', phone: '', role: 'cashier', branch_public_id: '' })
        loadData()
      } else {
        const data = await res.json()
        setMessage(data.detail || 'Invite failed')
      }
    } catch (err) {
      setMessage('Network error')
    }
  }

  const addBranch = async (e) => {
    e.preventDefault()
    if (!newBranchName.trim()) return
    setSavingBranch(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBranchName.trim() })
      })
      if (res.ok) {
        setNewBranchName('')
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not add branch')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setSavingBranch(false)
  }

  const renameBranch = async (branch, name) => {
    if (!name.trim() || name === branch.name) return
    try {
      await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches/${branch.public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      })
      loadData()
    } catch (err) {
      setMessage('Network error')
    }
  }

  const openEditCustomer = (c) => {
    setEditForm({
      public_id: c.public_id,
      name: c.name || '',
      address: c.address || '',
      age: c.age ?? '',
      phone: c.phone || '',
      email: c.email || '',
      birthday: c.birthday || '',
      occupation: c.occupation || '',
      last_order_date: c.last_order_date || '',
      stamp_count: c.stamp_count ?? 0,
      points_balance: c.points_balance ?? 0,
      multipass_sessions_remaining: c.multipass_sessions_remaining ?? 0,
      membership_status: c.membership_effective_status || c.membership_status || 'inactive',
      membership_visit_count: c.membership_visit_count || 0,
      membership_last_visit_at: c.membership_last_visit_at || '',
      membership_start_date: c.membership_start_date || '',
      membership_expires_at: c.membership_expires_at || '',
      vip_points: c.vip_points ?? 0,
      vip_manual_tier_id: c.vip_manual_tier_id || '',
    })
    setShowCouponForm(false)
    setCouponError('')
    setCouponText('')
    setCouponExpiry('')
    fetchCoupons(c.public_id)
    setShowEditModal(true)
  }

  const fetchMemberHistory = async (customerPublicId) => {
    setMemberHistoryLoading(true)
    try {
      const suffix = program?.card_type === 'multipass'
        ? 'multipass-history'
        : program?.card_type === 'membership'
        ? 'leaves'
        : program?.card_type === 'points'
        ? 'points-history'
        : program?.card_type === 'vip'
        ? 'vip-history'
        : 'stamp-history'
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${customerPublicId}/${suffix}`)
      const data = await res.json().catch(() => [])
      setMemberHistory(res.ok && Array.isArray(data) ? data : [])
    } catch (err) {
      setMemberHistory([])
    }
    setMemberHistoryLoading(false)
  }

  const logMemberVisitFromOwner = async () => {
    const customerPublicId = selectedCustomer?.public_id || editForm.public_id
    if (!customerPublicId) return
    setMembershipActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/membership/note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: customerPublicId,
          service_name: memberVisitService.trim() || null,
          note: memberVisitNote.trim() || null,
          as_owner: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not log visit')
      setMemberVisitService('')
      setMemberVisitNote('')
      await fetchMemberHistory(customerPublicId)
      await loadData()
      setSelectedCustomer(prev => prev ? {
        ...prev,
        membership_visit_count: (prev.membership_visit_count || 0) + 1,
        membership_last_visit_at: data.created_at || new Date().toISOString(),
      } : prev)
      setMessage('Visit logged')
    } catch (err) { setMessage(err.message) }
    setMembershipActionLoading(false)
  }

  const fetchCoupons = async (customerPublicId) => {
    setCouponLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${customerPublicId}/coupons`)
      if (res.ok) {
        const coupons = await res.json()
        const today = new Date().toISOString().slice(0, 10)
        const active = coupons.find(c => c.status === 'active' && (!c.expires_at || c.expires_at >= today))
        setActiveCoupon(active || null)
      }
    } catch (err) {
      // best-effort - editing the customer still works without coupon data
    }
    setCouponLoading(false)
  }

  const handleCreateCoupon = async () => {
    setCouponError('')
    if (!couponText.trim()) {
      setCouponError('Enter what the coupon is for')
      return
    }
    setCouponSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${editForm.public_id}/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reward_text: couponText.trim(),
          expires_at: couponExpiry || null,
        })
      })
      const data = await res.json()
      if (res.ok) {
        setActiveCoupon(data)
        setShowCouponForm(false)
        setCouponText('')
        setCouponExpiry('')
      } else {
        setCouponError(data.detail || 'Failed to create coupon')
      }
    } catch (err) {
      setCouponError('Network error')
    }
    setCouponSaving(false)
  }

  const handleCancelCoupon = async () => {
    if (!activeCoupon) return
    if (!window.confirm('Cancel this coupon?')) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/coupons/${activeCoupon.public_id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setActiveCoupon(null)
      }
    } catch (err) {
      setCouponError('Failed to cancel coupon')
    }
  }


  const saveMembershipSettings = async () => {
    setSavingMembershipSettings(true)
    try {
      const services = membershipSettings.membership_services_text
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_type: 'membership',
          stamp_goal: program?.stamp_goal || 8,
          reward_name: program?.reward_name || 'Membership',
          primary_color: program?.primary_color || '#3b82f6',
          reward_expiry_days: program?.reward_expiry_days || 30,
          program_logo_url: program?.program_logo_url || null,
          hero_image_url: program?.hero_image_url || null,
          card_name: program?.card_name || 'Membership Card',
          description: program?.description || '',
          membership_services: services,
          membership_duration_days: Number(membershipSettings.membership_duration_days) || 30,
          membership_price: Number(membershipSettings.membership_price) || 0,
          membership_terms: membershipSettings.membership_terms || null,
          membership_quick_checkin: !!membershipSettings.membership_quick_checkin,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save membership settings')
      setMessage('Membership settings saved')
      loadData()
    } catch (err) {
      setMessage(err.message)
    }
    setSavingMembershipSettings(false)
  }

  const runMembershipAction = async (action) => {
    if (!editForm.public_id) return
    const priceDefault = Number(program?.membership_price || 0)
    let pricePaid = null
    let paymentMethod = null
    if (action === 'activate' || action === 'renew') {
      const entered = window.prompt('Amount paid', String(priceDefault))
      if (entered === null) return
      pricePaid = Number(entered) || 0
      paymentMethod = window.prompt('Payment method', 'Cash') || 'Cash'
    }
    setMembershipActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/membership/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: editForm.public_id,
          action,
          duration_days: Number(program?.membership_duration_days || 30),
          price_paid: pricePaid,
          payment_method: paymentMethod,
          as_owner: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Membership update failed')
      setEditForm(prev => ({
        ...prev,
        membership_status: data.effective_status,
        membership_start_date: data.customer?.membership_start_date || prev.membership_start_date,
        membership_expires_at: data.customer?.membership_expires_at || '',
      }))
      setMessage(`Membership ${action} complete`)
      loadData()
    } catch (err) {
      setMessage(err.message)
    }
    setMembershipActionLoading(false)
  }

  const saveCustomer = async (e) => {
    e.preventDefault()
    setSavingCustomer(true)
    try {
      const { public_id, ...fields } = editForm
      const payload = {
        ...fields,
        age: fields.age === '' ? null : parseInt(fields.age, 10),
        stamp_count: fields.stamp_count === '' ? null : parseInt(fields.stamp_count, 10),
        points_balance: fields.points_balance === '' ? null : parseInt(fields.points_balance, 10),
        multipass_sessions_remaining: fields.multipass_sessions_remaining === '' ? null : parseInt(fields.multipass_sessions_remaining, 10),
      }
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setShowEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not save customer')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setSavingCustomer(false)
  }

  const deleteCustomer = async () => {
    if (!editForm.public_id) return
    if (!window.confirm(`Remove ${editForm.name || 'this leaf'} from your tree? This can't be undone.`)) return
    setDeletingCustomer(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${editForm.public_id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setShowEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not remove leaf')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setDeletingCustomer(false)
  }

  const openEditStaff = (s) => {
    const currentBranch = branches.find(b => b.id === s.branch_id)
    setStaffEditForm({
      public_id: s.public_id,
      name: s.name || '',
      email: s.email || '',
      phone: s.phone || '',
      role: s.role || 'cashier',
      pin: s.pin || '0000',
      is_active: s.is_active !== false,
      branch_public_id: currentBranch?.public_id || '',
    })
    setShowStaffEditModal(true)
  }

  const saveStaff = async (e) => {
    e.preventDefault()
    setSavingStaff(true)
    try {
      const { public_id, ...fields } = staffEditForm
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/${public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      })
      if (res.ok) {
        setShowStaffEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not save cashier')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setSavingStaff(false)
  }

  const deleteStaff = async () => {
    if (!staffEditForm.public_id) return
    if (!window.confirm(`Remove ${staffEditForm.name || 'this cashier'} from your team? This can't be undone.`)) return
    setDeletingStaff(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/${staffEditForm.public_id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setShowStaffEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not remove cashier')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setDeletingStaff(false)
  }

  const saveSetupKitDetails = async () => {
    setSavingSetupKit(true)
    try {
      const res=await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/setup-kit`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(setupKitForm)})
      const data=await res.json().catch(()=>({}))
      if(!res.ok) throw new Error(data.detail||'Could not save QR kit details')
      setSetupKit(data); setMessage('QR kit details saved'); loadData()
    } catch(err){ setMessage(err.message) }
    setSavingSetupKit(false)
  }

  const goLive = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/go-live`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMessage(data.message)
        loadData()
      } else {
        setMessage(data.detail || 'Go live failed')
      }
    } catch (err) {
      setMessage('Network error')
    }
  }

  const fetchQRImage = async () => {
    // Generate QR code with correct frontend URL (bypass backend wrong URL)
    const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinUrl)}`
    setQrImageUrl(qrApiUrl)
    setShowQRModal(true)
  }

  const shareQR = async () => {
    const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
    const shareText = `Join ${user?.business_name || 'our'} loyalty program! Scan the QR code or visit: ${joinUrl}`

    try {
      // Fetch the QR image as a blob for sharing
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinUrl)}`
      const qrRes = await fetch(qrApiUrl)
      const qrBlob = await qrRes.blob()
      const qrFile = new File([qrBlob], 'loyaltree-qr.png', { type: 'image/png' })

      if (navigator.canShare && navigator.canShare({ files: [qrFile] })) {
        await navigator.share({
          title: `Join ${user?.business_name || 'Us'} Rewards`,
          text: shareText,
          url: joinUrl,
          files: [qrFile]
        })
      } else if (navigator.share) {
        await navigator.share({
          title: `Join ${user?.business_name || 'Us'} Rewards`,
          text: shareText,
          url: joinUrl,
        })
      } else {
        await navigator.clipboard.writeText(`${shareText} ${joinUrl}`)
        setMessage('Link copied to clipboard!')
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.share({
            title: `Join ${user?.business_name || 'Us'} Rewards`,
            text: `Get stamps and earn rewards!`,
            url: joinUrl,
          })
        } catch (e2) {
          await navigator.clipboard.writeText(joinUrl)
          setMessage('Join link copied!')
        }
      }
    }
  }

  const downloadQR = () => {
    if (!qrImageUrl) return
    const link = document.createElement('a')
    link.href = qrImageUrl
    link.download = `${user?.business_name || 'business'}-qr-code.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const viewCustomerCard = (customer) => {
    setSelectedCustomer(customer)
    fetchCoupons(customer.public_id)
    setMemberVisitService('')
    setMemberVisitNote('')
    if (['stamp', 'membership', 'multipass', 'points', 'vip'].includes(program?.card_type)) {
      fetchMemberHistory(customer.public_id)
    } else {
      setMemberHistory([])
    }
    setShowCardModal(true)
  }

  const addToGoogleWallet = (customer) => {
    const walletUrl = `${API_BASE}/api/v1/customer/${customer.public_id}/wallet-pass`
    fetch(walletUrl)
      .then(res => res.json())
      .then(data => {
        if (data.add_to_wallet_url) {
          window.open(data.add_to_wallet_url, '_blank')
        } else {
          setMessage('Google Wallet link not available yet')
        }
      })
      .catch(() => setMessage('Could not get wallet link'))
  }

  const addToAppleWallet = (customer) => {
    setMessage('Apple Wallet coming soon!')
  }

  const isPointsCard = program?.card_type === 'points'
  const isMultipassCard = program?.card_type === 'multipass'
  const isMembershipCard = program?.card_type === 'membership'
  const isVipCard = program?.card_type === 'vip'
  const cardExperience = isPointsCard
    ? {
        key: 'points',
        accent: '#2563eb',
        soft: '#eff6ff',
        border: '#bfdbfe',
        icon: '💎',
        title: 'Points Loyalty',
        customerLabel: 'Customers',
        customerIcon: '👥',
        dashboardLabel: 'Points Dashboard',
        scanTitle: 'Scan Customer',
        scanDescription: 'Record a sale and award points',
        recentTitle: 'Recent Customer Activity',
        editDescription: 'Configure earning rules and reward prizes',
      }
    : isVipCard
    ? { key:'vip',accent:'#ca8a04',soft:'#fefce8',border:'#fde68a',icon:'👑',title:'VIP Program',customerLabel:'VIP Customers',customerIcon:'👑',dashboardLabel:'VIP Dashboard',scanTitle:'Record VIP Purchase',scanDescription:'Award VIP points and check tier benefits',recentTitle:'Recent VIP Activity',editDescription:'Configure tier thresholds and increasing benefits' }
    : isMembershipCard
    ? {
        key: 'membership',
        accent: '#0d9488',
        soft: '#f0fdfa',
        border: '#99f6e4',
        icon: '🏋️',
        title: 'Membership',
        customerLabel: 'Members',
        customerIcon: '👤',
        dashboardLabel: 'Membership Dashboard',
        scanTitle: 'Check In Member',
        scanDescription: 'Verify access and log a member visit',
        recentTitle: 'Recent Members',
        editDescription: 'Configure subscription duration, price, perks, and terms',
      }
    : isMultipassCard
    ? {
        key: 'multipass',
        accent: '#7c3aed',
        soft: '#f5f3ff',
        border: '#ddd6fe',
        icon: '🎫',
        title: 'Multi-Pass',
        customerLabel: 'Pass Holders',
        customerIcon: '🎟️',
        dashboardLabel: 'Multi-Pass Dashboard',
        scanTitle: 'Use a Session',
        scanDescription: 'Scan a pass and deduct one session',
        recentTitle: 'Recent Pass Activity',
        editDescription: 'Configure session count and pass validity',
      }
    : {
        key: 'stamp',
        accent: '#0d9488',
        soft: '#f0fdfa',
        border: '#99f6e4',
        icon: '🎟️',
        title: 'Stamp Rewards',
        customerLabel: 'Customers',
        customerIcon: '🍃',
        dashboardLabel: 'Stamp Dashboard',
        scanTitle: 'Add a Stamp',
        scanDescription: 'Scan a customer and add one stamp',
        recentTitle: 'Recent Stamp Activity',
        editDescription: 'Configure the stamp goal and reward',
      }

  const confirmedStamps = customers.reduce((sum, c) => sum + (c.stamp_count || 0), 0)
  const totalPoints = customers.reduce((sum, c) => sum + (c.points_balance || 0), 0)
  const totalSessionsLeft = customers.reduce((sum, c) => sum + (c.multipass_sessions_remaining || 0), 0)
  const unlockedRewards = customers.filter(c => c.reward_unlocked).length
  const totalVipPoints = customers.reduce((sum,c)=>sum+(c.vip_points||0),0)
  const membershipActive = customers.filter(c => ['active', 'lifetime'].includes(c.membership_effective_status || c.membership_status)).length
  const membershipExpired = customers.filter(c => (c.membership_effective_status || c.membership_status) === 'expired').length
  const membershipExpiringSoon = customers.filter(c => {
    const status = c.membership_effective_status || c.membership_status
    if (status !== 'active' || !c.membership_expires_at) return false
    const days = Math.ceil((new Date(c.membership_expires_at) - new Date()) / 86400000)
    return days >= 0 && days <= 7
  }).length
  const growthStage = customers.length < 10 ? 'seedling' : customers.length < 50 ? 'sapling' : customers.length < 200 ? 'growing' : 'mature'
  const subStatus = subscription?.subscription_status
  const needsRenewal = subStatus === 'expiring_soon' || subStatus === 'expired'
  const industry = INDUSTRY_META[business?.business_type] || INDUSTRY_META.other


  if (loading) return (
    <div style={styles.container}>
      <div style={styles.loadingTree}>
        <div style={styles.treeIcon}>🌳</div>
        <p>Growing your digital forest...</p>
      </div>
    </div>
  )


  // Leaves (customers) search - matches name, phone, or email
  const customerSearchTerm = customerSearch.trim().toLowerCase()
  const filteredCustomers = customerSearchTerm
    ? customers.filter(c => (
        (c.name || '').toLowerCase().includes(customerSearchTerm) ||
        (c.phone || '').toLowerCase().includes(customerSearchTerm) ||
        (c.email || '').toLowerCase().includes(customerSearchTerm)
      ))
    : customers

  // Team members (staff) search - matches name, email, or role
  const staffSearchTerm = staffSearch.trim().toLowerCase()
  const filteredStaff = staffSearchTerm
    ? staff.filter(s => (
        (s.name || '').toLowerCase().includes(staffSearchTerm) ||
        (s.email || '').toLowerCase().includes(staffSearchTerm) ||
        (s.role || '').toLowerCase().includes(staffSearchTerm)
      ))
    : staff

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.brand}>
          <img src={logo192} alt="LoyaltyTree" style={styles.logo} />
          <div>
            <h1 style={styles.brandName}>LoyaltyTree</h1>
            <p style={styles.brandTagline}>{cardExperience.dashboardLabel} · {cardExperience.editDescription}</p>
          </div>
        </div>
        <div style={styles.headerActions}>
          <span style={styles.planBadge}>{user?.business_name}</span>
          {needsRenewal && (
            <button
              onClick={() => setActiveTab('billing')}
              style={{
                ...styles.navBtn,
                ...(subStatus === 'expired' ? styles.renewalBtnExpired : styles.renewalBtnWarning),
              }}
            >
              {subStatus === 'expired'
                ? '⚠️ Subscription expired — Renew now'
                : `⏰ Renews in ${subscription.days_left}d — Pay now`}
            </button>
          )}
          <button onClick={() => { setOnboardingStep(0); setShowOnboarding(true) }} style={styles.navBtn}>🎓 Setup Guide</button>
          <button onClick={() => { setShowAnnouncements(true); markAnnouncementsChecked() }} style={styles.navBtn}>📢 Announcements</button>
          <button onClick={() => { markAnalyticsChecked(); navigate('/analytics') }} style={styles.navBtn}>📊 Analytics</button>
          <button
            onClick={contactLoyaltyTreeSupport}
            style={styles.supportBtn}
            title="Open Viber and contact LoyaltyTree Support"
          >
            💬 Support
          </button>
          <button onClick={onLogout} style={styles.logoutBtn}>Logout</button>
        </div>
      </header>

      <PlatformPromoBanner API_BASE={API_BASE} businessSlug={user?.business_slug} />

      {message && (
        <div style={styles.toast} onClick={() => setMessage('')}>
          {message}
        </div>
      )}

      {/* Professional dashboard summary */}
      <section style={styles.dashboardShell}>
        <div style={styles.dashboardHero}>
          <div style={styles.heroTreeWrap} aria-hidden="true">
            <div style={styles.heroTreeGlow}></div>
            <div style={styles.heroTree}>🌳</div>
            <div style={styles.heroTreeGround}>
              <span>🍃</span><span>🍃</span><span>🍃</span>
            </div>
          </div>

          <div style={styles.heroIdentity}>
            <div style={{minWidth: 0}}>
              <p style={styles.heroEyebrow}>{industry.icon} {industry.label} · {cardExperience.dashboardLabel}</p>
              <h2 style={styles.heroTitle}>{user?.business_name}</h2>
              <p style={styles.heroDescription}>{cardExperience.editDescription}</p>
              <div style={styles.heroGrowthRow}>
                <span style={styles.heroGrowthBadge}>
                  {growthStage === 'seedling' ? '🌱 Seedling' : growthStage === 'sapling' ? '🌿 Sapling' : growthStage === 'growing' ? '🌳 Growing Tree' : '🌲 Mature Tree'}
                </span>
                <span style={styles.heroProgramBadge}>{cardExperience.icon} {cardExperience.title}</span>
              </div>
            </div>
          </div>

          <div style={styles.heroQuickActions}>
            <button
              onClick={() => navigate('/scanner', { state: { ownerMode: true, businessSlug: user.business_slug, ownerName: user.business_name } })}
              style={{...styles.primaryActionBtn, background: '#0d9488'}}
            >
              📷 {cardExperience.scanTitle}
            </button>
            <button onClick={fetchQRImage} style={{...styles.secondaryActionBtn, borderColor: '#99f6e4', color: '#0f766e'}}>🔗 Share Join QR</button>
          </div>
        </div>

        <div style={styles.metricsGrid}>
          {(isVipCard
            ? [{value:customers.length,label:'VIP Customers',hint:'Enrolled in your VIP program'},{value:totalVipPoints,label:'VIP Points',hint:'Current points across customers'},{value:customers.filter(c=>c.vip_tier?.name).length,label:'Tiered Customers',hint:'Customers with an assigned tier'}]
            : isMembershipCard
            ? [
                { value: membershipActive, label: 'Active Members', hint: 'Currently allowed to check in' },
                { value: membershipExpiringSoon, label: 'Expiring Soon', hint: 'Memberships ending within 7 days' },
                { value: membershipExpired, label: 'Expired', hint: 'Memberships requiring renewal' },
              ]
            : isPointsCard
            ? [
                { value: customers.length, label: 'Customers', hint: 'Customers enrolled in the program' },
                { value: totalPoints, label: 'Points Balance', hint: 'Total unredeemed customer points' },
                { value: unlockedRewards, label: 'Rewards Ready', hint: 'Customers with available rewards' },
              ]
            : isMultipassCard
            ? [
                { value: customers.length, label: 'Pass Holders', hint: 'Customers with a multi-pass record' },
                { value: totalSessionsLeft, label: 'Sessions Left', hint: 'Unused sessions across all passes' },
                { value: customers.filter(c => (c.multipass_sessions_remaining || 0) <= 0 && (c.multipass_total_sessions || 0) > 0).length, label: 'Completed Passes', hint: 'Passes that reached zero sessions' },
              ]
            : [
                { value: customers.length, label: 'Customers', hint: 'Customers enrolled in the program' },
                { value: confirmedStamps, label: 'Stamps Issued', hint: 'Total stamps currently recorded' },
                { value: unlockedRewards, label: 'Rewards Ready', hint: 'Customers with available rewards' },
              ]
          ).map(metric => (
            <article key={metric.label} style={styles.metricCard}>
              <div style={{...styles.metricAccent, background: '#0d9488'}} />
              <span style={styles.metricLabel}>{metric.label}</span>
              <strong style={{...styles.metricValue, color: '#0f766e'}}>{metric.value}</strong>
              <span style={styles.metricHint}>{metric.hint}</span>
            </article>
          ))}
        </div>

        {/* Navigation Tabs */}
        <nav style={styles.tabs} aria-label="Owner dashboard sections">
          {[
            { id: 'tree', label: 'Overview', icon: cardExperience.icon },
            { id: 'customers', label: cardExperience.customerLabel, icon: cardExperience.customerIcon },
            { id: 'staff', label: 'Team', icon: '👥' },
            { id: 'program', label: 'Edit Card', icon: '✏️' },
            { id: 'billing', label: needsRenewal ? 'Billing ⚠️' : 'Billing', icon: '💳' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...styles.tab,
                ...(activeTab === tab.id ? {
                  background: '#0d9488',
                  color: 'white',
                  boxShadow: '0 8px 18px rgba(13,148,136,0.22)',
                } : {}),
              }}
            >
              <span aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </section>

      {/* Tab Content */}
      <div style={styles.content}>
        {activeTab === 'tree' && (
          <div style={styles.treeTab}>
            <div style={styles.industryInsight}>
              <div style={styles.industryInsightIcon}>{industry.icon}</div>
              <div>
                <div style={styles.industryInsightLabel}>{industry.label} setup</div>
                <strong style={styles.industryInsightTitle}>Recommended: {industry.recommend}</strong>
                <div style={styles.industryInsightText}>Focus analytics: {industry.focus}.</div>
              </div>
            </div>
            <div style={styles.actionCards}>
              <div style={{...styles.actionCard, borderColor: cardExperience.border}} onClick={() => setActiveTab('customers')}>
                <div style={styles.actionIcon}>{cardExperience.customerIcon}</div>
                <h3>View {cardExperience.customerLabel}</h3>
                <p>{customers.length} connected</p>
              </div>
              <div style={{...styles.actionCard, borderColor: cardExperience.border}} onClick={() => navigate('/scanner', { state: { ownerMode: true, businessSlug: user.business_slug, ownerName: user.business_name } })}>
                <div style={styles.actionIcon}>📷</div>
                <h3>{cardExperience.scanTitle}</h3>
                <p>{cardExperience.scanDescription}</p>
              </div>
              <div style={{...styles.actionCard, borderColor: cardExperience.border}} onClick={() => setShowInviteModal(true)}>
                <div style={styles.actionIcon}>🌿</div>
                <h3>Manage Team</h3>
                <p>Invite staff members</p>
              </div>
              <div style={{...styles.actionCard, borderColor: cardExperience.border}} onClick={fetchQRImage}>
                <div style={styles.actionIcon}>🔗</div>
                <h3>Share Join Link</h3>
                <p>Get the customer signup QR code</p>
              </div>
            </div>

            {setupKit && <section style={styles.setupKitPanel}>
              <div style={styles.setupKitHeader}>
                <div><small style={styles.setupKitEyebrow}>PHYSICAL QR / PR KIT</small><h3 style={{margin:'4px 0'}}>Confirm logo and delivery</h3><p style={{margin:0,color:'#64748b',fontSize:13}}>Your join QR is generated automatically for printing.</p></div>
                <span style={styles.setupKitStatus}>{String(setupKit.fulfillment_status||'requested').replaceAll('_',' ')}</span>
              </div>
              <div style={styles.setupKitGrid}>
                <div style={styles.setupKitPreview}>
                  {setupKitForm.logo_url?<img src={setupKitForm.logo_url} alt="Logo" style={styles.setupKitLogo}/>:<b>Logo needed</b>}
                  <img src={setupKit.qr_image_url} alt="Join QR" style={styles.setupKitQr}/>
                  <a href={setupKit.qr_join_url} target="_blank" rel="noreferrer">Open join link</a>
                </div>
                <div>
                  <label style={styles.label}>Final logo URL</label><input style={styles.input} value={setupKitForm.logo_url} onChange={e=>setSetupKitForm({...setupKitForm,logo_url:e.target.value})}/>
                  <div style={styles.setupKitTwoCol}><div><label style={styles.label}>Recipient</label><input style={styles.input} value={setupKitForm.recipient_name} onChange={e=>setSetupKitForm({...setupKitForm,recipient_name:e.target.value})}/></div><div><label style={styles.label}>Contact</label><input style={styles.input} value={setupKitForm.contact_number} onChange={e=>setSetupKitForm({...setupKitForm,contact_number:e.target.value})}/></div></div>
                  <label style={styles.label}>Complete delivery address</label><textarea style={{...styles.input,minHeight:72}} value={setupKitForm.delivery_address} onChange={e=>setSetupKitForm({...setupKitForm,delivery_address:e.target.value})}/>
                  <label style={styles.label}>Delivery instructions</label><textarea style={{...styles.input,minHeight:58}} value={setupKitForm.delivery_instructions} onChange={e=>setSetupKitForm({...setupKitForm,delivery_instructions:e.target.value})}/>
                  <button style={styles.submitBtn} onClick={saveSetupKitDetails} disabled={savingSetupKit}>{savingSetupKit?'Saving...':'Save QR Kit Details'}</button>
                </div>
              </div>
            </section>}

            <div style={styles.recentActivity}>
              <h3 style={styles.sectionTitle}>{cardExperience.icon} {cardExperience.recentTitle}</h3>
              {customers.slice(0, 5).map(c => (
                <div key={c.public_id} style={styles.activityRow}>
                  <span style={styles.activityLeaf}>🍃</span>
                  <span style={styles.activityName}>{c.name}</span>
                  <span style={styles.activityStamps}>
                    {isPointsCard ? `${c.points_balance || 0} points` : isMultipassCard ? `${c.multipass_sessions_remaining || 0}/${c.multipass_total_sessions || 0} sessions` : isVipCard ? `${c.vip_tier?.name || 'VIP'} · ${c.vip_points || 0} pts` : isMembershipCard ? `${(c.membership_effective_status || c.membership_status || 'inactive').toUpperCase()}` : `${c.stamp_count} rings`}
                  </span>
                  {c.reward_unlocked && <span style={styles.activityFruit}>🍎</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'customers' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>{cardExperience.customerIcon} {cardExperience.customerLabel} ({filteredCustomers.length}{customerSearchTerm ? ` of ${customers.length}` : ''})</h2>
              <button onClick={() => { markAnalyticsChecked(); navigate('/analytics') }} style={styles.viewAnalyticsBtn}>📊 View Analytics</button>
            </div>
            <div style={styles.searchBarWrap}>
              <span style={styles.searchIcon}>🔍</span>
              <input
                type="text"
                placeholder={`Search ${cardExperience.customerLabel.toLowerCase()} by name, phone, or email...`}
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                style={styles.searchInput}
              />
              {customerSearch && (
                <button onClick={() => setCustomerSearch('')} style={styles.searchClearBtn} aria-label="Clear search">✕</button>
              )}
            </div>
            {filteredCustomers.length === 0 && (
              <p style={styles.searchEmptyText}>No {cardExperience.customerLabel.toLowerCase()} match "{customerSearch}".</p>
            )}
            <div style={styles.customerGrid}>
              {filteredCustomers.map(c => (
                <div key={c.public_id} style={styles.customerCard}>
                  <div style={styles.customerAvatar}>{c.name?.[0]?.toUpperCase() || '?'}</div>
                  <div style={styles.customerInfo}>
                    <h4 style={styles.customerName}>{c.name}</h4>
                    <p style={styles.customerPhone}>{c.phone}</p>
                    {(c.age || c.occupation) && (
                      <p style={{...styles.customerPhone, fontSize: 12, color: '#94a3b8'}}>
                        {c.age ? `${c.age} yrs` : ''}{c.age && c.occupation ? ' · ' : ''}{c.occupation ? c.occupation.replace('_', ' ') : ''}
                      </p>
                    )}
                    {isPointsCard ? (
                      <p style={styles.stampText}>💎 {c.points_balance || 0} points</p>
                    ) : isMultipassCard ? (
                      <>
                        <div style={styles.stampRings}>
                          {Array.from({length: Math.min(c.multipass_total_sessions || program?.multipass_session_count || 12, 20)}).map((_, i) => (
                            <span key={i} style={{
                              ...styles.stampRing,
                              background: i < ((c.multipass_total_sessions || 0) - (c.multipass_sessions_remaining || 0)) ? '#e2e8f0' : '#0d9488'
                            }}></span>
                          ))}
                        </div>
                        <p style={styles.stampText}>
                          {c.multipass_sessions_remaining || 0} / {c.multipass_total_sessions || 0} sessions left
                          {c.multipass_expires_at ? ` · until ${c.multipass_expires_at}` : ''}
                        </p>
                      </>
                    ) : isVipCard ? (
                      <>
                        <p style={{...styles.stampText,fontWeight:900,color:c.vip_tier?.color||'#ca8a04'}}>👑 {c.vip_tier?.name||'VIP'}</p>
                        <p style={styles.lastStampedText}>{c.vip_points||0} VIP points{c.vip_next_tier?` · ${Math.max(0,c.vip_next_tier.threshold-(c.vip_points||0))} to ${c.vip_next_tier.name}`:' · Highest tier'}</p>
                      </>
                    ) : isMembershipCard ? (
                      <>
                        <p style={{...styles.stampText, fontWeight: 800}}>
                          {(c.membership_effective_status || c.membership_status || 'inactive').toUpperCase()}
                        </p>
                        <p style={styles.lastStampedText}>
                          {(c.membership_effective_status || c.membership_status) === 'lifetime'
                            ? 'Lifetime membership'
                            : c.membership_expires_at
                            ? `Active until ${c.membership_expires_at}`
                            : 'Not yet activated'}
                        </p>
                      </>
                    ) : (
                      <>
                        <div style={styles.stampRings}>
                          {Array.from({length: program?.stamp_goal || 8}).map((_, i) => (
                            <span key={i} style={{
                              ...styles.stampRing,
                              background: i < (c.stamp_count % (program?.stamp_goal || 8)) ? '#0d9488' : '#e2e8f0'
                            }}></span>
                          ))}
                        </div>
                        <p style={styles.stampText}>{c.stamp_count % (program?.stamp_goal || 8)} / {program?.stamp_goal || 8} rings</p>
                      </>
                    )}
                    <p style={styles.lastStampedText}>{formatLastStamped(c.last_stamp_at)}</p>
                    {c.reward_unlocked && <span style={styles.fruitBadge}>🍎 Reward Ready!</span>}
                    {isMultipassCard && (c.multipass_sessions_remaining || 0) <= 0 && (c.multipass_total_sessions || 0) > 0 && (
                      <span style={styles.fruitBadge}>🎫 Pass Complete</span>
                    )}
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                    <button
                      onClick={() => viewCustomerCard(c)}
                      style={styles.viewCardBtn}
                    >
                      View Card
                    </button>
                    <button
                      onClick={() => openEditCustomer(c)}
                      style={{...styles.viewCardBtn, background: 'transparent', color: '#0d9488', border: '1px solid #a7f3d0'}}
                    >
                      ✏️ Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'staff' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>🌿 Your Team ({filteredStaff.length}{staffSearchTerm ? ` of ${staff.length}` : ''})</h2>
              <button onClick={() => setShowInviteModal(true)} style={styles.addBtn}>+ Grow Team</button>
            </div>
            <div style={styles.searchBarWrap}>
              <span style={styles.searchIcon}>🔍</span>
              <input
                type="text"
                placeholder="Search members by name, email, or role..."
                value={staffSearch}
                onChange={e => setStaffSearch(e.target.value)}
                style={styles.searchInput}
              />
              {staffSearch && (
                <button onClick={() => setStaffSearch('')} style={styles.searchClearBtn} aria-label="Clear search">✕</button>
              )}
            </div>
            {filteredStaff.length === 0 && (
              <p style={styles.searchEmptyText}>No team members match "{staffSearch}".</p>
            )}

            <div style={{background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 12, padding: '14px 16px', marginBottom: 16}}>
              <p style={{margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#0f766e'}}>
                🏢 Branches
              </p>
              {branches.map(b => (
                <div key={b.public_id} style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
                  <input
                    defaultValue={b.name}
                    onBlur={e => renameBranch(b, e.target.value)}
                    style={{...styles.input, margin: 0, flex: 1, fontSize: 13, padding: '6px 10px'}}
                  />
                </div>
              ))}
              <form onSubmit={addBranch} style={{display: 'flex', gap: 8, marginTop: 8}}>
                <input
                  placeholder="New branch name"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  style={{...styles.input, margin: 0, flex: 1, fontSize: 13, padding: '6px 10px'}}
                />
                <button type="submit" disabled={savingBranch} style={{padding: '6px 12px', background: '#0d9488', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'}}>
                  + Add
                </button>
              </form>
            </div>

            <div style={{background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 12, padding: '14px 16px', marginBottom: 16}}>
              <p style={{margin: '0 0 4px 0', fontSize: 13, fontWeight: 600, color: '#0f766e'}}>
                Business ID (cashiers need this to log in)
              </p>
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <code style={{fontSize: 13, color: '#1e293b', background: 'white', padding: '6px 10px', borderRadius: 8, wordBreak: 'break-all', flex: 1}}>
                  {user.business_slug}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(user.business_slug)}
                  style={{padding: '6px 12px', background: '#0d9488', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'}}
                >
                  Copy
                </button>
              </div>
            </div>

            <div style={styles.staffGrid}>
              {filteredStaff.map(s => (
                <div key={s.public_id} style={styles.staffCard}>
                  <div style={styles.staffAvatar}>{s.name?.[0]?.toUpperCase()}</div>
                  <div style={styles.staffInfo}>
                    <h4>{s.name}</h4>
                    <p style={styles.staffRole}>{s.role}</p>
                    <p style={styles.staffEmail}>{s.email}</p>
                    {branches.find(b => b.id === s.branch_id) && (
                      <p style={{margin: '4px 0 0 0', fontSize: 12, color: '#0f766e'}}>
                        🏢 {branches.find(b => b.id === s.branch_id).name}
                      </p>
                    )}
                    <p style={{margin: '4px 0 0 0', fontSize: 12, color: '#0f766e', fontWeight: 600}}>
                      PIN: <code style={{background: '#f0fdf4', padding: '2px 6px', borderRadius: 6}}>{s.pin || '0000'}</code>
                    </p>
                    <p style={{margin: '4px 0 0 0', fontSize: 12, color: '#64748b'}}>
                      🏷️ {stampCounts[s.public_id] || 0} stamps added
                    </p>
                    <span style={{...styles.statusBadge, background: s.is_active ? '#dcfce7' : '#fee2e2', color: s.is_active ? '#166534' : '#991b1b'}}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <button
                    onClick={() => openEditStaff(s)}
                    style={{...styles.viewCardBtn, background: 'transparent', color: '#0d9488', border: '1px solid #a7f3d0', alignSelf: 'flex-start'}}
                  >
                    ✏️ Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'program' && (
          <div style={styles.programTab}>
            <LoyaltyCardCustomizer API_BASE={API_BASE} user={user} onSaved={loadData} />
            {isMembershipCard && (
              <div style={{...styles.card, marginTop: 18}}>
                <h3 style={{marginTop: 0}}>Membership subscription settings</h3>
                <label style={styles.label}>Default duration (days)</label>
                <input
                  style={styles.input}
                  type="number"
                  min="1"
                  value={membershipSettings.membership_duration_days}
                  onChange={e => setMembershipSettings({...membershipSettings, membership_duration_days: e.target.value})}
                />
                <label style={styles.label}>Default price (₱)</label>
                <input
                  style={styles.input}
                  type="number"
                  min="0"
                  value={membershipSettings.membership_price}
                  onChange={e => setMembershipSettings({...membershipSettings, membership_price: e.target.value})}
                />
                <label style={styles.label}>Perks / benefits (one per line)</label>
                <textarea
                  style={{...styles.input, minHeight: 120, resize: 'vertical'}}
                  value={membershipSettings.membership_services_text}
                  onChange={e => setMembershipSettings({...membershipSettings, membership_services_text: e.target.value})}
                  placeholder={'Unlimited access\nLocker use\nFree assessment'}
                />
                <label style={{...styles.label, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer'}}>
                  <input
                    type="checkbox"
                    checked={!!membershipSettings.membership_quick_checkin}
                    onChange={e => setMembershipSettings({...membershipSettings, membership_quick_checkin: e.target.checked})}
                    style={{marginTop: 3}}
                  />
                  <span><strong>Quick check-in (gym mode)</strong><br/><small style={{color:'#64748b'}}>Cashiers scan and log a visit immediately without asking for a service note. Turn this off for clinics or services that need visit details.</small></span>
                </label>
                <label style={styles.label}>Terms (optional)</label>
                <textarea
                  style={{...styles.input, minHeight: 90, resize: 'vertical'}}
                  value={membershipSettings.membership_terms}
                  onChange={e => setMembershipSettings({...membershipSettings, membership_terms: e.target.value})}
                />
                <button style={styles.submitBtn} onClick={saveMembershipSettings} disabled={savingMembershipSettings}>
                  {savingMembershipSettings ? 'Saving...' : 'Save membership settings'}
                </button>
              </div>
            )}

            {business?.status !== 'active' && (
              <div style={{...styles.goLiveCard, marginTop: 16, maxWidth: 500, marginLeft: 'auto', marginRight: 'auto'}}>
                <h3>🚀 Ready to Plant?</h3>
                <p>Your loyalty program is configured. Go live to start growing!</p>
                <button onClick={goLive} style={styles.goLiveBtn}>Go Live 🌱</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'billing' && (
          <SubscriptionPayment API_BASE={API_BASE} businessSlug={user.business_slug} onPaid={loadData} />
        )}
      </div>

      {/* QR Code Modal */}
      {showQRModal && (
        <div style={styles.modalOverlay} onClick={() => setShowQRModal(false)}>
          <div style={{...styles.modal, textAlign: 'center'}} onClick={e => e.stopPropagation()}>
            <h3>🔗 Share Your Tree</h3>
            <p style={{color: '#64748b', fontSize: 14, marginBottom: 16}}>
              Customers scan this QR code to join your loyalty program
            </p>
            {qrImageUrl && (
              <img 
                src={qrImageUrl} 
                alt="QR Code" 
                style={{width: 200, height: 200, marginBottom: 16}} 
              />
            )}
            <p style={{fontSize: 12, color: '#94a3b8', wordBreak: 'break-all', marginBottom: 16}}>
              {FRONTEND_URL}/join/{user.business_slug}
            </p>
            <div style={{display: 'flex', gap: 12, justifyContent: 'center'}}>
              <button onClick={shareQR} style={styles.submitBtn}>
                📤 Share
              </button>
              <button onClick={downloadQR} style={{...styles.submitBtn, background: '#64748b'}}>
                ⬇️ Download
              </button>
            </div>
            <button 
              onClick={() => setShowQRModal(false)} 
              style={{...styles.submitBtn, background: 'transparent', color: '#64748b', marginTop: 8}}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Customer Loyalty Card Modal */}
      {showCardModal && selectedCustomer && (
        <div style={styles.modalOverlay} onClick={() => setShowCardModal(false)}>
          <div style={{...styles.modal, maxWidth: 900}} onClick={e => e.stopPropagation()}>
            {/* Digital Card Preview */}
            <div style={{
              ...styles.loyaltyCard,
              background: `linear-gradient(135deg, ${program?.primary_color || '#0d9488'} 0%, ${program?.primary_color || '#14b8a6'} 100%)`,
            }}>
              <div style={styles.ownerCardQr}>
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(`${API_BASE}/stamp/${selectedCustomer.public_id}`)}`} alt="Member QR" style={styles.ownerCardQrImage}/>
              </div>
              <div style={styles.cardHeader}>
                <img src={logo64} alt="LoyaltyTree" style={styles.cardLogo} />
                <span style={styles.cardBusiness}>{user?.business_name}</span>
              </div>
              <div style={styles.cardBody}>
                <h3 style={styles.cardName}>{selectedCustomer.name}</h3>
                <p style={styles.cardId}>ID: {selectedCustomer.public_id?.slice(0, 8)}...</p>
                {isPointsCard ? (
                  <div style={styles.cardProgress}>
                    <p style={{fontSize: 32, fontWeight: 800, color: 'white', margin: '8px 0 0'}}>
                      {selectedCustomer.points_balance || 0}
                    </p>
                    <p style={{fontSize: 13, color: 'rgba(255,255,255,0.85)', margin: '2px 0 0'}}>points</p>
                    {(program?.points_prizes || []).length > 0 && (
                      <div style={{marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.25)', paddingTop: 8, textAlign: 'left'}}>
                        {program.points_prizes.map((prize, i) => (
                          <div key={prize.id || i} style={{
                            display: 'flex', justifyContent: 'space-between', padding: '4px 0',
                            fontSize: 12.5, color: 'white',
                            opacity: (selectedCustomer.points_balance || 0) >= prize.points_cost ? 1 : 0.5,
                          }}>
                            <span>{prize.name}</span>
                            <span style={{fontWeight: 700}}>{prize.points_cost} pts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : isMultipassCard ? (
                  <div style={styles.cardProgress}>
                    <p style={{fontSize: 32, fontWeight: 800, color: 'white', margin: '8px 0 0'}}>
                      {selectedCustomer.multipass_sessions_remaining || 0}
                    </p>
                    <p style={{fontSize: 13, color: 'rgba(255,255,255,0.85)', margin: '2px 0 0'}}>
                      of {selectedCustomer.multipass_total_sessions || 0} sessions left
                    </p>
                    {program?.description && (
                      <p style={{fontSize: 12.5, color: 'rgba(255,255,255,0.85)', margin: '10px 0 0'}}>{program.description}</p>
                    )}
                    {selectedCustomer.multipass_expires_at && (
                      <p style={{fontSize: 12, color: 'rgba(255,255,255,0.7)', margin: '6px 0 0'}}>
                        Valid until {selectedCustomer.multipass_expires_at}
                      </p>
                    )}
                  </div>
                ) : isVipCard ? (
                  <div style={styles.cardProgress}><p style={{fontSize:30,fontWeight:900,color:'white',margin:'8px 0 2px'}}>👑 {selectedCustomer.vip_tier?.name||'VIP'}</p><p style={{fontSize:14,color:'white',fontWeight:800}}>VIP Points: {selectedCustomer.vip_points||0}</p>{selectedCustomer.vip_next_tier&&<p style={{fontSize:12,color:'rgba(255,255,255,.8)'}}>{Math.max(0,selectedCustomer.vip_next_tier.threshold-(selectedCustomer.vip_points||0))} points to {selectedCustomer.vip_next_tier.name}</p>}{(selectedCustomer.vip_tier?.benefits||[]).map((b,i)=><p key={i} style={{fontSize:12,color:'white',margin:'4px 0',textAlign:'left'}}>✓ {b}</p>)}</div>
                ) : isMembershipCard ? (
                  <div style={styles.cardProgress}>
                    <p style={{
                      fontSize: 30,
                      fontWeight: 900,
                      color: 'white',
                      margin: '8px 0 2px',
                      letterSpacing: 0.5,
                    }}>
                      {(selectedCustomer.membership_effective_status || selectedCustomer.membership_status || 'inactive').toUpperCase()}
                    </p>

                    <p style={{
                      fontSize: 13,
                      color: 'rgba(255,255,255,0.88)',
                      margin: '4px 0 0',
                    }}>
                      {(selectedCustomer.membership_effective_status || selectedCustomer.membership_status) === 'lifetime'
                        ? 'Lifetime membership'
                        : selectedCustomer.membership_expires_at
                        ? `Active until ${selectedCustomer.membership_expires_at}`
                        : 'Membership not yet activated'}
                    </p>

                    {selectedCustomer.membership_start_date && (
                      <p style={{
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.72)',
                        margin: '6px 0 0',
                      }}>
                        Member since {selectedCustomer.membership_start_date}
                      </p>
                    )}

                    {Array.isArray(program?.membership_services) && program.membership_services.length > 0 && (
                      <div style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: '1px solid rgba(255,255,255,0.25)',
                        textAlign: 'left',
                      }}>
                        <p style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: 'rgba(255,255,255,0.72)',
                          margin: '0 0 7px',
                          textTransform: 'uppercase',
                          letterSpacing: 0.6,
                        }}>
                          Membership perks
                        </p>
                        {program.membership_services.slice(0, 5).map((benefit, i) => (
                          <p key={i} style={{
                            fontSize: 12.5,
                            color: 'white',
                            margin: '4px 0',
                          }}>
                            ✓ {benefit}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={styles.cardStamps}>
                      {Array.from({length: program?.stamp_goal || 8}).map((_, i) => (
                        <span key={i} style={{
                          ...styles.cardStamp,
                          background: i < (selectedCustomer.stamp_count % (program?.stamp_goal || 8)) ? 'white' : 'rgba(255,255,255,0.3)',
                        }}>★</span>
                      ))}
                    </div>
                    <p style={styles.cardProgress}>
                      {selectedCustomer.stamp_count % (program?.stamp_goal || 8)} / {program?.stamp_goal || 8} stamps
                    </p>
                    {selectedCustomer.reward_unlocked && (
                      <div style={styles.cardReward}>🎁 {program?.reward_name || 'Free Reward'} Unlocked!</div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div style={{marginBottom:18, padding:16, border:'1px solid #ccfbf1', background:'#f0fdfa', borderRadius:14}}>
              {isMembershipCard && (
                  <>
                    <div style={{display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:10, marginBottom:14}}>
                      <div style={{background:'white', border:'1px solid #99f6e4', borderRadius:12, padding:12}}>
                        <div style={{fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase'}}>Total visits</div>
                        <div style={{fontSize:24, fontWeight:900, color:'#0f766e', marginTop:4}}>
                          {selectedCustomer.membership_visit_count || memberHistory.length || 0}
                        </div>
                      </div>
                      <div style={{background:'white', border:'1px solid #99f6e4', borderRadius:12, padding:12}}>
                        <div style={{fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase'}}>Last visit</div>
                        <div style={{fontSize:14, fontWeight:800, color:'#0f766e', marginTop:6}}>
                          {selectedCustomer.membership_last_visit_at
                            ? new Date(selectedCustomer.membership_last_visit_at).toLocaleString()
                            : 'Never'}
                        </div>
                      </div>
                    </div>

                    <div style={{padding:14, background:'white', border:'1px solid #99f6e4', borderRadius:12, marginBottom:14}}>
                      <div style={{fontWeight:900, color:'#134e4a', marginBottom:4}}>Add member visit note</div>
                      <div style={{fontSize:12, color:'#64748b', marginBottom:10}}>
                        {membershipSettings.membership_quick_checkin
                          ? 'Gym quick check-in is enabled. This records a visit immediately without requiring notes.'
                          : 'Record the service, medical note, observation, or follow-up details for this visit.'}
                      </div>
                      {!membershipSettings.membership_quick_checkin && (
                        <>
                          <input
                            style={{...styles.input, marginBottom:8}}
                            value={memberVisitService}
                            onChange={e => setMemberVisitService(e.target.value)}
                            placeholder="Service or visit type (optional)"
                          />
                          <textarea
                            style={{...styles.input, minHeight:78, marginBottom:8}}
                            value={memberVisitNote}
                            onChange={e => setMemberVisitNote(e.target.value)}
                            placeholder="Medical note, observations, follow-up, or other details (optional)"
                          />
                        </>
                      )}
                      <button
                        type="button"
                        style={{...styles.submitBtn, marginTop:0}}
                        disabled={membershipActionLoading}
                        onClick={logMemberVisitFromOwner}
                      >
                        {membershipActionLoading ? 'Saving visit…' : 'Log Member Visit'}
                      </button>
                    </div>
                  </>
                )}

                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12}}>
                  <div>
                    <strong style={{fontSize:15,color:'#115e59'}}>
                      {isMultipassCard ? 'Multi-Pass activity' : isMembershipCard ? 'Member visit analytics' : isPointsCard ? 'Points activity' : isVipCard ? 'VIP activity' : 'Stamp activity'}
                    </strong>
                    <div style={{fontSize:12,color:'#64748b',marginTop:3}}>
                      {isMembershipCard
                        ? 'Service, notes, cashier, branch, and visit date'
                        : isMultipassCard
                        ? 'Every issued pass and stamped session'
                        : isPointsCard
                        ? 'Every points-earning sale, cashier, and branch'
                        : isVipCard
                        ? 'Every VIP points award and tier change'
                        : 'The date, cashier, and branch for every recorded stamp'}
                    </div>
                  </div>
                  <div style={{minWidth:76,textAlign:'center',background:'white',border:'1px solid #99f6e4',borderRadius:10,padding:'8px 10px'}}>
                    <strong style={{display:'block',fontSize:20,color:'#0f766e'}}>
                      {isMembershipCard
                        ? (selectedCustomer.membership_visit_count || memberHistory.length || 0)
                        : memberHistory.filter(item => !isMultipassCard || item.action === 'used').length}
                    </strong>
                    <span style={{fontSize:11,color:'#64748b'}}>
                      {isMembershipCard ? 'Visits' : isMultipassCard ? 'Used' : isPointsCard ? 'Sales' : isVipCard ? 'Updates' : 'Stamps'}
                    </span>
                  </div>
                </div>

                {memberHistoryLoading ? <p style={{color:'#64748b'}}>Loading activity...</p> : memberHistory.length === 0 ? (
                  <p style={{color:'#64748b',background:'white',padding:12,borderRadius:10,margin:0}}>
                    No dated activity has been recorded yet. Activity history starts when scans are logged through the system.
                  </p>
                ) : (
                  <div style={{maxHeight:320, overflowY:'auto', background:'white', borderRadius:12, padding:'0 12px'}}>
                    {memberHistory.map((item, i) => {
                      const eventDate = item.service_date || item.created_at
                      const location = [item.staff_name ? `By ${item.staff_name}` : null, item.branch_name ? `at ${item.branch_name}` : null].filter(Boolean).join(' ')
                      const title = isMembershipCard
                        ? (item.service_name || 'Visit')
                        : isMultipassCard
                        ? (item.action === 'issued' ? 'Pass issued' : 'Session stamped')
                        : isPointsCard
                        ? `+${item.points_earned ?? 0} pts earned`
                        : isVipCard
                        ? `${(item.points_delta ?? 0) >= 0 ? '+' : ''}${item.points_delta ?? 0} VIP pts`
                        : `Stamp #${item.stamp_number || (memberHistory.length - i)}`
                      // vip_events.action is always 'sale' or 'adjustment' -
                      // never a distinct 'tier_change' value - so a tier
                      // change is detected by comparing old_tier/new_tier on
                      // the row, not by action, and shown as a second line
                      // alongside the points-delta title rather than
                      // replacing it (both can be true at once: a sale that
                      // also pushed the customer into a new tier).
                      const tierChanged = isVipCard && item.old_tier && item.new_tier && item.old_tier !== item.new_tier

                      return <div key={item.id || i} style={{display:'grid',gridTemplateColumns:'12px 1fr',gap:10,padding:'12px 0',borderBottom:i===memberHistory.length-1?'none':'1px solid #e2e8f0'}}>
                        <div style={{width:10,height:10,borderRadius:'50%',background:'#14b8a6',marginTop:5,boxShadow:'0 0 0 4px #ccfbf1'}} />
                        <div>
                          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
                            <strong style={{color:'#134e4a'}}>{title}</strong>
                            <span style={{fontSize:12,color:'#64748b',whiteSpace:'nowrap'}}>
                              {eventDate ? new Date(eventDate).toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:eventDate.includes?.('T')?'numeric':undefined,minute:eventDate.includes?.('T')?'2-digit':undefined}) : 'Date unavailable'}
                            </span>
                          </div>
                          {isMultipassCard && <div style={{fontSize:13,color:'#475569',marginTop:3}}>{item.sessions_remaining ?? 0} sessions remaining after this activity</div>}
                          {isMembershipCard && item.note && <div style={{fontSize:13,color:'#334155',whiteSpace:'pre-wrap',marginTop:6,padding:8,background:'#f8fafc',borderRadius:8}}>{item.note}</div>}
                          {isPointsCard && item.amount_spent_pesos != null && <div style={{fontSize:13,color:'#475569',marginTop:3}}>₱{Number(item.amount_spent_pesos).toLocaleString()} spent</div>}
                          {isVipCard && tierChanged && <div style={{fontSize:13,fontWeight:700,color:'#b45309',marginTop:3}}>🏆 Tier: {item.old_tier} → {item.new_tier}</div>}
                          {isVipCard && (item.amount_spent != null || item.points_balance != null) && (
                            <div style={{fontSize:13,color:'#475569',marginTop:3}}>
                              {item.amount_spent != null ? `₱${Number(item.amount_spent).toLocaleString()} spent` : null}
                              {item.amount_spent != null && item.points_balance != null ? ' • ' : null}
                              {item.points_balance != null ? `${item.points_balance} pts balance after` : null}
                            </div>
                          )}
                          {isVipCard && item.note && <div style={{fontSize:13,color:'#334155',whiteSpace:'pre-wrap',marginTop:6,padding:8,background:'#f8fafc',borderRadius:8}}>{item.note}</div>}
                          {location && <div style={{fontSize:12,color:'#64748b',marginTop:5}}>{location}</div>}
                        </div>
                      </div>
                    })}
                  </div>
                )}
              </div>

            {activeCoupon && (
              <div style={{ background: '#f0fdfa', border: '1.5px dashed #0d9488', borderRadius: 10, padding: '10px 14px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f766e' }}>🎟️ {activeCoupon.reward_text}</div>
              </div>
            )}

            {/* QR Code */}
            <div style={{textAlign: 'center', margin: '20px 0'}}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`${API_BASE}/stamp/${selectedCustomer.public_id}`)}`}
                alt="Customer QR"
                style={{borderRadius: 12, border: '2px solid #e2e8f0'}}
              />
              <p style={{fontSize: 11, color: '#94a3b8', marginTop: 8}}>Scan at checkout</p>
            </div>

            {/* Wallet Buttons */}
            <div style={{display: 'flex', gap: 10, flexDirection: 'column'}}>
              <button 
                onClick={() => addToGoogleWallet(selectedCustomer)}
                style={styles.googleWalletBtn}
              >
                <span style={{fontSize: 20}}>🎫</span> Add to Google Wallet
              </button>
              <button 
                onClick={() => addToAppleWallet(selectedCustomer)}
                style={styles.appleWalletBtn}
              >
                <span style={{fontSize: 20}}>🍎</span> Add to Apple Wallet
              </button>
              <button 
                onClick={() => {
                  const cardUrl = `${FRONTEND_URL}/wallet/${selectedCustomer.public_id}`
                  if (navigator.share) {
                    navigator.share({
                      title: `${user?.business_name} Loyalty Card`,
                      text: `My loyalty card for ${user?.business_name}`,
                      url: cardUrl
                    })
                  } else {
                    navigator.clipboard.writeText(cardUrl)
                    setMessage('Card link copied!')
                  }
                }}
                style={{...styles.submitBtn, background: '#f0fdf4', color: '#0d9488'}}
              >
                🔗 Share Card Link
              </button>
            </div>

            <button 
              onClick={() => setShowCardModal(false)} 
              style={{...styles.submitBtn, background: 'transparent', color: '#64748b', marginTop: 12}}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {/* Edit Customer Modal */}
      {showEditModal && (
        <div style={styles.modalOverlay} onClick={() => setShowEditModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>✏️ Edit Customer</h3>
            <form onSubmit={saveCustomer}>
              <label style={styles.label}>Full Name</label>
              <input style={styles.input} value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} required />
              {isPointsCard ? (
                <>
                  <label style={styles.label}>Points Balance</label>
                  <input
                    style={styles.input}
                    type="number"
                    min="0"
                    value={editForm.points_balance}
                    onChange={e => setEditForm({...editForm, points_balance: e.target.value})}
                  />
                </>
              ) : isMultipassCard ? (
                <>
                  <label style={styles.label}>Sessions Remaining</label>
                  <input
                    style={styles.input}
                    type="number"
                    min="0"
                    value={editForm.multipass_sessions_remaining}
                    onChange={e => setEditForm({...editForm, multipass_sessions_remaining: e.target.value})}
                  />
                </>
              ) : isVipCard ? (
                <>
                  <label style={styles.label}>VIP points</label><input style={styles.input} type='number' min='0' value={editForm.vip_points||0} onChange={e=>setEditForm({...editForm,vip_points:e.target.value})}/>
                  <label style={styles.label}>Manual tier override</label><select style={styles.input} value={editForm.vip_manual_tier_id||''} onChange={e=>setEditForm({...editForm,vip_manual_tier_id:e.target.value})}><option value=''>Automatic from points</option>{(program?.vip_tiers||[]).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
                </>
              ) : isMembershipCard ? (
                <>
                  <label style={styles.label}>Membership status</label>
                  <input style={styles.input} value={(editForm.membership_status || 'inactive').toUpperCase()} readOnly />
                  <label style={styles.label}>Started</label>
                  <input style={styles.input} type="date" value={editForm.membership_start_date || ''} readOnly />
                  <label style={styles.label}>Expires</label>
                  <input style={styles.input} type="date" value={editForm.membership_expires_at || ''} readOnly />
                  <div style={{display: 'flex', flexWrap:'wrap', gap: 8, marginBottom: 18}}>
                    <button type="button" style={{...styles.submitBtn, width:'auto', flex:'1 1 120px'}} disabled={membershipActionLoading} onClick={() => runMembershipAction('activate')}>Activate</button>
                    <button type="button" style={{...styles.submitBtn, width:'auto', flex:'1 1 120px'}} disabled={membershipActionLoading} onClick={() => runMembershipAction('renew')}>Renew</button>
                    <button type="button" style={{...styles.submitBtn, width:'auto', flex:'1 1 120px', background: '#f59e0b'}} disabled={membershipActionLoading} onClick={() => runMembershipAction('suspend')}>Suspend</button>
                    <button type="button" style={{...styles.submitBtn, width:'auto', flex:'1 1 120px', background: '#0d9488'}} disabled={membershipActionLoading} onClick={() => runMembershipAction('reactivate')}>Reactivate</button>
                    <button type="button" style={{...styles.submitBtn, width:'auto', flex:'1 1 120px', background: '#334155'}} disabled={membershipActionLoading} onClick={() => runMembershipAction('lifetime')}>Lifetime</button>
                    <button type="button" style={{...styles.submitBtn, width:'auto', flex:'1 1 120px', background: '#dc2626'}} disabled={membershipActionLoading} onClick={() => runMembershipAction('cancel')}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <label style={styles.label}>
                    Stamps {program?.stamp_goal ? `(of ${program.stamp_goal} for a reward)` : ''}
                  </label>
                  <input
                    style={styles.input}
                    type="number"
                    min="0"
                    value={editForm.stamp_count}
                    onChange={e => setEditForm({...editForm, stamp_count: e.target.value})}
                  />
                </>
              )}
              <label style={styles.label}>Address</label>
              <input style={styles.input} value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})} />
              <label style={styles.label}>Age</label>
              <input style={styles.input} type="number" min="0" max="120" value={editForm.age} onChange={e => setEditForm({...editForm, age: e.target.value})} />
              <label style={styles.label}>Number</label>
              <input style={styles.input} value={editForm.phone || ''} onChange={e => setEditForm({...editForm, phone: e.target.value})} required />
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={editForm.email || ''} onChange={e => setEditForm({...editForm, email: e.target.value})} />
              <label style={styles.label}>Birthday</label>
              <input style={styles.input} type="date" value={editForm.birthday || ''} onChange={e => setEditForm({...editForm, birthday: e.target.value})} />
              <label style={styles.label}>Occupation</label>
              <select style={styles.input} value={editForm.occupation || ''} onChange={e => setEditForm({...editForm, occupation: e.target.value})}>
                <option value="">Not specified</option>
                <option value="working">Working</option>
                <option value="business_owner">Business Owner</option>
                <option value="unemployed">Unemployed</option>
              </select>
              <label style={styles.label}>Since When Last Ordered</label>
              <input style={styles.input} type="date" value={editForm.last_order_date || ''} onChange={e => setEditForm({...editForm, last_order_date: e.target.value})} />
              <button type="submit" style={styles.submitBtn} disabled={savingCustomer}>
                {savingCustomer ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={deleteCustomer}
                disabled={deletingCustomer}
                style={{...styles.submitBtn, background: 'transparent', color: '#dc2626', border: '1px solid #fecaca', marginTop: 8}}
              >
                {deletingCustomer ? 'Removing...' : '🗑️ Remove Leaf'}
              </button>
            </form>

            {/* One-Time Coupon */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <label style={styles.label}>One-Time Coupon</label>
              {couponLoading ? (
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Loading...</p>
              ) : activeCoupon ? (
                <div style={{ background: '#f0fdfa', border: '1.5px solid #0d9488', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>🎟️ {activeCoupon.reward_text}</div>
                  {activeCoupon.expires_at && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Expires {activeCoupon.expires_at}</div>
                  )}
                  <button
                    type="button"
                    onClick={handleCancelCoupon}
                    style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancel Coupon
                  </button>
                </div>
              ) : showCouponForm ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    style={styles.input}
                    value={couponText}
                    onChange={e => setCouponText(e.target.value)}
                    placeholder="What's the coupon for? e.g. Free coffee"
                    maxLength={200}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      type="date"
                      value={couponExpiry}
                      onChange={e => setCouponExpiry(e.target.value)}
                    />
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>expiry (optional)</span>
                  </div>
                  {couponError && <div style={{ color: '#dc2626', fontSize: 13 }}>{couponError}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => { setShowCouponForm(false); setCouponError('') }}
                      style={{ ...styles.submitBtn, background: 'transparent', color: '#64748b' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCoupon}
                      disabled={couponSaving}
                      style={styles.submitBtn}
                    >
                      {couponSaving ? 'Creating...' : 'Create Coupon'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCouponForm(true)}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1.5px dashed #0d9488', background: '#f0fdfa', color: '#0f766e', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  🎟️ Create One-Time Coupon
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {showStaffEditModal && (
        <div style={styles.modalOverlay} onClick={() => setShowStaffEditModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>✏️ Edit Cashier</h3>
            <form onSubmit={saveStaff}>
              <label style={styles.label}>Name</label>
              <input style={styles.input} value={staffEditForm.name || ''} onChange={e => setStaffEditForm({...staffEditForm, name: e.target.value})} required />
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={staffEditForm.email || ''} onChange={e => setStaffEditForm({...staffEditForm, email: e.target.value})} required />
              <label style={styles.label}>Phone</label>
              <input style={styles.input} value={staffEditForm.phone || ''} onChange={e => setStaffEditForm({...staffEditForm, phone: e.target.value})} />
              <label style={styles.label}>Role</label>
              <select style={styles.input} value={staffEditForm.role || 'cashier'} onChange={e => setStaffEditForm({...staffEditForm, role: e.target.value})}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
              <label style={styles.label}>Branch</label>
              <select style={styles.input} value={staffEditForm.branch_public_id || ''} onChange={e => setStaffEditForm({...staffEditForm, branch_public_id: e.target.value})}>
                <option value="">No branch assigned</option>
                {branches.map(b => (
                  <option key={b.public_id} value={b.public_id}>{b.name}</option>
                ))}
              </select>
              <label style={styles.label}>PIN</label>
              <input
                style={styles.input}
                value={staffEditForm.pin || ''}
                onChange={e => setStaffEditForm({...staffEditForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6)})}
                inputMode="numeric"
                placeholder="0000"
              />
              <label style={{...styles.label, display: 'flex', alignItems: 'center', gap: 8}}>
                <input
                  type="checkbox"
                  checked={staffEditForm.is_active !== false}
                  onChange={e => setStaffEditForm({...staffEditForm, is_active: e.target.checked})}
                />
                Active (can clock in / stamp cards)
              </label>
              <button type="submit" style={styles.submitBtn} disabled={savingStaff}>
                {savingStaff ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={deleteStaff}
                disabled={deletingStaff}
                style={{...styles.submitBtn, background: 'transparent', color: '#dc2626', border: '1px solid #fecaca', marginTop: 8}}
              >
                {deletingStaff ? 'Removing...' : '🗑️ Remove Cashier'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div style={styles.modalOverlay} onClick={() => setShowInviteModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>🌿 Grow Your Team</h3>
            <form onSubmit={inviteStaff}>
              <input style={styles.input} placeholder="Name" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} required />
              <input style={styles.input} placeholder="Email" type="email" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} required />
              <input style={styles.input} placeholder="Phone" value={inviteForm.phone} onChange={e => setInviteForm({...inviteForm, phone: e.target.value})} />
              <select style={styles.input} value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value})}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
              <select style={styles.input} value={inviteForm.branch_public_id} onChange={e => setInviteForm({...inviteForm, branch_public_id: e.target.value})}>
                <option value="">No branch assigned</option>
                {branches.map(b => (
                  <option key={b.public_id} value={b.public_id}>{b.name}</option>
                ))}
              </select>
              <button type="submit" style={styles.submitBtn}>Send Invite</button>
            </form>
          </div>
        </div>
      )}

      {showAnnouncements && (
        <Announcements
          API_BASE={API_BASE}
          businessSlug={user.business_slug}
          onClose={() => setShowAnnouncements(false)}
        />
      )}

      {showOnboarding && (() => {
        const totalSteps = 4
        const safeStep = Math.min(onboardingStep, totalSteps - 1)

        const goNextAfterCard = () => {
          loadData()
          setOnboardingStep(1)
        }

        const submitCashierInsideTutorial = async (e) => {
          e.preventDefault()
          await inviteStaff(e)
          setTimeout(() => {
            loadData()
            setOnboardingStep(2)
          }, 350)
        }

        const finishSetup = () => {
          if (onboardingKey) localStorage.setItem(onboardingKey, '1')
          setShowOnboarding(false)
          setActiveTab('tree')
        }

        return (
          <div style={styles.modalOverlay}>
            <div
              style={{
                ...styles.modal,
                width: safeStep === 0 ? 'min(1100px, 96vw)' : 'min(620px, 94vw)',
                maxWidth: safeStep === 0 ? 1100 : 620,
                maxHeight: '92vh',
                padding: 0,
                overflow: 'hidden',
                borderRadius: 22,
                boxShadow: '0 28px 90px rgba(15,23,42,.28)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e2e8f0',
                background: 'white',
              }}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16}}>
                  <div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 850,
                      color: cardExperience.accent,
                      textTransform: 'uppercase',
                      letterSpacing: .7,
                    }}>
                      LoyaltyTree setup · Step {safeStep + 1} of {totalSteps}
                    </div>
                    <h2 style={{margin: '5px 0 0', fontSize: 24, color: '#0f172a'}}>
                      {safeStep === 0
                        ? 'Choose and configure your card'
                        : safeStep === 1
                        ? 'Create your cashier'
                        : safeStep === 2
                        ? 'Share your join QR'
                        : 'Your business is ready'}
                    </h2>
                  </div>

                  <div style={{display: 'flex', gap: 6}}>
                    {Array.from({length: totalSteps}).map((_, i) => (
                      <span
                        key={i}
                        style={{
                          width: i === safeStep ? 28 : 9,
                          height: 9,
                          borderRadius: 999,
                          background: i < safeStep ? '#22c55e' : i === safeStep ? cardExperience.accent : '#e2e8f0',
                          transition: 'all .2s ease',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div style={{
                padding: safeStep === 0 ? 18 : 24,
                overflowY: 'auto',
                maxHeight: 'calc(92vh - 84px)',
                background: '#f8fafc',
              }}>
                {safeStep === 0 && (
                  <div>
                    <p style={{margin: '0 0 16px', color: '#64748b', fontSize: 14, lineHeight: 1.55}}>
                      Select the card your business will use, complete its settings, then save it. You will stay inside this setup guide.
                    </p>
                    <div style={{
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      borderRadius: 18,
                      padding: 18,
                    }}>
                      <LoyaltyCardCustomizer
                        API_BASE={API_BASE}
                        user={user}
                        onSaved={goNextAfterCard}
                      />
                    </div>
                  </div>
                )}

                {safeStep === 1 && (
                  <div style={{
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: 18,
                    padding: 22,
                  }}>
                    <p style={{margin: '0 0 18px', color: '#64748b', fontSize: 14, lineHeight: 1.55}}>
                      Create the cashier account that will scan customer cards and record visits, stamps, points, or sessions.
                    </p>

                    <form onSubmit={submitCashierInsideTutorial}>
                      <label style={styles.label}>Cashier name</label>
                      <input
                        style={styles.input}
                        value={inviteForm.name}
                        onChange={e => setInviteForm({...inviteForm, name: e.target.value})}
                        placeholder="Full name"
                        required
                      />

                      <label style={styles.label}>Email</label>
                      <input
                        style={styles.input}
                        type="email"
                        value={inviteForm.email}
                        onChange={e => setInviteForm({...inviteForm, email: e.target.value})}
                        placeholder="cashier@example.com"
                        required
                      />

                      <label style={styles.label}>Phone</label>
                      <input
                        style={styles.input}
                        value={inviteForm.phone}
                        onChange={e => setInviteForm({...inviteForm, phone: e.target.value})}
                        placeholder="09XXXXXXXXX"
                      />

                      {branches.length > 0 && (
                        <>
                          <label style={styles.label}>Branch</label>
                          <select
                            style={styles.input}
                            value={inviteForm.branch_public_id}
                            onChange={e => setInviteForm({...inviteForm, branch_public_id: e.target.value})}
                          >
                            <option value="">Unassigned</option>
                            {branches.map(branch => (
                              <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>
                            ))}
                          </select>
                        </>
                      )}

                      <div style={{
                        background: '#f0fdfa',
                        border: '1px solid #99f6e4',
                        borderRadius: 12,
                        padding: 13,
                        margin: '4px 0 16px',
                        color: '#0f766e',
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}>
                        The initial cashier PIN is <strong>0000</strong>. You can change it later from the Team section.
                      </div>

                      <button type="submit" style={{...styles.submitBtn, width: '100%'}}>
                        Create Cashier and Continue
                      </button>
                    </form>
                  </div>
                )}

                {safeStep === 2 && (
                  <div style={{
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: 18,
                    padding: 24,
                    textAlign: 'center',
                  }}>
                    <p style={{margin: '0 0 18px', color: '#64748b', fontSize: 14, lineHeight: 1.55}}>
                      Customers scan this QR code to join your program and receive their digital card.
                    </p>

                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(`${FRONTEND_URL}/join/${user.business_slug}`)}`}
                      alt="Customer join QR"
                      style={{
                        width: 240,
                        height: 240,
                        maxWidth: '100%',
                        borderRadius: 16,
                        border: '1px solid #e2e8f0',
                        padding: 10,
                        background: 'white',
                      }}
                    />

                    <p style={{
                      margin: '14px auto 18px',
                      fontSize: 12,
                      color: '#64748b',
                      wordBreak: 'break-all',
                      maxWidth: 440,
                    }}>
                      {FRONTEND_URL}/join/{user.business_slug}
                    </p>

                    <div style={{display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap'}}>
                      <button
                        type="button"
                        onClick={shareQR}
                        style={styles.submitBtn}
                      >
                        📤 Share QR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
                          navigator.clipboard.writeText(joinUrl)
                          setMessage('Join link copied!')
                        }}
                        style={{...styles.submitBtn, background: '#475569'}}
                      >
                        🔗 Copy Join Link
                      </button>
                      <button
                        type="button"
                        onClick={() => setOnboardingStep(3)}
                        style={{...styles.submitBtn, background: cardExperience.accent}}
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {safeStep === 3 && (
                  <div style={{
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: 18,
                    padding: '34px 24px',
                    textAlign: 'center',
                  }}>
                    <div style={{fontSize: 54, marginBottom: 10}}>🎉</div>
                    <h3 style={{fontSize: 25, margin: '0 0 8px', color: '#0f172a'}}>
                      Your LoyaltyTree is ready
                    </h3>
                    <p style={{margin: '0 auto 22px', maxWidth: 430, color: '#64748b', fontSize: 14, lineHeight: 1.6}}>
                      Your card is configured, your cashier is ready, and your customer join link can now be shared.
                    </p>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                      gap: 10,
                      maxWidth: 500,
                      margin: '0 auto 22px',
                    }}>
                      <div style={{padding: 13, borderRadius: 12, background: '#f0fdf4', color: '#166534', fontWeight: 750, fontSize: 13}}>
                        ✅ Card configured
                      </div>
                      <div style={{padding: 13, borderRadius: 12, background: '#f0fdf4', color: '#166534', fontWeight: 750, fontSize: 13}}>
                        ✅ Cashier created
                      </div>
                      <div style={{padding: 13, borderRadius: 12, background: '#f0fdf4', color: '#166534', fontWeight: 750, fontSize: 13}}>
                        ✅ Join QR ready
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={finishSetup}
                      style={{
                        ...styles.submitBtn,
                        minWidth: 220,
                        background: cardExperience.accent,
                      }}
                    >
                      Open My Dashboard
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0fdfa 0%, #f8fafc 38%, #f6f8fb 100%)',
    color: '#172033',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loadingTree: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    fontSize: 18,
    color: '#0d9488',
  },
  treeIcon: {
    fontSize: 64,
    animation: 'sway 2s ease-in-out infinite',
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 12,
    padding: '14px clamp(18px, 4vw, 48px)',
    background: 'rgba(255,255,255,0.96)',
    backdropFilter: 'blur(14px)',
    borderBottom: '1px solid #e7ebf0',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    boxShadow: '0 2px 12px rgba(15,23,42,0.04)',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    display: 'block',
  },
  brandName: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: '#0f766e',
  },
  brandTagline: {
    margin: 0,
    fontSize: 12,
    color: '#0d9488',
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  planBadge: {
    padding: '6px 12px',
    background: '#ccfbf1',
    color: '#0f766e',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
  },
  navBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  renewalBtnWarning: {
    background: '#fffbeb',
    color: '#d97706',
    border: '1.5px solid #fde68a',
  },
  renewalBtnExpired: {
    background: '#fef2f2',
    color: '#dc2626',
    border: '1.5px solid #fecaca',
  },
  supportBtn:{padding:'9px 14px',border:'1px solid #c4b5fd',borderRadius:10,background:'#f5f3ff',color:'#6d28d9',fontSize:13,fontWeight:800,cursor:'pointer',whiteSpace:'nowrap'},
  logoutBtn: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#64748b',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    top: 80,
    right: 24,
    padding: '12px 20px',
    background: '#0d9488',
    color: 'white',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 200,
    cursor: 'pointer',
  },
  treeSection: {
    padding: '32px 16px',
    textAlign: 'center',
    position: 'relative',
    maxWidth: 1180,
    margin: '22px auto 0',
    borderRadius: 24,
    background: 'rgba(255,255,255,0.72)',
    border: '1px solid rgba(255,255,255,0.9)',
    boxShadow: '0 18px 45px rgba(15,23,42,0.08)',
    backdropFilter: 'blur(12px)',
  },
  treeVisual: {
    position: 'relative',
    width: 300,
    maxWidth: '100%',
    height: 350,
    margin: '0 auto',
  },
  treeCanopy: {
    position: 'relative',
    width: 250,
    height: 200,
    margin: '0 auto',
    transition: 'transform 0.5s ease',
  },
  treeTop: {
    fontSize: 120,
    position: 'absolute',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))',
  },
  leaf: {
    position: 'absolute',
    fontSize: 20,
    animation: 'float 3s ease-in-out infinite',
  },
  treeTrunk: {
    position: 'relative',
    width: 200,
    margin: '0 auto',
  },
  roots: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: 8,
  },
  root: {
    padding: '8px 16px',
    background: 'rgba(13,148,136,0.1)',
    borderRadius: 20,
    fontSize: 13,
    color: '#0f766e',
    fontWeight: 600,
  },
  statsRing: {
    display: 'flex',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    maxWidth: 360,
    margin: '20px auto 0',
  },
  statOrb: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 20px',
    background: 'white',
    borderRadius: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    minWidth: 90,
    flex: '1 1 90px',
  },
  orbNumber: {
    fontSize: 24,
    fontWeight: 700,
    color: '#0f766e',
  },
  orbLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  growthBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    padding: '8px 20px',
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  growthIcon: {
    fontSize: 24,
  },
  growthText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f766e',
  },
  dashboardShell: {
    width: 'calc(100% - 32px)',
    maxWidth: 1180,
    margin: '28px auto 0',
  },
  dashboardHero: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 20,
    padding: '26px 28px',
    background: 'linear-gradient(135deg, #ffffff 0%, #f0fdfa 100%)',
    border: '1px solid #ccfbf1',
    borderRadius: 20,
    boxShadow: '0 12px 32px rgba(13,148,136,0.10)',
    position: 'relative',
    overflow: 'hidden',
  },
  heroTreeWrap: {
    position: 'relative',
    width: 112,
    height: 96,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  heroTreeGlow: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: '50%',
    background: 'rgba(20,184,166,0.12)',
    filter: 'blur(2px)',
  },
  heroTree: {
    position: 'relative',
    zIndex: 2,
    fontSize: 72,
    lineHeight: 1,
    filter: 'drop-shadow(0 8px 10px rgba(13,148,136,0.16))',
  },
  heroTreeGround: {
    position: 'absolute',
    zIndex: 3,
    bottom: 0,
    display: 'flex',
    gap: 2,
    fontSize: 13,
  },
  heroIdentity: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    flex: '1 1 360px',
  },
  heroIcon: {
    width: 68,
    height: 68,
    borderRadius: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 34,
    flexShrink: 0,
  },
  heroEyebrow: {
    margin: '0 0 5px',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.8,
    color: '#0d9488',
    textTransform: 'uppercase',
  },
  heroTitle: {
    margin: 0,
    fontSize: 'clamp(24px, 3vw, 34px)',
    lineHeight: 1.15,
    color: '#172033',
  },
  heroDescription: {
    margin: '8px 0 0',
    color: '#667085',
    fontSize: 14,
  },
  heroGrowthRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  heroGrowthBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 999,
    background: '#ccfbf1',
    color: '#0f766e',
    fontSize: 12,
    fontWeight: 800,
  },
  heroProgramBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.8)',
    border: '1px solid #d5f5ef',
    color: '#475467',
    fontSize: 12,
    fontWeight: 700,
  },
  heroQuickActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryActionBtn: {
    padding: '11px 16px',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 750,
    cursor: 'pointer',
  },
  secondaryActionBtn: {
    padding: '11px 16px',
    color: '#344054',
    background: 'white',
    border: '1px solid #d9dee7',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 14,
    marginTop: 16,
  },
  metricCard: {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 126,
    padding: '20px 20px 18px',
    background: 'white',
    border: '1px solid #dff7f2',
    borderRadius: 16,
    boxShadow: '0 6px 20px rgba(15,23,42,0.045)',
  },
  metricAccent: {
    position: 'absolute',
    inset: '0 auto 0 0',
    width: 4,
  },
  metricLabel: {
    color: '#667085',
    fontSize: 13,
    fontWeight: 700,
  },
  metricValue: {
    marginTop: 8,
    fontSize: 32,
    lineHeight: 1,
  },
  metricHint: {
    marginTop: 10,
    color: '#98a2b3',
    fontSize: 12,
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    padding: 6,
    overflowX: 'auto',
    background: 'white',
    border: '1px solid #dff7f2',
    borderRadius: 14,
    boxShadow: '0 5px 18px rgba(15,23,42,0.04)',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '10px 15px',
    border: 'none',
    borderRadius: 10,
    background: 'transparent',
    color: '#667085',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  content: {
    padding: '22px 16px 48px',
    maxWidth: 1180,
    margin: '0 auto',
  },
  treeTab: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  actionCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
  },
  actionCard: {
    background: 'white',
    borderRadius: 16,
    padding: 24,
    textAlign: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    border: '1px solid rgba(13,148,136,0.08)',
  },
  actionIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  goLiveCard: {
    background: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
    borderRadius: 16,
    padding: 24,
    color: 'white',
    textAlign: 'center',
  },
  goLiveBtn: {
    padding: '12px 32px',
    background: 'white',
    color: '#0d9488',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 12,
  },
  recentActivity: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: 18,
    fontWeight: 700,
    color: '#0f766e',
  },
  activityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  activityLeaf: {
    fontSize: 16,
  },
  activityName: {
    flex: 1,
    fontSize: 14,
    color: '#1e293b',
  },
  activityStamps: {
    fontSize: 13,
    color: '#64748b',
  },
  activityFruit: {
    fontSize: 16,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  viewAnalyticsBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  searchBarWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'white',
    border: '1.5px solid #e2e8f0',
    borderRadius: 12,
    padding: '10px 14px',
    marginBottom: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  searchIcon: {
    fontSize: 14,
    opacity: 0.6,
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    fontSize: 14,
    color: '#1e293b',
    background: 'transparent',
  },
  searchClearBtn: {
    border: 'none',
    background: '#f1f5f9',
    color: '#64748b',
    width: 22,
    height: 22,
    borderRadius: '50%',
    fontSize: 11,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchEmptyText: {
    fontSize: 13.5,
    color: '#94a3b8',
    textAlign: 'center',
    padding: '24px 0',
  },
  customerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 16,
  },
  customerCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  customerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #0d9488, #14b8a6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: 20,
    fontWeight: 700,
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    margin: '0 0 4px 0',
    fontSize: 16,
    color: '#1e293b',
  },
  customerPhone: {
    margin: '0 0 8px 0',
    fontSize: 12,
    color: '#94a3b8',
  },
  stampRings: {
    display: 'flex',
    gap: 4,
    marginBottom: 4,
  },
  stampRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    transition: 'background 0.3s',
  },
  stampText: {
    margin: 0,
    fontSize: 12,
    color: '#64748b',
  },
  lastStampedText: {
    margin: '2px 0 0 0',
    fontSize: 11.5,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  fruitBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    marginTop: 4,
  },
  viewCardBtn: {
    padding: '8px 16px',
    background: '#f0fdf4',
    color: '#0d9488',
    border: '1px solid #a7f3d0',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  addBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  staffGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 16,
  },
  staffCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    display: 'flex',
    gap: 16,
    alignItems: 'center',
  },
  staffAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    background: '#e0f2fe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#0369a1',
    fontSize: 20,
    fontWeight: 700,
  },
  staffInfo: {
    flex: 1,
  },
  staffRole: {
    margin: '2px 0',
    fontSize: 12,
    color: '#64748b',
    textTransform: 'capitalize',
  },
  staffEmail: {
    margin: '2px 0',
    fontSize: 12,
    color: '#94a3b8',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    marginTop: 4,
  },
  programTab: {
    maxWidth: 1000,
    margin: '0 auto',
  },
  programCard: {
    background: 'white',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  programRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  programLabel: {
    fontSize: 14,
    color: '#64748b',
  },
  programValue: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1e293b',
  },
  editBtn: {
    width: '100%',
    padding: '12px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 16,
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    padding: 16,
  },
  modal: {
    background: 'white',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
  },
  loyaltyCard: {
    position:'relative',
    overflow:'hidden',
    borderRadius:22,
    padding:'28px 230px 28px 28px',
    minHeight:330,
    color:'white',
    boxShadow:'0 18px 45px rgba(0,0,0,.22)',
  },
  ownerCardQr:{position:'absolute',right:28,top:'50%',transform:'translateY(-50%)',width:170,background:'#fff',borderRadius:16,padding:9,boxShadow:'0 12px 30px rgba(0,0,0,.24)'},
  ownerCardQrImage:{display:'block',width:'100%',aspectRatio:'1 / 1'},
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.2)',
    paddingBottom: 12,
  },
  cardLogo: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'white',
    padding: 2,
    display: 'block',
  },
  cardBusiness: {
    fontSize: 16,
    fontWeight: 700,
  },
  cardBody: {
    textAlign: 'left',
  },
  cardName: {
    margin: '0 0 4px 0',
    fontSize: 20,
    fontWeight: 700,
  },
  cardId: {
    margin: '0 0 16px 0',
    fontSize: 11,
    opacity: 0.8,
  },
  cardStamps: {
    display: 'flex',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardStamp: {
    width: 28,
    height: 28,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: '#0d9488',
    fontWeight: 700,
  },
  cardProgress: {
    margin: '0 0 12px 0',
    fontSize: 13,
    opacity: 0.9,
  },
  cardReward: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    display: 'inline-block',
  },
  googleWalletBtn: {
    width: '100%',
    padding: '14px',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  appleWalletBtn: {
    width: '100%',
    padding: '14px',
    background: '#1c1c1e',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    marginBottom: 12,
    border: '2px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 16,
    boxSizing: 'border-box',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#64748b',
    marginBottom: 4,
    marginTop: 8,
  },
  submitBtn: {
    width: '100%',
    padding: '14px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  },
  setupKitPanel:{background:'#fff',border:'1px solid #99f6e4',borderRadius:18,padding:20,marginBottom:18},
  setupKitHeader:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap',marginBottom:16},
  setupKitEyebrow:{color:'#0d9488',fontWeight:900,letterSpacing:1},
  setupKitStatus:{background:'#ccfbf1',color:'#0f766e',padding:'6px 10px',borderRadius:999,fontSize:11,fontWeight:900,textTransform:'uppercase'},
  setupKitGrid:{display:'grid',gridTemplateColumns:'210px minmax(0,1fr)',gap:18},
  setupKitPreview:{background:'#f8fafc',borderRadius:14,padding:12,display:'flex',flexDirection:'column',alignItems:'center',gap:9},
  setupKitLogo:{maxWidth:145,maxHeight:65,objectFit:'contain'},
  setupKitQr:{width:165,height:165},
  setupKitTwoCol:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10},
  industryInsight:{display:'flex',gap:13,alignItems:'center',padding:'14px 16px',marginBottom:16,background:'#f8fffe',border:'1px solid #ccfbf1',borderRadius:14},
  industryInsightIcon:{width:42,height:42,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',fontSize:23,background:'#ecfdf5'},
  industryInsightLabel:{fontSize:10.5,fontWeight:900,textTransform:'uppercase',letterSpacing:.8,color:'#0d9488'},
  industryInsightTitle:{display:'block',fontSize:14,color:'#134e4a',marginTop:2},
  industryInsightText:{fontSize:12,color:'#64748b',marginTop:3,lineHeight:1.4},
}

export default OwnerDashboard

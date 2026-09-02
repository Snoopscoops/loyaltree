import React, { useState, useEffect, useRef } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { useLocation, useNavigate } from 'react-router-dom'

// Only shows the raw scan/debug panel in local dev - never in a production
// build, since it prints internal API paths and response codes on-screen.
const DEBUG = import.meta.env.DEV
const CASHIER_BUILD = 'HYBRID-V17-MEMBERSHIP-LOYALTY'
const BUSINESS_ICONS={spa:'🌿',salon:'✂️',fitness:'🏋️',restaurant:'🍽️',coffee:'☕',retail:'🛍️',clinic:'🩺',laundry:'🧺',gas_station:'⛽',car_wash:'🚿',pharmacy:'💊',bakery:'🥐',hotel:'🏨',other:'🏪',car_lending:'🚗',cockpit:'🏆'}

// Accept both the new direct Cashier URL and older Gift Card QR formats so
// existing Wallet passes keep working during migration.
function giftIdentifierFromScan(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const legacyToken = raw.match(/^LTGC:(gc_[A-Z0-9_-]+)$/i)
  if (legacyToken) return legacyToken[1]
  const legacyPath = raw.match(/\/gift(?:-scan)?\/([^/?#]+)/i)
  if (legacyPath) return legacyPath[1]
  if (/^GC-[A-Z0-9-]+$/i.test(raw)) return raw
  try {
    const url = new URL(raw)
    const queuedGift = String(url.searchParams.get('gift') || '').trim()
    if (queuedGift) return queuedGift
  } catch (_) {}
  return ''
}

function CashierApp({ API_BASE }) {
  const location = useLocation()
  const navigate = useNavigate()
  // When the owner taps "Scan Leaf" from their own dashboard, we're handed
  // their business slug and name via router state - they've already
  // authenticated as the business owner, so there's no reason to make them
  // fill out a separate cashier PIN login screen too.
  const ownerState = location.state?.ownerMode ? location.state : null
  const isOwner = !!ownerState
  const initialQuery = new URLSearchParams(location.search)
  const pendingNfcToken = initialQuery.get('nfc') || ''
  const nfcBusinessSlug = initialQuery.get('business') || ''
  const pendingGiftId = initialQuery.get('gift') || ''
  const hasPendingNfcTap = !!pendingNfcToken
  const hasPendingGiftScan = !!pendingGiftId

  // Keep a verified cashier signed in for this browser session only. This lets
  // the next Gift Card scan go straight to Redeem without asking for the same
  // credentials again. We never store the cashier PIN.
  const restoredCashierSession = (() => {
    if (ownerState) return null
    try {
      const raw = sessionStorage.getItem('loyaltree_cashier_session')
      if (!raw) return null
      const saved = JSON.parse(raw)
      if (!saved?.businessSlug || !saved?.sessionToken || !saved?.staffName) return null
      if (nfcBusinessSlug && saved.businessSlug !== nfcBusinessSlug) return null
      return saved
    } catch (_) {
      return null
    }
  })()

  const [scanResult, setScanResult] = useState(null)
  const [businessSlug, setBusinessSlug] = useState(ownerState?.businessSlug || nfcBusinessSlug || restoredCashierSession?.businessSlug || '')
  const [staffPin, setStaffPin] = useState('')
  const [staffEmail, setStaffEmail] = useState(restoredCashierSession?.staffEmail || '')
  // Session token from /staff/verify-pin - sent instead of the raw PIN on
  // every scan, so the PIN itself only crosses the wire once per shift.
  const [sessionToken, setSessionToken] = useState(ownerState?.ownerToken || restoredCashierSession?.sessionToken || '')
  const lastScanRef = useRef({ id: null, time: 0 })
  const lastNfcRef = useRef({ token: null, time: 0 })
  const [customerData, setCustomerData] = useState(null)
  const [giftCardData, setGiftCardData] = useState(null)
  const [giftRedeemAmount, setGiftRedeemAmount] = useState('')
  const [giftRedeemQuantity, setGiftRedeemQuantity] = useState('1')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualId, setManualId] = useState('')
  const [debugInfo, setDebugInfo] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [staffName, setStaffName] = useState(isOwner ? (ownerState?.ownerName || 'Owner') : (restoredCashierSession?.staffName || ''))
  const [saleAmount, setSaleAmount] = useState('')
  const [vipSaleAmount, setVipSaleAmount] = useState('')
  const [customSessionCount, setCustomSessionCount] = useState('')
  const [entrySource, setEntrySource] = useState(hasPendingGiftScan ? 'gift_qr' : (hasPendingNfcTap ? 'nfc' : 'qr'))

  useEffect(() => {
    if (!businessSlug || !staffName || (!isOwner && !staffPin && !sessionToken)) return
    if (customerData || giftCardData) return // #reader isn't mounted while a customer/gift card is showing

    const scanner = new Html5QrcodeScanner('reader', {
      qrbox: { width: 250, height: 250 },
      fps: 10,
    })

    scanner.render(onScanSuccess, onScanError)

    function onScanSuccess(decodedText) {
      const rawScan = decodedText.trim()
      // The QR inside Wallet opens the Cashier flow directly. Older LTGC and
      // /gift-scan formats remain accepted for already-issued Wallet passes.
      const giftId = giftIdentifierFromScan(rawScan)
      if (giftId) {
        const now = Date.now()
        if (lastScanRef.current.id === `gift:${giftId}` && now - lastScanRef.current.time < 3000) return
        lastScanRef.current = { id: `gift:${giftId}`, time: now }
        scanner.clear()
        setScanResult(giftId)
        fetchGiftCard(giftId)
        return
      }

      // Extract customer ID from URL if needed
      let customerId = rawScan

      // If it's a URL, extract the last path segment
      if (customerId.includes('/')) {
        const parts = customerId.split('/')
        customerId = parts[parts.length - 1]
      }

      // Remove any query params
      if (customerId.includes('?')) {
        customerId = customerId.split('?')[0]
      }

      // Remove any hash
      if (customerId.includes('#')) {
        customerId = customerId.split('#')[0]
      }

      // The scanner reads several frames a second, so the same code can
      // fire onScanSuccess many times before the reader is torn down below.
      // Without this guard a single hold-up-your-phone moment could add
      // more than one stamp.
      const now = Date.now()
      if (lastScanRef.current.id === customerId && now - lastScanRef.current.time < 3000) {
        return
      }
      lastScanRef.current = { id: customerId, time: now }

      scanner.clear()
      if (DEBUG) setDebugInfo('Scanned: ' + decodedText.substring(0, 30) + ' | ID: ' + customerId.substring(0, 20))
      setScanResult(customerId)
      fetchCustomer(customerId)
    }

    function onScanError(err) {
      // Silent - QR scanning has many false errors
    }

    return () => {
      scanner.clear().catch(() => {})
    }
  }, [businessSlug, staffPin, sessionToken, staffName, customerData, giftCardData, isOwner])

  // External NFC reader/native bridge hand-off. If the customer taps before
  // the cashier has logged in, the query stays in the URL; after verify-pin
  // succeeds this effect runs automatically and continues the pending tap.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nfcToken = params.get('nfc')
    if (!nfcToken || customerData || loading) return
    if (!businessSlug || !staffName) return

    // The NFC resolve endpoint deliberately requires a real cashier session.
    // Owner-mode QR scanning is still supported, but owner NFC should later be
    // wired through an authenticated native reader rather than bypassing auth.
    if (!sessionToken) return

    const source = params.get('nfc_source') || 'terminal'
    resolveNfcToken(nfcToken, source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, businessSlug, staffName, sessionToken, customerData])

  // NFC itself is read by a Smart Tap/VAS terminal or native reader.
  // That reader can open /scanner?business=<business-slug>&nfc=<token>&nfc_source=google_wallet|apple_wallet.
  // Once the cashier has logged in, we resolve that signed token to the same
  // customer public_id the existing QR flow already understands.
  const resolveNfcToken = async (token, source = 'terminal') => {
    if (!token || !businessSlug || !sessionToken) return

    const now = Date.now()
    if (lastNfcRef.current.token === token && now - lastNfcRef.current.time < 3000) return
    lastNfcRef.current = { token, time: now }

    setLoading(true)
    setMessage('Reading NFC member…')
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/nfc/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ token, source }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.customer_public_id) {
        throw new Error(data.detail || 'Could not identify NFC member')
      }

      setEntrySource('nfc')
      setScanResult(data.customer_public_id)
      // Remove the one-time NFC payload from the address bar before loading
      // the customer, so Reset/refresh cannot accidentally resolve it again.
      navigate('/scanner', { replace: true })
      await fetchCustomer(data.customer_public_id)
    } catch (err) {
      setMessage(`❌ ${err.message || 'NFC read failed'}`)
    }
    setLoading(false)
  }

  const fetchCustomer = async (customerId) => {
    setLoading(true)
    setMessage('')
    const url = `${API_BASE}/api/v1/customer/${customerId}?_=${Date.now()}`
    if (DEBUG) setDebugInfo(prev => prev + ' | URL: ' + url.replace(API_BASE, ''))

    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (DEBUG) setDebugInfo(prev => prev + ' | Status: ' + res.status)

      if (res.ok) {
        const data = await res.json()
        const c = data.customer || {}

        const scannedBusinessSlug = data.business?.public_id || null

        // The scanned customer's business is authoritative. A stale cashier
        // login/localStorage businessSlug must never turn a VIP, Membership,
        // or Multi-Pass customer back into Stamp.
        if (businessSlug && scannedBusinessSlug && businessSlug !== scannedBusinessSlug) {
          throw new Error(
            `This customer belongs to ${data.business?.name || 'another business'}. Please log in to the correct cashier account.`
          )
        }

        // Use the same program object returned with the scanned customer.
        // This is the exact source already used successfully by the Points flow.
        const program = data.program || {}
        const allowedCardTypes = ['stamp', 'points', 'membership', 'vip', 'multipass', 'hybrid']
        // The saved loyalty program is authoritative for Hybrid. This prevents
        // any stale/legacy current_card_type value from making a Points-based
        // Hybrid card fall through to the Stamp UI.
        const returnedCardType = program.card_type === 'hybrid'
          ? 'hybrid'
          : (data.current_card_type || program.card_type)

        if (!allowedCardTypes.includes(returnedCardType)) {
          throw new Error(
            `The server returned no valid card type. Current: ${data.current_card_type || 'none'}; Program: ${program.card_type || 'none'}`
          )
        }

        const cardType = returnedCardType
        const goal = program.stamp_goal || 8
        let membershipBenefitState = { benefits: [], membership_name: program.membership_name || 'Membership' }
        if (cardType === 'membership' || cardType === 'hybrid') {
          try {
            const benefitRes = await fetch(`${API_BASE}/api/v1/business/${scannedBusinessSlug || businessSlug}/customers/${c.public_id}/membership-benefits`, { cache:'no-store' })
            const benefitData = await benefitRes.json().catch(() => ({}))
            if (benefitRes.ok) membershipBenefitState = benefitData
          } catch (_) {}
        }

        if (DEBUG) {
          setDebugInfo(prev =>
            `${prev} | Cashier program: ${program.card_type} | Final: ${cardType}`
          )
        }
        setCustomerData({
          public_id: c.public_id,
          name: c.name,
          phone: c.phone,
          business_name: data.business?.name || '',
          business_type: data.business?.business_type || 'other',
          card_type: cardType,
          hybrid_loyalty_type: program.hybrid_loyalty_type === 'stamp' ? 'stamp' : 'points',
          stamp_count: c.stamp_count || 0,
          reward_unlocked: !!c.reward_unlocked,
          reward_threshold: goal,
          points_balance: c.points_balance || 0,
          points_prizes: Array.isArray(program.points_prizes) ? program.points_prizes : [],
          // Rate used to preview how many points a sale amount will earn,
          // before the cashier taps "Add Points" - same formula the backend
          // uses in /points-sale (amount_spent / points_amount_pesos * points_per_amount).
          points_per_amount: program.points_per_amount || 0,
          points_amount_pesos: program.points_amount_pesos || 1,
          points_cap_limit: program.points_cap_limit || null,
          active_coupon: data.active_coupon || null,
          // Multipass fields - sessions_remaining/total come off the customer
          // row, session_count/validity_days are the program's defaults for
          // when a fresh pack is issued.
          sessions_remaining: c.multipass_sessions_remaining || 0,
          sessions_total: c.multipass_total_sessions || 0,
          multipass_expires_at: c.multipass_expires_at || null,
          multipass_session_count: program.multipass_session_count || 12,
          multipass_validity_days: program.multipass_validity_days || 90,
          multipass_description: program.description || '',
          membership_status: c.membership_effective_status || c.membership_status || 'inactive',
          membership_start_date: c.membership_start_date || null,
          membership_expires_at: c.membership_expires_at || null,
          membership_name: membershipBenefitState.membership_name || program.membership_name || program.card_name || 'Membership',
          membership_services: Array.isArray(program.membership_services) ? program.membership_services : [],
          membership_benefits: Array.isArray(membershipBenefitState.benefits) ? membershipBenefitState.benefits : [],
          membership_description: program.description || '',
          membership_visit_logging_enabled: program.membership_visit_logging_enabled !== false,
          membership_quick_checkin: !!program.membership_quick_checkin,
          vip_points: c.vip_points || 0,
          vip_tier: c.vip_tier || null,
          vip_next_tier: c.vip_next_tier || null,
          vip_points_per_amount: program.vip_points_per_amount || 0,
          vip_amount_pesos: program.vip_amount_pesos || 1,
        })
        setMessage(`Found: ${c.name}`)
      } else {
        const errorData = await res.json().catch(() => ({}))
        setMessage(`Not found: ${customerId.substring(0, 12)}...`)
        if (DEBUG) setDebugInfo(prev => prev + ' | Error: ' + (errorData.detail || 'Unknown'))
      }
    } catch (err) {
      setMessage(`❌ ${err.message || 'Could not load customer card'}`)
      if (DEBUG) setDebugInfo(prev => prev + ` | Error: ${err.message || 'unknown'}`)
    }
    setLoading(false)
  }

  const addStamp = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) {
      setMessage('Missing info - scan again')
      return
    }
    setLoading(true)
    setMessage('Adding stamp...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/stamp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Preferred: session token from verify-pin, so the PIN itself
          // never has to be resent. Falls back to sending the raw PIN in
          // the body only if the backend hasn't issued a token yet.
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        let msg = `✅ Stamp added! ${customerData.name} now has ${data.stamp_count} stamps`
        if (data.reward_unlocked) {
          msg += ' 🎉 REWARD UNLOCKED!'
        }
        if (data.warning) {
          msg += ` (${data.warning})`
        }
        setMessage(msg)
        setCustomerData(prev => prev ? {
          ...prev,
          stamp_count: data.stamp_count,
          reward_unlocked: !!data.reward_unlocked,
          active_coupon: data.active_coupon !== undefined ? data.active_coupon : prev.active_coupon,
        } : prev)
      } else {
        setMessage(`❌ Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      setMessage('❌ Network error - stamp not added')
    }
    setLoading(false)
  }

  const addPoints = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) {
      setMessage('Missing info - scan again')
      return
    }
    const amount = parseFloat(saleAmount)
    if (!amount || amount <= 0) {
      setMessage('Enter an amount spent first')
      return
    }
    setLoading(true)
    setMessage('Adding points...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/points-sale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          amount_spent: amount,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        const capNote = data.points_cap_limit
          ? (data.cap_reached
              ? ` · Cap reached (${Number(data.points_cap_limit).toLocaleString()} pts)`
              : ` · Cap ${Number(data.points_cap_limit).toLocaleString()} pts`)
          : ''
        const limitedNote = data.points_discarded > 0
          ? ` · ${data.points_discarded} pts not added because of the cap`
          : ''
        setMessage(
          data.points_earned > 0
            ? `✅ +${data.points_earned} points! ${customerData.name} now has ${data.points_balance} points${capNote}${limitedNote}`
            : `ℹ️ ${customerData.name} is already at the points cap. Balance remains ${data.points_balance} points.`
        )
        setCustomerData(prev => prev ? {
          ...prev,
          points_balance: data.points_balance,
          points_cap_limit: data.points_cap_limit ?? prev.points_cap_limit,
          active_coupon: data.active_coupon !== undefined ? data.active_coupon : prev.active_coupon,
        } : prev)
        setSaleAmount('')
      } else {
        setMessage(`❌ Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      setMessage('❌ Network error - points not added')
    }
    setLoading(false)
  }


  const recordVipPurchase = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) {
      setMessage('Missing info - scan again')
      return
    }
    const amount = parseFloat(vipSaleAmount)
    if (!amount || amount <= 0) {
      setMessage('Enter a purchase amount first')
      return
    }

    setLoading(true)
    setMessage('Adding VIP points...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/vip-sale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          amount_spent: amount,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'VIP sale failed')

      setCustomerData(prev => prev ? {
        ...prev,
        vip_points: data.vip_points,
        vip_tier: data.tier,
        vip_next_tier: data.next_tier,
        active_coupon: data.active_coupon !== undefined ? data.active_coupon : prev.active_coupon,
      } : prev)
      setVipSaleAmount('')

      setMessage(
        data.upgraded
          ? `🎉 ${customerData.name} upgraded to ${data.tier.name}! +${data.points_earned} VIP points`
          : `✅ ₱${Number(data.amount_spent || amount).toLocaleString()} recorded · +${data.points_earned} VIP points · ${data.vip_points} total`
      )
    } catch (err) {
      setMessage(`❌ ${err.message}`)
    }
    setLoading(false)
  }

  const logMembershipVisit = async () => {
    if (!customerData || !businessSlug) return
    if (customerData.membership_visit_logging_enabled === false) {
      setMessage('Membership visit logging is disabled by the business owner')
      return
    }
    const serviceName = customerData.membership_quick_checkin
      ? null
      : window.prompt('Visit or service', customerData.membership_services?.[0] || 'Member check-in')
    if (!customerData.membership_quick_checkin && !serviceName) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/membership/note`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          service_name: serviceName || null,
          entry_source: entrySource === 'nfc' ? 'nfc' : 'qr',
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not log visit')
      setMessage(entrySource === 'nfc' ? `✅ NFC activity logged for ${customerData.name}` : `✅ Visit logged for ${customerData.name}`)
    } catch (err) {
      setMessage(`❌ ${err.message}`)
    }
    setLoading(false)
  }

  const refreshMembershipBenefits = async () => {
    if (!customerData?.public_id || !businessSlug) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/customers/${customerData.public_id}/membership-benefits`, {cache:'no-store'})
      const data = await res.json().catch(() => ({}))
      if (res.ok) setCustomerData(prev => prev ? {...prev, membership_name:data.membership_name||prev.membership_name, membership_benefits:Array.isArray(data.benefits)?data.benefits:[]} : prev)
    } catch (_) {}
  }

  const redeemMembershipBenefit = async (benefit) => {
    if (!customerData || !businessSlug || !benefit?.id) return
    if (!['active','lifetime'].includes(customerData.membership_status)) {
      setMessage(`❌ Membership is ${customerData.membership_status}`); return
    }
    const ok = window.confirm(`Redeem “${benefit.name}” for ${customerData.name}?`)
    if (!ok) return
    setLoading(true)
    try {
      const idempotencyKey = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/membership-benefit/redeem`, {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Idempotency-Key':idempotencyKey,...(sessionToken?{Authorization:`Bearer ${sessionToken}`}:{})},
        body:JSON.stringify({customer_public_id:customerData.public_id,benefit_id:benefit.id,quantity:1,...(sessionToken?{}:{staff_pin:staffPin}),as_owner:isOwner}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not redeem benefit')
      setCustomerData(prev => prev ? {...prev,membership_benefits:Array.isArray(data.benefits)?data.benefits:prev.membership_benefits} : prev)
      setMessage(`✅ ${benefit.name} redeemed for ${customerData.name}`)
    } catch (err) { setMessage(`❌ ${err.message}`) }
    setLoading(false)
  }

  const useMultipassSession = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) {
      setMessage('Missing info - scan again')
      return
    }
    setLoading(true)
    setMessage('Using session...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/multipass/use`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        let msg = `✅ Session used! ${customerData.name} has ${data.sessions_remaining} sessions left`
        if (data.sessions_remaining === 0) msg += ' 🎉 Pass complete!'
        setMessage(msg)
        setCustomerData(prev => prev ? {
          ...prev,
          sessions_remaining: data.sessions_remaining,
          sessions_total: data.sessions_total,
          active_coupon: data.active_coupon !== undefined ? data.active_coupon : prev.active_coupon,
        } : prev)
      } else {
        setMessage(`❌ ${data.detail || 'Could not use session'}`)
      }
    } catch (err) {
      setMessage('❌ Network error - session not used')
    }
    setLoading(false)
  }

  const issueMultipass = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) {
      setMessage('Missing info - scan again')
      return
    }
    const overrideCount = customSessionCount ? parseInt(customSessionCount, 10) : null
    if (customSessionCount && (!overrideCount || overrideCount < 1)) {
      setMessage('Enter a valid session count')
      return
    }
    if (customerData.sessions_remaining > 0) {
      const ok = window.confirm(
        `${customerData.name} still has ${customerData.sessions_remaining} sessions left on their current pass. Issue a new pack anyway? This replaces the old one.`
      )
      if (!ok) return
    }
    setLoading(true)
    setMessage('Issuing pack...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/multipass/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          ...(overrideCount ? { session_count: overrideCount } : {}),
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`✅ ${data.sessions_remaining}-session pack issued! Valid until ${data.multipass_expires_at}`)
        setCustomerData(prev => prev ? {
          ...prev,
          sessions_remaining: data.sessions_remaining,
          sessions_total: data.sessions_total,
          multipass_expires_at: data.multipass_expires_at,
        } : prev)
        setCustomSessionCount('')
      } else {
        setMessage(`❌ Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      setMessage('❌ Network error - pack not issued')
    }
    setLoading(false)
  }

  const redeemReward = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) return
    setLoading(true)
    setMessage('Redeeming...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/reward/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        setMessage('🎁 Reward redeemed!')
        fetchCustomer(customerData.public_id)
      } else {
        setMessage(`❌ ${data.detail || 'No reward to redeem'}`)
      }
    } catch (err) {
      setMessage('❌ Network error')
    }
    setLoading(false)
  }

  const redeemPrize = async (prize) => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) return
    if (customerData.points_balance < prize.points_cost) return
    setLoading(true)
    setMessage(`Redeeming ${prize.name}...`)

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/points-redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          prize_id: prize.id,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        setMessage(`🎁 ${data.prize_name} redeemed! ${customerData.name} now has ${data.points_balance} points`)
        setCustomerData(prev => prev ? {
          ...prev,
          points_balance: data.points_balance,
        } : prev)
      } else {
        setMessage(`❌ ${data.detail || 'Could not redeem prize'}`)
      }
    } catch (err) {
      setMessage('❌ Network error - prize not redeemed')
    }
    setLoading(false)
  }

  const redeemCoupon = async () => {
    if (!customerData || !businessSlug || (!isOwner && !staffPin && !sessionToken)) return
    setLoading(true)
    setMessage('Redeeming coupon...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/coupon/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        })
      })

      const data = await res.json()

      if (res.ok) {
        setMessage('🎟️ Coupon redeemed!')
        fetchCustomer(customerData.public_id)
      } else {
        setMessage(`❌ ${data.detail || 'No coupon to redeem'}`)
      }
    } catch (err) {
      setMessage('❌ Network error')
    }
    setLoading(false)
  }

  const fetchGiftCard = async (identifier) => {
    if (!identifier || !businessSlug || !sessionToken) {
      setMessage('Cashier login is required before opening a Gift Card')
      return
    }
    setLoading(true); setMessage('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/gift-cards/${encodeURIComponent(identifier)}/cashier`, {
        headers: { Authorization: `Bearer ${sessionToken}` }, cache: 'no-store'
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403) {
        try { sessionStorage.removeItem('loyaltree_cashier_session') } catch (_) {}
        setSessionToken('')
        setStaffName('')
        throw new Error('Cashier session expired. Please log in again.')
      }
      if (!res.ok || !data.gift_card) throw new Error(data.detail || 'Gift Card not found')
      setCustomerData(null)
    setGiftCardData(null)
    setGiftRedeemAmount('')
    setGiftRedeemQuantity('1')
      setGiftCardData(data.gift_card)
      setMessage(`🎁 ${data.gift_card.name || 'Gift Card'} found`)
    } catch (err) {
      setGiftCardData(null)
      setMessage(`❌ ${err.message || 'Could not load Gift Card'}`)
    }
    setLoading(false)
  }

  // Wallet QR URLs open /cashier?business=<slug>&gift=<gift-id>.
  // If the cashier is already authenticated, load it immediately. If not,
  // the login form is pre-filled with the correct business and this effect
  // continues automatically after authentication.
  useEffect(() => {
    if (!pendingGiftId || giftCardData || customerData || loading) return
    if (!businessSlug || !staffName || !sessionToken) return

    const dedupeKey = `gift-route:${pendingGiftId}`
    if (lastScanRef.current.id === dedupeKey) return
    lastScanRef.current = { id: dedupeKey, time: Date.now() }
    setEntrySource('gift_qr')

    fetchGiftCard(pendingGiftId).finally(() => {
      navigate('/cashier', { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGiftId, businessSlug, staffName, sessionToken, giftCardData, customerData])

  // USB/2D scanners usually operate as a HID keyboard: they type the QR value
  // very quickly and finish with Enter. Capture only fast bursts so normal
  // human typing in the cashier screen is not mistaken for a scan.
  useEffect(() => {
    if (!businessSlug || !staffName || !sessionToken || customerData || giftCardData) return

    let buffer = ''
    let startedAt = 0
    let lastAt = 0

    const resetBuffer = () => {
      buffer = ''
      startedAt = 0
      lastAt = 0
    }

    const handleUsbScannerKey = (event) => {
      const now = Date.now()

      if (event.key === 'Enter') {
        const raw = buffer.trim()
        const elapsed = startedAt ? Math.max(1, lastAt - startedAt) : 99999
        const avgMs = raw.length ? elapsed / raw.length : 99999
        resetBuffer()

        // A scanner burst is normally much faster than manual typing.
        if (raw.length < 6 || avgMs > 80) return

        const giftIdentifier = giftIdentifierFromScan(raw)

        if (giftIdentifier) {
          const dedupeKey = `gift:${giftIdentifier}`
          if (lastScanRef.current.id === dedupeKey && now - lastScanRef.current.time < 3000) return
          lastScanRef.current = { id: dedupeKey, time: now }
          setEntrySource('gift_qr')
          setScanResult(giftIdentifier)
          fetchGiftCard(giftIdentifier)
          event.preventDefault()
          return
        }

        let customerId = raw
        try {
          if (/^https?:\/\//i.test(customerId)) {
            const u = new URL(customerId)
            customerId = u.pathname.split('/').filter(Boolean).pop() || ''
          }
        } catch (_) {}
        customerId = customerId.split('?')[0].split('#')[0].trim()
        if (!customerId) return

        if (lastScanRef.current.id === customerId && now - lastScanRef.current.time < 3000) return
        lastScanRef.current = { id: customerId, time: now }
        setEntrySource('qr')
        setScanResult(customerId)
        fetchCustomer(customerId)
        event.preventDefault()
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      if (!startedAt || now - lastAt > 120) {
        buffer = ''
        startedAt = now
      }
      buffer += event.key
      lastAt = now
    }

    window.addEventListener('keydown', handleUsbScannerKey, true)
    return () => window.removeEventListener('keydown', handleUsbScannerKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessSlug, staffName, sessionToken, customerData, giftCardData])


  const markGiftCardSold = async () => {
    if (!giftCardData || !businessSlug || !sessionToken) return
    setLoading(true); setMessage('Marking Gift Card sold/issued…')
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/gift-cards/${giftCardData.public_id}/activate`, { method:'POST', headers:{ Authorization:`Bearer ${sessionToken}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not mark Gift Card sold/issued')
      setGiftCardData(data.gift_card || data)
      setMessage('✅ Gift Card sold/issued. Recipient can now claim and add it to Wallet.')
    } catch (err) { setMessage(`❌ ${err.message || 'Issue failed'}`) }
    setLoading(false)
  }

  const redeemGiftCard = async () => {
    if (!giftCardData || !businessSlug || !sessionToken) return
    const isAmount = giftCardData.gift_type === 'amount'
    const amount = Number(giftRedeemAmount || 0)
    const quantity = Number(giftRedeemQuantity || 0)
    if (isAmount && amount <= 0) return setMessage('Enter the peso amount to redeem')
    if (!isAmount && quantity <= 0) return setMessage('Enter the quantity to redeem')
    const label = isAmount ? `₱${amount.toLocaleString()}` : `${quantity} ${giftCardData.item_name || 'item'}${quantity === 1 ? '' : 's'}`
    if (!window.confirm(`Redeem ${label} from ${giftCardData.code}?`)) return
    setLoading(true); setMessage('Redeeming Gift Card…')
    const idem = `gift-${giftCardData.public_id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/gift-cards/${giftCardData.public_id}/redeem`, {
        method:'POST', headers:{ Authorization:`Bearer ${sessionToken}`, 'Content-Type':'application/json', 'X-Idempotency-Key': idem },
        body:JSON.stringify(isAmount ? { amount } : { quantity })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Redemption failed')
      setGiftCardData(data.gift_card || giftCardData)
      setGiftRedeemAmount(''); setGiftRedeemQuantity('1')
      setMessage(`✅ ${label} redeemed successfully`)
      await fetchGiftCard(giftCardData.public_id)
    } catch (err) { setMessage(`❌ ${err.message || 'Redemption failed'}`) }
    setLoading(false)
  }

  const resetScan = () => {
    setScanResult(null)
    setCustomerData(null)
    setGiftCardData(null)
    setGiftRedeemAmount('')
    setGiftRedeemQuantity('1')
    setShowManual(false)
    setManualId('')
    setMessage('')
    setDebugInfo('')
    setSaleAmount('')
    setVipSaleAmount('')
    setCustomSessionCount('')
    setEntrySource('qr')
  }

  const verifyPinAndStart = async () => {
    if (!businessSlug || !staffEmail || !staffPin) {
      setMessage('Enter Business ID, email, and PIN')
      return
    }
    const cleanSlug = businessSlug.trim()
    const cleanEmail = staffEmail.trim()
    const cleanPin = staffPin.trim()
    setVerifying(true)
    setMessage('')
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${cleanSlug}/staff/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, pin: cleanPin })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setBusinessSlug(cleanSlug)
        // If the backend issued a session token, keep it and stop holding
        // onto the raw PIN - it's only sent once, right here.
        const verifiedName = data.name || 'Staff'
        if (data.session_token) {
          setSessionToken(data.session_token)
          setStaffPin('')
          try {
            sessionStorage.setItem('loyaltree_cashier_session', JSON.stringify({
              businessSlug: cleanSlug,
              staffEmail: cleanEmail,
              staffName: verifiedName,
              sessionToken: data.session_token,
            }))
          } catch (_) {}
        } else {
          // Legacy fallback remains supported, but never persist a raw PIN.
          setStaffPin(cleanPin)
        }
        setStaffName(verifiedName)
        setMessage('')
      } else {
        setMessage(data.detail || 'Invalid email or PIN for this business')
      }
    } catch (err) {
      setMessage('Network error - could not verify PIN')
    }
    setVerifying(false)
  }

  // Login screen (skipped entirely for the owner - they already authenticated
  // on the dashboard, so there's no PIN to collect here)
  if (!isOwner && (!businessSlug || (!staffPin && !sessionToken) || !staffName)) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.logo}>🌳</div>
          <h2 style={styles.title}>Cashier</h2>
          <p style={styles.subtitle}>Scan leaves, grow rewards</p>

          <input
            style={styles.input}
            placeholder="Business ID (from URL)"
            value={businessSlug}
            onChange={e => setBusinessSlug(e.target.value)}
            readOnly={hasPendingNfcTap || hasPendingGiftScan}
            title={hasPendingNfcTap ? 'Business is locked to the NFC terminal that initiated this tap' : hasPendingGiftScan ? 'Business is locked to the Gift Card that was scanned' : undefined}
          />
          <input
            style={styles.input}
            placeholder="Your Email"
            type="email"
            autoComplete="username"
            value={staffEmail}
            onChange={e => setStaffEmail(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Staff PIN"
            type="password"
            autoComplete="current-password"
            value={staffPin}
            onChange={e => setStaffPin(e.target.value)}
          />

          {message && <div style={styles.errorBox}>{message}</div>}

          <button
            style={styles.btn}
            onClick={verifyPinAndStart}
            disabled={!businessSlug || !staffEmail || !staffPin || verifying}
          >
            {verifying ? 'Checking...' : hasPendingNfcTap ? 'Authenticate NFC Tap 📡' : hasPendingGiftScan ? 'Login & Redeem Gift Card 🎁' : 'Start Scanning 🍃'}
          </button>

          <p style={styles.hint}>{hasPendingNfcTap ? 'NFC tap pending. Enter your cashier email and PIN to identify the member. No visit is recorded until you confirm Log NFC Activity.' : hasPendingGiftScan ? 'Gift Card ready. Log in with the same cashier email and PIN, then enter the amount or quantity and tap Redeem.' : 'Ask the business owner for the Business ID, your email, and your PIN — shown on their "Your Team" tab'}</p>
        </div>
      </div>
    )
  }

  // Live preview of how many points the current saleAmount will earn, using
  // the same formula the backend applies in /points-sale - lets the cashier
  // (and customer) see the conversion before tapping "Add Points" instead of
  // only finding out afterward.
  const previewPoints = (() => {
    if (!customerData || !(customerData.card_type === 'points' || (customerData.card_type === 'hybrid' && customerData.hybrid_loyalty_type === 'points'))) return 0
    const amount = parseFloat(saleAmount)
    if (!amount || amount <= 0) return 0
    const rate = customerData.points_per_amount || 0
    const pesos = customerData.points_amount_pesos || 1
    const raw = Math.floor((amount / pesos) * rate)
    const cap = Number(customerData.points_cap_limit || 0)
    if (!cap) return raw
    const remaining = Math.max(cap - Number(customerData.points_balance || 0), 0)
    return Math.min(raw, remaining)
  })()

  const previewVipPoints = (() => {
    if (!customerData || customerData.card_type !== 'vip') return 0
    const amount = parseFloat(vipSaleAmount)
    if (!amount || amount <= 0) return 0
    const rate = customerData.vip_points_per_amount || 0
    const pesos = customerData.vip_amount_pesos || 1
    return Math.floor((amount / pesos) * rate)
  })()

  const isHybrid = customerData?.card_type === 'hybrid'
  const hybridLoyaltyType = customerData?.hybrid_loyalty_type === 'stamp' ? 'stamp' : 'points'
  const usesPoints = customerData?.card_type === 'points' || (isHybrid && hybridLoyaltyType === 'points')
  const usesStamps = customerData?.card_type === 'stamp' || (isHybrid && hybridLoyaltyType === 'stamp')
  const hasMembership = customerData?.card_type === 'membership' || isHybrid
  const canLogMembershipVisit = hasMembership && customerData?.membership_visit_logging_enabled !== false

  const cardExperience = isHybrid
    ? {
        accent: '#0d9488',
        soft: '#f0fdfa',
        border: '#99f6e4',
        icon: '✨',
        label: `Hybrid Card · Membership + ${hybridLoyaltyType === 'points' ? 'Points' : 'Stamps'}`,
        actionTitle: 'Membership & Loyalty Actions',
      }
    : customerData?.card_type === 'points'
    ? {
        accent: '#2563eb',
        soft: '#eff6ff',
        border: '#bfdbfe',
        icon: '💎',
        label: 'Points Card',
        actionTitle: 'Record Purchase & Add Points',
      }
    : customerData?.card_type === 'membership'
    ? {
        accent: '#18181b',
        soft: '#fafaf9',
        border: '#d6d3d1',
        icon: '🏋️',
        label: 'Membership Card',
        actionTitle: 'Verify Access & Log Visit',
      }
    : customerData?.card_type === 'multipass'
    ? {
        accent: '#7c3aed',
        soft: '#f5f3ff',
        border: '#ddd6fe',
        icon: '🎫',
        label: 'Multi-Pass',
        actionTitle: 'Use or Issue Sessions',
      }
    : customerData?.card_type === 'vip'
    ? {
        accent: '#ca8a04',
        soft: '#fefce8',
        border: '#fde68a',
        icon: '👑',
        label: 'VIP Card',
        actionTitle: 'Enter Amount Spent & Earn VIP Points',
      }
    : {
        accent: '#0d9488',
        soft: '#f0fdfa',
        border: '#99f6e4',
        icon: '🎟️',
        label: 'Stamp Card',
        actionTitle: 'Add Stamp',
      }

  const isMultipassExpired = !!(
    customerData?.card_type === 'multipass' &&
    customerData.multipass_expires_at &&
    customerData.multipass_expires_at < new Date().toISOString().slice(0, 10)
  )

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerBrand}>
          <span style={styles.headerLogo}>🌳</span>
          <div>
            <span style={styles.headerTitle}>
              {isOwner ? 'Card Scanner' : 'Cashier Scanner'}{staffName ? ` · ${staffName}` : ''}
            </span>
            <div style={{fontSize: 9, color: '#94a3b8', marginTop: 2}}>
              {CASHIER_BUILD}
            </div>
          </div>
        </div>
        <button style={styles.resetBtn} onClick={() => {
          if (isOwner) {
            navigate('/dashboard')
            return
          }
          try { sessionStorage.removeItem('loyaltree_cashier_session') } catch (_) {}
          setBusinessSlug('')
          setStaffPin('')
          setStaffEmail('')
          setSessionToken('')
          setStaffName('')
          resetScan()
        }}>
          {isOwner ? '← Dashboard' : 'Switch'}
        </button>
      </header>

      {/* Message Area */}
      {message && (
        <div style={message.includes('✅') || message.includes('🎉') ? styles.successToast : styles.errorToast}>
          {message}
        </div>
      )}

      {/* Debug Info (small text for troubleshooting) - dev builds only */}
      {DEBUG && debugInfo && (
        <div style={styles.debugBox}>{debugInfo}</div>
      )}

      {/* Scanner or Customer Card */}
      {giftCardData ? (
        <div style={styles.giftCardPanel}>
          <div style={styles.giftHero}>
            <div style={styles.giftEyebrow}>🎁 GIFT CARD</div>
            <h2 style={styles.giftTitle}>{giftCardData.name || 'Gift Card'}</h2>
            <div style={styles.giftCode}>{giftCardData.code}</div>
            <div style={styles.giftBalanceLabel}>REMAINING</div>
            <div style={styles.giftBalance}>{giftCardData.gift_type === 'amount' ? `₱${Number(giftCardData.remaining_amount || 0).toLocaleString('en-PH',{maximumFractionDigits:2})}` : `${giftCardData.remaining_quantity || 0} / ${giftCardData.original_quantity || 0}`}</div>
            {giftCardData.gift_type === 'item' && <div style={styles.giftItem}>{giftCardData.item_name}</div>}
          </div>
          <div style={styles.giftStatusRow}><span>Status</span><b>{['active_claimed','partially_redeemed'].includes(giftCardData.status) ? 'READY TO REDEEM' : String(giftCardData.status || '').replaceAll('_',' ').toUpperCase()}</b></div>{giftCardData.wallet_platform&&<div style={styles.giftStatusRow}><span>Wallet</span><b>{String(giftCardData.wallet_platform).toUpperCase()} · BOUND</b></div>}
          {giftCardData.status === 'unactivated' ? (
            <div style={styles.giftActionBox}><p style={styles.scanHint}>This is unsold printed inventory. After receiving payment, mark this exact serial as sold/issued. The recipient must then claim it and bind one Wallet before it becomes spendable.</p><button style={styles.giftActivateBtn} disabled={loading} onClick={markGiftCardSold}>{loading?'Saving…':'Mark Sold / Issue'}</button></div>
          ) : giftCardData.status === 'issued_unclaimed' ? (
            <div style={styles.giftActionBox}><p style={styles.scanHint}>This Gift Card has been issued but not claimed yet. Ask the recipient to scan its QR, claim it, and add it to Apple Wallet or Google Wallet.</p></div>
          ) : giftCardData.status === 'claimed_pending_wallet' ? (
            <div style={styles.giftActionBox}><p style={styles.scanHint}>The Gift Card has been claimed, but Wallet binding is not complete yet. It cannot be redeemed until the claimant selects and opens their Wallet pass.</p></div>
          ) : ['active_claimed','partially_redeemed'].includes(giftCardData.status) ? (
            <div style={styles.giftActionBox}>
              {giftCardData.gift_type === 'amount' ? <input style={styles.input} type="number" min="0.01" step="0.01" placeholder="Amount to redeem (₱)" value={giftRedeemAmount} onChange={e=>setGiftRedeemAmount(e.target.value)} /> : <div><div style={{fontWeight:800,marginBottom:7}}>Quantity to redeem</div><input style={styles.input} type="number" min="1" max={giftCardData.remaining_quantity || 1} value={giftRedeemQuantity} onChange={e=>setGiftRedeemQuantity(e.target.value)} /></div>}
              <button style={styles.giftRedeemBtn} disabled={loading} onClick={redeemGiftCard}>{loading?'Processing…':'Redeem Now'}</button>
            </div>
          ) : <div style={styles.giftClosed}>This Gift Card can no longer be redeemed.</div>}
          {!!giftCardData.redemptions?.length && <div style={styles.giftHistory}><b>Recent redemptions</b>{giftCardData.redemptions.slice(0,6).map((r,i)=><div key={r.id||i} style={styles.giftHistoryRow}><span>{r.redeemed_at ? new Date(r.redeemed_at).toLocaleString() : 'Redemption'}</span><b>{giftCardData.gift_type==='amount'?`-₱${Number(r.amount||0).toLocaleString()}`:`-${r.quantity||0}`}</b></div>)}</div>}
          <button style={styles.scanAgainBtn} onClick={resetScan}>🔄 Scan Next</button>
        </div>
      ) : !customerData ? (
        <div style={styles.scanSection}>
          <div style={styles.scanCard}>
            <h3 style={styles.scanTitle}>📷 Scan Customer or Gift Card</h3>
            <div id="reader" style={styles.reader}></div>
            <p style={styles.scanHint}>Scan any LoyaltyTree loyalty card or Gift Card QR with the camera or a USB 2D scanner.</p>

            <button style={styles.manualBtn} onClick={() => setShowManual(true)}>
              ✏️ Enter ID Manually
            </button>
          </div>

          {showManual && (
            <div style={styles.manualCard}>
              <h4>Manual Entry</h4>
              <input
                style={styles.input}
                placeholder="Customer ID or Gift Card code"
                value={manualId}
                onChange={e => setManualId(e.target.value)}
              />
              <button style={styles.btn} onClick={() => {
                if (!manualId) return
                const raw = manualId.trim()
                const giftIdentifier = giftIdentifierFromScan(raw)
                giftIdentifier ? fetchGiftCard(giftIdentifier) : fetchCustomer(raw)
              }}>
                Find Card
              </button>
              <button style={styles.backBtn} onClick={() => setShowManual(false)}>
                Back
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={styles.customerCard}>
          {/* Customer Info */}
          <div style={{
            ...styles.customerHeader,
            background: cardExperience.soft,
            border: `1px solid ${cardExperience.border}`,
            borderRadius: 16,
            padding: 14,
          }}>
            <div style={{
              ...styles.customerAvatar,
              background: cardExperience.accent,
            }}>{customerData.name?.[0]?.toUpperCase()}</div>
            <div style={{flex: 1}}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 800,
                color: cardExperience.accent,
                textTransform: 'uppercase',
                letterSpacing: .5,
                marginBottom: 4,
              }}>
                {cardExperience.icon} {cardExperience.label} · {BUSINESS_ICONS[customerData.business_type] || '🏪'}
              </div>
              <h3 style={styles.customerName}>{customerData.name}</h3>
              <p style={styles.customerMeta}>
                {customerData.card_type === 'hybrid'
                  ? `${customerData.membership_status.toUpperCase()}${customerData.membership_expires_at ? ` • until ${customerData.membership_expires_at}` : ''} • ${hybridLoyaltyType === 'points' ? `${customerData.points_balance} points` : `${customerData.stamp_count}/${customerData.reward_threshold} stamps`}`
                  : customerData.card_type === 'points'
                  ? `${customerData.points_balance} points`
                  : customerData.card_type === 'multipass'
                  ? `${customerData.sessions_remaining}/${customerData.sessions_total} sessions left`
                  : customerData.card_type === 'vip'
                  ? `${customerData.vip_tier?.name || 'VIP'} · ${customerData.vip_points || 0} points`
                  : customerData.card_type === 'membership'
                  ? `${customerData.membership_status.toUpperCase()}${customerData.membership_expires_at ? ` • until ${customerData.membership_expires_at}` : ''}`
                  : `${customerData.stamp_count} rings • ${customerData.reward_threshold - (customerData.stamp_count % customerData.reward_threshold)} to fruit`}
              </p>
            </div>
          </div>

          <div style={{
            margin: '10px 0 2px',
            padding: '7px 10px',
            borderRadius: 8,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            color: '#475569',
            fontSize: 11,
            fontWeight: 800,
            textAlign: 'center',
          }}>
            SERVER CARD TYPE: {String(customerData.card_type || 'none').toUpperCase()}
          </div>

          {customerData.card_type === 'hybrid' ? (
            <>
              <div style={{
                ...styles.pointsBalanceBox,
                background: ['active','lifetime'].includes(customerData.membership_status) ? '#dcfce7' : '#fee2e2',
                marginBottom: 10,
              }}>
                <span style={{...styles.pointsBalanceNumber,fontSize:26}}>
                  {customerData.membership_status.toUpperCase()}
                </span>
                <span style={styles.pointsBalanceLabel}>
                  {customerData.membership_status === 'lifetime'
                    ? 'Lifetime membership'
                    : customerData.membership_expires_at
                    ? `Membership until ${customerData.membership_expires_at}`
                    : 'No active membership'}
                </span>
              </div>
              {hybridLoyaltyType === 'points' ? (
                <>
                  <div style={styles.pointsBalanceBox}>
                    <span style={styles.pointsBalanceNumber}>{customerData.points_balance}</span>
                    <span style={styles.pointsBalanceLabel}>points</span>
                    {customerData.points_cap_limit && <span style={{...styles.pointsBalanceLabel,marginTop:4}}>Maximum balance: {Number(customerData.points_cap_limit).toLocaleString()} pts</span>}
                  </div>
                  {customerData.points_prizes?.length > 0 && (
                    <div style={styles.prizeList}>
                      {customerData.points_prizes.map(prize => {
                        const affordable = customerData.points_balance >= prize.points_cost
                        return <div key={prize.id} style={{...styles.prizeRow,opacity:affordable?1:.5}}>
                          <div><div style={styles.prizeName}>{prize.name}</div><div style={styles.prizeCost}>{prize.points_cost} pts</div></div>
                          <button style={{...styles.prizeRedeemBtn,background:affordable?'#2563eb':'#cbd5e1',cursor:affordable?'pointer':'not-allowed'}} disabled={!affordable||loading} onClick={()=>redeemPointsPrize(prize)}>Redeem</button>
                        </div>
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div style={styles.stampVisual}>
                  {Array.from({length:customerData.reward_threshold||8}).map((_,i)=><div key={i} style={{...styles.stampDot,background:i<(customerData.stamp_count%(customerData.reward_threshold||8))?'#0d9488':'#e2e8f0'}}>{i<(customerData.stamp_count%(customerData.reward_threshold||8))?'🍃':''}</div>)}
                </div>
              )}
              {customerData.membership_benefits?.length > 0 && <div style={{margin:'14px 0'}}>
                <div style={{fontSize:12,fontWeight:900,color:'#334155',marginBottom:8}}>MEMBER BENEFITS · {customerData.membership_name}</div>
                <div style={styles.prizeList}>
                  {customerData.membership_benefits.map(benefit => {
                    const remaining = benefit.remaining_in_window
                    const rule = remaining == null ? 'Unlimited' : `${remaining} remaining`
                    const next = benefit.next_available_at ? ` · resets ${new Date(benefit.next_available_at).toLocaleString()}` : ''
                    return <div key={benefit.id} style={{...styles.prizeRow,opacity:benefit.available?1:.58}}>
                      <div style={{minWidth:0}}><div style={styles.prizeName}>{benefit.name}</div><div style={styles.prizeCost}>{benefit.available?rule:(benefit.unavailable_reason||'Unavailable')}{next}</div></div>
                      <button style={{...styles.prizeRedeemBtn,background:benefit.available?'#0d9488':'#cbd5e1',cursor:benefit.available?'pointer':'not-allowed'}} disabled={!benefit.available||loading} onClick={()=>redeemMembershipBenefit(benefit)}>{benefit.benefit_type?.includes('discount')?'Apply':'Redeem'}</button>
                    </div>
                  })}
                </div>
              </div>}
            </>
          ) : customerData.card_type === 'points' ? (
            <>
              {/* Points Balance */}
              <div style={styles.pointsBalanceBox}>
                <span style={styles.pointsBalanceNumber}>{customerData.points_balance}</span>
                <span style={styles.pointsBalanceLabel}>points</span>
                {customerData.points_cap_limit && (
                  <span style={{ ...styles.pointsBalanceLabel, marginTop: 4 }}>
                    Maximum balance: {Number(customerData.points_cap_limit).toLocaleString()} pts
                  </span>
                )}
              </div>

              {/* Prize catalog - every prize is listed, greyed out and
                  unclickable until the customer's balance covers it. */}
              {customerData.points_prizes?.length > 0 && (
                <div style={styles.prizeList}>
                  {customerData.points_prizes.map(prize => {
                    const affordable = customerData.points_balance >= prize.points_cost
                    return (
                      <div key={prize.id} style={{ ...styles.prizeRow, opacity: affordable ? 1 : 0.5 }}>
                        <div>
                          <div style={styles.prizeName}>{prize.name}</div>
                          <div style={styles.prizeCost}>{prize.points_cost} pts</div>
                        </div>
                        <button
                          style={{
                            ...styles.prizeRedeemBtn,
                            ...(affordable ? {} : styles.prizeRedeemBtnDisabled),
                          }}
                          onClick={() => redeemPrize(prize)}
                          disabled={loading || !affordable}
                        >
                          {loading ? '...' : '🎁 Redeem'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : customerData.card_type === 'multipass' ? (
            <>
              {/* Sessions Balance */}
              <div style={styles.pointsBalanceBox}>
                <span style={styles.pointsBalanceNumber}>{customerData.sessions_remaining}</span>
                <span style={styles.pointsBalanceLabel}>of {customerData.sessions_total} sessions left</span>
              </div>

              {customerData.multipass_description && (
                <p style={styles.multipassDescription}>{customerData.multipass_description}</p>
              )}

              {customerData.multipass_expires_at && (
                <p style={styles.multipassExpiry}>
                  {isMultipassExpired ? '⏰ Expired' : 'Valid until'} {customerData.multipass_expires_at}
                </p>
              )}
            </>
          ) : customerData.card_type === 'vip' ? (
            <><div style={styles.pointsBalanceBox}><span style={{...styles.pointsBalanceNumber,fontSize:28}}>👑 {customerData.vip_tier?.name||'VIP'}</span><span style={styles.pointsBalanceLabel}>{customerData.vip_points||0} VIP points</span></div>{(customerData.vip_tier?.benefits||[]).map((b,i)=><div key={i} style={{fontSize:13,color:'#475569'}}>✓ {b}</div>)}</>
          ) : customerData.card_type === 'membership' ? (
            <>
              <div style={{
                ...styles.pointsBalanceBox,
                background: ['active','lifetime'].includes(customerData.membership_status) ? '#dcfce7' : '#fee2e2'
              }}>
                <span style={{...styles.pointsBalanceNumber, fontSize: 28}}>
                  {customerData.membership_status.toUpperCase()}
                </span>
                <span style={styles.pointsBalanceLabel}>
                  {customerData.membership_status === 'lifetime'
                    ? 'Lifetime access'
                    : customerData.membership_expires_at
                    ? `Active until ${customerData.membership_expires_at}`
                    : 'No active subscription'}
                </span>
              </div>
              {customerData.membership_benefits?.length > 0 && (
                <div style={{margin:'14px 0'}}>
                  <div style={{fontSize:12,fontWeight:900,color:'#334155',marginBottom:8}}>MEMBER BENEFITS · {customerData.membership_name}</div>
                  <div style={styles.prizeList}>{customerData.membership_benefits.map(benefit => <div key={benefit.id} style={{...styles.prizeRow,opacity:benefit.available?1:.58}}>
                    <div><div style={styles.prizeName}>{benefit.name}</div><div style={styles.prizeCost}>{benefit.remaining_in_window==null?'Unlimited':`${benefit.remaining_in_window} remaining`}{benefit.unavailable_reason?` · ${benefit.unavailable_reason}`:''}</div></div>
                    <button style={{...styles.prizeRedeemBtn,background:benefit.available?'#0d9488':'#cbd5e1'}} disabled={!benefit.available||loading} onClick={()=>redeemMembershipBenefit(benefit)}>{benefit.benefit_type?.includes('discount')?'Apply':'Redeem'}</button>
                  </div>)}</div>
                </div>
              )}
            </>
          ) : (
            /* Stamp Rings */
            <div style={styles.stampVisual}>
              {Array.from({length: customerData.reward_threshold || 8}).map((_, i) => (
                <div key={i} style={{
                  ...styles.stampDot,
                  background: i < (customerData.stamp_count % (customerData.reward_threshold || 8)) ? '#0d9488' : '#e2e8f0',
                }}>
                  {i < (customerData.stamp_count % (customerData.reward_threshold || 8)) ? '🍃' : ''}
                </div>
              ))}
            </div>
          )}

          {/* Reward Banner (stamp cards only) */}
          {usesStamps && customerData.reward_unlocked && (
            <div style={styles.rewardBanner}>
              <span style={styles.rewardEmoji}>🍎</span>
              <span style={styles.rewardText}>Fruit Ready!</span>
            </div>
          )}

          {/* Multipass status banners */}
          {customerData.card_type === 'multipass' && isMultipassExpired && (
            <div style={{...styles.rewardBanner, background: '#fee2e2'}}>
              <span style={styles.rewardEmoji}>⏰</span>
              <span style={{...styles.rewardText, color: '#991b1b'}}>Pass expired - issue a new one</span>
            </div>
          )}
          {customerData.card_type === 'multipass' && !isMultipassExpired && customerData.sessions_remaining <= 0 && (
            <div style={styles.rewardBanner}>
              <span style={styles.rewardEmoji}>🎉</span>
              <span style={styles.rewardText}>All sessions used!</span>
            </div>
          )}

          {/* Coupon Banner */}
          {customerData.active_coupon && (
            <div style={{...styles.rewardBanner, background: '#f0fdfa', border: '1.5px dashed #0d9488'}}>
              <span style={styles.rewardEmoji}>🎟️</span>
              <span style={{...styles.rewardText, color: '#0f766e'}}>{customerData.active_coupon.reward_text}</span>
            </div>
          )}

          {/* Card-specific transaction */}
          <div style={{
            margin: '18px 0 10px',
            fontSize: 13,
            fontWeight: 850,
            color: cardExperience.accent,
            textTransform: 'uppercase',
            letterSpacing: .5,
          }}>
            {cardExperience.actionTitle}
          </div>

          {/* Actions */}
          {usesPoints ? (
            <div style={styles.pointsSaleSection}>
              <div style={styles.pointsSaleRow}>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="Amount spent (₱)"
                  value={saleAmount}
                  onChange={e => setSaleAmount(e.target.value)}
                  style={styles.pointsSaleInput}
                />
                <button
                  style={{...styles.actionBtn, background: '#0d9488', flex: 'none', padding: '14px 20px'}}
                  onClick={addPoints}
                  disabled={loading || !saleAmount}
                >
                  {loading ? '...' : '💎 Record Sale'}
                </button>
              </div>
              {saleAmount && (
                <p style={styles.pointsPreview}>
                  {previewPoints > 0
                    ? `= +${previewPoints} point${previewPoints === 1 ? '' : 's'}`
                    : 'Enter a valid amount'}
                </p>
              )}
            </div>
          ) : null}
          {customerData.card_type === 'vip' ? (
            <div style={{
              ...styles.pointsSaleSection,
              background: '#fefce8',
              border: '1px solid #fde68a',
            }}>
              <div style={styles.pointsSaleRow}>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="Purchase amount (₱)"
                  value={vipSaleAmount}
                  onChange={e => setVipSaleAmount(e.target.value)}
                  style={styles.pointsSaleInput}
                />
                <button
                  style={{
                    ...styles.actionBtn,
                    background: '#ca8a04',
                    flex: 'none',
                    padding: '14px 20px',
                  }}
                  onClick={recordVipPurchase}
                  disabled={loading || !vipSaleAmount}
                >
                  {loading ? '...' : '👑 Add VIP Points'}
                </button>
              </div>
              {vipSaleAmount && (
                <p style={styles.pointsPreview}>
                  {previewVipPoints > 0
                    ? `₱${Number(vipSaleAmount).toLocaleString()} earns +${previewVipPoints} VIP point${previewVipPoints === 1 ? '' : 's'}`
                    : 'Enter a purchase amount to preview VIP points'}
                </p>
              )}
              <p style={styles.pointsPreview}>
                Earning rule: {customerData.vip_points_per_amount} VIP points for every ₱{customerData.vip_amount_pesos} spent
              </p>
              {customerData.vip_next_tier && (
                <p style={styles.pointsPreview}>
                  Next tier: {customerData.vip_next_tier.name} at {customerData.vip_next_tier.threshold} VIP points
                </p>
              )}
            </div>
          ) : null}
          {customerData.card_type === 'multipass' ? (
            <div style={styles.pointsSaleSection}>
              <div style={styles.pointsSaleRow}>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  placeholder={`Sessions (default ${customerData.multipass_session_count})`}
                  value={customSessionCount}
                  onChange={e => setCustomSessionCount(e.target.value)}
                  style={styles.pointsSaleInput}
                />
                <button
                  style={{...styles.actionBtn, background: '#1a73e8', flex: 'none', padding: '14px 20px'}}
                  onClick={issueMultipass}
                  disabled={loading}
                >
                  {loading ? '...' : '🎫 Issue Pack'}
                </button>
              </div>
              <p style={styles.pointsPreview}>Leave blank to use the default pack size and validity.</p>
            </div>
          ) : null}
          <div style={styles.actions}>
            {usesStamps && (
              <button
                style={{...styles.actionBtn, background: '#0d9488'}}
                onClick={addStamp}
                disabled={loading}
              >
                {loading ? '...' : '🎟️ Add Stamp'}
              </button>
            )}
            {canLogMembershipVisit && (
              <button
                style={{...styles.actionBtn, background: '#0d9488'}}
                onClick={logMembershipVisit}
                disabled={loading || !['active','lifetime'].includes(customerData.membership_status)}
              >
                {loading ? '...' : entrySource === 'nfc' ? '📡 Log NFC Activity' : '🏋️ Check In Member'}
              </button>
            )}
            {canLogMembershipVisit && !['active','lifetime'].includes(customerData.membership_status) && (
              <div style={{width: '100%', color: '#991b1b', fontWeight: 700, textAlign: 'center'}}>
                Access denied — membership is {customerData.membership_status}.
              </div>
            )}
            {customerData.card_type === 'multipass' && (
              <button
                style={{...styles.actionBtn, background: '#0d9488'}}
                onClick={useMultipassSession}
                disabled={loading || isMultipassExpired || customerData.sessions_remaining <= 0}
              >
                {loading ? '...' : '🎫 Use One Session'}
              </button>
            )}
            {usesStamps && customerData.reward_unlocked && (
              <button
                style={{...styles.actionBtn, background: '#f59e0b'}}
                onClick={redeemReward}
                disabled={loading}
              >
                {loading ? '...' : '🍎 Harvest'}
              </button>
            )}
            {customerData.active_coupon && (
              <button
                style={{...styles.actionBtn, background: '#0d9488'}}
                onClick={redeemCoupon}
                disabled={loading}
              >
                {loading ? '...' : '🎟️ Redeem'}
              </button>
            )}
          </div>

          <button style={styles.scanAgainBtn} onClick={resetScan}>
            🔄 Scan Next
          </button>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(13,148,136,0.1)',
  },
  headerBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerLogo: {
    fontSize: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f766e',
  },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 12,
    color: '#64748b',
    cursor: 'pointer',
  },
  loginCard: {
    maxWidth: 360,
    margin: '60px auto',
    padding: 32,
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    textAlign: 'center',
  },
  logo: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    margin: '0 0 4px 0',
    fontSize: 22,
    fontWeight: 700,
    color: '#0f766e',
  },
  subtitle: {
    margin: '0 0 20px 0',
    fontSize: 14,
    color: '#64748b',
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    marginBottom: 12,
    border: '2px solid #e2e8f0',
    borderRadius: 12,
    fontSize: 16,
    boxSizing: 'border-box',
    WebkitTextSizeAdjust: '100%',
  },
  btn: {
    width: '100%',
    padding: '14px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 12,
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  successToast: {
    margin: '12px 16px',
    padding: '14px 16px',
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'center',
  },
  errorToast: {
    margin: '12px 16px',
    padding: '14px 16px',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'center',
  },
  debugBox: {
    margin: '4px 16px',
    padding: '6px 10px',
    background: '#f1f5f9',
    color: '#64748b',
    borderRadius: 6,
    fontSize: 10,
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  scanSection: {
    padding: 16,
    maxWidth: 500,
    margin: '0 auto',
  },
  scanCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    textAlign: 'center',
  },
  scanTitle: {
    margin: '0 0 12px 0',
    fontSize: 18,
    color: '#0f766e',
  },
  reader: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  scanHint: {
    margin: '8px 0 0 0',
    fontSize: 13,
    color: '#94a3b8',
  },
  manualBtn: {
    marginTop: 12,
    padding: '10px 20px',
    background: '#f0fdf4',
    color: '#0d9488',
    border: '1px solid #a7f3d0',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  manualCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    marginTop: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  backBtn: {
    width: '100%',
    padding: '12px',
    background: 'transparent',
    color: '#64748b',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 8,
  },
  customerCard: {
    maxWidth: 420,
    margin: '12px auto',
    padding: 20,
    background: 'white',
    borderRadius: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  customerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid #f1f5f9',
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
  customerName: {
    margin: '0 0 2px 0',
    fontSize: 18,
    color: '#1e293b',
  },
  customerMeta: {
    margin: 0,
    fontSize: 13,
    color: '#64748b',
  },
  stampVisual: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: 6,
    marginBottom: 16,
  },
  pointsBalanceBox: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    padding: '18px 0',
    marginBottom: 16,
    background: '#f0fdfa',
    borderRadius: 12,
  },
  pointsBalanceNumber: {
    fontSize: 34,
    fontWeight: 800,
    color: '#0f766e',
  },
  pointsBalanceLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0d9488',
  },
  pointsSaleSection: {
    marginBottom: 12,
  },
  pointsSaleRow: {
    display: 'flex',
    gap: 10,
  },
  pointsPreview: {
    margin: '6px 2px 0',
    fontSize: 13,
    fontWeight: 600,
    color: '#0f766e',
  },
  pointsSaleInput: {
    flex: 1,
    padding: '14px 16px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
  },
  multipassDescription: {
    textAlign: 'center',
    fontSize: 13.5,
    color: '#475569',
    margin: '0 0 12px',
  },
  multipassExpiry: {
    textAlign: 'center',
    fontSize: 12.5,
    color: '#94a3b8',
    margin: '0 0 12px',
  },
  prizeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 16,
  },
  prizeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: '#f8fafc',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
  },
  prizeName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
  },
  prizeCost: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  prizeRedeemBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#f59e0b',
    color: 'white',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  prizeRedeemBtnDisabled: {
    background: '#cbd5e1',
    cursor: 'not-allowed',
  },
  stampDot: {
    aspectRatio: '1',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
  },
  rewardBanner: {
    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
    borderRadius: 10,
    padding: 12,
    textAlign: 'center',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rewardEmoji: {
    fontSize: 20,
  },
  rewardText: {
    fontSize: 15,
    fontWeight: 700,
    color: '#92400e',
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginBottom: 12,
  },
  actionBtn: {
    flex: 1,
    padding: '14px',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  giftCardPanel:{maxWidth:560,margin:'20px auto',padding:'0 16px 28px'},
  giftHero:{background:'linear-gradient(135deg,#0d9488,#0f766e)',color:'#fff',borderRadius:22,padding:22,boxShadow:'0 18px 45px rgba(15,118,110,.18)'},
  giftEyebrow:{fontSize:11,fontWeight:900,letterSpacing:1.4,opacity:.8},
  giftTitle:{margin:'7px 0 2px',fontSize:25},giftCode:{fontFamily:'monospace',fontSize:12,opacity:.75},
  giftBalanceLabel:{fontSize:10,fontWeight:900,letterSpacing:1.2,marginTop:20,opacity:.75},giftBalance:{fontSize:38,fontWeight:900,marginTop:2},giftItem:{fontSize:13,opacity:.85,marginTop:2},
  giftStatusRow:{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#fff',border:'1px solid #dbe7e5',borderRadius:13,padding:'13px 14px',marginTop:12,fontSize:12,color:'#475569'},
  giftActionBox:{background:'#fff',border:'1px solid #dbe7e5',borderRadius:16,padding:16,marginTop:12},giftActivateBtn:{width:'100%',padding:14,border:0,borderRadius:11,background:'#0f172a',color:'#fff',fontSize:15,fontWeight:800,cursor:'pointer'},giftRedeemBtn:{width:'100%',padding:14,border:0,borderRadius:11,background:'#0d9488',color:'#fff',fontSize:15,fontWeight:800,cursor:'pointer',marginTop:10},
  giftClosed:{padding:15,borderRadius:13,background:'#f1f5f9',color:'#64748b',textAlign:'center',marginTop:12,fontWeight:700},giftHistory:{background:'#fff',border:'1px solid #dbe7e5',borderRadius:14,padding:14,marginTop:12,fontSize:12},giftHistoryRow:{display:'flex',justifyContent:'space-between',gap:12,padding:'8px 0',borderBottom:'1px solid #f1f5f9',color:'#64748b'},
  scanAgainBtn: {
    width: '100%',
    padding: '12px',
    background: '#f1f5f9',
    color: '#64748b',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default CashierApp

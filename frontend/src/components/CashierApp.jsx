import React, { useState, useEffect, useRef } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import { useLocation, useNavigate } from 'react-router-dom'

// Only shows the raw scan/debug panel in local dev - never in a production
// build, since it prints internal API paths and response codes on-screen.
const DEBUG = import.meta.env.DEV

function CashierApp({ API_BASE }) {
  const location = useLocation()
  const navigate = useNavigate()
  // When the owner taps "Scan Leaf" from their own dashboard, we're handed
  // their business slug and name via router state - they've already
  // authenticated as the business owner, so there's no reason to make them
  // fill out a separate cashier PIN login screen too.
  const ownerState = location.state?.ownerMode ? location.state : null
  const isOwner = !!ownerState

  const [scanResult, setScanResult] = useState(null)
  const [businessSlug, setBusinessSlug] = useState(ownerState?.businessSlug || '')
  const [staffPin, setStaffPin] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  // Session token from /staff/verify-pin - sent instead of the raw PIN on
  // every scan, so the PIN itself only crosses the wire once per shift.
  const [sessionToken, setSessionToken] = useState('')
  const lastScanRef = useRef({ id: null, time: 0 })
  const [customerData, setCustomerData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualId, setManualId] = useState('')
  const [debugInfo, setDebugInfo] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [staffName, setStaffName] = useState(isOwner ? (ownerState?.ownerName || 'Owner') : '')
  const [saleAmount, setSaleAmount] = useState('')
  const [customSessionCount, setCustomSessionCount] = useState('')

  useEffect(() => {
    if (!businessSlug || !staffName || (!isOwner && !staffPin && !sessionToken)) return
    if (customerData) return // #reader isn't mounted while the customer card is showing

    const scanner = new Html5QrcodeScanner('reader', {
      qrbox: { width: 250, height: 250 },
      fps: 10,
    })

    scanner.render(onScanSuccess, onScanError)

    function onScanSuccess(decodedText) {
      // Extract customer ID from URL if needed
      let customerId = decodedText.trim()

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
  }, [businessSlug, staffPin, sessionToken, staffName, customerData, isOwner])

  const fetchCustomer = async (customerId) => {
    setLoading(true)
    setMessage('')
    const url = `${API_BASE}/api/v1/customer/${customerId}`
    if (DEBUG) setDebugInfo(prev => prev + ' | URL: ' + url.replace(API_BASE, ''))

    try {
      const res = await fetch(url)
      if (DEBUG) setDebugInfo(prev => prev + ' | Status: ' + res.status)

      if (res.ok) {
        const data = await res.json()
        const c = data.customer || {}
        const program = data.program || {}
        const goal = program.stamp_goal || 8
        const cardType = program.card_type === 'points'
          ? 'points'
          : program.card_type === 'multipass'
          ? 'multipass'
          : program.card_type === 'membership'
          ? 'membership'
          : program.card_type === 'vip'
          ? 'vip'
          : 'stamp'
        setCustomerData({
          public_id: c.public_id,
          name: c.name,
          phone: c.phone,
          card_type: cardType,
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
          membership_services: Array.isArray(program.membership_services) ? program.membership_services : [],
          membership_description: program.description || '',
          vip_points: c.vip_points || 0, vip_tier: c.vip_tier || null, vip_next_tier: c.vip_next_tier || null,
        })
        setMessage(`Found: ${c.name}`)
      } else {
        const errorData = await res.json().catch(() => ({}))
        setMessage(`Not found: ${customerId.substring(0, 12)}...`)
        if (DEBUG) setDebugInfo(prev => prev + ' | Error: ' + (errorData.detail || 'Unknown'))
      }
    } catch (err) {
      setMessage('Network error - check connection')
      if (DEBUG) setDebugInfo(prev => prev + ' | Network Error')
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
        setMessage(`✅ +${data.points_earned} points! ${customerData.name} now has ${data.points_balance} points`)
        setCustomerData(prev => prev ? {
          ...prev,
          points_balance: data.points_balance,
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
    const amount = Number(window.prompt('Purchase amount (₱)', '0')); if (!amount || amount <= 0) return; setLoading(true)
    try { const res=await fetch(`${API_BASE}/api/v1/business/${businessSlug}/vip-sale`,{method:'POST',headers:{'Content-Type':'application/json',...(sessionToken?{Authorization:`Bearer ${sessionToken}`}:{})},body:JSON.stringify({customer_public_id:customerData.public_id,amount_spent:amount,...(sessionToken?{}:{staff_pin:staffPin}),as_owner:isOwner})}); const d=await res.json(); if(!res.ok) throw new Error(d.detail||'VIP sale failed'); setCustomerData({...customerData,vip_points:d.vip_points,vip_tier:d.tier,vip_next_tier:d.next_tier}); setMessage(d.upgraded?`🎉 Upgraded to ${d.tier.name}!`:`✅ ${d.points_earned} VIP points added`) } catch(e){setMessage(`❌ ${e.message}`)} setLoading(false)
  }

  const logMembershipVisit = async () => {
    if (!customerData || !businessSlug) return
    const serviceName = window.prompt(
      'Visit or service',
      customerData.membership_services?.[0] || 'Member check-in'
    )
    if (!serviceName) return
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
          service_name: serviceName,
          ...(sessionToken ? {} : { staff_pin: staffPin }),
          as_owner: isOwner,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not log visit')
      setMessage(`✅ Visit logged for ${customerData.name}`)
    } catch (err) {
      setMessage(`❌ ${err.message}`)
    }
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

  const resetScan = () => {
    setScanResult(null)
    setCustomerData(null)
    setShowManual(false)
    setManualId('')
    setMessage('')
    setDebugInfo('')
    setSaleAmount('')
    setCustomSessionCount('')
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
        if (data.session_token) {
          setSessionToken(data.session_token)
          setStaffPin('')
        } else {
          setStaffPin(cleanPin)
        }
        setStaffName(data.name || 'Staff')
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
            {verifying ? 'Checking...' : 'Start Scanning 🍃'}
          </button>

          <p style={styles.hint}>Ask the business owner for the Business ID, your email, and your PIN — shown on their "Your Team" tab</p>
        </div>
      </div>
    )
  }

  // Live preview of how many points the current saleAmount will earn, using
  // the same formula the backend applies in /points-sale - lets the cashier
  // (and customer) see the conversion before tapping "Add Points" instead of
  // only finding out afterward.
  const previewPoints = (() => {
    if (!customerData || customerData.card_type !== 'points') return 0
    const amount = parseFloat(saleAmount)
    if (!amount || amount <= 0) return 0
    const rate = customerData.points_per_amount || 0
    const pesos = customerData.points_amount_pesos || 1
    return Math.floor((amount / pesos) * rate)
  })()

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
          <span style={styles.headerTitle}>{isOwner ? 'Scan Leaf' : 'Cashier'}{staffName ? ` · ${staffName}` : ''}</span>
        </div>
        <button style={styles.resetBtn} onClick={() => {
          if (isOwner) {
            navigate('/dashboard')
            return
          }
          setBusinessSlug('')
          setStaffPin('')
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
      {!customerData ? (
        <div style={styles.scanSection}>
          <div style={styles.scanCard}>
            <h3 style={styles.scanTitle}>🍃 Scan Customer QR</h3>
            <div id="reader" style={styles.reader}></div>
            <p style={styles.scanHint}>Point camera at customer QR code</p>

            <button style={styles.manualBtn} onClick={() => setShowManual(true)}>
              ✏️ Enter ID Manually
            </button>
          </div>

          {showManual && (
            <div style={styles.manualCard}>
              <h4>Manual Entry</h4>
              <input
                style={styles.input}
                placeholder="Customer ID"
                value={manualId}
                onChange={e => setManualId(e.target.value)}
              />
              <button style={styles.btn} onClick={() => {
                if (manualId) fetchCustomer(manualId)
              }}>
                Find Customer
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
          <div style={styles.customerHeader}>
            <div style={styles.customerAvatar}>{customerData.name?.[0]?.toUpperCase()}</div>
            <div>
              <h3 style={styles.customerName}>{customerData.name}</h3>
              <p style={styles.customerMeta}>
                {customerData.card_type === 'points'
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

          {customerData.card_type === 'points' ? (
            <>
              {/* Points Balance */}
              <div style={styles.pointsBalanceBox}>
                <span style={styles.pointsBalanceNumber}>{customerData.points_balance}</span>
                <span style={styles.pointsBalanceLabel}>points</span>
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
                    ? `Valid until ${customerData.membership_expires_at}`
                    : 'No active subscription'}
                </span>
              </div>
              {customerData.membership_services?.length > 0 && (
                <div style={{margin: '12px 0', color: '#475569', fontSize: 13}}>
                  {customerData.membership_services.map((s, i) => <div key={i}>✓ {s}</div>)}
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
          {customerData.card_type === 'stamp' && customerData.reward_unlocked && (
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

          {/* Actions */}
          {customerData.card_type === 'points' ? (
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
                  {loading ? '...' : '💎 Add Points'}
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
            {customerData.card_type === 'stamp' && (
              <button
                style={{...styles.actionBtn, background: '#0d9488'}}
                onClick={addStamp}
                disabled={loading}
              >
                {loading ? '...' : '🍃 Add Ring'}
              </button>
            )}
            {customerData.card_type === 'vip' && (<button style={{...styles.actionBtn,background:'#ca8a04'}} onClick={recordVipPurchase} disabled={loading}>{loading?'...':'👑 Record VIP Purchase'}</button>)}
            {customerData.card_type === 'membership' && (
              <button
                style={{...styles.actionBtn, background: '#0d9488'}}
                onClick={logMembershipVisit}
                disabled={loading || !['active','lifetime'].includes(customerData.membership_status)}
              >
                {loading ? '...' : '✅ Log Visit'}
              </button>
            )}
            {customerData.card_type === 'membership' && !['active','lifetime'].includes(customerData.membership_status) && (
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
                {loading ? '...' : '✅ Use Session'}
              </button>
            )}
            {customerData.card_type === 'stamp' && customerData.reward_unlocked && (
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

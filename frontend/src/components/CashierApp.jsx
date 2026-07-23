import React, { useState, useEffect } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'

function CashierApp({ API_BASE, user }) {
  const [scanResult, setScanResult] = useState(null)
  const [customer, setCustomer] = useState(null)
  const [transactionId, setTransactionId] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('reader', {
      qrbox: { width: 250, height: 250 },
      fps: 5,
    })
    scanner.render(onScanSuccess, onScanFailure)
    return () => scanner.clear()
  }, [])

  const onScanSuccess = async (decodedText) => {
    setScanResult(decodedText)
    try {
      const res = await fetch(`${API_BASE}/api/v1/customer/${decodedText}/profile`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await res.json()
      setCustomer(data)
      setMessage('')
    } catch (err) {
      setMessage('Customer not found')
    }
  }

  const onScanFailure = (error) => {
    // ignore scan failures (user still aiming)
  }

  const addStamp = async (e) => {
    e.preventDefault()
    if (!transactionId) {
      setMessage('Enter transaction ID')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/stamp/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.token}` },
        body: JSON.stringify({
          customer_id: customer.id,
          transaction_id: transactionId,
          amount: parseFloat(amount) || 0
        })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage(`✅ Stamp added! ${data.stamps_current}/${data.stamps_needed} stamps`)
        setCustomer({ ...customer, stamp_count: data.stamps_current, reward_unlocked: data.reward_unlocked })
        setTransactionId('')
        setAmount('')
      } else {
        setMessage(`❌ ${data.detail || 'Failed'}`)
      }
    } catch (err) {
      setMessage('❌ Network error')
    }
    setLoading(false)
  }

  const redeemReward = async () => {
    if (!window.confirm('Confirm reward redemption?')) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/reward/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.token}` },
        body: JSON.stringify({ customer_id: customer.id })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage(`🎉 Reward redeemed! Customer has ${data.stamps_remaining} stamps remaining`)
        setCustomer({ ...customer, stamp_count: data.stamps_remaining, reward_unlocked: false })
      } else {
        setMessage(`❌ ${data.detail || 'Failed'}`)
      }
    } catch (err) {
      setMessage('❌ Network error')
    }
    setLoading(false)
  }

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
      <h1>🎯 Cashier Scanner</h1>

      {!customer && (
        <div id="reader" style={{ width: '100%', marginBottom: 20 }}></div>
      )}

      {customer && (
        <div style={{ padding: 20, background: '#f8f9fa', borderRadius: 10, marginBottom: 20 }}>
          <h2>{customer.name}</h2>
          <p style={{ color: '#666' }}>{customer.phone}</p>
          <div style={{ fontSize: 48, textAlign: 'center', margin: '20px 0', color: '#2d6a4f' }}>
            {customer.stamp_count || 0} <span style={{ fontSize: 24, color: '#666' }}>/ {customer.reward_threshold || 8}</span>
          </div>

          {customer.reward_unlocked && (
            <div style={{ padding: 15, background: '#d4edda', borderRadius: 8, marginBottom: 15, textAlign: 'center' }}>
              <strong>🎉 Reward Unlocked!</strong>
              <button onClick={redeemReward} disabled={loading} style={{ display: 'block', width: '100%', marginTop: 10, padding: 12, background: '#28a745', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                {loading ? 'Processing...' : 'Redeem Reward'}
              </button>
            </div>
          )}

          <form onSubmit={addStamp}>
            <input
              placeholder="Transaction ID"
              value={transactionId}
              onChange={e => setTransactionId(e.target.value)}
              style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
            
            />
            <input
              placeholder="Amount ($)"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
            />
            <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
              {loading ? 'Adding...' : '➕ Add Stamp'}
            </button>
          </form>

          <button onClick={() => { setCustomer(null); setScanResult(null); setMessage('') }} style={{ width: '100%', marginTop: 10, padding: 10, background: '#6c757d', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
            Scan Next Customer
          </button>
        </div>
      )}

      {message && (
        <div style={{ padding: 15, background: message.includes('✅') || message.includes('🎉') ? '#d4edda' : '#f8d7da', borderRadius: 8, textAlign: 'center' }}>
          {message}
        </div>
      )}
    </div>
  )
}

export default CashierApp

import React, { useState } from 'react'
import { useParams } from 'react-router-dom'

function CustomerJoin({ API_BASE }) {
  const { businessSlug } = useParams()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const res = await fetch(`${API_BASE}/api/v1/customer/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_slug: businessSlug, name, phone })
      })
      const data = await res.json()
      if (res.ok) {
        setSubmitted(true)
      } else {
        setError(data.detail || 'Something went wrong')
      }
    } catch (err) {
      setError('Network error')
    }
  }

  if (submitted) {
    return (
      <div style={{ maxWidth: 400, margin: '100px auto', padding: 30, textAlign: 'center' }}>
        <h1 style={{ color: '#2d6a4f' }}>🎉 Welcome!</h1>
        <p>Your loyalty card has been created.</p>
        <p style={{ color: '#666', fontSize: 14, marginTop: 20 }}>
          Check your SMS for a link to add your card to Apple Wallet or Google Wallet.
        </p>
        <p style={{ marginTop: 30, fontSize: 12, color: '#999' }}>
          (Wallet pass generation coming in next update)
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 30, border: '1px solid #ddd', borderRadius: 10 }}>
      <h1 style={{ textAlign: 'center', color: '#2d6a4f' }}>🌳 Join Loyalty Program</h1>
      <p style={{ textAlign: 'center', color: '#666' }}>Enter your details to get your digital loyalty card</p>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Your Name"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
        />
        <input
          placeholder="Phone Number"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
        />
        <button type="submit" style={{ width: '100%', padding: 12, background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
          Get My Loyalty Card
        </button>
      </form>
      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
    </div>
  )
}

export default CustomerJoin

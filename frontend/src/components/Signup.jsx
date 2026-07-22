import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function Signup({ API_BASE }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [businessType, setBusinessType] = useState('spa')
  const [plan, setPlan] = useState('starter')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSignup = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          phone,
          business_type: businessType,
          plan
        })
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess('Business registered successfully! Redirecting to login...')
        setTimeout(() => {
          navigate('/')
        }, 2000)
      } else {
        setError(data.detail || 'Signup failed')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div style={{ maxWidth: 400, margin: '100px auto', padding: 30, textAlign: 'center' }}>
        <h1 style={{ color: '#2d6a4f' }}>🎉 Success!</h1>
        <p>{success}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 30, border: '1px solid #ddd', borderRadius: 10 }}>
      <h1 style={{ textAlign: 'center', color: '#2d6a4f' }}>🌳 LoyaltyTree</h1>
      <h2 style={{ textAlign: 'center', color: '#666', fontSize: 18, marginBottom: 20 }}>Register Your Business</h2>
      
      <form onSubmit={handleSignup}>
        <input
          type="text"
          placeholder="Business Name"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
        />
        <input
          type="email"
          placeholder="Business Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
        />
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
          minLength={8}
        />
        <input
          type="tel"
          placeholder="Phone Number"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
        />
        <select
          value={businessType}
          onChange={e => setBusinessType(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
        >
          <option value="spa">Spa / Wellness</option>
          <option value="salon">Salon / Barber</option>
          <option value="fitness">Fitness / Gym</option>
          <option value="restaurant">Restaurant / Cafe</option>
          <option value="retail">Retail Shop</option>
          <option value="other">Other Service</option>
        </select>
        <select
          value={plan}
          onChange={e => setPlan(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
        >
          <option value="starter">Starter - $29/mo</option>
          <option value="growth">Growth - $79/mo</option>
          <option value="pro">Pro - $199/mo</option>
        </select>
        <button 
          type="submit" 
          disabled={loading}
          style={{ width: '100%', padding: 12, background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}
        >
          {loading ? 'Creating Account...' : 'Create Business Account'}
        </button>
      </form>
      
      {error && <p style={{ color: 'red', textAlign: 'center', marginTop: 10 }}>{error}</p>}
      
      <p style={{ textAlign: 'center', marginTop: 15 }}>
        Already have an account? <a href="/" style={{ color: '#2d6a4f' }}>Log In</a>
      </p>
    </div>
  )
}

export default Signup
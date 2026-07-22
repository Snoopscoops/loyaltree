import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function Login({ API_BASE, setUser }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      if (res.ok) {
        setUser(data)
        // Navigate based on role
        if (data.role === 'admin') {
          navigate('/admin')
        } else if (data.role === 'owner') {
          navigate('/owner')
        } else if (data.role === 'cashier') {
          navigate('/cashier')
        }
      } else {
        setError(data.detail || 'Login failed')
      }
    } catch (err) {
      setError('Network error')
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 30, border: '1px solid #ddd', borderRadius: 10 }}>
      <h1 style={{ textAlign: 'center', color: '#2d6a4f' }}>🌳 LoyaltyTree</h1>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: 12, marginBottom: 10, borderRadius: 5, border: '1px solid #ccc' }}
          required
        />
        <button type="submit" style={{ width: '100%', padding: 12, background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
          Log In
        </button>
      </form>
      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
      <p style={{ textAlign: 'center', color: '#666', marginTop: 20, fontSize: 12 }}>
        Demo accounts:<br/>
        admin@loyaltree.com / admin123<br/>
        owner@demo.com / owner123<br/>
        cashier@demo.com / cashier123
      </p>
    </div>
  )
}

export default Login

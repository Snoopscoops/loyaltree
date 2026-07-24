import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './components/LoginPage'
import OwnerDashboard from './components/OwnerDashboard'
import CashierApp from './components/CashierApp'
import WalletPass from './components/WalletPass'
import AnalyticsDashboard from './components/AnalyticsDashboard'

const API_BASE = 'https://loyaltree-btw1.onrender.com'

function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('loyaltree_user'))
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (user) {
      localStorage.setItem('loyaltree_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('loyaltree_user')
    }
  }, [user])

  return (
    <BrowserRouter>
      <style>{`
        @keyframes sway {
          0%, 100% { transform: rotate(-2deg); }
          50% { transform: rotate(2deg); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-10px) rotate(5deg); }
        }
        @keyframes grow {
          0% { transform: scale(0.8); opacity: 0.5; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f0fdf4;
        }
      `}</style>
      <Routes>
        <Route path="/" element={
          user ? (
            user.role === 'owner' ? <Navigate to="/dashboard" /> :
            ['manager', 'cashier'].includes(user.role) ? <Navigate to="/scanner" /> :
            <Navigate to="/login" />
          ) : <Navigate to="/login" />
        } />
        <Route path="/login" element={<LoginPage API_BASE={API_BASE} onLogin={setUser} />} />
        <Route path="/dashboard" element={
          user?.role === 'owner' ? <OwnerDashboard API_BASE={API_BASE} user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" />
        } />
        <Route path="/scanner" element={
          ['owner', 'manager', 'cashier'].includes(user?.role) ? <CashierApp API_BASE={API_BASE} /> : <Navigate to="/login" />
        } />
        <Route path="/wallet/:customerId" element={<WalletPass API_BASE={API_BASE} />} />
        <Route path="/analytics" element={
          user?.role === 'owner' ? <AnalyticsDashboard API_BASE={API_BASE} user={user} /> : <Navigate to="/login" />
        } />
        <Route path="/join/:businessSlug" element={<div>Join Page - Redirecting...</div>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

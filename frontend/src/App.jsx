import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import Login from './components/Login'
import Signup from './components/Signup'
import HomePage from './components/HomePage'
import OwnerDashboard from './components/OwnerDashboard'
import CarLendingDashboard from './components/CarLendingDashboard'
import CockpitDashboard from './components/CockpitDashboard'
import CashierApp from './components/CashierApp'
import AnalyticsDashboard from './components/AnalyticsDashboard'
import AdminDashboard from './components/AdminDashboard'

const API_BASE = 'https://loyaltree-btw1.onrender.com'

// /wallet/:id (and similar) are pages rendered by the FastAPI backend, not
// React routes - if someone lands here on the frontend domain (old bookmark,
// stray link, etc.) send them straight to the real page instead of a blank
// or missing component.
function RedirectToBackend({ base, sub, id: explicitId }) {
  const params = useParams()
  const id = explicitId || Object.values(params)[0]
  useEffect(() => {
    window.location.replace(`${base}/${sub}/${id}`)
  }, [base, sub, id])
  return null
}

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
            user.role === 'super_admin' ? <Navigate to="/admin" /> :
            user.role === 'agent' ? <RedirectToBackend base={API_BASE} sub="agent" id={user.business_slug} /> :
            ['manager', 'cashier'].includes(user.role) ? <Navigate to="/scanner" /> :
            <Navigate to="/login" />
          ) : <HomePage />
        } />
        <Route path="/login" element={<Login API_BASE={API_BASE} onLogin={setUser} />} />
        <Route path="/signup" element={<Signup API_BASE={API_BASE} />} />
        <Route path="/dashboard" element={
          user?.role === 'owner' ? (
            user.business_type === 'car_lending'
              ? <CarLendingDashboard API_BASE={API_BASE} user={user} onLogout={() => setUser(null)} />
              : user.business_type === 'cockpit'
                ? <CockpitDashboard API_BASE={API_BASE} user={user} onLogout={() => setUser(null)} />
                : <OwnerDashboard API_BASE={API_BASE} user={user} onLogout={() => setUser(null)} />
          ) : <Navigate to="/login" />
        } />
        <Route path="/scanner" element={
          ['owner', 'manager', 'cashier'].includes(user?.role)
            ? <CashierApp key="cashier-v14" API_BASE={API_BASE} />
            : <Navigate to="/login" />
        } />
        <Route path="/wallet/:customerId" element={<RedirectToBackend base={API_BASE} sub="wallet" />} />
        <Route path="/analytics" element={
          user?.role === 'owner' ? <AnalyticsDashboard API_BASE={API_BASE} user={user} /> : <Navigate to="/login" />
        } />
        <Route path="/join/:businessSlug" element={<RedirectToBackend base={API_BASE} sub="join" />} />
        <Route path="/admin" element={
          user?.role === 'super_admin' ? <AdminDashboard API_BASE={API_BASE} user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" />
        } />
      </Routes>
    </BrowserRouter>
  )
}

export default App

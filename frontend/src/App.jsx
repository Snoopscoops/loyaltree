import React, { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import Login from './components/Login'
import Signup from './components/Signup'
import HomePage from './components/HomePage'
import PublicInfoPage from './components/PublicInfoPage'
import OwnerDashboard from './components/OwnerDashboard'
import CarLendingDashboard from './components/CarLendingDashboard'
import CockpitDashboard from './components/CockpitDashboard'
import CashierApp from './components/CashierApp'
import AnalyticsDashboard from './components/AnalyticsDashboard'
import AdminDashboard from './components/AdminDashboard'
import PartnerDashboard from './components/PartnerDashboard'
import MotoliteApp from './components/MotoliteApp'
import CustomerJoin from './components/CustomerJoin'
import { trackEvent } from './analytics'

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


function PublicRouteAnalytics({ API_BASE }) {
  const location = useLocation()

  useEffect(() => {
    const path = location.pathname
    const isPublic =
      path === '/' ||
      path === '/login' ||
      path === '/signup' ||
      path === '/about' ||
      path === '/contact' ||
      path.startsWith('/how-it-works') ||
      path.startsWith('/join/')

    if (!isPublic) return

    const pageNames = {
      '/': 'Homepage',
      '/login': 'Business Login',
      '/signup': 'Business Application',
      '/about': 'About Us',
      '/contact': 'Contact Us',
      '/how-it-works': 'How It Works',
      '/how-it-works/businesses': 'How It Works - Businesses',
      '/how-it-works/customers': 'How It Works - Customers',
    }

    const businessPublicId = path.startsWith('/join/')
      ? decodeURIComponent(path.split('/')[2] || '')
      : null

    trackEvent(API_BASE, 'page_view', {
      path: `${path}${location.hash || ''}`,
      page_name: businessPublicId ? 'Business Join Page' : (pageNames[path] || 'LoyaltyTree'),
      business_public_id: businessPublicId,
    })
  }, [API_BASE, location.pathname, location.search, location.hash])

  return null
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('loyaltree_user')
      if (!saved) return null
      const parsed = JSON.parse(saved)
      if (!parsed || !parsed.role || !parsed.token) {
        localStorage.removeItem('loyaltree_user')
        return null
      }
      return parsed
    } catch {
      localStorage.removeItem('loyaltree_user')
      return null
    }
  })

  const handleLogout = () => {
    localStorage.removeItem('loyaltree_user')
    setUser(null)
  }

  useEffect(() => {
    if (user) {
      localStorage.setItem('loyaltree_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('loyaltree_user')
    }
  }, [user])

  return (
    <BrowserRouter>
      <PublicRouteAnalytics API_BASE={API_BASE} />
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
        <Route path="/motolite/*" element={<MotoliteApp API_BASE={API_BASE} />} />
        <Route path="/" element={
          user ? (
            user.role === 'owner' ? <Navigate to="/dashboard" /> :
            user.role === 'super_admin' ? <Navigate to="/admin" /> :
            user.role === 'partner' ? <Navigate to="/partner" /> :
            user.role === 'agent' ? <RedirectToBackend base={API_BASE} sub="agent" id={user.business_slug} /> :
            ['manager', 'cashier'].includes(user.role) ? <Navigate to="/scanner" /> :
            <Navigate to="/login" />
          ) : <HomePage API_BASE={API_BASE} />
        } />
        <Route path="/how-it-works" element={<PublicInfoPage type="overview" API_BASE={API_BASE} />} />
        <Route path="/how-it-works/businesses" element={<PublicInfoPage type="businesses" API_BASE={API_BASE} />} />
        <Route path="/how-it-works/customers" element={<PublicInfoPage type="customers" API_BASE={API_BASE} />} />
        <Route path="/about" element={<PublicInfoPage type="about" API_BASE={API_BASE} />} />
        <Route path="/contact" element={<PublicInfoPage type="contact" API_BASE={API_BASE} />} />
        <Route path="/login" element={
          user ? (
            user.role === 'owner' ? <Navigate to="/dashboard" replace /> :
            user.role === 'super_admin' ? <Navigate to="/admin" replace /> :
            user.role === 'partner' ? <Navigate to="/partner" replace /> :
            user.role === 'agent' ? <RedirectToBackend base={API_BASE} sub="agent" id={user.business_slug} /> :
            ['manager', 'cashier'].includes(user.role) ? <Navigate to="/scanner" replace /> :
            <Login API_BASE={API_BASE} onLogin={setUser} />
          ) : <Login API_BASE={API_BASE} onLogin={setUser} />
        } />
        <Route path="/signup" element={<Signup API_BASE={API_BASE} />} />
        <Route path="/dashboard" element={
          user?.role === 'owner' ? (
            user.business_type === 'car_lending'
              ? <CarLendingDashboard API_BASE={API_BASE} user={user} onLogout={handleLogout} />
              : user.business_type === 'cockpit'
                ? <CockpitDashboard API_BASE={API_BASE} user={user} onLogout={handleLogout} />
                : <OwnerDashboard API_BASE={API_BASE} user={user} onLogout={handleLogout} />
          ) : <Navigate to="/login" />
        } />
        <Route path="/scanner" element={
          ['owner', 'manager', 'cashier', 'partner'].includes(user?.role)
            ? <CashierApp key="cashier-api-security-v1" API_BASE={API_BASE} />
            : <Navigate to="/login" />
        } />
        <Route path="/wallet/:customerId" element={<RedirectToBackend base={API_BASE} sub="wallet" />} />
        <Route path="/analytics" element={
          user?.role === 'owner' ? <AnalyticsDashboard API_BASE={API_BASE} user={user} /> : <Navigate to="/login" />
        } />
        <Route path="/join/:businessSlug" element={<CustomerJoin API_BASE={API_BASE} />} />
        <Route path="/admin" element={
          user?.role === 'super_admin' ? <AdminDashboard API_BASE={API_BASE} user={user} onLogout={handleLogout} /> : <Navigate to="/login" />
        } />
        <Route path="/partner" element={
          user?.role === 'partner' ? <PartnerDashboard API_BASE={API_BASE} user={user} onLogout={handleLogout} /> : <Navigate to="/login" />
        } />
      </Routes>
    </BrowserRouter>
  )
}

export default App

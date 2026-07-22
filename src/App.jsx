import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './components/Login'
import AdminDashboard from './components/AdminDashboard'
import OwnerDashboard from './components/OwnerDashboard'
import CashierApp from './components/CashierApp'
import CustomerJoin from './components/CustomerJoin'

const API_BASE = 'https://loyaltree-api.onrender.com'

function App() {
  const [user, setUser] = useState(null)

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login API_BASE={API_BASE} setUser={setUser} />} />
        <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard API_BASE={API_BASE} user={user} /> : <Navigate to="/" />} />
        <Route path="/owner" element={user?.role === 'owner' ? <OwnerDashboard API_BASE={API_BASE} user={user} /> : <Navigate to="/" />} />
        <Route path="/cashier" element={user?.role === 'cashier' ? <CashierApp API_BASE={API_BASE} user={user} /> : <Navigate to="/" />} />
        <Route path="/join/:businessSlug" element={<CustomerJoin API_BASE={API_BASE} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App


// ============================================================
// LOYALTYPASS DASHBOARD - React App
// ============================================================
// Single app with role-based routing:
// - /admin → Your platform dashboard (all businesses)
// - /dashboard → Business owner dashboard (their business only)
// - /scan → Cashier scan interface
// ============================================================

import React, { useState, useEffect } from 'react';

const API_BASE = 'https://api.yourapp.com/api/v1';

// ============================================================
// MAIN APP ROUTER
// ============================================================

function App() {
  const [user, setUser] = useState(null); // { role: 'admin' | 'owner' | 'cashier', businessId: '...' }
  const [view, setView] = useState('login');

  const handleLogin = (role, businessId = null) => {
    setUser({ role, businessId });
    if (role === 'admin') setView('admin');
    else if (role === 'owner') setView('owner');
    else if (role === 'cashier') setView('scan');
  };

  if (view === 'login') return <LoginScreen onLogin={handleLogin} />;
  if (view === 'admin') return <AdminDashboard />;
  if (view === 'owner') return <OwnerDashboard businessId={user.businessId} />;
  if (view === 'scan') return <CashierScanApp businessId={user.businessId} />;
}

// ============================================================
// LOGIN SCREEN
// ============================================================

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('owner');

  const handleSubmit = (e) => {
    e.preventDefault();
    // In production: call API to authenticate
    // Mock login for demo
    if (email.includes('admin')) onLogin('admin');
    else if (email.includes('cashier')) onLogin('cashier', 'biz_123');
    else onLogin('owner', 'biz_123');
  };

  return (
    <div style={styles.loginContainer}>
      <div style={styles.loginCard}>
        <div style={styles.loginLogo}>⭐</div>
        <h1 style={styles.loginTitle}>LoyaltyPass</h1>
        <p style={styles.loginSubtitle}>Sign in to your dashboard</p>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.loginInput}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.loginInput}
          />
          <button type="submit" style={styles.loginButton}>Sign In</button>
        </form>

        <p style={styles.loginHint}>
          Demo: use "admin@" for platform view, "owner@" for business view, "cashier@" for scan view
        </p>
      </div>
    </div>
  );
}

// ============================================================
// YOUR PLATFORM ADMIN DASHBOARD
// ============================================================

function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('businesses');
  const [businesses, setBusinesses] = useState([
    { id: 1, name: 'Serenity Spa', status: 'active', plan: 'pro', customers: 1247, stamps: 8934, revenue: 299, joined: '2024-01-15' },
    { id: 2, name: 'FitZone Gym', status: 'active', plan: 'growth', customers: 892, stamps: 5671, revenue: 129, joined: '2024-02-20' },
    { id: 3, name: 'AutoCare Pro', status: 'pending_review', plan: 'starter', customers: 0, stamps: 0, revenue: 0, joined: '2024-07-22' },
    { id: 4, name: 'Glow Salon', status: 'suspended', plan: 'pro', customers: 234, stamps: 1890, revenue: 0, joined: '2023-11-10' },
  ]);

  const stats = {
    totalBusinesses: businesses.length,
    activeBusinesses: businesses.filter(b => b.status === 'active').length,
    totalCustomers: businesses.reduce((sum, b) => sum + b.customers, 0),
    monthlyRevenue: businesses.reduce((sum, b) => sum + b.revenue, 0),
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.adminHeader}>
        <div style={styles.headerLeft}>
          <span style={styles.headerLogo}>⭐ LoyaltyPass</span>
          <span style={styles.headerBadge}>Platform Admin</span>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.headerUser}>👤 Platform Owner</span>
        </div>
      </div>

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total Businesses</div>
          <div style={styles.statValue}>{stats.totalBusinesses}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Active</div>
          <div style={styles.statValue} style={{color: '#10b981'}}>{stats.activeBusinesses}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total Customers</div>
          <div style={styles.statValue}>{stats.totalCustomers.toLocaleString()}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Monthly Revenue</div>
          <div style={styles.statValue}>${stats.monthlyRevenue}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        <button onClick={() => setActiveTab('businesses')} style={{...styles.tab, ...(activeTab === 'businesses' ? styles.tabActive : {})}}>🏪 Businesses</button>
        <button onClick={() => setActiveTab('verification')} style={{...styles.tab, ...(activeTab === 'verification' ? styles.tabActive : {})}}>🔐 Verification Queue (1)</button>
        <button onClick={() => setActiveTab('billing')} style={{...styles.tab, ...(activeTab === 'billing' ? styles.tabActive : {})}}>💰 Billing</button>
        <button onClick={() => setActiveTab('fraud')} style={{...styles.tab, ...(activeTab === 'fraud' ? styles.tabActive : {})}}>🚨 Fraud Alerts</button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'businesses' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>All Businesses</h2>
              <button style={styles.primaryButton}>+ Add Business</button>
            </div>
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeader}>
                    <th style={styles.th}>Business</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Plan</th>
                    <th style={styles.th}>Customers</th>
                    <th style={styles.th}>Stamps</th>
                    <th style={styles.th}>MRR</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {businesses.map(b => (
                    <tr key={b.id} style={styles.tableRow}>
                      <td style={styles.td}>
                        <div style={{fontWeight: 600}}>{b.name}</div>
                        <div style={{fontSize: 12, color: '#94a3b8'}}>Joined {b.joined}</div>
                      </td>
                      <td style={styles.td}>
                        <span style={{...styles.statusBadge, ...getStatusStyle(b.status)}}>{b.status}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.planBadge}>{b.plan}</span>
                      </td>
                      <td style={styles.td}>{b.customers.toLocaleString()}</td>
                      <td style={styles.td}>{b.stamps.toLocaleString()}</td>
                      <td style={styles.td}>${b.revenue}</td>
                      <td style={styles.td}>
                        <button style={styles.actionBtn}>View</button>
                        {b.status === 'pending_review' && <button style={{...styles.actionBtn, background: '#10b981', color: 'white'}}>Verify</button>}
                        {b.status === 'active' && <button style={{...styles.actionBtn, background: '#ef4444', color: 'white'}}>Suspend</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'verification' && (
          <div>
            <h2 style={styles.sectionTitle}>Pending Verification</h2>
            <div style={styles.verificationCard}>
              <div style={styles.verificationHeader}>
                <h3>AutoCare Pro</h3>
                <span style={styles.verificationDate}>Submitted: July 22, 2024</span>
              </div>
              <div style={styles.verificationDocs}>
                <div style={styles.docItem}>
                  <span>📄 Business License</span>
                  <button style={styles.actionBtn}>View</button>
                </div>
                <div style={styles.docItem}>
                  <span>🆔 Owner ID</span>
                  <button style={styles.actionBtn}>View</button>
                </div>
                <div style={styles.docItem}>
                  <span>🏦 Bank Statement</span>
                  <button style={styles.actionBtn}>View</button>
                </div>
              </div>
              <div style={styles.verificationActions}>
                <button style={{...styles.primaryButton, background: '#ef4444'}}>Reject</button>
                <button style={styles.primaryButton}>Approve & Activate</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BUSINESS OWNER DASHBOARD
// ============================================================

function OwnerDashboard({ businessId }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [showQRModal, setShowQRModal] = useState(false);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.ownerHeader}>
        <div style={styles.headerLeft}>
          <span style={styles.headerLogo}>⭐ LoyaltyPass</span>
          <span style={styles.headerBusiness}>Serenity Spa</span>
        </div>
        <div style={styles.headerRight}>
          <button onClick={() => setShowQRModal(true)} style={styles.qrButton}>📱 Get QR Code</button>
          <span style={styles.headerUser}>👤 Owner</span>
        </div>
      </div>

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Active Members</div>
          <div style={styles.statValue}>1,247</div>
          <div style={{...styles.statChange, color: '#10b981'}}>↑ 12% this month</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Stamps Issued</div>
          <div style={styles.statValue}>8,934</div>
          <div style={{...styles.statChange, color: '#10b981'}}>↑ 8% this month</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Rewards Redeemed</div>
          <div style={styles.statValue}>89</div>
          <div style={{...styles.statChange, color: '#10b981'}}>↑ 15% this month</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Avg. Visits/Customer</div>
          <div style={styles.statValue}>4.2</div>
          <div style={{...styles.statChange, color: '#10b981'}}>↑ 0.3 this month</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        <button onClick={() => setActiveTab('overview')} style={{...styles.tab, ...(activeTab === 'overview' ? styles.tabActive : {})}}>📊 Overview</button>
        <button onClick={() => setActiveTab('customers')} style={{...styles.tab, ...(activeTab === 'customers' ? styles.tabActive : {})}}>👥 Customers</button>
        <button onClick={() => setActiveTab('staff')} style={{...styles.tab, ...(activeTab === 'staff' ? styles.tabActive : {})}}>👥 Staff</button>
        <button onClick={() => setActiveTab('campaigns')} style={{...styles.tab, ...(activeTab === 'campaigns' ? styles.tabActive : {})}}>📢 Campaigns</button>
        <button onClick={() => setActiveTab('settings')} style={{...styles.tab, ...(activeTab === 'settings' ? styles.tabActive : {})}}>⚙️ Program Settings</button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'customers' && <CustomersTab />}
        {activeTab === 'staff' && <StaffTab />}
        {activeTab === 'campaigns' && <CampaignsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>

      {/* QR Code Modal */}
      {showQRModal && <QRCodeModal onClose={() => setShowQRModal(false)} />}
    </div>
  );
}

// ============================================================
// OWNER DASHBOARD TABS
// ============================================================

function OverviewTab() {
  return (
    <div>
      <div style={styles.twoColumn}>
        <div style={styles.chartCard}>
          <h3 style={styles.cardTitle}>📈 Weekly Activity</h3>
          <div style={styles.barChart}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => (
              <div key={day} style={styles.barContainer}>
                <div style={{...styles.bar, height: [45, 62, 38, 55, 78, 92, 68][i] + '%'}}></div>
                <span style={styles.barLabel}>{day}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={styles.chartCard}>
          <h3 style={styles.cardTitle}>👤 Customer Segments</h3>
          <div style={styles.segments}>
            {[
              { label: 'VIP (8+ visits)', pct: 18, color: '#8b5cf6' },
              { label: 'Regular (4-7)', pct: 42, color: '#3b82f6' },
              { label: 'New (1-3)', pct: 28, color: '#10b981' },
              { label: 'At Risk (30d+)', pct: 12, color: '#ef4444' },
            ].map(seg => (
              <div key={seg.label} style={styles.segmentRow}>
                <div style={styles.segmentInfo}>
                  <span style={styles.segmentLabel}>{seg.label}</span>
                  <span style={styles.segmentPct}>{seg.pct}%</span>
                </div>
                <div style={styles.segmentBar}>
                  <div style={{...styles.segmentFill, width: seg.pct + '%', background: seg.color}}></div>
                </div>
              </div>
            ))}
          </div>
          <div style={styles.alertBox}>
            ⚠️ 149 customers haven't visited in 30+ days. 
            <button style={styles.alertAction}>Send Win-Back Campaign</button>
          </div>
        </div>
      </div>

      <div style={styles.recentActivity}>
        <h3 style={styles.cardTitle}>🔔 Recent Activity</h3>
        {[
          { time: '2m ago', text: 'Sarah M. earned stamp #5 (3 until reward)', type: 'stamp' },
          { time: '5m ago', text: 'Mike T. redeemed Free Aromatherapy', type: 'reward' },
          { time: '12m ago', text: 'New member: Jessica L. joined', type: 'join' },
          { time: '1h ago', text: 'Cashier John voided stamp #3 (wrong amount)', type: 'void' },
        ].map((item, i) => (
          <div key={i} style={styles.activityItem}>
            <span style={{...styles.activityDot, background: item.type === 'stamp' ? '#3b82f6' : item.type === 'reward' ? '#10b981' : item.type === 'join' ? '#8b5cf6' : '#ef4444'}}></span>
            <div style={styles.activityText}>
              <div>{item.text}</div>
              <div style={styles.activityTime}>{item.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomersTab() {
  const [customers] = useState([
    { name: 'Sarah Mitchell', phone: '555-0123', stamps: 5, rewards: 1, lastVisit: '2024-07-22', status: 'active' },
    { name: 'Mike Torres', phone: '555-0456', stamps: 8, rewards: 0, lastVisit: '2024-07-21', status: 'active' },
    { name: 'Jessica Lee', phone: '555-0789', stamps: 1, rewards: 0, lastVisit: '2024-07-22', status: 'new' },
    { name: 'David Chen', phone: '555-0321', stamps: 12, rewards: 2, lastVisit: '2024-06-15', status: 'at-risk' },
  ]);

  return (
    <div>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Customers</h2>
        <input type="text" placeholder="Search by name or phone..." style={styles.searchInput} />
      </div>
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Phone</th>
              <th style={styles.th}>Stamps</th>
              <th style={styles.th}>Rewards</th>
              <th style={styles.th}>Last Visit</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c, i) => (
              <tr key={i} style={styles.tableRow}>
                <td style={styles.td}><strong>{c.name}</strong></td>
                <td style={styles.td}>{c.phone}</td>
                <td style={styles.td}>{c.stamps}</td>
                <td style={styles.td}>{c.rewards}</td>
                <td style={styles.td}>{c.lastVisit}</td>
                <td style={styles.td}>
                  <span style={{...styles.statusBadge, ...getCustomerStatusStyle(c.status)}}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StaffTab() {
  const [staff] = useState([
    { name: 'John Smith', email: 'john@serenityspa.com', role: 'manager', stampsToday: 23, totalStamps: 1450 },
    { name: 'Emma Davis', email: 'emma@serenityspa.com', role: 'cashier', stampsToday: 18, totalStamps: 890 },
    { name: 'Carlos Ruiz', email: 'carlos@serenityspa.com', role: 'cashier', stampsToday: 12, totalStamps: 567 },
  ]);

  return (
    <div>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Staff Members</h2>
        <button style={styles.primaryButton}>+ Invite Staff</button>
      </div>
      <div style={styles.staffGrid}>
        {staff.map((s, i) => (
          <div key={i} style={styles.staffCard}>
            <div style={styles.staffAvatar}>{s.name.split(' ').map(n => n[0]).join('')}</div>
            <div style={styles.staffName}>{s.name}</div>
            <div style={styles.staffRole}>{s.role}</div>
            <div style={styles.staffEmail}>{s.email}</div>
            <div style={styles.staffStats}>
              <div><strong>{s.stampsToday}</strong> today</div>
              <div><strong>{s.totalStamps}</strong> total</div>
            </div>
            <button style={styles.actionBtn}>Edit</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignsTab() {
  return (
    <div>
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Push Campaigns</h2>
        <button style={styles.primaryButton}>+ New Campaign</button>
      </div>
      <div style={styles.campaignGrid}>
        {[
          { name: '🎯 Geofence Welcome', status: 'active', sent: 234, opened: 89, type: 'auto' },
          { name: '🎂 Birthday Reward', status: 'active', sent: 12, opened: 11, type: 'auto' },
          { name: '⏰ Flash Sale 25% Off', status: 'draft', sent: 0, opened: 0, type: 'manual' },
          { name: '😴 Win-Back: We Miss You', status: 'paused', sent: 149, opened: 34, type: 'auto' },
        ].map((camp, i) => (
          <div key={i} style={styles.campaignCard}>
            <div style={styles.campaignHeader}>
              <span style={{...styles.campaignStatus, background: camp.status === 'active' ? '#dcfce7' : camp.status === 'draft' ? '#f1f5f9' : '#fef3c7', color: camp.status === 'active' ? '#166534' : camp.status === 'draft' ? '#64748b' : '#92400e'}}>{camp.status}</span>
              <span style={styles.campaignType}>{camp.type}</span>
            </div>
            <div style={styles.campaignName}>{camp.name}</div>
            <div style={styles.campaignStats}>
              <div>Sent: <strong>{camp.sent}</strong></div>
              <div>Opened: <strong>{camp.opened}</strong></div>
              <div>Rate: <strong>{camp.sent > 0 ? Math.round((camp.opened/camp.sent)*100) : 0}%</strong></div>
            </div>
            <div style={styles.campaignActions}>
              <button style={styles.actionBtn}>Edit</button>
              {camp.status === 'draft' && <button style={{...styles.actionBtn, background: '#3b82f6', color: 'white'}}>Send</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div style={styles.settingsContainer}>
      <h2 style={styles.sectionTitle}>Program Settings</h2>

      <div style={styles.settingSection}>
        <h3 style={styles.settingTitle}>🎯 Stamp Rules</h3>
        <div style={styles.settingRow}>
          <label>Stamps needed for reward:</label>
          <input type="number" defaultValue={8} style={styles.settingInput} />
        </div>
        <div style={styles.settingRow}>
          <label>Reward name:</label>
          <input type="text" defaultValue="Free Aromatherapy Session" style={styles.settingInput} />
        </div>
        <div style={styles.settingRow}>
          <label>Reward expires after (days):</label>
          <input type="number" defaultValue={30} style={styles.settingInput} />
        </div>
      </div>

      <div style={styles.settingSection}>
        <h3 style={styles.settingTitle}>🔔 Push Notifications</h3>
        <div style={styles.toggleRow}>
          <span>Milestone alerts ("3 more visits!")</span>
          <input type="checkbox" defaultChecked style={styles.toggle} />
        </div>
        <div style={styles.toggleRow}>
          <span>Reward unlocked notification</span>
          <input type="checkbox" defaultChecked style={styles.toggle} />
        </div>
        <div style={styles.toggleRow}>
          <span>Geofence welcome (when near store)</span>
          <input type="checkbox" style={styles.toggle} />
        </div>
        <div style={styles.toggleRow}>
          <span>Win-back campaign (inactive 30+ days)</span>
          <input type="checkbox" defaultChecked style={styles.toggle} />
        </div>
      </div>

      <div style={styles.settingSection}>
        <h3 style={styles.settingTitle}>🎨 Branding</h3>
        <div style={styles.settingRow}>
          <label>Primary color:</label>
          <input type="color" defaultValue="#3b82f6" style={styles.colorInput} />
        </div>
        <div style={styles.settingRow}>
          <label>Business logo:</label>
          <button style={styles.actionBtn}>Upload</button>
        </div>
      </div>

      <button style={styles.primaryButton}>Save Changes</button>
    </div>
  );
}

// ============================================================
// QR CODE MODAL
// ============================================================

function QRCodeModal({ onClose }) {
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2>📱 Your QR Code</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.qrDisplay}>
          {/* Mock QR code - in production: actual generated QR */}
          <div style={styles.mockQR}>
            <div style={styles.qrPattern}></div>
          </div>
          <p style={styles.qrUrl}>loyaltypass.io/join/serenity-spa</p>
        </div>

        <div style={styles.qrOptions}>
          <div style={styles.qrOption}>
            <strong>📄 Print for Counter</strong>
            <p>3x3 inch, high quality SVG</p>
            <button style={styles.actionBtn}>Download SVG</button>
          </div>
          <div style={styles.qrOption}>
            <strong>🧾 Add to Receipt</strong>
            <p>Small QR, 1x1 inch PNG</p>
            <button style={styles.actionBtn}>Download PNG</button>
          </div>
          <div style={styles.qrOption}>
            <strong>🪟 Window Sticker</strong>
            <p>5x5 inch, print-ready PDF</p>
            <button style={styles.actionBtn}>Download PDF</button>
          </div>
        </div>

        <div style={styles.qrTip}>
          💡 <strong>Tip:</strong> Place QR at eye level on counter. 30% of customers scan within first 10 seconds of seeing it.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CASHIER SCAN APP
// ============================================================

function CashierScanApp({ businessId }) {
  const [mode, setMode] = useState('scan'); // scan | confirm | success
  const [customerData, setCustomerData] = useState(null);
  const [transactionId, setTransactionId] = useState('');
  const [amount, setAmount] = useState('');
  const [staffPin, setStaffPin] = useState('');

  const handleScan = (customerId) => {
    // Mock: in production, API call
    setCustomerData({
      name: 'Sarah Mitchell',
      phone: '555-0123',
      stamps: 5,
      goal: 8,
      rewardName: 'Free Aromatherapy',
      unlockedRewards: 0
    });
    setMode('confirm');
  };

  const handleAddStamp = () => {
    if (!transactionId || !amount || !staffPin) return;
    setMode('success');
  };

  const reset = () => {
    setMode('scan');
    setCustomerData(null);
    setTransactionId('');
    setAmount('');
    setStaffPin('');
  };

  if (mode === 'scan') {
    return (
      <div style={styles.scanContainer}>
        <div style={styles.scanHeader}>
          <span style={styles.scanLogo}>⭐ LoyaltyPass</span>
          <span style={styles.scanBusiness}>Serenity Spa</span>
        </div>
        <div style={styles.scannerBox}>
          <div style={styles.scannerFrame}>
            <div style={styles.scannerCorner}></div>
            <div style={{...styles.scannerCorner, right: 0}}></div>
            <div style={{...styles.scannerCorner, bottom: 0}}></div>
            <div style={{...styles.scannerCorner, right: 0, bottom: 0}}></div>
            <p style={styles.scannerText}>Point camera at customer QR code</p>
          </div>
          <input 
            type="text" 
            placeholder="Or type customer ID..."
            style={styles.scanInput}
            onKeyDown={(e) => e.key === 'Enter' && handleScan(e.target.value)}
          />
        </div>
        <div style={styles.scanFooter}>
          <button style={styles.scanHistoryBtn}>📋 History</button>
          <button style={styles.scanLogoutBtn}>Logout</button>
        </div>
      </div>
    );
  }

  if (mode === 'confirm') {
    const progress = customerData.stamps % customerData.goal;
    return (
      <div style={styles.scanContainer}>
        <div style={styles.scanHeader}>
          <span style={styles.scanLogo}>⭐ LoyaltyPass</span>
          <button onClick={reset} style={styles.backBtn}>← Back</button>
        </div>

        <div style={styles.customerCard}>
          <h2 style={styles.customerName}>{customerData.name}</h2>
          <p style={styles.customerPhone}>{customerData.phone}</p>

          <div style={styles.progressSection}>
            <p style={styles.progressText}>
              {customerData.stamps} / {customerData.goal} stamps
            </p>
            <div style={styles.stampRow}>
              {Array.from({ length: customerData.goal }).map((_, i) => (
                <div key={i} style={{
                  ...styles.stampDot,
                  background: i < progress ? '#3b82f6' : '#e2e8f0',
                  color: i < progress ? 'white' : '#94a3b8'
                }}>{i < progress ? '✓' : i + 1}</div>
              ))}
            </div>
            <p style={styles.stampsUntil}>{customerData.goal - progress} more until {customerData.rewardName}</p>
          </div>

          <div style={styles.stampForm}>
            <input
              type="text"
              placeholder="Transaction ID (from POS)"
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
              style={styles.stampInput}
            />
            <input
              type="number"
              placeholder="Amount ($)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={styles.stampInput}
            />
            <input
              type="password"
              placeholder="Your PIN"
              value={staffPin}
              onChange={(e) => setStaffPin(e.target.value)}
              style={styles.stampInput}
            />
            <button onClick={handleAddStamp} style={styles.confirmBtn}>
              ✓ Confirm & Add Stamp
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'success') {
    return (
      <div style={styles.scanContainer}>
        <div style={styles.successCard}>
          <div style={styles.successIcon}>🎉</div>
          <h2 style={styles.successTitle}>Stamp Added!</h2>
          <p style={styles.successDetail}>{customerData.name}</p>
          <p style={styles.successDetail}>Stamp #{customerData.stamps + 1}</p>
          <p style={styles.successDetail}>Total: {customerData.stamps + 1} stamps</p>

          {(customerData.stamps + 1) % customerData.goal === 0 && (
            <div style={styles.rewardUnlockedBanner}>
              🎁 REWARD UNLOCKED!<br/>
              <small>Customer will receive push notification</small>
            </div>
          )}

          <button onClick={reset} style={styles.nextBtn}>Scan Next Customer</button>
        </div>
      </div>
    );
  }
}

// ============================================================
// STYLES
// ============================================================

const styles = {
  // Login
  loginContainer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)' },
  loginCard: { background: 'white', borderRadius: 20, padding: 48, width: 360, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  loginLogo: { fontSize: 48, marginBottom: 16 },
  loginTitle: { margin: 0, fontSize: 24, color: '#1e293b' },
  loginSubtitle: { color: '#64748b', marginBottom: 24 },
  loginInput: { width: '100%', padding: 14, marginBottom: 12, border: '2px solid #e2e8f0', borderRadius: 10, fontSize: 16, boxSizing: 'border-box' },
  loginButton: { width: '100%', padding: 14, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  loginHint: { fontSize: 11, color: '#94a3b8', marginTop: 16 },

  // Layout
  container: { maxWidth: 1200, margin: '0 auto', padding: '0 24px 24px' },
  adminHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #e2e8f0', marginBottom: 24 },
  ownerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid #e2e8f0', marginBottom: 24 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 16 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  headerLogo: { fontSize: 20, fontWeight: 700, color: '#1e293b' },
  headerBadge: { background: '#3b82f6', color: 'white', padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  headerBusiness: { color: '#64748b', fontSize: 14 },
  headerUser: { color: '#64748b', fontSize: 14 },
  qrButton: { background: '#10b981', color: 'white', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' },

  // Stats
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 },
  statCard: { background: 'white', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 28, fontWeight: 700, color: '#1e293b', marginTop: 4 },
  statChange: { fontSize: 12, marginTop: 4 },

  // Tabs
  tabBar: { display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 24 },
  tab: { padding: '12px 20px', border: 'none', background: 'transparent', color: '#64748b', fontSize: 14, fontWeight: 500, cursor: 'pointer', borderBottom: '3px solid transparent' },
  tabActive: { color: '#3b82f6', borderBottomColor: '#3b82f6', fontWeight: 600 },

  // Content
  content: { background: 'white', borderRadius: 12, padding: 24, minHeight: 400 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sectionTitle: { margin: 0, fontSize: 18, color: '#1e293b' },
  primaryButton: { background: '#3b82f6', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' },

  // Table
  tableContainer: { overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  tableHeader: { background: '#f8fafc' },
  th: { textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 600, fontSize: 12, textTransform: 'uppercase' },
  tableRow: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '16px', color: '#475569' },
  statusBadge: { padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  planBadge: { background: '#dbeafe', color: '#1e40af', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  actionBtn: { background: '#f1f5f9', color: '#475569', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginRight: 8 },

  // Verification
  verificationCard: { background: '#f8fafc', borderRadius: 12, padding: 24 },
  verificationHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 16 },
  verificationDate: { color: '#64748b', fontSize: 14 },
  verificationDocs: { marginBottom: 20 },
  docItem: { display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #e2e8f0' },
  verificationActions: { display: 'flex', gap: 12, justifyContent: 'flex-end' },

  // Overview charts
  twoColumn: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 },
  chartCard: { background: '#f8fafc', borderRadius: 12, padding: 20 },
  cardTitle: { margin: '0 0 16px 0', fontSize: 16, color: '#1e293b' },
  barChart: { display: 'flex', alignItems: 'end', gap: 12, height: 160, paddingBottom: 24 },
  barContainer: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  bar: { width: '100%', background: '#3b82f6', borderRadius: '6px 6px 0 0', minHeight: 20 },
  barLabel: { fontSize: 11, color: '#94a3b8' },
  segments: { marginBottom: 16 },
  segmentRow: { marginBottom: 12 },
  segmentInfo: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  segmentLabel: { fontSize: 13, color: '#475569' },
  segmentPct: { fontSize: 13, fontWeight: 600, color: '#1e293b' },
  segmentBar: { height: 8, background: '#e2e8f0', borderRadius: 4 },
  segmentFill: { height: '100%', borderRadius: 4 },
  alertBox: { background: '#fef3c7', padding: 12, borderRadius: 8, fontSize: 13, color: '#92400e', marginTop: 16 },
  alertAction: { background: '#f59e0b', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, marginLeft: 12, cursor: 'pointer' },

  // Activity
  recentActivity: { background: '#f8fafc', borderRadius: 12, padding: 20 },
  activityItem: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #e2e8f0' },
  activityDot: { width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0 },
  activityText: { fontSize: 14, color: '#475569' },
  activityTime: { fontSize: 12, color: '#94a3b8', marginTop: 2 },

  // Search
  searchInput: { padding: '10px 16px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, width: 280 },

  // Staff
  staffGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  staffCard: { background: '#f8fafc', borderRadius: 12, padding: 20, textAlign: 'center' },
  staffAvatar: { width: 56, height: 56, background: '#3b82f6', color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, margin: '0 auto 12px' },
  staffName: { fontWeight: 600, color: '#1e293b' },
  staffRole: { fontSize: 12, color: '#64748b', textTransform: 'uppercase', marginTop: 4 },
  staffEmail: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  staffStats: { display: 'flex', justifyContent: 'center', gap: 24, margin: '16px 0', fontSize: 13, color: '#475569' },

  // Campaigns
  campaignGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 },
  campaignCard: { border: '2px solid #e2e8f0', borderRadius: 12, padding: 20 },
  campaignHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 },
  campaignStatus: { padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  campaignType: { fontSize: 12, color: '#94a3b8' },
  campaignName: { fontWeight: 600, color: '#1e293b', marginBottom: 12 },
  campaignStats: { display: 'flex', gap: 24, fontSize: 13, color: '#475569', marginBottom: 16 },
  campaignActions: { display: 'flex', gap: 8 },

  // Settings
  settingsContainer: { maxWidth: 600 },
  settingSection: { background: '#f8fafc', borderRadius: 12, padding: 24, marginBottom: 20 },
  settingTitle: { margin: '0 0 16px 0', fontSize: 16, color: '#1e293b' },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  settingInput: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, width: 200 },
  toggleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  toggle: { width: 20, height: 20 },
  colorInput: { width: 40, height: 40, border: 'none', borderRadius: 8, cursor: 'pointer' },

  // QR Modal
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'white', borderRadius: 16, padding: 32, width: 480, maxHeight: '80vh', overflow: 'auto' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  closeBtn: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' },
  qrDisplay: { textAlign: 'center', marginBottom: 24 },
  mockQR: { width: 200, height: 200, background: '#f8fafc', borderRadius: 12, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qrPattern: { width: 160, height: 160, background: 'repeating-linear-gradient(0deg, #1e293b 0px, #1e293b 8px, transparent 8px, transparent 16px), repeating-linear-gradient(90deg, #1e293b 0px, #1e293b 8px, transparent 8px, transparent 16px)' },
  qrUrl: { fontSize: 12, color: '#64748b', fontFamily: 'monospace' },
  qrOptions: { marginBottom: 20 },
  qrOption: { background: '#f8fafc', borderRadius: 8, padding: 16, marginBottom: 12 },
  qrTip: { background: '#eff6ff', padding: 12, borderRadius: 8, fontSize: 13, color: '#3b82f6' },

  // Cashier Scan
  scanContainer: { maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' },
  scanHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, background: 'white', borderBottom: '1px solid #e2e8f0' },
  scanLogo: { fontWeight: 700, color: '#1e293b' },
  scanBusiness: { fontSize: 12, color: '#64748b' },
  backBtn: { background: 'none', border: 'none', color: '#3b82f6', fontSize: 14, cursor: 'pointer' },
  scannerBox: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 },
  scannerFrame: { width: 280, height: 280, border: '2px solid #3b82f6', borderRadius: 20, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  scannerCorner: { position: 'absolute', width: 30, height: 30, borderLeft: '4px solid #3b82f6', borderTop: '4px solid #3b82f6', top: -2, left: -2 },
  scannerText: { color: '#64748b', fontSize: 14, textAlign: 'center', padding: '0 20px' },
  scanInput: { width: '100%', maxWidth: 280, padding: 14, border: '2px solid #e2e8f0', borderRadius: 10, fontSize: 16, textAlign: 'center' },
  scanFooter: { display: 'flex', justifyContent: 'space-between', padding: 16, background: 'white', borderTop: '1px solid #e2e8f0' },
  scanHistoryBtn: { background: '#f1f5f9', border: 'none', padding: '10px 16px', borderRadius: 8, color: '#475569', fontWeight: 600, cursor: 'pointer' },
  scanLogoutBtn: { background: '#fee2e2', border: 'none', padding: '10px 16px', borderRadius: 8, color: '#991b1b', fontWeight: 600, cursor: 'pointer' },

  // Customer card in scan
  customerCard: { background: 'white', borderRadius: 16, padding: 24, margin: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  customerName: { margin: 0, fontSize: 22, color: '#1e293b' },
  customerPhone: { color: '#64748b', margin: '4px 0 20px' },
  progressSection: { marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid #e2e8f0' },
  progressText: { fontWeight: 600, color: '#1e293b', marginBottom: 12 },
  stampRow: { display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12 },
  stampDot: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 },
  stampsUntil: { color: '#64748b', fontSize: 14, textAlign: 'center' },
  stampForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  stampInput: { padding: 14, border: '2px solid #e2e8f0', borderRadius: 10, fontSize: 16 },
  confirmBtn: { padding: 16, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8 },

  // Success
  successCard: { background: 'white', borderRadius: 16, padding: 40, margin: 24, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  successIcon: { fontSize: 56, marginBottom: 16 },
  successTitle: { margin: 0, fontSize: 24, color: '#1e293b' },
  successDetail: { color: '#64748b', fontSize: 16, margin: '8px 0' },
  rewardUnlockedBanner: { background: '#dcfce7', color: '#166534', padding: 16, borderRadius: 12, fontWeight: 700, margin: '20px 0' },
  nextBtn: { padding: 16, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: 20 },
};

function getStatusStyle(status) {
  const map = {
    active: { background: '#dcfce7', color: '#166534' },
    pending_review: { background: '#fef3c7', color: '#92400e' },
    suspended: { background: '#fee2e2', color: '#991b1b' },
    cancelled: { background: '#f3f4f6', color: '#4b5563' },
  };
  return map[status] || map.cancelled;
}

function getCustomerStatusStyle(status) {
  const map = {
    active: { background: '#dcfce7', color: '#166534' },
    new: { background: '#dbeafe', color: '#1e40af' },
    'at-risk': { background: '#fee2e2', color: '#991b1b' },
  };
  return map[status] || map.active;
}

export default App;

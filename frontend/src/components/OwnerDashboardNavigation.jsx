import React, { useEffect, useId, useRef, useState } from 'react'
import './owner-dashboard-refresh.css'
import loyaltyTreeLogo from './logo-192.png'

// Presentation only. Existing dashboard callbacks own navigation and all actions.
function Icon({ name, className = '' }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    chart: <><path d="M4 3v18h17M9 17v-5m5 5V7m5 10V3"/></>,
    announcement: <><path d="m3 10 17-6v15L3 14Zm5 6 1 5h4l-2-4M20 10l2-1m-2 5 2 1"/></>,
    campaign: <><path d="m4 17 6-6 4 3 7-10M16 4h5v5"/><path d="M3 4v17h18"/></>,
    star: <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.8 9.7l6.4-.9Z"/>,
    team: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18m-11 0v3h4v-3"/></>,
    bag: <><path d="M5 8h14l2 13H3Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></>,
    gift: <><path d="M3 11h18v10H3Zm-1-5h20v5H2Zm10 0v15"/><path d="M12 6H8a2.5 2.5 0 1 1 2.5-2.5L12 6Zm0 0h4a2.5 2.5 0 1 0-2.5-2.5L12 6Z"/></>,
    plug: <><path d="M8 3v5m8-5v5M5 8h14v3a7 7 0 0 1-7 7v4M7 8v3a5 5 0 0 0 10 0V8"/></>,
    billing: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-3 5h-4"/></>,
    referrals: <><circle cx="5" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8 11 7-4m-7 6 7 4"/></>,
    setup: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 3.4 2.4c-.9.3-.9 1-.9 2.6m0 4h.01"/></>,
    security: <><path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z"/><path d="m8 11 3 3 5-6"/></>,
    wallet: <><path d="M20 8V5H5a3 3 0 0 0 0 6h16v9H5a3 3 0 0 1-3-3V8"/><path d="M17 13h5v5h-5a2.5 2.5 0 0 1 0-5Z"/></>,
    segments: <><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M1 21v-3a6 6 0 0 1 12 0v3m2-9a6 6 0 0 1 8 6v3"/></>,
    retention: <><path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6"/><path d="M12 7v5l3 2"/></>,
    branches: <><path d="M12 3v8M5 15v-4h14v4"/><rect x="8" y="1" width="8" height="4" rx="1"/><rect x="1" y="16" width="8" height="6" rx="1"/><rect x="15" y="16" width="8" height="6" rx="1"/></>,
    scan: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 12h18M8 8v8m4-8v8m4-8v8"/></>,
    share: <><path d="M12 16V3m-5 5 5-5 5 5M5 12H3v9h18v-9h-2"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>, down: <path d="m6 9 6 6 6-6"/>,
    install: <><path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5"/></>,
    logout: <><path d="M9 3H3v18h6m5-14 5 5-5 5m-7-5h12"/></>,
  }
  return <svg className={`lt-owner-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.card}</svg>
}
const tabTitles = {
  tree: 'Overview', customers: 'Customers', program: 'Loyalty card', analytics: 'Analytics', announcements: 'Announcements', staff: 'Team & locations',
  qrmenu: 'QR Menu', orderahead: 'Order Ahead', giftcards: 'Gift cards', ltbenefits: 'LT Rewards', pos: 'Integrations', campaigns: 'Campaigns',
  satisfaction: 'Satisfaction', billing: 'Billing', referrals: 'Referrals', security: 'Transactions & security',
  walletqueue: 'Wallet queue', crm: 'Customer segments', retention: 'Retention', operations: 'Branch operations',
}
const advancedTabs = ['security', 'walletqueue', 'crm', 'retention', 'operations']

export default function OwnerDashboardNavigation({
  activeTab, onNavigate, onAnalytics, onAnnouncements, onSetup, onSupport, onScan, onShare,
  onInstall, onLogout, businessName, ownerName, planLabel, needsRenewal, renewalText,
  orderAheadEnabled, isStandaloneApp,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches)
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedTabs.includes(activeTab))
  const sidebarRef = useRef(null)
  const launcherRef = useRef(null)
  const closeButtonRef = useRef(null)
  const sidebarId = useId()
  const advancedId = useId()
  const name = businessName || 'Your business'
  const initials = (ownerName || name).trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)')
    const update = () => { setIsMobile(media.matches); if (!media.matches) setDrawerOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => { if (advancedTabs.includes(activeTab)) setAdvancedOpen(true) }, [activeTab])
  const closeDrawer = () => {
    setDrawerOpen(false)
    if (launcherRef.current?.isConnected) launcherRef.current.focus()
  }
  const openDrawer = event => { launcherRef.current = event.currentTarget; setDrawerOpen(true) }
  const act = callback => { if (drawerOpen) closeDrawer(); callback?.() }
  const navigateTo = tab => act(() => onNavigate?.(tab))
  useEffect(() => {
    if (!isMobile || !drawerOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); setDrawerOpen(false); launcherRef.current?.focus()
      } else if (event.key === 'Tab') {
        const focusable = [...sidebarRef.current.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length)
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || !sidebarRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow }
  }, [isMobile, drawerOpen])
  const item = (id, label, icon, callback, extra = false) => <button
    key={id} type="button" className={`lt-owner-nav-item${activeTab === id ? ' is-active' : ''}${extra ? ' lt-owner-nav-extra' : ''}`}
    onClick={callback || (() => navigateTo(id))} aria-current={activeTab === id ? 'page' : undefined} aria-label={label} title={label}
  ><Icon name={icon}/><span className="lt-owner-nav-label">{label}</span>{id === 'billing' && needsRenewal && <span className="lt-owner-renewal-dot" aria-label="Renewal due"/>}</button>
  return <>
    {isMobile && drawerOpen && <button type="button" className="lt-owner-sidebar-backdrop" onClick={closeDrawer} tabIndex={-1} aria-label="Close navigation"/>}
    <aside ref={sidebarRef} id={sidebarId} className={`lt-owner-sidebar${drawerOpen ? ' is-open' : ''}`}
      role={isMobile && drawerOpen ? 'dialog' : undefined} aria-modal={isMobile && drawerOpen ? 'true' : undefined}
      aria-label="Owner navigation" aria-hidden={isMobile && !drawerOpen ? 'true' : undefined} inert={isMobile && !drawerOpen ? '' : undefined}>
      <div className="lt-owner-brand-row">
        <button type="button" className="lt-owner-brand" onClick={() => navigateTo('tree')} aria-label="Loyalty Tree overview"><img className="lt-owner-brand-logo" src={loyaltyTreeLogo} alt=""/><span className="lt-owner-brand-word">Loyalty Tree<small>BUSINESS WORKSPACE</small></span></button>
        <button type="button" ref={closeButtonRef} className="lt-owner-drawer-close" onClick={closeDrawer} aria-label="Close navigation"><Icon name="close"/></button>
      </div>
      <div className="lt-owner-workspace" title={name}><span className="lt-owner-workspace-monogram">{name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><span>Owner dashboard</span></div></div>
      <nav className="lt-owner-nav" aria-label="Business dashboard">
        <div className="lt-owner-nav-section">WORKSPACE</div>
        {item('tree', 'Overview', 'home')}{item('customers', 'Customers', 'people')}{item('program', 'Loyalty card', 'card')}
        {item('analytics', 'Analytics', 'chart', () => act(onAnalytics))}
        <div className="lt-owner-nav-section">GROW</div>
        {item('announcements', 'Announcements', 'announcement', () => act(onAnnouncements))}
        {item('ltbenefits', 'LT Rewards', 'gift')}
        {item('campaigns', 'Campaigns', 'campaign')}{item('satisfaction', 'Satisfaction', 'star')}
        <div className="lt-owner-nav-section">OPERATE</div>
        {item('staff', 'Team & locations', 'team')}{item('qrmenu', 'QR Menu', 'scan')}{orderAheadEnabled && item('orderahead', 'Order Ahead', 'bag')}
        {item('giftcards', 'Gift cards', 'gift')}{item('pos', 'Integrations', 'plug')}
        <button type="button" className={`lt-owner-nav-item lt-owner-advanced-toggle${advancedTabs.includes(activeTab) ? ' is-active' : ''}`} onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen} aria-controls={advancedId} aria-label="Advanced tools" title="Advanced tools"><Icon name="more"/><span className="lt-owner-nav-label">Advanced tools</span><Icon name="down" className={advancedOpen ? 'lt-owner-chevron is-open' : 'lt-owner-chevron'}/></button>
        <div id={advancedId} className="lt-owner-advanced" hidden={!advancedOpen}>
          {item('security', 'Transactions & security', 'security', undefined, true)}{item('walletqueue', 'Wallet queue', 'wallet', undefined, true)}
          {item('crm', 'Customer segments', 'segments', undefined, true)}{item('retention', 'Retention', 'retention', undefined, true)}{item('operations', 'Branch operations', 'branches', undefined, true)}
        </div>
      </nav>
      <div className="lt-owner-sidebar-footer">
        {planLabel && <div className="lt-owner-plan"><span>YOUR PLAN</span><strong>{planLabel}</strong><button type="button" onClick={() => navigateTo('billing')}>Manage plan <Icon name="chevron"/></button></div>}
        {item('billing', 'Billing', 'billing')}{item('referrals', 'Referrals', 'referrals')}
        {item('setup', 'Setup guide', 'setup', () => act(onSetup))}{item('support', 'Help & support', 'help', () => act(onSupport))}
        {onInstall && <button type="button" className="lt-owner-nav-item lt-owner-install" disabled={isStandaloneApp} onClick={() => act(onInstall)} aria-label={isStandaloneApp ? 'App installed' : 'Add to Home Screen'} title={isStandaloneApp ? 'App installed' : 'Add to Home Screen'}><Icon name="install"/><span className="lt-owner-nav-label">{isStandaloneApp ? 'App installed' : 'Add to Home Screen'}</span></button>}
        <button type="button" className="lt-owner-nav-item lt-owner-logout" onClick={() => act(onLogout)} aria-label="Log out" title="Log out"><Icon name="logout"/><span className="lt-owner-nav-label">Log out</span></button>
      </div>
    </aside>
    <header className="lt-owner-topbar">
      <div className="lt-owner-breadcrumbs">
        <button type="button" className="lt-owner-menu-button" onClick={openDrawer} aria-label="Open dashboard navigation" aria-expanded={drawerOpen} aria-controls={sidebarId}><Icon name="menu"/></button>
        <span className="lt-owner-breadcrumb-business" title={name}>{name}</span><Icon name="chevron"/><strong>{tabTitles[activeTab] || 'Overview'}</strong>
      </div>
      <div className="lt-owner-top-actions">
        {needsRenewal && <button type="button" className="lt-owner-renewal" onClick={() => navigateTo('billing')}>{renewalText || 'Renew your subscription'}</button>}
        <button type="button" className="lt-owner-top-icon" onClick={() => act(onShare)} title="Share customer join QR" aria-label="Share customer join QR"><Icon name="share"/></button>
        <div className="lt-owner-profile"><span className="lt-owner-avatar" aria-hidden="true">{initials}</span><div><strong>{ownerName || 'Business owner'}</strong><span>Owner</span></div></div>
      </div>
    </header>
    <nav className="lt-owner-mobile-bottom" aria-label="Quick navigation">
      <button type="button" className={activeTab === 'tree' ? 'is-active' : ''} onClick={() => navigateTo('tree')} aria-current={activeTab === 'tree' ? 'page' : undefined}><Icon name="home"/><span>Home</span></button>
      <button type="button" className={activeTab === 'customers' ? 'is-active' : ''} onClick={() => navigateTo('customers')} aria-current={activeTab === 'customers' ? 'page' : undefined}><Icon name="people"/><span>Customers</span></button>
      <button type="button" className="lt-owner-mobile-scan" onClick={() => act(onScan)} aria-label="Scan customer card"><Icon name="scan"/><span>Scan</span></button>
      <button type="button" className={activeTab === 'analytics' ? 'is-active' : ''} aria-current={activeTab === 'analytics' ? 'page' : undefined} onClick={() => act(onAnalytics)}><Icon name="chart"/><span>Analytics</span></button>
      <button type="button" className={drawerOpen ? 'is-active' : ''} onClick={openDrawer} aria-label="More dashboard navigation" aria-expanded={drawerOpen} aria-controls={sidebarId}><Icon name="more"/><span>More</span></button>
    </nav>
  </>
}

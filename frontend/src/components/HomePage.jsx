import React from 'react'
import { useNavigate } from 'react-router-dom'

const FEATURES = [
  {
    icon: '📱',
    title: 'Digital stamp cards',
    body: 'No punch cards to lose or forget. Customers collect stamps and watch their reward get closer with every visit.',
  },
  {
    icon: '👛',
    title: 'Lives in their wallet',
    body: 'Cards push straight to Google Wallet, so customers don\u2019t need to install an app to start collecting.',
  },
  {
    icon: '🔑',
    title: 'PIN check-in for staff',
    body: 'Each staff member gets their own PIN to add stamps and redeem rewards at checkout \u2014 no shared logins.',
  },
  {
    icon: '📊',
    title: 'See what\u2019s working',
    body: 'Track visits, redemptions, and repeat customers over time, broken down by day and by trend.',
  },
  {
    icon: '📣',
    title: 'Announcements',
    body: 'Push a message straight to customers\u2019 wallet passes \u2014 a new item, a limited-time offer, a thank you.',
  },
  {
    icon: '🎨',
    title: 'Your brand, not ours',
    body: 'Set your logo, your colors, your reward, and your stamp goal. It looks like your business, not a template.',
  },
]

const STEPS = [
  { n: '1', title: 'Set up your card', body: 'Pick your stamp goal, your reward, and your colors. Takes a few minutes.' },
  { n: '2', title: 'Share your QR code', body: 'Customers scan it once and their card saves straight to their phone.' },
  { n: '3', title: 'Stamp at checkout', body: 'Your staff adds a stamp with their PIN. The reward unlocks itself.' },
]

function HomePage({ onNavigateLogin }) {
  const navigate = useNavigate()
  const goToLogin = onNavigateLogin || (() => navigate('/login'))

  return (
    <div style={styles.page}>
      <header style={styles.nav}>
        <div style={styles.brand}>
          <span style={styles.logo}>🌳</span>
          <span style={styles.brandName}>LoyaltyTree</span>
        </div>
        <button onClick={goToLogin} style={styles.navBtn}>Business Login</button>
      </header>

      <section style={styles.hero}>
        <div style={styles.heroInner}>
          <h1 style={styles.h1}>Turn regulars into a growing tree of loyal customers</h1>
          <p style={styles.heroSub}>
            A digital stamp card for your business that lives in your customers' phone wallet \u2014
            no app to download, no punch cards to lose.
          </p>
          <button onClick={goToLogin} style={styles.heroBtn}>🌱 Business Login</button>
        </div>
        <div style={styles.heroVisual} aria-hidden="true">
          <div style={styles.heroCard}>
            <div style={styles.heroCardHeader}>
              <span>Free Coffee</span>
              <span style={{ fontSize: 12, opacity: 0.85 }}>Corner Cafe</span>
            </div>
            <div style={styles.heroStampRow}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ ...styles.heroStamp, background: i < 5 ? '#0d9488' : '#e2e8f0' }} />
              ))}
            </div>
            <div style={styles.heroCardFoot}>5 of 8 stamps &middot; 3 to go</div>
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>What your customers get</h2>
        <div style={styles.featureGrid}>
          {FEATURES.map(f => (
            <div key={f.title} style={styles.featureCard}>
              <span style={styles.featureIcon}>{f.icon}</span>
              <h3 style={styles.featureTitle}>{f.title}</h3>
              <p style={styles.featureBody}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...styles.section, background: '#f0fdf4' }}>
        <h2 style={styles.h2}>How it works</h2>
        <div style={styles.stepsRow}>
          {STEPS.map(s => (
            <div key={s.n} style={styles.step}>
              <div style={styles.stepNumber}>{s.n}</div>
              <h3 style={styles.featureTitle}>{s.title}</h3>
              <p style={styles.featureBody}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.ctaSection}>
        <h2 style={{ ...styles.h2, color: 'white' }}>Ready to grow your regulars?</h2>
        <p style={styles.ctaSub}>Log in to your business account to set up or manage your loyalty card.</p>
        <button onClick={goToLogin} style={styles.ctaBtn}>Business Login</button>
      </section>

      <footer style={styles.footer}>
        <span>🌳 LoyaltyTree</span>
        <span style={styles.footerNote}>Where businesses grow with customers</span>
      </footer>
    </div>
  )
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#0f172a',
  },
  nav: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '18px 32px', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)',
    position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid rgba(13,148,136,0.1)',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { fontSize: 26 },
  brandName: { fontWeight: 700, fontSize: 18, color: '#0f766e' },
  navBtn: {
    padding: '10px 20px', background: '#0d9488', color: 'white', border: 'none',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  hero: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 40,
    padding: '72px 32px', maxWidth: 1100, margin: '0 auto', flexWrap: 'wrap',
  },
  heroInner: { flex: '1 1 420px', maxWidth: 540 },
  h1: { fontSize: 40, lineHeight: 1.15, margin: '0 0 16px', fontWeight: 800, color: '#0f172a' },
  heroSub: { fontSize: 17, lineHeight: 1.6, color: '#475569', margin: '0 0 28px' },
  heroBtn: {
    padding: '16px 28px', background: '#0d9488', color: 'white', border: 'none',
    borderRadius: 14, fontSize: 16, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(13,148,136,0.3)',
  },
  heroVisual: { flex: '1 1 260px', display: 'flex', justifyContent: 'center' },
  heroCard: {
    width: 260, borderRadius: 20, background: 'white', boxShadow: '0 20px 50px rgba(0,0,0,0.12)',
    padding: 20, transform: 'rotate(-3deg)',
  },
  heroCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: '#0d9488', color: 'white', borderRadius: 12, padding: '10px 14px',
    fontWeight: 700, marginBottom: 16,
  },
  heroStampRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 },
  heroStamp: { width: '100%', aspectRatio: '1', borderRadius: '50%' },
  heroCardFoot: { fontSize: 12, color: '#64748b', textAlign: 'center' },
  section: { padding: '64px 32px', maxWidth: 1100, margin: '0 auto' },
  h2: { fontSize: 28, fontWeight: 800, textAlign: 'center', margin: '0 0 40px', color: '#0f172a' },
  featureGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24,
  },
  featureCard: {
    background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24,
  },
  featureIcon: { fontSize: 28, display: 'block', marginBottom: 12 },
  featureTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 8px', color: '#0f172a' },
  featureBody: { fontSize: 14, lineHeight: 1.6, color: '#64748b', margin: 0 },
  stepsRow: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32,
    maxWidth: 900, margin: '0 auto',
  },
  step: { textAlign: 'center' },
  stepNumber: {
    width: 40, height: 40, borderRadius: '50%', background: '#0d9488', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
    margin: '0 auto 16px', fontSize: 16,
  },
  ctaSection: {
    textAlign: 'center', padding: '72px 32px',
    background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)', color: 'white',
  },
  ctaSub: { fontSize: 15, color: 'rgba(255,255,255,0.85)', margin: '0 0 28px' },
  ctaBtn: {
    padding: '16px 32px', background: 'white', color: '#0f766e', border: 'none',
    borderRadius: 14, fontSize: 16, fontWeight: 700, cursor: 'pointer',
  },
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '24px 32px', fontSize: 13, color: '#94a3b8', flexWrap: 'wrap', gap: 8,
  },
  footerNote: { fontSize: 12, color: '#cbd5e1' },
}

export default HomePage

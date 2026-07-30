import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo192 from './logo-192.png'
import logo64 from './logo-64.png'

const FEATURES = [
  {
    icon: '📱',
    title: 'Digital stamp cards',
    body: 'No punch cards to lose or forget. Customers collect stamps and watch their reward get closer with every visit.',
  },
  {
    icon: '👛',
    title: 'Lives in their wallet',
    body: 'Cards push straight to Google Wallet and Apple Wallet \u2014 no app to install, no account to create.',
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

const COMPARISON = [
  {
    traditional: 'Gets left at home, lost in a drawer, or thrown out with old receipts',
    digital: 'Lives in the phone customers already carry everywhere \u2014 nothing to lose',
  },
  {
    traditional: 'Easy to fake, over-stamp, or forget to punch at checkout',
    digital: 'Every stamp is logged by staff PIN, so counts stay accurate and trustworthy',
  },
  {
    traditional: "Owner has no idea how many cards are out there or who's close to a reward",
    digital: 'Owner sees every customer, every stamp, and every trend in one dashboard',
  },
  {
    traditional: 'No way to reach a customer once they walk out the door',
    digital: 'Send announcements straight to the wallet pass \u2014 a new item, an offer, a thank you',
  },
  {
    traditional: 'A generic paper card that looks like everyone else\u2019s',
    digital: 'Branded with your logo, your colors, and your reward \u2014 looks like your business',
  },
  {
    traditional: 'Printing, restocking, and replacing cards costs money every month',
    digital: 'One-time setup, no printing, no restocking \u2014 the card never runs out',
  },
]

const PILLARS = [
  {
    icon: '📣',
    title: 'Marketing',
    body: 'Push announcements, birthday greetings, and review prompts straight to your customers\u2019 phones \u2014 no ad spend, no mailing list.',
  },
  {
    icon: '🔁',
    title: 'Customer Retention',
    body: 'Stamps, rewards, and win-back messages keep regulars coming back \u2014 automatically, without your staff lifting a finger.',
  },
  {
    icon: '🌱',
    title: 'Zero Ecological Waste',
    body: 'No paper punch cards, no plastic cards, no printing. Every loyalty card lives digitally in a customer\u2019s existing wallet app.',
  },
]

const SCAN_STEPS = [
  {
    n: '1',
    icon: '📲',
    title: 'Scan to Join',
    body: 'Customers scan your QR code once and their card saves straight to their phone \u2014 no app to download, no form to fill out.',
  },
  {
    n: '2',
    icon: '✅',
    title: 'Scan to Stamp',
    body: 'At checkout, staff scan the same code to add a stamp. It updates instantly on the card already sitting in their wallet.',
  },
]

const STEPS = [
  { n: '1', title: 'Set up your card', body: 'Pick your stamp goal, your reward, and your colors. Takes a few minutes.' },
  { n: '2', title: 'Share your QR code', body: 'Customers scan it once and their card saves straight to their phone.' },
  { n: '3', title: 'Stamp at checkout', body: 'Your staff adds a stamp with their PIN. The reward unlocks itself.' },
]

const CARD_TYPES = [
  { key: 'stamps', icon: '🎟️', title: 'Stamps', available: true },
  { key: 'cashback', icon: '💵', title: 'Cashback', available: false },
  { key: 'discount', icon: '🏷️', title: 'Discount', available: false },
  { key: 'multipass', icon: '🎫', title: 'Multipass', available: false },
  { key: 'membership', icon: '🪪', title: 'Membership', available: false },
  { key: 'giftcard', icon: '🎁', title: 'Gift Card', available: false },
  { key: 'vip', icon: '👑', title: 'VIP Cards', available: false },
  { key: 'nfc', icon: '📡', title: 'NFC Enabled Cards', available: false },
]

const BRANCH_TIERS = [
  { key: '1', label: '1 branch' },
  { key: '2-3', label: '2\u20133 branches' },
  { key: '5', label: 'Up to 5 branches' },
]

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    prices: { '1': 350, '2-3': 550, '5': 750 },
    features: [
      'Google Wallet & Apple Wallet',
      '2 announcements per month',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Customer service',
    ],
  },
  {
    key: 'growth',
    name: 'Growth',
    prices: { '1': 550, '2-3': 750, '5': 950 },
    features: [
      'Google Wallet & Apple Wallet',
      '5 announcements per month',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Google review prompt',
      'Birthday automated greetings',
      'Customer service',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    highlight: true,
    prices: { '1': 750, '2-3': 950, '5': 1150 },
    features: [
      'Google Wallet & Apple Wallet',
      '5 announcements per month',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Google review prompt',
      'Birthday automated greetings',
      'Up to 3 different loyalty cards in circulation',
      "Win-back system (message if 30 days pass without a stamp)",
      'Customer service',
    ],
  },
  {
    key: 'ultra',
    name: 'Ultra',
    comingSoon: true,
    features: [
      'Google Wallet & Apple Wallet',
      '5 announcements per month',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Google review prompt',
      'Birthday automated greetings',
      'Up to 3 different loyalty cards in circulation',
      "Win-back system (message if 30 days pass without a stamp)",
      'Customer service',
      'Geo-based notifications',
      'Early order',
    ],
  },
]

function HomePage({ onNavigateLogin }) {
  const navigate = useNavigate()
  const goToLogin = onNavigateLogin || (() => navigate('/login'))

  const [activeCard, setActiveCard] = useState(null) // e.g. 'stamps'
  const [modalView, setModalView] = useState('sample') // 'sample' | 'pricing'
  const [branchTier, setBranchTier] = useState('1')

  const openCard = (card) => {
    if (!card.available) return
    setActiveCard(card.key)
    setModalView('sample')
  }

  const closeModal = () => {
    setActiveCard(null)
    setModalView('sample')
  }

  return (
    <div style={styles.page}>
      <header style={styles.nav}>
        <div style={styles.brand}>
          <img src={logo192} alt="LoyaltyTree" style={styles.logo} />
          <span style={styles.brandName}>LoyaltyTree</span>
        </div>
        <button onClick={goToLogin} style={styles.navBtn}>Business Login</button>
      </header>

      <section style={styles.hero}>
        <div style={styles.heroInner}>
          <h1 style={styles.h1}>Marketing Just Got Smarter. Loyalty Just Got Automated.</h1>
          <p style={styles.heroSub}>
            One digital loyalty card that markets to your customers, keeps them coming back, and
            replaces paper punch cards entirely &mdash; no app to download, no printing, no waste.
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

      <section style={styles.pillarSection}>
        <div style={styles.pillarGrid}>
          {PILLARS.map(p => (
            <div key={p.title} style={styles.pillarCard}>
              <span style={styles.pillarIcon}>{p.icon}</span>
              <h3 style={styles.pillarTitle}>{p.title}</h3>
              <p style={styles.pillarBody}>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.scanSection}>
        <span style={styles.scanEyebrow}>No app needed</span>
        <h2 style={styles.h2}>Scan to Join. Scan to Stamp.</h2>
        <p style={styles.scanIntro}>
          That's the whole system. No applications needed &mdash; the card goes straight to your
          customer's Google Wallet or Apple Wallet, and stays there.
        </p>
        <div style={styles.scanRow}>
          {SCAN_STEPS.map((s, i) => (
            <React.Fragment key={s.n}>
              <div style={styles.scanCard}>
                <div style={styles.scanCardIcon}>{s.icon}</div>
                <div style={styles.scanCardBadge}>Step {s.n}</div>
                <h3 style={styles.scanCardTitle}>{s.title}</h3>
                <p style={styles.scanCardBody}>{s.body}</p>
              </div>
              {i === 0 && <div style={styles.scanArrow} aria-hidden="true">&rarr;</div>}
            </React.Fragment>
          ))}
        </div>
        <div style={styles.walletRow}>
          <span style={styles.walletPill}>📱 Google Wallet</span>
          <span style={styles.walletPill}>🍎 Apple Wallet</span>
        </div>
      </section>

      <section style={{ ...styles.section, paddingTop: 0 }}>
        <h2 style={styles.h2}>Why a digital loyalty card wins</h2>
        <p style={styles.comparisonIntro}>
          A loyalty program only works if customers actually keep coming back to use it.
          Paper punch cards were never built for that &mdash; they get lost, forgotten, and thrown away
          before the reward is ever earned. A digital card removes every one of those friction points
          by living somewhere customers never lose: their phone.
        </p>
        <style>{`
          @media (max-width: 640px) {
            .lt-comparison-row { grid-template-columns: 1fr !important; }
            .lt-comparison-cell-bad { border-right: none !important; border-bottom: 1px solid #f1f5f9; }
          }
        `}</style>
        <div style={styles.comparisonTable}>
          <div className="lt-comparison-row" style={styles.comparisonHeaderRow}>
            <div style={styles.comparisonHeaderCell}>
              <span style={styles.comparisonHeaderIcon}>🧾</span>
              Traditional punch card
            </div>
            <div style={{ ...styles.comparisonHeaderCell, ...styles.comparisonHeaderCellGood }}>
              <span style={styles.comparisonHeaderIcon}>📱</span>
              LoyaltyTree digital card
            </div>
          </div>
          {COMPARISON.map((row, i) => (
            <div key={i} className="lt-comparison-row" style={styles.comparisonRow}>
              <div className="lt-comparison-cell-bad" style={{ ...styles.comparisonCell, ...styles.comparisonCellBad }}>
                <span style={{ ...styles.comparisonMark, ...styles.comparisonMarkBad }}>✕</span>
                <span>{row.traditional}</span>
              </div>
              <div style={{ ...styles.comparisonCell, ...styles.comparisonCellGood }}>
                <span style={{ ...styles.comparisonMark, ...styles.comparisonMarkGood }}>✓</span>
                <span>{row.digital}</span>
              </div>
            </div>
          ))}
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

      <section style={styles.section}>
        <h2 style={styles.h2}>Choose your card type</h2>
        <p style={styles.cardTypesIntro}>Stamps is live today. Everything else is on its way.</p>
        <div style={styles.cardTypesGrid}>
          {CARD_TYPES.map(c => (
            <button
              key={c.key}
              onClick={() => openCard(c)}
              style={{
                ...styles.cardTypeItem,
                ...(c.available ? styles.cardTypeItemAvailable : styles.cardTypeItemDisabled),
              }}
              disabled={!c.available}
            >
              <span style={styles.cardTypeIcon}>{c.icon}</span>
              <span style={styles.cardTypeTitle}>{c.title}</span>
              {c.available ? (
                <span style={styles.availableBadge}>Available</span>
              ) : (
                <span style={styles.comingSoonBadge}>Coming soon</span>
              )}
            </button>
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
        <span style={styles.footerBrand}>
          <img src={logo64} alt="LoyaltyTree" style={styles.footerLogo} />
          LoyaltyTree
        </span>
        <span style={styles.footerNote}>Marketing, retention, and zero-waste loyalty &mdash; automated</span>
      </footer>

      {activeCard === 'stamps' && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <button onClick={closeModal} style={styles.modalCloseBtn} aria-label="Close">✕</button>

            {modalView === 'sample' ? (
              <>
                <h2 style={styles.modalTitle}>Sample: Stamps card</h2>
                <p style={styles.modalSubtitle}>This is what your customers see on their phone.</p>
                <div style={styles.sampleWrap}>
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
                <button onClick={() => setModalView('pricing')} style={styles.pricingBtn}>
                  See pricing
                </button>
              </>
            ) : (
              <>
                <h2 style={styles.modalTitle}>Stamps pricing</h2>
                <p style={styles.modalSubtitle}>Pick the plan and branch count that fits your business.</p>

                <div style={styles.branchTierRow}>
                  {BRANCH_TIERS.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setBranchTier(t.key)}
                      style={{
                        ...styles.branchTierBtn,
                        ...(branchTier === t.key ? styles.branchTierBtnActive : {}),
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div style={styles.pricingGrid}>
                  {PLANS.map(p => (
                    <div key={p.key} style={{ ...styles.planCard, ...(p.highlight ? styles.planCardHighlight : {}) }}>
                      {p.highlight && <div style={styles.planBadge}>Most popular</div>}
                      <div style={styles.planName}>{p.name}</div>
                      {p.comingSoon ? (
                        <div style={styles.planPriceComingSoon}>Coming soon</div>
                      ) : (
                        <div style={styles.planPrice}>
                          ₱{p.prices[branchTier].toLocaleString()}
                          <span style={styles.planPriceUnit}>/mo</span>
                        </div>
                      )}
                      <ul style={styles.planFeatureList}>
                        {p.features.map(f => (
                          <li key={f} style={styles.planFeatureItem}>
                            <span style={styles.planFeatureCheck}>✓</span> {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <p style={styles.contactNote}>
                  6 branches or more? Let's talk it through together &mdash; email{' '}
                  <a href="mailto:connect.aliciabrewery@gmail.com" style={styles.contactLink}>connect.aliciabrewery@gmail.com</a>
                </p>

                <button onClick={() => setModalView('sample')} style={styles.backBtn}>
                  &larr; Back to sample
                </button>
              </>
            )}
          </div>
        </div>
      )}
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
  logo: { width: 32, height: 32, borderRadius: '50%', display: 'block' },
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

  // Marketing / Retention / Zero Waste pillars
  pillarSection: {
    padding: '0 32px 64px', maxWidth: 1100, margin: '0 auto',
  },
  pillarGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20,
  },
  pillarCard: {
    background: 'white', border: '1px solid #e2e8f0', borderRadius: 18,
    padding: '28px 24px', textAlign: 'center', boxShadow: '0 4px 14px rgba(15,23,42,0.04)',
  },
  pillarIcon: { fontSize: 30, display: 'block', marginBottom: 12 },
  pillarTitle: { fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' },
  pillarBody: { fontSize: 14, lineHeight: 1.6, color: '#64748b', margin: 0 },

  // Scan to Join / Scan to Stamp section
  scanSection: {
    padding: '56px 32px 64px', maxWidth: 1000, margin: '0 auto', textAlign: 'center',
  },
  scanEyebrow: {
    display: 'inline-block', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: '#0d9488', background: '#ccfbf1',
    borderRadius: 999, padding: '6px 14px', marginBottom: 14,
  },
  scanIntro: {
    fontSize: 15, lineHeight: 1.7, color: '#475569', maxWidth: 560, margin: '-16px auto 40px',
  },
  scanRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20,
    flexWrap: 'wrap', marginBottom: 32,
  },
  scanCard: {
    flex: '1 1 260px', maxWidth: 300, background: 'white', border: '1.5px solid #e2e8f0',
    borderRadius: 20, padding: '32px 24px', boxShadow: '0 10px 30px rgba(15,23,42,0.06)',
  },
  scanCardIcon: { fontSize: 36, marginBottom: 10 },
  scanCardBadge: {
    display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#0d9488',
    background: '#f0fdfa', borderRadius: 999, padding: '3px 12px', marginBottom: 10,
  },
  scanCardTitle: { fontSize: 19, fontWeight: 800, margin: '0 0 8px', color: '#0f172a' },
  scanCardBody: { fontSize: 13.5, lineHeight: 1.6, color: '#64748b', margin: 0 },
  scanArrow: { fontSize: 26, color: '#0d9488', fontWeight: 700 },
  walletRow: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  walletPill: {
    fontSize: 13.5, fontWeight: 600, color: '#0f172a', background: '#f8fafc',
    border: '1px solid #e2e8f0', borderRadius: 999, padding: '8px 16px',
  },

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
  footerBrand: { display: 'flex', alignItems: 'center', gap: 6 },
  footerLogo: { width: 18, height: 18, borderRadius: '50%', display: 'block' },

  // Comparison section
  comparisonIntro: {
    textAlign: 'center', fontSize: 15, lineHeight: 1.7, color: '#475569',
    maxWidth: 680, margin: '-16px auto 40px',
  },
  comparisonTable: {
    display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 900, margin: '0 auto',
    border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden',
  },
  comparisonHeaderRow: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
  },
  comparisonHeaderCell: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '16px 12px', fontSize: 14, fontWeight: 700, color: '#64748b', background: '#f8fafc',
    textAlign: 'center',
  },
  comparisonHeaderCellGood: {
    background: '#0d9488', color: 'white',
  },
  comparisonHeaderIcon: { fontSize: 16 },
  comparisonRow: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #f1f5f9',
  },
  comparisonCell: {
    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 18px',
    fontSize: 13.5, lineHeight: 1.5,
  },
  comparisonCellBad: {
    color: '#64748b', background: 'white', borderRight: '1px solid #f1f5f9',
  },
  comparisonCellGood: {
    color: '#0f172a', background: '#f0fdfa', fontWeight: 500,
  },
  comparisonMark: {
    fontWeight: 800, flexShrink: 0, marginTop: 1,
  },
  comparisonMarkBad: { color: '#f87171' },
  comparisonMarkGood: { color: '#0d9488' },

  // Card types section
  cardTypesIntro: { textAlign: 'center', fontSize: 14, color: '#64748b', margin: '-24px 0 32px' },
  cardTypesGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16,
  },
  cardTypeItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    borderRadius: 16, padding: '24px 16px', fontFamily: 'inherit',
    border: '1.5px solid #e2e8f0', background: 'white', position: 'relative',
  },
  cardTypeItemAvailable: {
    cursor: 'pointer', borderColor: '#0d9488', boxShadow: '0 4px 14px rgba(13,148,136,0.12)',
  },
  cardTypeItemDisabled: {
    cursor: 'not-allowed', opacity: 0.55,
  },
  cardTypeIcon: { fontSize: 30 },
  cardTypeTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', textAlign: 'center' },
  availableBadge: {
    fontSize: 11, fontWeight: 700, color: '#0d9488', background: '#ccfbf1',
    borderRadius: 20, padding: '3px 10px', marginTop: 2,
  },
  comingSoonBadge: {
    fontSize: 11, fontWeight: 600, color: '#94a3b8', background: '#f1f5f9',
    borderRadius: 20, padding: '3px 10px', marginTop: 2,
  },

  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16,
  },
  modal: {
    position: 'relative', background: 'white', borderRadius: 20, padding: '36px 28px',
    width: '100%', maxWidth: 880, maxHeight: '88vh', overflow: 'auto',
    boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
  },
  modalCloseBtn: {
    position: 'absolute', top: 18, right: 18, width: 32, height: 32, borderRadius: '50%',
    border: 'none', background: '#f1f5f9', color: '#475569', fontSize: 15, cursor: 'pointer',
  },
  modalTitle: { fontSize: 24, fontWeight: 800, margin: '0 0 6px', color: '#0f172a', textAlign: 'center' },
  modalSubtitle: { fontSize: 14, color: '#64748b', margin: '0 0 28px', textAlign: 'center' },
  sampleWrap: { display: 'flex', justifyContent: 'center', margin: '0 0 28px' },
  pricingBtn: {
    display: 'block', margin: '0 auto', padding: '14px 32px', background: '#0d9488',
    color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
    cursor: 'pointer', boxShadow: '0 8px 20px rgba(13,148,136,0.25)',
  },
  branchTierRow: {
    display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28,
  },
  branchTierBtn: {
    padding: '9px 16px', borderRadius: 999, border: '1.5px solid #e2e8f0', background: 'white',
    color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  branchTierBtnActive: {
    borderColor: '#0d9488', background: '#0d9488', color: 'white',
  },
  pricingGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16,
    marginBottom: 24,
  },
  planCard: {
    position: 'relative', border: '1.5px solid #e2e8f0', borderRadius: 16, padding: '20px 18px',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  planCardHighlight: {
    borderColor: '#0d9488', boxShadow: '0 10px 28px rgba(13,148,136,0.18)',
  },
  planBadge: {
    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
    background: '#0d9488', color: 'white', fontSize: 11, fontWeight: 700,
    padding: '4px 12px', borderRadius: 999, whiteSpace: 'nowrap',
  },
  planName: { fontSize: 16, fontWeight: 800, color: '#0f172a', textAlign: 'center' },
  planPrice: { fontSize: 26, fontWeight: 800, color: '#0d9488', textAlign: 'center' },
  planPriceUnit: { fontSize: 13, fontWeight: 600, color: '#94a3b8' },
  planPriceComingSoon: {
    fontSize: 15, fontWeight: 700, color: '#94a3b8', textAlign: 'center', padding: '4px 0',
  },
  planFeatureList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 },
  planFeatureItem: { fontSize: 12.5, color: '#475569', lineHeight: 1.4 },
  planFeatureCheck: { color: '#0d9488', fontWeight: 700 },
  contactNote: {
    textAlign: 'center', fontSize: 13, color: '#64748b', background: '#f8fafc',
    borderRadius: 10, padding: '14px 16px', margin: '0 0 20px',
  },
  contactLink: { color: '#0d9488', fontWeight: 700, textDecoration: 'none' },
  backBtn: {
    display: 'block', margin: '0 auto', background: 'transparent', border: 'none',
    color: '#0d9488', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
}

export default HomePage

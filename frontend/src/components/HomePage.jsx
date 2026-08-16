import React, { useState, useEffect } from 'react'
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

const PLATFORM_OVERVIEW = [
  {
    key: 'overview',
    icon: '📊',
    title: 'Overview',
    body: 'See activity, visits, rewards, retention, wallet updates, and loyalty performance in one place.',
  },
  {
    key: 'businesses',
    icon: '🏪',
    title: 'For Businesses',
    body: 'Create your card, manage branches and cashiers, run promotions, and keep every loyalty action organized.',
  },
  {
    key: 'customers',
    icon: '👥',
    title: 'For Customers',
    body: 'Join with a QR code, save the card to Apple Wallet or Google Wallet, earn rewards, and receive updates.',
  },
]

const INDUSTRIES=[
  {icon:'☕',title:'Coffee & Food',body:'Cafés, bakeries, restaurants and food businesses.',cards:'Stamps · Points · VIP'},
  {icon:'🏋️',title:'Fitness & Wellness',body:'Gyms, fitness studios, spas and wellness businesses.',cards:'Membership · Multipass · VIP'},
  {icon:'✂️',title:'Beauty & Personal Care',body:'Salons, barbers and personal-care businesses.',cards:'VIP · Stamps · Points'},
  {icon:'🧺',title:'Laundry',body:'Reward repeat wash, dry and fold customers.',cards:'Stamps · Points · Membership'},
  {icon:'⛽',title:'Gasoline Stations',body:'Reward frequent motorists and build stronger fleet loyalty.',cards:'Points · VIP · Stamps'},
  {icon:'🚿',title:'Automotive Services',body:'Car washes and repeat-service automotive businesses.',cards:'Stamps · Multipass · Points'},
  {icon:'🩺',title:'Clinics & Health',body:'Recurring wellness, clinic and pharmacy customers.',cards:'Membership · Points · Multipass'},
  {icon:'🛍️',title:'Retail',body:'Stores and merchants that want spend-based loyalty.',cards:'Points · VIP · Stamps'},
]

const CARD_TYPES = [
  { key: 'stamps', icon: '🎟️', title: 'Stamps', available: true },
  { key: 'coupons', icon: '✂️', title: 'Coupons', available: true },
  { key: 'points', icon: '⭐', title: 'Points', available: true },
  { key: 'cashback', icon: '💵', title: 'Cashback', available: false },
  { key: 'discount', icon: '🏷️', title: 'Discount', available: false },
  { key: 'multipass', icon: '🎫', title: 'Multipass', available: true },
  { key: 'membership', icon: '🪪', title: 'Membership', available: true },
  { key: 'giftcard', icon: '🎁', title: 'Gift Card', available: false },
  { key: 'vip', icon: '👑', title: 'VIP Cards', available: true },
]

// Sample-card visuals + copy shown in the "Choose your card type" modal.
// Keyed by CARD_TYPES[].key so the modal can look up whichever available
// card the merchant clicks, instead of hard-coding a single type.
const CARD_SAMPLES = {
  stamps: {
    name: 'Stamps',
    intro: 'Customers collect a stamp per visit and unlock a reward once the card is full.',
    render: (styles) => (
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
    ),
  },
  coupons: {
    name: 'Coupons',
    intro: 'Send a one-time discount or offer straight to a customer\u2019s wallet pass \u2014 they show it to redeem, staff marks it used.',
    render: (styles) => (
      <div style={styles.heroCard}>
        <div style={styles.heroCardHeader}>
          <span>20% Off</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Corner Cafe</span>
        </div>
        <div style={styles.couponBody}>
          <div style={styles.couponIcon}>✂️</div>
          <div style={styles.couponCode}>WELCOME20</div>
          <div style={styles.couponExpiry}>Valid until Aug 31</div>
        </div>
        <div style={styles.heroCardFoot}>Show this pass at checkout to redeem</div>
      </div>
    ),
  },
  points: {
    name: 'Points',
    intro: 'Customers earn points on every purchase and redeem them for rewards once they hit a threshold.',
    render: (styles) => (
      <div style={styles.heroCard}>
        <div style={styles.heroCardHeader}>
          <span>Rewards Points</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Corner Cafe</span>
        </div>
        <div style={styles.pointsBody}>
          <div style={styles.pointsValue}>1,240 <span style={styles.pointsUnit}>pts</span></div>
          <div style={styles.pointsToNext}>260 pts to next reward</div>
        </div>
        <div style={styles.heroCardFoot}>Earn 1 point per ₱50 spent</div>
      </div>
    ),
  },
  multipass: {
    name: 'Multipass',
    intro: 'Customers pay upfront for a set number of visits or sessions, then check in each time until the pass runs out.',
    render: (styles) => (
      <div style={styles.heroCard}>
        <div style={styles.heroCardHeader}>
          <span>10-Visit Pass</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Corner Cafe</span>
        </div>
        <div style={styles.heroStampRow}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{ ...styles.heroStamp, background: i < 4 ? '#0d9488' : '#e2e8f0' }} />
          ))}
        </div>
        <div style={styles.heroCardFoot}>4 of 10 visits used &middot; 6 remaining</div>
      </div>
    ),
  },

  membership: {
    name: 'Membership',
    intro: 'Run subscription and access programs with active status, renewal dates, and member perks.',
    render: (styles) => (
      <div style={styles.heroCard}>
        <div style={styles.heroCardHeader}>
          <span>Gym Membership</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Active Fitness</span>
        </div>
        <div style={styles.membershipBody}>
          <div style={styles.membershipStatus}>ACTIVE</div>
          <div style={styles.membershipDate}>Active until Sep 30, 2026</div>
          <div style={styles.membershipPerks}>✓ Unlimited access · ✓ Locker use</div>
        </div>
        <div style={styles.heroCardFoot}>Member ID · LT-2048</div>
      </div>
    ),
  },
  vip: {
    name: 'VIP Cards',
    intro: 'Reward your best customers with VIP points, automatic tier upgrades, and stronger benefits at every level.',
    render: (styles) => (
      <div style={styles.heroCard}>
        <div style={{ ...styles.heroCardHeader, background: '#a16207' }}>
          <span>Gold VIP</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Premier Retail</span>
        </div>
        <div style={styles.vipBody}>
          <div style={styles.vipTier}>GOLD</div>
          <div style={styles.vipPoints}>3,450 VIP points</div>
          <div style={styles.vipProgress}>550 points to Platinum</div>
        </div>
        <div style={styles.heroCardFoot}>10% discount · Priority service</div>
      </div>
    ),
  },
}

const BRANCH_TIERS = [
  { key: '1', label: '1 branch' },
  { key: '2-3', label: '2\u20133 branches' },
  { key: '5', label: 'Up to 5 branches' },
]

const PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    prices: { '1': 350, '2-3': 650, '5': 1300 },
    features: [
      'Google Wallet & Apple Wallet',
      '2 active announcements',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Birthday automated greetings',
      'Customer service',
    ],
  },
  {
    key: 'growth',
    name: 'Growth',
    highlight: true,
    prices: { '1': 550, '2-3': 1050, '5': 2100 },
    features: [
      'Google Wallet & Apple Wallet',
      'Up to 5 active announcements',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Google review prompt',
      'Birthday automated greetings',
      "Win-back system (message if 30 days pass without a stamp)",
      'Customer service',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    comingSoon: true,
    prices: { '1': 750, '2-3': 1450, '5': 2900 },
    features: [
      'Google Wallet & Apple Wallet',
      'Up to 7 active announcements',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Google review prompt',
      'Birthday automated greetings',
      'Up to 3 different loyalty cards in circulation',
      "Win-back system (message if 30 days pass without a stamp)",
      'Geo tagging',
      'Advance ordering',
      'Customer service',
    ],
  },
  {
    key: 'specialized',
    name: 'Specialized System',
    features: [
      'Specialized system for your business',
      'NFC & contactless integration — available for Specialized Businesses',
      'Google Wallet & Apple Wallet',
      'Up to 5 active announcements',
      'Full digital system',
      'Full loyalty card customization',
      'Analytics',
      'Google review prompt',
      'Birthday automated greetings',
      'Up to 3 different loyalty cards in circulation',
      "Win-back system (message if 30 days pass without a stamp)",
      'Geo tagging',
      'Advance ordering',
      'Customer service',
    ],
  },
]

function HomePage({ onNavigateLogin, API_BASE = '' }) {
  const navigate = useNavigate()
  const goToLogin = onNavigateLogin || (() => navigate('/login'))

  const [activeCard, setActiveCard] = useState(null) // e.g. 'stamps'
  const [modalView, setModalView] = useState('sample') // 'sample' | 'pricing'
  const [branchTier, setBranchTier] = useState('1')
  const [partners, setPartners] = useState([])
  const [partnersLoading, setPartnersLoading] = useState(true)
  const [partnersError, setPartnersError] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadPartners = async () => {
      const configuredBase = (API_BASE || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
      const candidates = [...new Set([
        configuredBase,
        'https://loyaltree-btw1.onrender.com',
        window.location.origin,
      ].filter(Boolean))]
      const errors = []

      try {
        let partnerRows = null

        for (const base of candidates) {
          try {
            const res = await fetch(`${base}/api/v1/public/partners?_=${Date.now()}`, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
              },
            })
            const raw = await res.text()
            let data = null
            try { data = raw ? JSON.parse(raw) : [] } catch (_) {}

            if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
            if (!Array.isArray(data)) throw new Error('Invalid partner response')

            partnerRows = data
            break
          } catch (err) {
            errors.push(`${base}: ${err.message}`)
          }
        }

        if (partnerRows === null) {
          throw new Error(errors.join(' | ') || 'No partner API could be reached')
        }

        if (!cancelled) {
          setPartners(partnerRows.filter(partner => partner?.logo_url && partner?.is_active !== false))
          setPartnersError('')
        }
      } catch (err) {
        if (!cancelled) {
          setPartners([])
          setPartnersError(err.message || 'Could not load homepage partners')
        }
      } finally {
        if (!cancelled) setPartnersLoading(false)
      }
    }

    loadPartners()

    // Keep the public partner showcase in sync with changes made from the
    // Admin Dashboard without requiring visitors to hard-refresh the page.
    const interval = window.setInterval(loadPartners, 30000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadPartners()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [API_BASE])

  const partnerLogoSrc = (partner) => {
    if (!partner?.logo_url) return ''
    const version = encodeURIComponent(partner.updated_at || partner.public_id || Date.now())
    return `${partner.logo_url}${partner.logo_url.includes('?') ? '&' : '?'}ltv=${version}`
  }

  const openCard = (card) => {
    if (!card.available) return
    setActiveCard(card.key)
    setModalView('sample')
  }

  const closeModal = () => {
    setActiveCard(null)
    setModalView('sample')
  }

  const scrollToSection = (id) => {
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openContact = () => {
    window.open('https://m.me/theloyaltytree', '_blank', 'noopener,noreferrer')
  }

  const goPublicPage = (path) => {
    window.location.assign(path)
  }

  return (
    <div style={styles.page}>
      <style>{`
        html { scroll-behavior: smooth; }
        .lt-home-navlinks { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; margin-left:auto; }
        .lt-how-menu { position:relative; }
        .lt-how-summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:5px; }
        .lt-how-summary::-webkit-details-marker { display:none; }
        .lt-how-dropdown {
          position:absolute; top:calc(100% + 8px); left:0; width:310px; background:white;
          border:1px solid #e2e8f0; border-radius:14px; padding:8px; box-shadow:0 18px 45px rgba(15,23,42,.14);
          z-index:100;
        }
        .lt-how-menu:not([open]) .lt-how-dropdown { display:none; }
        .lt-home-overview-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
        .lt-brand-pillars { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:0 0 22px; max-width:560px; }
        .lt-brand-pillar { min-width:0; }
        @media (max-width: 900px) {
          .lt-home-header { align-items:center !important; flex-wrap:wrap !important; padding:12px 16px !important; }
          .lt-home-navlinks { order:3; width:100%; margin-left:0 !important; justify-content:flex-start; flex-wrap:nowrap; overflow-x:auto; padding:8px 0 0; scrollbar-width:none; border-top:1px solid #f1f5f9; }
          .lt-home-navlinks::-webkit-scrollbar { display:none; }
          .lt-home-navlink { white-space:nowrap; }
          .lt-how-dropdown { position:fixed !important; left:14px !important; right:14px !important; top:auto !important; width:auto !important; }
          .lt-home-overview-grid { grid-template-columns:1fr !important; }
        }
        @media (max-width: 700px) {
          .lt-home-hero-actions { width:100%; }
          .lt-brand-pillars { gap:7px; margin-bottom:18px; }
          .lt-brand-pillar { padding:12px 8px !important; }
          .lt-brand-pillar-word { font-size:13px !important; }
          .lt-brand-pillar-copy { font-size:10px !important; }
        }
        @media (max-width: 560px) {
          .lt-home-login { padding:9px 12px !important; font-size:12px !important; }
        }
      `}</style>
      <header className="lt-home-header" style={styles.nav}>
        <button onClick={() => scrollToSection('top')} style={styles.brandButton} aria-label="Go to top">
          <img src={logo192} alt="LoyaltyTree" style={styles.logo} />
          <span style={styles.brandName}>LoyaltyTree</span>
        </button>

        <nav className="lt-home-navlinks" aria-label="Homepage navigation">
          <details className="lt-how-menu">
            <summary className="lt-home-navlink lt-how-summary" style={styles.navLink}>How It Works <span style={{fontSize:10}}>▾</span></summary>
            <div className="lt-how-dropdown">
              <button onClick={() => goPublicPage('/how-it-works')} style={styles.dropdownItem}>
                <span style={styles.dropdownIcon}>📊</span>
                <span><b>Overview</b><small style={styles.dropdownSmall}>See the complete LoyaltyTree flow</small></span>
              </button>
              <button onClick={() => goPublicPage('/how-it-works/businesses')} style={styles.dropdownItem}>
                <span style={styles.dropdownIcon}>🏪</span>
                <span><b>For Businesses</b><small style={styles.dropdownSmall}>Card setup, cashier, analytics and retention</small></span>
              </button>
              <button onClick={() => goPublicPage('/how-it-works/customers')} style={styles.dropdownItem}>
                <span style={styles.dropdownIcon}>👥</span>
                <span><b>For Customers</b><small style={styles.dropdownSmall}>Join, Wallet card, rewards and updates</small></span>
              </button>
            </div>
          </details>
          <button className="lt-home-navlink" onClick={() => goPublicPage('/how-it-works#pricing')} style={styles.navLink}>Pricing</button>
          <button className="lt-home-navlink" onClick={() => goPublicPage('/about')} style={styles.navLink}>About Us</button>
          <button className="lt-home-navlink" onClick={() => goPublicPage('/contact')} style={styles.navLink}>Contact Us</button>
        </nav>

        <button className="lt-home-login" onClick={goToLogin} style={styles.navBtn}>Business Login</button>
      </header>

      <section id="top" style={styles.hero}>
        <div style={styles.heroInner}>
          <div style={styles.heroEyebrow}>🌱 DIGITAL LOYALTY FOR SERVICE BUSINESSES</div>

          <div className="lt-brand-pillars" aria-label="Digitalize, Secure, Connect">
            <div className="lt-brand-pillar" style={styles.brandPillar}>
              <span style={styles.brandPillarIcon}>01</span>
              <strong className="lt-brand-pillar-word" style={styles.brandPillarWord}>DIGITALIZE</strong>
              <span className="lt-brand-pillar-copy" style={styles.brandPillarCopy}>Modernize loyalty</span>
            </div>
            <div className="lt-brand-pillar" style={styles.brandPillar}>
              <span style={styles.brandPillarIcon}>02</span>
              <strong className="lt-brand-pillar-word" style={styles.brandPillarWord}>SECURE</strong>
              <span className="lt-brand-pillar-copy" style={styles.brandPillarCopy}>Protect every interaction</span>
            </div>
            <div className="lt-brand-pillar" style={styles.brandPillar}>
              <span style={styles.brandPillarIcon}>03</span>
              <strong className="lt-brand-pillar-word" style={styles.brandPillarWord}>CONNECT</strong>
              <span className="lt-brand-pillar-copy" style={styles.brandPillarCopy}>Build lasting relationships</span>
            </div>
          </div>

          <h1 style={styles.h1}>Modernize the way you build customer relationships.</h1>
          <p style={styles.heroSub}>
            LoyaltyTree helps service businesses digitalize customer loyalty, keep every interaction
            organized and secure, and stay connected with customers beyond every visit.
          </p>
          <div className="lt-home-hero-actions" style={styles.heroActions}>
            <button onClick={goToLogin} style={styles.heroBtn}>Get Started for Your Business</button>
            <button onClick={() => goPublicPage('/how-it-works')} style={styles.heroSecondaryBtn}>See How It Works →</button>
          </div>
          <div style={styles.heroTrustRow}>
            <span>✓ No customer app</span>
            <span>✓ Apple & Google Wallet</span>
            <span>✓ Built for repeat business</span>
          </div>
        </div>

        <div style={styles.heroVisual} aria-label="LoyaltyTree digital loyalty preview">
          <div style={styles.heroVisualGlow}></div>
          <div style={styles.heroDashboardCard}>
            <div style={styles.heroDashboardTop}>
              <div>
                <div style={styles.heroMiniLabel}>LOYALTYTREE</div>
                <div style={styles.heroDashboardTitle}>Your customer relationship, in one place.</div>
              </div>
              <div style={styles.heroLiveBadge}>● LIVE</div>
            </div>

            <div style={styles.heroMetricGrid}>
              <div style={styles.heroMetric}>
                <strong style={styles.heroMetricValue}>128</strong>
                <span style={styles.heroMetricLabel}>Customers</span>
              </div>
              <div style={styles.heroMetric}>
                <strong style={styles.heroMetricValue}>342</strong>
                <span style={styles.heroMetricLabel}>Stamps</span>
              </div>
              <div style={styles.heroMetric}>
                <strong style={styles.heroMetricValue}>24</strong>
                <span style={styles.heroMetricLabel}>Rewards</span>
              </div>
            </div>

            <div style={styles.heroWalletCard}>
              <div style={styles.heroCardHeader}>
                <span>Free Coffee</span>
                <span style={{ fontSize: 12, opacity: 0.85 }}>Your Business</span>
              </div>
              <div style={styles.heroStampRow}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{ ...styles.heroStamp, background: i < 5 ? '#0d9488' : '#e2e8f0' }} />
                ))}
              </div>
              <div style={styles.heroCardFoot}>5 of 8 stamps &middot; 3 to your reward</div>
            </div>

            <div style={styles.heroNotification}>
              <span style={styles.heroNotificationIcon}>🎉</span>
              <div>
                <strong style={styles.heroNotificationTitle}>Stay connected after every visit</strong>
                <span style={styles.heroNotificationText}>Announcements, birthday greetings & wallet updates</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" style={styles.topHowSection}>
        <span style={styles.navSectionEyebrow}>Simple from day one</span>
        <h2 style={styles.h2Compact}>A better connection with every visit.</h2>
        <p style={styles.topSectionIntro}>
          Customers join once, keep your branded card in their phone, and your team manages loyalty, rewards, communication, and retention from one dashboard.
        </p>
        <div style={styles.topStepsGrid}>
          {STEPS.map(s => (
            <div key={s.n} style={styles.topStepCard}>
              <div style={styles.topStepNumber}>{s.n}</div>
              <h3 style={styles.featureTitle}>{s.title}</h3>
              <p style={styles.featureBody}>{s.body}</p>
            </div>
          ))}
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

      <section id="why-digital" style={{ ...styles.section, paddingTop: 0 }}>
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

      <section id="customer-tools" style={styles.section}>
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

      <style>{`
        @media (max-width: 980px) {
          .lt-card-available { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .lt-card-coming { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 560px) {
          .lt-card-available, .lt-card-coming { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
      `}</style>
      <section id="business-tools" style={{...styles.section,background:'#f8fafc'}}>
        <div style={styles.industryHeader}>
          <span style={styles.partnerEyebrow}>Built for everyday businesses</span>
          <h2 style={styles.h2}>Choose your industry. LoyaltyTree adapts.</h2>
          <p style={styles.cardTypesIntro}>Laundry shops and gasoline stations are now included alongside food, fitness, beauty, health, retail and automotive services.</p>
        </div>
        <div style={styles.industryGrid}>
          {INDUSTRIES.map(item=><div key={item.title} style={styles.industryCard}>
            <div style={styles.industryIcon}>{item.icon}</div><div style={styles.industryTitle}>{item.title}</div>
            <p style={styles.industryBody}>{item.body}</p><div style={styles.industryCards}>{item.cards}</div>
          </div>)}
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.h2}>Choose your card type</h2>
        <p style={styles.cardTypesIntro}>Choose the card that fits your business: rewards, subscriptions, session packs, or VIP tiers.</p>

        <div style={styles.cardTypeGroup}>
          <div style={styles.cardTypeGroupLabel}>Available now</div>
          <div className="lt-card-available" style={styles.cardTypesAvailableGrid}>
            {CARD_TYPES.filter(c => c.available).map(c => (
              <button
                key={c.key}
                onClick={() => openCard(c)}
                style={{...styles.cardTypeItem, ...styles.cardTypeItemAvailable}}
              >
                <span style={styles.cardTypeIcon}>{c.icon}</span>
                <span style={styles.cardTypeTitle}>{c.title}</span>
                <span style={styles.availableBadge}>Available</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{...styles.cardTypeGroup, marginTop:24}}>
          <div style={{...styles.cardTypeGroupLabel, color:'#94a3b8'}}>Coming soon</div>
          <div className="lt-card-coming" style={styles.cardTypesComingGrid}>
            {CARD_TYPES.filter(c => !c.available).map(c => (
              <button key={c.key} style={{...styles.cardTypeItem, ...styles.cardTypeItemDisabled}} disabled>
                <span style={styles.cardTypeIcon}>{c.icon}</span>
                <span style={styles.cardTypeTitle}>{c.title}</span>
                <span style={styles.comingSoonBadge}>Coming soon</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section style={{...styles.section, background:'#ecfdf5'}}>
        <div style={styles.nfcSpecialWrap}>
          <div style={styles.nfcSpecialIcon}>📡</div>
          <div style={styles.nfcSpecialContent}>
            <span style={styles.nfcSpecialEyebrow}>Available Now · Specialized Businesses Only</span>
            <h2 style={styles.nfcSpecialTitle}>NFC & Contactless Integration</h2>
            <p style={styles.nfcSpecialBody}>
              NFC integration is available now for Specialized Businesses. LoyaltyTree can integrate with compatible NFC membership, attendance, and access-control systems for custom deployments such as gyms, clubs, hotels, and other specialized environments.
            </p>
            <div style={styles.nfcSpecialTags}>
              <span style={styles.nfcSpecialTag}>Membership check-in</span>
              <span style={styles.nfcSpecialTag}>Attendance tracking</span>
              <span style={styles.nfcSpecialTag}>Access-control integration</span>
              <span style={styles.nfcSpecialTag}>Custom implementation & pricing</span>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" style={styles.homePricingSection}>
        <div style={styles.homePricingHeader}>
          <span style={styles.partnerEyebrow}>Simple pricing</span>
          <h2 style={styles.h2}>Start small. Grow when you need to.</h2>
          <p style={styles.cardTypesIntro}>Plans start at ₱350/month for one branch, with Google Wallet and Apple Wallet support included.</p>
        </div>
        <div style={styles.homePricingCards}>
          <div style={styles.homePriceCard}>
            <span style={styles.homePriceLabel}>Starter</span>
            <div style={styles.homePrice}>₱350<span style={styles.homePriceUnit}>/mo</span></div>
            <p style={styles.homePriceText}>Core digital loyalty, customization, analytics, announcements, birthday greetings, and support.</p>
          </div>
          <div style={{...styles.homePriceCard,...styles.homePriceCardFeatured}}>
            <span style={styles.homePricePopular}>MOST POPULAR</span>
            <span style={styles.homePriceLabel}>Growth</span>
            <div style={styles.homePrice}>₱550<span style={styles.homePriceUnit}>/mo</span></div>
            <p style={styles.homePriceText}>Adds review prompts, more announcements, and automated win-back tools for customer retention.</p>
          </div>
          <div style={styles.homePriceCard}>
            <span style={styles.homePriceLabel}>Specialized</span>
            <div style={styles.homePriceCustom}>Custom</div>
            <p style={styles.homePriceText}>For NFC, contactless, membership, access, and specialized business integrations.</p>
          </div>
        </div>
        <button onClick={() => goPublicPage('/how-it-works#pricing')} style={styles.homePricingButton}>View full pricing & branch options →</button>
      </section>

      {(partnersLoading || partnersError || partners.length > 0) && (
        <section style={{ ...styles.section, background: '#ffffff' }}>
          <div style={styles.partnerHeader}>
            <span style={styles.partnerEyebrow}>Our growing community</span>
            <h2 style={styles.h2}>Thank you for trusting us</h2>
            <p style={styles.partnerIntro}>
              We are proud to support businesses that use LoyaltyTree to serve, retain, and appreciate their customers.
            </p>
          </div>

          {partnersLoading && (
            <div style={styles.partnerStatus}>Loading partner logos...</div>
          )}

          {!partnersLoading && partnersError && (
            <div style={{...styles.partnerStatus, color:'#b91c1c', background:'#fef2f2', borderColor:'#fecaca'}}>
              Partner logos could not load: {partnersError}
            </div>
          )}

          {!partnersLoading && !partnersError && partners.length === 0 && (
            <div style={styles.partnerStatus}>No active homepage partners have been added yet.</div>
          )}

          {['partners', 'growth', 'starter'].map(planKey => {
            const planPartners = partners.filter(p => p.plan_segment === planKey)
            if (!planPartners.length) return null
            return (
              <div key={planKey} style={styles.partnerPlanGroup}>
                <div style={styles.partnerPlanHeading}>
                  <span style={{ ...styles.partnerPlanBadge, background: planKey === 'growth' ? '#0d9488' : '#475569' }}>
                    {planKey === 'partners' ? 'Partners' : planKey === 'growth' ? 'Growth Plan Partners' : 'Starter Plan Partners'}
                  </span>
                </div>
                <div style={styles.partnerGrid}>
                  {planPartners.map(partner => (
                    <a
                      key={partner.public_id}
                      href={partner.website_url || undefined}
                      target={partner.website_url ? '_blank' : undefined}
                      rel={partner.website_url ? 'noopener noreferrer' : undefined}
                      style={styles.partnerCard}
                    >
                      <div style={styles.partnerLogoWrap}>
                        <img src={partnerLogoSrc(partner)} alt={partner.name} style={styles.partnerLogo} loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />
                      </div>
                      <div style={styles.partnerName}>{partner.name}</div>
                      <div style={styles.partnerSector}>{partner.sector || 'Business Partner'}</div>
                    </a>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}


      <section id="about" style={styles.aboutSection}>
        <div style={styles.aboutGrid}>
          <div style={styles.aboutCard}>
            <span style={styles.navSectionEyebrow}>About LoyaltyTree</span>
            <h2 style={styles.aboutTitle}>Built in Isabela for businesses that depend on real customer relationships.</h2>
            <p style={styles.aboutBody}>
              LoyaltyTree started from a simple observation: in a province where market movement and money circulation can shift with farming industries,
              keeping existing customers matters. That idea became a platform focused on helping service-industry businesses build stronger,
              longer-lasting connections with the people they serve — through digital loyalty, retention tools, and direct customer engagement.
            </p>
            <div style={styles.founderLine}>Developer / Founder — Alfred / Snoopscoops</div>
          </div>

          <div id="contact" style={styles.contactCard}>
            <span style={styles.navSectionEyebrow}>Contact Us</span>
            <h2 style={styles.aboutTitle}>Questions, support, or partnership inquiries?</h2>
            <p style={styles.aboutBody}>
              Reach out for platform questions, business setup, support, or partnership opportunities.
            </p>
            <div style={styles.homeContactDetails}>
              <a href="tel:+639397992144" style={styles.homeContactLink}>📱 0939 799 2144 <span style={styles.homeContactMeta}>Smart</span></a>
              <a href="mailto:fredsomeros.stocks@gmail.com" style={styles.homeContactLink}>✉️ fredsomeros.stocks@gmail.com</a>
              <a href="mailto:theloyaltytree@gmail.com" style={styles.homeContactLink}>✉️ theloyaltytree@gmail.com</a>
            </div>
            <div style={styles.contactActions}>
              <button onClick={openContact} style={styles.contactPrimary}>💬 Message LoyaltyTree</button>
              <button onClick={() => goPublicPage('/contact')} style={styles.contactSecondary}>Contact Us</button>
            </div>
          </div>
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

      {activeCard && CARD_SAMPLES[activeCard] && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <button onClick={closeModal} style={styles.modalCloseBtn} aria-label="Close">✕</button>

            {modalView === 'sample' ? (
              <>
                <h2 style={styles.modalTitle}>Sample: {CARD_SAMPLES[activeCard].name} card</h2>
                <p style={styles.modalSubtitle}>{CARD_SAMPLES[activeCard].intro}</p>
                <div style={styles.sampleWrap}>
                  {CARD_SAMPLES[activeCard].render(styles)}
                </div>
                <button onClick={() => setModalView('pricing')} style={styles.pricingBtn}>
                  See pricing
                </button>
              </>
            ) : (
              <>
                <h2 style={styles.modalTitle}>{CARD_SAMPLES[activeCard].name} pricing</h2>
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
                      {p.prices ? (
                        <>
                          <div style={styles.planPrice}>
                            ₱{p.prices[branchTier].toLocaleString()}
                            <span style={styles.planPriceUnit}>/mo</span>
                          </div>
                          {p.comingSoon && <div style={styles.planPriceComingSoon}>Coming soon</div>}
                        </>
                      ) : (
                        <div style={styles.planPriceComingSoon}>Upon discussion</div>
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
                  Need more than 5 branches or a specialized system? Let's talk it through together &mdash; email{' '}
                  <a href="mailto:theloyaltytree@gmail.com" style={styles.contactLink}>theloyaltytree@gmail.com</a>
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
  brandButton: {
    display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent',
    padding: 0, cursor: 'pointer', flexShrink: 0,
  },
  logo: { width: 32, height: 32, borderRadius: '50%', display: 'block' },
  brandName: { fontWeight: 700, fontSize: 18, color: '#0f766e' },
  navBtn: {
    padding: '10px 20px', background: '#0d9488', color: 'white', border: 'none',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  navLink: {
    border: 'none', background: 'transparent', color: '#334155', borderRadius: 9,
    padding: '9px 10px', fontSize: 13, fontWeight: 650, cursor: 'pointer',
  },
  dropdownItem: {
    width: '100%', display: 'flex', gap: 11, alignItems: 'flex-start', textAlign: 'left',
    border: 'none', background: 'transparent', padding: '11px 10px', borderRadius: 10,
    color: '#0f172a', cursor: 'pointer', fontSize: 13,
  },
  dropdownIcon: {
    width: 34, height: 34, borderRadius: 10, background: '#ecfdf5', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 17,
  },
  dropdownSmall: { display: 'block', color: '#64748b', fontSize: 11, fontWeight: 500, marginTop: 3, lineHeight: 1.35 },
  topHowSection: {
    padding: '58px 32px 34px', maxWidth: 1100, margin: '0 auto', textAlign: 'center',
  },
  navSectionEyebrow: {
    display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#0f766e', marginBottom: 9,
  },
  h2Compact: { fontSize: 30, lineHeight: 1.2, fontWeight: 800, margin: '0 0 12px', color: '#0f172a' },
  topSectionIntro: {
    maxWidth: 690, margin: '0 auto 28px', color: '#64748b', fontSize: 14.5, lineHeight: 1.65,
  },
  topStepsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14,
  },
  topStepCard: {
    textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
    padding: 20, boxShadow: '0 8px 24px rgba(15,23,42,0.04)',
  },
  topStepNumber: {
    width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#d1fae5', color: '#047857', fontWeight: 850,
    marginBottom: 12,
  },
  platformSection: { padding: '18px 32px 58px', maxWidth: 1100, margin: '0 auto' },
  platformCard: {
    display: 'flex', gap: 15, alignItems: 'flex-start', background: '#fff',
    border: '1px solid #e2e8f0', borderRadius: 16, padding: 20,
  },
  platformIcon: {
    width: 48, height: 48, borderRadius: 14, background: '#ecfdf5',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0,
  },
  platformTitle: { fontSize: 17, fontWeight: 800, margin: '0 0 6px', color: '#0f172a' },
  platformBody: { fontSize: 13.5, lineHeight: 1.55, color: '#64748b', margin: '0 0 10px' },
  platformLearnBtn: {
    border: 'none', background: 'transparent', color: '#0f766e', padding: 0,
    fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
  },
  hero: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 54,
    padding: '88px 32px 82px', maxWidth: 1180, margin: '0 auto', flexWrap: 'wrap',
    position: 'relative',
  },
  heroInner: { flex: '1 1 440px', maxWidth: 600 },
  heroEyebrow: {
    display:'inline-flex', alignItems:'center', padding:'7px 12px', borderRadius:999,
    background:'#ecfdf5', color:'#0f766e', fontSize:11, fontWeight:850,
    letterSpacing:'.07em', marginBottom:18, border:'1px solid #ccfbf1',
  },
  brandPillar: {
    display:'flex', flexDirection:'column', alignItems:'flex-start', justifyContent:'center',
    padding:'14px 13px', background:'rgba(255,255,255,.78)', border:'1px solid #ccfbf1',
    borderRadius:14, boxShadow:'0 8px 24px rgba(15,23,42,.035)',
  },
  brandPillarIcon: {
    fontSize:9, fontWeight:900, letterSpacing:'.08em', color:'#0d9488', marginBottom:5,
  },
  brandPillarWord: {
    fontSize:15, lineHeight:1.1, fontWeight:900, letterSpacing:'.035em', color:'#0f172a',
  },
  brandPillarCopy: {
    display:'block', marginTop:5, fontSize:10.5, lineHeight:1.3, color:'#64748b', fontWeight:650,
  },
  h1: { fontSize: 'clamp(40px,5.2vw,64px)', lineHeight: 1.03, letterSpacing:'-0.035em', margin: '0 0 20px', fontWeight: 900, color: '#0f172a' },
  heroSub: { fontSize: 17, lineHeight: 1.72, color: '#475569', margin: '0 0 28px', maxWidth:580 },
  heroActions:{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'},
  heroBtn: {
    padding: '15px 22px', background: '#0d9488', color: 'white', border: 'none',
    borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer',
    boxShadow: '0 10px 24px rgba(13,148,136,0.22)',
  },
  heroSecondaryBtn:{
    padding:'14px 20px',background:'#fff',color:'#0f766e',border:'1px solid #cbd5e1',
    borderRadius:12,fontSize:14,fontWeight:800,cursor:'pointer',
  },
  heroTrustRow:{
    display:'flex',gap:16,flexWrap:'wrap',marginTop:22,color:'#64748b',fontSize:12,fontWeight:700,
  },
  heroVisual: { flex: '1 1 380px', minWidth:280, display: 'flex', justifyContent: 'center', position:'relative' },
  heroVisualGlow:{
    position:'absolute',width:'82%',height:'82%',borderRadius:'50%',background:'#ccfbf1',
    filter:'blur(46px)',opacity:.7,top:'8%',left:'9%',
  },
  heroDashboardCard:{
    position:'relative',zIndex:1,width:'100%',maxWidth:430,background:'#fff',border:'1px solid #dbeafe',
    borderRadius:24,padding:20,boxShadow:'0 28px 70px rgba(15,23,42,.14)',
  },
  heroDashboardTop:{display:'flex',justifyContent:'space-between',gap:14,alignItems:'flex-start',marginBottom:16},
  heroMiniLabel:{fontSize:9,fontWeight:900,letterSpacing:1.3,color:'#0d9488',marginBottom:4},
  heroDashboardTitle:{fontSize:16,fontWeight:850,color:'#0f172a',lineHeight:1.3,maxWidth:250},
  heroLiveBadge:{fontSize:9,fontWeight:900,color:'#047857',background:'#d1fae5',padding:'5px 8px',borderRadius:999,whiteSpace:'nowrap'},
  heroMetricGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14},
  heroMetric:{background:'#f8fafc',border:'1px solid #eef2f7',borderRadius:12,padding:'10px 9px'},
  heroMetricValue:{display:'block',fontSize:19,color:'#0f172a',lineHeight:1.1},
  heroMetricLabel:{display:'block',fontSize:9.5,color:'#64748b',marginTop:4},
  heroWalletCard:{
    borderRadius:16,background:'#fff',border:'1px solid #e2e8f0',padding:14,
    boxShadow:'0 8px 24px rgba(15,23,42,.06)',marginBottom:12,
  },
  heroNotification:{
    display:'flex',gap:10,alignItems:'center',padding:'11px 12px',borderRadius:14,
    background:'#f0fdfa',border:'1px solid #ccfbf1',
  },
  heroNotificationIcon:{fontSize:20},
  heroNotificationTitle:{display:'block',fontSize:11.5,color:'#0f172a',marginBottom:2},
  heroNotificationText:{display:'block',fontSize:9.5,color:'#64748b',lineHeight:1.35},
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

  // Coupons sample card
  couponBody: { textAlign: 'center', padding: '14px 0 18px' },
  couponIcon: { fontSize: 30, marginBottom: 6 },
  couponCode: {
    fontSize: 18, fontWeight: 800, color: '#0f172a', letterSpacing: '1px',
    border: '1.5px dashed #cbd5e1', borderRadius: 10, padding: '6px 14px',
    display: 'inline-block', marginBottom: 8,
  },
  couponExpiry: { fontSize: 12, color: '#94a3b8' },

  // Points sample card
  pointsBody: { textAlign: 'center', padding: '12px 0 16px' },
  pointsValue: { fontSize: 32, fontWeight: 800, color: '#0d9488' },
  pointsUnit: { fontSize: 14, fontWeight: 600, color: '#94a3b8' },
  pointsToNext: { fontSize: 12.5, color: '#64748b', marginTop: 4 },
  section: { padding: '64px 32px', maxWidth: 1100, margin: '0 auto' },
  industryHeader:{maxWidth:720,margin:'0 auto 28px',textAlign:'center'},
  industryGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:14},
  industryCard:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:18,boxShadow:'0 8px 20px rgba(15,23,42,.04)'},
  industryIcon:{fontSize:28,marginBottom:10},industryTitle:{fontSize:15,fontWeight:800,color:'#0f172a'},
  industryBody:{fontSize:12.5,lineHeight:1.5,color:'#64748b',minHeight:56},industryCards:{fontSize:11,fontWeight:800,color:'#0d9488'},

  homePricingSection:{padding:'72px 32px',maxWidth:1100,margin:'0 auto',textAlign:'center'},
  homePricingHeader:{maxWidth:680,margin:'0 auto 28px'},
  homePricingCards:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:16,alignItems:'stretch'},
  homePriceCard:{position:'relative',background:'#fff',border:'1px solid #e2e8f0',borderRadius:18,padding:'26px 22px',textAlign:'left',boxShadow:'0 8px 24px rgba(15,23,42,.05)'},
  homePriceCardFeatured:{border:'2px solid #0d9488',boxShadow:'0 16px 36px rgba(13,148,136,.12)'},
  homePricePopular:{position:'absolute',top:14,right:14,fontSize:9,fontWeight:900,letterSpacing:'.08em',color:'#047857',background:'#d1fae5',padding:'5px 8px',borderRadius:999},
  homePriceLabel:{display:'block',fontSize:15,fontWeight:850,color:'#0f172a',marginBottom:12},
  homePrice:{fontSize:34,fontWeight:900,color:'#0f172a',letterSpacing:'-.03em'},
  homePriceUnit:{fontSize:13,fontWeight:700,color:'#64748b',marginLeft:3},
  homePriceCustom:{fontSize:30,fontWeight:900,color:'#0f766e'},
  homePriceText:{fontSize:12.5,lineHeight:1.6,color:'#64748b',margin:'12px 0 0'},
  homePricingButton:{marginTop:24,padding:'13px 18px',border:'none',borderRadius:11,background:'#0d9488',color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer'},

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
  aboutSection: {
    padding: '68px 32px', maxWidth: 1100, margin: '0 auto',
  },
  aboutGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(290px,1fr))', gap: 18,
  },
  aboutCard: {
    borderRadius: 18, padding: 28, background: 'linear-gradient(135deg,#f0fdf4,#ecfdf5)',
    border: '1px solid #bbf7d0',
  },
  contactCard: {
    borderRadius: 18, padding: 28, background: 'linear-gradient(135deg,#fffbeb,#fff7ed)',
    border: '1px solid #fde68a',
  },
  aboutTitle: { fontSize: 23, lineHeight: 1.25, fontWeight: 800, color: '#0f172a', margin: '0 0 12px' },
  aboutBody: { fontSize: 14, lineHeight: 1.7, color: '#475569', margin: 0 },
  founderLine:{marginTop:18,fontSize:12,fontWeight:850,color:'#0f766e'},
  homeContactDetails:{display:'grid',gap:8,marginTop:16},
  homeContactLink:{color:'#0f172a',fontSize:12.5,fontWeight:750,textDecoration:'none',wordBreak:'break-word'},
  homeContactMeta:{color:'#64748b',fontWeight:600},
  contactActions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 },
  contactPrimary: {
    border: 'none', borderRadius: 11, background: '#0d9488', color: 'white',
    padding: '11px 16px', fontWeight: 800, cursor: 'pointer',
  },
  contactSecondary: {
    border: '1px solid #0d9488', borderRadius: 11, background: 'white', color: '#0f766e',
    padding: '11px 16px', fontWeight: 800, cursor: 'pointer',
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
  cardTypeGroup: { maxWidth: 980, margin: '0 auto' },
  cardTypeGroupLabel: {
    marginBottom: 12, fontSize: 12, fontWeight: 800, color: '#0d9488',
    textTransform: 'uppercase', letterSpacing: '.08em', textAlign: 'center',
  },
  cardTypesAvailableGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10,
  },
  cardTypesComingGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10,
    maxWidth: 680, margin: '0 auto',
  },
  cardTypeItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    borderRadius: 14, padding: '18px 10px', minHeight: 150, fontFamily: 'inherit',
    border: '1.5px solid #e2e8f0', background: 'white', position: 'relative',
  },
  cardTypeItemAvailable: {
    cursor: 'pointer', borderColor: '#0d9488', boxShadow: '0 4px 14px rgba(13,148,136,0.12)',
  },
  cardTypeItemDisabled: {
    cursor: 'not-allowed', opacity: 0.55,
  },
  cardTypeIcon: { fontSize: 27 },
  cardTypeTitle: { fontSize: 14, fontWeight: 700, color: '#0f172a', textAlign: 'center' },
  availableBadge: {
    fontSize: 11, fontWeight: 700, color: '#0d9488', background: '#ccfbf1',
    borderRadius: 20, padding: '3px 10px', marginTop: 2,
  },
  comingSoonBadge: {
    fontSize: 11, fontWeight: 600, color: '#94a3b8', background: '#f1f5f9',
    borderRadius: 20, padding: '3px 10px', marginTop: 2,
  },

  membershipBody: { padding: '24px 18px', textAlign: 'center' },
  membershipStatus: { fontSize: 27, fontWeight: 900, color: '#0d9488', letterSpacing: 1 },
  membershipDate: { marginTop: 5, fontSize: 13, color: '#475569' },
  membershipPerks: { marginTop: 13, fontSize: 11.5, color: '#64748b', lineHeight: 1.5 },
  vipBody: { padding: '24px 18px', textAlign: 'center' },
  vipTier: { fontSize: 29, fontWeight: 900, color: '#a16207', letterSpacing: 1.5 },
  vipPoints: { marginTop: 5, fontSize: 14, fontWeight: 750, color: '#334155' },
  vipProgress: { marginTop: 6, fontSize: 11.5, color: '#64748b' },
  nfcSpecialWrap: {
    display: 'flex', alignItems: 'center', gap: 28, maxWidth: 920, margin: '0 auto',
    background: '#ffffff', border: '1.5px solid #99f6e4', borderRadius: 22, padding: '32px 30px',
    boxShadow: '0 14px 34px rgba(13,148,136,0.10)', flexWrap: 'wrap',
  },
  nfcSpecialIcon: {
    width: 78, height: 78, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#ccfbf1', fontSize: 38, flexShrink: 0,
  },
  nfcSpecialContent: { flex: '1 1 520px' },
  nfcSpecialEyebrow: {
    display: 'inline-block', fontSize: 12, fontWeight: 800, color: '#0d9488',
    textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8,
  },
  nfcSpecialTitle: { fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' },
  nfcSpecialBody: { fontSize: 14.5, lineHeight: 1.7, color: '#475569', margin: '0 0 18px' },
  nfcSpecialTags: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  nfcSpecialTag: {
    fontSize: 12, fontWeight: 700, color: '#0f766e', background: '#f0fdfa',
    border: '1px solid #99f6e4', borderRadius: 999, padding: '7px 11px',
  },

  partnerHeader: { maxWidth: 680, margin: '0 auto 34px', textAlign: 'center' },
  partnerStatus: {
    maxWidth: 680, margin: '0 auto 24px', padding: '12px 16px',
    border: '1px solid #ccfbf1', borderRadius: 12, background: '#f0fdfa',
    color: '#0f766e', textAlign: 'center', fontSize: 13, fontWeight: 600,
  },
  partnerEyebrow: { display: 'inline-block', marginBottom: 8, fontSize: 12, fontWeight: 800, color: '#0d9488', textTransform: 'uppercase', letterSpacing: 1 },
  partnerIntro: { margin: '10px auto 0', color: '#64748b', lineHeight: 1.7, fontSize: 14 },
  partnerPlanGroup: { maxWidth: 1080, margin: '0 auto 34px' },
  partnerPlanHeading: { display: 'flex', justifyContent: 'center', marginBottom: 18 },
  partnerPlanBadge: { color: 'white', borderRadius: 999, padding: '7px 16px', fontSize: 12, fontWeight: 800, letterSpacing: .4 },
  partnerGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 },
  partnerCard: { textDecoration: 'none', color: 'inherit', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 14px', textAlign: 'center', boxShadow: '0 7px 20px rgba(15,23,42,.05)' },
  partnerLogoWrap: { height: 82, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 12, marginBottom: 12, padding: 10 },
  partnerLogo: { maxWidth: '100%', maxHeight: 62, objectFit: 'contain' },
  partnerName: { fontSize: 14, fontWeight: 800, color: '#0f172a' },
  partnerSector: { marginTop: 4, fontSize: 11.5, color: '#94a3b8' },

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

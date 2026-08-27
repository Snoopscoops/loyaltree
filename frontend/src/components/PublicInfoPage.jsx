import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo192 from './logo-192.png'
import { trackEvent } from '../analytics'
import customerStep1Scan from '../assets/customer-step-1-scan.png'
import customerStep2Form from '../assets/customer-step-2-form.png'
import customerStep2WalletButtons from '../assets/customer-step-2-wallet-buttons.png'
import customerStep3WalletCard from '../assets/customer-step-3-wallet-card.png'
import customerStep4Notification from '../assets/customer-step-4-notification.png'
import businessStep1Customize from '../assets/business-step-1-customize.png'
import businessStep2Team from '../assets/business-step-2-team.png'
import businessStep3JoinQr from '../assets/business-step-3-join-qr.png'
import businessStep4Analytics from '../assets/business-step-4-analytics.png'
import businessStep5Engagement from '../assets/business-step-5-engagement.png'
import businessStep6StampActivity from '../assets/business-step-6-stamp-activity.png'

const PAGE_CONTENT = {
  overview: {
    eyebrow: 'HOW IT WORKS · OVERVIEW',
    title: 'One connected loyalty journey — for the customer and the business.',
    intro: 'LoyaltyTree connects the entire relationship: customers join and keep the card in their phone, staff record activity at checkout, and the business uses rewards, communication and analytics to strengthen repeat visits.',
    steps: [
      ['1', 'Customer discovers the program', 'The business shares one QR code in-store, online, on receipts, menus or marketing materials.'],
      ['2', 'Customer joins & saves the card', 'The customer enrolls and saves the branded loyalty card to Apple Wallet or Google Wallet.'],
      ['3', 'Staff records real activity', 'Authorized cashiers scan the customer card and record stamps, points, visits, membership activity or other loyalty actions.'],
      ['4', 'The customer sees progress', 'The same Wallet card reflects rewards, loyalty progress, membership status, VIP tiers or remaining sessions.'],
      ['5', 'The business keeps the relationship active', 'Analytics, announcements, birthday greetings, retention tools and customer activity help the business stay connected after checkout.'],
    ],
    featureTitle: 'Everything stays connected',
    features: [
      ['📲', 'Customer joining', 'One QR-led experience that moves the customer from discovery to enrollment quickly.'],
      ['👛', 'Apple & Google Wallet', 'The loyalty card stays in a familiar place on the customer’s phone instead of another separate loyalty app.'],
      ['🧾', 'Cashier accountability', 'Staff activity can be tied to individual cashier accounts, timestamps and branches.'],
      ['🎁', 'Flexible loyalty programs', 'Run stamps, points, memberships, multipass programs, VIP tiers and other supported loyalty experiences.'],
      ['📣', 'Direct engagement', 'Use announcements, birthday greetings and retention messaging to stay connected beyond a single purchase.'],
      ['📊', 'Business intelligence', 'Use customer, loyalty, activity and retention analytics to understand how the program is performing.'],
    ],
  },
  businesses: {
    eyebrow: 'HOW IT WORKS · FOR BUSINESSES',
    title: 'Set up loyalty once. Run it from one business dashboard.',
    intro: 'Design the card, organize your team, share the join QR, watch performance, and keep customers engaged with announcements and automated birthday greetings.',
    steps: [
      ['1', 'Customize Your Card', 'Choose the card type, set the name and description, configure rewards and milestones, and preview what customers will see.'],
      ['2', 'Set Up Branches & Cashiers', 'Create branches, add team members, assign cashier access, and keep staff activity tied to individual accounts.'],
      ['3', 'Share Your Join QR', 'Show, share, or download the business QR so customers can join your loyalty program in seconds.'],
      ['4', 'Track Customers & Analytics', 'Monitor customers, stamps, rewards, growth, retention signals, and activity trends from the Analytics Dashboard.'],
      ['5', 'Engage Customers', 'Post announcements and use automated birthday greetings to keep your loyalty program active beyond checkout.'],
      ['6', 'Monitor Staff Stamp Activity', 'See which team member added stamps, when each stamp was added, which branch handled it, and how many stamps each staff member issued.'],
    ],
    featureTitle: 'What the business controls',
    features: [
      ['🎨', 'Card design', 'Branding, card type, rewards, milestones and Wallet appearance.'],
      ['🏪', 'Branches & cashiers', 'Organize locations and give staff their own controlled cashier access.'],
      ['🔗', 'Customer acquisition', 'Share a join QR online or at the physical business.'],
      ['📈', 'Analytics', 'Measure customer growth, loyalty activity, rewards and retention performance.'],
      ['📣', 'Announcements', 'Send business updates and promotions to loyalty customers.'],
      ['🎂', 'Birthday greetings', 'Use automated birthday messaging to create timely customer touchpoints.'],
      ['🧾', 'Staff stamp activity', 'Track who stamped, when they stamped, the branch, and total stamps added by each staff member.'],
    ],
  },
  customers: {
    eyebrow: 'HOW IT WORKS · FOR CUSTOMERS',
    title: 'For Customers',
    intro: 'Join in seconds, keep your loyalty card in your phone, earn rewards, and stay connected with the businesses you love.',
    steps: [
      ['1', 'Scan the Business QR', 'Use your phone camera to scan the LoyaltyTree QR at the store or on the business\' materials.'],
      ['2', 'Join & Add to Wallet', 'Fill up the quick form, then add your card to Google Wallet on Android or Apple Wallet on iPhone.'],
      ['3', 'Your Card is Ready', 'Your loyalty card is now available in your Wallet and ready to show whenever you visit.'],
      ['4', 'Get Notified & Stay Updated', 'Receive relevant updates, offers, reminders, and reward notifications from the business.'],
    ],
    featureTitle: 'Simple for every visit',
    features: [
      ['🛡️', 'Safe & Private', 'Your customer information is protected and used only for the loyalty experience you joined.'],
      ['👛', 'Always in Your Wallet', 'Keep your digital loyalty card with you without carrying another plastic or paper card.'],
      ['🎁', 'Earn & Redeem Rewards', 'Collect stamps, points, perks, or other rewards based on the business\' loyalty program.'],
    ],
  },
  about: {
    eyebrow: 'ABOUT US',
    title: 'Helping service businesses build better connections with their customers.',
    intro: 'LoyaltyTree started with a simple idea in Isabela: help service industry businesses establish stronger, more meaningful connections with their customers—especially in markets where spending and local economic activity can change quickly.',
    paragraphs: [
      'Living in the province of Isabela, we saw how closely local businesses are connected to agriculture. Market movement and money circulation can be volatile, seasonal, and strongly influenced by farming activity.',
      'That reality led to one important question: when customer spending slows or shifts, how can a business keep the customers it already worked hard to earn—and build a better relationship with them over time?',
      'That is where the focus on customer retention and sustainable growth began. LoyaltyTree was built to help service industry businesses turn everyday transactions into lasting customer relationships through loyalty, rewards, communication, customer insights, and meaningful engagement.',
      'Whether it is a café, restaurant, salon, automotive service, retail service, wellness business, local shop, or another customer-focused service business, the goal is the same: give businesses practical tools to recognize their customers, understand their activity, reward their loyalty, and stay connected beyond a single transaction.',
      'What started as a local idea in Isabela is growing into a platform with a broader purpose: helping service businesses of different sizes establish better customer connections, encourage repeat visits, and build long-term customer value.',
    ],
    founder: {
      role: 'Developer & Founder',
      name: 'Alfred',
      handle: 'Snoopscoops',
      bioTitle: 'About Alfred',
      bio: [
        'Alfred has been developing systems as a hobby for around 15 years, building hands-on experience across different technologies and programming environments.',
        'He studied at the University of the Philippines Diliman and was part of the UP Diliman Taekwondo Team from 2015–2019. He has also completed different language certifications.',
        'His technical background includes blockchain and smart contract development, with particular experience using the Solidity programming language. Previous work in the Philippine blockchain and digital community space received coverage from national and industry publications.',
        'Alongside technology and entrepreneurship, Alfred is a DTI Kapatid Mentor ME (KMME) Batch 13 Graduate and serves as the 2026 Local Organization President of JCI Alicia Pagay.',
        'That combination of long-term hands-on development, entrepreneurship, leadership, community involvement, and continued learning helped shape the foundation behind LoyaltyTree.',
      ],
      credentials: [
        ['🎓', 'DTI Kapatid Mentor ME (KMME)', 'Batch 13 Graduate'],
        ['🤝', 'JCI Alicia Pagay', '2026 Local Organization President'],
        ['🥋', 'UP Diliman Taekwondo Team', '2015–2019'],
      ],
      media: [
        ['Esquire Philippines', 'https://www.esquiremag.ph/culture/books-and-art/larry-alcala-nft-scarletbox-a2765-20220913'],
        ['BusinessWorld', 'https://bworldonline.com/technology/2022/05/02/445840/group-chat-births-filipino-nft-movement/'],
        ['Lifestyle Asia', 'https://lifestyleasia-onemega.com/arts-and-culture/tech/tale-of-the-token-this-filipino-crypto-success-story-started-with-a-pair-of-bored-punks/'],
        ['Manila Standard', 'https://manilastandard.net/?p=314217761'],
        ['The New Hue', 'https://www.thenewhueph.com/post/the-ten-the-bedrocks-of-bored-punks-of-society'],
      ],
    },
  },
  contact: {
    eyebrow: 'CONTACT',
    title: 'Talk to LoyaltyTree.',
    intro: 'Have a question about LoyaltyTree, business setup, support, or partnership opportunities? Reach us directly by mobile or email.',
    contact: true,
  },
}

function PublicInfoPage({ type='overview', API_BASE='' }) {
  const navigate = useNavigate()
  const page = PAGE_CONTENT[type] || PAGE_CONTENT.overview
  const [customerStep, setCustomerStep] = useState(0)
  const [businessStep, setBusinessStep] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pricingBranchTier, setPricingBranchTier] = useState('1')
  const [pricingStep, setPricingStep] = useState(0)

  useEffect(() => {
    setCustomerStep(0)
    setBusinessStep(0)
  }, [type])

  useEffect(() => {
    if (type !== 'overview' || window.location.hash !== '#pricing') return
    const scrollToPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    scrollToPricing()
    const timer = window.setTimeout(scrollToPricing, 180)
    return () => window.clearTimeout(timer)
  }, [type])

  const openMessenger = () => {
    trackEvent(API_BASE, 'contact_click', {
      page_name: `Public Info - ${type}`,
      metadata: { placement: 'messenger', section: type },
    })
    window.open('https://m.me/theloyaltytree', '_blank', 'noopener,noreferrer')
  }

  const goToPricing = () => {
    trackEvent(API_BASE, 'pricing_view', {
      page_name: `Public Info - ${type}`,
      metadata: { placement: 'public_info_navigation' },
    })
    setMobileMenuOpen(false)
    if (type === 'overview') {
      window.history.replaceState(null, '', '/how-it-works#pricing')
      window.requestAnimationFrame(() => {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return
    }
    window.location.assign('/how-it-works#pricing')
  }

  const applyBusiness = (placement='public_info') => {
    trackEvent(API_BASE, 'apply_business_click', {
      page_name: `Public Info - ${type}`,
      metadata: { placement, section: type },
    })
    navigate('/signup')
  }

  const contactLoyaltyTree = (placement='public_info') => {
    trackEvent(API_BASE, 'contact_click', {
      page_name: `Public Info - ${type}`,
      metadata: { placement, section: type },
    })
    navigate('/contact')
  }

  const customerSteps = [
    {
      number: 1,
      title: 'Scan the Business QR',
      body: "Use your phone camera to scan the LoyaltyTree QR at the store or on the business' materials.",
      images: [{ src: customerStep1Scan, alt: 'Customer scanning a LoyaltyTree business QR code with a phone camera' }],
    },
    {
      number: 2,
      title: 'Join & Add to Wallet',
      body: 'Fill up the quick form, then add your card to Google Wallet on Android or Apple Wallet on iPhone.',
      images: [
        { src: customerStep2Form, alt: 'LoyaltyTree customer sign-up form' },
        { src: customerStep2WalletButtons, alt: 'LoyaltyTree customer card ready with Apple Wallet and Google Wallet buttons' },
      ],
    },
    {
      number: 3,
      title: 'Your Card is Ready',
      body: 'Your loyalty card is now available in your Wallet and ready to show whenever you visit.',
      images: [{ src: customerStep3WalletCard, alt: "LoyaltyTree loyalty card saved in the customer's digital wallet" }],
    },
    {
      number: 4,
      title: 'Get Notified & Stay Updated',
      body: 'Receive relevant updates, offers, reminders, and reward notifications from the business.',
      images: [{ src: customerStep4Notification, alt: "LoyaltyTree business notification shown on a customer's phone" }],
    },
  ]

  const businessSteps = [
    {
      number: 1,
      title: 'Customize Your Card',
      body: 'Choose the card type, set the card name and description, configure rewards and milestones, and preview what customers will see.',
      image: businessStep1Customize,
      alt: 'LoyaltyTree card customizer with live preview, stamp card settings, and milestone rewards',
      tag: 'CARD DESIGN',
    },
    {
      number: 2,
      title: 'Set Up Branches & Cashiers',
      body: 'Create branches, add team members, assign cashier access, and keep staff activity tied to individual accounts.',
      image: businessStep2Team,
      alt: 'LoyaltyTree team setup showing branches and the Grow Your Team cashier invitation form',
      tag: 'TEAM & ACCESS',
    },
    {
      number: 3,
      title: 'Share Your Join QR',
      body: 'Show, share, or download the business QR so customers can join the loyalty program in seconds.',
      image: businessStep3JoinQr,
      alt: 'LoyaltyTree Share Your Tree join QR screen',
      tag: 'CUSTOMER JOINING',
    },
    {
      number: 4,
      title: 'Track Customers & Analytics',
      body: 'Monitor customer growth, stamps issued, rewards, activity patterns, and retention signals from the Analytics Dashboard.',
      image: businessStep4Analytics,
      alt: 'LoyaltyTree Analytics Dashboard showing customers, stamps, rewards and activity charts',
      tag: 'ANALYTICS',
    },
    {
      number: 5,
      title: 'Engage Customers',
      body: 'Post announcements and use automated birthday greetings to keep your loyalty program active beyond checkout.',
      image: businessStep5Engagement,
      alt: 'LoyaltyTree announcements interface used to publish customer messages',
      tag: 'ANNOUNCEMENTS + BIRTHDAYS',
    },
    {
      number: 6,
      title: 'Monitor Staff Stamp Activity',
      body: 'See which staff member added stamps, when each activity happened, the branch involved, and how many stamps each person issued.',
      image: businessStep6StampActivity,
      alt: 'LoyaltyTree stamp activity showing staff member names, branch, timestamps, and stamps added',
      tag: 'STAFF ACCOUNTABILITY',
    },
  ]

  const pricingBranches = [
    { key: '1', label: '1 branch' },
    { key: '3', label: '3 branches' },
    { key: '5', label: 'Up to 5 branches' },
  ]

  const pricingPlans = [
    {
      key: 'starter',
      name: 'Starter',
      prices: { '1': 350, '3': 1000, '5': 1600 },
      tagline: 'A complete digital loyalty system for smaller businesses getting started.',
      features: [
        'Google Wallet & Apple Wallet',
        '2 active announcements',
        'Full digital loyalty system',
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
      prices: { '1': 550, '3': 1600, '5': 2600 },
      tagline: 'More customer engagement and retention tools for growing businesses.',
      features: [
        'Google Wallet & Apple Wallet',
        'Up to 5 active announcements',
        'Full digital loyalty system',
        'Full loyalty card customization',
        'Analytics',
        'Google review prompt',
        'Birthday automated greetings',
        'Win-back system after 30 days without a stamp',
        'Customer service',
      ],
    },
    {
      key: 'pro',
      name: 'Pro',
      comingSoon: true,
      prices: { '1': 750, '3': 2100, '5': 3600 },
      tagline: 'Advanced loyalty tools for businesses ready to run more complex programs.',
      features: [
        'Google Wallet & Apple Wallet',
        'Up to 7 active announcements',
        'Full digital loyalty system',
        'Full loyalty card customization',
        'Analytics',
        'Google review prompt',
        'Birthday automated greetings',
        'Up to 3 loyalty cards in circulation',
        'Win-back system after 30 days without a stamp',
        'Geo tagging',
        'Advance ordering',
        'Customer service',
      ],
    },
    {
      key: 'specialized',
      name: 'Specialized System',
      tagline: 'Maximize your business with a specialized digital loyalty system built around your operational needs — designed to boost efficiency, customer retention, and long-term growth.',
      benefits: ['Efficiency', 'Retention', 'Growth'],
      features: [
        'Specialized digital loyalty system for your business',
        'Website integration',
        'Location services & geo tagging',
        'NFC & contactless integration',
        'Booking & reservation system integration',
        'Payment system integration',
        'Google Wallet & Apple Wallet',
        'Custom loyalty card configuration',
        'Analytics & customer insights',
        'Announcements & birthday greetings',
        'Google review prompt',
        'Win-back system',
        'Advance ordering',
        'Customer service',
      ],
    },
  ]

  const overviewSteps = [
    {number:'01', icon:'📲', title:'Discover & Join', body:'A customer scans the business QR and joins the loyalty program.'},
    {number:'02', icon:'👛', title:'Save to Wallet', body:'The branded card goes to Apple Wallet or Google Wallet.'},
    {number:'03', icon:'📷', title:'Scan at Checkout', body:'Authorized staff scan the customer and record the loyalty activity.'},
    {number:'04', icon:'🎁', title:'Reward Progress Updates', body:'Stamps, points, tiers, memberships or sessions update in the customer record.'},
    {number:'05', icon:'🔁', title:'Keep the Relationship Going', body:'Announcements, birthday greetings, retention tools and analytics help bring customers back.'},
  ]

  const goBusinessStep = (index) => {
    const safeIndex = Math.max(0, Math.min(businessSteps.length - 1, index))
    setBusinessStep(safeIndex)
  }

  const goCustomerStep = (index) => {
    const safeIndex = Math.max(0, Math.min(customerSteps.length - 1, index))
    setCustomerStep(safeIndex)
  }

  return <div style={s.page}>
    <style>{`
      .public-nav { display:flex; align-items:center; width:100%; max-width:none; gap:18px; }
      .public-links { display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; margin-left:auto; }
      .public-login-desktop { margin-left:8px; flex:0 0 auto; }
      .public-how { position:relative; }
      .public-how summary { list-style:none; cursor:pointer; }
      .public-how summary::-webkit-details-marker { display:none; }
      .public-menu { position:absolute; left:0; top:calc(100% + 8px); width:260px; background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:7px; box-shadow:0 16px 40px rgba(15,23,42,.14); z-index:20; }
      .public-menu button { width:100%; border:0; background:transparent; text-align:left; padding:10px; border-radius:9px; cursor:pointer; font-weight:700; color:#334155; }
      .customer-desktop-grid {
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:18px;
        align-items:stretch;
        position:relative;
      }
      .customer-desktop-card { position:relative; }
      .customer-desktop-card:not(:last-child)::after {
        content:'→';
        position:absolute;
        right:-15px;
        top:50%;
        transform:translateY(-50%);
        width:28px;
        height:28px;
        border-radius:999px;
        display:grid;
        place-items:center;
        background:#ecfdf5;
        color:#0f766e;
        border:1px solid #99f6e4;
        font-weight:900;
        z-index:2;
        box-shadow:0 6px 16px rgba(15,118,110,.10);
      }
      .customer-mobile-slider { display:none; }
      .business-visual-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; align-items:stretch; }
      .business-mobile-slider { display:none; }
      .pricing-mobile-slider { display:none; }
      .overview-flow-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; }
      @media(min-width:1101px){
        .pricing-core-grid {
          display:grid !important;
          grid-template-columns:repeat(3,minmax(0,1fr)) !important;
          gap:18px !important;
          max-width:1080px;
          margin:0 auto;
        }
        .pricing-specialized-wrap {
          max-width:1080px;
          margin:20px auto 0;
        }
      }
      @media(max-width:1100px){
        main > section:first-child { padding:48px 16px !important; }
        .overview-flow-grid {
          display:flex !important;
          overflow-x:auto;
          gap:14px;
          scroll-snap-type:x mandatory;
          padding:2px 2px 12px;
          scrollbar-width:none;
        }
        .overview-flow-grid::-webkit-scrollbar { display:none; }
        .overview-flow-grid > article {
          flex:0 0 min(78vw,320px);
          scroll-snap-align:start;
        }
        .overview-flow-arrow { display:none !important; }
        .pricing-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        .pricing-specialized-content { grid-template-columns:1fr !important; }
      }
      @media(max-width:1050px){
        .customer-desktop-grid { display:none; }
        .customer-mobile-slider { display:block; }
        .business-visual-grid { display:none; }
        .business-mobile-slider { display:block; }
      }
      .public-mobile-toggle { display:none; }
      @media(max-width:760px){
        .public-nav { position:relative; width:100%; gap:10px; }
        .public-mobile-toggle {
          display:flex;
          width:42px;
          height:42px;
          align-items:center;
          justify-content:center;
          border:1px solid #dbe4ea;
          border-radius:11px;
          background:#fff;
          color:#0f172a;
          font-size:22px;
          font-weight:900;
          cursor:pointer;
          flex:0 0 auto;
        }
        .public-links {
          display:none;
          position:absolute;
          top:calc(100% + 10px);
          left:0;
          right:0;
          width:auto;
          padding:10px;
          background:#fff;
          border:1px solid #e2e8f0;
          border-radius:15px;
          box-shadow:0 18px 45px rgba(15,23,42,.16);
          z-index:100;
        }
        .public-links.mobile-open { display:flex; flex-direction:column; align-items:stretch; gap:4px; }
        .public-links > button,
        .public-links .public-how > summary {
          width:100%;
          box-sizing:border-box;
          text-align:left;
          justify-content:flex-start;
        }
        .public-how { width:100%; }
        .public-menu {
          position:static;
          width:auto;
          margin-top:6px;
          box-shadow:none;
          border-radius:10px;
          background:#f8fafc;
        }
        .public-login-desktop { display:none !important; }
        .public-login-mobile { display:block !important; }
        .overview-two-sides { grid-template-columns:1fr !important; }
        .overview-side-card { padding:18px !important; }
        .overview-pricing-branches {
          justify-content:flex-start !important;
          overflow-x:auto;
          flex-wrap:nowrap !important;
          padding-bottom:4px;
          scrollbar-width:none;
        }
        .overview-pricing-branches::-webkit-scrollbar { display:none; }
        .overview-pricing-branches button { white-space:nowrap; }
        .overview-flow-grid {
          display:flex !important;
          overflow-x:auto;
          gap:12px;
          scroll-snap-type:x mandatory;
          padding:2px 2px 10px;
        }
        .overview-flow-grid > article {
          flex:0 0 calc(100vw - 52px);
          max-width:340px;
          scroll-snap-align:center;
        }
        .pricing-core-grid,
        .pricing-specialized-wrap { display:none !important; }
        .pricing-mobile-slider { display:block !important; }
        .pricing-specialized-content { grid-template-columns:1fr !important; gap:18px !important; }
      }
      @media(min-width:761px){
        .public-login-mobile { display:none !important; }
      }
    `}</style>

    <header style={s.header}>
      <div className="public-nav">
        <button onClick={()=>navigate('/')} style={s.brand}>
          <img src={logo192} alt="LoyaltyTree" style={s.logo}/>
          <span style={s.brandName}>LoyaltyTree</span>
        </button>

        <nav className={`public-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <details className="public-how">
            <summary style={s.navLink}>How It Works ▾</summary>
            <div className="public-menu">
              <button onClick={()=>{navigate('/how-it-works');setMobileMenuOpen(false)}}>📊 Overview</button>
              <button onClick={()=>{navigate('/how-it-works/businesses');setMobileMenuOpen(false)}}>🏪 For Businesses</button>
              <button onClick={()=>{navigate('/how-it-works/customers');setMobileMenuOpen(false)}}>👥 For Customers</button>
              <button onClick={goToPricing}>💳 Pricing</button>
            </div>
          </details>
          <button onClick={goToPricing} style={s.navLink}>Pricing</button>
          <button onClick={()=>{navigate('/about');setMobileMenuOpen(false)}} style={s.navLink}>About Us</button>
          <button onClick={()=>{trackEvent(API_BASE,'contact_click',{page_name:`Public Info - ${type}`,metadata:{placement:'header'}});navigate('/contact');setMobileMenuOpen(false)}} style={s.navLink}>Contact Us</button>
          <button className="public-login-mobile" onClick={()=>{navigate('/login');setMobileMenuOpen(false)}} style={s.mobileLoginBtn}>Business Login</button>
        </nav>

        <button className="public-login-desktop" onClick={()=>navigate('/login')} style={s.loginBtn}>Business Login</button>
        <button
          className="public-mobile-toggle"
          onClick={()=>setMobileMenuOpen(v=>!v)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? '×' : '☰'}
        </button>
      </div>
    </header>

    <main>
      <section style={s.hero}>
        <div style={s.heroInner}>
          <span style={s.eyebrow}>{page.eyebrow}</span>
          <h1 style={s.h1}>{page.title}</h1>
          <p style={s.intro}>{page.intro}</p>
          {type==='overview' && <div style={s.heroActions}>
            <button style={s.primary} onClick={()=>applyBusiness('overview_hero')}>Get Started</button>
            <button style={s.secondary} onClick={()=>navigate('/how-it-works/businesses')}>See it for businesses</button>
          </div>}
        </div>
      </section>

      {type==='customers' && <section style={s.customerJourneySection}>
        <div style={s.customerJourneyIntro}>
          <div>
            <span style={s.customerJourneyEyebrow}>4 SIMPLE STEPS</span>
            <h2 style={s.customerJourneyTitle}>From QR scan to rewards in your Wallet</h2>
          </div>
          <p style={s.customerJourneyIntroText}>A simple customer journey designed to feel familiar on both Android and iPhone.</p>
        </div>

        <div className="customer-desktop-grid">
          {customerSteps.map(step => (
            <article className="customer-desktop-card" style={s.customerJourneyCard} key={step.number}>
              <div style={s.customerJourneyHead}>
                <div style={s.customerStepBadge}>STEP {step.number}</div>
                <h2 style={s.customerDesktopTitle}>{step.title}</h2>
                <p style={s.customerDesktopBody}>{step.body}</p>
              </div>

              <div
                style={{
                  ...s.customerImageGrid,
                  gridTemplateColumns: step.images.length === 1 ? '1fr' : 'repeat(2,minmax(0,1fr))',
                }}
              >
                {step.images.map((image, index) => (
                  <div style={s.customerEqualImageFrame} key={`${step.number}-${index}`}>
                    <img
                      src={image.src}
                      alt={image.alt}
                      style={step.number === 4 ? s.customerNotificationDesktopImage : s.customerEqualImage}
                    />
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="customer-mobile-slider">
          <article style={s.customerSliderCard}>
            <div style={s.customerSliderTop}>
              <div style={s.number}>{customerSteps[customerStep].number}</div>
              <div style={s.customerSliderCounter}>Step {customerStep + 1} of {customerSteps.length}</div>
            </div>

            <h2 style={s.customerSliderTitle}>{customerSteps[customerStep].title}</h2>
            <p style={s.customerSliderBody}>{customerSteps[customerStep].body}</p>

            <div
              style={{
                ...s.customerSliderImages,
                gridTemplateColumns: customerSteps[customerStep].images.length === 1 ? '1fr' : 'repeat(2,minmax(0,1fr))',
              }}
            >
              {customerSteps[customerStep].images.map((image, index) => (
                <div style={s.customerSliderImageFrame} key={`mobile-${customerStep}-${index}`}>
                  <img
                    src={image.src}
                    alt={image.alt}
                    style={customerSteps[customerStep].number === 4 ? s.customerNotificationImage : s.customerSliderImage}
                  />
                </div>
              ))}
            </div>

            <div style={s.customerDots}>
              {customerSteps.map((step, index) => (
                <button
                  key={step.number}
                  onClick={() => goCustomerStep(index)}
                  aria-label={`Go to step ${step.number}`}
                  style={{
                    ...s.customerDot,
                    ...(customerStep === index ? s.customerDotActive : {}),
                  }}
                />
              ))}
            </div>

            <div style={s.customerSliderControls}>
              <button
                onClick={() => goCustomerStep(customerStep - 1)}
                disabled={customerStep === 0}
                style={{
                  ...s.customerArrowBtn,
                  ...(customerStep === 0 ? s.customerArrowDisabled : {}),
                }}
              >
                ← Previous
              </button>
              <button
                onClick={() => goCustomerStep(customerStep + 1)}
                disabled={customerStep === customerSteps.length - 1}
                style={{
                  ...s.customerArrowBtnPrimary,
                  ...(customerStep === customerSteps.length - 1 ? s.customerArrowDisabled : {}),
                }}
              >
                Next Step →
              </button>
            </div>
          </article>
        </div>
      </section>}

      {type==='businesses' && <section style={s.businessJourneySection}>
        <div style={s.businessJourneyIntro}>
          <div>
            <span style={s.customerJourneyEyebrow}>REAL LOYALTYTREE WORKFLOW</span>
            <h2 style={s.customerJourneyTitle}>Everything the business needs, in one operating flow</h2>
          </div>
          <p style={s.customerJourneyIntroText}>
            These are actual LoyaltyTree screens—from card setup to team access, joining and analytics, through announcements, birthday engagement and staff stamp accountability.
          </p>
        </div>

        <div className="business-visual-grid">
          {businessSteps.map(step => (
            <article className="business-visual-card" style={s.businessVisualCard} key={step.number}>
              <div style={s.businessVisualTop}>
                <span style={s.businessTag}>{step.tag}</span>
                <span style={s.businessStepNumber}>{String(step.number).padStart(2,'0')}</span>
              </div>
              <h2 style={s.businessVisualTitle}>{step.title}</h2>
              <p style={s.businessVisualBody}>{step.body}</p>
              <div style={s.businessImageFrame}>
                <img src={step.image} alt={step.alt} style={s.businessImage}/>
              </div>
            </article>
          ))}
        </div>

        <div className="business-mobile-slider">
          <article style={s.businessSliderCard}>
            <div style={s.businessVisualTop}>
              <span style={s.businessTag}>{businessSteps[businessStep].tag}</span>
              <span style={s.customerSliderCounter}>Step {businessStep + 1} of {businessSteps.length}</span>
            </div>
            <h2 style={s.customerSliderTitle}>{businessSteps[businessStep].title}</h2>
            <p style={s.customerSliderBody}>{businessSteps[businessStep].body}</p>
            <div style={s.businessSliderImageFrame}>
              <img src={businessSteps[businessStep].image} alt={businessSteps[businessStep].alt} style={s.businessSliderImage}/>
            </div>
            <div style={s.customerDots}>
              {businessSteps.map((step,index)=>(
                <button
                  key={step.number}
                  onClick={()=>goBusinessStep(index)}
                  aria-label={`Go to business step ${step.number}`}
                  style={{...s.customerDot,...(businessStep===index?s.customerDotActive:{})}}
                />
              ))}
            </div>
            <div style={s.customerSliderControls}>
              <button
                onClick={()=>goBusinessStep(businessStep-1)}
                disabled={businessStep===0}
                style={{...s.customerArrowBtn,...(businessStep===0?s.customerArrowDisabled:{})}}
              >
                ← Previous
              </button>
              <button
                onClick={()=>goBusinessStep(businessStep+1)}
                disabled={businessStep===businessSteps.length-1}
                style={{...s.customerArrowBtnPrimary,...(businessStep===businessSteps.length-1?s.customerArrowDisabled:{})}}
              >
                Next Step →
              </button>
            </div>
          </article>
        </div>
      </section>}

      {type==='overview' && <section style={s.overviewSection}>
        <div style={s.overviewIntroRow}>
          <div>
            <span style={s.customerJourneyEyebrow}>ONE CONNECTED SYSTEM</span>
            <h2 style={s.overviewSectionTitle}>From first scan to the next visit.</h2>
          </div>
          <p style={s.overviewSectionIntro}>
            LoyaltyTree connects what the customer experiences with what the business operates — without breaking the journey into separate tools.
          </p>
        </div>

        <div className="overview-flow-grid" style={s.overviewFlowGrid}>
          {overviewSteps.map((step,index)=>(
            <article key={step.number} style={s.overviewFlowCard}>
              <div style={s.overviewFlowTop}>
                <span style={s.overviewFlowNumber}>{step.number}</span>
                <span style={s.overviewFlowIcon}>{step.icon}</span>
              </div>
              <h3 style={s.overviewFlowTitle}>{step.title}</h3>
              <p style={s.overviewFlowBody}>{step.body}</p>
              {index < overviewSteps.length-1 && <div className="overview-flow-arrow" style={s.overviewFlowArrow}>→</div>}
            </article>
          ))}
        </div>

        <div className="overview-two-sides" style={s.overviewTwoSides}>
          <article className="overview-side-card" style={{...s.overviewSideCard,...s.overviewCustomerCard}}>
            <div style={s.overviewSideIcon}>👥</div>
            <div>
              <span style={s.overviewSideEyebrow}>CUSTOMER SIDE</span>
              <h3 style={s.overviewSideTitle}>Simple enough to use every visit.</h3>
              <p style={s.overviewSideBody}>Scan, join, save the card, show it at checkout, earn progress and receive relevant updates.</p>
              <button style={s.overviewLinkBtn} onClick={()=>navigate('/how-it-works/customers')}>See For Customers →</button>
            </div>
          </article>

          <article className="overview-side-card" style={{...s.overviewSideCard,...s.overviewBusinessCard}}>
            <div style={s.overviewSideIcon}>🏪</div>
            <div>
              <span style={s.overviewSideEyebrow}>BUSINESS SIDE</span>
              <h3 style={s.overviewSideTitle}>One dashboard to operate the relationship.</h3>
              <p style={s.overviewSideBody}>Design the program, create team access, share the join QR, monitor activity, engage customers and analyze performance.</p>
              <button style={s.overviewLinkBtn} onClick={()=>navigate('/how-it-works/businesses')}>See For Businesses →</button>
            </div>
          </article>
        </div>

        <div id="pricing" style={s.pricingSection}>
          <div style={s.pricingHeader}>
            <span style={s.customerJourneyEyebrow}>PRICING</span>
            <h2 style={s.pricingTitle}>Simple pricing that grows with your business.</h2>
            <p style={s.pricingIntro}>
              Choose your branch count, then compare plans. No paper cards, no separate customer app, and no complicated setup.
            </p>
          </div>

          <div className="overview-pricing-branches" style={s.pricingBranchRow}>
            {pricingBranches.map(branch => (
              <button
                key={branch.key}
                onClick={()=>setPricingBranchTier(branch.key)}
                style={{
                  ...s.pricingBranchBtn,
                  ...(pricingBranchTier===branch.key ? s.pricingBranchBtnActive : {}),
                }}
              >
                {branch.label}
              </button>
            ))}
          </div>

          <div className="pricing-core-grid" style={s.pricingGrid}>
            {pricingPlans.filter(plan => plan.key !== 'specialized').map(plan => (
              <article
                key={plan.key}
                style={{
                  ...s.pricingCard,
                  ...(plan.highlight ? s.pricingCardHighlight : {}),
                }}
              >
                <div style={s.pricingCardTop}>
                  <div>
                    {plan.highlight && <div style={s.pricingPopular}>MOST POPULAR</div>}
                    {plan.comingSoon && <div style={s.pricingComingSoon}>COMING SOON</div>}
                    <h3 style={s.pricingPlanName}>{plan.name}</h3>
                    <p style={s.pricingTagline}>{plan.tagline}</p>
                  </div>

                  {plan.prices && (
                    <div style={s.pricingPriceWrap}>
                      <span style={s.pricingCurrency}>₱</span>
                      <span style={s.pricingPrice}>{plan.prices[pricingBranchTier].toLocaleString()}</span>
                      <span style={s.pricingUnit}>/mo</span>
                    </div>
                  )}
                </div>

                <div style={s.pricingDivider}/>

                <ul style={s.pricingFeatureList}>
                  {plan.features.map(feature => (
                    <li key={feature} style={s.pricingFeatureItem}>
                      <span style={s.pricingCheck}>✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={()=>contactLoyaltyTree('pricing_or_cta')}
                  style={plan.highlight ? s.pricingPrimaryBtn : s.pricingSecondaryBtn}
                >
                  {plan.comingSoon ? 'Ask About Pro' : 'Get Started'}
                </button>
              </article>
            ))}
          </div>

          <div className="pricing-specialized-wrap">
            {pricingPlans.filter(plan => plan.key === 'specialized').map(plan => (
              <article key={plan.key} style={s.pricingSpecializedCard}>
                <div className="pricing-specialized-content" style={s.pricingSpecializedContent}>
                  <div>
                    <div style={s.pricingSpecializedEyebrow}>CUSTOM SOLUTION</div>
                    <h3 style={s.pricingSpecializedTitle}>{plan.name}</h3>
                    <p style={s.pricingSpecializedTagline}>{plan.tagline}</p>

                    <div style={s.pricingSpecializedBenefits}>
                      {plan.benefits?.map(benefit => (
                        <span key={benefit} style={s.pricingSpecializedBenefit}>{benefit}</span>
                      ))}
                    </div>

                    <div style={s.pricingDiscuss}>Pricing upon discussion</div>
                  </div>

                  <div>
                    <div style={s.pricingSpecializedFeatureTitle}>Connect LoyaltyTree with your business systems</div>
                    <div style={s.pricingSpecializedFeatures}>
                      {plan.features.slice(0,8).map(feature => (
                        <div key={feature} style={s.pricingSpecializedFeature}>
                          <span style={s.pricingCheck}>✓</span>
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={()=>contactLoyaltyTree('pricing_or_cta')} style={s.pricingPrimaryBtn}>
                    Discuss Your System
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="pricing-mobile-slider">
            {(() => {
              const plan = pricingPlans[pricingStep]
              const specialized = plan.key === 'specialized'
              return <article style={specialized ? s.pricingMobileSpecializedCard : {...s.pricingMobileCard,...(plan.highlight?s.pricingCardHighlight:{})}}>
                <div style={s.pricingMobileTop}>
                  <div style={specialized ? s.pricingSpecializedEyebrow : s.pricingMobileStepLabel}>
                    {specialized ? 'CUSTOM SOLUTION' : `PLAN ${pricingStep + 1} OF ${pricingPlans.length}`}
                  </div>
                  {plan.highlight && <div style={s.pricingPopular}>MOST POPULAR</div>}
                  {plan.comingSoon && <div style={s.pricingComingSoon}>COMING SOON</div>}
                  <h3 style={specialized?s.pricingSpecializedTitle:s.pricingPlanName}>{plan.name}</h3>
                  <p style={specialized?s.pricingSpecializedTagline:s.pricingTagline}>{plan.tagline}</p>
                  {!specialized && plan.prices && <div style={s.pricingPriceWrap}>
                    <span style={s.pricingCurrency}>₱</span>
                    <span style={s.pricingPrice}>{plan.prices[pricingBranchTier].toLocaleString()}</span>
                    <span style={s.pricingUnit}>/mo</span>
                  </div>}
                  {specialized && <>
                    <div style={s.pricingSpecializedBenefits}>{plan.benefits?.map(x=><span key={x} style={s.pricingSpecializedBenefit}>{x}</span>)}</div>
                    <div style={{...s.pricingDiscuss,color:'#99f6e4'}}>Pricing upon discussion</div>
                  </>}
                </div>

                <div style={specialized?s.pricingMobileSpecializedFeatures:s.pricingFeatureList}>
                  {(specialized?plan.features.slice(0,8):plan.features).map(feature=>
                    <div key={feature} style={specialized?s.pricingSpecializedFeature:s.pricingFeatureItem}>
                      <span style={s.pricingCheck}>✓</span><span>{feature}</span>
                    </div>
                  )}
                </div>

                <button onClick={()=>contactLoyaltyTree('pricing_or_cta')} style={specialized||plan.highlight?s.pricingPrimaryBtn:s.pricingSecondaryBtn}>
                  {specialized?'Discuss Your System':(plan.comingSoon?'Ask About Pro':'Get Started')}
                </button>

                <div style={s.pricingMobileDots}>
                  {pricingPlans.map((item,index)=><button key={item.key} onClick={()=>setPricingStep(index)}
                    aria-label={`Go to ${item.name}`}
                    style={{...s.customerDot,...(pricingStep===index?s.customerDotActive:{})}} />)}
                </div>
                <div style={s.pricingMobileControls}>
                  <button onClick={()=>setPricingStep(Math.max(0,pricingStep-1))} disabled={pricingStep===0}
                    style={{...s.customerArrowBtn,...(pricingStep===0?s.customerArrowDisabled:{})}}>← Previous</button>
                  <button onClick={()=>setPricingStep(Math.min(pricingPlans.length-1,pricingStep+1))}
                    disabled={pricingStep===pricingPlans.length-1}
                    style={{...s.customerArrowBtnPrimary,...(pricingStep===pricingPlans.length-1?s.customerArrowDisabled:{})}}>Next →</button>
                </div>
              </article>
            })()}
          </div>

          <p style={s.pricingNote}>
            Need more than 5 branches or a custom deployment? Contact LoyaltyTree and we can discuss a specialized setup for your business.
          </p>
        </div>
      </section>}

      {page.steps && type!=='customers' && type!=='businesses' && type!=='overview' && <section style={s.section}>
        <div style={s.stepGrid}>
          {page.steps.map(([n,title,body])=><article key={n} style={s.stepCard}>
            <div style={s.number}>{n}</div>
            <h2 style={s.stepTitle}>{title}</h2>
            <p style={s.body}>{body}</p>
          </article>)}
        </div>
      </section>}

      {page.features && <section style={{...s.section,paddingTop:12}}>
        <h2 style={s.sectionTitle}>{page.featureTitle}</h2>
        <div style={s.featureGrid}>
          {page.features.map(([icon,title,body])=><article key={title} style={s.featureCard}>
            <div style={s.icon}>{icon}</div>
            <div><h3 style={s.featureTitle}>{title}</h3><p style={s.body}>{body}</p></div>
          </article>)}
        </div>
      </section>}

      {page.paragraphs && <section style={s.section}>
        <div style={s.storyCard}>
          {page.paragraphs.map((p,i)=><p key={i} style={s.storyText}>{p}</p>)}
          {page.founder && <>
            <div style={s.founderCard}>
              <div style={s.founderAvatar}>A</div>
              <div>
                <div style={s.founderRole}>{page.founder.role}</div>
                <div style={s.founderName}>{page.founder.name}</div>
                <div style={s.founderHandle}>{page.founder.handle}</div>
              </div>
            </div>

            <div style={s.founderBioCard}>
              <div style={s.founderBioEyebrow}>THE PERSON BEHIND LOYALTYTREE</div>
              <h3 style={s.founderBioTitle}>{page.founder.bioTitle}</h3>
              {page.founder.bio?.map((paragraph,index)=>(
                <p key={index} style={s.founderBioText}>{paragraph}</p>
              ))}

              {page.founder.credentials && <div style={s.founderCredentials}>
                {page.founder.credentials.map(([icon,title,detail])=>(
                  <div key={title} style={s.founderCredentialCard}>
                    <div style={s.founderCredentialIcon}>{icon}</div>
                    <div>
                      <div style={s.founderCredentialTitle}>{title}</div>
                      <div style={s.founderCredentialDetail}>{detail}</div>
                    </div>
                  </div>
                ))}
              </div>}

              {page.founder.media && <div style={s.founderMediaBlock}>
                <div style={s.founderMediaLabel}>PREVIOUS WORK & MEDIA FEATURES</div>
                <p style={s.founderMediaNote}>
                  These publications covered Alfred&apos;s previous work and ventures. They are not media features or endorsements of LoyaltyTree.
                </p>
                <div style={s.founderMediaLinks}>
                  {page.founder.media.map(([name,url])=>(
                    <a key={name} href={url} target="_blank" rel="noopener noreferrer" style={s.founderMediaLink}>
                      {name} <span aria-hidden="true">↗</span>
                    </a>
                  ))}
                </div>
              </div>}
            </div>
          </>}
          <button style={s.primary} onClick={()=>contactLoyaltyTree('pricing_or_cta')}>Contact LoyaltyTree</button>
        </div>
      </section>}

      {page.contact && <section style={s.section}>
        <div style={s.contactIntroCard}>
          <span style={s.contactKicker}>LET'S CONNECT</span>
          <h2 style={s.contactHeading}>Talk directly with LoyaltyTree.</h2>
          <p style={s.contactLead}>For business onboarding, product questions, support, partnerships, or general inquiries, use any of the contact channels below.</p>
        </div>

        <div style={s.contactGrid}>
          <div style={s.contactCard}>
            <div style={s.contactIconBox}>📱</div>
            <div>
              <div style={s.contactLabel}>MOBILE NUMBER</div>
              <a href="tel:+639397992144" style={s.contactValue}>0939 799 2144</a>
              <div style={s.contactMeta}>Smart</div>
            </div>
          </div>

          <div style={s.contactCard}>
            <div style={s.contactIconBox}>✉️</div>
            <div>
              <div style={s.contactLabel}>EMAIL</div>
              <a href="mailto:fredsomeros.stocks@gmail.com" style={s.contactValue}>fredsomeros.stocks@gmail.com</a>
              <a href="mailto:theloyaltytree@gmail.com" style={s.contactValue}>theloyaltytree@gmail.com</a>
            </div>
          </div>

          <div style={s.contactCard}>
            <div style={s.contactIconBox}>🤝</div>
            <div>
              <div style={s.contactLabel}>BUSINESS & PARTNERSHIPS</div>
              <div style={s.contactText}>Interested in LoyaltyTree for your business or in becoming a city or regional partner?</div>
              <button style={{...s.secondary,marginTop:14}} onClick={openMessenger}>Message LoyaltyTree</button>
            </div>
          </div>
        </div>
      </section>}
    </main>

    <footer style={s.footer}>
      <span>© {new Date().getFullYear()} LoyaltyTree</span>
      <button onClick={()=>navigate('/')} style={s.footerLink}>Back to homepage</button>
    </footer>
  </div>
}

const s={
  page:{minHeight:'100vh',background:'#fff',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',color:'#0f172a'},
  header:{position:'sticky',top:0,zIndex:50,background:'rgba(255,255,255,.96)',backdropFilter:'blur(12px)',borderBottom:'1px solid #e2e8f0',padding:'14px clamp(16px,4vw,54px)'},
  brand:{display:'flex',alignItems:'center',gap:9,border:0,background:'transparent',padding:0,cursor:'pointer'},
  logo:{width:34,height:34,borderRadius:'50%'},brandName:{fontSize:20,fontWeight:850,color:'#0f766e'},
  navLink:{border:0,background:'transparent',padding:'9px 10px',borderRadius:9,color:'#334155',fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'},
  loginBtn:{border:0,background:'#0d9488',color:'#fff',padding:'10px 15px',borderRadius:10,fontWeight:800,cursor:'pointer',whiteSpace:'nowrap'},
  mobileLoginBtn:{width:'100%',border:0,background:'#0d9488',color:'#fff',padding:'12px 14px',borderRadius:10,fontWeight:800,cursor:'pointer',textAlign:'center',marginTop:4},
  hero:{background:'linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 55%,#f8fafc 100%)',padding:'clamp(64px,9vw,110px) 22px'},
  heroInner:{maxWidth:900,margin:'0 auto',textAlign:'center'},eyebrow:{fontSize:11,fontWeight:900,letterSpacing:1.5,color:'#0f766e'},
  h1:{fontSize:'clamp(36px,6vw,66px)',lineHeight:1.04,letterSpacing:'-.035em',margin:'14px 0 20px',fontWeight:900},
  intro:{fontSize:'clamp(16px,2vw,21px)',lineHeight:1.65,color:'#475569',maxWidth:760,margin:'0 auto'},
  heroActions:{display:'flex',justifyContent:'center',gap:10,flexWrap:'wrap',marginTop:28},
  primary:{border:0,background:'#0d9488',color:'#fff',padding:'12px 17px',borderRadius:11,fontWeight:850,cursor:'pointer'},
  secondary:{border:'1px solid #0d9488',background:'#fff',color:'#0f766e',padding:'11px 16px',borderRadius:11,fontWeight:850,cursor:'pointer'},
  section:{maxWidth:1100,margin:'0 auto',padding:'58px 22px'},
  overviewSection:{maxWidth:1260,margin:'0 auto',padding:'clamp(34px,7vw,58px) clamp(14px,4vw,22px) 24px'},
  overviewIntroRow:{
    display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:18,flexWrap:'wrap',marginBottom:20,
  },
  overviewSectionTitle:{fontSize:'clamp(27px,4vw,40px)',lineHeight:1.12,fontWeight:900,margin:'6px 0 0',color:'#0f172a'},
  overviewSectionIntro:{maxWidth:500,fontSize:'clamp(13px,2.8vw,14px)',lineHeight:1.65,color:'#64748b',margin:0},
  overviewFlowGrid:{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:12},
  overviewFlowCard:{
    position:'relative',minWidth:0,background:'#fff',border:'1px solid #e2e8f0',borderRadius:18,
    padding:18,boxShadow:'0 10px 28px rgba(15,23,42,.05)',
  },
  overviewFlowTop:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:18},
  overviewFlowNumber:{fontSize:10,fontWeight:900,letterSpacing:1,color:'#0f766e',background:'#ecfdf5',padding:'5px 7px',borderRadius:999},
  overviewFlowIcon:{fontSize:22},
  overviewFlowTitle:{fontSize:15.5,fontWeight:900,lineHeight:1.25,color:'#0f172a',margin:'0 0 7px'},
  overviewFlowBody:{fontSize:12.5,lineHeight:1.6,color:'#64748b',margin:0},
  overviewFlowArrow:{
    position:'absolute',right:-13,top:'50%',transform:'translateY(-50%)',width:25,height:25,borderRadius:'50%',
    display:'grid',placeItems:'center',background:'#0d9488',color:'#fff',fontWeight:900,zIndex:3,boxShadow:'0 5px 14px rgba(13,148,136,.2)',
  },
  overviewTwoSides:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16,marginTop:24},
  overviewSideCard:{display:'flex',gap:14,alignItems:'flex-start',padding:'clamp(18px,4vw,24px)',borderRadius:20,border:'1px solid #e2e8f0'},
  overviewCustomerCard:{background:'linear-gradient(135deg,#f8fafc,#eff6ff)'},
  overviewBusinessCard:{background:'linear-gradient(135deg,#f0fdf4,#ecfdf5)'},
  overviewSideIcon:{width:48,height:48,borderRadius:14,display:'grid',placeItems:'center',fontSize:23,background:'#fff',flexShrink:0,boxShadow:'0 6px 18px rgba(15,23,42,.06)'},
  overviewSideEyebrow:{fontSize:9.5,fontWeight:900,letterSpacing:1,color:'#0f766e'},
  overviewSideTitle:{fontSize:20,fontWeight:900,lineHeight:1.25,color:'#0f172a',margin:'5px 0 8px'},
  overviewSideBody:{fontSize:13.5,lineHeight:1.65,color:'#64748b',margin:'0 0 13px'},
  overviewLinkBtn:{border:0,background:'transparent',padding:0,color:'#0f766e',fontWeight:850,fontSize:12.5,cursor:'pointer'},
  pricingSection:{marginTop:'clamp(42px,8vw,72px)',paddingTop:'clamp(40px,7vw,62px)',borderTop:'1px solid #e2e8f0',scrollMarginTop:90},
  pricingHeader:{maxWidth:720,margin:'0 auto 24px',textAlign:'center'},
  pricingTitle:{fontSize:'clamp(28px,4vw,42px)',lineHeight:1.12,fontWeight:900,color:'#0f172a',margin:'7px 0 12px'},
  pricingIntro:{fontSize:14.5,lineHeight:1.7,color:'#64748b',margin:0},
  pricingBranchRow:{display:'flex',justifyContent:'center',gap:8,flexWrap:'wrap',marginBottom:24},
  pricingBranchBtn:{border:'1px solid #cbd5e1',background:'#fff',color:'#475569',padding:'9px 14px',borderRadius:999,fontWeight:800,fontSize:12,cursor:'pointer'},
  pricingBranchBtnActive:{background:'#0d9488',borderColor:'#0d9488',color:'#fff',boxShadow:'0 7px 18px rgba(13,148,136,.18)'},
  pricingGrid:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:18,alignItems:'stretch'},
  pricingCard:{position:'relative',display:'flex',flexDirection:'column',background:'#fff',border:'1px solid #e2e8f0',borderRadius:18,padding:22,boxShadow:'0 10px 26px rgba(15,23,42,.045)'},
  pricingCardHighlight:{border:'2px solid #0d9488',boxShadow:'0 16px 34px rgba(13,148,136,.12)'},
  pricingCardSpecialized:{gridColumn:'1 / -1',maxWidth:760,width:'100%',margin:'0 auto'},
  pricingPopular:{display:'inline-flex',background:'#0d9488',color:'#fff',fontSize:9,fontWeight:900,letterSpacing:1,padding:'6px 10px',borderRadius:999,whiteSpace:'nowrap',marginBottom:10},
  pricingComingSoon:{display:'inline-flex',alignSelf:'flex-start',background:'#f1f5f9',color:'#64748b',fontSize:9,fontWeight:900,letterSpacing:.8,padding:'5px 8px',borderRadius:999,marginBottom:8},
  pricingPlanName:{fontSize:22,fontWeight:900,color:'#0f172a',margin:'2px 0 6px'},
  pricingTagline:{fontSize:12.5,lineHeight:1.5,color:'#64748b',margin:'0 0 14px',minHeight:52},
  pricingPriceWrap:{display:'flex',alignItems:'baseline',gap:2,marginBottom:17},
  pricingCurrency:{fontSize:16,fontWeight:850,color:'#0f766e'},
  pricingPrice:{fontSize:38,fontWeight:950,color:'#0f172a',letterSpacing:'-.045em'},
  pricingUnit:{fontSize:11,color:'#64748b',fontWeight:700},
  pricingCardTop:{display:'flex',flexDirection:'column'},
  pricingDivider:{height:1,background:'#eef2f7',margin:'4px 0 16px'},
  pricingDiscuss:{fontSize:21,fontWeight:900,color:'#0f766e',margin:'5px 0 10px'},
  pricingSpecializedCard:{background:'linear-gradient(135deg,#0f172a,#134e4a)',color:'#fff',borderRadius:20,padding:24,boxShadow:'0 18px 38px rgba(15,23,42,.14)'},
  pricingSpecializedContent:{display:'grid',gridTemplateColumns:'1.2fr 1.5fr auto',gap:24,alignItems:'center'},
  pricingSpecializedEyebrow:{fontSize:9.5,fontWeight:900,letterSpacing:1.1,color:'#99f6e4',marginBottom:6},
  pricingSpecializedTitle:{fontSize:24,fontWeight:900,margin:'0 0 8px',color:'#fff'},
  pricingSpecializedTagline:{fontSize:13.5,lineHeight:1.6,color:'rgba(255,255,255,.78)',margin:0,maxWidth:500},
  pricingSpecializedBenefits:{display:'flex',gap:8,flexWrap:'wrap',margin:'14px 0 4px'},
  pricingSpecializedBenefit:{
    display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'6px 9px',
    borderRadius:999,background:'rgba(153,246,228,.12)',border:'1px solid rgba(153,246,228,.22)',
    color:'#ccfbf1',fontSize:10,fontWeight:900,letterSpacing:.6,
  },
  pricingSpecializedFeatureTitle:{fontSize:11,fontWeight:900,letterSpacing:.7,color:'#99f6e4',marginBottom:10,textTransform:'uppercase'},
  pricingSpecializedFeatures:{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:'8px 14px'},
  pricingSpecializedFeature:{display:'flex',gap:8,fontSize:11.5,lineHeight:1.4,color:'rgba(255,255,255,.88)'},
  pricingFeatureList:{listStyle:'none',padding:0,margin:'0 0 18px',display:'grid',gap:8,flex:1},
  pricingFeatureItem:{display:'flex',gap:8,alignItems:'flex-start',fontSize:11.5,lineHeight:1.4,color:'#475569'},
  pricingCheck:{color:'#0d9488',fontWeight:900,marginTop:1},
  pricingPrimaryBtn:{width:'100%',border:0,background:'#0d9488',color:'#fff',padding:'11px 12px',borderRadius:10,fontWeight:850,cursor:'pointer'},
  pricingSecondaryBtn:{width:'100%',border:'1px solid #0d9488',background:'#fff',color:'#0f766e',padding:'10px 12px',borderRadius:10,fontWeight:850,cursor:'pointer'},
  pricingNote:{textAlign:'center',maxWidth:720,margin:'20px auto 0',fontSize:12.5,lineHeight:1.6,color:'#64748b'},
  pricingMobileCard:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:20,padding:20,boxShadow:'0 12px 30px rgba(15,23,42,.06)'},
  pricingMobileSpecializedCard:{background:'linear-gradient(135deg,#0f172a,#134e4a)',color:'#fff',borderRadius:20,padding:20,boxShadow:'0 16px 34px rgba(15,23,42,.14)'},
  pricingMobileTop:{marginBottom:16},
  pricingMobileStepLabel:{fontSize:9.5,fontWeight:900,letterSpacing:1,color:'#0f766e',marginBottom:8},
  pricingMobileSpecializedFeatures:{display:'grid',gap:9,margin:'16px 0 18px'},
  pricingMobileDots:{display:'flex',justifyContent:'center',gap:7,margin:'20px 0 14px'},
  pricingMobileControls:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10},
  customerJourneySection:{maxWidth:1320,margin:'0 auto',padding:'52px 22px 24px'},
  customerJourneyIntro:{
    display:'flex',justifyContent:'space-between',gap:24,alignItems:'flex-end',
    marginBottom:22,padding:'0 4px',flexWrap:'wrap',
  },
  customerJourneyEyebrow:{fontSize:10,fontWeight:900,letterSpacing:1.2,color:'#0f766e'},
  customerJourneyTitle:{fontSize:'clamp(24px,3vw,34px)',lineHeight:1.15,fontWeight:900,margin:'6px 0 0',color:'#0f172a'},
  customerJourneyIntroText:{maxWidth:430,fontSize:13.5,lineHeight:1.6,color:'#64748b',margin:0},
  customerJourneyGrid:{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:18,alignItems:'stretch'},
  customerJourneyCard:{
    minWidth:0,display:'flex',flexDirection:'column',background:'#fff',
    border:'1px solid #e2e8f0',borderRadius:22,padding:16,
    boxShadow:'0 14px 36px rgba(15,23,42,.07)',
  },
  customerJourneyHead:{
    display:'flex',flexDirection:'column',alignItems:'flex-start',minHeight:148,padding:'2px 2px 14px',
  },
  customerStepBadge:{
    display:'inline-flex',alignItems:'center',justifyContent:'center',background:'#ecfdf5',
    color:'#0f766e',border:'1px solid #a7f3d0',borderRadius:999,padding:'6px 9px',
    fontSize:10,fontWeight:900,letterSpacing:.8,marginBottom:10,
  },
  customerDesktopTitle:{fontSize:19,fontWeight:900,lineHeight:1.2,margin:'0 0 8px',color:'#0f172a'},
  customerDesktopBody:{fontSize:13,lineHeight:1.6,color:'#64748b',margin:0},
  customerImageGrid:{display:'grid',gap:8,flex:1},
  customerEqualImageFrame:{
    height:390,border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',background:'#f8fafc',
    display:'flex',alignItems:'center',justifyContent:'center',
  },
  customerEqualImage:{
    width:'100%',height:'100%',objectFit:'cover',objectPosition:'center',display:'block',
  },
  customerSliderCard:{
    maxWidth:720,margin:'0 auto',background:'#fff',border:'1px solid #e2e8f0',borderRadius:20,
    padding:'clamp(16px,4vw,24px)',boxShadow:'0 16px 42px rgba(15,23,42,.08)',
  },
  customerSliderTop:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12},
  customerSliderCounter:{fontSize:12,fontWeight:800,color:'#0f766e'},
  customerSliderTitle:{fontSize:'clamp(22px,5vw,30px)',fontWeight:900,margin:'12px 0 8px'},
  customerSliderBody:{fontSize:14,lineHeight:1.65,color:'#64748b',margin:'0 0 18px'},
  customerSliderImages:{display:'grid',gap:8},
  customerSliderImageFrame:{
    height:'clamp(360px,62vh,560px)',border:'1px solid #e2e8f0',borderRadius:18,overflow:'hidden',
    background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',
  },
  customerSliderImage:{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center',display:'block'},
  customerNotificationDesktopImage:{
    width:'100%',height:'100%',objectFit:'cover',objectPosition:'center 70%',display:'block',
  },
  customerNotificationImage:{width:'100%',height:'100%',objectFit:'contain',objectPosition:'center',display:'block',background:'#f8fafc'},
  customerDots:{display:'flex',justifyContent:'center',gap:8,marginTop:18},
  customerDot:{width:8,height:8,borderRadius:'50%',border:0,background:'#cbd5e1',padding:0,cursor:'pointer'},
  customerDotActive:{width:24,borderRadius:999,background:'#0d9488'},
  customerSliderControls:{display:'flex',justifyContent:'space-between',gap:10,marginTop:18},
  customerArrowBtn:{
    flex:1,border:'1px solid #cbd5e1',background:'#fff',color:'#334155',padding:'11px 14px',
    borderRadius:11,fontWeight:850,cursor:'pointer',
  },
  customerArrowBtnPrimary:{
    flex:1,border:'1px solid #0d9488',background:'#0d9488',color:'#fff',padding:'11px 14px',
    borderRadius:11,fontWeight:850,cursor:'pointer',
  },
  customerArrowDisabled:{opacity:.4,cursor:'not-allowed'},
  businessJourneySection:{maxWidth:1320,margin:'0 auto',padding:'52px 22px 20px'},
  businessJourneyIntro:{
    display:'flex',justifyContent:'space-between',gap:24,alignItems:'flex-end',
    marginBottom:22,padding:'0 4px',flexWrap:'wrap',
  },
  businessVisualCard:{
    minWidth:0,background:'#fff',border:'1px solid #e2e8f0',borderRadius:22,padding:16,
    boxShadow:'0 14px 36px rgba(15,23,42,.065)',display:'flex',flexDirection:'column',
  },
  businessVisualTop:{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',marginBottom:10},
  businessTag:{
    background:'#ecfdf5',color:'#0f766e',border:'1px solid #a7f3d0',borderRadius:999,
    padding:'6px 9px',fontSize:9.5,fontWeight:900,letterSpacing:.7,
  },
  businessStepNumber:{fontSize:20,fontWeight:900,color:'#cbd5e1'},
  businessVisualTitle:{fontSize:20,fontWeight:900,lineHeight:1.2,margin:'0 0 8px',color:'#0f172a'},
  businessVisualBody:{fontSize:13,lineHeight:1.6,color:'#64748b',margin:'0 0 14px',minHeight:62},
  businessImageFrame:{
    height:300,border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',background:'#f8fafc',
    marginTop:'auto',
  },
  businessImage:{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center',display:'block'},
  businessSliderCard:{
    maxWidth:820,margin:'0 auto',background:'#fff',border:'1px solid #e2e8f0',borderRadius:20,
    padding:'clamp(16px,4vw,24px)',boxShadow:'0 16px 42px rgba(15,23,42,.08)',
  },
  businessSliderImageFrame:{
    height:'clamp(300px,55vh,560px)',border:'1px solid #e2e8f0',borderRadius:18,overflow:'hidden',
    background:'#f8fafc',
  },
  businessSliderImage:{width:'100%',height:'100%',objectFit:'contain',objectPosition:'center',display:'block'},
  stepGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:13},
  stepCard:{border:'1px solid #e2e8f0',borderRadius:16,padding:20,background:'#fff',boxShadow:'0 8px 25px rgba(15,23,42,.035)'},
  number:{width:34,height:34,borderRadius:'50%',display:'grid',placeItems:'center',background:'#d1fae5',color:'#047857',fontWeight:900,marginBottom:13},
  stepTitle:{fontSize:17,fontWeight:850,margin:'0 0 7px'},body:{fontSize:13.5,lineHeight:1.65,color:'#64748b',margin:'0 0 15px'},
  sectionTitle:{fontSize:28,fontWeight:900,textAlign:'center',margin:'0 0 24px'},
  featureGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:13},
  featureCard:{display:'flex',gap:13,border:'1px solid #e2e8f0',borderRadius:15,padding:18,background:'#f8fafc'},
  icon:{width:44,height:44,borderRadius:13,background:'#ecfdf5',display:'grid',placeItems:'center',fontSize:21,flexShrink:0},
  featureTitle:{fontSize:15,fontWeight:850,margin:'2px 0 5px'},
  storyCard:{maxWidth:820,margin:'0 auto',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:18,padding:'clamp(22px,4vw,38px)'},
  storyText:{fontSize:16,lineHeight:1.8,color:'#475569',margin:'0 0 18px'},
  founderCard:{
    display:'flex',alignItems:'center',gap:14,margin:'26px 0',padding:18,
    border:'1px solid #d1fae5',borderRadius:16,background:'linear-gradient(135deg,#f0fdf4,#ecfdf5)',
  },
  founderAvatar:{
    width:52,height:52,borderRadius:'50%',display:'grid',placeItems:'center',
    background:'#0d9488',color:'#fff',fontSize:20,fontWeight:900,flexShrink:0,
  },
  founderRole:{fontSize:11,fontWeight:900,letterSpacing:.7,color:'#0f766e',textTransform:'uppercase'},
  founderName:{fontSize:18,fontWeight:900,color:'#0f172a',marginTop:2},
  founderHandle:{fontSize:12,color:'#64748b',marginTop:2},
  founderBioCard:{
    margin:'0 0 26px',padding:'clamp(20px,4vw,30px)',borderRadius:18,
    background:'#fff',border:'1px solid #e2e8f0',boxShadow:'0 12px 30px rgba(15,23,42,.05)',
  },
  founderBioEyebrow:{fontSize:10,fontWeight:900,letterSpacing:1.2,color:'#0f766e',marginBottom:7},
  founderBioTitle:{fontSize:24,fontWeight:900,color:'#0f172a',margin:'0 0 14px'},
  founderBioText:{fontSize:14.5,lineHeight:1.75,color:'#475569',margin:'0 0 13px'},
  founderCredentials:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginTop:20},
  founderCredentialCard:{display:'flex',alignItems:'center',gap:11,padding:'12px 13px',border:'1px solid #e2e8f0',borderRadius:13,background:'#f8fafc'},
  founderCredentialIcon:{width:34,height:34,borderRadius:10,background:'#ecfdf5',display:'grid',placeItems:'center',fontSize:17,flexShrink:0},
  founderCredentialTitle:{fontSize:12.5,fontWeight:850,color:'#0f172a',lineHeight:1.35},
  founderCredentialDetail:{fontSize:11.5,color:'#64748b',marginTop:2},
  founderMediaBlock:{marginTop:20,padding:16,borderRadius:15,background:'#f0fdfa',border:'1px solid #ccfbf1'},
  founderMediaLabel:{fontSize:10,fontWeight:900,letterSpacing:1.2,color:'#0f766e'},
  founderMediaNote:{fontSize:11.5,lineHeight:1.55,color:'#64748b',margin:'6px 0 11px'},
  founderMediaLinks:{display:'flex',flexWrap:'wrap',gap:8},
  founderMediaLink:{display:'inline-flex',alignItems:'center',gap:4,padding:'8px 10px',borderRadius:9,background:'#fff',border:'1px solid #99f6e4',color:'#0f766e',fontSize:11.5,fontWeight:800,textDecoration:'none'},
  contactIntroCard:{maxWidth:760,margin:'0 auto 28px',textAlign:'center'},
  contactKicker:{fontSize:10,fontWeight:900,letterSpacing:1.5,color:'#0f766e'},
  contactHeading:{fontSize:'clamp(26px,4vw,40px)',lineHeight:1.12,fontWeight:900,margin:'8px 0 12px',color:'#0f172a'},
  contactLead:{fontSize:15,lineHeight:1.7,color:'#64748b',margin:0},
  contactGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,340px))',justifyContent:'center',gap:16,alignItems:'start',maxWidth:1050,margin:'0 auto'},
  contactCard:{width:'100%',boxSizing:'border-box',border:'1px solid #e2e8f0',borderRadius:20,padding:24,background:'#fff',display:'flex',gap:16,alignItems:'flex-start',boxShadow:'0 12px 30px rgba(15,23,42,.05)'},
  contactIconBox:{width:46,height:46,borderRadius:14,background:'#ecfdf5',display:'grid',placeItems:'center',fontSize:21,flexShrink:0},
  contactLabel:{fontSize:10,fontWeight:900,letterSpacing:1,color:'#0f766e',marginBottom:7},
  contactValue:{display:'block',fontSize:15,fontWeight:800,color:'#0f172a',textDecoration:'none',lineHeight:1.7,wordBreak:'break-word'},
  contactMeta:{fontSize:12,color:'#64748b',marginTop:2},
  contactText:{fontSize:13.5,lineHeight:1.6,color:'#64748b'},
  footer:{borderTop:'1px solid #e2e8f0',padding:'24px clamp(18px,4vw,54px)',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',fontSize:12,color:'#64748b'},
  footerLink:{border:0,background:'transparent',color:'#0f766e',fontWeight:800,cursor:'pointer'},
}

export default PublicInfoPage

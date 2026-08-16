import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo192 from './logo-192.png'
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
    eyebrow: 'HOW IT WORKS',
    title: 'One loyalty system. From first scan to repeat customer.',
    intro: 'LoyaltyTree connects customer joining, digital Wallet cards, cashier activity, rewards, retention and business analytics in one flow.',
    steps: [
      ['1', 'Customer joins', 'A customer scans the business QR code and joins the loyalty program from their phone.'],
      ['2', 'Card goes to Wallet', 'Their LoyaltyTree card can be saved to Apple Wallet or Google Wallet, so there is no separate loyalty app to remember.'],
      ['3', 'Cashier scans the customer', 'At checkout, an authorized cashier uses the normal LoyaltyTree camera scanner to identify the customer and record the correct activity.'],
      ['4', 'Rewards update', 'Stamps, points, membership status, VIP progress or pass sessions update in the same customer record and sync back to the Wallet card.'],
      ['5', 'Loyalty keeps working', 'Announcements, birthday greetings, win-back activity, analytics and retention tools help the business keep customers engaged.'],
    ],
    featureTitle: 'The LoyaltyTree loop',
    features: [
      ['📲', 'QR-first joining', 'Fast onboarding for customers using a link or printed QR code.'],
      ['👛', 'Digital Wallet card', 'A loyalty card customers can keep with the cards they already use on their phone.'],
      ['📷', 'Cashier scanning', 'Authorized staff scan the customer and perform the correct loyalty transaction.'],
      ['📊', 'Business visibility', 'Owners can see customer activity, loyalty performance and operational trends.'],
      ['🔔', 'Customer engagement', 'Wallet updates and retention features help bring customers back.'],
      ['🔒', 'Controlled transactions', 'Cashier sessions, audit records and transaction protections keep loyalty activity accountable.'],
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
    title: 'Loyalty technology built for stronger customer relationships.',
    intro: 'LoyaltyTree is designed to help businesses replace fragmented paper-card loyalty with a connected digital experience for customers, cashiers and owners.',
    paragraphs: [
      'The platform brings together digital loyalty cards, QR enrollment, cashier tools, Wallet integration, customer activity, retention features and analytics.',
      'Our focus is making loyalty practical for real businesses: easy for customers to join, simple for staff to operate, and useful for owners who want to understand and grow repeat business.',
      'LoyaltyTree is also being structured for local support through business and partner networks, helping businesses receive more hands-on onboarding and assistance as the platform expands.',
    ],
  },
  contact: {
    eyebrow: 'CONTACT',
    title: 'Talk to LoyaltyTree.',
    intro: 'Have a question about the platform, business setup, support, or partnership opportunities? Reach out and we’ll point you in the right direction.',
    contact: true,
  },
}

function PublicInfoPage({ type='overview' }) {
  const navigate = useNavigate()
  const page = PAGE_CONTENT[type] || PAGE_CONTENT.overview
  const [customerStep, setCustomerStep] = useState(0)
  const [businessStep, setBusinessStep] = useState(0)

  useEffect(() => {
    setCustomerStep(0)
    setBusinessStep(0)
  }, [type])

  const openMessenger = () => window.open('https://m.me/theloyaltytree', '_blank', 'noopener,noreferrer')

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
      .public-nav { display:flex; align-items:center; justify-content:space-between; gap:18px; }
      .public-links { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
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
      @media(max-width:1050px){
        .customer-desktop-grid { display:none; }
        .customer-mobile-slider { display:block; }
        .business-visual-grid { display:none; }
        .business-mobile-slider { display:block; }
      }
      @media(max-width:760px){
        .public-nav { flex-wrap:wrap; }
        .public-links { order:3; width:100%; overflow-x:auto; flex-wrap:nowrap; scrollbar-width:none; }
        .public-links::-webkit-scrollbar { display:none; }
        .public-menu { position:fixed; left:14px; right:14px; width:auto; }
      }
    `}</style>

    <header style={s.header}>
      <div className="public-nav">
        <button onClick={()=>navigate('/')} style={s.brand}>
          <img src={logo192} alt="LoyaltyTree" style={s.logo}/>
          <span style={s.brandName}>LoyaltyTree</span>
        </button>

        <nav className="public-links">
          <details className="public-how">
            <summary style={s.navLink}>How It Works ▾</summary>
            <div className="public-menu">
              <button onClick={()=>navigate('/how-it-works')}>📊 Overview</button>
              <button onClick={()=>navigate('/how-it-works/businesses')}>🏪 For Businesses</button>
              <button onClick={()=>navigate('/how-it-works/customers')}>👥 For Customers</button>
            </div>
          </details>
          <button onClick={()=>navigate('/about')} style={s.navLink}>About Us</button>
          <button onClick={()=>navigate('/contact')} style={s.navLink}>Contact</button>
        </nav>

        <button onClick={()=>navigate('/login')} style={s.loginBtn}>Business Login</button>
      </div>
    </header>

    <main>
      <section style={s.hero}>
        <div style={s.heroInner}>
          <span style={s.eyebrow}>{page.eyebrow}</span>
          <h1 style={s.h1}>{page.title}</h1>
          <p style={s.intro}>{page.intro}</p>
          {type==='overview' && <div style={s.heroActions}>
            <button style={s.primary} onClick={()=>navigate('/signup')}>Get Started</button>
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

      {page.steps && type!=='customers' && type!=='businesses' && <section style={s.section}>
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
          <button style={s.primary} onClick={()=>navigate('/contact')}>Contact LoyaltyTree</button>
        </div>
      </section>}

      {page.contact && <section style={s.section}>
        <div style={s.contactGrid}>
          <div style={s.contactCard}>
            <div style={s.icon}>💬</div>
            <h2 style={s.stepTitle}>Support & inquiries</h2>
            <p style={s.body}>Message the LoyaltyTree team for account support, product questions, onboarding or general inquiries.</p>
            <button style={s.primary} onClick={openMessenger}>Open Messenger</button>
          </div>
          <div style={s.contactCard}>
            <div style={s.icon}>🤝</div>
            <h2 style={s.stepTitle}>Partnerships</h2>
            <p style={s.body}>Interested in bringing LoyaltyTree to businesses in your city or region? Contact us about partnership opportunities.</p>
            <button style={s.secondary} onClick={openMessenger}>Ask about partnerships</button>
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
  hero:{background:'linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 55%,#f8fafc 100%)',padding:'clamp(64px,9vw,110px) 22px'},
  heroInner:{maxWidth:900,margin:'0 auto',textAlign:'center'},eyebrow:{fontSize:11,fontWeight:900,letterSpacing:1.5,color:'#0f766e'},
  h1:{fontSize:'clamp(36px,6vw,66px)',lineHeight:1.04,letterSpacing:'-.035em',margin:'14px 0 20px',fontWeight:900},
  intro:{fontSize:'clamp(16px,2vw,21px)',lineHeight:1.65,color:'#475569',maxWidth:760,margin:'0 auto'},
  heroActions:{display:'flex',justifyContent:'center',gap:10,flexWrap:'wrap',marginTop:28},
  primary:{border:0,background:'#0d9488',color:'#fff',padding:'12px 17px',borderRadius:11,fontWeight:850,cursor:'pointer'},
  secondary:{border:'1px solid #0d9488',background:'#fff',color:'#0f766e',padding:'11px 16px',borderRadius:11,fontWeight:850,cursor:'pointer'},
  section:{maxWidth:1100,margin:'0 auto',padding:'58px 22px'},
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
  contactGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:16},
  contactCard:{border:'1px solid #e2e8f0',borderRadius:18,padding:26,background:'#fff'},
  footer:{borderTop:'1px solid #e2e8f0',padding:'24px clamp(18px,4vw,54px)',display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',fontSize:12,color:'#64748b'},
  footerLink:{border:0,background:'transparent',color:'#0f766e',fontWeight:800,cursor:'pointer'},
}

export default PublicInfoPage

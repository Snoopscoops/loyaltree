import React from 'react'
import { useNavigate } from 'react-router-dom'
import logo192 from './logo-192.png'
import customerStep1Scan from '../assets/customer-step-1-scan.png'
import customerStep2Form from '../assets/customer-step-2-form.png'
import customerStep2WalletButtons from '../assets/customer-step-2-wallet-buttons.png'
import customerStep3WalletCard from '../assets/customer-step-3-wallet-card.png'
import customerStep4Notification from '../assets/customer-step-4-notification.png'

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
    title: 'Set up loyalty once. Operate it from one business dashboard.',
    intro: 'LoyaltyTree gives a business the tools to design its program, enroll customers, control cashier access, track activity and keep customers coming back.',
    steps: [
      ['1', 'Choose a card type', 'Set up a Stamp, Points, Membership, Multi-Pass or VIP program based on how the business rewards customers.'],
      ['2', 'Design the card', 'Set the card name, description, branding, reward rules, milestones and Wallet appearance.'],
      ['3', 'Create branches and cashiers', 'Give authorized staff their own cashier credentials instead of sharing one business login.'],
      ['4', 'Share the join QR', 'Place the QR at checkout, on social media, menus, receipts or printed materials so customers can join quickly.'],
      ['5', 'Run and measure loyalty', 'Use cashier transactions, customer records, retention activity and analytics to understand what is working.'],
    ],
    featureTitle: 'What the business controls',
    features: [
      ['🎨', 'Card design', 'Brand colors, logo, reward structure and program configuration.'],
      ['🏪', 'Branches', 'Organize loyalty activity across multiple locations.'],
      ['🧾', 'Cashiers', 'Individual cashier access with transaction accountability.'],
      ['👥', 'Customer activity', 'See loyalty customers and their program progress.'],
      ['📣', 'Engagement', 'Announcements and automated retention features.'],
      ['📈', 'Analytics', 'Understand loyalty activity, retention and operational performance.'],
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

  const openMessenger = () => window.open('https://m.me/theloyaltytree', '_blank', 'noopener,noreferrer')

  return <div style={s.page}>
    <style>{`
      .public-nav { display:flex; align-items:center; justify-content:space-between; gap:18px; }
      .public-links { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
      .public-how { position:relative; }
      .public-how summary { list-style:none; cursor:pointer; }
      .public-how summary::-webkit-details-marker { display:none; }
      .public-menu { position:absolute; left:0; top:calc(100% + 8px); width:260px; background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:7px; box-shadow:0 16px 40px rgba(15,23,42,.14); z-index:20; }
      .public-menu button { width:100%; border:0; background:transparent; text-align:left; padding:10px; border-radius:9px; cursor:pointer; font-weight:700; color:#334155; }
      .customer-journey-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; align-items:start; }
      .customer-step-two-images { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      @media(max-width:1050px){
        .customer-journey-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
      @media(max-width:760px){
        .public-nav { flex-wrap:wrap; }
        .public-links { order:3; width:100%; overflow-x:auto; flex-wrap:nowrap; scrollbar-width:none; }
        .public-links::-webkit-scrollbar { display:none; }
        .public-menu { position:fixed; left:14px; right:14px; width:auto; }
        .customer-journey-grid { grid-template-columns:1fr; gap:20px; }
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
        <div className="customer-journey-grid" style={s.customerJourneyGrid}>
          <article style={s.customerJourneyCard}>
            <div style={s.customerJourneyHead}>
              <div style={s.number}>1</div>
              <div><h2 style={s.stepTitle}>Scan the Business QR</h2><p style={s.body}>Use your phone camera to scan the LoyaltyTree QR at the store or on the business' materials.</p></div>
            </div>
            <div style={s.customerImageFrame}>
              <img src={customerStep1Scan} alt="Customer scanning a LoyaltyTree business QR code with a phone camera" style={s.customerImage}/>
            </div>
          </article>

          <article style={s.customerJourneyCard}>
            <div style={s.customerJourneyHead}>
              <div style={s.number}>2</div>
              <div><h2 style={s.stepTitle}>Join & Add to Wallet</h2><p style={s.body}>Fill up the quick form, then add your card to Google Wallet on Android or Apple Wallet on iPhone.</p></div>
            </div>
            <div className="customer-step-two-images" style={s.customerStepTwoImages}>
              <div style={s.customerPhoneFrame}>
                <img src={customerStep2Form} alt="LoyaltyTree customer sign-up form" style={s.customerImage}/>
              </div>
              <div style={s.customerPhoneFrame}>
                <img src={customerStep2WalletButtons} alt="LoyaltyTree customer card ready with Apple Wallet and Google Wallet buttons" style={s.customerImage}/>
              </div>
            </div>
          </article>

          <article style={s.customerJourneyCard}>
            <div style={s.customerJourneyHead}>
              <div style={s.number}>3</div>
              <div><h2 style={s.stepTitle}>Your Card is Ready</h2><p style={s.body}>Your loyalty card is now available in your Wallet and ready to show whenever you visit.</p></div>
            </div>
            <div style={s.customerImageFrame}>
              <img src={customerStep3WalletCard} alt="LoyaltyTree loyalty card saved in the customer's digital wallet" style={s.customerImage}/>
            </div>
          </article>

          <article style={s.customerJourneyCard}>
            <div style={s.customerJourneyHead}>
              <div style={s.number}>4</div>
              <div><h2 style={s.stepTitle}>Get Notified & Stay Updated</h2><p style={s.body}>Receive relevant updates, offers, reminders, and reward notifications from the business.</p></div>
            </div>
            <div style={s.customerImageFrame}>
              <img src={customerStep4Notification} alt="LoyaltyTree business notification shown on a customer's phone" style={s.customerImage}/>
            </div>
          </article>
        </div>
      </section>}

      {page.steps && type!=='customers' && <section style={s.section}>
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
  customerJourneySection:{maxWidth:1280,margin:'0 auto',padding:'52px 22px 24px'},
  customerJourneyGrid:{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:16,alignItems:'start'},
  customerJourneyCard:{minWidth:0},
  customerJourneyHead:{display:'flex',gap:12,alignItems:'flex-start',minHeight:118},
  customerImageFrame:{border:'1px solid #e2e8f0',borderRadius:18,overflow:'hidden',background:'#f8fafc',boxShadow:'0 10px 30px rgba(15,23,42,.06)'},
  customerStepTwoImages:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8},
  customerPhoneFrame:{border:'1px solid #e2e8f0',borderRadius:18,overflow:'hidden',background:'#f8fafc',boxShadow:'0 10px 30px rgba(15,23,42,.06)'},
  customerImage:{width:'100%',height:'auto',display:'block'},
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

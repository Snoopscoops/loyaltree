import React from 'react'
import { useNavigate } from 'react-router-dom'

const UPDATED = 'August 18, 2026'

const DOCUMENTS = {
  privacy: {
    title: 'Privacy Policy',
    intro: 'This Privacy Policy explains how LoyaltyTree collects, uses, stores, shares, and protects personal information when businesses, staff, customers, and website visitors use our digital loyalty platform.',
    sections: [
      ['1. Scope', 'This policy applies to LoyaltyTree website visitors, businesses that apply for or use LoyaltyTree, authorized business staff, and customers or members who join a participating business loyalty program.'],
      ['2. Information we collect', 'We may process business profile and contact details; account and staff information; customer loyalty information such as card identifiers, stamps, points, visits, rewards, membership or multipass activity and redemptions; information voluntarily provided for birthday or loyalty features; technical, security and website-usage information; and payment confirmation information needed to administer subscriptions. Payment credentials may be handled directly by the applicable payment provider.'],
      ['3. Purposes and lawful processing', 'We use information to provide accounts and digital loyalty cards, operate Google Wallet and Apple Wallet functionality, record loyalty activity, provide analytics, manage branches and staff, deliver configured loyalty communications, process subscriptions, provide support, prevent abuse and fraud, secure and improve the platform, and comply with legal obligations. Processing will be based on an appropriate basis under applicable law, such as consent, contract, legal obligation, or legitimate interests where permitted.'],
      ['4. Participating businesses', 'A participating business is responsible for collecting and using its customer information lawfully, providing appropriate notices, obtaining consent where required, limiting staff access, and ensuring that rewards, promotions and communications it configures through LoyaltyTree are lawful and accurate. Businesses must not submit personal information they are not authorized to process.'],
      ['5. Service providers and disclosures', 'Information may be shared with hosting, database, cloud storage, wallet, analytics, communications, security, and payment providers when reasonably necessary to operate LoyaltyTree. Information may also be disclosed when required by law, to protect the service or its users, or in connection with a legitimate corporate transaction subject to appropriate safeguards. LoyaltyTree does not sell personal information as a standalone product.'],
      ['6. Retention and security', 'We retain information only as long as reasonably necessary for the purpose for which it was collected, contractual and security needs, dispute resolution, legitimate business purposes, or legal requirements. We use reasonable organizational and technical safeguards designed to protect information, although no online service can guarantee absolute security.'],
      ['7. Data-subject rights', 'Subject to applicable Philippine law, data subjects may have rights to be informed, access personal data, object to certain processing, correct inaccurate information, request erasure or blocking when warranted, obtain data portability where applicable, and lodge a complaint with the National Privacy Commission. Requests concerning information controlled by a participating business may need to be handled by that business, with LoyaltyTree providing reasonable assistance where appropriate.'],
      ['8. Website activity and browser storage', 'LoyaltyTree may use necessary browser storage and similar technologies for authentication, security, preferences and service operation. We may measure public website visits and interactions to understand performance and improve the platform.'],
      ['9. Children', 'LoyaltyTree is designed primarily for businesses and their customer loyalty programs. A participating business is responsible for ensuring that any program involving minors complies with applicable consent and privacy requirements.'],
      ['10. Changes and contact', 'We may update this Privacy Policy as LoyaltyTree evolves or legal requirements change. Privacy questions and requests may be sent to theloyaltytree@gmail.com.']
    ]
  },
  terms: {
    title: 'Terms of Service',
    intro: 'These Terms govern access to and use of LoyaltyTree, including its website, dashboards, digital loyalty cards, wallet integrations, customer-facing pages, and related services.',
    sections: [
      ['1. Acceptance', 'By creating an account, applying a business, accessing a dashboard, or otherwise using LoyaltyTree, you agree to these Terms and applicable policies. If you act for a business, you represent that you are authorized to do so.'],
      ['2. Service', 'LoyaltyTree provides technology for digital loyalty programs, supported loyalty cards, customer records, staff and branch tools, analytics, announcements, review prompts and integrations such as Google Wallet and Apple Wallet. Features vary by plan and may evolve. Specialized systems, NFC, booking, payment, location, website or other custom integrations may require a separate scope, price and implementation agreement.'],
      ['3. Accounts and security', 'Users must provide accurate information and protect login credentials, PINs, staff access and devices. Users are responsible for activity performed through access methods under their control, except to the extent caused by LoyaltyTree, and should promptly report suspected unauthorized access.'],
      ['4. Plans and payment', 'Paid features are provided according to the plan, branch tier, billing arrangement and inclusions shown or agreed at signup or renewal. Taxes, custom work, setup items, PR kits, hardware and third-party charges may be separate when stated. Nonpayment may result in limitation, suspension or termination of paid services after reasonable notice where practicable.'],
      ['5. Rewards and business offers', 'Rewards, discounts, points, stamps, memberships, multipasses, promotions and other customer benefits are offered and fulfilled by the participating business unless expressly stated otherwise. The business is responsible for its published program rules and disputes concerning its underlying goods, services, rewards or customer transactions.'],
      ['6. Acceptable use', 'Users may not use LoyaltyTree for unlawful, fraudulent, deceptive, abusive, infringing or unauthorized activity; dishonestly manipulate loyalty balances; access another account without permission; interfere with security; distribute malicious code; overload or improperly scrape the service; send unlawful spam; or use customer information without an appropriate basis.'],
      ['7. Third-party services', 'LoyaltyTree may interoperate with third-party wallet, hosting, storage, messaging, analytics and payment services. Those providers may have separate terms and policies, and integration availability may change because of provider rules, compatibility or technical requirements.'],
      ['8. Intellectual property', 'LoyaltyTree retains rights in its platform software, designs, branding and original materials. Businesses retain rights in their own names, logos and content and grant LoyaltyTree permission reasonably necessary to display and process those materials to provide the service.'],
      ['9. Availability and changes', 'We aim to provide a reliable service but do not guarantee uninterrupted or error-free operation. Maintenance, third-party outages, internet failures and security events may affect availability. Features may be improved, modified, replaced or discontinued when reasonably necessary.'],
      ['10. Suspension and termination', 'Access may be restricted or suspended for material breach, security risk, fraud, unlawful activity, nonpayment or abuse. A user may stop using the service subject to applicable billing and Business Agreement obligations.'],
      ['11. Results and liability', 'LoyaltyTree does not guarantee a particular level of sales, retention, revenue or growth. Nothing in these Terms excludes a right or liability that cannot lawfully be excluded, and any limitation applies only to the extent permitted by law.'],
      ['12. Governing law and contact', 'These Terms are governed by the laws of the Republic of the Philippines, without prejudice to mandatory rights that apply. The parties should first attempt in good faith to resolve disputes directly. Questions may be sent to theloyaltytree@gmail.com.']
    ]
  },
  business: {
    title: 'Business Agreement',
    intro: 'This Business Agreement applies to businesses that subscribe to or deploy LoyaltyTree. It supplements the Terms of Service and defines the operational responsibilities between LoyaltyTree and each participating business.',
    sections: [
      ['1. Enrollment and authority', 'The person enrolling a business represents that the submitted information is accurate and that they are authorized to establish and manage the LoyaltyTree account. LoyaltyTree may request reasonable information needed to verify, configure, support or secure an account.'],
      ['2. Subscription and scope', 'The business receives the features included in its selected plan, branch tier and agreed add-ons. Specialized integrations, custom development, hardware, NFC/contactless deployments, PR kits or other non-standard work may require an additional quotation, scope of work, implementation schedule or written agreement.'],
      ['3. Fees, renewal and cancellation', 'The business agrees to pay the fees presented or otherwise agreed for subscriptions and optional services. Renewal cycles, due dates, cancellation rules, refund eligibility, setup fees, hardware costs and custom-development schedules should be stated during checkout, invoice, quotation or written order. Plan changes may affect available features and limits.'],
      ['4. Business profile and branding', 'The business authorizes LoyaltyTree to use its submitted business name, logo, branch details, contact information and loyalty-program content as reasonably necessary to create and operate cards, dashboards, QR materials, wallet passes and agreed promotional or PR materials. The business represents that it has the necessary rights to those materials.'],
      ['5. Loyalty-program responsibility', 'The business determines its customer-facing loyalty offer and is responsible for the accuracy and legality of reward terms, points or stamp rules, memberships, multipasses, promotions, expiration rules, announcements and redemption decisions. LoyaltyTree provides the technology and is not responsible for fulfilling the business’s underlying goods, services or rewards unless expressly agreed.'],
      ['6. Customer data and privacy', 'The business must collect and use customer information lawfully, provide required notices, obtain consent where required, limit collection to appropriate information and avoid instructing LoyaltyTree to process information unlawfully. LoyaltyTree will process information needed to operate the platform and maintain reasonable safeguards. Each party will perform its applicable obligations under Philippine data-protection law.'],
      ['7. Staff and transaction activity', 'The business decides which owners, managers, cashiers, agents or other personnel receive access and must remove access when no longer authorized. The business is responsible for internal controls around stamps, points, redemptions, visits, memberships and other activity performed by authorized staff. LoyaltyTree may retain audit records for security, support, fraud prevention and dispute investigation.'],
      ['8. Customer communications', 'The business is responsible for the content and legal basis of announcements, promotional messages, review requests, birthday messages, win-back messages and other communications it initiates or configures. The business must respect applicable consent requirements and customer preferences.'],
      ['9. QR, Wallet, NFC and integrations', 'QR codes, Google Wallet passes, Apple Wallet passes, NFC/contactless functions, location services, payments, booking systems, websites and other integrations may depend on compatible devices, third-party services, approvals, network availability and configuration. The business must not misuse credentials, QR codes or integration mechanisms to bypass security or plan restrictions.'],
      ['10. Support and platform changes', 'LoyaltyTree may perform maintenance and release improvements, security changes and feature updates. We will use reasonable efforts to minimize material disruption and support the business according to its plan or separate service arrangement.'],
      ['11. Suspension and termination', 'LoyaltyTree may suspend or terminate a business account for material breach, nonpayment, fraud, unlawful processing, security threats, abuse or misuse. Where appropriate, notice and a reasonable opportunity to resolve the issue will be provided. Data after termination will be handled according to applicable law, legitimate business and security needs, and the Privacy Policy.'],
      ['12. Responsibility and liability', 'Each party remains responsible for its own acts, omissions, personnel and legal obligations. LoyaltyTree is not responsible for the quality, safety, legality, delivery or fulfillment of the business’s underlying products, services, promotions or rewards. Nothing limits a liability or right that cannot legally be limited.'],
      ['13. Governing documents', 'This Agreement is governed by the laws of the Republic of the Philippines. The Terms of Service, Privacy Policy, selected plan or order, and any signed quotation or specialized scope incorporated by reference form the applicable agreement. A specialized written agreement controls for its specific project to the extent it expressly conflicts with this general Agreement.'],
      ['14. Contact', 'Business agreement, billing, support and account questions may be sent to theloyaltytree@gmail.com through the official LoyaltyTree contact channels.']
    ]
  }
}

export default function LegalPage({ type='privacy' }) {
  const navigate=useNavigate()
  const doc=DOCUMENTS[type] || DOCUMENTS.privacy
  return <div style={s.page}>
    <header style={s.header}><button onClick={()=>navigate('/')} style={s.brand}>LoyaltyTree</button><button onClick={()=>navigate('/')} style={s.back}>← Back to Home</button></header>
    <main style={s.main}>
      <div style={s.eyebrow}>LEGAL</div><h1 style={s.h1}>{doc.title}</h1><div style={s.updated}>Effective / last updated: {UPDATED}</div><p style={s.intro}>{doc.intro}</p>
      <div style={s.notice}>These documents describe LoyaltyTree’s platform rules and privacy practices. They are not a substitute for legal advice regarding a business’s particular circumstances.</div>
      <article style={s.card}>{doc.sections.map(([h,p])=><section key={h} style={s.section}><h2 style={s.h2}>{h}</h2><p style={s.p}>{p}</p></section>)}</article>
      <nav style={s.nav}><button onClick={()=>navigate('/privacy')} style={s.link}>Privacy Policy</button><button onClick={()=>navigate('/terms')} style={s.link}>Terms of Service</button><button onClick={()=>navigate('/business-agreement')} style={s.link}>Business Agreement</button></nav>
    </main>
    <footer style={s.footer}>© 2026 LoyaltyTree. All rights reserved.</footer>
  </div>
}
const s={
 page:{minHeight:'100vh',background:'#f7fbf9',color:'#0f172a',fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"},
 header:{minHeight:72,padding:'0 6%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,background:'#fff',borderBottom:'1px solid #e2e8f0',position:'sticky',top:0,zIndex:20},
 brand:{border:0,background:'transparent',color:'#0f766e',fontWeight:900,fontSize:22,cursor:'pointer',padding:0},back:{border:'1px solid #dbe5e1',background:'#fff',color:'#0f766e',borderRadius:10,padding:'9px 13px',fontWeight:800,cursor:'pointer'},
 main:{width:'min(900px,88%)',margin:'0 auto',padding:'64px 0 52px'},eyebrow:{color:'#0f766e',fontWeight:900,letterSpacing:'0.18em',fontSize:12,marginBottom:12},
 h1:{margin:'0 0 8px',fontSize:'clamp(36px,6vw,60px)',lineHeight:1.05,letterSpacing:'-0.035em'},updated:{margin:'0 0 24px',color:'#64748b',fontSize:13},
 intro:{margin:'0 0 26px',color:'#475569',fontSize:18,lineHeight:1.75,maxWidth:800},notice:{background:'#ecfdf5',border:'1px solid #bbf7d0',color:'#166534',padding:'15px 17px',borderRadius:12,fontSize:13,lineHeight:1.6,marginBottom:22},
 card:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:18,padding:'clamp(22px,5vw,46px)',boxShadow:'0 14px 40px rgba(15,23,42,.05)'},section:{padding:'0 0 26px',margin:'0 0 26px',borderBottom:'1px solid #eef2f7'},
 h2:{margin:'0 0 12px',fontSize:20,lineHeight:1.3},p:{margin:0,color:'#475569',lineHeight:1.75,fontSize:15},nav:{display:'flex',flexWrap:'wrap',gap:10,marginTop:24},
 link:{border:'1px solid #cfe3dc',background:'#fff',color:'#0f766e',borderRadius:10,padding:'10px 13px',fontWeight:800,cursor:'pointer'},footer:{textAlign:'center',padding:'24px 6%',background:'#073f36',color:'#a7d8c9',fontSize:12}
}

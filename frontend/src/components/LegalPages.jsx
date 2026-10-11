import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import policy from '../legal-content.json'

const LEGAL_ENTITY = { ...policy.operator, phoneHref:'+639397992144' }

function LegalSection({ section, number, id }) {
  return <section id={id} style={s.section}>
    <h2 style={s.h2}>{number}. {section.title}</h2>
    {section.paragraphs.map((text,index)=><p key={index} style={{...s.p,marginBottom:12}}>{text}</p>)}
    {section.bullets?.length > 0 && <ul style={{...s.p,paddingLeft:22}}>{section.bullets.map(text=><li key={text} style={{marginBottom:12}}>{text}</li>)}</ul>}
  </section>
}

export default function LegalPage({ type='privacy' }) {
  const navigate=useNavigate()
  const key=type === 'business' ? 'business-agreement' : type
  const doc=policy.documents[key] || policy.documents.privacy
  useEffect(()=>{
    const oldTitle=document.title
    document.title=`${doc.title} | LoyaltyTree`
    window.scrollTo(0,0)
    return ()=>{document.title=oldTitle}
  },[doc.title])
  return <div style={s.page}>
    <header style={s.header}><button onClick={()=>navigate('/')} style={s.brand}>LoyaltyTree</button><button onClick={()=>navigate('/')} style={s.back}>← Back to Home</button></header>
    <main style={s.main}>
      <div style={s.eyebrow}>LEGAL</div><h1 style={s.h1}>{doc.title}</h1>
      <div style={s.updated}>Last updated: 11 October 2026 · Version {doc.version}</div><p style={s.intro}>{doc.intro}</p>
      <div style={s.notice}>These rules operate with the applicable accepted documents and law. A published revision does not silently replace an earlier signed agreement. Customer statutory rights are preserved.</div>
      <div style={s.identityCard}>
        <div style={s.identityLabel}>PLATFORM OPERATOR</div><div style={s.identityName}>{LEGAL_ENTITY.name}</div><div style={s.identityMeta}>{LEGAL_ENTITY.location}</div>
        <div style={s.identityContacts}><a href={`tel:${LEGAL_ENTITY.phoneHref}`} style={s.identityLink}>{LEGAL_ENTITY.phone}</a><a href={`mailto:${LEGAL_ENTITY.email}`} style={s.identityLink}>{LEGAL_ENTITY.email}</a></div>
      </div>
      <aside style={s.identityCard} aria-label="Key points"><strong>Key points</strong><ul style={s.p}>{doc.summary.map(text=><li key={text}>{text}</li>)}</ul></aside>
      <nav aria-label="Document sections" style={{...s.nav,margin:'0 0 24px'}}>{doc.sections.map((section,index)=><a key={section.title} href={`#legal-section-${index+1}`} style={s.link}>{index+1}. {section.title}</a>)}{doc.dpa&&<a href="#legal-dpa" style={s.link}>Annex A · Data Processing Addendum</a>}</nav>
      <article style={s.card}>
        {doc.sections.map((section,index)=><LegalSection key={section.title} section={section} number={index+1} id={`legal-section-${index+1}`}/>)}
        {doc.dpa && <div id="legal-dpa"><h2 style={s.h2}>Annex A — Data Processing Addendum</h2><p style={s.updated}>Version {policy.versions.dpa}</p>{doc.dpa.map((section,index)=><LegalSection key={section.title} section={section} number={`A${index+1}`} id={`legal-dpa-${index+1}`}/>)}</div>}
        {doc.plans && <section style={s.section}><h2 style={s.h2}>Annex B — Standard Plan Features</h2><p style={s.p}>Announcement limits apply per paid subscription cycle. Gift cards and physical kits are Philippines-only. POS integration requires compatible systems and an agreed scope. Custom exceptions must be recorded in the accepted order.</p><div style={{overflowX:'auto',marginTop:16}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13,textAlign:'left'}}><thead><tr>{['Plan','Features','Announcements','Members','Support'].map(label=><th key={label} style={{padding:10,borderBottom:'2px solid #b7c7bd'}}>{label}</th>)}</tr></thead><tbody>{doc.plans.map(row=><tr key={row[0]}>{row.map((cell,i)=><td key={i} style={{padding:10,borderBottom:'1px solid #dce3de',verticalAlign:'top'}}>{cell}</td>)}</tr>)}</tbody></table></div></section>}
      </article>
      <nav style={s.nav}><Link to="/privacy" style={s.link}>Privacy Policy</Link><Link to="/terms" style={s.link}>Terms of Service</Link><Link to="/business-agreement" style={s.link}>Business Agreement</Link><Link to="/contact" style={s.link}>Contact Us</Link></nav>
    </main>
    <footer style={s.footer}><strong>{LEGAL_ENTITY.name}</strong> · {LEGAL_ENTITY.location} · {LEGAL_ENTITY.phone} · {LEGAL_ENTITY.email}<br/>© 2026 LoyaltyTree. All rights reserved.</footer>
  </div>
}
const s={
 page:{minHeight:'100vh',background:'#f8f6ef',color:'#123c32',fontFamily:"'Avenir Next',Avenir,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"},
 header:{minHeight:72,padding:'0 6%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,background:'#fff',borderBottom:'1px solid #e2e8f0',position:'sticky',top:0,zIndex:20},
 brand:{border:0,background:'transparent',color:'#0f766e',fontWeight:900,fontSize:22,cursor:'pointer',padding:0},back:{border:'1px solid #dbe5e1',background:'#fff',color:'#0f766e',borderRadius:10,padding:'9px 13px',fontWeight:800,cursor:'pointer'},
 main:{width:'min(900px,88%)',margin:'0 auto',padding:'64px 0 52px'},eyebrow:{color:'#0f766e',fontWeight:900,letterSpacing:'0.18em',fontSize:12,marginBottom:12},
 h1:{margin:'0 0 8px',fontSize:'clamp(36px,6vw,60px)',lineHeight:1.05,letterSpacing:'-0.035em'},updated:{margin:'0 0 24px',color:'#64748b',fontSize:13},
 intro:{margin:'0 0 26px',color:'#475569',fontSize:18,lineHeight:1.75,maxWidth:800},notice:{background:'#ecfdf5',border:'1px solid #bbf7d0',color:'#166534',padding:'15px 17px',borderRadius:12,fontSize:13,lineHeight:1.6,marginBottom:22},identityCard:{background:'#fff',border:'1px solid #cfe3dc',borderRadius:14,padding:'16px 18px',margin:'0 0 22px',boxShadow:'0 8px 22px rgba(15,23,42,.04)'},identityLabel:{fontSize:10,fontWeight:900,letterSpacing:'.14em',color:'#0f766e',marginBottom:5},identityName:{fontSize:16,fontWeight:900,color:'#0f172a'},identityMeta:{fontSize:13,color:'#64748b',marginTop:3},identityContacts:{display:'flex',flexWrap:'wrap',gap:12,marginTop:9},identityLink:{color:'#0f766e',fontSize:13,fontWeight:800,textDecoration:'none'},
 card:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:18,padding:'clamp(22px,5vw,46px)',boxShadow:'0 14px 40px rgba(15,23,42,.05)'},section:{scrollMarginTop:95,padding:'0 0 26px',margin:'0 0 26px',borderBottom:'1px solid #eef2f7'},
 h2:{margin:'0 0 12px',fontSize:20,lineHeight:1.3},p:{margin:0,color:'#475569',lineHeight:1.75,fontSize:15},nav:{display:'flex',flexWrap:'wrap',gap:10,marginTop:24},
 link:{display:'inline-block',textDecoration:'none',fontSize:12,lineHeight:1.5,border:'1px solid #cfe3dc',background:'#fff',color:'#0f766e',borderRadius:10,padding:'10px 13px',fontWeight:800,cursor:'pointer'},footer:{textAlign:'center',padding:'24px 6%',background:'#073f36',color:'#a7d8c9',fontSize:12}
}

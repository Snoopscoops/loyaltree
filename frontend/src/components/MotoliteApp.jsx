import React, { useEffect, useState } from 'react'
import './motolite.css'
import motoliteLogo from './assets/motolite-logo.webp'

const hotline = '0917-891-6686'

function go(path){ window.history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')) }
function usePath(){ const [p,setP]=useState(window.location.pathname); useEffect(()=>{const f=()=>setP(window.location.pathname); addEventListener('popstate',f); return()=>removeEventListener('popstate',f)},[]); return p }

const sample = {
  member:'Juan Dela Cruz', memberNo:'MTL-2026-8A7D3F2B', battery:'Motolite Gold DIN66',
  serial:'MG66-829134', vehicle:'Mitsubishi Montero Sport', plate:'ABC 1234',
  installed:'Aug 8, 2026', expires:'Aug 8, 2028', branch:'Cauayan City Branch'
}

function Header(){return <>
  <div className="hotline">Official Hotlines · Globe {hotline} · Smart 0918-843-6686 · NCR (02) 8370-6686</div>
  <header><button className="brand" onClick={()=>go('/motolite')}><img src={motoliteLogo}/></button>
    <nav><a href="#batteries">Batteries</a><a href="#services">Service</a><a href="#advantage">Warranty</a><button onClick={()=>go('/motolite/warranty')}>My Warranty</button></nav>
    <button className="staff" onClick={()=>go('/motolite/login')}>Staff Login</button>
  </header>
</>}

function Home(){return <div><Header/>
  <section className="hero"><div className="heroInner"><div>
    <span className="kicker yellow">THE BATTERY YOU CAN RELY ON</span>
    <h1>Pangmatagalan.<br/>Now digitally protected.</h1>
    <p>A sample Motolite digital experience combining nationwide warranty records, QR verification, Apple Wallet, Google Wallet, emergency assistance and branch-level service access.</p>
    <div className="heroBtns"><button className="redBtn" onClick={()=>go('/motolite/warranty')}>View My Warranty</button><a href="#batteries" className="whiteBtn">Find a Battery</a></div>
  </div><div className="preview"><img src={motoliteLogo}/><span className="active">ACTIVE</span><h3>{sample.battery}</h3><p>{sample.vehicle}</p><div className="mini"><span>Member</span><b>{sample.member}</b><span>Valid until</span><b>{sample.expires}</b></div><button onClick={()=>go('/motolite/warranty')}>Open Warranty Card</button></div></div></section>

  <section className="quick"><Action icon="⚡" title="Find the Right Battery" text="Match your vehicle with the proper Motolite battery."/><Action icon="✓" title="Register Warranty" text="Activate your battery warranty and digital member record." click={()=>go('/motolite/warranty')}/><Action icon="▣" title="Check Warranty" text="See status, battery details and service history." click={()=>go('/motolite/warranty')}/><Action icon="☎" title="Emergency Assistance" text="Fast access to Motolite support." href={`tel:${hotline}`}/></section>

  <section id="batteries" className="section"><span className="kicker">MOTOLITE BATTERIES</span><h2>Built for every kind of drive.</h2><div className="cats">{['Automotive','Motorcycle','Heavy Commercial','Marine & Leisure','Industrial'].map(x=><div className="cat" key={x}><div className="battery"><i/></div><h3>{x}</h3><p>Reliable Motolite power for your application.</p><b>View more →</b></div>)}</div></section>

  <section id="services" className="section dark"><span className="kicker yellow">MOTOLITE SERVICES</span><h2>More than a battery.</h2><div className="services"><Service title="RES-Q" text="On-demand roadside assistance for motorists."/><Service title="Express Hatid" text="Battery delivery and installation support."/><Service title="Digital Warranty" text="Your warranty, battery details and service record in one place."/></div></section>

  <section id="advantage" className="section"><div className="center"><span className="kicker">THE DIGITAL MOTOLITE ADVANTAGE</span><h2>Your warranty follows you wherever you go.</h2><p>One national warranty record with localized branch access and a permanent digital member card.</p></div><div className="benefits"><Benefit icon="QR" title="Secure QR Warranty"/><Benefit icon="" title="Apple Wallet"/><Benefit icon="G" title="Google Wallet"/><Benefit icon="24/7" title="Emergency Call"/><Benefit icon="◎" title="Nearest Branch"/><Benefit icon="↻" title="Replacement Reminders"/></div></section>

  <section className="cta"><div><span className="kicker yellow">ONE NATIONAL WARRANTY NETWORK</span><h2>Purchased in one city. Serviced in another.</h2><p>National, regional and local dashboards share one warranty source of truth while access remains permission-based.</p></div><button onClick={()=>go('/motolite/login')}>Open Staff Portal</button></section>
  <footer><img src={motoliteLogo}/><p>Sample digital warranty concept for demonstration purposes.</p></footer>
</div>}

function Action({icon,title,text,click,href}){const c=<><span className="round">{icon}</span><div><h3>{title}</h3><p>{text}</p></div><b>→</b></>; return href?<a className="action" href={href}>{c}</a>:<button className="action" onClick={click}>{c}</button>}
function Service({title,text}){return <div className="service"><span>M</span><h3>{title}</h3><p>{text}</p><b>Learn more →</b></div>}
function Benefit({icon,title}){return <div className="benefit"><span>{icon}</span><h3>{title}</h3><p>Part of the all-in-one Motolite warranty and membership experience.</p></div>}

function Warranty(){return <div className="portal"><Header/><main className="section"><span className="kicker">MY MOTOLITE</span><h1 className="pageTitle">Digital Warranty</h1><div className="warrantyGrid"><div className="walletCard"><img src={motoliteLogo}/><small>DIGITAL WARRANTY MEMBER</small><h2>{sample.member}</h2><p>{sample.memberNo}</p><h3>{sample.battery}</h3><strong>● WARRANTY ACTIVE</strong><div className="qr">{Array.from({length:64}).map((_,i)=><i key={i} className={(i*7+i%5)%3?'on':''}/>)}</div><em>Scan at an authorized Motolite branch</em></div><div><div className="info"><div className="infoHead"><h3>Battery Details</h3><span>ACTIVE</span></div>{[['Battery',sample.battery],['Serial Number',sample.serial],['Vehicle',sample.vehicle],['Plate Number',sample.plate],['Installed',sample.installed],['Warranty Until',sample.expires],['Original Branch',sample.branch]].map(([a,b])=><div className="row" key={a}><span>{a}</span><b>{b}</b></div>)}</div><div className="walletBtns"><button> Add to Apple Wallet</button><button>G Add to Google Wallet</button></div><div className="tiles"><a href={`tel:${hotline}`}>☎<b>Emergency Assistance</b><span>{hotline}</span></a><button>◎<b>Find Nearest Branch</b><span>Use current location</span></button><button>▣<b>Service History</b><span>View warranty activity</span></button></div></div></div></main></div>}

function Login(){const [role,setRole]=useState('local'); const login=()=>go('/motolite/'+role); return <div className="login"><div className="loginBrand"><img src={motoliteLogo}/><h1>Warranty Operations</h1><p>National · Regional · Local</p></div><div className="loginBox"><h2>Staff Login</h2><p>Sample role routing for the warranty platform.</p><label>Access Level</label><div className="roles">{['national','regional','local'].map(r=><button key={r} onClick={()=>setRole(r)} className={role===r?'sel':''}>{r}</button>)}</div><label>Email</label><input placeholder="staff@motolite.com"/><label>Password</label><input type="password" placeholder="••••••••"/><button className="redBtn full" onClick={login}>Login</button><button className="back" onClick={()=>go('/motolite')}>← Back to website</button></div></div>}

const dash={national:['National Dashboard','Philippines',['1,284,493','982,403','8,241','4,382']],regional:['Regional Dashboard','Region II',['82,103','64,280','42','531']],local:['Local Dashboard','Cauayan City Branch',['2,842','2,191','184','12']]}
function Dashboard({level}){const [title,sub,s]=dash[level]; return <div className="dash"><aside><img src={motoliteLogo}/><small>{level.toUpperCase()} ACCESS</small>{['Overview','Members','Warranties','Batteries','Claims & Replacements','Notifications','Reports'].map((x,i)=><button className={i===0?'current':''} key={x}>{x}</button>)}<button className="bottom" onClick={()=>go('/motolite')}>Public Website</button></aside><main><span className="kicker">{sub}</span><h1>{title}</h1><div className="stats">{[['Members',s[0]],['Active Warranties',s[1]],[level==='local'?'Expiring in 30 Days':level==='regional'?'Branches':'Claims This Month',s[2]],[level==='local'?'Claims':'Replacements',s[3]]].map(([a,b])=><div><span>{a}</span><b>{b}</b><small>Live sample data</small></div>)}</div><div className="dashPanels"><section><h3>Recent Warranty Activity</h3>{[['MTL-2026-184201','Gold DIN66','Warranty activated'],['MTL-2026-184199','Excel N70','Battery inspection'],['MTL-2026-184188','Enduro NS40','Replacement approved'],['MTL-2026-184173','Gold DIN55','Warranty verified']].map(x=><div className="activity"><b>{x[0]}</b><span>{x[1]}</span><em>{x[2]}</em></div>)}</section><section><h3>Warranty Health</h3><strong className="health">92.4%</strong><p>of registered warranties in this scope are currently active.</p><div className="bar"><i/></div></section></div></main></div>}

export default function MotoliteApp(){const p=usePath(); if(p==='/motolite/login')return <Login/>; if(p==='/motolite/warranty')return <Warranty/>; if(p.startsWith('/motolite/national'))return <Dashboard level="national"/>; if(p.startsWith('/motolite/regional'))return <Dashboard level="regional"/>; if(p.startsWith('/motolite/local'))return <Dashboard level="local"/>; return <Home/>}

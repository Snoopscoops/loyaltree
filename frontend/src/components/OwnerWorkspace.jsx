import React, {useEffect,useRef,useState} from 'react'
import {asArray, PERIODS, manilaDay, dateRange, validRange, paymentClass, filterOrders, nextStatus, money, validMerchantStatus} from './ownerWorkspaceModel.js'
import './owner-workspace.css'

const paymentLabels={cash_confirmed:'Confirmed cash',outstanding:'Outstanding',test:'Test payment',unverified:'Unverified paid record',cancelled:'Cancelled',unknown:'Unknown'}
const statusLabels={new:'New',preparing:'Preparing',ready:'Ready',completed:'Completed',cancelled:'Cancelled'}
const nextLabels={preparing:'Start preparing',ready:'Mark ready',completed:'Complete order'}
const dateText=value=>{const d=new Date(value||'');return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(d):'—'}
const count=value=>Number.isInteger(value)&&value>=0?value.toLocaleString('en-PH'):'—'
const percent=value=>typeof value==='number'&&Number.isFinite(value)?value+'%':'—'
const params=values=>new URLSearchParams(Object.entries(values).filter(([,v])=>v!==''&&v!=null)).toString()

async function request(API_BASE,user,path,{signal,method='GET',body,raw=false,merchant=false}={}){
  if(user?.role!=='owner'||!user?.token||!user?.business_slug)throw new Error('Owner sign-in required.')
  const identifier=merchant?(user.business_public_id||user.business_slug):user.business_slug
  const base=API_BASE.replace(/\/$/,'')+'/api/v1/business/'+encodeURIComponent(identifier)
  const res=await fetch(base+path,{method,signal,cache:'no-store',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+user.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
  if(!res.ok){
    const error=await res.json().catch(()=>null)
    throw new Error(res.status===401?'Session expired. Sign in again.':res.status===403?'This feature is not available to this account.':typeof error?.detail==='string'?error.detail:'Could not load this feature. Try again.')
  }
  return raw?res:res.json()
}
function useReport(API_BASE,user,path,refresh=0,merchant=false){
  const scope=JSON.stringify([API_BASE,user?.business_slug,user?.business_public_id,path,refresh,merchant])
  const [state,setState]=useState({scope:'',session:null,data:null,error:'',loading:true})
  useEffect(()=>{
    const controller=new AbortController()
    setState({scope,session:user?.token,data:null,error:'',loading:true})
    if(path)request(API_BASE,user,path,{signal:controller.signal,merchant}).then(data=>{
      if(!controller.signal.aborted)setState({scope,session:user.token,data,error:'',loading:false})
    }).catch(e=>{if(!controller.signal.aborted)setState({scope,session:user?.token,data:null,error:e.message,loading:false})})
    else setState({scope,session:user?.token,data:null,error:'',loading:false})
    return()=>controller.abort()
  },[scope,user?.token,user?.role])
  return state.scope===scope&&state.session===user?.token?state:{data:null,error:'',loading:true}
}
function Notice({state}){
  return state.loading?<p role="status" className="lt-ws-note">Loading verified records…</p>:state.error?<p role="alert" className="lt-ws-error">{state.error}</p>:null
}
function Stat({label,value,detail}){
  return <div className="lt-ws-stat"><small>{label}</small><strong>{value}</strong>{detail&&<span>{detail}</span>}</div>
}
function Period({period,onChange,custom=false}){
  return <div className="lt-ws-pills" role="group" aria-label="Reporting period">{[...PERIODS,...(custom?[['custom','Custom']]:[])].map(([value,label])=><button key={value} type="button" aria-pressed={period===value} onClick={()=>onChange(value)}>{label}</button>)}</div>
}
function Branch({branches,branch,onChange}){
  return <label>Branch<select value={branch} onChange={e=>onChange(e.target.value)}><option value="">All branches</option>{asArray(branches).filter(b=>b.public_id).map(b=><option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>
}
function Settlement({data}){
  const settlement=data?.payments?.settlement
  return <div className="lt-ws-grid"><Stat label="Confirmed cash" value={money(settlement?.cash_confirmed?.sales)} detail="Cash-paid orders"/><Stat label="Order value" value={money(data?.sales)} detail="Includes unpaid orders"/><Stat label="Outstanding" value={money(settlement?.outstanding?.sales)}/><Stat label="Orders" value={count(data?.orders)}/><Stat label="Test payments" value={money(settlement?.test?.sales)}/><Stat label="Other paid records" value={money(settlement?.unverified?.sales)} detail="Collection not verified"/></div>
}
export function OwnerDailyOverview({API_BASE,user,onOpen}){
  const [refresh,setRefresh]=useState(0)
  const state=useReport(API_BASE,user,'/menu-orders/summary?period=today',refresh)
  return <section className="lt-ws" aria-label="Today's menu operations"><div className="lt-ws-heading"><div><h2>Today's operations</h2><p>Digital menu · All branches · Manila time</p></div><button type="button" onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div><Notice state={state}/><Settlement data={state.data}/><p className="lt-ws-note">Orders created today, classified by their current payment status. Not a payment-date cash ledger.</p><div className="lt-ws-actions"><button type="button" onClick={()=>onOpen('orders')}>View orders</button><button type="button" onClick={()=>onOpen('transactions')}>Transactions</button><button type="button" onClick={()=>onOpen('reservations')}>Reservations</button></div></section>
}
function OrderDetails({row}){
  return <div className="lt-ws-detail"><dl><dt>Order</dt><dd>{row.order_number||'—'}</dd><dt>Branch</dt><dd>{row.branch?.name||row.branch_name||'—'}</dd><dt>Created</dt><dd>{dateText(row.created_at)}</dd><dt>Order status</dt><dd>{statusLabels[row.status]||row.status||'Unknown'}</dd><dt>Payment</dt><dd>{paymentLabels[paymentClass(row)]} · {row.payment_method||'Not recorded'}</dd><dt>Order value</dt><dd>{money(row.total)}</dd><dt>Customer</dt><dd>{row.customer?.name||'Not recorded'}</dd><dt>Table / service</dt><dd>{[row.table_no,row.service].filter(Boolean).join(' · ')||'—'}</dd><dt>Parent order</dt><dd>{row.parent_order_public_id||'—'}</dd></dl><h4>Items</h4>{asArray(row.items).map((item,i)=><div className="lt-ws-line" key={item.line_id||i}><span>{item.quantity??'—'} × {item.item_name||item.name||'Item'}<small>{asArray(item.modifiers).map(m=>m.option_name).filter(Boolean).join(', ')||asArray(item.options).map(m=>m.name).filter(Boolean).join(', ')}</small></span></div>)}{row.customer_note&&<p className="lt-ws-note">Note: {row.customer_note}</p>}</div>
}
export function OwnerOrders({API_BASE,user,branches,transactions=false,onOpen}){
  const [period,setPeriod]=useState('today'),[branch,setBranch]=useState(''),[custom,setCustom]=useState(()=>dateRange('today'))
  const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[payment,setPayment]=useState(''),[refresh,setRefresh]=useState(0)
  const [expanded,setExpanded]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState('')
  const lock=useRef(false),active=useRef(null)
  useEffect(()=>{const current={};active.current=current;return()=>{active.current=null}},[user.token,user.business_slug])
  const range=period==='custom'?custom:dateRange(period)
  const valid=validRange(range.start,range.end)
  const reportQuery=params({branch,...(period==='custom'?range:{period})})
  const reportPath=period==='custom'?'/menu-orders/report?'+reportQuery+'&format=json':'/menu-orders/summary?'+reportQuery
  const summary=useReport(API_BASE,user,transactions&&valid?reportPath:null,refresh)
  const list=useReport(API_BASE,user,'/menu-orders',refresh)
  const rows=filterOrders(list.data?.orders,{branch,...(transactions&&valid?range:{}),search:query,status,payment})
  async function advance(row){
    const next=nextStatus(row)
    if(!next||lock.current||!row.public_id)return
    const scope=active.current
    lock.current=true;setBusy(true);setActionError('')
    try{await request(API_BASE,user,'/menu-orders/'+encodeURIComponent(row.public_id)+'/status',{method:'PATCH',body:{status:next}})}
    catch(e){if(active.current===scope)setActionError(e.message)}
    finally{lock.current=false;if(active.current===scope){setBusy(false);setRefresh(v=>v+1)}}
  }
  async function download(){
    if(!valid||lock.current)return
    const scope=active.current
    lock.current=true;setBusy(true);setActionError('')
    try{
      const response=await request(API_BASE,user,'/menu-orders/report?'+reportQuery+'&format=csv',{raw:true})
      const blob=await response.blob()
      if(active.current!==scope)return
      const url=URL.createObjectURL(blob),a=document.createElement('a')
      a.href=url;a.download='LoyaltyTree-menu-report-'+range.start+'-'+range.end+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){if(active.current===scope)setActionError(e.message)}
    finally{lock.current=false;if(active.current===scope)setBusy(false)}
  }
  return <section className="lt-ws"><div className="lt-ws-heading"><div><small>BUSINESS OPERATIONS</small><h2>{transactions?'Transactions':'Menu orders'}</h2><p>{transactions?'Review order records and payment classifications.':'Manage recent digital-menu orders. Order Ahead remains a separate workspace.'}</p></div><button type="button" disabled={busy} onClick={()=>{setRefresh(v=>v+1);setActionError('')}}>Refresh</button></div>
    {transactions&&<><Period period={period} onChange={setPeriod} custom/><div className="lt-ws-filters">{period==='custom'&&<><label>From<input type="date" value={custom.start} max={manilaDay()} onChange={e=>setCustom(v=>({...v,start:e.target.value}))}/></label><label>To<input type="date" value={custom.end} max={manilaDay()} onChange={e=>setCustom(v=>({...v,end:e.target.value}))}/></label></>}<Branch branches={branches} branch={branch} onChange={setBranch}/></div>{!valid?<p role="alert" className="lt-ws-error">Choose a valid range of up to 92 days ending no later than today.</p>:<><Notice state={summary}/><Settlement data={summary.data}/><p className="lt-ws-note">Current payment status of non-cancelled orders created in the selected dates, not a bank statement or payment-date ledger. CSV includes order detail for the selected period.</p><div className="lt-ws-actions"><button type="button" disabled={busy} onClick={download}>Download CSV report</button><button type="button" onClick={()=>onOpen('security')}>Loyalty audit & security</button></div></>}</>}
    <h3>{transactions?'Recent order records':'Order queue & history'}</h3><p className="lt-ws-note">The list is limited to recent records returned by the order service. Use the dated CSV for the full report supported by the server.</p>
    <div className="lt-ws-filters">{!transactions&&<Branch branches={branches} branch={branch} onChange={setBranch}/>}<label>Search<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Order, customer or item"/></label><label>Order status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Payment<select value={payment} onChange={e=>setPayment(e.target.value)}><option value="">All payments</option>{Object.entries(paymentLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    <Notice state={list}/>{actionError&&<p role="alert" className="lt-ws-error">{actionError}</p>}
    {(!transactions||valid)&&list.data&&(!Array.isArray(list.data.orders)?<p role="alert">Unexpected order response. Refresh to try again.</p>:rows.length===0?<p>No matching recent orders.</p>:<div className="lt-ws-list">{rows.map((row,i)=>{const id=row.public_id||row.order_number||String(i);return <article key={id} className="lt-ws-record"><button className="lt-ws-record-toggle" type="button" aria-expanded={expanded===id} onClick={()=>setExpanded(expanded===id?'':id)}><span><strong>{row.order_number||'Order'}</strong><small>{dateText(row.created_at)} · {row.branch?.name||'Branch not recorded'}</small></span><span><strong>{money(row.total)}</strong><small>{statusLabels[row.status]||row.status||'Unknown'} · {paymentLabels[paymentClass(row)]}</small></span></button>{expanded===id&&<><OrderDetails row={row}/>{!transactions&&nextStatus(row)&&<button type="button" disabled={busy} onClick={()=>advance(row)}>{nextLabels[nextStatus(row)]}</button>}</>}</article>})}</div>)}
    {!transactions&&<p className="lt-ws-note">Only confirmed cash orders can advance here. Cash confirmation, add-ons, voids and refunds remain in the authorized cashier workflow; no digital payment is activated.</p>}
  </section>
}
export function OwnerIntelligence({API_BASE,user,branches,kind,onOpen}){
  const [period,setPeriod]=useState('today'),[branch,setBranch]=useState(''),[refresh,setRefresh]=useState(0)
  const state=useReport(API_BASE,user,'/menu-orders/insights?'+params({period,branch}),refresh)
  const data=state.data,customer=kind==='customer',f=data?.purchase_frequency
  const items=asArray(data?.top_items),top=items[0]
  const groups=asArray(data?.sections).filter(s=>(customer?['age','gender','occupation','membership','tenure']:['time','weekday','branch']).includes(s.key))
  return <section className="lt-ws"><div className="lt-ws-heading"><div><h2>{customer?'Customer Intelligence':'Product Intelligence'}</h2><p>{customer?'Understand repeat purchasing and linked customer groups.':'Understand ordered items and demand patterns.'}</p></div><button type="button" onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div><Period period={period} onChange={setPeriod}/><Branch branches={branches} branch={branch} onChange={setBranch}/><Notice state={state}/><h3>{PERIODS.find(p=>p[0]===period)?.[1]} summary</h3><p className="lt-ws-note">{data?.start&&data?.end?data.start+' — '+data.end+' · ':''}Manila time · Calendar period to date</p>
    {customer?<><div className="lt-ws-grid"><Stat label="Linked buyers" value={count(f?.linked_buyers)}/><Stat label="Repeat buyers" value={count(f?.repeat_buyers)}/><Stat label="Repeat buyer rate" value={percent(f?.repeat_buyer_percent)}/><Stat label="Average cash spend" value={money(f?.average_cash_spend_per_buyer)}/></div><p className="lt-ws-note">Distinct linked cash-paid bills only; not all visitors or lifetime spending.</p></>:<><div className="lt-ws-grid"><Stat label="Top ordered item" value={top?.name||'—'}/><Stat label="Quantity ordered (top item)" value={count(top?.quantity)}/><Stat label="Menu orders" value={count(data?.kpis?.orders)}/><Stat label="Order value" value={money(data?.kpis?.sales)}/></div><p className="lt-ws-note">Non-cancelled menu orders, including unpaid orders. Not confirmed revenue.</p></>}
    <h3>Detailed breakdown</h3>{customer?<><div className="lt-ws-grid"><Stat label="Single-bill buyers" value={count(f?.single_bill_buyers)}/><Stat label="Average bills per buyer" value={typeof f?.average_bills_per_buyer==='number'?f.average_bills_per_buyer.toFixed(2):'—'}/></div><div className="lt-ws-actions"><button onClick={()=>onOpen('customers')}>Customer directory & history</button><button onClick={()=>onOpen('retention')}>Retention</button><button onClick={()=>onOpen('campaigns')}>Win-back settings</button></div></>:<div className="lt-ws-panel"><h4>Top ordered products</h4><p className="lt-ws-note">Returned top-item list only, not the entire inventory.</p>{items.length?items.map((item,i)=><div key={i} className="lt-ws-line"><span>{i+1}. {item.name}</span><strong>{count(item.quantity)} ordered · {money(item.sales)}</strong></div>):<p>No ranked items available.</p>}<h4>Order value trend</h4>{asArray(data?.trend).map((entry,i)=><div className="lt-ws-line" key={i}><span>{entry.label}</span><strong>{count(entry.orders)} orders · {money(entry.sales)}</strong></div>)}</div>}
    {groups.map(section=><div className="lt-ws-panel" key={section.key}><h4>{section.title}</h4>{asArray(section.groups).filter(g=>g.hidden===false&&Number(g.orders)>0).map(g=><div className="lt-ws-line" key={g.key}><span>{g.label}<small>{g.top_item?'Most ordered: '+g.top_item:''}</small></span><strong>{count(g.orders)} orders</strong></div>)}{asArray(section.groups).some(g=>g.hidden===true)&&<p className="lt-ws-note">Small cohorts are suppressed.</p>}{!asArray(section.groups).some(g=>g.hidden===false&&Number(g.orders)>0)&&<p className="lt-ws-note">No eligible groups to display.</p>}{section.note&&<p className="lt-ws-note">{section.note}</p>}</div>)}
    <p className="lt-ws-note">{customer?'Demographics are linked-card cohorts; hidden groups are not displayed.':'Demand groups are for all selected menu orders, not per-product hourly breakdowns.'}</p>
  </section>
}
export function OwnerCustomerOrderHistory({API_BASE,user,customerId}){
  const [opened,setOpened]=useState(false)
  const state=useReport(API_BASE,user,opened&&customerId?'/customers/'+encodeURIComponent(customerId)+'/menu-order-history':null)
  return <section className="lt-ws lt-ws-history"><button type="button" aria-expanded={opened} onClick={()=>setOpened(v=>!v)}>{opened?'Hide':'View'} linked order history</button>{opened&&<><Notice state={state}/>{state.data&&<><div className="lt-ws-grid"><Stat label="Linked orders" value={count(state.data.summary?.total_orders)}/><Stat label="Completed paid orders" value={count(state.data.summary?.completed_paid_orders)}/><Stat label="Verified spend" value={money(state.data.summary?.total_spent)}/></div><p className="lt-ws-note">Completed cash-paid linked digital-menu orders only. {state.data.summary?.complete===true?'Other channels excluded.':'History is limited; totals are not lifetime totals.'}</p><div className="lt-ws-list">{asArray(state.data.orders).map((o,i)=><details key={i} className="lt-ws-panel"><summary>{o.order_number||'Order'} · {money(o.total)} · {statusLabels[o.status]||o.status}</summary><OrderDetails row={o}/><p>Verified spend: {money(o.verified_spent)}</p></details>)}</div></>}</>}</section>
}
export function OwnerMerchantPayments({API_BASE,user,onOpen}){
  const [refresh,setRefresh]=useState(0)
  const state=useReport(API_BASE,user,'/merchant-payments/status',refresh,true)
  const data=validMerchantStatus(state.data)?state.data:null
  const active=data?.state==='active'&&data.portal_available===true
  const labels={disabled:'Not enabled',registration_required:'Registration required',verification_pending:'Verification pending',active:'Active',restricted:'Restricted'}
  return <section className="lt-ws"><div className="lt-ws-heading"><div><h2>Merchant payments</h2><p>Business collections and settlement readiness. Separate from LoyaltyTree subscription billing.</p></div><button onClick={()=>setRefresh(v=>v+1)}>Refresh status</button></div><Notice state={state}/><div className="lt-ws-grid"><Stat label="Merchant status" value={data?labels[data.state]:'Unavailable'}/><Stat label="Available balance" value={active&&Number.isSafeInteger(data.available_centavos)&&data.available_centavos>=0?money(data.available_centavos/100):'—'}/><Stat label="Pending balance" value={active&&Number.isSafeInteger(data.pending_centavos)&&data.pending_centavos>=0?money(data.pending_centavos/100):'—'}/></div><p className="lt-ws-note">Registration, live QRPH/card collection, payout destination and withdrawals are not enabled in this workspace. No funds can be moved here.</p><div className="lt-ws-actions"><button onClick={()=>onOpen('transactions')}>View recorded transactions</button><button onClick={()=>onOpen('billing')}>Subscription billing</button></div></section>
}

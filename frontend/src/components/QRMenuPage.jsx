import React, { useEffect, useId, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { filterMenuItems, groupMenuCategories, menuItemAvailable, menuSelectionAvailable, menuOptionAvailable, menuItemPrice, toggleMenuOption, validMenuPayload, addCartItem, changeCartQuantity, cartSubtotal, buildMenuOrder, sendMenuOrder, pickupTimeLabel, resolveMenuBranch, PAYMENT_METHODS, paymentReceiptLabel, CASH_NOTICE, payButtonLabel, receiptCopy } from './qrMenuModel'
import loyaltyTreeLogo from './logo-192.png'
import { requestJsonResponse } from './requestTimeout'
import { ORDER_TRACKING_STEPS, menuOrderPhase, fetchMenuOrderPhase } from './qrMenuOrderTracking'
import { saveRecentOrder, readRecentOrder, forgetRecentOrder, buildReorderDraft } from './qrMenuRecentOrder'
import './qr-menu.css'
import { checkoutRewardIsEligible, checkoutRewardSelectionPayload } from './qrMenuRedemption'
import './qr-menu-rewards.css' // owner-v11
import { loyaltyProgress, historyEvents, quickReorderItems, canQuickAdd } from './qrMenuV15'
import './qr-menu-v15.css'
import MenuCheckoutContact, { validContactPhone } from './MenuCheckoutContact'

function MenuItemPhoto({ item, available }) {
  const [failedSource, setFailedSource] = useState(null)
  return <div className="lt-qr-item-visual">
    {item.image_url && failedSource !== item.image_url ? <img className="lt-qr-item-photo" src={item.image_url} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(item.image_url)} /> : <div className="lt-qr-item-placeholder" aria-hidden="true"><span>{item.name.slice(0, 1)}</span></div>}
    {!available && <span className="lt-qr-item-badge">Sold out</span>}
  </div>
}

function ItemDetails({ item, available, branchId, money, onClose, onAdd }) {
  const dialog = useRef(null)
  const titleId = useId()
  const [selected, setSelected] = useState({})
  const [quantity, setQuantity] = useState(1)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="lt-qr-sheet" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="lt-qr-sheet-content">
      <button type="button" className="lt-qr-close" onClick={onClose} aria-label="Close item details">×</button>
      {item.image_url && <img className="lt-qr-detail-photo" src={item.image_url} alt="" />}
      <p className="lt-qr-eyebrow">ON THE MENU</p><h2 id={titleId}>{item.name}</h2>
      {item.description && <p className="lt-qr-description">{item.description}</p>}
      {!available && <p className="lt-qr-sold-note">Currently sold out at this location.</p>}
      {(item.modifier_groups || []).map(group => <fieldset key={group.public_id} className="lt-qr-option-group">
        <legend>{group.name}</legend><p>{group.selection_type === 'single' ? 'Choose one' : `Choose your options${group.max_selections > 0 ? ` · up to ${group.max_selections}` : ''}`}</p>
        {group.options.map(option => <label key={option.public_id} className={!menuOptionAvailable(item,branchId,option.public_id)?'is-unavailable':''}><span><input disabled={!menuOptionAvailable(item,branchId,option.public_id)} type={group.selection_type === 'single' ? 'radio' : 'checkbox'} name={group.public_id} checked={(selected[group.public_id] || []).includes(option.public_id)} onChange={() => setSelected(current => toggleMenuOption(current, group, option.public_id))} />{option.name}</span><span>{option.price_delta ? `${option.price_delta > 0 ? '+' : '−'} ${money(Math.abs(option.price_delta))}` : 'Included'}</span></label>)}
        {selected[group.public_id]?.length > 0 && <button type="button" className="lt-qr-text-button" onClick={() => setSelected(current => ({ ...current, [group.public_id]: [] }))}>Clear selection</button>}
      </fieldset>)}
      <div className="lt-qr-detail-price"><span>Price with selected options</span><strong>{money(menuItemPrice(item, selected))}</strong></div>
      {available && menuSelectionAvailable(item,branchId,selected) && <div className="lt-qr-qty"><button type="button" onClick={() => setQuantity(value => Math.max(1, value - 1))} aria-label="Decrease quantity">−</button><span>{quantity}</span><button type="button" onClick={() => setQuantity(value => Math.min(20, value + 1))} aria-label="Increase quantity">+</button></div>}
      <button type="button" className="lt-qr-primary" disabled={!menuSelectionAvailable(item,branchId,selected)} onClick={() => { onAdd(item, selected, quantity); onClose() }}>{menuSelectionAvailable(item,branchId,selected) ? 'Add to cart' : 'Sold out'}</button>
    </div>
  </dialog>
}


// Browser privacy modes can throw even while reading window.localStorage.
function recentReceiptStorage() { try { return window.localStorage } catch { return null } }

const CARD_EVENT = 'lt-menu-card-change'

function MenuCardLink({ apiBase, business, label, className = 'lt-qr-card-link', onConnected }) {
  const storageKey = `lt-menu-card:${business.public_id}`
  const [open, setOpen] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [code, setCode] = React.useState('')
  const [challenge, setChallenge] = React.useState('')
  const [card, setCard] = React.useState(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let saved = ''
    try { saved = localStorage.getItem(storageKey) || '' } catch { saved = '' }
    if (!saved) return undefined
    let active = true
    fetch(`${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/card`, { headers: { Authorization: `Bearer ${saved}` }, cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(body => { if (active) setCard(body) })
      .catch(() => { try { localStorage.removeItem(storageKey); localStorage.removeItem(`lt-menu-card-name:${business.public_id}`) } catch { /* ignore */ } })
    return () => { active = false }
  }, [apiBase, business.public_id, storageKey])
  // Keep every Connect card button on the page (header + checkout) in sync.
  React.useEffect(() => {
    const sync = event => { if (event.detail?.business === business.public_id) setCard(event.detail.card) }
    window.addEventListener(CARD_EVENT, sync)
    return () => window.removeEventListener(CARD_EVENT, sync)
  }, [business.public_id])
  const announce = value => { try { window.dispatchEvent(new CustomEvent(CARD_EVENT, { detail: { business: business.public_id, card: value } })) } catch { /* old browsers */ } }
  const post = async (path, body) => {
    const response = await fetch(`${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/card/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Try again.')
    return payload
  }
  const submit = async event => {
    event.preventDefault()
    setBusy(true); setNote('')
    try {
      if (!challenge) {
        const result = await post('request', { email })
        setChallenge(result.challenge)
        setNote(`Code sent to ${result.email_masked}.`)
      } else {
        const result = await post('verify', { challenge, code })
        try { localStorage.setItem(storageKey, result.token); localStorage.setItem(`lt-menu-card-name:${business.public_id}`, result.name || '') } catch { /* ignore */ }
        const connected = { name: result.name, email_masked: result.email_masked }
        setCard(connected)
        announce(connected)
        onConnected?.(connected)
        setOpen(false)
      }
    } catch (error) { setNote(error.message) }
    finally { setBusy(false) }
  }
  const forget = () => {
    try { localStorage.removeItem(storageKey); localStorage.removeItem(`lt-menu-card-name:${business.public_id}`) } catch { /* ignore */ }
    setCard(null); setChallenge(''); setCode(''); setNote('')
    announce(null)
  }
  return <>
    <button type="button" className={className} onClick={() => setOpen(true)}>{label || (card ? `Connected · ${String(card.name || '').split(' ')[0]}` : 'Connect card')}</button>
    {open && <div className="lt-qr-card-banner" role="dialog" aria-label="Connect loyalty card">
      <form onSubmit={submit}>
        <button type="button" className="lt-qr-card-banner-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <strong>{card ? 'Card connected' : challenge ? 'Enter the code' : 'Connect card'}</strong>
        {card ? <><p>{card.name} · {card.email_masked}</p><button type="button" onClick={forget}>Use another email</button></>
          : !challenge ? <><input type="email" aria-label="Email" autoComplete="email" required placeholder="Email on your card" value={email} onChange={event => setEmail(event.target.value)} /><button disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button></>
          : <><input inputMode="numeric" aria-label="Code" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="6-digit code" value={code} onChange={event => setCode(event.target.value)} /><button disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button></>}
        {note && <p role="status">{note}</p>}
      </form>
    </div>}
  </>
}


function CardHistorySheet({ apiBase, businessId, token, onClose, onReorder, initialTab = 'activity' }) {
  const dialog = useRef(null)
  const [tab, setTab] = useState(initialTab)
  const [filter, setFilter] = useState('all')
  const [record, setRecord] = useState(null)
  const [orderHistory, setOrderHistory] = useState(null)
  const [error, setError] = useState('')
  const [ordersError, setOrdersError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    dialog.current?.showModal()
    const controller = new AbortController()
    const load = async (path) => {
      const response = await fetch(`${apiBase}/api/v1/public/menu/${encodeURIComponent(businessId)}/card/${path}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(response.status === 401 ? 'Card connection expired. Reconnect your card.' :
          (typeof body.detail === 'string' ? body.detail : 'History temporarily unavailable.'))
      }
      return response.json()
    }
    void load('history').then(value => { if (!controller.signal.aborted) setRecord(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message || 'Card history unavailable.') })
    void load('orders').then(value => { if (!controller.signal.aborted) setOrderHistory(value) })
      .catch(e => { if (!controller.signal.aborted) setOrdersError(e.message || 'Order history unavailable.') })
    return () => { controller.abort(); dialog.current?.close() }
  }, [apiBase, businessId, token, refresh])
  const progress = loyaltyProgress(record)
  const events = historyEvents(record?.events, filter)
  const peso = value => typeof value === 'number' && Number.isFinite(value) ? `₱${value.toLocaleString('en-PH', {minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'
  const formatDate = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : '' }
  return <dialog ref={dialog} className="lt-v15-history-sheet" aria-label="Loyalty card history" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="lt-v15-history-inner">
      <header className="lt-v15-history-head"><div><span>YOUR LOYALTY CARD</span><h2>Card History</h2></div><button type="button" onClick={onClose} aria-label="Close card history">×</button></header>
      {record && <div className="lt-v15-history-card"><strong>{record.card_name || record.business_name || 'Loyalty card'}</strong><p>{progress.label}</p>
        {progress.goal > 0 && progress.goal <= 20 && <div className="lt-v15-stamps" aria-label={progress.label}>{Array.from({length:progress.goal},(_,i)=><span key={i} className={i<progress.filled?'is-filled':''} aria-hidden="true">{i<progress.filled?'✓':''}</span>)}</div>}
      </div>}
      <div className="lt-v15-history-filters" role="group" aria-label="History section">
        {[['activity','Activity'],['orders','Orders'],['rewards','Rewards']].map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}
      </div>
      {tab === 'orders' ? <>
        {!orderHistory && !ordersError && <p role="status" className="lt-v15-history-state">Loading your orders…</p>}
        {ordersError && <p role="alert" className="lt-v15-history-state">{ordersError}</p>}
        {orderHistory && <>
          <div className="lt-v16-order-totals"><span><b>{orderHistory.summary?.total_orders ?? '—'}</b> Linked orders</span><span><b>{peso(orderHistory.summary?.total_spent)}</b> Verified spent</span></div>
          {!orderHistory.summary?.complete && <p className="lt-v15-history-help">Showing recent linked orders only; totals are not lifetime totals.</p>}
          <p className="lt-v15-history-help">Only linked digital-menu orders. Cash spending is counted once the order is completed and marked paid. Test payments and unpaid orders are excluded.</p>
          {(orderHistory.orders || []).length ? <ul className="lt-v15-history-events lt-v16-orders">{orderHistory.orders.map((order,index)=><li key={`${order.order_number}-${index}`}><span className="lt-v15-history-symbol" aria-hidden="true">▤</span><span><strong>{order.order_number || 'Order'}</strong><small>{formatDate(order.created_at)} · {order.status} · {order.payment_status}</small><small>{order.branch_name || 'Branch not recorded'} · {order.payment_method || 'Payment method unknown'}</small><small>{(order.items||[]).map(item=>`${item.quantity}× ${item.name}`).join(', ')}</small>{onReorder && (order.items||[]).some(item=>item.item_id) && <button type="button" className="lt-v18-reorder" onClick={()=>onReorder(order)}>Reorder items</button>}</span><b>{peso(order.total)}</b></li>)}</ul>
            : <p className="lt-v15-history-state">No linked menu orders yet.</p>}
        </>}
      </> : <>
        {!record && !error && <p role="status" className="lt-v15-history-state">Checking your card activity…</p>}
        {error && <p role="alert" className="lt-v15-history-state">{error}</p>}
        {record && <>
          {tab === 'activity' && <div className="lt-v15-history-filters" role="group" aria-label="Filter card activity">{[['all','All'],['earned','Earned'],['redeemed','Redeemed']].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>}
          {(() => { const shown = tab === 'rewards' ? historyEvents(record.events,'redeemed') : events; return shown.length ? <ul className="lt-v15-history-events">{shown.map(event=><li key={event.id}><span className="lt-v15-history-symbol" aria-hidden="true">{event.type==='redeemed'?'↗':'✦'}</span><span><strong>{event.label}</strong><small>{formatDate(event.created_at)}</small></span>{Number.isFinite(event.amount) && event.amount!==0 && <b>{event.amount>0?'+':''}{event.amount} {event.unit||''}</b>}</li>)}</ul> : <p className="lt-v15-history-state">No recorded {tab === 'rewards' ? 'redemptions' : 'card activity'} yet.</p> })()}
          {record.partial && <p className="lt-v15-history-help">Some activity sources are currently unavailable. This is a partial history.</p>}
        </>}
      </>}
      {(error || ordersError) && <button type="button" className="lt-v16-retry" onClick={()=>{setRecord(null);setOrderHistory(null);setError('');setOrdersError('');setRefresh(v=>v+1)}}>Try again</button>}
    </div>
  </dialog>
}

function MenuLoyaltyCard({ apiBase, business, refreshKey, onReorder }) {
  const [token, setToken] = useState('')
  const [snapshot, setSnapshot] = useState(null)
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [historyTab, setHistoryTab] = useState('activity')
  const region = useRef(null)
  useEffect(() => {
    const readToken = () => { try { return localStorage.getItem(`lt-menu-card:${business.public_id}`) || '' } catch { return '' } }
    setToken(readToken())
    const sync = event => {
      if (event.detail?.business !== business.public_id) return
      const next = readToken()
      setToken(next)
      setSnapshot(null)
      if (!next) setOpen(false)
    }
    const openHistory = event => {
      if (event.detail?.business !== business.public_id) return
      region.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      if (readToken() && apiBase) {setHistoryTab('activity');setOpen(true)}
    }
    const openOrders = event => {
      if (event.detail?.business !== business.public_id) return
      if (readToken() && apiBase) {setHistoryTab('orders');setOpen(true)}
    }
    window.addEventListener('lt-menu-open-orders', openOrders)
    window.addEventListener(CARD_EVENT, sync)
    window.addEventListener('lt-menu-open-history', openHistory)
    return () => { window.removeEventListener(CARD_EVENT, sync); window.removeEventListener('lt-menu-open-history', openHistory); window.removeEventListener('lt-menu-open-orders', openOrders) }
  }, [apiBase, business.public_id])
  useEffect(() => {
    setSnapshot(null)
    if (!token || !apiBase) { setPending(false); return undefined }
    const controller = new AbortController()
    setPending(true)
    fetch(`${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/card/rewards`, {
      headers: {Authorization:`Bearer ${token}`}, cache:'no-store', signal:controller.signal,
    }).then(res => res.ok ? res.json() : Promise.reject()).then(value => {
      if (!controller.signal.aborted) setSnapshot(value)
    }).catch(() => { if (!controller.signal.aborted) setSnapshot(null) }).finally(() => { if (!controller.signal.aborted) setPending(false) })
    return () => controller.abort()
  }, [apiBase, business.public_id, token, refreshKey])
  const progress = loyaltyProgress(snapshot)
  return <section ref={region} className="lt-v15-loyalty" aria-label="Your loyalty card">
    <div className="lt-v15-loyalty-top"><span className="lt-v15-loyalty-icon" aria-hidden="true">{business.logo_url ? <img src={business.logo_url} alt="" loading="lazy" /> : "▣"}</span><div><span className="lt-v15-loyalty-kicker">LOYALTY CARD</span><strong>{snapshot?.card_name && snapshot.card_name !== 'Loyalty card' ? snapshot.card_name : business.name}</strong><p>{pending ? 'Checking card…' : snapshot ? progress.label : token ? 'Card details temporarily unavailable' : 'Connect your card to see rewards'}</p></div>
      {token && apiBase && <button type="button" onClick={()=>{setHistoryTab('activity');setOpen(true)}}>History <span aria-hidden="true">›</span></button>}
    </div>
    {snapshot && progress.goal > 0 && progress.goal <= 20 && <div className="lt-v15-stamps" aria-label={progress.label}>{Array.from({length:progress.goal},(_,i)=><span key={i} className={i<progress.filled?'is-filled':''} aria-hidden="true">{i<progress.filled?'✓':''}</span>)}</div>}
    {token && open && <CardHistorySheet apiBase={apiBase} businessId={business.public_id} token={token} initialTab={historyTab} onReorder={order=>{onReorder?.(order);setOpen(false)}} onClose={()=>setOpen(false)} />}
  </section>
}

function FastConfigureCard({ product, category, branchId, cart, money, onAdd, onOpen, onQuantity }) {
  const [selected, setSelected] = useState({})
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)
  useEffect(() => { if (!added) return undefined; const timer = setTimeout(()=>setAdded(false), 850); return () => clearTimeout(timer) }, [added])
  const available = menuItemAvailable(product, branchId)
  const groups = product.modifier_groups || []
  const quick = canQuickAdd(groups,selected) && menuSelectionAvailable(product,branchId,selected)
  const needsDetail = groups.length > 2 || groups.some(g=>!Array.isArray(g.options) || g.options.length > 6)
  const inCart = cart.filter(line=>line.item_id===product.public_id).reduce((count,line)=>count+line.quantity,0)
  return <article className={`lt-v15-product lt-qr-dish${!available?' is-sold':''}`}>
    <div className="lt-v15-product-top">
      <button type="button" className="lt-v15-product-photo" onClick={()=>onOpen(product)} aria-label={`Customize ${product.name}`}><MenuItemPhoto item={product} available={available}/></button>
      <div className="lt-v15-product-info"><small>{category || 'MENU'}</small><h3>{product.name}</h3>{product.description && <p>{product.description}</p>}<strong>{money(menuItemPrice(product,selected))}</strong></div>
    </div>
    {available && groups.length > 0 && !needsDetail && <div className="lt-v15-product-options">{groups.map(group=><fieldset key={group.public_id}><legend>{group.name}</legend><div>{group.options.map(option=><button type="button" key={option.public_id} disabled={!menuOptionAvailable(product,branchId,option.public_id)} title={!menuOptionAvailable(product,branchId,option.public_id)?'Sold out today':undefined} aria-pressed={(selected[group.public_id]||[]).includes(option.public_id)} onClick={()=>setSelected(current=>toggleMenuOption(current,group,option.public_id))}>{option.name}{option.price_delta>0?` +${money(option.price_delta)}`:''}</button>)}</div></fieldset>)}</div>}
    <div className="lt-v15-product-bottom">{available && !needsDetail && <div className="lt-v15-quantity" aria-label={`Quantity for ${product.name}`}><button type="button" onClick={()=>setQuantity(q=>Math.max(1,q-1))} aria-label={`Decrease quantity for ${product.name}`}>−</button><strong>{quantity}</strong><button type="button" onClick={()=>setQuantity(q=>Math.min(20,q+1))} aria-label={`Increase quantity for ${product.name}`}>+</button></div>}
      {available && inCart>0 && <span className="lt-v15-in-cart">{inCart} in bag</span>}
      <button type="button" className={`lt-v15-add${added?' is-added':''}`} disabled={!available} onClick={()=>{ if(!quick || needsDetail) return onOpen(product); onAdd(product,selected,quantity);setAdded(true) }}>{!available?'Sold out':added?'✓ Added':quick&&!needsDetail?'Add to Bag':'Choose options'}</button>
    </div>
  </article>
}

function pickupSlots() {
  const now = new Date()
  const start = new Date(now)
  start.setSeconds(0, 0)
  const remainder = start.getMinutes() % 15
  start.setMinutes(start.getMinutes() + (remainder === 0 ? 15 : 15 - remainder))
  if (start.getTime() - now.getTime() < 15 * 60 * 1000) start.setMinutes(start.getMinutes() + 15)
  return Array.from({ length: 24 }, (_, index) => {
    const slot = new Date(start.getTime() + index * 15 * 60 * 1000)
    const value = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, '0')}-${String(slot.getDate()).padStart(2, '0')}T${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`
    return { value, label: pickupTimeLabel(slot) }
  })
}

function CartThumb({ line }) {
  const [failedSource, setFailedSource] = useState('')
  const source = line?.image_url || ''
  const letter = (String(line?.name || '').trim().slice(0, 1) || '•').toUpperCase()
  return <span className="lt-qr-cart-thumb" aria-hidden="true">
    {source && failedSource !== source
      ? <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
      : <span className="lt-qr-cart-thumb-letter">{letter}</span>}
  </span>
}

function CartLine({ line, money, onQuantity, disabled = false }) {
  const options = (line.options || []).map(option => option.name).filter(Boolean)
  const lineTotal = Number(line.unit_price || 0) * Number(line.quantity || 0)
  return <li className="lt-qr-cart-line">
    <CartThumb line={line} />
    <div className="lt-qr-cart-line-copy">
      <strong className="lt-qr-cart-line-name">{line.name}</strong>
      {options.length > 0 && <span className="lt-qr-cart-line-options">{options.join(', ')}</span>}
      <span className="lt-qr-cart-line-unit">{money(line.unit_price)} × {line.quantity}</span>
      {onQuantity && <div className="lt-qr-cart-stepper">
        <button type="button" disabled={disabled} onClick={() => onQuantity(line.quantity - 1)} aria-label={line.quantity === 1 ? `Remove ${line.name}` : `Decrease ${line.name}`}>−</button>
        <span aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
        <button type="button" disabled={disabled || line.quantity >= 20} onClick={() => onQuantity(line.quantity + 1)} aria-label={`Increase ${line.name}`}>+</button>
      </div>}
    </div>
    <strong className="lt-qr-cart-line-total">{money(lineTotal)}</strong>
  </li>
}

function CheckoutRewards({ snapshot, loading, error, paymentMethod, selectedReward, onSelect, disabled }) {
  if (loading) return <section className="lt-menu-rewards" aria-live="polite"><strong>Your loyalty rewards</strong><p>Checking your card…</p></section>
  if (error) return <section className="lt-menu-rewards" aria-live="polite"><strong>Your loyalty rewards</strong><p>{error}</p></section>
  if (!snapshot) return <section className="lt-menu-rewards"><strong>Your loyalty rewards</strong><p>Connect your LoyaltyTree card before checkout to see your rewards.</p></section>
  const rewards = snapshot.rewards || []
  return <section className="lt-menu-rewards" aria-label="Your loyalty rewards">
    <strong>Your loyalty rewards</strong>
    <div className="lt-menu-rewards-balances">
      {snapshot.points_enabled && <span><b>{snapshot.points_balance}</b> points</span>}
      {snapshot.stamps_enabled && <span><b>{snapshot.stamp_count}</b> stamps</span>}
    </div>
    {rewards.length ? <ul>{rewards.map((reward, index) => {
      const eligible = checkoutRewardIsEligible(reward)
      const isSelected = eligible && selectedReward?.kind === reward.kind && selectedReward?.id === reward.id
      const pickable = eligible && paymentMethod === 'cash'
      return <li key={`${reward.kind}-${reward.id || index}`}>
        {eligible ? <label className={`lt-menu-reward-choice${isSelected ? ' is-picked' : ''}`}>
          <input type="radio" name="lt-menu-reward" value={`${reward.kind}:${reward.id}`} checked={isSelected}
            disabled={!pickable || disabled} onChange={() => onSelect({ kind: reward.kind, id: reward.id })} />
          <span><b>{reward.name}</b>{reward.detail && <small>{reward.detail}</small>}</span>
        </label> : <span><b>{reward.name}</b>{reward.detail && <small>{reward.detail}</small>}</span>}
        <em className={eligible ? 'is-ready' : ''}>{!reward.available ? 'Not yet' : eligible ? (isSelected ? 'Selected' : 'Available') : 'At counter'}</em>
      </li>
    })}</ul> : <p>No rewards are available yet. Keep earning with your card!</p>}
    {selectedReward && paymentMethod === 'cash' && <button type="button" className="lt-menu-reward-clear" disabled={disabled} onClick={() => onSelect(null)}>Remove selected reward</button>}
    <small className="lt-menu-rewards-footnote">{paymentMethod === 'cash'
      ? 'Select one eligible Points or Stamp reward. The counter fulfills it after confirmed payment and completion. No online price discounts.'
      : 'Select Pay at counter to use an eligible reward. Card and QR Ph methods are test-only and cannot redeem real rewards.'}</small>
  </section>
}

function CheckIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function OrderTypeIcon({ type }) {
  const paths = type === 'dine-in' ? <><path d="M3 10h18M5 10v11m14-11v11M7 4h10v6H7zM3 15h4m10 0h4" /></> : type === 'pickup' ? <><rect x="4" y="8" width="16" height="13" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2" /></> : <><path d="M3 5h12v12H3zM15 9h4l3 4v4h-7" /><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
}

const CHECKOUT_STEPS = [['', 'Cart'], ['service', 'Details'], ['payment', 'Pay']]

function serviceLine(service, tableNo, pickupLabel) {
  if (service === 'dine-in') return `Dine in${tableNo ? ` · Table ${tableNo}` : ''}`
  return `Pick up${pickupLabel ? ` · ${pickupLabel}` : ' later'}`
}

export function QRMenuBrowser({ data, preview = false, initialBranch, onBranchChange, apiBase = '' }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [under200, setUnder200] = useState(false)
  const [navNotice, setNavNotice] = useState('')
  const [requestedBranch, setRequestedBranch] = useState(initialBranch !== undefined ? initialBranch || '' : data.selected_branch || '')
  const [item, setItem] = useState(null)
  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  const [order, setOrder] = useState(null)
  const [trackingError, setTrackingError] = useState('')
  const [savedReceipt, setSavedReceipt] = useState(null)
  const [resumeBusy, setResumeBusy] = useState(false)
  const [resumeError, setResumeError] = useState('')
  const [reorderNote, setReorderNote] = useState('')
  const [payStep, setPayStep] = useState('')
  const [service, setService] = useState('dine-in')
  const [buyerName, setBuyerName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [cardName, setCardName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [tableNo, setTableNo] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [pickupAt, setPickupAt] = useState('')
  const [slots, setSlots] = useState([])
  const [checkingCard, setCheckingCard] = useState(false)
  const [checkoutRewards, setCheckoutRewards] = useState(null)
  const [selectedReward, setSelectedReward] = useState(null)
  const [rewardsLoading, setRewardsLoading] = useState(false)
  const [rewardsError, setRewardsError] = useState('')
  const rewardsRequest = useRef(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [copied, setCopied] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const submittingRef = useRef(false)
  // One order number + payment reference per checkout. A retry after a failed
  // save reuses them so the shop never gets two different orders for one tap.
  const pendingIds = useRef(null)
  const sheetRef = useRef(null)
  const cartOverlayRef = useRef(null)
  const dockRef = useRef(null)
  const sheetTitleId = useId()
  const menuHeading = useRef(null)
  const focusHeading = useRef(false)
  const business = data.business
  const branches = data.branches || []
  // A multi-branch shop needs a branch before anyone can order. One branch is picked automatically.
  const { branchId, needsBranch, showSelector, invalidBranch } = resolveMenuBranch(branches, requestedBranch)
  const branch = branches.find(value => value.public_id === branchId)
  const chooseBranch = id => { if (!branches.some(value => value.public_id === id)) return; setRequestedBranch(id); setItem(null); onBranchChange?.(id) }
  useEffect(() => { if (initialBranch !== undefined) setRequestedBranch(initialBranch || '') }, [initialBranch])
  useEffect(() => { if (focusHeading.current) { menuHeading.current?.focus({ preventScroll: true }); focusHeading.current = false } }, [category, search])
  const money = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: business.currency || 'PHP' }).format(Number(value || 0))
  const groups = groupMenuCategories(data.categories || [], data.items || [], branchId)
  const selectedCategory = groups.find(value => value.public_id === category)
  const catalog = category && category !== 'all' ? selectedCategory?.items || [] : groups.flatMap(value => value.items)
  const items = filterMenuItems(catalog, 'all', search).filter(value => !under200 || (business.currency || 'PHP') !== 'PHP' || Number(value.base_price) < 200)
  const categoryName = Object.fromEntries(groups.flatMap(value => value.items.map(entry => [entry.public_id, value.name])))
  const chooseCategory = id => { focusHeading.current = true; setCategory(id) }
  const previousLines = order?.status === 'completed' ? order.lines : savedReceipt?.status === 'completed' ? savedReceipt.lines : []
  const quickItems = quickReorderItems(previousLines, data.items || [], branchId, menuItemAvailable, buildReorderDraft, addCartItem)
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  const total = cartSubtotal(cart)
  const pickupLabel = slots.find(slot => slot.value === pickupAt)?.label || ''
  const updateCart = change => { pendingIds.current = null; setSubmitError(''); setCart(change) }
  const addItem = (value, selected = {}, quantity = 1) => {
    setReorderNote('')
    if (needsBranch || !menuSelectionAvailable(value, branchId, selected)) return
    updateCart(current => addCartItem(current, value, selected, quantity))
    setOrder(null)
  }
  const changeLine = (key, quantity) => updateCart(current => changeCartQuantity(current, key, quantity))
  const addUsual = option => {
    setOrder(null); setCart(option.draft); setReorderNote('Review your current prices and options before placing another order. Nothing has been submitted.'); setPayStep(''); setCartOpen(true)
  }

  const reorderFromHistory = previous => {
    if (needsBranch) {setReorderNote('Choose a branch before reordering.');return}
    const lines = (previous?.items || []).map(value => ({
      item_id: value.item_id, name: value.name, quantity: value.quantity,
      options: Array.isArray(value.options) ? value.options : [],
    }))
    const {cart: draft, skipped} = buildReorderDraft(lines, data.items || [], branchId, menuItemAvailable, addCartItem)
    setCart(draft);setSelectedReward(null);setCheckoutRewards(null);pendingIds.current=null;setOrder(null);setPayStep('')
    setReorderNote(skipped ? `${skipped} old item${skipped === 1 ? '' : 's'} could not be added. Review current prices, options and availability.` : 'Review current prices and availability. This is a new draft order, not a payment.')
    setCartOpen(draft.length > 0)
  }

  const openCart = () => { setOrder(null); setReorderNote(''); setPayStep(''); setSubmitError(''); setCartOpen(true) }
  const closeCart = () => {
    if (submittingRef.current) return
    setCartOpen(false); setSubmitError(''); setCopied(false)
    // Preserve the saved order for the customer-facing tracking dock.
    if (payStep !== 'done' && !cart.length) setPayStep('')
  }

  // v14: browser-local last receipt, strictly scoped to this business. Never
  // restore the saved status as authoritative; verify it with the v13 API first.
  useEffect(() => {
    if (preview) return undefined
    setSavedReceipt(readRecentOrder(recentReceiptStorage(), business.public_id))
    setResumeError('')
    return undefined
  }, [business.public_id, preview])
  useEffect(() => {
    if (!preview && order?.server_order_id) saveRecentOrder(recentReceiptStorage(), business.public_id, order)
  }, [business.public_id, order, preview])

  // Poll the actual saved order, not a visual timer. Works while the receipt is
  // open or minimized, stops on completion/cancellation and cleans up on unmount.
  useEffect(() => {
    const id = order?.server_order_id
    if (!id || !apiBase || preview || order.status === 'completed' || order.status === 'cancelled') return undefined
    let disposed = false
    let busy = false
    const controller = new AbortController()
    const load = async () => {
      if (busy || disposed || document.visibilityState === 'hidden') return
      busy = true
      try {
        const next = await fetchMenuOrderPhase({ fetchImpl: fetch, apiBase,
          businessId: business.public_id, orderId: id, signal: controller.signal })
        if (!disposed) {
          setTrackingError('')
          setOrder(current => current?.server_order_id !== id ? current
            : current.status === next.status && current.payment_status === next.payment_status
              ? current : { ...current, ...next })
        }
      } catch {
        if (!disposed) setTrackingError('Live updates temporarily unavailable. Last known status shown.')
      } finally { busy = false }
    }
    void load()
    const timer = window.setInterval(load, 6000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [apiBase, business.public_id, order?.server_order_id, order?.status, preview])

  // Focus the sheet when it opens, trap Tab inside it, and give focus back.
  useEffect(() => {
    if (!cartOpen) return undefined
    let previous = ''
    const overlay = cartOverlayRef.current
    const viewport = window.visualViewport
    // Public checkout belongs to the browser top layer, not a scrolling menu
    // ancestor. Follow the visible viewport when Android chrome or keyboard moves.
    const syncViewport = () => {
      if (!overlay || !viewport || viewport.width <= 0 || viewport.height <= 0) return
      overlay.style.setProperty('--lt-cart-viewport-top', `${viewport.offsetTop}px`)
      overlay.style.setProperty('--lt-cart-viewport-left', `${viewport.offsetLeft}px`)
      overlay.style.setProperty('--lt-cart-viewport-width', `${viewport.width}px`)
      overlay.style.setProperty('--lt-cart-viewport-height', `${viewport.height}px`)
    }
    if (!preview) {
      previous = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      syncViewport()
      overlay?.showModal()
      syncViewport()
      viewport?.addEventListener('resize', syncViewport)
      viewport?.addEventListener('scroll', syncViewport)
      window.addEventListener('resize', syncViewport)
    }
    return () => {
      if (!preview) {
        viewport?.removeEventListener('resize', syncViewport)
        viewport?.removeEventListener('scroll', syncViewport)
        window.removeEventListener('resize', syncViewport)
        if (overlay?.open) overlay.close()
        document.body.style.overflow = previous
      }
      setTimeout(() => dockRef.current?.focus?.({ preventScroll: true }), 0)
    }
  }, [cartOpen, preview])
  useEffect(() => { if (cartOpen) sheetRef.current?.querySelector('h2')?.focus({ preventScroll: true }) }, [payStep, cartOpen])
  const onSheetKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); closeCart(); return }
    if (event.key !== 'Tab') return
    const focusable = [...(sheetRef.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]') || [])]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const loadCheckoutRewards = async token => {
    const seq = ++rewardsRequest.current
    setCheckoutRewards(null)
    setRewardsError('')
    if (!token || !apiBase) { setRewardsLoading(false); return }
    setRewardsLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/card/rewards`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!response.ok) throw new Error(response.status === 401 ? 'Card connection expired. Please reconnect.' : 'Rewards unavailable. You can still place your order.')
      const body = await response.json()
      if (seq === rewardsRequest.current) setCheckoutRewards(body)
    } catch (error) {
      if (seq === rewardsRequest.current) setRewardsError(error.message || 'Rewards unavailable. You can still place your order.')
    } finally { if (seq === rewardsRequest.current) setRewardsLoading(false) }
  }

  const startCheckout = async () => {
    if (!cart.length || checkingCard || needsBranch) return
    setSelectedReward(null)
    setCheckingCard(true)
    let saved = ''
    let token = ''
    try { saved = localStorage.getItem(`lt-menu-card-name:${business.public_id}`) || ''; token = localStorage.getItem(`lt-menu-card:${business.public_id}`) || '' } catch { saved = ''; token = '' }
    if (token && apiBase) {
      try {
        const response = await fetch(`${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/card`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        if (response.ok) {
          const body = await response.json()
          if (body.name && body.name !== 'Loyalty card') { saved = body.name; try { localStorage.setItem(`lt-menu-card-name:${business.public_id}`, saved) } catch { /* storage is optional */ } }
        } else if (response.status === 401) {
          token = ''; saved = ''
          try { localStorage.removeItem(`lt-menu-card:${business.public_id}`); localStorage.removeItem(`lt-menu-card-name:${business.public_id}`) } catch { /* ignore */ }
        }
      } catch { /* temporary connection problem: rewards remain unavailable */ }
    }
    void loadCheckoutRewards(token)
    setCheckingCard(false)
    setCardName(saved)
    setEditingName(false)
    setBuyerName(current => current.trim() ? current : saved)
    setSlots(pickupSlots())
    setPayStep('service')
  }

  const cardToken = () => { try { return localStorage.getItem(`lt-menu-card:${business.public_id}`) || '' } catch { return '' } }

  async function submitOrder() {
    if (submittingRef.current) return
    if (!cart.length) { setSubmitError('Your cart is empty.'); return }
    if (needsBranch) { setSubmitError('Choose your branch first.'); return }
    if (service !== 'dine-in') { setSubmitError('Pick up and delivery require verified online payment and are not available yet.'); return }
    if (paymentMethod !== 'cash') { setSubmitError('Card and QRPH are in test mode. Please select cash.'); return }
    if (!apiBase) { setSubmitError('Ordering is not available in preview.'); return }
    if (!pendingIds.current) {
      const stamp = Date.now().toString(36).toUpperCase()
      pendingIds.current = { order_id: `LT-${stamp}`, payment_reference: `REF-${stamp.slice(-6)}` }
    }
    const ids = pendingIds.current
    const placedOrder = {
      ...buildMenuOrder({ merchantId: business.public_id, cart, orderId: ids.order_id }),
      buyer_name: buyerName.trim(),
      service,
      table_no: service === 'dine-in' ? tableNo.trim() : '',
      customer_note: orderNote.trim().slice(0, 500),
      pickup_at: service === 'pickup' ? pickupAt : '',
      pickup_label: service === 'pickup' ? pickupLabel : '',
      payment_reference: ids.payment_reference,
      status: 'awaiting_payment',
      lines: cart.map(line => ({ ...line })),
      // Sent with the order so the owner app can show the branch and member.
      branch_public_id: branchId,
      branch_name: branch?.name || '',
      card_token: cardToken(),
      payment_method: paymentMethod,
      ...checkoutRewardSelectionPayload(selectedReward, paymentMethod),
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    const result = await sendMenuOrder({
      fetchImpl: (input, init) => fetch(input, init),
      url: `${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/orders`,
      order: placedOrder,
    })
    submittingRef.current = false
    setSubmitting(false)
    if (!result.ok) { setSubmitError(result.error); return }
    // Only a saved order (response.ok) reaches the receipt.
    const saved = result.order || {}
    setTrackingError('')
    setSavedReceipt(null)
    setOrder({ ...placedOrder, order_number: saved.order_number || placedOrder.order_id, server_order_id: saved.public_id || '', status: saved.status || 'new', payment_status: saved.payment_status || '', reward: saved.reward || null })
    pendingIds.current = null
    setCopied(false)
    setCart([])
    setPayStep('done')
  }

  const copyOrderNumber = async value => {
    try { await navigator.clipboard.writeText(value); setCopied(true) } catch { setCopied(false) }
  }

  const resumeLastOrder = async () => {
    if (!savedReceipt || resumeBusy || preview) return
    setResumeBusy(true); setResumeError('')
    try {
      // A cached status is not proof that the order is still in that stage.
      const next = await fetchMenuOrderPhase({ fetchImpl: fetch, apiBase,
        businessId: business.public_id, orderId: savedReceipt.server_order_id })
      setOrder({ ...savedReceipt, ...next })
      setSavedReceipt(null)
      setPayStep('done')
      setCartOpen(true)
    } catch {
      setResumeError('Cannot verify this order right now. Check your connection and try again.')
    } finally { setResumeBusy(false) }
  }
  const forgetLastOrder = () => {
    forgetRecentOrder(recentReceiptStorage(), business.public_id)
    setSavedReceipt(null); setResumeError(''); setOrder(null)
    setCartOpen(false); setPayStep('')
  }
  const orderAgain = () => {
    // Never replay an old payment, reward reservation or order ID.
    // Rebuild only an unsubmitted draft with the current menu and prices.
    const { cart: draft, skipped } = buildReorderDraft(order?.lines, data.items || [], branchId,
      menuItemAvailable, addCartItem)
    setCart(draft); setSelectedReward(null); setCheckoutRewards(null)
    pendingIds.current = null; setSubmitError(''); setOrder(null); setPayStep('')
    setCartOpen(draft.length > 0)
    setReorderNote(skipped
      ? `${skipped} previous item${skipped === 1 ? '' : 's'} could not be added because availability or options changed. Review your cart and current prices.`
      : draft.length ? 'Review your reorder cart. Prices and availability are updated; nothing has been submitted.'
        : 'Choose your items from the current menu to order again.')
  }


  const step = payStep === 'done' ? 'done' : !cart.length ? 'empty' : payStep
  const receipt = order ? receiptCopy(order.payment_method, money(order.subtotal), business.name) : null
  const phase = order ? menuOrderPhase(order) : null
  const title = step === 'done' ? (phase?.title || 'Your order') : step === 'service' ? 'Order details' : step === 'payment' ? 'Review & pay' : 'Your cart'
  const stepIndex = CHECKOUT_STEPS.findIndex(([value]) => value === payStep)
  const nameFromCard = cardName && buyerName.trim() === cardName && !editingName
  // No connected card: the shop needs a name to call the order.
  const nameRequired = !cardName
  const isOnlinePreview = service === 'pickup' || service === 'delivery'
  const detailsReady = !(service === 'pickup' && !pickupAt) && !(nameRequired && !buyerName.trim()) && (!isOnlinePreview || (buyerName.trim() && validContactPhone(contactPhone) && (service !== 'delivery' || deliveryAddress.trim().length >= 5)))
  const chooseService = value => {
    setService(value); setPaymentMethod(value === 'dine-in' ? 'cash' : 'qrph')
    setSelectedReward(null); setSubmitError(''); pendingIds.current = null
    if(value === 'pickup' && !slots.length) setSlots(pickupSlots())
  }
  const connectedCard = value => {
    const name = value?.name && value.name !== 'Loyalty card' ? value.name : ''
    if (!name) return
    let token = ''
    try { token = localStorage.getItem(`lt-menu-card:${business.public_id}`) || '' } catch { /* ignore */ }
    void loadCheckoutRewards(token)
    try { localStorage.setItem(`lt-menu-card-name:${business.public_id}`, name) } catch { /* storage is optional */ }
    setCardName(name)
    setEditingName(false)
    setBuyerName(name)
    setContactPhone(''); setDeliveryAddress('')
  }

  const CartOverlay = preview ? 'div' : 'dialog'
  return <div className={`lt-qr-public lt-qr-cafe lt-qr-v15${preview ? ' lt-qr-is-preview' : ''}${count ? ' lt-qr-has-cart' : ''}`}>
    <main className="lt-qr-page">
      {preview && <div className="lt-qr-preview-note">Owner preview · {data.is_published ? 'Published' : 'Not published'}</div>}
      {reorderNote && <p className="lt-qr-reorder-notice" role="status">{reorderNote}</p>}
      <header className="lt-qr-cafe-head lt-v15-head">
        <div className="lt-qr-cafe-title lt-v15-business-row">
          {business.logo_url && <img className="lt-qr-cafe-logo" src={business.logo_url} alt="" />}
          <h1>{business.name}</h1>
          <div className="lt-qr-cafe-side">
            {showSelector ? <label className="lt-qr-branch-drop"><select aria-label="Branch" value={branchId} onChange={event=>chooseBranch(event.target.value)}>{!branchId && <option value="" disabled>Choose branch</option>}{branches.map(value=><option key={value.public_id} value={value.public_id}>{value.name}</option>)}</select></label>
              : branch?.name && <span className="lt-v15-branch-name">{branch.name}</span>}
            {apiBase ? <MenuCardLink apiBase={apiBase} business={business} /> : business.join_url && <a className="lt-qr-card-link" href={business.join_url}>Connect loyalty card</a>}
          </div>
        </div>
        <label className="lt-qr-cafe-search lt-v15-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search menu" placeholder="Search the menu" value={search} onChange={event=>setSearch(event.target.value)} /></label>
        <div className="lt-v15-filter-row">
          {quickItems.length>0 && <button type="button" onClick={()=>document.querySelector('.lt-v15-usual')?.scrollIntoView({behavior:'smooth'})}>↻ Quick Reorder</button>}
          {(business.currency||'PHP')==='PHP' && <button type="button" aria-pressed={under200} onClick={()=>setUnder200(value=>!value)}>Under ₱200</button>}
          <button type="button" onClick={()=>{setUnder200(false);setSearch('');chooseCategory('all')}}>All menu</button>
        </div>
      </header>
      {needsBranch && <section className="lt-qr-branch-picker" aria-labelledby="lt-qr-branch-picker-title"><h2 id="lt-qr-branch-picker-title">Choose your branch</h2><p>Pick your location to browse and order.</p><ul>{branches.map(value=><li key={value.public_id}><button type="button" onClick={()=>chooseBranch(value.public_id)}><span className="lt-qr-branch-picker-copy"><strong>{value.name}</strong>{value.address && <span>{value.address}</span>}</span><i aria-hidden="true">›</i></button></li>)}</ul></section>}
      {!needsBranch && <>
        <nav className="lt-v15-categories" aria-label="Menu categories">
          <button type="button" aria-pressed={category==='all'} onClick={()=>chooseCategory('all')}>All Items</button>
          {groups.map(value=><button type="button" key={value.public_id} aria-pressed={category===value.public_id} onClick={()=>chooseCategory(value.public_id)}>{value.name}</button>)}
        </nav>
        <MenuLoyaltyCard apiBase={apiBase} business={business} refreshKey={`${order?.status||''}:${order?.payment_status||''}`} onReorder={reorderFromHistory} />
        {quickItems.length>0 && !search && category==='all' && !under200 && <section className="lt-v15-usual" aria-label="Order your daily usual"><div className="lt-v15-section-head"><h2>Order Your Daily Usual</h2><small>From a recent order on this device</small></div><div className="lt-v15-usual-list">{quickItems.map(option=><button type="button" key={option.item.public_id} onClick={()=>addUsual(option)}><span className="lt-v15-usual-photo"><MenuItemPhoto item={option.item} available /></span><span><strong>{option.item.name}</strong><small>{money(menuItemPrice(option.item,{}))} base price · Review options</small></span><b aria-hidden="true">＋</b></button>)}</div></section>}
        {(data.actions||[]).length>0 && <div className="lt-qr-cafe-actions lt-v15-extras">{data.actions.map(action=><a key={action.id} href={action.url} target="_blank" rel="noreferrer" className={action.id==='book'?'is-book':''}><strong>{action.label}</strong>{action.note?<span>{action.note}</span>:null}</a>)}</div>}
        <section className="lt-qr-stream lt-v15-menu" aria-label="Menu items">
          <div className="lt-v15-section-head"><h2 ref={menuHeading} tabIndex={-1}>{search.trim()?'Search results':selectedCategory?.name||'All items'}</h2><small>{items.length} {items.length===1?'item':'items'}</small></div>
          {items.map(value=><FastConfigureCard key={value.public_id} product={value} category={categoryName[value.public_id]} branchId={branchId} cart={cart} money={money} onOpen={setItem} onAdd={addItem} onQuantity={changeLine} />)}
          {!items.length && <div className="lt-qr-empty" role="status"><h3>{search?'No matches yet.':'Nothing in this category.'}</h3><p>{search?'Try another word.':'Check another category.'}</p></div>}
        </section>
      </>}
      <footer className="lt-qr-footer"><img src={loyaltyTreeLogo} alt="" /><span>Menu by <strong>Loyalty Tree</strong></span></footer>
    </main>
    {item && <ItemDetails key={item.public_id} item={item} branchId={branchId} available={menuItemAvailable(item, branchId)} money={money} onClose={() => setItem(null)} onAdd={addItem} />}
    {!order && savedReceipt && !cartOpen && !needsBranch && count === 0 && <div className="lt-qr-resume-dock" role="region" aria-label="Recent order tracking">
      <p><strong>Recent order saved on this device</strong><small>Tap to securely check its latest status. Available for 3 days.</small></p>
      <div className="lt-qr-resume-actions">
        <button type="button" className="lt-qr-resume-main" disabled={resumeBusy} onClick={resumeLastOrder}>{resumeBusy ? 'Checking order…' : 'Track last order'}</button>
        <button type="button" className="lt-qr-resume-forget" disabled={resumeBusy} onClick={forgetLastOrder}>Forget</button>
      </div>
      {resumeError && <small role="alert">{resumeError}</small>}
    </div>}
    {order && !cartOpen && !needsBranch && <div className="lt-qr-dock lt-qr-tracking-dock">
      <button type="button" className="lt-qr-dock-card" onClick={() => { setPayStep('done'); setCartOpen(true) }}
        aria-label={`Track order ${order.order_number}, ${phase?.title || 'Order status'}`}>
        <span className="lt-qr-dock-count" aria-hidden="true">✓</span>
        <span className="lt-qr-dock-label" aria-hidden="true">{phase?.title}<small>Order {order.order_number} · Tap to track</small></span>
        <strong aria-hidden="true">›</strong>
      </button>
    </div>}
    {count > 0 && !order && !cartOpen && !needsBranch && <div className="lt-qr-dock">
      <button type="button" ref={dockRef} className="lt-qr-dock-card" onClick={openCart} aria-label={`View cart, ${count} ${count === 1 ? 'item' : 'items'}, ${money(total)}`}>
        <span className="lt-qr-dock-count" aria-hidden="true">{count}</span>
        <span className="lt-qr-dock-label" aria-hidden="true">View cart<small>{count} {count === 1 ? 'item' : 'items'}</small></span>
        <strong aria-hidden="true">{money(total)}</strong>
      </button>
    </div>}
    {!cartOpen && !needsBranch && <>
      {navNotice && <p className="lt-v15-nav-note" role="status">{navNotice}</p>}
      <nav className="lt-v15-bottom-nav" aria-label="Menu navigation">
        <button type="button" onClick={()=>{ setNavNotice('');window.scrollTo({top:0,behavior:'smooth'}) }}><span aria-hidden="true">⌂</span>Menu</button>
        <button type="button" onClick={()=>{setNavNotice('');if(order){setPayStep('done');setCartOpen(true)}else {let token='';try{token=localStorage.getItem(`lt-menu-card:${business.public_id}`)||''}catch{};if(token && apiBase){window.dispatchEvent(new CustomEvent('lt-menu-open-orders',{detail:{business:business.public_id}}))}else if(savedReceipt){void resumeLastOrder()}else setNavNotice('Connect your loyalty card to view linked previous orders.')}}}><span aria-hidden="true">▤</span>Orders</button>
        <button type="button" onClick={()=>{setNavNotice('');window.dispatchEvent(new CustomEvent('lt-menu-open-history', { detail: {business:business.public_id} }))}}><span aria-hidden="true">✧</span>Rewards</button>
        <button type="button" onClick={()=>{if(order){setPayStep('done');setCartOpen(true)}else openCart()}}><span className="lt-v19-nav-cart" aria-hidden="true">▣{count > 0 && <b>{count}</b>}</span>Cart<span className="lt-qr-sr">{count > 0 ? `, ${count} items` : ''}</span></button>
      </nav>
    </>}
    {cartOpen && <CartOverlay ref={cartOverlayRef} className="lt-qr-cart" aria-labelledby={preview ? undefined : sheetTitleId} onCancel={event => { event.preventDefault(); closeCart() }} onMouseDown={event => { if (event.target === event.currentTarget) closeCart() }}>
      <div className="lt-qr-cart-card" ref={sheetRef} role={preview ? 'dialog' : undefined} aria-modal={preview ? true : undefined} aria-labelledby={preview ? sheetTitleId : undefined} onKeyDown={onSheetKeyDown}>
        <header className="lt-qr-sheet-head">
          <div>
            <div className="lt-v19-sheet-title"><h2 id={sheetTitleId} tabIndex={-1}>{title}</h2>{step === '' && <span className="lt-v19-cart-count">{count} {count === 1 ? 'item' : 'items'}</span>}</div>
            {(step === '' || step === 'service' || step === 'payment') && <ol className="lt-qr-steps" aria-label="Checkout steps">
              {CHECKOUT_STEPS.map(([value, label], index) => <li key={label} className={index < stepIndex ? 'is-done' : index === stepIndex ? 'is-current' : ''} aria-current={index === stepIndex ? 'step' : undefined}>{label}</li>)}
            </ol>}
          </div>
          <button type="button" className="lt-qr-sheet-x" onClick={closeCart} disabled={submitting} aria-label={step === 'done' ? 'Close receipt' : 'Close cart'}>×</button>
        </header>

        <div className="lt-qr-sheet-body">
          {step === 'empty' && <div className="lt-qr-cart-empty">
            <span className="lt-qr-cart-empty-icon" aria-hidden="true">☕</span>
            <h3>Your cart is empty</h3>
            <p>Add something from the menu and it will show up here.</p>
          </div>}

          {step === '' && <ul className="lt-qr-cart-lines">{cart.map(line => <CartLine key={line.key} line={line} money={money} onQuantity={quantity => changeLine(line.key, quantity)} />)}</ul>}

          {step === 'service' && <div className="lt-qr-pay">
            <h3 className="lt-v19-order-type-title">How will you get your order?</h3>
            <div className="lt-v19-order-types" role="group" aria-label="Order type">
              <button type="button" aria-pressed={service === 'dine-in'} onClick={() => chooseService('dine-in')}><OrderTypeIcon type="dine-in"/><strong>Dine in</strong><span className="lt-v19-choice-indicator" aria-hidden="true">{service === 'dine-in' && <CheckIcon size={13}/>}</span></button>
              <button type="button" aria-pressed={service === 'pickup'} onClick={()=>chooseService('pickup')}><OrderTypeIcon type="pickup"/><strong>Pick up</strong><small>Online only</small><span className="lt-v19-choice-indicator" aria-hidden="true">{service === 'pickup' && <CheckIcon size={13}/>}</span></button>
              <button type="button" aria-pressed={service === 'delivery'} onClick={()=>chooseService('delivery')}><OrderTypeIcon type="delivery"/><strong>Delivery</strong><small>Online only</small><span className="lt-v19-choice-indicator" aria-hidden="true">{service === 'delivery' && <CheckIcon size={13}/>}</span></button>
            </div>
            {isOnlinePreview && <div className="lt-v20-preview-note" role="status"><strong>Online ordering preview</strong><small>Card or QRPH only. You can prepare your details, but live payment and order submission are not enabled yet.</small></div>}
            {service === 'dine-in'
              ? <label className="lt-qr-field"><span>Table number <em>optional</em></span><input inputMode="numeric" autoComplete="off" placeholder="e.g. 5" value={tableNo} onChange={event => setTableNo(event.target.value.slice(0, 12))} /></label>
              : service === 'pickup' ? <label className="lt-qr-field"><span>Pick up time</span><select value={pickupAt} onChange={event => setPickupAt(event.target.value)}><option value="">Choose a time</option>{slots.map(slot => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select>{!pickupAt && <small className="lt-qr-field-help">Choose a pick up time to continue.</small>}</label> : null}
            <label className="lt-qr-field lt-qr-note-field"><span>Note <em>optional · special requests</em></span><textarea maxLength={500} rows={3} value={orderNote} onChange={event => { setOrderNote(event.target.value); pendingIds.current = null }} placeholder="e.g. Less ice, no onions, separate sauce (subject to merchant confirmation)" aria-label="Note for the merchant" /><small className="lt-qr-field-help is-neutral">Requests are subject to the merchant's confirmation. No automatic price changes.</small></label>
            {nameFromCard && !isOnlinePreview
              ? <div className="lt-qr-name-row"><span>Name: <strong>{cardName}</strong></span><button type="button" className="lt-qr-text-button" onClick={() => setEditingName(true)}>Change</button></div>
              : <label className="lt-qr-field"><span>{nameRequired || isOnlinePreview ? <>Your name <b className="lt-qr-required" aria-hidden="true">*</b></> : <>Your name <em>optional</em></>}</span><input autoComplete="name" required={nameRequired || isOnlinePreview} aria-required={nameRequired || isOnlinePreview} aria-describedby={nameRequired ? `${sheetTitleId}-name-help` : undefined} placeholder="Name for your order" value={buyerName} onChange={event => setBuyerName(event.target.value.slice(0, 120))} />{nameRequired && <small id={`${sheetTitleId}-name-help`} className="lt-qr-field-help is-neutral">So the shop can call your order.</small>}</label>}
            {!cardName && (apiBase || business.join_url) && <div className="lt-qr-card-promo">
              <p><strong>Have a LoyaltyTree card?</strong> Connect it to earn rewards on this order.</p>
              {apiBase
                ? <MenuCardLink apiBase={apiBase} business={business} label="Connect card" className="lt-qr-card-promo-button" onConnected={connectedCard} />
                : <a className="lt-qr-card-promo-button" href={business.join_url}>Connect card</a>}
            </div>}
            {isOnlinePreview && <MenuCheckoutContact key={business.public_id+':'+cardToken()} apiBase={apiBase} businessId={business.public_id} cardToken={cardToken()} service={service} phone={contactPhone} setPhone={setContactPhone} address={deliveryAddress} setAddress={setDeliveryAddress} onName={name=>setBuyerName(current=>current.trim()?current:name)} />}
            <ul className="lt-qr-cart-lines is-compact" aria-label="Items in your order">{cart.map(line => <CartLine key={line.key} line={line} money={money} />)}</ul>
          </div>}

          {step === 'payment' && <div className="lt-qr-pay">
            <dl className="lt-qr-summary">
              {branch && branches.length > 1 && <div><dt>Branch</dt><dd>{branch.name}</dd></div>}
              <div><dt>Order type</dt><dd>{service === 'delivery' ? 'Delivery' : serviceLine(service, tableNo.trim(), pickupLabel)}</dd></div>
              <div><dt>Name</dt><dd>{buyerName.trim() || '—'}</dd></div>
              {isOnlinePreview && <div><dt>Phone</dt><dd>{contactPhone}</dd></div>}
              {service === 'delivery' && <div><dt>Address</dt><dd className="lt-qr-note-display">{deliveryAddress}</dd></div>}
              <div><dt>Items</dt><dd>{count} {count === 1 ? 'item' : 'items'}</dd></div>
              {orderNote.trim() && <div><dt>Note</dt><dd className="lt-qr-note-display">{orderNote.trim()}</dd></div>}
            </dl>
            <ul className="lt-qr-cart-lines is-compact" aria-label="Items in your order">{cart.map(line => <CartLine key={line.key} line={line} money={money} />)}</ul>
            <dl className="lt-qr-totals">
              <div><dt>Subtotal</dt><dd>{money(total)}</dd></div>
              {service === 'delivery' && <div><dt>Delivery fee</dt><dd>Not calculated yet</dd></div>}
              <div className="is-total"><dt>{service === 'delivery' ? 'Items total' : 'Total'}</dt><dd>{money(total)}</dd></div>
            </dl>
            {!isOnlinePreview && <CheckoutRewards snapshot={checkoutRewards} loading={rewardsLoading} error={rewardsError}
              paymentMethod={paymentMethod} selectedReward={selectedReward} disabled={submitting}
              onSelect={choice => { setSelectedReward(choice); pendingIds.current = null; setSubmitError('') }} />}
            <fieldset className="lt-qr-pay-methods">
              <legend>How will you pay?</legend>
              {Object.entries({ ...(!isOnlinePreview ? {cash: PAYMENT_METHODS.cash} : {}), card: { label: 'Card · TEST', detail: 'Not available for live payment yet' }, qrph: { label: 'QRPH · TEST', detail: 'Not available for live payment yet' } }).map(([value, method]) => <label key={value} className={paymentMethod === value ? 'is-on' : ''}>
                <input type="radio" name="lt-qr-payment" value={value} checked={paymentMethod === value} disabled={submitting || (!isOnlinePreview && value !== 'cash')} onChange={() => { setPaymentMethod(value); if (value !== 'cash') setSelectedReward(null); pendingIds.current = null; setSubmitError('') }} />
                <span><strong>{method.label}</strong><small>{method.detail}</small></span>
              </label>)}
            </fieldset>
            {isOnlinePreview ? <div className="lt-v20-preview-note" role="status"><strong>Card and QRPH only</strong><small>No cash payment for pickup or delivery. This is a preview; payment and order submission are disabled.</small></div> : paymentMethod === 'cash'
              ? <div className="lt-qr-cash-notice" role="alert"><span className="lt-qr-cash-icon" aria-hidden="true">!</span><p><strong>Pay at the counter first.</strong> Your order will be prepared only after the cashier confirms your payment.</p></div>
              : paymentMethod && <p className="lt-qr-test-note">Card and QRPH are in test mode and unavailable for live checkout.</p>}
          </div>}

          {step === 'done' && order && <div className={`lt-qr-receipt${phase?.awaitingPayment ? ' is-waiting' : ''}`} role="status">
            {phase?.done
              ? <span className="lt-qr-receipt-check" aria-hidden="true"><CheckIcon size={34} /></span>
              : <span className={`lt-qr-track-badge${phase?.cancelled ? ' is-cancelled' : phase?.awaitingPayment ? ' is-payment-waiting' : ''}`}><span aria-hidden="true">{phase?.cancelled ? '!' : '◷'}</span> {phase?.title}</span>}
            <h3 aria-live="polite">{phase?.title}</h3>
            <p className="lt-qr-receipt-sub">{phase?.sub}</p>
            {!phase?.cancelled && <ol className="lt-qr-tracker" aria-label="Live order progress">
              {ORDER_TRACKING_STEPS.map((label, index) => <li key={label}
                className={index < phase.stage ? 'is-complete' : index === phase.stage ? 'is-current' : ''}
                aria-current={index === phase.stage ? 'step' : undefined}>
                <span className="lt-qr-tracker-dot" aria-hidden="true">{index < phase.stage || (phase.done && index === phase.stage) ? '✓' : index + 1}</span>
                <strong>{label}</strong>
              </li>)}
            </ol>}
            {trackingError && <p className="lt-qr-tracking-error" role="status">{trackingError}</p>}
            <div className="lt-qr-receipt-number">
              <span>Order number</span>
              <strong>{order.order_number}</strong>
              <button type="button" className="lt-qr-text-button" onClick={() => copyOrderNumber(order.order_number)}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <dl className="lt-qr-summary">
              {order.payment_reference && <div><dt>Payment reference</dt><dd>{order.payment_reference}</dd></div>}
              {order.branch_name && branches.length > 1 && <div><dt>Branch</dt><dd>{order.branch_name}</dd></div>}
              <div><dt>Order type</dt><dd>{serviceLine(order.service, order.table_no, order.pickup_label)}</dd></div>
              {order.buyer_name && <div><dt>Name</dt><dd>{order.buyer_name}</dd></div>}
              {order.customer_note && <div><dt>Note</dt><dd className="lt-qr-note-display">{order.customer_note}</dd></div>}
              <div><dt>Payment</dt><dd><span className={`lt-qr-paid-pill${order.payment_method === 'cash' && order.payment_status !== 'paid' ? ' is-unpaid' : ''}`}>{order.payment_method === 'cash' && order.payment_status === 'paid' ? 'Cash · Paid' : paymentReceiptLabel(order.payment_method)}</span></dd></div>
              {order.reward && <div><dt>Reward</dt><dd>🎁 {order.reward.name} ({phase?.cancelled ? 'not redeemed' : order.status === 'completed' ? 'redeemed' : 'reserved until paid and completed'})</dd></div>}
              {order.status === 'completed' && <div><dt>Loyalty</dt><dd>Check your connected Wallet card for the latest stamps or points.</dd></div>}
            </dl>
            <ul className="lt-qr-cart-lines is-compact" aria-label="Items ordered">{(order.lines || []).map(line => <CartLine key={line.key} line={line} money={money} />)}</ul>
            <dl className="lt-qr-totals"><div className="is-total"><dt>{order.payment_method === 'cash' && order.payment_status === 'paid' ? 'Order total' : receipt.totalLabel}</dt><dd>{money(order.subtotal)}</dd></div></dl>
            {order.status === 'completed' && <p className="lt-qr-complete-note">Thanks for ordering! Your receipt is saved on this device for up to 3 days. You can order again using the current menu.</p>}
            {order.status === 'completed' && <button type="button" className="lt-qr-privacy-clear" onClick={forgetLastOrder}>Forget this order on this device</button>}
          </div>}
        </div>

        <footer className="lt-qr-sheet-foot">
          {step === 'empty' && <button type="button" className="lt-qr-primary lt-qr-wide" onClick={closeCart}>Browse the menu</button>}
          {step === '' && <>
            <div className="lt-v19-cart-subtotal"><span>Subtotal</span><strong>{money(total)}</strong></div>
            <button type="button" className="lt-qr-primary lt-qr-wide lt-v19-checkout-cta" disabled={checkingCard || needsBranch} onClick={startCheckout}>{checkingCard ? 'One moment…' : 'Checkout'}{!checkingCard && <span aria-hidden="true">→</span>}</button>
          </>}
          {step === 'service' && <>
            <button type="button" className="lt-qr-primary lt-qr-wide" disabled={!detailsReady} onClick={() => { if (!detailsReady) return; setSubmitError(''); setPayStep('payment') }}>Continue to payment</button>
            <button type="button" className="lt-qr-back-button" onClick={() => setPayStep('')}>Back to cart</button>
          </>}
          {step === 'payment' && <>
            {submitError && <div className="lt-qr-pay-error" role="alert">
              <p><strong>Order not sent.</strong> {submitError}</p>
              <button type="button" onClick={submitOrder} disabled={submitting}>Try again</button>
            </div>}
            {isOnlinePreview ? <button type="button" className="lt-qr-primary lt-qr-wide" disabled>Online payment coming soon</button> : !submitError && <button type="button" className="lt-qr-primary lt-qr-wide" disabled={submitting || paymentMethod !== 'cash'} aria-busy={submitting} onClick={submitOrder}>{submitting ? <><span className="lt-qr-spinner" aria-hidden="true" />Sending order…</> : payButtonLabel(paymentMethod, money(total))}</button>}
            <button type="button" className="lt-qr-back-button" disabled={submitting} onClick={() => { setSubmitError(''); setPayStep('service') }}>Back</button>
          </>}
          {step === 'done' && <>{order?.status === 'completed' && <button type="button" className="lt-qr-primary lt-qr-wide" onClick={orderAgain}>Order again · review cart</button>}<button type="button" className={order?.status === 'completed' ? 'lt-qr-back-button' : 'lt-qr-primary lt-qr-wide'} onClick={closeCart}>Back to menu</button></>}
        </footer>
      </div>
    </CartOverlay>}
  </div>
}
function MenuLoading() {
  return <div className="lt-qr-public lt-qr-cafe">
    <main className="lt-qr-page lt-qr-loading" role="status" aria-live="polite">
      <span className="lt-qr-sr">Getting the menu ready…</span>
      <div className="lt-qr-cafe-head" aria-hidden="true"><div className="lt-qr-skel lt-qr-skel-title" /><div className="lt-qr-skel lt-qr-skel-search" /></div>
      <div className="lt-qr-cafe-split" aria-hidden="true">
        <div className="lt-qr-rail">{[0, 1, 2, 3].map(index => <div key={index} className="lt-qr-skel lt-qr-skel-rail" />)}</div>
        <div className="lt-qr-stream">{[0, 1, 2, 3].map(index => <div key={index} className="lt-qr-dish lt-qr-skel-card"><div className="lt-qr-skel lt-qr-skel-photo" /><div><div className="lt-qr-skel lt-qr-skel-line" /><div className="lt-qr-skel lt-qr-skel-line is-short" /></div></div>)}</div>
      </div>
    </main>
  </div>
}

export default function QRMenuPage({ API_BASE }) {
  const { businessId } = useParams()
  const [params, setParams] = useSearchParams()
  const branch = params.get('branch') || ''
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  // The catalog contains public availability for all active branches. A branch
  // switch reuses that one response; it never polls or starts customer ordering.
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setData(null); setError(''); window.scrollTo(0, 0)
    requestJsonResponse(fetch, `${API_BASE}/api/v1/public/menu/${encodeURIComponent(businessId)}`, { signal: controller.signal, cache: 'no-store' }, { message: 'The menu is taking too long to load. Please try again.' })
      .then(({response,payload:body}) => { if (!response.ok) throw new Error(response.status === 404 ? 'This menu is not available right now.' : 'We couldn’t load the menu. Please try again.'); if (!validMenuPayload(body)) throw new Error('We couldn’t load the menu. Please try again.'); return body })
      .then(value => { if(active)setData(value) }).catch(value => { if (active && value.name !== 'AbortError') setError(value.message) })
    return () => { active=false; controller.abort() }
  }, [API_BASE, businessId, attempt])
  useEffect(() => { if (data?.business?.name) document.title = `${data.business.name} · QR Menu | Loyalty Tree` }, [data?.business?.name])
  if (error) return <main className="lt-qr-message-page"><h1>Menu unavailable</h1><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></main>
  if (!data) return <MenuLoading />
  return <QRMenuBrowser data={data} apiBase={API_BASE} initialBranch={branch} onBranchChange={value => setParams(value ? { branch: value } : {})} />
}

import React, { useEffect, useId, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { filterMenuItems, groupMenuCategories, menuItemAvailable, menuItemPrice, toggleMenuOption, validMenuPayload, addCartItem, changeCartQuantity, cartSubtotal, buildMenuOrder, sendMenuOrder, pickupTimeLabel, resolveMenuBranch, PAYMENT_METHODS, paymentReceiptLabel } from './qrMenuModel'
import loyaltyTreeLogo from './logo-192.png'
import { requestJsonResponse } from './requestTimeout'
import './qr-menu.css'

function MenuItemPhoto({ item, available }) {
  const [failedSource, setFailedSource] = useState(null)
  return <div className="lt-qr-item-visual">
    {item.image_url && failedSource !== item.image_url ? <img className="lt-qr-item-photo" src={item.image_url} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(item.image_url)} /> : <div className="lt-qr-item-placeholder" aria-hidden="true"><span>{item.name.slice(0, 1)}</span></div>}
    {!available && <span className="lt-qr-item-badge">Sold out</span>}
  </div>
}

function ItemDetails({ item, available, money, onClose, onAdd }) {
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
        {group.options.map(option => <label key={option.public_id}><span><input type={group.selection_type === 'single' ? 'radio' : 'checkbox'} name={group.public_id} checked={(selected[group.public_id] || []).includes(option.public_id)} onChange={() => setSelected(current => toggleMenuOption(current, group, option.public_id))} />{option.name}</span><span>{option.price_delta ? `${option.price_delta > 0 ? '+' : '−'} ${money(Math.abs(option.price_delta))}` : 'Included'}</span></label>)}
        {selected[group.public_id]?.length > 0 && <button type="button" className="lt-qr-text-button" onClick={() => setSelected(current => ({ ...current, [group.public_id]: [] }))}>Clear selection</button>}
      </fieldset>)}
      <div className="lt-qr-detail-price"><span>Price with selected options</span><strong>{money(menuItemPrice(item, selected))}</strong></div>
      {available && <div className="lt-qr-qty"><button type="button" onClick={() => setQuantity(value => Math.max(1, value - 1))} aria-label="Decrease quantity">−</button><span>{quantity}</span><button type="button" onClick={() => setQuantity(value => Math.min(20, value + 1))} aria-label="Increase quantity">+</button></div>}
      <button type="button" className="lt-qr-primary" disabled={!available} onClick={() => { onAdd(item, selected, quantity); onClose() }}>{available ? 'Add to cart' : 'Sold out'}</button>
    </div>
  </dialog>
}


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

function CheckIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

const CHECKOUT_STEPS = [['', 'Cart'], ['service', 'Details'], ['payment', 'Pay']]

function serviceLine(service, tableNo, pickupLabel) {
  if (service === 'dine-in') return `Dine in${tableNo ? ` · Table ${tableNo}` : ''}`
  return `Pick up${pickupLabel ? ` · ${pickupLabel}` : ' later'}`
}

export function QRMenuBrowser({ data, preview = false, initialBranch, onBranchChange, apiBase = '' }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [requestedBranch, setRequestedBranch] = useState(initialBranch !== undefined ? initialBranch || '' : data.selected_branch || '')
  const [item, setItem] = useState(null)
  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  const [order, setOrder] = useState(null)
  const [payStep, setPayStep] = useState('')
  const [service, setService] = useState('dine-in')
  const [buyerName, setBuyerName] = useState('')
  const [cardName, setCardName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [tableNo, setTableNo] = useState('')
  const [pickupAt, setPickupAt] = useState('')
  const [slots, setSlots] = useState([])
  const [checkingCard, setCheckingCard] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [copied, setCopied] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('')
  const submittingRef = useRef(false)
  // One order number + payment reference per checkout. A retry after a failed
  // save reuses them so the shop never gets two different orders for one tap.
  const pendingIds = useRef(null)
  const sheetRef = useRef(null)
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
  const items = filterMenuItems(catalog, 'all', search)
  const categoryName = Object.fromEntries(groups.flatMap(value => value.items.map(entry => [entry.public_id, value.name])))
  const chooseCategory = id => { focusHeading.current = true; setCategory(id) }
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  const total = cartSubtotal(cart)
  const pickupLabel = slots.find(slot => slot.value === pickupAt)?.label || ''
  const updateCart = change => { pendingIds.current = null; setSubmitError(''); setCart(change) }
  const addItem = (value, selected = {}, quantity = 1) => {
    if (needsBranch || !menuItemAvailable(value, branchId)) return
    updateCart(current => addCartItem(current, value, selected, quantity))
    setOrder(null)
  }
  const changeLine = (key, quantity) => updateCart(current => changeCartQuantity(current, key, quantity))

  const openCart = () => { setOrder(null); setPayStep(''); setSubmitError(''); setCartOpen(true) }
  const closeCart = () => {
    if (submittingRef.current) return
    setCartOpen(false); setSubmitError(''); setCopied(false)
    if (payStep === 'done') { setOrder(null); setPayStep('') }
    else if (!cart.length) setPayStep('')
  }

  // Focus the sheet when it opens, trap Tab inside it, and give focus back.
  useEffect(() => {
    if (!cartOpen) return undefined
    let previous = ''
    if (!preview) { previous = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    return () => {
      if (!preview) document.body.style.overflow = previous
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

  const startCheckout = async () => {
    if (!cart.length || checkingCard || needsBranch) return
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
        }
      } catch { /* the saved name is optional; keep the stored one */ }
    }
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
    if (!PAYMENT_METHODS[paymentMethod]) { setSubmitError('Choose how you’ll pay.'); return }
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
    setOrder({ ...placedOrder, order_number: saved.order_number || placedOrder.order_id, server_order_id: saved.public_id || '', status: saved.status || 'new' })
    pendingIds.current = null
    setCopied(false)
    setCart([])
    setPayStep('done')
  }

  const copyOrderNumber = async value => {
    try { await navigator.clipboard.writeText(value); setCopied(true) } catch { setCopied(false) }
  }

  const step = payStep === 'done' ? 'done' : !cart.length ? 'empty' : payStep
  const title = step === 'done' ? 'Order sent' : step === 'service' ? 'How will you get it?' : step === 'payment' ? 'Review & pay' : 'Your order'
  const stepIndex = CHECKOUT_STEPS.findIndex(([value]) => value === payStep)
  const nameFromCard = cardName && buyerName.trim() === cardName && !editingName
  // No connected card: the shop needs a name to call the order.
  const nameRequired = !cardName
  const detailsReady = !(service === 'pickup' && !pickupAt) && !(nameRequired && !buyerName.trim())
  const connectedCard = value => {
    const name = value?.name && value.name !== 'Loyalty card' ? value.name : ''
    if (!name) return
    try { localStorage.setItem(`lt-menu-card-name:${business.public_id}`, name) } catch { /* storage is optional */ }
    setCardName(name)
    setEditingName(false)
    setBuyerName(name)
  }

  return <div className={`lt-qr-public lt-qr-cafe${preview ? ' lt-qr-is-preview' : ''}${count ? ' lt-qr-has-cart' : ''}`}>
    <main className="lt-qr-page">
      {preview && <div className="lt-qr-preview-note">Owner preview · {data.is_published ? 'Published' : 'Not published'}</div>}
      <header className="lt-qr-cafe-head">
        <div className="lt-qr-cafe-title">
          {business.logo_url && <img className="lt-qr-cafe-logo" src={business.logo_url} alt="" />}
          <h1>{business.name}</h1>
          <div className="lt-qr-cafe-side">{showSelector && <label className="lt-qr-branch-drop"><select aria-label="Branch" value={branchId} onChange={event => chooseBranch(event.target.value)}>{!branchId && <option value="" disabled>Choose branch</option>}{branches.map(value => <option key={value.public_id} value={value.public_id}>{value.name}</option>)}</select></label>}{apiBase ? <MenuCardLink apiBase={apiBase} business={business} /> : business.join_url && <a className="lt-qr-card-link" href={business.join_url}>Connect loyalty card</a>}</div>
        </div>
        {(data.actions || []).length > 0 && <div className="lt-qr-cafe-actions">{data.actions.map(action => <a key={action.id} href={action.url} target="_blank" rel="noreferrer" className={action.id === 'book' ? 'is-book' : ''}><strong>{action.label}</strong>{action.note ? <span>{action.note}</span> : null}</a>)}</div>}
        <label className="lt-qr-cafe-search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M16.5 16.5 L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input type="search" aria-label="Search menu" placeholder="Search the menu" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </header>
      {needsBranch && <section className="lt-qr-branch-picker" aria-labelledby="lt-qr-branch-picker-title">
        <h2 id="lt-qr-branch-picker-title">Choose your branch</h2>
        <p>{invalidBranch ? 'That branch is no longer available. Pick where you’re ordering from.' : 'Pick where you’re ordering from to see the menu and order.'}</p>
        <ul>{branches.map(value => <li key={value.public_id}><button type="button" onClick={() => chooseBranch(value.public_id)}><span className="lt-qr-branch-picker-copy"><strong>{value.name}</strong>{value.address && <span>{value.address}</span>}</span><i aria-hidden="true">›</i></button></li>)}</ul>
      </section>}
      {!needsBranch && <div className="lt-qr-cafe-split">
        <nav className="lt-qr-rail" aria-label="Menu categories">
          <button type="button" aria-pressed={category === 'all'} onClick={() => chooseCategory('all')}><strong>All</strong><span>{groups.reduce((sum, value) => sum + value.items.length, 0)}</span></button>
          {groups.map(value => <button type="button" key={value.public_id} aria-pressed={category === value.public_id} onClick={() => chooseCategory(value.public_id)}><strong>{value.name}</strong><span>{value.items.length}</span></button>)}
        </nav>
        <section className="lt-qr-stream" aria-label="Menu items">
          <h2 className="lt-qr-sr" ref={menuHeading} tabIndex={-1}>{search.trim() ? 'Search results' : selectedCategory?.name || 'All items'}</h2>
          {items.map(value => {
            const available = menuItemAvailable(value, branchId)
            const canAdd = available && !(value.modifier_groups || []).length
            const line = cart.find(entry => entry.key === `${value.public_id}|`)
            return <article key={value.public_id} className={`lt-qr-dish${line ? ' is-in' : ''}${available ? '' : ' is-sold'}`}>
              <div className="lt-qr-dish-top">
                <button type="button" className="lt-qr-dish-photo" onClick={() => setItem(value)} aria-label={`View ${value.name}${available ? '' : ', sold out'}`}>
                  <MenuItemPhoto item={value} available={available} />
                </button>
                <div className="lt-qr-dish-copy">
                  <p className="lt-qr-dish-cat">{categoryName[value.public_id] || 'Menu'}</p>
                  <h3>{value.name}</h3>
                  {value.description && <p>{value.description}</p>}
                </div>
              </div>
              <div className="lt-qr-dish-row">
                <div><span>Price</span><strong>{money(value.base_price)}</strong></div>
                {canAdd && line ? <div className="lt-qr-step"><button type="button" onClick={() => changeLine(line.key, line.quantity - 1)} aria-label={`Decrease ${value.name}`}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeLine(line.key, line.quantity + 1)} aria-label={`Increase ${value.name}`}>+</button></div>
                  : canAdd ? <button type="button" className="lt-qr-add-pill" onClick={() => addItem(value)} aria-label={`Add ${value.name}`}>+ Add</button>
                  : available ? <button type="button" className="lt-qr-add-pill" onClick={() => setItem(value)} aria-label={`Choose options for ${value.name}`}>Choose</button>
                  : <span className="lt-qr-sold-pill">Sold out</span>}
              </div>
            </article>
          })}
          {!items.length && <div className="lt-qr-empty" role="status"><h3>{search ? 'No matches yet.' : 'Nothing in this category.'}</h3><p>{search ? 'Try another word.' : 'Check another category.'}</p></div>}
        </section>
      </div>}
      <footer className="lt-qr-footer"><img src={loyaltyTreeLogo} alt="" /><span>Menu by <strong>Loyalty Tree</strong></span></footer>
    </main>
    {item && <ItemDetails key={item.public_id} item={item} available={menuItemAvailable(item, branchId)} money={money} onClose={() => setItem(null)} onAdd={addItem} />}
    {count > 0 && !cartOpen && !needsBranch && <div className="lt-qr-dock">
      <button type="button" ref={dockRef} className="lt-qr-dock-card" onClick={openCart} aria-label={`View cart, ${count} ${count === 1 ? 'item' : 'items'}, ${money(total)}`}>
        <span className="lt-qr-dock-count" aria-hidden="true">{count}</span>
        <span className="lt-qr-dock-label" aria-hidden="true">View cart<small>{count} {count === 1 ? 'item' : 'items'}</small></span>
        <strong aria-hidden="true">{money(total)}</strong>
      </button>
    </div>}
    {cartOpen && <div className="lt-qr-cart" onMouseDown={event => { if (event.target === event.currentTarget) closeCart() }}>
      <div className="lt-qr-cart-card" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={sheetTitleId} onKeyDown={onSheetKeyDown}>
        <header className="lt-qr-sheet-head">
          <div>
            <h2 id={sheetTitleId} tabIndex={-1}>{title}</h2>
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
            <div className="lt-qr-pay-choices" role="group" aria-label="How will you get it?">
              <button type="button" aria-pressed={service === 'dine-in'} onClick={() => setService('dine-in')}>{service === 'dine-in' && <CheckIcon />}Dine in</button>
              <button type="button" aria-pressed={service === 'pickup'} onClick={() => { setService('pickup'); if (!slots.length) setSlots(pickupSlots()) }}>{service === 'pickup' && <CheckIcon />}Pick up later</button>
            </div>
            {service === 'dine-in'
              ? <label className="lt-qr-field"><span>Table number <em>optional</em></span><input inputMode="numeric" autoComplete="off" placeholder="e.g. 5" value={tableNo} onChange={event => setTableNo(event.target.value.slice(0, 12))} /></label>
              : <label className="lt-qr-field"><span>Pick up time</span><select value={pickupAt} onChange={event => setPickupAt(event.target.value)}><option value="">Choose a time</option>{slots.map(slot => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select>{!pickupAt && <small className="lt-qr-field-help">Choose a pick up time to continue.</small>}</label>}
            {nameFromCard
              ? <div className="lt-qr-name-row"><span>Name: <strong>{cardName}</strong></span><button type="button" className="lt-qr-text-button" onClick={() => setEditingName(true)}>Change</button></div>
              : <label className="lt-qr-field"><span>{nameRequired ? <>Your name <b className="lt-qr-required" aria-hidden="true">*</b></> : <>Your name <em>optional</em></>}</span><input autoComplete="name" required={nameRequired} aria-required={nameRequired} aria-describedby={nameRequired ? `${sheetTitleId}-name-help` : undefined} placeholder="Name for your order" value={buyerName} onChange={event => setBuyerName(event.target.value.slice(0, 120))} />{nameRequired && <small id={`${sheetTitleId}-name-help`} className="lt-qr-field-help is-neutral">So the shop can call your order.</small>}</label>}
            {!cardName && (apiBase || business.join_url) && <div className="lt-qr-card-promo">
              <p><strong>Have a LoyaltyTree card?</strong> Connect it to earn rewards on this order.</p>
              {apiBase
                ? <MenuCardLink apiBase={apiBase} business={business} label="Connect card" className="lt-qr-card-promo-button" onConnected={connectedCard} />
                : <a className="lt-qr-card-promo-button" href={business.join_url}>Connect card</a>}
            </div>}
            <ul className="lt-qr-cart-lines is-compact" aria-label="Items in your order">{cart.map(line => <CartLine key={line.key} line={line} money={money} />)}</ul>
          </div>}

          {step === 'payment' && <div className="lt-qr-pay">
            <dl className="lt-qr-summary">
              {branch && branches.length > 1 && <div><dt>Branch</dt><dd>{branch.name}</dd></div>}
              <div><dt>Order type</dt><dd>{serviceLine(service, tableNo.trim(), pickupLabel)}</dd></div>
              <div><dt>Name</dt><dd>{buyerName.trim() || '—'}</dd></div>
              <div><dt>Items</dt><dd>{count} {count === 1 ? 'item' : 'items'}</dd></div>
            </dl>
            <ul className="lt-qr-cart-lines is-compact" aria-label="Items in your order">{cart.map(line => <CartLine key={line.key} line={line} money={money} />)}</ul>
            <dl className="lt-qr-totals">
              <div><dt>Subtotal</dt><dd>{money(total)}</dd></div>
              <div className="is-total"><dt>Total</dt><dd>{money(total)}</dd></div>
            </dl>
            <fieldset className="lt-qr-pay-methods">
              <legend>How will you pay?</legend>
              {Object.entries(PAYMENT_METHODS).map(([value, method]) => <label key={value} className={paymentMethod === value ? 'is-on' : ''}>
                <input type="radio" name="lt-qr-payment" value={value} checked={paymentMethod === value} disabled={submitting} onChange={() => { setPaymentMethod(value); setSubmitError('') }} />
                <span><strong>{method.label}</strong><small>{method.detail}</small></span>
              </label>)}
            </fieldset>
            <p className="lt-qr-test-note">{paymentMethod === 'cash' ? 'Your order will be sent to the shop. Pay at the counter.' : 'Test payment. Nothing is charged. Your order will be sent to the shop.'}</p>
          </div>}

          {step === 'done' && order && <div className="lt-qr-receipt" role="status">
            <span className="lt-qr-receipt-check" aria-hidden="true"><CheckIcon size={34} /></span>
            <h3>Order sent to {business.name}</h3>
            <p className="lt-qr-receipt-sub">{order.payment_method === 'cash' ? 'The shop has received your order. Pay at the counter.' : 'The shop has received your order.'}</p>
            <div className="lt-qr-receipt-number">
              <span>Order number</span>
              <strong>{order.order_number}</strong>
              <button type="button" className="lt-qr-text-button" onClick={() => copyOrderNumber(order.order_number)}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <dl className="lt-qr-summary">
              <div><dt>Payment reference</dt><dd>{order.payment_reference}</dd></div>
              {order.branch_name && branches.length > 1 && <div><dt>Branch</dt><dd>{order.branch_name}</dd></div>}
              <div><dt>Order type</dt><dd>{serviceLine(order.service, order.table_no, order.pickup_label)}</dd></div>
              <div><dt>Name</dt><dd>{order.buyer_name || '—'}</dd></div>
              <div><dt>Payment</dt><dd><span className={`lt-qr-paid-pill${order.payment_method === 'cash' ? ' is-unpaid' : ''}`}>{paymentReceiptLabel(order.payment_method)}</span></dd></div>
            </dl>
            <ul className="lt-qr-cart-lines is-compact" aria-label="Items ordered">{(order.lines || []).map(line => <CartLine key={line.key} line={line} money={money} />)}</ul>
            <dl className="lt-qr-totals"><div className="is-total"><dt>Total paid</dt><dd>{money(order.subtotal)}</dd></div></dl>
          </div>}
        </div>

        <footer className="lt-qr-sheet-foot">
          {step === 'empty' && <button type="button" className="lt-qr-primary lt-qr-wide" onClick={closeCart}>Browse the menu</button>}
          {step === '' && <button type="button" className="lt-qr-primary lt-qr-wide" disabled={checkingCard || needsBranch} onClick={startCheckout}>{checkingCard ? 'One moment…' : `Checkout · ${money(total)}`}</button>}
          {step === 'service' && <>
            <button type="button" className="lt-qr-primary lt-qr-wide" disabled={!detailsReady} onClick={() => { if (!detailsReady) return; setSubmitError(''); setPayStep('payment') }}>Continue to payment</button>
            <button type="button" className="lt-qr-back-button" onClick={() => setPayStep('')}>Back to cart</button>
          </>}
          {step === 'payment' && <>
            {submitError && <div className="lt-qr-pay-error" role="alert">
              <p><strong>Order not sent.</strong> {submitError}</p>
              <button type="button" onClick={submitOrder} disabled={submitting}>Try again</button>
            </div>}
            {!submitError && <button type="button" className="lt-qr-primary lt-qr-wide" disabled={submitting || !paymentMethod} aria-busy={submitting} onClick={submitOrder}>{submitting ? <><span className="lt-qr-spinner" aria-hidden="true" />Sending order…</> : !paymentMethod ? 'Choose how you’ll pay' : paymentMethod === 'cash' ? `Place order · ${money(total)}` : `Pay ${money(total)} (test)`}</button>}
            <button type="button" className="lt-qr-back-button" disabled={submitting} onClick={() => { setSubmitError(''); setPayStep('service') }}>Back</button>
          </>}
          {step === 'done' && <button type="button" className="lt-qr-primary lt-qr-wide" onClick={closeCart}>Back to menu</button>}
        </footer>
      </div>
    </div>}
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

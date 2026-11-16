import React, { useEffect, useId, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { filterMenuItems, groupMenuCategories, menuItemAvailable, menuItemPrice, toggleMenuOption, validMenuPayload, addCartItem, changeCartQuantity, cartSubtotal, buildMenuOrder } from './qrMenuModel'
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


function MenuCardLink({ apiBase, business }) {
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
      .catch(() => { try { localStorage.removeItem(storageKey) } catch { /* ignore */ } })
    return () => { active = false }
  }, [apiBase, business.public_id, storageKey])
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
        try { localStorage.setItem(storageKey, result.token) } catch { /* ignore */ }
        setCard({ name: result.name, email_masked: result.email_masked })
        setOpen(false)
      }
    } catch (error) { setNote(error.message) }
    finally { setBusy(false) }
  }
  const forget = () => {
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    setCard(null); setChallenge(''); setCode(''); setNote('')
  }
  return <>
    <button type="button" className="lt-qr-card-link" onClick={() => setOpen(true)}>{card ? `Connected · ${card.name.split(' ')[0]}` : 'Connect card'}</button>
    {open && React.createPortal(<div className="lt-qr-card-pop" onClick={() => setOpen(false)}>
      <form className="lt-qr-card-pop-card" role="dialog" aria-label="Connect loyalty card" onClick={event => event.stopPropagation()} onSubmit={submit}>
        <button type="button" className="lt-qr-card-pop-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <h2>{card ? 'Card connected' : 'Connect card'}</h2>
        {card ? <><p>{card.name}<br />{card.email_masked}</p><button type="button" className="lt-qr-card-link" onClick={forget}>Use another email</button></>
          : !challenge ? <><input type="email" aria-label="Email" autoComplete="email" required placeholder="Email on your card" value={email} onChange={event => setEmail(event.target.value)} /><button className="lt-qr-card-link" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>{business.join_url && <a href={business.join_url}>No card yet? Join</a>}</>
          : <><input inputMode="numeric" aria-label="Code" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="6-digit code" value={code} onChange={event => setCode(event.target.value)} /><button className="lt-qr-card-link" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button></>}
        {note && <p role="status">{note}</p>}
      </form>
    </div>, document.body)}
  </>
}

export function QRMenuBrowser({ data, preview = false, initialBranch, onBranchChange, apiBase = '' }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState(initialBranch || data.selected_branch || '')
  const [item, setItem] = useState(null)
  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  const [order, setOrder] = useState(null)
  const menuHeading = useRef(null)
  const focusHeading = useRef(false)
  const business = data.business
  const branches = data.branches || []
  const branch = branches.find(value => value.public_id === branchId)
  const chooseBranch = id => { setBranchId(id); setItem(null); onBranchChange?.(id) }
  useEffect(() => { if (initialBranch !== undefined) setBranchId(initialBranch || data.selected_branch || '') }, [initialBranch, data.selected_branch])
  useEffect(() => { if (focusHeading.current) { menuHeading.current?.focus({ preventScroll: true }); focusHeading.current = false } }, [category, search])
  const money = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: business.currency || 'PHP' }).format(value)
  const groups = groupMenuCategories(data.categories || [], data.items || [], branchId)
  const selectedCategory = groups.find(value => value.public_id === category)
  const catalog = category && category !== 'all' ? selectedCategory?.items || [] : groups.flatMap(value => value.items)
  const items = filterMenuItems(catalog, 'all', search)
  const categoryName = Object.fromEntries(groups.flatMap(value => value.items.map(entry => [entry.public_id, value.name])))
  const chooseCategory = id => { focusHeading.current = true; setCategory(id) }
  const count = cart.reduce((sum, line) => sum + line.quantity, 0)
  const total = cartSubtotal(cart)
  const addItem = (value, selected = {}, quantity = 1) => {
    if (!menuItemAvailable(value, branchId)) return
    setCart(current => addCartItem(current, value, selected, quantity))
    setOrder(null)
  }
  return <div className={`lt-qr-public lt-qr-cafe${preview ? ' lt-qr-is-preview' : ''}${count ? ' lt-qr-has-cart' : ''}`}>
    <main className="lt-qr-page">
      {preview && <div className="lt-qr-preview-note">Owner preview · {data.is_published ? 'Published' : 'Not published'}</div>}
      <header className="lt-qr-cafe-head">
        <div className="lt-qr-cafe-title">
          {business.logo_url && <img className="lt-qr-cafe-logo" src={business.logo_url} alt="" />}
          <h1>{business.name}</h1>
          <div className="lt-qr-cafe-side">{branches.length > 1 && <label className="lt-qr-branch-drop"><select aria-label="Branch" value={branchId} onChange={event => chooseBranch(event.target.value)}><option value="">All branches</option>{branches.map(value => <option key={value.public_id} value={value.public_id}>{value.name}</option>)}</select></label>}{apiBase ? <MenuCardLink apiBase={apiBase} business={business} /> : business.join_url && <a className="lt-qr-card-link" href={business.join_url}>Connect loyalty card</a>}</div>
        </div>
        {(data.actions || []).length > 0 && <div className="lt-qr-cafe-actions">{data.actions.map(action => <a key={action.id} href={action.url} target="_blank" rel="noreferrer" className={action.id === 'book' ? 'is-book' : ''}><strong>{action.label}</strong>{action.note ? <span>{action.note}</span> : null}</a>)}</div>}
        <label className="lt-qr-cafe-search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M16.5 16.5 L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <input type="search" aria-label="Search menu" placeholder="Search the menu" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </header>
      <div className="lt-qr-cafe-split">
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
                {canAdd && line ? <div className="lt-qr-step"><button type="button" onClick={() => setCart(current => changeCartQuantity(current, line.key, line.quantity - 1))} aria-label={`Decrease ${value.name}`}>−</button><span>{line.quantity}</span><button type="button" onClick={() => setCart(current => changeCartQuantity(current, line.key, line.quantity + 1))} aria-label={`Increase ${value.name}`}>+</button></div>
                  : canAdd ? <button type="button" className="lt-qr-add-pill" onClick={() => addItem(value)}>+ Add</button>
                  : <button type="button" className="lt-qr-add-pill" disabled={!available} onClick={() => available && setItem(value)}>{available ? 'Choose' : 'Sold out'}</button>}
              </div>
            </article>
          })}
          {!items.length && <div className="lt-qr-empty" role="status"><h3>{search ? 'No matches yet.' : 'Nothing in this category.'}</h3><p>{search ? 'Try another word.' : 'Check another category.'}</p></div>}
        </section>
      </div>
      <footer className="lt-qr-footer"><img src={loyaltyTreeLogo} alt="" /><span>Menu by <strong>Loyalty Tree</strong></span></footer>
    </main>
    {item && <ItemDetails key={item.public_id} item={item} available={menuItemAvailable(item, branchId)} money={money} onClose={() => setItem(null)} onAdd={addItem} />}
    {count > 0 && <div className="lt-qr-dock"><div className="lt-qr-dock-card"><div className="lt-qr-dock-count" aria-hidden="true">{count}</div><div><span>{count} {count === 1 ? 'item' : 'items'}</span><strong>{money(total)}</strong></div><button type="button" onClick={() => setCartOpen(true)}>Review & Pay</button></div></div>}
    {cartOpen && <div className="lt-qr-cart" role="dialog" aria-label="Your cart">
      <div className="lt-qr-cart-card">
        <div className="lt-qr-cart-head"><h2>Your cart</h2><button type="button" onClick={() => { setCartOpen(false); setOrder(null) }} aria-label="Close cart">×</button></div>
        {cart.map(line => <div className="lt-qr-cart-line" key={line.key}><div><strong>{line.name}</strong>{line.options.length > 0 && <p>{line.options.map(option => option.name).join(', ')}</p>}<span>{money(line.unit_price * line.quantity)}</span></div><div className="lt-qr-qty"><button type="button" onClick={() => setCart(current => changeCartQuantity(current, line.key, line.quantity - 1))} aria-label={`Decrease ${line.name}`}>−</button><span>{line.quantity}</span><button type="button" onClick={() => setCart(current => changeCartQuantity(current, line.key, line.quantity + 1))} aria-label={`Increase ${line.name}`}>+</button></div></div>)}
        <div className="lt-qr-cart-total"><span>Total</span><strong>{money(total)}</strong></div>
        {!order ? <button type="button" className="lt-qr-primary" onClick={() => setOrder(buildMenuOrder({ merchantId: business.public_id, cart, orderId: `ord_${Date.now().toString(36)}` }))}>Checkout</button> : <div className="lt-qr-checkout" role="status"><strong>Payments coming soon</strong><p>This order is saved on this phone only. Nothing has been charged.</p><dl><div><dt>Order</dt><dd>{order.order_id}</dd></div><div><dt>Status</dt><dd>{order.status}</dd></div></dl></div>}
      </div>
    </div>}
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
  if (!data) return <main className="lt-qr-message-page" role="status"><p>Getting the menu ready…</p></main>
  if (branch && !data.branches.some(value => value.public_id === branch)) return <main className="lt-qr-message-page"><h1>Location unavailable</h1><p>This location is no longer available.</p><button type="button" onClick={() => setParams({})}>Choose another location</button></main>
  return <QRMenuBrowser data={data} apiBase={API_BASE} initialBranch={branch} onBranchChange={value => setParams(value ? { branch: value } : {})} />
}

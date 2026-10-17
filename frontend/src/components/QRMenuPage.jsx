import React, { useEffect, useId, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { filterMenuItems, menuItemAvailable, menuItemPrice, toggleMenuOption, validMenuPayload } from './qrMenuModel'
import loyaltyTreeLogo from './logo-192.png'
import './qr-menu.css'

function ItemDetails({ item, available, money, onClose }) {
  const dialog = useRef(null)
  const titleId = useId()
  const [selected, setSelected] = useState({})
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="lt-qr-sheet" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="lt-qr-sheet-content">
      <button type="button" className="lt-qr-close" onClick={onClose} aria-label="Close item details">×</button>
      {item.image_url && <img className="lt-qr-detail-photo" src={item.image_url} alt="" />}
      <p className="lt-qr-eyebrow">ON THE MENU</p><h2 id={titleId}>{item.name}</h2>
      {item.description && <p className="lt-qr-description">{item.description}</p>}
      {!available && <p className="lt-qr-sold-note">Currently sold out at this location.</p>}
      {(item.modifier_groups || []).map(group => <fieldset key={group.public_id} className="lt-qr-option-group">
        <legend>{group.name}</legend><p>{group.selection_type === 'single' ? 'Choose one to preview the price' : `Choose your options${group.max_selections > 0 ? ` · up to ${group.max_selections}` : ''}`}</p>
        {group.options.map(option => <label key={option.public_id}><span><input type={group.selection_type === 'single' ? 'radio' : 'checkbox'} name={group.public_id} checked={(selected[group.public_id] || []).includes(option.public_id)} onChange={() => setSelected(current => toggleMenuOption(current, group, option.public_id))} />{option.name}</span><span>{option.price_delta ? `${option.price_delta > 0 ? '+' : '−'} ${money(Math.abs(option.price_delta))}` : 'Included'}</span></label>)}
        {selected[group.public_id]?.length > 0 && <button type="button" className="lt-qr-text-button" onClick={() => setSelected(current => ({ ...current, [group.public_id]: [] }))}>Clear selection</button>}
      </fieldset>)}
      <div className="lt-qr-detail-price"><span>Price with selected options</span><strong>{money(menuItemPrice(item, selected))}</strong></div>
      <p className="lt-qr-browse-note">Browse the menu, then order with our team.</p>
      <button type="button" className="lt-qr-primary" onClick={onClose}>Back to menu</button>
    </div>
  </dialog>
}

export function QRMenuBrowser({ data, preview = false, initialBranch, onBranchChange }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState(initialBranch || data.selected_branch || '')
  const [item, setItem] = useState(null)
  const design = data.design || {}
  const business = data.business
  const branches = data.branches || []
  const branch = branches.find(value => value.public_id === branchId)
  const chooseBranch = id => { setBranchId(id); setItem(null); onBranchChange?.(id) }
  useEffect(() => { if (initialBranch !== undefined) setBranchId(initialBranch || data.selected_branch || '') }, [initialBranch, data.selected_branch])
  const money = value => new Intl.NumberFormat(undefined, { style: 'currency', currency: business.currency || 'PHP' }).format(value)
  const items = filterMenuItems(data.items || [], category, search)
  const theme = { '--qr-primary': design.primary_color || '#0f766e', '--qr-bg': design.background_color || '#f8faf8', '--qr-surface': design.surface_color || '#fff', '--qr-text': design.text_color || '#173f35', '--qr-muted': design.muted_color || '#64748b' }
  return <div className={`lt-qr-public${preview ? ' lt-qr-is-preview' : ''}`} style={theme}>
    <main className="lt-qr-page">
      {preview && <div className="lt-qr-preview-note">Owner preview · {data.is_published ? 'Published' : 'Not published'}</div>}
      {design.show_banner !== false && business.hero_url && <img className="lt-qr-hero" src={business.hero_url} alt="" />}
      <header className="lt-qr-brand">
        {business.logo_url ? <img className="lt-qr-logo" src={business.logo_url} alt="" style={{ borderRadius: design.logo_shape === 'circle' ? '50%' : design.logo_shape === 'square' ? 4 : 16 }} /> : <span className="lt-qr-monogram" aria-hidden="true">{business.name.slice(0, 1)}</span>}
        <div><p className="lt-qr-eyebrow">WELCOME TO OUR TABLE</p><h1>{business.name}</h1><p className="lt-qr-subtitle">Our menu{branch ? ` · ${branch.name}` : ''}</p></div>
      </header>
      {branches.length > 1 && <label className="lt-qr-branch-select">Location<select aria-label="Menu location" value={branchId} onChange={event => chooseBranch(event.target.value)}><option value="">Choose a location</option>{branches.map(value => <option key={value.public_id} value={value.public_id}>{value.name}</option>)}</select></label>}
      {branches.length > 1 && !branchId ? <section className="lt-qr-location-prompt"><h2>Find your local favorites.</h2><p>Choose a location to see its menu and availability.</p>{branches.map(value => <button type="button" key={value.public_id} onClick={() => chooseBranch(value.public_id)}><strong>{value.name}</strong><span>{value.address || 'View menu'} →</span></button>)}</section> : <>
        {branch?.address && <p className="lt-qr-address">{branch.address}</p>}
        <div className="lt-qr-browse-tools"><label className="lt-qr-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search menu" placeholder="Find something you’ll love" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <nav className={`lt-qr-categories lt-qr-categories-${design.category_style || 'pills'}`} aria-label="Menu categories">{[{ public_id: 'all', name: 'All' }, ...(data.categories || [])].map(value => <button type="button" key={value.public_id} aria-pressed={category === value.public_id} onClick={() => setCategory(value.public_id)}>{value.name}</button>)}</nav>
        </div>
        <div className="lt-qr-section-label"><h2>{category === 'all' ? 'A little of everything' : data.categories.find(value => value.public_id === category)?.name}</h2><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
        <div className={`lt-qr-items${design.product_layout === 'image_top' ? ' lt-qr-image-top' : design.product_layout === 'compact' ? ' lt-qr-compact' : ''}`}>{items.map(value => {
          const available = menuItemAvailable(value, branchId)
          return <button type="button" key={value.public_id} className={`lt-qr-item${available ? '' : ' is-sold'}`} onClick={() => setItem(value)} aria-label={`View ${value.name}${available ? '' : ', sold out'}`}>
            {value.image_url ? <img className="lt-qr-item-photo" src={value.image_url} alt="" loading="lazy" /> : <div className="lt-qr-item-placeholder" aria-hidden="true"><span>{value.name.slice(0, 1)}</span></div>}
            <div className="lt-qr-item-copy"><h3>{value.name}</h3>{design.show_product_description !== false && value.description && <p>{value.description}</p>}<div className="lt-qr-item-bottom"><strong>{money(value.base_price)}</strong><span>{available ? 'View details ↗' : 'Sold out'}</span></div></div>
          </button>
        })}</div>
        {!items.length && <div className="lt-qr-empty" role="status"><h3>{search ? 'No matches yet.' : 'More good things are coming.'}</h3><p>{search ? 'Try another search or category.' : 'Check back soon for menu updates.'}</p>{(search || category !== 'all') && <button type="button" className="lt-qr-text-button" onClick={() => { setSearch(''); setCategory('all') }}>Show all items</button>}</div>}
        <aside className="lt-qr-loyalty"><div><strong>A little loyalty goes a long way.</strong><p>Discover this business’s loyalty program.</p></div><a href={business.join_url}>Join Loyalty Tree →</a></aside>
      </>}
      <footer className="lt-qr-footer"><img src={loyaltyTreeLogo} alt="" /><span>Menu by <strong>Loyalty Tree</strong></span></footer>
    </main>
    {item && <ItemDetails key={item.public_id} item={item} available={menuItemAvailable(item, branchId)} money={money} onClose={() => setItem(null)} />}
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
    setData(null); setError(''); window.scrollTo(0, 0)
    fetch(`${API_BASE}/api/v1/public/menu/${encodeURIComponent(businessId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(response.status === 404 ? 'This menu is not available right now.' : 'We couldn’t load the menu. Please try again.'); if (!validMenuPayload(body)) throw new Error('We couldn’t load the menu. Please try again.'); return body })
      .then(setData).catch(value => { if (value.name !== 'AbortError') setError(value.message) })
    return () => controller.abort()
  }, [API_BASE, businessId, attempt])
  useEffect(() => { if (data?.business?.name) document.title = `${data.business.name} · QR Menu | Loyalty Tree` }, [data?.business?.name])
  if (error) return <main className="lt-qr-message-page"><h1>Menu unavailable</h1><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></main>
  if (!data) return <main className="lt-qr-message-page" role="status"><p>Getting the menu ready…</p></main>
  if (branch && !data.branches.some(value => value.public_id === branch)) return <main className="lt-qr-message-page"><h1>Location unavailable</h1><p>This location is no longer available.</p><button type="button" onClick={() => setParams({})}>Choose another location</button></main>
  return <QRMenuBrowser data={data} initialBranch={branch} onBranchChange={value => setParams(value ? { branch: value } : {})} />
}

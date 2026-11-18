import React, { useEffect, useState } from 'react'
import { currencySymbol, formatMoney } from './currency'

const STEP_TITLES = [
  'Where does this item go?',
  'Name and price',
  'Photo',
  'Options',
  'Where it shows',
]

function detailOf(data, fallback) {
  return typeof data?.detail === 'string' ? data.detail : fallback
}

function tintFor(name) {
  const text = String(name || 'Menu')
  const hues = ['#0f766e', '#115e59', '#1d4ed8', '#9a3412', '#7c3aed']
  const index = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % hues.length
  return hues[index]
}

export default function MenuItemGuide({
  API_BASE,
  slug,
  authFetch,
  currency = 'PHP',
  categories = [],
  branches = [],
  modifierGroups = [],
  isFirst = false,
  published = false,
  openAdd = false,
  showBack = false,
  onBack,
  onPreview,
  onReload,
  onChanged,
  setMessage,
}) {
  const [step, setStep] = useState(0)
  const [categoryId, setCategoryId] = useState('')
  const [newSection, setNewSection] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [optionName, setOptionName] = useState('')
  const [optionPrice, setOptionPrice] = useState('')
  const [hiddenBranches, setHiddenBranches] = useState([])
  const [shown, setShown] = useState(true)
  const [inStock, setInStock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(null)
  const [live, setLive] = useState(published)

  useEffect(() => { setLive(published) }, [published])
  useEffect(() => { if (openAdd) { setSaved(null); setStep(0); setError('') } }, [openAdd])

  const sectionName = newSection.trim() || categories.find(category => category.public_id === categoryId)?.name || ''
  const inherited = modifierGroups.filter(group => group.applies_to_all || (group.category_public_ids || []).includes(categoryId))
  const money = value => formatMoney(Number(value || 0), currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const symbol = currencySymbol(currency).trim()

  const send = async (url, method, body) => {
    const response = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(detailOf(data, 'Could not save'))
    return data
  }

  const createSection = async () => {
    const label = newSection.trim()
    const data = await send(`${API_BASE}/api/v1/business/${slug}/order-ahead/categories`, 'POST', {
      name: label,
      description: '',
      is_active: true,
      sort_order: categories.length,
    })
    const id = data.category?.public_id || ''
    if (!id) throw new Error('Could not save that section')
    await onReload?.()
    onChanged?.()
    return id
  }

  const uploadPhoto = async file => {
    if (!file || !slug) return
    setBusy(true)
    setError('')
    try {
      const ready = await authFetch(`${API_BASE}/api/v1/business/${slug}/cloudinary-signature?purpose=order_ahead_menu`, { method: 'POST' })
      const signature = await ready.json()
      if (!ready.ok) throw new Error(detailOf(signature, 'Could not prepare the photo'))
      const body = new FormData()
      body.append('file', file)
      body.append('api_key', signature.api_key)
      body.append('timestamp', signature.timestamp)
      body.append('signature', signature.signature)
      body.append('upload_preset', signature.upload_preset)
      body.append('folder', signature.folder)
      const uploaded = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloud_name}/image/upload`, { method: 'POST', body })
      const photo = await uploaded.json()
      if (!uploaded.ok) throw new Error(photo.error?.message || 'Photo upload failed')
      setImageUrl(photo.secure_url || photo.url || '')
    } catch (err) {
      setError(err.message || 'Photo upload failed')
    } finally {
      setBusy(false)
    }
  }

  const goNext = async () => {
    setError('')
    if (step === 0) {
      if (!newSection.trim() && !categoryId) {
        setError('Choose a section, or type a new one.')
        return
      }
      if (newSection.trim()) {
        setBusy(true)
        try {
          const id = await createSection()
          if (id) setCategoryId(id)
          setNewSection('')
          setStep(1)
        } catch (err) {
          setError(err.message || 'Could not add that section')
        } finally {
          setBusy(false)
        }
        return
      }
      setStep(1)
      return
    }
    if (step === 1) {
      const amount = Number(price)
      if (!name.trim()) { setError('Enter the item name.'); return }
      if (price === '' || Number.isNaN(amount) || amount < 0) { setError('Enter a price. Use 0 if it is free.'); return }
      setStep(2)
      return
    }
    if (step === 3 && optionPrice !== '' && Number(optionPrice) < 0) {
      setError('Option price cannot be negative.')
      return
    }
    setStep(current => Math.min(4, current + 1))
  }

  const saveItem = async () => {
    setError('')
    const amount = Number(price)
    if (!name.trim()) { setError('Enter the item name.'); setStep(1); return }
    if (price === '' || Number.isNaN(amount) || amount < 0) { setError('Enter a price. Use 0 if it is free.'); setStep(1); return }
    if (!categoryId && !sectionName) { setError('Choose a section first.'); setStep(0); return }
    setBusy(true)
    try {
      let sectionId = categoryId
      if (!sectionId && newSection.trim()) sectionId = await createSection()
      let groupId = ''
      const extra = optionName.trim()
      if (extra) {
        const group = await send(`${API_BASE}/api/v1/business/${slug}/order-ahead/modifier-groups`, 'POST', {
          name: extra,
          selection_type: 'single',
          is_required: false,
          min_selections: 0,
          max_selections: 1,
          is_active: true,
          applies_to_all: false,
          category_public_ids: [],
          sort_order: 0,
          options: [{ name: extra, price_delta: Number(optionPrice || 0), is_active: true, sort_order: 0 }],
        })
        groupId = group.modifier_group?.public_id || group.public_id || ''
        if (!groupId) throw new Error('Could not save that option')
      }
      await send(`${API_BASE}/api/v1/business/${slug}/order-ahead/items`, 'POST', {
        name: name.trim(),
        description: description.trim(),
        base_price: amount,
        category_public_id: sectionId || null,
        image_url: imageUrl,
        is_active: shown,
        is_available: inStock,
        modifier_group_public_ids: groupId ? [groupId] : [],
        excluded_inherited_modifier_group_public_ids: [],
        unavailable_branch_public_ids: hiddenBranches,
        sort_order: 0,
      })
      await onReload?.()
      onChanged?.()
      setSaved({ name: name.trim(), section: sectionName || 'the menu' })
      setMessage?.(`${name.trim()} added`)
    } catch (err) {
      setError(err.message || 'Could not add this item')
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    setBusy(true)
    setError('')
    try {
      await send(`${API_BASE}/api/v1/business/${slug}/qr-menu`, 'PUT', { is_published: true })
      setLive(true)
      onChanged?.()
      setMessage?.('Menu published')
    } catch (err) {
      setError(err.message || 'Could not publish the menu')
    } finally {
      setBusy(false)
    }
  }

  const addAnother = () => {
    setSaved(null)
    setName('')
    setPrice('')
    setDescription('')
    setImageUrl('')
    setOptionName('')
    setOptionPrice('')
    setShown(true)
    setInStock(true)
    setHiddenBranches([])
    setStep(1)
    setError('')
  }

  if (saved) {
    return (
      <section className="lt-mi" aria-label="Item added">
        {showBack && <button type="button" className="lt-mi-back" onClick={onBack}>Back to scan page</button>}
        <div className="lt-mi-done">
          <p className="lt-mi-kicker">Added</p>
          <h3>{saved.name}</h3>
          <p>{live
            ? `Added to ${saved.section}. It is live on the menu now.`
            : `Added to ${saved.section}. Customers will see it after you publish.`}</p>
        </div>
        {error && <p className="lt-mi-error" role="alert">{error}</p>}
        <div className="lt-mi-stack">
          <button type="button" className="lt-mi-next" onClick={addAnother}>Add another in {saved.section}</button>
          <button type="button" className="lt-mi-skip" onClick={onPreview}>Preview</button>
          {!live && <button type="button" className="lt-mi-skip" disabled={busy} onClick={publish}>{busy ? 'Publishing…' : 'Publish menu'}</button>}
        </div>
      </section>
    )
  }

  return (
    <section className="lt-mi" aria-label="Add menu item">
      <div className="lt-mi-top">
        <div>
          {showBack && <button type="button" className="lt-mi-back" onClick={onBack}>Back to scan page</button>}
          <p className="lt-mi-kicker">{isFirst ? 'Add your first item' : 'Add item'} · {step + 1} of 5</p>
          <h3>{STEP_TITLES[step]}</h3>
        </div>
      </div>
      <div className="lt-mi-bars" aria-hidden="true">
        {STEP_TITLES.map((title, index) => <span key={title} className={index <= step ? 'is-on' : ''} />)}
      </div>
      {error && <p className="lt-mi-error" role="alert">{error}</p>}

      <div className={step === 1 ? 'lt-mi-layout' : undefined}>
        <div>
          {step === 0 && (
            <>
              <p className="lt-mi-note">Pick the section customers will browse, like Coffee or Food. You can add a section here. You do not need the Categories tab.</p>
              {!!categories.length && (
                <div className="lt-mi-sections">
                  {categories.map(category => (
                    <button type="button" key={category.public_id} aria-pressed={categoryId === category.public_id && !newSection.trim()} onClick={() => { setCategoryId(category.public_id); setNewSection(''); setError('') }}>
                      {category.name}
                    </button>
                  ))}
                </div>
              )}
              <label>New section
                <input maxLength={40} value={newSection} placeholder="Coffee" onChange={event => { setNewSection(event.target.value); setError('') }} />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <p className="lt-mi-note">One line is enough. The card on the side is what customers will recognize.</p>
              <label>Item name
                <input maxLength={80} value={name} placeholder="Iced latte" onChange={event => setName(event.target.value)} />
              </label>
              <label>Price
                <span className="lt-mi-price"><i>{symbol}</i><input inputMode="decimal" type="number" min="0" step="0.01" placeholder="120.00" value={price} onChange={event => setPrice(event.target.value)} /></span>
              </label>
              <label>One-line description
                <input maxLength={80} value={description} placeholder="12 oz, less sweet" onChange={event => setDescription(event.target.value)} />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <p className="lt-mi-note">Optional. Square photos look best. Skip this and the section color is used.</p>
              <div className="lt-mi-photo">
                {imageUrl ? <img src={imageUrl} alt="" /> : <b style={{ background: tintFor(sectionName) }}>{(sectionName || 'M').slice(0, 1)}</b>}
                <div>
                  <label className="lt-mi-file">Add photo
                    <input type="file" accept="image/*" hidden disabled={busy} onChange={event => { uploadPhoto(event.target.files?.[0]); event.target.value = '' }} />
                  </label>
                  {imageUrl && <button type="button" className="lt-mi-remove" onClick={() => setImageUrl('')}>Remove</button>}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="lt-mi-note">Optional. Options already on this section stay attached. Add one more just for this item, like Large +{symbol}20.</p>
              {inherited.length
                ? <p className="lt-mi-inherit">From {sectionName || 'this section'}: {inherited.map(group => group.name).join(' · ')}</p>
                : <p className="lt-mi-inherit">This section has no shared options yet.</p>}
              <label>Option name
                <input maxLength={40} value={optionName} placeholder="Large" onChange={event => setOptionName(event.target.value)} />
              </label>
              <label>Extra price
                <span className="lt-mi-price"><i>+{symbol}</i><input inputMode="decimal" type="number" min="0" step="0.01" placeholder="20" value={optionPrice} onChange={event => setOptionPrice(event.target.value)} /></span>
              </label>
            </>
          )}

          {step === 4 && (
            <>
              <p className="lt-mi-note">Everything starts on. Turn off a branch, or hide the item, only if you need to.</p>
              <div className="lt-mi-checks">
                {branches.map(branch => (
                  <label key={branch.public_id}>
                    <input type="checkbox" checked={!hiddenBranches.includes(branch.public_id)} onChange={event => setHiddenBranches(current => event.target.checked ? current.filter(id => id !== branch.public_id) : [...current, branch.public_id])} />
                    {branch.name}
                  </label>
                ))}
                <label><input type="checkbox" checked={shown} onChange={event => setShown(event.target.checked)} />Show on QR menu</label>
                <label><input type="checkbox" checked={inStock} onChange={event => setInStock(event.target.checked)} />In stock now</label>
              </div>
            </>
          )}
        </div>

        {step === 1 && (
          <aside className="lt-mi-live" aria-label="Item preview">
            {imageUrl ? <img src={imageUrl} alt="" /> : <b style={{ background: tintFor(sectionName) }}>{(name || sectionName || 'M').slice(0, 1)}</b>}
            <div>
              <strong>{name || 'Item name'}</strong>
              <span>{sectionName || 'Section'}</span>
              <em>{price === '' ? `${symbol}0.00` : money(price)}</em>
              {description.trim() && <p>{description.trim()}</p>}
            </div>
          </aside>
        )}
      </div>

      <div className="lt-mi-actions">
        {step > 0 && <button type="button" className="lt-mi-skip" disabled={busy} onClick={() => { setError(''); setStep(current => current - 1) }}>Back</button>}
        {step === 2 && <button type="button" className="lt-mi-skip" disabled={busy} onClick={() => setStep(3)}>Skip</button>}
        {step === 3 && <button type="button" className="lt-mi-skip" disabled={busy} onClick={() => { setOptionName(''); setOptionPrice(''); setStep(4) }}>Skip</button>}
        {step < 4
          ? <button type="button" className="lt-mi-next" disabled={busy} onClick={goNext}>{busy ? 'Saving…' : 'Continue'}</button>
          : <button type="button" className="lt-mi-next" disabled={busy} onClick={saveItem}>{busy ? 'Saving…' : 'Add item to menu'}</button>}
      </div>
    </section>
  )
}

export function menuItemAvailable(item, branchId) {
  return item.is_available !== false && !(item.unavailable_branch_public_ids || []).includes(branchId)
}
export function filterMenuItems(items, category, search) {
  const needle = search.trim().toLocaleLowerCase()
  return items.filter(item => (category === 'all' || item.category_public_id === category) &&
    (!needle || `${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(needle)))
}
export function groupMenuCategories(categories, items, branchId) {
  const grouped = categories.map(category => {
    const members = items.filter(item => item.category_public_id === category.public_id)
    const photo = members.find(item => item.image_url && menuItemAvailable(item, branchId)) || members.find(item => item.image_url)
    return { ...category, items: members, image_url: photo?.image_url || '' }
  }).filter(category => category.items.length)
  if (!grouped.length) return []
  const knownIds = new Set(categories.map(category => category.public_id))
  const others = items.filter(item => !knownIds.has(item.category_public_id))
  if (others.length) grouped.push({ public_id: '__uncategorized__', name: 'More favorites', items: others, image_url: others.find(item => item.image_url)?.image_url || '' })
  return grouped
}
export function toggleMenuOption(selected, group, optionId) {
  if (!group.options.some(option => option.public_id === optionId)) return selected
  const current = selected[group.public_id] || []
  const next = current.includes(optionId) ? current.filter(id => id !== optionId) :
    group.selection_type === 'single' ? [optionId] :
    group.max_selections > 0 && current.length >= group.max_selections ? current : [...current, optionId]
  return { ...selected, [group.public_id]: next }
}
export function menuItemPrice(item, selected) {
  return Number(item.base_price || 0) + (item.modifier_groups || []).reduce((total, group) =>
    total + group.options.filter(option => (selected[group.public_id] || []).includes(option.public_id))
      .reduce((sum, option) => sum + Number(option.price_delta || 0), 0), 0)
}

export function validMenuPayload(value) {
  return Boolean(value?.business?.public_id && value.business.name && Array.isArray(value.items) && Array.isArray(value.categories) && Array.isArray(value.branches))
}

function lineKey(item, selected) {
  const options = (item.modifier_groups || []).flatMap(group =>
    group.options.filter(option => (selected[group.public_id] || []).includes(option.public_id)).map(option => option.public_id))
  return `${item.public_id}|${options.sort().join(',')}`
}

function lineOptions(item, selected) {
  return (item.modifier_groups || []).flatMap(group =>
    group.options.filter(option => (selected[group.public_id] || []).includes(option.public_id))
      .map(option => ({ public_id: option.public_id, name: option.name, price_delta: Number(option.price_delta || 0) })))
}

export function addCartItem(cart, item, selected = {}, quantity = 1) {
  if (!item?.public_id || !menuItemAvailable(item)) return cart
  const qty = Math.max(1, Math.min(20, Math.floor(Number(quantity) || 1)))
  const key = lineKey(item, selected)
  const current = cart.find(line => line.key === key)
  if (current) return cart.map(line => line.key === key ? { ...line, quantity: Math.min(20, line.quantity + qty) } : line)
  return [...cart, {
    key,
    item_id: item.public_id,
    name: item.name,
    unit_price: menuItemPrice(item, selected),
    quantity: qty,
    options: lineOptions(item, selected),
  }]
}

export function changeCartQuantity(cart, key, quantity) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty <= 0) return cart.filter(line => line.key !== key)
  return cart.map(line => line.key === key ? { ...line, quantity: Math.min(20, qty) } : line)
}

export function cartSubtotal(cart) {
  return (cart || []).reduce((sum, line) => sum + Number(line.unit_price || 0) * Number(line.quantity || 0), 0)
}

export function buildMenuOrder({ merchantId, cart, orderId }) {
  const items = (cart || []).map(line => ({
    item_id: line.item_id,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unit_price,
    line_total: Number(line.unit_price || 0) * Number(line.quantity || 0),
    options: line.options || [],
  }))
  return {
    order_id: orderId,
    merchant_id: merchantId,
    items,
    subtotal: cartSubtotal(cart),
    status: 'pending_payment',
  }
}

export function digitalMenuHref(config, slug) {
  if (config?.digital_menu_published !== true) return ''
  const id = String(config.public_id || slug || '').trim()
  return id ? `/menu/${encodeURIComponent(id)}` : ''
}

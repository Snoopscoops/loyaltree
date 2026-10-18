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

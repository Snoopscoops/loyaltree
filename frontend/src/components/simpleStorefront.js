// Presentation helpers only. The server remains authoritative for stock and price.
export function optionLimits(group) {
  const minimum = Math.max(0, Number(group.min_selections) || 0, group.is_required ? 1 : 0)
  const configured = Number(group.max_selections) || 0
  return { minimum, maximum: group.selection_type === 'single' ? 1 : configured > 0 ? configured : Infinity }
}
export function optionsComplete(item, selected = {}) {
  const groups = item?.modifier_groups || []
  if (!Array.isArray(groups) || !selected || typeof selected !== 'object') return false
  if (Object.keys(selected).some(key => !groups.some(g => g.public_id === key))) return false
  return groups.every(group => {
    const ids = selected[group.public_id] || []
    const {minimum, maximum} = optionLimits(group)
    return Array.isArray(ids) && new Set(ids).size === ids.length &&
      ids.length >= minimum && ids.length <= maximum &&
      Array.isArray(group.options) && ids.every(id => group.options.some(o => o.public_id === id && o.is_active !== false))
  })
}
export function storefrontShareUrl(businessId, branchId = '') {
  const path = 'https://theloyaltytree.com/menu/' + encodeURIComponent(String(businessId || ''))
  return branchId ? path + '?branch=' + encodeURIComponent(String(branchId)) : path
}
// Keep white text legible, even when a merchant has chosen a very light primary color.
export function storefrontAccent(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return '#234c39'
  const rgb = [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
  const linear = rgb.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4)
  const luminance=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722
  return 1.05/(luminance+.05)>=4.5?color:'#234c39'
}

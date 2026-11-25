export function tiktokUrl(value) {
  const text = String(value || '').trim()
  if (text.length > 300 || /[\s\\\x00-\x1f\x7f]/.test(text)) return ''
  return /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*tiktok\.com\/[^/?#].*$/i.test(text) ? text : ''
}

export function isTikTokLink(link) {
  return String(link?.label || '').trim().toLowerCase() === 'tiktok' || Boolean(tiktokUrl(link?.url))
}

export function findTikTokLink(links) {
  return (Array.isArray(links) ? links : []).find(link => isTikTokLink(link) && tiktokUrl(link?.url))
}

const FALLBACK_API_BASE = 'https://loyaltree-btw1.onrender.com'

const safeStorageGet = (storage, key) => {
  try { return storage.getItem(key) } catch (_) { return null }
}

const safeStorageSet = (storage, key, value) => {
  try { storage.setItem(key, value) } catch (_) {}
}

const randomId = (prefix) => {
  try {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`
  } catch (_) {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export const getAnalyticsIdentity = () => {
  let visitorId = safeStorageGet(window.localStorage, 'lt_analytics_visitor')
  if (!visitorId) {
    visitorId = randomId('visitor')
    safeStorageSet(window.localStorage, 'lt_analytics_visitor', visitorId)
  }

  let sessionId = safeStorageGet(window.sessionStorage, 'lt_analytics_session')
  if (!sessionId) {
    sessionId = randomId('session')
    safeStorageSet(window.sessionStorage, 'lt_analytics_session', sessionId)
  }

  return { visitorId, sessionId }
}

const deriveSource = (referrer) => {
  if (!referrer) return 'direct'
  try {
    const host = new URL(referrer).hostname.toLowerCase()
    if (!host || host === window.location.hostname.toLowerCase()) return 'internal'
    if (host.includes('facebook.com') || host.includes('fb.com') || host.includes('messenger.com')) return 'facebook'
    if (host.includes('instagram.com')) return 'instagram'
    if (host.includes('tiktok.com')) return 'tiktok'
    if (host.includes('google.')) return 'google'
    if (host.includes('bing.com')) return 'bing'
    return host.replace(/^www\./, '')
  } catch (_) {
    return 'referral'
  }
}

const campaignContext = () => {
  const params = new URLSearchParams(window.location.search)
  const current = {
    source: params.get('utm_source') || '',
    medium: params.get('utm_medium') || '',
    campaign: params.get('utm_campaign') || '',
  }

  if (current.source || current.medium || current.campaign) {
    safeStorageSet(window.sessionStorage, 'lt_analytics_campaign', JSON.stringify(current))
    return current
  }

  const stored = safeStorageGet(window.sessionStorage, 'lt_analytics_campaign')
  if (stored) {
    try { return JSON.parse(stored) || {} } catch (_) {}
  }
  return {}
}

export const trackEvent = (apiBase, eventName, details = {}) => {
  if (typeof window === 'undefined' || !eventName) return Promise.resolve()

  const { visitorId, sessionId } = getAnalyticsIdentity()
  const campaign = campaignContext()
  const referrer = details.referrer !== undefined ? details.referrer : document.referrer || ''
  const source = details.source || campaign.source || deriveSource(referrer)
  const path = details.path || `${window.location.pathname}${window.location.hash || ''}`

  // React StrictMode/dev re-renders and rapid double-clicks should not create
  // duplicate analytics rows for the exact same event within two seconds.
  const dedupeKey = `lt_event_${eventName}_${path}`
  const lastSent = Number(safeStorageGet(window.sessionStorage, dedupeKey) || 0)
  if (Date.now() - lastSent < 2000) return Promise.resolve()
  safeStorageSet(window.sessionStorage, dedupeKey, String(Date.now()))

  const payload = {
    event_name: eventName,
    session_id: sessionId,
    visitor_id: visitorId,
    path,
    page_name: details.page_name || document.title || '',
    referrer,
    source,
    medium: details.medium || campaign.medium || null,
    campaign: details.campaign || campaign.campaign || null,
    business_public_id: details.business_public_id || null,
    metadata: details.metadata || {},
  }

  const configured = (apiBase || import.meta.env.VITE_API_BASE_URL || FALLBACK_API_BASE).replace(/\/$/, '')

  return fetch(`${configured}/api/v1/public/analytics/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    cache: 'no-store',
  }).catch(() => {
    // Analytics is intentionally best-effort and never blocks navigation,
    // customer signup, Wallet actions, or any other LoyaltyTree workflow.
  })
}

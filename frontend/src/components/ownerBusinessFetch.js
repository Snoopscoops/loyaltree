// Scope a dashboard capability to the configured API and exact business path.
// Cloudinary and other businesses must never receive this Authorization header.
export function createOwnerBusinessFetch(fetchImpl, { API_BASE, businessId, ownerToken, onAuthError }) {
  const fallback = globalThis.location?.href || 'http://localhost/'
  const prefix = new URL(`${API_BASE.replace(/\/$/, '')}/api/v1/business/${encodeURIComponent(businessId)}`, fallback)
  return async (input, options = {}) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, fallback)
    const trusted = target.origin === prefix.origin
      && (target.pathname === prefix.pathname || target.pathname.startsWith(`${prefix.pathname}/`))
    if (!trusted) return fetchImpl(input, options)
    if (!ownerToken) {
      const error = Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 })
      onAuthError?.(error)
      throw error
    }
    const headers = new Headers(options.headers || (typeof input === 'object' && input.headers) || {})
    headers.set('Authorization', `Bearer ${ownerToken}`)
    const response = await fetchImpl(input, { ...options, headers, credentials: 'omit', redirect: 'error' })
    if ([401, 403].includes(response.status)) {
      const error = Object.assign(new Error(response.status === 401
        ? 'Your session has expired. Please sign in again.'
        : 'You do not have access to this business. Please sign in with its owner account.'), { status: response.status })
      onAuthError?.(error)
      throw error
    }
    return response
  }
}

import React, { useCallback, useRef } from 'react'
import { benefitRequestError } from './benefitsManagementModel'
import { requestJsonResponse } from './requestTimeout'

export function useBenefitsRequest({ API_BASE = '', token, authFetch, relativeAuth = false }) {
  const latest = useRef({ API_BASE, token, authFetch, relativeAuth })
  latest.current = { API_BASE, token, authFetch, relativeAuth }
  return useCallback(async (path, options = {}) => {
    const current = latest.current
    if (!current.token && !current.authFetch) throw new Error('Sign in with an authorized account to use LT Rewards.')
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    if (current.token) headers.Authorization = `Bearer ${current.token}`
    const url = current.authFetch && current.relativeAuth ? path : `${current.API_BASE.replace(/\/$/, '')}${path}`
    const { response, payload: body } = await requestJsonResponse(current.authFetch || fetch, url,
      { ...options, headers, cache: 'no-store' }, { message: 'LT Rewards is taking too long. Please try again.' })
    if (!response.ok) { const error = new Error(benefitRequestError(response.status, body)); error.status = response.status; throw error }
    if (!body || typeof body !== 'object') throw new Error('The LT Rewards response was incomplete. Please refresh.')
    return body
  }, [])
}

export function BenefitMetric({ label, value, detail }) {
  return <div className="lt-benefit-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}

export function BenefitField({ label, hint, children, wide = false }) {
  return <label className={`lt-benefit-field${wide ? ' is-wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function BenefitMessage({ error, children }) {
  return children ? <p className={`lt-benefit-message${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p> : null
}

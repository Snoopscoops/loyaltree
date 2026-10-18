import { formatMoney } from './currency.js'

// Display fallback only; live quotes use the server's billing_discounts.
export const PH_REFERENCE_DISCOUNTS = Object.freeze({monthly:0,'3_months':25,'6_months':50,annual:100})

export const BILLING_TERMS = Object.freeze({
  monthly: { label: '1 Month', payLabel: '1 Month', pricingKey: 'monthly', unit: '/month', months: 1, multiplier: 1 },
  '3_months': { label: '3 Months', payLabel: '3 Months', pricingKey: '3_months', unit: '/3 months', months: 3, multiplier: 3 },
  '6_months': { label: '6 Months', payLabel: '6 Months', pricingKey: '6_months', unit: '/6 months', months: 6, multiplier: 6 },
  annual: { label: '1 Year', payLabel: '1 Year', pricingKey: 'annual', unit: '/year', months: 12, multiplier: 10, note: '12 months access' },
})

export function normalizeBillingCycle(value) {
  return Object.hasOwn(BILLING_TERMS, value) ? value : 'monthly'
}

export function prepaidPrice(monthly, cycle, discounts = {}) {
  const key = normalizeBillingCycle(cycle)
  const term = BILLING_TERMS[key]
  const discount = Number(discounts?.[key] || 0)
  return Math.max(0, Number(monthly || 0) - discount) * (discount > 0 ? term.months : term.multiplier)
}

export function planPrice(plan, branches, cycle = 'monthly') {
  if (!plan) return null
  const n = Math.max(1, Number(branches) || 1)
  const bracket = n <= 1 ? '1' : n === 2 ? '2' : n === 3 ? '3' : '5'
  const one = Number(plan.price_tiers?.['1'] ?? plan.price_month ?? 0)
  const five = Number(plan.price_tiers?.['5'] ?? one)
  const monthly = n > 5 ? five + (n - 5) * one : Number(plan.price_tiers?.[bracket] ?? one)
  return prepaidPrice(monthly, cycle, plan.billing_discounts)
}

export function billingSavings(cycle, currency = 'PHP', discounts = {}) {
  const key = normalizeBillingCycle(cycle)
  const discount = Number(discounts?.[key] || 0)
  if (discount > 0) return `${formatMoney(discount, currency)}/month off`
  return key === 'annual' ? '2 months free' : ''
}

export function billingSummary(cycle, currency = 'PHP', discounts = {}) {
  const key = normalizeBillingCycle(cycle)
  if (key === 'monthly') return '30 days of access per payment.'
  const term = BILLING_TERMS[key]
  const savings = billingSavings(key, currency, discounts)
  return `Prepay ${term.months} months of access.${savings ? ` ${savings}.` : ''}`
}

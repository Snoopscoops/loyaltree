export const CURRENCY_META = {
  PHP: { symbol:'₱', locale:'en-PH', name:'Philippine Peso' },
  SGD: { symbol:'S$', locale:'en-SG', name:'Singapore Dollar' },
  GBP: { symbol:'£', locale:'en-GB', name:'British Pound' },
  HKD: { symbol:'HK$', locale:'en-HK', name:'Hong Kong Dollar' },
  USD: { symbol:'$', locale:'en-US', name:'US Dollar' },
  NZD: { symbol:'NZ$', locale:'en-NZ', name:'New Zealand Dollar' },
  MYR: { symbol:'RM', locale:'en-MY', name:'Malaysian Ringgit' },
}

export const COUNTRY_OPTIONS = [
  { code:'PH', label:'Philippines', currency:'PHP', flag:'🇵🇭' },
  { code:'SG', label:'Singapore', currency:'SGD', flag:'🇸🇬' },
  { code:'GB', label:'United Kingdom', currency:'GBP', flag:'🇬🇧' },
  { code:'HK', label:'Hong Kong', currency:'HKD', flag:'🇭🇰' },
  { code:'US', label:'United States', currency:'USD', flag:'🇺🇸' },
  { code:'NZ', label:'New Zealand', currency:'NZD', flag:'🇳🇿' },
  { code:'MY', label:'Malaysia', currency:'MYR', flag:'🇲🇾' },
]

export function currencyMeta(currency='PHP') {
  return CURRENCY_META[String(currency || 'PHP').toUpperCase()] || CURRENCY_META.PHP
}

export function formatMoney(amount, currency='PHP', { minimumFractionDigits, maximumFractionDigits } = {}) {
  const meta = currencyMeta(currency)
  const value = Number(amount || 0)
  const hasFraction = Math.abs(value - Math.round(value)) > 0.000001
  const min = minimumFractionDigits ?? (hasFraction ? 2 : 0)
  const max = maximumFractionDigits ?? 2
  return `${meta.symbol}${value.toLocaleString(meta.locale, { minimumFractionDigits:min, maximumFractionDigits:max })}`
}

export function currencySymbol(currency='PHP') {
  return currencyMeta(currency).symbol
}

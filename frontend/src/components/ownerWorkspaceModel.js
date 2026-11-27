// Read-only reporting helpers. A recorded order value is not a settlement ledger.
export const PERIODS = Object.freeze([['today','Daily'],['week','Weekly'],['month','Monthly']])
export const asArray = value => Array.isArray(value) ? value : []
export function manilaDay(value = new Date()) {
  if (value == null || value === '') return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  const get = key => parts.find(part => part.type === key)?.value
  return [get('year'),get('month'),get('day')].join('-')
}
export function dateRange(period,today = manilaDay()) {
  const date = new Date(today+'T00:00:00Z')
  if (period === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7)
  if (period === 'month') date.setUTCDate(1)
  return {start:date.toISOString().slice(0,10),end:today}
}
export function validRange(start,end,today=manilaDay()) {
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN
    const time = Date.parse(value+'T00:00:00Z')
    return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : NaN
  }
  const a=parse(start),b=parse(end)
  return Number.isFinite(a)&&Number.isFinite(b)&&a<=b&&end<=today&&b-a<92*86400000
}
export function paymentClass(row) {
  if (row?.status === 'cancelled') return 'cancelled'
  if (row?.payment_status === 'paid_test') return 'test'
  if (row?.payment_status === 'paid' && row?.payment_method === 'cash') return 'cash_confirmed'
  if (row?.payment_status === 'paid') return 'unverified'
  if (row?.payment_status === 'unpaid') return 'outstanding'
  return 'unknown'
}
export function filterOrders(rows,{branch='',start='',end='',search='',status='',payment=''}={}) {
  const term=search.trim().toLowerCase()
  return asArray(rows).filter(row=>{
    if (!row || typeof row !== 'object') return false
    const day=manilaDay(row.created_at)
    const id=row.branch?.public_id||row.branch_public_id||''
    return (!branch||id===branch)&&(!start||(day&&day>=start))&&(!end||(day&&day<=end))&&
      (!status||row.status===status)&&(!payment||paymentClass(row)===payment)&&
      (!term||[row.order_number,row.customer?.name,...asArray(row.items).map(item=>item?.item_name||item?.name)].some(value=>String(value||'').toLowerCase().includes(term)))
  })
}
export function nextStatus(row) {
  if (paymentClass(row)!=='cash_confirmed') return null
  return row.status==='new'?'preparing':row.status==='preparing'?'ready':row.status==='ready'?'completed':null
}
export function money(value,currency='PHP') {
  if (!['string','number'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('en-PH',{style:'currency',currency}).format(Number(value))
}
export function validMerchantStatus(data) {
  return data?.version===1&&['disabled','registration_required','verification_pending','active','restricted'].includes(data.state)
}

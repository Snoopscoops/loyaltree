// The menu card capability is scoped to one business. Never persist phone or address here.
export function readBookingCardToken(storage,businessId) {
  if(!businessId)return ''
  try{return storage?.getItem('lt-menu-card:'+businessId)||''}catch{return ''}
}
export function bookingCardName(value){
  if(typeof value!=='string')return ''
  const name=value.trim()
  return /^(loyalty card|customer)$/i.test(name)?'':name.slice(0,100)
}

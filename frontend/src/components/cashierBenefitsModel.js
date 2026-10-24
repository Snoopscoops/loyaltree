// A bill must be explicitly confirmed; scanning or adding a plain stamp is not a sale.
export function cashierActsAsOwner(dashboardState) {
  return dashboardState?.ownerMode === true && dashboardState?.sessionRole === 'owner' && Boolean(dashboardState?.ownerToken)
}

export function cashierBillAmount(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, decimal = ''] = text.split('.')
  const centavos = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(centavos) && centavos > 0 && centavos <= 100000000000 ? centavos / 100 : null
}

export function cashierStampBill({ enabled, amount, confirmed }) {
  if (!enabled || !String(amount ?? '').trim()) return { payload: {} }
  const bill = cashierBillAmount(amount)
  if (bill === null) return { error: 'Enter a positive purchase total with up to two decimal places, or clear the optional amount.' }
  if (!confirmed) return { error: 'Confirm the purchase total before adding LT Points, or clear the optional amount to add a plain stamp.' }
  return { payload: { amount_spent: bill } }
}

export function cashierAttemptKey(attempts, operation, payload, createKey) {
  const fingerprint = JSON.stringify(payload)
  if (attempts[operation]?.fingerprint === fingerprint) return attempts[operation].key
  const key = createKey()
  attempts[operation] = { fingerprint, key }
  return key
}

export function cashierNewAttemptKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // A transaction reference is not a credential. Keep older cashier browsers
  // usable when randomUUID is unavailable outside a secure browser context.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16)
    return (token === 'x' ? value : (value & 3) | 8).toString(16)
  })
}

export async function sendBusinessInquiry(base, inquiry, signal) {
  const response = await fetch(`${base}/api/v1/public/business-inquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inquiry),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'We could not confirm receipt. Please try again or email theloyaltytree@gmail.com.')
  }
  return data
}

// A deadline covers fetch AND reading the response body. Preserve caller
// cancellation, and settle even if a transport ignores AbortSignal.
export class RequestTimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError' }
}

export async function withRequestTimeout(operation, {
  signal, timeoutMs = 30000,
  message = 'This request is taking too long. Please try again.',
} = {}) {
  const controller = new AbortController()
  let timer, onAbort
  const interrupted = new Promise((_, reject) => {
    onAbort = () => {
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'))
      controller.abort(signal?.reason)
    }
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      const error = new RequestTimeoutError(message)
      reject(error)
      controller.abort(error)
    }, timeoutMs)
  })
  try {
    if (signal?.aborted) return await interrupted
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), interrupted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export function requestJsonResponse(send, input, options = {}, deadline = {}) {
  return withRequestTimeout(async signal => {
    const response = await send(input, { ...options, signal })
    const payload = await response.json().catch(() => null)
    return { response, payload }
  }, { ...deadline, signal: options.signal })
}

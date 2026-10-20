// One refresh at a time; paused tabs do no background dashboard work.
export function startVisibilityPolling(refresh, {
  intervalMs = 60000,
  immediate = true,
  document: page = globalThis.document,
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
} = {}) {
  let stopped = false
  let running = false
  let timer
  const visible = () => !page || page.visibilityState !== 'hidden'
  const next = () => {
    if (!stopped && visible()) timer = schedule(tick, intervalMs)
  }
  const tick = async () => {
    cancel(timer)
    if (stopped || running || !visible()) return
    running = true
    try { await refresh() } catch { /* Existing loaders own their error UI. */ }
    finally { running = false; next() }
  }
  const onVisibility = () => {
    cancel(timer)
    if (visible()) void tick()
  }
  page?.addEventListener('visibilitychange', onVisibility)
  if (immediate) void tick()
  else next()
  return () => {
    stopped = true
    cancel(timer)
    page?.removeEventListener('visibilitychange', onVisibility)
  }
}

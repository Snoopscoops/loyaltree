// One failed or slow section must not hide the entire admin dashboard.
export async function readAdminJson(authFetch, path, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await authFetch(path, { signal: controller.signal })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not load admin data.')
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Data is taking too long to load. Please retry.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function loadAdminResources(read, resources, onError) {
  return Promise.allSettled(resources.map(async ([path, apply]) => {
    try { apply(await read(path)) }
    catch (error) { onError(error); throw error }
  }))
}

export function filterAdminBusinesses(rows, { search = '', status = '', plan = '', type = '' } = {}) {
  const needle = search.toLowerCase()
  return rows.filter(row => (!status || row.status === status) && (!plan || row.plan === plan) &&
    (!type || row.business_type === type) && (!needle || [row.name, row.email, row.address]
      .some(value => String(value || '').toLowerCase().includes(needle))))
}

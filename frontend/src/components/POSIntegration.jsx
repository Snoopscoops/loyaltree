import React, { useEffect, useMemo, useState } from 'react'

const PROVIDERS = [
  {
    id: 'storehub',
    name: 'StoreHub',
    region: 'Philippines / Southeast Asia',
    description: 'Connect StoreHub transactions to Loyalty Tree for automatic loyalty activity.',
    status: 'available',
  },
  {
    id: 'loyverse',
    name: 'Loyverse',
    region: 'Global',
    description: 'Public API connector planned after StoreHub.',
    status: 'coming_soon',
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    region: 'Philippines',
    description: 'Restaurant POS connector planned for a later release.',
    status: 'coming_soon',
  },
  {
    id: 'qashier',
    name: 'Qashier',
    region: 'Southeast Asia',
    description: 'POS and payments connector planned for a later release.',
    status: 'coming_soon',
  },
  {
    id: 'shopify',
    name: 'Shopify POS',
    region: 'Global',
    description: 'Retail POS connector planned for a later release.',
    status: 'coming_soon',
  },
  {
    id: 'square',
    name: 'Square',
    region: 'Global',
    description: 'Retail and restaurant POS connector planned for a later release.',
    status: 'coming_soon',
  },
]

const EMPTY_TEST = {
  customer_public_id: '',
  amount_spent: '',
  external_transaction_id: '',
}

const normalizePlan = value => String(value || '').trim().toLowerCase()

function POSIntegration({
  API_BASE,
  user,
  business,
  branches = [],
  authFetch,
  onUpgrade,
}) {
  const slug = user?.business_slug || business?.public_id
  const plan = normalizePlan(business?.plan || user?.plan)
  const isPro = plan === 'pro'

  const [loading, setLoading] = useState(false)
  const [apiAvailable, setApiAvailable] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [integration, setIntegration] = useState(null)
  const [provider, setProvider] = useState('storehub')
  const [setupStep, setSetupStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [branchMappings, setBranchMappings] = useState({})
  const [testForm, setTestForm] = useState(EMPTY_TEST)
  const [testResult, setTestResult] = useState(null)
  const [storeHubConnection, setStoreHubConnection] = useState(null)
  const [storeHubCredentials, setStoreHubCredentials] = useState({ store_name: '', api_token: '' })
  const [storeHubOutlets, setStoreHubOutlets] = useState([])
  const [loyaltyContract, setLoyaltyContract] = useState(null)
  const [showReconnect, setShowReconnect] = useState(false)
  const [storeHubRealResult, setStoreHubRealResult] = useState(null)
  const [storeHubTransactions, setStoreHubTransactions] = useState([])

  const activeProvider = useMemo(
    () => PROVIDERS.find(item => item.id === provider) || PROVIDERS[0],
    [provider]
  )

  const integrationStatus = String(integration?.status || 'not_connected').toLowerCase()
  const hasSavedStoreHubCredentials = Boolean(storeHubConnection?.credentials_saved || integration?.config?.real_api_tested)
  const isConnected = ['connected', 'testing', 'live'].includes(integrationStatus) && (integrationStatus === 'live' || hasSavedStoreHubCredentials)
  const isLive = integrationStatus === 'live'

  const call = async (url, options = {}) => {
    if (!authFetch) throw new Error('Authenticated API helper is not available.')
    return authFetch(url, options)
  }

  const loadPOS = async () => {
    if (!isPro || !slug || !authFetch) return
    setLoading(true)
    setError('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos`, {
        cache: 'no-store',
      })

      // Safe during rollout: the component can be deployed before main.py
      // receives the POS routes without breaking the owner dashboard.
      if (res.status === 404) {
        setApiAvailable(false)
        setIntegration(null)
        return
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not load POS integration.')

      setApiAvailable(true)
      setIntegration(data.integration || null)
      setStoreHubConnection(data.storehub_connection || null)
      setStoreHubOutlets(data.storehub_connection?.outlets || data.integration?.config?.storehub_outlets || [])
      setLoyaltyContract(data.loyalty_contract || null)
      if (data.storehub_connection?.store_name) {
        setStoreHubCredentials(current => ({ ...current, store_name: data.storehub_connection.store_name }))
      }

      const mappings = {}
      ;(data.branch_mappings || []).forEach(row => {
        if (!row.branch_public_id) return
        mappings[row.branch_public_id] = {
          external_branch_id: row.external_branch_id || '',
          external_branch_name: row.external_branch_name || '',
        }
      })
      setBranchMappings(mappings)

      if (data.integration?.provider) setProvider(data.integration.provider)

      const status = String(data.integration?.status || '').toLowerCase()
      const credentialsSaved = Boolean(data.storehub_connection?.credentials_saved || data.integration?.config?.real_api_tested)
      if (status === 'live') setSetupStep(7)
      else if (!credentialsSaved) setSetupStep(1)
      else if (status === 'testing') setSetupStep(6)
      else if (data.branch_mappings?.length) setSetupStep(3)
      else if (data.integration) setSetupStep(2)
    } catch (err) {
      setError(err.message || 'Could not load POS integration.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPOS()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, slug])

  const connectStoreHub = async () => {
    if (!slug) return
    const storeName = storeHubCredentials.store_name.trim()
    const apiToken = storeHubCredentials.api_token.trim()
    if (!storeName || !apiToken) {
      setError('Enter the StoreHub store name and API token.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    setStoreHubRealResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_name: storeName, api_token: apiToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not connect StoreHub.')
      setIntegration(data.integration || null)
      setStoreHubRealResult(data)
      setStoreHubOutlets(data.stores || [])
      setLoyaltyContract(data.loyalty_contract || null)
      setStoreHubCredentials({ store_name: storeName, api_token: '' })
      setShowReconnect(false)
      setSetupStep(2)
      setMessage(`StoreHub connected securely. ${data.store_count ?? 0} outlet(s) detected.`)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not connect StoreHub.')
    } finally {
      setSaving(false)
    }
  }

  const testSavedStoreHubConnection = async () => {
    if (!slug) return
    setSaving(true)
    setError('')
    setMessage('')
    setStoreHubRealResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/connection-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'storehub' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'StoreHub API connection test failed.')
      setStoreHubRealResult(data)
      setIntegration(data.integration || integration)
      setStoreHubOutlets(data.stores || [])
      setLoyaltyContract(data.loyalty_contract || loyaltyContract)
      setMessage(`StoreHub API connected. ${data.store_count ?? 0} outlet(s) detected.`)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'StoreHub API connection test failed.')
    } finally {
      setSaving(false)
    }
  }

  const disconnectStoreHub = async () => {
    if (!slug) return
    if (!window.confirm('Disconnect StoreHub credentials? Saved branch mappings will be preserved.')) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/disconnect`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not disconnect StoreHub.')
      setIntegration(data.integration || null)
      setStoreHubOutlets([])
      setStoreHubTransactions([])
      setStoreHubRealResult(null)
      setStoreHubCredentials({ store_name: '', api_token: '' })
      setSetupStep(1)
      setMessage('StoreHub disconnected. Branch mappings were preserved for reconnecting later.')
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not disconnect StoreHub.')
    } finally {
      setSaving(false)
    }
  }

  const previewStoreHubTransactions = async () => {
    if (!slug) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/transactions-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 1, limit: 10 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not read StoreHub transactions.')
      setStoreHubTransactions(data.transactions || [])
      setMessage(`Read ${data.returned ?? 0} recent StoreHub transaction(s). No loyalty balances changed.`)
    } catch (err) {
      setError(err.message || 'Could not read StoreHub transactions.')
    } finally {
      setSaving(false)
    }
  }

  const updateMapping = (branchPublicId, field, value) => {
    setBranchMappings(current => ({
      ...current,
      [branchPublicId]: {
        ...(current[branchPublicId] || {
          external_branch_id: '',
          external_branch_name: '',
        }),
        [field]: value,
      },
    }))
  }

  const saveBranchMappings = async () => {
    if (!slug) return
    const mappings = branches.map(branch => ({
      branch_public_id: branch.public_id,
      external_branch_id: branchMappings[branch.public_id]?.external_branch_id?.trim() || null,
      external_branch_name: branchMappings[branch.public_id]?.external_branch_name?.trim() || null,
    })).filter(row => row.external_branch_id || row.external_branch_name)

    if (!mappings.length) {
      setError('Map at least one Loyalty Tree branch to a StoreHub outlet.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/branch-mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'storehub', mappings }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save branch mappings.')

      setMessage('Branch mapping saved.')
      setSetupStep(3)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not save branch mappings.')
    } finally {
      setSaving(false)
    }
  }

  const saveSetupSettings = async patch => {
    if (!slug) return false
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'storehub', ...patch }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save POS settings.')
      setIntegration(current => ({ ...(current || {}), ...(data.integration || {}) }))
      return true
    } catch (err) {
      setError(err.message || 'Could not save POS settings.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const runTestTransaction = async e => {
    e?.preventDefault()
    if (!slug) return

    const amount = Number(testForm.amount_spent)
    if (!testForm.customer_public_id.trim()) {
      setError('Enter a Loyalty Tree customer ID for the test.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid test purchase amount.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    setTestResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/test-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: testForm.customer_public_id.trim(),
          amount_spent: amount,
          external_transaction_id:
            testForm.external_transaction_id.trim() ||
            `STOREHUB-TEST-${Date.now()}`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Test transaction failed.')

      setTestResult(data)
      setMessage('Test transaction processed successfully.')
      setSetupStep(6)
    } catch (err) {
      setError(err.message || 'Test transaction failed.')
    } finally {
      setSaving(false)
    }
  }

  const goLive = async () => {
    if (!slug) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/go-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'storehub' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not activate StoreHub integration.')

      setIntegration(data.integration || {
        ...(integration || {}),
        status: 'live',
      })
      setSetupStep(7)
      setMessage('StoreHub integration is live.')
    } catch (err) {
      setError(err.message || 'Could not activate StoreHub integration.')
    } finally {
      setSaving(false)
    }
  }

  if (!isPro) {
    return (
      <div style={s.page}>
        <div style={s.lockedCard}>
          <div style={s.lockIcon}>🔒</div>
          <div style={s.eyebrow}>PRO FEATURE</div>
          <h2 style={s.title}>POS Integration</h2>
          <p style={s.muted}>
            Connect a supported point-of-sale system to Loyalty Tree and automate
            loyalty activity from real purchases.
          </p>
          <div style={s.price}>Pro · ₱750/month per branch</div>
          <button
            type="button"
            style={s.primaryButton}
            onClick={() => onUpgrade?.()}
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.headerRow}>
        <div>
          <div style={s.eyebrow}>PRO · POS INTEGRATION</div>
          <h2 style={s.title}>Connect your point-of-sale system</h2>
          <p style={s.muted}>
            Let Loyalty Tree receive eligible POS transactions, identify members,
            apply your existing loyalty rules, and update Wallet cards.
          </p>
        </div>
        <StatusBadge status={integrationStatus} />
      </div>

      {!apiAvailable && (
        <div style={s.infoBanner}>
          <b>POS UI ready.</b> The database migration can be installed now. The
          backend POS routes still need to be added to <code>main.py</code> before
          the setup buttons become active.
        </div>
      )}

      {message && <div style={s.successBanner}>{message}</div>}
      {error && <div style={s.errorBanner}>{error}</div>}

      {loading ? (
        <div style={s.card}>Loading POS integration…</div>
      ) : (
        <>
          <SetupProgress step={setupStep} isLive={isLive} />

          <section style={s.card}>
            <div style={s.sectionHeader}>
              <div>
                <div style={s.stepLabel}>1 · POS PROVIDER</div>
                <h3 style={s.sectionTitle}>Choose your POS</h3>
              </div>
              {isConnected && <span style={s.connectedPill}>Connected</span>}
            </div>

            <div style={s.providerGrid}>
              {PROVIDERS.map(item => {
                const selected = provider === item.id
                const available = item.status === 'available'
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!available || (isConnected && item.id !== provider)}
                    onClick={() => available && setProvider(item.id)}
                    style={{
                      ...s.providerCard,
                      ...(selected ? s.providerCardSelected : {}),
                      ...(!available ? s.providerCardDisabled : {}),
                    }}
                  >
                    <div style={s.providerTop}>
                      <b>{item.name}</b>
                      <span style={available ? s.availablePill : s.soonPill}>
                        {available ? 'Available' : 'Coming soon'}
                      </span>
                    </div>
                    <div style={s.providerRegion}>{item.region}</div>
                    <div style={s.providerDescription}>{item.description}</div>
                  </button>
                )
              })}
            </div>

            {activeProvider.id === 'storehub' && !isConnected && (
              <div style={{marginTop:18,display:'grid',gap:12}}>
                <div style={s.ruleBox}>
                  <b>Connect your own StoreHub account</b>
                  <div style={s.smallMuted}>
                    The API token is sent only to the Loyalty Tree backend, encrypted, and never shown again.
                  </div>
                </div>
                {!storeHubConnection?.encryption_configured && (
                  <div style={s.infoBanner}>
                    Platform setup required: add <code>POS_CREDENTIALS_ENCRYPTION_KEY</code> once to the Loyalty Tree backend environment.
                  </div>
                )}
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
                  <label style={{display:'grid',gap:6}}>
                    <span style={s.smallMuted}>StoreHub store name</span>
                    <input
                      style={s.input}
                      placeholder="e.g. angkan"
                      autoComplete="off"
                      value={storeHubCredentials.store_name}
                      onChange={e => setStoreHubCredentials(current => ({ ...current, store_name: e.target.value }))}
                    />
                  </label>
                  <label style={{display:'grid',gap:6}}>
                    <span style={s.smallMuted}>StoreHub API token</span>
                    <input
                      style={s.input}
                      type="password"
                      placeholder="Paste API token"
                      autoComplete="new-password"
                      value={storeHubCredentials.api_token}
                      onChange={e => setStoreHubCredentials(current => ({ ...current, api_token: e.target.value }))}
                    />
                  </label>
                </div>
                <div style={s.actionRow}>
                  <button
                    type="button"
                    style={s.primaryButton}
                    disabled={saving || !apiAvailable || !storeHubConnection?.encryption_configured}
                    onClick={connectStoreHub}
                  >
                    {saving ? 'Testing…' : 'Test & connect StoreHub'}
                  </button>
                  <span style={s.smallMuted}>Credentials are saved only after StoreHub authentication succeeds.</span>
                </div>
              </div>
            )}
          </section>

          {isConnected && (
            <section style={s.card}>
              <div style={s.sectionHeader}>
                <div>
                  <div style={s.stepLabel}>STOREHUB ACCOUNT</div>
                  <h3 style={s.sectionTitle}>Connected securely</h3>
                </div>
                <span style={s.connectedPill}>Connected</span>
              </div>
              <div style={s.ruleBox}>
                <b>{integration?.external_account_name || storeHubConnection?.store_name || 'StoreHub'}</b>
                <div style={s.smallMuted}>
                  API token: •••••••••••• · Stored encrypted on Loyalty Tree's backend
                </div>
              </div>

              {showReconnect && (
                <div style={{marginTop:12,display:'grid',gap:10}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
                    <input
                      style={s.input}
                      placeholder="StoreHub store name"
                      value={storeHubCredentials.store_name}
                      onChange={e => setStoreHubCredentials(current => ({ ...current, store_name: e.target.value }))}
                    />
                    <input
                      style={s.input}
                      type="password"
                      placeholder="New API token"
                      autoComplete="new-password"
                      value={storeHubCredentials.api_token}
                      onChange={e => setStoreHubCredentials(current => ({ ...current, api_token: e.target.value }))}
                    />
                  </div>
                  <button type="button" style={s.primaryButton} disabled={saving} onClick={connectStoreHub}>
                    {saving ? 'Testing…' : 'Test & replace credentials'}
                  </button>
                </div>
              )}

              <div style={s.actionRow}>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={testSavedStoreHubConnection}>
                  Test saved connection
                </button>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={previewStoreHubTransactions}>
                  Preview recent transactions
                </button>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={() => setShowReconnect(value => !value)}>
                  {showReconnect ? 'Cancel reconnect' : 'Reconnect / change token'}
                </button>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={disconnectStoreHub}>
                  Disconnect
                </button>
              </div>

              {!!storeHubOutlets.length && (
                <div style={{marginTop:14}}>
                  <b style={{fontSize:13}}>Detected StoreHub outlets</b>
                  <div style={{marginTop:8,display:'grid',gap:6}}>
                    {storeHubOutlets.slice(0,20).map((store, index) => (
                      <div key={store.id || index} style={s.resultItem}>
                        <b>{store.name || store.id || `Outlet ${index + 1}`}</b>
                        {store.id && <div style={s.smallMuted}>ID: {store.id}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!storeHubTransactions.length && (
                <div style={{marginTop:14}}>
                  <b style={{fontSize:13}}>Recent StoreHub transactions · read-only</b>
                  <div style={{marginTop:8,display:'grid',gap:7}}>
                    {storeHubTransactions.map((tx, index) => (
                      <div key={tx.ref_id || index} style={s.resultItem}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                          <b>{tx.invoice_number || tx.ref_id || `Transaction ${index + 1}`}</b>
                          <b>{tx.total === null || tx.total === undefined ? '—' : `₱${Number(tx.total).toFixed(2)}`}</b>
                        </div>
                        <div style={s.smallMuted}>
                          Store: {tx.store_id || '—'} · Customer ref: {tx.customer_ref_id || 'none'} · {tx.transaction_time || ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {isConnected && (
            <>
              <section style={s.card}>
                <div style={s.stepLabel}>2 · BRANCH MAPPING</div>
                <h3 style={s.sectionTitle}>Match Loyalty Tree branches to StoreHub outlets</h3>
                <p style={s.muted}>
                  Each POS transaction must resolve to the correct Loyalty Tree branch.
                </p>

                {branches.length ? (
                  <div style={s.mappingList}>
                    {branches.map(branch => (
                      <div key={branch.public_id} style={s.mappingRow}>
                        <div>
                          <b>{branch.name}</b>
                          <div style={s.smallMuted}>{branch.address || 'Loyalty Tree branch'}</div>
                        </div>
                        <div style={s.arrow}>↔</div>
                        <div style={s.mappingFields}>
                          {storeHubOutlets.length ? (
                            <select
                              style={s.input}
                              value={branchMappings[branch.public_id]?.external_branch_id || ''}
                              onChange={e => {
                                const selected = storeHubOutlets.find(item => String(item.id) === e.target.value)
                                updateMapping(branch.public_id, 'external_branch_id', e.target.value)
                                updateMapping(branch.public_id, 'external_branch_name', selected?.name || '')
                              }}
                            >
                              <option value="">Choose StoreHub outlet…</option>
                              {storeHubOutlets.map((outlet, index) => (
                                <option key={outlet.id || index} value={String(outlet.id || '')}>
                                  {outlet.name || outlet.id || `Outlet ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <input
                                style={s.input}
                                placeholder="StoreHub outlet ID"
                                value={branchMappings[branch.public_id]?.external_branch_id || ''}
                                onChange={e => updateMapping(branch.public_id, 'external_branch_id', e.target.value)}
                              />
                              <input
                                style={s.input}
                                placeholder="StoreHub outlet name"
                                value={branchMappings[branch.public_id]?.external_branch_name || ''}
                                onChange={e => updateMapping(branch.public_id, 'external_branch_name', e.target.value)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={s.emptyState}>Create at least one branch before mapping StoreHub.</div>
                )}

                <button
                  type="button"
                  style={s.primaryButton}
                  disabled={saving || !branches.length || !apiAvailable}
                  onClick={saveBranchMappings}
                >
                  {saving ? 'Saving…' : 'Save branch mapping'}
                </button>
              </section>

              <section style={s.twoColumn}>
                <div style={s.card}>
                  <div style={s.stepLabel}>3 · CUSTOMER IDENTIFICATION</div>
                  <h3 style={s.sectionTitle}>How members are identified</h3>
                  <ChoiceRow
                    checked
                    label="Scan Loyalty Tree QR"
                    description="Recommended. The member's Loyalty Tree QR identifies the loyalty account."
                  />
                  <ChoiceRow
                    disabled
                    label="Phone lookup"
                    description="Can be added later as a fallback."
                  />
                  <ChoiceRow
                    disabled
                    label="Email lookup"
                    description="Can be added later as a fallback."
                  />
                  <button
                    type="button"
                    style={s.secondaryButton}
                    disabled={saving || !apiAvailable}
                    onClick={async () => {
                      if (await saveSetupSettings({ member_identification: 'qr' })) {
                        setSetupStep(4)
                        setMessage('Customer identification saved.')
                      }
                    }}
                  >
                    Continue
                  </button>
                </div>

                <div style={s.card}>
                  <div style={s.stepLabel}>4 · LOYALTY RULES</div>
                  <h3 style={s.sectionTitle}>Use the existing Loyalty Tree card rules</h3>
                  <div style={s.ruleBox}>
                    <b>No duplicate loyalty configuration.</b>
                    <div style={s.smallMuted}>
                      StoreHub supplies the purchase transaction. Loyalty Tree remains the
                      source of truth for earning, rewards and redemption rules.
                    </div>
                    {loyaltyContract?.configured && (
                      <div style={{marginTop:8,fontSize:12}}>
                        Saved card: <b>{loyaltyContract.card_type}</b> · Engine: <b>{loyaltyContract.earning?.type || loyaltyContract.effective_loyalty_type}</b>
                        {loyaltyContract.earning?.type === 'points' && (
                          <div style={s.smallMuted}>
                            {loyaltyContract.earning.points_per_amount ?? '—'} point(s) per ₱{loyaltyContract.earning.amount_pesos ?? '—'}
                          </div>
                        )}
                        {loyaltyContract.earning?.type === 'stamp' && (
                          <div style={s.smallMuted}>
                            Stamp goal: {loyaltyContract.earning.stamp_goal ?? '—'}
                          </div>
                        )}
                        {loyaltyContract.earning?.type === 'hybrid' && (
                          <div style={s.smallMuted}>
                            Points: {loyaltyContract.earning.points?.points_per_amount ?? '—'} per ₱{loyaltyContract.earning.points?.amount_pesos ?? '—'} · Stamp goal: {loyaltyContract.earning.stamp?.stamp_goal ?? '—'}
                          </div>
                        )}
                        <div style={s.smallMuted}>
                          Redemption rules stay in Loyalty Tree and are exposed to the POS connector from the saved card configuration.
                        </div>
                      </div>
                    )}
                  </div>
                  <ChoiceRow
                    checked
                    label="Use eligible POS purchase amount"
                    description="Transaction amount is passed into the existing Loyalty Tree loyalty engine."
                  />
                  <button
                    type="button"
                    style={s.secondaryButton}
                    disabled={saving || !apiAvailable}
                    onClick={async () => {
                      if (await saveSetupSettings({
                        loyalty_source: 'existing_loyaltytree_program',
                        earning_enabled: true,
                      })) {
                        setSetupStep(5)
                        setMessage('Loyalty settings saved.')
                      }
                    }}
                  >
                    Continue
                  </button>
                </div>
              </section>

              <section style={s.card}>
                <div style={s.stepLabel}>5 · REDEMPTION</div>
                <h3 style={s.sectionTitle}>Redemption through POS</h3>
                <p style={s.muted}>
                  Loyalty Tree already remains the source of truth for redemption rules.
                  Automatic StoreHub redemption will be enabled after StoreHub confirms the
                  discount/tender write-back needed to apply an approved redemption to checkout.
                </p>
                <ChoiceRow
                  checked={integration?.config?.redemption_enabled === true}
                  disabled
                  label="StoreHub redemption"
                  description="Prepared in the integration model, but keep disabled during the first earning-only test."
                />
                <button
                  type="button"
                  style={s.secondaryButton}
                  disabled={saving || !apiAvailable}
                  onClick={async () => {
                    if (await saveSetupSettings({ redemption_enabled: false })) {
                      setSetupStep(6)
                      setMessage('Earning-only test mode selected.')
                    }
                  }}
                >
                  Continue with earning only
                </button>
              </section>

              <section style={s.card}>
                <div style={s.stepLabel}>6 · TEST TRANSACTION</div>
                <h3 style={s.sectionTitle}>Simulate a StoreHub sale</h3>
                <p style={s.muted}>
                  Use a real Loyalty Tree test member. This should run through the same
                  loyalty engine and Wallet update flow that live StoreHub transactions
                  will use later.
                </p>

                <form onSubmit={runTestTransaction} style={s.testGrid}>
                  <label style={s.fieldLabel}>
                    Loyalty Tree customer ID
                    <input
                      style={s.input}
                      placeholder="customer-public-id"
                      value={testForm.customer_public_id}
                      onChange={e =>
                        setTestForm(current => ({
                          ...current,
                          customer_public_id: e.target.value,
                        }))
                      }
                    />
                  </label>

                  <label style={s.fieldLabel}>
                    Purchase amount
                    <input
                      style={s.input}
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="100.00"
                      value={testForm.amount_spent}
                      onChange={e =>
                        setTestForm(current => ({
                          ...current,
                          amount_spent: e.target.value,
                        }))
                      }
                    />
                  </label>

                  <label style={s.fieldLabel}>
                    Test StoreHub transaction ID
                    <input
                      style={s.input}
                      placeholder="Auto-generated if blank"
                      value={testForm.external_transaction_id}
                      onChange={e =>
                        setTestForm(current => ({
                          ...current,
                          external_transaction_id: e.target.value,
                        }))
                      }
                    />
                  </label>

                  <div style={s.testButtonWrap}>
                    <button
                      type="submit"
                      style={s.primaryButton}
                      disabled={saving || !apiAvailable}
                    >
                      {saving ? 'Processing…' : 'Run test transaction'}
                    </button>
                  </div>
                </form>

                {testResult && (
                  <div style={s.testResult}>
                    <b>✓ Test passed</b>
                    <div style={s.resultGrid}>
                      <ResultItem label="Amount" value={`₱${Number(testResult.amount_spent || testForm.amount_spent || 0).toFixed(2)}`} />
                      <ResultItem label="Points earned" value={testResult.points_earned ?? '—'} />
                      <ResultItem label="Stamps" value={testResult.stamp_count ?? testResult.stamps ?? '—'} />
                      <ResultItem label="Wallet sync" value={testResult.wallet_sync_status || 'Queued'} />
                    </div>
                  </div>
                )}
              </section>

              <section style={s.card}>
                <div style={s.stepLabel}>7 · GO LIVE</div>
                <div style={s.sectionHeader}>
                  <div>
                    <h3 style={s.sectionTitle}>
                      {isLive ? 'StoreHub integration is live' : 'Ready for live StoreHub'}
                    </h3>
                    <p style={s.muted}>
                      {isLive
                        ? 'Loyalty Tree is ready to receive supported StoreHub transactions for this business.'
                        : 'Activate only after the test flow passes and real StoreHub API credentials are available.'}
                    </p>
                  </div>
                  {isLive && <span style={s.livePill}>● LIVE</span>}
                </div>

                {!isLive && (
                  <button
                    type="button"
                    style={s.primaryButton}
                    disabled={saving || !testResult || !apiAvailable}
                    onClick={goLive}
                  >
                    {saving ? 'Activating…' : 'Go Live'}
                  </button>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}

function SetupProgress({ step, isLive }) {
  const steps = [
    'Provider',
    'Branches',
    'Member ID',
    'Loyalty',
    'Redemption',
    'Test',
    'Live',
  ]
  const completed = isLive ? 7 : Math.max(0, Math.min(Number(step || 1) - 1, 6))

  return (
    <div style={s.progressCard}>
      <div style={s.progressTop}>
        <b>POS Setup</b>
        <span style={s.smallMuted}>{isLive ? 'Complete' : `${completed}/7 completed`}</span>
      </div>
      <div style={s.progressTrack}>
        <div
          style={{
            ...s.progressFill,
            width: `${isLive ? 100 : (completed / 7) * 100}%`,
          }}
        />
      </div>
      <div style={s.progressSteps}>
        {steps.map((label, index) => {
          const done = isLive || index < completed
          const active = !isLive && index === Math.min(completed, 6)
          return (
            <div key={label} style={{ ...s.progressStep, ...(active ? s.progressStepActive : {}) }}>
              <span>{done ? '✓' : index + 1}</span>
              <small>{label}</small>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const normalized = String(status || '').toLowerCase()
  const cfg = normalized === 'live'
    ? { label: '● Live', style: s.statusLive }
    : ['connected', 'testing'].includes(normalized)
      ? { label: normalized === 'testing' ? '● Test Mode' : '● Connected', style: s.statusConnected }
      : normalized === 'error'
        ? { label: '● Error', style: s.statusError }
        : { label: 'Not connected', style: s.statusIdle }

  return <span style={{ ...s.statusBadge, ...cfg.style }}>{cfg.label}</span>
}

function ChoiceRow({ checked = false, disabled = false, label, description }) {
  return (
    <div style={{ ...s.choiceRow, ...(disabled ? { opacity: 0.55 } : {}) }}>
      <div style={{
        ...s.choiceCheck,
        ...(checked ? s.choiceCheckOn : {}),
      }}>
        {checked ? '✓' : ''}
      </div>
      <div>
        <b style={{ fontSize: 13 }}>{label}</b>
        <div style={s.smallMuted}>{description}</div>
      </div>
    </div>
  )
}

function ResultItem({ label, value }) {
  return (
    <div style={s.resultItem}>
      <div style={s.smallMuted}>{label}</div>
      <b>{String(value)}</b>
    </div>
  )
}

const s = {
  page: {
    display: 'grid',
    gap: 14,
    width: '100%',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.08em',
    color: '#0f766e',
  },
  title: {
    margin: '5px 0 6px',
    color: '#0f172a',
  },
  muted: {
    margin: 0,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.55,
  },
  smallMuted: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 1.45,
  },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 16,
    boxShadow: '0 5px 16px rgba(15,23,42,0.04)',
  },
  lockedCard: {
    maxWidth: 620,
    margin: '20px auto',
    textAlign: 'center',
    background: '#fff',
    border: '1px solid #dbeafe',
    borderRadius: 20,
    padding: 28,
    boxShadow: '0 10px 30px rgba(15,23,42,0.06)',
  },
  lockIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    display: 'grid',
    placeItems: 'center',
    margin: '0 auto 12px',
    background: '#eff6ff',
    fontSize: 24,
  },
  price: {
    margin: '15px 0',
    display: 'inline-block',
    background: '#ecfdf5',
    color: '#047857',
    borderRadius: 999,
    padding: '7px 11px',
    fontSize: 12,
    fontWeight: 850,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    margin: '5px 0 7px',
    fontSize: 17,
    color: '#0f172a',
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.08em',
    color: '#64748b',
  },
  twoColumn: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 14,
  },
  providerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    marginTop: 14,
  },
  providerCard: {
    textAlign: 'left',
    border: '1px solid #e2e8f0',
    background: '#fff',
    borderRadius: 13,
    padding: 13,
    cursor: 'pointer',
    minHeight: 124,
  },
  providerCardSelected: {
    borderColor: '#0d9488',
    background: '#f0fdfa',
    boxShadow: '0 0 0 2px rgba(13,148,136,0.08)',
  },
  providerCardDisabled: {
    cursor: 'default',
    background: '#f8fafc',
    opacity: 0.72,
  },
  providerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
  },
  providerRegion: {
    fontSize: 11,
    color: '#0f766e',
    fontWeight: 750,
    marginTop: 5,
  },
  providerDescription: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 1.45,
    marginTop: 7,
  },
  availablePill: {
    fontSize: 9,
    fontWeight: 900,
    padding: '4px 6px',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#166534',
  },
  soonPill: {
    fontSize: 9,
    fontWeight: 900,
    padding: '4px 6px',
    borderRadius: 999,
    background: '#f1f5f9',
    color: '#64748b',
  },
  connectedPill: {
    fontSize: 10,
    fontWeight: 850,
    padding: '5px 8px',
    borderRadius: 999,
    background: '#ecfdf5',
    color: '#047857',
  },
  livePill: {
    fontSize: 11,
    fontWeight: 900,
    padding: '7px 10px',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#166534',
  },
  statusBadge: {
    padding: '7px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 850,
    whiteSpace: 'nowrap',
  },
  statusLive: {
    background: '#dcfce7',
    color: '#166534',
  },
  statusConnected: {
    background: '#ecfeff',
    color: '#155e75',
  },
  statusError: {
    background: '#fef2f2',
    color: '#b91c1c',
  },
  statusIdle: {
    background: '#f1f5f9',
    color: '#64748b',
  },
  actionRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 14,
  },
  primaryButton: {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    background: '#0d9488',
    color: '#fff',
    fontWeight: 850,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    padding: '9px 12px',
    background: '#fff',
    color: '#0f172a',
    fontWeight: 800,
    cursor: 'pointer',
    marginTop: 12,
  },
  infoBanner: {
    padding: 12,
    borderRadius: 12,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1e40af',
    fontSize: 12,
    lineHeight: 1.5,
  },
  successBanner: {
    padding: 11,
    borderRadius: 10,
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    color: '#047857',
    fontSize: 12,
    fontWeight: 700,
  },
  errorBanner: {
    padding: 11,
    borderRadius: 10,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: 700,
  },
  mappingList: {
    display: 'grid',
    gap: 8,
    margin: '14px 0',
  },
  mappingRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, .7fr) 30px minmax(220px, 1.3fr)',
    gap: 10,
    alignItems: 'center',
    background: '#f8fafc',
    borderRadius: 12,
    padding: 11,
  },
  mappingFields: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 7,
  },
  arrow: {
    textAlign: 'center',
    color: '#94a3b8',
    fontWeight: 900,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    padding: '9px 10px',
    background: '#fff',
    color: '#0f172a',
  },
  emptyState: {
    margin: '12px 0',
    padding: 12,
    background: '#f8fafc',
    borderRadius: 10,
    color: '#64748b',
    fontSize: 12,
  },
  choiceRow: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr',
    gap: 9,
    alignItems: 'flex-start',
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  choiceCheck: {
    width: 20,
    height: 20,
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    display: 'grid',
    placeItems: 'center',
    fontSize: 12,
  },
  choiceCheckOn: {
    background: '#0d9488',
    borderColor: '#0d9488',
    color: '#fff',
  },
  ruleBox: {
    background: '#f0fdfa',
    border: '1px solid #99f6e4',
    borderRadius: 11,
    padding: 11,
    margin: '11px 0',
  },
  testGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10,
    alignItems: 'end',
    marginTop: 14,
  },
  fieldLabel: {
    display: 'grid',
    gap: 5,
    fontSize: 11,
    fontWeight: 800,
    color: '#475569',
  },
  testButtonWrap: {
    display: 'flex',
    alignItems: 'flex-end',
  },
  testResult: {
    marginTop: 14,
    border: '1px solid #a7f3d0',
    background: '#ecfdf5',
    borderRadius: 12,
    padding: 12,
    color: '#065f46',
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8,
    marginTop: 10,
  },
  resultItem: {
    background: 'rgba(255,255,255,.75)',
    borderRadius: 9,
    padding: 9,
  },
  progressCard: {
    background: '#0f172a',
    color: '#fff',
    borderRadius: 16,
    padding: 14,
  },
  progressTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'center',
  },
  progressTrack: {
    height: 6,
    background: '#334155',
    borderRadius: 999,
    overflow: 'hidden',
    margin: '10px 0 12px',
  },
  progressFill: {
    height: '100%',
    background: '#2dd4bf',
    borderRadius: 999,
    transition: 'width .2s ease',
  },
  progressSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    gap: 4,
  },
  progressStep: {
    display: 'grid',
    justifyItems: 'center',
    gap: 3,
    color: '#94a3b8',
    fontSize: 10,
    textAlign: 'center',
  },
  progressStepActive: {
    color: '#5eead4',
    fontWeight: 800,
  },
}

export default POSIntegration

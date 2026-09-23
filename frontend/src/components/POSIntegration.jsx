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
    description: 'Official API connector for stores, customers and receipts.',
    status: 'available',
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

const POS_DEVICE_PROFILES = [
  { id: 'imin_falcon_1', label: 'iMin Falcon 1', scanner: 'camera', note: 'Built-in camera. Older/slower model — keep the QR camera screen lightweight.' },
  { id: 'imin_d4', label: 'iMin D4', scanner: 'camera', note: 'Built-in camera. Older/slower model — keep the QR camera screen lightweight.' },
  { id: 'sunmi_d3_pro', label: 'Sunmi D3 Pro', scanner: 'hardware_scanner', note: 'Can scan but has no built-in camera. Use the terminal scanner flow.' },
  { id: 'sunmi_t2', label: 'Sunmi T2', scanner: 'external_scanner', note: 'ANGKAN setup: use an external QR scanner.' },
  { id: 'other', label: 'Other POS terminal', scanner: 'external_scanner', note: 'Confirm scanner/camera support during branch testing.' },
]

const CHECKOUT_MODES = [
  { id: 'auto', label: 'Automatic · Seamless first, Companion fallback', note: 'Recommended for pilot. Try StoreHub seamless checkout first; automatically fall back to Loyalty Tree Companion if the required StoreHub write hooks are not verified.' },
  { id: 'seamless', label: 'Seamless StoreHub only', note: 'Requires verified open-cart discount write and completed-sale confirmation from StoreHub. Redemption is blocked if the seamless test fails.' },
  { id: 'companion', label: 'Loyalty Tree Companion', note: 'Cashier scans/redeems in Loyalty Tree, applies the displayed discount in StoreHub, then confirms it before completing the sale.' },
]

const SCANNER_METHODS = [
  { id: 'camera', label: 'Built-in camera' },
  { id: 'hardware_scanner', label: 'POS hardware scanner' },
  { id: 'external_scanner', label: 'External QR scanner' },
]

const EMPTY_TEST = {
  customer_public_id: '',
  amount_spent: '',
  external_transaction_id: '',
  branch_public_id: '',
}

const EMPTY_REDEMPTION_TEST = {
  customer_public_id: '',
  gross_amount: '485',
  points_to_redeem: '100',
  branch_public_id: '',
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
  const [loyverseConnection, setLoyverseConnection] = useState(null)
  const [loyverseCredentials, setLoyverseCredentials] = useState({ api_token: '' })
  const [loyverseStores, setLoyverseStores] = useState([])
  const [loyverseResult, setLoyverseResult] = useState(null)
  const [loyverseReceipts, setLoyverseReceipts] = useState([])
  const [redemptionConfig, setRedemptionConfig] = useState({
    enabled: false,
    value_per_point: 1,
    min_points: 1,
    increment_points: 1,
    max_percent: 100,
    hold_minutes: 10,
    earn_on_net_amount: true,
  })
  const [redemptionForm, setRedemptionForm] = useState(EMPTY_REDEMPTION_TEST)
  const [redemptionResult, setRedemptionResult] = useState(null)
  const [redemptionStage, setRedemptionStage] = useState('idle')
  const [companionDevices, setCompanionDevices] = useState([])
  const [activationCodeInfo, setActivationCodeInfo] = useState(null)
  const [newDeviceName, setNewDeviceName] = useState('')
  const [quickBranchId, setQuickBranchId] = useState('')
  const [quickOutletId, setQuickOutletId] = useState('')
  const [copyState, setCopyState] = useState('')

  const activeProvider = useMemo(
    () => PROVIDERS.find(item => item.id === provider) || PROVIDERS[0],
    [provider]
  )

  const integrationStatus = String(integration?.status || 'not_connected').toLowerCase()
  const hasSavedStoreHubCredentials = Boolean(storeHubConnection?.credentials_saved || (provider === 'storehub' && integration?.config?.real_api_tested))
  const hasSavedLoyverseCredentials = Boolean(loyverseConnection?.credentials_saved || (provider === 'loyverse' && integration?.config?.real_api_tested))
  const hasSavedCredentials = provider === 'loyverse' ? hasSavedLoyverseCredentials : hasSavedStoreHubCredentials
  const simulatorReady = provider === 'storehub' && integration?.mode === 'test' && integration?.config?.simulator === true
  const isConnected = ['connected', 'testing', 'live'].includes(integrationStatus) && (integrationStatus === 'live' || hasSavedCredentials || simulatorReady)
  const isLive = integrationStatus === 'live'
  const providerLabel = provider === 'loyverse' ? 'Loyverse' : 'StoreHub'
  const providerLocations = provider === 'loyverse' ? loyverseStores : storeHubOutlets
  const locationLabel = provider === 'loyverse' ? 'store' : 'outlet'

  const call = async (url, options = {}) => {
    if (!authFetch) throw new Error('Authenticated API helper is not available.')
    return authFetch(url, options)
  }

  const loadCompanionDevices = async () => {
    if (!isPro || !slug || !authFetch) return
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/devices`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      setCompanionDevices(data.devices || [])
    } catch (_) {
      // Device status is helpful, but should never block POS setup.
    }
  }

  const generateCompanionActivationCode = async () => {
    if (!slug) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const branch = branches.find(item => item.public_id === quickBranchId) || branches[0]
      if (!branch) throw new Error('Choose a Loyalty Tree branch first.')
      const mapping = branchMappings[branch.public_id] || {}
      if (!mapping.saved_mapping || !mapping.external_branch_id) {
        throw new Error('Link this branch to its POS outlet before generating a device.')
      }
      const deviceName = newDeviceName.trim() || `${branch.name || 'Branch'} POS`
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/device-activation-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          expires_in_minutes: 15,
          max_uses: 1,
          branch_public_id: branch.public_id,
          external_branch_id: mapping.external_branch_id,
          external_branch_name: mapping.external_branch_name || null,
          device_name: deviceName,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not generate Companion activation code.')
      setActivationCodeInfo(data)
      setMessage(`Pairing code ready for the existing ${providerLabel} POS at ${data.branch_name || branch.name}. Enter it in Loyalty Tree Companion on that POS.`)
    } catch (err) {
      setError(err.message || 'Could not generate Companion activation code.')
    } finally {
      setSaving(false)
    }
  }

  const copyText = async (value, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(String(value || ''))
      setCopyState(label)
      window.setTimeout(() => setCopyState(''), 1600)
    } catch (_) {
      setCopyState('Copy manually')
      window.setTimeout(() => setCopyState(''), 1600)
    }
  }

  const saveQuickBranchMapping = async () => {
    if (!slug) return
    const branch = branches.find(item => item.public_id === quickBranchId) || branches[0]
    if (!branch) {
      setError('Create at least one Loyalty Tree branch first.')
      return
    }

    const existing = branchMappings[branch.public_id] || {}
    let externalBranchId = String(existing.external_branch_id || '').trim()
    let externalBranchName = String(existing.external_branch_name || '').trim()

    if (simulatorReady) {
      externalBranchId = externalBranchId || `test-${branch.public_id}`
      externalBranchName = externalBranchName || branch.name || branch.public_id
    } else if (quickOutletId) {
      const selected = providerLocations.find(item => String(item.id) === String(quickOutletId))
      externalBranchId = String(quickOutletId)
      externalBranchName = selected?.name || externalBranchName || String(quickOutletId)
    }

    if (!externalBranchId && !externalBranchName) {
      setError(`Choose the ${providerLabel} ${locationLabel} for this branch, or use Advanced setup.`)
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/branch-mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          mappings: [{
            branch_public_id: branch.public_id,
            external_branch_id: externalBranchId || null,
            external_branch_name: externalBranchName || null,
            device_model: existing.device_model || 'other',
            scanner_method: existing.scanner_method || 'external_scanner',
            checkout_mode: existing.checkout_mode || 'auto',
          }],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not save branch mapping.')
      setMessage(`${branch.name || 'Branch'} is linked. Next, activate the Companion tablet.`)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not save branch mapping.')
    } finally {
      setSaving(false)
    }
  }

  const loadPOS = async () => {
    if (!isPro || !slug || !authFetch) return
    setLoading(true)
    setError('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos?provider=${encodeURIComponent(provider)}`, {
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
      setStoreHubOutlets(data.storehub_connection?.outlets || (provider === 'storehub' ? data.integration?.config?.storehub_outlets : []) || [])
      setLoyverseConnection(data.loyverse_connection || null)
      setLoyverseStores(data.loyverse_connection?.stores || (provider === 'loyverse' ? data.integration?.config?.loyverse_stores : []) || [])
      setLoyaltyContract(data.loyalty_contract || null)
      if (data.redemption_config) setRedemptionConfig(data.redemption_config)
      if (data.storehub_connection?.store_name) {
        setStoreHubCredentials(current => ({ ...current, store_name: data.storehub_connection.store_name }))
      }

      const mappings = {}
      ;(data.branch_mappings || []).forEach(row => {
        if (!row.branch_public_id) return
        mappings[row.branch_public_id] = {
          external_branch_id: row.external_branch_id || '',
          external_branch_name: row.external_branch_name || '',
          saved_mapping: true,
          device_model: row.settings?.device_model || 'other',
          scanner_method: row.settings?.scanner_method || 'external_scanner',
          performance_note: row.settings?.performance_note || '',
          checkout_mode: row.settings?.checkout_mode || 'auto',
          effective_checkout_mode: row.settings?.effective_checkout_mode || 'pending_test',
          seamless_last_test_passed: row.settings?.seamless_last_test_passed === true,
          seamless_simulator_passed: row.settings?.seamless_simulator_passed === true,
          seamless_last_test_at: row.settings?.seamless_last_test_at || null,
          seamless_last_test_reason: row.settings?.seamless_last_test_reason || '',
          last_test_passed: row.settings?.last_test_passed === true,
          last_test_at: row.settings?.last_test_at || null,
        }
      })
      setBranchMappings(mappings)

      const status = String(data.integration?.status || '').toLowerCase()
      const credentialsSaved = provider === 'loyverse'
        ? Boolean(data.loyverse_connection?.credentials_saved || data.integration?.config?.real_api_tested)
        : Boolean(data.storehub_connection?.credentials_saved || data.integration?.config?.real_api_tested)
      const simulatorConnected = provider === 'storehub' && data.integration?.mode === 'test' && data.integration?.config?.simulator === true
      if (status === 'live') setSetupStep(7)
      else if (!credentialsSaved && !simulatorConnected) setSetupStep(1)
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
    setMessage('')
    setError('')
    setTestResult(null)
    setRedemptionResult(null)
    setRedemptionStage('idle')
    setBranchMappings({})
    loadPOS()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, slug, provider])

  useEffect(() => {
    if (!quickBranchId && branches[0]?.public_id) setQuickBranchId(branches[0].public_id)
  }, [branches, quickBranchId])

  useEffect(() => {
    setQuickOutletId('')
    if (isConnected) loadCompanionDevices()
    else {
      setCompanionDevices([])
      setActivationCodeInfo(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, slug, provider])

  const startStoreHubSimulator = async () => {
    if (!slug) return
    setSaving(true); setError(''); setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/integrations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'storehub', mode: 'test' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not start StoreHub simulator.')
      setIntegration(data.integration || null)
      setSetupStep(2)
      setMessage('StoreHub simulator ready. Map one ANGKAN branch and run the full earning/redemption flow.')
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not start StoreHub simulator.')
    } finally { setSaving(false) }
  }

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
        body: JSON.stringify({ provider }),
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

  const connectLoyverse = async () => {
    if (!slug) return
    const apiToken = loyverseCredentials.api_token.trim()
    if (!apiToken) {
      setError('Enter the Loyverse access token.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    setLoyverseResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/loyverse/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_token: apiToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not connect Loyverse.')
      setIntegration(data.integration || null)
      setLoyverseResult(data)
      setLoyverseStores(data.stores || [])
      setLoyaltyContract(data.loyalty_contract || null)
      setLoyverseCredentials({ api_token: '' })
      setShowReconnect(false)
      setSetupStep(2)
      setMessage(`Loyverse connected securely. ${data.store_count ?? 0} store(s) detected.`)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not connect Loyverse.')
    } finally {
      setSaving(false)
    }
  }

  const testSavedLoyverseConnection = async () => {
    if (!slug) return
    setSaving(true)
    setError('')
    setMessage('')
    setLoyverseResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/loyverse/connection-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'loyverse' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Loyverse API connection test failed.')
      setLoyverseResult(data)
      setIntegration(data.integration || integration)
      setLoyverseStores(data.stores || [])
      setLoyaltyContract(data.loyalty_contract || loyaltyContract)
      setMessage(`Loyverse API connected. ${data.store_count ?? 0} store(s) detected.`)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Loyverse API connection test failed.')
    } finally {
      setSaving(false)
    }
  }

  const disconnectLoyverse = async () => {
    if (!slug) return
    if (!window.confirm('Disconnect Loyverse credentials? Saved branch mappings will be preserved.')) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/loyverse/disconnect`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not disconnect Loyverse.')
      setIntegration(data.integration || null)
      setLoyverseStores([])
      setLoyverseReceipts([])
      setLoyverseResult(null)
      setLoyverseCredentials({ api_token: '' })
      setSetupStep(1)
      setMessage('Loyverse disconnected. Branch mappings were preserved for reconnecting later.')
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not disconnect Loyverse.')
    } finally {
      setSaving(false)
    }
  }

  const previewLoyverseReceipts = async () => {
    if (!slug) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/loyverse/receipts-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 1, limit: 10 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not read Loyverse receipts.')
      setLoyverseReceipts(data.receipts || [])
      setTestResult({ provider: 'loyverse', preview_ok: true, returned: data.returned ?? 0 })
      setSetupStep(6)
      setMessage(`Read ${data.returned ?? 0} recent Loyverse receipt(s). No loyalty balances changed.`)
    } catch (err) {
      setError(err.message || 'Could not read Loyverse receipts.')
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
          device_model: 'other',
          scanner_method: 'external_scanner',
          checkout_mode: 'auto',
          effective_checkout_mode: 'pending_test',
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
      device_model: branchMappings[branch.public_id]?.device_model || 'other',
      scanner_method: branchMappings[branch.public_id]?.scanner_method || 'external_scanner',
      checkout_mode: branchMappings[branch.public_id]?.checkout_mode || 'auto',
    })).filter(row => row.external_branch_id || row.external_branch_name)

    if (!mappings.length) {
      setError(`Map at least one Loyalty Tree branch to a ${providerLabel} ${locationLabel}.`)
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/branch-mappings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, mappings }),
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

  const testSeamlessCheckout = async branchPublicId => {
    if (!slug || provider !== 'storehub') return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/seamless-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch_public_id: branchPublicId,
          checkout_mode: branchMappings[branchPublicId]?.checkout_mode || 'auto',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not test seamless StoreHub checkout.')
      const settings = data.branch_mapping?.settings || {}
      setBranchMappings(current => ({
        ...current,
        [branchPublicId]: {
          ...(current[branchPublicId] || {}),
          checkout_mode: settings.checkout_mode || current[branchPublicId]?.checkout_mode || 'auto',
          effective_checkout_mode: settings.effective_checkout_mode || data.effective_mode || 'pending_test',
          seamless_last_test_passed: settings.seamless_last_test_passed === true,
          seamless_simulator_passed: settings.seamless_simulator_passed === true,
          seamless_last_test_at: settings.seamless_last_test_at || null,
          seamless_last_test_reason: settings.seamless_last_test_reason || data.message || '',
        },
      }))
      if (data.provider_ready) {
        setMessage('Seamless StoreHub checkout is verified for this branch.')
      } else if (data.simulated_ready) {
        setMessage('Loyalty Tree seamless flow passed in simulator. Live StoreHub write access is still unverified, so Automatic mode will use Companion fallback for production.')
      } else {
        setMessage(data.message || 'Seamless checkout is not verified. Companion fallback is ready.')
      }
    } catch (err) {
      setError(err.message || 'Could not test seamless StoreHub checkout.')
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
        body: JSON.stringify({ provider, ...patch }),
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
            `${provider.toUpperCase()}-TEST-${Date.now()}`,
          branch_public_id: testForm.branch_public_id || null,
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

  const saveRedemptionSettings = async () => {
    const ok = await saveSetupSettings({
      redemption_enabled: true,
      redemption_value_per_point: Number(redemptionConfig.value_per_point || 1),
      redemption_min_points: Number(redemptionConfig.min_points || 1),
      redemption_increment_points: Number(redemptionConfig.increment_points || 1),
      redemption_max_percent: Number(redemptionConfig.max_percent || 100),
      reservation_hold_minutes: Number(redemptionConfig.hold_minutes || 10),
      earn_on_net_amount: redemptionConfig.earn_on_net_amount !== false,
    })
    if (ok) {
      setRedemptionConfig(current => ({ ...current, enabled: true }))
      setSetupStep(6)
      setMessage('StoreHub redemption simulator enabled.')
      await loadPOS()
    }
  }

  const reserveRedemption = async () => {
    if (!slug) return
    const gross = Number(redemptionForm.gross_amount)
    const points = Number(redemptionForm.points_to_redeem)
    if (!redemptionForm.customer_public_id.trim()) {
      setError('Enter a Loyalty Tree customer ID for redemption testing.')
      return
    }
    if (!Number.isFinite(gross) || gross <= 0 || !Number.isInteger(points) || points <= 0) {
      setError('Enter a valid gross amount and whole-number points to redeem.')
      return
    }
    setSaving(true); setError(''); setMessage(''); setRedemptionResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/redemptions/reserve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: redemptionForm.customer_public_id.trim(),
          gross_amount: gross,
          points_to_redeem: points,
          branch_public_id: redemptionForm.branch_public_id || null,
          reservation_key: `LT-RED-${Date.now()}`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not reserve points.')
      setRedemptionResult(data)
      setRedemptionStage('reserved')
      setMessage(data.message || 'Points reserved.')
    } catch (err) {
      setError(err.message || 'Could not reserve points.')
    } finally { setSaving(false) }
  }

  const applyRedemptionDiscount = async () => {
    const reservationId = redemptionResult?.reservation?.id
    if (!reservationId) return
    const txId = redemptionForm.external_transaction_id.trim() || `STOREHUB-RED-${Date.now()}`
    setRedemptionForm(current => ({ ...current, external_transaction_id: txId }))
    setSaving(true); setError(''); setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/redemptions/${reservationId}/apply-discount`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_transaction_id: txId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not apply StoreHub discount.')
      setRedemptionResult(current => ({ ...(current || {}), ...data }))
      setRedemptionStage('discount_applied')
      setMessage(data.message || 'StoreHub discount applied in simulator.')
    } catch (err) {
      setError(err.message || 'Could not apply StoreHub discount.')
    } finally { setSaving(false) }
  }

  const completeRedemptionSale = async () => {
    const reservationId = redemptionResult?.reservation?.id
    if (!reservationId) return
    const txId = redemptionForm.external_transaction_id.trim() || `STOREHUB-RED-${Date.now()}`
    setSaving(true); setError(''); setMessage(''); setTestResult(null)
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/test-transaction`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: redemptionForm.customer_public_id.trim(),
          amount_spent: Number(redemptionForm.gross_amount),
          external_transaction_id: txId,
          branch_public_id: redemptionForm.branch_public_id || null,
          redemption_reservation_id: reservationId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not complete StoreHub redemption test.')
      setTestResult(data)
      setRedemptionStage('completed')
      setRedemptionResult(current => ({ ...(current || {}), completed_sale: data }))
      setMessage('Redemption + net-amount earning test passed.')
      setSetupStep(6)
      await loadPOS()
    } catch (err) {
      setError(err.message || 'Could not complete StoreHub redemption test.')
    } finally { setSaving(false) }
  }

  const releaseRedemption = async () => {
    const reservationId = redemptionResult?.reservation?.id
    if (!reservationId) return
    setSaving(true); setError(''); setMessage('')
    try {
      const res = await call(`${API_BASE}/api/v1/business/${slug}/pos/storehub/redemptions/${reservationId}/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'checkout_cancelled_in_simulator' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not release points.')
      setRedemptionResult(data)
      setRedemptionStage('released')
      setMessage('Reserved points released. Customer balance was not deducted.')
    } catch (err) {
      setError(err.message || 'Could not release points.')
    } finally { setSaving(false) }
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
        body: JSON.stringify({ provider }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `Could not activate ${providerLabel} integration.`)

      setIntegration(data.integration || {
        ...(integration || {}),
        status: 'live',
      })
      setSetupStep(7)
      setMessage(`${providerLabel} integration is live.`)
    } catch (err) {
      setError(err.message || `Could not activate ${providerLabel} integration.`)
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

  const activeCompanionDevices = companionDevices.filter(device => !device?.revoked_at)
  const hasSavedMapping = Object.values(branchMappings).some(row => row?.saved_mapping)
  const quickBranch = branches.find(item => item.public_id === quickBranchId) || branches[0] || null
  const activeDevicesForQuickBranch = activeCompanionDevices.filter(device =>
    !quickBranch?.public_id || String(device?.branch_public_id || '') === String(quickBranch.public_id)
  )
  const quickStep = !isConnected
    ? 1
    : !hasSavedMapping
      ? 2
      : activeDevicesForQuickBranch.length
        ? 4
        : 3

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
          <QuickCompanionSetup
            step={quickStep}
            provider={provider}
            setProvider={setProvider}
            apiAvailable={apiAvailable}
            saving={saving}
            isConnected={isConnected}
            simulatorReady={simulatorReady}
            startStoreHubSimulator={startStoreHubSimulator}
            branches={branches}
            quickBranch={quickBranch}
            quickBranchId={quickBranchId}
            setQuickBranchId={setQuickBranchId}
            providerLabel={providerLabel}
            locationLabel={locationLabel}
            providerLocations={providerLocations}
            quickOutletId={quickOutletId}
            setQuickOutletId={setQuickOutletId}
            saveQuickBranchMapping={saveQuickBranchMapping}
            activationCodeInfo={activationCodeInfo}
            newDeviceName={newDeviceName}
            setNewDeviceName={setNewDeviceName}
            generateCompanionActivationCode={generateCompanionActivationCode}
            loadCompanionDevices={loadCompanionDevices}
            activeCompanionDevices={activeDevicesForQuickBranch}
            copyText={copyText}
            API_BASE={API_BASE}
          />

          {copyState && <div style={{...s.successBanner,padding:'8px 11px'}}>{copyState}</div>}

          <details style={s.advancedPanel}>
            <summary style={s.advancedSummary}>Advanced POS setup & diagnostics</summary>
            <div style={s.advancedBody}>
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
                <div style={s.infoBanner}>
                  <b>Want to test before StoreHub gives API access?</b> Start Simulator Mode. It uses the same branch mapping, point reservation, net-amount earning and Wallet flow, but the StoreHub discount call is simulated.
                  <div style={{marginTop:8}}>
                    <button type="button" style={s.secondaryButton} disabled={saving || !apiAvailable} onClick={startStoreHubSimulator}>
                      {saving ? 'Starting…' : 'Start StoreHub simulator'}
                    </button>
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

            {activeProvider.id === 'loyverse' && !isConnected && (
              <div style={{marginTop:18,display:'grid',gap:12}}>
                <div style={s.ruleBox}>
                  <b>Connect your Loyverse account</b>
                  <div style={s.smallMuted}>
                    Create a personal access token in Loyverse Back Office → Access Tokens. Loyalty Tree encrypts it before saving.
                  </div>
                </div>
                {!loyverseConnection?.encryption_configured && (
                  <div style={s.infoBanner}>
                    Platform setup required: add <code>POS_CREDENTIALS_ENCRYPTION_KEY</code> once to the Loyalty Tree backend environment.
                  </div>
                )}
                <label style={{display:'grid',gap:6,maxWidth:620}}>
                  <span style={s.smallMuted}>Loyverse personal access token</span>
                  <input
                    style={s.input}
                    type="password"
                    placeholder="Paste Loyverse access token"
                    autoComplete="new-password"
                    value={loyverseCredentials.api_token}
                    onChange={e => setLoyverseCredentials({ api_token: e.target.value })}
                  />
                </label>
                <div style={s.actionRow}>
                  <button
                    type="button"
                    style={s.primaryButton}
                    disabled={saving || !apiAvailable || !loyverseConnection?.encryption_configured}
                    onClick={connectLoyverse}
                  >
                    {saving ? 'Testing…' : 'Test & connect Loyverse'}
                  </button>
                  <span style={s.smallMuted}>
                    We validate the token against Loyverse's official <code>/stores</code> API before saving it.
                  </span>
                </div>
              </div>
            )}
          </section>

          {isConnected && provider === 'storehub' && (
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

          {isConnected && provider === 'loyverse' && (
            <section style={s.card}>
              <div style={s.sectionHeader}>
                <div>
                  <div style={s.stepLabel}>LOYVERSE ACCOUNT</div>
                  <h3 style={s.sectionTitle}>Connected securely</h3>
                </div>
                <span style={s.connectedPill}>Connected</span>
              </div>
              <div style={s.ruleBox}>
                <b>{integration?.external_account_name || loyverseConnection?.account_name || 'Loyverse'}</b>
                <div style={s.smallMuted}>
                  Access token: •••••••••••• · Stored encrypted on Loyalty Tree's backend
                </div>
              </div>

              {showReconnect && (
                <div style={{marginTop:12,display:'grid',gap:10}}>
                  <input
                    style={s.input}
                    type="password"
                    placeholder="New Loyverse access token"
                    autoComplete="new-password"
                    value={loyverseCredentials.api_token}
                    onChange={e => setLoyverseCredentials({ api_token: e.target.value })}
                  />
                  <button type="button" style={s.primaryButton} disabled={saving} onClick={connectLoyverse}>
                    {saving ? 'Testing…' : 'Test & replace token'}
                  </button>
                </div>
              )}

              <div style={s.actionRow}>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={testSavedLoyverseConnection}>
                  Test saved connection
                </button>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={previewLoyverseReceipts}>
                  Preview recent receipts
                </button>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={() => setShowReconnect(value => !value)}>
                  {showReconnect ? 'Cancel reconnect' : 'Reconnect / change token'}
                </button>
                <button type="button" style={s.secondaryButton} disabled={saving} onClick={disconnectLoyverse}>
                  Disconnect
                </button>
              </div>

              {!!loyverseStores.length && (
                <div style={{marginTop:14}}>
                  <b style={{fontSize:13}}>Detected Loyverse stores</b>
                  <div style={{marginTop:8,display:'grid',gap:6}}>
                    {loyverseStores.slice(0,20).map((store, index) => (
                      <div key={store.id || index} style={s.resultItem}>
                        <b>{store.name || store.id || `Store ${index + 1}`}</b>
                        {store.id && <div style={s.smallMuted}>ID: {store.id}</div>}
                        {(store.city || store.address) && (
                          <div style={s.smallMuted}>{[store.address, store.city].filter(Boolean).join(' · ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!loyverseReceipts.length && (
                <div style={{marginTop:14}}>
                  <b style={{fontSize:13}}>Recent Loyverse receipts · read-only</b>
                  <div style={{marginTop:8,display:'grid',gap:7}}>
                    {loyverseReceipts.map((tx, index) => (
                      <div key={tx.receipt_number || index} style={s.resultItem}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                          <b>{tx.receipt_number || `Receipt ${index + 1}`}</b>
                          <b>{tx.total_money === null || tx.total_money === undefined ? '—' : `₱${Number(tx.total_money).toFixed(2)}`}</b>
                        </div>
                        <div style={s.smallMuted}>
                          Store: {tx.store_id || '—'} · Customer: {tx.customer_id || 'none'} · {tx.receipt_date || ''}
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
                <h3 style={s.sectionTitle}>Match Loyalty Tree branches to {providerLabel} {provider === 'loyverse' ? 'stores' : 'outlets'}</h3>
                <p style={s.muted}>
                  Each POS transaction must resolve to the correct Loyalty Tree branch.
                </p>

                {branches.length ? (
                  <div style={s.mappingList}>
                    {branches.map(branch => (
                      <div key={branch.public_id} style={s.mappingRow}>
                        <div>
                          <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}>
                            <b>{branch.name}</b>
                            {branchMappings[branch.public_id]?.last_test_passed && <span style={s.connectedPill}>Test passed</span>}
                          </div>
                          <div style={s.smallMuted}>{branch.address || 'Loyalty Tree branch'}</div>
                          {branchMappings[branch.public_id]?.last_test_at && <div style={s.smallMuted}>Last tested: {new Date(branchMappings[branch.public_id].last_test_at).toLocaleString()}</div>}
                        </div>
                        <div style={s.arrow}>↔</div>
                        <div style={s.mappingFields}>
                          {providerLocations.length ? (
                            <select
                              style={s.input}
                              value={branchMappings[branch.public_id]?.external_branch_id || ''}
                              onChange={e => {
                                const selected = providerLocations.find(item => String(item.id) === e.target.value)
                                updateMapping(branch.public_id, 'external_branch_id', e.target.value)
                                updateMapping(branch.public_id, 'external_branch_name', selected?.name || '')
                              }}
                            >
                              <option value="">Choose {providerLabel} {locationLabel}…</option>
                              {providerLocations.map((outlet, index) => (
                                <option key={outlet.id || index} value={String(outlet.id || '')}>
                                  {outlet.name || outlet.id || `Outlet ${index + 1}`}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <>
                              <input
                                style={s.input}
                                placeholder={`${providerLabel} ${locationLabel} ID`}
                                value={branchMappings[branch.public_id]?.external_branch_id || ''}
                                onChange={e => updateMapping(branch.public_id, 'external_branch_id', e.target.value)}
                              />
                              <input
                                style={s.input}
                                placeholder={`${providerLabel} ${locationLabel} name`}
                                value={branchMappings[branch.public_id]?.external_branch_name || ''}
                                onChange={e => updateMapping(branch.public_id, 'external_branch_name', e.target.value)}
                              />
                            </>
                          )}
                          {provider === 'storehub' && (
                            <>
                              <select
                                style={s.input}
                                value={branchMappings[branch.public_id]?.device_model || 'other'}
                                onChange={e => {
                                  const profile = POS_DEVICE_PROFILES.find(item => item.id === e.target.value) || POS_DEVICE_PROFILES[POS_DEVICE_PROFILES.length - 1]
                                  updateMapping(branch.public_id, 'device_model', e.target.value)
                                  updateMapping(branch.public_id, 'scanner_method', profile.scanner)
                                  updateMapping(branch.public_id, 'performance_note', profile.note)
                                }}
                              >
                                {POS_DEVICE_PROFILES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                              </select>
                              <select
                                style={s.input}
                                value={branchMappings[branch.public_id]?.scanner_method || 'external_scanner'}
                                onChange={e => updateMapping(branch.public_id, 'scanner_method', e.target.value)}
                              >
                                {SCANNER_METHODS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                              </select>
                              <div style={s.smallMuted}>
                                {(POS_DEVICE_PROFILES.find(item => item.id === (branchMappings[branch.public_id]?.device_model || 'other')) || POS_DEVICE_PROFILES[POS_DEVICE_PROFILES.length - 1]).note}
                              </div>

                              <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid #e2e8f0'}}>
                                <div style={{fontWeight:800,fontSize:12,marginBottom:6}}>Checkout integration method</div>
                                <select
                                  style={s.input}
                                  value={branchMappings[branch.public_id]?.checkout_mode || 'auto'}
                                  onChange={e => updateMapping(branch.public_id, 'checkout_mode', e.target.value)}
                                >
                                  {CHECKOUT_MODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                                </select>
                                <div style={{...s.smallMuted,marginTop:5}}>
                                  {(CHECKOUT_MODES.find(item => item.id === (branchMappings[branch.public_id]?.checkout_mode || 'auto')) || CHECKOUT_MODES[0]).note}
                                </div>
                                <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
                                  <button
                                    type="button"
                                    style={s.secondaryButton}
                                    disabled={saving || !branchMappings[branch.public_id]?.saved_mapping}
                                    onClick={() => testSeamlessCheckout(branch.public_id)}
                                  >
                                    {saving ? 'Testing…' : 'Test seamless checkout'}
                                  </button>
                                  {branchMappings[branch.public_id]?.effective_checkout_mode === 'seamless' && <span style={s.connectedPill}>Seamless verified</span>}
                                  {branchMappings[branch.public_id]?.effective_checkout_mode === 'companion' && <span style={s.warningPill}>Companion fallback</span>}
                                  {branchMappings[branch.public_id]?.effective_checkout_mode === 'blocked' && <span style={s.errorPill}>Seamless blocked</span>}
                                  {branchMappings[branch.public_id]?.seamless_simulator_passed && !branchMappings[branch.public_id]?.seamless_last_test_passed && <span style={s.availablePill}>LT simulator passed</span>}
                                </div>
                                {!branchMappings[branch.public_id]?.saved_mapping && (
                                  <div style={{...s.smallMuted,marginTop:6}}>Save the branch mapping first, then run the seamless test.</div>
                                )}
                                {branchMappings[branch.public_id]?.seamless_last_test_reason && (
                                  <div style={{...s.smallMuted,marginTop:6}}>
                                    {branchMappings[branch.public_id].seamless_last_test_reason}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={s.emptyState}>Create at least one branch before mapping {providerLabel}.</div>
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
                      {providerLabel} supplies the purchase transaction. Loyalty Tree remains the
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
                <h3 style={s.sectionTitle}>Reserve → discount → complete sale</h3>
                {provider !== 'storehub' ? (
                  <p style={s.muted}>POS redemption simulator is currently implemented for StoreHub first.</p>
                ) : (
                  <>
                    <p style={s.muted}>
                      Loyalty Tree reserves points first. The StoreHub adapter then applies the checkout discount.
                      Points are deducted only after the POS sale is confirmed, and new points are earned on the net paid amount.
                    </p>
                    <div style={s.ruleBox}>
                      <b>ANGKAN default</b>
                      <div style={s.smallMuted}>1 point = ₱1 · earn on net amount after redemption · reservation expires automatically.</div>
                    </div>

                    <div style={{...s.testGrid,marginTop:12}}>
                      <label style={s.fieldLabel}>₱ value per point
                        <input style={s.input} type="number" min="0.01" step="0.01" value={redemptionConfig.value_per_point}
                          onChange={e => setRedemptionConfig(c => ({...c,value_per_point:e.target.value}))}/>
                      </label>
                      <label style={s.fieldLabel}>Minimum points
                        <input style={s.input} type="number" min="1" step="1" value={redemptionConfig.min_points}
                          onChange={e => setRedemptionConfig(c => ({...c,min_points:e.target.value}))}/>
                      </label>
                      <label style={s.fieldLabel}>Redemption increment
                        <input style={s.input} type="number" min="1" step="1" value={redemptionConfig.increment_points}
                          onChange={e => setRedemptionConfig(c => ({...c,increment_points:e.target.value}))}/>
                      </label>
                      <label style={s.fieldLabel}>Max % of bill
                        <input style={s.input} type="number" min="1" max="100" step="1" value={redemptionConfig.max_percent}
                          onChange={e => setRedemptionConfig(c => ({...c,max_percent:e.target.value}))}/>
                      </label>
                    </div>
                    <ChoiceRow
                      checked={redemptionConfig.earn_on_net_amount !== false}
                      label="Earn on NET amount after redemption"
                      description="Recommended: a ₱485 bill less ₱100 redemption earns points from ₱385."
                    />
                    <button type="button" style={s.secondaryButton} disabled={saving || !apiAvailable} onClick={saveRedemptionSettings}>
                      {saving ? 'Saving…' : (redemptionConfig.enabled ? 'Save redemption rules' : 'Enable redemption simulator')}
                    </button>

                    {redemptionConfig.enabled && (
                      <div style={{marginTop:16,borderTop:'1px solid #e2e8f0',paddingTop:16}}>
                        <b style={{fontSize:13}}>Run the ANGKAN redemption flow</b>
                        <div style={{...s.testGrid,marginTop:10}}>
                          <label style={s.fieldLabel}>Customer ID
                            <input style={s.input} placeholder="customer-public-id" value={redemptionForm.customer_public_id}
                              onChange={e => setRedemptionForm(c => ({...c,customer_public_id:e.target.value}))}/>
                          </label>
                          <label style={s.fieldLabel}>Branch
                            <select style={s.input} value={redemptionForm.branch_public_id}
                              onChange={e => setRedemptionForm(c => ({...c,branch_public_id:e.target.value}))}>
                              <option value="">First active mapped branch</option>
                              {branches.map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}
                            </select>
                          </label>
                          <label style={s.fieldLabel}>Gross StoreHub bill
                            <input style={s.input} type="number" min="0.01" step="0.01" value={redemptionForm.gross_amount}
                              onChange={e => setRedemptionForm(c => ({...c,gross_amount:e.target.value}))}/>
                          </label>
                          <label style={s.fieldLabel}>Points to redeem
                            <input style={s.input} type="number" min="1" step="1" value={redemptionForm.points_to_redeem}
                              onChange={e => setRedemptionForm(c => ({...c,points_to_redeem:e.target.value}))}/>
                          </label>
                          <label style={s.fieldLabel}>StoreHub transaction ID
                            <input style={s.input} placeholder="Generated when discount is applied" value={redemptionForm.external_transaction_id}
                              onChange={e => setRedemptionForm(c => ({...c,external_transaction_id:e.target.value}))}/>
                          </label>
                        </div>
                        <div style={s.actionRow}>
                          <button type="button" style={s.primaryButton} disabled={saving || !['idle','released','completed'].includes(redemptionStage)} onClick={reserveRedemption}>1 · Reserve points</button>
                          <button type="button" style={s.secondaryButton} disabled={saving || redemptionStage !== 'reserved'} onClick={applyRedemptionDiscount}>2 · Apply StoreHub discount</button>
                          <button type="button" style={s.primaryButton} disabled={saving || redemptionStage !== 'discount_applied'} onClick={completeRedemptionSale}>3 · Complete sale</button>
                          <button type="button" style={s.secondaryButton} disabled={saving || !['reserved','discount_applied'].includes(redemptionStage)} onClick={releaseRedemption}>Cancel / release</button>
                        </div>

                        {redemptionResult?.reservation && (
                          <div style={s.testResult}>
                            <b>Redemption: {String(redemptionStage).replaceAll('_',' ')}</b>
                            <div style={s.resultGrid}>
                              <ResultItem label="Reserved" value={`${redemptionResult.reservation.points_reserved ?? 0} pts`} />
                              <ResultItem label="Discount" value={`₱${Number(redemptionResult.reservation.redemption_amount || 0).toFixed(2)}`} />
                              <ResultItem label="Gross" value={`₱${Number(redemptionResult.reservation.gross_amount || 0).toFixed(2)}`} />
                              <ResultItem label="Net" value={`₱${Number(redemptionResult.reservation.net_amount || 0).toFixed(2)}`} />
                            </div>
                          </div>
                        )}
                        {redemptionResult?.completed_sale && (
                          <div style={s.testResult}>
                            <b>✓ Full redemption flow passed</b>
                            <div style={s.resultGrid}>
                              <ResultItem label="Points redeemed" value={redemptionResult.completed_sale.points_redeemed ?? '—'} />
                              <ResultItem label="Points earned" value={redemptionResult.completed_sale.points_earned ?? '—'} />
                              <ResultItem label="Final balance" value={redemptionResult.completed_sale.points_balance ?? '—'} />
                              <ResultItem label="Wallet" value={redemptionResult.completed_sale.wallet_sync_status || 'Queued'} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>

              {provider === 'storehub' ? (
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
                    Loyalty Tree branch
                    <select
                      style={s.input}
                      value={testForm.branch_public_id || ''}
                      onChange={e => setTestForm(current => ({ ...current, branch_public_id: e.target.value }))}
                    >
                      <option value="">First active mapped branch</option>
                      {branches.map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}
                    </select>
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
                      <ResultItem label="Gross" value={`₱${Number(testResult.gross_amount ?? testResult.amount_spent ?? testForm.amount_spent ?? 0).toFixed(2)}`} />
                      <ResultItem label="Redeemed" value={testResult.points_redeemed ? `${testResult.points_redeemed} pts / ₱${Number(testResult.redemption_amount || 0).toFixed(2)}` : 'None'} />
                      <ResultItem label="Net / eligible" value={`₱${Number(testResult.eligible_amount ?? testResult.net_amount ?? testResult.amount_spent ?? 0).toFixed(2)}`} />
                      <ResultItem label="Points earned" value={testResult.points_earned ?? '—'} />
                      <ResultItem label="Stamps" value={testResult.stamp_count ?? testResult.stamps ?? '—'} />
                      <ResultItem label="Wallet sync" value={testResult.wallet_sync_status || 'Queued'} />
                    </div>
                  </div>
                )}
              </section>
              ) : (
                <section style={s.card}>
                  <div style={s.stepLabel}>6 · API RECEIPT TEST</div>
                  <h3 style={s.sectionTitle}>Read a real Loyverse receipt safely</h3>
                  <p style={s.muted}>
                    This reads recent receipts from Loyverse using the connected token. It does not
                    award Loyalty Tree points yet. We first verify that receipt data includes the
                    Loyverse customer ID, store ID and amount we need for automatic loyalty.
                  </p>
                  <div style={s.ruleBox}>
                    <b>Next milestone</b>
                    <div style={s.smallMuted}>
                      Sync a Loyalty Tree member's QR value into Loyverse <code>customer_code</code>,
                      scan that card in Loyverse POS, then confirm the resulting receipt contains the
                      expected <code>customer_id</code>.
                    </div>
                  </div>
                  <button
                    type="button"
                    style={s.primaryButton}
                    disabled={saving || !apiAvailable}
                    onClick={previewLoyverseReceipts}
                  >
                    {saving ? 'Reading…' : 'Preview recent Loyverse receipts'}
                  </button>
                  {testResult?.provider === 'loyverse' && (
                    <div style={s.testResult}>
                      <b>✓ Loyverse API read test passed</b>
                      <div style={s.smallMuted}>
                        {testResult.returned ?? 0} receipt(s) returned. No Loyalty Tree balance changed.
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section style={s.card}>
                <div style={s.stepLabel}>7 · GO LIVE</div>
                <div style={s.sectionHeader}>
                  <div>
                    <h3 style={s.sectionTitle}>
                      {isLive ? `${providerLabel} integration is live` : `Ready for live ${providerLabel}`}
                    </h3>
                    <p style={s.muted}>
                      {isLive
                        ? `Loyalty Tree is ready to receive supported ${providerLabel} transactions for this business.`
                        : `Activate only after the ${providerLabel} test flow passes and customer matching is verified.`}
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
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function QuickCompanionSetup({
  step,
  provider,
  setProvider,
  apiAvailable,
  saving,
  isConnected,
  simulatorReady,
  startStoreHubSimulator,
  branches,
  quickBranch,
  quickBranchId,
  setQuickBranchId,
  providerLabel,
  locationLabel,
  providerLocations,
  quickOutletId,
  setQuickOutletId,
  saveQuickBranchMapping,
  activationCodeInfo,
  newDeviceName,
  setNewDeviceName,
  generateCompanionActivationCode,
  loadCompanionDevices,
  activeCompanionDevices,
  copyText,
  API_BASE,
}) {
  const current = Math.max(1, Math.min(Number(step || 1), 4))
  const progress = ['Connect POS', 'Link branch', 'Activate', 'Test']

  return (
    <section style={s.quickCard}>
      <div style={s.sectionHeader}>
        <div>
          <div style={s.eyebrow}>SIMPLE SETUP</div>
          <h3 style={{...s.sectionTitle,marginTop:4}}>Loyalty Tree Companion</h3>
          <p style={s.muted}>One step at a time. Advanced settings stay hidden unless you need them.</p>
        </div>
        <span style={s.quickStepPill}>Step {current} of 4</span>
      </div>

      <div style={s.quickProgress}>
        {progress.map((label,index) => {
          const number = index + 1
          const done = number < current
          const active = number === current
          return (
            <div key={label} style={{...s.quickProgressItem,...(active?s.quickProgressActive:{}),...(done?s.quickProgressDone:{})}}>
              <span style={s.quickProgressDot}>{done ? '✓' : number}</span>
              <span>{label}</span>
            </div>
          )
        })}
      </div>

      {current === 1 && (
        <div style={s.quickBody}>
          <div>
            <div style={s.stepLabel}>STEP 1 · CONNECT POS</div>
            <h4 style={s.quickTitle}>Choose how you want to connect</h4>
            <p style={s.muted}>For the ANGKAN test, use StoreHub Simulator. No StoreHub API token is needed yet.</p>
          </div>

          <div style={s.quickProviderRow}>
            <button
              type="button"
              style={{...s.quickChoice,...(provider==='storehub'?s.quickChoiceActive:{})}}
              onClick={() => setProvider('storehub')}
              disabled={isConnected && provider !== 'storehub'}
            >
              <b>StoreHub</b>
              <span>Philippines / Southeast Asia</span>
            </button>
            <button
              type="button"
              style={{...s.quickChoice,...(provider==='loyverse'?s.quickChoiceActive:{})}}
              onClick={() => setProvider('loyverse')}
              disabled={isConnected && provider !== 'loyverse'}
            >
              <b>Loyverse</b>
              <span>Global</span>
            </button>
          </div>

          {provider === 'storehub' ? (
            <button
              type="button"
              style={s.primaryButton}
              disabled={saving || !apiAvailable}
              onClick={startStoreHubSimulator}
            >
              {saving ? 'Starting…' : 'Start StoreHub Simulator'}
            </button>
          ) : (
            <div style={s.infoBanner}>
              Open <b>Advanced POS setup & diagnostics</b> below to enter the Loyverse access token.
            </div>
          )}

          <div style={s.quickHint}>Already have real StoreHub API access? Use Advanced setup below instead of Simulator Mode.</div>
        </div>
      )}

      {current === 2 && (
        <div style={s.quickBody}>
          <div>
            <div style={s.stepLabel}>STEP 2 · LINK BRANCH</div>
            <h4 style={s.quickTitle}>Choose the branch for this tablet</h4>
            <p style={s.muted}>Start with one branch. You can add the rest later.</p>
          </div>

          {!branches.length ? (
            <div style={s.emptyState}>Create at least one Loyalty Tree branch first.</div>
          ) : (
            <>
              <label style={s.fieldLabel}>Loyalty Tree branch
                <select style={s.input} value={quickBranchId || quickBranch?.public_id || ''} onChange={e => setQuickBranchId(e.target.value)}>
                  {branches.map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}
                </select>
              </label>

              {simulatorReady ? (
                <div style={s.ruleBox}>
                  <b>StoreHub Simulator outlet</b>
                  <div style={s.smallMuted}>A test outlet will be linked automatically to {quickBranch?.name || 'this branch'}.</div>
                </div>
              ) : providerLocations.length ? (
                <label style={s.fieldLabel}>{providerLabel} {locationLabel}
                  <select style={s.input} value={quickOutletId} onChange={e => setQuickOutletId(e.target.value)}>
                    <option value="">Choose {providerLabel} {locationLabel}…</option>
                    {providerLocations.map((location,index) => (
                      <option key={location.id || index} value={String(location.id || '')}>
                        {location.name || location.id || `${providerLabel} ${locationLabel} ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div style={s.infoBanner}>
                  No {providerLabel} locations were detected. Use Advanced setup below to enter the location manually.
                </div>
              )}

              <button type="button" style={s.primaryButton} disabled={saving || !apiAvailable} onClick={saveQuickBranchMapping}>
                {saving ? 'Saving…' : `Link ${quickBranch?.name || 'branch'}`}
              </button>
            </>
          )}
        </div>
      )}

      {current === 3 && (
        <div style={s.quickBody}>
          <div>
            <div style={s.stepLabel}>STEP 3 · ACTIVATE COMPANION</div>
            <h4 style={s.quickTitle}>Pair Loyalty Tree with the existing POS</h4>
            <p style={s.muted}>This does not create another StoreHub POS. It pairs Loyalty Tree Companion with the physical POS already using the selected StoreHub outlet.</p>
            <label style={s.fieldLabel}>Device name
              <input style={s.input} value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} placeholder={`${quickBranch?.name || 'Branch'} POS 1`} />
            </label>
          </div>

          {!activationCodeInfo?.activation_code ? (
            <button type="button" style={s.primaryButton} disabled={saving || !apiAvailable} onClick={generateCompanionActivationCode}>
              {saving ? 'Generating…' : 'Pair Existing POS'}
            </button>
          ) : (
            <div style={s.activationBox}>
              <div style={s.stepLabel}>ONE-TIME CODE</div>
              <div style={s.activationCode}>{activationCodeInfo.activation_code}</div>
              <div style={s.smallMuted}>
                {activationCodeInfo.expires_at
                  ? `Valid until ${new Date(activationCodeInfo.expires_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`
                  : 'Valid for about 15 minutes'} · one device
              </div>
              <button type="button" style={s.secondaryButton} onClick={() => copyText(activationCodeInfo.activation_code,'Activation code copied')}>
                Copy code
              </button>
            </div>
          )}

          <div style={s.quickInstructions}>
            {[
              'Open Loyalty Tree Companion on the existing physical POS/tablet that already runs StoreHub.',
              'Enter the 6-digit pairing code.',
              'Loyalty Tree attaches to the saved branch + StoreHub outlet; it does not create or replace a StoreHub POS.',
              'Finish activation, then refresh device status here.',
            ].map((item,index) => (
              <div key={item} style={s.quickInstruction}>
                <span>{index + 1}</span>
                <div>{item}</div>
              </div>
            ))}
          </div>

          <div style={s.actionRow}>
            <button type="button" style={s.secondaryButton} disabled={saving} onClick={loadCompanionDevices}>Refresh device status</button>
            {activationCodeInfo?.activation_code && (
              <button type="button" style={s.secondaryButton} disabled={saving} onClick={generateCompanionActivationCode}>Generate new code</button>
            )}
          </div>

          <details style={s.quickDetails}>
            <summary>Advanced · API server</summary>
            <div style={s.apiServerRow}>
              <code>{API_BASE}</code>
              <button type="button" style={s.miniButton} onClick={() => copyText(API_BASE,'API server copied')}>Copy</button>
            </div>
          </details>
        </div>
      )}

      {current === 4 && (
        <div style={s.quickBody}>
          <div>
            <div style={s.stepLabel}>STEP 4 · TEST</div>
            <h4 style={s.quickTitle}>Run the first checkout test</h4>
            <p style={s.muted}>Loyalty Tree is paired with this existing POS. You can pair another physical POS at the same mapped outlet or validate the cashier flow.</p>
          </div>

          <div style={s.ruleBox}>
            <b>Active POS Devices</b>
            {activeCompanionDevices.length ? activeCompanionDevices.map((device,index) => (
              <div key={device.id || device.public_id || index} style={{marginTop:8,paddingTop:8,borderTop:'1px solid #e2e8f0'}}>
                <strong>{device.display_name || `POS Device ${index + 1}`}</strong>
                <div style={s.smallMuted}>{device.branch_name || 'Branch'} · {device.external_branch_name || device.external_branch_id || providerLabel} · {device.status || 'active'}</div>
              </div>
            )) : <div style={s.smallMuted}>No activated devices yet.</div>}
          </div>

          <label style={s.fieldLabel}>Existing POS name
            <input style={s.input} value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} placeholder={`${quickBranch?.name || 'Branch'} POS 2`} />
          </label>
          <button type="button" style={s.primaryButton} disabled={saving || !apiAvailable} onClick={generateCompanionActivationCode}>
            {saving ? 'Generating…' : '+ Pair Another Existing POS'}
          </button>
          {activationCodeInfo?.activation_code && (
            <div style={s.activationBox}>
              <div style={s.stepLabel}>EXISTING POS PAIRING CODE</div>
              <div style={s.activationCode}>{activationCodeInfo.activation_code}</div>
              <div style={s.smallMuted}>{activationCodeInfo.branch_name || quickBranch?.name} · {activationCodeInfo.external_branch_name || 'mapped POS outlet'} · one device</div>
              <button type="button" style={s.secondaryButton} onClick={() => copyText(activationCodeInfo.activation_code,'Pairing code copied')}>Copy code</button>
            </div>
          )}

          <div style={s.quickInstructions}>
            {[
              'Enable the floating Loyalty Tree bubble.',
              simulatorReady ? 'Open Mock StoreHub POS inside Companion.' : `Open ${providerLabel} on the POS.`,
              'Tap the bubble and scan a real Loyalty Tree Wallet QR.',
              simulatorReady ? 'Create a Completed Sale for ₱420.00.' : 'Complete a small test transaction.',
              'Confirm the receipt matches, loyalty updates once, and the Wallet refreshes.',
            ].map((item,index) => (
              <div key={item} style={s.quickInstruction}>
                <span>{index + 1}</span>
                <div>{item}</div>
              </div>
            ))}
          </div>

          {!!activeCompanionDevices.length && (
            <div style={s.deviceReadyBox}>
              <b>✓ Companion device connected</b>
              {activeCompanionDevices.slice(0,3).map((device,index) => (
                <div key={device.id || index} style={s.smallMuted}>
                  {device.display_name || device.branch_name || `Device ${index + 1}`}
                  {device.branch_name ? ` · ${device.branch_name}` : ''}
                </div>
              ))}
            </div>
          )}

          <button type="button" style={s.secondaryButton} onClick={loadCompanionDevices}>Refresh device status</button>
        </div>
      )}
    </section>
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
  quickCard: {
    background: '#fff',
    border: '1px solid #dbeafe',
    borderRadius: 18,
    padding: 16,
    boxShadow: '0 8px 22px rgba(15,23,42,.04)',
  },
  quickStepPill: {
    fontSize: 10,
    fontWeight: 900,
    padding: '6px 9px',
    borderRadius: 999,
    background: '#ccfbf1',
    color: '#0f766e',
  },
  quickProgress: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
    gap: 7,
    marginTop: 14,
  },
  quickProgressItem: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 9px',
    borderRadius: 10,
    background: '#f8fafc',
    color: '#94a3b8',
    fontSize: 10.5,
    fontWeight: 800,
  },
  quickProgressActive: {
    background: '#f0fdfa',
    color: '#0f766e',
    boxShadow: 'inset 0 0 0 1px #99f6e4',
  },
  quickProgressDone: {
    color: '#0f766e',
  },
  quickProgressDot: {
    flex: '0 0 auto',
    width: 22,
    height: 22,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    background: '#ccfbf1',
    color: '#0f766e',
    fontSize: 10,
    fontWeight: 900,
  },
  quickBody: {
    display: 'grid',
    gap: 12,
    marginTop: 16,
    paddingTop: 14,
    borderTop: '1px solid #f1f5f9',
  },
  quickTitle: {
    margin: '4px 0 5px',
    fontSize: 16,
    color: '#0f172a',
  },
  quickProviderRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
    gap: 8,
  },
  quickChoice: {
    display: 'grid',
    gap: 3,
    textAlign: 'left',
    padding: '11px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 11,
    background: '#fff',
    color: '#0f172a',
    cursor: 'pointer',
  },
  quickChoiceActive: {
    borderColor: '#0d9488',
    background: '#f0fdfa',
    boxShadow: '0 0 0 2px rgba(13,148,136,.08)',
  },
  quickHint: {
    fontSize: 10.5,
    color: '#64748b',
  },
  activationBox: {
    textAlign: 'center',
    padding: 16,
    border: '1px solid #99f6e4',
    borderRadius: 14,
    background: '#f0fdfa',
  },
  activationCode: {
    margin: '5px 0 4px',
    fontSize: 36,
    lineHeight: 1.05,
    letterSpacing: '.12em',
    fontWeight: 950,
    color: '#0f172a',
  },
  quickInstructions: {
    display: 'grid',
    gap: 7,
  },
  quickInstruction: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr',
    gap: 9,
    alignItems: 'start',
    padding: '8px 9px',
    borderRadius: 9,
    background: '#f8fafc',
    color: '#334155',
    fontSize: 11.5,
    lineHeight: 1.45,
  },
  quickDetails: {
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '9px 10px',
    color: '#475569',
    fontSize: 11,
  },
  apiServerRow: {
    marginTop: 9,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: '9px 10px',
    borderRadius: 9,
    background: '#f8fafc',
    overflow: 'hidden',
  },
  miniButton: {
    flex: '0 0 auto',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '5px 8px',
    background: '#fff',
    color: '#334155',
    fontSize: 10,
    fontWeight: 850,
    cursor: 'pointer',
  },
  deviceReadyBox: {
    display: 'grid',
    gap: 4,
    padding: 11,
    borderRadius: 10,
    border: '1px solid #a7f3d0',
    background: '#ecfdf5',
    color: '#047857',
    fontSize: 12,
  },
  advancedPanel: {
    border: '1px dashed #cbd5e1',
    borderRadius: 14,
    background: '#fff',
    padding: '10px 12px',
  },
  advancedSummary: {
    cursor: 'pointer',
    color: '#64748b',
    fontSize: 11.5,
    fontWeight: 850,
  },
  advancedBody: {
    display: 'grid',
    gap: 14,
    marginTop: 14,
  },
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
  warningPill: {
    fontSize: 10,
    fontWeight: 850,
    padding: '5px 8px',
    borderRadius: 999,
    background: '#fff7ed',
    color: '#c2410c',
  },
  errorPill: {
    fontSize: 10,
    fontWeight: 850,
    padding: '5px 8px',
    borderRadius: 999,
    background: '#fef2f2',
    color: '#b91c1c',
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

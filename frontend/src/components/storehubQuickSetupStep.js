// The read-only account/outlet mapping step can complete even when StoreHub
// denies /transactions. Sale and device-pairing steps stay gated.
export function storehubQuickSetupStep({ isConnected, hasSavedMapping, provider, simulatorReady, transactionsVerified, activeDeviceCount }) {
  if (!isConnected) return 1
  if (!hasSavedMapping) return 2
  if (provider === 'storehub' && !simulatorReady && !transactionsVerified) return 1
  return activeDeviceCount > 0 ? 4 : 3
}

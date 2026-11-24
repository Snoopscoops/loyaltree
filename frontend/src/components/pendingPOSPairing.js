// Pairing-only access: the server owns verification, never a client flag.
export const isPendingPOS = device => device?.pairing_status === 'pending_verification' ||
  (device?.metadata?.pairing_verification !== undefined &&
    (device.metadata.pairing_verification !== 'verified' || !String(device.external_terminal_id || '').trim()))

export function mappedPendingBranches(branches, mappings, locations) {
  const known = new Set((locations || []).map(location => String(location.id || '')))
  return (branches || []).filter(branch => {
    const mapping = mappings[branch.public_id]
    return branch.is_active !== false && mapping?.saved_mapping === true && mapping.is_active !== false &&
      Boolean(mapping.external_branch_id) && known.has(String(mapping.external_branch_id))
  })
}

const ACTIVE = new Set(['queued', 'processing'])
const STATUSES = new Set([...ACTIVE, 'completed', 'failed'])
const count = value => Number.isSafeInteger(value) && value >= 0

// Counts describe server preparation and queueing, never delivery to a device.
export function validCardUpgradeSnapshot(value) {
  if (!value || typeof value.available !== 'boolean' || !['total_cards', 'eligible_cards', 'enabled_cards'].every(key => count(value[key]))) return false
  if (value.eligible_cards > value.total_cards || value.enabled_cards > value.total_cards) return false
  if (value.rollout == null) return true
  const job = value.rollout
  return !!job && typeof job.id === 'string' && !!job.id && STATUSES.has(job.status)
    && ['total', 'scanned', 'queued', 'failed', 'remaining'].every(key => count(job[key]))
    && job.scanned <= job.total && job.remaining <= job.total
    && (job.error_type == null || typeof job.error_type === 'string')
}

export const cardUpgradeActive = snapshot => ACTIVE.has(snapshot?.rollout?.status)
export const cardUpgradeShouldPoll = (snapshot, visibility = 'visible') => cardUpgradeActive(snapshot) && visibility === 'visible'

export function cardUpgradeProgress(snapshot) {
  const job = snapshot?.rollout
  if (!job) return null
  const percent = job.total ? Math.min(100, Math.floor(job.scanned / job.total * 100)) : job.status === 'completed' ? 100 : 0
  const label = job.status === 'queued' ? 'Update request queued'
    : job.status === 'processing' ? 'Preparing card updates'
      : job.status === 'failed' ? 'Some card updates need another attempt'
        : job.failed > 0 ? 'Preparation finished with some failures'
          : 'Card updates queued'
  return { percent, label, canRetry: !cardUpgradeActive(snapshot) && (job.status === 'failed' || job.failed > 0) }
}

// Sample member data for the editor only. Publishing uses the existing
// loyalty-config and wallet-class endpoints, never these preview values.
export function buildWalletPassPreview(form = {}, { businessName = 'Your Business', tier = {}, stampValue = '', stampProgress = [], sampleStamps = null } = {}) {
  const number = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
  const field = (label, value) => ({ label, value: String(value) })
  const type = form.card_type || 'stamp'
  const hybrid = type === 'hybrid'
  const pointsEnabled = type === 'points' || (hybrid && form.hybrid_points_enabled !== false)
  const stampsEnabled = type === 'stamp' || (hybrid && form.hybrid_stamps_enabled === true)
  const employee = type === 'employee' || (type === 'membership' && form.membership_employee_mode === true)
  const stampGoal = Math.max(1, number(form.stamp_goal, 8))
  const stamps = Math.min(stampGoal, Math.max(0, sampleStamps === null ? Math.min(5, stampGoal) : Number(sampleStamps) || 0))
  const milestones = (form.stamp_rewards || []).filter(item => number(item?.stamps, 0) > 0).slice().sort((a, b) => Number(a.stamps) - Number(b.stamps))
  const nextStamp = milestones.find(item => Number(item.stamps) >= stamps) || milestones.at(-1)
  const stampRewardName = nextStamp?.reward_name || form.reward_name || 'Reward'
  const stampRemaining = Math.max(0, number(nextStamp?.stamps, stampGoal) - stamps)
  const stampReward = `${stampRewardName} · ${stampRemaining ? `${stampRemaining} stamps to go` : 'Ready to redeem'}`
  const prizes = (form.points_prizes || []).filter(item => number(item?.points_cost, 0) > 0).slice().sort((a, b) => Number(a.points_cost) - Number(b.points_cost))
  let points = prizes.length ? Math.max(1, Math.round(Number(prizes[0].points_cost) * .58)) : 240
  if (number(form.points_cap_limit, 0)) points = Math.min(points, Number(form.points_cap_limit))
  const nextPoints = prizes.find(item => Number(item.points_cost) >= points) || prizes.at(-1)
  const pointsReward = nextPoints
    ? `${nextPoints.name || 'Reward'} · ${Number(nextPoints.points_cost) <= points ? 'Ready to redeem' : `${Number(nextPoints.points_cost) - points} points to go`}`
    : 'Ask in-store for rewards'
  const membershipValidity = `${number(form.membership_duration_days, 30)} days after activation`
  const sessions = Math.min(200, Math.max(2, number(form.multipass_session_count, 12)))
  const remaining = sessions - Math.ceil(sessions / 3)
  const tierUsesStamps = type === 'vip' ? form.vip_progression_type === 'stamps' : form.hybrid_tier_progression_type !== 'points'
  const tierBalance = Math.max(0, Number(tier.threshold) || 0)
  const tierUnit = tierUsesStamps ? 'stamps' : 'points'
  const stampBalance = stampValue || `${stamps} / ${stampGoal}`
  let metric = field('STAMPS', stampBalance)
  let secondaryMetric = null
  let appleFields = [field('NEXT REWARD', stampReward), metric]
  let auxiliaryFields = []
  let details = [field('NEXT REWARD', stampReward), field('HOW TO EARN', `1 stamp per qualifying visit${form.stamp_once_per_day ? ' · max 1/day' : ''}`)]

  if (pointsEnabled) {
    metric = field('POINTS', points.toLocaleString('en-US'))
    appleFields = [field('NEXT REWARD', pointsReward), metric]
    details = [field('NEXT REWARD', pointsReward), field('HOW TO EARN', `${number(form.points_per_amount, 10)} points per ₱${number(form.points_amount_pesos, 100)} spent`)]
    if (form.points_notes) details.push(field('POINTS NOTES', form.points_notes))
  }
  if (type === 'multipass') {
    metric = field('SESSIONS', `${remaining} / ${sessions}`)
    appleFields = [field('EXPIRES', `${number(form.multipass_validity_days, 90)} days after purchase`), metric]
    details = [field('SESSIONS LEFT', `${remaining} of ${sessions}`), field('VALID UNTIL', `${number(form.multipass_validity_days, 90)} days after purchase`)]
  } else if (type === 'vip') {
    metric = field(tierUsesStamps ? 'TIER STAMPS' : 'VIP PTS', tierBalance.toLocaleString('en-US'))
    const tierField = field('VIP TIER', tier.name || 'Member')
    if (tierUsesStamps) secondaryMetric = tierField
    appleFields = [tierField, field(tierUsesStamps ? 'TIER STAMPS' : 'TIER POINTS', metric.value)]
    details = [tierField, field('TIER PROGRESS', `${tierBalance.toLocaleString('en-US')} ${tierUnit}`)]
  } else if (type === 'employee') {
    metric = field('EMPLOYEE ID', 'EMP-001')
    secondaryMetric = field('STATUS', 'ACTIVE')
    appleFields = [field('EMPLOYEE', 'Sample Member'), field('ID NUMBER', 'EMP-001')]
    auxiliaryFields = [field('STARTED', 'Sample date'), field('BIRTHDAY', 'Sample date')]
    details = [field('EMPLOYEE ID', 'EMP-001'), field('NAME', 'Sample Member')]
  } else if (type === 'membership') {
    metric = field(employee ? 'EMPLOYEE ID' : 'STATUS', employee ? 'EMP-001' : 'ACTIVE')
    appleFields = [field('STATUS', 'ACTIVE'), field('VALID UNTIL', membershipValidity)]
    details = [field(employee ? 'EMPLOYEE MEMBERSHIP' : 'MEMBERSHIP', form.membership_name || 'Membership'), ...appleFields]
  } else if (hybrid) {
    secondaryMetric = field('STATUS', 'ACTIVE')
    appleFields = [metric, secondaryMetric]
    auxiliaryFields = [field('VALID UNTIL', membershipValidity)]
    if (stampsEnabled && pointsEnabled) {
      auxiliaryFields.unshift(field('REWARD STAMPS', stampProgress.join(' ') || stampBalance))
      details.push(field('REWARD STAMPS', stampProgress.join(' ') || stampBalance), field('NEXT STAMP REWARD', stampReward))
    }
    details.push(field('MEMBERSHIP', form.membership_name || 'Membership'), field('STATUS', 'ACTIVE'), field('VALID UNTIL', membershipValidity))
    if (form.hybrid_tier_enabled === true) details.push(field('CURRENT TIER', tier.name || 'Member'))
  }

  if (type === 'stamp' && stampProgress.length > 1) auxiliaryFields = [field('STAMP PROGRESS', stampProgress.join(' '))]
  const benefits = type === 'employee' ? form.employee_benefits : (form.membership_benefits?.length ? form.membership_benefits : form.membership_services)
  if (employee || type === 'membership' || hybrid) {
    ;(benefits || []).slice(0, 4).forEach(item => {
      const name = typeof item === 'string' ? item : item?.name
      if (name) details.push(field(employee ? 'EMPLOYEE BENEFIT' : 'BENEFIT', name))
    })
  }
  if (type === 'vip' || (hybrid && form.hybrid_tier_enabled === true)) {
    if (Number(tier.discount_percent) > 0) details.push(field('TIER BENEFIT', `${tier.discount_percent}% discount`))
    ;(tier.benefits || []).filter(Boolean).slice(0, 4).forEach(value => details.push(field('TIER BENEFIT', value)))
  }
  if (form.description) details.push(field('ABOUT THIS CARD', form.description))
  const actions = (form.wallet_actions || []).slice(0, 5)
    .filter(action => action?.enabled !== false && String(action?.label || '').trim() && /^https:\/\//i.test(String(action?.url || '').trim()))
    .map((action, index) => ({ id: action.id || `action-${index}`, label: String(action.label).trim().slice(0, 40), url: String(action.url).trim().slice(0, 2000), primary: action.primary === true }))
  return {
    title: String(form.card_name || `${businessName} Rewards`), businessName,
    metric, secondaryMetric, appleFields, auxiliaryFields, details, actions,
    primaryAction: actions.find(action => action.primary) || actions[0] || null,
  }
}

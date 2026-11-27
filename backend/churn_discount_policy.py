"""Pure win-back policy: plans candidates, never issues or sends coupons.

The caller must supply verified activity and consent, then atomically claim
each candidate before issuing through the existing campaign coupon pipeline.
"""
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class ChurnPolicy:
    enabled: bool = False
    inactivity_days: int = 30
    discount_percent: int = 10
    validity_days: int = 7
    daily_limit: int = 25

    def __post_init__(self):
        if type(self.enabled) is not bool:
            raise ValueError("enabled must be boolean")
        for key, low, high in (
            ("inactivity_days", 7, 365), ("discount_percent", 1, 100),
            ("validity_days", 1, 30), ("daily_limit", 1, 100),
        ):
            value = getattr(self, key)
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"Invalid {key}")


def plan_winback(policy, members, *, today, business_id, already_claimed=()):
    """One proposal per verified inactive episode, oldest activity first.

    Input must be scoped to this business and use Philippine calendar dates.
    Missing activity or consent fails closed. Claims must be durable and unique;
    this function alone does not prevent concurrent issuance.
    """
    if not policy.enabled:
        return []
    claimed = set(already_claimed)
    cutoff = today - timedelta(days=policy.inactivity_days)
    latest = {}
    blocked = set()
    for member in members:
        if member.get("business_id") != business_id:
            continue
        customer_id = member.get("customer_id")
        if type(customer_id) is not int or customer_id <= 0:
            continue
        if member.get("marketing_allowed") is not True or member.get("active") is not True:
            blocked.add(customer_id)
            continue
        last = member.get("last_verified_activity")
        if type(last) is not date or last > today:
            blocked.add(customer_id)
            continue
        latest[customer_id] = max(last, latest.get(customer_id, last))
    proposals = []
    for customer_id, last in sorted(latest.items(), key=lambda pair: (pair[1], pair[0])):
        if customer_id in blocked or last > cutoff:
            continue
        key = (business_id, customer_id, last.isoformat())
        if key in claimed:
            continue
        proposals.append({
            "business_id": business_id, "customer_id": customer_id,
            "activity_date": last.isoformat(), "claim_key": key,
            "reward_type": "percent_discount", "reward_value": policy.discount_percent,
            "starts_at": today.isoformat(),
            "expires_at": (today + timedelta(days=policy.validity_days - 1)).isoformat(),
        })
        if len(proposals) >= policy.daily_limit:
            break
    return proposals

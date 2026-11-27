"""Scheduler-independent win-back batch preparation.

No network sends, coupon writes or claims occur by default. The authoritative
activity/consent reader and atomic coupon issuance adapter must be integrated
before an operator can activate automated delivery.
"""
from dataclasses import fields
from datetime import datetime
from zoneinfo import ZoneInfo

try:
    from .churn_discount_policy import ChurnPolicy, plan_winback
except ImportError:
    from churn_discount_policy import ChurnPolicy, plan_winback

MANILA = ZoneInfo("Asia/Manila")


def prepare_business_batch(db, business_id, read_verified_members, *, now=None):
    now = now or datetime.now(MANILA)
    if now.tzinfo is None:
        raise ValueError("Use an offset-aware clock")
    today = now.astimezone(MANILA).date()
    settings = db.table("churn_discount_settings").select("*").eq(
        "business_id", business_id).limit(1).execute().data or []
    if not settings:
        return {"status": "disabled", "proposals": []}
    row = settings[0]
    policy = ChurnPolicy(**{f.name: row[f.name] for f in fields(ChurnPolicy)})
    if not policy.enabled:
        return {"status": "disabled", "proposals": []}
    # The reader must return a complete, tenant-scoped snapshot, including
    # current consent and latest authoritative activity, or raise an error.
    members = read_verified_members(business_id, today)
    if members is None:
        raise ValueError("Verified membership snapshot unavailable")
    claims = []
    offset = 0
    while True:
        page = db.table("churn_discount_claims").select(
            "customer_id,activity_date").eq("business_id", business_id).order(
            "customer_id").order("activity_date").range(offset, offset + 499).execute().data or []
        claims.extend((business_id, item["customer_id"], item["activity_date"]) for item in page)
        if len(page) < 500:
            break
        offset += len(page)
    proposals = plan_winback(policy, members, today=today, business_id=business_id,
                             already_claimed=claims)
    return {"status": "preview_only", "business_id": business_id,
            "settings_version": row["updated_at"], "proposals": proposals}


def scheduled_winback_run(*args, **kwargs):
    # Keep this explicit gate until issuing a real coupon and marking its
    # claim can occur in one transaction with fresh eligibility verification.
    return {"status": "not_active", "issued": 0, "notifications_sent": 0}

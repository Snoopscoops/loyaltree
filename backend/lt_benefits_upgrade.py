"""Super-admin-approved, bounded upgrades of existing Wallet cards.

The SQL migration keeps existing cards disabled and defaults future customer
rows to enabled. This worker only feeds the existing durable Wallet queue; it
never renders a pass or contacts Apple/Google. Completed means queued, rather
than delivered to a phone. Every database operation is business scoped or a
leased service-role worker command.
"""
from __future__ import annotations

import uuid
try:
    from .wallet_rate import RollingBudget
    from .apple_memory import memory_pressure
except ImportError:
    from wallet_rate import RollingBudget
    from apple_memory import memory_pressure

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, StrictBool


ROLLOUT_REASON = "lt_benefits_admin_upgrade_v1"


class CardUpgradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: StrictBool


class LTBenefitsUpgradeService:
    def __init__(self, *, db, get_business, require_admin, enabled, ready, enqueue, log=None):
        self.db, self.get_business, self.require_admin = db, get_business, require_admin
        self.enabled, self.ready, self.enqueue, self.log = enabled, ready, enqueue, log
        self.rate = RollingBudget()

    def _log(self, event, **fields):
        try:
            if self.log:
                self.log(event, **fields)
        except Exception:
            pass

    def _command(self, action, **data):
        try:
            result = self.db.rpc("ltb_card_upgrade_command", {"p_action": action, "p_data": data}).execute().data
        except Exception as exc:
            self._log("lt_card_upgrade_unavailable", action=action, error_type=type(exc).__name__)
            raise HTTPException(503, "Wallet card upgrade setup or connection is unavailable. Apply backend/lt_benefits_upgrade.sql.") from None
        if not isinstance(result, dict):
            raise HTTPException(503, "Wallet card upgrade returned an invalid response.")
        if result.get("error"):
            raise HTTPException(409, "The Wallet card upgrade could not be updated. Try again.")
        return result

    def _business(self, slug, request):
        # Platform admin verification precedes all business/feature checks.
        self.require_admin(request)
        business = self.get_business(slug)
        if not business:
            raise HTTPException(404, "Business not found.")
        return business

    def _available(self):
        if not self.enabled():
            return False
        try:
            self.ready()
            return True
        except HTTPException as exc:
            if exc.status_code != 503:
                raise
            return False

    def status(self, slug, request):
        business = self._business(slug, request)
        if not self.enabled():
            return dict(available=False, total_cards=0, eligible_cards=0, enabled_cards=0, rollout=None)
        result = self._command("status", business_id=str(business["id"]))
        return dict(available=self._available(), **result)

    def start(self, slug, request, *, confirm):
        business = self._business(slug, request)
        if confirm is not True:
            raise HTTPException(422, "Confirm the upgrade to update existing Wallet cards.")
        if not self.enabled():
            raise HTTPException(503, "LT Benefits is not enabled yet.")
        self.ready()
        result = self._command("start", business_id=str(business["id"]), business_slug=str(slug))
        self._log("lt_card_upgrade_started", business_slug=str(slug), rollout_id=(result.get("rollout") or {}).get("id"))
        return dict(available=True, **result)

    def tick(self, limit=5):
        """Queue at most five cards under one 90-second durable lease.

        A crash after enqueue but before acknowledgement can repeat that enqueue;
        the existing queue coalesces pending jobs. No purchase, contact linking,
        or points mutation occurs here. Failed attempts back off and retain the
        exact pending card for retry, even though its native flag is already on.
        """
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 5:
            raise ValueError("limit must be an integer from 1 to 5")
        if not self._available():
            return {"available": False, "queued": 0}
        if memory_pressure.paused():
            return {"available": True, "queued": 0, "paused": True}
        lease = str(uuid.uuid4())
        work = self._command("claim", lease=lease, limit=limit)
        job = work.get("job")
        if not job:
            return {"available": True, "queued": 0}
        queued = 0
        try:
            business = self.get_business(job["business_slug"])
            if not business or str(business.get("id")) != str(job["business_id"]):
                raise RuntimeError("BusinessUnavailable")
            cards = work.get("cards", [])
            for card in cards[:limit]:
                if memory_pressure.paused() or not self.rate.take():
                    self._command("release", job_id=job["id"], lease=lease)
                    return {"available": True, "queued": queued, "rollout_id": job["id"], "paused": True}
                result = self.enqueue(card, business, reason=ROLLOUT_REASON)
                if not isinstance(result, dict) or result.get("status") != "queued" or not result.get("job_id"):
                    raise RuntimeError("WalletQueueRejected")
                self._command("ack", job_id=job["id"], lease=lease, customer_id=str(card["id"]),
                              wallet_job_id=str(result["job_id"]))
                queued += 1
            if len(cards) > limit:
                self._command("release", job_id=job["id"], lease=lease)
            return {"available": True, "queued": queued, "rollout_id": job["id"]}
        except Exception as exc:
            error_type = type(exc).__name__
            # Store only a type, never queue response detail, contacts, or tokens.
            try:
                self._command("fail", job_id=job["id"], lease=lease, error_type=error_type)
            except HTTPException:
                pass  # Lease expiry guarantees recovery if this acknowledgement fails.
            self._log("lt_card_upgrade_retry", business_slug=job["business_slug"], rollout_id=job["id"], error_type=error_type)
            return {"available": True, "queued": queued, "rollout_id": job["id"], "error_type": error_type}


def register_lt_benefits_upgrade_routes(app, *, db, get_business, require_admin, enabled, ready, enqueue, log=None):
    service = LTBenefitsUpgradeService(db=db, get_business=get_business, require_admin=require_admin,
        enabled=enabled, ready=ready, enqueue=enqueue, log=log)

    @app.get("/api/v1/admin/businesses/{slug}/lt-benefits/card-upgrade")
    def status(slug: str, request: Request):
        return service.status(slug, request)

    @app.post("/api/v1/admin/businesses/{slug}/lt-benefits/card-upgrade")
    def start(slug: str, body: CardUpgradeRequest, request: Request):
        return service.start(slug, request, confirm=body.confirm)

    return service

"""Operator-only, bounded rollout of LT Benefits onto existing loyalty cards.

No work runs when this module is imported. Default operation is a read-only dry
run. ``--apply`` enables the native LT Benefits flag on each selected card before
queuing its existing durable Wallet sync job; it does not build passes, send
provider requests, or republish Google classes in this process.
The running application worker must resolve each customer's own program.

Run after BOTH lt_benefits.sql and lt_benefits_upgrade.sql and feature activation,
starting with a canary. Use the super admin dashboard button for a business-scoped
upgrade; this CLI is an explicit operator override across selected businesses:
  python -m backend.lt_benefits_rollout --max-cards 25
  python -m backend.lt_benefits_rollout --apply --max-cards 25 --batch-size 5

Resume an interrupted applied run with the returned --after-id checkpoint and
the same --through-id high-water mark. New joins beyond that mark are excluded.
Existing pending jobs coalesce through enqueue_wallet_sync. Replaying a completed
job can enqueue a fresh sync, so a resume checkpoint avoids unnecessary pushes.

Google class/layout publication is deliberately separate. This queues current
Google object updates and Apple update notifications; provider/device caches
determine when changed artwork appears. No immediate logo replacement is promised.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict, dataclass, field
import importlib
import json
import time
from typing import Callable, Optional


CUSTOMER_FIELDS = "id,business_id,public_id,program_id,lt_benefits_card_enabled"
BUSINESS_FIELDS = "id,public_id"
ROLLOUT_REASON = "lt_benefits_rollout_v1"


@dataclass
class RolloutResult:
    mode: str
    scanned: int = 0
    eligible: int = 0
    queued: int = 0
    coalesced: int = 0
    skipped: int = 0
    pages: int = 0
    resume_after_id: int = 0
    through_id: int = 0
    stopped: bool = False
    error_type: Optional[str] = None
    skip_reasons: dict = field(default_factory=lambda: {"missing_card": 0, "missing_business": 0})


def _positive_integer(value, name, maximum=None, *, allow_zero=False):
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or (maximum is not None and value > maximum):
        raise ValueError(f"{name} must be an integer from {minimum}" + (f" to {maximum}" if maximum is not None else ""))
    return value


def _rows(query):
    rows = query.execute().data
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Unexpected database response")
    return rows


class CardEnableRejected(RuntimeError):
    """The native flag write was not confirmed for the selected card/business."""


def _enable_card(db, customer, business):
    if customer.get("lt_benefits_card_enabled") is True:
        return customer
    rows = _rows(db.table("customers").update({"lt_benefits_card_enabled": True})
                 .eq("id", customer["id"]).eq("business_id", business["id"]))
    if len(rows) != 1 or rows[0].get("id") != customer["id"] or rows[0].get("business_id") != business["id"] or rows[0].get("lt_benefits_card_enabled") is not True:
        raise CardEnableRejected()
    return dict(customer, lt_benefits_card_enabled=True)


def queue_cards(db, enqueue: Optional[Callable] = None, *, apply=False, batch_size=10,
                max_cards=None, after_id=0, through_id=None, pause_seconds=5.0,
                sleep=time.sleep, on_progress=None):
    """Read minimal keyset pages and optionally enqueue current customer cards.

    Memory is bounded by two pages of at most 25 rows. No contacts, names, card
    artwork or provider credentials are selected or returned. Missing businesses
    and cards are skipped. There is no assumed archive column in the existing
    schema; deleted customer rows are absent, and orphan businesses are skipped.

    The addon migration is required: selecting its native flag fails closed when
    the column is absent. Apply confirms only that flag's business-scoped write
    before enqueue; dry-run never writes it. No balances or contacts are changed.

    A failed read/flag write/enqueue stops immediately. The checkpoint advances only after
    an accepted queued/coalesced card or a deliberate skip, so retrying from it
    includes the failed card. An ambiguous write may already exist in the durable
    queue; the existing enqueue adapter handles pending-job coalescing.
    """
    _positive_integer(batch_size, "batch_size", 25)
    _positive_integer(after_id, "after_id", allow_zero=True)
    if max_cards is not None:
        _positive_integer(max_cards, "max_cards")
    if through_id is not None:
        _positive_integer(through_id, "through_id", allow_zero=True)
    if not isinstance(apply, bool):
        raise ValueError("apply must be a boolean")
    if apply and not callable(enqueue):
        raise ValueError("An enqueue adapter is required for apply")
    if isinstance(pause_seconds, bool) or not isinstance(pause_seconds, (int, float)) or not 1 <= pause_seconds <= 60:
        raise ValueError("pause_seconds must be between 1 and 60")
    result = RolloutResult(mode="apply" if apply else "dry_run", resume_after_id=after_id)

    def progress():
        if on_progress is not None:
            on_progress(asdict(result))

    try:
        if through_id is None:
            last = _rows(db.table("customers").select("id").order("id", desc=True).limit(1))
            through_id = _positive_integer(last[0].get("id"), "customer id") if last else 0
        result.through_id = through_id
        while result.resume_after_id < through_id and (max_cards is None or result.scanned < max_cards):
            count = min(batch_size, max_cards - result.scanned) if max_cards is not None else batch_size
            rows = _rows(db.table("customers").select(CUSTOMER_FIELDS)
                         .gt("id", result.resume_after_id).lte("id", through_id).order("id").limit(count))
            if not rows:
                break
            # Validate the entire page before any mutations or cursor changes.
            previous = result.resume_after_id
            for row in rows:
                identifier = _positive_integer(row.get("id"), "customer id")
                if identifier <= previous or identifier > through_id:
                    raise ValueError("Customer page is not strictly ordered within the snapshot")
                previous = identifier
            business_ids = list(dict.fromkeys(row.get("business_id") for row in rows if row.get("business_id") is not None))
            businesses = _rows(db.table("businesses").select(BUSINESS_FIELDS).in_("id", business_ids).limit(25)) if business_ids else []
            by_id = {row.get("id"): row for row in businesses if row.get("id") is not None}
            result.pages += 1
            for customer in rows:
                result.scanned += 1
                business = by_id.get(customer.get("business_id"))
                if not customer.get("public_id"):
                    result.skipped += 1; result.skip_reasons["missing_card"] += 1
                elif not business or not business.get("public_id"):
                    result.skipped += 1; result.skip_reasons["missing_business"] += 1
                else:
                    result.eligible += 1
                    if apply:
                        customer = _enable_card(db, customer, business)
                        outcome = enqueue(customer, business, reason=ROLLOUT_REASON)
                        if not isinstance(outcome, dict) or outcome.get("status") != "queued" or not outcome.get("job_id"):
                            result.stopped = True; result.error_type = "QueueRejected"
                            progress()
                            return result
                        if outcome.get("coalesced"):
                            result.coalesced += 1
                        else:
                            result.queued += 1
                result.resume_after_id = customer["id"]
            progress()
            if len(rows) < count or result.resume_after_id >= through_id or (max_cards is not None and result.scanned >= max_cards):
                break
            # Throttle read-only scans as well as job production. A live worker
            # drains the queue separately at its existing configured rate.
            sleep(pause_seconds)
    except Exception as failure:
        result.stopped = True
        result.error_type = type(failure).__name__
    return result


def _parser():
    parser = argparse.ArgumentParser(description="Dry-run or slowly enqueue existing cards for LT Benefits. No direct provider pushes.")
    parser.add_argument("--apply", action="store_true", help="Enable selected cards and queue Wallet jobs after both LT SQL migrations and activation; default is read-only.")
    parser.add_argument("--batch-size", type=int, default=10, help="Customer rows per page, 1–25 (default: 10).")
    parser.add_argument("--max-cards", type=int, help="Stop after this many scanned cards; use a small canary first.")
    parser.add_argument("--after-id", type=int, default=0, help="Resume after the checkpoint from a previous applied run.")
    parser.add_argument("--through-id", type=int, help="Reuse a previous run's high-water mark when resuming.")
    parser.add_argument("--pause-seconds", type=float, default=5, help="Pause between pages, 1–60 seconds (default: 5).")
    return parser


def main(argv=None, *, runtime_loader=None, emit=print):
    args = _parser().parse_args(argv)
    # Reject bad options before importing the application or opening clients.
    try:
        _positive_integer(args.batch_size, "batch_size", 25)
        _positive_integer(args.after_id, "after_id", allow_zero=True)
        if args.max_cards is not None: _positive_integer(args.max_cards, "max_cards")
        if args.through_id is not None: _positive_integer(args.through_id, "through_id", allow_zero=True)
        if not 1 <= args.pause_seconds <= 60: raise ValueError("pause_seconds must be between 1 and 60")
    except ValueError as failure:
        _parser().error(str(failure))
    runtime = None
    started = False
    try:
        runtime = runtime_loader() if runtime_loader else importlib.import_module(f"{__package__}.main" if __package__ else "main")
        if runtime.supabase is None:
            raise RuntimeError("Database is not configured")
        asyncio.run(runtime.http.start())
        started = True
        if args.apply:
            if not runtime.lt_benefits_enabled():
                raise RuntimeError("LT Benefits must be activated before applying a rollout")
            runtime._lt_benefits.ready()
        result = queue_cards(runtime.supabase, runtime.enqueue_wallet_sync, apply=args.apply,
                             batch_size=args.batch_size, max_cards=args.max_cards,
                             after_id=args.after_id, through_id=args.through_id,
                             pause_seconds=args.pause_seconds,
                             on_progress=lambda state: emit(json.dumps({"event": "lt_benefits_rollout_progress", **state}, separators=(",", ":"))))
        emit(json.dumps({"event": "lt_benefits_rollout", **asdict(result)}, separators=(",", ":")))
        return 1 if result.stopped else 0
    except Exception as failure:
        # Exception text may contain tokens, contacts, database URLs or SQL.
        emit(json.dumps({"event": "lt_benefits_rollout", "mode": "apply" if args.apply else "dry_run", "stopped": True, "error_type": type(failure).__name__}, separators=(",", ":")))
        return 1
    finally:
        if started:
            asyncio.run(runtime.http.stop())


if __name__ == "__main__":
    raise SystemExit(main())

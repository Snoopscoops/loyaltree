"""Small durable purchase/refund adapters; no Wallet rendering or provider calls.

The caller supplies confirmed, authenticated server-side purchase context. A
persisted snapshot is shared by all local reward engines, so optional LT work
cannot turn a hybrid points/stamp purchase into two LT awards.
"""
from decimal import Decimal, InvalidOperation
import hashlib
import re


PURCHASE_ACTIONS = frozenset(("stamp_add", "points_sale", "tier_points_sale", "tier_stamp"))
DONE_REFUNDS = frozenset(("reversed", "replay", "pending_refund", "replay_pending_refund"))


def canonical_purchase_source(value):
    """Keep a receipt stable across transport paths and local reward engines."""
    source = str(value or "").strip()
    # Strip one engine suffix; a real receipt ending in ':points' remains part
    # of its source after the single engine suffix is removed.
    source = re.sub(r":(?:points|stamp|tier)$", "", source)
    if source.startswith("companion:"):
        source = "pos:" + source[len("companion:"):]
    if len(source) > 180:
        source = source[:120] + ":" + hashlib.sha256(source.encode()).hexdigest()[:40]
    return source


def pos_purchase_source(transaction):
    provider = str(transaction.get("provider") or "").strip().lower()
    integration = str(transaction.get("integration_id") or "").strip()
    receipt = str(transaction.get("external_transaction_id") or "").strip()
    if not provider or not integration or not receipt:
        raise ValueError("POS purchase requires provider, integration and receipt identity")
    # Construct the receipt without suffix stripping: a provider ID may itself
    # end with ':stamp'. It is not a local reward engine suffix here.
    source = f"pos:{provider}:{integration}:{receipt}"
    return source if len(source) <= 180 else source[:120] + ":" + hashlib.sha256(source.encode()).hexdigest()[:40]


def centavos(value):
    """Convert an authoritative peso amount without rounding away fractions."""
    if isinstance(value, bool) or value is None:
        raise ValueError("An exact final net amount is required")
    try:
        parsed = Decimal(str(value)) * 100
    except (ValueError, InvalidOperation):
        raise ValueError("An exact final net amount is required") from None
    if not parsed.is_finite() or parsed != parsed.to_integral_value() or not 0 <= parsed <= 100_000_000_000:
        raise ValueError("Final net amount must be nonnegative centavos")
    return int(parsed)


def purchase_metadata(amount_centavos, source_id, *, currency="PHP", customer_public_id=None):
    """Call only AFTER signed actor/provider verification; not a request flag."""
    if isinstance(amount_centavos, bool) or not isinstance(amount_centavos, int) or not 0 <= amount_centavos <= 100_000_000_000:
        raise ValueError("amount_centavos must be a nonnegative integer")
    source = str(source_id or "").strip()
    if not source or len(source) > 200:
        raise ValueError("A stable bounded purchase source is required")
    result = dict(lt_purchase_authorized=True, lt_amount_centavos=amount_centavos,
                  lt_purchase_source=source, lt_purchase_currency=str(currency).upper())
    if customer_public_id:
        result["lt_customer_public_id"] = str(customer_public_id)
    return result


def pos_purchase_metadata(transaction, *, customer_public_id, amount_centavos=None):
    """Snapshot actual final NET, regardless of a merchant's gross-earn rule.

    Persist this in pos_transactions.processing_metadata before calling either
    loyalty engine, then copy the same fields into each transaction_audit row.
    Missing net_amount is rejected rather than falling back to gross_amount.
    """
    amount = centavos(transaction.get("net_amount")) if amount_centavos is None else amount_centavos
    return purchase_metadata(amount, pos_purchase_source(transaction),
        currency=transaction.get("currency") or "PHP", customer_public_id=customer_public_id)


class LTTransactionReconciler:
    def __init__(self, *, db, benefits, enabled, log=None):
        self.db, self.benefits, self.enabled, self.log = db, benefits, enabled, log

    def _enabled(self):
        return bool(self.enabled() if callable(self.enabled) else self.enabled)

    def _log(self, event, **fields):
        try:
            if self.log:
                self.log(event, **fields)
        except Exception:
            pass

    @staticmethod
    def audit_purchase(audit, metadata=None):
        """Allowlist persisted, server-authorized purchase context for retry."""
        info = dict(audit.get("metadata") or {})
        if metadata:
            info.update(metadata)
        if audit.get("action") not in PURCHASE_ACTIONS or info.get("lt_purchase_authorized") is not True:
            return None
        amount = info.get("lt_amount_centavos")
        if isinstance(amount, bool) or not isinstance(amount, int) or not 0 <= amount <= 100_000_000_000:
            raise ValueError("Authorized purchase lacks exact centavos snapshot")
        source = info.get("lt_purchase_source")
        if not source:
            source = canonical_purchase_source(audit.get("idempotency_key") or audit.get("transaction_id") or audit.get("id"))
        return purchase_metadata(amount, source, currency=info.get("lt_purchase_currency") or "PHP",
                                 customer_public_id=info.get("lt_customer_public_id"))

    def _audit_snapshots(self, transaction):
        """Bounded compatibility fallback; no contacts, raw provider payloads or API keys."""
        metadata = transaction.get("processing_metadata") or {}
        references = metadata.get("transaction_audit_refs") or []
        references = references if isinstance(references, list) else []
        references = [str(value) for value in references[:12] if value]
        if transaction.get("transaction_audit_ref"):
            references.append(str(transaction["transaction_audit_ref"]))
        columns = "id,transaction_id,business_id,customer_id,action,status,idempotency_key,metadata"
        def query():
            return (self.db.table("transaction_audit").select(columns)
                .eq("business_id", transaction["business_id"]).eq("customer_id", transaction["customer_id"])
                .in_("action", list(PURCHASE_ACTIONS)).in_("status", ["success", "processing"]))
        rows = []
        if references:
            rows = query().in_("transaction_id", list(dict.fromkeys(references))[:12]).limit(12).execute().data or []
        if not rows:
            base = pos_purchase_source(transaction)
            legacy = "companion:" + base[len("pos:"):]
            keys = [value + suffix for value in (base, legacy) for suffix in ("", ":points", ":stamp", ":tier")]
            rows = query().in_("idempotency_key", keys).limit(12).execute().data or []
        snapshots = {}
        for audit in rows:
            snapshot = self.audit_purchase(audit)
            if snapshot and not (audit.get("metadata") or {}).get("lt_purchase_currency"):
                snapshot["lt_purchase_currency"] = str(transaction.get("currency") or "PHP").upper()
            if not snapshot:
                continue
            key = snapshot["lt_purchase_source"]
            if key in snapshots and snapshots[key]["lt_amount_centavos"] != snapshot["lt_amount_centavos"]:
                raise ValueError("Hybrid purchase has conflicting LT amount snapshots")
            snapshots[key] = snapshot
        return list(snapshots.values())

    def refund_pos(self, transaction):
        """StoreHub on_void callback; exception/False keeps the durable void marker.

        Only verified server snapshots can reverse/mark LT purchases. A feature
        pause cannot erase prior eligibility. The SQL reverse command retains a
        tombstone when the original earn has not arrived yet.
        """
        if not isinstance(transaction, dict) or transaction.get("status") != "voided":
            return dict(status="not_voided")
        metadata = transaction.get("processing_metadata") or {}
        metadata = metadata if isinstance(metadata, dict) else {}
        if metadata.get("lt_refund_processed") is True:
            return dict(status="refund_already_processed")
        known = metadata.get("lt_purchase_authorized")
        # No SQL traffic for pre-feature sales when the feature is off. New POS
        # flows persist either the authoritative snapshot or an explicit False.
        if known is False or (known is not True and not self._enabled()):
            return dict(status="no_lt_purchase")
        if not transaction.get("business_id") or not transaction.get("customer_id") or not transaction.get("id"):
            raise ValueError("Voided purchase identity is incomplete")
        if known is True:
            pseudo_audit = dict(action="points_sale", metadata=metadata,
                idempotency_key=metadata.get("lt_purchase_source") or pos_purchase_source(transaction))
            snapshots = [self.audit_purchase(pseudo_audit)]
            if not metadata.get("lt_purchase_currency"):
                snapshots[0]["lt_purchase_currency"] = str(transaction.get("currency") or "PHP").upper()
        else:
            snapshots = self._audit_snapshots(transaction)
        if not snapshots:
            return dict(status="no_lt_purchase")
        outcomes = []
        for snapshot in snapshots:
            if snapshot["lt_purchase_currency"] != "PHP" or snapshot["lt_amount_centavos"] == 0:
                continue
            outcome = self.benefits.reverse(transaction["business_id"], "purchase", snapshot["lt_purchase_source"],
                f"pos-void:{transaction['id']}", snapshot["lt_amount_centavos"])
            if not isinstance(outcome, dict) or outcome.get("status") not in DONE_REFUNDS:
                raise RuntimeError("LT refund is not durably recorded")
            outcomes.append(outcome["status"])
        # The StoreHub worker persists this only together with clearing its
        # existing wallet-pending flag AFTER the callback and queue succeed.
        metadata["lt_refund_processed"] = True
        transaction["processing_metadata"] = metadata
        self._log("lt_points_pos_refund", transaction_id=str(transaction["id"]),
                  business_id=str(transaction["business_id"]), sources=len(outcomes))
        return dict(status="refund_recorded", sources=len(outcomes))

"""Versioned read-only merchant payment capability. No NextPay calls or writes.

Future adapters must derive each status from provider-confirmed merchant data,
not client claims or a credential's presence. The hosted portal must authenticate
and authorize the business again for every operation, independently of this GET.
"""
from fastapi import Header, HTTPException
from fastapi.responses import JSONResponse

STATES = frozenset({"disabled", "registration_required", "verification_pending", "active", "restricted"})
MAX_CENTAVOS = 9_000_000_000_000


def merchant_payment_status(claims):
    # Deliberately hard locked until the provider adapter AND hosted portal are
    # implemented and approved. API keys alone must never enable this contract.
    return {"state": "disabled", "portal_available": False}


def normalize_status(raw):
    if not isinstance(raw, dict) or raw.get("state") not in STATES:
        raise HTTPException(503, "Payment status unavailable")
    state = raw["state"]
    portal = raw.get("portal_available") is True and state != "disabled"
    result = {"version": 1, "state": state, "portal_available": portal,
              "available_centavos": None, "pending_centavos": None,
              "payout_ready": False}
    if state == "active" and portal:
        for field in ("available_centavos", "pending_centavos"):
            value = raw.get(field)
            if type(value) is int and 0 <= value <= MAX_CENTAVOS:
                result[field] = value
        result["payout_ready"] = (raw.get("payout_ready") is True
                                  and result["available_centavos"] is not None
                                  and result["available_centavos"] > 0)
    return result


def register_merchant_payment_routes(app, *, require_owner, read_status=merchant_payment_status):
    @app.get("/api/v1/business/{public_id}/merchant-payments/status")
    def payment_status(public_id: str, authorization: str = Header(default="")):
        claims = require_owner(public_id, authorization)
        # Defence in depth, even if the existing authorization helper changes.
        if claims.get("role") != "owner" or claims.get("business_public_id") != public_id:
            raise HTTPException(403, "Owner access required")
        try:
            status = normalize_status(read_status(claims))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Payment status unavailable") from None
        return JSONResponse(status, headers={"Cache-Control": "no-store"})

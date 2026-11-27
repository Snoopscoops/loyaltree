"""Owner-only settings; saving configuration never issues a coupon."""
from dataclasses import asdict
from datetime import datetime, timezone
from fastapi import Body, Header, HTTPException

try:
    from .churn_discount_policy import ChurnPolicy
except ImportError:
    from churn_discount_policy import ChurnPolicy


def register_churn_discount_routes(app, *, db, business_for):
    path = '/api/v1/business/{public_id}/churn-discount-settings'
    fields = tuple(asdict(ChurnPolicy()))

    def response(policy):
        return {**asdict(policy), 'issuance_ready': False}

    @app.get(path)
    def get_churn_settings(public_id: str, authorization: str = Header(default='')):
        business = business_for(public_id, authorization)
        try:
            rows = db.table('churn_discount_settings').select(','.join(fields)).eq(
                'business_id', business['id']).limit(1).execute().data or []
            return response(ChurnPolicy(**rows[0]) if rows else ChurnPolicy())
        except Exception as exc:
            raise HTTPException(503, 'Win-back settings are unavailable.') from exc

    @app.put(path)
    def save_churn_settings(public_id: str, payload: dict = Body(...),
                            authorization: str = Header(default='')):
        business = business_for(public_id, authorization)
        if set(payload) != set(fields):
            raise HTTPException(400, 'Provide all win-back settings.')
        try:
            policy = ChurnPolicy(**payload)
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, str(exc)) from exc
        try:
            db.table('churn_discount_settings').upsert({
                'business_id': business['id'], **asdict(policy),
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }, on_conflict='business_id').execute()
        except Exception as exc:
            raise HTTPException(503, 'Could not save win-back settings.') from exc
        return response(policy)

"""Business subscription trial coupons, separate from customer reward coupons."""
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo
import re
from typing import Optional
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

MANILA = ZoneInfo('Asia/Manila')

def coupon_code(value):
    code = str(value or '').strip().upper()
    if not re.fullmatch(r'[A-Z0-9_-]{3,64}', code):
        raise HTTPException(400, 'Use a coupon code of 3–64 letters, numbers, underscores or hyphens.')
    return code

def coupon_available(row, country='PH', email='', now=None):
    today = (now or datetime.now(timezone.utc)).astimezone(MANILA).date()
    if not row or not row.get('is_active'):
        raise HTTPException(400, 'Coupon is invalid or disabled.')
    if not date.fromisoformat(row['starts_on']) <= today <= date.fromisoformat(row['ends_on']):
        raise HTTPException(400, 'Coupon is outside its redemption dates.')
    if row.get('country_code') and row['country_code'] != country.upper():
        raise HTTPException(400, 'Coupon is not available in your country.')
    if row.get('eligible_email') and row['eligible_email'].strip().lower() != email.strip().lower():
        raise HTTPException(400, 'Coupon is reserved for another business.')
    return row

def subscription_access_expiry(business):
    """Keep exact trial hours and any later referral/admin access extension."""
    subscription = business.get('subscription_expires_at')
    trial = business.get('trial_ends_at') if not business.get('last_paid_at') else None
    def timestamp(value):
        try:
            result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            return result if result.tzinfo else result.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None
    candidates = [(value, timestamp(value)) for value in (subscription, trial) if value]
    candidates = [(value, parsed) for value, parsed in candidates if parsed is not None]
    return max(candidates, key=lambda item: item[1])[0] if candidates else None

def billing_hold(business, now=None):
    """Paid subscriptions receive 14 days grace; promotional access ends exactly."""
    expiry = subscription_access_expiry(business)
    if not expiry:
        return False
    ends = datetime.fromisoformat(str(expiry).replace('Z', '+00:00'))
    if ends.tzinfo is None:
        ends = ends.replace(tzinfo=timezone.utc)
    grace = 14 if business.get('last_paid_at') or not business.get('trial_ends_at') else 0
    return (now or datetime.now(timezone.utc)) > ends + timedelta(days=grace)

class TrialCouponInput(BaseModel):
    code: str
    title: str = Field(default='Free business trial', min_length=1, max_length=120)
    trial_days: int = Field(default=7, ge=1, le=90)
    starts_on: date
    ends_on: date
    max_redemptions: Optional[int] = Field(default=None, ge=1)
    country_code: Optional[str] = Field(default='PH', min_length=2, max_length=3)
    eligible_email: Optional[str] = Field(default=None, max_length=254)
    is_public: bool = False
    show_popup: bool = False
    is_active: bool = True

class CouponPreview(BaseModel):
    code: str
    country_code: str = 'PH'
    email: str = ''

def register_trial_routes(app, db, require_admin):
    def ready():
        if not db:
            raise HTTPException(503, 'Database unavailable')

    def lookup(code):
        ready()
        try:
            rows = db.table('business_trial_coupons').select('*').eq('code', coupon_code(code)).limit(1).execute().data or []
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, 'Trial coupons are unavailable. Apply the trial_coupons.sql migration first.') from exc
        return rows[0] if rows else None

    @app.post('/api/v1/public/trial-coupons/preview')
    async def preview(req: CouponPreview):
        row = coupon_available(lookup(req.code), req.country_code, req.email)
        used = db.table('business_trial_redemptions').select('id', count='exact').eq('coupon_id', row['id']).execute().count or 0
        if row.get('max_redemptions') and used >= row['max_redemptions']:
            raise HTTPException(400, 'Coupon has reached its usage limit.')
        return {'code': row['code'], 'trial_days': row['trial_days'], 'title': row['title'],
                'trial_ends_at': (datetime.now(timezone.utc) + timedelta(days=row['trial_days'])).isoformat()}

    @app.get('/api/v1/public/trial-promotions')
    async def promotions(country: str = 'PH'):
        ready()
        try:
            rows = db.table('business_trial_coupons').select('*').eq('is_active', True).eq('is_public', True).eq('show_popup', True).order('id', desc=True).execute().data or []
            result = []
            for row in rows:
                if row.get('eligible_email'):
                    continue
                try:
                    coupon_available(row, country)
                except HTTPException:
                    continue
                used = db.table('business_trial_redemptions').select('id', count='exact').eq('coupon_id', row['id']).execute().count or 0
                if row.get('max_redemptions') and used >= row['max_redemptions']:
                    continue
                result.append({k: row[k] for k in ('code', 'title', 'trial_days', 'starts_on', 'ends_on')})
            return result
        except Exception:
            # Optional advertising must not break the homepage before migration.
            return []

    def all_rows(query_factory):
        rows, offset = [], 0
        while True:
            batch = query_factory().range(offset, offset + 999).execute().data or []
            rows.extend(batch)
            if len(batch) < 1000:
                return rows
            offset += 1000

    @app.get('/api/v1/admin/trial-coupons')
    async def coupons(_: bool = Depends(require_admin)):
        ready()
        rows = all_rows(lambda: db.table('business_trial_coupons').select('*').order('id', desc=True))
        for row in rows:
            row['redemptions'] = all_rows(lambda: db.table('business_trial_redemptions').select('*,businesses(public_id,name,email,last_paid_at,status)').eq('coupon_id', row['id']).order('redeemed_at', desc=True))
        return rows

    def values(req):
        data = req.model_dump() if hasattr(req, 'model_dump') else req.dict()
        data['code'] = coupon_code(req.code)
        if req.ends_on < req.starts_on:
            raise HTTPException(400, 'End date must be on or after the start date.')
        data['starts_on'], data['ends_on'] = req.starts_on.isoformat(), req.ends_on.isoformat()
        data['country_code'] = req.country_code.upper() if req.country_code else None
        data['eligible_email'] = (req.eligible_email or '').strip().lower() or None
        if data['eligible_email'] and (req.is_public or req.show_popup):
            raise HTTPException(400, 'Business-specific coupons must remain private.')
        if req.show_popup and not req.is_public:
            raise HTTPException(400, 'Only public coupons can display a popup.')
        return data

    @app.post('/api/v1/admin/trial-coupons')
    async def create(req: TrialCouponInput, _: bool = Depends(require_admin)):
        ready()
        data = values(req)
        try:
            return db.table('business_trial_coupons').insert(data).execute().data[0]
        except Exception as exc:
            raise HTTPException(400, 'Could not create coupon. Check for a duplicate code and apply the migration.') from exc

    @app.put('/api/v1/admin/trial-coupons/{coupon_id}')
    async def update(coupon_id: int, req: TrialCouponInput, _: bool = Depends(require_admin)):
        ready()
        data = values(req)
        try:
            rows = db.table('business_trial_coupons').update(data).eq('id', coupon_id).execute().data or []
        except Exception as exc:
            raise HTTPException(400, 'Could not update coupon. Check for a duplicate code.') from exc
        if not rows:
            raise HTTPException(404, 'Coupon not found')
        return rows[0]

    return lookup

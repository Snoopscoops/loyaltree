"""Owner setup for menu payments. The 3% platform fee is fixed and automatic."""
import re
from datetime import datetime, timezone

from fastapi import Header, HTTPException
from pydantic import BaseModel

PLATFORM_FEE_PERCENT = 3

BUSINESS_AGE = {
    'under_1_year': 'Under 1 year',
    '1_to_2_years': '1 to 2 years',
    '3_to_5_years': '3 to 5 years',
    'over_5_years': 'Over 5 years',
}
BUSINESS_SIZE = {
    'just_me': 'Just me',
    '2_to_10': '2 to 10 people',
    '11_to_50': '11 to 50 people',
    'over_50': 'Over 50 people',
}
MONTHLY_VOLUME = {
    'under_100k': 'Under ₱100,000',
    '100k_to_500k': '₱100,000 to ₱500,000',
    '500k_to_1m': '₱500,000 to ₱1,000,000',
    'over_1m': 'Over ₱1,000,000',
}
SOURCE_OF_FUNDS = {
    'business_sales': 'Sales of the business',
    'salary': 'Salary',
    'commission': 'Commission',
    'other': 'Other',
}

TEXT = {
    'trade_name': (120, 'Trade name'),
    'address_line': (160, 'Business address'),
    'city': (80, 'City'),
    'industry': (80, 'Industry'),
    'description': (240, 'What the business sells'),
    'owner_name': (120, 'Full name'),
    'nationality': (60, 'Nationality'),
    'birth_place': (80, 'Place of birth'),
    'work': (80, 'Nature of work'),
    'owner_address': (160, 'Home address'),
    'payout_institution': (80, 'Bank name'),
    'payout_account_name': (120, 'Account name'),
}


class MenuPaymentSetup(BaseModel):
    trade_name: str = ''
    address_line: str = ''
    city: str = ''
    industry: str = ''
    description: str = ''
    business_age: str = ''
    business_size: str = ''
    monthly_volume: str = ''
    business_tin: str = ''
    owner_name: str = ''
    birthday: str = ''
    nationality: str = ''
    birth_place: str = ''
    mobile: str = ''
    email: str = ''
    work: str = ''
    source_of_funds: str = ''
    owner_tin: str = ''
    owner_address: str = ''
    payout_kind: str = ''
    payout_institution: str = ''
    payout_account_name: str = ''
    payout_account_number: str = ''
    payout_last4: str = ''


def _clean(value, limit):
    return ' '.join(str(value or '').split())[:limit]


def _tin(value):
    digits = re.sub(r'\D', '', str(value or ''))
    return digits if 9 <= len(digits) <= 15 else ''


def _mobile(value):
    digits = re.sub(r'\D', '', str(value or ''))
    if digits.startswith('63') and len(digits) == 12:
        digits = '0' + digits[2:]
    return digits if len(digits) == 11 and digits.startswith('09') else ''


def _birthday(value):
    try:
        parsed = datetime.strptime(str(value or ''), '%Y-%m-%d')
    except ValueError:
        return ''
    age = (datetime.now(timezone.utc).date() - parsed.date()).days / 365.25
    return parsed.strftime('%Y-%m-%d') if 18 <= age <= 100 else ''


def _account_number(kind, value):
    digits = re.sub(r'\D', '', str(value or ''))
    if kind == 'gcash':
        return digits if _mobile(digits) else ''
    if kind == 'bank' and 8 <= len(digits) <= 20:
        return digits
    return ''


def normalize_setup(payload):
    """Return a public record. The full payout number is never included."""
    data = payload if isinstance(payload, dict) else payload.model_dump()
    record = {key: _clean(data.get(key), limit) for key, (limit, _label) in TEXT.items()}
    record['business_age'] = data.get('business_age') if data.get('business_age') in BUSINESS_AGE else ''
    record['business_size'] = data.get('business_size') if data.get('business_size') in BUSINESS_SIZE else ''
    record['monthly_volume'] = data.get('monthly_volume') if data.get('monthly_volume') in MONTHLY_VOLUME else ''
    record['source_of_funds'] = data.get('source_of_funds') if data.get('source_of_funds') in SOURCE_OF_FUNDS else ''
    record['business_tin'] = _tin(data.get('business_tin'))
    record['owner_tin'] = _tin(data.get('owner_tin'))
    record['birthday'] = _birthday(data.get('birthday'))
    record['mobile'] = _mobile(data.get('mobile'))
    email = _clean(data.get('email'), 120).lower()
    record['email'] = email if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email) else ''
    kind = data.get('payout_kind') if data.get('payout_kind') in ('gcash', 'bank') else ''
    record['payout_kind'] = kind
    if kind == 'gcash':
        record['payout_institution'] = 'GCash'
    number = _account_number(kind, data.get('payout_account_number'))
    existing_last4 = re.sub(r'\D', '', str(data.get('payout_last4') or ''))
    record['payout_last4'] = number[-4:] if number else existing_last4 if len(existing_last4) == 4 else ''
    missing = [label for key, (_limit, label) in TEXT.items() if key != 'payout_institution' and not record[key]]
    if not record['business_age']:
        missing.append('How long the business has operated')
    if not record['business_size']:
        missing.append('Business size')
    if not record['monthly_volume']:
        missing.append('Monthly sales')
    if not record['business_tin']:
        missing.append('Business TIN')
    if not record['birthday']:
        missing.append('Birthday')
    if not record['mobile']:
        missing.append('Mobile number')
    if not record['email']:
        missing.append('Email')
    if not record['source_of_funds']:
        missing.append('Source of funds')
    if not record['owner_tin']:
        missing.append('Owner TIN')
    if not kind:
        missing.append('GCash or bank')
    elif kind == 'bank' and not record['payout_institution']:
        missing.append('Bank name')
    if not record['payout_last4']:
        missing.append('GCash number' if kind == 'gcash' else 'Account number')
    record['missing'] = missing
    record['ready'] = not missing
    record['platform_fee_percent'] = PLATFORM_FEE_PERCENT
    record['platform_fee_editable'] = False
    return record


def public_setup(row):
    record = normalize_setup(row or {})
    record['status'] = 'ready' if record['ready'] else 'incomplete'
    record['updated_at'] = (row or {}).get('updated_at')
    record.pop('payout_account_number', None)
    return record


def register_menu_payment_routes(app, *, db, get_business, require_owner, has_feature, on_hold):
    def owner_business(public_id, authorization):
        require_owner(public_id, authorization)
        business = get_business(public_id)
        if not business:
            raise HTTPException(404, 'Business not found')
        if not has_feature(business, 'qr_menu'):
            raise HTTPException(403, 'QR Menu is included in Growth and Pro.')
        if str(business.get('status') or '').upper() != 'ACTIVE' or on_hold(business):
            raise HTTPException(403, 'An active business subscription is required for QR Menu.')
        return business

    def load(business):
        try:
            rows = db.table('merchant_menu_payment_setups').select('*').eq('business_id', business['id']).limit(1).execute().data or []
        except Exception as exc:
            raise HTTPException(503, 'Menu payments are not ready. Apply backend/menu_payments.sql in Supabase.') from exc
        return public_setup(rows[0] if rows else {})

    @app.get('/api/v1/business/{public_id}/qr-menu/payments')
    def get_menu_payments(public_id: str, authorization: str = Header(default='')):
        return load(owner_business(public_id, authorization))

    @app.put('/api/v1/business/{public_id}/qr-menu/payments')
    def save_menu_payments(public_id: str, update: MenuPaymentSetup, authorization: str = Header(default='')):
        business = owner_business(public_id, authorization)
        record = public_setup(update.model_dump())
        row = {key: record[key] for key in (
            'trade_name', 'address_line', 'city', 'industry', 'description', 'business_age', 'business_size',
            'monthly_volume', 'business_tin', 'owner_name', 'birthday', 'nationality', 'birth_place', 'mobile',
            'email', 'work', 'source_of_funds', 'owner_tin', 'owner_address', 'payout_kind',
            'payout_institution', 'payout_account_name', 'payout_last4')}
        row.update(business_id=business['id'], updated_at=datetime.now(timezone.utc).isoformat())
        try:
            db.table('merchant_menu_payment_setups').upsert(row, on_conflict='business_id').execute()
        except Exception as exc:
            raise HTTPException(503, 'Could not save menu payments. Please try again.') from exc
        saved = load(business)
        saved['updated_at'] = row['updated_at']
        return saved

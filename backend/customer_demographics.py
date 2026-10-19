"""Admin-only aggregates of merchant customers, never owner or visitor profiles."""
from collections import Counter
from datetime import date, datetime, timezone
from threading import Lock
from time import monotonic
from zoneinfo import ZoneInfo
import re

from fastapi import Depends, HTTPException, Response


AGE_LABELS = {
    'under_18': 'Under 18', '18_24': '18–24', '25_34': '25–34',
    '35_44': '35–44', '45_54': '45–54', '55_64': '55–64', '65_plus': '65+',
}
GENDER_LABELS = {'female': 'Female', 'male': 'Male', 'lgbtq': 'LGBTQ+', 'rather_not_say': 'Prefer not to say'}
OCCUPATION_LABELS = {'working': 'Working', 'business_owner': 'Business owner', 'unemployed': 'Unemployed'}
PAGE_SIZE = 1000
MIN_SAMPLE = 10
MIN_CELL = 5
CACHE_SECONDS = 300


def _missing_column(exc, optional):
    message = str(getattr(exc, 'message', '') or exc)
    code = str(getattr(exc, 'code', '') or '')
    if code not in ('42703', 'PGRST204') and 'column' not in message.lower():
        return None
    for field in optional:
        if re.search(rf"(?:column\s+(?:\w+\.)?{re.escape(field)}\b|['\"]{re.escape(field)}['\"]\s+column)", message, re.I):
            return field
    return None


def read_pages(db, table, required, optional=(), missing=None):
    """Narrow reads, stable pagination, and explicit older-schema coverage."""
    columns = list(required) + list(optional)
    offset = 0
    while True:
        try:
            rows = db.table(table).select(','.join(columns)).order('id').range(offset, offset + PAGE_SIZE - 1).execute().data or []
        except Exception as exc:
            field = _missing_column(exc, set(optional) & set(columns))
            if not field:
                raise
            columns.remove(field)
            if missing is not None:
                missing.add(f'{table}.{field}')
            continue
        yield from rows
        if len(rows) < PAGE_SIZE:
            return
        offset += PAGE_SIZE


def age_bracket(row, today):
    saved = str(row.get('age_bracket') or '').strip()
    if saved in AGE_LABELS:
        return saved
    age = None
    try:
        raw = row.get('age')
        if raw is not None and str(raw).strip():
            age = int(str(raw))
    except (ValueError, TypeError):
        pass
    if age is None and row.get('birthday'):
        try:
            born = date.fromisoformat(str(row['birthday'])[:10])
            age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        except (ValueError, TypeError):
            pass
    if age is None or not 0 <= age <= 120:
        return None
    for maximum, key in ((17, 'under_18'), (24, '18_24'), (34, '25_34'), (44, '35_44'), (54, '45_54'), (64, '55_64')):
        if age <= maximum:
            return key
    return '65_plus'


def _row_rank(row):
    for field in ('updated_at', 'created_at'):
        try:
            parsed = datetime.fromisoformat(str(row.get(field) or '').replace('Z', '+00:00'))
            return (parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).timestamp(), str(row['id']))
        except (ValueError, TypeError):
            pass
    return (0, str(row['id']))


def safe_distribution(counts, labels, total):
    known = sum(counts.values())
    hidden = {key for key, value in counts.items() if 0 < value < MIN_CELL}
    visible = [(key, counts.get(key, 0)) for key in labels if counts.get(key, 0) >= MIN_CELL]
    # Keep a small cell from being recovered by subtracting visible cells.
    if hidden and visible:
        hidden.add(min(visible, key=lambda value: value[1])[0])
    available = known >= MIN_SAMPLE and any(counts.get(key, 0) > 0 and key not in hidden for key in labels)
    rows = []
    for key, label in labels.items():
        count = counts.get(key, 0) if available and key not in hidden else None
        rows.append({'key': key, 'label': label, 'count': count,
                     'percent': round(count / known * 100, 1) if count is not None and known else None})
    largest = None
    if available and not hidden:
        maximum = max(counts.values(), default=0)
        largest = {'label': ' / '.join(labels[key] for key in labels if counts.get(key, 0) == maximum),
                   'count': maximum, 'percent': round(maximum / known * 100, 1)}
    return {
        'available': available, 'sample_size': known, 'missing': total - known,
        'coverage_percent': round(known / total * 100, 1) if total else None,
        'suppressed': bool(hidden), 'rows': rows, 'largest_group': largest,
    }


def build_customer_demographics(businesses, programs, customers, today=None):
    today = today or datetime.now(ZoneInfo('Asia/Manila')).date()
    included = {str(row['id']) for row in businesses if not row.get('is_demo')}
    employees = {(str(row['business_id']), str(row['id'])) for row in programs
                 if row.get('card_type') == 'employee' or (row.get('card_type') == 'membership' and row.get('membership_employee_mode') is True)}
    people = {}
    memberships = linked = excluded_employees = 0
    for row in customers:
        business_id = str(row['business_id'])
        if business_id not in included:
            continue
        if (business_id, str(row.get('program_id'))) in employees:
            excluded_employees += 1
            continue
        memberships += 1
        identity = row.get('identity_id')
        has_identity = identity is not None and str(identity).strip() != ''
        linked += int(has_identity)
        key = (business_id, 'identity' if has_identity else 'membership', str(identity if has_identity else row['id']))
        profile = people.setdefault(key, {})
        rank = _row_rank(row)
        values = {'age': age_bracket(row, today), 'gender': str(row.get('gender') or '').strip().lower(),
                  'occupation': str(row.get('occupation') or '').strip().lower()}
        for field, labels in (('age', AGE_LABELS), ('gender', GENDER_LABELS), ('occupation', OCCUPATION_LABELS)):
            value = values[field]
            if value in labels and (field not in profile or rank > profile[field][0]):
                profile[field] = (rank, value)
    counts = {field: Counter(profile[field][1] for profile in people.values() if field in profile)
              for field in ('age', 'gender', 'occupation')}
    total = len(people)
    represented = len({key[0] for key in people})
    return {
        'generated_at': datetime.now(timezone.utc).isoformat(), 'stale': False,
        'scope': 'Customers registered with all non-demo businesses',
        'summary': {'customers': total, 'memberships': memberships, 'businesses': len(included),
                    'businesses_with_customers': represented,
                    'average_customers_per_business': round(total / len(included), 1) if included else None,
                    'identity_linked_memberships': linked, 'unlinked_memberships': memberships - linked,
                    'employee_memberships_excluded': excluded_employees},
        'age': safe_distribution(counts['age'], AGE_LABELS, total),
        'gender': safe_distribution(counts['gender'], GENDER_LABELS, total),
        'occupation': safe_distribution(counts['occupation'], OCCUPATION_LABELS, total),
        'privacy': {'minimum_sample': MIN_SAMPLE, 'minimum_cell': MIN_CELL, 'secondary_suppression': True},
        'methodology': {
            'counting': 'Shared identities count once per business, across their cards. A person visiting two businesses counts once at each. Legacy memberships without a shared identity count separately.',
            'responses': 'The latest available valid response per customer is used. Missing or invalid values are excluded from each demographic denominator.',
            'age': 'Age ranges are reported. An exact average age cannot be calculated from age ranges; legacy saved ages or full birthdays are converted to ranges.',
            'average': 'Customer count divided by all non-demo businesses, including businesses with no customers. Business account status does not filter the population.',
            'location': 'Customer city/region is not consistently collected. Business addresses and website visitor locations are not used to guess customer demographics.',
        },
    }


class CustomerDemographicsReport:
    def __init__(self, db, on_warning=None, clock=monotonic):
        self.db, self.on_warning, self.clock = db, on_warning, clock
        self.cached, self.cached_at, self.lock = None, None, Lock()

    def get(self):
        now = self.clock()
        if self.cached is not None and now - self.cached_at < CACHE_SECONDS:
            return self.cached
        if not self.lock.acquire(blocking=False):
            if self.cached is not None:
                return {**self.cached, 'stale': True}
            raise HTTPException(503, 'Customer demographics are being prepared. Please retry shortly.', headers={'Retry-After': '3'})
        try:
            if self.cached is not None and self.clock() - self.cached_at < CACHE_SECONDS:
                return self.cached
            if self.db is None:
                raise RuntimeError('Database unavailable')
            missing = set()
            businesses = list(read_pages(self.db, 'businesses', ('id', 'is_demo')))
            programs = list(read_pages(self.db, 'loyalty_programs', ('id', 'business_id', 'card_type'), ('membership_employee_mode',), missing))
            customers = read_pages(self.db, 'customers', ('id', 'business_id'),
                                   ('identity_id', 'program_id', 'age_bracket', 'gender', 'occupation', 'age', 'birthday', 'created_at', 'updated_at'), missing)
            report = build_customer_demographics(businesses, programs, customers)
            report['source_fields_missing'] = sorted(missing)
            report['cache_seconds'] = CACHE_SECONDS
            self.cached, self.cached_at = report, self.clock()
            return report
        except Exception as exc:
            if self.on_warning:
                self.on_warning(type(exc).__name__)
            if self.cached is not None and now - self.cached_at < 3600:
                return {**self.cached, 'stale': True}
            raise HTTPException(503, 'Customer demographics are temporarily unavailable. Please try again shortly.') from exc
        finally:
            self.lock.release()


def register_customer_demographics_routes(app, *, db, require_admin, on_warning=None):
    report = CustomerDemographicsReport(db, on_warning)

    @app.get('/api/v1/admin/customer-demographics')
    def customer_demographics(response: Response, _: bool = Depends(require_admin)):
        response.headers['Cache-Control'] = 'private, no-store'
        try:
            return report.get()
        except HTTPException as exc:
            exc.headers = {**(exc.headers or {}), 'Cache-Control': 'private, no-store'}
            raise

    return report

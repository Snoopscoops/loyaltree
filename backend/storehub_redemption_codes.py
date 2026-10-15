"""Manual StoreHub discounts, verified receipts and one-time LoyaltyTree codes."""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import inspect
import re


class RedemptionCodeError(Exception):
    def __init__(self, message, *, review=False):
        super().__init__(message)
        self.review = review


def money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount > Decimal('1000000000'):
            raise InvalidOperation
        return amount.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise RedemptionCodeError('Enter a valid amount with up to two decimal places.') from exc


def timestamp(value):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError('timezone required')
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError) as exc:
        raise RedemptionCodeError('The checkout time needs review.', review=True) from exc


def build_options(programs, config):
    """Keep each membership's balances and benefit limits separate."""
    result = []
    for program in programs:
        customer = str(program.get('membership_customer_public_id') or '')
        if not customer:
            continue
        common = {'customer_public_id': customer, 'program_name': program.get('program_name') or 'Loyalty program'}
        if config.get('enabled') and program.get('points_enabled'):
            for raw in config.get('options') or []:
                points = int(raw)
                if (points < int(config.get('min_points') or 1)
                        or points % int(config.get('increment_points') or 1)
                        or points > int(program.get('points_balance') or 0)):
                    continue
                result.append({**common, 'id': f'points:{customer}:{points}', 'kind': 'points',
                    'reward_id': str(points), 'name': f'{points} points', 'points': points,
                    'value_mode': 'fixed', 'value': str(money(Decimal(points) * Decimal(str(config['value_per_point'])))),
                    'max_percent': str(config.get('max_percent') or 100), 'requires_item_amount': False})
        for coupon in program.get('redeemables') or []:
            if str(coupon.get('source') or '').lower() == 'campaign':
                continue  # Campaigns retain their separate branch and promotion ledger flow.
            identifier = str(coupon.get('public_id') or '')
            if not identifier:
                continue
            kind = str(coupon.get('reward_type') or 'redeemable').lower()
            mode = 'percentage' if kind in ('percentage_discount', 'percent_discount') else 'fixed' if kind == 'fixed_discount' else 'item'
            result.append({**common, 'id': f'coupon:{customer}:{identifier}', 'kind': 'coupon',
                'reward_id': identifier, 'name': coupon.get('name') or 'Earned reward',
                'value_mode': mode, 'value': str(money(coupon.get('reward_value') or 0)),
                'min_purchase_amount': str(money(coupon.get('min_purchase_amount') or 0)),
                'requires_item_amount': mode == 'item', 'stacking_allowed':coupon.get('stacking_allowed') is not False,
                'birthday_verification_required':bool(coupon.get('birthday_verification_required'))})
        for benefit in program.get('benefits') or []:
            identifier = str(benefit.get('id') or '')
            if not identifier or not benefit.get('available'):
                continue
            kind = str(benefit.get('benefit_type') or 'custom').lower()
            mode = 'percentage' if kind == 'percentage_discount' else 'fixed' if kind == 'fixed_discount' else 'item' if kind == 'free_item' else 'benefit'
            result.append({**common, 'id': f'benefit:{customer}:{identifier}', 'kind': 'benefit',
                'reward_id': identifier, 'name': benefit.get('name') or 'Employee benefit',
                'value_mode': mode, 'value': str(money(benefit.get('value') or 0)),
                'requires_item_amount': mode == 'item',
                'remaining_in_window': benefit.get('remaining_in_window')})
    return result


def quote(option, gross_amount, item_amount=None, *, currency="PHP"):
    gross = money(gross_amount)
    if gross <= 0:
        raise RedemptionCodeError('Enter the current StoreHub bill total before this LoyaltyTree reward.')
    if gross < money(option.get('min_purchase_amount') or 0):
        raise RedemptionCodeError('This bill is below the reward’s minimum purchase amount.')
    mode = option['value_mode']
    value = money(option.get('value') or 0)
    if mode == 'fixed':
        discount = value if option['kind'] == 'points' else min(value, gross)
    elif mode == 'percentage':
        if value <= 0 or value > 100:
            raise RedemptionCodeError('The owner needs to correct this percentage reward.', review=True)
        discount = money(gross * value / 100)
    elif mode == 'item':
        if item_amount is None or money(item_amount) <= 0:
            raise RedemptionCodeError('Enter the eligible item’s current StoreHub price, included in the bill total.')
        discount = money(item_amount)
    elif mode == 'benefit':
        discount = Decimal('0.00')
    else:
        raise RedemptionCodeError('This reward type needs owner setup.', review=True)
    if discount > gross:
        raise RedemptionCodeError('The reward value exceeds the bill. Check the amount before generating a code.')
    if mode in ('fixed', 'percentage') and discount <= 0:
        raise RedemptionCodeError('The owner needs to configure a positive discount amount.', review=True)
    if option['kind'] == 'points' and discount > money(gross * Decimal(str(option.get('max_percent') or 100)) / 100):
        raise RedemptionCodeError('This points option exceeds the owner’s bill discount limit.')
    return {'gross_amount': str(gross), 'discount_amount': str(discount),
            'expected_total': str(money(gross - discount)),
            'instruction': f'Apply {currency} {discount:.2f} off' if discount > 0 else f'Provide benefit: {option["name"]}'}


def note_codes(raw):
    found = set()
    def walk(value, depth=0):
        if depth > 6:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in ('notes', 'note', 'comment', 'remarks') and isinstance(child, str):
                    found.update(re.findall(r'(?<![A-Z0-9])LT-[A-Z0-9]{8,16}(?![A-Z0-9])', child.upper()))
                elif isinstance(child, (dict, list)):
                    walk(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                walk(child, depth + 1)
    walk(raw)
    return found


def receipt_matches(code, rows):
    """Require note-code or exact receipt, then check amount/time/register/void."""
    if not code.get('confirmed_at'):
        return []
    start = timestamp(code['scanned_at']) - timedelta(seconds=10)
    reference = str(code.get('receipt_reference') or '').strip()
    end = timestamp(code['expires_at']) if reference else min(timestamp(code['confirmed_at']) + timedelta(minutes=10), timestamp(code['expires_at']))
    invalid, versions, matched = set(), {}, {}
    for row in rows:
        identifier = str(row.get('external_transaction_id') or '')
        raw = row.get('raw_payload') if isinstance(row.get('raw_payload'), dict) else {}
        fingerprint = tuple(str(row.get(key)) for key in ('external_receipt_number', 'net_amount', 'gross_amount',
            'external_branch_id', 'external_terminal_id', 'transacted_at', 'transaction_type'))
        versions.setdefault(identifier, set()).add(fingerprint)
        if row.get('transaction_type') != 'sale' or row.get('status') in ('voided', 'refunded', 'ignored', 'failed') or raw.get('isCancelled'):
            invalid.add(identifier)
    invalid.update(identifier for identifier, copies in versions.items() if len(copies) > 1)
    for row in rows:
        identifier = str(row.get('external_transaction_id') or '')
        if not identifier or identifier in invalid:
            continue
        raw = row.get('raw_payload') if isinstance(row.get('raw_payload'), dict) else {}
        if (str(row.get('external_branch_id') or '') != code['external_branch_id']
                or str(row.get('external_terminal_id') or '') != code['external_terminal_id']
                or str(row.get('currency') or '').upper() != code['currency']):
            continue
        codes = note_codes(raw)
        # Another LoyaltyTree code on this receipt is evidence of another checkout.
        if codes and codes != {code['code']}:
            continue
        if reference:
            if str(row.get('external_receipt_number') or '').strip() != reference:
                continue
        elif code['code'] not in codes:
            continue
        try:
            if not start <= timestamp(row.get('transacted_at')) <= end:
                continue
            if money(row.get('net_amount') if row.get('net_amount') is not None else row.get('gross_amount')) != money(code['expected_total']):
                continue
            # StoreHub's documented discount is an absolute monetary amount.
            if money(code['discount_amount']) > 0 and ('discount' not in raw or money(raw['discount']) < money(code['discount_amount'])):
                continue
            if code.get('kind') == 'coupon' and (code.get('payload') or {}).get('stacking_allowed') is False and money(raw.get('discount',0)) != money(code['discount_amount']):
                continue
        except RedemptionCodeError:
            continue
        matched[identifier] = row
    return list(matched.values())


def public_code(row):
    if not row:
        return None
    return {key: row.get(key) for key in ('id', 'code', 'kind', 'name', 'status', 'instruction',
        'gross_amount', 'discount_amount', 'expected_total', 'currency', 'expires_at',
        'receipt_reference', 'confirmed_at', 'message', 'external_transaction_id')}


def cancelled_receipts(code, rows):
    """A void can release a pending hold; refunds need separate review."""
    if not code.get('confirmed_at'):
        return []
    matches = {}
    for row in rows:
        raw = row.get('raw_payload') if isinstance(row.get('raw_payload'), dict) else {}
        if not raw.get('isCancelled'):
            continue
        if (str(row.get('external_branch_id') or '') != code['external_branch_id']
                or str(row.get('external_terminal_id') or '') != code['external_terminal_id']):
            continue
        reference = str(code.get('receipt_reference') or '').strip()
        codes = note_codes(raw)
        if codes and codes != {code['code']}:
            continue
        known_receipt = bool(code.get('matched_transaction_id') and str(code.get('external_transaction_id') or '') == str(row.get('external_transaction_id') or ''))
        if not known_receipt and reference and str(row.get('external_receipt_number') or '').strip() != reference:
            continue
        if not known_receipt and not reference and code['code'] not in codes:
            continue
        if not timestamp(code['scanned_at'])-timedelta(seconds=10) <= timestamp(row['transacted_at']) <= timestamp(code['expires_at']):
            continue
        matches[row['external_transaction_id']] = row
    return list(matches.values())


class RedemptionCodeService:
    def __init__(self, *, rpc, context, fetch, materialize, process, release, abort, reverse, log=None):
        self.rpc, self.context = rpc, context
        self.fetch, self.materialize, self.process, self.release = fetch, materialize, process, release
        self.abort, self.reverse = abort, reverse
        self.log = log or (lambda *args, **kwargs: None)

    def finish(self, code, status, message, result=None):
        return self.rpc('pos_finish_redemption_code', {'p_id': str(code['id']), 'p_lease': str(code['lease_token']),
            'p_status': status, 'p_message': message, 'p_result': result or {}})

    async def run_once(self, limit=5):
        for _ in range(min(20, max(1, limit))):
            rows = await asyncio.to_thread(self.rpc, 'pos_claim_redemption_codes', {'p_limit': 1})
            if not rows:
                break
            code = rows[0]
            try:
                if code['status'] == 'redeemed' or code.get('void_detected'):
                    await asyncio.to_thread(self.reverse, code, None)
                    continue
                if not code.get('confirmed_at') and timestamp(code['expires_at']) <= datetime.now(timezone.utc):
                    await asyncio.to_thread(self.release, code, None)
                    await asyncio.to_thread(self.finish, code, 'expired', 'Unused reservation expired. The reward is available again.')
                    continue
                context = await asyncio.to_thread(self.context, code)
                rows, complete = await asyncio.to_thread(self.fetch, code, context)
                if not complete:
                    await asyncio.to_thread(self.finish, code, 'needs_review', 'StoreHub returned an incomplete receipt list. Ask the owner to review; the reward remains reserved.')
                    continue
                voids = cancelled_receipts(code, rows)
                if len(voids) == 1:
                    transaction = await asyncio.to_thread(self.materialize, voids[0], context)
                    await asyncio.to_thread(self.abort, code, context, transaction)
                    continue
                matches = receipt_matches(code, rows)
                if len(matches) != 1:
                    message = ('More than one receipt matches. Enter the full StoreHub receipt number.' if len(matches) > 1 else
                        'Waiting for StoreHub verification. Add the full receipt number if the code is not returned in StoreHub notes.')
                    await asyncio.to_thread(self.finish, code, 'needs_review' if len(matches) > 1 or timestamp(code['expires_at']) < datetime.now(timezone.utc) else 'confirmed', message)
                    continue
                transaction = await asyncio.to_thread(self.materialize, matches[0], context)
                transaction = await asyncio.to_thread(self.rpc, 'pos_claim_redemption_receipt', {
                    'p_id': str(code['id']), 'p_lease': str(code['lease_token']), 'p_transaction_id': str(transaction['id'])})
                result = self.process(code, context, transaction)
                if inspect.isawaitable(result):
                    result = await result
                await asyncio.to_thread(self.finish, code, 'redeemed', 'Receipt verified. Reward redeemed.', result)
            except Exception as exc:
                detail = str(getattr(exc, 'detail', exc))[:500]
                review = getattr(exc, 'review', False) or getattr(exc, 'status_code', 0) in (400, 401, 402, 403, 404)
                if str(getattr(exc, 'code', '')) in ('P0001', '23505'):
                    review = True
                if getattr(exc, 'status_code', 0) == 409:
                    review = not any(message in detail.lower() for message in ('already being processed', 'please wait', 'not synced'))
                try:
                    await asyncio.to_thread(self.finish, code, 'needs_review' if review else code['status'], detail)
                except Exception:
                    self.log('redemption_code_finish_failed', code_id=str(code['id']))


async def periodic_redemption_codes(factory, interval_seconds=30, log=None):
    while True:
        try:
            await factory().run_once()
        except Exception as exc:
            if log:
                log('redemption_code_worker_failed', error=str(exc)[:500])
        await asyncio.sleep(max(15, interval_seconds))

"""Durable, earning-only offline sales. StoreHub remains the source of truth.

The device's amount is a lookup key, never an instruction to add points. Every
award passes the normal Companion processor after an atomic receipt claim.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import inspect
import json
import re
from uuid import UUID


PENDING_STATES = ('pending', 'awaiting_storehub', 'needs_review')
TIME_PADDING_SECONDS = 10


class OfflineSaleError(Exception):
    def __init__(self, message: str, *, review: bool = False):
        super().__init__(message)
        self.review = review


def timestamp(value) -> datetime:
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('timezone required')
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError) as exc:
        raise OfflineSaleError('Save the original sale times with their timezone.') from exc


def money(value) -> Decimal:
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result < 0 or result > Decimal('1000000000'):
            raise InvalidOperation
        return result.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise OfflineSaleError('Enter a valid final bill total.') from exc


def receipt_key(value) -> str:
    return re.sub('[^A-Za-z0-9]', '', str(value or '')).lower()


def normalize_event(event: dict, context: dict, now: datetime | None = None) -> dict:
    """Normalize once before hashing; corrections never replace this identity."""
    now = now or datetime.now(timezone.utc)
    try:
        event_id = str(UUID(str(event.get('client_event_id') or '')))
    except ValueError as exc:
        raise OfflineSaleError('This saved sale needs its original event ID.') from exc
    if event.get('pending_redemption'):
        raise OfflineSaleError('Offline saving is earning-only. Resolve the pending redemption online first.', review=True)
    for key in ('device_id', 'business_public_id', 'branch_public_id', 'external_branch_id', 'external_terminal_id'):
        if not str(event.get(key) or '').strip() or str(event.get(key)).strip() != str(context.get(key) or '').strip():
            raise OfflineSaleError('This saved sale belongs to a different POS device, branch, or register. Ask the owner to review it.', review=True)
    customer = str(event.get('customer_ref') or '').strip()
    if not customer or len(customer) > 500:
        raise OfflineSaleError('The scanned member is missing from this saved sale.')
    scanned, completed = timestamp(event.get('scanned_at')), timestamp(event.get('completed_at'))
    if completed < scanned or completed - scanned > timedelta(hours=12):
        raise OfflineSaleError('The saved scan and completion times need review.', review=True)
    if completed > now + timedelta(minutes=5):
        raise OfflineSaleError('The POS clock is ahead. Correct its time before syncing this sale.', review=True)
    receipt = str(event.get('receipt_reference') or '').strip()
    mode = str(event.get('receipt_match_mode') or ('full' if receipt else 'amount')).strip()
    if mode not in ('amount', 'suffix5', 'full') or len(receipt) > 200:
        raise OfflineSaleError('Enter the receipt number or leave it blank.')
    if (mode == 'amount' and receipt) or (mode != 'amount' and not receipt):
        raise OfflineSaleError('The receipt matching option does not match the saved receipt.')
    if mode == 'suffix5' and (len(receipt_key(receipt)) != 5 or not re.fullmatch('[A-Za-z0-9]{5}', receipt)):
        raise OfflineSaleError('Enter exactly the last five receipt characters, or use the full receipt number.')
    currency = str(event.get('currency') or '').upper().strip()
    if not re.fullmatch('[A-Z]{3}', currency) or currency != context.get('currency'):
        raise OfflineSaleError('This sale currency does not match the business currency.', review=True)
    final_amount = money(event.get('final_amount'))
    if final_amount <= 0:
        raise OfflineSaleError('Offline earning requires a final bill total above zero.')
    original = {
        'client_event_id': event_id, 'customer_ref': customer,
        'receipt_reference': receipt, 'receipt_match_mode': mode,
        'final_amount': str(final_amount), 'currency': currency,
        'scanned_at': scanned.isoformat(), 'completed_at': completed.isoformat(),
        'device_id': context['device_id'], 'business_public_id': context['business_public_id'],
        'branch_public_id': context['branch_public_id'], 'external_branch_id': context['external_branch_id'],
        'external_terminal_id': context['external_terminal_id'],
        'session_id': str(event.get('session_id') or '').strip() or None,
        'pending_redemption': False,
    }
    digest = hashlib.sha256(json.dumps(original, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {
        **original, 'event_hash': digest, 'original_event': original,
        'business_id': str(context['business_id']), 'branch_id': str(context['branch_id']),
        'integration_id': str(context['integration_id']), 'provider': 'storehub',
        'scope': {key: context[key] for key in ('external_branch_id', 'external_terminal_id', 'business_public_id', 'branch_public_id')},
    }


def public_event(row: dict) -> dict:
    status = str(row.get('status') or 'pending')
    return {
        'id': str(row.get('id') or ''), 'client_event_id': row.get('client_event_id'),
        'status': status, 'acknowledged': bool(row.get('id')),
        'message': row.get('message') or 'Saved on the server. Points are pending StoreHub verification.',
        'receipt_reference': row.get('receipt_reference') or '',
        'receipt_match_mode': row.get('receipt_match_mode') or 'amount',
        'requires_full_receipt': status == 'needs_review' and bool((row.get('result') or {}).get('requires_full_receipt')),
        'final_amount': str(row.get('final_amount') or '0'), 'currency': row.get('currency'),
        'completed_at': row.get('completed_at'),
        'result': row.get('result') if isinstance(row.get('result'), dict) else {},
    }


def matching_sales(event: dict, rows: list[dict]) -> list[dict]:
    """Return all exact candidates; never select the newest/closest sale."""
    start = timestamp(event['scanned_at']) - timedelta(seconds=TIME_PADDING_SECONDS)
    end = timestamp(event['completed_at']) + timedelta(seconds=TIME_PADDING_SECONDS)
    scope = event.get('scope') or {}
    expected_amount = money(event['final_amount'])
    result = {}
    invalid_ids = {
        str(row.get('external_transaction_id') or '') for row in rows
        if row.get('transaction_type') != 'sale'
        or row.get('status') in ('voided', 'refunded', 'ignored', 'failed')
        or (row.get('raw_payload') or {}).get('isCancelled')
    }
    versions = {}
    for row in rows:
        reference = str(row.get('external_transaction_id') or '')
        fingerprint = tuple(str(row.get(key) or '') for key in (
            'external_receipt_number', 'transaction_type', 'external_branch_id',
            'external_terminal_id', 'currency', 'net_amount', 'gross_amount', 'transacted_at',
        ))
        versions.setdefault(reference, set()).add(fingerprint)
    invalid_ids.update(reference for reference, fingerprints in versions.items() if len(fingerprints) > 1)
    for row in rows:
        raw = row.get('raw_payload') if isinstance(row.get('raw_payload'), dict) else {}
        if row.get('transaction_type') != 'sale' or row.get('status') in ('voided', 'refunded', 'ignored', 'failed') or raw.get('isCancelled'):
            continue
        if (str(row.get('external_branch_id') or '') != str(scope.get('external_branch_id') or '')
                or str(row.get('external_terminal_id') or '') != str(scope.get('external_terminal_id') or '')
                or str(row.get('currency') or '').upper() != event['currency']):
            continue
        try:
            occurred = timestamp(row.get('transacted_at'))
            amount = money(row.get('net_amount') if row.get('net_amount') is not None else row.get('gross_amount'))
        except OfflineSaleError:
            continue
        if amount != expected_amount or not start <= occurred <= end:
            continue
        receipt = str(row.get('external_receipt_number') or '').strip()
        mode = event.get('receipt_match_mode')
        if mode == 'full' and receipt != event.get('receipt_reference'):
            continue
        if mode == 'suffix5' and receipt_key(receipt)[-5:] != receipt_key(event.get('receipt_reference')):
            continue
        external_id = str(row.get('external_transaction_id') or '').strip()
        if external_id and external_id not in invalid_ids:
            result[external_id] = row
    return list(result.values())


def overlaps_amount_event(event: dict, other: dict) -> bool:
    if event.get('receipt_match_mode') != 'amount' or other.get('receipt_match_mode') != 'amount' or str(event.get('id')) == str(other.get('id')):
        return False
    if other.get('status') not in PENDING_STATES:
        return False
    if any(str(event.get(key)) != str(other.get(key)) for key in ('integration_id', 'branch_id', 'currency')):
        return False
    if (event.get('scope') or {}).get('external_terminal_id') != (other.get('scope') or {}).get('external_terminal_id'):
        return False
    if money(event['final_amount']) != money(other['final_amount']):
        return False
    padding = timedelta(seconds=TIME_PADDING_SECONDS)
    return (timestamp(event['scanned_at']) - padding <= timestamp(other['completed_at']) + padding
            and timestamp(other['scanned_at']) - padding <= timestamp(event['completed_at']) + padding)


class OfflineSalesService:
    def __init__(self, *, db, rpc, context, customer, fetch, materialize, process, log=None):
        self.db, self.rpc = db, rpc
        self.context, self.customer = context, customer
        self.fetch, self.materialize, self.process = fetch, materialize, process
        self.log = log or (lambda *args, **kwargs: None)

    def enqueue(self, device: dict, events: list[dict]) -> list[dict]:
        results = [None] * len(events)
        prepared = []
        def failed(event, exc):
            return {
                'client_event_id': event.get('client_event_id'), 'id': '',
                'status': 'needs_review' if getattr(exc, 'review', False) else 'rejected',
                'acknowledged': False, 'requires_full_receipt': False,
                'message': str(getattr(exc, 'detail', exc))[:500],
            }
        for index, event in enumerate(events):
            try:
                context = self.context(device, event)
                prepared.append((index, normalize_event(event, context)))
            except Exception as exc:
                results[index] = failed(event, exc)
        if prepared:
            try:
                # One DB transaction makes the whole batch visible together.
                # A worker cannot award the first overlapping customer while
                # this same upload is still inserting the second customer.
                rows = self.rpc('pos_offline_sales_enqueue_batch', {'p_events': [event for _, event in prepared]})
                if not isinstance(rows, list) or len(rows) != len(prepared):
                    raise RuntimeError('The offline upload was not acknowledged. Keep these sales on this POS and retry.')
                for (index, _), row in zip(prepared, rows):
                    results[index] = public_event(row) if row.get('id') else {**row, 'acknowledged': False}
            except Exception as exc:
                for index, event in prepared:
                    results[index] = failed(event, exc)
        return results

    def _finish(self, event, status, message, result=None):
        return self.rpc('pos_finish_offline_sale', {
            'p_event_id': str(event['id']), 'p_lease_token': str(event['lease_token']),
            'p_status': status, 'p_message': message, 'p_result': result or {},
            'p_retry_seconds': min(3600, 30 * 2 ** min(int(event.get('attempts') or 1), 6)),
        })

    def _overlapping(self, event):
        rows = (self.db.table('storehub_offline_sales').select('*')
                .eq('integration_id', event['integration_id']).eq('branch_id', event['branch_id'])
                .eq('currency', event['currency']).eq('final_amount', event['final_amount'])
                .in_('status', list(PENDING_STATES)).limit(501).execute().data or [])
        # A capped collision search is not evidence that an event is unique.
        return len(rows) > 500 or any(overlaps_amount_event(event, row) for row in rows)

    async def run_once(self, limit=10) -> int:
        completed = 0
        fetch_cache = {}
        for _ in range(max(1, min(int(limit), 100))):
            # Lease only the event we are about to process. A slow provider call
            # cannot consume the leases of nine later events in this run.
            claimed = await asyncio.to_thread(self.rpc, 'pos_claim_offline_sales', {'p_limit': 1, 'p_lease_seconds': 300})
            if isinstance(claimed, dict):
                claimed = [claimed]
            if not claimed:
                break
            event = claimed[0]
            try:
                device = {'id': event['device_id']}
                original = event.get('original_event') or {**(event.get('scope') or {}), **event}
                context = await asyncio.to_thread(self.context, device, original)
                customer = await asyncio.to_thread(self.customer, event['customer_ref'], context)
                if not customer:
                    raise OfflineSaleError('The member is no longer available. Ask the owner to review this sale.', review=True)
                if event.get('receipt_match_mode') == 'amount' and await asyncio.to_thread(self._overlapping, event):
                    await asyncio.to_thread(self._finish, event, 'needs_review', 'Two saved sales could match the same total and time. Enter the full receipt number to identify this sale.', {'requires_full_receipt': True})
                    continue
                cache_key = (str(event['integration_id']), str((event.get('scope') or {}).get('external_branch_id')), timestamp(event['scanned_at']).isoformat(), timestamp(event['completed_at']).isoformat())
                if cache_key not in fetch_cache:
                    fetch_cache[cache_key] = await asyncio.to_thread(self.fetch, event, context)
                rows, complete = fetch_cache[cache_key]
                if not complete:
                    await asyncio.to_thread(self._finish, event, 'needs_review', 'StoreHub returned an incomplete transaction page. No points were awarded; ask the owner to review this sale.')
                    continue
                matches = matching_sales(event, rows)
                if not matches:
                    await asyncio.to_thread(self._finish, event, 'awaiting_storehub', 'Saved. Waiting for this completed sale to appear in StoreHub; points remain pending.')
                    continue
                if len(matches) != 1:
                    await asyncio.to_thread(self._finish, event, 'needs_review', 'More than one StoreHub sale matches. Enter the full receipt number; no points have been awarded.', {'requires_full_receipt': True})
                    continue
                tx = await asyncio.to_thread(self.materialize, matches[0], context)
                if not tx or not tx.get('id'):
                    raise RuntimeError('StoreHub sale could not be saved for verification. It will retry.')
                tx = await asyncio.to_thread(self.rpc, 'pos_claim_offline_sale_transaction', {
                    'p_event_id': str(event['id']), 'p_lease_token': str(event['lease_token']),
                    'p_transaction_id': str(tx['id']), 'p_customer_id': str(customer['id']),
                })
                result = self.process(event, context, customer, tx)
                if inspect.isawaitable(result):
                    result = await result
                await asyncio.to_thread(self._finish, event, 'processed', 'StoreHub sale verified. Loyalty rewards were processed.', result or {})
                completed += 1
            except Exception as exc:
                detail = str(getattr(exc, 'detail', exc))[:500]
                # Scope/receipt/claim conflicts need a human decision. Network
                # and provider failures remain pending and retry automatically.
                review = getattr(exc, 'review', False) or getattr(exc, 'status_code', 0) in (400, 401, 402, 403, 404, 409)
                review = review or any(word in detail.lower() for word in ('already claimed', 'different customer', 'scope changed', 'ambiguous', 'inactive', 'register changed', 'receipt mismatch', 'does not match', 'same active storehub', 'original active', 'overlapping offline sales', 'already bound', 'does not belong'))
                if (getattr(exc, 'status_code', 0) == 409
                        and detail.strip().lower() in ('this transaction is already being processed. please wait.',
                            'this receipt is reserved for a saved offline sale. please wait for offline verification.')):
                    # The online checkout can be finishing the same member's
                    # receipt. Its canonical idempotency guard is retryable.
                    review = False
                try:
                    await asyncio.to_thread(self._finish, event, 'needs_review' if review else 'awaiting_storehub', detail,
                        {'requires_full_receipt': True} if review and ('overlapping offline sales' in detail.lower() or 'receipt mismatch' in detail.lower()) else {})
                except Exception as finish_error:
                    self.log('storehub_offline_finish_failed', error=str(finish_error), event_id=str(event.get('id')))
                self.log('storehub_offline_sale_failed', error=detail, event_id=str(event.get('id')))
        return completed


async def periodic_offline_sales(service_factory, interval_seconds=30, log=None):
    while True:
        try:
            await service_factory().run_once()
        except Exception as exc:
            if log:
                log('storehub_offline_worker_failed', error=str(exc))
        await asyncio.sleep(max(10, int(interval_seconds)))

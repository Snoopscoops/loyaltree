"""Bounded APNs outbox; acceptance never proves phone receipt.

Callers authorize and dirty their own pass audience. This module never renders
passes or expands a device token into another business's serial numbers.
"""
from collections import Counter
import time


class DeliveryCount(int):
    """Preserve legacy integer callers while retaining precise outcomes."""
    def __new__(cls, accepted=0, **fields):
        value = super().__new__(cls, accepted)
        value.details = {**dict(targets=0, attempted=0, apns_accepted=int(accepted),
            retryable_failed=0, permanent_failed=0, deferred=0, queued=0,
            retry_unavailable=0, acknowledgement_uncertain=0, retry_exhausted=0), **fields}
        return value

    def wallet_result(self):
        d = self.details
        if d['targets'] == int(self): status = 'push_sent'
        elif int(self): status = 'push_partial'
        elif d['queued'] and not d['retry_unavailable']: status = 'push_queued'
        elif d['permanent_failed'] == d['targets']: status = 'push_rejected'
        else: status = 'push_failed'
        return dict(status=status, pushes_sent=int(self), registrations=d['targets'],
            retry_required=bool(d['retry_unavailable']), delivery_status='unconfirmed', **d)


class AppleDelivery:
    def __init__(self, *, db, client, cert, paused, log, fallback, trim=lambda: None,
                 sleep=time.sleep, clock=time.monotonic, batch_size=20, batch_delay=.25):
        self.db, self.client, self.cert, self.paused = db, client, cert, paused
        self.log, self.fallback, self.trim = log, fallback, trim
        self.sleep, self.clock = sleep, clock
        self.batch_size, self.batch_delay = min(20, batch_size), batch_delay
        self.last_warning = None

    def _rpc(self, action, **data):
        return self.db().rpc('apple_push_delivery_command', {'p_action': action, 'p_data': data}).execute().data or {}

    def _warning(self, exc):
        now = self.clock()
        if self.last_warning is None or now-self.last_warning >= 60:
            self.last_warning = now
            self.log('apple_push_queue_unavailable', 'warning', error_type=type(exc).__name__,
                durable=False, action='Apply apple_wallet_delivery.sql; durable handoff is not confirmed.')

    def _remember(self, token, context):
        self.fallback[(context['business_id'], token)] = dict(context)

    def _deliver(self, jobs, pass_type):
        outcomes = []
        try:
            cert = self.cert()
            if not cert or not cert[0]: raise RuntimeError('APNs credentials unavailable')
            with self.client(cert) as client:
                for job in jobs:
                    outcome = dict(id=job.get('id'), lease=job.get('lease'), revision=job.get('revision'),
                        outcome='deferred', attempted=False, status=None, reason='memory_pressure')
                    if not self.paused():
                        outcome.update(outcome='retry', attempted=True, reason=None)
                        try:
                            response = client.post('https://api.push.apple.com/3/device/' + job['push_token'],
                                headers={'apns-topic': pass_type}, json={})
                            status = response.status_code
                            outcome['status'] = status
                            if status == 200:
                                outcome['outcome'] = 'accepted'
                            else:
                                try: reason = response.json().get('reason')
                                except Exception: reason = None
                                allowed = {'BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered',
                                    'TooManyRequests', 'InternalServerError', 'ServiceUnavailable', 'Shutdown',
                                    'BadCertificate', 'BadCertificateEnvironment', 'ExpiredProviderToken',
                                    'InvalidProviderToken', 'MissingTopic', 'BadTopic'}
                                outcome['reason'] = reason if reason in allowed else 'ProviderRejected'
                                if status == 410 or reason in {'BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'}:
                                    outcome['outcome'] = 'rejected'
                        except Exception as exc:
                            outcome['reason'] = type(exc).__name__
                    outcomes.append(outcome)
        except Exception as exc:
            for job in jobs[len(outcomes):]:
                outcomes.append(dict(id=job.get('id'), lease=job.get('lease'), revision=job.get('revision'),
                    outcome='retry', attempted=False, status=None, reason=type(exc).__name__))
        finally:
            try: self.trim()
            except Exception: pass
        return outcomes

    def _summary(self, context, counts, errors):
        self.log('apple_push_summary', 'warning' if counts['retryable_failed'] or counts['permanent_failed'] or counts['retry_unavailable'] or counts['acknowledgement_uncertain'] else 'info',
            business_id=context['business_id'], business_slug=context.get('business_slug'),
            reason=context.get('reason'), delivery_status='unconfirmed', **counts,
            outcomes=[dict(outcome=o, status=s, reason=r, count=n) for (o,s,r),n in errors.items()])
        return DeliveryCount(counts['apns_accepted'], **{k:v for k,v in counts.items() if k != 'apns_accepted'})

    @staticmethod
    def _counts(targets=0):
        return dict(targets=targets, attempted=0, apns_accepted=0, retryable_failed=0,
            permanent_failed=0, deferred=0, queued=0, retry_unavailable=0, acknowledgement_uncertain=0, retry_exhausted=0)

    @staticmethod
    def _count(counts, outcome, errors):
        counts['attempted'] += int(outcome['attempted'])
        key = {'accepted':'apns_accepted', 'retry':'retryable_failed', 'rejected':'permanent_failed', 'deferred':'deferred'}[outcome['outcome']]
        counts[key] += 1
        if outcome['outcome'] != 'accepted': errors[(outcome['outcome'],outcome['status'],outcome['reason'])] += 1

    def send(self, tokens, *, pass_type, business_id=None, business_slug=None, reason='wallet_update', serial_scope=None):
        tokens = list(dict.fromkeys(token for token in tokens if token))
        scope = str(business_id) if business_id is not None else 'serial:' + str(serial_scope or 'legacy')
        context = dict(business_id=scope, business_slug=business_slug, reason=reason, pass_type_identifier=pass_type)
        counts, errors = self._counts(len(tokens)), Counter()
        if not tokens: return DeliveryCount()
        queued, fallback = [], []
        # Persist before sending. A killed worker leaves pending/expired leased
        # work. Batch RPCs avoid one database request per recipient.
        for offset in range(0, len(tokens), 100):
            chunk = tokens[offset:offset+100]
            try:
                rows = self._rpc('enqueue', **context, tokens=chunk).get('jobs', [])
                if len(rows) != len(chunk): raise RuntimeError('Outbox enqueue incomplete')
                queued.extend(row['id'] for row in rows)
                for token in chunk: self.fallback.pop((scope, token), None)
            except Exception as exc:
                self._warning(exc)
                fallback.extend(chunk)
        counts['queued'] = len(queued)
        if not self.paused():
            for offset in range(0, len(queued), self.batch_size):
                if offset: self.sleep(self.batch_delay)
                if self.paused(): break
                try:
                    jobs = self._rpc('claim', ids=queued[offset:offset+self.batch_size], limit=self.batch_size).get('jobs', [])
                    outcomes = self._deliver(jobs, pass_type)
                    for outcome in outcomes: self._count(counts, outcome, errors)
                    try:
                        finished = self._rpc('finish', outcomes=outcomes)
                        counts['queued'] -= int(finished.get('terminal', 0))
                        counts['retry_exhausted'] += int(finished.get('exhausted', 0))
                    except Exception as exc:
                        self._warning(exc)
                        counts['acknowledgement_uncertain'] += len(outcomes)
                except Exception as exc:
                    self._warning(exc)  # Claimed/pending rows stay durable.
        else: counts['deferred'] += len(queued)
        # Missing migration/outage must not fail a committed stamp. Retain a
        # bounded fallback and explicitly require upstream wallet-job retry.
        for offset in range(0, len(fallback), self.batch_size):
            if offset: self.sleep(self.batch_delay)
            chunk = fallback[offset:offset+self.batch_size]
            if self.paused():
                outcomes = [dict(outcome='deferred', attempted=False, status=None, reason='memory_pressure') for _ in chunk]
            else: outcomes = self._deliver([dict(push_token=token) for token in chunk], pass_type)
            for token, outcome in zip(chunk, outcomes):
                self._count(counts, outcome, errors)
                if outcome['outcome'] in ('accepted', 'rejected'): self.fallback.pop((scope, token), None)
                else:
                    self._remember(token, context)
                    counts['retry_unavailable'] += 1
        return self._summary(context, counts, errors)

    def drain(self, pass_type):
        if self.paused(): return DeliveryCount()
        # Never discard fallback work before successful durable handoff. One
        # group per tick keeps retry provider calls bounded at20.
        keys = list(self.fallback)[:20]
        if keys:
            context = self.fallback.get(keys[0]) or {}
            tokens = [key[1] for key in keys if self.fallback.get(key) == context]
            return self.send(tokens, pass_type=pass_type, business_id=context.get('business_id'),
                business_slug=context.get('business_slug'), reason=context.get('reason', 'deferred_retry'))
        try:
            claimed = self._rpc('claim', limit=20)
            jobs = claimed.get('jobs', [])
            if claimed.get('expired_failed'):
                self.log('apple_push_lease_expired', 'warning', failed=claimed['expired_failed'])
        except Exception as exc:
            self._warning(exc)
            return DeliveryCount()
        totals = self._counts(len(jobs))
        for key in dict.fromkeys((j['business_id'], j.get('business_slug'), j['pass_type_identifier']) for j in jobs):
            group = [j for j in jobs if (j['business_id'], j.get('business_slug'), j['pass_type_identifier']) == key]
            context = dict(business_id=key[0], business_slug=key[1], reason='outbox_retry')
            counts, errors = self._counts(len(group)), Counter()
            counts['queued'] = len(group)
            outcomes = self._deliver(group, key[2])
            for outcome in outcomes: self._count(counts, outcome, errors)
            try:
                finished = self._rpc('finish', outcomes=outcomes)
                counts['queued'] -= int(finished.get('terminal', 0))
                counts['retry_exhausted'] += int(finished.get('exhausted', 0))
            except Exception as exc:
                self._warning(exc)
                counts['acknowledgement_uncertain'] = len(outcomes)
            self._summary(context, counts, errors)
            for field in totals:
                if field != 'targets': totals[field] += counts[field]
        return DeliveryCount(totals['apns_accepted'], **{k:v for k,v in totals.items() if k != 'apns_accepted'})

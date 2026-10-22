"""Request-local, paginated admin list metrics without per-business queries."""


def business_metrics(db, business_ids, since, loyalty_type, log, page_size=500):
    ids = list(dict.fromkeys(business_ids))
    stats = {key: dict(program=None, customer_count=0, staff_count=0,
                       activity_30d=0, points_balance_outstanding=0,
                       sessions_outstanding=0, branch_count=0) for key in ids}
    if not ids:
        return stats

    def rows(table, columns, selected_ids=ids, recent=False, programs=False):
        # Stable pagination avoids PostgREST's default row cap and keeps raw
        # customer/event rows out of retained memory. Never select contacts.
        for start in range(0, len(selected_ids), 100):
            chunk = selected_ids[start:start + 100]
            offset = 0
            legacy_program_order = False
            while True:
                query = db.table(table).select(columns).in_('business_id', chunk)
                if recent:
                    query = query.gte('created_at', since)
                if programs:
                    if legacy_program_order:
                        query = query.order('updated_at', desc=True).order('created_at', desc=True)
                    else:
                        query = query.order('is_default', desc=True).order('sort_order').order('created_at')
                query = query.order('id', desc=legacy_program_order).range(offset, offset + page_size - 1)
                try:
                    page = query.execute().data or []
                except Exception as exc:
                    if programs and offset == 0 and not legacy_program_order:
                        # Same rolling-schema fallback as safe_get_loyalty_program.
                        legacy_program_order = True
                        continue
                    else:
                        log('admin_data_partial', 'warning', table=table, error_type=type(exc).__name__)
                        return
                yield from page
                if len(page) < page_size:
                    break
                offset += page_size

    # Use the same stable default-program ordering as the existing lookup.
    for row in rows('loyalty_programs', '*', programs=True):
        item = stats[row['business_id']]
        if item['program'] is None:
            item['program'] = row
    for row in rows('customers', 'id,business_id,points_balance,multipass_sessions_remaining'):
        item = stats[row['business_id']]
        item['customer_count'] += 1
        item['points_balance_outstanding'] += row.get('points_balance') or 0
        item['sessions_outstanding'] += row.get('multipass_sessions_remaining') or 0
    for table, field in (('staff', 'staff_count'), ('branches', 'branch_count')):
        for row in rows(table, 'id,business_id'):
            stats[row['business_id']][field] += 1

    groups = {}
    for key, item in stats.items():
        program = item['program'] or {}
        card_type = program.get('card_type', 'stamp')
        table = ('points_events' if loyalty_type(program) == 'points' else
                 'multipass_events' if card_type == 'multipass' else
                 'employee_attendance_events' if card_type == 'employee' else 'stamp_events')
        groups.setdefault(table, []).append(key)
    for table, selected in groups.items():
        columns = 'id,business_id,action' if table == 'multipass_events' else 'id,business_id'
        for row in rows(table, columns, selected, recent=True):
            if table != 'multipass_events' or row.get('action') == 'used':
                stats[row['business_id']]['activity_30d'] += 1
    return stats

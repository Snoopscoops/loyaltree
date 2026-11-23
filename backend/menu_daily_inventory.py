"""v18 serving limits shared by owner and assigned cashiers.

All stock writes run through a single SQL transaction/RPC and all order
reservations happen through database triggers; the browser never decrements stock.
"""
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field


class SetDailyServings(BaseModel):
    branch_public_id: str = Field(min_length=1, max_length=96)
    item_public_id: str = Field(min_length=1, max_length=96)
    variant_key: str = Field(default='*', min_length=1, max_length=96)
    initial_servings: int = Field(strict=True, ge=0, le=100000)
    repeat_daily: bool = True


def service_day():
    return datetime.now(ZoneInfo('Asia/Manila')).date().isoformat()


def inventory_rows(db, business_id, day):
    db.rpc('menu_ensure_daily_servings', {'p_business_id': business_id, 'p_day': day}).execute()
    return (db.table('menu_daily_servings').select(
        'branch_public_id,item_public_id,variant_key,service_day,initial_servings,reserved,consumed')
        .eq('business_id', business_id).eq('service_day', day).execute().data or [])


def option_ids_for(item, snapshot):
    groups_by_id = {group['public_id']: group for group in snapshot.get('modifier_groups', [])
                    if group.get('public_id')}
    return {str(option.get('public_id')) for group_id in item.get('modifier_group_public_ids', [])
            for option in groups_by_id.get(group_id, {}).get('options', []) if option.get('public_id')}


def register_menu_inventory_routes(app, *, db, operator, menu_snapshot):
    def current(public_id, auth):
        business, scope = operator(public_id, auth)
        if str(business.get('status') or '').upper() != 'ACTIVE':
            raise HTTPException(403, 'An active business is required.')
        return business, scope

    @app.get('/api/v1/business/{public_id}/menu-inventory')
    def get_inventory(public_id: str, authorization: str = Header(default='')):
        business, scope = current(public_id, authorization)
        try:
            snapshot = menu_snapshot(business)
            rows = inventory_rows(db, business['id'], service_day())
        except Exception as exc:
            raise HTTPException(503, 'Daily inventory is unavailable. Verify backend/menu_daily_servings_v18.sql.') from exc
        branch = scope.get('branch')
        if branch:
            rows = [row for row in rows if row['branch_public_id'] == branch]
        branches = [dict(public_id=b['public_id'], name=b.get('name') or 'Branch')
                    for b in snapshot.get('branches', []) if b.get('is_active') is not False
                    and (not branch or b['public_id'] == branch)]
        groups = {g.get('public_id'):g for g in snapshot.get('modifier_groups',[])}
        items = []
        for item in snapshot.get('items',[]):
            if item.get('is_active') is False or not item.get('public_id'):
                continue
            options = [dict(public_id=o['public_id'], name=f"{g.get('name') or 'Variant'} · {o.get('name') or 'Option'}")
                for gid in item.get('modifier_group_public_ids', []) for g in [groups.get(gid)] if g
                for o in g.get('options',[]) if o.get('is_active') is not False and o.get('public_id')]
            items.append(dict(public_id=item['public_id'], name=item.get('name') or 'Item', variants=options))
        return {'service_day': service_day(), 'branches': branches, 'items': items,
                'rows': [{**row, 'remaining': max(0, row['initial_servings']-row['reserved']-row['consumed'])}
                         for row in rows], 'role': scope['role']}

    @app.put('/api/v1/business/{public_id}/menu-inventory')
    def set_inventory(public_id: str, payload: SetDailyServings, authorization: str = Header(default='')):
        business, scope = current(public_id, authorization)
        if scope.get('branch') and payload.branch_public_id != scope['branch']:
            raise HTTPException(403, 'You can only adjust stock for your assigned branch.')
        try:
            snapshot = menu_snapshot(business)
        except Exception as exc:
            raise HTTPException(503, 'Could not verify the current menu.') from exc
        if not any(b.get('public_id') == payload.branch_public_id and b.get('is_active') is not False
                   for b in snapshot.get('branches',[])):
            raise HTTPException(404, 'Branch not found.')
        item = next((i for i in snapshot.get('items',[]) if i.get('public_id') == payload.item_public_id
                     and i.get('is_active') is not False), None)
        if item is None:
            raise HTTPException(404, 'Menu item not found.')
        if payload.variant_key != '*' and payload.variant_key not in option_ids_for(item,snapshot):
            raise HTTPException(422, 'This variant is not available for this item.')
        try:
            result = db.rpc('menu_set_daily_servings', {
                'p_business_id': business['id'], 'p_branch': payload.branch_public_id,
                'p_item': payload.item_public_id, 'p_variant': payload.variant_key,
                'p_initial': payload.initial_servings, 'p_repeat': payload.repeat_daily,
            }).execute()
        except Exception as exc:
            message = str(exc).lower()
            if 'below already reserved' in message:
                raise HTTPException(409, 'Cannot set servings below already reserved and consumed quantity.') from exc
            raise HTTPException(503, 'Could not save daily servings. Try again.') from exc
        row = result.data or {}
        return {'success': True, 'stock': {**row, 'remaining': max(0,int(row.get('initial_servings') or 0)-int(row.get('reserved') or 0)-int(row.get('consumed') or 0))}}

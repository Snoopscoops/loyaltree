"""Public, browse-only menus backed by the existing Order Ahead catalog."""
from datetime import datetime, timezone
from math import isfinite
from urllib.parse import quote, urlencode, urlsplit

from fastapi import Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


class QRMenuPublishUpdate(BaseModel):
    is_published: bool = Field(strict=True)


def safe_image(value):
    value = str(value or '').strip()
    try:
        parsed = urlsplit(value)
    except ValueError:
        return ''
    return value if parsed.scheme in ('https', 'http') and parsed.netloc and parsed.username is None else ''


def number(value):
    try:
        result = float(value or 0)
        return result if isfinite(result) else 0
    except (TypeError, ValueError):
        return 0


def public_catalog(snapshot):
    """Allowlist public content; never expose owner settings or database IDs."""
    categories = [dict(public_id=c['public_id'], name=c.get('name') or 'Category', description=c.get('description') or '')
                  for c in snapshot.get('categories', []) if c.get('is_active') is not False and c.get('public_id')]
    active_categories = {c['public_id'] for c in categories}
    groups = {}
    for group in snapshot.get('modifier_groups', []):
        if group.get('is_active') is False or not group.get('public_id'):
            continue
        options = [dict(public_id=o['public_id'], name=o.get('name') or 'Option', price_delta=number(o.get('price_delta')))
                   for o in group.get('options', []) if o.get('is_active') is not False and o.get('public_id')]
        if options:
            groups[group['public_id']] = dict(public_id=group['public_id'], name=group.get('name') or 'Options',
                selection_type='multiple' if group.get('selection_type') == 'multiple' else 'single',
                is_required=bool(group.get('is_required')), min_selections=group.get('min_selections') or 0,
                max_selections=group.get('max_selections') or 0, options=options)
    branches = [dict(public_id=b['public_id'], name=b.get('name') or 'Branch', address=b.get('address') or '')
                for b in snapshot.get('branches', []) if b.get('is_active') is not False and b.get('public_id')]
    branch_ids = {b['public_id'] for b in branches}
    items = []
    for item in snapshot.get('items', []):
        category = item.get('category_public_id')
        if item.get('is_active') is False or not item.get('public_id') or (category and category not in active_categories):
            continue
        items.append(dict(public_id=item['public_id'], name=item.get('name') or 'Menu item',
            description=item.get('description') or '', image_url=safe_image(item.get('image_url')),
            base_price=number(item.get('base_price')), category_public_id=category,
            is_available=item.get('is_available') is not False,
            unavailable_branch_public_ids=[bid for bid in item.get('unavailable_branch_public_ids', []) if bid in branch_ids],
            modifier_groups=[groups[gid] for gid in item.get('modifier_group_public_ids', []) if gid in groups]))
    return dict(categories=categories, items=items, branches=branches)


def menu_link(frontend_url, public_id, branch=None):
    url = f"{frontend_url.rstrip('/')}/menu/{quote(str(public_id), safe='')}"
    return url + ('?' + urlencode({'branch': branch}) if branch else '')


def register_qr_menu_routes(app, *, db, get_business, require_owner, has_feature, on_hold,
                            menu_snapshot, branding, frontend_url):
    def eligible(business):
        return bool(business and has_feature(business, 'qr_menu') and business.get('status') == 'active' and not on_hold(business))

    def owner_business(public_id, authorization):
        require_owner(public_id, authorization)
        business = get_business(public_id)
        if not business:
            raise HTTPException(404, 'Business not found')
        if not has_feature(business, 'qr_menu'):
            raise HTTPException(403, 'QR Menu is included in Growth and Pro.')
        if not eligible(business):
            raise HTTPException(403, 'An active business subscription is required for QR Menu.')
        return business

    def settings(business):
        try:
            rows = db.table('qr_menu_settings').select('is_published,updated_at').eq('business_id', business['id']).limit(1).execute().data or []
            return rows[0] if rows else {'is_published': False, 'updated_at': None}
        except Exception as exc:
            raise HTTPException(503, 'QR Menu setup is not ready. Apply backend/qr_menu.sql in Supabase.') from exc

    def snapshot(business):
        try:
            return public_catalog(menu_snapshot(business))
        except Exception as exc:
            raise HTTPException(503, 'The menu is temporarily unavailable. Please try again shortly.') from exc

    def response(business, state):
        branches = db.table('branches').select('public_id,name').eq('business_id', business['id']).eq('is_active', True).order('created_at').execute().data or []
        return dict(is_published=bool(state.get('is_published')), updated_at=state.get('updated_at'),
            public_url=menu_link(frontend_url, business['public_id']),
            branches=[dict(public_id=b['public_id'], name=b.get('name') or 'Branch',
                public_url=menu_link(frontend_url, business['public_id'], b['public_id'])) for b in branches])

    def payload(business, state, branch):
        catalog = snapshot(business)
        if branch and not any(b['public_id'] == branch for b in catalog['branches']):
            raise HTTPException(404, 'Branch not found')
        brand = branding(business)
        return dict(**catalog, business=dict(public_id=business['public_id'], name=business.get('name') or 'Business',
                logo_url=safe_image(brand.get('logo_url')), hero_url=safe_image(brand.get('hero_url')),
                currency=brand.get('currency') or 'PHP', join_url=f"{frontend_url.rstrip('/')}/join/{quote(business['public_id'], safe='')}"),
            design={key: value for key, value in brand.get('design', {}).items() if key in (
                'primary_color','background_color','surface_color','text_color','muted_color','product_layout',
                'category_style','logo_shape','show_banner','show_product_description')},
            selected_branch=branch or (catalog['branches'][0]['public_id'] if len(catalog['branches']) == 1 else None),
            is_published=bool(state.get('is_published')), updated_at=state.get('updated_at'))

    @app.get('/api/v1/business/{public_id}/qr-menu')
    def owner_qr_menu(public_id: str, authorization: str = Header(default='')):
        business = owner_business(public_id, authorization)
        return response(business, settings(business))

    @app.put('/api/v1/business/{public_id}/qr-menu')
    def publish_qr_menu(public_id: str, update: QRMenuPublishUpdate, authorization: str = Header(default='')):
        business = owner_business(public_id, authorization)
        settings(business)  # Check migration before a write or publication.
        if update.is_published and not snapshot(business)['items']:
            raise HTTPException(400, 'Add at least one visible menu item before publishing.')
        row = dict(business_id=business['id'], is_published=update.is_published, updated_at=datetime.now(timezone.utc).isoformat())
        try:
            db.table('qr_menu_settings').upsert(row, on_conflict='business_id').execute()
        except Exception as exc:
            raise HTTPException(503, 'Could not save QR Menu publication. Please try again.') from exc
        return response(business, row)

    @app.get('/api/v1/business/{public_id}/qr-menu/preview')
    def preview_qr_menu(public_id: str, branch: str = Query(default=''), authorization: str = Header(default='')):
        business = owner_business(public_id, authorization)
        return JSONResponse(payload(business, settings(business), branch), headers={'Cache-Control': 'no-store'})

    @app.get('/api/v1/public/menu/{public_id}')
    def public_qr_menu(public_id: str, branch: str = Query(default='')):
        business = get_business(public_id)
        if not eligible(business):
            raise HTTPException(404, 'This menu is not available right now.')
        try:
            state = settings(business)
        except HTTPException as exc:
            raise HTTPException(503, 'The menu is temporarily unavailable. Please try again shortly.') from exc
        if not state.get('is_published'):
            raise HTTPException(404, 'This menu is not available right now.')
        return JSONResponse(payload(business, state, branch), headers={'Cache-Control': 'no-store'})

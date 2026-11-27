"""Who may work the digital-menu Orders board, and for which branch.

Owner: every branch, every tool.
Manager: orders for their branch (every branch when no branch is assigned),
         plus the daily summary and the sales report for that scope.
Cashier: orders for their assigned branch only. A cashier with no branch
         gets a clear "ask the owner" message instead of every branch.

The staff row is re-read on every request, so moving or disabling someone
takes effect right away even if their 12-hour session token is still valid.
"""
from fastapi import Header, HTTPException

ALL_ROLES = ('owner', 'manager', 'cashier')
REPORT_ROLES = ('owner', 'manager')
NO_BRANCH = 'Ask the owner to assign your branch.'
OTHER_BRANCH = 'This order belongs to another branch.'


def _first(result):
    data = getattr(result, 'data', None) or []
    return data[0] if isinstance(data, list) and data else None


def permissions(role):
    staff = role in ('manager', 'cashier')
    return {
        'orders': True,
        'mark_paid': role in ALL_ROLES,
        'cancel_order': role in ALL_ROLES,
        'void_items': role in ('owner', 'manager'),
        'refund': False,  # NextPay refund processing is not enabled.
        'stamps': True,
        'stamp_corrections': role in ('owner', 'manager'),
        'summary': role in REPORT_ROLES,
        'report': role in REPORT_ROLES,
        'analytics': role == 'owner',
        'menu': role == 'owner',
        'customers': role == 'owner',
        'billing': role == 'owner',
        'staff': role == 'owner',
        'settings': not staff,
    }


def make_menu_order_operator(*, db, get_business, get_claims):
    """Returns operator(public_id, authorization, allow=..., need_branch=True) -> (business, scope)."""

    def operator(public_id, authorization, allow=ALL_ROLES, need_branch=True):
        if not authorization or not str(authorization).startswith('Bearer '):
            raise HTTPException(status_code=401, detail='Sign in to see orders.')
        claims = get_claims(public_id, authorization)
        if not claims:
            raise HTTPException(status_code=401, detail='Session expired. Sign in again.')
        if claims.get('business_public_id') not in (None, public_id):
            raise HTTPException(status_code=403, detail='Session does not match this business')
        business = get_business(public_id)
        if not business:
            raise HTTPException(status_code=404, detail='Business not found')
        role = str(claims.get('role') or '').lower()
        if role == 'owner':
            scope = {'role': 'owner', 'name': claims.get('name') or business.get('name') or '', 'staff_id': None,
                     'branch': '', 'branch_name': '', 'all_branches': True, 'needs_branch': False}
            return business, scope
        if role not in ('manager', 'cashier') or claims.get('staff_id') is None:
            raise HTTPException(status_code=403, detail='Business staff access required')
        try:
            staff = _first(db.table('staff').select('id,business_id,branch_id,is_active,role,name')
                           .eq('id', claims.get('staff_id')).eq('business_id', business.get('id')).limit(1).execute())
        except Exception:
            raise HTTPException(status_code=503, detail='Staff sign-in is temporarily unavailable. Try again.')
        if not staff or staff.get('is_active') is False:
            raise HTTPException(status_code=403, detail='This staff account is inactive. Ask the owner.')
        role = str(staff.get('role') or role).lower()
        if role not in ('manager', 'cashier'):
            raise HTTPException(status_code=403, detail='Business staff access required')
        if role not in allow:
            raise HTTPException(status_code=403, detail='Only the owner or a manager can open this.' if 'manager' in allow
                                else 'Only the owner can open this.')
        branch_public_id, branch_name = '', ''
        if staff.get('branch_id') is not None:
            try:
                branch = _first(db.table('branches').select('id,public_id,name,is_active,business_id')
                                .eq('id', staff.get('branch_id')).eq('business_id', business.get('id')).limit(1).execute())
            except Exception:
                raise HTTPException(status_code=503, detail='Could not load your branch. Try again.')
            if not branch or branch.get('is_active') is False:
                raise HTTPException(status_code=403, detail='Your branch is not available. ' + NO_BRANCH)
            branch_public_id, branch_name = str(branch.get('public_id') or ''), str(branch.get('name') or '')
        needs_branch = role == 'cashier' and not branch_public_id
        if needs_branch and need_branch:
            raise HTTPException(status_code=403, detail=NO_BRANCH)
        scope = {'role': role, 'name': staff.get('name') or claims.get('name') or '', 'staff_id': staff.get('id'),
                 'branch': branch_public_id, 'branch_name': branch_name,
                 'all_branches': role == 'manager' and not branch_public_id, 'needs_branch': needs_branch}
        return business, scope

    return operator


def scoped_branch(scope, requested=''):
    """The branch filter to use. Staff tied to a branch can't ask for another one."""
    requested = str(requested or '').strip()
    locked = (scope or {}).get('branch') or ''
    if locked:
        if requested and requested != locked:
            raise HTTPException(status_code=403, detail='You can only see your own branch.')
        return locked
    return requested


def check_order_branch(scope, row):
    locked = (scope or {}).get('branch') or ''
    if locked and str((row or {}).get('branch_public_id') or '') != locked:
        raise HTTPException(status_code=403, detail=OTHER_BRANCH)


def access_payload(scope):
    branch = {'public_id': scope.get('branch'), 'name': scope.get('branch_name')} if scope.get('branch') else None
    return {'role': scope.get('role'), 'name': scope.get('name') or '', 'branch': branch,
            'all_branches': bool(scope.get('all_branches')), 'needs_branch': bool(scope.get('needs_branch')),
            'message': NO_BRANCH if scope.get('needs_branch') else '', 'can': permissions(scope.get('role'))}


def register_menu_order_access_routes(app, *, operator):
    @app.get('/api/v1/business/{public_id}/menu-orders/access')
    def menu_orders_access(public_id: str, authorization: str = Header(default='')):
        """What this signed-in person may do in the LoyaltyTree app, and for which branch."""
        _, scope = operator(public_id, authorization, need_branch=False)
        return access_payload(scope)

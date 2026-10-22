"""Small, database-free adapters for the shared LT layer on merchant passes."""
import hashlib
import hmac
import html
from io import BytesIO
from urllib.parse import quote, urlencode


LABEL = 'Loyalty Tree Benefits'
RELEASE = 'lt-benefits-v2'
GOOGLE_CLASS_SUFFIX = '-ltbenefits-v1'


def card_enabled(customer, *, enabled=False):
    """Old cards opt in; only future rows receive the database default."""
    return bool(enabled and (customer or {}).get('lt_benefits_card_enabled') is True)


def google_class_id(legacy_id, customer, *, enabled=False):
    if card_enabled(customer, enabled=enabled):
        return str(legacy_id) + GOOGLE_CLASS_SUFFIX
    return legacy_id


def is_google_class(class_id):
    return str(class_id or '').endswith(GOOGLE_CLASS_SUFFIX)


def card_token(customer_id, business_id, secret):
    if not customer_id or not business_id or not secret:
        return None
    payload = f'lt-benefits|{customer_id}|{business_id}'.encode()
    return hmac.new(str(secret).encode(), payload, hashlib.sha256).hexdigest()


def verify_card_token(customer_id, business_id, supplied, secret):
    expected = card_token(customer_id, business_id, secret)
    return bool(expected and supplied and hmac.compare_digest(expected, str(supplied)))


def wallet_action(customer, business, frontend_url, secret, enabled=False):
    if not card_enabled(customer, enabled=enabled):
        return None
    customer_id = str((customer or {}).get('public_id') or '')
    token = card_token(customer_id, (business or {}).get('public_id'), secret)
    if not token:
        return None
    return {'label': LABEL, 'url': f"{frontend_url.rstrip('/')}/benefits?" +
            urlencode({'card': customer_id, 'token': token})}


def projection(customer):
    """Read denormalized columns returned by the EXISTING customer lookup.

    No network requests, image work, or account matching in the Apple Add path.
    A missing projection means the customer has not linked a verified account.
    """
    customer = customer or {}
    value = customer.get('lt_points_balance')
    return {
        'linked': customer.get('lt_member_id') is not None and value is not None,
        'balance': max(0, int(value or 0)),
        'version': int(customer.get('lt_points_version') or 0),
        'updated_at': customer.get('lt_points_updated_at'),
        'coupon_count': max(0, int(customer.get('lt_coupon_count') or 0)),
    }


def apply_apple(pass_dict, customer, action):
    if not action:
        return pass_dict
    state = projection(customer)
    fields = pass_dict.get('storeCard')
    if not fields:
        return pass_dict
    value = str(state['balance']) if state['linked'] else 'Connect'
    field = {'key': 'lt_points', 'label': 'LT POINTS', 'value': value}
    secondary, auxiliary = fields.setdefault('secondaryFields', []), fields.setdefault('auxiliaryFields', [])
    if len(secondary) + len(auxiliary) < 4:
        auxiliary.append(field)
    else:
        # Preserve every merchant field. Header has an independent field budget.
        headers = fields.setdefault('headerFields', [])
        if len(headers) < 3:
            headers.append(field)
    back = fields.setdefault('backFields', [])
    back.insert(0, {
        'key': 'lt_benefits', 'label': LABEL.upper(),
        'value': 'View points and partner coupons',
        'attributedValue': f'<a href="{html.escape(action["url"], quote=True)}">View points and partner coupons ›</a>',
    })
    back.insert(1, {'key': 'lt_points_detail', 'label': 'LOYALTY TREE POINTS',
                    'value': value if state['linked'] else 'Verify your account to connect your cards'})
    if state['coupon_count']:
        back.insert(2, {'key': 'lt_coupons', 'label': 'LOYALTY TREE COUPONS',
                        'value': f"{state['coupon_count']} claimed · view your coupons in Loyalty Tree Benefits"})
    pass_dict.setdefault('userInfo', {})['loyaltyTreePointsVersion'] = str(state['version'])
    # iOS 27 uses Apple's membership-benefits action type and system label.
    # Older Wallet versions still have the tappable Pass Details link above.
    existing = [item for item in pass_dict.get('featuredActions', [])
                if item.get('identifier') != 'loyaltree-benefits']
    pass_dict['featuredActions'] = [{
        'identifier': 'loyaltree-benefits', 'type': 'membershipBenefits',
        'url': action['url'],
    }, *existing[:1]]
    return pass_dict


def apply_google(loyalty_object, customer, action):
    if not action:
        return loyalty_object
    state = projection(customer)
    value = str(state['balance']) if state['linked'] else 'Connect your account'
    modules = loyalty_object.setdefault('textModulesData', [])
    modules.insert(0, {'id': 'lt_points', 'header': 'LOYALTY TREE POINTS', 'body': value})
    merchant = loyalty_object.get('loyaltyPoints') or {}
    merchant_balance = merchant.get('balance') or {}
    modules.append({'id': 'lt_merchant_reward', 'header': merchant.get('label') or 'BUSINESS REWARDS',
                    'body': str(next(iter(merchant_balance.values()), ''))})
    modules.append({'id': 'lt_member', 'header': 'MEMBER', 'body': loyalty_object.get('accountName') or 'Member'})
    secondary = loyalty_object.get('secondaryLoyaltyPoints') or {}
    if secondary:
        modules.append({'id': 'lt_merchant_status', 'header': secondary.get('label') or 'BUSINESS STATUS',
                        'body': str(next(iter((secondary.get('balance') or {}).values()), ''))})
    if state['coupon_count']:
        modules.insert(1, {'id': 'lt_coupons', 'header': 'LOYALTY TREE COUPONS',
                           'body': f"{state['coupon_count']} claimed · open Loyalty Tree Benefits"})
    if not loyalty_object.get('secondaryLoyaltyPoints'):
        loyalty_object['secondaryLoyaltyPoints'] = {
            'label': 'LT POINTS', 'balance': {'string': value}}
    loyalty_object.setdefault('linksModuleData', {}).setdefault('uris', []).insert(
        0, {'uri': action['url'], 'description': LABEL})
    loyalty_object['appLinkData'] = {
        'webAppLinkInfo': {'appTarget': {'targetUri': {
            'uri': action['url'], 'description': LABEL}}},
        'displayText': {'defaultValue': {'language': 'en-US', 'value': LABEL}},
    }
    return loyalty_object


def apply_google_class(loyalty_class):
    def item(module):
        return {'firstValue': {'fields': [{'fieldPath': f"object.textModulesData['{module}']"}]}}
    loyalty_class['classTemplateInfo'] = {'cardTemplateOverride': {'cardRowTemplateInfos': [
        {'twoItems': {'startItem': item('lt_merchant_reward'), 'endItem': item('lt_points')}},
        {'twoItems': {'startItem': item('lt_member'), 'endItem': item('lt_merchant_status')}},
    ]}}
    return loyalty_class


def co_brand_png(rendered_logo, brand_png):
    """Compose only small, already-rendered assets; callers byte-cache results."""
    from PIL import Image
    with Image.open(BytesIO(rendered_logo)) as raw, Image.open(BytesIO(brand_png)) as brand_raw:
        with raw.convert('RGBA') as source, brand_raw.convert('RGBA') as brand:
            width, height = source.size
            with Image.new('RGBA', (width, height), (0, 0, 0, 0)) as canvas:
                merchant_width = max(1, int(width * .72))
                merchant_height = max(1, int(height * .72))
                with source.resize((merchant_width, merchant_height), Image.Resampling.LANCZOS) as merchant:
                    canvas.alpha_composite(merchant, (0, (height - merchant_height) // 2))
                size = max(1, int(min(height * .86, width * .22)))
                with brand.resize((size, size), Image.Resampling.LANCZOS) as mark:
                    canvas.alpha_composite(mark, (width - size, (height - size) // 2))
                with BytesIO() as buffer:
                    canvas.save(buffer, 'PNG', optimize=False)
                    return buffer.getvalue()


def normalized_purchase_source(value):
    source = str(value or '').strip()
    for suffix in (':points', ':stamp', ':tier'):
        if source.endswith(suffix):
            source = source[:-len(suffix)]
    if len(source) > 180:
        return source[:120] + ':' + hashlib.sha256(source.encode()).hexdigest()[:40]
    return source

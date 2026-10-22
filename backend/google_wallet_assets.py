"""Public, immutable CDN branding. Never upload customer/pass data."""
import hashlib
import re
import time

try:
    from .wallet_cloudinary import parse_public_asset
    from .wallet_memory import BoundedTTLCache
except ImportError:
    from wallet_cloudinary import parse_public_asset
    from wallet_memory import BoundedTTLCache

_VALID = BoundedTTLCache('google_public_images', max_bytes=128*1024, max_items=256, ttl=3600)


def validate_image(client, url):
    if not parse_public_asset(url):
        raise ValueError('Google Wallet branding must use a public HTTPS Cloudinary image.')
    if _VALID.get(url):
        return
    response = client.request('HEAD', url, timeout=10, follow_redirects=False)
    if response.status_code != 200 or not response.headers.get('content-type', '').lower().startswith('image/'):
        raise ValueError('Google Wallet branding image is not publicly available.')
    _VALID[url] = True


def validate_class_images(client, payload):
    for key in ('programLogo', 'wideProgramLogo', 'heroImage'):
        image = payload.get(key)
        if image:
            validate_image(client, (image.get('sourceUri') or {}).get('uri'))


def publish_png(client, content, *, cloud, api_key, api_secret):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', cloud or ''):
        raise ValueError('Cloudinary account is not configured.')
    if not content or not content.startswith(b'\x89PNG\r\n\x1a\n') or len(content) > 5*1024*1024:
        raise ValueError('Invalid Wallet branding PNG.')
    public_id = 'wallet-public-v1/' + hashlib.sha256(content).hexdigest()
    url = f'https://res.cloudinary.com/{cloud}/image/upload/{public_id}.png'
    try:
        validate_image(client, url)
        return url
    except ValueError:
        pass
    if not api_key or not api_secret:
        raise ValueError('Cloudinary server credentials are required to publish Wallet branding.')
    params = dict(public_id=public_id, timestamp=str(int(time.time())), overwrite='false', type='upload')
    signature = hashlib.sha256(('&'.join(f'{k}={params[k]}' for k in sorted(params))+api_secret).encode()).hexdigest()
    response = client.post(f'https://api.cloudinary.com/v1_1/{cloud}/image/upload',
        data={**params, 'api_key': api_key, 'signature': signature},
        files={'file': ('wallet.png', content, 'image/png')}, timeout=30, follow_redirects=False)
    if response.status_code != 200:
        raise ValueError('Could not publish public Wallet branding to Cloudinary.')
    result = response.json()
    asset = parse_public_asset(result.get('secure_url'))
    if not asset or asset.cloud_name != cloud or asset.public_id != public_id:
        raise ValueError('Cloudinary returned an unexpected Wallet branding image.')
    validate_image(client, url)
    return url

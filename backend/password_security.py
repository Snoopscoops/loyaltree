"""Owner password migration and reset revocation without memory-heavy hashing.

The deterministic legacy hash in main is also used by unrelated credentials;
keep that function unchanged. Password KDFs run in worker threads, with at most
two derivations in flight and no unbounded queue of blocked hashing workers.
"""
import asyncio
import base64
import hashlib
import hmac
import secrets
from contextlib import asynccontextmanager
from contextvars import ContextVar
from threading import BoundedSemaphore

from fastapi import HTTPException


ALGORITHM = 'pbkdf2_sha256'
ITERATIONS = 600_000
_HASH_SLOTS = BoundedSemaphore(2)
_REQUEST_ACCOUNT = ContextVar('owner_auth_request_account', default=None)


class PasswordWorkBusy(RuntimeError):
    """The small hashing budget is currently occupied; the caller can retry."""


class OwnerCredentialsChanged(RuntimeError):
    """An atomic migration lost a race with a password change."""


def _derive(password, salt, iterations):
    if not _HASH_SLOTS.acquire(blocking=False):
        raise PasswordWorkBusy('Password verification is busy. Please try again shortly.')
    try:
        return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    finally:
        _HASH_SLOTS.release()


def hash_owner_password_sync(password):
    if not isinstance(password, str) or not password:
        raise ValueError('Password must not be empty')
    salt = secrets.token_bytes(16)
    digest = _derive(password, salt, ITERATIONS)
    encoded_salt = base64.urlsafe_b64encode(salt).decode('ascii').rstrip('=')
    return f'{ALGORITHM}${ITERATIONS}${encoded_salt}${digest.hex()}'


async def hash_owner_password(password):
    try:
        return await asyncio.to_thread(hash_owner_password_sync, password)
    except PasswordWorkBusy as exc:
        raise HTTPException(503, str(exc), headers={'Retry-After': '1'}) from exc


def _parts(stored):
    try:
        algorithm, rounds, salt_text, digest_text = stored.split('$')
        iterations = int(rounds)
        if algorithm != ALGORITHM or not (100_000 <= iterations <= 1_000_000):
            return None
        salt = base64.b64decode(salt_text + '=' * (-len(salt_text) % 4), altchars=b'-_', validate=True)
        digest = bytes.fromhex(digest_text)
        if not (16 <= len(salt) <= 64) or len(digest) != 32:
            return None
        return iterations, salt, digest
    except (ValueError, TypeError):
        return None


def verify_owner_password(password, stored, *, legacy_hasher=None):
    """Accept salted hashes, legacy SHA-256, and legacy literal passwords.

    A SHA-256 digest is never accepted as a literal password (pass-the-hash).
    Malformed salted envelopes fail closed rather than becoming plaintext.
    """
    if not isinstance(password, str) or not isinstance(stored, str) or not stored:
        return False
    if stored.startswith(ALGORITHM + '$'):
        parts = _parts(stored)
        return bool(parts and hmac.compare_digest(_derive(password, parts[1], parts[0]), parts[2]))
    legacy_digest = (legacy_hasher or (lambda value: hashlib.sha256(value.encode()).hexdigest()))(password)
    if len(stored) == 64 and all(character in '0123456789abcdef' for character in stored.lower()):
        return hmac.compare_digest(stored.encode(), legacy_digest.encode())
    return hmac.compare_digest(stored.encode(), password.encode()) or hmac.compare_digest(stored.encode(), legacy_digest.encode())


def owner_password_needs_upgrade(stored):
    parts = _parts(stored) if isinstance(stored, str) and stored.startswith(ALGORITHM + '$') else None
    return parts is None or parts[0] != ITERATIONS


def migrate_owner_password(db, business, password):
    """Compare-and-swap the verified hash; never overwrite a concurrent reset."""
    stored = business.get('password_hash')
    if not owner_password_needs_upgrade(stored):
        return business
    new_hash = hash_owner_password_sync(password)
    response = db.table('businesses').update({'password_hash': new_hash}).eq('id', business['id']).eq('password_hash', stored).execute()
    rows = getattr(response, 'data', None)
    if not isinstance(rows, list) or len(rows) != 1:
        raise OwnerCredentialsChanged('Password changed during sign-in. Please sign in again.')
    return {**business, **rows[0]}


def _account_scope(claims):
    return claims.get('business_public_id'), str(claims.get('business_id'))


def _read_auth_business(db, claims):
    if db is None:
        raise HTTPException(503, 'Account authentication is temporarily unavailable')
    try:
        response = db.table('businesses').select('id,public_id,auth_version').eq('public_id', claims['business_public_id']).limit(2).execute()
        rows = getattr(response, 'data', None)
    except Exception as exc:
        raise HTTPException(503, 'Account authentication is temporarily unavailable') from exc
    if not isinstance(rows, list):
        raise HTTPException(503, 'Account authentication is temporarily unavailable')
    if len(rows) != 1:
        raise HTTPException(401, 'Owner account is no longer available')
    return rows[0]


@asynccontextmanager
async def owner_auth_request(db, claims):
    """Load once off the event loop; cache only inside this request's context.

    Public routes are not failed just because an irrelevant Authorization
    header carries an unavailable account. A protected guard raises the saved
    lookup error when it actually needs the authentication result.
    """
    row, error = None, None
    try:
        row = await asyncio.to_thread(_read_auth_business, db, claims)
    except HTTPException as exc:
        error = exc
    context = _REQUEST_ACCOUNT.set((_account_scope(claims), row, error))
    try:
        yield
    finally:
        _REQUEST_ACCOUNT.reset(context)


def validate_business_auth_version(db, claims, business=None, *, allowed_roles=('owner',)):
    """Check reset revocation against a fresh business row, not cached metadata.

    ``business`` may only be supplied by a caller that just read it from the DB.
    Existing signed owner tokens without the claim map to version zero.
    """
    if not isinstance(claims, dict) or claims.get('role') not in allowed_roles:
        raise HTTPException(403, 'Owner access required')
    if not claims.get('business_public_id'):
        raise HTTPException(401, 'Owner session is invalid')
    if business is None:
        cached = _REQUEST_ACCOUNT.get()
        if cached is not None and cached[0] == _account_scope(claims):
            if cached[2] is not None:
                raise cached[2]
            business = cached[1]
        else:
            business = _read_auth_business(db, claims)
    if business.get('public_id') != claims.get('business_public_id'):
        raise HTTPException(403, 'Session does not match this business')
    if claims.get('business_id') is not None and str(claims['business_id']) != str(business.get('id')):
        raise HTTPException(401, 'Owner session is invalid')
    token_version = claims.get('auth_version', 0)
    current_version = business.get('auth_version', 0)
    if (type(token_version) is not int or type(current_version) is not int or
            token_version < 0 or current_version < 0 or token_version != current_version):
        raise HTTPException(401, 'Password changed. Please sign in again')
    return business

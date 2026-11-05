"""Short join slugs for businesses created from now on.

Existing public_ids are never rewritten. Printed QR codes keep the slug
already stored on the business.
"""
import re
import secrets

CANONICAL_JOIN_BASE = "https://theloyaltytree.com"
MAX_NEW_JOIN_URL_LENGTH = 39
_JOIN_PATH = "/join/"
MAX_NEW_SLUG_LENGTH = MAX_NEW_JOIN_URL_LENGTH - len(CANONICAL_JOIN_BASE + _JOIN_PATH)


def join_url_for_slug(slug: str, base: str = CANONICAL_JOIN_BASE) -> str:
    return f"{str(base).rstrip('/')}{_JOIN_PATH}{slug}"


def _prefix(name: str) -> str:
    letters = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return (letters[:3] or "lt")


def _blocked(candidate: str, taken) -> bool:
    if callable(taken):
        return bool(taken(candidate))
    return candidate in set(taken or ())


def _randbelow(rng, limit: int) -> int:
    if rng is None:
        return secrets.randbelow(limit)
    return rng.randbelow(limit)


def short_business_slug(name: str, taken=(), rng=None) -> str:
    """A lowercase URL-safe slug of at most 7 characters.

    Three letters from the business name plus four digits, for example
    jus5479. Collisions retry. The caller must not use this to replace a
    slug that is already saved.
    """
    prefix = _prefix(name)
    for _ in range(40):
        candidate = f"{prefix}{_randbelow(rng, 10000):04d}"[:MAX_NEW_SLUG_LENGTH]
        if re.fullmatch(r"[a-z0-9]+", candidate) and not _blocked(candidate, taken):
            return candidate
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    for _ in range(40):
        candidate = "".join(alphabet[_randbelow(rng, len(alphabet))] for _ in range(MAX_NEW_SLUG_LENGTH))
        if not _blocked(candidate, taken):
            return candidate
    raise RuntimeError("could not allocate a unique join slug")


def resolve_stored_public_id(requested: str, stored: dict) -> str | None:
    """Look up a join slug exactly. Long slugs already in use stay valid."""
    raw = str(requested or "").strip()
    if "__p__" in raw:
        raw = raw.split("__p__", 1)[0].strip()
    found = stored.get(raw) if raw else None
    return found if isinstance(found, str) and found else None

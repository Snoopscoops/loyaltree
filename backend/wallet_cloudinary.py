"""Public Wallet artwork derivatives. No app imports, credentials or I/O at import.

Original uploads are never overwritten. Only unsigned public image/upload URLs
from the configured Cloudinary account can be prepared. Signed, private, fetch,
external and ambiguous URLs are left alone. Profiles resize the existing edit
chain rather than discarding it; branded/local compositing still belongs to its
renderer. In particular these profiles do not reproduce alpha-bound trimming or
the Google white-plate knockout, nor create LT co-branding from an original logo.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
import time
from urllib.parse import parse_qsl, quote, unquote, urlsplit, urlunsplit


PROFILE_VERSION = "wallet-png-v1"
_CLOUD = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_VERSION = re.compile(r"^v[0-9]+$")
_PREFIXES = frozenset("a ar b bo c co cs d dl dn dpr du e eo f fl fn fps g h if ki l o p pg q r so sp t u vc vs w x y z".split())
_IMAGE_EXT = frozenset("png jpg jpeg webp avif gif bmp tif tiff svg heic heif psd jxl".split())


def profile_transforms():
    result = {}
    for scale, size in ((1, 29), (2, 58), (3, 87)):
        result[f"apple_icon_{scale}x"] = f"c_fill,g_center,h_{size},w_{size}/b_white,c_pad,h_{size},w_{size}/f_png"
    for scale, width, height in ((1, 160, 50), (2, 320, 100), (3, 480, 150)):
        result[f"apple_logo_{scale}x"] = f"b_transparent,c_pad,g_west,h_{height},w_{width}/f_png"
    for scale, width, height in ((1, 375, 123), (2, 750, 246), (3, 1125, 369)):
        result[f"apple_strip_{scale}x"] = f"c_fill,g_center,h_{height},w_{width}/f_png"
    result.update({
        "apple_logo_source": "c_limit,h_960,w_960/f_png",
        "google_hero_source": "c_fill,g_center,h_336,w_1032/f_png",
        "google_logo_source": "c_limit,h_1280,w_1280/f_png",
        "progress_icon_source": "c_limit,h_400,w_400/f_png",
    })
    return result


def profiles_for_role(role):
    profiles = profile_transforms()
    if role == "logo":
        return [name for name in profiles if name.startswith(("apple_icon_", "apple_logo_"))] + ["google_logo_source"]
    if role == "hero":
        return [name for name in profiles if name.startswith("apple_strip_")] + ["google_hero_source"]
    if role == "progress_icon":
        return ["progress_icon_source"]
    raise ValueError("Unknown public artwork role")


@dataclass(frozen=True)
class PublicAsset:
    cloud_name: str
    public_id: str
    encoded_id: str
    transforms: tuple[str, ...]
    version: str
    query: str

    def identity(self):
        return json.dumps([self.cloud_name, self.public_id, self.transforms, self.version], separators=(",", ":"))


def _transform_component(value):
    if not value or len(value) > 2000:
        return False
    return all((token.startswith("$") or token.split("_", 1)[0] in _PREFIXES) and "_" in token for token in value.split(","))


def parse_public_asset(url):
    """Fail closed on unsupported URL shapes; return no private/signed source."""
    if not isinstance(url, str) or not 1 <= len(url) <= 4096 or any(ord(c) < 32 for c in url):
        return None
    try:
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.netloc.lower() != "res.cloudinary.com" or parts.fragment:
            return None
        path = parts.path.split("/")
        if len(path) < 5 or path[0] or not _CLOUD.fullmatch(path[1]) or path[2:4] != ["image", "upload"]:
            return None
        tail = path[4:]
        if any(not segment or unquote(segment) in (".", "..") for segment in tail):
            return None
        decoded = [unquote(segment) for segment in tail]
        if any(any(ord(char) < 32 for char in segment) for segment in decoded):
            return None
        # Signed URL path/query cannot be modified without regenerating its signature.
        if any(segment.startswith("s--") for segment in decoded) or any(key.lower() in ("__cld_token__", "signature", "token", "auth_token") for key, _ in parse_qsl(parts.query)):
            return None
        transforms = []
        while tail and _transform_component(unquote(tail[0])):
            transforms.append(tail.pop(0))
        version = tail.pop(0) if tail and _VERSION.fullmatch(tail[0]) else ""
        if not tail:
            return None
        # Transform prefixes after a version are actual folder names. Without a
        # version Cloudinary's own reserved transformation grammar applies.
        filename = tail[-1]
        if "." in filename:
            stem, extension = filename.rsplit(".", 1)
            if extension.lower() not in _IMAGE_EXT or not stem:
                return None
            tail[-1] = stem
        encoded_id = "/".join(tail)
        public_id = unquote(encoded_id)
        if not public_id or len(public_id) > 255 or public_id.endswith(" ") or any(c in public_id for c in "?&#\\%<>"):
            return None
        if any(c in public_id for c in ("\r", "\n", "\x00")) or "://" in public_id:
            return None
        transform_text = unquote("/".join(transforms)).lower()
        # Remote fetch overlays would transmit another URL to the provider.
        if any(term in transform_text for term in ("fetch:", "http:", "https:", "__cld_token__")):
            return None
        return PublicAsset(path[1], public_id, encoded_id, tuple(transforms), version, parts.query)
    except (ValueError, UnicodeError):
        return None


def _chain(asset, profile):
    transform = profile_transforms()[profile]
    before = "/".join(asset.transforms)
    return before if before == transform or before.endswith("/" + transform) else "/".join(filter(None, (before, transform)))


def delivery_url(url, profile):
    if profile not in profile_transforms():
        raise ValueError("Unknown Wallet artwork profile")
    asset = parse_public_asset(url)
    if not asset:
        return url
    segments = [asset.cloud_name, "image", "upload", _chain(asset, profile)]
    if asset.version:
        segments.append(asset.version)
    segments.append(asset.encoded_id + ".png")
    return urlunsplit(("https", "res.cloudinary.com", "/" + "/".join(segments), asset.query, ""))


def make_plan(url, profiles):
    asset = parse_public_asset(url)
    if not asset:
        return None
    names = sorted(set(profiles))
    if not names or any(name not in profile_transforms() for name in names):
        raise ValueError("Invalid Wallet artwork profiles")
    transforms = list(dict.fromkeys(unquote(_chain(asset, name)) for name in names))
    digest = hashlib.sha256(json.dumps([PROFILE_VERSION, asset.identity(), transforms], separators=(",", ":")).encode()).hexdigest()
    return dict(id=digest, cloud_name=asset.cloud_name, public_id=asset.public_id, version=asset.version,
                profiles=names, transforms=transforms, urls={name: delivery_url(url, name) for name in names})


def plan_sources(sources):
    """Union roles of each exact public source/edit/version before deduping."""
    grouped, skipped = {}, 0
    for record in sources:
        asset = parse_public_asset(record.get("url"))
        if not asset:
            skipped += 1
            continue
        names = record.get("profiles") or profiles_for_role(record.get("role"))
        group = grouped.setdefault(asset.identity(), {"url": record["url"], "profiles": set()})
        group["profiles"].update(names)
    return {"plans": sorted((make_plan(item["url"], item["profiles"]) for item in grouped.values()), key=lambda plan: plan["id"]), "skipped": skipped}


def _canonical_chain(value):
    parts = [",".join(sorted(part.split(","))) for part in unquote(value).split("/") if part]
    if parts and parts[-1] == "f_png":
        parts.pop()
    return "/".join(parts)


def _prepared_response(data, plan):
    expected_version = plan["version"].removeprefix("v")
    if expected_version and str(data.get("version")) != expected_version:
        return "version_mismatch"
    if data.get("public_id") != plan["public_id"]:
        return "invalid_response"
    actual = set()
    for result in data.get("eager", []):
        asset = parse_public_asset(result.get("secure_url"))
        if not asset or asset.cloud_name != plan["cloud_name"] or asset.public_id != plan["public_id"] or result.get("status") in ("failed", "pending") or result.get("error"):
            continue
        if str(result.get("format", "")).lower() != "png":
            continue
        actual.add(_canonical_chain(result.get("transformation") or "/".join(asset.transforms)))
    return "prepared" if all(_canonical_chain(transform) in actual for transform in plan["transforms"]) else "incomplete"


def send_eager_plan(plan, *, cloud_name, api_key, api_secret, client, sleep=time.sleep, retries=1, now=time.time):
    """Synchronous explicit eager generation. No file upload or original mutation.

    Credentials are sent only to api.cloudinary.com, with redirects disabled.
    Reports contain hashes/counts/types, never credentials, response bodies or
    source URLs. Retrying a response lost after acceptance may regenerate already
    prepared derivatives; the local manifest avoids deliberate repeated sends.
    """
    if not _CLOUD.fullmatch(cloud_name or "") or plan.get("cloud_name") != cloud_name:
        return dict(id=plan["id"], status="skipped_account", profiles=plan["profiles"], prepared_count=0)
    if not api_key or not api_secret or isinstance(retries, bool) or retries not in (0, 1, 2):
        raise ValueError("Cloudinary preparation credentials or retry count are invalid")
    # Rebuild all URL-derived fields so an arbitrary plan cannot smuggle a URL
    # into explicit's public_id or inject unrelated upload/metadata parameters.
    sources = [parse_public_asset(url) for url in plan.get("urls", {}).values()]
    if not sources or any(not asset or asset.cloud_name != cloud_name or asset.public_id != plan.get("public_id") or asset.version != plan.get("version") for asset in sources):
        raise ValueError("Invalid eager preparation plan")
    if set(plan.get("transforms", [])) != {unquote("/".join(asset.transforms)) for asset in sources} or not set(plan.get("profiles", [])) <= set(profile_transforms()):
        raise ValueError("Invalid eager preparation plan")
    endpoint = f"https://api.cloudinary.com/v1_1/{quote(cloud_name, safe='')}/image/explicit"
    base = dict(public_id=plan["public_id"], type="upload", eager="|".join(plan["transforms"]), eager_async="false")
    report = dict(id=plan["id"], profiles=plan["profiles"], prepared_count=0)
    for attempt in range(retries + 1):
        payload = dict(base, timestamp=str(int(now())))
        signature_input = "&".join(f"{key}={payload[key]}" for key in sorted(payload)) + api_secret
        payload.update(api_key=api_key, signature=hashlib.sha256(signature_input.encode()).hexdigest())
        try:
            response = client.post(endpoint, data=payload, timeout=60.0, follow_redirects=False)
            if response.status_code == 200:
                data = response.json()
                status = _prepared_response(data, plan) if isinstance(data, dict) else "invalid_response"
                return dict(report, status=status, prepared_count=len(plan["transforms"]) if status == "prepared" else 0, attempts=attempt + 1)
            transient = response.status_code in (408, 420, 429, 500, 502, 503, 504)
            if not transient or attempt == retries:
                return dict(report, status="failed", status_code=response.status_code, attempts=attempt + 1)
        except Exception as failure:
            if attempt == retries:
                return dict(report, status="failed", error_type=type(failure).__name__, attempts=attempt + 1)
        sleep(min(4, .5 * 2 ** attempt))
    return dict(report, status="failed")


def prepare_source(url, profiles, **kwargs):
    plan = make_plan(url, profiles)
    return send_eager_plan(plan, **kwargs) if plan else dict(status="skipped_unsupported", prepared_count=0)

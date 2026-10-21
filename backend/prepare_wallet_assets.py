"""Run public Wallet PNG preparation from an operator's machine, not Render.

Default is a read-only plan. --apply sends bounded explicit eager requests only
for this account's existing public artwork and checkpoints each result. No app
import, server deploy, database write, file upload or original replacement.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.parse import unquote, urlsplit

try:
    from .wallet_cloudinary import PROFILE_VERSION, plan_sources, send_eager_plan
except ImportError:
    from wallet_cloudinary import PROFILE_VERSION, plan_sources, send_eager_plan


PUBLIC_COLUMNS = {
    "businesses": "id,public_id,logo_url",
    "loyalty_programs": "id,business_id,public_id,program_logo_url,hero_image_url,wallet_progress_filled_icon_url,wallet_progress_empty_icon_url",
}
ENV_KEYS = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_URL")


def _environment(path=None, environ=None):
    result = dict(os.environ if environ is None else environ)
    if path:
        from dotenv import dotenv_values
        values = dotenv_values(path, interpolate=False)
        result.update({key: value for key, value in values.items() if key in ENV_KEYS and value is not None})
    return result


def _cloudinary_credentials(environ):
    cloud = environ.get("CLOUDINARY_CLOUD_NAME", "")
    key, secret = environ.get("CLOUDINARY_API_KEY", ""), environ.get("CLOUDINARY_API_SECRET", "")
    if environ.get("CLOUDINARY_URL"):
        parsed = urlsplit(environ["CLOUDINARY_URL"])
        if parsed.scheme != "cloudinary" or not parsed.hostname or parsed.path not in ("", "/"):
            raise ValueError("Invalid Cloudinary configuration")
        cloud, key, secret = cloud or parsed.hostname, key or unquote(parsed.username or ""), secret or unquote(parsed.password or "")
    return dict(cloud_name=cloud, api_key=key, api_secret=secret)


def public_artwork_sources(client, *, url, key, page_size=100, max_rows=10000):
    """Select only public branding references, never customer/profile tables."""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".supabase.co") or parsed.netloc != parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment or not key:
        raise ValueError("A configured Supabase HTTPS project and service key are required")
    if isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 500 or not isinstance(max_rows, int) or max_rows < 1:
        raise ValueError("Invalid source pagination limits")
    records = []
    for table, columns in PUBLIC_COLUMNS.items():
        offset = 0
        while True:
            response = client.get(f"{url.rstrip('/')}/rest/v1/{table}",
                params={"select": columns, "order": "id.asc", "limit": page_size, "offset": offset},
                headers={"apikey": key, "Authorization": "Bearer " + key}, timeout=30.0, follow_redirects=False)
            if response.status_code != 200:
                raise RuntimeError("PublicArtworkReadFailed")
            rows = response.json()
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("Invalid public artwork response")
            if offset + len(rows) > max_rows:
                raise ValueError("Public artwork scan exceeds its configured bound")
            for row in rows:
                for field, role in (("logo_url", "logo"), ("program_logo_url", "logo"), ("hero_image_url", "hero"),
                                    ("wallet_progress_filled_icon_url", "progress_icon"), ("wallet_progress_empty_icon_url", "progress_icon")):
                    if row.get(field):
                        records.append({"url": row[field], "role": role})
            if len(rows) < page_size:
                break
            offset += len(rows)
    return records


def read_manifest(path):
    if not path.exists():
        return {"schema": 1, "profile_version": PROFILE_VERSION, "entries": {}}
    if path.stat().st_size > 20 * 1024 * 1024:
        raise ValueError("Preparation manifest exceeds its size bound")
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get("schema") != 1 or not isinstance(value.get("entries"), dict):
        raise ValueError("Invalid preparation manifest; preserve it before starting a new one")
    return value


def save_manifest(path, manifest):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Private file mode plus atomic replacement makes each accepted result a
    # restart checkpoint. The file contains only hashes/profiles/status/counts.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".wallet-assets-", delete=False) as stream:
            temporary = stream.name
            json.dump(manifest, stream, separators=(",", ":"), sort_keys=True)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def prepare_plans(plans, *, apply, credentials, client, manifest, persist=None, batch_size=2,
                  pause_seconds=1.0, sleep=time.sleep, emit=None, limit=None):
    if type(apply) is not bool or type(batch_size) is not int or not 1 <= batch_size <= 10 or not 0 <= pause_seconds <= 30 or (limit is not None and (type(limit) is not int or limit < 1)):
        raise ValueError("Invalid preparation options")
    totals = Counter(planned=len(plans), transformations=sum(len(plan["transforms"]) for plan in plans))
    sends, stopped = 0, False
    for plan in plans:
        if plan["cloud_name"] != credentials["cloud_name"]:
            totals["skipped_account"] += 1
            continue
        previous = manifest["entries"].get(plan["id"], {})
        if previous.get("status") == "prepared" and previous.get("profiles") == plan["profiles"]:
            totals["already_prepared"] += 1
            continue
        if not apply:
            totals["pending"] += 1
            continue
        if limit is not None and sends >= limit:
            totals["deferred"] += 1
            continue
        result = send_eager_plan(plan, client=client, sleep=sleep, **credentials)
        sends += 1
        totals[result["status"]] += 1
        manifest["entries"][plan["id"]] = result
        if persist:
            persist(manifest)
        if emit and sends % batch_size == 0:
            emit({"event": "wallet_assets_progress", **totals, "requests": sends})
        if result.get("status_code") in (420, 429):
            stopped = True
            break
        if sends % batch_size == 0:
            sleep(pause_seconds)
    return {"event": "wallet_assets_preparation", "mode": "apply" if apply else "dry_run", **totals, "requests": sends, "stopped_rate_limit": stopped}


def main(argv=None, *, client_factory=None, environ=None, emit=print):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Generate existing public artwork derivatives; default only plans.")
    parser.add_argument("--env-file", type=Path, help="Explicit local credentials file; never printed.")
    parser.add_argument("--sources", type=Path, help="Optional JSON list [{url,role}] instead of a Supabase branding scan.")
    parser.add_argument("--manifest", type=Path, default=Path("wallet-assets-manifest.json"))
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--pause-seconds", type=float, default=1.0)
    parser.add_argument("--limit", type=int, help="Maximum source plans to send this run; omitted prepares every selected source.")
    args = parser.parse_args(argv)
    client = None
    try:
        if not 1 <= args.batch_size <= 10 or not 0 <= args.pause_seconds <= 30 or (args.limit is not None and args.limit < 1):
            raise ValueError("Invalid preparation limits")
        env = _environment(args.env_file, environ)
        credentials = _cloudinary_credentials(env)
        if not credentials["cloud_name"] or (args.apply and (not credentials["api_key"] or not credentials["api_secret"])):
            raise ValueError("Cloudinary preparation is not configured")
        if client_factory is None:
            import httpx
            client_factory = lambda: httpx.Client(follow_redirects=False, limits=httpx.Limits(max_connections=2, max_keepalive_connections=2))
        client = client_factory()
        if args.sources:
            if args.sources.stat().st_size > 5 * 1024 * 1024:
                raise ValueError("Public source list exceeds its bound")
            sources = json.loads(args.sources.read_text())
            if not isinstance(sources, list) or len(sources) > 50000 or any(not isinstance(item, dict) for item in sources):
                raise ValueError("Invalid public source list")
        else:
            sources = public_artwork_sources(client, url=env.get("SUPABASE_URL", ""), key=env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_KEY", ""))
        planned = plan_sources(sources)
        manifest = read_manifest(args.manifest)
        report = prepare_plans(planned["plans"], apply=args.apply, credentials=credentials, client=client, manifest=manifest,
            persist=(lambda state: save_manifest(args.manifest, state)) if args.apply else None,
            batch_size=args.batch_size, pause_seconds=args.pause_seconds, limit=args.limit,
            emit=lambda value: emit(json.dumps(value, separators=(",", ":"))))
        report["unsupported_sources"] = planned["skipped"]
        emit(json.dumps(report, separators=(",", ":")))
        return 1 if any(report.get(key) for key in ("failed", "invalid_response", "incomplete", "version_mismatch", "stopped_rate_limit")) else 0
    except Exception as failure:
        emit(json.dumps({"event": "wallet_assets_preparation", "mode": "apply" if args.apply else "dry_run", "status": "failed", "error_type": type(failure).__name__}, separators=(",", ":")))
        return 1
    finally:
        if client:
            client.close()


if __name__ == "__main__":
    raise SystemExit(main())

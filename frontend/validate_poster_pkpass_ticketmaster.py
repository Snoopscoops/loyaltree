#!/usr/bin/env python3
"""
LoyaltyTree Trial 5 — Ticketmaster-style Poster Event Ticket validator.

Usage:
    python validate_poster_pkpass_ticketmaster.py /path/to/test.pkpass
"""
import sys
import json
import zipfile
import hashlib
from pathlib import Path
from io import BytesIO

try:
    from PIL import Image
except Exception:
    Image = None

REQUIRED_SEMANTICS = (
    "eventName",
    "venueName",
    "venueRegionName",
    "venueRoom",
)

ACTION_KEYS = (
    "orderFoodURL",
    "merchandiseURL",
    "bagPolicyURL",
    "purchaseParkingURL",
    "addOnURL",
)

ASSET_BASES = (
    "artwork",
    "primaryLogo",
    "secondaryLogo",
)

def image_size(raw):
    if Image is None:
        return None
    try:
        with Image.open(BytesIO(raw)) as img:
            return img.width, img.height
    except Exception:
        return None

def main(filename):
    path = Path(filename)
    if not path.exists():
        raise SystemExit(f"Not found: {path}")

    with zipfile.ZipFile(path, "r") as zf:
        names = set(zf.namelist())
        print("=== LoyaltyTree Trial 5 — Ticketmaster-style Validator ===")
        print("File:", path)

        missing_bundle = sorted({"pass.json", "manifest.json", "signature"} - names)
        if "pass.json" not in names:
            raise SystemExit("FAIL: pass.json missing")

        p = json.loads(zf.read("pass.json").decode("utf-8"))
        semantics = dict(p.get("semantics") or {})
        preferred = list(p.get("preferredStyleSchemes") or [])

        missing_semantics = [
            key for key in REQUIRED_SEMANTICS
            if not str(semantics.get(key) or "").strip()
        ]

        action_pairs = [(key, str(p.get(key) or "").strip()) for key in ACTION_KEYS if p.get(key)]
        action_urls = [url for _, url in action_pairs]
        all_https = bool(action_urls) and all(url.startswith("https://") for url in action_urls)
        distinct_urls = len(action_urls) >= 4 and len(set(action_urls)) == len(action_urls)
        has_coordinates = bool(semantics.get("venueLocation"))

        print("\nPoster structure")
        print("  eventTicket:", isinstance(p.get("eventTicket"), dict))
        print("  preferred styles:", preferred)
        print("  poster requested:", "posterEventTicket" in preferred)
        print("  missing required semantics:", missing_semantics or "none")
        print("  barcode present:", bool(p.get("barcodes") or p.get("barcode")))

        print("\nVenue")
        print("  name:", semantics.get("venueName"))
        print("  region:", semantics.get("venueRegionName"))
        print("  room:", semantics.get("venueRoom"))
        print("  coordinates:", semantics.get("venueLocation") or "MISSING")

        print("\nEvent Guide destinations")
        for key, url in action_pairs:
            # Safe enough for a local user-run diagnostic; URLs contain the
            # member token, so show only origin/path and hide query values.
            safe_url = url.split("?", 1)[0]
            print(f"  {key}: {safe_url}")
        print("  all HTTPS:", all_https)
        print("  four+ distinct destinations:", distinct_urls)

        print("\nPoster assets")
        poster_assets_ok = True
        for base in ASSET_BASES:
            variants = sorted(
                n for n in names
                if n == f"{base}.png" or n.startswith(f"{base}@")
            )
            if not variants:
                poster_assets_ok = False
                print(f"  {base}: MISSING")
                continue
            print(f"  {base}:")
            for name in variants:
                raw = zf.read(name)
                dims = image_size(raw)
                suffix = f" {dims[0]}x{dims[1]}" if dims else ""
                print(f"    {name}: {len(raw)} bytes{suffix}")

        manifest_errors = []
        if "manifest.json" in names:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            for name, expected in manifest.items():
                if name not in names:
                    manifest_errors.append(f"{name}: missing")
                    continue
                if hashlib.sha1(zf.read(name)).hexdigest() != expected:
                    manifest_errors.append(f"{name}: SHA1 mismatch")
        else:
            manifest_errors.append("manifest.json missing")

        signature_ok = "signature" in names and bool(zf.read("signature"))

        structural_ready = (
            not missing_bundle
            and isinstance(p.get("eventTicket"), dict)
            and "posterEventTicket" in preferred
            and not missing_semantics
            and not bool(p.get("barcodes") or p.get("barcode"))
            and poster_assets_ok
            and not manifest_errors
            and signature_ok
        )

        tm_profile_ready = (
            structural_ready
            and has_coordinates
            and all_https
            and distinct_urls
            and len(action_pairs) >= 4
        )

        print("\nManifest/hash errors:", manifest_errors or "none")
        print("Signature present:", signature_ok)
        print("\nPOSTER STRUCTURE:", "READY" if structural_ready else "CHECK")
        print("TICKETMASTER-STYLE PROFILE:", "TM-READY" if tm_profile_ready else "TM-PARTIAL")

        if structural_ready and not tm_profile_ready:
            print("\nTM-PARTIAL means the poster package is structurally ready, but the")
            print("Ticketmaster-like diagnostic profile is missing at least one of:")
            print("- real venue coordinates")
            print("- four distinct HTTPS Event Guide destinations")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Usage: python validate_poster_pkpass_ticketmaster.py /path/to/test.pkpass"
        )
    main(sys.argv[1])

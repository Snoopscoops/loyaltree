# Prepare public Wallet artwork on Cloudinary

This operator command runs on your machine, prepares PNG derivatives on Cloudinary, and leaves original uploads unchanged. It does not deploy Render, upload signed passes/customer data, change database records, or send Wallet pushes.

```sh
python -m backend.prepare_wallet_assets --env-file backend/.env --manifest /private/tmp/wallet-assets-manifest.json
python -m backend.prepare_wallet_assets --apply --env-file backend/.env --manifest /private/tmp/wallet-assets-manifest.json
```

The first command only reads public branding references and reports its plan. The second prepares each uncompleted source with one synchronous explicit eager request. Requests run sequentially; the default batch size is two with a one-second gap between batches. Use `--limit 1` for a first source, then repeat without the limit using the same manifest. Each result is atomically saved; completed plans are skipped on resume. Preserve the manifest: Cloudinary counts repeated explicit image transformations even when they already exist. A network failure after provider acceptance can still regenerate derivatives on its one bounded retry.

Required environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or existing `SUPABASE_KEY`), `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. `CLOUDINARY_URL` is also supported for Cloudinary credentials. `--env-file` is explicit and never printed. Credentials are sent only to the configured `*.supabase.co` project for narrow branding reads, and `api.cloudinary.com` for eager generation; redirects are disabled. Database failures abort rather than using an incomplete scan. An optional `--sources source.json` replaces the database read with a public list: `[{"url":"https://res.cloudinary.com/.../image/upload/v123/brand.png","role":"logo"}]`. Roles are `logo`, `hero`, and `progress_icon`.

The scanner selects only IDs, public IDs and artwork URLs from `businesses` and `loyalty_programs`. It never reads customer records. Reports and the private manifest contain hashes, profile names, counts, statuses and exception types, without API responses, tokens or source URLs. Rate limits stop the run; other failed sources remain retryable. A version mismatch is reported rather than claiming that a previously overwritten original version was prepared.

Profiles are deterministic (`wallet-png-v1`):

| Profile | Output |
| --- | --- |
| `apple_icon_1x`, `2x`, `3x` | 29², 58², 87²; center crop, white background, PNG |
| `apple_logo_1x`, `2x`, `3x` | 160×50, 320×100, 480×150; transparent contain, left aligned, PNG |
| `apple_strip_1x`, `2x`, `3x` | 375×123, 750×246, 1125×369; center crop, PNG |
| `apple_logo_source` | Fit within 960×960, no upscaling, transparent PNG source |
| `google_logo_source` | Fit within 1280×1280, no upscaling, transparent PNG source |
| `google_hero_source` | 1032×336 center crop, PNG source |
| `progress_icon_source` | Fit within 400×400, no upscaling, transparent PNG source |

`delivery_url(url, profile)` preserves the existing edit chain, version, nested public ID and public analytics query before appending its profile. Unsupported/external, signed, authenticated, fetch and remote-overlay URLs remain unchanged. Only public `https://res.cloudinary.com/<cloud>/image/upload/...` assets in the configured account are prepared; no external source URL is passed to Cloudinary. Existing transformed URLs are derived with their edits intact. Repeated calls for the same profile are idempotent.

These derivatives do not replace every local render. Existing alpha-bound trimming, Google plate removal, LT co-branding and dynamic progress/text are separate operations; their exact appearance must be retained. Prefer bounded source profiles in those paths. Static finished derivatives can replace matching static render steps after visual checks. Keep per-member pass JSON/QR/signing and dynamic artwork separate. Preparing assets alone changes no live Wallet URL; backend integration and deployment remain separate.

Validation uses HTTP fakes only: `python -B -m unittest discover -s backend/tests -p '*wallet*cloudinary*.py'` and `python -B -m unittest discover -s backend/tests -p 'test_prepare_wallet_assets.py'`.

API details follow Cloudinary's [explicit API reference](https://cloudinary.com/documentation/image_upload_api_reference#explicit), [eager transformations](https://cloudinary.com/documentation/eager_and_incoming_transformations), [authentication signatures](https://cloudinary.com/documentation/authentication_signatures), and [transformation reference](https://cloudinary.com/documentation/transformation_reference). Eager transforms create additional derived assets rather than replacing the original. PNG output keeps transparency except the intentional white Apple icon background.

## Runtime integration

After deployment, Cloudinary public URLs are requested with bounded PNG source profiles **before** decoding: Apple branding within 960², Google branding within 1280², progress icons within 400², Google hero 1032×336 and Apple static strip 1125×369. Unsupported or signed image URLs retain their existing path. Original artwork URLs remain stored for editing. No new environment variables are required beyond the existing Cloudinary settings.

Apple branding and static strips reuse their compressed 1×/2×/3× files across customers inside the existing 8 MiB / 64-entry / fifteen-minute Apple image cache. This adds no separate memory budget and retains no decoded PIL images. Keys include source, color, business wordmark and LT layout version/opt-in as appropriate. Temporary CDN fallbacks are not retained as successful branding. Customer JSON, QR, signature and dynamic progress remain specific to each pass; the existing Add cache, concurrency control and HTTP client stay in place.

New owner branding uploads request a business-scoped signed upload with `asset_role=logo|hero|progress_icon`. Only the matching owner's session can request these fixed eager profiles. The browser uploads directly to Cloudinary and stores the original URL. Existing upload callers that omit `asset_role` keep their parameters and behavior. Saving a changed card design also prepares its supported public artwork in background work before the existing Apple design refresh. Preparation failures are best effort; they cannot fail the save or stop the refresh. Apple Add never calls the Cloudinary preparation API.

JSON events use the existing logging helper and never include source URLs or credentials:

- `wallet_assets_prepared`: `business_slug`, `prepared_count`, `status`.
- `wallet_assets_prepare_failed`: `business_slug`, `prepared_count` and `status`, or `error_type`.
- `wallet_asset_fetch_failed`: `profile`, `error_type`.
- Operator-only `wallet_assets_progress`: planned source/transform counts, prepared/already-prepared/failure counts and requests sent.
- Operator-only `wallet_assets_preparation`: `mode`, source/transform counts, `unsupported_sources`, request/status counts and `stopped_rate_limit`; fatal setup failures contain only `error_type`.

For visible-change LT push queueing, see `README-lt-benefits.md` and the rerunnable `lt_benefits_visible_updates.sql` addon. This is a separate database migration; preparing Cloudinary artwork does not apply it or deploy application code.

Native delivery and signed-upload regressions use synthetic images and fake providers in `test_wallet_asset_delivery.py` and `test_wallet_upload_signature.py`. They check shared artwork without shared private pass data, transparency, fallback behavior, dynamic progress, owner scope and signature integrity. Actual Add latency and RSS savings require a live before/after measurement after deployment.

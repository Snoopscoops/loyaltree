# QR Menu — Growth and Pro

QR Menu reuses the Order Ahead categories, items, modifier groups/options and branch-availability tables. Menu edits are shared with existing Order Ahead businesses. QR Menu access only opens catalog management; ordering, operator sessions, pickup operations and payment activation keep their existing independent gates.

## Release order

1. Run [`qr_menu.sql`](qr_menu.sql) in the Supabase SQL Editor. The existing `order_ahead_*` catalog migrations must already be installed. This migration creates only `qr_menu_settings`, with `business_id` as its unique key and `is_published=false` by default. It does not change any existing menu, plan, order or payment row.
2. Deploy the backend and frontend together. No new package or environment variable is required. Public links use the existing `FRONTEND_URL` when set, otherwise `https://theloyaltytree.com`.
3. In the owner dashboard, choose **QR Menu**, add/review the shared catalog, inspect **Customer preview**, then choose **Publish menu**. **QR & sharing** provides a permanent business link, per-branch links and locally generated SVG QR downloads.

The migration enables row-level security, removes anonymous/authenticated access and grants the backend service role access. Guests read only the backend's allowlisted public response; they never query Supabase directly. If the migration is missing, publication fails closed and the owner sees a setup error. The public page shows a temporary-unavailability message.

## Routes and access

- `GET /api/v1/business/{public_id}/qr-menu`: owner publication state and stable business/branch URLs.
- `PUT /api/v1/business/{public_id}/qr-menu`: owner publishes/unpublishes, with a strict boolean `is_published`. Publishing requires at least one visible item.
- `GET /api/v1/business/{public_id}/qr-menu/preview`: owner-only preview, including unpublished menus.
- `GET /api/v1/public/menu/{public_id}`: anonymous published catalog. Optional `branch` must name an active branch belonging to this business.
- `/menu/{public_id}?branch={branch_public_id}`: public React page. The generic business QR offers a location picker for multiple active branches; a branch QR opens that location directly. Businesses without branch rows can publish a business-wide menu.

Public reads and publication require an active Growth/Pro business without a subscription hold. Business status uses the same case-insensitive `ACTIVE` check as owner login; existing trial access and paid grace periods use the shared billing-hold rules. Downgrading, suspension or a billing hold hides the public menu. Owner authorization is checked independently of the client plan display. Existing admin-enabled Order Ahead accounts retain their existing catalog access, including legacy plans; that does not grant Starter public QR Menu publication.

The shared catalog management routes under `/order-ahead/` additionally admit active Growth/Pro owners for QR Menu. This exception is explicitly limited to categories, items, modifier groups, beverage quick setup and availability. It does not enable orders, payment settings or staff operations.

Public projection excludes inactive items/categories/groups/options, database IDs, business secrets and owner configuration. Sold-out items remain visible with their status, including branch-specific availability. Images are restricted to HTTP(S) URLs without embedded credentials. Item details let visitors preview size/add-on prices; no order, payment, customer identity, wallet update, stamp or reward is created. Optional loyalty signup uses the existing join page. Remembered customer sessions and personalized wallet menu links are a later feature.

## Freshness and verification

One public catalog request loads active branches and their availability. Searching, category changes, price previews and branch switching use that response without polling. Pages and API responses use `no-store`; reopening/reloading the same QR fetches current content. An already-open menu keeps its loaded snapshot until reloaded. Existing business metadata caches can apply to plan/status changes.

Run `python -m unittest discover -s backend/tests`, then `npm test` and `npm run build` in `frontend`. New tests cover draft privacy, owner/business/plan gates, subscription holds, downgrade behavior, independent Order Ahead gates, stable publication links, branch validation, public-field filtering, outages, strict publication inputs and price/availability behavior.

The dev-only workspace at `/dev/owner-dashboard.html?plan=growth&orderAhead=off` uses fictional data and intercepts API requests. Open QR Menu, publish it, then use Open menu to test the public component inside the same isolated workspace. `&view=menu&published=1&branch=demo-branch-main` opens an independently seeded fictional published menu. `&plan=starter` checks the upgrade screen. These parameters are fixture-only and cannot bypass production publication/authentication.

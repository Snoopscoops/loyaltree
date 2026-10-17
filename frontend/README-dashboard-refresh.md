# Owner dashboard design refresh

The refresh uses a Loyalty Tree logo, teal sidebar, compact overview, responsive mobile navigation, and an “Updates from LoyaltyTree” section for existing platform announcements. It reuses the current customer, card, team, billing, announcements, Order Ahead, integration, and analytics screens and their API handlers. The mockup's fictional metrics and stamp-only assumptions are not part of production.

## Rollout and rollback

The new design is enabled by default for every standard business owner. No new environment variable is needed for this rollout. Managers, cashiers, admins, public pages, and specialized lending/cockpit dashboards retain their existing interfaces.

To restore the previous design, set the **frontend build** environment variable below and rebuild:

```text
VITE_OWNER_DASHBOARD_REFRESH=off
```

Unset/empty or `all` enables the design for all standard owners. An optional comma-separated list enables only exact `business_slug` or `business_public_id` matches. `*` is not a supported wildcard. This setting changes presentation only and grants no permissions. No SQL migration or backend environment change is needed.

Payment processing, prices, subscription rules, staff permissions, program scope, wallet issuance and notification delivery stay on their existing implementations. Both platform-to-owner updates and owner-to-customer announcements remain separate and retain their current content and actions. The original design refresh did not alter Events; separate Events notification adjustments are documented below.

## Local verification

```bash
cd frontend
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:3000/dev/owner-dashboard.html?scenario=stamp&design=refresh` for an isolated test workspace. It renders the real components with fictional data and intercepts all fetches; unknown API calls fail locally. External links, checkout frames and real payments/pushes are blocked. The Events map loads Leaflet and OpenStreetMap assets; location tests use fictional coordinates instead of the device location. The request log omits headers and bodies. The fixture page is a development-only entry and is not included in the production build.

Use the controls to compare the current design and the refresh and to check stamp, points, subscription, multipass, tier, hybrid and employee card scenarios. Check platform update dismissal, customer search/details, program selection and the All Programs scanner restriction, announcements and delivery summaries, billing screens, analytics tabs, setup, and desktop/mobile navigation. These fixture checks do not constitute a live payment or provider-delivery test.

## Owner dashboard refinements

Overview shows Total customers, Total customer visits, Return rate and Rewards ready. The customer list filters All customers, Regulars, Rewards ready and At risk. Metrics and filters use the selected program; All Programs counts customer cards across programs. A person with multiple program memberships can appear more than once in that scope.

A visit is a recorded customer-card visit day in the configured loyalty timezone (`LOYALTY_TIMEZONE`, existing default Asia/Manila), deduplicated across the available stamp, points, membership, multipass-use, tier-sale and employee time-in histories. Balance edits, redemptions, pass issuance and time-outs do not invent visits. Return rate is customers with two or more recorded visit days divided by customers with at least one recorded visit. Regulars have three or more visit days, occasional visitors two, and first-time/new customers zero or one. At risk takes priority when the last visit (or join date for customers without visits) is at least the configured churn threshold ago, default 30 days.

Rewards ready counts customers with an unclaimed earned stamp milestone, an affordable points prize, or a currently usable coupon. Active memberships, tier perks and prepaid sessions alone do not count as earned rewards. Missing upstream data displays an unavailable value rather than a confirmed zero. Missing optional historical tables are identified as partial history. Customer and ledger reads paginate beyond PostgREST's 1,000-row default. Narrow visit reads cache for up to 120 seconds and local successful loyalty mutations invalidate that cache; another worker's updates can take up to two minutes to appear.

Analytics → Overview includes the Customer Mix pie, using the selected-program scope and all available history. It appears only in the Analytics Overview tab. Analytics opens inside the owner dashboard with the existing business-wide reports and their branch and time filters clearly labeled. The Viewing Program selector uses a compact toolbar on desktop and mobile. Existing `/analytics` bookmarks still work.

Announcements contains the existing birthday greeting/reward, churn/win-back and geolocation automation controls. These settings remain business-wide with their existing access gates. Opening or editing the screen does not send a notification. End date is removed from the editor to match the API, which already clears announcement expiry. Platform updates from Loyalty Tree remain visible separately.

The card editor has separate Apple and Google Wallet previews driven by draft values, including wallet action links and native details, colors/artwork, reward configuration, sessions, membership benefits and selected tier. Preview values are sample data, and wallet providers can adjust the native layout. Publishing still uses the existing handlers. The obsolete Go Live prompt is removed; account activation remains controlled by admin approval.

Deploy both backend and frontend for these refinements. No new SQL migration, environment variable, package, payment integration or notification-delivery change is required.

## Events notification adjustments

Event details use a full-width message area with a 120-character counter, multiline preview and a separate send button. The existing event notification endpoint saves the update and emails ticket holders who have an email address; the result separates provider-accepted emails, failures and tickets without an email address. The missing event email sender has been restored using the existing transactional email service. Provider acceptance does not guarantee inbox delivery. This change does not add wallet push delivery to that endpoint.

New events reuse the Announcements map for nearby notifications: request the device location once with **Use my current location**, click or drag a venue pin, or enter coordinates manually. A slider and numeric input preview a 50–1,000 meter radius. Save Draft or Publish Event saves the nearby message, coordinates and radius. Permission denial or a location timeout leaves manual pin placement available. No background location tracking is added.

Apple event passes now put `maxDistance` at the pass root and accept zero-valued coordinates. Apple applies system relevance limits; Google Wallet controls its nearby radius and notification timing. This does not refresh previously downloaded event passes automatically. Deploy frontend and backend together; no new SQL migration, package or environment variable is needed for these adjustments.

The local fixture includes a fictional published event and intercepts event creation and notification sends. Append `&geo=denied` to test denied location permission; the default simulates a successful location lookup. No real notifications are sent.

`event_notification` logs each manual event update with `business_slug`, `event_id`, `channel`, `recipients`, `delivered` (provider-accepted count), `failed` and `skipped`. Failures use warning level. Recipient addresses and message content are omitted.

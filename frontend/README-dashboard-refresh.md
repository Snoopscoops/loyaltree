# Owner dashboard design refresh

The refresh uses a forest-green sidebar, compact overview, responsive mobile navigation, and an “Updates from LoyaltyTree” section for existing platform announcements. It reuses the current customer, card, team, billing, announcements, Order Ahead, integration, and analytics screens and their API handlers. The mockup's fictional metrics and stamp-only assumptions are not part of production.

## Rollout and rollback

The new design is enabled by default for every standard business owner. No new environment variable is needed for this rollout. Managers, cashiers, admins, public pages, and specialized lending/cockpit dashboards retain their existing interfaces.

To restore the previous design, set the **frontend build** environment variable below and rebuild:

```text
VITE_OWNER_DASHBOARD_REFRESH=off
```

Unset/empty or `all` enables the design for all standard owners. An optional comma-separated list enables only exact `business_slug` or `business_public_id` matches. `*` is not a supported wildcard. This setting changes presentation only and grants no permissions. No SQL migration or backend environment change is needed.

Payment processing, prices, subscription rules, staff permissions, program scope, wallet issuance and notification delivery stay on their existing implementations. Both platform-to-owner updates and owner-to-customer announcements remain separate and retain their current content and actions. Events is outside this change.

## Local verification

```bash
cd frontend
npm test
npm run build
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:3000/dev/owner-dashboard.html?scenario=stamp&design=refresh` for an isolated test workspace. It renders the real components with fictional data and intercepts all fetches; unknown API calls fail locally. External links, maps, checkout frames and real payments/pushes are blocked. The request log omits headers and bodies. The fixture page is a development-only entry and is not included in the production build.

Use the controls to compare the current design and the refresh and to check stamp, points, subscription, multipass, tier, hybrid and employee card scenarios. Check platform update dismissal, customer search/details, program selection and the All Programs scanner restriction, announcements and delivery summaries, billing screens, analytics tabs, setup, and desktop/mobile navigation. These fixture checks do not constitute a live payment or provider-delivery test.

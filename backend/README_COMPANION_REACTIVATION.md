# Manager Add POS and existing-POS reactivation

This update fixes the activation code disappearing after generation/setup refresh and adds **Reactivate existing POS** for a StoreHub machine whose Companion app asks for activation again.

## Deploy

1. Run **ANGKAN_POS_reactivation.sql** in Supabase. This additive migration installs a service-only function and reloads the API schema. It requires the POS activation, Register ID and offline-sale migrations already used by ANGKAN. Installing it does not rotate or disable any device login.
2. Deploy the updated **backend/main.py** and **frontend/src/components/OwnerDashboard.jsx** together. The migration source is saved as **backend/storehub_companion_reactivation.sql**.
3. Refresh the manager dashboard. The existing **Companion APK 0.7.0** can use the new flow; this change requires no APK rebuild or reinstall.

## Reactivate the POS that asks for a code

1. On the manager dashboard, find **Add POS / Activate APK**.
2. Under the existing machine, press **Reactivate APK on this POS**. Alternatively choose **Reactivate existing POS**, then select the machine.
3. Check its saved StoreHub Register ID. Confirm that the previous Companion login should be replaced when the code is used.
4. Press **Generate reactivation code**, then **Copy activation code**. The code lasts 15 minutes and remains visible during setup Refresh. Keep the page open until activation is complete; a full browser reload cannot retrieve the plaintext code, so generate a new one if needed.
5. Enter this code in the Companion APK on that POS, check the assigned branch/outlet, and press Activate. The server uses the machine's saved Register ID even if the APK does not submit a Register ID field. After activation, turn the floating bubble on again if the app asks.

The same device record, original activation date, Register ID, server transaction history and server-side queued work are retained. The current login is untouched by code generation; it is replaced only when activation succeeds. An already-used code or an older code for the previous login cannot rotate the machine again. A lost activation response may require generating a fresh reactivation code for the same device.

## Saved offline sales

Keep the POS app's existing data. Check any unsynced offline sales before reactivating. APK 0.7.0 assigns a new local activation scope when it saves the new login: locally saved sales from the previous activation remain stored but do **not** automatically upload under the new activation. They need separate recovery/review. Already-uploaded server records remain attached to the same device and are preserved.

## New POS versus existing POS

- **+ Add POS / Add a new POS** generates a code for a new machine and still requires an unused Register ID.
- **Reactivate existing POS** reuses only that selected active StoreHub machine's saved Register ID. It does not create another device or bypass protection against a different machine using the same ID.
- Managers still need the owner's **Manage Companion Devices** permission and the assigned branch's current active POS mapping. Unsaved mapping changes must be saved or reverted before code generation.
- The backend rechecks the manager's current permission/branch, device, mapping, integration and Register ID when the code is consumed. The previous login is revoked in the database; another backend worker's cached authentication can expire up to `POS_DEVICE_CACHE_TTL_SECONDS` later (15 seconds by default, maximum 60).

## Validation

Passed: frontend production build; **199 Python tests** covering new reactivation routes and existing Register ID, offline earning, redemptions, void and login behavior; **17 grouped PostgreSQL/PGlite cases** for one-time use, permission/scope checks, sibling-code invalidation, same-device preservation and transaction rollback.

The local browser preview used sample data and blocked all live APIs. It verified reactivation selection, required confirmation, generated code, Copy, code retention during Refresh, unsaved-mapping blocking, API failure and permission denial. No production code was generated and no real POS credential was rotated. A real POS activation remains to be checked after deployment.

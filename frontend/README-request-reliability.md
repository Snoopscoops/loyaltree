# Request deadlines and hidden tabs

Subscription access, QR Menu setup/preview/public browsing and Benefits reads
and writes have a 30-second deadline, including reading the JSON body. Caller
cancellation is preserved, unmounted views cancel their work, and timeout errors
give a retry or refresh action instead of leaving an indefinite loading screen.
Direct card-provider requests have a 60-second deadline. Neither helper retries
a write automatically.

Subscription access refreshes at most once per minute. Payment confirmation
checks one existing intent every four seconds. Both wait for the previous read
and pause while the page is hidden; becoming visible checks again. The local QR
countdown uses wall-clock expiry, so browser timer throttling cannot extend it.
Local expiry keeps the existing payment attempt and checks its server status;
only a confirmed failed/expired server result offers a replacement payment.

An uncertain card submission is retained across reload and resumed by its exact
payment-intent ID. Cancel is unavailable during a provider write, confirmation,
manual review or an issued QR. Closing the local screen would not cancel the
provider payment. These changes do not send a payment or change prices.

Before showing a QR or submitting a card attach, recovery metadata must be
saved. If browser session storage is blocked or full, the current URL retains
only the public business slug and payment-intent ID; account verification is
still required before reading its status. No token, card detail or client key
is added to that URL. If both storage and URL recovery fail, payment submission
stops. Confirmed completion/failure clears this routing context.

Unknown frontend routes show a branded 404 screen with home and support links.
This is the client-side SPA screen; the existing Vercel fallback still serves
the application shell.

Tests: `tests/request-timeout.test.mjs`, `tests/visibility-polling.test.mjs`,
`tests/billing-session.test.mjs`, plus the coupon upload tests. Deadlines cover
stalled response bodies and transports that ignore cancellation. Payment tests
cover keeping uncertain attempts and never retrying provider writes.

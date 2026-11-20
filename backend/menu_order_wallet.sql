-- owner-v8: Digital Menu orders on the customer's loyalty card.
-- One row per order step, so a card is never notified twice for the same step
-- and an order never earns points or stamps twice. Run once in Supabase > SQL Editor.
BEGIN;
CREATE TABLE IF NOT EXISTS public.menu_order_wallet_events (
    id bigserial PRIMARY KEY,
    business_id bigint REFERENCES public.businesses(id) ON DELETE CASCADE,
    order_public_id text NOT NULL,
    customer_public_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('notice', 'award')),
    step text NOT NULL,
    google_sent boolean NOT NULL DEFAULT false,
    result jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_public_id, kind, step)
);
CREATE INDEX IF NOT EXISTS menu_order_wallet_events_customer_idx
    ON public.menu_order_wallet_events (customer_public_id, created_at DESC);
-- Already added by menu_order_branches.sql; repeated so this file runs on its own.
ALTER TABLE public.menu_counter_orders ADD COLUMN IF NOT EXISTS member_customer_public_id text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS menu_counter_orders_member_idx
    ON public.menu_counter_orders (business_id, member_customer_public_id, created_at DESC);
ALTER TABLE public.menu_order_wallet_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_order_wallet_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_order_wallet_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.menu_order_wallet_events_id_seq TO service_role;
COMMENT ON TABLE public.menu_order_wallet_events IS
    'Digital Menu order steps sent to the customer loyalty card (Apple/Google) and the one-time points/stamp award. Server only.';
COMMIT;
NOTIFY pgrst, 'reload schema';

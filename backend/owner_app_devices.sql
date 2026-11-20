-- owner-v6: phones of the LoyaltyTree app that ring for new menu orders (FCM push).
-- Run once in Supabase > SQL Editor. Safe to run again.
BEGIN;
CREATE TABLE IF NOT EXISTS public.owner_app_devices (
    id bigserial PRIMARY KEY,
    token text NOT NULL UNIQUE,
    business_id bigint NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'cashier')),
    staff_id bigint,
    branch_public_id text NOT NULL DEFAULT '',
    platform text NOT NULL DEFAULT 'android',
    app_version text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_app_devices_business_idx ON public.owner_app_devices (business_id);
ALTER TABLE public.owner_app_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_app_devices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_app_devices TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.owner_app_devices_id_seq TO service_role;
COMMENT ON TABLE public.owner_app_devices IS
    'LoyaltyTree app phones (owner, manager, cashier) that get new-order push notifications. Server only.';
COMMIT;

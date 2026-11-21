-- owner-v10: server-side iOS new-order notification preferences.
-- Safe to run repeatedly in Supabase SQL Editor (owner executes manually).
BEGIN;
ALTER TABLE public.owner_app_devices
    ADD COLUMN IF NOT EXISTS alerts_on boolean NOT NULL DEFAULT true;
ALTER TABLE public.owner_app_devices
    ADD COLUMN IF NOT EXISTS muted_branches text[] NOT NULL DEFAULT '{}'::text[];
COMMIT;

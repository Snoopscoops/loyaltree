-- QR Menu publication is separate from Order Ahead activation/payment settings.
-- Uses the existing order_ahead_* catalog tables; no menu rows are copied.
BEGIN;
CREATE TABLE IF NOT EXISTS public.qr_menu_settings (
    business_id bigint PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    is_published boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qr_menu_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qr_menu_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_menu_settings TO service_role;
COMMENT ON TABLE public.qr_menu_settings IS
    'Owner-controlled browse-only menu publication. Access via the backend; no direct anonymous table access.';
COMMIT;

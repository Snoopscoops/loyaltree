-- Menu payment setup. The full payout number is not stored.
-- Loyalty Tree's 3% is applied when a payment is created, not chosen here.
BEGIN;
CREATE TABLE IF NOT EXISTS public.merchant_menu_payment_setups (
    business_id bigint PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    trade_name text NOT NULL DEFAULT '',
    address_line text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    industry text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    business_age text NOT NULL DEFAULT '',
    business_size text NOT NULL DEFAULT '',
    monthly_volume text NOT NULL DEFAULT '',
    business_tin text NOT NULL DEFAULT '',
    owner_name text NOT NULL DEFAULT '',
    birthday text NOT NULL DEFAULT '',
    nationality text NOT NULL DEFAULT '',
    birth_place text NOT NULL DEFAULT '',
    mobile text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    work text NOT NULL DEFAULT '',
    source_of_funds text NOT NULL DEFAULT '',
    owner_tin text NOT NULL DEFAULT '',
    owner_address text NOT NULL DEFAULT '',
    payout_kind text NOT NULL DEFAULT '' CHECK (payout_kind IN ('', 'gcash', 'bank')),
    payout_institution text NOT NULL DEFAULT '',
    payout_account_name text NOT NULL DEFAULT '',
    payout_last4 text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_menu_payment_setups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_menu_payment_setups FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchant_menu_payment_setups TO service_role;
COMMENT ON TABLE public.merchant_menu_payment_setups IS
    'Owner setup for QR menu payments. Stores the payout destination last 4 only. Platform fee is a fixed 3 percent.';
COMMIT;

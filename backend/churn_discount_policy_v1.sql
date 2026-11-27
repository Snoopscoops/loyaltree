-- Draft migration: apply only after final verification.
BEGIN;
CREATE TABLE IF NOT EXISTS public.churn_discount_settings (
    business_id bigint PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    inactivity_days integer NOT NULL DEFAULT 30 CHECK (inactivity_days BETWEEN 7 AND 365),
    discount_percent integer NOT NULL DEFAULT 10 CHECK (discount_percent BETWEEN 1 AND 100),
    validity_days integer NOT NULL DEFAULT 7 CHECK (validity_days BETWEEN 1 AND 30),
    daily_limit integer NOT NULL DEFAULT 25 CHECK (daily_limit BETWEEN 1 AND 100),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.churn_discount_claims (
    business_id bigint NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    activity_date date NOT NULL,
    claim_day date NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','skipped')),
    coupon_public_id text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id,customer_id,activity_date)
);
CREATE INDEX IF NOT EXISTS churn_discount_claims_day_idx
    ON public.churn_discount_claims(business_id,claim_day);
ALTER TABLE public.churn_discount_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.churn_discount_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.churn_discount_settings, public.churn_discount_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.churn_discount_settings, public.churn_discount_claims TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

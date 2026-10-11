-- Run before deploying the admin branch-count editor. NULL preserves automatic billing.
ALTER TABLE public.businesses
    ADD COLUMN IF NOT EXISTS billing_branch_count integer;
ALTER TABLE public.businesses
    DROP CONSTRAINT IF EXISTS businesses_billing_branch_count_check;
ALTER TABLE public.businesses
    ADD CONSTRAINT businesses_billing_branch_count_check
    CHECK (billing_branch_count IS NULL OR billing_branch_count BETWEEN 1 AND 10000);
COMMENT ON COLUMN public.businesses.billing_branch_count IS
    'Admin override of operating branches for standard subscription billing; NULL uses branch records.';

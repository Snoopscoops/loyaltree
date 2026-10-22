-- Run in Supabase SQL Editor after reconciling any flagged duplicate accounts.
-- Never delete/merge business rows automatically: wallets, billing and customers
-- reference their IDs. This migration fails atomically if duplicates remain.
BEGIN;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.businesses WHERE nullif(btrim(email),'') IS NOT NULL
  GROUP BY lower(btrim(email)) HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Duplicate business emails require owner review. No rows changed.';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_login_email_normalized_idx
 ON public.businesses(lower(btrim(email))) WHERE nullif(btrim(email),'') IS NOT NULL;
-- Staff/agents can work at different businesses. Enforce uniqueness only inside
-- their business; credential-aware login still rejects ambiguous cross-tenant matches.
CREATE UNIQUE INDEX IF NOT EXISTS staff_login_email_per_business_idx
 ON public.staff(business_id,lower(btrim(email))) WHERE nullif(btrim(email),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cl_agents_login_email_per_business_idx
 ON public.cl_agents(business_id,lower(btrim(email))) WHERE nullif(btrim(email),'') IS NOT NULL;
COMMIT;

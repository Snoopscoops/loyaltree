-- Draft: apply after churn_discount_policy_v1.sql and coupon schema verification.
BEGIN;
CREATE OR REPLACE FUNCTION public.churn_discount_report(p_business_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH classified AS (
   SELECT cl.status,
          EXISTS (SELECT 1 FROM public.coupons c
            WHERE c.business_id=cl.business_id AND c.customer_id=cl.customer_id
              AND c.public_id=cl.coupon_public_id) AS coupon_exists,
          EXISTS (SELECT 1 FROM public.coupons c
            WHERE c.business_id=cl.business_id AND c.customer_id=cl.customer_id
              AND c.public_id=cl.coupon_public_id AND c.status='redeemed') AS redeemed,
          EXISTS (SELECT 1 FROM public.coupons c
            WHERE c.business_id=cl.business_id AND c.customer_id=cl.customer_id
              AND c.public_id=cl.coupon_public_id AND c.status='active'
              AND c.expires_at < (now() AT TIME ZONE 'Asia/Manila')::date) AS expired
   FROM public.churn_discount_claims cl WHERE cl.business_id=p_business_id
 )
 SELECT jsonb_build_object(
   'pending',count(*) FILTER (WHERE status='pending'),
   'skipped',count(*) FILTER (WHERE status='skipped'),
   'issued',count(*) FILTER (WHERE status='issued' AND coupon_exists),
   'redeemed',count(*) FILTER (WHERE status='issued' AND redeemed),
   'expired_unused',count(*) FILTER (WHERE status='issued' AND expired),
   'missing_coupon',count(*) FILTER (WHERE status='issued' AND NOT coupon_exists),
   'redemption_rate_percent',round(100.0*count(*) FILTER (WHERE status='issued' AND redeemed)/
      nullif(count(*) FILTER (WHERE status='issued' AND coupon_exists),0),2),
   'scope','lifetime',
   'revenue_available',false
 ) FROM classified;
$$;
REVOKE ALL ON FUNCTION public.churn_discount_report(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.churn_discount_report(bigint) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

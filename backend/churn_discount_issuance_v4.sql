-- Draft, after enterprise_campaigns and churn_discount_policy_v1/v2/v3.
-- Existing customers have no promotional consent by default.
BEGIN;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS automation_kind text;
CREATE TABLE IF NOT EXISTS public.churn_marketing_consent (
  business_id bigint NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  verified_email text NOT NULL,
  allowed boolean NOT NULL,
  notice_version text NOT NULL CHECK (notice_version='winback-v1'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,customer_id)
);
ALTER TABLE public.churn_marketing_consent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.churn_marketing_consent FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.churn_marketing_consent TO service_role;

-- Only recorded stamp/points programs are supported in this first increment.
-- Other card types and unlinked orders are not treated as inactive members.
CREATE OR REPLACE FUNCTION public.churn_issue_business_batch(p_business_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 cfg public.churn_discount_settings%ROWTYPE;
 local_day date := (now() AT TIME ZONE 'Asia/Manila')::date;
 candidate record; consent public.churn_marketing_consent%ROWTYPE;
 member public.customers%ROWTYPE; activity_day date; cap integer;
 campaign_key text; campaign_id_value bigint; coupon_key text; issue_id_value bigint;
 source_key text; expiry date; issued_count integer := 0;
BEGIN
 SELECT * INTO cfg FROM public.churn_discount_settings WHERE business_id=p_business_id FOR UPDATE;
 IF NOT FOUND OR cfg.enabled IS NOT TRUE THEN RETURN jsonb_build_object('issued',0,'status','disabled'); END IF;
 IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id=p_business_id AND status='ACTIVE' AND plan='pro') THEN
   RETURN jsonb_build_object('issued',0,'status','ineligible_business');
 END IF;
 SELECT greatest(0,cfg.daily_limit-count(*))::integer INTO cap FROM public.churn_discount_claims
   WHERE business_id=p_business_id AND claim_day=local_day;
 IF cap=0 THEN RETURN jsonb_build_object('issued',0,'status','daily_limit'); END IF;
 expiry := local_day+cfg.validity_days-1;
 -- The settings lock serializes runs. Limit candidates per invocation and
 -- exclude previously claimed episodes before limiting.
 FOR candidate IN
   SELECT c.id, a.last_day FROM public.customers c
   JOIN public.churn_marketing_consent m ON m.customer_id=c.id AND m.business_id=c.business_id
   JOIN public.loyalty_programs p ON p.id=c.program_id AND p.business_id=c.business_id
   CROSS JOIN LATERAL (
     SELECT max(day_value) AS last_day FROM (
       SELECT (max(s.created_at) AT TIME ZONE 'Asia/Manila')::date AS day_value FROM public.stamp_events s WHERE s.business_id=c.business_id AND s.customer_id=c.id
       UNION ALL SELECT (max(e.created_at) AT TIME ZONE 'Asia/Manila')::date FROM public.points_events e WHERE e.business_id=c.business_id AND e.customer_id=c.id
       UNION ALL SELECT (max(o.created_at) AT TIME ZONE 'Asia/Manila')::date FROM public.menu_counter_orders o WHERE o.business_id=c.business_id AND o.member_customer_public_id=c.public_id AND o.status<>'cancelled' AND o.payment_status='paid' AND o.payment_method='cash'
       UNION ALL SELECT (max(t.transacted_at) AT TIME ZONE 'Asia/Manila')::date FROM public.pos_transactions t WHERE t.business_id=c.business_id AND t.customer_id=c.id AND t.transaction_type='sale' AND t.status='loyalty_applied'
     ) events
   ) a
   WHERE c.business_id=p_business_id AND m.allowed IS TRUE AND m.verified_email=lower(btrim(c.email))
     AND p.is_active IS TRUE AND p.card_type IN ('stamp','points')
     AND a.last_day<=local_day-cfg.inactivity_days
     AND NOT EXISTS(SELECT 1 FROM public.churn_discount_claims cl WHERE cl.business_id=c.business_id AND cl.customer_id=c.id AND cl.activity_date=a.last_day)
   ORDER BY a.last_day,c.id LIMIT cap
 LOOP
   SELECT * INTO member FROM public.customers WHERE id=candidate.id AND business_id=p_business_id FOR UPDATE;
   IF NOT FOUND THEN CONTINUE; END IF;
   SELECT * INTO consent FROM public.churn_marketing_consent WHERE business_id=p_business_id AND customer_id=member.id FOR UPDATE;
   IF NOT FOUND OR consent.allowed IS NOT TRUE OR consent.verified_email IS DISTINCT FROM lower(btrim(member.email)) THEN CONTINUE; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.loyalty_programs WHERE id=member.program_id AND business_id=p_business_id AND is_active IS TRUE AND card_type IN ('stamp','points')) THEN CONTINUE; END IF;
   SELECT max(day_value) INTO activity_day FROM (
      SELECT (max(s.created_at) AT TIME ZONE 'Asia/Manila')::date AS day_value FROM public.stamp_events s WHERE s.business_id=p_business_id AND s.customer_id=member.id
      UNION ALL SELECT (max(e.created_at) AT TIME ZONE 'Asia/Manila')::date FROM public.points_events e WHERE e.business_id=p_business_id AND e.customer_id=member.id
      UNION ALL SELECT (max(o.created_at) AT TIME ZONE 'Asia/Manila')::date FROM public.menu_counter_orders o WHERE o.business_id=p_business_id AND o.member_customer_public_id=member.public_id AND o.status<>'cancelled' AND o.payment_status='paid' AND o.payment_method='cash'
      UNION ALL SELECT (max(t.transacted_at) AT TIME ZONE 'Asia/Manila')::date FROM public.pos_transactions t WHERE t.business_id=p_business_id AND t.customer_id=member.id AND t.transaction_type='sale' AND t.status='loyalty_applied'
   ) events;
   IF activity_day IS DISTINCT FROM candidate.last_day OR activity_day>local_day-cfg.inactivity_days THEN CONTINUE; END IF;
   INSERT INTO public.churn_discount_claims(business_id,customer_id,activity_date,claim_day)
     VALUES(p_business_id,member.id,activity_day,local_day) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN CONTINUE; END IF;
   -- Ended qualification prevents the existing mass-grant and purchase paths
   -- from distributing personalized vouchers. Coupon dates remain independent.
   campaign_key := md5('winback:'||p_business_id||':'||local_day||':'||cfg.updated_at);
   INSERT INTO public.campaigns(public_id,business_id,name,scope,status,qualifying_start_date,qualifying_end_date,qualification_type,reward_type,reward_value,reward_label,coupon_start_date,coupon_end_date,automation_kind)
     VALUES(campaign_key,p_business_id,'Automatic win-back','nationwide','ended',local_day-1,local_day-1,'any_purchase','percent_discount',cfg.discount_percent,cfg.discount_percent||'% OFF',local_day,expiry,'winback') ON CONFLICT(public_id) DO NOTHING;
   SELECT id INTO STRICT campaign_id_value FROM public.campaigns WHERE public_id=campaign_key AND business_id=p_business_id AND automation_kind='winback';
   coupon_key := replace(gen_random_uuid()::text,'-','');
   source_key := 'winback:'||member.id||':'||activity_day;
   INSERT INTO public.coupons(public_id,business_id,customer_id,reward_text,reward_type,status,starts_at,expires_at,source,source_ref,created_at)
     VALUES(coupon_key,p_business_id,member.id,cfg.discount_percent||'% OFF — We miss you!','percent_discount','active',local_day,expiry,'campaign','campaign:'||campaign_key||':'||source_key,now());
   INSERT INTO public.campaign_coupon_issues(public_id,campaign_id,business_id,customer_id,coupon_public_id,source_transaction_id,reward_type,reward_value,status,starts_at,expires_at)
     VALUES(replace(gen_random_uuid()::text,'-',''),campaign_id_value,p_business_id,member.id,coupon_key,source_key,'percent_discount',cfg.discount_percent,'issued',local_day,expiry) RETURNING id INTO issue_id_value;
   INSERT INTO public.campaign_activity(campaign_id,campaign_issue_id,business_id,customer_id,activity_type,source_transaction_id,metadata)
     VALUES(campaign_id_value,issue_id_value,p_business_id,member.id,'coupon_issued',source_key,jsonb_build_object('coupon_public_id',coupon_key,'automation_kind','winback'));
   UPDATE public.churn_discount_claims SET status='issued',coupon_public_id=coupon_key WHERE business_id=p_business_id AND customer_id=member.id AND activity_date=activity_day;
   -- Existing durable queue is part of the transaction, not a best-effort push.
   INSERT INTO public.wallet_sync_jobs(business_id,customer_id,reason,status,attempts,next_attempt_at)
     VALUES(p_business_id,member.id,'churn_coupon_issued','pending',0,now());
   issued_count := issued_count+1;
 END LOOP;
 RETURN jsonb_build_object('issued',issued_count,'status','processed');
END $$;
REVOKE ALL ON FUNCTION public.churn_issue_business_batch(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.churn_issue_business_batch(bigint) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Draft migration; requires churn_discount_policy_v1.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.churn_claim_episode(
    p_business_id bigint, p_customer_id bigint, p_activity_date date,
    p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
    cfg public.churn_discount_settings%ROWTYPE;
    local_day date := (now() AT TIME ZONE 'Asia/Manila')::date;
    inserted integer;
BEGIN
    -- Serialize all claims for this business, including concurrent workers.
    SELECT * INTO cfg FROM public.churn_discount_settings
      WHERE business_id=p_business_id FOR UPDATE;
    IF NOT FOUND OR cfg.enabled IS NOT TRUE THEN
        RETURN jsonb_build_object('claimed',false,'reason','disabled');
    END IF;
    IF cfg.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('claimed',false,'reason','settings_changed');
    END IF;
    IF p_activity_date IS NULL OR p_activity_date > local_day-cfg.inactivity_days THEN
        RETURN jsonb_build_object('claimed',false,'reason','not_inactive');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.customers
        WHERE id=p_customer_id AND business_id=p_business_id) THEN
        RETURN jsonb_build_object('claimed',false,'reason','customer_not_found');
    END IF;
    IF EXISTS(SELECT 1 FROM public.churn_discount_claims
        WHERE business_id=p_business_id AND customer_id=p_customer_id
          AND activity_date=p_activity_date) THEN
        RETURN jsonb_build_object('claimed',false,'reason','already_claimed');
    END IF;
    IF (SELECT count(*) FROM public.churn_discount_claims
        WHERE business_id=p_business_id AND claim_day=local_day)>=cfg.daily_limit THEN
        RETURN jsonb_build_object('claimed',false,'reason','daily_limit');
    END IF;
    -- A claim is NOT a voucher. The future issuance transaction must recheck
    -- authoritative activity, consent and configuration before issuing.
    INSERT INTO public.churn_discount_claims(business_id,customer_id,activity_date,claim_day)
        VALUES(p_business_id,p_customer_id,p_activity_date,local_day)
        ON CONFLICT (business_id,customer_id,activity_date) DO NOTHING;
    GET DIAGNOSTICS inserted=ROW_COUNT;
    RETURN jsonb_build_object('claimed',inserted=1,
        'reason',CASE WHEN inserted=1 THEN 'pending' ELSE 'already_claimed' END);
END $$;
REVOKE ALL ON FUNCTION public.churn_claim_episode(bigint,bigint,date,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.churn_claim_episode(bigint,bigint,date,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

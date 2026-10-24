-- Apply before deploying subscription fulfillment. No provider calls here.
-- This migration never credits historical payments. Review legacy_review rows
-- against provider receipts and existing account expiry before manual repair.
-- Duplicate intent rows must be reconciled; do not delete referenced accounts.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.subscription_payments
   WHERE nullif(btrim(paymongo_payment_intent_id),'') IS NOT NULL
   GROUP BY paymongo_payment_intent_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Duplicate subscription payment intents require review; no rows changed.';
 END IF;
END $$;
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS fulfillment_context jsonb;
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS billing_session_id text;
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending';
UPDATE public.subscription_payments SET fulfillment_status='legacy_review'
 WHERE fulfillment_context IS NULL AND fulfilled_at IS NULL AND status='paid';
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payment_intent_unique_idx
 ON public.subscription_payments(paymongo_payment_intent_id)
 WHERE nullif(btrim(paymongo_payment_intent_id),'') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.subscription_fulfill(
 p_event_type text,p_intent_id text,p_payment_id text,p_amount_centavos bigint,
 p_currency text,p_livemode boolean,p_business_slug text DEFAULT '',p_payment_context text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE
 p public.subscription_payments%ROWTYPE;b public.businesses%ROWTYPE;
 patch public.businesses%ROWTYPE;r public.businesses%ROWTYPE;
 referrer_id public.businesses.id%TYPE;
 now_at timestamptz:=transaction_timestamp();base_at timestamptz;expiry_at date;
 current_at timestamptz;trial_at timestamptz;referral_base timestamptz;
 cycle text;months integer;paid_count integer;referral_done boolean:=false;
BEGIN
 IF p_event_type NOT IN('payment.paid','payment.failed','qrph.expired') THEN
  RETURN jsonb_build_object('outcome','ignored');END IF;
 SELECT * INTO p FROM subscription_payments WHERE paymongo_payment_intent_id=p_intent_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','missing_attempt');END IF;
 IF p.payment_provider IS DISTINCT FROM 'paymongo'
  OR p_payment_context NOT IN('','subscription') THEN
  RETURN jsonb_build_object('outcome','rejected','reason','provider_context');END IF;
 -- Legacy paid rows are acknowledged but never blindly granted a second term.
 IF p.fulfilled_at IS NOT NULL THEN RETURN jsonb_build_object('outcome','replay');END IF;
 IF p.fulfillment_context IS NULL OR p.fulfillment_status='legacy_review' THEN
  UPDATE subscription_payments SET fulfillment_status='legacy_review' WHERE id=p.id;
  RETURN jsonb_build_object('outcome','legacy_review');END IF;
 IF p.fulfillment_context->>'provider' IS DISTINCT FROM 'paymongo'
  OR p.fulfillment_context->>'version' IS DISTINCT FROM '1'
  OR (p.fulfillment_context->>'livemode')::boolean IS DISTINCT FROM p_livemode THEN
  RETURN jsonb_build_object('outcome','rejected','reason','provider_mode');END IF;
 -- Lock merchant/referrer in the same order for simultaneous referral payments.
 SELECT referred_by_business_id INTO referrer_id FROM businesses WHERE id=p.business_id;
 PERFORM 1 FROM businesses WHERE id=p.business_id OR id=referrer_id ORDER BY id FOR UPDATE;
 SELECT * INTO b FROM businesses WHERE id=p.business_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription business is unavailable';END IF;
 IF p_business_slug<>'' AND b.public_id::text<>p_business_slug THEN
  RETURN jsonb_build_object('outcome','rejected','reason','business_mismatch');END IF;
 IF p_event_type IN('payment.failed','qrph.expired') THEN
  -- Provider events may arrive out of order. Paid is a terminal outcome.
  IF p.status='pending' THEN
   p:=jsonb_populate_record(p,jsonb_build_object('status',CASE WHEN p_event_type='payment.failed' THEN 'failed' ELSE 'expired' END));
   UPDATE subscription_payments SET status=p.status WHERE id=p.id;
  END IF;
  RETURN jsonb_build_object('outcome','updated');END IF;
 IF p.status='paid' THEN
  UPDATE subscription_payments SET fulfillment_status='legacy_review' WHERE id=p.id;
  RETURN jsonb_build_object('outcome','legacy_review');END IF;
 IF p_amount_centavos IS NULL OR p_amount_centavos<=0 OR p_payment_id=''
  OR p.processor_amount IS NULL OR p.processor_amount::numeric*100<>p_amount_centavos
  OR upper(COALESCE(p.processor_currency,''))<>p_currency THEN
  RETURN jsonb_build_object('outcome','rejected','reason','amount_currency');END IF;
 cycle:=p.billing_cycle;
 IF cycle NOT IN('monthly','3_months','6_months','annual') OR cycle IS NULL THEN
  RETURN jsonb_build_object('outcome','rejected','reason','billing_cycle');END IF;
 current_at:=nullif(to_jsonb(b)->>'subscription_expires_at','')::timestamptz;
 trial_at:=CASE WHEN b.last_paid_at IS NULL THEN nullif(to_jsonb(b)->>'trial_ends_at','')::timestamptz ELSE NULL END;
 base_at:=GREATEST(now_at,current_at,trial_at);
 months:=CASE cycle WHEN '3_months' THEN 3 WHEN '6_months' THEN 6 WHEN 'annual' THEN 12 ELSE 0 END;
 expiry_at:=(CASE WHEN cycle='monthly' THEN base_at+interval '30 days' ELSE base_at+make_interval(months=>months) END)::date;
 patch:=jsonb_populate_record(b,jsonb_build_object('last_paid_at',now_at::date,
  'subscription_expires_at',expiry_at,'billing_cycle',cycle,
  'status',CASE WHEN upper(b.status::text)='PENDING' THEN 'ACTIVE' ELSE b.status::text END));
 UPDATE businesses SET last_paid_at=patch.last_paid_at,subscription_expires_at=patch.subscription_expires_at,
  billing_cycle=patch.billing_cycle,status=patch.status WHERE id=b.id;
 IF (p.fulfillment_context->>'setup_kit_included')::boolean IS TRUE THEN
  UPDATE businesses SET setup_kit_paid=true,setup_kit_status='paid' WHERE id=b.id;
  UPDATE setup_kit_orders SET payment_status='paid',fulfillment_status='paid',paid_at=now_at,updated_at=now_at
   WHERE business_id=b.id AND fulfillment_status IS DISTINCT FROM 'cancelled';
 END IF;
 UPDATE subscription_payments SET status='paid',paymongo_payment_id=p_payment_id,paid_at=now_at,
  fulfilled_at=now_at,fulfillment_status='fulfilled' WHERE id=p.id;
 -- Preserve the first-payment referral reward in the same atomic transaction.
 IF referrer_id IS NOT NULL AND referrer_id<>b.id AND b.referral_rewarded_at IS NULL
  AND NOT COALESCE(b.is_demo,false) THEN
  SELECT count(*) INTO paid_count FROM subscription_payments WHERE business_id=b.id AND status='paid';
  SELECT * INTO r FROM businesses WHERE id=referrer_id;
  IF FOUND AND paid_count=1 THEN
   referral_base:=GREATEST(now_at,nullif(to_jsonb(r)->>'subscription_expires_at','')::timestamptz,
    CASE WHEN r.last_paid_at IS NULL THEN nullif(to_jsonb(r)->>'trial_ends_at','')::timestamptz ELSE NULL END);
   patch:=jsonb_populate_record(r,jsonb_build_object('subscription_expires_at',(referral_base+interval '30 days')::date));
   UPDATE businesses SET subscription_expires_at=patch.subscription_expires_at WHERE id=r.id;
   UPDATE businesses SET referral_rewarded_at=now_at,referral_reward_payment_intent_id=p_intent_id WHERE id=b.id;
   referral_done:=true;
  END IF;
 END IF;
 RETURN jsonb_build_object('outcome','fulfilled','business_id',b.id,'business_slug',b.public_id,
  'billing_cycle',cycle,'subscription_expires_at',expiry_at,'referral_rewarded',referral_done);
END $$;
REVOKE ALL ON FUNCTION public.subscription_fulfill(text,text,text,bigint,text,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_fulfill(text,text,text,bigint,text,boolean,text,text) TO service_role;
COMMIT;

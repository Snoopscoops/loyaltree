-- Existing LT Benefits installations: run before releasing the coupon editor.
-- Rerunnable; does not rewrite members, balances, inventory or coupon snapshots.
BEGIN;
ALTER TABLE public.ltb_offers ADD COLUMN IF NOT EXISTS weekly_limit integer
 CONSTRAINT ltb_offers_weekly_limit_check CHECK(weekly_limit BETWEEN 1 AND 1000000);
CREATE INDEX IF NOT EXISTS ltb_coupons_offer_week_idx ON public.ltb_coupons(offer_id,claimed_at);

-- Patch only the existing offer-save and claim blocks, preserving independently
-- migrated identity and Wallet logic. Unknown versions fail atomically instead
-- of overwriting a newer dispatcher. Fresh installs already contain this code.
DO $migration$
DECLARE source text;old_parts text[];new_parts text[];i integer;
BEGIN
 SELECT pg_get_functiondef('public.ltb_command(text,jsonb)'::regprocedure) INTO source;
 IF position('jsonb_build_object(''error'',''weekly_limit'')' IN source)>0 THEN RETURN;END IF;
 old_parts:=ARRAY[
 $old$    total_quantity=(data->>'total_quantity')::integer,per_member_limit=(data->>'per_member_limit')::integer,$old$,
 $old$    discount_centavos,points_cost,total_quantity,per_member_limit,min_spend_centavos,starts_at,ends_at,coupon_valid_days,status)$old$,
 $old$    COALESCE((data->>'per_member_limit')::integer,1),COALESCE((data->>'min_spend_centavos')::bigint,0),$old$,
 $old$  IF o.claimed_count>=o.total_quantity THEN RETURN jsonb_build_object('error','out_of_stock');END IF;$old$
 ];
 new_parts:=ARRAY[
 $new$    total_quantity=(data->>'total_quantity')::integer,per_member_limit=(data->>'per_member_limit')::integer,
    weekly_limit=(data->>'weekly_limit')::integer,$new$,
 $new$    discount_centavos,points_cost,total_quantity,per_member_limit,weekly_limit,min_spend_centavos,starts_at,ends_at,coupon_valid_days,status)$new$,
 $new$    COALESCE((data->>'per_member_limit')::integer,1),(data->>'weekly_limit')::integer,COALESCE((data->>'min_spend_centavos')::bigint,0),$new$,
 $new$  IF o.claimed_count>=o.total_quantity THEN RETURN jsonb_build_object('error','out_of_stock');END IF;
  -- All claimers hold the same offer row lock. A retry is returned above before
  -- this check; successful claims count even if used or expired later.
  IF o.weekly_limit IS NOT NULL AND (SELECT count(*) FROM ltb_coupons WHERE offer_id=o.id
   AND claimed_at>=(date_trunc('week',now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')
   AND claimed_at<((date_trunc('week',now() AT TIME ZONE 'Asia/Manila')+interval '7 days') AT TIME ZONE 'Asia/Manila'))>=o.weekly_limit
   THEN RETURN jsonb_build_object('error','weekly_limit');END IF;$new$
 ];
 FOR i IN 1..array_length(old_parts,1) LOOP
  IF (length(source)-length(replace(source,old_parts[i],'')))/length(old_parts[i])<>1
   THEN RAISE EXCEPTION 'Unknown LT Benefits coupon dispatcher version (patch %); migration rolled back',i;END IF;
  source:=replace(source,old_parts[i],new_parts[i]);
 END LOOP;
 EXECUTE source;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;

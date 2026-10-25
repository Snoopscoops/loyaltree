-- Run once in Supabase SQL Editor before enabling LT_BENEFITS_ENABLED.
-- Merchant stamps and merchant points are never changed by this migration.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ltb_settings (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
 pesos_per_point integer NOT NULL DEFAULT 500 CHECK(pesos_per_point BETWEEN 1 AND 1000000),
 rule_version bigint NOT NULL DEFAULT 1, max_points_per_transaction integer CHECK(max_points_per_transaction>0),
 updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.ltb_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.ltb_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL CHECK(email=lower(btrim(email))),
 phone_key text NOT NULL DEFAULT '', email_verified_at timestamptz, balance_points bigint NOT NULL DEFAULT 0,
 version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ltb_members ADD COLUMN IF NOT EXISTS phone_key text NOT NULL DEFAULT '';
ALTER TABLE public.ltb_members ALTER COLUMN email_verified_at DROP NOT NULL;
ALTER TABLE public.ltb_members ALTER COLUMN email_verified_at DROP DEFAULT;
ALTER TABLE public.ltb_members DROP CONSTRAINT IF EXISTS ltb_members_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS ltb_members_contact_idx ON public.ltb_members(email,phone_key);
CREATE OR REPLACE FUNCTION public.ltb_phone(p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE digits text:=regexp_replace(COALESCE(p_value,''),'[^0-9]','','g');
BEGIN
 IF left(digits,2)='00' THEN digits:=substr(digits,3);END IF;
 IF length(digits)=11 AND left(digits,2)='09' THEN digits:='63'||substr(digits,2);END IF;
 RETURN CASE WHEN length(digits) BETWEEN 8 AND 15 THEN digits ELSE '' END;
END $$;
CREATE TABLE IF NOT EXISTS public.ltb_cards (
 customer_public_id text PRIMARY KEY,member_id uuid NOT NULL REFERENCES public.ltb_members(id),customer_id text NOT NULL,
 business_id text NOT NULL,business_slug text NOT NULL,business_name text NOT NULL,business_logo_url text,
 revoked_at timestamptz,consent_version text NOT NULL DEFAULT '2026-10-21',consent_at timestamptz NOT NULL DEFAULT now(),linked_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ltb_cards_member_idx ON public.ltb_cards(member_id);
CREATE TABLE IF NOT EXISTS public.ltb_auth_challenges (
 id uuid PRIMARY KEY,email text NOT NULL,code_hash text NOT NULL,client_hash text NOT NULL,card_context jsonb,
 attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 consumed_at timestamptz,send_failed boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS ltb_auth_email_idx ON public.ltb_auth_challenges(email,created_at DESC);
CREATE INDEX IF NOT EXISTS ltb_auth_client_idx ON public.ltb_auth_challenges(client_hash,created_at DESC);
CREATE TABLE IF NOT EXISTS public.ltb_sessions (
 token_hash text PRIMARY KEY,member_id uuid NOT NULL REFERENCES public.ltb_members(id),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,customer_public_id text);
ALTER TABLE public.ltb_sessions ADD COLUMN IF NOT EXISTS customer_public_id text;
CREATE INDEX IF NOT EXISTS ltb_session_expiry_idx ON public.ltb_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public.ltb_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id text NOT NULL,business_slug text NOT NULL,
 business_name text NOT NULL,business_logo_url text,title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),terms text NOT NULL DEFAULT '' CHECK(length(terms)<=3000),
 image_url text CHECK(image_url IS NULL OR image_url ~ '^https://[^[:space:]]+$'),
 category text NOT NULL DEFAULT 'other' CHECK(category IN('food_drink','shopping','wellness','experiences','other')),
 discount_centavos bigint NOT NULL CHECK(discount_centavos BETWEEN 1 AND 100000000),
 points_cost integer NOT NULL CHECK(points_cost BETWEEN 1 AND 10000000),
 total_quantity integer NOT NULL CHECK(total_quantity BETWEEN 1 AND 1000000),
 claimed_count integer NOT NULL DEFAULT 0 CHECK(claimed_count>=0 AND claimed_count<=total_quantity),
 per_member_limit integer NOT NULL DEFAULT 1 CHECK(per_member_limit BETWEEN 1 AND 100),
 weekly_limit integer CONSTRAINT ltb_offers_weekly_limit_check CHECK(weekly_limit BETWEEN 1 AND 1000000),
 min_spend_centavos bigint NOT NULL DEFAULT 0 CHECK(min_spend_centavos BETWEEN 0 AND 100000000),
 starts_at timestamptz,ends_at timestamptz,coupon_valid_days integer NOT NULL DEFAULT 30 CHECK(coupon_valid_days BETWEEN 1 AND 365),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','paused')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at));
CREATE INDEX IF NOT EXISTS ltb_offers_business_idx ON public.ltb_offers(business_id,created_at DESC);
ALTER TABLE public.ltb_offers ADD COLUMN IF NOT EXISTS weekly_limit integer CONSTRAINT ltb_offers_weekly_limit_check CHECK(weekly_limit BETWEEN 1 AND 1000000);
CREATE INDEX IF NOT EXISTS ltb_offers_catalog_idx ON public.ltb_offers(status,created_at DESC);
CREATE TABLE IF NOT EXISTS public.ltb_coupons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),offer_id uuid NOT NULL REFERENCES public.ltb_offers(id),
 member_id uuid NOT NULL REFERENCES public.ltb_members(id),business_id text NOT NULL,snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'claimed' CHECK(status IN('claimed','used')),
 claimed_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,used_at timestamptz,
 used_by text,branch_id text,receipt_reference text,expiry_notified boolean NOT NULL DEFAULT false,CHECK((status='used')=(used_at IS NOT NULL)));
CREATE INDEX IF NOT EXISTS ltb_coupons_member_idx ON public.ltb_coupons(member_id,claimed_at DESC);
CREATE INDEX IF NOT EXISTS ltb_coupons_business_idx ON public.ltb_coupons(business_id,claimed_at DESC);
CREATE INDEX IF NOT EXISTS ltb_coupons_offer_member_idx ON public.ltb_coupons(offer_id,member_id);
CREATE INDEX IF NOT EXISTS ltb_coupons_offer_week_idx ON public.ltb_coupons(offer_id,claimed_at);
CREATE TABLE IF NOT EXISTS public.ltb_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id uuid NOT NULL REFERENCES public.ltb_members(id),
 kind text NOT NULL CHECK(kind IN('earn','refund','claim')),points_delta bigint NOT NULL,description text NOT NULL,
 source_reference text NOT NULL,rule_snapshot jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ltb_ledger_member_idx ON public.ltb_ledger(member_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.ltb_idempotency (
 scope text NOT NULL,key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS public.ltb_purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),member_id uuid NOT NULL REFERENCES public.ltb_members(id),
 customer_public_id text NOT NULL,business_id text NOT NULL,source_type text NOT NULL,source_id text NOT NULL,
 eligible_centavos bigint NOT NULL CHECK(eligible_centavos>0),refunded_centavos bigint NOT NULL DEFAULT 0,
 rule_version bigint NOT NULL,rate_centavos bigint NOT NULL CHECK(rate_centavos>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,source_type,source_id),CHECK(refunded_centavos BETWEEN 0 AND eligible_centavos));
CREATE TABLE IF NOT EXISTS public.ltb_earning_buckets (
 member_id uuid NOT NULL REFERENCES public.ltb_members(id),rule_version bigint NOT NULL,
 net_spend_centavos bigint NOT NULL DEFAULT 0 CHECK(net_spend_centavos>=0),earned_points bigint NOT NULL DEFAULT 0 CHECK(earned_points>=0),
 PRIMARY KEY(member_id,rule_version));
CREATE TABLE IF NOT EXISTS public.ltb_refunds (
 purchase_id uuid NOT NULL REFERENCES public.ltb_purchases(id),refund_id text NOT NULL,
 amount_centavos bigint NOT NULL CHECK(amount_centavos>0),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(purchase_id,refund_id));
CREATE TABLE IF NOT EXISTS public.ltb_pending_refunds (
 business_id text NOT NULL,source_type text NOT NULL,source_id text NOT NULL,refund_id text NOT NULL,
 amount_centavos bigint NOT NULL CHECK(amount_centavos>0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,source_type,source_id,refund_id));
CREATE TABLE IF NOT EXISTS public.ltb_wallet_jobs (
 member_id uuid PRIMARY KEY REFERENCES public.ltb_members(id),version bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing')),lease_token uuid,lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 dirty_cards jsonb NOT NULL DEFAULT '{}',claimed_cards jsonb NOT NULL DEFAULT '{}');
-- Per-card tokens coalesce only visible changes. A leased snapshot cannot
-- acknowledge a later update to the same card or a newly linked card.
ALTER TABLE public.ltb_wallet_jobs ADD COLUMN IF NOT EXISTS dirty_cards jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.ltb_wallet_jobs ADD COLUMN IF NOT EXISTS claimed_cards jsonb NOT NULL DEFAULT '{}';
-- Retain all work queued by older releases, including cleared revoked cards.
UPDATE public.ltb_wallet_jobs j SET dirty_cards=COALESCE((SELECT jsonb_object_agg(k.customer_public_id,gen_random_uuid()::text)
 FROM public.ltb_cards k WHERE k.member_id=j.member_id),'{}') WHERE dirty_cards='{}';

-- Apple Add sees these columns in its existing select('*'): no extra round trip.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lt_member_id uuid;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lt_points_balance bigint;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lt_points_version bigint;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lt_points_updated_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lt_coupon_count integer;

CREATE OR REPLACE FUNCTION public.ltb_touch(p_member uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m ltb_members%ROWTYPE;changed_cards jsonb;
BEGIN
 -- Activity remains current even for a purchase that changes only carry/debt.
 UPDATE ltb_members SET updated_at=clock_timestamp() WHERE id=p_member RETURNING * INTO m;
 IF NOT FOUND THEN RETURN;END IF;
 -- Compare and write in the same UPDATE. Contact predicates are rechecked if
 -- a concurrent contact edit wins the customer row lock, so stale membership
 -- data cannot restore a projection that the revocation trigger just cleared.
 WITH coupon_counts AS(SELECT business_id,count(*)::integer coupons FROM ltb_coupons
  WHERE member_id=m.id AND status='claimed' AND expires_at>now() GROUP BY business_id),changed AS(
  UPDATE customers c SET lt_member_id=m.id,lt_points_balance=GREATEST(m.balance_points,0),lt_points_version=m.version+1,
   lt_points_updated_at=m.updated_at,lt_coupon_count=COALESCE(q.coupons,0)
  FROM ltb_cards k LEFT JOIN coupon_counts q ON q.business_id=k.business_id
  WHERE k.member_id=m.id AND k.revoked_at IS NULL AND k.customer_public_id=c.public_id::text
   AND k.customer_id=c.id::text AND k.business_id=c.business_id::text
   AND lower(btrim(c.email))=m.email AND ltb_phone(to_jsonb(c)->>'phone')=m.phone_key
   AND (c.lt_member_id IS DISTINCT FROM m.id OR c.lt_points_balance IS NULL
    OR GREATEST(c.lt_points_balance,0) IS DISTINCT FROM GREATEST(m.balance_points,0)
    OR GREATEST(COALESCE(c.lt_coupon_count,0),0) IS DISTINCT FROM COALESCE(q.coupons,0))
  RETURNING c.public_id)
 SELECT COALESCE(jsonb_object_agg(public_id::text,gen_random_uuid()::text),'{}') INTO changed_cards FROM changed;
 IF changed_cards='{}' THEN RETURN;END IF;
 -- Native projections hold the rendered balance; signed debt remains in the
 -- member/ledger. Invisible debt/carry changes never alter pass fingerprints.
 UPDATE ltb_members SET version=version+1 WHERE id=m.id RETURNING * INTO m;
 INSERT INTO ltb_wallet_jobs(member_id,version,dirty_cards) VALUES(m.id,m.version,changed_cards)
 ON CONFLICT(member_id) DO UPDATE SET version=GREATEST(ltb_wallet_jobs.version+1,EXCLUDED.version),
  dirty_cards=ltb_wallet_jobs.dirty_cards||EXCLUDED.dirty_cards,updated_at=now(),
  next_attempt_at=CASE WHEN ltb_wallet_jobs.status='pending' THEN now() ELSE ltb_wallet_jobs.next_attempt_at END;
END $$;

CREATE OR REPLACE FUNCTION public.ltb_link_card(p_member uuid,p_card jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m ltb_members%ROWTYPE;k ltb_cards%ROWTYPE;
BEGIN
 SELECT * INTO m FROM ltb_members WHERE id=p_member FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Signed URL proves card possession; fresh verified matching contact proves ownership.
 PERFORM 1 FROM customers c WHERE c.public_id::text=p_card->>'customer_public_id'
  AND c.id::text=p_card->>'customer_id' AND c.business_id::text=p_card->>'business_id' AND lower(btrim(c.email))=m.email AND ltb_phone(to_jsonb(c)->>'phone')=m.phone_key FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 SELECT * INTO k FROM ltb_cards WHERE customer_public_id=p_card->>'customer_public_id';
 IF FOUND AND k.revoked_at IS NULL AND k.member_id<>p_member THEN RETURN false;END IF;
 IF (NOT FOUND OR k.member_id<>p_member) AND (SELECT count(*) FROM ltb_cards WHERE member_id=p_member)>=100 THEN RETURN false;END IF;
 INSERT INTO ltb_cards(customer_public_id,member_id,customer_id,business_id,business_slug,business_name,business_logo_url)
 VALUES(p_card->>'customer_public_id',p_member,p_card->>'customer_id',p_card->>'business_id',p_card->>'business_slug',
 p_card->>'business_name',p_card->>'business_logo_url') ON CONFLICT(customer_public_id) DO UPDATE
 SET member_id=EXCLUDED.member_id,customer_id=EXCLUDED.customer_id,business_id=EXCLUDED.business_id,
 business_slug=EXCLUDED.business_slug,business_name=EXCLUDED.business_name,business_logo_url=EXCLUDED.business_logo_url,
 revoked_at=NULL,consent_at=now(),linked_at=now() WHERE ltb_cards.revoked_at IS NOT NULL;
 SELECT * INTO k FROM ltb_cards WHERE customer_public_id=p_card->>'customer_public_id';
 IF k.member_id<>p_member THEN RETURN false; END IF;
 PERFORM ltb_touch(p_member);RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.ltb_coupon_json(q public.ltb_coupons) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public AS $$ SELECT q.snapshot||jsonb_build_object('id',q.id,'offer_id',q.offer_id,
 'status',CASE WHEN q.status='claimed' AND q.expires_at<=now() THEN 'expired' ELSE q.status END,
 'claimed_at',q.claimed_at,'expires_at',q.expires_at,'used_at',q.used_at) $$;
CREATE OR REPLACE FUNCTION public.ltb_offer_json(o public.ltb_offers) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public AS $$ SELECT to_jsonb(o)-'business_id'||jsonb_build_object(
 'remaining_quantity',o.total_quantity-o.claimed_count,
 'used_count',(SELECT count(*) FROM ltb_coupons WHERE offer_id=o.id AND status='used'),
 'expired_count',(SELECT count(*) FROM ltb_coupons WHERE offer_id=o.id AND status='claimed' AND expires_at<=now())) $$;

-- Service-only dispatch: every financial or inventory action is ONE transaction.
CREATE OR REPLACE FUNCTION public.ltb_command(p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s ltb_settings%ROWTYPE;m ltb_members%ROWTYPE;ch ltb_auth_challenges%ROWTYPE;
 o ltb_offers%ROWTYPE;q ltb_coupons%ROWTYPE;k ltb_cards%ROWTYPE;purchase ltb_purchases%ROWTYPE;
 bucket ltb_earning_buckets%ROWTYPE;idem ltb_idempotency%ROWTYPE;existing_refund ltb_refunds%ROWTYPE;
 amount bigint;delta bigint;earned bigint;lim integer;offst integer;refunded bigint;pending_amount bigint;processed integer:=0;work_member uuid;
 data jsonb;result jsonb;rows_json jsonb;email_value text;scope_value text;expiry timestamptz;
BEGIN
 SELECT * INTO s FROM ltb_settings WHERE id=1;
 IF p_action='settings' THEN RETURN to_jsonb(s)-'id'; END IF;
 IF p_action='settings_update' THEN
  UPDATE ltb_settings SET enabled=COALESCE((p_data->>'enabled')::boolean,enabled),
   rule_version=rule_version+CASE WHEN p_data ? 'pesos_per_point' AND (p_data->>'pesos_per_point')::integer<>pesos_per_point THEN 1 ELSE 0 END,
   pesos_per_point=COALESCE((p_data->>'pesos_per_point')::integer,pesos_per_point),
   max_points_per_transaction=CASE WHEN p_data ? 'max_points_per_transaction' THEN (p_data->>'max_points_per_transaction')::integer ELSE max_points_per_transaction END,
   updated_at=now() WHERE id=1 RETURNING * INTO s;RETURN to_jsonb(s)-'id';
 END IF;
 IF NOT s.enabled AND p_action NOT IN('reverse','logout','wallet_jobs_claim','wallet_jobs_finish','auth_cleanup','maintenance') THEN RETURN jsonb_build_object('error','unavailable');END IF;
 lim:=LEAST(GREATEST(COALESCE((p_data->>'limit')::integer,25),1),100);
 offst:=LEAST(GREATEST(COALESCE((p_data->>'offset')::integer,0),0),10000);

 IF p_action='provision' THEN
  IF COALESCE(p_data->>'email','')='' OR COALESCE(p_data->>'phone_key','')='' THEN RETURN jsonb_build_object('status','missing_contact');END IF;
  INSERT INTO ltb_members(email,phone_key) VALUES(p_data->>'email',p_data->>'phone_key') ON CONFLICT(email,phone_key) DO NOTHING;
  SELECT * INTO m FROM ltb_members WHERE email=p_data->>'email' AND phone_key=p_data->>'phone_key' FOR UPDATE;
  -- Only the first card is enrolled automatically. A second card with matching
  -- contacts must prove the OTP before gaining access to this shared balance.
  IF p_data->'card_context' IS NOT NULL AND p_data->'card_context'<>'null'::jsonb
   AND NOT EXISTS(SELECT 1 FROM ltb_cards WHERE member_id=m.id) THEN
   PERFORM ltb_link_card(m.id,p_data->'card_context');
  END IF;
  RETURN jsonb_build_object('status','profile_ready');
 ELSIF p_action='auth_request' THEN
  email_value:=p_data->>'email';
  IF p_data->'card_context' IS NULL OR p_data->'card_context'='null'::jsonb THEN RETURN jsonb_build_object('accepted',false);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ltb-client:'||(p_data->>'client_hash'),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ltb-auth:'||email_value,0));
  IF EXISTS(SELECT 1 FROM ltb_auth_challenges WHERE email=email_value AND created_at>now()-interval '60 seconds')
   OR (SELECT count(*) FROM ltb_auth_challenges WHERE email=email_value AND created_at>now()-interval '1 hour')>=5
   OR (SELECT count(*) FROM ltb_auth_challenges WHERE client_hash=p_data->>'client_hash' AND created_at>now()-interval '1 hour')>=20
  THEN RETURN jsonb_build_object('accepted',false);END IF;
  INSERT INTO ltb_auth_challenges(id,email,code_hash,client_hash,card_context,expires_at)
   VALUES((p_data->>'id')::uuid,email_value,p_data->>'code_hash',p_data->>'client_hash',p_data->'card_context',now()+interval '10 minutes');
  RETURN jsonb_build_object('accepted',true);
 ELSIF p_action='auth_send_failed' THEN
  UPDATE ltb_auth_challenges SET send_failed=true,consumed_at=now() WHERE id=(p_data->>'id')::uuid;RETURN '{}';
 ELSIF p_action='auth_verify' THEN
  SELECT * INTO ch FROM ltb_auth_challenges WHERE id=(p_data->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR ch.consumed_at IS NOT NULL OR ch.expires_at<=now() OR ch.send_failed OR ch.attempts>=5
   THEN RETURN jsonb_build_object('error','invalid_code');END IF;
  UPDATE ltb_auth_challenges SET attempts=attempts+1 WHERE id=ch.id;
  IF ch.code_hash<>p_data->>'code_hash' THEN RETURN jsonb_build_object('error','invalid_code');END IF;
  IF ch.card_context IS NOT NULL AND ch.card_context<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM customers c
   WHERE c.public_id::text=ch.card_context->>'customer_public_id' AND c.id::text=ch.card_context->>'customer_id'
   AND c.business_id::text=ch.card_context->>'business_id' AND lower(btrim(c.email))=ch.email
   AND ltb_phone(to_jsonb(c)->>'phone')=COALESCE(ch.card_context->>'phone_key',''))
   THEN RETURN jsonb_build_object('error','card_contact_changed');END IF;
  IF ch.card_context IS NULL OR ch.card_context='null'::jsonb THEN RETURN jsonb_build_object('error','invalid_code');END IF;
  INSERT INTO ltb_members(email,phone_key,email_verified_at) VALUES(ch.email,COALESCE(ch.card_context->>'phone_key',''),now())
   ON CONFLICT(email,phone_key) DO UPDATE SET email_verified_at=now();
  SELECT * INTO m FROM ltb_members WHERE email=ch.email AND phone_key=COALESCE(ch.card_context->>'phone_key','') FOR UPDATE;
  IF ch.card_context IS NOT NULL AND ch.card_context<>'null'::jsonb THEN
   IF NOT ltb_link_card(m.id,ch.card_context) THEN RETURN jsonb_build_object('error','card_link_conflict');END IF;
  END IF;
  UPDATE ltb_auth_challenges SET consumed_at=now() WHERE id=ch.id;
  INSERT INTO ltb_sessions(token_hash,member_id,expires_at,customer_public_id) VALUES(p_data->>'token_hash',m.id,now()+interval '60 days',ch.card_context->>'customer_public_id');
  RETURN jsonb_build_object('member_id',m.id,'email',m.email,'linked',true,'customer_public_id',ch.card_context->>'customer_public_id');
 ELSIF p_action='session' THEN
  SELECT mm.* INTO m FROM ltb_sessions ss JOIN ltb_members mm ON mm.id=ss.member_id
   JOIN ltb_cards kk ON kk.customer_public_id=ss.customer_public_id AND kk.member_id=mm.id AND kk.revoked_at IS NULL
   JOIN customers cc ON cc.public_id::text=kk.customer_public_id AND lower(btrim(cc.email))=mm.email
    AND ltb_phone(to_jsonb(cc)->>'phone')=mm.phone_key
   WHERE ss.token_hash=p_data->>'token_hash' AND ss.revoked_at IS NULL AND ss.expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error','unauthorized');END IF;
  RETURN jsonb_build_object('member_id',m.id,'email',m.email,'customer_public_id',
   (SELECT customer_public_id FROM ltb_sessions WHERE token_hash=p_data->>'token_hash'));
 ELSIF p_action='logout' THEN
  UPDATE ltb_sessions SET revoked_at=now() WHERE token_hash=p_data->>'token_hash';RETURN jsonb_build_object('logged_out',true);
 ELSIF p_action IN('auth_cleanup','maintenance') THEN
  DELETE FROM ltb_auth_challenges WHERE id IN(SELECT id FROM ltb_auth_challenges WHERE expires_at<now()-interval '1 day' LIMIT 500);
  DELETE FROM ltb_sessions WHERE token_hash IN(SELECT token_hash FROM ltb_sessions
   WHERE expires_at<now()-interval '1 day' OR revoked_at<now()-interval '1 day' LIMIT 500);
  FOR work_member IN SELECT DISTINCT member_id FROM ltb_coupons
   WHERE status='claimed' AND expires_at<=now() AND NOT expiry_notified LIMIT LEAST(lim,10) LOOP
   PERFORM 1 FROM ltb_members WHERE id=work_member FOR UPDATE SKIP LOCKED;
   IF FOUND THEN
    UPDATE ltb_coupons SET expiry_notified=true WHERE member_id=work_member AND status='claimed' AND expires_at<=now() AND NOT expiry_notified;
    PERFORM ltb_touch(work_member);processed:=processed+1;
   END IF;
  END LOOP;
  RETURN jsonb_build_object('members_updated',processed);
 ELSIF p_action IN('catalog','owner_offers') THEN
  SELECT COALESCE(jsonb_agg(t.obj ORDER BY t.created_at DESC,t.id DESC),'[]') INTO rows_json FROM(
   SELECT ltb_offer_json(oo) obj,oo.created_at,oo.id FROM ltb_offers oo WHERE CASE WHEN p_action='owner_offers'
    THEN oo.business_id=p_data->>'business_id' ELSE oo.status='active' AND (oo.starts_at IS NULL OR oo.starts_at<=now())
    AND (oo.ends_at IS NULL OR oo.ends_at>now()) AND oo.claimed_count<oo.total_quantity END
   ORDER BY oo.created_at DESC,oo.id DESC LIMIT lim+1 OFFSET offst)t;
  RETURN jsonb_build_object('offers',rows_json,'has_more',jsonb_array_length(rows_json)>lim,'limit',lim,'offset',offst);
 ELSIF p_action='offer_save' THEN
  data:=p_data->'offer';
  IF p_data ? 'offer_id' THEN
   SELECT * INTO o FROM ltb_offers WHERE id=(p_data->>'offer_id')::uuid AND business_id=p_data->>'business_id' FOR UPDATE;
   IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found');END IF;
   data:=to_jsonb(o)||data;
   IF (data->>'total_quantity')::integer<o.claimed_count THEN RETURN jsonb_build_object('error','stock_below_claimed');END IF;
   UPDATE ltb_offers SET title=data->>'title',description=data->>'description',terms=data->>'terms',image_url=data->>'image_url',
    category=data->>'category',discount_centavos=(data->>'discount_centavos')::bigint,points_cost=(data->>'points_cost')::integer,
    total_quantity=(data->>'total_quantity')::integer,per_member_limit=(data->>'per_member_limit')::integer,
    weekly_limit=(data->>'weekly_limit')::integer,
    min_spend_centavos=(data->>'min_spend_centavos')::bigint,starts_at=(data->>'starts_at')::timestamptz,
    ends_at=(data->>'ends_at')::timestamptz,coupon_valid_days=(data->>'coupon_valid_days')::integer,status=data->>'status',updated_at=now()
   WHERE id=o.id RETURNING * INTO o;
  ELSE
   INSERT INTO ltb_offers(business_id,business_slug,business_name,business_logo_url,title,description,terms,image_url,category,
    discount_centavos,points_cost,total_quantity,per_member_limit,weekly_limit,min_spend_centavos,starts_at,ends_at,coupon_valid_days,status)
   VALUES(p_data->>'business_id',p_data->>'business_slug',p_data->>'business_name',p_data->>'business_logo_url',data->>'title',
    COALESCE(data->>'description',''),COALESCE(data->>'terms',''),data->>'image_url',COALESCE(data->>'category','other'),
    (data->>'discount_centavos')::bigint,(data->>'points_cost')::integer,(data->>'total_quantity')::integer,
    COALESCE((data->>'per_member_limit')::integer,1),(data->>'weekly_limit')::integer,COALESCE((data->>'min_spend_centavos')::bigint,0),
    (data->>'starts_at')::timestamptz,(data->>'ends_at')::timestamptz,COALESCE((data->>'coupon_valid_days')::integer,30),COALESCE(data->>'status','draft')) RETURNING * INTO o;
  END IF;RETURN ltb_offer_json(o);
 ELSIF p_action='link' THEN
  IF NOT ltb_link_card((p_data->>'member_id')::uuid,p_data->'card_context') THEN RETURN jsonb_build_object('error','card_link_conflict');END IF;
  RETURN jsonb_build_object('linked',true,'card',(p_data->'card_context')-'customer_id'-'business_id'-'business_logo_url');
 ELSIF p_action='me' THEN
  SELECT * INTO m FROM ltb_members WHERE id=(p_data->>'member_id')::uuid;
  RETURN jsonb_build_object('balance_points',m.balance_points,'available_points',GREATEST(m.balance_points,0),
   'cards',COALESCE((SELECT jsonb_agg(t.obj) FROM(SELECT jsonb_build_object('customer_public_id',customer_public_id,
    'business_slug',business_slug,'business_name',business_name) obj FROM ltb_cards WHERE member_id=m.id AND revoked_at IS NULL ORDER BY linked_at DESC LIMIT 100)t),'[]'),
   'coupons',COALESCE((SELECT jsonb_agg(t.obj) FROM(SELECT ltb_coupon_json(qq) obj FROM ltb_coupons qq WHERE qq.member_id=m.id
    ORDER BY qq.claimed_at DESC,qq.id DESC LIMIT lim OFFSET offst)t),'[]'),
   'activity',COALESCE((SELECT jsonb_agg(t.obj) FROM(SELECT jsonb_build_object('id',id,'kind',kind,'points_delta',points_delta,
    'created_at',created_at,'description',description) obj FROM ltb_ledger WHERE member_id=m.id ORDER BY created_at DESC,id DESC LIMIT lim OFFSET offst)t),'[]'),
   'has_more',(SELECT count(*)>offst+lim FROM ltb_coupons WHERE member_id=m.id) OR (SELECT count(*)>offst+lim FROM ltb_ledger WHERE member_id=m.id));
 ELSIF p_action='claim' THEN
  SELECT * INTO m FROM ltb_members WHERE id=(p_data->>'member_id')::uuid FOR UPDATE;
  scope_value:='claim:'||m.id;
  SELECT * INTO idem FROM ltb_idempotency WHERE scope=scope_value AND key=p_data->>'key';
  IF FOUND THEN
   IF idem.request_hash<>p_data->>'request_hash' THEN RETURN jsonb_build_object('error','idempotency_conflict');END IF;
   RETURN idem.result||jsonb_build_object('idempotent_replay',true);
  END IF;
  SELECT * INTO o FROM ltb_offers WHERE id=(p_data->>'offer_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found');END IF;
  IF o.status<>'active' OR o.starts_at>now() OR o.ends_at<=now() THEN RETURN jsonb_build_object('error','offer_closed');END IF;
  IF o.claimed_count>=o.total_quantity THEN RETURN jsonb_build_object('error','out_of_stock');END IF;
  -- All claimers hold the same offer row lock. A retry is returned above before
  -- this check; successful claims count even if used or expired later.
  IF o.weekly_limit IS NOT NULL AND (SELECT count(*) FROM ltb_coupons WHERE offer_id=o.id
   AND claimed_at>=(date_trunc('week',now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')
   AND claimed_at<((date_trunc('week',now() AT TIME ZONE 'Asia/Manila')+interval '7 days') AT TIME ZONE 'Asia/Manila'))>=o.weekly_limit
   THEN RETURN jsonb_build_object('error','weekly_limit');END IF;
  IF m.balance_points<o.points_cost THEN RETURN jsonb_build_object('error','insufficient_points');END IF;
  IF (SELECT count(*) FROM ltb_coupons WHERE offer_id=o.id AND member_id=m.id)>=o.per_member_limit THEN RETURN jsonb_build_object('error','member_limit');END IF;
  expiry:=LEAST(COALESCE(o.ends_at,'infinity'::timestamptz),now()+make_interval(days=>o.coupon_valid_days));
  data:=jsonb_build_object('business_slug',o.business_slug,'business_name',o.business_name,'business_logo_url',o.business_logo_url,
   'title',o.title,'description',o.description,'terms',o.terms,'image_url',o.image_url,'category',o.category,
   'discount_centavos',o.discount_centavos,'points_cost',o.points_cost,'min_spend_centavos',o.min_spend_centavos);
  INSERT INTO ltb_coupons(offer_id,member_id,business_id,snapshot,expires_at) VALUES(o.id,m.id,o.business_id,data,expiry) RETURNING * INTO q;
  UPDATE ltb_offers SET claimed_count=claimed_count+1,updated_at=now() WHERE id=o.id;
  UPDATE ltb_members SET balance_points=balance_points-o.points_cost WHERE id=m.id RETURNING * INTO m;
  INSERT INTO ltb_ledger(member_id,kind,points_delta,description,source_reference,rule_snapshot) VALUES(m.id,'claim',-o.points_cost,'Coupon claimed',q.id::text,data);
  PERFORM ltb_touch(m.id);
  result:=jsonb_build_object('coupon',ltb_coupon_json(q),'balance_points',m.balance_points,'available_points',GREATEST(m.balance_points,0),'idempotent_replay',false);
  INSERT INTO ltb_idempotency(scope,key,request_hash,result) VALUES(scope_value,p_data->>'key',p_data->>'request_hash',result);RETURN result;
 ELSIF p_action='cashier_customer' THEN
  SELECT * INTO k FROM ltb_cards WHERE customer_public_id=p_data->>'customer_public_id' AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('linked',false,'customer_public_id',p_data->>'customer_public_id','coupons','[]'::jsonb);END IF;
  RETURN jsonb_build_object('linked',true,'customer_public_id',k.customer_public_id,'coupons',COALESCE((SELECT jsonb_agg(t.obj) FROM(
   SELECT ltb_coupon_json(qq) obj FROM ltb_coupons qq WHERE qq.member_id=k.member_id AND qq.business_id=p_data->>'business_id'
   ORDER BY claimed_at DESC LIMIT 100)t),'[]'));
 ELSIF p_action='use' THEN
  SELECT * INTO k FROM ltb_cards WHERE customer_public_id=p_data->>'customer_public_id' AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found');END IF;
  SELECT * INTO m FROM ltb_members WHERE id=k.member_id FOR UPDATE;
  PERFORM 1 FROM customers c WHERE c.public_id::text=k.customer_public_id
   AND lower(btrim(c.email))=m.email AND ltb_phone(to_jsonb(c)->>'phone')=m.phone_key FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM ltb_cards WHERE customer_public_id=k.customer_public_id
   AND member_id=m.id AND revoked_at IS NULL) THEN RETURN jsonb_build_object('error','not_found');END IF;
  scope_value:='use:'||(p_data->>'business_id');
  PERFORM pg_advisory_xact_lock(hashtextextended(scope_value||':'||(p_data->>'key'),0));
  SELECT * INTO idem FROM ltb_idempotency WHERE scope=scope_value AND key=p_data->>'key';
  IF FOUND THEN
   IF idem.request_hash<>p_data->>'request_hash' THEN RETURN jsonb_build_object('error','idempotency_conflict');END IF;
   RETURN idem.result||jsonb_build_object('idempotent_replay',true);
  END IF;
  SELECT * INTO q FROM ltb_coupons WHERE id=(p_data->>'coupon_id')::uuid AND member_id=m.id AND business_id=p_data->>'business_id' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found');END IF;
  IF q.status<>'claimed' THEN RETURN jsonb_build_object('error','already_used');END IF;
  IF q.expires_at<=now() THEN RETURN jsonb_build_object('error','coupon_expired');END IF;
  amount:=(p_data->>'bill_amount_centavos')::bigint;
  IF amount<COALESCE((q.snapshot->>'min_spend_centavos')::bigint,0) OR amount<(q.snapshot->>'discount_centavos')::bigint
   THEN RETURN jsonb_build_object('error','minimum_spend');END IF;
  UPDATE ltb_coupons SET status='used',used_at=now(),used_by=p_data->>'staff_id',branch_id=p_data->>'branch_id',
   receipt_reference=p_data->>'receipt_reference' WHERE id=q.id RETURNING * INTO q;
  PERFORM ltb_touch(m.id);result:=jsonb_build_object('coupon',ltb_coupon_json(q),'used',true,'idempotent_replay',false);
  INSERT INTO ltb_idempotency(scope,key,request_hash,result) VALUES(scope_value,p_data->>'key',p_data->>'request_hash',result);RETURN result;
 ELSIF p_action='report' THEN
  RETURN jsonb_build_object('totals',jsonb_build_object(
   'claimed',(SELECT count(*) FROM ltb_coupons WHERE business_id=p_data->>'business_id'),
   'used',(SELECT count(*) FROM ltb_coupons WHERE business_id=p_data->>'business_id' AND status='used'),
   'expired',(SELECT count(*) FROM ltb_coupons WHERE business_id=p_data->>'business_id' AND status='claimed' AND expires_at<=now())),
   'offers',COALESCE((SELECT jsonb_agg(t.obj) FROM(SELECT jsonb_build_object('id',oo.id,'title',oo.title,'claimed',oo.claimed_count,
    'used',(SELECT count(*) FROM ltb_coupons WHERE offer_id=oo.id AND status='used'),
    'expired',(SELECT count(*) FROM ltb_coupons WHERE offer_id=oo.id AND status='claimed' AND expires_at<=now()),
    'remaining_quantity',oo.total_quantity-oo.claimed_count) obj FROM ltb_offers oo WHERE oo.business_id=p_data->>'business_id' ORDER BY created_at DESC LIMIT lim OFFSET offst)t),'[]'),
   'recent',COALESCE((SELECT jsonb_agg(t.obj) FROM(SELECT ltb_coupon_json(qq)||jsonb_build_object('customer_public_id',
    (SELECT customer_public_id FROM ltb_cards WHERE member_id=qq.member_id AND business_id=qq.business_id ORDER BY linked_at LIMIT 1)) obj
    FROM ltb_coupons qq WHERE qq.business_id=p_data->>'business_id' ORDER BY claimed_at DESC LIMIT lim OFFSET offst)t),'[]'),
   'has_more',(SELECT count(*)>lim+offst FROM ltb_coupons WHERE business_id=p_data->>'business_id') OR (SELECT count(*)>lim+offst FROM ltb_offers WHERE business_id=p_data->>'business_id'));
 ELSIF p_action='earn' THEN
  IF p_data->>'currency'<>'PHP' THEN RETURN jsonb_build_object('status','skipped_currency');END IF;
  amount:=(p_data->>'amount_centavos')::bigint;
  IF amount<=0 OR amount>100000000000 THEN RETURN jsonb_build_object('error','invalid_amount');END IF;
  SELECT * INTO k FROM ltb_cards WHERE customer_public_id=p_data->>'customer_public_id' AND revoked_at IS NULL AND business_id=p_data->>'business_id';
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unlinked');END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ltb-purchase:'||(p_data->>'business_id')||':'||(p_data->>'source_type')||':'||(p_data->>'source_id'),0));
  SELECT * INTO m FROM ltb_members WHERE id=k.member_id FOR UPDATE;
  PERFORM 1 FROM customers c WHERE c.public_id::text=k.customer_public_id
   AND lower(btrim(c.email))=m.email AND ltb_phone(to_jsonb(c)->>'phone')=m.phone_key FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM ltb_cards WHERE customer_public_id=k.customer_public_id
   AND member_id=m.id AND revoked_at IS NULL) THEN RETURN jsonb_build_object('status','unlinked');END IF;
  SELECT * INTO purchase FROM ltb_purchases WHERE business_id=p_data->>'business_id' AND source_type=p_data->>'source_type' AND source_id=p_data->>'source_id';
  IF FOUND THEN
   IF purchase.member_id<>m.id OR purchase.eligible_centavos<>amount OR purchase.customer_public_id<>k.customer_public_id THEN RETURN jsonb_build_object('error','source_conflict');END IF;
   RETURN jsonb_build_object('status','replay','member_id',m.id,'balance_points',m.balance_points);
  END IF;
  INSERT INTO ltb_earning_buckets(member_id,rule_version) VALUES(m.id,s.rule_version) ON CONFLICT DO NOTHING;
  SELECT * INTO bucket FROM ltb_earning_buckets WHERE member_id=m.id AND rule_version=s.rule_version FOR UPDATE;
  SELECT COALESCE(sum(amount_centavos),0) INTO refunded FROM ltb_pending_refunds
   WHERE business_id=k.business_id AND source_type=p_data->>'source_type' AND source_id=p_data->>'source_id';
  IF refunded>amount THEN RETURN jsonb_build_object('error','refund_exceeds_purchase');END IF;
  earned:=(bucket.net_spend_centavos+amount-refunded)/(s.pesos_per_point::bigint*100);delta:=earned-bucket.earned_points;
  IF s.max_points_per_transaction IS NOT NULL AND delta>s.max_points_per_transaction THEN RETURN jsonb_build_object('status','needs_review','reason','transaction_cap');END IF;
  INSERT INTO ltb_purchases(member_id,customer_public_id,business_id,source_type,source_id,eligible_centavos,refunded_centavos,rule_version,rate_centavos)
   VALUES(m.id,k.customer_public_id,k.business_id,p_data->>'source_type',p_data->>'source_id',amount,refunded,s.rule_version,s.pesos_per_point::bigint*100) RETURNING * INTO purchase;
  INSERT INTO ltb_refunds(purchase_id,refund_id,amount_centavos)
   SELECT purchase.id,refund_id,amount_centavos FROM ltb_pending_refunds WHERE business_id=k.business_id
    AND source_type=p_data->>'source_type' AND source_id=p_data->>'source_id';
  UPDATE ltb_earning_buckets SET net_spend_centavos=net_spend_centavos+amount-refunded,earned_points=earned WHERE member_id=m.id AND rule_version=s.rule_version;
  UPDATE ltb_members SET balance_points=balance_points+delta WHERE id=m.id RETURNING * INTO m;
  INSERT INTO ltb_ledger(member_id,kind,points_delta,description,source_reference,rule_snapshot) VALUES(m.id,'earn',delta,'Confirmed purchase',purchase.id::text,
   jsonb_build_object('rule_version',s.rule_version,'rate_centavos',s.pesos_per_point::bigint*100,'amount_centavos',amount,'refunded_centavos',refunded,'business_slug',k.business_slug));
  PERFORM ltb_touch(m.id);RETURN jsonb_build_object('status','earned','member_id',m.id,'points_earned',delta,'balance_points',m.balance_points);
 ELSIF p_action='reverse' THEN
  amount:=(p_data->>'amount_centavos')::bigint;
  IF amount<=0 OR amount>100000000000 THEN RETURN jsonb_build_object('error','invalid_amount');END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ltb-purchase:'||(p_data->>'business_id')||':'||(p_data->>'source_type')||':'||(p_data->>'source_id'),0));
  SELECT * INTO purchase FROM ltb_purchases WHERE business_id=p_data->>'business_id' AND source_type=p_data->>'source_type' AND source_id=p_data->>'source_id';
  IF NOT FOUND THEN
   SELECT amount_centavos INTO pending_amount FROM ltb_pending_refunds WHERE business_id=p_data->>'business_id'
    AND source_type=p_data->>'source_type' AND source_id=p_data->>'source_id' AND refund_id=p_data->>'refund_id';
   IF FOUND THEN
    IF pending_amount<>amount THEN RETURN jsonb_build_object('error','source_conflict');END IF;
    RETURN jsonb_build_object('status','replay_pending_refund');
   END IF;
   INSERT INTO ltb_pending_refunds(business_id,source_type,source_id,refund_id,amount_centavos)
    VALUES(p_data->>'business_id',p_data->>'source_type',p_data->>'source_id',p_data->>'refund_id',amount);
   RETURN jsonb_build_object('status','pending_refund');
  END IF;
  SELECT * INTO m FROM ltb_members WHERE id=purchase.member_id FOR UPDATE;
  SELECT * INTO purchase FROM ltb_purchases WHERE id=purchase.id FOR UPDATE;
  SELECT * INTO existing_refund FROM ltb_refunds WHERE purchase_id=purchase.id AND refund_id=p_data->>'refund_id';
  IF FOUND THEN
   IF existing_refund.amount_centavos<>amount THEN RETURN jsonb_build_object('error','source_conflict');END IF;
   RETURN jsonb_build_object('status','replay','member_id',m.id,'balance_points',m.balance_points);
  END IF;
  IF amount>purchase.eligible_centavos-purchase.refunded_centavos THEN RETURN jsonb_build_object('error','refund_exceeds_purchase');END IF;
  SELECT * INTO bucket FROM ltb_earning_buckets WHERE member_id=m.id AND rule_version=purchase.rule_version FOR UPDATE;
  earned:=(bucket.net_spend_centavos-amount)/purchase.rate_centavos;delta:=earned-bucket.earned_points;
  UPDATE ltb_earning_buckets SET net_spend_centavos=net_spend_centavos-amount,earned_points=earned WHERE member_id=m.id AND rule_version=purchase.rule_version;
  UPDATE ltb_purchases SET refunded_centavos=refunded_centavos+amount WHERE id=purchase.id;
  INSERT INTO ltb_refunds(purchase_id,refund_id,amount_centavos) VALUES(purchase.id,p_data->>'refund_id',amount);
  UPDATE ltb_members SET balance_points=balance_points+delta WHERE id=m.id RETURNING * INTO m;
  INSERT INTO ltb_ledger(member_id,kind,points_delta,description,source_reference,rule_snapshot) VALUES(m.id,'refund',delta,'Purchase refund',purchase.id::text||':'||(p_data->>'refund_id'),
   jsonb_build_object('rule_version',purchase.rule_version,'rate_centavos',purchase.rate_centavos,'amount_centavos',amount));
  PERFORM ltb_touch(m.id);RETURN jsonb_build_object('status','reversed','member_id',m.id,'points_reversed',-delta,'balance_points',m.balance_points);
 ELSIF p_action='wallet_projection' THEN
  SELECT * INTO k FROM ltb_cards WHERE customer_public_id=p_data->>'customer_public_id' AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN 'null'::jsonb;END IF;
  SELECT * INTO m FROM ltb_members WHERE id=k.member_id;
  RETURN jsonb_build_object('member_public_id',m.id,'balance',m.balance_points,'version',m.version,'updated_at',m.updated_at,
   'coupons',COALESCE((SELECT jsonb_agg(t.obj) FROM(SELECT jsonb_build_object('id',id,'title',snapshot->>'title',
    'discount_centavos',(snapshot->>'discount_centavos')::bigint,'status',status,'expires_at',expires_at) obj
    FROM ltb_coupons WHERE member_id=m.id AND business_id=k.business_id AND status='claimed' AND expires_at>now() ORDER BY expires_at LIMIT 8)t),'[]'));
 ELSIF p_action='wallet_jobs_claim' THEN
  WITH selected AS(SELECT member_id FROM ltb_wallet_jobs WHERE next_attempt_at<=now() AND (status='pending' OR lease_until<=now())
   ORDER BY updated_at LIMIT LEAST(lim,10) FOR UPDATE SKIP LOCKED),claimed AS(
   UPDATE ltb_wallet_jobs j SET status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',
    attempts=attempts+1,claimed_cards=dirty_cards FROM selected x WHERE j.member_id=x.member_id RETURNING j.*)
  SELECT COALESCE(jsonb_agg((to_jsonb(c)-'dirty_cards'-'claimed_cards')||jsonb_build_object('cards',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'customer_public_id',cc.customer_public_id,'business_id',cc.business_id,'business_slug',cc.business_slug)) FROM ltb_cards cc
    WHERE cc.member_id=c.member_id AND c.claimed_cards ? cc.customer_public_id),'[]'))),'[]')
   INTO rows_json FROM claimed c;RETURN rows_json;
 ELSIF p_action='wallet_jobs_finish' THEN
  -- Finish is one row-locked transaction. Remove only the exact card tokens
  -- captured by this lease; newer changes remain dirty even for the same card.
  PERFORM 1 FROM ltb_wallet_jobs WHERE member_id=(p_data->>'member_id')::uuid
   AND lease_token=(p_data->>'lease_token')::uuid AND status='processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN '{}';END IF;
  IF (p_data->>'success')::boolean THEN
   UPDATE ltb_wallet_jobs j SET dirty_cards=COALESCE((SELECT jsonb_object_agg(d.key,d.value)
    FROM jsonb_each(j.dirty_cards) d WHERE j.claimed_cards->d.key IS DISTINCT FROM d.value),'{}'),
    claimed_cards='{}' WHERE j.member_id=(p_data->>'member_id')::uuid;
   DELETE FROM ltb_wallet_jobs WHERE member_id=(p_data->>'member_id')::uuid AND dirty_cards='{}';
   UPDATE ltb_wallet_jobs SET status='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=now()
    WHERE member_id=(p_data->>'member_id')::uuid;
  ELSE
   UPDATE ltb_wallet_jobs SET status='pending',lease_token=NULL,lease_until=NULL,claimed_cards='{}',
    next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7)))::integer)
    WHERE member_id=(p_data->>'member_id')::uuid;
  END IF;RETURN '{}';
 END IF;
 RAISE EXCEPTION 'Unknown LT Benefits command';
END $$;


CREATE OR REPLACE FUNCTION public.ltb_revoke_changed_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior_member uuid;prior_version bigint;
BEGIN
 IF lower(btrim(COALESCE(OLD.email,''))) IS NOT DISTINCT FROM lower(btrim(COALESCE(NEW.email,'')))
  AND ltb_phone(to_jsonb(OLD)->>'phone') IS NOT DISTINCT FROM ltb_phone(to_jsonb(NEW)->>'phone') THEN RETURN NEW;END IF;
 SELECT member_id INTO prior_member FROM ltb_cards WHERE customer_public_id=OLD.public_id::text AND revoked_at IS NULL;
 IF prior_member IS NOT NULL THEN
  UPDATE ltb_cards SET revoked_at=clock_timestamp() WHERE customer_public_id=OLD.public_id::text;
  prior_version:=COALESCE(OLD.lt_points_version,1)+1;
  NEW.lt_member_id:=NULL;NEW.lt_points_balance:=NULL;NEW.lt_points_version:=NULL;
  NEW.lt_points_updated_at:=NULL;NEW.lt_coupon_count:=NULL;
  INSERT INTO ltb_wallet_jobs(member_id,version,dirty_cards)
   VALUES(prior_member,prior_version,jsonb_build_object(OLD.public_id::text,gen_random_uuid()::text)) ON CONFLICT(member_id) DO UPDATE
   SET version=GREATEST(ltb_wallet_jobs.version+1,EXCLUDED.version),
    dirty_cards=ltb_wallet_jobs.dirty_cards||EXCLUDED.dirty_cards,updated_at=now(),
    next_attempt_at=CASE WHEN ltb_wallet_jobs.status='pending' THEN now() ELSE ltb_wallet_jobs.next_attempt_at END;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ltb_contact_changed ON public.customers;
CREATE TRIGGER ltb_contact_changed BEFORE UPDATE ON public.customers
 FOR EACH ROW EXECUTE FUNCTION public.ltb_revoke_changed_contact();

CREATE OR REPLACE FUNCTION public.ltb_immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LT Benefits ledger is append-only';END $$;
DROP TRIGGER IF EXISTS ltb_ledger_immutable ON public.ltb_ledger;
CREATE TRIGGER ltb_ledger_immutable BEFORE UPDATE OR DELETE ON public.ltb_ledger FOR EACH ROW EXECUTE FUNCTION public.ltb_immutable_ledger();
DO $$ DECLARE t text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['ltb_settings','ltb_members','ltb_cards','ltb_auth_challenges','ltb_sessions','ltb_offers','ltb_coupons',
  'ltb_ledger','ltb_idempotency','ltb_purchases','ltb_earning_buckets','ltb_refunds','ltb_pending_refunds','ltb_wallet_jobs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'ltb_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
COMMIT;

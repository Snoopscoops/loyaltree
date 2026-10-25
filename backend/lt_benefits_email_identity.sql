-- Apply after lt_benefits.sql and lt_benefits_upgrade.sql. Rerunnable.
-- No contact is trusted and no profile is merged by running this migration.
-- Consolidation happens ONLY inside a successful email OTP transaction.
BEGIN;
ALTER TABLE public.ltb_members ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.ltb_members(id);
CREATE INDEX IF NOT EXISTS ltb_identity_customer_email_idx ON public.customers((lower(btrim(email))),id)
 WHERE lt_benefits_card_enabled IS TRUE;
CREATE INDEX IF NOT EXISTS ltb_identity_alias_idx ON public.ltb_members(merged_into) WHERE merged_into IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.ltb_email_identities(
 email text PRIMARY KEY CHECK(email=lower(btrim(email))),
 member_id uuid NOT NULL UNIQUE REFERENCES public.ltb_members(id),verified_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.ltb_identity_transfers(
 source_member_id uuid PRIMARY KEY REFERENCES public.ltb_members(id),
 target_member_id uuid NOT NULL REFERENCES public.ltb_members(id),
 points_transferred bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ltb_ledger DROP CONSTRAINT IF EXISTS ltb_ledger_kind_check;
ALTER TABLE public.ltb_ledger ADD CONSTRAINT ltb_ledger_kind_check CHECK(kind IN('earn','refund','claim','transfer'));

CREATE OR REPLACE FUNCTION public.ltb_resolve_member(p_member uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(merged_into,id) FROM ltb_members WHERE id=p_member
$$;

CREATE OR REPLACE FUNCTION public.ltb_merge_verified_email(p_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target uuid;old ltb_members%ROWTYPE;bucket record;rate bigint;other_rate bigint;bonus bigint;card record;eligible integer;prior_touch text;
BEGIN
 IF p_email<>lower(btrim(p_email)) OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
  RAISE EXCEPTION 'identity_merge_review';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ltb-email:'||p_email,0));
 SELECT count(*) INTO eligible FROM customers WHERE lower(btrim(email))=p_email AND lt_benefits_card_enabled IS TRUE;
 IF eligible=0 OR eligible>100 THEN RAISE EXCEPTION 'identity_merge_review';END IF;
 SELECT member_id INTO target FROM ltb_email_identities WHERE email=p_email FOR UPDATE;
 IF target IS NULL THEN
  SELECT id INTO target FROM ltb_members WHERE email=p_email AND merged_into IS NULL ORDER BY created_at,id LIMIT 1;
  IF target IS NULL THEN
   INSERT INTO ltb_members(email,phone_key) VALUES(p_email,'email') RETURNING id INTO target;
  END IF;
  INSERT INTO ltb_email_identities(email,member_id) VALUES(p_email,target);
 END IF;
 -- All financial commands for this email take the same advisory lock first.
 PERFORM 1 FROM ltb_members WHERE email=p_email ORDER BY id FOR UPDATE;
 -- Freeze current contacts before moving card rows, avoiding card/customer
 -- lock inversion with the existing contact-change trigger.
 PERFORM 1 FROM customers WHERE lower(btrim(email))=p_email AND lt_benefits_card_enabled IS TRUE ORDER BY id FOR UPDATE;
 UPDATE ltb_members SET email_verified_at=now() WHERE id=target;
 FOR old IN SELECT * FROM ltb_members WHERE email=p_email AND id<>target AND merged_into IS NULL ORDER BY id LOOP
  INSERT INTO ltb_identity_transfers(source_member_id,target_member_id,points_transferred) VALUES(old.id,target,old.balance_points);
  -- Original ledger rows remain immutable, with explicit balancing transfers.
  INSERT INTO ltb_ledger(member_id,kind,points_delta,description,source_reference,rule_snapshot) VALUES
   (old.id,'transfer',-old.balance_points,'Verified email account transfer','identity:'||old.id||':out',jsonb_build_object('target_member_id',target)),
   (target,'transfer',old.balance_points,'Verified email account transfer','identity:'||old.id||':in',jsonb_build_object('source_member_id',old.id));
  UPDATE ltb_members SET balance_points=balance_points+old.balance_points WHERE id=target;
  UPDATE ltb_members SET balance_points=0,merged_into=target WHERE id=old.id;
  UPDATE ltb_purchases SET member_id=target WHERE member_id=old.id;
  UPDATE ltb_coupons SET member_id=target WHERE member_id=old.id;
  -- Revoked cards retain source ownership so an outstanding clear (including
  -- an in-flight lease) can still find its target. Active cards get a fresh
  -- canonical projection/outbox token below.
  UPDATE ltb_cards SET member_id=target WHERE member_id=old.id AND revoked_at IS NULL;
  INSERT INTO ltb_earning_buckets(member_id,rule_version,net_spend_centavos,earned_points)
   SELECT target,rule_version,net_spend_centavos,earned_points FROM ltb_earning_buckets WHERE member_id=old.id
   ON CONFLICT(member_id,rule_version) DO UPDATE SET
    net_spend_centavos=ltb_earning_buckets.net_spend_centavos+EXCLUDED.net_spend_centavos,
    earned_points=ltb_earning_buckets.earned_points+EXCLUDED.earned_points;
  DELETE FROM ltb_earning_buckets WHERE member_id=old.id;
 END LOOP;
 -- Combining two partial spends must not discard their cumulative carry.
 FOR bucket IN SELECT * FROM ltb_earning_buckets WHERE member_id=target ORDER BY rule_version FOR UPDATE LOOP
  SELECT min(rate_centavos),max(rate_centavos) INTO rate,other_rate FROM ltb_purchases
   WHERE member_id=target AND rule_version=bucket.rule_version;
  IF rate IS NULL THEN
   IF bucket.net_spend_centavos<>0 OR bucket.earned_points<>0 THEN RAISE EXCEPTION 'identity_merge_review';END IF;
   CONTINUE;
  END IF;
  IF rate<>other_rate THEN RAISE EXCEPTION 'identity_merge_review';END IF;
  bonus:=bucket.net_spend_centavos/rate-bucket.earned_points;
  IF bonus<0 THEN RAISE EXCEPTION 'identity_merge_review';END IF;
  IF bonus>0 THEN
   UPDATE ltb_earning_buckets SET earned_points=earned_points+bonus WHERE member_id=target AND rule_version=bucket.rule_version;
   UPDATE ltb_members SET balance_points=balance_points+bonus WHERE id=target;
   INSERT INTO ltb_ledger(member_id,kind,points_delta,description,source_reference,rule_snapshot)
    VALUES(target,'earn',bonus,'Combined purchase carry','identity-carry:'||gen_random_uuid(),
     jsonb_build_object('rule_version',bucket.rule_version,'rate_centavos',rate));
  END IF;
 END LOOP;
 prior_touch:=current_setting('ltb.identity_defer_touch',true);
 PERFORM set_config('ltb.identity_defer_touch','1',true);
 FOR card IN SELECT c.public_id,c.id,c.business_id,b.public_id slug,b.name,b.logo_url
  FROM customers c JOIN businesses b ON b.id=c.business_id
  WHERE lower(btrim(c.email))=p_email AND c.lt_benefits_card_enabled IS TRUE ORDER BY c.id LOOP
  IF NOT ltb_link_card(target,jsonb_build_object('customer_public_id',card.public_id::text,'customer_id',card.id::text,
   'business_id',card.business_id::text,'business_slug',card.slug,'business_name',card.name,'business_logo_url',card.logo_url)) THEN
   RAISE EXCEPTION 'identity_merge_review';END IF;
 END LOOP;
 PERFORM set_config('ltb.identity_defer_touch',COALESCE(prior_touch,''),true);
 PERFORM ltb_touch(target);
 RETURN target;
END $$;

CREATE OR REPLACE FUNCTION public.ltb_identity_command(p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE email_value text;member_uuid uuid;ch ltb_auth_challenges%ROWTYPE;m ltb_members%ROWTYPE;
 card jsonb;result jsonb;prior_setting text;matches integer;different integer;token_source text;
BEGIN
 IF p_action NOT IN('settings','settings_update','reverse','logout','wallet_jobs_claim','wallet_jobs_finish','auth_cleanup','maintenance')
  AND NOT COALESCE((SELECT enabled FROM ltb_settings WHERE id=1),false) THEN RETURN jsonb_build_object('error','unavailable');END IF;
 -- Resolve an email BEFORE taking any purchase/member locks, including refunds.
 IF p_action IN('auth_request','provision') THEN email_value:=lower(btrim(p_data->>'email'));
 ELSIF p_action='auth_verify' THEN SELECT email INTO email_value FROM ltb_auth_challenges WHERE id=(p_data->>'id')::uuid;
 ELSIF p_data ? 'member_id' THEN SELECT email INTO email_value FROM ltb_members WHERE id=(p_data->>'member_id')::uuid;
 ELSIF p_action='session' THEN SELECT mm.email INTO email_value FROM ltb_sessions ss JOIN ltb_members mm ON mm.id=ss.member_id WHERE ss.token_hash=p_data->>'token_hash';
 ELSIF p_action IN('earn','use') THEN SELECT mm.email INTO email_value FROM ltb_cards kk JOIN ltb_members mm ON mm.id=kk.member_id WHERE kk.customer_public_id=p_data->>'customer_public_id';
 ELSIF p_action='reverse' THEN SELECT mm.email INTO email_value FROM ltb_purchases pp JOIN ltb_members mm ON mm.id=pp.member_id
  WHERE pp.business_id=p_data->>'business_id' AND pp.source_type=p_data->>'source_type' AND pp.source_id=p_data->>'source_id';END IF;
 IF p_action='auth_request' THEN PERFORM pg_advisory_xact_lock(hashtextextended('ltb-client:'||(p_data->>'client_hash'),0));END IF;
 IF email_value IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('ltb-email:'||email_value,0));END IF;

 IF p_action='provision' THEN
  card:=p_data->'card_context';
  IF email_value IS NULL OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR NOT EXISTS(
   SELECT 1 FROM customers c WHERE c.public_id::text=card->>'customer_public_id' AND c.id::text=card->>'customer_id'
    AND c.business_id::text=card->>'business_id' AND lower(btrim(c.email))=email_value AND c.lt_benefits_card_enabled IS TRUE)
   THEN RETURN jsonb_build_object('status','missing_contact');END IF;
  IF EXISTS(SELECT 1 FROM ltb_cards WHERE customer_public_id=card->>'customer_public_id' AND revoked_at IS NULL) THEN
   RETURN jsonb_build_object('status','profile_ready');END IF;
  -- A stranger typing somebody else's email must never see their LT balance.
  -- An unverified new card has its own pending profile until email OTP/session.
  INSERT INTO ltb_members(email,phone_key) VALUES(email_value,'pending:'||(card->>'customer_public_id'))
   ON CONFLICT(email,phone_key) DO NOTHING;
  SELECT * INTO m FROM ltb_members WHERE email=email_value AND phone_key='pending:'||(card->>'customer_public_id');
  IF m.merged_into IS NOT NULL OR m.email_verified_at IS NOT NULL THEN
   -- A revoked card whose email changes away and back must not reopen an
   -- old verified balance or reactivate an alias. It starts pending again.
   INSERT INTO ltb_members(email,phone_key) VALUES(email_value,'pending:'||(card->>'customer_public_id')||':'||gen_random_uuid()) RETURNING * INTO m;
  END IF;
  IF NOT ltb_link_card(m.id,card) THEN RETURN jsonb_build_object('error','card_link_conflict');END IF;
  RETURN jsonb_build_object('status','profile_ready');
 ELSIF p_action='auth_request' THEN
  IF email_value IS NULL OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   OR p_data->'card_context' IS NULL THEN RETURN jsonb_build_object('accepted',false);END IF;
  -- Shared QR entry verifies an existing business registration. It is not a
  -- separate public signup. Keep HTTP acceptance generic for unknown emails.
  IF NOT EXISTS(SELECT 1 FROM customers WHERE lower(btrim(email))=email_value AND lt_benefits_card_enabled IS TRUE)
   THEN RETURN jsonb_build_object('accepted',false);END IF;
  IF EXISTS(SELECT 1 FROM ltb_auth_challenges WHERE email=email_value AND created_at>now()-interval '60 seconds')
   OR (SELECT count(*) FROM ltb_auth_challenges WHERE email=email_value AND created_at>now()-interval '1 hour')>=5
   OR (SELECT count(*) FROM ltb_auth_challenges WHERE client_hash=p_data->>'client_hash' AND created_at>now()-interval '1 hour')>=20
   THEN RETURN jsonb_build_object('accepted',false);END IF;
  INSERT INTO ltb_auth_challenges(id,email,code_hash,client_hash,card_context,expires_at)
   VALUES((p_data->>'id')::uuid,email_value,p_data->>'code_hash',p_data->>'client_hash',p_data->'card_context',now()+interval '10 minutes');
  RETURN jsonb_build_object('accepted',true);
 ELSIF p_action='auth_verify' THEN
  SELECT * INTO ch FROM ltb_auth_challenges WHERE id=(p_data->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR ch.consumed_at IS NOT NULL OR ch.expires_at<=now() OR ch.send_failed OR ch.attempts>=5 THEN
   RETURN jsonb_build_object('error','invalid_code');END IF;
  UPDATE ltb_auth_challenges SET attempts=attempts+1 WHERE id=ch.id;
  IF ch.code_hash<>p_data->>'code_hash' THEN RETURN jsonb_build_object('error','invalid_code');END IF;
  card:=ch.card_context;
  IF NOT EXISTS(SELECT 1 FROM customers WHERE lower(btrim(email))=ch.email AND lt_benefits_card_enabled IS TRUE)
   THEN RETURN jsonb_build_object('error','invalid_code');END IF;
  IF card IS NULL OR (COALESCE(card->>'kind','')<>'email' AND NOT EXISTS(SELECT 1 FROM customers c
   WHERE c.public_id::text=card->>'customer_public_id' AND c.id::text=card->>'customer_id'
   AND c.business_id::text=card->>'business_id' AND lower(btrim(c.email))=ch.email AND c.lt_benefits_card_enabled IS TRUE)) THEN
   RETURN jsonb_build_object('error','card_contact_changed');END IF;
  BEGIN member_uuid:=ltb_merge_verified_email(ch.email);
  EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('error','identity_merge_review');END;
  UPDATE ltb_auth_challenges SET consumed_at=now() WHERE id=ch.id;
  INSERT INTO ltb_sessions(token_hash,member_id,expires_at,customer_public_id)
   VALUES(p_data->>'token_hash',member_uuid,now()+interval '60 days',card->>'customer_public_id');
  RETURN jsonb_build_object('member_id',member_uuid,'email',ch.email,'linked',true,'customer_public_id',card->>'customer_public_id');
 ELSIF p_action='session' THEN
  SELECT ltb_resolve_member(member_id),customer_public_id INTO member_uuid,token_source FROM ltb_sessions
   WHERE token_hash=p_data->>'token_hash' AND revoked_at IS NULL AND expires_at>now();
  SELECT * INTO m FROM ltb_members WHERE id=member_uuid AND email_verified_at IS NOT NULL;
  IF NOT FOUND OR (token_source IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ltb_cards k JOIN customers c ON c.public_id::text=k.customer_public_id
   WHERE k.customer_public_id=token_source AND k.member_id=m.id AND k.revoked_at IS NULL AND lower(btrim(c.email))=m.email))
   THEN RETURN jsonb_build_object('error','unauthorized');END IF;
  RETURN jsonb_build_object('member_id',m.id,'email',m.email,'customer_public_id',token_source);
 ELSIF p_action='link' THEN
  member_uuid:=ltb_resolve_member((p_data->>'member_id')::uuid);
  SELECT * INTO m FROM ltb_members WHERE id=member_uuid AND email_verified_at IS NOT NULL;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.public_id::text=p_data->'card_context'->>'customer_public_id'
   AND c.id::text=p_data->'card_context'->>'customer_id' AND c.business_id::text=p_data->'card_context'->>'business_id'
   AND lower(btrim(c.email))=m.email AND c.lt_benefits_card_enabled IS TRUE)
   THEN RETURN jsonb_build_object('error','card_link_conflict');END IF;
  BEGIN member_uuid:=ltb_merge_verified_email(m.email);
  EXCEPTION WHEN raise_exception THEN RETURN jsonb_build_object('error','identity_merge_review');END;
  RETURN jsonb_build_object('linked',true);
 END IF;

 IF p_action IN('me','claim') THEN
  member_uuid:=ltb_resolve_member((p_data->>'member_id')::uuid);
  p_data:=p_data||jsonb_build_object('member_id',member_uuid);
 END IF;
 -- Do not rewrite old idempotency scopes or discard collisions during merging.
 IF p_action='claim' THEN
  SELECT count(*),count(DISTINCT ii.result->'coupon'->>'id') INTO matches,different FROM ltb_idempotency ii
   WHERE key=p_data->>'key' AND request_hash=p_data->>'request_hash' AND scope IN(
    SELECT 'claim:'||id FROM ltb_members WHERE id=member_uuid OR merged_into=member_uuid);
  IF matches>0 THEN
   IF different<>1 THEN RETURN jsonb_build_object('error','idempotency_conflict');END IF;
   SELECT ii.result INTO result FROM ltb_idempotency ii WHERE key=p_data->>'key' AND request_hash=p_data->>'request_hash'
    AND scope IN(SELECT 'claim:'||id FROM ltb_members WHERE id=member_uuid OR merged_into=member_uuid) LIMIT 1;
   SELECT * INTO m FROM ltb_members WHERE id=member_uuid;
   RETURN result||jsonb_build_object('idempotent_replay',true,'balance_points',m.balance_points,'available_points',GREATEST(m.balance_points,0));
  END IF;
  IF EXISTS(SELECT 1 FROM ltb_idempotency WHERE key=p_data->>'key' AND scope IN(
   SELECT 'claim:'||id FROM ltb_members WHERE id=member_uuid OR merged_into=member_uuid)) THEN
   RETURN jsonb_build_object('error','idempotency_conflict');END IF;
 END IF;
 prior_setting:=current_setting('ltb.identity_inner',true);
 PERFORM set_config('ltb.identity_inner','1',true);
 result:=ltb_command(p_action,p_data);
 PERFORM set_config('ltb.identity_inner',COALESCE(prior_setting,''),true);
 IF p_action='me' THEN
  result:=result||jsonb_build_object('activity',COALESCE((SELECT jsonb_agg(x.obj ORDER BY x.created_at DESC,x.id DESC) FROM(
   SELECT jsonb_build_object('id',id,'kind',kind,'points_delta',points_delta,'created_at',created_at,'description',description) obj,created_at,id
   FROM ltb_ledger WHERE kind<>'transfer' AND member_id IN(SELECT id FROM ltb_members WHERE id=member_uuid OR merged_into=member_uuid)
   ORDER BY created_at DESC,id DESC LIMIT LEAST(GREATEST(COALESCE((p_data->>'limit')::integer,25),1),100)
   OFFSET LEAST(GREATEST(COALESCE((p_data->>'offset')::integer,0),0),10000))x),'[]'),
   'has_more',(SELECT count(*)>LEAST(GREATEST(COALESCE((p_data->>'offset')::integer,0),0),10000)+LEAST(GREATEST(COALESCE((p_data->>'limit')::integer,25),1),100)
    FROM ltb_coupons WHERE member_id=member_uuid) OR
    (SELECT count(*)>LEAST(GREATEST(COALESCE((p_data->>'offset')::integer,0),0),10000)+LEAST(GREATEST(COALESCE((p_data->>'limit')::integer,25),1),100)
    FROM ltb_ledger WHERE kind<>'transfer' AND member_id IN(SELECT id FROM ltb_members WHERE id=member_uuid OR merged_into=member_uuid)));
 END IF;
 RETURN result;
END $$;

-- Surgical patches retain independently deployed coupon/offer improvements.
DO $$ DECLARE definition text;signature text;BEGIN
 FOREACH signature IN ARRAY ARRAY['public.ltb_touch(uuid)','public.ltb_link_card(uuid,jsonb)','public.ltb_command(text,jsonb)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=replace(definition,'AND lower(btrim(c.email))=m.email AND ltb_phone(to_jsonb(c)->>''phone'')=m.phone_key',
   'AND lower(btrim(c.email))=m.email AND c.lt_benefits_card_enabled IS TRUE');
  IF signature='public.ltb_link_card(uuid,jsonb)' AND strpos(definition,'ltb.identity_defer_touch')=0 THEN
   IF strpos(definition,'PERFORM ltb_touch(p_member);RETURN true;')=0 THEN RAISE EXCEPTION 'LT link migration needs review';END IF;
   definition:=replace(definition,'PERFORM ltb_touch(p_member);RETURN true;',
    'IF current_setting(''ltb.identity_defer_touch'',true) IS DISTINCT FROM ''1'' THEN PERFORM ltb_touch(p_member);END IF;RETURN true;');
  END IF;
  IF signature='public.ltb_command(text,jsonb)' AND strpos(definition,'ltb.identity_inner')=0 THEN
   IF strpos(definition,E'BEGIN\n SELECT * INTO s FROM ltb_settings WHERE id=1;')=0 THEN RAISE EXCEPTION 'LT dispatcher migration needs review';END IF;
   definition:=replace(definition,E'BEGIN\n SELECT * INTO s FROM ltb_settings WHERE id=1;',
    E'BEGIN\n IF current_setting(''ltb.identity_inner'',true) IS DISTINCT FROM ''1'' THEN RETURN ltb_identity_command(p_action,p_data);END IF;\n SELECT * INTO s FROM ltb_settings WHERE id=1;');
  END IF;
  EXECUTE definition;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ltb_revoke_changed_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior_member uuid;prior_version bigint;
BEGIN
 IF lower(btrim(COALESCE(OLD.email,''))) IS NOT DISTINCT FROM lower(btrim(COALESCE(NEW.email,''))) THEN RETURN NEW;END IF;
 SELECT member_id INTO prior_member FROM ltb_cards WHERE customer_public_id=OLD.public_id::text AND revoked_at IS NULL;
 IF prior_member IS NOT NULL THEN
  UPDATE ltb_cards SET revoked_at=clock_timestamp() WHERE customer_public_id=OLD.public_id::text;
  UPDATE ltb_sessions SET revoked_at=clock_timestamp() WHERE customer_public_id=OLD.public_id::text AND revoked_at IS NULL;
  prior_version:=COALESCE(OLD.lt_points_version,1)+1;
  NEW.lt_member_id:=NULL;NEW.lt_points_balance:=NULL;NEW.lt_points_version:=NULL;NEW.lt_points_updated_at:=NULL;NEW.lt_coupon_count:=NULL;
  INSERT INTO ltb_wallet_jobs(member_id,version,dirty_cards) VALUES(prior_member,prior_version,jsonb_build_object(OLD.public_id::text,gen_random_uuid()::text))
   ON CONFLICT(member_id) DO UPDATE SET version=GREATEST(ltb_wallet_jobs.version+1,EXCLUDED.version),dirty_cards=ltb_wallet_jobs.dirty_cards||EXCLUDED.dirty_cards,updated_at=now();
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['ltb_email_identities','ltb_identity_transfers'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN('ltb_resolve_member','ltb_merge_verified_email','ltb_identity_command') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
COMMIT;

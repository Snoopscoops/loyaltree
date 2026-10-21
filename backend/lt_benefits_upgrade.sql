-- Apply AFTER lt_benefits.sql. This migration never enables existing cards.
BEGIN;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS lt_benefits_card_enabled boolean;
ALTER TABLE public.customers ALTER COLUMN lt_benefits_card_enabled SET DEFAULT true;
CREATE INDEX IF NOT EXISTS ltb_upgrade_customer_business_idx ON public.customers((business_id::text),id);

CREATE TABLE IF NOT EXISTS public.ltb_card_upgrades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id text NOT NULL,business_slug text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','processing','completed','failed')),
 through_id bigint NOT NULL DEFAULT 0,cursor_id bigint NOT NULL DEFAULT 0,total bigint NOT NULL DEFAULT 0,
 scanned bigint NOT NULL DEFAULT 0,queued bigint NOT NULL DEFAULT 0,failed integer NOT NULL DEFAULT 0,skipped bigint NOT NULL DEFAULT 0,
 pending jsonb NOT NULL DEFAULT '[]',attempts integer NOT NULL DEFAULT 0,error_type text,
 lease uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_wallet_job_id text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ltb_card_upgrades ADD COLUMN IF NOT EXISTS skipped bigint NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS ltb_card_upgrades_active_idx ON public.ltb_card_upgrades(business_id)
 WHERE status IN('queued','processing');
CREATE INDEX IF NOT EXISTS ltb_card_upgrades_business_idx ON public.ltb_card_upgrades(business_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.ltb_card_upgrade_json(j public.ltb_card_upgrades) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('id',j.id,'status',j.status,'total',j.total,'scanned',j.scanned,'queued',j.queued,
  'failed',j.failed,'skipped',j.skipped,'remaining',CASE WHEN j.status='completed' THEN 0 ELSE GREATEST(j.total-j.scanned,0) END,'error_type',j.error_type)
$$;

CREATE OR REPLACE FUNCTION public.ltb_card_upgrade_command(p_action text,p_data jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j ltb_card_upgrades%ROWTYPE;business_value text:=p_data->>'business_id';
 total_value bigint;enabled_value bigint;eligible_value bigint;through_value bigint;batch jsonb;first_card jsonb;
 lease_value uuid;limit_value integer;skipped_value bigint;skipped_through bigint;
BEGIN
 IF p_action IN('status','start') THEN
  IF business_value IS NULL OR business_value='' THEN RETURN jsonb_build_object('error','invalid_business');END IF;
  IF p_action='start' THEN
   -- Serialize repeat clicks without locking unrelated businesses.
   PERFORM pg_advisory_xact_lock(hashtextextended('ltb-card-upgrade:'||business_value,0));
   SELECT * INTO j FROM ltb_card_upgrades WHERE business_id=business_value AND status IN('queued','processing')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
   IF FOUND THEN
    UPDATE ltb_card_upgrades SET business_slug=p_data->>'business_slug',updated_at=now() WHERE id=j.id;
   ELSE
    -- Retry a failed snapshot, retaining its pending batch and checkpoint.
    SELECT * INTO j FROM ltb_card_upgrades WHERE business_id=business_value AND status='failed'
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
     UPDATE ltb_card_upgrades SET business_slug=p_data->>'business_slug',status='queued',attempts=0,failed=0,error_type=NULL,lease=NULL,
      lease_until=NULL,next_attempt_at=now(),updated_at=now() WHERE id=j.id RETURNING * INTO j;
    ELSE
     SELECT count(*),COALESCE(max(id),0) INTO eligible_value,through_value FROM customers
      WHERE business_id::text=business_value AND public_id IS NOT NULL AND lt_benefits_card_enabled IS NOT TRUE;
     IF eligible_value>0 THEN
      INSERT INTO ltb_card_upgrades(business_id,business_slug,total,through_id)
       VALUES(business_value,p_data->>'business_slug',eligible_value,through_value) RETURNING * INTO j;
     END IF;
    END IF;
   END IF;
  END IF;
  SELECT count(*),count(*) FILTER(WHERE lt_benefits_card_enabled IS TRUE),
   count(*) FILTER(WHERE lt_benefits_card_enabled IS NOT TRUE)
   INTO total_value,enabled_value,eligible_value FROM customers WHERE business_id::text=business_value AND public_id IS NOT NULL;
  SELECT * INTO j FROM ltb_card_upgrades WHERE business_id=business_value ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('total_cards',total_value,'enabled_cards',enabled_value,'eligible_cards',eligible_value,
   'rollout',CASE WHEN j.id IS NULL THEN NULL ELSE ltb_card_upgrade_json(j) END);
 ELSIF p_action='claim' THEN
  lease_value:=(p_data->>'lease')::uuid;limit_value:=LEAST(5,GREATEST(1,COALESCE((p_data->>'limit')::integer,5)));
  SELECT * INTO j FROM ltb_card_upgrades
   WHERE (status='queued' AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now())
   ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('job',NULL,'cards','[]'::jsonb);END IF;
  batch:=j.pending;
  IF jsonb_array_length(batch)>0 THEN
   -- Rows can be removed/reassigned after a crash. Reconcile the persisted batch
   -- under the job lock, preserving only the original card and original business.
   -- A replacement card with the same numeric id must never receive this upgrade.
   SELECT COALESCE(jsonb_agg(b.card ORDER BY b.ordinality) FILTER(WHERE c.id IS NOT NULL),'[]'),
    count(*) FILTER(WHERE c.id IS NULL),COALESCE(max((b.card->>'id')::bigint) FILTER(WHERE c.id IS NULL),0)
    INTO batch,skipped_value,skipped_through
    FROM jsonb_array_elements(j.pending) WITH ORDINALITY b(card,ordinality)
    LEFT JOIN customers c ON c.id=(b.card->>'id')::bigint AND c.business_id::text=j.business_id
     AND c.public_id::text=b.card->>'public_id';
   IF skipped_value>0 THEN
    UPDATE ltb_card_upgrades SET pending=batch,cursor_id=GREATEST(cursor_id,skipped_through),
     scanned=LEAST(total,scanned+skipped_value),skipped=skipped+skipped_value,updated_at=now()
     WHERE id=j.id RETURNING * INTO j;
   END IF;
  END IF;
  IF jsonb_array_length(batch)=0 THEN
   SELECT COALESCE(jsonb_agg(card ORDER BY card_id),'[]') INTO batch FROM(
    SELECT c.id card_id,jsonb_build_object('id',c.id,'public_id',c.public_id,'business_id',c.business_id,
     'program_id',to_jsonb(c)->'program_id','lt_benefits_card_enabled',true) card FROM customers c
    WHERE c.business_id::text=j.business_id AND c.id>j.cursor_id AND c.id<=j.through_id
     AND c.public_id IS NOT NULL AND c.lt_benefits_card_enabled IS NOT TRUE ORDER BY c.id LIMIT limit_value
   ) cards;
  END IF;
  IF jsonb_array_length(batch)=0 THEN
   UPDATE ltb_card_upgrades SET status='completed',skipped=skipped+GREATEST(total-scanned,0),scanned=total,failed=0,error_type=NULL,
    lease=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
   RETURN jsonb_build_object('job',NULL,'cards','[]'::jsonb);
  END IF;
  -- The pending snapshot survives a crash after enabling, before/after enqueue.
  UPDATE customers c SET lt_benefits_card_enabled=true WHERE c.business_id::text=j.business_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(batch) b WHERE b->>'id'=c.id::text AND b->>'public_id'=c.public_id::text);
  UPDATE ltb_card_upgrades SET status='processing',pending=batch,lease=lease_value,
   lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('job',jsonb_build_object('id',j.id,'business_id',j.business_id,'business_slug',j.business_slug),
   'cards',batch);
 ELSIF p_action IN('ack','fail','release') THEN
  SELECT * INTO j FROM ltb_card_upgrades WHERE id=(p_data->>'job_id')::uuid AND status='processing'
   AND lease=(p_data->>'lease')::uuid AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','lease_lost');END IF;
  IF p_action='ack' THEN
   first_card:=j.pending->0;
   IF first_card IS NULL OR first_card->>'id' IS DISTINCT FROM p_data->>'customer_id' THEN
    RETURN jsonb_build_object('error','card_out_of_order');
   END IF;
   UPDATE ltb_card_upgrades SET pending=pending-0,cursor_id=GREATEST(cursor_id,(first_card->>'id')::bigint),
    scanned=LEAST(total,scanned+1),queued=queued+1,failed=0,attempts=0,error_type=NULL,
    last_wallet_job_id=left(p_data->>'wallet_job_id',100),updated_at=now(),
    status=CASE WHEN jsonb_array_length(pending)=1 THEN 'queued' ELSE 'processing' END,
    lease=CASE WHEN jsonb_array_length(pending)=1 THEN NULL ELSE lease END,
    lease_until=CASE WHEN jsonb_array_length(pending)=1 THEN NULL ELSE lease_until END,
    next_attempt_at=now() WHERE id=j.id;
  ELSIF p_action='release' THEN
   UPDATE ltb_card_upgrades SET status='queued',lease=NULL,lease_until=NULL,next_attempt_at=now(),updated_at=now() WHERE id=j.id;
  ELSE
   UPDATE ltb_card_upgrades SET attempts=attempts+1,failed=1,
    status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'queued' END,
    error_type=CASE WHEN (p_data->>'error_type') ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' THEN p_data->>'error_type' ELSE 'QueueError' END,
    lease=NULL,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>LEAST(300,5*power(2,attempts)::integer)),
    updated_at=now() WHERE id=j.id;
  END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 RETURN jsonb_build_object('error','unknown_action');
END $$;

ALTER TABLE public.ltb_card_upgrades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ltb_card_upgrades FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ltb_card_upgrades TO service_role;
REVOKE ALL ON FUNCTION public.ltb_card_upgrade_json(public.ltb_card_upgrades) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ltb_card_upgrade_command(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ltb_card_upgrade_json(public.ltb_card_upgrades) TO service_role;
GRANT EXECUTE ON FUNCTION public.ltb_card_upgrade_command(text,jsonb) TO service_role;
COMMIT;

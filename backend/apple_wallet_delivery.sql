-- Apply in Supabase before deploying the APNs outbox/lease worker.
-- Installs recovery mechanisms; it does not send pushes or change points.
BEGIN;
CREATE TABLE IF NOT EXISTS public.apple_push_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id text NOT NULL,business_slug text,pass_type_identifier text NOT NULL,
 push_token text NOT NULL,reason text NOT NULL DEFAULT 'wallet_update',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','completed','failed')),
 revision bigint NOT NULL DEFAULT 1,attempts integer NOT NULL DEFAULT 0,
 lease uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_outcome text,last_status integer,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,pass_type_identifier,push_token)
);
CREATE INDEX IF NOT EXISTS apple_push_deliveries_pending_idx ON public.apple_push_deliveries(next_attempt_at,id)
 WHERE status IN('pending','processing');
ALTER TABLE public.apple_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apple_push_deliveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.apple_push_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.apple_push_delivery_command(p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j apple_push_deliveries%ROWTYPE;v_token text;v_outcome jsonb;v_jobs jsonb:='[]';
 v_scope text:=p_data->>'business_id';v_type text:=p_data->>'pass_type_identifier';
 v_limit integer;v_terminal integer:=0;v_exhausted integer:=0;v_expired integer:=0;v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_action='enqueue' THEN
  IF coalesce(length(v_scope),0) NOT BETWEEN 1 AND 300 OR coalesce(length(v_type),0) NOT BETWEEN 1 AND 300
   OR jsonb_typeof(p_data->'tokens') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'tokens')>100 THEN
   RAISE EXCEPTION 'Invalid bounded Apple push audience';END IF;
  FOR v_token IN SELECT DISTINCT jsonb_array_elements_text(p_data->'tokens') LOOP
   IF length(v_token) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'Invalid push target';END IF;
   INSERT INTO apple_push_deliveries(business_id,business_slug,pass_type_identifier,push_token,reason)
    VALUES(v_scope,p_data->>'business_slug',v_type,v_token,coalesce(p_data->>'reason','wallet_update'))
   ON CONFLICT(business_id,pass_type_identifier,push_token) DO UPDATE SET
    revision=apple_push_deliveries.revision+1,business_slug=EXCLUDED.business_slug,reason=EXCLUDED.reason,
    status=CASE WHEN apple_push_deliveries.status='processing' THEN 'processing' ELSE 'pending' END,
    attempts=CASE WHEN apple_push_deliveries.status='processing' THEN apple_push_deliveries.attempts ELSE 0 END,
    next_attempt_at=v_now,updated_at=v_now
   RETURNING * INTO j;
   v_jobs:=v_jobs||jsonb_build_array(jsonb_build_object('id',j.id));
  END LOOP;
  RETURN jsonb_build_object('jobs',v_jobs);
 ELSIF p_action='claim' THEN
  v_limit:=LEAST(20,GREATEST(1,coalesce((p_data->>'limit')::integer,20)));
  -- A crash during the final attempt becomes an explicit terminal failure.
  UPDATE apple_push_deliveries SET status='failed',lease=NULL,lease_until=NULL,
   last_outcome='lease_expired',updated_at=v_now
   WHERE status='processing' AND lease_until<=v_now AND attempts>=8;
  GET DIAGNOSTICS v_expired=ROW_COUNT;
  WITH candidates AS (
   SELECT id FROM apple_push_deliveries WHERE attempts<8 AND next_attempt_at<=v_now
    AND (status='pending' OR (status='processing' AND lease_until<=v_now))
    AND (p_data->'ids' IS NULL OR id IN(SELECT value::bigint FROM jsonb_array_elements_text(p_data->'ids')))
    ORDER BY next_attempt_at,id LIMIT v_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
   UPDATE apple_push_deliveries d SET status='processing',lease=gen_random_uuid(),
    lease_until=v_now+interval '15 minutes',attempts=attempts+1,updated_at=v_now
   FROM candidates c WHERE d.id=c.id RETURNING d.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO v_jobs FROM claimed;
  RETURN jsonb_build_object('jobs',v_jobs,'expired_failed',v_expired);
 ELSIF p_action='finish' THEN
  IF jsonb_typeof(p_data->'outcomes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'outcomes')>20 THEN
   RAISE EXCEPTION 'Invalid bounded push outcomes';END IF;
  FOR v_outcome IN SELECT value FROM jsonb_array_elements(p_data->'outcomes') LOOP
   SELECT * INTO j FROM apple_push_deliveries WHERE id=(v_outcome->>'id')::bigint
    AND status='processing' AND lease=(v_outcome->>'lease')::uuid FOR UPDATE;
   IF NOT FOUND THEN CONTINUE;END IF;
   IF j.revision<>(v_outcome->>'revision')::bigint THEN
    -- A newer stamp/edit arrived while this lease was sending: retain it.
    UPDATE apple_push_deliveries SET status='pending',attempts=0,lease=NULL,lease_until=NULL,
     next_attempt_at=v_now,updated_at=v_now WHERE id=j.id;
   ELSIF v_outcome->>'outcome' IN('accepted','rejected') THEN
    UPDATE apple_push_deliveries SET status=CASE WHEN v_outcome->>'outcome'='accepted' THEN 'completed' ELSE 'failed' END,
     lease=NULL,lease_until=NULL,last_outcome=v_outcome->>'outcome',last_status=(v_outcome->>'status')::integer,
     updated_at=v_now WHERE id=j.id;
    v_terminal:=v_terminal+1;
   ELSIF v_outcome->>'outcome' IN('retry','deferred') THEN
    UPDATE apple_push_deliveries SET status=CASE WHEN j.attempts>=8 AND v_outcome->>'outcome'='retry' THEN 'failed' ELSE 'pending' END,
     attempts=CASE WHEN v_outcome->>'outcome'='deferred' THEN greatest(0,j.attempts-1) ELSE j.attempts END,
     lease=NULL,lease_until=NULL,last_outcome=v_outcome->>'outcome',last_status=(v_outcome->>'status')::integer,
     next_attempt_at=v_now+make_interval(secs=>CASE WHEN v_outcome->>'outcome'='deferred' THEN 15 ELSE least(900,5*power(2,least(j.attempts,8))::integer) END),
     updated_at=v_now WHERE id=j.id;
    IF j.attempts>=8 AND v_outcome->>'outcome'='retry' THEN
     v_terminal:=v_terminal+1;v_exhausted:=v_exhausted+1;
    END IF;
   ELSE RAISE EXCEPTION 'Invalid push outcome';END IF;
  END LOOP;
  RETURN jsonb_build_object('terminal',v_terminal,'exhausted',v_exhausted);
 END IF;
 RAISE EXCEPTION 'Unknown push command';
END $$;
REVOKE ALL ON FUNCTION public.apple_push_delivery_command(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apple_push_delivery_command(text,jsonb) TO service_role;

-- Existing wallet jobs gain a recovery lease without rewriting IDs or payloads.
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5;
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.wallet_sync_jobs ADD COLUMN IF NOT EXISTS last_error text;

CREATE OR REPLACE FUNCTION public.wallet_sync_queue_command(p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j wallet_sync_jobs%ROWTYPE;v_jobs jsonb:='[]';v_now timestamptz:=clock_timestamp();v_limit integer;v_expired integer:=0;
BEGIN
 IF p_action='claim' THEN
  v_limit:=LEAST(20,GREATEST(1,coalesce((p_data->>'limit')::integer,10)));
  UPDATE wallet_sync_jobs SET status='failed',last_error='Worker lease expired after final attempt',
   lease_token=NULL,lease_until=NULL,updated_at=v_now
   WHERE status='processing' AND coalesce(lease_until,coalesce(started_at,updated_at,created_at,'epoch'::timestamptz)+interval '15 minutes')<=v_now
    AND attempts>=coalesce(max_attempts,5);
  GET DIAGNOSTICS v_expired=ROW_COUNT;
  WITH candidates AS (
   SELECT id,(status='processing') recovered_from_lease FROM wallet_sync_jobs WHERE coalesce(attempts,0)<coalesce(max_attempts,5)
    AND ((status IN('pending','failed') AND next_attempt_at<=v_now)
     OR (status='processing' AND coalesce(lease_until,coalesce(started_at,updated_at,created_at,'epoch'::timestamptz)+interval '15 minutes')<=v_now))
    ORDER BY created_at,id LIMIT v_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
   UPDATE wallet_sync_jobs w SET status='processing',lease_token=gen_random_uuid(),
    lease_until=v_now+interval '15 minutes',started_at=v_now,
    attempts=coalesce(attempts,0)+1,updated_at=v_now
   FROM candidates c WHERE w.id=c.id RETURNING w.*,c.recovered_from_lease
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]') INTO v_jobs FROM claimed;
  RETURN jsonb_build_object('jobs',v_jobs,'expired_failed',v_expired);
 ELSIF p_action='finish' THEN
  SELECT * INTO j FROM wallet_sync_jobs WHERE id::text=p_data->>'id' AND status='processing'
   AND lease_token=(p_data->>'lease_token')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',false);END IF;
  IF p_data->>'outcome'='completed' THEN
   UPDATE wallet_sync_jobs SET status='completed',completed_at=v_now,last_error=NULL,
    lease_token=NULL,lease_until=NULL,updated_at=v_now WHERE id=j.id;
  ELSIF p_data->>'outcome' IN('retry','deferred') THEN
   UPDATE wallet_sync_jobs SET status=CASE WHEN j.attempts>=coalesce(j.max_attempts,5) AND p_data->>'outcome'='retry' THEN 'failed' ELSE 'pending' END,
    attempts=CASE WHEN p_data->>'outcome'='deferred' THEN greatest(0,j.attempts-1) ELSE j.attempts END,
    next_attempt_at=v_now+make_interval(secs=>CASE WHEN p_data->>'outcome'='deferred' THEN 15 ELSE least(300,5*power(2,least(j.attempts,8))::integer) END),
    last_error=p_data->>'error_type',lease_token=NULL,lease_until=NULL,updated_at=v_now WHERE id=j.id;
  ELSE RAISE EXCEPTION 'Invalid wallet outcome';END IF;
  RETURN jsonb_build_object('accepted',true);
 END IF;
 RAISE EXCEPTION 'Unknown wallet command';
END $$;
REVOKE ALL ON FUNCTION public.wallet_sync_queue_command(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_sync_queue_command(text,jsonb) TO service_role;
COMMIT;

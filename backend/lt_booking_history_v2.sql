-- Apply after native bookings V1 and short references. Existing guest bookings stay unlinked.
BEGIN;
ALTER TABLE public.lt_bookings ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lt_bookings_member_history_idx ON public.lt_bookings(business_id,customer_id,starts_at DESC,id) WHERE customer_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.lt_booking_request_linked(
  p_business bigint,p_branch bigint,p_resource uuid,p_start timestamptz,p_guests integer,
  p_name text,p_phone text,p_note text,p_request uuid,p_customer bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; existing public.lt_bookings%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_business::text||':'||p_request::text,0));
  IF p_customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND business_id=p_business) THEN
    RAISE EXCEPTION USING errcode='P0001',message='not_found';
  END IF;
  SELECT * INTO existing FROM public.lt_bookings WHERE business_id=p_business AND request_id=p_request;
  IF FOUND AND existing.customer_id IS DISTINCT FROM p_customer THEN
    RAISE EXCEPTION USING errcode='P0001',message='request_conflict';
  END IF;
  result := public.lt_booking_request(p_business,p_branch,p_resource,p_start,p_guests,p_name,p_phone,p_note,p_request);
  UPDATE public.lt_bookings SET customer_id=p_customer WHERE id=(result->>'reference')::uuid AND business_id=p_business;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.lt_booking_request_linked(bigint,bigint,uuid,timestamptz,integer,text,text,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lt_booking_request_linked(bigint,bigint,uuid,timestamptz,integer,text,text,text,uuid,bigint) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

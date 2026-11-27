-- Review and test in disposable PostgreSQL before production application.
BEGIN;
CREATE OR REPLACE FUNCTION public.menu_settle_counter_bill(
  p_business_id bigint,p_branch text,p_root text,p_actor text,p_expected jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_root public.menu_counter_orders%ROWTYPE;
  v_row public.menu_counter_orders%ROWTYPE;
  v_pending jsonb;
  v_total numeric;
  v_count integer;
BEGIN
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
     OR length(coalesce(btrim(p_actor),'')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid settlement request' USING ERRCODE='22023';
  END IF;
  v_root := public.menu_lock_counter_order(p_business_id,p_branch,p_root);
  IF v_root.parent_order_public_id IS NOT NULL OR v_root.status IN ('cancelled','completed')
     OR v_root.payment_method IS DISTINCT FROM 'cash' THEN
    RAISE EXCEPTION 'Select an active cash bill' USING ERRCODE='23514';
  END IF;
  -- All existing child mutations take this same root lock first.
  PERFORM 1 FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
      AND (public_id=p_root OR parent_order_public_id=p_root)
    ORDER BY public_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
      AND (public_id=p_root OR parent_order_public_id=p_root) AND status<>'cancelled'
      AND (payment_method IS DISTINCT FROM 'cash'
        OR coalesce(payment_status,'') NOT IN ('paid','unpaid')
        OR (payment_status='unpaid' AND (status IS DISTINCT FROM 'new' OR total IS NULL OR total<0)))) THEN
    RAISE EXCEPTION 'Bill contains an unsupported payment or order status' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_object_agg(public_id,total),'{}'::jsonb),coalesce(sum(total),0),count(*)
    INTO v_pending,v_total,v_count FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
      AND (public_id=p_root OR parent_order_public_id=p_root)
      AND status<>'cancelled' AND payment_status='unpaid';
  IF v_pending IS DISTINCT FROM p_expected OR v_count=0 THEN
    RAISE EXCEPTION 'Bill changed or already settled. Refresh before confirming.' USING ERRCODE='23514';
  END IF;
  FOR v_row IN SELECT * FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
      AND (public_id=p_root OR parent_order_public_id=p_root)
      AND status<>'cancelled' AND payment_status='unpaid' ORDER BY public_id
  LOOP
    PERFORM public.menu_transition_counter_order(p_business_id,p_branch,v_row.public_id,
      'paid',p_actor,NULL,v_row.total);
  END LOOP;
  SELECT * INTO STRICT v_root FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch AND public_id=p_root;
  RETURN jsonb_build_object('order',to_jsonb(v_root),'settled_count',v_count,'settled_total',v_total);
END $$;
REVOKE ALL ON FUNCTION public.menu_settle_counter_bill(bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.menu_settle_counter_bill(bigint,text,text,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

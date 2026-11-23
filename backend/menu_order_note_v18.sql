-- v18 OPTIONAL customer note. Apply BEFORE deploying the v18 order-note backend.
-- Existing rows remain valid; no change to payment or loyalty rules.
BEGIN;
ALTER TABLE public.menu_counter_orders ADD COLUMN IF NOT EXISTS customer_note text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION public.menu_place_cash_reward_order(
  p_business_id integer, p_customer_id integer, p_order jsonb,
  p_kind text, p_reward_id text, p_reward_name text,
  p_points_cost integer, p_card_cycle integer, p_required_stamps integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_order public.menu_counter_orders%ROWTYPE;
  v_existing public.menu_counter_orders%ROWTYPE;
  v_held integer := 0;
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION 'Invalid order payload';
  END IF;
  IF p_kind NOT IN ('points_prize','stamp_reward') OR
     length(coalesce(p_reward_id,'')) NOT BETWEEN 1 AND 100 OR
     length(coalesce(p_reward_name,'')) NOT BETWEEN 1 AND 120 OR
     (p_order->>'payment_method') IS DISTINCT FROM 'cash' OR
     (p_order->>'payment_status') IS DISTINCT FROM 'unpaid' OR
     (p_order->>'business_id')::integer IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'Only verified cash orders can redeem at checkout';
  END IF;
  IF length(coalesce(p_order->>'order_number','')) NOT BETWEEN 1 AND 40 OR
     length(coalesce(p_order->>'public_id','')) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Order reference is invalid';
  END IF;
  -- Serializes browser retries of the same order number before checking the customer.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'loyaltree-menu-reward:' || p_business_id::text || ':' || (p_order->>'order_number'), 0));
  SELECT * INTO v_existing FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND order_number=(p_order->>'order_number')
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.member_customer_public_id=(p_order->>'member_customer_public_id') AND
       v_existing.checkout_reward_kind=p_kind AND
       v_existing.checkout_reward_id=p_reward_id AND
       v_existing.items=p_order->'items' AND
       v_existing.total=(p_order->>'total')::numeric AND
       v_existing.payment_reference IS NOT DISTINCT FROM (p_order->>'payment_reference') THEN
      RETURN to_jsonb(v_existing);
    END IF;
    RAISE EXCEPTION 'Order number was already used for a different request';
  END IF;
  -- Lock the customer to serialize concurrent redemption requests and points sales.
  SELECT * INTO v_customer FROM public.customers
    WHERE id=p_customer_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND OR v_customer.public_id IS DISTINCT FROM (p_order->>'member_customer_public_id') THEN
    RAISE EXCEPTION 'Connected loyalty card does not belong to this business';
  END IF;
  -- Expired reservations are released under the same customer lock so stamps
  -- can be selected again and old pending rows do not lock members forever.
  UPDATE public.menu_order_redemptions SET status='released',updated_at=now()
    WHERE business_id=p_business_id AND customer_id=p_customer_id
    AND status='pending' AND expires_at<=now();
  IF p_kind='points_prize' THEN
    IF coalesce(p_points_cost,0)<=0 OR coalesce(p_required_stamps,0)<>0 THEN
      RAISE EXCEPTION 'Invalid prize cost';
    END IF;
    SELECT coalesce(sum(points_cost),0)::integer INTO v_held
      FROM public.menu_order_redemptions
      WHERE business_id=p_business_id AND customer_id=p_customer_id
      AND kind='points_prize' AND status='pending' AND expires_at>now();
    IF coalesce(v_customer.points_balance,0) < p_points_cost+v_held THEN
      RAISE EXCEPTION 'Not enough unreserved points for this reward';
    END IF;
  ELSE
    IF coalesce(p_points_cost,0)<>0 OR coalesce(p_required_stamps,0)<=0 OR
       coalesce(p_card_cycle,0)<1 OR
       coalesce(v_customer.stamp_count,0)<p_required_stamps OR
       coalesce(v_customer.card_cycle,1)<>p_card_cycle THEN
      RAISE EXCEPTION 'Stamp milestone is not available for this card';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stamp_reward_claims
      WHERE customer_id=p_customer_id AND card_cycle=p_card_cycle AND milestone_id=p_reward_id) OR
       EXISTS (SELECT 1 FROM public.menu_order_redemptions
      WHERE customer_id=p_customer_id AND kind='stamp_reward' AND card_cycle=p_card_cycle
        AND reward_id=p_reward_id AND status='pending' AND expires_at>now()) THEN
      RAISE EXCEPTION 'Stamp reward has already been claimed or selected for another order';
    END IF;
  END IF;
  INSERT INTO public.menu_counter_orders
    (public_id,business_id,order_number,payment_reference,buyer_name,
     service,table_no,customer_note,pickup_label,status,payment_status,payment_method,total,
     items,created_at,branch_public_id,branch_name,member_customer_public_id,
     checkout_reward_kind,checkout_reward_id,checkout_reward_name)
  VALUES
    (p_order->>'public_id',p_business_id,p_order->>'order_number',p_order->>'payment_reference',
     p_order->>'buyer_name',p_order->>'service',p_order->>'table_no',left(coalesce(p_order->>'customer_note',''),500),p_order->>'pickup_label',
     'new','unpaid','cash',(p_order->>'total')::numeric,
     p_order->'items',coalesce((p_order->>'created_at')::timestamptz,now()),
     p_order->>'branch_public_id',p_order->>'branch_name',p_order->>'member_customer_public_id',
     p_kind,p_reward_id,p_reward_name)
  RETURNING * INTO v_order;
  INSERT INTO public.menu_order_redemptions
    (order_public_id,business_id,customer_id,customer_public_id,
     kind,reward_id,reward_name,points_cost,card_cycle,required_stamps)
  VALUES
    (v_order.public_id,p_business_id,p_customer_id,v_customer.public_id,
     p_kind,p_reward_id,p_reward_name,p_points_cost,p_card_cycle,p_required_stamps);
  RETURN to_jsonb(v_order);
END $$;
COMMIT;

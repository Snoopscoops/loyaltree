-- LoyaltyTree owner-v12: order-linked points-prize/stamp-milestone redemption.
-- Run in Supabase SQL Editor BEFORE deploying owner-v12 code.
-- Cash payment only until a real, verified online payment gateway is enabled.
-- This does not change order prices or create monetary discounts.
BEGIN;
ALTER TABLE public.menu_counter_orders
  ADD COLUMN IF NOT EXISTS checkout_reward_kind text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS checkout_reward_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS checkout_reward_name text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.menu_order_redemptions (
  order_public_id text PRIMARY KEY,
  business_id integer NOT NULL,
  customer_id integer NOT NULL,
  customer_public_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('points_prize', 'stamp_reward')),
  reward_id text NOT NULL,
  reward_name text NOT NULL,
  points_cost integer NOT NULL DEFAULT 0 CHECK (points_cost >= 0),
  card_cycle integer NOT NULL DEFAULT 1 CHECK (card_cycle >= 1),
  required_stamps integer NOT NULL DEFAULT 0 CHECK (required_stamps >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','redeemed','released')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS menu_order_redemptions_member_idx
  ON public.menu_order_redemptions (business_id,customer_id,status,expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS menu_order_redemptions_pending_stamp_idx
  ON public.menu_order_redemptions (customer_id,card_cycle,reward_id)
  WHERE kind='stamp_reward' AND status='pending';
ALTER TABLE public.menu_order_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_order_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.menu_order_redemptions TO service_role;

-- Both the order and its pending redemption must commit together.
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
     service,table_no,pickup_label,status,payment_status,payment_method,total,
     items,created_at,branch_public_id,branch_name,member_customer_public_id,
     checkout_reward_kind,checkout_reward_id,checkout_reward_name)
  VALUES
    (p_order->>'public_id',p_business_id,p_order->>'order_number',p_order->>'payment_reference',
     p_order->>'buyer_name',p_order->>'service',p_order->>'table_no',p_order->>'pickup_label',
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

-- Called only AFTER the regular protected owner/staff status authorization.
-- Completion and points/stamp claim happen in ONE DB transaction.
CREATE OR REPLACE FUNCTION public.menu_finalize_cash_reward_order(
  p_business_id integer,p_order_public_id text,p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order public.menu_counter_orders%ROWTYPE;
  v_reward public.menu_order_redemptions%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_held integer := 0;
  v_pos_held integer := 0;
BEGIN
  IF p_target NOT IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid reward-order status';
  END IF;
  SELECT * INTO v_order FROM public.menu_counter_orders
    WHERE business_id=p_business_id AND public_id=p_order_public_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  SELECT * INTO v_reward FROM public.menu_order_redemptions
    WHERE order_public_id=p_order_public_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order has no checkout redemption'; END IF;
  IF v_order.status=p_target AND
    ((p_target='completed' AND v_reward.status='redeemed') OR
     (p_target='cancelled' AND v_reward.status='released')) THEN
    RETURN to_jsonb(v_order); -- safe retry, no second charge
  END IF;
  IF v_order.status IN ('completed','cancelled') OR v_reward.status<>'pending' THEN
    RAISE EXCEPTION 'This order or reward is already closed';
  END IF;
  IF p_target='completed' THEN
    IF v_order.payment_method<>'cash' OR v_order.payment_status<>'paid' THEN
      RAISE EXCEPTION 'Cash payment must be confirmed before redeeming this reward';
    END IF;
    IF v_reward.expires_at<=now() THEN
      RAISE EXCEPTION 'Reward reservation expired. Cancel this order and place a new one';
    END IF;
    SELECT * INTO v_customer FROM public.customers
      WHERE id=v_reward.customer_id AND business_id=p_business_id FOR UPDATE;
    IF NOT FOUND OR v_customer.public_id IS DISTINCT FROM v_reward.customer_public_id OR
       v_order.member_customer_public_id IS DISTINCT FROM v_reward.customer_public_id THEN
      RAISE EXCEPTION 'Linked loyalty card no longer matches';
    END IF;
    IF v_reward.kind='points_prize' THEN
      SELECT coalesce(sum(points_cost),0)::integer INTO v_held
      FROM public.menu_order_redemptions
      WHERE customer_id=v_reward.customer_id AND kind='points_prize'
        AND status='pending' AND expires_at>now()
        AND order_public_id<>p_order_public_id;
      -- Respect pre-existing StoreHub/POS points holds where that feature is installed.
      IF to_regclass('public.pos_redemption_reservations') IS NOT NULL THEN
        EXECUTE 'SELECT coalesce(sum(points_reserved),0)::integer FROM public.pos_redemption_reservations '
             || 'WHERE business_id=$1 AND customer_id=$2 AND status IN (''reserved'',''discount_applied'') AND expires_at>now()'
          INTO v_pos_held USING p_business_id,v_reward.customer_id;
      END IF;
      IF coalesce(v_customer.points_balance,0)<v_reward.points_cost+v_held+v_pos_held THEN
        RAISE EXCEPTION 'Not enough available points. Cancel the order or select another reward';
      END IF;
      UPDATE public.customers SET points_balance=points_balance-v_reward.points_cost,
        updated_at=now() WHERE id=v_reward.customer_id;
    ELSIF v_reward.kind='stamp_reward' THEN
      IF coalesce(v_customer.card_cycle,1)<>v_reward.card_cycle OR
         coalesce(v_customer.stamp_count,0)<v_reward.required_stamps OR
         EXISTS(SELECT 1 FROM public.stamp_reward_claims
           WHERE customer_id=v_reward.customer_id AND card_cycle=v_reward.card_cycle
             AND milestone_id=v_reward.reward_id) THEN
        RAISE EXCEPTION 'Stamp reward already claimed or no longer available';
      END IF;
      INSERT INTO public.stamp_reward_claims
        (business_id,customer_id,card_cycle,milestone_id,milestone_stamps,reward_name,redeemed_at)
      VALUES
        (p_business_id,v_reward.customer_id,v_reward.card_cycle,v_reward.reward_id,
         v_reward.required_stamps,v_reward.reward_name,now());
    ELSE
      RAISE EXCEPTION 'Unsupported reward';
    END IF;
    UPDATE public.menu_order_redemptions
      SET status='redeemed',completed_at=now(),updated_at=now()
      WHERE order_public_id=p_order_public_id;
  ELSE
    UPDATE public.menu_order_redemptions
      SET status='released',updated_at=now()
      WHERE order_public_id=p_order_public_id;
  END IF;
  UPDATE public.menu_counter_orders SET status=p_target
    WHERE business_id=p_business_id AND public_id=p_order_public_id
    RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END $$;

REVOKE ALL ON FUNCTION public.menu_place_cash_reward_order(integer,integer,jsonb,text,text,text,integer,integer,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.menu_finalize_cash_reward_order(integer,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.menu_place_cash_reward_order(integer,integer,jsonb,text,text,text,integer,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.menu_finalize_cash_reward_order(integer,text,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

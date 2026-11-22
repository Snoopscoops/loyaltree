-- LoyaltyTree owner-v12.2: final standalone Stamp reward resets the card cycle.
-- Run on a staging database first, before deploying the Python wallet hook.
-- Does NOT automatically change any already-redeemed customer/order.
-- Requires owner-v12 public.menu_finalize_cash_reward_order to exist.
BEGIN;
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
  v_program public.loyalty_programs%ROWTYPE;
  v_final_stamps integer;
  v_reset_cycle boolean := false;
  v_today date;

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
      -- For standalone Stamp programs only, reset after the FINAL milestone
      -- if the merchant opted into stamp_reset_after_final. Other milestones
      -- and Hybrid/Tier engines keep their existing progression semantics.
      IF v_customer.program_id IS NOT NULL THEN
        SELECT * INTO v_program FROM public.loyalty_programs
          WHERE id=v_customer.program_id AND business_id=p_business_id LIMIT 1;
      ELSE
        SELECT * INTO v_program FROM public.loyalty_programs
          WHERE business_id=p_business_id
          ORDER BY is_default DESC,sort_order,created_at,id LIMIT 1;
      END IF;
      IF v_program.id IS NOT NULL AND v_program.card_type='stamp'
         AND v_program.stamp_reset_after_final IS NOT FALSE THEN
        -- Mirror the Python get_stamp_rewards() rule: highest valid
        -- configured milestone, with stamp_goal/legacy-final fallback.
        SELECT max((item->>'stamps')::integer) INTO v_final_stamps
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(to_jsonb(v_program.stamp_rewards))='array'
               THEN to_jsonb(v_program.stamp_rewards)
               ELSE '[]'::jsonb END
        ) AS item
        WHERE (item->>'stamps') ~ '^[0-9]{1,8}$'
          AND length(btrim(coalesce(item->>'reward_name',''))) > 0;
        IF v_final_stamps IS NULL OR v_final_stamps < 1 THEN
          v_final_stamps := greatest(1,coalesce(nullif(v_program.stamp_goal,0),8));
        END IF;
        IF v_reward.required_stamps = v_final_stamps THEN
          -- Another checkout holding a stamp milestone on this OLD cycle
          -- must be resolved first, otherwise that order could be stranded.
          UPDATE public.menu_order_redemptions SET status='released',updated_at=now()
            WHERE business_id=p_business_id AND customer_id=v_reward.customer_id
              AND kind='stamp_reward' AND card_cycle=v_reward.card_cycle
              AND status='pending' AND expires_at<=now()
              AND order_public_id<>p_order_public_id;
          IF EXISTS (
            SELECT 1 FROM public.menu_order_redemptions
            WHERE business_id=p_business_id AND customer_id=v_reward.customer_id
              AND kind='stamp_reward' AND card_cycle=v_reward.card_cycle
              AND status='pending' AND expires_at>now()
              AND order_public_id<>p_order_public_id
          ) THEN
            RAISE EXCEPTION 'Another stamp reward order is pending for this card cycle. Resolve it first';
          END IF;
          v_today := (now() AT TIME ZONE 'Asia/Manila')::date;
          UPDATE public.customers
             SET stamp_count=0,
                 card_cycle=v_reward.card_cycle+1,
                 reward_unlocked=false,
                 card_started_at=v_today,
                 card_expires_at=CASE WHEN coalesce(v_program.card_expiration_enabled,false)
                   THEN v_today+greatest(1,least(3650,coalesce(v_program.card_validity_days,365)))
                   ELSE NULL END,
                 last_card_reset_at=now(),updated_at=now()
           WHERE id=v_reward.customer_id AND business_id=p_business_id
             AND card_cycle=v_reward.card_cycle;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Stamp cycle changed; reward reset cancelled safely';
          END IF;
          v_reset_cycle := true;
        END IF;
      END IF;
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
  -- The flag is response-only; the order still has its original DB schema.
  -- The existing order-wallet hook skips earning a stamp on this reset order.
  RETURN to_jsonb(v_order) || jsonb_build_object('_stamp_cycle_reset',v_reset_cycle);
END $$;


REVOKE ALL ON FUNCTION public.menu_finalize_cash_reward_order(integer,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.menu_finalize_cash_reward_order(integer,text,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';

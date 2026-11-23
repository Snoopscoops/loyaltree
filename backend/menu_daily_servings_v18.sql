-- LoyaltyTree v18: optional daily serving inventory, per business/branch/item/variant.
-- IMPORTANT: Apply BEFORE deploying the corresponding backend code.
-- One inventory row is a limit. Items with no configured row continue their old behavior.
-- A '*' variant row is shared item stock; a particular option ID controls that variant.
-- When both exist, both limits must have remaining stock.
BEGIN;
CREATE TABLE IF NOT EXISTS public.menu_daily_servings (
  business_id bigint NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_public_id text NOT NULL,
  item_public_id text NOT NULL,
  variant_key text NOT NULL DEFAULT '*',
  service_day date NOT NULL,
  initial_servings integer NOT NULL CHECK(initial_servings BETWEEN 0 AND 100000),
  reserved integer NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  consumed integer NOT NULL DEFAULT 0 CHECK(consumed >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, branch_public_id, item_public_id, variant_key, service_day),
  CONSTRAINT menu_servings_not_oversold CHECK(reserved + consumed <= initial_servings),
  CONSTRAINT menu_servings_variant_format CHECK(variant_key = '*' OR (length(variant_key) <= 96 AND variant_key ~ '^[A-Za-z0-9_-]+$'))
);
-- Reusable opening quantities for tomorrow and subsequent days.
CREATE TABLE IF NOT EXISTS public.menu_serving_defaults (
  business_id bigint NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_public_id text NOT NULL,
  item_public_id text NOT NULL,
  variant_key text NOT NULL DEFAULT '*',
  initial_servings integer NOT NULL CHECK(initial_servings BETWEEN 0 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, branch_public_id, item_public_id, variant_key)
);
ALTER TABLE public.menu_serving_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_serving_defaults FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.menu_serving_defaults TO service_role;

CREATE OR REPLACE FUNCTION public.menu_ensure_daily_servings(
  p_business_id bigint, p_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.menu_daily_servings
    (business_id,branch_public_id,item_public_id,variant_key,service_day,initial_servings)
  SELECT business_id,branch_public_id,item_public_id,variant_key,p_day,initial_servings
  FROM public.menu_serving_defaults WHERE business_id=p_business_id
  ON CONFLICT DO NOTHING;
END $$;

-- Concurrent adjustments preserve all reservations and consumption already recorded.
CREATE OR REPLACE FUNCTION public.menu_set_daily_servings(
  p_business_id bigint,p_branch text,p_item text,p_variant text,p_initial integer,p_repeat boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_row public.menu_daily_servings%ROWTYPE;
BEGIN
  IF p_initial IS NULL OR p_initial<0 OR p_initial>100000 OR
      nullif(p_branch,'') IS NULL OR nullif(p_item,'') IS NULL OR
      (p_variant<>'*' AND (p_variant IS NULL OR length(p_variant)>96 OR p_variant !~ '^[A-Za-z0-9_-]+$')) THEN
    RAISE EXCEPTION 'Invalid serving configuration';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.branches WHERE business_id=p_business_id AND public_id=p_branch AND is_active=true)
      OR NOT EXISTS(SELECT 1 FROM public.order_ahead_items WHERE business_id=p_business_id AND public_id=p_item AND is_active=true) THEN
    RAISE EXCEPTION 'Invalid branch or menu item';
  END IF;
  -- Only write defaults after today can be updated safely; failed calls roll back both.
  INSERT INTO public.menu_daily_servings
    (business_id,branch_public_id,item_public_id,variant_key,service_day,initial_servings)
  VALUES(p_business_id,p_branch,p_item,p_variant,v_day,p_initial)
  ON CONFLICT (business_id,branch_public_id,item_public_id,variant_key,service_day)
  DO UPDATE SET initial_servings=excluded.initial_servings, updated_at=now()
  WHERE public.menu_daily_servings.reserved+public.menu_daily_servings.consumed<=excluded.initial_servings
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot set servings below already reserved and consumed quantity';
  END IF;
  IF coalesce(p_repeat,false) THEN
    INSERT INTO public.menu_serving_defaults
      (business_id,branch_public_id,item_public_id,variant_key,initial_servings)
    VALUES(p_business_id,p_branch,p_item,p_variant,p_initial)
    ON CONFLICT (business_id,branch_public_id,item_public_id,variant_key)
    DO UPDATE SET initial_servings=excluded.initial_servings,updated_at=now();
  END IF;
  RETURN to_jsonb(v_row);
END $$;

CREATE INDEX IF NOT EXISTS menu_daily_servings_day_idx
  ON public.menu_daily_servings (business_id, service_day, branch_public_id);
ALTER TABLE public.menu_daily_servings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_daily_servings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.menu_daily_servings TO service_role;

-- Resolve all configured stock rows matching one ordered line. Multiple matches
-- (e.g. shared item stock AND medium size) are deliberate independent limits.
-- This function locks rows through UPDATE and is safe under concurrent orders.
CREATE OR REPLACE FUNCTION public.menu_servings_adjust_line(
    p_business_id bigint, p_branch text, p_day date, p_line jsonb, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item text := coalesce(p_line->>'item_id','');
  v_qty integer;
  v_ids text[];
  v_stock record;
BEGIN
  IF NOT (p_line ? 'item_id') OR v_item = '' THEN
    RETURN; -- legacy data and non-stock reward lines
  END IF;
  IF jsonb_typeof(p_line->'options') = 'array' THEN
    SELECT coalesce(array_agg(o->>'public_id'),ARRAY[]::text[]) INTO v_ids
      FROM jsonb_array_elements(p_line->'options') o
      WHERE jsonb_typeof(o)='object' AND o ? 'public_id';
  ELSE
    v_ids := ARRAY[]::text[];
  END IF;
  IF coalesce(p_line->>'quantity','') !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'Invalid serving quantity' USING ERRCODE='23514';
  END IF;
  v_qty := (p_line->>'quantity')::integer;
  IF v_qty < 1 OR v_qty > 20 THEN
    RAISE EXCEPTION 'Invalid serving quantity' USING ERRCODE='23514';
  END IF;
  FOR v_stock IN
    SELECT variant_key FROM public.menu_daily_servings
    WHERE business_id=p_business_id AND branch_public_id=p_branch
      AND item_public_id=v_item AND service_day=p_day
      AND (variant_key='*' OR variant_key=ANY(v_ids))
    ORDER BY variant_key
  LOOP
    IF p_action='reserve' THEN
      UPDATE public.menu_daily_servings
      SET reserved=reserved+v_qty,updated_at=now()
      WHERE business_id=p_business_id AND branch_public_id=p_branch
        AND item_public_id=v_item AND service_day=p_day AND variant_key=v_stock.variant_key
        AND initial_servings-reserved-consumed >= v_qty;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Not enough servings available for this option. Refresh the menu.' USING ERRCODE='23514';
      END IF;
    ELSIF p_action='release' THEN
      UPDATE public.menu_daily_servings
      SET reserved=reserved-v_qty,updated_at=now()
      WHERE business_id=p_business_id AND branch_public_id=p_branch
        AND item_public_id=v_item AND service_day=p_day AND variant_key=v_stock.variant_key
        AND reserved>=v_qty;
      -- Do not silently release unrelated stock after an operator adjustment.
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Daily stock reservation does not match order' USING ERRCODE='23514';
      END IF;
    ELSIF p_action='consume' THEN
      UPDATE public.menu_daily_servings
      SET reserved=reserved-v_qty,consumed=consumed+v_qty,updated_at=now()
      WHERE business_id=p_business_id AND branch_public_id=p_branch
        AND item_public_id=v_item AND service_day=p_day AND variant_key=v_stock.variant_key
        AND reserved>=v_qty;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Daily stock reservation does not match order' USING ERRCODE='23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown serving action';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.menu_servings_order_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_day date;
  v_line jsonb;
  v_action text;
  v_has_managed boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status IN ('cancelled','completed') THEN RETURN NEW; END IF;
    v_action:='reserve';
    v_day:=(coalesce(NEW.created_at, now()) AT TIME ZONE 'Asia/Manila')::date;
  ELSE
    IF OLD.status IS NOT DISTINCT FROM NEW.status OR OLD.status IN ('completed','cancelled') THEN
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('cancelled','completed') THEN RETURN NEW; END IF;
    v_action:=CASE WHEN NEW.status='cancelled' THEN 'release' ELSE 'consume' END;
    v_day:=(coalesce(OLD.created_at, now()) AT TIME ZONE 'Asia/Manila')::date;
  END IF;
  IF coalesce(NEW.branch_public_id,'') = '' THEN RETURN NEW; END IF;
  PERFORM public.menu_ensure_daily_servings(NEW.business_id,v_day);
  SELECT EXISTS(SELECT 1 FROM public.menu_daily_servings
    WHERE business_id=NEW.business_id AND branch_public_id=NEW.branch_public_id
      AND service_day=v_day) INTO v_has_managed;
  IF NOT v_has_managed THEN RETURN NEW; END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(NEW.items::jsonb,'[]'::jsonb)) ORDER BY value->>'item_id' LOOP
    -- The synthetic checkout reward is not a purchased menu item.
    IF coalesce(v_line->>'item_id','') = '' THEN
      IF coalesce(NEW.checkout_reward_kind,'') <> ''
         AND coalesce(v_line->>'item_name','') LIKE '🎁 REWARD:%' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'This menu needs a refresh before ordering. Missing item ID.' USING ERRCODE='23514';
    END IF;
    -- Do not allow a forged item ID to bypass a configured serving limit.
    IF TG_OP='INSERT' AND NOT EXISTS (
      SELECT 1 FROM public.order_ahead_items
      WHERE business_id=NEW.business_id AND public_id=v_line->>'item_id'
        AND name=v_line->>'item_name' AND is_active=true) THEN
      RAISE EXCEPTION 'Menu item has changed. Refresh your menu before ordering.' USING ERRCODE='23514';
    END IF;
    PERFORM public.menu_servings_adjust_line(
      NEW.business_id,NEW.branch_public_id,v_day,v_line,v_action);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS menu_servings_reserve_trigger ON public.menu_counter_orders;
CREATE TRIGGER menu_servings_reserve_trigger AFTER INSERT ON public.menu_counter_orders
  FOR EACH ROW EXECUTE FUNCTION public.menu_servings_order_trigger();
DROP TRIGGER IF EXISTS menu_servings_finalize_trigger ON public.menu_counter_orders;
CREATE TRIGGER menu_servings_finalize_trigger AFTER UPDATE OF status ON public.menu_counter_orders
  FOR EACH ROW EXECUTE FUNCTION public.menu_servings_order_trigger();
REVOKE ALL ON FUNCTION public.menu_ensure_daily_servings(bigint,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.menu_ensure_daily_servings(bigint,date) TO service_role;
REVOKE ALL ON FUNCTION public.menu_set_daily_servings(bigint,text,text,text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.menu_set_daily_servings(bigint,text,text,text,integer,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.menu_servings_adjust_line(bigint,text,date,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.menu_servings_adjust_line(bigint,text,date,jsonb,text) TO service_role;
COMMIT;

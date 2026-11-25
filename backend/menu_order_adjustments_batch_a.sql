-- Batch A: independently paid cash add-ons and exact stock reservations.
-- Apply after the daily-serving and checkout-reward migrations.
BEGIN;

ALTER TABLE public.menu_counter_orders
  ADD COLUMN IF NOT EXISTS parent_order_public_id text REFERENCES public.menu_counter_orders(public_id),
  ADD COLUMN IF NOT EXISTS batch_a_stock_tracked boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS menu_counter_orders_parent_idx
  ON public.menu_counter_orders (business_id,branch_public_id,parent_order_public_id)
  WHERE parent_order_public_id IS NOT NULL;

-- Record the actual limits held at checkout. A limit configured later must
-- never release or consume somebody else's stock.
CREATE TABLE IF NOT EXISTS public.menu_counter_stock_reservations (
  business_id bigint NOT NULL,
  order_public_id text NOT NULL,
  line_id text NOT NULL,
  branch_public_id text NOT NULL,
  item_public_id text NOT NULL,
  variant_key text NOT NULL,
  service_day date NOT NULL,
  quantity integer NOT NULL CHECK (quantity>0),
  PRIMARY KEY (business_id,order_public_id,line_id,variant_key)
);
CREATE TABLE IF NOT EXISTS public.menu_counter_order_adjustments (
  business_id bigint NOT NULL,
  order_public_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('add','void','paid','cancelled')),
  request_id uuid NOT NULL,
  actor text NOT NULL,
  request_data jsonb NOT NULL,
  result_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,order_public_id,operation,request_id)
);
-- One immutable settled amount per parent. Loyalty dispatch always uses its
-- original order ID and existing points/stamp idempotency keys, including on retries.
CREATE TABLE IF NOT EXISTS public.menu_counter_order_finalizations (
  business_id bigint NOT NULL,
  order_public_id text NOT NULL,
  settled_total numeric NOT NULL CHECK (settled_total>=0),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,order_public_id)
);
ALTER TABLE public.menu_counter_stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_counter_order_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_counter_order_finalizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.menu_counter_stock_reservations,
  public.menu_counter_order_adjustments,public.menu_counter_order_finalizations
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.menu_counter_stock_reservations TO service_role;
GRANT SELECT,INSERT ON public.menu_counter_order_adjustments,
  public.menu_counter_order_finalizations TO service_role;

CREATE OR REPLACE FUNCTION public.menu_counter_canonical_total(p_items jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
  v_line jsonb;
  v_ids text[] := ARRAY[]::text[];
  v_line_id text;
  v_total numeric := 0;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid order lines' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Order must contain 1 to 40 lines' USING ERRCODE='22023';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_line_id := v_line->>'line_id';
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
       OR coalesce(v_line_id,'') !~ '^[0-9a-f]{32}$' OR v_line_id=ANY(v_ids)
       OR jsonb_typeof(v_line->'item_id') IS DISTINCT FROM 'string'
       OR length(v_line->>'item_id') NOT BETWEEN 1 AND 96
       OR jsonb_typeof(v_line->'item_name') IS DISTINCT FROM 'string'
       OR length(v_line->>'item_name') NOT BETWEEN 1 AND 120
       OR jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
       OR coalesce(v_line->>'quantity','') !~ '^([1-9]|1[0-9]|20)$'
       OR jsonb_typeof(v_line->'unit_price') IS DISTINCT FROM 'number'
       OR coalesce(v_line->>'unit_price','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
       OR jsonb_typeof(v_line->'line_total') IS DISTINCT FROM 'number'
       OR coalesce(v_line->>'line_total','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
       OR jsonb_typeof(v_line->'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid canonical order line' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(v_line->'options')>100 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_line->'options') AS opt(value)
      WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
         OR jsonb_typeof(value->'public_id') IS DISTINCT FROM 'string'
         OR length(value->>'public_id') NOT BETWEEN 1 AND 96
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_line->'options') AS opt(value)
      GROUP BY value->>'public_id' HAVING count(*)>1
    ) THEN
      RAISE EXCEPTION 'Invalid canonical order options' USING ERRCODE='22023';
    END IF;
    IF (v_line->>'unit_price')::numeric*(v_line->>'quantity')::integer<>(v_line->>'line_total')::numeric THEN
      RAISE EXCEPTION 'Stored line price mismatch' USING ERRCODE='22023';
    END IF;
    v_ids := array_append(v_ids,v_line_id);
    v_total := v_total+(v_line->>'line_total')::numeric;
  END LOOP;
  IF v_total>1000000000 THEN
    RAISE EXCEPTION 'Invalid order total' USING ERRCODE='22023';
  END IF;
  RETURN v_total;
END $$;

CREATE OR REPLACE FUNCTION public.menu_counter_track_canonical_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.batch_a_stock_tracked := false;
  IF NEW.service='dine-in' AND NEW.status='new'
     AND NEW.payment_method='cash' AND NEW.payment_status='unpaid'
     AND coalesce(NEW.branch_public_id,'')<>''
     AND coalesce(NEW.checkout_reward_kind,'')='' AND coalesce(NEW.checkout_reward_id,'')=''
     AND jsonb_typeof(NEW.items::jsonb)='array' THEN
    IF jsonb_array_length(NEW.items::jsonb)>0 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.items::jsonb) WHERE NOT (value ? 'line_id')
    ) THEN
      IF NEW.total IS DISTINCT FROM public.menu_counter_canonical_total(NEW.items::jsonb) THEN
        RAISE EXCEPTION 'Stored order total mismatch' USING ERRCODE='22023';
      END IF;
      NEW.batch_a_stock_tracked := true;
    END IF;
  END IF;
  IF NEW.parent_order_public_id IS NOT NULL THEN
    IF NOT NEW.batch_a_stock_tracked OR NEW.parent_order_public_id=NEW.public_id
       OR coalesce(NEW.member_customer_public_id,'')<>'' THEN
      RAISE EXCEPTION 'Invalid sub-order' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.menu_counter_orders
      WHERE business_id=NEW.business_id AND branch_public_id=NEW.branch_public_id
        AND public_id=NEW.parent_order_public_id AND parent_order_public_id IS NULL
        AND batch_a_stock_tracked AND status IN ('new','preparing','ready')
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent order is unavailable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.menu_counter_apply_stock(
  p_business_id bigint,p_order_public_id text,p_line_id text,p_quantity integer,p_action text
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_held record;
  v_delta integer;
BEGIN
  IF coalesce(p_action,'') NOT IN ('reserve','release','consume')
     OR (p_quantity IS NOT NULL AND (p_line_id IS NULL OR p_quantity<=0)) THEN
    RAISE EXCEPTION 'Invalid stock adjustment' USING ERRCODE='22023';
  END IF;
  FOR v_held IN
    SELECT branch_public_id,item_public_id,variant_key,service_day,sum(quantity)::integer AS quantity
      FROM public.menu_counter_stock_reservations
     WHERE business_id=p_business_id AND order_public_id=p_order_public_id
       AND (p_line_id IS NULL OR line_id=p_line_id)
     GROUP BY branch_public_id,item_public_id,variant_key,service_day
     ORDER BY branch_public_id,item_public_id,variant_key,service_day
  LOOP
    v_delta := coalesce(p_quantity,v_held.quantity);
    IF v_delta>v_held.quantity THEN
      RAISE EXCEPTION 'Daily stock reservation does not match order' USING ERRCODE='23514';
    END IF;
    IF p_action='reserve' THEN
      UPDATE public.menu_daily_servings SET reserved=reserved+v_delta,updated_at=now()
       WHERE business_id=p_business_id AND branch_public_id=v_held.branch_public_id
         AND item_public_id=v_held.item_public_id AND variant_key=v_held.variant_key
         AND service_day=v_held.service_day AND initial_servings-reserved-consumed>=v_delta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Not enough servings available for this option. Refresh the menu.' USING ERRCODE='23514';
      END IF;
    ELSE
      UPDATE public.menu_daily_servings
         SET reserved=reserved-v_delta,updated_at=now(),
             consumed=consumed+CASE WHEN p_action='consume' THEN v_delta ELSE 0 END
       WHERE business_id=p_business_id AND branch_public_id=v_held.branch_public_id
         AND item_public_id=v_held.item_public_id AND variant_key=v_held.variant_key
         AND service_day=v_held.service_day AND reserved>=v_delta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Daily stock reservation does not match order' USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF p_action IN ('release','consume') THEN
    DELETE FROM public.menu_counter_stock_reservations
     WHERE business_id=p_business_id AND order_public_id=p_order_public_id
       AND (p_line_id IS NULL OR line_id=p_line_id)
       AND (p_quantity IS NULL OR quantity=p_quantity);
    IF p_quantity IS NOT NULL THEN
      UPDATE public.menu_counter_stock_reservations SET quantity=quantity-p_quantity
       WHERE business_id=p_business_id AND order_public_id=p_order_public_id
         AND line_id=p_line_id AND quantity>p_quantity;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.menu_counter_stock_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_day date;
BEGIN
  IF TG_OP='INSERT' THEN
    v_day := (coalesce(NEW.created_at,now()) AT TIME ZONE 'Asia/Manila')::date;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.items::jsonb) AS ln(value)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.order_ahead_items
          WHERE business_id=NEW.business_id AND public_id::text=(ln.value->>'item_id')
            AND name=ln.value->>'item_name' AND is_active
       )
    ) THEN
      RAISE EXCEPTION 'Menu item has changed. Refresh your menu before ordering.' USING ERRCODE='23514';
    END IF;
    PERFORM public.menu_ensure_daily_servings(NEW.business_id,v_day);
    INSERT INTO public.menu_counter_stock_reservations
      (business_id,order_public_id,line_id,branch_public_id,item_public_id,variant_key,service_day,quantity)
    SELECT NEW.business_id,NEW.public_id,ln.value->>'line_id',stock.branch_public_id,
           stock.item_public_id,stock.variant_key,stock.service_day,(ln.value->>'quantity')::integer
      FROM jsonb_array_elements(NEW.items::jsonb) AS ln(value)
      JOIN public.menu_daily_servings AS stock
        ON stock.business_id=NEW.business_id AND stock.branch_public_id=NEW.branch_public_id
       AND stock.item_public_id=ln.value->>'item_id' AND stock.service_day=v_day
       AND (stock.variant_key='*' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(ln.value->'options') opt(value)
          WHERE opt.value->>'public_id'=stock.variant_key
       ));
    PERFORM public.menu_counter_apply_stock(NEW.business_id,NEW.public_id,NULL,NULL,'reserve');
  ELSIF NEW.status IN ('completed','cancelled') AND OLD.status NOT IN ('completed','cancelled') THEN
    PERFORM public.menu_counter_apply_stock(NEW.business_id,NEW.public_id,NULL,NULL,
      CASE WHEN NEW.status='completed' THEN 'consume' ELSE 'release' END);
  END IF;
  RETURN NEW;
END $$;

-- Keep the original stock path for pre-migration, legacy and reward orders.
DROP TRIGGER IF EXISTS menu_counter_track_canonical_insert ON public.menu_counter_orders;
CREATE TRIGGER menu_counter_track_canonical_insert BEFORE INSERT ON public.menu_counter_orders
  FOR EACH ROW EXECUTE FUNCTION public.menu_counter_track_canonical_insert();
DROP TRIGGER IF EXISTS menu_servings_reserve_trigger ON public.menu_counter_orders;
CREATE TRIGGER menu_servings_reserve_trigger AFTER INSERT ON public.menu_counter_orders
  FOR EACH ROW WHEN (NOT NEW.batch_a_stock_tracked)
  EXECUTE FUNCTION public.menu_servings_order_trigger();
DROP TRIGGER IF EXISTS menu_servings_finalize_trigger ON public.menu_counter_orders;
CREATE TRIGGER menu_servings_finalize_trigger AFTER UPDATE OF status ON public.menu_counter_orders
  FOR EACH ROW WHEN (NOT OLD.batch_a_stock_tracked)
  EXECUTE FUNCTION public.menu_servings_order_trigger();
DROP TRIGGER IF EXISTS menu_counter_stock_reserve ON public.menu_counter_orders;
CREATE TRIGGER menu_counter_stock_reserve AFTER INSERT ON public.menu_counter_orders
  FOR EACH ROW WHEN (NEW.batch_a_stock_tracked)
  EXECUTE FUNCTION public.menu_counter_stock_trigger();
DROP TRIGGER IF EXISTS menu_counter_stock_finalize ON public.menu_counter_orders;
CREATE TRIGGER menu_counter_stock_finalize AFTER UPDATE OF status ON public.menu_counter_orders
  FOR EACH ROW WHEN (OLD.batch_a_stock_tracked)
  EXECUTE FUNCTION public.menu_counter_stock_trigger();

CREATE OR REPLACE FUNCTION public.menu_lock_counter_order(
  p_business_id bigint,p_branch text,p_order_public_id text
) RETURNS public.menu_counter_orders LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_parent_id text;
  v_order public.menu_counter_orders%ROWTYPE;
BEGIN
  SELECT parent_order_public_id INTO v_parent_id FROM public.menu_counter_orders
   WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
     AND public_id=p_order_public_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002';
  END IF;
  -- A child always locks its family root before itself.
  IF v_parent_id IS NOT NULL THEN
    PERFORM 1 FROM public.menu_counter_orders
      WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch AND public_id=v_parent_id
        AND parent_order_public_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent order not found' USING ERRCODE='P0002';
    END IF;
  END IF;
  SELECT * INTO v_order FROM public.menu_counter_orders
   WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
     AND public_id=p_order_public_id
     AND parent_order_public_id IS NOT DISTINCT FROM v_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002';
  END IF;
  RETURN v_order;
END $$;

CREATE OR REPLACE FUNCTION public.menu_counter_adjustment_result(
  p_order public.menu_counter_orders,p_previous_status text,p_changed boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_loyalty jsonb;
  v_total numeric;
BEGIN
  IF p_order.parent_order_public_id IS NULL AND p_order.status='completed'
     AND coalesce(p_order.member_customer_public_id,'')<>'' THEN
    SELECT settled_total INTO v_total FROM public.menu_counter_order_finalizations
      WHERE business_id=p_order.business_id AND order_public_id=p_order.public_id;
    IF FOUND THEN
      v_loyalty := to_jsonb(p_order) || jsonb_build_object('total',v_total);
    END IF;
  END IF;
  RETURN jsonb_build_object('order',to_jsonb(p_order),'loyalty_order',v_loyalty,
    'changed',p_changed,'previous_status',p_previous_status);
END $$;

CREATE OR REPLACE FUNCTION public.menu_create_counter_suborder(
  p_business_id bigint,p_branch text,p_parent_public_id text,p_request_id uuid,
  p_order jsonb,p_actor text
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_parent public.menu_counter_orders%ROWTYPE;
  v_child public.menu_counter_orders%ROWTYPE;
  v_existing public.menu_counter_order_adjustments%ROWTYPE;
  v_items jsonb := p_order->'items';
  v_request_items jsonb := p_order->'request_items';
  v_note text := coalesce(p_order->>'customer_note','');
  v_request jsonb;
  v_total numeric;
  v_child_id text;
  v_sequence integer;
  v_suffix text := '';
BEGIN
  IF p_request_id IS NULL OR length(coalesce(btrim(p_actor),'')) NOT BETWEEN 1 AND 120
     OR jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR length(v_note)>500 THEN
    RAISE EXCEPTION 'Invalid sub-order payload' USING ERRCODE='22023';
  END IF;
  v_parent := public.menu_lock_counter_order(p_business_id,p_branch,p_parent_public_id);
  IF v_items IS NOT NULL THEN
    v_total := public.menu_counter_canonical_total(v_items);
    IF jsonb_typeof(p_order->'total') IS DISTINCT FROM 'number'
       OR v_total<=0 OR (p_order->>'total')::numeric IS DISTINCT FROM v_total THEN
      RAISE EXCEPTION 'Invalid sub-order total' USING ERRCODE='22023';
    END IF;
    IF v_request_items IS NULL THEN
      SELECT jsonb_agg(jsonb_build_object(
        'item_id',ln.value->>'item_id','quantity',ln.value->'quantity',
        'options',coalesce((
          SELECT jsonb_agg(opt.value->>'public_id' ORDER BY opt.value->>'public_id')
            FROM jsonb_array_elements(ln.value->'options') opt(value)
        ),'[]'::jsonb)
      ) ORDER BY ln.ordinality) INTO v_request_items
        FROM jsonb_array_elements(v_items) WITH ORDINALITY ln(value,ordinality);
    END IF;
  END IF;
  IF jsonb_typeof(v_request_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid sub-order request items' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(v_request_items) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Invalid sub-order request items' USING ERRCODE='22023';
  END IF;
  v_request := jsonb_build_object('items',v_request_items,'customer_note',v_note);
  SELECT * INTO v_existing FROM public.menu_counter_order_adjustments
    WHERE business_id=p_business_id AND order_public_id=p_parent_public_id
      AND operation='add' AND request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.request_data IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Request ID was already used for another sub-order' USING ERRCODE='23514';
    END IF;
    SELECT * INTO STRICT v_child FROM public.menu_counter_orders
      WHERE business_id=p_business_id AND branch_public_id=p_branch
        AND parent_order_public_id=p_parent_public_id
        AND public_id=v_existing.result_data->>'child_public_id';
    RETURN public.menu_counter_adjustment_result(v_child,v_child.status,false);
  END IF;
  IF NOT v_parent.batch_a_stock_tracked OR v_parent.parent_order_public_id IS NOT NULL
     OR v_parent.service<>'dine-in' OR v_parent.payment_method<>'cash'
     OR v_parent.status NOT IN ('new','preparing','ready')
     OR coalesce(v_parent.checkout_reward_kind,'')<>'' OR coalesce(v_parent.checkout_reward_id,'')<>'' THEN
    RAISE EXCEPTION 'Only an open cash dine-in parent supports add-ons' USING ERRCODE='23514';
  END IF;
  IF v_items IS NULL THEN
    RETURN NULL; -- Check a retry before repricing against live catalog/stock.
  END IF;

  -- The parent row is locked above; count committed add requests (including cancelled children).
  SELECT count(*)::integer+1 INTO v_sequence FROM public.menu_counter_order_adjustments
    WHERE business_id=p_business_id AND order_public_id=p_parent_public_id AND operation='add';
  WHILE v_sequence > 0 LOOP
    v_sequence := v_sequence-1;
    v_suffix := chr(65 + v_sequence % 26) || v_suffix;
    v_sequence := v_sequence / 26;
  END LOOP;
  v_child_id := replace(gen_random_uuid()::text,'-','');
  INSERT INTO public.menu_counter_orders (
    public_id,business_id,parent_order_public_id,order_number,payment_reference,buyer_name,
    service,table_no,customer_note,pickup_label,status,payment_status,payment_method,total,
    items,created_at,branch_public_id,branch_name,member_customer_public_id
  ) VALUES (
    v_child_id,p_business_id,p_parent_public_id,v_parent.order_number||v_suffix,'CASH-'||upper(v_child_id),
    v_parent.buyer_name,'dine-in',v_parent.table_no,v_note,'','new','unpaid','cash',v_total,
    v_items,now(),p_branch,v_parent.branch_name,''
  ) RETURNING * INTO v_child;
  INSERT INTO public.menu_counter_order_adjustments
    (business_id,order_public_id,operation,request_id,actor,request_data,result_data)
  VALUES (p_business_id,p_parent_public_id,'add',p_request_id,btrim(p_actor),v_request,
    jsonb_build_object('child_public_id',v_child.public_id,'total',v_child.total));
  RETURN public.menu_counter_adjustment_result(v_child,'',true);
END $$;

CREATE OR REPLACE FUNCTION public.menu_void_counter_order_item(
  p_business_id bigint,p_branch text,p_order_public_id text,p_request_id uuid,
  p_line_id text,p_quantity integer,p_reason text,p_actor text
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_order public.menu_counter_orders%ROWTYPE;
  v_existing public.menu_counter_order_adjustments%ROWTYPE;
  v_request jsonb;
  v_items jsonb;
  v_original_line jsonb;
  v_remaining integer;
  v_total numeric;
BEGIN
  IF p_request_id IS NULL OR length(coalesce(btrim(p_actor),'')) NOT BETWEEN 1 AND 120
     OR coalesce(p_line_id,'') !~ '^[0-9a-f]{32}$' OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 20
     OR length(coalesce(btrim(p_reason),'')) NOT BETWEEN 1 AND 250 THEN
    RAISE EXCEPTION 'Invalid line, void quantity, or reason' USING ERRCODE='22023';
  END IF;
  v_order := public.menu_lock_counter_order(p_business_id,p_branch,p_order_public_id);
  v_request := jsonb_build_object('line_id',p_line_id,'quantity',p_quantity,'reason',btrim(p_reason));
  SELECT * INTO v_existing FROM public.menu_counter_order_adjustments
    WHERE business_id=p_business_id AND order_public_id=p_order_public_id
      AND operation='void' AND request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.request_data IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'Request ID was already used for another void' USING ERRCODE='23514';
    END IF;
    RETURN public.menu_counter_adjustment_result(v_order,v_order.status,false);
  END IF;
  IF NOT v_order.batch_a_stock_tracked OR v_order.status<>'new'
     OR v_order.payment_status<>'unpaid' OR v_order.payment_method<>'cash' OR v_order.service<>'dine-in'
     OR coalesce(v_order.checkout_reward_kind,'')<>'' OR coalesce(v_order.checkout_reward_id,'')<>'' THEN
    RAISE EXCEPTION 'Only new unpaid cash dine-in orders can be voided' USING ERRCODE='23514';
  END IF;
  IF v_order.total IS DISTINCT FROM public.menu_counter_canonical_total(v_order.items::jsonb) THEN
    RAISE EXCEPTION 'Stored order total mismatch' USING ERRCODE='23514';
  END IF;
  SELECT value INTO v_original_line FROM jsonb_array_elements(v_order.items::jsonb)
    WHERE value->>'line_id'=p_line_id;
  IF NOT FOUND OR (v_original_line->>'quantity')::integer<p_quantity THEN
    RAISE EXCEPTION 'Invalid line or void quantity' USING ERRCODE='23514';
  END IF;
  v_remaining := (v_original_line->>'quantity')::integer-p_quantity;
  SELECT jsonb_agg(
    CASE WHEN ln.value->>'line_id'=p_line_id THEN ln.value || jsonb_build_object(
      'quantity',v_remaining,'line_total',(v_original_line->>'unit_price')::numeric*v_remaining
    ) ELSE ln.value END ORDER BY ln.ordinality
  ) INTO v_items
    FROM jsonb_array_elements(v_order.items::jsonb) WITH ORDINALITY ln(value,ordinality)
   WHERE ln.value->>'line_id'<>p_line_id OR v_remaining>0;
  IF v_items IS NULL THEN
    RAISE EXCEPTION 'Use whole-order cancellation for the final line' USING ERRCODE='23514';
  END IF;
  v_total := public.menu_counter_canonical_total(v_items);
  IF v_total<=0 THEN
    RAISE EXCEPTION 'Use whole-order cancellation for a zero total' USING ERRCODE='23514';
  END IF;

  PERFORM public.menu_counter_apply_stock(p_business_id,p_order_public_id,p_line_id,p_quantity,'release');
  INSERT INTO public.menu_counter_order_adjustments
    (business_id,order_public_id,operation,request_id,actor,request_data,result_data)
  VALUES (p_business_id,p_order_public_id,'void',p_request_id,btrim(p_actor),v_request,
    jsonb_build_object('original_line',v_original_line,'previous_total',v_order.total,'total',v_total));
  UPDATE public.menu_counter_orders SET items=v_items,total=v_total
    WHERE business_id=p_business_id AND branch_public_id=p_branch AND public_id=p_order_public_id
    RETURNING * INTO v_order;
  RETURN public.menu_counter_adjustment_result(v_order,'new',true);
END $$;

DROP FUNCTION IF EXISTS public.menu_transition_counter_order(bigint,text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.menu_transition_counter_order(
  p_business_id bigint,p_branch text,p_order_public_id text,
  p_target text,p_actor text,p_reason text DEFAULT NULL,p_expected_amount numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  v_order public.menu_counter_orders%ROWTYPE;
  v_previous text;
  v_child_total numeric;
BEGIN
  IF coalesce(p_target,'') NOT IN ('paid','preparing','ready','completed','cancelled')
     OR length(coalesce(btrim(p_actor),'')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid order transition' USING ERRCODE='22023';
  END IF;
  v_order := public.menu_lock_counter_order(p_business_id,p_branch,p_order_public_id);
  v_previous := v_order.status;
  IF p_target='paid' THEN
    IF p_expected_amount IS NULL OR p_expected_amount IS DISTINCT FROM v_order.total THEN
      RAISE EXCEPTION 'Payment amount changed or missing. Refresh the order and confirm again.' USING ERRCODE='23514';
    END IF;
    IF v_order.payment_method<>'cash' THEN
      RAISE EXCEPTION 'Only cash orders can be confirmed at the counter' USING ERRCODE='23514';
    END IF;
    IF v_order.payment_status='paid' THEN
      RETURN public.menu_counter_adjustment_result(v_order,v_previous,false);
    END IF;
    IF v_previous<>'new' OR v_order.payment_status<>'unpaid' THEN
      RAISE EXCEPTION 'Only new unpaid cash orders can be confirmed' USING ERRCODE='23514';
    END IF;
    UPDATE public.menu_counter_orders SET payment_status='paid'
      WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch AND public_id=p_order_public_id
      RETURNING * INTO v_order;
    INSERT INTO public.menu_counter_order_adjustments
      (business_id,order_public_id,operation,request_id,actor,request_data,result_data)
    VALUES (p_business_id,p_order_public_id,'paid',gen_random_uuid(),btrim(p_actor),
      '{}'::jsonb,jsonb_build_object('total',v_order.total));
    RETURN public.menu_counter_adjustment_result(v_order,v_previous,true);
  END IF;

  IF v_previous=p_target THEN
    RETURN public.menu_counter_adjustment_result(v_order,v_previous,false);
  END IF;
  IF NOT v_order.batch_a_stock_tracked
     AND NOT (p_target='cancelled' AND v_order.payment_method='cash') THEN
    RAISE EXCEPTION 'This order requires the existing status workflow' USING ERRCODE='23514';
  END IF;
  IF v_previous NOT IN ('new','preparing','ready') OR (v_previous='ready' AND p_target='preparing') THEN
    RAISE EXCEPTION 'Order cannot move to that status' USING ERRCODE='23514';
  END IF;
  IF p_target='cancelled' THEN
    IF length(coalesce(btrim(p_reason),'')) NOT BETWEEN 1 AND 250 THEN
      RAISE EXCEPTION 'A cancellation reason is required (max 250 characters)' USING ERRCODE='22023';
    END IF;
    IF v_previous<>'new' OR v_order.payment_status<>'unpaid' THEN
      RAISE EXCEPTION 'Only new unpaid orders can be cancelled' USING ERRCODE='23514';
    END IF;
    IF v_order.parent_order_public_id IS NULL AND EXISTS (
      SELECT 1 FROM public.menu_counter_orders
       WHERE business_id=p_business_id AND branch_public_id=p_branch
         AND parent_order_public_id=p_order_public_id AND status<>'cancelled'
    ) THEN
      RAISE EXCEPTION 'Cancel the sub-orders before cancelling the parent' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.menu_counter_order_adjustments
      (business_id,order_public_id,operation,request_id,actor,request_data,result_data)
    VALUES (p_business_id,p_order_public_id,'cancelled',gen_random_uuid(),btrim(p_actor),
      jsonb_build_object('reason',btrim(p_reason)),jsonb_build_object('total',v_order.total));
    IF coalesce(v_order.checkout_reward_kind,'')<>'' OR coalesce(v_order.checkout_reward_id,'')<>'' THEN
      -- Keep the established reward release, under the same order lock as the
      -- cash-payment check. A concurrent pay cannot settle a cancelled order.
      PERFORM public.menu_finalize_cash_reward_order(p_business_id::integer,p_order_public_id,'cancelled');
      SELECT * INTO STRICT v_order FROM public.menu_counter_orders
       WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
         AND public_id=p_order_public_id;
      RETURN public.menu_counter_adjustment_result(v_order,v_previous,true);
    END IF;
  ELSE
    IF v_order.payment_method<>'cash' OR v_order.payment_status<>'paid' THEN
      RAISE EXCEPTION 'Waiting for payment. Confirm cash at the counter first.' USING ERRCODE='23514';
    END IF;
    IF p_target='completed' AND v_order.batch_a_stock_tracked AND v_order.parent_order_public_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.menu_counter_orders
         WHERE business_id=p_business_id AND branch_public_id=p_branch
           AND parent_order_public_id=p_order_public_id
           AND status<>'cancelled' AND (status<>'completed' OR payment_status<>'paid')
      ) THEN
        RAISE EXCEPTION 'Complete or cancel all sub-orders before completing the parent' USING ERRCODE='23514';
      END IF;
      SELECT coalesce(sum(total),0) INTO v_child_total FROM public.menu_counter_orders
        WHERE business_id=p_business_id AND branch_public_id=p_branch
          AND parent_order_public_id=p_order_public_id AND status='completed' AND payment_status='paid';
      INSERT INTO public.menu_counter_order_finalizations (business_id,order_public_id,settled_total)
      VALUES (p_business_id,p_order_public_id,v_order.total+v_child_total);
    END IF;
  END IF;

  UPDATE public.menu_counter_orders SET status=p_target
    WHERE business_id=p_business_id AND branch_public_id IS NOT DISTINCT FROM p_branch
      AND public_id=p_order_public_id
    RETURNING * INTO v_order;
  RETURN public.menu_counter_adjustment_result(v_order,v_previous,true);
END $$;

REVOKE ALL ON FUNCTION public.menu_counter_canonical_total(jsonb),
  public.menu_counter_track_canonical_insert(),
  public.menu_counter_apply_stock(bigint,text,text,integer,text),
  public.menu_counter_stock_trigger(),
  public.menu_lock_counter_order(bigint,text,text),
  public.menu_counter_adjustment_result(public.menu_counter_orders,text,boolean),
  public.menu_create_counter_suborder(bigint,text,text,uuid,jsonb,text),
  public.menu_void_counter_order_item(bigint,text,text,uuid,text,integer,text,text),
  public.menu_transition_counter_order(bigint,text,text,text,text,text,numeric)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.menu_counter_canonical_total(jsonb),
  public.menu_counter_track_canonical_insert(),
  public.menu_counter_apply_stock(bigint,text,text,integer,text),
  public.menu_counter_stock_trigger(),
  public.menu_lock_counter_order(bigint,text,text),
  public.menu_counter_adjustment_result(public.menu_counter_orders,text,boolean),
  public.menu_create_counter_suborder(bigint,text,text,uuid,jsonb,text),
  public.menu_void_counter_order_item(bigint,text,text,uuid,text,integer,text,text),
  public.menu_transition_counter_order(bigint,text,text,text,text,text,numeric)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

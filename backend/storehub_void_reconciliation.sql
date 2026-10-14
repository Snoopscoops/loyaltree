-- Apply in Supabase SQL Editor before deploying the 60-second StoreHub void
-- reconciler. This migration uses the existing POS schema and the existing
-- pos_reverse_points_redemption RPC; it deliberately does not recreate that RPC.
-- No production rows are changed by installing these functions.
begin;

do $$
begin
  if to_regclass('public.pos_transactions') is null
     or to_regclass('public.pos_redemption_reservations') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.points_events') is null
     or to_regclass('public.wallet_sync_jobs') is null then
    raise exception 'Install the existing POS transactions, points-redemption reservations, customers, points-events and wallet_sync_jobs schema before storehub_void_reconciliation.sql';
  end if;
  if not exists (
    with rpc_candidates as (
      select p.pronargs, p.pronargdefaults,
        array(select p.proargnames[i] from generate_subscripts(p.proargnames, 1) i
          where p.proargmodes is null or p.proargmodes[i] in ('i', 'b', 'v')
          order by i) as input_names
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'pos_reverse_points_redemption'
        and p.prokind = 'f'
    )
    select 1 from rpc_candidates c
    where array_position(c.input_names, 'p_reservation_id') is not null
      and array_position(c.input_names, 'p_reason') is not null
      and not exists(select 1 from generate_series(1, c.pronargs - c.pronargdefaults) i
        where c.input_names[i] not in ('p_reservation_id', 'p_reason'))
  ) then
    raise exception 'Existing public.pos_reverse_points_redemption(p_reservation_id, p_reason) is required; install the existing POS redemption migration first';
  end if;
end $$;

-- Shared rate gate prevents multiple Render workers or Companion devices from
-- issuing the same outlet scan every minute. The interval starts at claim time.
create table if not exists public.storehub_void_sync_leases (
  scope text primary key check (length(scope) between 1 and 300),
  claimed_at timestamptz not null
);
alter table public.storehub_void_sync_leases enable row level security;
revoke all on public.storehub_void_sync_leases from public, anon, authenticated;
grant all on public.storehub_void_sync_leases to service_role;

create or replace function public.pos_claim_storehub_void_sync(
  p_scope text,
  p_interval_seconds integer default 60
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claimed text;
begin
  if p_scope is null or length(trim(p_scope)) not between 1 and 300 then
    raise exception 'A valid StoreHub integration/outlet scope is required';
  end if;
  if p_interval_seconds is null or p_interval_seconds < 60 then
    raise exception 'StoreHub void scan interval must be at least 60 seconds';
  end if;
  insert into public.storehub_void_sync_leases(scope, claimed_at)
  values(trim(p_scope), v_now)
  on conflict(scope) do update set claimed_at = excluded.claimed_at
    where storehub_void_sync_leases.claimed_at
      <= v_now - make_interval(secs => p_interval_seconds)
  returning scope into v_claimed;
  return v_claimed is not null;
end $$;

-- One Postgres transaction covers the earned-points clawback, redemption
-- restoration, activity entry, and final POS status. Retrying a lost HTTP
-- response is safe because the POS row is locked and checked before mutation.
create or replace function public.pos_reverse_storehub_void(
  p_transaction_id text,
  p_integration_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tx public.pos_transactions%rowtype;
  v_customer public.customers%rowtype;
  v_reservation public.pos_redemption_reservations%rowtype;
  v_reservation_json jsonb;
  v_processing jsonb;
  v_loyalty_result jsonb;
  v_reservation_id text;
  v_points integer;
  v_points_redeemed integer;
  v_balance_before integer;
  v_balance_after integer;
  v_expected_restored_balance bigint;
  v_redemption_reversed boolean := false;
  v_rpc_id_type text;
  v_rpc_reason_type text;
  v_rpc_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_transaction_id), '') is null
     or nullif(trim(p_integration_id), '') is null then
    raise exception 'StoreHub transaction and integration identifiers are required';
  end if;
  select * into v_tx from public.pos_transactions
    where id::text = p_transaction_id and integration_id::text = p_integration_id
    for update;
  if not found then
    raise exception 'StoreHub transaction not found for this integration';
  end if;
  if lower(coalesce(v_tx.provider, '')) <> 'storehub' then
    raise exception 'Only StoreHub transactions can be reversed by this function';
  end if;
  if v_tx.status = 'voided' then
    return jsonb_build_object('changed', false, 'transaction', to_jsonb(v_tx),
      'customer_id', v_tx.customer_id, 'business_id', v_tx.business_id);
  end if;
  if v_tx.status is distinct from 'loyalty_applied' then
    return jsonb_build_object('changed', false, 'transaction', to_jsonb(v_tx),
      'customer_id', v_tx.customer_id, 'business_id', v_tx.business_id);
  end if;
  if v_tx.customer_id is null then
    raise exception 'Applied StoreHub transaction has no linked customer';
  end if;

  v_processing := case when jsonb_typeof(v_tx.processing_metadata) = 'object'
    then v_tx.processing_metadata else '{}'::jsonb end;
  v_loyalty_result := case when jsonb_typeof(v_processing->'loyalty_result') = 'object'
    then v_processing->'loyalty_result' else '{}'::jsonb end;
  v_reservation_id := coalesce(
    nullif(v_loyalty_result->>'redemption_reservation_id', ''),
    nullif(to_jsonb(v_tx)->>'redemption_reservation_id', ''));
  v_points := greatest(0, coalesce(v_tx.points_earned, 0));
  v_points_redeemed := greatest(0,
    coalesce(nullif(to_jsonb(v_tx)->>'points_redeemed', '')::integer, 0),
    coalesce(nullif(v_loyalty_result->>'points_redeemed', '')::integer, 0));

  -- This wrapper locks the reservation before the customer so automatic
  -- reversals consistently acquire shared rows in the same order.
  if v_reservation_id is not null then
    select * into v_reservation from public.pos_redemption_reservations
      where id::text = v_reservation_id for update;
    if not found then
      raise exception 'StoreHub redemption reservation not found; void was not applied';
    end if;
    if v_reservation.customer_id is distinct from v_tx.customer_id
       or v_reservation.business_id is distinct from v_tx.business_id
       or v_reservation.integration_id is distinct from v_tx.integration_id then
      raise exception 'StoreHub redemption reservation does not belong to this transaction customer/integration';
    end if;
    v_reservation_json := to_jsonb(v_reservation);
    if nullif(trim(v_reservation_json->>'external_transaction_id'), '') is not null
       and trim(v_reservation_json->>'external_transaction_id')
         is distinct from trim(v_tx.external_transaction_id) then
      raise exception 'StoreHub redemption reservation belongs to another receipt';
    end if;
    if v_reservation_json->>'branch_id' is not null
       and v_reservation_json->>'branch_id' is distinct from to_jsonb(v_tx)->>'branch_id' then
      raise exception 'StoreHub redemption reservation belongs to another branch';
    end if;
    if v_reservation_json->>'provider' is not null
       and lower(v_reservation_json->>'provider') is distinct from lower(v_tx.provider) then
      raise exception 'StoreHub redemption reservation belongs to another POS provider';
    end if;
    if coalesce(v_reservation.status, '') not in ('committed', 'reversed') then
      raise exception 'StoreHub redemption reservation is not committed or already reversed';
    end if;
  elsif v_points_redeemed > 0 then
    raise exception 'StoreHub redeemed points have no reservation link; void was not applied';
  end if;

  select * into v_customer from public.customers
    where id = v_tx.customer_id for update;
  if not found or v_customer.business_id is distinct from v_tx.business_id then
    raise exception 'StoreHub customer not found for this business';
  end if;
  v_balance_before := coalesce(v_customer.points_balance, 0);
  -- Keep the existing nonnegative balance policy, then restore redeemed points.
  -- Example: balance 5, earn 10, redeemed 50 -> 0 + 50, rather than 45.
  v_balance_after := greatest(0, v_balance_before - v_points);
  if v_points > 0 then
    update public.customers set points_balance = v_balance_after, updated_at = v_now
      where id = v_customer.id;
  end if;

  if v_reservation_id is not null then
    if v_reservation.status = 'committed' then
      v_expected_restored_balance := v_balance_after::bigint + coalesce(v_reservation.points_reserved, 0);
      -- Derive the installed RPC's identifier type instead of assuming UUID or
      -- bigint. The existing schema is authoritative for all identifier types.
      with rpc_candidates as (
        select p.oid, p.pronargs, p.pronargdefaults, p.proargtypes,
          array(select p.proargnames[i] from generate_subscripts(p.proargnames, 1) i
            where p.proargmodes is null or p.proargmodes[i] in ('i', 'b', 'v')
            order by i) as input_names
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'pos_reverse_points_redemption'
          and p.prokind = 'f'
      ), callable as (
        select c.*, array_position(c.input_names, 'p_reservation_id') - 1 as id_pos,
          array_position(c.input_names, 'p_reason') - 1 as reason_pos
        from rpc_candidates c
        where array_position(c.input_names, 'p_reservation_id') is not null
          and array_position(c.input_names, 'p_reason') is not null
          and not exists(select 1 from generate_series(1, c.pronargs - c.pronargdefaults) i
            where c.input_names[i] not in ('p_reservation_id', 'p_reason'))
      )
      select format_type(c.proargtypes[c.id_pos], null), format_type(c.proargtypes[c.reason_pos], null)
        into v_rpc_id_type, v_rpc_reason_type
        from callable c
        order by (c.proargtypes[c.id_pos] = pg_typeof(v_reservation.id)::oid) desc,
          c.pronargs, c.oid
        limit 1;
      if v_rpc_id_type is null then
        raise exception 'Existing StoreHub points reversal RPC is missing; void was not applied';
      end if;
      execute format('select to_jsonb(public.pos_reverse_points_redemption(p_reservation_id => $1::%s, p_reason => $2::%s))',
        v_rpc_id_type, v_rpc_reason_type)
        into v_rpc_result using v_reservation_id, 'storehub_void_or_refund';
      select * into v_reservation from public.pos_redemption_reservations
        where id::text = v_reservation_id;
      if not found or v_reservation.status is distinct from 'reversed' then
        raise exception 'StoreHub redemption RPC did not restore the reservation; void was not applied';
      end if;
      select * into v_customer from public.customers where id = v_tx.customer_id;
      if not found or v_customer.points_balance is distinct from v_expected_restored_balance then
        raise exception 'StoreHub redemption RPC did not restore the expected customer balance; void was not applied';
      end if;
    end if;
    v_redemption_reversed := true;
  end if;

  if v_points > 0 then
    insert into public.points_events(
      business_id, customer_id, amount_spent_pesos, points_earned, branch_id, created_at
    ) values (
      v_tx.business_id, v_tx.customer_id, -coalesce(v_tx.gross_amount, 0),
      -v_points, v_tx.branch_id, v_now
    );
  end if;
  -- The pending marker remains until the application durably queues the final
  -- Wallet balance. Repeated scans can retry that step without reversing twice.
  update public.pos_transactions set
    status = 'voided',
    processing_metadata = v_processing || jsonb_build_object(
      'void_reversed_at', v_now,
      'points_reversed', v_points,
      'redemption_reversed', v_redemption_reversed,
      'void_wallet_sync_pending', true),
    updated_at = v_now
    where id = v_tx.id returning * into v_tx;
  return jsonb_build_object('changed', true, 'transaction', to_jsonb(v_tx),
    'customer_id', v_tx.customer_id, 'business_id', v_tx.business_id);
end $$;

revoke all on function public.pos_claim_storehub_void_sync(text, integer) from public, anon, authenticated;
revoke all on function public.pos_reverse_storehub_void(text, text) from public, anon, authenticated;
grant execute on function public.pos_claim_storehub_void_sync(text, integer) to service_role;
grant execute on function public.pos_reverse_storehub_void(text, text) to service_role;
notify pgrst, 'reload schema';
commit;

-- Optional diagnostics if the dependency preflight stops installation:
-- select table_name, column_name, data_type, udt_name
-- from information_schema.columns where table_schema = 'public'
--   and table_name in ('pos_transactions', 'pos_redemption_reservations',
--     'customers', 'points_events', 'wallet_sync_jobs')
-- order by table_name, ordinal_position;
-- select p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'pos_reverse_points_redemption';

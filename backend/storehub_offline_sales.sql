-- Run once in Supabase SQL Editor before deploying offline StoreHub earning.
-- Installation adds a durable queue; it does not award points or change devices.
begin;

do $$ begin
  if to_regclass('public.pos_devices') is null
     or to_regclass('public.pos_branch_mappings') is null
     or to_regclass('public.pos_integrations') is null
     or to_regclass('public.branches') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.pos_transactions') is null then
    raise exception 'Install the existing POS device, branch, integration, customer and transaction schema first';
  end if;
end $$;

-- Version provider changes and customer claims, including older POS installs.
alter table public.pos_transactions add column if not exists updated_at timestamptz default now();

create or replace function public.pos_offline_trim(p_value text)
returns text language sql immutable strict parallel safe set search_path = public as $$
  select btrim(p_value, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000')
$$;
create or replace function public.pos_offline_receipt_key(p_value text)
returns text language sql immutable strict parallel safe set search_path = public as $$
  select lower(regexp_replace(p_value, '[^A-Za-z0-9]', '', 'g'))
$$;

create table if not exists public.storehub_offline_sales (
  id uuid primary key default gen_random_uuid(),
  device_id text not null, business_id text not null, branch_id text not null,
  integration_id text not null,
  provider text not null default 'storehub' check(provider = 'storehub'),
  client_event_id text not null check(length(client_event_id) between 1 and 120),
  event_hash text not null check(event_hash ~ '^[a-f0-9]{64}$'),
  customer_ref text not null check(length(customer_ref) between 1 and 500),
  receipt_reference text not null default '' check(length(receipt_reference) <= 200),
  receipt_match_mode text not null default 'amount' check(receipt_match_mode in ('amount','suffix5','full')),
  final_amount numeric(18,2) not null check(final_amount > 0 and final_amount < 'Infinity'::numeric),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  scanned_at timestamptz not null, completed_at timestamptz not null,
  scope jsonb not null check(jsonb_typeof(scope) = 'object'),
  session_id text,
  original_event jsonb not null check(jsonb_typeof(original_event) = 'object'),
  receipt_corrections jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check(status in ('pending','awaiting_storehub','needs_review','processed','rejected')),
  matched_transaction_id text,
  external_transaction_id text,
  result jsonb not null default '{}'::jsonb,
  message text, last_error text,
  attempts integer not null default 0 check(attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint storehub_offline_sales_device_event_uidx unique(device_id, client_event_id),
  constraint storehub_offline_sales_time_check check(
    completed_at >= scanned_at and completed_at <= scanned_at + interval '12 hours'
    and isfinite(scanned_at) and isfinite(completed_at)),
  constraint storehub_offline_sales_receipt_check check(
    (receipt_match_mode = 'amount' and receipt_reference = '')
    or (receipt_match_mode = 'full' and length(public.pos_offline_trim(receipt_reference)) between 1 and 200)
    or (receipt_match_mode = 'suffix5' and receipt_reference ~ '^[A-Za-z0-9]{5}$'))
);
create unique index if not exists storehub_offline_sales_transaction_uidx
  on public.storehub_offline_sales(matched_transaction_id) where matched_transaction_id is not null;
create index if not exists storehub_offline_sales_due_idx
  on public.storehub_offline_sales(next_attempt_at, created_at)
  where status in ('pending','awaiting_storehub');
create index if not exists storehub_offline_sales_overlap_idx
  on public.storehub_offline_sales(integration_id,branch_id,currency,final_amount,
    (scope->>'external_terminal_id'))
  where status in ('pending','awaiting_storehub','needs_review');
alter table public.storehub_offline_sales enable row level security;
revoke all on public.storehub_offline_sales from public, anon, authenticated;
grant all on public.storehub_offline_sales to service_role;

-- All receipt claims and publication/correction of pending offline work use
-- this same short transaction lock. A later online scan cannot select an older
-- saved offline sale between checking the queue and binding its customer.
create or replace function public.pos_offline_sale_lock_scope(p_integration_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if nullif(public.pos_offline_trim(p_integration_id),'') is null then
    raise exception 'A POS integration is required for the offline receipt lock';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('loyaltree:pos-offline:'||p_integration_id,0));
end $$;

create or replace function public.pos_offline_sale_preserve_source()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.id,new.device_id,new.business_id,new.branch_id,new.integration_id,new.provider,
      new.client_event_id,new.event_hash,new.customer_ref,new.final_amount,new.currency,
      new.scanned_at,new.completed_at,new.scope,new.session_id,new.original_event,new.created_at)
    is distinct from
     (old.id,old.device_id,old.business_id,old.branch_id,old.integration_id,old.provider,
      old.client_event_id,old.event_hash,old.customer_ref,old.final_amount,old.currency,
      old.scanned_at,old.completed_at,old.scope,old.session_id,old.original_event,old.created_at) then
    raise exception 'The original offline sale event is immutable';
  end if;
  return new;
end $$;
drop trigger if exists storehub_offline_sales_preserve_source on public.storehub_offline_sales;
create trigger storehub_offline_sales_preserve_source before update on public.storehub_offline_sales
  for each row execute function public.pos_offline_sale_preserve_source();

-- Both enqueue and later matching read current device scope. An upload cannot
-- keep earning on an old branch/register after that device is reassigned.
create or replace function public.pos_offline_sale_assert_device(
  p_device_id text, p_business_id text, p_branch_id text, p_integration_id text,
  p_external_branch_id text, p_external_terminal_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_device public.pos_devices%rowtype;
  v_mapping public.pos_branch_mappings%rowtype;
begin
  select * into v_device from public.pos_devices where id::text = p_device_id for share;
  if not found or v_device.status::text is distinct from 'active'
     or lower(coalesce(v_device.provider::text,'')) <> 'storehub'
     or v_device.business_id::text is distinct from p_business_id
     or v_device.branch_id::text is distinct from p_branch_id
     or v_device.integration_id::text is distinct from p_integration_id
     or nullif(public.pos_offline_trim(p_external_terminal_id),'') is null
     or public.pos_offline_trim(v_device.metadata->>'external_terminal_id')
       is distinct from public.pos_offline_trim(p_external_terminal_id) then
    raise exception 'Offline sale requires the same active StoreHub device, business, branch and assigned register';
  end if;
  select * into v_mapping from public.pos_branch_mappings
    where id::text = v_device.mapping_id::text and is_active is true
      and business_id::text = p_business_id and branch_id::text = p_branch_id
      and integration_id::text = p_integration_id
      and external_branch_id = p_external_branch_id for share;
  if not found or nullif(public.pos_offline_trim(p_external_branch_id),'') is null
     or not exists(select 1 from public.branches where id::text = p_branch_id
       and business_id::text = p_business_id and is_active is true)
     or not exists(select 1 from public.pos_integrations where id::text = p_integration_id
       and business_id::text = p_business_id and lower(coalesce(provider::text,'')) = 'storehub') then
    raise exception 'Offline sale no longer has its original active StoreHub branch/outlet mapping';
  end if;
  return to_jsonb(v_device);
end $$;

create or replace function public.pos_offline_sale_enqueue(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.storehub_offline_sales%rowtype;
begin
  if jsonb_typeof(p_event) is distinct from 'object' or jsonb_typeof(p_event->'scope') is distinct from 'object' then
    raise exception 'An offline sale event with scope is required';
  end if;
  perform public.pos_offline_sale_lock_scope(p_event->>'integration_id');
  perform public.pos_offline_sale_assert_device(p_event->>'device_id',p_event->>'business_id',
    p_event->>'branch_id',p_event->>'integration_id',p_event->'scope'->>'external_branch_id',
    p_event->'scope'->>'external_terminal_id');
  insert into public.storehub_offline_sales(device_id,business_id,branch_id,integration_id,
    client_event_id,event_hash,customer_ref,receipt_reference,receipt_match_mode,final_amount,currency,
    scanned_at,completed_at,scope,session_id,original_event)
  values(p_event->>'device_id',p_event->>'business_id',p_event->>'branch_id',p_event->>'integration_id',
    p_event->>'client_event_id',p_event->>'event_hash',p_event->>'customer_ref',
    coalesce(public.pos_offline_trim(p_event->>'receipt_reference'),''),
    coalesce(p_event->>'receipt_match_mode','amount'),(p_event->>'final_amount')::numeric,
    p_event->>'currency',(p_event->>'scanned_at')::timestamptz,(p_event->>'completed_at')::timestamptz,
    p_event->'scope',nullif(p_event->>'session_id',''),p_event)
  on conflict(device_id,client_event_id) do nothing returning * into v_row;
  if not found then
    select * into v_row from public.storehub_offline_sales
      where device_id = p_event->>'device_id' and client_event_id = p_event->>'client_event_id' for update;
    if v_row.event_hash is distinct from p_event->>'event_hash' then
      raise exception using errcode='23505',message='Offline event ID was already used for a different sale';
    end if;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.pos_claim_offline_sales(p_limit integer, p_lease_seconds integer default 120)
returns setof jsonb language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null
     or p_lease_seconds not between 30 and 900 then
    raise exception 'Offline queue claims require a limit of 1-100 and lease of 30-900 seconds';
  end if;
  return query with due as (
    select id from public.storehub_offline_sales
    where status in ('pending','awaiting_storehub') and next_attempt_at <= v_now
      and (lease_expires_at is null or lease_expires_at <= v_now)
    order by next_attempt_at,created_at,id for update skip locked limit p_limit
  ), claimed as (
    update public.storehub_offline_sales q set lease_token=gen_random_uuid(),
      lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),attempts=q.attempts+1,updated_at=v_now
    from due where q.id=due.id returning q.*
  ) select to_jsonb(claimed) from claimed;
end $$;

-- Publish one upload batch atomically. The worker cannot claim the first sale
-- while another potentially overlapping sale in this same batch is still being
-- inserted. Each exception block rolls back only its rejected item.
create or replace function public.pos_offline_sales_enqueue_batch(p_events jsonb)
returns setof jsonb language plpgsql security definer set search_path = public as $$
declare v_event jsonb; v_message text; v_integration text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'An offline sale batch must be an array';
  end if;
  if jsonb_array_length(p_events) not between 1 and 50 then
    raise exception 'An offline sale batch must contain 1-50 events';
  end if;
  -- Sorted acquisition also keeps a mixed-integration service-role batch from
  -- taking the same advisory locks in opposing orders.
  for v_integration in select distinct value->>'integration_id'
    from jsonb_array_elements(p_events)
    where nullif(public.pos_offline_trim(value->>'integration_id'),'') is not null
    order by 1 loop
    perform public.pos_offline_sale_lock_scope(v_integration);
  end loop;
  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      return next public.pos_offline_sale_enqueue(v_event);
    exception when others then
      get stacked diagnostics v_message = message_text;
      return next jsonb_build_object('client_event_id',v_event->>'client_event_id',
        'id','','status',case when sqlstate='P0001' or sqlstate='23505' then 'needs_review' else 'rejected' end,
        'acknowledged',false,'requires_full_receipt',false,'message',left(v_message,500));
    end;
  end loop;
end $$;

create or replace function public.pos_finish_offline_sale(
  p_event_id text,p_lease_token text,p_status text,p_message text,p_result jsonb,
  p_retry_seconds integer default 60
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.storehub_offline_sales%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_status is null or p_status not in ('awaiting_storehub','needs_review','processed','rejected')
     or p_retry_seconds is null or p_retry_seconds not between 1 and 86400
     or jsonb_typeof(coalesce(p_result,'{}'::jsonb)) <> 'object' then
    raise exception 'Invalid offline completion status, result or retry interval';
  end if;
  update public.storehub_offline_sales set status=p_status,message=left(p_message,2000),
    result=coalesce(p_result,'{}'::jsonb),
    last_error=case when p_status in ('awaiting_storehub','needs_review','rejected') then left(p_message,2000) else null end,
    next_attempt_at=v_now+make_interval(secs=>p_retry_seconds),
    lease_token=null,lease_expires_at=null,updated_at=v_now,
    processed_at=case when p_status='processed' then v_now else processed_at end
    where id::text=p_event_id and lease_token::text=p_lease_token and lease_expires_at > v_now
      and status in ('pending','awaiting_storehub')
    returning * into v_row;
  if not found then raise exception using errcode='40001',message='Offline sale lease is expired or no longer owned'; end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.pos_correct_offline_sale_receipt(
  p_device_id text,p_event_id text,p_receipt_reference text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.storehub_offline_sales%rowtype; v_receipt text:=public.pos_offline_trim(p_receipt_reference);
begin
  if v_receipt is null or length(v_receipt) not between 1 and 200 then
    raise exception 'A complete receipt number of 1-200 characters is required';
  end if;
  select * into v_row from public.storehub_offline_sales where id::text=p_event_id;
  if found then perform public.pos_offline_sale_lock_scope(v_row.integration_id); end if;
  select * into v_row from public.storehub_offline_sales where id::text=p_event_id for update;
  if not found or v_row.device_id is distinct from p_device_id or v_row.status <> 'needs_review' then
    raise exception 'Only this device can correct a sale awaiting review';
  end if;
  perform public.pos_offline_sale_assert_device(v_row.device_id,v_row.business_id,v_row.branch_id,v_row.integration_id,
    v_row.scope->>'external_branch_id',v_row.scope->>'external_terminal_id');
  update public.storehub_offline_sales set receipt_reference=v_receipt,receipt_match_mode='full',
    receipt_corrections=receipt_corrections||jsonb_build_array(jsonb_build_object('previous_receipt',receipt_reference,
      'previous_mode',receipt_match_mode,'receipt',v_receipt,'at',clock_timestamp())),
    status='pending',next_attempt_at=clock_timestamp(),message=null,last_error=null,
    lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
    where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- Claim one normalized sale before invoking the existing idempotent loyalty
-- processor. A retry of the same event is safe; another event cannot own it.
create or replace function public.pos_claim_offline_sale_transaction(
  p_event_id text,p_lease_token text,p_transaction_id text,p_customer_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.storehub_offline_sales%rowtype;
  v_tx public.pos_transactions%rowtype;
  v_amount numeric; v_receipt text; v_meta jsonb; v_raw jsonb;
begin
  select * into v_event from public.storehub_offline_sales where id::text=p_event_id;
  if found then perform public.pos_offline_sale_lock_scope(v_event.integration_id); end if;
  select * into v_event from public.storehub_offline_sales where id::text=p_event_id for update;
  if not found or v_event.lease_token::text is distinct from p_lease_token
     or v_event.lease_expires_at <= clock_timestamp() or v_event.lease_expires_at is null
     or v_event.status not in ('pending','awaiting_storehub') then
    raise exception using errcode='40001',message='Offline sale lease is expired or no longer owned';
  end if;
  perform public.pos_offline_sale_assert_device(v_event.device_id,v_event.business_id,v_event.branch_id,v_event.integration_id,
    v_event.scope->>'external_branch_id',v_event.scope->>'external_terminal_id');
  if not exists(select 1 from public.customers where id::text=p_customer_id and business_id::text=v_event.business_id) then
    raise exception 'Offline earning customer does not belong to this business';
  end if;
  select * into v_tx from public.pos_transactions where id::text=p_transaction_id for update;
  if not found then raise exception 'StoreHub sale was not found'; end if;
  v_meta:=case when jsonb_typeof(v_tx.processing_metadata)='object' then v_tx.processing_metadata else '{}'::jsonb end;
  v_raw:=case when jsonb_typeof(v_tx.raw_payload)='object' then v_tx.raw_payload else '{}'::jsonb end;
  v_amount:=coalesce(v_tx.net_amount,v_tx.gross_amount);
  v_receipt:=public.pos_offline_trim(v_tx.external_receipt_number);
  if lower(coalesce(v_tx.provider::text,'')) <> 'storehub'
     or v_tx.business_id::text is distinct from v_event.business_id
     or v_tx.integration_id::text is distinct from v_event.integration_id
     or v_tx.branch_id::text is distinct from v_event.branch_id
     or lower(coalesce(v_tx.transaction_type::text,'')) <> 'sale'
     or coalesce(v_tx.status::text,'') in ('voided','refunded','ignored','failed')
     or v_meta->>'void_reversed_at' is not null
     or lower(coalesce(v_raw->>'isCancelled','false')) <> 'false'
     or coalesce(public.pos_offline_trim(v_raw->>'storeId'),public.pos_offline_trim(v_meta->>'bridge_external_branch_id'))
        is distinct from public.pos_offline_trim(v_event.scope->>'external_branch_id')
     or coalesce(nullif(public.pos_offline_trim(v_raw->>'registerId'),''),
          nullif(public.pos_offline_trim(v_meta->>'bridge_external_terminal_id'),''))
        is distinct from public.pos_offline_trim(v_event.scope->>'external_terminal_id')
     or upper(coalesce(v_tx.currency,'')) is distinct from v_event.currency
     or v_amount is null or v_amount <= 0 or v_amount >= 'Infinity'::numeric
     or round(v_amount,2) is distinct from v_event.final_amount
     or v_tx.transacted_at is null
     or v_tx.transacted_at < v_event.scanned_at-interval '10 seconds'
     or v_tx.transacted_at > v_event.completed_at+interval '10 seconds'
     or (v_event.receipt_match_mode='full' and v_receipt is distinct from v_event.receipt_reference)
     or (v_event.receipt_match_mode='suffix5' and right(public.pos_offline_receipt_key(v_receipt),5)
          is distinct from lower(v_event.receipt_reference)) then
    raise exception 'StoreHub sale does not match the offline receipt, amount, time, branch and register';
  end if;
  if v_tx.customer_id is not null and v_tx.customer_id::text is distinct from p_customer_id then
    raise exception using errcode='23505',message='StoreHub sale already belongs to a different customer';
  end if;
  if v_meta->>'offline_sale_event_id' is not null and v_meta->>'offline_sale_event_id' <> v_event.id::text
     or exists(select 1 from public.storehub_offline_sales where matched_transaction_id=p_transaction_id and id<>v_event.id) then
    raise exception using errcode='23505',message='StoreHub sale is already claimed by another offline event';
  end if;
  if v_event.matched_transaction_id is not null and v_event.matched_transaction_id <> p_transaction_id then
    raise exception using errcode='23505',message='Offline event is already bound to a different StoreHub sale';
  end if;
  -- Amount alone must not choose between overlapping offline scans. Supplying
  -- a complete receipt later is the explicit resolution for such ambiguity.
  if v_event.receipt_match_mode='amount' and exists(select 1 from public.storehub_offline_sales other
    where other.id<>v_event.id and other.status in ('pending','awaiting_storehub','needs_review')
      and other.receipt_match_mode='amount' and other.integration_id=v_event.integration_id
      and other.branch_id=v_event.branch_id and other.final_amount=v_event.final_amount and other.currency=v_event.currency
      and other.scope->>'external_terminal_id'=v_event.scope->>'external_terminal_id'
      and other.scanned_at <= v_event.completed_at+interval '20 seconds'
      and other.completed_at >= v_event.scanned_at-interval '20 seconds') then
    raise exception 'Overlapping offline sales need a complete receipt number before matching';
  end if;
  v_tx.customer_id:=(jsonb_populate_record(null::public.pos_transactions,jsonb_build_object('customer_id',p_customer_id))).customer_id;
  update public.pos_transactions set customer_id=v_tx.customer_id,updated_at=clock_timestamp(),
    processing_metadata=v_meta||jsonb_build_object('offline_sale_event_id',v_event.id::text,
      'offline_client_event_id',v_event.client_event_id,'offline_device_id',v_event.device_id)
    where id=v_tx.id returning * into v_tx;
  update public.storehub_offline_sales set matched_transaction_id=p_transaction_id,
    external_transaction_id=v_tx.external_transaction_id,updated_at=clock_timestamp() where id=v_event.id;
  return to_jsonb(v_tx);
end $$;

-- Canonical StoreHub customer claim, used by both interactive and offline
-- Companion processing before any loyalty mutation. Queue publication shares
-- the integration lock, so a pending offline receipt cannot be stolen by the
-- next member's online scan (which intentionally permits a small time pad).
create or replace function public.pos_claim_companion_transaction_customer(
  p_device_id text,p_transaction_id text,p_customer_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_device public.pos_devices%rowtype;
  v_mapping public.pos_branch_mappings%rowtype;
  v_tx public.pos_transactions%rowtype;
  v_meta jsonb; v_raw jsonb; v_outlet text; v_register text; v_locked_integration text;
begin
  select * into v_device from public.pos_devices where id::text=p_device_id;
  if not found then raise exception 'The active StoreHub device was not found'; end if;
  v_locked_integration:=v_device.integration_id::text;
  perform public.pos_offline_sale_lock_scope(v_locked_integration);
  select * into v_device from public.pos_devices where id::text=p_device_id for share;
  if not found or v_device.integration_id::text is distinct from v_locked_integration then
    raise exception 'The StoreHub device integration changed during the receipt claim';
  end if;
  select * into v_mapping from public.pos_branch_mappings where id::text=v_device.mapping_id::text;
  perform public.pos_offline_sale_assert_device(p_device_id,v_device.business_id::text,
    v_device.branch_id::text,v_device.integration_id::text,v_mapping.external_branch_id,
    public.pos_offline_trim(v_device.metadata->>'external_terminal_id'));
  if not exists(select 1 from public.customers where id::text=p_customer_id
      and business_id::text=v_device.business_id::text) then
    raise exception 'The checkout member does not belong to this business';
  end if;
  select * into v_tx from public.pos_transactions where id::text=p_transaction_id for update;
  if not found then raise exception 'StoreHub sale was not found'; end if;
  v_meta:=case when jsonb_typeof(v_tx.processing_metadata)='object' then v_tx.processing_metadata else '{}'::jsonb end;
  v_raw:=case when jsonb_typeof(v_tx.raw_payload)='object' then v_tx.raw_payload else '{}'::jsonb end;
  v_outlet:=coalesce(nullif(public.pos_offline_trim(v_raw->>'storeId'),''),
    nullif(public.pos_offline_trim(v_meta->>'bridge_external_branch_id'),''));
  v_register:=coalesce(nullif(public.pos_offline_trim(v_raw->>'registerId'),''),
    nullif(public.pos_offline_trim(v_meta->>'bridge_external_terminal_id'),''));
  if lower(coalesce(v_tx.provider::text,'')) <> 'storehub'
     or v_tx.business_id::text is distinct from v_device.business_id::text
     or v_tx.integration_id::text is distinct from v_device.integration_id::text
     or v_tx.branch_id::text is distinct from v_device.branch_id::text
     or lower(coalesce(v_tx.transaction_type::text,'')) <> 'sale'
     or coalesce(v_tx.status::text,'') not in ('received','matched','processing','loyalty_applied')
     or v_meta->>'void_reversed_at' is not null
     or lower(coalesce(v_raw->>'isCancelled','false')) <> 'false'
     or v_outlet is distinct from public.pos_offline_trim(v_mapping.external_branch_id)
     or v_register is distinct from public.pos_offline_trim(v_device.metadata->>'external_terminal_id') then
    raise exception 'This POS receipt is no longer an eligible sale for this device, branch and register';
  end if;
  if v_tx.customer_id is not null and v_tx.customer_id::text is distinct from p_customer_id then
    raise exception using errcode='23505',message='This POS receipt is already linked to a different member';
  end if;
  -- Once the offline claim has established the receipt owner, duplicate saved
  -- events cannot prevent that owner from finishing. Their own claims will be
  -- rejected by the unique receipt binding and the immutable customer check.
  if not exists(select 1 from public.storehub_offline_sales owner
      where owner.id::text=v_meta->>'offline_sale_event_id'
        and owner.matched_transaction_id=p_transaction_id
        and owner.integration_id=v_tx.integration_id::text
        and v_tx.customer_id::text=p_customer_id)
    and exists(select 1 from public.storehub_offline_sales q
    where q.status in ('pending','awaiting_storehub','needs_review')
      and q.integration_id=v_tx.integration_id::text and q.branch_id=v_tx.branch_id::text
      and q.business_id=v_tx.business_id::text and q.currency=upper(v_tx.currency)
      and q.scope->>'external_branch_id'=v_outlet and q.scope->>'external_terminal_id'=v_register
      and q.final_amount=round(coalesce(v_tx.net_amount,v_tx.gross_amount),2)
      and v_tx.transacted_at between q.scanned_at-interval '10 seconds' and q.completed_at+interval '10 seconds'
      and (q.receipt_match_mode='amount'
        or (q.receipt_match_mode='full' and q.receipt_reference=public.pos_offline_trim(v_tx.external_receipt_number))
        or (q.receipt_match_mode='suffix5' and lower(q.receipt_reference)=right(public.pos_offline_receipt_key(v_tx.external_receipt_number),5)))
      ) then
    raise exception using errcode='40001',message='This receipt is reserved for a saved offline sale. Please wait for offline verification.';
  end if;
  if v_tx.customer_id is null then
    v_tx.customer_id:=(jsonb_populate_record(null::public.pos_transactions,jsonb_build_object('customer_id',p_customer_id))).customer_id;
    update public.pos_transactions set customer_id=v_tx.customer_id,updated_at=clock_timestamp() where id=v_tx.id returning * into v_tx;
  end if;
  return to_jsonb(v_tx);
end $$;

revoke all on function public.pos_offline_sale_assert_device(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.pos_offline_sale_lock_scope(text) from public,anon,authenticated;
revoke all on function public.pos_offline_sale_preserve_source() from public,anon,authenticated;
revoke all on function public.pos_offline_sale_enqueue(jsonb) from public,anon,authenticated;
revoke all on function public.pos_offline_sales_enqueue_batch(jsonb) from public,anon,authenticated;
revoke all on function public.pos_claim_offline_sales(integer,integer) from public,anon,authenticated;
revoke all on function public.pos_finish_offline_sale(text,text,text,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.pos_correct_offline_sale_receipt(text,text,text) from public,anon,authenticated;
revoke all on function public.pos_claim_offline_sale_transaction(text,text,text,text) from public,anon,authenticated;
revoke all on function public.pos_claim_companion_transaction_customer(text,text,text) from public,anon,authenticated;
grant execute on function public.pos_offline_trim(text),public.pos_offline_receipt_key(text) to public;
grant execute on function public.pos_offline_sale_assert_device(text,text,text,text,text,text),
  public.pos_offline_sale_lock_scope(text),public.pos_claim_companion_transaction_customer(text,text,text),
  public.pos_offline_sale_enqueue(jsonb),public.pos_offline_sales_enqueue_batch(jsonb),public.pos_claim_offline_sales(integer,integer),
  public.pos_finish_offline_sale(text,text,text,text,jsonb,integer),
  public.pos_correct_offline_sale_receipt(text,text,text),public.pos_claim_offline_sale_transaction(text,text,text,text) to service_role;
commit;
notify pgrst,'reload schema';

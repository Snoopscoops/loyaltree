-- Additive migration. Run after the existing Register ID, offline-sale and void SQL.
begin;
do $$ begin
  if to_regprocedure('public.pos_offline_sale_lock_scope(text)') is null
     or to_regclass('public.pos_redemption_reservations') is null
     or to_regclass('public.pos_coupon_reservations') is null
     or to_regclass('public.pos_benefit_reservations') is null
     or to_regclass('public.membership_benefit_redemptions') is null
     or to_regclass('public.wallet_sync_jobs') is null
     or to_regprocedure('public.pos_reverse_storehub_void(text,text)') is null then
    raise exception 'Install the existing POS reservation, offline-sale and StoreHub void migrations first';
  end if;
end $$;

alter table public.membership_benefit_redemptions add column if not exists pos_voided_at timestamptz;

create table if not exists public.pos_redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check(code ~ '^LT-[A-F0-9]{12}$'),
  device_id uuid not null, session_id uuid not null, integration_id uuid not null,
  business_id integer not null, branch_id integer not null,
  customer_id integer not null, earning_customer_id integer not null,
  external_branch_id text not null, external_terminal_id text not null,
  request_id uuid not null, request_hash text not null,
  kind text not null check(kind in ('points','coupon','benefit')),
  name text not null, instruction text not null,
  gross_amount numeric(18,2) not null check(gross_amount > 0 and gross_amount < 'Infinity'::numeric),
  discount_amount numeric(18,2) not null check(discount_amount >= 0 and discount_amount < 'Infinity'::numeric),
  expected_total numeric(18,2) not null check(expected_total >= 0 and expected_total < 'Infinity'::numeric),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  reservation_id uuid not null,
  payload jsonb not null,
  scanned_at timestamptz not null, expires_at timestamptz not null,
  status text not null default 'reserved' check(status in ('reserved','confirmed','needs_review','redeemed','cancelled','expired','reversed')),
  confirmed_at timestamptz, receipt_reference text not null default '',
  receipt_history jsonb not null default '[]'::jsonb,
  matched_transaction_id uuid unique, external_transaction_id text,
  lease_token uuid, lease_expires_at timestamptz,
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  message text, result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(device_id,request_id), unique(kind,reservation_id),
  check(gross_amount-discount_amount=expected_total),
  check(expires_at > scanned_at and isfinite(expires_at) and isfinite(scanned_at)),
  check(length(receipt_reference)<=200)
);
create unique index if not exists pos_redemption_codes_active_device_uidx
  on public.pos_redemption_codes(device_id) where status in ('reserved','confirmed','needs_review');
create index if not exists pos_redemption_codes_work_idx
  on public.pos_redemption_codes(next_attempt_at) where status in ('reserved','confirmed');
alter table public.pos_redemption_codes enable row level security;
revoke all on public.pos_redemption_codes from public,anon,authenticated;
grant all on public.pos_redemption_codes to service_role;

create or replace function public.pos_reserve_benefit(p_business_id integer,p_integration_id uuid,p_branch_id integer,p_device_id uuid,p_customer_id integer,p_program_id integer,
  p_provider text,p_reservation_key text,p_benefit_id text,p_benefit_name text,p_benefit_type text,p_benefit_value numeric,p_quantity integer,p_usage_limit integer,
  p_window_start timestamptz,p_window_end timestamptz,p_hold_minutes integer default 15)
returns setof pos_benefit_reservations language plpgsql security definer set search_path=public as $$
declare r pos_benefit_reservations%rowtype;used integer;held integer;
begin
  if p_quantity is null or p_quantity<=0 then raise exception 'Benefit quantity must be positive';end if;
  select * into r from pos_benefit_reservations where integration_id=p_integration_id and reservation_key=p_reservation_key limit 1;
  if found then return next r;return;end if;
  perform 1 from customers where id=p_customer_id and business_id=p_business_id for update;if not found then raise exception 'Customer not found';end if;
  select * into r from pos_benefit_reservations where integration_id=p_integration_id and reservation_key=p_reservation_key limit 1;
  if found then return next r;return;end if;
  update pos_benefit_reservations set status='expired' where customer_id=p_customer_id and benefit_id=p_benefit_id and status='reserved' and expires_at<=now();
  if p_usage_limit is not null then
    select coalesce(sum(quantity),0)::integer into used from membership_benefit_redemptions where business_id=p_business_id and customer_id=p_customer_id
      and benefit_id=p_benefit_id and pos_voided_at is null and (p_window_start is null or redeemed_at>=p_window_start) and (p_window_end is null or redeemed_at<p_window_end);
    select coalesce(sum(quantity),0)::integer into held from pos_benefit_reservations where business_id=p_business_id and customer_id=p_customer_id
      and benefit_id=p_benefit_id and status='reserved' and expires_at>now()
      and (p_window_start is null or created_at>=p_window_start) and (p_window_end is null or created_at<p_window_end);
    if used+held+p_quantity>p_usage_limit then raise exception 'Employee benefit usage limit reached';end if;
  end if;
  insert into pos_benefit_reservations(business_id,integration_id,branch_id,device_id,customer_id,program_id,provider,reservation_key,benefit_id,benefit_name,
    benefit_type,benefit_value,quantity,usage_limit,window_start,window_end,expires_at)
    values(p_business_id,p_integration_id,p_branch_id,p_device_id,p_customer_id,p_program_id,p_provider,p_reservation_key,p_benefit_id,p_benefit_name,
    p_benefit_type,p_benefit_value,p_quantity,p_usage_limit,p_window_start,p_window_end,now()+make_interval(mins=>greatest(1,least(coalesce(p_hold_minutes,15),120))))
    returning * into r;return next r;
end $$;

-- Other staff screens spend only points left after active POS holds.
-- The operation UUID makes response-loss retries deduct once.
create table if not exists public.pos_points_prize_spends (
  operation_id uuid primary key,business_id integer not null,customer_id integer not null,
  points integer not null check(points>0),balance_after integer not null,created_at timestamptz not null default now()
);
alter table public.pos_points_prize_spends enable row level security;
revoke all on public.pos_points_prize_spends from public,anon,authenticated;
grant all on public.pos_points_prize_spends to service_role;
create or replace function public.pos_spend_available_prize_points(p_business_id integer,p_customer_id integer,p_points integer,p_operation_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_prior public.pos_points_prize_spends%rowtype;v_balance integer;v_held integer;
begin
  if p_points is null or p_points<=0 then raise exception 'Prize cost must be positive';end if;
  select points_balance into v_balance from public.customers where id=p_customer_id and business_id=p_business_id for update;
  if not found then raise exception 'Customer not found';end if;
  select * into v_prior from public.pos_points_prize_spends where operation_id=p_operation_id;
  if found then
    if v_prior.business_id<>p_business_id or v_prior.customer_id<>p_customer_id or v_prior.points<>p_points then
      raise exception 'Points operation belongs to another request';end if;
    return v_prior.balance_after;
  end if;
  select coalesce(sum(points_reserved),0)::integer into v_held from public.pos_redemption_reservations
    where customer_id=p_customer_id and business_id=p_business_id and status in ('reserved','discount_applied') and expires_at>now();
  if coalesce(v_balance,0)-v_held<p_points then
    raise exception 'Not enough available points. Points reserved for a POS reward cannot be spent again';end if;
  update public.customers set points_balance=v_balance-p_points,updated_at=now() where id=p_customer_id;
  insert into public.pos_points_prize_spends(operation_id,business_id,customer_id,points,balance_after)
    values(p_operation_id,p_business_id,p_customer_id,p_points,v_balance-p_points);
  return v_balance-p_points;
end $$;

create or replace function public.pos_redemption_note_text(p_raw jsonb,p_depth integer default 0)
returns text language plpgsql immutable set search_path=public as $$
declare v_key text;v_value jsonb;v_result text:='';
begin
  if p_depth>6 then return ''; end if;
  if jsonb_typeof(p_raw)='object' then
    for v_key,v_value in select * from jsonb_each(p_raw) loop
      if lower(v_key) in ('note','notes','comment','remarks') and jsonb_typeof(v_value)='string' then
        v_result:=v_result||' '||(v_value#>>'{}');
      elsif jsonb_typeof(v_value) in ('object','array') then
        v_result:=v_result||' '||public.pos_redemption_note_text(v_value,p_depth+1);
      end if;
    end loop;
  elsif jsonb_typeof(p_raw)='array' then
    for v_value in select value from jsonb_array_elements(p_raw) loop
      v_result:=v_result||' '||public.pos_redemption_note_text(v_value,p_depth+1);
    end loop;
  end if;
  return v_result;
end $$;

create or replace function public.pos_redemption_code_snapshot_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if (to_jsonb(new)-array['status','expires_at','confirmed_at','receipt_reference','receipt_history',
      'matched_transaction_id','external_transaction_id','lease_token','lease_expires_at','attempts','next_attempt_at','message','result','updated_at'])
    is distinct from (to_jsonb(old)-array['status','expires_at','confirmed_at','receipt_reference','receipt_history',
      'matched_transaction_id','external_transaction_id','lease_token','lease_expires_at','attempts','next_attempt_at','message','result','updated_at']) then
    raise exception 'An issued reward code snapshot cannot be changed';end if;
  if old.status in ('redeemed','cancelled','expired','reversed') and new.status is distinct from old.status
    and not(old.status='redeemed' and new.status='reversed') then
    raise exception 'A used or closed code cannot be reused';end if;
  return new;
end $$;
drop trigger if exists pos_redemption_code_snapshot_guard on public.pos_redemption_codes;
create trigger pos_redemption_code_snapshot_guard before update on public.pos_redemption_codes
  for each row execute function public.pos_redemption_code_snapshot_guard();

-- The code and the existing reward reservation commit in one transaction.
create or replace function public.pos_issue_redemption_code(
  p_device_id text,p_session_id text,p_request_id text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_device public.pos_devices%rowtype;v_session public.pos_companion_sessions%rowtype;
  v_customer public.customers%rowtype;v_source public.customers%rowtype;
  v_row public.pos_redemption_codes%rowtype;v_reservation jsonb;v_id uuid:=gen_random_uuid();
  v_code text;v_kind text:=p_payload->>'kind';v_key text;v_locked text;
begin
  select * into v_device from public.pos_devices where id::text=p_device_id;
  if not found then raise exception 'POS device not found'; end if;
  v_locked:=v_device.integration_id::text;
  perform public.pos_offline_sale_lock_scope(v_locked);
  select * into v_device from public.pos_devices where id::text=p_device_id for share;
  if v_device.integration_id::text is distinct from v_locked then raise exception 'POS connection changed'; end if;
  perform public.pos_offline_sale_assert_device(p_device_id,v_device.business_id::text,
    v_device.branch_id::text,v_locked,p_payload->>'external_branch_id',p_payload->>'external_terminal_id');
  select * into v_row from public.pos_redemption_codes where device_id=v_device.id and request_id=p_request_id::uuid;
  if found then
    if v_row.request_hash is distinct from p_payload->>'request_hash' or v_row.session_id::text<>p_session_id then
      raise exception 'This retry belongs to a different reward request';
    end if;
    return to_jsonb(v_row);
  end if;
  if exists(select 1 from public.pos_redemption_codes where device_id=v_device.id
    and status in ('reserved','confirmed','needs_review')) then
    raise exception 'Finish or cancel the current reward before generating another code';
  end if;
  select * into v_session from public.pos_companion_sessions where id::text=p_session_id for update;
  if not found or v_session.device_id<>v_device.id or v_session.business_id<>v_device.business_id
    or v_session.branch_id<>v_device.branch_id or v_session.integration_id<>v_device.integration_id
    or v_session.status not in ('waiting_for_sale','matching') or v_session.expires_at<=now()
    or v_session.matched_pos_transaction_id is not null then
    raise exception 'Scan the customer before starting this StoreHub bill';
  end if;
  select * into v_source from public.customers where public_id=v_session.source_customer_public_id;
  select * into v_customer from public.customers where id=(p_payload->>'customer_id')::integer;
  if not found or v_source.id is null or v_customer.business_id is distinct from v_device.business_id or v_source.business_id is distinct from v_device.business_id
    or (v_customer.id<>v_source.id and (v_source.identity_id is null or v_customer.identity_id is distinct from v_source.identity_id)) then
    raise exception 'This reward belongs to another customer identity';
  end if;
  if (p_payload->>'earning_customer_id')::integer<>v_session.customer_id and v_kind<>'points' then
    raise exception 'The earning membership changed';
  end if;
  if v_kind='points' and (p_payload->>'earning_customer_id')::integer<>v_customer.id then
    raise exception 'The points membership changed';
  end if;
  if exists(select 1 from public.pos_transactions t where t.integration_id=v_device.integration_id
    and t.branch_id=v_device.branch_id and t.customer_id=v_session.customer_id
    and t.transacted_at>=v_session.scanned_at-interval '5 seconds'
    and t.status in ('received','matched','processing','loyalty_applied')) then
    raise exception 'A receipt is already being processed for this scan. Start a new checkout before redeeming';
  end if;
  if exists(select 1 from public.pos_redemption_reservations r where r.id::text=v_session.result->>'redemption_reservation_id'
      and r.status in ('reserved','discount_applied') and r.expires_at>now())
    or exists(select 1 from public.pos_coupon_reservations where device_id=v_device.id and status='reserved' and expires_at>now())
    or exists(select 1 from public.pos_benefit_reservations where device_id=v_device.id and status='reserved' and expires_at>now()) then
    raise exception 'Release the existing reward reservation before creating a code';
  end if;
  v_code:='LT-'||upper(substr(replace(v_id::text,'-',''),1,12));v_key:='LT-CODE:'||v_id::text;
  if v_kind='points' then
    select to_jsonb(r) into v_reservation from public.pos_reserve_points_redemption(
      v_device.business_id,v_device.integration_id,v_device.branch_id,v_customer.id,
      (p_payload->>'program_id')::integer,'storehub',v_key,(p_payload->>'points')::integer,
      (p_payload->>'value_per_point')::numeric,(p_payload->>'gross_amount')::numeric,
      (p_payload->>'max_percent')::numeric,(p_payload->>'hold_minutes')::integer) r;
    if (v_reservation->>'redemption_amount')::numeric<>(p_payload->>'discount_amount')::numeric then
      raise exception 'The points discount changed. Refresh and select it again';
    end if;
  elsif v_kind='coupon' then
    perform 1 from public.coupons where id=(p_payload->>'coupon_id')::integer
      and (source is null or lower(source)<>'campaign')
      and (starts_at is null or starts_at<=coalesce((p_payload->>'loyalty_date')::date,current_date))
      and (expires_at is null or expires_at>=coalesce((p_payload->>'loyalty_date')::date,current_date)) for update;
    if not found then raise exception 'Coupon is not usable on this date or requires the campaign redemption screen';end if;
    select to_jsonb(r) into v_reservation from public.pos_reserve_coupon(
      v_device.business_id,v_device.integration_id,v_device.branch_id,v_device.id,v_customer.id,
      (p_payload->>'program_id')::integer,(p_payload->>'coupon_id')::integer,'storehub',v_key,
      (p_payload->>'gross_amount')::numeric,(p_payload->>'hold_minutes')::integer) r;
    update public.pos_coupon_reservations set discount_amount=(p_payload->>'discount_amount')::numeric
      where id=(v_reservation->>'id')::uuid;
  elsif v_kind='benefit' then
    select to_jsonb(r) into v_reservation from public.pos_reserve_benefit(
      v_device.business_id,v_device.integration_id,v_device.branch_id,v_device.id,v_customer.id,
      (p_payload->>'program_id')::integer,'storehub',v_key,p_payload->>'reward_id',p_payload->>'name',
      p_payload->>'benefit_type',(p_payload->>'benefit_value')::numeric,1,(p_payload->>'usage_limit')::integer,
      (p_payload->>'window_start')::timestamptz,(p_payload->>'window_end')::timestamptz,
      (p_payload->>'hold_minutes')::integer) r;
  else raise exception 'Unsupported reward kind';
  end if;
  if v_reservation is null or v_reservation->>'status'<>'reserved' then raise exception 'Reward was not reserved'; end if;
  insert into public.pos_redemption_codes(id,code,device_id,session_id,integration_id,business_id,branch_id,
    customer_id,earning_customer_id,external_branch_id,external_terminal_id,request_id,request_hash,
    kind,name,instruction,gross_amount,discount_amount,expected_total,currency,reservation_id,payload,scanned_at,expires_at)
  values(v_id,v_code,v_device.id,v_session.id,v_device.integration_id,v_device.business_id,v_device.branch_id,
    v_customer.id,(p_payload->>'earning_customer_id')::integer,p_payload->>'external_branch_id',p_payload->>'external_terminal_id',
    p_request_id::uuid,p_payload->>'request_hash',v_kind,p_payload->>'name',p_payload->>'instruction',
    (p_payload->>'gross_amount')::numeric,(p_payload->>'discount_amount')::numeric,(p_payload->>'expected_total')::numeric,
    p_payload->>'currency',(v_reservation->>'id')::uuid,p_payload,v_session.scanned_at,(v_reservation->>'expires_at')::timestamptz)
  returning * into v_row;
  update public.pos_companion_sessions set result=result||jsonb_build_object('manual_redemption_code_id',v_id::text),
    expires_at=v_row.expires_at,updated_at=now() where id=v_session.id;
  return to_jsonb(v_row);
end $$;

create or replace function public.pos_confirm_redemption_code(p_device_id text,p_id text,p_receipt_reference text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pos_redemption_codes%rowtype;v_expiry timestamptz;
begin
  select * into v_row from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found'; end if;
  perform public.pos_offline_sale_lock_scope(v_row.integration_id::text);
  select * into v_row from public.pos_redemption_codes where id::text=p_id for update;
  if v_row.device_id::text<>p_device_id then raise exception 'This code belongs to another POS device'; end if;
  perform public.pos_offline_sale_assert_device(p_device_id,v_row.business_id::text,v_row.branch_id::text,
    v_row.integration_id::text,v_row.external_branch_id,v_row.external_terminal_id);
  if v_row.status='redeemed' then return to_jsonb(v_row); end if;
  if v_row.status not in ('reserved','confirmed','needs_review') or (v_row.confirmed_at is null and v_row.expires_at<=now()) then
    raise exception 'Reward reservation expired or is no longer active';
  end if;
  if length(btrim(coalesce(p_receipt_reference,'')))>200 then raise exception 'Receipt number is too long'; end if;
  if v_row.matched_transaction_id is not null then
    if v_row.receipt_reference<>btrim(coalesce(p_receipt_reference,'')) then raise exception 'The verified receipt cannot be changed'; end if;
    return to_jsonb(v_row);
  end if;
  if v_row.lease_expires_at>now() then raise exception 'Receipt verification is already being processed. Please wait.'; end if;
  v_expiry:=coalesce(v_row.confirmed_at,now())+interval '24 hours';
  if v_row.kind='points' then
    update public.pos_redemption_reservations set expires_at='infinity'::timestamptz where id=v_row.reservation_id and status='reserved' and expires_at>now();
  elsif v_row.kind='coupon' then
    update public.pos_coupon_reservations set expires_at='infinity'::timestamptz where id=v_row.reservation_id and status='reserved' and expires_at>now();
  else
    update public.pos_benefit_reservations set expires_at='infinity'::timestamptz where id=v_row.reservation_id and status='reserved' and expires_at>now();
  end if;
  if not found then raise exception 'The underlying reward hold is no longer active'; end if;
  update public.pos_redemption_codes set status='confirmed',confirmed_at=coalesce(confirmed_at,now()),expires_at=v_expiry,
    receipt_history=receipt_history||jsonb_build_array(jsonb_build_object('previous',receipt_reference,'receipt',btrim(coalesce(p_receipt_reference,'')),'at',now())),
    receipt_reference=btrim(coalesce(p_receipt_reference,'')),next_attempt_at=now(),
    message='Discount confirmed by cashier. Waiting for StoreHub receipt verification.',updated_at=now()
    where id=v_row.id returning * into v_row;
  update public.pos_companion_sessions set expires_at=v_expiry,updated_at=now() where id=v_row.session_id;
  return to_jsonb(v_row);
end $$;

create or replace function public.pos_cancel_redemption_code(p_device_id text,p_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pos_redemption_codes%rowtype;
begin
  select * into v_row from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found'; end if;
  perform public.pos_offline_sale_lock_scope(v_row.integration_id::text);
  select * into v_row from public.pos_redemption_codes where id::text=p_id for update;
  if v_row.device_id::text<>p_device_id then raise exception 'This code belongs to another POS device'; end if;
  if v_row.status in ('cancelled','expired') then return to_jsonb(v_row); end if;
  perform public.pos_offline_sale_assert_device(p_device_id,v_row.business_id::text,v_row.branch_id::text,
    v_row.integration_id::text,v_row.external_branch_id,v_row.external_terminal_id);
  if v_row.confirmed_at is not null or v_row.matched_transaction_id is not null or v_row.lease_expires_at>now() then
    raise exception 'The discount was confirmed. Void the StoreHub sale and let verification release the reward';
  end if;
  if v_row.kind='points' then perform public.pos_release_points_redemption(v_row.reservation_id,'unused_code_cancelled');
  elsif v_row.kind='coupon' then perform public.pos_release_coupon(v_row.reservation_id,'unused_code_cancelled');
  else perform public.pos_release_benefit(v_row.reservation_id,'unused_code_cancelled');end if;
  update public.pos_redemption_codes set status='cancelled',message='Unused reward reservation released.',updated_at=now()
    where id=v_row.id returning * into v_row;
  update public.pos_companion_sessions set result=result-'manual_redemption_code_id',
    expires_at=now()+interval '5 minutes',updated_at=now() where id=v_row.session_id;
  return to_jsonb(v_row);
end $$;

create or replace function public.pos_claim_redemption_codes(p_limit integer default 1)
returns setof jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_limit not between 1 and 20 then raise exception 'Claim 1-20 codes';end if;
  return query with due as (
    select id from public.pos_redemption_codes where
      ((status='confirmed' and next_attempt_at<=now()) or (status='reserved' and expires_at<=now())
        or (status in ('redeemed','needs_review') and matched_transaction_id is not null and next_attempt_at<=now() and exists(select 1 from public.pos_transactions t
          where t.id=matched_transaction_id and (t.status='voided' or t.transaction_type='void'
            or lower(coalesce(t.raw_payload->>'isCancelled','false'))='true' or t.processing_metadata->>'void_reversed_at' is not null))))
      and (lease_expires_at is null or lease_expires_at<=now())
      order by next_attempt_at,created_at for update skip locked limit p_limit
  ), claimed as (
    update public.pos_redemption_codes c set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',
      attempts=attempts+1,updated_at=now() from due where c.id=due.id returning c.*
  ) select to_jsonb(claimed)||jsonb_build_object('void_detected',exists(select 1 from public.pos_transactions t
      where t.id=claimed.matched_transaction_id and (t.status='voided' or t.transaction_type='void'
        or lower(coalesce(t.raw_payload->>'isCancelled','false'))='true' or t.processing_metadata->>'void_reversed_at' is not null))) from claimed;
end $$;

create or replace function public.pos_claim_redemption_receipt(p_id text,p_lease text,p_transaction_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pos_redemption_codes%rowtype;v_tx public.pos_transactions%rowtype;v_codes text[];v_raw jsonb;
begin
  select * into v_row from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found';end if;
  perform public.pos_offline_sale_lock_scope(v_row.integration_id::text);
  select * into v_row from public.pos_redemption_codes where id::text=p_id for update;
  if v_row.status<>'confirmed' or v_row.lease_token::text is distinct from p_lease or v_row.lease_expires_at<=now() then
    raise exception 'Reward verification lease expired';end if;
  perform public.pos_offline_sale_assert_device(v_row.device_id::text,v_row.business_id::text,v_row.branch_id::text,
    v_row.integration_id::text,v_row.external_branch_id,v_row.external_terminal_id);
  select * into v_tx from public.pos_transactions where id::text=p_transaction_id for update;
  if not found then raise exception 'StoreHub receipt not found';end if;
  v_raw:=coalesce(v_tx.raw_payload,'{}'::jsonb);
  select coalesce(array_agg(distinct m[1]),'{}') into v_codes from
    regexp_matches(upper(public.pos_redemption_note_text(v_raw)),'\mLT-[A-Z0-9]{8,16}\M','g') m;
  if v_tx.business_id<>v_row.business_id or v_tx.branch_id is distinct from v_row.branch_id
    or v_tx.integration_id<>v_row.integration_id or v_tx.provider<>'storehub' or v_tx.transaction_type<>'sale'
    or v_tx.status in ('voided','refunded','ignored','failed') or v_tx.processing_metadata->>'void_reversed_at' is not null
    or lower(coalesce(v_raw->>'isCancelled','false'))<>'false'
    or coalesce(v_raw->>'storeId',v_tx.processing_metadata->>'bridge_external_branch_id') is distinct from v_row.external_branch_id
    or coalesce(v_raw->>'registerId',v_tx.processing_metadata->>'bridge_external_terminal_id') is distinct from v_row.external_terminal_id
    or upper(v_tx.currency) is distinct from v_row.currency or round(coalesce(v_tx.net_amount,v_tx.gross_amount),2) is distinct from v_row.expected_total
    or v_tx.transacted_at is null or v_tx.transacted_at<v_row.scanned_at-interval '10 seconds'
    or v_tx.transacted_at>(case when v_row.receipt_reference<>'' then v_row.expires_at else least(v_row.confirmed_at+interval '10 minutes',v_row.expires_at) end)
    or (v_row.discount_amount>0 and (v_raw->>'discount' is null or (v_raw->>'discount')::numeric<v_row.discount_amount))
    or (v_row.kind='coupon' and v_row.payload->>'stacking_allowed'='false' and coalesce((v_raw->>'discount')::numeric,0)<>v_row.discount_amount)
    or (v_row.receipt_reference<>'' and btrim(v_tx.external_receipt_number) is distinct from v_row.receipt_reference)
    or (v_row.receipt_reference='' and not(v_row.code=any(v_codes)))
    or (cardinality(v_codes)>0 and (cardinality(v_codes)<>1 or not(v_row.code=any(v_codes)))) then
    raise exception 'StoreHub receipt does not match the reward code, discount, total, time, branch and register';
  end if;
  if v_tx.customer_id is not null and v_tx.customer_id<>v_row.earning_customer_id then raise exception 'Receipt belongs to another customer';end if;
  if v_tx.status='loyalty_applied' and v_tx.processing_metadata->>'manual_redemption_code_id' is distinct from v_row.id::text then
    raise exception 'This sale already completed without this redemption';end if;
  if v_tx.processing_metadata->>'offline_sale_event_id' is not null then raise exception 'This receipt belongs to an offline earning event';end if;
  if v_row.matched_transaction_id is not null and v_row.matched_transaction_id<>v_tx.id then raise exception 'Code already belongs to another receipt';end if;
  update public.pos_redemption_codes set matched_transaction_id=v_tx.id,external_transaction_id=v_tx.external_transaction_id,
    updated_at=now() where id=v_row.id;
  update public.pos_transactions set customer_id=v_row.earning_customer_id,
    processing_metadata=processing_metadata||jsonb_build_object('manual_redemption_code_id',v_row.id::text,'manual_redemption_code',v_row.code),
    updated_at=clock_timestamp() where id=v_tx.id returning * into v_tx;
  return to_jsonb(v_tx);
end $$;

create or replace function public.pos_finish_redemption_code(p_id text,p_lease text,p_status text,p_message text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.pos_redemption_codes%rowtype;
begin
  if p_status not in ('reserved','confirmed','needs_review','redeemed','cancelled','expired') then raise exception 'Invalid code status';end if;
  select * into v_row from public.pos_redemption_codes where id::text=p_id for update;
  if not found or v_row.lease_token::text is distinct from p_lease or v_row.lease_expires_at<=now() then
    raise exception 'Reward verification lease expired';end if;
  if p_status='redeemed' then
    if v_row.status<>'confirmed' or v_row.matched_transaction_id is null or not exists(
      select 1 from public.pos_transactions where id=v_row.matched_transaction_id
        and customer_id=v_row.earning_customer_id and status='loyalty_applied'
        and processing_metadata->>'manual_redemption_code_id'=v_row.id::text) then
      raise exception 'A completed verified receipt is required before marking redeemed';end if;
    if not ((v_row.kind='points' and exists(select 1 from public.pos_redemption_reservations where id=v_row.reservation_id and status='committed'))
      or (v_row.kind='coupon' and exists(select 1 from public.pos_coupon_reservations where id=v_row.reservation_id and status='committed'))
      or (v_row.kind='benefit' and exists(select 1 from public.pos_benefit_reservations where id=v_row.reservation_id and status='committed'))) then
      raise exception 'The verified reward has not been committed';end if;
  elsif p_status in ('cancelled','expired') and v_row.confirmed_at is not null then
    raise exception 'A confirmed code can only be released by a verified void';
  end if;
  update public.pos_redemption_codes set status=p_status,message=left(p_message,1000),result=coalesce(p_result,'{}'::jsonb),
    lease_token=null,lease_expires_at=null,next_attempt_at=now()+interval '30 seconds',updated_at=now()
    where id::text=p_id and lease_token::text=p_lease and lease_expires_at>now()
    returning * into v_row;
  if not found then raise exception 'Reward verification lease expired';end if;
  if p_status='expired' then
    update public.pos_companion_sessions set status='expired',error_message='Unused reward reservation expired.',updated_at=now() where id=v_row.session_id;
  end if;
  if p_status='redeemed' then
    update public.pos_companion_sessions set status='completed',matched_pos_transaction_id=v_row.matched_transaction_id,
      external_transaction_id=v_row.external_transaction_id,gross_amount=v_row.expected_total,currency=v_row.currency,
      result=result||coalesce(p_result,'{}'::jsonb)||jsonb_build_object('manual_redemption_code_id',v_row.id::text),
      completed_at=now(),updated_at=now() where id=v_row.session_id;
  end if;
  return to_jsonb(v_row);
end $$;

-- A normal online poll cannot consume a receipt while its register has an
create or replace function public.pos_commit_code_reward(p_id text,p_lease text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code public.pos_redemption_codes%rowtype;v_tx public.pos_transactions%rowtype;v_result jsonb;
  v_benefit public.pos_benefit_reservations%rowtype;v_ledger_id bigint;v_used integer;
begin
  select * into v_code from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found';end if;
  perform public.pos_offline_sale_lock_scope(v_code.integration_id::text);
  select * into v_code from public.pos_redemption_codes where id::text=p_id for update;
  if v_code.status<>'confirmed' or v_code.lease_token::text is distinct from p_lease or v_code.lease_expires_at<=now()
    or v_code.matched_transaction_id is null then raise exception 'A verified receipt and active lease are required';end if;
  select * into v_tx from public.pos_transactions where id=v_code.matched_transaction_id for update;
  if v_tx.status in ('voided','refunded','ignored','failed') or v_tx.transaction_type<>'sale'
    or lower(coalesce(v_tx.raw_payload->>'isCancelled','false'))<>'false'
    or v_tx.processing_metadata->>'void_reversed_at' is not null then raise exception 'This sale was voided before redemption';end if;
  perform set_config('loyaltree.redemption_code_id',v_code.id::text,true);
  if v_code.kind='points' then
    perform public.pos_mark_redemption_discount_applied(v_code.reservation_id,v_tx.external_transaction_id,
      jsonb_build_object('checkout_mode','companion_code','code',v_code.code,'receipt_verified',true));
    select to_jsonb(r) into v_result from public.pos_commit_points_redemption(v_code.reservation_id,v_tx.external_transaction_id) r;
  elsif v_code.kind='coupon' then
    select to_jsonb(r) into v_result from public.pos_commit_coupon(v_code.reservation_id,v_tx.external_transaction_id) r;
  else
    select * into v_benefit from public.pos_benefit_reservations where id=v_code.reservation_id for update;
    perform 1 from public.customers where id=v_code.customer_id and business_id=v_code.business_id for update;
    if not found then raise exception 'Employee membership no longer exists';end if;
    if v_benefit.status='committed' then return to_jsonb(v_benefit);end if;
    if v_benefit.status<>'reserved' or v_benefit.expires_at<=now()
      or (v_benefit.window_start is not null and v_tx.transacted_at<v_benefit.window_start)
      or (v_benefit.window_end is not null and v_tx.transacted_at>=v_benefit.window_end) then
      raise exception 'This sale falls outside the reserved employee benefit period';end if;
    select id into v_ledger_id from public.membership_benefit_redemptions where business_id=v_code.business_id
      and idempotency_key='pos-benefit:'||v_benefit.id::text limit 1;
    if not found then
      select coalesce(sum(quantity),0)::integer into v_used from public.membership_benefit_redemptions
        where business_id=v_code.business_id and customer_id=v_code.customer_id and benefit_id=v_benefit.benefit_id
          and pos_voided_at is null
          and (v_benefit.window_start is null or redeemed_at>=v_benefit.window_start)
          and (v_benefit.window_end is null or redeemed_at<v_benefit.window_end);
      if v_benefit.usage_limit is not null and v_used+v_benefit.quantity>v_benefit.usage_limit then
        raise exception 'Employee benefit usage limit reached';end if;
      insert into public.membership_benefit_redemptions(business_id,customer_id,benefit_id,benefit_name,benefit_type,benefit_value,
        quantity,branch_id,note,idempotency_key,redeemed_at)
      values(v_code.business_id,v_code.customer_id,v_benefit.benefit_id,v_benefit.benefit_name,v_benefit.benefit_type,v_benefit.benefit_value,
        v_benefit.quantity,v_code.branch_id,v_code.code||' · StoreHub receipt '||v_tx.external_receipt_number,
        'pos-benefit:'||v_benefit.id::text,v_tx.transacted_at) returning id into v_ledger_id;
    end if;
    update public.pos_benefit_reservations set status='committed',committed_at=now(),updated_at=now(),
      external_transaction_id=v_tx.external_transaction_id,committed_redemption_id=v_ledger_id,
      metadata=metadata||jsonb_build_object('manual_redemption_code',v_code.code)
      where id=v_benefit.id returning to_jsonb(pos_benefit_reservations.*) into v_result;
  end if;
  if v_result->>'status'<>'committed' then raise exception 'The reward was not committed';end if;
  return v_result;
end $$;

create or replace function public.pos_guard_coded_reservation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_code public.pos_redemption_codes%rowtype;
begin
  if new.status is not distinct from old.status then return new;end if;
  select * into v_code from public.pos_redemption_codes where reservation_id=old.id
    and kind=(case tg_table_name when 'pos_redemption_reservations' then 'points' when 'pos_coupon_reservations' then 'coupon' else 'benefit' end)
    and status in ('reserved','confirmed','needs_review','redeemed');
  if not found then return new;end if;
  if new.status in ('discount_applied','committed') and current_setting('loyaltree.redemption_code_id',true) is distinct from v_code.id::text then
    raise exception 'This reward code requires verified receipt processing';end if;
  if new.status in ('released','expired','cancelled') and v_code.confirmed_at is not null
    and current_setting('loyaltree.redemption_code_id',true) is distinct from v_code.id::text then
    raise exception 'A confirmed reward code requires a verified StoreHub void before release';end if;
  return new;
end $$;
drop trigger if exists pos_points_code_reservation_guard on public.pos_redemption_reservations;
create trigger pos_points_code_reservation_guard before update of status on public.pos_redemption_reservations
  for each row execute function public.pos_guard_coded_reservation();
drop trigger if exists pos_coupon_code_reservation_guard on public.pos_coupon_reservations;
create trigger pos_coupon_code_reservation_guard before update of status on public.pos_coupon_reservations
  for each row execute function public.pos_guard_coded_reservation();
drop trigger if exists pos_benefit_code_reservation_guard on public.pos_benefit_reservations;
create trigger pos_benefit_code_reservation_guard before update of status on public.pos_benefit_reservations
  for each row execute function public.pos_guard_coded_reservation();

create or replace function public.pos_guard_reserved_benefit_code()
returns trigger language plpgsql security definer set search_path=public as $$
declare h public.pos_benefit_reservations%rowtype;v_used integer;v_held integer;v_own uuid;
begin
  perform 1 from public.customers where id=new.customer_id and business_id=new.business_id for update;
  if not found then raise exception 'Benefit customer not found';end if;
  select reservation_id into v_own from public.pos_redemption_codes where kind='benefit'
    and id::text=current_setting('loyaltree.redemption_code_id',true);
  for h in select r.* from public.pos_benefit_reservations r join public.pos_redemption_codes c on c.reservation_id=r.id and c.kind='benefit'
    where r.business_id=new.business_id and r.customer_id=new.customer_id and r.benefit_id=new.benefit_id
      and r.status='reserved' and r.expires_at>now() and c.status in ('reserved','confirmed','needs_review')
      and r.usage_limit is not null
      and (r.window_start is null or new.redeemed_at>=r.window_start) and (r.window_end is null or new.redeemed_at<r.window_end)
  loop
    select coalesce(sum(quantity),0)::integer into v_used from public.membership_benefit_redemptions
      where business_id=new.business_id and customer_id=new.customer_id and benefit_id=new.benefit_id and pos_voided_at is null
        and (h.window_start is null or redeemed_at>=h.window_start) and (h.window_end is null or redeemed_at<h.window_end);
    select coalesce(sum(quantity),0)::integer into v_held from public.pos_benefit_reservations
      where business_id=new.business_id and customer_id=new.customer_id and benefit_id=new.benefit_id
        and status='reserved' and expires_at>now() and id is distinct from v_own
        and (h.window_start is null or created_at>=h.window_start) and (h.window_end is null or created_at<h.window_end);
    if v_used+v_held+new.quantity>h.usage_limit then
      raise exception 'Employee benefit is reserved on a StoreHub checkout. Finish or cancel its code first';end if;
  end loop;
  return new;
end $$;
drop trigger if exists membership_benefits_reserved_code_guard on public.membership_benefit_redemptions;
create trigger membership_benefits_reserved_code_guard before insert on public.membership_benefit_redemptions
  for each row execute function public.pos_guard_reserved_benefit_code();

create or replace function public.pos_guard_reserved_coupon_code()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='redeemed' and old.status is distinct from 'redeemed' and exists(
    select 1 from public.pos_redemption_codes c join public.pos_coupon_reservations r on r.id=c.reservation_id
    where c.kind='coupon' and r.coupon_id=new.id and c.status in ('reserved','confirmed','needs_review')
      and current_setting('loyaltree.redemption_code_id',true) is distinct from c.id::text) then
    raise exception 'This reward is reserved on a StoreHub checkout. Finish or cancel its code first';
  end if;
  return new;
end $$;
drop trigger if exists coupons_reserved_code_guard on public.coupons;
create trigger coupons_reserved_code_guard before update of status on public.coupons
  for each row execute function public.pos_guard_reserved_coupon_code();

-- A normal online poll cannot consume a receipt while its register has an
-- unfinished code. The code worker sets its ownership marker in the same UPDATE.
create or replace function public.pos_guard_code_receipt_customer()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_code public.pos_redemption_codes%rowtype;v_register text;
begin
  if new.customer_id is null or new.customer_id is not distinct from old.customer_id or new.provider<>'storehub' then return new;end if;
  v_register:=coalesce(new.raw_payload->>'registerId',new.processing_metadata->>'bridge_external_terminal_id');
  select * into v_code from public.pos_redemption_codes where integration_id=new.integration_id
    and branch_id=new.branch_id and external_terminal_id=v_register
    and status in ('reserved','confirmed','needs_review')
    and new.transacted_at>=scanned_at-interval '5 seconds' and new.transacted_at<=expires_at limit 1;
  if found and (new.processing_metadata->>'manual_redemption_code_id' is distinct from v_code.id::text
    or v_code.matched_transaction_id is distinct from new.id or new.customer_id<>v_code.earning_customer_id) then
    raise exception using errcode='40001',message='This checkout has a reserved reward code. Please wait for receipt verification.';
  end if;
  return new;
end $$;
drop trigger if exists pos_transactions_code_customer_guard on public.pos_transactions;
create trigger pos_transactions_code_customer_guard before update of customer_id on public.pos_transactions
  for each row execute function public.pos_guard_code_receipt_customer();

-- Keep ordinary polling/void scans from interrupting a coded reward between
-- its commit and the earning acknowledgement. A leased code worker can record
-- the verified provider void and reconcile both parts together.
create or replace function public.pos_guard_code_processing_void()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_code public.pos_redemption_codes%rowtype;
begin
  if new.status='loyalty_applied' and (old.status in ('voided','refunded') or old.transaction_type in ('void','refund')
      or old.processing_metadata->>'void_reversed_at' is not null or lower(coalesce(old.raw_payload->>'isCancelled','false'))='true') then
    if exists(select 1 from public.pos_redemption_codes where matched_transaction_id=old.id) then
      raise exception using errcode='40001',message='StoreHub void arrived before the reward acknowledgement. Retry reconciliation.';end if;
  end if;
  if not(new.status='voided' or new.transaction_type='void' or lower(coalesce(new.raw_payload->>'isCancelled','false'))='true') then return new;end if;
  select * into v_code from public.pos_redemption_codes where matched_transaction_id=old.id and status in ('confirmed','needs_review');
  if found and current_setting('loyaltree.redemption_code_id',true) is distinct from v_code.id::text then
    raise exception using errcode='40001',message='This reward checkout is being processed. Its code worker will reconcile the StoreHub void.';end if;
  return new;
end $$;
drop trigger if exists pos_transactions_code_void_guard on public.pos_transactions;
create trigger pos_transactions_code_void_guard before update on public.pos_transactions
  for each row execute function public.pos_guard_code_processing_void();

create or replace function public.pos_record_code_void(p_id text,p_lease text,p_external_id text,p_raw jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.pos_redemption_codes%rowtype;t public.pos_transactions%rowtype;
begin
  select * into c from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found';end if;
  perform public.pos_offline_sale_lock_scope(c.integration_id::text);
  select * into c from public.pos_redemption_codes where id::text=p_id for update;
  if c.status not in ('confirmed','needs_review') or c.matched_transaction_id is null
    or c.lease_token::text is distinct from p_lease or c.lease_expires_at<=now() then raise exception 'Reward verification lease expired';end if;
  select * into t from public.pos_transactions where id=c.matched_transaction_id for update;
  if not found or t.integration_id<>c.integration_id or t.business_id<>c.business_id or t.branch_id is distinct from c.branch_id
    or t.external_transaction_id is distinct from p_external_id or p_raw->>'refId' is distinct from p_external_id
    or lower(coalesce(p_raw->>'isCancelled','false'))<>'true'
    or p_raw->>'storeId' is distinct from c.external_branch_id or p_raw->>'registerId' is distinct from c.external_terminal_id then
    raise exception 'StoreHub void does not match the verified receipt';end if;
  perform set_config('loyaltree.redemption_code_id',c.id::text,true);
  update public.pos_transactions set raw_payload=p_raw,transaction_type='void',updated_at=clock_timestamp()
    where id=t.id returning * into t;
  return to_jsonb(t);
end $$;

create or replace function public.pos_abort_voided_redemption_code(p_id text,p_lease text,p_transaction_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code public.pos_redemption_codes%rowtype;v_tx public.pos_transactions%rowtype;v_codes text[];v_committed boolean;
begin
  select * into v_code from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found';end if;
  perform public.pos_offline_sale_lock_scope(v_code.integration_id::text);
  select * into v_code from public.pos_redemption_codes where id::text=p_id for update;
  if v_code.status not in ('confirmed','needs_review')
    or v_code.lease_token::text is distinct from p_lease or v_code.lease_expires_at<=now() then
    raise exception 'Only a pending reward can be released by a verified void';end if;
  select * into v_tx from public.pos_transactions where id::text=p_transaction_id for update;
  if not found or v_tx.integration_id<>v_code.integration_id or v_tx.business_id<>v_code.business_id
    or v_tx.branch_id is distinct from v_code.branch_id or v_tx.provider<>'storehub'
    or lower(coalesce(v_tx.raw_payload->>'isCancelled','false'))<>'true'
    or coalesce(v_tx.raw_payload->>'storeId',v_tx.processing_metadata->>'bridge_external_branch_id') is distinct from v_code.external_branch_id
    or coalesce(v_tx.raw_payload->>'registerId',v_tx.processing_metadata->>'bridge_external_terminal_id') is distinct from v_code.external_terminal_id
    or v_tx.transacted_at is null or v_tx.transacted_at<v_code.scanned_at-interval '10 seconds' or v_tx.transacted_at>v_code.expires_at then
    raise exception 'The StoreHub void does not belong to this reward checkout';end if;
  select coalesce(array_agg(distinct m[1]),'{}') into v_codes from
    regexp_matches(upper(public.pos_redemption_note_text(v_tx.raw_payload)),'\mLT-[A-Z0-9]{8,16}\M','g') m;
  if (v_code.matched_transaction_id is null and v_code.receipt_reference<>'' and btrim(v_tx.external_receipt_number) is distinct from v_code.receipt_reference)
    or (v_code.matched_transaction_id is null and v_code.receipt_reference='' and not(v_code.code=any(v_codes)))
    or (cardinality(v_codes)>0 and (cardinality(v_codes)<>1 or not(v_code.code=any(v_codes))))
    or (v_code.matched_transaction_id is not null and v_code.matched_transaction_id<>v_tx.id) then
    raise exception 'Enter the exact voided receipt number before releasing this reward';end if;
  perform set_config('loyaltree.redemption_code_id',v_code.id::text,true);
  v_committed := (v_code.kind='points' and exists(select 1 from public.pos_redemption_reservations where id=v_code.reservation_id and status='committed'))
    or (v_code.kind='coupon' and exists(select 1 from public.pos_coupon_reservations where id=v_code.reservation_id and status='committed'))
    or (v_code.kind='benefit' and exists(select 1 from public.pos_benefit_reservations where id=v_code.reservation_id and status='committed'));
  if v_committed then return public.pos_reverse_redemption_code(p_id,p_lease);end if;
  if v_code.kind='points' then perform public.pos_release_points_redemption(v_code.reservation_id,'verified_storehub_void');
  elsif v_code.kind='coupon' then perform public.pos_release_coupon(v_code.reservation_id,'verified_storehub_void');
  else perform public.pos_release_benefit(v_code.reservation_id,'verified_storehub_void');end if;
  update public.pos_redemption_codes set status='cancelled',message='StoreHub void verified. Reward reservation released.',
    lease_token=null,lease_expires_at=null,result=result||jsonb_build_object('void_transaction_id',v_tx.id),updated_at=now()
    where id=v_code.id returning * into v_code;
  update public.pos_companion_sessions set status='cancelled',error_message='StoreHub void verified. Reward released.',updated_at=now()
    where id=v_code.session_id;
  return to_jsonb(v_code);
end $$;

create or replace function public.pos_reverse_redemption_code(p_id text,p_lease text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_code public.pos_redemption_codes%rowtype;v_tx public.pos_transactions%rowtype;v_benefit public.pos_benefit_reservations%rowtype;
  v_points public.pos_redemption_reservations%rowtype;v_before integer;v_after integer;v_id_type text;v_reason_type text;
begin
  select * into v_code from public.pos_redemption_codes where id::text=p_id;
  if not found then raise exception 'Reward code not found';end if;
  perform public.pos_offline_sale_lock_scope(v_code.integration_id::text);
  select * into v_code from public.pos_redemption_codes where id::text=p_id for update;
  if v_code.status='reversed' then return to_jsonb(v_code);end if;
  if v_code.status not in ('redeemed','confirmed','needs_review') or v_code.matched_transaction_id is null or v_code.lease_token::text is distinct from p_lease or v_code.lease_expires_at<=now() then
    raise exception 'Reward reversal lease expired';end if;
  select * into v_tx from public.pos_transactions where id=v_code.matched_transaction_id for update;
  if v_tx.integration_id<>v_code.integration_id or v_tx.business_id<>v_code.business_id
    or not(v_tx.status='voided' or v_tx.transaction_type='void'
      or lower(coalesce(v_tx.raw_payload->>'isCancelled','false'))='true' or v_tx.processing_metadata->>'void_reversed_at' is not null) then
    raise exception 'A StoreHub void is required to restore this reward';end if;
  if not ((v_code.kind='points' and exists(select 1 from public.pos_redemption_reservations where id=v_code.reservation_id and status in ('committed','reversed')))
    or (v_code.kind='coupon' and exists(select 1 from public.pos_coupon_reservations where id=v_code.reservation_id and status='committed'))
    or (v_code.kind='benefit' and exists(select 1 from public.pos_benefit_reservations where id=v_code.reservation_id and status='committed'))) then
    return public.pos_abort_voided_redemption_code(p_id,p_lease,v_tx.id::text);end if;
  perform set_config('loyaltree.redemption_code_id',v_code.id::text,true);
  -- Existing reconciliation restores points and removes sale earnings once.
  perform public.pos_reverse_storehub_void(v_tx.id::text,v_tx.integration_id::text);
  -- A crash may happen after the reward commit but before sale earning. The
  -- older void wrapper intentionally skips sales not marked loyalty_applied.
  -- Restore that committed points hold too, using the installed reversal RPC.
  if v_code.kind='points' then
    select * into v_points from public.pos_redemption_reservations where id=v_code.reservation_id for update;
    if v_points.status='committed' then
      select points_balance into v_before from public.customers where id=v_code.customer_id and business_id=v_code.business_id for update;
      with candidates as (
        select p.oid,p.pronargs,p.pronargdefaults,p.proargtypes,
          array(select p.proargnames[i] from generate_subscripts(p.proargnames,1) i
            where p.proargmodes is null or p.proargmodes[i] in ('i','b','v') order by i) names
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='pos_reverse_points_redemption'
      ) select format_type(proargtypes[array_position(names,'p_reservation_id')-1],null),
          format_type(proargtypes[array_position(names,'p_reason')-1],null)
        into v_id_type,v_reason_type from candidates c
        where array_position(names,'p_reservation_id') is not null and array_position(names,'p_reason') is not null
          and not exists(select 1 from generate_series(1,c.pronargs-c.pronargdefaults) i where names[i] not in ('p_reservation_id','p_reason'))
        order by (proargtypes[array_position(names,'p_reservation_id')-1]=pg_typeof(v_points.id)::oid) desc,pronargs,oid limit 1;
      if v_id_type is null then raise exception 'Existing points reversal RPC is required';end if;
      execute format('select public.pos_reverse_points_redemption(p_reservation_id=>$1::%s,p_reason=>$2::%s)',v_id_type,v_reason_type)
        using v_points.id::text,'verified_storehub_code_void';
      select * into v_points from public.pos_redemption_reservations where id=v_code.reservation_id;
      select points_balance into v_after from public.customers where id=v_code.customer_id;
      if v_points.status is distinct from 'reversed' or v_after is distinct from v_before+v_points.points_reserved then
        raise exception 'Points reversal did not restore the expected balance';end if;
    end if;
  end if;
  if v_code.kind='coupon' then
    update public.coupons set status='active',redeemed_at=null,updated_at=now()
      where id=(select coupon_id from public.pos_coupon_reservations where id=v_code.reservation_id) and status='redeemed';
    update public.pos_coupon_reservations set status='cancelled',release_reason='verified_storehub_void',released_at=now(),updated_at=now()
      where id=v_code.reservation_id and status='committed';
  elsif v_code.kind='benefit' then
    select * into v_benefit from public.pos_benefit_reservations where id=v_code.reservation_id for update;
    update public.membership_benefit_redemptions set pos_voided_at=coalesce(pos_voided_at,now())
      where id=v_benefit.committed_redemption_id and customer_id=v_code.customer_id and business_id=v_code.business_id;
    update public.pos_benefit_reservations set status='reversed',reversed_at=now(),updated_at=now() where id=v_code.reservation_id;
  end if;
  -- Persist Wallet retries in the same transaction as restoring the reward.
  insert into public.wallet_sync_jobs(business_id,customer_id,reason,status,attempts,next_attempt_at)
    select v_code.business_id,c.id,'manual_redemption_void','pending',0,now() from public.customers c
      where c.id in (v_code.customer_id,v_code.earning_customer_id)
      and not exists(select 1 from public.wallet_sync_jobs j where j.business_id=v_code.business_id and j.customer_id=c.id and j.status='pending');
  update public.pos_redemption_codes set status='reversed',message='StoreHub void verified. Reward restored; this code remains used.',
    lease_token=null,lease_expires_at=null,result=result||jsonb_build_object('void_reversed_at',now()),updated_at=now()
    where id=v_code.id returning * into v_code;
  update public.pos_companion_sessions set status='cancelled',error_message='StoreHub void verified. Reward restored; the code remains used.',
    result=result||jsonb_build_object('manual_redemption_code_id',v_code.id::text,'manual_reward_voided',true),updated_at=now()
    where id=v_code.session_id;
  return to_jsonb(v_code);
end $$;

do $$ declare f record;begin
  for f in select p.oid::regprocedure fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('pos_redemption_note_text','pos_issue_redemption_code',
      'pos_confirm_redemption_code','pos_cancel_redemption_code','pos_claim_redemption_codes',
      'pos_claim_redemption_receipt','pos_finish_redemption_code','pos_guard_code_receipt_customer',
      'pos_commit_code_reward','pos_record_code_void','pos_guard_code_processing_void','pos_guard_reserved_coupon_code','pos_guard_reserved_benefit_code','pos_guard_coded_reservation','pos_spend_available_prize_points','pos_reserve_benefit','pos_redemption_code_snapshot_guard','pos_abort_voided_redemption_code','pos_reverse_redemption_code') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.fn);
    execute format('grant execute on function %s to service_role',f.fn);
  end loop;
end $$;
commit;
notify pgrst,'reload schema';

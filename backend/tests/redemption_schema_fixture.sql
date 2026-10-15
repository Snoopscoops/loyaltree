-- Local test fixture based on the user's exported integer/UUID schema and RPCs.
create role anon;create role authenticated;create role service_role;
create table pos_integrations(id uuid primary key,business_id integer,provider text);
create table branches(id integer primary key,business_id integer,is_active boolean);
create table pos_branch_mappings(id uuid primary key,business_id integer,branch_id integer,integration_id uuid,is_active boolean,external_branch_id text);
create table pos_devices(id uuid primary key,business_id integer,branch_id integer,integration_id uuid,mapping_id uuid,provider text,status text,metadata jsonb);
create table customers(id integer primary key,business_id integer,public_id text,identity_id bigint,program_id integer,points_balance integer default 0,updated_at timestamptz);
create table coupons(id integer primary key,public_id text,business_id integer,customer_id integer,reward_text text,status text default 'active',
  starts_at date,source text,expires_at date,redeemed_at timestamptz,updated_at timestamptz,reward_type text,reward_value numeric,min_purchase_amount numeric default 0);
create table membership_benefit_redemptions(id bigserial primary key,business_id integer,customer_id integer,benefit_id text,benefit_name text,
  benefit_type text,benefit_value numeric,quantity integer,staff_id integer,branch_id integer,note text,idempotency_key text,redeemed_at timestamptz,
  unique(business_id,idempotency_key));
create table pos_companion_sessions(id uuid primary key,device_id uuid,business_id integer,branch_id integer,integration_id uuid,
  customer_id integer,customer_public_id text,source_customer_public_id text,status text default 'waiting_for_sale',scanned_at timestamptz,
  expires_at timestamptz,matched_pos_transaction_id uuid,external_transaction_id text,gross_amount numeric,currency text,
  result jsonb default '{}',error_message text,completed_at timestamptz,updated_at timestamptz);
create table pos_transactions(id uuid primary key,integration_id uuid,business_id integer,branch_id integer,customer_id integer,provider text,
  external_transaction_id text,external_receipt_number text,transaction_type text,status text,currency text,net_amount numeric,gross_amount numeric,
  raw_payload jsonb default '{}',processing_metadata jsonb default '{}',transacted_at timestamptz,updated_at timestamptz default now());
create table wallet_sync_jobs(id uuid primary key default gen_random_uuid(),business_id integer,customer_id integer,reason text,status text,attempts integer,next_attempt_at timestamptz);
create table pos_redemption_reservations(id uuid primary key default gen_random_uuid(),business_id integer,integration_id uuid,branch_id integer,
  customer_id integer,program_id integer,provider text,reservation_key text,external_transaction_id text,
  points_reserved integer check(points_reserved>0),value_per_point numeric,redemption_amount numeric,gross_amount numeric,net_amount numeric,
  balance_before integer,available_before integer,balance_after integer,status text default 'reserved',provider_payload jsonb default '{}',
  expires_at timestamptz,discount_applied_at timestamptz,committed_at timestamptz,released_at timestamptz,reversed_at timestamptz,release_reason text,
  unique(integration_id,reservation_key),check(status in ('reserved','discount_applied','committed','released','reversed','failed')));
create table pos_coupon_reservations(id uuid primary key default gen_random_uuid(),business_id integer,integration_id uuid,branch_id integer,device_id uuid,
  customer_id integer,program_id integer,coupon_id integer,provider text,reservation_key text,reward_text text,reward_type text,reward_value numeric,
  gross_amount numeric,discount_amount numeric,status text default 'reserved',expires_at timestamptz,external_transaction_id text,release_reason text,
  committed_at timestamptz,released_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),
  unique(integration_id,reservation_key),check(status in ('reserved','committed','released','expired','cancelled')));
create table pos_benefit_reservations(id uuid primary key default gen_random_uuid(),business_id integer,integration_id uuid,branch_id integer,device_id uuid,
  customer_id integer,program_id integer,provider text,reservation_key text,benefit_id text,benefit_name text,benefit_type text,benefit_value numeric,
  quantity integer check(quantity>0),usage_limit integer,window_start timestamptz,window_end timestamptz,status text default 'reserved',
  external_transaction_id text,committed_redemption_id bigint,expires_at timestamptz,released_at timestamptz,committed_at timestamptz,
  reversed_at timestamptz,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),
  unique(integration_id,reservation_key),check(status in ('reserved','committed','released','expired','reversed')));

create function pos_reserve_points_redemption(p_business_id integer,p_integration_id uuid,p_branch_id integer,p_customer_id integer,p_program_id integer,
  p_provider text,p_reservation_key text,p_points integer,p_value_per_point numeric,p_gross_amount numeric,p_max_percent numeric default 100,p_hold_minutes integer default 10)
returns setof pos_redemption_reservations language plpgsql as $$
declare b integer;h integer;a integer;d numeric;n numeric;r pos_redemption_reservations%rowtype;
begin
  if p_points is null or p_points<=0 then raise exception 'Points to redeem must be greater than zero';end if;
  if p_value_per_point is null or p_value_per_point<=0 then raise exception 'Redemption value per point must be greater than zero';end if;
  if p_gross_amount is null or p_gross_amount<=0 then raise exception 'Gross amount must be greater than zero';end if;
  select * into r from pos_redemption_reservations where integration_id=p_integration_id and reservation_key=p_reservation_key limit 1;
  if found then return next r;return;end if;
  select coalesce(points_balance,0) into b from customers where id=p_customer_id and business_id=p_business_id for update;
  if not found then raise exception 'Customer not found for this business';end if;
  select * into r from pos_redemption_reservations where integration_id=p_integration_id and reservation_key=p_reservation_key limit 1;
  if found then return next r;return;end if;
  update pos_redemption_reservations set status='released',release_reason=coalesce(release_reason,'reservation_expired'),released_at=coalesce(released_at,now())
    where customer_id=p_customer_id and status in ('reserved','discount_applied') and expires_at<=now();
  select coalesce(sum(points_reserved),0)::integer into h from pos_redemption_reservations
    where customer_id=p_customer_id and status in ('reserved','discount_applied') and expires_at>now();
  a:=greatest(b-h,0);if p_points>a then raise exception 'Not enough available points';end if;
  d:=round(p_points*p_value_per_point,2);
  if d>round(p_gross_amount*least(greatest(coalesce(p_max_percent,100),0),100)/100,2) then raise exception 'Redemption exceeds allowed percentage';end if;
  if d>p_gross_amount then raise exception 'Redemption cannot exceed gross bill';end if;
  n:=greatest(round(p_gross_amount-d,2),0);
  return query insert into pos_redemption_reservations(integration_id,business_id,branch_id,customer_id,program_id,provider,reservation_key,
    points_reserved,value_per_point,redemption_amount,gross_amount,net_amount,balance_before,available_before,status,expires_at)
    values(p_integration_id,p_business_id,p_branch_id,p_customer_id,p_program_id,coalesce(nullif(btrim(p_provider),''),'storehub'),p_reservation_key,
    p_points,p_value_per_point,d,p_gross_amount,n,b,a,'reserved',now()+make_interval(mins=>greatest(coalesce(p_hold_minutes,10),1))) returning *;
end $$;
create function pos_mark_redemption_discount_applied(p_reservation_id uuid,p_external_transaction_id text default null,p_provider_payload jsonb default '{}')
returns setof pos_redemption_reservations language plpgsql as $$
declare r pos_redemption_reservations%rowtype;
begin
  select * into r from pos_redemption_reservations where id=p_reservation_id for update;
  if not found then raise exception 'Redemption reservation not found';end if;
  if r.status in ('committed','reversed') then return next r;return;end if;
  if r.status not in ('reserved','discount_applied') then raise exception 'Redemption reservation is not active';end if;
  if r.expires_at<=now() then update pos_redemption_reservations set status='released',release_reason='reservation_expired',released_at=now()
    where id=p_reservation_id returning * into r;return next r;return;end if;
  update pos_redemption_reservations set status='discount_applied',external_transaction_id=coalesce(nullif(btrim(p_external_transaction_id),''),external_transaction_id),
    provider_payload=coalesce(provider_payload,'{}')||coalesce(p_provider_payload,'{}'),discount_applied_at=coalesce(discount_applied_at,now())
    where id=p_reservation_id returning * into r;return next r;
end $$;
create function pos_commit_points_redemption(p_reservation_id uuid,p_external_transaction_id text default null)
returns setof pos_redemption_reservations language plpgsql as $$
declare r pos_redemption_reservations%rowtype;b integer;
begin
  select * into r from pos_redemption_reservations where id=p_reservation_id for update;
  if not found then raise exception 'Redemption reservation not found';end if;
  if r.status in ('committed','reversed') then return next r;return;end if;
  if r.status<>'discount_applied' then raise exception 'Discount must be applied';end if;
  select coalesce(points_balance,0) into b from customers where id=r.customer_id and business_id=r.business_id for update;
  if not found or b<r.points_reserved then raise exception 'Not enough points';end if;
  update customers set points_balance=b-r.points_reserved,updated_at=now() where id=r.customer_id;
  update pos_redemption_reservations set status='committed',external_transaction_id=coalesce(nullif(btrim(p_external_transaction_id),''),external_transaction_id),
    balance_after=b-r.points_reserved,committed_at=coalesce(committed_at,now()) where id=r.id returning * into r;return next r;
end $$;
create function pos_release_points_redemption(p_reservation_id uuid,p_reason text default 'checkout_cancelled')
returns setof pos_redemption_reservations language plpgsql as $$
declare r pos_redemption_reservations%rowtype;
begin
  select * into r from pos_redemption_reservations where id=p_reservation_id for update;
  if not found then raise exception 'Redemption reservation not found';end if;
  if r.status in ('committed','reversed') then raise exception 'Committed redemption cannot be released';end if;
  if r.status='released' then return next r;return;end if;
  update pos_redemption_reservations set status='released',release_reason=p_reason,released_at=coalesce(released_at,now()) where id=r.id returning * into r;
  return next r;
end $$;
create function pos_reserve_coupon(p_business_id integer,p_integration_id uuid,p_branch_id integer,p_device_id uuid,p_customer_id integer,
  p_program_id integer,p_coupon_id integer,p_provider text,p_reservation_key text,p_gross_amount numeric,p_hold_minutes integer default 15)
returns setof pos_coupon_reservations language plpgsql as $$
declare c coupons%rowtype;r pos_coupon_reservations%rowtype;d numeric:=0;
begin
  select * into r from pos_coupon_reservations where integration_id=p_integration_id and reservation_key=p_reservation_key limit 1;
  if found then return next r;return;end if;
  select * into c from coupons where id=p_coupon_id for update;
  if not found or c.business_id<>p_business_id or c.customer_id<>p_customer_id then raise exception 'Coupon not found for customer';end if;
  if c.status<>'active' then raise exception 'Coupon is not active';end if;
  if c.expires_at is not null and c.expires_at<current_date then raise exception 'Coupon expired';end if;
  if coalesce(c.min_purchase_amount,0)>coalesce(p_gross_amount,0) then raise exception 'Minimum purchase not met';end if;
  update pos_coupon_reservations set status='expired',updated_at=now() where coupon_id=p_coupon_id and status='reserved' and expires_at<=now();
  if exists(select 1 from pos_coupon_reservations where coupon_id=p_coupon_id and status='reserved' and expires_at>now()) then raise exception 'Coupon is already reserved';end if;
  if c.reward_type='fixed_discount' then d:=least(coalesce(c.reward_value,0),coalesce(p_gross_amount,0));
  elsif c.reward_type='percentage_discount' then d:=round(p_gross_amount*least(greatest(coalesce(c.reward_value,0),0),100)/100,2);end if;
  insert into pos_coupon_reservations(business_id,integration_id,branch_id,device_id,customer_id,program_id,coupon_id,provider,reservation_key,
    reward_text,reward_type,reward_value,gross_amount,discount_amount,status,expires_at)
    values(p_business_id,p_integration_id,p_branch_id,p_device_id,p_customer_id,p_program_id,p_coupon_id,p_provider,p_reservation_key,
    c.reward_text,c.reward_type,c.reward_value,p_gross_amount,d,'reserved',now()+make_interval(mins=>greatest(1,least(coalesce(p_hold_minutes,15),120))))
    returning * into r;return next r;
end $$;
create function pos_commit_coupon(p_reservation_id uuid,p_external_transaction_id text)
returns setof pos_coupon_reservations language plpgsql as $$
declare r pos_coupon_reservations%rowtype;
begin
  select * into r from pos_coupon_reservations where id=p_reservation_id for update;
  if not found then return;end if;
  if r.status='committed' then return next r;return;end if;
  if r.status<>'reserved' or r.expires_at<=now() then raise exception 'Coupon reservation is not active';end if;
  update coupons set status='redeemed',redeemed_at=now(),updated_at=now() where id=r.coupon_id and status='active';
  if not found then raise exception 'Coupon is no longer active';end if;
  update pos_coupon_reservations set status='committed',external_transaction_id=p_external_transaction_id,committed_at=now(),updated_at=now()
    where id=r.id returning * into r;return next r;
end $$;
create function pos_release_coupon(p_reservation_id uuid,p_reason text default 'checkout_cancelled')
returns setof pos_coupon_reservations language plpgsql as $$
declare r pos_coupon_reservations%rowtype;
begin
  select * into r from pos_coupon_reservations where id=p_reservation_id for update;if not found then return;end if;
  if r.status='reserved' then update pos_coupon_reservations set status='released',release_reason=p_reason,released_at=now(),updated_at=now()
    where id=r.id returning * into r;end if;return next r;
end $$;
create function pos_reserve_benefit(p_business_id integer,p_integration_id uuid,p_branch_id integer,p_device_id uuid,p_customer_id integer,p_program_id integer,
  p_provider text,p_reservation_key text,p_benefit_id text,p_benefit_name text,p_benefit_type text,p_benefit_value numeric,p_quantity integer,p_usage_limit integer,
  p_window_start timestamptz,p_window_end timestamptz,p_hold_minutes integer default 15)
returns setof pos_benefit_reservations language plpgsql as $$
declare r pos_benefit_reservations%rowtype;used integer;held integer;
begin
  if p_quantity is null or p_quantity<=0 then raise exception 'Benefit quantity must be positive';end if;
  select * into r from pos_benefit_reservations where integration_id=p_integration_id and reservation_key=p_reservation_key limit 1;
  if found then return next r;return;end if;
  perform 1 from customers where id=p_customer_id for update;if not found then raise exception 'Customer not found';end if;
  update pos_benefit_reservations set status='expired' where customer_id=p_customer_id and benefit_id=p_benefit_id and status='reserved' and expires_at<=now();
  if p_usage_limit is not null then
    select coalesce(sum(quantity),0)::integer into used from membership_benefit_redemptions where business_id=p_business_id and customer_id=p_customer_id
      and benefit_id=p_benefit_id and (p_window_start is null or redeemed_at>=p_window_start) and (p_window_end is null or redeemed_at<p_window_end);
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
create function pos_release_benefit(p_reservation_id uuid,p_reason text default 'checkout_cancelled')
returns setof pos_benefit_reservations language plpgsql as $$
declare r pos_benefit_reservations%rowtype;
begin
  select * into r from pos_benefit_reservations where id=p_reservation_id for update;if not found then raise exception 'Benefit reservation not found';end if;
  if r.status='reserved' then update pos_benefit_reservations set status='released',released_at=now(),metadata=metadata||jsonb_build_object('release_reason',p_reason)
    where id=r.id returning * into r;end if;return next r;
end $$;
-- Only the pre-existing points reversal RPC is supplied as a fixture. The
-- production void wrapper is loaded and executed by this suite unchanged.
create function pos_reverse_points_redemption(p_reservation_id uuid,p_reason text) returns jsonb language plpgsql as $$
declare r pos_redemption_reservations%rowtype;
begin
  select * into r from pos_redemption_reservations where id=p_reservation_id for update;
  if r.status='committed' then
    update customers set points_balance=points_balance+r.points_reserved where id=r.customer_id;
    update pos_redemption_reservations set status='reversed',reversed_at=now() where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
end $$;
alter table pos_transactions add column points_earned integer not null default 0;
alter table pos_transactions add column points_redeemed integer not null default 0;
create table points_events(id bigserial,business_id integer,customer_id integer,branch_id integer,amount_spent_pesos numeric,points_earned integer,created_at timestamptz);

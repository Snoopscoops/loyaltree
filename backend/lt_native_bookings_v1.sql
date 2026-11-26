-- Native bookings V1. Apply only after reviewing/testing in a disposable DB.
-- No changes to existing menu, guest-page, payment or loyalty tables.
begin;
create table if not exists public.lt_booking_settings (
  branch_id bigint primary key references public.branches(id) on delete restrict,
  business_id bigint not null references public.businesses(id) on delete restrict,
  venue_enabled boolean not null default false,
  table_enabled boolean not null default false,
  opens_at time not null default '10:00',
  closes_at time not null default '22:00',
  weekdays integer[] not null default array[1,2,3,4,5,6,7],
  blocked_dates date[] not null default '{}',
  check (opens_at < closes_at),
  check (weekdays <@ array[1,2,3,4,5,6,7])
);
create table if not exists public.lt_booking_resources (
  id uuid primary key default gen_random_uuid(),
  branch_id bigint not null references public.lt_booking_settings(branch_id) on delete restrict,
  business_id bigint not null references public.businesses(id) on delete restrict,
  kind text not null check(kind in ('venue','table')),
  name text not null check(length(btrim(name)) between 1 and 100),
  capacity integer not null check(capacity between 1 and 1000),
  duration_minutes integer not null check(duration_minutes between 30 and 720 and duration_minutes % 30 = 0),
  price_centavos integer not null default 0 check(price_centavos between 0 and 100000000),
  active boolean not null default true
);
alter table public.lt_booking_resources add column if not exists available_from time, add column if not exists available_until time;
do $ begin
  if not exists (select 1 from pg_constraint where conrelid='public.lt_booking_resources'::regclass and conname='lt_booking_resource_hours_check') then
    alter table public.lt_booking_resources add constraint lt_booking_resource_hours_check check ((available_from is null and available_until is null) or (kind='table' and available_from is not null and available_until is not null and available_from < available_until));
  end if;
end $;
create index if not exists lt_booking_resources_branch_idx on public.lt_booking_resources(branch_id, kind);
create table if not exists public.lt_bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  business_id bigint not null references public.businesses(id) on delete restrict,
  branch_id bigint not null references public.lt_booking_settings(branch_id) on delete restrict,
  resource_id uuid not null references public.lt_booking_resources(id) on delete restrict,
  kind text not null check(kind in ('venue','table')),
  resource_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at > starts_at),
  guests integer not null check(guests between 1 and 1000),
  customer_name text not null check(length(btrim(customer_name)) between 1 and 100),
  phone text not null check(length(phone) between 7 and 30),
  note text not null default '' check(length(note) <= 500),
  price_centavos integer not null check(price_centavos >= 0),
  status text not null default 'pending' check(status in ('pending','confirmed','declined','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id, request_id)
);
create index if not exists lt_bookings_branch_time_idx on public.lt_bookings(branch_id,starts_at,ends_at) where status in ('confirmed','completed');
create index if not exists lt_bookings_requests_idx on public.lt_bookings(branch_id,created_at);
alter table public.lt_booking_settings enable row level security;
alter table public.lt_booking_resources enable row level security;
alter table public.lt_bookings enable row level security;
revoke all on public.lt_booking_settings,public.lt_booking_resources,public.lt_bookings from public,anon,authenticated;
grant select,insert,update on public.lt_booking_settings,public.lt_booking_resources,public.lt_bookings to service_role;

-- All confirmations and request submissions serialize on the branch setting
-- row. Venue packages mean exclusive use of that entire branch in V1.
create or replace function public.lt_booking_slots(
  p_business bigint,p_branch bigint,p_resource uuid,p_day date,p_guests integer
) returns setof timestamptz language sql stable security invoker set search_path=public,pg_temp as $$
  select t at time zone 'Asia/Manila'
  from public.lt_booking_settings s
  join public.lt_booking_resources r on r.branch_id=s.branch_id and r.business_id=s.business_id
  join public.branches b on b.id=s.branch_id and b.business_id=s.business_id and b.is_active is true
  cross join lateral generate_series(p_day+greatest(s.opens_at,coalesce(r.available_from,s.opens_at)),p_day+least(s.closes_at,coalesce(r.available_until,s.closes_at))-make_interval(mins=>r.duration_minutes),interval '30 minutes') t
  where s.business_id=p_business and s.branch_id=p_branch and r.id=p_resource and r.active
    and case when r.kind='venue' then s.venue_enabled else s.table_enabled end
    and p_guests between 1 and r.capacity
    and p_day between (now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::date+90
    and extract(isodow from p_day)::integer=any(s.weekdays) and not(p_day=any(s.blocked_dates))
    and (t at time zone 'Asia/Manila')>now()
    and not exists(select 1 from public.lt_bookings x
      where x.business_id=p_business and x.branch_id=p_branch and x.status in ('confirmed','completed')
      and (r.kind='venue' or x.kind='venue' or x.resource_id=r.id)
      and x.starts_at < ((t+make_interval(mins=>r.duration_minutes)) at time zone 'Asia/Manila')
      and x.ends_at > (t at time zone 'Asia/Manila'))
  order by 1;
$$;

create or replace function public.lt_booking_request(
  p_business bigint,p_branch bigint,p_resource uuid,p_start timestamptz,p_guests integer,
  p_name text,p_phone text,p_note text,p_request uuid
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.lt_booking_settings%rowtype; r public.lt_booking_resources%rowtype; x public.lt_bookings%rowtype;
begin
  -- Serialize identical request IDs even if submitted against different branches.
  perform pg_advisory_xact_lock(hashtextextended(p_business::text||':'||p_request::text,0));
  select * into x from public.lt_bookings where business_id=p_business and request_id=p_request;
  if found then
    if x.branch_id<>p_branch or x.resource_id<>p_resource or x.starts_at<>p_start or x.guests<>p_guests or x.customer_name<>btrim(p_name) or x.phone<>p_phone or x.note<>p_note then
      raise exception using errcode='P0001',message='request_conflict';
    end if;
    return jsonb_build_object('reference',x.id,'status',x.status);
  end if;
  select * into s from public.lt_booking_settings where business_id=p_business and branch_id=p_branch for update;
  if not found then raise exception using errcode='P0001',message='unavailable'; end if;
  select * into r from public.lt_booking_resources where id=p_resource and business_id=p_business and branch_id=p_branch for share;
  if not found then raise exception using errcode='P0001',message='unavailable'; end if;
  if not exists(select 1 from public.lt_booking_slots(p_business,p_branch,p_resource,(p_start at time zone 'Asia/Manila')::date,p_guests) v where v=p_start) then
    raise exception using errcode='P0001',message='unavailable';
  end if;
  if (select count(*) from public.lt_bookings where branch_id=p_branch and created_at>now()-interval '15 minutes')>=40
    or (select count(*) from public.lt_bookings where business_id=p_business and phone=p_phone and created_at>now()-interval '1 hour')>=5 then
    raise exception using errcode='P0001',message='rate_limit';
  end if;
  insert into public.lt_bookings(request_id,business_id,branch_id,resource_id,kind,resource_name,starts_at,ends_at,guests,customer_name,phone,note,price_centavos)
  values(p_request,p_business,p_branch,p_resource,r.kind,r.name,p_start,p_start+make_interval(mins=>r.duration_minutes),p_guests,btrim(p_name),p_phone,p_note,r.price_centavos)
  returning * into x;
  return jsonb_build_object('reference',x.id,'status',x.status);
end;
$$;

create or replace function public.lt_booking_transition(p_business bigint,p_id uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare x public.lt_bookings%rowtype; r public.lt_booking_resources%rowtype; bid bigint;
begin
  select branch_id into bid from public.lt_bookings where business_id=p_business and id=p_id;
  if not found then raise exception using errcode='P0001',message='not_found'; end if;
  perform 1 from public.lt_booking_settings where business_id=p_business and branch_id=bid for update;
  select * into x from public.lt_bookings where business_id=p_business and id=p_id for update;
  if x.status=p_status then return jsonb_build_object('reference',x.id,'status',x.status); end if;
  if p_status='confirmed' and x.status='pending' then
    select * into r from public.lt_booking_resources where id=x.resource_id and business_id=p_business and branch_id=bid for share;
    if not found or r.duration_minutes<>extract(epoch from (x.ends_at-x.starts_at))/60 or r.price_centavos<>x.price_centavos or r.kind<>x.kind or r.name<>x.resource_name then
      raise exception using errcode='P0001',message='resource_changed';
    end if;
    if not exists(select 1 from public.lt_booking_slots(p_business,bid,x.resource_id,(x.starts_at at time zone 'Asia/Manila')::date,x.guests) v where v=x.starts_at) then
      raise exception using errcode='P0001',message='unavailable';
    end if;
  elsif (p_status='declined' and x.status='pending') or (p_status='cancelled' and x.status in ('pending','confirmed')) or (p_status='completed' and x.status='confirmed' and x.ends_at<=now()) then
    null;
  else raise exception using errcode='P0001',message='invalid_transition';
  end if;
  update public.lt_bookings set status=p_status,updated_at=now() where id=x.id and business_id=p_business;
  return jsonb_build_object('reference',x.id,'status',p_status);
end;
$$;
revoke all on function public.lt_booking_slots(bigint,bigint,uuid,date,integer),public.lt_booking_request(bigint,bigint,uuid,timestamptz,integer,text,text,text,uuid),public.lt_booking_transition(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.lt_booking_slots(bigint,bigint,uuid,date,integer),public.lt_booking_request(bigint,bigint,uuid,timestamptz,integer,text,text,text,uuid),public.lt_booking_transition(bigint,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;

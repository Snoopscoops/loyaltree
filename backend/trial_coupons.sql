-- Apply in Supabase SQL Editor before deploying the coupon feature.
begin;
-- Stop with a clear message if the existing signup schema is not installed.
do $$
begin
 if to_regclass('public.businesses') is null or to_regclass('public.business_agreements') is null then
  raise exception 'Apply the existing businesses and business_agreements schema before trial_coupons.sql';
 end if;
end $$;
alter table public.businesses add column if not exists trial_ends_at timestamptz;
create table if not exists public.business_trial_coupons (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,64}$'),
  title text not null,
  trial_days integer not null check (trial_days between 1 and 90),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  max_redemptions integer check (max_redemptions > 0),
  country_code text,
  eligible_email text,
  is_public boolean not null default false,
  show_popup boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (not show_popup or is_public),
  check (eligible_email is null or (not is_public and not show_popup))
);
create table if not exists public.business_trial_redemptions (
  id bigserial primary key,
  coupon_id bigint not null references public.business_trial_coupons(id),
  business_id bigint not null unique references public.businesses(id) on delete cascade,
  code text not null,
  business_email text not null unique,
  business_phone text unique,
  trial_days integer not null,
  redeemed_at timestamptz not null default now(),
  trial_ends_at timestamptz not null
);
create index if not exists trial_redemptions_coupon_idx on public.business_trial_redemptions(coupon_id);
alter table public.business_trial_coupons enable row level security;
alter table public.business_trial_redemptions enable row level security;
revoke all on public.business_trial_coupons, public.business_trial_redemptions from anon, authenticated;
grant all on public.business_trial_coupons, public.business_trial_redemptions to service_role;
grant usage, select on sequence public.business_trial_coupons_id_seq, public.business_trial_redemptions_id_seq to service_role;

-- Locked claim prevents concurrent signups exceeding the usage limit.
create or replace function public.redeem_business_trial(p_code text, p_business_id bigint, p_trial_days integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
 c public.business_trial_coupons%rowtype;
 b public.businesses%rowtype;
 trial_end timestamptz;
 local_today date := (now() at time zone 'Asia/Manila')::date;
begin
 select * into c from public.business_trial_coupons where code = upper(trim(p_code)) for update;
 if not found or not c.is_active then raise exception 'Coupon is invalid or disabled'; end if;
 if c.trial_days <> p_trial_days then raise exception 'Coupon duration changed; review and sign the updated agreement'; end if;
 if local_today < c.starts_on or local_today > c.ends_on then raise exception 'Coupon is outside its redemption dates'; end if;
 select * into b from public.businesses where id = p_business_id for update;
 if not found then raise exception 'Business not found'; end if;
 if not exists(select 1 from public.business_agreements where business_id = b.id) then raise exception 'Signed business agreement is required before trial activation'; end if;
 if b.status <> 'PENDING' or b.last_paid_at is not null or b.trial_ends_at is not null then raise exception 'Only new unpaid businesses can redeem a trial'; end if;
 if c.country_code is not null and c.country_code <> coalesce(b.pricing_region, b.country_code, 'PH') then raise exception 'Coupon is not available in your country'; end if;
 if c.eligible_email is not null and lower(trim(c.eligible_email)) <> lower(trim(b.email)) then raise exception 'Coupon is reserved for another business'; end if;
 if exists(select 1 from public.business_trial_redemptions where business_id = b.id) then raise exception 'Trial already redeemed'; end if;
 if c.max_redemptions is not null and (select count(*) from public.business_trial_redemptions where coupon_id = c.id) >= c.max_redemptions then raise exception 'Coupon has reached its usage limit'; end if;
 trial_end := now() + make_interval(days => c.trial_days);
 insert into public.business_trial_redemptions(coupon_id, business_id, code, business_email, business_phone, trial_days, trial_ends_at)
 values(c.id, b.id, c.code, lower(trim(b.email)), nullif(regexp_replace(coalesce(b.phone,''), '[^0-9]', '', 'g'), ''), c.trial_days, trial_end);
 update public.businesses set status = 'ACTIVE', subscription_expires_at = trial_end, trial_ends_at = trial_end where id = b.id;
 return jsonb_build_object('code', c.code, 'trial_days', c.trial_days, 'trial_ends_at', trial_end);
end $$;
revoke all on function public.redeem_business_trial(text,bigint,integer) from public, anon, authenticated;
grant execute on function public.redeem_business_trial(text,bigint,integer) to service_role;
-- Recover an activation whose HTTP response was lost. Cancellation deletes the
-- pending business and its agreement in one transaction, never an active trial.
create or replace function public.cancel_pending_trial_signup(p_code text, p_business_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
 b public.businesses%rowtype;
 r public.business_trial_redemptions%rowtype;
begin
 select * into b from public.businesses where id = p_business_id for update;
 if not found then return jsonb_build_object('cancelled', true); end if;
 select * into r from public.business_trial_redemptions where business_id = b.id;
 if found then
  if b.status <> 'ACTIVE' then raise exception 'Cannot confirm a business that is not active'; end if;
  if r.code <> upper(trim(p_code)) then raise exception 'Trial claim belongs to a different coupon'; end if;
  return jsonb_build_object('code', r.code, 'trial_days', r.trial_days, 'trial_ends_at', r.trial_ends_at);
 end if;
 if b.status <> 'PENDING' or b.last_paid_at is not null or b.trial_ends_at is not null then
  raise exception 'Cannot cancel a business that has already been activated';
 end if;
 delete from public.business_agreements where business_id = b.id;
 delete from public.businesses where id = b.id;
 return jsonb_build_object('cancelled', true);
end $$;
revoke all on function public.cancel_pending_trial_signup(text,bigint) from public, anon, authenticated;
grant execute on function public.cancel_pending_trial_signup(text,bigint) to service_role;

insert into public.business_trial_coupons(code,title,trial_days,starts_on,ends_on,country_code,is_public,show_popup)
values ('HALLOWEEN7','Halloween Special',7,'2026-10-15','2026-11-15','PH',true,true)
on conflict(code) do nothing;
notify pgrst, 'reload schema';
commit;

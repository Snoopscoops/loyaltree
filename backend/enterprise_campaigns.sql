-- Loyalty Tree enterprise campaigns + seasonal coupons
-- Safe to run repeatedly in Supabase SQL Editor.

alter table if exists coupons
  add column if not exists starts_at date,
  add column if not exists source text,
  add column if not exists source_ref text,
  add column if not exists reward_type text;

create table if not exists campaigns (
  id bigserial primary key,
  public_id text not null unique,
  business_id bigint not null references businesses(id) on delete cascade,
  created_by_staff_id bigint null references staff(id) on delete set null,
  name text not null,
  description text null,
  scope text not null default 'nationwide' check (scope in ('nationwide','selected_branches','single_branch')),
  status text not null default 'scheduled' check (status in ('draft','scheduled','active','paused','ended')),
  qualifying_start_date date not null,
  qualifying_end_date date not null,
  qualification_type text not null default 'any_purchase' check (qualification_type in ('any_purchase','minimum_spend')),
  minimum_spend numeric(14,2) not null default 0,
  reward_type text not null check (reward_type in ('percent_discount','fixed_discount','buy_one_take_one')),
  reward_value numeric(14,2) null,
  reward_label text null,
  reward_description text null,
  coupon_start_date date not null,
  coupon_end_date date not null,
  min_redemption_spend numeric(14,2) not null default 0,
  max_per_member integer not null default 1 check (max_per_member between 1 and 20),
  applicable_product_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (qualifying_end_date >= qualifying_start_date),
  check (coupon_end_date >= coupon_start_date),
  check (minimum_spend >= 0),
  check (min_redemption_spend >= 0),
  check (
    (reward_type = 'buy_one_take_one')
    or (reward_value is not null and reward_value > 0)
  ),
  check (reward_type <> 'percent_discount' or reward_value <= 100)
);

create index if not exists idx_campaigns_business_dates
  on campaigns(business_id, qualifying_start_date, qualifying_end_date, status);

create table if not exists campaign_branches (
  id bigserial primary key,
  campaign_id bigint not null references campaigns(id) on delete cascade,
  branch_id bigint not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(campaign_id, branch_id)
);

create index if not exists idx_campaign_branches_branch
  on campaign_branches(branch_id, campaign_id);

create table if not exists campaign_coupon_issues (
  id bigserial primary key,
  public_id text not null unique,
  campaign_id bigint not null references campaigns(id) on delete cascade,
  business_id bigint not null references businesses(id) on delete cascade,
  customer_id bigint not null references customers(id) on delete cascade,
  coupon_public_id text not null,
  qualification_branch_id bigint null references branches(id) on delete set null,
  redemption_branch_id bigint null references branches(id) on delete set null,
  source_transaction_id text not null,
  qualifying_amount numeric(14,2) null,
  reward_type text not null,
  reward_value numeric(14,2) null,
  min_redemption_spend numeric(14,2) not null default 0,
  applicable_product_text text null,
  status text not null default 'issued' check (status in ('issued','redeemed','expired','cancelled')),
  starts_at date not null,
  expires_at date not null,
  issued_at timestamptz not null default now(),
  redeemed_at timestamptz null,
  redemption_gross_amount numeric(14,2) null,
  discount_amount numeric(14,2) null,
  redemption_net_amount numeric(14,2) null,
  created_at timestamptz not null default now(),
  unique(campaign_id, customer_id, source_transaction_id)
);

create index if not exists idx_campaign_issues_campaign_status
  on campaign_coupon_issues(campaign_id, status, issued_at desc);
create index if not exists idx_campaign_issues_customer
  on campaign_coupon_issues(customer_id, issued_at desc);
create index if not exists idx_campaign_issues_coupon
  on campaign_coupon_issues(coupon_public_id);

create table if not exists campaign_activity (
  id bigserial primary key,
  campaign_id bigint not null references campaigns(id) on delete cascade,
  campaign_issue_id bigint null references campaign_coupon_issues(id) on delete set null,
  business_id bigint not null references businesses(id) on delete cascade,
  customer_id bigint null references customers(id) on delete set null,
  branch_id bigint null references branches(id) on delete set null,
  activity_type text not null check (activity_type in ('qualified','coupon_issued','coupon_redeemed','coupon_expired','coupon_cancelled')),
  gross_amount numeric(14,2) null,
  discount_amount numeric(14,2) null,
  source_transaction_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_campaign_activity_campaign_created
  on campaign_activity(campaign_id, created_at desc);
create index if not exists idx_campaign_activity_business_created
  on campaign_activity(business_id, created_at desc);
create index if not exists idx_campaign_activity_branch_created
  on campaign_activity(branch_id, created_at desc);

-- Keep PostgREST aware of the latest schema after migration.
notify pgrst, 'reload schema';

-- Aggregates run in Postgres so a nationwide campaign does not pull every issue
-- row into the API process just to render a dashboard report.
create or replace function campaign_report_summary(p_campaign_id bigint)
returns table (
  issued bigint,
  unique_members bigint,
  redeemed bigint,
  redeemed_members bigint,
  expired bigint,
  gross_revenue_from_redemptions numeric,
  net_revenue_from_redemptions numeric,
  discount_given numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint as issued,
    count(distinct customer_id)::bigint as unique_members,
    count(*) filter (where status = 'redeemed')::bigint as redeemed,
    count(distinct customer_id) filter (where status = 'redeemed')::bigint as redeemed_members,
    count(*) filter (where status = 'expired' or (status = 'issued' and expires_at < current_date))::bigint as expired,
    coalesce(sum(redemption_gross_amount) filter (where status = 'redeemed'),0)::numeric as gross_revenue_from_redemptions,
    coalesce(sum(redemption_net_amount) filter (where status = 'redeemed'),0)::numeric as net_revenue_from_redemptions,
    coalesce(sum(discount_amount) filter (where status = 'redeemed'),0)::numeric as discount_given
  from campaign_coupon_issues
  where campaign_id = p_campaign_id;
$$;

create or replace function campaign_report_by_branch(p_campaign_id bigint)
returns table (
  branch_id bigint,
  branch_name text,
  issued bigint,
  redeemed bigint,
  gross_revenue numeric,
  discount_given numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with grouped as (
    select
      coalesce(redemption_branch_id, qualification_branch_id) as branch_id,
      count(*)::bigint as issued,
      count(*) filter (where status='redeemed')::bigint as redeemed,
      coalesce(sum(redemption_gross_amount) filter (where status='redeemed'),0)::numeric as gross_revenue,
      coalesce(sum(discount_amount) filter (where status='redeemed'),0)::numeric as discount_given
    from campaign_coupon_issues
    where campaign_id = p_campaign_id
    group by coalesce(redemption_branch_id, qualification_branch_id)
  )
  select g.branch_id, coalesce(b.name,'Unknown / unassigned') as branch_name,
         g.issued, g.redeemed, g.gross_revenue, g.discount_given
  from grouped g
  left join branches b on b.id = g.branch_id
  order by g.redeemed desc, g.issued desc, branch_name;
$$;

notify pgrst, 'reload schema';

-- Campaign data is API-only. The FastAPI backend uses the Supabase server/service
-- credential; browser/anon clients should not query these tables or report RPCs directly.
alter table campaigns enable row level security;
alter table campaign_branches enable row level security;
alter table campaign_coupon_issues enable row level security;
alter table campaign_activity enable row level security;

revoke all on function campaign_report_summary(bigint) from public;
revoke all on function campaign_report_summary(bigint) from anon;
revoke all on function campaign_report_summary(bigint) from authenticated;
grant execute on function campaign_report_summary(bigint) to service_role;

revoke all on function campaign_report_by_branch(bigint) from public;
revoke all on function campaign_report_by_branch(bigint) from anon;
revoke all on function campaign_report_by_branch(bigint) from authenticated;
grant execute on function campaign_report_by_branch(bigint) to service_role;

notify pgrst, 'reload schema';

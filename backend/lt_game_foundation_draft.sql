-- DRAFT ONLY: do not apply until game rules, identity and abuse controls are approved.
-- Inert campaign inventory foundation. No routes, prize allocation, plays or wallet writes.
begin;
create table public.lt_game_campaigns (
 id uuid primary key default gen_random_uuid(),
 business_id bigint not null references public.businesses(id) on delete restrict,
 title text not null check(length(btrim(title)) between 1 and 100),
 game_kind text not null check(game_kind in ('spin','scratch','puzzle','mission')),
 status text not null default 'draft' check(status in ('draft','archived')),
 starts_at timestamptz,
 ends_at timestamptz,
 daily_play_limit integer not null default 1 check(daily_play_limit between 1 and 20),
 created_at timestamptz not null default now(),
 check(ends_at is null or (starts_at is not null and ends_at > starts_at)),
 unique(business_id,id)
);
create table public.lt_game_prizes (
 id uuid primary key default gen_random_uuid(),
 business_id bigint not null,
 campaign_id uuid not null,
 title text not null check(length(btrim(title)) between 1 and 100),
 total_quantity integer not null check(total_quantity between 0 and 100000),
 foreign key(business_id,campaign_id) references public.lt_game_campaigns(business_id,id) on delete restrict
);
create index lt_game_campaigns_business_idx on public.lt_game_campaigns(business_id);
create index lt_game_prizes_campaign_idx on public.lt_game_prizes(business_id,campaign_id);
alter table public.lt_game_campaigns enable row level security;
alter table public.lt_game_prizes enable row level security;
revoke all on public.lt_game_campaigns,public.lt_game_prizes from public,anon,authenticated,service_role;
-- No service role grants until audited backend endpoints exist.
commit;

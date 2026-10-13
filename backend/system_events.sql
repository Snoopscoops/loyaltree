begin;
create table if not exists public.system_events (
    id bigint generated always as identity primary key,
    ts timestamptz not null default now(),
    event text not null,
    level text not null check (level in ('debug','info','warning','error')),
    business_slug text,
    endpoint text,
    status integer,
    payload jsonb not null default '{}'::jsonb
);
create index if not exists system_events_ts_id_idx on public.system_events (ts, id);
create index if not exists system_events_event_ts_idx on public.system_events (event, ts);
alter table public.system_events enable row level security;
revoke all on public.system_events from anon, authenticated;
grant select, insert on public.system_events to service_role;
grant usage, select on sequence public.system_events_id_seq to service_role;
-- Keep serial identity stable; revision survives Render restarts and workers.
alter table public.apple_wallet_registrations
    add column if not exists pass_updated_at timestamptz;
commit;

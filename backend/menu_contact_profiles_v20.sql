-- Phase 2: private checkout profile and durable, single-use contact OTP.
-- Apply only after isolated migration and access-control tests.
begin;
create table if not exists public.menu_contact_profiles (
  business_id text not null, customer_public_id text not null,
  phone text not null default '' check (char_length(phone) <= 32),
  addresses jsonb not null default '[]'::jsonb check (jsonb_typeof(addresses) = 'array' and jsonb_array_length(addresses) <= 10),
  default_address_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (business_id, customer_public_id)
);
create table if not exists public.menu_contact_challenges (
  business_id text not null, customer_public_id text not null,
  challenge_id text not null, code_digest text not null,
  expires_at timestamptz not null, issued_at timestamptz not null,
  attempts int not null default 0, consumed boolean not null default false,
  window_started timestamptz not null, request_count int not null,
  primary key (business_id, customer_public_id)
);
alter table public.menu_contact_profiles enable row level security;
alter table public.menu_contact_challenges enable row level security;
revoke all on public.menu_contact_profiles, public.menu_contact_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.menu_contact_profiles, public.menu_contact_challenges to service_role;

-- One active challenge per member, at most 5 sends per hour and 60 seconds apart.
create or replace function public.menu_contact_issue(p_business text,p_customer text,p_challenge text,p_digest text)
returns boolean language plpgsql set search_path = '' as $$
declare changed integer;
begin
  insert into public.menu_contact_challenges as c
    (business_id,customer_public_id,challenge_id,code_digest,expires_at,issued_at,attempts,consumed,window_started,request_count)
  values (p_business,p_customer,p_challenge,p_digest,now()+interval '10 minutes',now(),0,false,now(),1)
  on conflict (business_id,customer_public_id) do update set
    challenge_id=excluded.challenge_id, code_digest=excluded.code_digest,
    expires_at=excluded.expires_at, issued_at=excluded.issued_at, attempts=0,consumed=false,
    request_count=case when c.window_started <= now()-interval '1 hour' then 1 else c.request_count+1 end,
    window_started=case when c.window_started <= now()-interval '1 hour' then now() else c.window_started end
  where c.issued_at <= now()-interval '60 seconds'
    and (c.window_started <= now()-interval '1 hour' or c.request_count < 5);
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

-- A failed guess commits its attempt count; success consumes the challenge.
create or replace function public.menu_contact_verify(p_business text,p_customer text,p_challenge text,p_digest text)
returns boolean language plpgsql set search_path = '' as $$
declare c public.menu_contact_challenges%rowtype;
begin
  select * into c from public.menu_contact_challenges
    where business_id=p_business and customer_public_id=p_customer for update;
  if not found or c.challenge_id <> p_challenge or c.consumed or c.attempts >= 5 or c.expires_at <= now() then
    return false;
  end if;
  update public.menu_contact_challenges set attempts=attempts+1,
    consumed=(c.code_digest=p_digest) or attempts+1>=5
    where business_id=p_business and customer_public_id=p_customer;
  return c.code_digest=p_digest;
end $$;
revoke all on function public.menu_contact_issue(text,text,text,text),public.menu_contact_verify(text,text,text,text) from public,anon,authenticated;
grant execute on function public.menu_contact_issue(text,text,text,text),public.menu_contact_verify(text,text,text,text) to service_role;
commit;

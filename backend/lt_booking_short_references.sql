-- Short booking references: preserve UUID identity, retries and existing links.
begin;
create or replace function public.lt_booking_short_code(p_id uuid)
returns text language plpgsql immutable strict set search_path = pg_catalog as $$
declare
  raw bytea := uuid_send(p_id);
  n bigint := 0;
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  code text := '';
  i integer;
begin
  -- 60 random bits of UUIDv4; omit the fixed version nibble.
  for i in 0..5 loop n := (n << 8) | get_byte(raw,i); end loop;
  n := (n << 4) | (get_byte(raw,6) & 15);
  n := (n << 8) | get_byte(raw,7);
  for i in reverse 11..0 loop
    code := code || substr(alphabet, ((n >> (i*5)) & 31)::integer+1,1);
  end loop;
  return code;
end;
$$;
revoke all on function public.lt_booking_short_code(uuid) from public,anon,authenticated;
grant execute on function public.lt_booking_short_code(uuid) to service_role;
alter table public.lt_bookings add column if not exists booking_code text generated always as (public.lt_booking_short_code(id)) stored;
create unique index if not exists lt_bookings_business_code_unique on public.lt_bookings(business_id,booking_code);
notify pgrst, 'reload schema';
commit;

-- LOYALTY TREE / ANGKAN: STOREHUB REGISTER ID SETUP
-- Run in Supabase SQL Editor before deploying the backend and frontend.
--
-- TARGETED GATEWAY MALL REPAIR:
-- Keep pairing cea90f73-e5d8-4043-b31c-70c14b2006e0 active.
-- Disable these two confirmed obsolete pairings; retain their rows and history:
--   6645ea4b-3663-4a23-881e-8954ae3a965d
--   e1ba3c6d-66e9-46d5-8959-e8228d3d006e
-- An older device checking in after the inspected timestamps stops this script.
-- Other branches/devices are unchanged. Any later failure rolls back the repair.
-- Confirm the keeper against the physical POS before running this script.
begin;

-- ============================================================
-- 1. REGISTER ID NORMALIZATION
-- ============================================================
-- Match Python str.strip(), including nonbreaking and Unicode whitespace.
-- The pure normalizer is safe for any role maintaining this indexed table.
create or replace function public.pos_normalize_storehub_register(p_register_id text)
returns text language sql immutable strict parallel safe set search_path = public as $$
  select nullif(btrim(p_register_id,
    U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'), '')
$$;

-- ============================================================
-- 1A. TARGETED LEGACY GATEWAY MALL PAIRING REPAIR
-- ============================================================
do $$
declare
  v_keep public.pos_devices%rowtype;
  v_old public.pos_devices%rowtype;
  v_ids text[] := array[
    'cea90f73-e5d8-4043-b31c-70c14b2006e0',
    '6645ea4b-3663-4a23-881e-8954ae3a965d',
    'e1ba3c6d-66e9-46d5-8959-e8228d3d006e'
  ];
  v_count integer;
  v_expected_seen timestamptz;
begin
  -- All three IDs absent means a fresh installation, with no legacy repair.
  perform 1 from public.pos_devices where id::text = any(v_ids)
    order by id::text for update;
  select count(*) into v_count from public.pos_devices where id::text = any(v_ids);
  if v_count = 0 then return; end if;
  if v_count <> 3 then
    raise exception 'Gateway Mall device records changed since inspection. Rerun the device check before installing this repair';
  end if;
  select * into v_keep from public.pos_devices where id::text = v_ids[1];
  if lower(coalesce(v_keep.provider::text, '')) <> 'storehub'
     or v_keep.status::text is distinct from 'active'
     or v_keep.branch_id::text is distinct from '50'
     or v_keep.integration_id::text is distinct from '2d34e3e4-3b55-48cd-a35e-75273319bf62'
     or public.pos_normalize_storehub_register(v_keep.metadata->>'external_terminal_id')
       is distinct from '683981062d8a2900083a998d' then
    raise exception 'The Gateway Mall keeper is no longer the inspected active StoreHub pairing. No devices were disabled';
  end if;
  for v_old in select * from public.pos_devices where id::text = any(v_ids) order by id::text loop
    if v_old.business_id::text is distinct from v_keep.business_id::text
       or v_old.branch_id::text is distinct from v_keep.branch_id::text
       or v_old.integration_id::text is distinct from v_keep.integration_id::text
       or lower(coalesce(v_old.provider::text, '')) <> 'storehub'
       or public.pos_normalize_storehub_register(v_old.metadata->>'external_terminal_id')
         is distinct from '683981062d8a2900083a998d'
       or not exists (select 1 from public.pos_branch_mappings m
         where m.id::text = v_old.mapping_id::text
           and m.business_id::text = v_keep.business_id::text
           and m.branch_id::text = v_keep.branch_id::text
           and m.integration_id::text = v_keep.integration_id::text
           and m.external_branch_id = '68397fe9474be40007880517'
           and m.is_active is true) then
      raise exception 'Gateway Mall pairing % has changed branch/outlet/Register ID since inspection. No devices were disabled', v_old.id;
    end if;
    if v_old.id = v_keep.id then continue; end if;
    -- Preserve an already disabled/revoked record on repeat runs.
    if v_old.status::text in ('disabled', 'revoked') then continue; end if;
    if v_old.status::text is distinct from 'active' then
      raise exception 'Gateway Mall pairing % has an unexpected status. No devices were disabled', v_old.id;
    end if;
    v_expected_seen := case v_old.id::text
      when '6645ea4b-3663-4a23-881e-8954ae3a965d' then timestamptz '2026-10-09 08:43:26.514518+00'
      when 'e1ba3c6d-66e9-46d5-8959-e8228d3d006e' then timestamptz '2026-10-09 07:36:49.938626+00'
    end;
    if v_old.last_seen_at is distinct from v_expected_seen then
      raise exception 'Gateway Mall pairing % checked in again or changed since inspection. Rerun the device check; no devices were disabled', v_old.id;
    end if;
    update public.pos_devices set status = 'disabled',
      metadata = (case when jsonb_typeof(metadata) = 'object' then metadata else '{}'::jsonb end)
        || jsonb_build_object('storehub_register_binding_repair', jsonb_build_object(
          'kept_device_id', v_keep.id::text,
          'previous_status', v_old.status::text,
          'register_id', v_old.metadata->>'external_terminal_id',
          'changed_at', clock_timestamp(),
          'reason', 'Confirmed obsolete Gateway Mall pairing shares another device Register ID'))
      where id = v_old.id;
  end loop;
end $$;


-- ============================================================
-- 2. VALIDATE EXISTING POS SCHEMA AND ACTIVE BINDINGS
-- ============================================================
do $$
declare v_duplicates text;
begin
  if to_regclass('public.pos_devices') is null
     or to_regclass('public.pos_branch_mappings') is null
     or to_regclass('public.pos_integrations') is null
     or to_regclass('public.branches') is null then
    raise exception 'Install the existing POS devices, branch mappings, integrations and branches schema first';
  end if;
  if exists (select 1 from public.pos_devices
    where lower(coalesce(provider::text, '')) = 'storehub' and status::text = 'active'
      and public.pos_normalize_storehub_register(metadata->>'external_terminal_id') is not null
      and (integration_id is null or branch_id is null
        or jsonb_typeof(metadata->'external_terminal_id') is distinct from 'string'
        or length(public.pos_normalize_storehub_register(metadata->>'external_terminal_id')) > 120)) then
    raise exception 'An active StoreHub device has an invalid Register ID or no integration/branch. Correct its binding before installing this migration';
  end if;
  select string_agg(register_id || ' [devices: ' || devices || ']', '; ')
    into v_duplicates from (
      select integration_id, branch_id,
        public.pos_normalize_storehub_register(metadata->>'external_terminal_id') register_id,
        string_agg(id::text, ', ' order by id::text) devices
      from public.pos_devices
      where lower(coalesce(provider::text, '')) = 'storehub' and status::text = 'active'
        and public.pos_normalize_storehub_register(metadata->>'external_terminal_id') is not null
      group by integration_id, branch_id,
        public.pos_normalize_storehub_register(metadata->>'external_terminal_id')
      having count(*) > 1
      limit 10
    ) duplicates;
  if v_duplicates is not null then
    raise exception 'Duplicate active StoreHub Register IDs: %. Assign each machine its own ID or retire the old device, then rerun', v_duplicates;
  end if;
end $$;

-- ============================================================
-- 3. DATABASE DUPLICATE PROTECTION
-- ============================================================
-- IDs are opaque and case-sensitive. Whitespace cannot bypass uniqueness.
create unique index if not exists pos_devices_storehub_register_active_uidx
  on public.pos_devices (integration_id, branch_id,
    (public.pos_normalize_storehub_register(metadata->>'external_terminal_id')))
  where lower(coalesce(provider::text, '')) = 'storehub' and status::text = 'active'
    and public.pos_normalize_storehub_register(metadata->>'external_terminal_id') is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pos_devices'::regclass
    and conname = 'pos_devices_storehub_register_scope_check') then
    alter table public.pos_devices add constraint pos_devices_storehub_register_scope_check check (
      lower(coalesce(provider::text, '')) <> 'storehub' or status::text is distinct from 'active'
      or public.pos_normalize_storehub_register(metadata->>'external_terminal_id') is null
      or (integration_id is not null and branch_id is not null
        and jsonb_typeof(metadata->'external_terminal_id') = 'string'
        and length(public.pos_normalize_storehub_register(metadata->>'external_terminal_id')) <= 120)
    );
  end if;
end $$;

-- ============================================================
-- 4. DEPLOYMENT READINESS CHECK
-- ============================================================
create or replace function public.pos_storehub_register_guard_ready()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pg_index
    where indexrelid = to_regclass('public.pos_devices_storehub_register_active_uidx')
      and indrelid = 'public.pos_devices'::regclass and indisunique and indisvalid
      and indnkeyatts = 3 and indnatts = 3
      and pg_get_indexdef(indexrelid, 1, true) = 'integration_id'
      and pg_get_indexdef(indexrelid, 2, true) = 'branch_id'
      and regexp_replace(pg_get_indexdef(indexrelid, 3, true), '[[:space:]()]|::text', '', 'g') =
        'pos_normalize_storehub_registermetadata->>''external_terminal_id'''
      and regexp_replace(pg_get_expr(indpred, indrelid), '[[:space:]()]|::text', '', 'g') =
        'lowerCOALESCEprovider,''''=''storehub''ANDstatus=''active''ANDpos_normalize_storehub_registermetadata->>''external_terminal_id''ISNOTNULL')
    and exists (select 1 from pg_constraint
      where conrelid = 'public.pos_devices'::regclass
        and conname = 'pos_devices_storehub_register_scope_check' and convalidated and contype = 'c'
        and regexp_replace(pg_get_constraintdef(oid), '[[:space:]()]|::text', '', 'g') =
          'CHECKlowerCOALESCEprovider,''''<>''storehub''ORstatusISDISTINCTFROM''active''ORpos_normalize_storehub_registermetadata->>''external_terminal_id''ISNULLORintegration_idISNOTNULLANDbranch_idISNOTNULLANDjsonb_typeofmetadata->''external_terminal_id''=''string''ANDlengthpos_normalize_storehub_registermetadata->>''external_terminal_id''<=120')
$$;

-- CREATE INDEX IF NOT EXISTS must not silently accept a different index with
-- this name, including an interrupted/invalid index or weaker uniqueness scope.
do $$
begin
  if not public.pos_storehub_register_guard_ready() then
    raise exception 'Existing StoreHub Register ID protection differs from the required definition. Inspect pos_devices_storehub_register_active_uidx and its scope constraint before rerunning; this migration does not replace existing indexes';
  end if;
end $$;

-- ============================================================
-- 5. ASSIGN A REGISTER TO AN EXISTING ACTIVE DEVICE
-- ============================================================
-- Both RPCs lock the current device and merge only their own metadata fields.
-- A Check POS result can never overwrite a Register ID saved at the same time.
create or replace function public.pos_assign_storehub_register(
  p_device_id text, p_business_id text, p_register_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_device public.pos_devices%rowtype;
  v_mapping public.pos_branch_mappings%rowtype;
  v_register text := public.pos_normalize_storehub_register(p_register_id);
begin
  if nullif(v_register, '') is null or length(v_register) > 120 then
    raise exception 'A StoreHub Register ID of 1 to 120 characters is required';
  end if;
  if not public.pos_storehub_register_guard_ready() then
    raise exception 'StoreHub Register ID protection is not installed';
  end if;
  select * into v_device from public.pos_devices
    where id::text = p_device_id and business_id::text = p_business_id for update;
  if not found or lower(coalesce(v_device.provider::text, '')) <> 'storehub'
     or v_device.status::text is distinct from 'active' then
    raise exception 'An active StoreHub device belonging to this business is required';
  end if;
  select * into v_mapping from public.pos_branch_mappings
    where id::text = v_device.mapping_id::text
      and business_id::text = v_device.business_id::text
      and integration_id::text = v_device.integration_id::text
      and branch_id::text = v_device.branch_id::text
      and is_active is true for share;
  if not found or nullif(trim(v_mapping.external_branch_id), '') is null
     or not exists (select 1 from public.pos_integrations
       where id::text = v_device.integration_id::text
         and business_id::text = v_device.business_id::text
         and lower(coalesce(provider::text, '')) = 'storehub')
     or not exists (select 1 from public.branches
       where id::text = v_device.branch_id::text
         and business_id::text = v_device.business_id::text and is_active is true) then
    raise exception 'This StoreHub device has no active branch/outlet mapping';
  end if;
  update public.pos_devices set metadata =
    (case when jsonb_typeof(metadata) = 'object' then metadata else '{}'::jsonb end)
      || jsonb_build_object('external_terminal_id', v_register)
    where id = v_device.id returning * into v_device;
  return to_jsonb(v_device);
end $$;

-- ============================================================
-- 6. RECORD OBSERVED REGISTER IDS
-- ============================================================
create or replace function public.pos_record_storehub_registers(
  p_device_id text, p_external_branch_id text, p_register_ids jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_device public.pos_devices%rowtype;
  v_mapping public.pos_branch_mappings%rowtype;
  v_metadata jsonb;
  v_seen jsonb;
begin
  if jsonb_typeof(p_register_ids) is distinct from 'array'
     or jsonb_array_length(p_register_ids) > 100 then
    raise exception 'At most 100 observed StoreHub Register IDs are allowed';
  end if;
  if exists (select 1 from jsonb_array_elements(p_register_ids) value
    where jsonb_typeof(value) <> 'string'
      or public.pos_normalize_storehub_register(value #>> '{}') is null
      or length(public.pos_normalize_storehub_register(value #>> '{}')) > 120) then
    raise exception 'Observed StoreHub Register IDs must be nonblank strings up to 120 characters';
  end if;
  select * into v_device from public.pos_devices where id::text = p_device_id for update;
  if not found or lower(coalesce(v_device.provider::text, '')) <> 'storehub'
     or v_device.status::text is distinct from 'active' then
    raise exception 'An active StoreHub device is required';
  end if;
  select * into v_mapping from public.pos_branch_mappings
    where id::text = v_device.mapping_id::text
      and business_id::text = v_device.business_id::text
      and integration_id::text = v_device.integration_id::text
      and branch_id::text = v_device.branch_id::text and is_active is true
      and external_branch_id = p_external_branch_id for share;
  if not found or nullif(trim(v_mapping.external_branch_id), '') is null
     or not exists (select 1 from public.pos_integrations
       where id::text = v_device.integration_id::text
         and business_id::text = v_device.business_id::text
         and lower(coalesce(provider::text, '')) = 'storehub')
     or not exists (select 1 from public.branches
       where id::text = v_device.branch_id::text
         and business_id::text = v_device.business_id::text and is_active is true) then
    raise exception 'Observed Register IDs do not belong to this device active branch/outlet';
  end if;
  v_metadata := case when jsonb_typeof(v_device.metadata) = 'object'
    then v_device.metadata else '{}'::jsonb end;
  select coalesce(jsonb_agg(register_id order by register_id), '[]'::jsonb) into v_seen
  from (
    select distinct public.pos_normalize_storehub_register(value #>> '{}') register_id
    from jsonb_array_elements(p_register_ids || case
      when v_metadata->>'seen_register_outlet_id' = p_external_branch_id
        and jsonb_typeof(v_metadata->'seen_register_ids') = 'array'
      then v_metadata->'seen_register_ids' else '[]'::jsonb end) value
    where jsonb_typeof(value) = 'string'
      and length(public.pos_normalize_storehub_register(value #>> '{}')) between 1 and 120
    order by register_id limit 100
  ) observed;
  v_metadata := v_metadata || jsonb_build_object(
    'seen_register_ids', v_seen, 'seen_register_outlet_id', p_external_branch_id,
    'seen_registers_updated_at', clock_timestamp());
  update public.pos_devices set metadata = v_metadata where id = v_device.id;
  return v_metadata;
end $$;

-- ============================================================
-- 7. BACKEND PERMISSIONS AND POSTGREST RELOAD
-- ============================================================
revoke all on function public.pos_storehub_register_guard_ready() from public, anon, authenticated;
revoke all on function public.pos_assign_storehub_register(text, text, text) from public, anon, authenticated;
revoke all on function public.pos_record_storehub_registers(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pos_normalize_storehub_register(text) to public;
grant execute on function public.pos_storehub_register_guard_ready() to service_role;
grant execute on function public.pos_assign_storehub_register(text, text, text) to service_role;
grant execute on function public.pos_record_storehub_registers(text, text, jsonb) to service_role;
commit;
notify pgrst, 'reload schema';

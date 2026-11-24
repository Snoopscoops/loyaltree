-- Stage 2: atomic, owner-issued, pending-only StoreHub device activation.
-- Install only with the complete two-stage application release (not Stage 2 alone).
-- No existing device, branch mapping, credential or loyalty balance is modified.
begin;

create or replace function public.pos_activate_pending_companion(
  p_activation_id text, p_code_hash text, p_device_token_hash text,
  p_hardware_model text, p_scanner_method text, p_checkout_mode text,
  p_overlay_enabled boolean, p_app_version text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code public.pos_device_activation_codes%rowtype;
  v_integration public.pos_integrations%rowtype;
  v_mapping public.pos_branch_mappings%rowtype;
  v_branch public.branches%rowtype;
  v_device public.pos_devices%rowtype;
  v_scope jsonb;
  v_outlet text;
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
     or p_device_token_hash is null or p_device_token_hash !~ '^[a-f0-9]{64}$'
     or nullif(btrim(p_hardware_model),'') is null or length(p_hardware_model)>100
     or p_scanner_method is null or p_scanner_method not in ('camera','hardware','external_scanner')
     or p_checkout_mode is null or p_checkout_mode not in ('direct','floating','web','auto')
     or p_overlay_enabled is null or length(coalesce(p_app_version,''))>50 then
    raise exception 'Invalid pending activation request';
  end if;
  -- Serialize competing consumers. Any failure rolls back both insertion and use.
  select * into v_code from public.pos_device_activation_codes
    where id::text=p_activation_id for update;
  if not found or v_code.code_hash is distinct from p_code_hash
     or v_code.revoked_at is not null or v_code.expires_at is null
     or not isfinite(v_code.expires_at) or v_code.expires_at<=clock_timestamp()
     or coalesce(v_code.max_uses,0)<>1 or coalesce(v_code.used_count,0)<>0
     or v_code.provider::text is distinct from 'storehub' then
    raise exception 'Pending activation code invalid, expired or used';
  end if;
  v_scope := v_code.metadata;
  if jsonb_typeof(v_scope) is distinct from 'object'
     or v_scope->'pending_pairing' is distinct from 'true'::jsonb
     or v_scope->>'purpose' is distinct from 'pos_companion_device_activation'
     or v_scope->>'generated_by' is distinct from 'owner'
     or nullif(v_scope->>'reactivate_device_id','') is not null
     or nullif(v_scope->>'allowed_external_terminal_id','') is not null
     or nullif(v_scope->>'pending_integration_id','') is null
     or nullif(v_scope->>'pending_mapping_id','') is null
     or nullif(v_scope->>'allowed_branch_id','') is null
     or nullif(v_scope->>'allowed_branch_public_id','') is null then
    raise exception 'Pending activation code has invalid scope';
  end if;
  v_outlet := btrim(coalesce(v_scope->>'allowed_external_branch_id',''));
  if v_outlet='' or lower(v_outlet) like 'test-%' or lower(v_outlet) like 'mock-%' then
    raise exception 'Pending activation requires a real StoreHub outlet';
  end if;
  -- Current connection and exact mapping are authoritative, not the APK request.
  select * into v_integration from public.pos_integrations
    where id::text=v_scope->>'pending_integration_id' for share;
  if not found or v_integration.business_id::text is distinct from v_code.business_id::text
     or v_integration.provider::text is distinct from 'storehub'
     or coalesce(v_integration.status::text,'') not in ('connected','testing','live')
     or nullif(btrim(v_integration.credentials_ciphertext::text),'') is null
     or jsonb_typeof(v_integration.config->'storehub_outlets') is distinct from 'array' then
    raise exception 'Pending activation requires the current linked StoreHub account';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_integration.config->'storehub_outlets') o
      where btrim(o->>'id')=v_outlet) then
    raise exception 'Pending activation outlet no longer belongs to this account';
  end if;
  select * into v_branch from public.branches
    where id::text=v_scope->>'allowed_branch_id' for share;
  if not found or v_branch.business_id::text is distinct from v_code.business_id::text
     or v_branch.public_id::text is distinct from v_scope->>'allowed_branch_public_id'
     or v_branch.is_active is not true then
    raise exception 'Pending activation branch unavailable';
  end if;
  select * into v_mapping from public.pos_branch_mappings
    where id::text=v_scope->>'pending_mapping_id' for share;
  if not found or v_mapping.business_id::text is distinct from v_code.business_id::text
     or v_mapping.integration_id::text is distinct from v_integration.id::text
     or v_mapping.branch_id::text is distinct from v_branch.id::text
     or v_mapping.external_branch_id::text is distinct from v_outlet
     or v_mapping.is_active is not true then
    raise exception 'Pending activation mapping changed';
  end if;
  if v_code.expires_at<=clock_timestamp() then
    raise exception 'Pending activation code expired while waiting';
  end if;
  insert into public.pos_devices (business_id,branch_id,integration_id,mapping_id,provider,
    device_token_hash,display_name,hardware_model,scanner_method,checkout_mode,overlay_enabled,
    status,app_version,last_seen_at,metadata)
  values (v_code.business_id,v_branch.id,v_integration.id,v_mapping.id,'storehub',
    p_device_token_hash,coalesce(nullif(btrim(v_scope->>'device_name'),''),left(coalesce(v_branch.name,'Branch')||' Companion',200)),
    p_hardware_model,p_scanner_method,p_checkout_mode,p_overlay_enabled,'active',p_app_version,now(),
    jsonb_build_object('activation_code_id',v_code.id::text,'pairing_verification','pending',
      'pending_pairing_outlet_id',v_outlet,'pending_pairing_started_at',now()))
  returning * into v_device;
  update public.pos_device_activation_codes set used_count=1 where id=v_code.id;
  return to_jsonb(v_device);
end $$;

revoke all on function public.pos_activate_pending_companion(text,text,text,text,text,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public.pos_activate_pending_companion(text,text,text,text,text,text,boolean,text)
  to service_role;

create or replace function public.pos_pending_pairing_ready()
returns boolean language sql stable security definer set search_path=public as $$
  select to_regprocedure('public.pos_activate_pending_companion(text,text,text,text,text,text,boolean,text)') is not null;
$$;
revoke all on function public.pos_pending_pairing_ready() from public,anon,authenticated;
grant execute on function public.pos_pending_pairing_ready() to service_role;
-- Stage 3: only the service role can atomically bind a pending device after
-- server-side provider evidence + authorized owner's receipt confirmation.
create or replace function public.pos_verify_pending_storehub_register(
  p_device_id text, p_business_id text, p_expected_token_hash text,
  p_integration_id text, p_mapping_id text, p_outlet_id text, p_credentials_digest text,
  p_register_id text, p_transaction_id text, p_receipt_number text, p_transaction_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_device public.pos_devices%rowtype;
  v_integration public.pos_integrations%rowtype;
  v_mapping public.pos_branch_mappings%rowtype;
  v_register text := public.pos_normalize_storehub_register(p_register_id);
begin
  if not public.pos_storehub_register_guard_ready() then
    raise exception 'StoreHub register duplicate guard is not installed';
  end if;
  if v_register is null or length(v_register)>120
     or nullif(btrim(p_transaction_id),'') is null or length(p_transaction_id)>200
     or nullif(btrim(p_receipt_number),'') is null or length(p_receipt_number)>200
     or p_transaction_at is null or not isfinite(p_transaction_at)
     or p_transaction_at<clock_timestamp()-interval '1 day' or p_transaction_at>clock_timestamp()
     or nullif(btrim(p_outlet_id),'') is null or lower(p_outlet_id) like 'test-%' or lower(p_outlet_id) like 'mock-%'
     or nullif(btrim(p_expected_token_hash),'') is null
     or p_credentials_digest is null or p_credentials_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid register verification evidence';
  end if;
  -- Lock the integration and mapping so a concurrent reconnection or remapping
  -- cannot turn an old provider receipt into proof for a different account.
  select * into v_integration from public.pos_integrations
    where id::text=p_integration_id and business_id::text=p_business_id for share;
  if not found or v_integration.provider::text is distinct from 'storehub'
     or coalesce(v_integration.status::text,'') not in ('connected','testing','live')
     or nullif(btrim(v_integration.credentials_ciphertext::text),'') is null
     or encode(sha256(convert_to(v_integration.credentials_ciphertext::text,'UTF8')),'hex') is distinct from p_credentials_digest
     or jsonb_typeof(v_integration.config->'storehub_outlets') is distinct from 'array' then
    raise exception 'StoreHub connection changed';
  end if;
  if not exists(select 1 from jsonb_array_elements(v_integration.config->'storehub_outlets') o where btrim(o->>'id')=p_outlet_id) then
    raise exception 'StoreHub outlet no longer belongs to this account';
  end if;
  select * into v_mapping from public.pos_branch_mappings where id::text=p_mapping_id
    and business_id::text=p_business_id and integration_id::text=p_integration_id
    and external_branch_id=p_outlet_id and is_active is true for share;
  if not found then raise exception 'POS mapping changed'; end if;
  perform 1 from public.branches where id=v_mapping.branch_id and business_id::text=p_business_id
    and is_active is true for share;
  if not found then raise exception 'POS branch inactive'; end if;
  select * into v_device from public.pos_devices where id::text=p_device_id and business_id::text=p_business_id
    and integration_id::text=p_integration_id and mapping_id::text=p_mapping_id and branch_id=v_mapping.branch_id for update;
  if not found or v_device.provider::text is distinct from 'storehub' or v_device.status::text is distinct from 'active'
     or v_device.device_token_hash is distinct from p_expected_token_hash
     or to_jsonb(v_device)->>'revoked_at' is not null
     or v_device.metadata->>'pairing_verification' is distinct from 'pending'
     or v_device.metadata->>'pending_pairing_outlet_id' is distinct from p_outlet_id
     or nullif(v_device.metadata->>'pending_pairing_started_at','') is null
     or p_transaction_at < (v_device.metadata->>'pending_pairing_started_at')::timestamptz
     or public.pos_normalize_storehub_register(v_device.metadata->>'external_terminal_id') is not null then
    raise exception 'Pending device changed or receipt predates activation';
  end if;
  -- Existing partial unique index rejects concurrent duplicate bindings.
  update public.pos_devices set metadata=metadata || jsonb_build_object(
    'external_terminal_id',v_register,'pairing_verification','verified',
    'pairing_verified_at',clock_timestamp(),'pairing_verified_outlet_id',p_outlet_id,
    'pairing_verified_transaction_id',p_transaction_id,'pairing_verified_receipt_number',p_receipt_number)
    where id=v_device.id returning * into v_device;
  return to_jsonb(v_device);
end $$;
revoke all on function public.pos_verify_pending_storehub_register(text,text,text,text,text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.pos_verify_pending_storehub_register(text,text,text,text,text,text,text,text,text,text,timestamptz) to service_role;

notify pgrst,'reload schema';
commit;

-- Run in Supabase before deploying existing-POS Companion reactivation.
-- This migration adds one service-only function. It changes no device or token
-- until a POS consumes a manager-generated reactivation code.
begin;

do $$ begin
  if to_regclass('public.pos_device_activation_codes') is null
     or to_regclass('public.pos_devices') is null
     or to_regclass('public.staff') is null
     or to_regclass('public.pos_branch_mappings') is null
     or to_regclass('public.pos_integrations') is null
     or to_regclass('public.branches') is null
     or to_regprocedure('public.pos_offline_sale_lock_scope(text)') is null
     or to_regprocedure('public.pos_offline_sale_assert_device(text,text,text,text,text,text)') is null then
    raise exception 'Install the existing POS activation, register-binding and offline-sale migrations first';
  end if;
end $$;

create or replace function public.pos_reactivate_companion_device(
  p_activation_id text, p_code_hash text, p_device_token_hash text,
  p_hardware_model text, p_scanner_method text, p_checkout_mode text,
  p_overlay_enabled boolean, p_app_version text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code public.pos_device_activation_codes%rowtype;
  v_device public.pos_devices%rowtype;
  v_integration public.pos_integrations%rowtype;
  v_manager public.staff%rowtype;
  v_scope jsonb;
  v_permissions jsonb;
  v_integration_id text;
  v_register_id text;
begin
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
     or p_device_token_hash is null or p_device_token_hash !~ '^[a-f0-9]{64}$'
     or nullif(btrim(p_hardware_model),'') is null or length(p_hardware_model)>100
     or p_scanner_method is null or p_scanner_method not in ('camera','hardware','external_scanner')
     or p_checkout_mode is null or p_checkout_mode not in ('direct','floating','web','auto')
     or p_overlay_enabled is null or length(coalesce(p_app_version,''))>50 then
    raise exception 'Invalid Companion reactivation request';
  end if;

  -- Read only the lock scope first. Every authoritative check follows the lock.
  select metadata->>'reactivate_integration_id' into v_integration_id
    from public.pos_device_activation_codes where id::text=p_activation_id;
  if nullif(v_integration_id,'') is null then
    raise exception 'Companion reactivation code not found';
  end if;
  perform public.pos_offline_sale_lock_scope(v_integration_id);
  select * into v_code from public.pos_device_activation_codes
    where id::text=p_activation_id for update;
  if not found or v_code.code_hash is distinct from p_code_hash
     or v_code.revoked_at is not null or v_code.expires_at is null
     or v_code.expires_at<=now() or not isfinite(v_code.expires_at)
     or coalesce(v_code.max_uses,0)<>1 or coalesce(v_code.used_count,0)<>0
     or lower(coalesce(v_code.provider::text,''))<>'storehub' then
    raise exception 'Companion reactivation code is invalid, expired or already used';
  end if;
  v_scope := v_code.metadata;
  if jsonb_typeof(v_scope) is distinct from 'object'
     or v_scope->>'purpose' is distinct from 'pos_companion_device_activation'
     or v_scope->>'generated_by' is distinct from 'branch_manager'
     or v_scope->>'reactivate_integration_id' is distinct from v_integration_id
     or nullif(v_scope->>'reactivate_device_id','') is null
     or nullif(v_scope->>'reactivate_mapping_id','') is null
     or nullif(v_scope->>'manager_staff_id','') is null
     or coalesce(v_scope->>'reactivate_expected_token_hash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'Companion reactivation code has an invalid device scope';
  end if;
  v_register_id := public.pos_offline_trim(v_scope->>'allowed_external_terminal_id');
  if nullif(v_register_id,'') is null or length(v_register_id)>120 then
    raise exception 'Companion reactivation requires the saved StoreHub Register ID';
  end if;

  select * into v_device from public.pos_devices
    where id::text=v_scope->>'reactivate_device_id' for update;
  if not found or v_device.status::text is distinct from 'active' or to_jsonb(v_device)->>'revoked_at' is not null
     or lower(coalesce(v_device.provider::text,''))<>'storehub'
     or v_device.business_id::text is distinct from v_code.business_id::text
     or v_device.branch_id::text is distinct from v_scope->>'allowed_branch_id'
     or v_device.integration_id::text is distinct from v_integration_id
     or v_device.mapping_id::text is distinct from v_scope->>'reactivate_mapping_id'
     or v_device.device_token_hash is distinct from v_scope->>'reactivate_expected_token_hash'
     or v_device.device_token_hash is not distinct from p_device_token_hash
     or public.pos_offline_trim(v_device.metadata->>'external_terminal_id') is distinct from v_register_id then
    raise exception 'Companion reactivation no longer matches the active POS pairing';
  end if;
  -- The same helper used for offline receipts validates current branch, mapping
  -- and register scope while retaining those rows for the rest of this commit.
  perform public.pos_offline_sale_assert_device(v_device.id::text,v_device.business_id::text,
    v_device.branch_id::text,v_integration_id,v_scope->>'allowed_external_branch_id',v_register_id);
  select * into v_integration from public.pos_integrations
    where id::text=v_integration_id for share;
  if not found or v_integration.business_id::text is distinct from v_device.business_id::text
     or lower(coalesce(v_integration.provider::text,''))<>'storehub'
     or lower(coalesce(v_integration.status::text,'')) in ('disconnected','error') then
    raise exception 'Companion reactivation requires the current connected StoreHub account';
  end if;
  perform 1 from public.branches where id::text=v_device.branch_id::text
    and business_id::text=v_device.business_id::text and is_active is true
    and public_id::text=v_scope->>'allowed_branch_public_id' for share;
  if not found then raise exception 'Companion reactivation branch is unavailable'; end if;

  select * into v_manager from public.staff where id::text=v_scope->>'manager_staff_id' for share;
  if not found or v_manager.business_id::text is distinct from v_device.business_id::text
     or v_manager.branch_id::text is distinct from v_device.branch_id::text
     or v_manager.is_active is false
     or lower(coalesce(v_manager.role::text,''))<>'manager' then
    raise exception 'Companion reactivation manager access was revoked or reassigned';
  end if;
  v_permissions := to_jsonb(v_manager)->'permissions';
  if jsonb_typeof(v_permissions)='string' then
    begin v_permissions := (v_permissions#>>'{}')::jsonb;
    exception when others then v_permissions := '{}'::jsonb; end;
  end if;
  if jsonb_typeof(v_permissions) is distinct from 'object'
     or v_permissions->'manage_companion_devices' is distinct from 'true'::jsonb then
    raise exception 'Companion reactivation manager permission was removed';
  end if;
  if exists(select 1 from public.pos_devices d
    where d.id<>v_device.id and d.integration_id::text=v_integration_id
      and d.branch_id::text=v_device.branch_id::text and d.status::text='active'
      and lower(coalesce(d.provider::text,''))='storehub'
      and public.pos_offline_trim(d.metadata->>'external_terminal_id')=v_register_id) then
    raise exception 'Companion reactivation Register ID belongs to another active POS';
  end if;

  update public.pos_devices set device_token_hash=p_device_token_hash,
    hardware_model=p_hardware_model, scanner_method=p_scanner_method,
    checkout_mode=p_checkout_mode, overlay_enabled=p_overlay_enabled,
    app_version=p_app_version, last_seen_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'last_reactivation_code_id',v_code.id::text,'last_reactivated_at',now(),
      'reactivation_count',case when coalesce(metadata->>'reactivation_count','') ~ '^[0-9]{1,8}$'
        then (metadata->>'reactivation_count')::integer+1 else 1 end)
    where id=v_device.id returning * into v_device;
  update public.pos_device_activation_codes set used_count=1
    where id=v_code.id;
  return to_jsonb(v_device);
end $$;

revoke all on function public.pos_reactivate_companion_device(text,text,text,text,text,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public.pos_reactivate_companion_device(text,text,text,text,text,text,boolean,text)
  to service_role;
notify pgrst, 'reload schema';
commit;

-- Preserve the new identity/scope/order fields when older callers such as the
-- read-only RotaCloud sync omit them from the private staff payload.

begin;

alter function public.save_rota_staff_profile_private(uuid, uuid, jsonb)
  rename to save_rota_staff_profile_private_core;

create or replace function public.save_rota_staff_profile_private(
  target_organisation uuid,
  target_actor uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  existing_staff payroll_private.rota_staff_profiles%rowtype;
  enriched_payload jsonb := payload;
  requested_id uuid := nullif(payload->>'id', '')::uuid;
  requested_app_profile uuid := nullif(payload->>'appProfileId', '')::uuid;
  requested_employee_ref text := trim(coalesce(payload->>'employeeRef', ''));
begin
  if requested_id is not null then
    select * into existing_staff
    from payroll_private.rota_staff_profiles staff
    where staff.id = requested_id
      and staff.organisation_id = target_organisation;
  elsif requested_app_profile is not null then
    select * into existing_staff
    from payroll_private.rota_staff_profiles staff
    where staff.app_profile_id = requested_app_profile
      and staff.organisation_id = target_organisation;
  elsif requested_employee_ref <> '' then
    select * into existing_staff
    from payroll_private.rota_staff_profiles staff
    where staff.employee_ref = requested_employee_ref
      and staff.organisation_id = target_organisation;
  end if;

  if found then
    enriched_payload = jsonb_build_object(
      'appProfileId', existing_staff.app_profile_id,
      'organisationWide', existing_staff.organisation_wide,
      'roleRank', existing_staff.role_rank,
      'displayOrder', existing_staff.display_order
    ) || payload;
  end if;

  return public.save_rota_staff_profile_private_core(
    target_organisation,
    target_actor,
    enriched_payload
  );
end;
$$;

revoke all on function public.save_rota_staff_profile_private_core(uuid, uuid, jsonb) from public;
revoke all on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) from public;
grant execute on function public.save_rota_staff_profile_private_core(uuid, uuid, jsonb) to service_role;
grant execute on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) to service_role;

commit;

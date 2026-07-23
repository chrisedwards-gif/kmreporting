-- Make existing Labour settings the single source of salary cost for rota planning.
-- Also ensure only the latest effective rota membership is used for a person/site.

begin;

alter table payroll_private.rota_staff_site_memberships
  drop constraint if exists rota_staff_site_memberships_check;

alter table payroll_private.rota_staff_site_memberships
  drop constraint if exists rota_staff_site_memberships_pay_detail_check;

alter table payroll_private.rota_staff_site_memberships
  add constraint rota_staff_site_memberships_pay_detail_check
  check (
    (
      pay_basis = 'hourly'
      and hourly_rate > 0
      and annual_salary is null
    )
    or
    (
      pay_basis = 'salaried'
      and hourly_rate is null
      and contracted_weekly_hours > 0
    )
  );

create or replace function public.get_rota_private_staff(
  target_organisation uuid,
  target_site uuid,
  target_week_start date
)
returns jsonb
language sql
stable
security definer
set search_path = public, payroll_private, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', staff.id,
    'appProfileId', staff.app_profile_id,
    'employeeRef', staff.employee_ref,
    'rotacloudUserId', staff.rotacloud_user_id,
    'staffName', staff.staff_name,
    'primaryRole', staff.primary_role,
    'roleTitle', coalesce(nullif(membership.role_title, ''), staff.primary_role),
    'roleRank', staff.role_rank,
    'displayOrder', staff.display_order,
    'organisationWide', staff.organisation_wide,
    'skills', staff.skills,
    'minimumWeeklyHours', staff.minimum_weekly_hours,
    'targetWeeklyHours', staff.target_weekly_hours,
    'maximumWeeklyHours', staff.maximum_weekly_hours,
    'minimumShiftMinutes', staff.minimum_shift_minutes,
    'maximumShiftMinutes', staff.maximum_shift_minutes,
    'maximumConsecutiveDays', staff.maximum_consecutive_days,
    'preferredDays', staff.preferred_days,
    'preferredStart', staff.preferred_start,
    'preferredEnd', staff.preferred_end,
    'payBasis', case when coalesce(salary.configured, false) then 'salaried' else membership.pay_basis end,
    'loadedHourlyRate', case
      when coalesce(salary.configured, false) or membership.pay_basis = 'salaried' then 0
      else round(
        membership.hourly_rate
        * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate),
        4
      )
    end,
    'fixedWeeklyCost', coalesce(salary.loaded_week_cost, 0),
    'costAllocationPct', case
      when coalesce(salary.configured, false) or membership.pay_basis = 'salaried' then 100
      else membership.cost_allocation_pct
    end,
    'salaryConfigured', coalesce(salary.configured, false)
  ) order by staff.role_rank, staff.display_order, staff.staff_name), '[]'::jsonb)
  from payroll_private.rota_staff_profiles staff
  join lateral (
    select candidate.*
    from payroll_private.rota_staff_site_memberships candidate
    where candidate.staff_profile_id = staff.id
      and candidate.organisation_id = target_organisation
      and candidate.site_id = target_site
      and candidate.active
      and candidate.valid_from <= target_week_start + 6
      and (candidate.valid_to is null or candidate.valid_to >= target_week_start)
    order by candidate.valid_from desc, candidate.updated_at desc, candidate.id desc
    limit 1
  ) membership on true
  left join lateral (
    select
      true as configured,
      round(sum(
        allocation.annual_salary / 52
        * allocation.allocation_pct / 100
        * (
          (least(coalesce(allocation.valid_to, target_week_start + 6), target_week_start + 6)
            - greatest(allocation.valid_from, target_week_start) + 1)::numeric / 7
        )
        * (1 + allocation.oncost_rate / 100)
      ), 2) as loaded_week_cost
    from payroll_private.salary_allocations allocation
    where allocation.organisation_id = target_organisation
      and allocation.site_id = target_site
      and allocation.active
      and allocation.valid_from <= target_week_start + 6
      and (allocation.valid_to is null or allocation.valid_to >= target_week_start)
      and (
        (staff.app_profile_id is not null and allocation.profile_id = staff.app_profile_id)
        or (
          allocation.profile_id is null
          and regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g')
              = regexp_replace(lower(trim(staff.staff_name)), '\s+', ' ', 'g')
        )
      )
  ) salary on true
  where staff.organisation_id = target_organisation
    and staff.active;
$$;

create or replace function public.get_rota_private_workspace(target_organisation uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, payroll_private, pg_temp
as $$
  with latest_memberships as (
    select distinct on (membership.staff_profile_id, membership.site_id)
      membership.*
    from payroll_private.rota_staff_site_memberships membership
    where membership.organisation_id = target_organisation
      and membership.active
      and membership.valid_from <= current_date
      and (membership.valid_to is null or membership.valid_to >= current_date)
    order by membership.staff_profile_id, membership.site_id,
      membership.valid_from desc, membership.updated_at desc, membership.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', staff.id,
    'appProfileId', staff.app_profile_id,
    'employeeRef', staff.employee_ref,
    'rotacloudUserId', staff.rotacloud_user_id,
    'staffName', staff.staff_name,
    'primaryRole', staff.primary_role,
    'roleRank', staff.role_rank,
    'displayOrder', staff.display_order,
    'organisationWide', staff.organisation_wide,
    'skills', staff.skills,
    'minimumWeeklyHours', staff.minimum_weekly_hours,
    'targetWeeklyHours', staff.target_weekly_hours,
    'maximumWeeklyHours', staff.maximum_weekly_hours,
    'minimumShiftMinutes', staff.minimum_shift_minutes,
    'maximumShiftMinutes', staff.maximum_shift_minutes,
    'maximumConsecutiveDays', staff.maximum_consecutive_days,
    'preferredDays', staff.preferred_days,
    'preferredStart', staff.preferred_start,
    'preferredEnd', staff.preferred_end,
    'notes', staff.notes,
    'active', staff.active,
    'siteId', membership.site_id,
    'roleTitle', membership.role_title,
    'payBasis', case when coalesce(salary.configured, false) then 'salaried' else membership.pay_basis end,
    'hourlyRate', case when coalesce(salary.configured, false) then null else membership.hourly_rate end,
    'annualSalary', salary.annual_salary,
    'contractedWeeklyHours', membership.contracted_weekly_hours,
    'employerNiRate', membership.employer_ni_rate,
    'pensionRate', membership.pension_rate,
    'otherOncostRate', membership.other_oncost_rate,
    'costAllocationPct', coalesce(salary.allocation_pct, membership.cost_allocation_pct),
    'salaryConfigured', coalesce(salary.configured, false),
    'primarySite', membership.primary_site,
    'validFrom', membership.valid_from,
    'validTo', membership.valid_to
  ) order by staff.role_rank, staff.display_order, staff.staff_name, membership.primary_site desc), '[]'::jsonb)
  from payroll_private.rota_staff_profiles staff
  join latest_memberships membership
    on membership.staff_profile_id = staff.id
  left join lateral (
    select
      true as configured,
      max(allocation.annual_salary) as annual_salary,
      max(allocation.allocation_pct) as allocation_pct
    from payroll_private.salary_allocations allocation
    where allocation.organisation_id = target_organisation
      and allocation.site_id = membership.site_id
      and allocation.active
      and allocation.valid_from <= current_date
      and (allocation.valid_to is null or allocation.valid_to >= current_date)
      and (
        (staff.app_profile_id is not null and allocation.profile_id = staff.app_profile_id)
        or (
          allocation.profile_id is null
          and regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g')
              = regexp_replace(lower(trim(staff.staff_name)), '\s+', ' ', 'g')
        )
      )
  ) salary on true
  where staff.organisation_id = target_organisation;
$$;

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
  target_site uuid := (payload->>'siteId')::uuid;
  target_valid_from date := coalesce(nullif(payload->>'validFrom', '')::date, current_date);
  saved_id uuid;
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
    enriched_payload := jsonb_build_object(
      'appProfileId', existing_staff.app_profile_id,
      'organisationWide', existing_staff.organisation_wide,
      'roleRank', existing_staff.role_rank,
      'displayOrder', existing_staff.display_order
    ) || payload;
  end if;

  saved_id := public.save_rota_staff_profile_private_core(
    target_organisation,
    target_actor,
    enriched_payload
  );

  update payroll_private.rota_staff_site_memberships older
  set valid_to = target_valid_from - 1,
      updated_at = now()
  where older.organisation_id = target_organisation
    and older.staff_profile_id = saved_id
    and older.valid_from < target_valid_from
    and (older.valid_to is null or older.valid_to >= target_valid_from)
    and exists (
      select 1
      from payroll_private.rota_staff_site_memberships current_membership
      where current_membership.organisation_id = target_organisation
        and current_membership.staff_profile_id = saved_id
        and current_membership.site_id = older.site_id
        and current_membership.valid_from = target_valid_from
    );

  return saved_id;
end;
$$;

revoke all on function public.get_rota_private_staff(uuid, uuid, date) from public;
revoke all on function public.get_rota_private_workspace(uuid) from public;
revoke all on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) from public;
grant execute on function public.get_rota_private_staff(uuid, uuid, date) to service_role;
grant execute on function public.get_rota_private_workspace(uuid) to service_role;
grant execute on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) to service_role;

commit;

-- Correct salary detection and make draft saves recalculate from the same
-- Labour salary allocations used by weekly reporting.

begin;

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
    'payBasis', case when salary.configured then 'salaried' else membership.pay_basis end,
    'loadedHourlyRate', case
      when salary.configured or membership.pay_basis = 'salaried' then 0
      else round(
        membership.hourly_rate
        * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate),
        4
      )
    end,
    'fixedWeeklyCost', salary.loaded_week_cost,
    'costAllocationPct', case
      when salary.configured or membership.pay_basis = 'salaried' then 100
      else membership.cost_allocation_pct
    end,
    'salaryConfigured', salary.configured
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
      count(*) > 0 as configured,
      round(coalesce(sum(
        allocation.annual_salary / 52
        * allocation.allocation_pct / 100
        * (
          (least(coalesce(allocation.valid_to, target_week_start + 6), target_week_start + 6)
            - greatest(allocation.valid_from, target_week_start) + 1)::numeric / 7
        )
        * (1 + allocation.oncost_rate / 100)
      ), 0), 2) as loaded_week_cost
    from payroll_private.salary_allocations allocation
    where allocation.organisation_id = target_organisation
      and allocation.site_id = target_site
      and allocation.active
      and allocation.valid_from <= target_week_start + 6
      and (allocation.valid_to is null or allocation.valid_to >= target_week_start)
      and (
        (staff.app_profile_id is not null and allocation.profile_id = staff.app_profile_id)
        or (
          staff.app_profile_id is null
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
    'payBasis', case when salary.configured then 'salaried' else membership.pay_basis end,
    'hourlyRate', case when salary.configured then null else membership.hourly_rate end,
    'annualSalary', salary.annual_salary,
    'contractedWeeklyHours', membership.contracted_weekly_hours,
    'employerNiRate', membership.employer_ni_rate,
    'pensionRate', membership.pension_rate,
    'otherOncostRate', membership.other_oncost_rate,
    'costAllocationPct', case when salary.configured then salary.allocation_pct else membership.cost_allocation_pct end,
    'salaryConfigured', salary.configured,
    'primarySite', membership.primary_site,
    'validFrom', membership.valid_from,
    'validTo', membership.valid_to
  ) order by staff.role_rank, staff.display_order, staff.staff_name, membership.primary_site desc), '[]'::jsonb)
  from payroll_private.rota_staff_profiles staff
  join latest_memberships membership
    on membership.staff_profile_id = staff.id
  left join lateral (
    select
      count(*) > 0 as configured,
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
          staff.app_profile_id is null
          and regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g')
              = regexp_replace(lower(trim(staff.staff_name)), '\s+', ' ', 'g')
        )
      )
  ) salary on true
  where staff.organisation_id = target_organisation;
$$;

alter function public.save_rota_builder_draft_private(uuid, uuid, uuid, uuid, jsonb)
  rename to save_rota_builder_draft_private_core;

create or replace function public.save_rota_builder_draft_private(
  target_organisation uuid,
  target_site uuid,
  target_plan uuid,
  target_actor uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  result jsonb;
begin
  result := public.save_rota_builder_draft_private_core(
    target_organisation,
    target_site,
    target_plan,
    target_actor,
    payload
  );

  update public.rota_plan_days day_row
  set planned_cost = round(
    day_row.fixed_labour_cost
    + coalesce((
      select sum(
        membership.hourly_rate
        * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate)
        * shift_row.paid_minutes / 60.0
      )
      from public.rota_plan_shifts shift_row
      join payroll_private.rota_staff_profiles staff
        on staff.id = shift_row.staff_profile_id
       and staff.organisation_id = target_organisation
      join lateral (
        select candidate.*
        from payroll_private.rota_staff_site_memberships candidate
        where candidate.staff_profile_id = staff.id
          and candidate.organisation_id = target_organisation
          and candidate.site_id = target_site
          and candidate.active
          and candidate.valid_from <= day_row.business_date
          and (candidate.valid_to is null or candidate.valid_to >= day_row.business_date)
        order by candidate.valid_from desc, candidate.updated_at desc, candidate.id desc
        limit 1
      ) membership on true
      where shift_row.plan_day_id = day_row.id
        and membership.pay_basis = 'hourly'
        and not exists (
          select 1
          from payroll_private.salary_allocations allocation
          where allocation.organisation_id = target_organisation
            and allocation.site_id = target_site
            and allocation.active
            and allocation.valid_from <= day_row.business_date
            and (allocation.valid_to is null or allocation.valid_to >= day_row.business_date)
            and (
              (staff.app_profile_id is not null and allocation.profile_id = staff.app_profile_id)
              or (
                staff.app_profile_id is null
                and regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g')
                    = regexp_replace(lower(trim(staff.staff_name)), '\s+', ' ', 'g')
              )
            )
        )
    ), 0),
    2
  )
  where day_row.plan_id = target_plan;

  update public.rota_plans plan
  set planned_hours = coalesce((
        select round(sum(day_row.planned_hours), 2)
        from public.rota_plan_days day_row
        where day_row.plan_id = target_plan
      ), 0),
      planned_cost = coalesce((
        select round(sum(day_row.planned_cost), 2)
        from public.rota_plan_days day_row
        where day_row.plan_id = target_plan
      ), 0),
      updated_at = now()
  where plan.id = target_plan
    and plan.organisation_id = target_organisation
    and plan.site_id = target_site;

  select jsonb_build_object(
    'plannedHours', plan.planned_hours,
    'plannedCost', plan.planned_cost,
    'shiftCount', (select count(*) from public.rota_plan_shifts where plan_id = target_plan),
    'markCount', (select count(*) from public.rota_plan_marks where plan_id = target_plan)
  ) into result
  from public.rota_plans plan
  where plan.id = target_plan;

  return result;
end;
$$;

revoke all on function public.get_rota_private_staff(uuid, uuid, date) from public;
revoke all on function public.get_rota_private_workspace(uuid) from public;
revoke all on function public.save_rota_builder_draft_private_core(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.save_rota_builder_draft_private(uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.get_rota_private_staff(uuid, uuid, date) to service_role;
grant execute on function public.get_rota_private_workspace(uuid) to service_role;
grant execute on function public.save_rota_builder_draft_private_core(uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.save_rota_builder_draft_private(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;

-- Bootstrap rota identities from existing Labour salary allocations.
-- Salary cost remains sourced only from payroll_private.salary_allocations.

begin;

with allocation_people as (
  select distinct on (
    allocation.organisation_id,
    coalesce(allocation.profile_id::text, regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g'))
  )
    allocation.organisation_id,
    allocation.profile_id,
    allocation.staff_name,
    allocation.role_title,
    case
      when allocation.profile_id is not null then 'salary-profile:' || allocation.profile_id::text
      else 'salary-name:' || md5(regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g'))
    end as employee_ref,
    case
      when lower(allocation.role_title) like '%group%' then true
      when lower(allocation.role_title) like '%development%' then true
      else false
    end as organisation_wide,
    case
      when lower(allocation.role_title) like '%group chef%' then 100
      when lower(allocation.role_title) like '%executive%' then 110
      when lower(allocation.role_title) like '%kitchen manager%' then 200
      when lower(allocation.role_title) like '%sous%' then 300
      else 500
    end::smallint as role_rank
  from payroll_private.salary_allocations allocation
  where allocation.active
    and allocation.valid_from <= current_date
    and (allocation.valid_to is null or allocation.valid_to >= current_date)
  order by
    allocation.organisation_id,
    coalesce(allocation.profile_id::text, regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g')),
    allocation.updated_at desc,
    allocation.id desc
)
insert into payroll_private.rota_staff_profiles (
  organisation_id,
  employee_ref,
  app_profile_id,
  staff_name,
  primary_role,
  skills,
  minimum_weekly_hours,
  target_weekly_hours,
  maximum_weekly_hours,
  minimum_shift_minutes,
  maximum_shift_minutes,
  maximum_consecutive_days,
  preferred_days,
  notes,
  active,
  organisation_wide,
  role_rank,
  display_order
)
select
  person.organisation_id,
  person.employee_ref,
  person.profile_id,
  person.staff_name,
  person.role_title,
  array[regexp_replace(lower(trim(person.role_title)), '[^a-z0-9]+', ' ', 'g')],
  0,
  40,
  48,
  240,
  720,
  6,
  '{1,2,3,4,5}'::smallint[],
  'Created from the existing Labour salary allocation. Salary and on-cost remain controlled in Labour settings.',
  true,
  person.organisation_wide,
  person.role_rank,
  1000
from allocation_people person
where not exists (
  select 1
  from payroll_private.rota_staff_profiles existing
  where existing.organisation_id = person.organisation_id
    and (
      existing.employee_ref = person.employee_ref
      or (person.profile_id is not null and existing.app_profile_id = person.profile_id)
    )
);

insert into payroll_private.rota_staff_site_memberships (
  organisation_id,
  staff_profile_id,
  site_id,
  role_title,
  pay_basis,
  hourly_rate,
  annual_salary,
  contracted_weekly_hours,
  employer_ni_rate,
  pension_rate,
  other_oncost_rate,
  cost_allocation_pct,
  primary_site,
  active,
  valid_from,
  valid_to
)
select
  allocation.organisation_id,
  staff.id,
  allocation.site_id,
  allocation.role_title,
  'salaried',
  null,
  null,
  40,
  0,
  0,
  0,
  allocation.allocation_pct,
  true,
  allocation.active,
  allocation.valid_from,
  allocation.valid_to
from payroll_private.salary_allocations allocation
join payroll_private.rota_staff_profiles staff
  on staff.organisation_id = allocation.organisation_id
 and (
   (allocation.profile_id is not null and staff.app_profile_id = allocation.profile_id)
   or (
     allocation.profile_id is null
     and staff.employee_ref = 'salary-name:' || md5(regexp_replace(lower(trim(allocation.staff_name)), '\s+', ' ', 'g'))
   )
 )
where allocation.active
  and allocation.valid_from <= current_date
  and (allocation.valid_to is null or allocation.valid_to >= current_date)
on conflict (staff_profile_id, site_id, valid_from)
do update set
  role_title = excluded.role_title,
  pay_basis = 'salaried',
  hourly_rate = null,
  annual_salary = null,
  contracted_weekly_hours = excluded.contracted_weekly_hours,
  cost_allocation_pct = excluded.cost_allocation_pct,
  active = excluded.active,
  valid_to = excluded.valid_to,
  updated_at = now();

commit;

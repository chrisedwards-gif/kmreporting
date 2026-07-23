-- Rota identity, organisation-wide scope and display ordering
--
-- One rota staff profile may link to exactly one application profile UUID.
-- Group-level staff can appear at every kitchen without allocating their salary
-- to every site. Display rank/order is controlled centrally by management.

begin;

alter table payroll_private.rota_staff_profiles
  add column if not exists app_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists organisation_wide boolean not null default false,
  add column if not exists role_rank smallint not null default 500 check (role_rank between 0 and 9999),
  add column if not exists display_order integer not null default 1000 check (display_order >= 0);

create unique index if not exists rota_staff_profiles_org_app_profile_uidx
  on payroll_private.rota_staff_profiles(organisation_id, app_profile_id)
  where app_profile_id is not null;

-- Link only unambiguous exact-name matches. Duplicate names remain deliberately
-- unlinked until an admin chooses the correct account in the private team screen.
with name_matches as (
  select
    staff.id as staff_id,
    min(profile.id) as profile_id,
    count(*) as match_count
  from payroll_private.rota_staff_profiles staff
  join public.profiles profile
    on profile.organisation_id = staff.organisation_id
   and profile.active
   and regexp_replace(lower(trim(profile.full_name)), '\s+', ' ', 'g')
       = regexp_replace(lower(trim(staff.staff_name)), '\s+', ' ', 'g')
  where staff.app_profile_id is null
  group by staff.id
)
update payroll_private.rota_staff_profiles staff
set app_profile_id = matches.profile_id,
    updated_at = now()
from name_matches matches
where matches.staff_id = staff.id
  and matches.match_count = 1;

update payroll_private.rota_staff_profiles
set role_rank = case
      when lower(primary_role) ~ '(group|executive|head chef|culinary director)' then 100
      when lower(primary_role) ~ '(kitchen manager|general manager|head of)' then 200
      when lower(primary_role) ~ '(pizz|pizza)' then 300
      when lower(primary_role) ~ '(senior|supervisor|lead)' then 350
      else 400
    end
where role_rank = 500;

with ranked as (
  select
    id,
    row_number() over (
      partition by organisation_id, role_rank
      order by staff_name, id
    ) * 10 as next_order
  from payroll_private.rota_staff_profiles
)
update payroll_private.rota_staff_profiles staff
set display_order = ranked.next_order,
    updated_at = now()
from ranked
where ranked.id = staff.id
  and staff.display_order = 1000;

alter table payroll_private.rota_staff_site_memberships
  drop constraint if exists rota_staff_site_memberships_cost_allocation_pct_check;

alter table payroll_private.rota_staff_site_memberships
  add constraint rota_staff_site_memberships_cost_allocation_pct_check
  check (cost_allocation_pct >= 0 and cost_allocation_pct <= 100);

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
    'payBasis', membership.pay_basis,
    'loadedHourlyRate', round(
      coalesce(
        membership.hourly_rate,
        membership.annual_salary / nullif(52 * membership.contracted_weekly_hours, 0)
      ) * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate),
      4
    ),
    'fixedWeeklyCost', case when membership.pay_basis = 'salaried' then round(
      membership.annual_salary / 52
      * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate),
      2
    ) else 0 end,
    'costAllocationPct', membership.cost_allocation_pct
  ) order by staff.role_rank, staff.display_order, staff.staff_name), '[]'::jsonb)
  from payroll_private.rota_staff_profiles staff
  join payroll_private.rota_staff_site_memberships membership
    on membership.staff_profile_id = staff.id
   and membership.organisation_id = target_organisation
   and membership.site_id = target_site
   and membership.active
   and membership.valid_from <= target_week_start + 6
   and (membership.valid_to is null or membership.valid_to >= target_week_start)
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
    'payBasis', membership.pay_basis,
    'hourlyRate', membership.hourly_rate,
    'annualSalary', membership.annual_salary,
    'contractedWeeklyHours', membership.contracted_weekly_hours,
    'employerNiRate', membership.employer_ni_rate,
    'pensionRate', membership.pension_rate,
    'otherOncostRate', membership.other_oncost_rate,
    'costAllocationPct', membership.cost_allocation_pct,
    'primarySite', membership.primary_site,
    'validFrom', membership.valid_from,
    'validTo', membership.valid_to
  ) order by staff.role_rank, staff.display_order, staff.staff_name, membership.primary_site desc), '[]'::jsonb)
  from payroll_private.rota_staff_profiles staff
  join payroll_private.rota_staff_site_memberships membership
    on membership.staff_profile_id = staff.id
   and membership.organisation_id = target_organisation
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
  target_id uuid := nullif(payload->>'id', '')::uuid;
  target_app_profile uuid := nullif(payload->>'appProfileId', '')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  target_employee_ref text := left(trim(coalesce(payload->>'employeeRef', '')), 120);
  target_name text := left(trim(coalesce(payload->>'staffName', '')), 120);
  target_role text := left(trim(coalesce(payload->>'roleTitle', '')), 120);
  target_pay_basis text := payload->>'payBasis';
  target_valid_from date := coalesce(nullif(payload->>'validFrom', '')::date, current_date);
  target_organisation_wide boolean := coalesce((payload->>'organisationWide')::boolean, false);
  target_role_rank smallint := coalesce((payload->>'roleRank')::smallint, 500);
  target_display_order integer := coalesce((payload->>'displayOrder')::integer, 1000);
  target_cost_allocation numeric := coalesce((payload->>'costAllocationPct')::numeric, 100);
  target_primary boolean := coalesce((payload->>'primarySite')::boolean, true);
  actor_role public.app_role;
  other_site record;
begin
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = target_actor
    and profile.organisation_id = target_organisation
    and profile.active;

  if actor_role not in ('admin', 'group_manager') then
    raise exception 'rota staff access denied';
  end if;

  if not exists (
    select 1 from public.sites site
    where site.id = target_site
      and site.organisation_id = target_organisation
      and site.active
  ) then
    raise exception 'site not found';
  end if;

  if target_app_profile is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = target_app_profile
      and profile.organisation_id = target_organisation
      and profile.active
  ) then
    raise exception 'linked app profile is outside this organisation';
  end if;

  if target_app_profile is not null and exists (
    select 1
    from payroll_private.rota_staff_profiles staff
    where staff.organisation_id = target_organisation
      and staff.app_profile_id = target_app_profile
      and (target_id is null or staff.id <> target_id)
  ) then
    raise exception 'app profile is already linked to another rota person';
  end if;

  if length(target_employee_ref) < 1 or length(target_name) < 2 then
    raise exception 'invalid staff profile';
  end if;

  if target_id is null and target_app_profile is not null then
    select staff.id into target_id
    from payroll_private.rota_staff_profiles staff
    where staff.organisation_id = target_organisation
      and staff.app_profile_id = target_app_profile;
  end if;

  if target_id is null then
    select staff.id into target_id
    from payroll_private.rota_staff_profiles staff
    where staff.organisation_id = target_organisation
      and staff.employee_ref = target_employee_ref;
  end if;

  if target_id is null then
    insert into payroll_private.rota_staff_profiles (
      organisation_id,
      app_profile_id,
      employee_ref,
      rotacloud_user_id,
      staff_name,
      primary_role,
      organisation_wide,
      role_rank,
      display_order,
      skills,
      minimum_weekly_hours,
      target_weekly_hours,
      maximum_weekly_hours,
      minimum_shift_minutes,
      maximum_shift_minutes,
      maximum_consecutive_days,
      preferred_days,
      preferred_start,
      preferred_end,
      notes,
      active
    ) values (
      target_organisation,
      target_app_profile,
      target_employee_ref,
      nullif(payload->>'rotacloudUserId', '')::bigint,
      target_name,
      target_role,
      target_organisation_wide,
      target_role_rank,
      target_display_order,
      coalesce(array(select jsonb_array_elements_text(coalesce(payload->'skills', '[]'::jsonb))), '{}'::text[]),
      coalesce((payload->>'minimumWeeklyHours')::numeric, 0),
      coalesce((payload->>'targetWeeklyHours')::numeric, 40),
      coalesce((payload->>'maximumWeeklyHours')::numeric, 48),
      coalesce((payload->>'minimumShiftMinutes')::smallint, 240),
      coalesce((payload->>'maximumShiftMinutes')::smallint, 720),
      coalesce((payload->>'maximumConsecutiveDays')::smallint, 6),
      coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(payload->'preferredDays', '[1,2,3,4,5]'::jsonb))), '{1,2,3,4,5}'::smallint[]),
      nullif(payload->>'preferredStart', '')::time,
      nullif(payload->>'preferredEnd', '')::time,
      left(coalesce(payload->>'notes', ''), 1000),
      coalesce((payload->>'active')::boolean, true)
    ) returning id into target_id;
  else
    update payroll_private.rota_staff_profiles
    set app_profile_id = target_app_profile,
        employee_ref = target_employee_ref,
        rotacloud_user_id = nullif(payload->>'rotacloudUserId', '')::bigint,
        staff_name = target_name,
        primary_role = target_role,
        organisation_wide = target_organisation_wide,
        role_rank = target_role_rank,
        display_order = target_display_order,
        skills = coalesce(array(select jsonb_array_elements_text(coalesce(payload->'skills', '[]'::jsonb))), '{}'::text[]),
        minimum_weekly_hours = coalesce((payload->>'minimumWeeklyHours')::numeric, minimum_weekly_hours),
        target_weekly_hours = coalesce((payload->>'targetWeeklyHours')::numeric, target_weekly_hours),
        maximum_weekly_hours = coalesce((payload->>'maximumWeeklyHours')::numeric, maximum_weekly_hours),
        minimum_shift_minutes = coalesce((payload->>'minimumShiftMinutes')::smallint, minimum_shift_minutes),
        maximum_shift_minutes = coalesce((payload->>'maximumShiftMinutes')::smallint, maximum_shift_minutes),
        maximum_consecutive_days = coalesce((payload->>'maximumConsecutiveDays')::smallint, maximum_consecutive_days),
        preferred_days = coalesce(array(select value::smallint from jsonb_array_elements_text(coalesce(payload->'preferredDays', '[]'::jsonb))), preferred_days),
        preferred_start = nullif(payload->>'preferredStart', '')::time,
        preferred_end = nullif(payload->>'preferredEnd', '')::time,
        notes = left(coalesce(payload->>'notes', notes), 1000),
        active = coalesce((payload->>'active')::boolean, active),
        updated_at = now()
    where id = target_id
      and organisation_id = target_organisation;

    if not found then raise exception 'staff profile not found'; end if;
  end if;

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
  ) values (
    target_organisation,
    target_id,
    target_site,
    target_role,
    target_pay_basis,
    case when target_pay_basis = 'hourly' then (payload->>'hourlyRate')::numeric else null end,
    case when target_pay_basis = 'salaried' then (payload->>'annualSalary')::numeric else null end,
    nullif(payload->>'contractedWeeklyHours', '')::numeric,
    coalesce((payload->>'employerNiRate')::numeric, 0),
    coalesce((payload->>'pensionRate')::numeric, 0),
    coalesce((payload->>'otherOncostRate')::numeric, 0),
    target_cost_allocation,
    target_primary,
    coalesce((payload->>'active')::boolean, true),
    target_valid_from,
    nullif(payload->>'validTo', '')::date
  )
  on conflict (staff_profile_id, site_id, valid_from) do update
  set role_title = excluded.role_title,
      pay_basis = excluded.pay_basis,
      hourly_rate = excluded.hourly_rate,
      annual_salary = excluded.annual_salary,
      contracted_weekly_hours = excluded.contracted_weekly_hours,
      employer_ni_rate = excluded.employer_ni_rate,
      pension_rate = excluded.pension_rate,
      other_oncost_rate = excluded.other_oncost_rate,
      cost_allocation_pct = excluded.cost_allocation_pct,
      primary_site = excluded.primary_site,
      active = excluded.active,
      valid_to = excluded.valid_to,
      updated_at = now();

  if target_organisation_wide then
    for other_site in
      select site.id
      from public.sites site
      where site.organisation_id = target_organisation
        and site.active
        and site.id <> target_site
    loop
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
      ) values (
        target_organisation,
        target_id,
        other_site.id,
        target_role,
        target_pay_basis,
        case when target_pay_basis = 'hourly' then (payload->>'hourlyRate')::numeric else null end,
        case when target_pay_basis = 'salaried' then (payload->>'annualSalary')::numeric else null end,
        nullif(payload->>'contractedWeeklyHours', '')::numeric,
        coalesce((payload->>'employerNiRate')::numeric, 0),
        coalesce((payload->>'pensionRate')::numeric, 0),
        coalesce((payload->>'otherOncostRate')::numeric, 0),
        0,
        false,
        coalesce((payload->>'active')::boolean, true),
        target_valid_from,
        nullif(payload->>'validTo', '')::date
      )
      on conflict (staff_profile_id, site_id, valid_from) do nothing;
    end loop;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    target_organisation,
    target_actor,
    'rota.staff_profile_saved',
    'rota_staff_profile',
    target_id,
    jsonb_build_object(
      'site_id', target_site,
      'app_profile_id', target_app_profile,
      'organisation_wide', target_organisation_wide,
      'role_rank', target_role_rank,
      'display_order', target_display_order,
      'pay_basis', target_pay_basis,
      'source', coalesce(payload->>'source', 'manual')
    )
  );

  return target_id;
end;
$$;

create or replace function public.save_rota_staff_order_private(
  target_organisation uuid,
  target_actor uuid,
  payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  actor_role public.app_role;
  item jsonb;
  updated_count integer := 0;
begin
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = target_actor
    and profile.organisation_id = target_organisation
    and profile.active;

  if actor_role not in ('admin', 'group_manager') then
    raise exception 'rota order access denied';
  end if;

  for item in select value from jsonb_array_elements(coalesce(payload, '[]'::jsonb))
  loop
    update payroll_private.rota_staff_profiles
    set role_rank = greatest(0, least(9999, (item->>'roleRank')::integer)),
        display_order = greatest(0, (item->>'displayOrder')::integer),
        updated_at = now()
    where id = (item->>'id')::uuid
      and organisation_id = target_organisation;
    if found then updated_count := updated_count + 1; end if;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    target_organisation,
    target_actor,
    'rota.staff_order_saved',
    'organisation',
    target_organisation,
    jsonb_build_object('updated_count', updated_count)
  );

  return updated_count;
end;
$$;

revoke all on function public.get_rota_private_staff(uuid, uuid, date) from public;
revoke all on function public.get_rota_private_workspace(uuid) from public;
revoke all on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) from public;
revoke all on function public.save_rota_staff_order_private(uuid, uuid, jsonb) from public;

grant execute on function public.get_rota_private_staff(uuid, uuid, date) to service_role;
grant execute on function public.get_rota_private_workspace(uuid) to service_role;
grant execute on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) to service_role;
grant execute on function public.save_rota_staff_order_private(uuid, uuid, jsonb) to service_role;

commit;

-- Rota builder workspace
--
-- Adds an auditable, site-scoped draft editor on top of generated rota plans.
-- Individual pay remains in payroll_private; public shift rows never store rates.

begin;

alter table public.rota_plan_shifts
  add column if not exists note text not null default '' check (length(note) <= 1500),
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.rota_plan_marks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.rota_plans(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  staff_profile_id uuid not null,
  business_date date not null,
  mark_type text not null check (mark_type in ('day_off', 'unavailable', 'leave', 'training')),
  note text not null default '' check (length(note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, staff_profile_id, business_date, mark_type)
);

create index if not exists rota_plan_marks_plan_date_idx
  on public.rota_plan_marks(plan_id, business_date, staff_profile_id);

alter table public.rota_plan_marks enable row level security;

drop policy if exists rota_plan_marks_read on public.rota_plan_marks;
create policy rota_plan_marks_read on public.rota_plan_marks
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

grant select on public.rota_plan_marks to authenticated;

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
  actor_role public.app_role;
  plan_row public.rota_plans%rowtype;
  day_payload jsonb;
  shift_payload jsonb;
  mark_payload jsonb;
  target_day public.rota_plan_days%rowtype;
  shift_staff_id uuid;
  shift_start_value timestamptz;
  shift_end_value timestamptz;
  shift_break smallint;
  shift_paid integer;
  shift_staff_name text;
  shift_role_title text;
  shift_pay_basis text;
  mark_staff_id uuid;
  totals jsonb;
begin
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = target_actor
    and profile.organisation_id = target_organisation
    and profile.active;

  if actor_role not in ('admin', 'group_manager', 'kitchen_manager') then
    raise exception 'rota draft access denied';
  end if;

  if not exists (
    select 1
    from public.sites site
    where site.id = target_site
      and site.organisation_id = target_organisation
      and (
        actor_role <> 'kitchen_manager'
        or exists (
          select 1 from public.site_memberships membership
          where membership.site_id = site.id
            and membership.user_id = target_actor
        )
      )
  ) then
    raise exception 'site not found or outside scope';
  end if;

  select * into plan_row
  from public.rota_plans plan
  where plan.id = target_plan
    and plan.organisation_id = target_organisation
    and plan.site_id = target_site
  for update;

  if plan_row.id is null then
    raise exception 'rota plan not found';
  end if;

  if plan_row.status = 'superseded' then
    raise exception 'superseded rota plans cannot be edited';
  end if;

  delete from public.rota_plan_shifts where plan_id = target_plan;
  delete from public.rota_plan_marks where plan_id = target_plan;

  for day_payload in
    select value from jsonb_array_elements(coalesce(payload->'days', '[]'::jsonb))
  loop
    select * into target_day
    from public.rota_plan_days day_row
    where day_row.plan_id = target_plan
      and day_row.business_date = (day_payload->>'businessDate')::date;

    if target_day.id is null then
      raise exception 'draft contains a day outside this plan';
    end if;

    for shift_payload in
      select value from jsonb_array_elements(coalesce(day_payload->'shifts', '[]'::jsonb))
    loop
      shift_staff_id := nullif(shift_payload->>'staffProfileId', '')::uuid;
      shift_start_value := (shift_payload->>'shiftStart')::timestamptz;
      shift_end_value := (shift_payload->>'shiftEnd')::timestamptz;
      shift_break := coalesce((shift_payload->>'breakMinutes')::smallint, 0);
      shift_paid := floor(extract(epoch from (shift_end_value - shift_start_value)) / 60)::integer - shift_break;

      if shift_end_value <= shift_start_value
        or shift_paid <= 0
        or shift_break < 0
        or shift_break > 180
        or (shift_start_value at time zone 'Europe/London')::date <> target_day.business_date
        or (shift_end_value - shift_start_value) > interval '18 hours'
      then
        raise exception 'invalid shift time or break';
      end if;

      if shift_staff_id is null then
        shift_staff_name := 'Open shift';
        shift_role_title := left(coalesce(nullif(shift_payload->>'roleTitle', ''), 'Cover required'), 120);
        shift_pay_basis := 'unfilled';
      else
        select
          staff.staff_name,
          coalesce(nullif(membership.role_title, ''), staff.primary_role),
          membership.pay_basis
        into shift_staff_name, shift_role_title, shift_pay_basis
        from payroll_private.rota_staff_profiles staff
        join payroll_private.rota_staff_site_memberships membership
          on membership.staff_profile_id = staff.id
         and membership.organisation_id = target_organisation
         and membership.site_id = target_site
         and membership.active
         and membership.valid_from <= target_day.business_date
         and (membership.valid_to is null or membership.valid_to >= target_day.business_date)
        where staff.id = shift_staff_id
          and staff.organisation_id = target_organisation
          and staff.active
        order by membership.valid_from desc
        limit 1;

        if shift_staff_name is null then
          raise exception 'shift staff member is outside this site';
        end if;

        shift_role_title := left(coalesce(nullif(shift_payload->>'roleTitle', ''), shift_role_title), 120);
      end if;

      insert into public.rota_plan_shifts (
        plan_id,
        plan_day_id,
        organisation_id,
        site_id,
        staff_profile_id,
        staff_name,
        role_title,
        shift_start,
        shift_end,
        break_minutes,
        paid_minutes,
        required_skill,
        assignment_reason,
        source,
        note,
        updated_by,
        updated_at
      ) values (
        target_plan,
        target_day.id,
        target_organisation,
        target_site,
        shift_staff_id,
        shift_staff_name,
        shift_role_title,
        shift_start_value,
        shift_end_value,
        shift_break,
        shift_paid,
        nullif(left(coalesce(shift_payload->>'requiredSkill', ''), 120), ''),
        left(coalesce(shift_payload->>'assignmentReason', 'Manager draft'), 500),
        'manual',
        left(coalesce(shift_payload->>'note', ''), 1500),
        target_actor,
        now()
      );
    end loop;

    update public.rota_plan_days
    set evidence = (coalesce(evidence, '{}'::jsonb) - 'coverage')
          || jsonb_build_object('coverage', coalesce(day_payload->'coverage', '[]'::jsonb)),
        warnings = coalesce(day_payload->'warnings', '[]'::jsonb)
    where id = target_day.id;
  end loop;

  for mark_payload in
    select value from jsonb_array_elements(coalesce(payload->'marks', '[]'::jsonb))
  loop
    mark_staff_id := (mark_payload->>'staffProfileId')::uuid;

    if (mark_payload->>'businessDate')::date < plan_row.week_start
      or (mark_payload->>'businessDate')::date > plan_row.week_end
      or coalesce(mark_payload->>'markType', '') not in ('day_off', 'unavailable', 'leave', 'training')
      or not exists (
        select 1
        from payroll_private.rota_staff_profiles staff
        join payroll_private.rota_staff_site_memberships membership
          on membership.staff_profile_id = staff.id
         and membership.organisation_id = target_organisation
         and membership.site_id = target_site
         and membership.active
         and membership.valid_from <= (mark_payload->>'businessDate')::date
         and (membership.valid_to is null or membership.valid_to >= (mark_payload->>'businessDate')::date)
        where staff.id = mark_staff_id
          and staff.organisation_id = target_organisation
          and staff.active
      )
    then
      raise exception 'invalid rota day marker';
    end if;

    insert into public.rota_plan_marks (
      plan_id,
      organisation_id,
      site_id,
      staff_profile_id,
      business_date,
      mark_type,
      note,
      created_by,
      updated_at
    ) values (
      target_plan,
      target_organisation,
      target_site,
      mark_staff_id,
      (mark_payload->>'businessDate')::date,
      mark_payload->>'markType',
      left(coalesce(mark_payload->>'note', ''), 1000),
      target_actor,
      now()
    );
  end loop;

  update public.rota_plan_days day_row
  set planned_hours = coalesce((
        select round(sum(shift_row.paid_minutes) / 60.0, 2)
        from public.rota_plan_shifts shift_row
        where shift_row.plan_day_id = day_row.id
          and shift_row.staff_profile_id is not null
      ), 0),
      planned_cost = round(
        day_row.fixed_labour_cost
        + coalesce((
          select sum(
            case when membership.pay_basis = 'hourly'
              then membership.hourly_rate
                * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate)
                * shift_row.paid_minutes / 60.0
              else 0
            end
          )
          from public.rota_plan_shifts shift_row
          join lateral (
            select membership.*
            from payroll_private.rota_staff_site_memberships membership
            where membership.staff_profile_id = shift_row.staff_profile_id
              and membership.organisation_id = target_organisation
              and membership.site_id = target_site
              and membership.active
              and membership.valid_from <= day_row.business_date
              and (membership.valid_to is null or membership.valid_to >= day_row.business_date)
            order by membership.valid_from desc
            limit 1
          ) membership on true
          where shift_row.plan_day_id = day_row.id
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
      warnings = coalesce(payload->'warnings', '[]'::jsonb),
      updated_at = now()
  where plan.id = target_plan;

  insert into public.audit_log (
    organisation_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    detail
  ) values (
    target_organisation,
    target_actor,
    'rota.draft_saved',
    'rota_plan',
    target_plan,
    jsonb_build_object(
      'site_id', target_site,
      'week_start', plan_row.week_start,
      'shift_count', (select count(*) from public.rota_plan_shifts where plan_id = target_plan),
      'mark_count', (select count(*) from public.rota_plan_marks where plan_id = target_plan)
    )
  );

  select jsonb_build_object(
    'plannedHours', plan.planned_hours,
    'plannedCost', plan.planned_cost,
    'shiftCount', (select count(*) from public.rota_plan_shifts where plan_id = target_plan),
    'markCount', (select count(*) from public.rota_plan_marks where plan_id = target_plan)
  ) into totals
  from public.rota_plans plan
  where plan.id = target_plan;

  return totals;
end;
$$;

revoke all on function public.save_rota_builder_draft_private(uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.save_rota_builder_draft_private(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;

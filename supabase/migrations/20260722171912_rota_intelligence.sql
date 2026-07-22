-- Rota intelligence 016
--
-- Forecasting inputs and generated rota output live in the public schema so
-- site-scoped managers can use them. Individual pay and employment constraints
-- remain in payroll_private and are available only to service-role RPCs.

begin;

create table public.rota_site_settings (
  site_id uuid primary key references public.sites(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  rotacloud_location_id bigint,
  forecast_weeks smallint not null default 8 check (forecast_weeks between 4 and 26),
  minimum_history_weeks smallint not null default 4 check (minimum_history_weeks between 2 and 12),
  interval_minutes smallint not null default 60 check (interval_minutes in (15, 30, 60)),
  sales_per_labour_hour_target numeric(10,2) not null default 95 check (sales_per_labour_hour_target between 20 and 500),
  minimum_rest_hours numeric(4,1) not null default 11 check (minimum_rest_hours between 8 and 24),
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organisation_id, rotacloud_location_id)
);

create table public.rota_day_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time not null default '10:00',
  close_time time not null default '22:00',
  prep_minutes smallint not null default 0 check (prep_minutes between 0 and 360),
  close_minutes smallint not null default 0 check (close_minutes between 0 and 360),
  minimum_staff smallint not null default 2 check (minimum_staff between 1 and 20),
  maximum_staff smallint not null default 5 check (maximum_staff between 1 and 30),
  required_skills text[] not null default '{}'::text[],
  trading boolean not null default true,
  updated_at timestamptz not null default now(),
  check (close_time > open_time),
  check (maximum_staff >= minimum_staff),
  unique (site_id, weekday)
);

create table public.rota_demand_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  slot_time time not null,
  demand_weight numeric(8,6) not null check (demand_weight >= 0 and demand_weight <= 1),
  source text not null default 'template' check (source in ('template', 'hourly_sales', 'manual')),
  updated_at timestamptz not null default now(),
  unique (site_id, weekday, slot_time)
);

create table public.hourly_sales_metrics (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  slot_time time not null,
  interval_minutes smallint not null default 60 check (interval_minutes in (15, 30, 60)),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  transactions integer not null default 0 check (transactions >= 0),
  covers integer not null default 0 check (covers >= 0),
  source_system text not null default 'manual',
  source_reference text not null default '',
  imported_at timestamptz not null default now(),
  unique (site_id, business_date, slot_time, source_system)
);

create table public.rota_forecast_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  event_date date not null,
  title text not null check (length(trim(title)) between 2 and 160),
  sales_uplift_pct numeric(7,3) not null default 0 check (sales_uplift_pct between -90 and 500),
  notes text not null default '' check (length(notes) <= 1000),
  source text not null default 'manual' check (source in ('manual', 'calendar', 'bank_holiday', 'weather')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, event_date, title)
);

create table public.rota_plans (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'suggested' check (status in ('suggested', 'accepted', 'superseded')),
  forecast_method text not null default 'weighted_same_weekday',
  forecast_sales numeric(14,2) not null default 0 check (forecast_sales >= 0),
  forecast_low numeric(14,2) not null default 0 check (forecast_low >= 0),
  forecast_high numeric(14,2) not null default 0 check (forecast_high >= 0),
  labour_target_pct numeric(7,3) not null check (labour_target_pct between 0 and 100),
  labour_budget numeric(14,2) not null default 0 check (labour_budget >= 0),
  planned_cost numeric(14,2) not null default 0 check (planned_cost >= 0),
  planned_hours numeric(10,2) not null default 0 check (planned_hours >= 0),
  accuracy_mape numeric(8,3),
  confidence text not null default 'building_history' check (confidence in ('high', 'medium', 'low', 'building_history')),
  explanation text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (week_end = week_start + 6),
  check (forecast_high >= forecast_low),
  unique (site_id, week_start, version)
);

create table public.rota_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.rota_plans(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  forecast_sales numeric(14,2) not null default 0,
  forecast_low numeric(14,2) not null default 0,
  forecast_high numeric(14,2) not null default 0,
  labour_budget numeric(14,2) not null default 0,
  fixed_labour_cost numeric(14,2) not null default 0,
  controllable_budget numeric(14,2) not null default 0,
  planned_cost numeric(14,2) not null default 0,
  planned_hours numeric(10,2) not null default 0,
  peak_time time,
  evidence jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  unique (plan_id, business_date)
);

create table public.rota_plan_shifts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.rota_plans(id) on delete cascade,
  plan_day_id uuid not null references public.rota_plan_days(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  staff_profile_id uuid,
  staff_name text not null check (length(trim(staff_name)) between 2 and 120),
  role_title text not null default '',
  shift_start timestamptz not null,
  shift_end timestamptz not null,
  break_minutes smallint not null default 0 check (break_minutes between 0 and 180),
  paid_minutes integer not null check (paid_minutes > 0),
  required_skill text,
  assignment_reason text not null default '',
  source text not null default 'suggested' check (source in ('suggested', 'manual', 'rotacloud')),
  created_at timestamptz not null default now(),
  check (shift_end > shift_start)
);

create table payroll_private.rota_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_ref text not null check (length(trim(employee_ref)) between 1 and 120),
  rotacloud_user_id bigint,
  staff_name text not null check (length(trim(staff_name)) between 2 and 120),
  primary_role text not null default '' check (length(primary_role) <= 120),
  skills text[] not null default '{}'::text[],
  minimum_weekly_hours numeric(6,2) not null default 0 check (minimum_weekly_hours between 0 and 100),
  target_weekly_hours numeric(6,2) not null default 40 check (target_weekly_hours between 0 and 100),
  maximum_weekly_hours numeric(6,2) not null default 48 check (maximum_weekly_hours between 0 and 100),
  minimum_shift_minutes smallint not null default 240 check (minimum_shift_minutes between 60 and 720),
  maximum_shift_minutes smallint not null default 720 check (maximum_shift_minutes between 120 and 960),
  maximum_consecutive_days smallint not null default 6 check (maximum_consecutive_days between 1 and 7),
  preferred_days smallint[] not null default '{1,2,3,4,5}'::smallint[],
  preferred_start time,
  preferred_end time,
  notes text not null default '' check (length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_weekly_hours <= target_weekly_hours and target_weekly_hours <= maximum_weekly_hours),
  check (minimum_shift_minutes <= maximum_shift_minutes),
  unique (organisation_id, employee_ref),
  unique (organisation_id, rotacloud_user_id)
);

create table payroll_private.rota_staff_site_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  staff_profile_id uuid not null references payroll_private.rota_staff_profiles(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  role_title text not null default '' check (length(role_title) <= 120),
  pay_basis text not null check (pay_basis in ('hourly', 'salaried')),
  hourly_rate numeric(12,4),
  annual_salary numeric(14,2),
  contracted_weekly_hours numeric(7,2),
  employer_ni_rate numeric(7,5) not null default 0 check (employer_ni_rate between 0 and 1),
  pension_rate numeric(7,5) not null default 0 check (pension_rate between 0 and 1),
  other_oncost_rate numeric(7,5) not null default 0 check (other_oncost_rate between 0 and 1),
  cost_allocation_pct numeric(7,3) not null default 100 check (cost_allocation_pct > 0 and cost_allocation_pct <= 100),
  primary_site boolean not null default true,
  active boolean not null default true,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (pay_basis = 'hourly' and hourly_rate > 0 and annual_salary is null)
    or
    (pay_basis = 'salaried' and annual_salary > 0 and contracted_weekly_hours > 0 and hourly_rate is null)
  ),
  check (valid_to is null or valid_to >= valid_from),
  unique (staff_profile_id, site_id, valid_from)
);

create index rota_day_rules_site_idx on public.rota_day_rules(site_id, weekday);
create index rota_demand_templates_site_idx on public.rota_demand_templates(site_id, weekday, slot_time);
create index hourly_sales_metrics_site_date_idx on public.hourly_sales_metrics(site_id, business_date, slot_time);
create index rota_forecast_events_site_date_idx on public.rota_forecast_events(site_id, event_date);
create index rota_plans_site_week_idx on public.rota_plans(site_id, week_start desc, version desc);
create index rota_plan_days_site_date_idx on public.rota_plan_days(site_id, business_date);
create index rota_plan_shifts_plan_idx on public.rota_plan_shifts(plan_id, shift_start);
create index rota_plan_shifts_staff_time_idx on public.rota_plan_shifts(staff_profile_id, shift_start, shift_end);
create index rota_staff_profiles_rotacloud_idx on payroll_private.rota_staff_profiles(rotacloud_user_id) where rotacloud_user_id is not null;
create index rota_staff_memberships_site_idx on payroll_private.rota_staff_site_memberships(site_id, active, valid_from, valid_to);

alter table public.rota_site_settings enable row level security;
alter table public.rota_day_rules enable row level security;
alter table public.rota_demand_templates enable row level security;
alter table public.hourly_sales_metrics enable row level security;
alter table public.rota_forecast_events enable row level security;
alter table public.rota_plans enable row level security;
alter table public.rota_plan_days enable row level security;
alter table public.rota_plan_shifts enable row level security;

create policy rota_site_settings_read on public.rota_site_settings
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy rota_day_rules_read on public.rota_day_rules
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy rota_demand_templates_read on public.rota_demand_templates
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy hourly_sales_metrics_read on public.hourly_sales_metrics
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy rota_forecast_events_read on public.rota_forecast_events
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy rota_plans_read on public.rota_plans
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy rota_plan_days_read on public.rota_plan_days
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

create policy rota_plan_shifts_read on public.rota_plan_shifts
for select to authenticated
using (organisation_id = (select app_private.current_organisation_id()) and app_private.can_read_site(site_id));

grant select on public.rota_site_settings, public.rota_day_rules, public.rota_demand_templates,
  public.hourly_sales_metrics, public.rota_forecast_events, public.rota_plans,
  public.rota_plan_days, public.rota_plan_shifts to authenticated;
grant all on public.rota_site_settings, public.rota_day_rules, public.rota_demand_templates,
  public.hourly_sales_metrics, public.rota_forecast_events, public.rota_plans,
  public.rota_plan_days, public.rota_plan_shifts to service_role;

-- Seed conservative defaults. Managers can refine these once real day-part
-- sales are available; the UI labels template-based peaks explicitly.
insert into public.rota_site_settings (site_id, organisation_id)
select site.id, site.organisation_id from public.sites site
on conflict (site_id) do nothing;

insert into public.rota_day_rules (
  organisation_id, site_id, weekday, open_time, close_time, minimum_staff, maximum_staff
)
select site.organisation_id, site.id, day.weekday, '10:00'::time, '22:00'::time, 2, 5
from public.sites site
cross join generate_series(0, 6) as day(weekday)
on conflict (site_id, weekday) do nothing;

insert into public.rota_demand_templates (
  organisation_id, site_id, weekday, slot_time, demand_weight, source
)
select site.organisation_id, site.id, day.weekday, slot.slot_time, slot.weight, 'template'
from public.sites site
cross join generate_series(0, 6) as day(weekday)
cross join (values
  ('10:00'::time, 0.040000::numeric),
  ('11:00'::time, 0.050000::numeric),
  ('12:00'::time, 0.080000::numeric),
  ('13:00'::time, 0.100000::numeric),
  ('14:00'::time, 0.070000::numeric),
  ('15:00'::time, 0.060000::numeric),
  ('16:00'::time, 0.080000::numeric),
  ('17:00'::time, 0.120000::numeric),
  ('18:00'::time, 0.140000::numeric),
  ('19:00'::time, 0.120000::numeric),
  ('20:00'::time, 0.080000::numeric),
  ('21:00'::time, 0.060000::numeric)
) as slot(slot_time, weight)
on conflict (site_id, weekday, slot_time) do nothing;

create or replace function app_private.seed_rota_site_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
begin
  insert into public.rota_site_settings (site_id, organisation_id)
  values (new.id, new.organisation_id)
  on conflict (site_id) do nothing;

  insert into public.rota_day_rules (
    organisation_id, site_id, weekday, open_time, close_time, minimum_staff, maximum_staff
  )
  select new.organisation_id, new.id, day.weekday, '10:00'::time, '22:00'::time, 2, 5
  from generate_series(0, 6) as day(weekday)
  on conflict (site_id, weekday) do nothing;

  insert into public.rota_demand_templates (
    organisation_id, site_id, weekday, slot_time, demand_weight, source
  )
  select new.organisation_id, new.id, day.weekday, slot.slot_time, slot.weight, 'template'
  from generate_series(0, 6) as day(weekday)
  cross join (values
    ('10:00'::time, 0.040000::numeric), ('11:00'::time, 0.050000::numeric),
    ('12:00'::time, 0.080000::numeric), ('13:00'::time, 0.100000::numeric),
    ('14:00'::time, 0.070000::numeric), ('15:00'::time, 0.060000::numeric),
    ('16:00'::time, 0.080000::numeric), ('17:00'::time, 0.120000::numeric),
    ('18:00'::time, 0.140000::numeric), ('19:00'::time, 0.120000::numeric),
    ('20:00'::time, 0.080000::numeric), ('21:00'::time, 0.060000::numeric)
  ) as slot(slot_time, weight)
  on conflict (site_id, weekday, slot_time) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_rota_site_defaults on public.sites;
create trigger seed_rota_site_defaults
after insert on public.sites
for each row execute function app_private.seed_rota_site_defaults();

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
    'employeeRef', staff.employee_ref,
    'rotacloudUserId', staff.rotacloud_user_id,
    'staffName', staff.staff_name,
    'primaryRole', staff.primary_role,
    'roleTitle', coalesce(nullif(membership.role_title, ''), staff.primary_role),
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
      coalesce(membership.hourly_rate, membership.annual_salary / nullif(52 * membership.contracted_weekly_hours, 0))
      * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate), 4
    ),
    'fixedWeeklyCost', case when membership.pay_basis = 'salaried' then round(
      membership.annual_salary / 52
      * (1 + membership.employer_ni_rate + membership.pension_rate + membership.other_oncost_rate), 2
    ) else 0 end,
    'costAllocationPct', membership.cost_allocation_pct
  ) order by staff.staff_name), '[]'::jsonb)
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
    'employeeRef', staff.employee_ref,
    'rotacloudUserId', staff.rotacloud_user_id,
    'staffName', staff.staff_name,
    'primaryRole', staff.primary_role,
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
  ) order by staff.staff_name, membership.primary_site desc), '[]'::jsonb)
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
  target_site uuid := (payload->>'siteId')::uuid;
  target_employee_ref text := left(trim(coalesce(payload->>'employeeRef', '')), 120);
  target_name text := left(trim(coalesce(payload->>'staffName', '')), 120);
  target_role text := left(trim(coalesce(payload->>'roleTitle', '')), 120);
  target_pay_basis text := payload->>'payBasis';
  target_valid_from date := coalesce(nullif(payload->>'validFrom', '')::date, current_date);
  actor_role public.app_role;
begin
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = target_actor
    and profile.organisation_id = target_organisation
    and profile.active;
  if actor_role not in ('admin', 'group_manager') then raise exception 'rota staff access denied'; end if;
  if not exists (select 1 from public.sites site where site.id = target_site and site.organisation_id = target_organisation) then raise exception 'site not found'; end if;
  if length(target_employee_ref) < 1 or length(target_name) < 2 then raise exception 'invalid staff profile'; end if;

  if target_id is null then
    select staff.id into target_id
    from payroll_private.rota_staff_profiles staff
    where staff.organisation_id = target_organisation
      and staff.employee_ref = target_employee_ref;
  end if;

  if target_id is null then
    insert into payroll_private.rota_staff_profiles (
      organisation_id, employee_ref, rotacloud_user_id, staff_name, primary_role, skills,
      minimum_weekly_hours, target_weekly_hours, maximum_weekly_hours,
      minimum_shift_minutes, maximum_shift_minutes, maximum_consecutive_days,
      preferred_days, preferred_start, preferred_end, notes, active
    ) values (
      target_organisation, target_employee_ref, nullif(payload->>'rotacloudUserId', '')::bigint,
      target_name, target_role,
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
    set employee_ref = target_employee_ref,
        rotacloud_user_id = nullif(payload->>'rotacloudUserId', '')::bigint,
        staff_name = target_name,
        primary_role = target_role,
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
    where id = target_id and organisation_id = target_organisation;
    if not found then raise exception 'staff profile not found'; end if;
  end if;

  insert into payroll_private.rota_staff_site_memberships (
    organisation_id, staff_profile_id, site_id, role_title, pay_basis,
    hourly_rate, annual_salary, contracted_weekly_hours,
    employer_ni_rate, pension_rate, other_oncost_rate, cost_allocation_pct,
    primary_site, active, valid_from, valid_to
  ) values (
    target_organisation, target_id, target_site, target_role, target_pay_basis,
    case when target_pay_basis = 'hourly' then (payload->>'hourlyRate')::numeric else null end,
    case when target_pay_basis = 'salaried' then (payload->>'annualSalary')::numeric else null end,
    nullif(payload->>'contractedWeeklyHours', '')::numeric,
    coalesce((payload->>'employerNiRate')::numeric, 0),
    coalesce((payload->>'pensionRate')::numeric, 0),
    coalesce((payload->>'otherOncostRate')::numeric, 0),
    coalesce((payload->>'costAllocationPct')::numeric, 100),
    coalesce((payload->>'primarySite')::boolean, true),
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

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (target_organisation, target_actor, 'rota.staff_profile_saved', 'rota_staff_profile', target_id,
    jsonb_build_object('site_id', target_site, 'pay_basis', target_pay_basis, 'source', coalesce(payload->>'source', 'manual')));
  return target_id;
end;
$$;

create or replace function public.save_rota_plan_private(
  target_organisation uuid,
  target_site uuid,
  target_actor uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  plan_id uuid;
  day_id uuid;
  next_version integer;
  day_payload jsonb;
  shift_payload jsonb;
  actor_role public.app_role;
  target_week_start date := (payload->>'weekStart')::date;
begin
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = target_actor
    and profile.organisation_id = target_organisation
    and profile.active;
  if actor_role not in ('admin', 'group_manager', 'kitchen_manager') then raise exception 'rota plan access denied'; end if;
  if not exists (
    select 1 from public.sites site
    where site.id = target_site
      and site.organisation_id = target_organisation
      and (
        actor_role <> 'kitchen_manager'
        or exists (select 1 from public.site_memberships membership where membership.site_id = site.id and membership.user_id = target_actor)
      )
  ) then raise exception 'site not found or outside scope'; end if;

  select coalesce(max(plan.version), 0) + 1 into next_version
  from public.rota_plans plan
  where plan.site_id = target_site and plan.week_start = target_week_start;

  update public.rota_plans
  set status = 'superseded', updated_at = now()
  where site_id = target_site and week_start = target_week_start and status <> 'superseded';

  insert into public.rota_plans (
    organisation_id, site_id, week_start, week_end, version, status,
    forecast_sales, forecast_low, forecast_high, labour_target_pct,
    labour_budget, planned_cost, planned_hours, accuracy_mape, confidence,
    explanation, warnings, generated_by
  ) values (
    target_organisation, target_site, target_week_start, (payload->>'weekEnd')::date,
    next_version, 'suggested', (payload->>'forecastSales')::numeric,
    (payload->>'forecastLow')::numeric, (payload->>'forecastHigh')::numeric,
    (payload->>'labourTargetPct')::numeric, (payload->>'labourBudget')::numeric,
    (payload->>'plannedCost')::numeric, (payload->>'plannedHours')::numeric,
    nullif(payload->>'accuracyMape', '')::numeric,
    coalesce(payload->>'confidence', 'building_history'),
    left(coalesce(payload->>'explanation', ''), 4000),
    coalesce(payload->'warnings', '[]'::jsonb), target_actor
  ) returning id into plan_id;

  for day_payload in select value from jsonb_array_elements(coalesce(payload->'days', '[]'::jsonb)) loop
    insert into public.rota_plan_days (
      plan_id, organisation_id, site_id, business_date, forecast_sales,
      forecast_low, forecast_high, labour_budget, fixed_labour_cost,
      controllable_budget, planned_cost, planned_hours, peak_time, evidence, warnings
    ) values (
      plan_id, target_organisation, target_site, (day_payload->>'businessDate')::date,
      (day_payload->>'forecastSales')::numeric, (day_payload->>'forecastLow')::numeric,
      (day_payload->>'forecastHigh')::numeric, (day_payload->>'labourBudget')::numeric,
      (day_payload->>'fixedLabourCost')::numeric, (day_payload->>'controllableBudget')::numeric,
      (day_payload->>'plannedCost')::numeric, (day_payload->>'plannedHours')::numeric,
      nullif(day_payload->>'peakTime', '')::time,
      coalesce(day_payload->'evidence', '{}'::jsonb) || jsonb_build_object('coverage', coalesce(day_payload->'coverage', '[]'::jsonb)),
      coalesce(day_payload->'warnings', '[]'::jsonb)
    ) returning id into day_id;

    for shift_payload in select value from jsonb_array_elements(coalesce(day_payload->'shifts', '[]'::jsonb)) loop
      insert into public.rota_plan_shifts (
        plan_id, plan_day_id, organisation_id, site_id, staff_profile_id,
        staff_name, role_title, shift_start, shift_end, break_minutes,
        paid_minutes, required_skill, assignment_reason, source
      ) values (
        plan_id, day_id, target_organisation, target_site,
        nullif(shift_payload->>'staffProfileId', '')::uuid,
        left(coalesce(shift_payload->>'staffName', 'Unfilled shift'), 120),
        left(coalesce(shift_payload->>'roleTitle', ''), 120),
        (shift_payload->>'shiftStart')::timestamptz,
        (shift_payload->>'shiftEnd')::timestamptz,
        coalesce((shift_payload->>'breakMinutes')::smallint, 0),
        (shift_payload->>'paidMinutes')::integer,
        nullif(left(coalesce(shift_payload->>'requiredSkill', ''), 120), ''),
        left(coalesce(shift_payload->>'assignmentReason', ''), 500),
        'suggested'
      );
    end loop;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (target_organisation, target_actor, 'rota.plan_generated', 'rota_plan', plan_id,
    jsonb_build_object('site_id', target_site, 'week_start', target_week_start, 'version', next_version,
      'forecast_sales', payload->'forecastSales', 'planned_cost', payload->'plannedCost'));
  return plan_id;
end;
$$;

revoke all on function public.get_rota_private_staff(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.get_rota_private_workspace(uuid) from public, anon, authenticated;
revoke all on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_rota_plan_private(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_rota_private_staff(uuid, uuid, date) to service_role;
grant execute on function public.get_rota_private_workspace(uuid) to service_role;
grant execute on function public.save_rota_staff_profile_private(uuid, uuid, jsonb) to service_role;
grant execute on function public.save_rota_plan_private(uuid, uuid, uuid, jsonb) to service_role;

commit;

-- HOS Kitchen Reports: production schema, access controls and safe cost engine.
-- Apply with `supabase db push` after linking a Supabase project.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'group_manager', 'finance', 'kitchen_manager', 'viewer');
create type public.report_status as enum ('draft', 'submitted', 'review_required', 'approved', 'shared');
create type public.approval_decision as enum ('approved', 'changes_requested');

create schema if not exists app_private;
create schema if not exists payroll_private;

revoke all on schema app_private from public, anon, authenticated;
revoke all on schema payroll_private from public, anon, authenticated;

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  full_name text not null,
  notification_email text,
  role public.app_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  food_cost_target numeric(6,3) not null default 30,
  labour_target numeric(6,3) not null default 32,
  waste_target numeric(6,3) not null default 1.2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table public.site_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  can_submit boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);

create table public.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint reporting_period_is_seven_days check (week_end = week_start + 6),
  constraint reporting_period_starts_monday check (extract(isodow from week_start) = 1),
  unique (organisation_id, week_start)
);

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  period_id uuid not null references public.reporting_periods(id) on delete cascade,
  manager_id uuid not null references public.profiles(id),
  status public.report_status not null default 'draft',
  wins text not null default '',
  operational_issues text not null default '',
  staffing_issues text not null default '',
  compliance_issues text not null default '',
  equipment_issues text not null default '',
  actions_underway text not null default '',
  support_needed text not null default '',
  submitted_at timestamptz,
  approved_at timestamptz,
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, period_id)
);

create table public.report_source_values (
  report_id uuid primary key references public.weekly_reports(id) on delete cascade,
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  opening_stock numeric(14,2) not null default 0 check (opening_stock >= 0),
  purchases numeric(14,2) not null default 0 check (purchases >= 0),
  credits numeric(14,2) not null default 0 check (credits >= 0),
  transfers_in numeric(14,2) not null default 0 check (transfers_in >= 0),
  transfers_out numeric(14,2) not null default 0 check (transfers_out >= 0),
  closing_stock numeric(14,2) not null default 0 check (closing_stock >= 0),
  adjustments numeric(14,2) not null default 0,
  waste_cost numeric(14,2) not null default 0 check (waste_cost >= 0),
  source_reference text,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Provider-neutral daily facts from EPOS, purchasing and waste systems.
create table public.daily_site_metrics (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  source_system text not null,
  has_sales boolean not null default false,
  has_purchasing boolean not null default false,
  has_waste boolean not null default false,
  gross_sales numeric(14,2) not null default 0 check (gross_sales >= 0),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  covers integer not null default 0 check (covers >= 0),
  food_purchases numeric(14,2) not null default 0 check (food_purchases >= 0),
  credits numeric(14,2) not null default 0 check (credits >= 0),
  waste_cost numeric(14,2) not null default 0 check (waste_cost >= 0),
  source_reference text,
  imported_at timestamptz not null default now(),
  unique (site_id, business_date, source_system)
);

-- Employee references, hours and every pay-rate field remain outside the exposed API schema.
create table payroll_private.pay_rates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  employee_ref text not null,
  hourly_rate numeric(12,4),
  annual_salary numeric(14,2),
  contracted_weekly_hours numeric(8,2),
  employer_ni_rate numeric(7,5) not null default 0,
  pension_rate numeric(7,5) not null default 0,
  other_oncost_rate numeric(7,5) not null default 0,
  loaded_hourly_rate numeric(12,4) generated always as (
    coalesce(
      hourly_rate,
      annual_salary / nullif(52 * contracted_weekly_hours, 0)
    ) * (1 + employer_ni_rate + pension_rate + other_oncost_rate)
  ) stored,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  constraint one_pay_basis check (
    (hourly_rate is not null and annual_salary is null)
    or (hourly_rate is null and annual_salary is not null and contracted_weekly_hours > 0)
  ),
  constraint valid_rate_range check (valid_to is null or valid_to >= valid_from),
  unique (organisation_id, employee_ref, valid_from)
);

create table payroll_private.time_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  period_id uuid not null references public.reporting_periods(id) on delete cascade,
  employee_ref text not null,
  paid_hours numeric(9,2) not null default 0 check (paid_hours >= 0),
  agency_cost numeric(14,2) not null default 0 check (agency_cost >= 0),
  overtime_premium numeric(14,2) not null default 0 check (overtime_premium >= 0),
  source_reference text,
  imported_at timestamptz not null default now(),
  unique (site_id, period_id, employee_ref)
);

-- Only safe site-level totals enter the public schema.
create table public.site_cost_snapshots (
  report_id uuid primary key references public.weekly_reports(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  period_id uuid not null references public.reporting_periods(id) on delete cascade,
  net_sales numeric(14,2) not null default 0,
  cogs numeric(14,2) not null default 0,
  food_cost_pct numeric(8,3) not null default 0,
  staff_cost numeric(14,2) not null default 0,
  labour_pct numeric(8,3) not null default 0,
  waste_cost numeric(14,2) not null default 0,
  waste_pct numeric(8,3) not null default 0,
  prime_cost numeric(14,2) not null default 0,
  prime_cost_pct numeric(8,3) not null default 0,
  review_flags jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);

create table public.report_review_resolutions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  flag_code text not null,
  resolution text not null,
  resolved_by uuid not null references public.profiles(id),
  resolved_at timestamptz not null default now(),
  unique (report_id, flag_code)
);

create table public.report_approvals (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  decision public.approval_decision not null,
  notes text not null default '',
  decided_by uuid not null references public.profiles(id),
  decided_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  report_id uuid references public.weekly_reports(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  notification_type text not null,
  dedupe_key text not null unique,
  delivery_status text not null default 'queued',
  provider_reference text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index weekly_reports_org_period_idx on public.weekly_reports (organisation_id, period_id);
create index weekly_reports_status_idx on public.weekly_reports (status, updated_at);
create index memberships_site_idx on public.site_memberships (site_id, user_id);
create index snapshots_period_idx on public.site_cost_snapshots (organisation_id, period_id);
create index daily_metrics_site_date_idx on public.daily_site_metrics (site_id, business_date);
create index time_entries_period_idx on payroll_private.time_entries (site_id, period_id);
create index pay_rates_lookup_idx on payroll_private.pay_rates (site_id, employee_ref, valid_from, valid_to);

create function app_private.current_organisation_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organisation_id from public.profiles where id = auth.uid() and active = true
$$;

create function app_private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and active = true
$$;

create function app_private.is_elevated()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(app_private.current_app_role() in ('admin', 'group_manager', 'finance'), false)
$$;

create function app_private.can_access_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    exists (
      select 1 from public.sites s
      where s.id = target_site_id
        and s.organisation_id = app_private.current_organisation_id()
        and (
          app_private.is_elevated()
          or exists (
            select 1 from public.site_memberships sm
            where sm.site_id = s.id and sm.user_id = auth.uid()
          )
        )
    ),
    false
  )
$$;

create function app_private.rollup_daily_metrics(target_site_id uuid, target_start date, target_end date)
returns table (
  has_sales boolean,
  has_purchasing boolean,
  has_waste boolean,
  net_sales numeric,
  purchases numeric,
  credits numeric,
  waste_cost numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.daily_site_metrics where site_id = target_site_id and business_date between target_start and target_end and has_sales),
    exists (select 1 from public.daily_site_metrics where site_id = target_site_id and business_date between target_start and target_end and has_purchasing),
    exists (select 1 from public.daily_site_metrics where site_id = target_site_id and business_date between target_start and target_end and has_waste),
    coalesce((
      select sum(latest.net_sales) from (
        select distinct on (business_date) net_sales
        from public.daily_site_metrics
        where site_id = target_site_id and business_date between target_start and target_end and has_sales
        order by business_date, imported_at desc
      ) latest
    ), 0),
    coalesce((
      select sum(latest.food_purchases) from (
        select distinct on (business_date) food_purchases
        from public.daily_site_metrics
        where site_id = target_site_id and business_date between target_start and target_end and has_purchasing
        order by business_date, imported_at desc
      ) latest
    ), 0),
    coalesce((
      select sum(latest.credits) from (
        select distinct on (business_date) credits
        from public.daily_site_metrics
        where site_id = target_site_id and business_date between target_start and target_end and has_purchasing
        order by business_date, imported_at desc
      ) latest
    ), 0),
    coalesce((
      select sum(latest.waste_cost) from (
        select distinct on (business_date) waste_cost
        from public.daily_site_metrics
        where site_id = target_site_id and business_date between target_start and target_end and has_waste
        order by business_date, imported_at desc
      ) latest
    ), 0)
$$;

revoke all on function app_private.rollup_daily_metrics(uuid, date, date) from public, anon, authenticated;

grant usage on schema app_private to authenticated;
grant execute on function app_private.current_organisation_id() to authenticated;
grant execute on function app_private.current_app_role() to authenticated;
grant execute on function app_private.is_elevated() to authenticated;
grant execute on function app_private.can_access_site(uuid) to authenticated;

alter table public.organisations enable row level security;
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_memberships enable row level security;
alter table public.reporting_periods enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.report_source_values enable row level security;
alter table public.daily_site_metrics enable row level security;
alter table public.site_cost_snapshots enable row level security;
alter table public.report_review_resolutions enable row level security;
alter table public.report_approvals enable row level security;
alter table public.audit_log enable row level security;
alter table public.notification_log enable row level security;

create policy organisations_read on public.organisations for select to authenticated
using (id = app_private.current_organisation_id());

create policy profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or (organisation_id = app_private.current_organisation_id() and app_private.is_elevated()));

create policy sites_read on public.sites for select to authenticated
using (app_private.can_access_site(id));

create policy sites_manage on public.sites for all to authenticated
using (organisation_id = app_private.current_organisation_id() and app_private.current_app_role() = 'admin')
with check (organisation_id = app_private.current_organisation_id() and app_private.current_app_role() = 'admin');

create policy memberships_read on public.site_memberships for select to authenticated
using (user_id = auth.uid() or app_private.is_elevated());

create policy memberships_manage on public.site_memberships for all to authenticated
using (app_private.current_app_role() = 'admin' and app_private.can_access_site(site_id))
with check (app_private.current_app_role() = 'admin' and app_private.can_access_site(site_id));

create policy periods_read on public.reporting_periods for select to authenticated
using (organisation_id = app_private.current_organisation_id());

create policy reports_read on public.weekly_reports for select to authenticated
using (organisation_id = app_private.current_organisation_id() and app_private.can_access_site(site_id));

create policy reports_update on public.weekly_reports for update to authenticated
using (app_private.can_access_site(site_id) and (manager_id = auth.uid() or app_private.is_elevated()))
with check (organisation_id = app_private.current_organisation_id() and app_private.can_access_site(site_id));

create policy source_values_read on public.report_source_values for select to authenticated
using (exists (select 1 from public.weekly_reports r where r.id = report_id and app_private.can_access_site(r.site_id)));

create policy daily_metrics_read on public.daily_site_metrics for select to authenticated
using (organisation_id = app_private.current_organisation_id() and app_private.can_access_site(site_id));

create policy snapshots_read on public.site_cost_snapshots for select to authenticated
using (organisation_id = app_private.current_organisation_id() and app_private.can_access_site(site_id));

create policy resolutions_read on public.report_review_resolutions for select to authenticated
using (exists (select 1 from public.weekly_reports r where r.id = report_id and app_private.can_access_site(r.site_id)));

create policy approvals_read on public.report_approvals for select to authenticated
using (exists (select 1 from public.weekly_reports r where r.id = report_id and app_private.can_access_site(r.site_id)));

create policy audit_read on public.audit_log for select to authenticated
using (organisation_id = app_private.current_organisation_id() and app_private.is_elevated());

create policy notifications_read on public.notification_log for select to authenticated
using (recipient_id = auth.uid() or (organisation_id = app_private.current_organisation_id() and app_private.is_elevated()));

-- All report writes go through this checked RPC so period, source and narrative updates are atomic.
create function public.save_weekly_report(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  target_site uuid := (payload->>'siteId')::uuid;
  target_start date := (payload->>'weekStart')::date;
  target_end date := (payload->>'weekEnd')::date;
  target_status public.report_status := (payload->>'status')::public.report_status;
  organisation uuid := app_private.current_organisation_id();
  period uuid;
  report uuid;
begin
  if auth.uid() is null or not app_private.can_access_site(target_site) then
    raise exception 'site access denied';
  end if;
  if target_end <> target_start + 6 or extract(isodow from target_start) <> 1 then
    raise exception 'reporting period must be Monday to Sunday';
  end if;
  if target_status not in ('draft', 'submitted') then
    raise exception 'invalid submission status';
  end if;

  insert into public.reporting_periods (organisation_id, week_start, week_end, due_at)
  values (organisation, target_start, target_end, ((target_end + 2) + time '12:00') at time zone 'Europe/London')
  on conflict (organisation_id, week_start) do update set week_end = excluded.week_end
  returning id into period;

  insert into public.weekly_reports (
    organisation_id, site_id, period_id, manager_id, status, wins, operational_issues,
    staffing_issues, compliance_issues, equipment_issues, actions_underway, support_needed,
    submitted_at, updated_at
  ) values (
    organisation, target_site, period, auth.uid(), target_status,
    coalesce(payload->>'wins', ''), coalesce(payload->>'operationalIssues', ''),
    coalesce(payload->>'staffingIssues', ''), coalesce(payload->>'complianceIssues', ''),
    coalesce(payload->>'equipmentIssues', ''), coalesce(payload->>'actionsUnderway', ''),
    coalesce(payload->>'supportNeeded', ''),
    case when target_status = 'submitted' then now() else null end, now()
  )
  on conflict (site_id, period_id) do update set
    manager_id = auth.uid(), status = excluded.status, wins = excluded.wins,
    operational_issues = excluded.operational_issues, staffing_issues = excluded.staffing_issues,
    compliance_issues = excluded.compliance_issues, equipment_issues = excluded.equipment_issues,
    actions_underway = excluded.actions_underway, support_needed = excluded.support_needed,
    submitted_at = case when excluded.status = 'submitted' then coalesce(weekly_reports.submitted_at, now()) else weekly_reports.submitted_at end,
    updated_at = now()
  returning id into report;

  insert into public.report_source_values (
    report_id, net_sales, opening_stock, purchases, credits, transfers_in, transfers_out,
    closing_stock, adjustments, waste_cost, confirmed_by, confirmed_at, updated_at
  ) values (
    report, coalesce((payload->>'netSales')::numeric, 0), coalesce((payload->>'openingStock')::numeric, 0),
    coalesce((payload->>'purchases')::numeric, 0), coalesce((payload->>'credits')::numeric, 0),
    coalesce((payload->>'transfersIn')::numeric, 0), coalesce((payload->>'transfersOut')::numeric, 0),
    coalesce((payload->>'closingStock')::numeric, 0), coalesce((payload->>'adjustments')::numeric, 0),
    coalesce((payload->>'wasteCost')::numeric, 0), auth.uid(), now(), now()
  )
  on conflict (report_id) do update set
    net_sales = excluded.net_sales, opening_stock = excluded.opening_stock,
    purchases = excluded.purchases, credits = excluded.credits, transfers_in = excluded.transfers_in,
    transfers_out = excluded.transfers_out, closing_stock = excluded.closing_stock,
    adjustments = excluded.adjustments, waste_cost = excluded.waste_cost,
    confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now();

  -- If live connectors have already supplied this week, their normalized totals
  -- take precedence for only the domains they own. Stock values remain manager-confirmed.
  with imported as (
    select * from app_private.rollup_daily_metrics(target_site, target_start, target_end)
  )
  update public.report_source_values values_row set
    net_sales = case when imported.has_sales then coalesce(imported.net_sales, 0) else values_row.net_sales end,
    purchases = case when imported.has_purchasing then coalesce(imported.purchases, 0) else values_row.purchases end,
    credits = case when imported.has_purchasing then coalesce(imported.credits, 0) else values_row.credits end,
    waste_cost = case when imported.has_waste then coalesce(imported.waste_cost, 0) else values_row.waste_cost end,
    updated_at = now()
  from imported
  where values_row.report_id = report;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id)
  values (organisation, auth.uid(), case when target_status = 'submitted' then 'report.submitted' else 'report.saved' end, 'weekly_report', report);
  return report;
end;
$$;

revoke all on function public.save_weekly_report(jsonb) from public, anon;
grant execute on function public.save_weekly_report(jsonb) to authenticated;

-- Uses private rates and time entries, returning only a safe site snapshot.
create function public.recalculate_report_costs(target_report uuid)
returns void
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  r public.weekly_reports%rowtype;
  src public.report_source_values%rowtype;
  target public.sites%rowtype;
  cogs_total numeric := 0;
  staff_total numeric := 0;
  food_pct numeric := 0;
  labour_pct numeric := 0;
  waste_pct numeric := 0;
  flags jsonb := '[]'::jsonb;
  time_record_count integer := 0;
  unrated_record_count integer := 0;
begin
  select * into r from public.weekly_reports where id = target_report;
  if not found or (auth.role() <> 'service_role' and not app_private.can_access_site(r.site_id)) then raise exception 'report access denied'; end if;
  select * into src from public.report_source_values where report_id = target_report;
  select * into target from public.sites where id = r.site_id;

  cogs_total := src.opening_stock + src.purchases - src.credits + src.transfers_in - src.transfers_out - src.closing_stock + src.adjustments;
  select
    coalesce(sum(te.paid_hours * coalesce(pr.loaded_hourly_rate, 0) + te.agency_cost + te.overtime_premium), 0),
    count(*),
    count(*) filter (where te.paid_hours > 0 and pr.loaded_hourly_rate is null)
    into staff_total, time_record_count, unrated_record_count
  from payroll_private.time_entries te
  join public.reporting_periods rp on rp.id = te.period_id
  left join lateral (
    select rate.loaded_hourly_rate
    from payroll_private.pay_rates rate
    where rate.organisation_id = te.organisation_id
      and rate.site_id = te.site_id
      and rate.employee_ref = te.employee_ref
      and rate.valid_from <= rp.week_end
      and (rate.valid_to is null or rate.valid_to >= rp.week_start)
    order by rate.valid_from desc limit 1
  ) pr on true
  where te.site_id = r.site_id and te.period_id = r.period_id;

  if src.net_sales > 0 then
    food_pct := cogs_total / src.net_sales * 100;
    labour_pct := staff_total / src.net_sales * 100;
    waste_pct := src.waste_cost / src.net_sales * 100;
  end if;

  if food_pct > target.food_cost_target then flags := flags || jsonb_build_array(jsonb_build_object('code','FOOD_COST_OVER_TARGET','label','Food cost over target','severity',case when food_pct > target.food_cost_target + 3 then 'critical' else 'warning' end)); end if;
  if labour_pct > target.labour_target then flags := flags || jsonb_build_array(jsonb_build_object('code','LABOUR_OVER_TARGET','label','Labour over target','severity',case when labour_pct > target.labour_target + 3 then 'critical' else 'warning' end)); end if;
  if waste_pct > target.waste_target then flags := flags || jsonb_build_array(jsonb_build_object('code','WASTE_OVER_TARGET','label','Waste over target','severity','warning')); end if;
  if time_record_count = 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','PAYROLL_DATA_MISSING','label','Payroll/time data missing','severity','critical')); end if;
  if unrated_record_count > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','PAY_RATE_MISSING','label','One or more private pay rates are missing','severity','critical')); end if;
  if length(trim(r.compliance_issues)) > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','COMPLIANCE_REVIEW','label','Compliance issue reported','severity','critical')); end if;
  if length(trim(r.support_needed)) > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','SUPPORT_REQUESTED','label','Support requested','severity','info')); end if;

  insert into public.site_cost_snapshots (
    report_id, organisation_id, site_id, period_id, net_sales, cogs, food_cost_pct,
    staff_cost, labour_pct, waste_cost, waste_pct, prime_cost, prime_cost_pct, review_flags, refreshed_at
  ) values (
    r.id, r.organisation_id, r.site_id, r.period_id, src.net_sales, cogs_total, food_pct,
    staff_total, labour_pct, src.waste_cost, waste_pct, cogs_total + staff_total,
    case when src.net_sales > 0 then (cogs_total + staff_total) / src.net_sales * 100 else 0 end, flags, now()
  ) on conflict (report_id) do update set
    net_sales = excluded.net_sales, cogs = excluded.cogs, food_cost_pct = excluded.food_cost_pct,
    staff_cost = excluded.staff_cost, labour_pct = excluded.labour_pct, waste_cost = excluded.waste_cost,
    waste_pct = excluded.waste_pct, prime_cost = excluded.prime_cost, prime_cost_pct = excluded.prime_cost_pct,
    review_flags = excluded.review_flags, refreshed_at = now();

  if r.status = 'submitted' and jsonb_array_length(flags) > 0 then
    update public.weekly_reports set status = 'review_required', updated_at = now() where id = r.id;
  end if;
end;
$$;

revoke all on function public.recalculate_report_costs(uuid) from public, anon;
grant execute on function public.recalculate_report_costs(uuid) to authenticated;
grant execute on function public.recalculate_report_costs(uuid) to service_role;

create function app_private.refresh_cost_snapshot_after_source_change()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
begin
  perform public.recalculate_report_costs(new.report_id);
  return new;
end;
$$;

create trigger refresh_cost_snapshot_after_source_change
after insert or update on public.report_source_values
for each row execute function app_private.refresh_cost_snapshot_after_source_change();

-- Service-only integration endpoint for payroll/time providers. The function returns no private data.
create function public.import_private_cost_data(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, payroll_private, pg_temp
as $$
declare
  organisation uuid := (payload->>'organisationId')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  target_period uuid := (payload->>'periodId')::uuid;
  item jsonb;
  target_report uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.sites where id = target_site and organisation_id = organisation) then raise exception 'site mismatch'; end if;
  if not exists (select 1 from public.reporting_periods where id = target_period and organisation_id = organisation) then raise exception 'period mismatch'; end if;

  for item in select value from jsonb_array_elements(coalesce(payload->'payRates', '[]'::jsonb)) loop
    insert into payroll_private.pay_rates (
      organisation_id, site_id, employee_ref, hourly_rate, annual_salary, contracted_weekly_hours,
      employer_ni_rate, pension_rate, other_oncost_rate, valid_from, valid_to
    ) values (
      organisation, target_site, item->>'employeeRef', (item->>'hourlyRate')::numeric,
      (item->>'annualSalary')::numeric, (item->>'contractedWeeklyHours')::numeric,
      coalesce((item->>'employerNiRate')::numeric, 0), coalesce((item->>'pensionRate')::numeric, 0),
      coalesce((item->>'otherOncostRate')::numeric, 0), (item->>'validFrom')::date,
      (item->>'validTo')::date
    ) on conflict (organisation_id, employee_ref, valid_from) do update set
      site_id = excluded.site_id, hourly_rate = excluded.hourly_rate, annual_salary = excluded.annual_salary,
      contracted_weekly_hours = excluded.contracted_weekly_hours, employer_ni_rate = excluded.employer_ni_rate,
      pension_rate = excluded.pension_rate, other_oncost_rate = excluded.other_oncost_rate, valid_to = excluded.valid_to;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'timeEntries', '[]'::jsonb)) loop
    insert into payroll_private.time_entries (
      organisation_id, site_id, period_id, employee_ref, paid_hours, agency_cost,
      overtime_premium, source_reference, imported_at
    ) values (
      organisation, target_site, target_period, item->>'employeeRef',
      coalesce((item->>'paidHours')::numeric, 0), coalesce((item->>'agencyCost')::numeric, 0),
      coalesce((item->>'overtimePremium')::numeric, 0), item->>'sourceReference', now()
    ) on conflict (site_id, period_id, employee_ref) do update set
      paid_hours = excluded.paid_hours, agency_cost = excluded.agency_cost,
      overtime_premium = excluded.overtime_premium, source_reference = excluded.source_reference,
      imported_at = now();
  end loop;

  select id into target_report from public.weekly_reports where site_id = target_site and period_id = target_period;
  if target_report is not null then perform public.recalculate_report_costs(target_report); end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (organisation, null, 'costs.private_imported', 'site', target_site, jsonb_build_object('period_id', target_period));
end;
$$;

revoke all on function public.import_private_cost_data(jsonb) from public, anon, authenticated;
grant execute on function public.import_private_cost_data(jsonb) to service_role;

-- Normalized adapter for EPOS, purchasing and waste APIs. Provider credentials
-- stay in the connector/automation layer; this database accepts a stable shape.
create function public.import_operating_metrics(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  organisation uuid := (payload->>'organisationId')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  source_name text := payload->>'sourceSystem';
  domains jsonb := payload->'domains';
  item jsonb;
  report_row record;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.sites where id = target_site and organisation_id = organisation) then raise exception 'site mismatch'; end if;

  for item in select value from jsonb_array_elements(coalesce(payload->'metrics', '[]'::jsonb)) loop
    insert into public.daily_site_metrics (
      organisation_id, site_id, business_date, source_system, has_sales, has_purchasing,
      has_waste, gross_sales, net_sales, covers, food_purchases, credits, waste_cost,
      source_reference, imported_at
    ) values (
      organisation, target_site, (item->>'businessDate')::date, source_name,
      domains ? 'sales', domains ? 'purchasing', domains ? 'waste',
      coalesce((item->>'grossSales')::numeric, 0), coalesce((item->>'netSales')::numeric, 0),
      coalesce((item->>'covers')::integer, 0), coalesce((item->>'foodPurchases')::numeric, 0),
      coalesce((item->>'credits')::numeric, 0), coalesce((item->>'wasteCost')::numeric, 0),
      item->>'sourceReference', now()
    ) on conflict (site_id, business_date, source_system) do update set
      has_sales = excluded.has_sales, has_purchasing = excluded.has_purchasing,
      has_waste = excluded.has_waste, gross_sales = excluded.gross_sales,
      net_sales = excluded.net_sales, covers = excluded.covers,
      food_purchases = excluded.food_purchases, credits = excluded.credits,
      waste_cost = excluded.waste_cost, source_reference = excluded.source_reference,
      imported_at = now();
  end loop;

  for report_row in
    select r.id, p.week_start, p.week_end
    from public.weekly_reports r
    join public.reporting_periods p on p.id = r.period_id
    where r.site_id = target_site
      and exists (
        select 1 from jsonb_array_elements(payload->'metrics') metric
        where (metric->>'businessDate')::date between p.week_start and p.week_end
      )
  loop
    with imported as (
      select * from app_private.rollup_daily_metrics(target_site, report_row.week_start, report_row.week_end)
    )
    update public.report_source_values values_row set
      net_sales = case when imported.has_sales then coalesce(imported.net_sales, 0) else values_row.net_sales end,
      purchases = case when imported.has_purchasing then coalesce(imported.purchases, 0) else values_row.purchases end,
      credits = case when imported.has_purchasing then coalesce(imported.credits, 0) else values_row.credits end,
      waste_cost = case when imported.has_waste then coalesce(imported.waste_cost, 0) else values_row.waste_cost end,
      source_reference = source_name,
      updated_at = now()
    from imported
    where values_row.report_id = report_row.id;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    organisation, null, 'operations.metrics_imported', 'site', target_site,
    jsonb_build_object('source_system', source_name, 'domains', domains, 'row_count', jsonb_array_length(payload->'metrics'))
  );
end;
$$;

revoke all on function public.import_operating_metrics(jsonb) from public, anon, authenticated;
grant execute on function public.import_operating_metrics(jsonb) to service_role;

create function public.decide_report(target_report uuid, target_decision public.approval_decision, decision_notes text default '')
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare report_row public.weekly_reports%rowtype;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then raise exception 'approval access denied'; end if;
  select * into report_row from public.weekly_reports where id = target_report and organisation_id = app_private.current_organisation_id();
  if not found then raise exception 'report not found'; end if;
  if target_decision = 'approved' and exists (
    select 1 from jsonb_array_elements(coalesce((select review_flags from public.site_cost_snapshots where report_id = target_report), '[]'::jsonb)) f
    where not exists (select 1 from public.report_review_resolutions rr where rr.report_id = target_report and rr.flag_code = f->>'code')
  ) then raise exception 'all review flags must be resolved before approval'; end if;

  insert into public.report_approvals (report_id, decision, notes, decided_by) values (target_report, target_decision, coalesce(decision_notes,''), auth.uid());
  update public.weekly_reports set
    status = case when target_decision = 'approved' then 'approved'::public.report_status else 'draft'::public.report_status end,
    approved_at = case when target_decision = 'approved' then now() else null end,
    updated_at = now()
  where id = target_report;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (report_row.organisation_id, auth.uid(), 'report.' || target_decision::text, 'weekly_report', target_report, jsonb_build_object('notes', coalesce(decision_notes,'')));
end;
$$;

revoke all on function public.decide_report(uuid, public.approval_decision, text) from public, anon;
grant execute on function public.decide_report(uuid, public.approval_decision, text) to authenticated;

create function public.resolve_and_approve_report(target_report uuid, resolution_notes text)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare flag jsonb;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then raise exception 'approval access denied'; end if;
  if length(trim(coalesce(resolution_notes, ''))) = 0 and exists (
    select 1 from public.site_cost_snapshots s
    where s.report_id = target_report and jsonb_array_length(s.review_flags) > 0
  ) then raise exception 'resolution notes are required for flagged reports'; end if;

  for flag in
    select value from jsonb_array_elements(coalesce((select review_flags from public.site_cost_snapshots where report_id = target_report), '[]'::jsonb))
  loop
    insert into public.report_review_resolutions (report_id, flag_code, resolution, resolved_by)
    values (target_report, flag->>'code', resolution_notes, auth.uid())
    on conflict (report_id, flag_code) do update set
      resolution = excluded.resolution, resolved_by = auth.uid(), resolved_at = now();
  end loop;
  perform public.decide_report(target_report, 'approved'::public.approval_decision, resolution_notes);
end;
$$;

revoke all on function public.resolve_and_approve_report(uuid, text) from public, anon;
grant execute on function public.resolve_and_approve_report(uuid, text) to authenticated;

create function public.mark_report_shared(target_report uuid, channel text)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare report_row public.weekly_reports%rowtype;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then raise exception 'sharing access denied'; end if;
  select * into report_row from public.weekly_reports where id = target_report and organisation_id = app_private.current_organisation_id();
  if not found or report_row.status <> 'approved' then raise exception 'only approved reports can be shared'; end if;
  update public.weekly_reports set status = 'shared', shared_at = now(), updated_at = now() where id = target_report;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (report_row.organisation_id, auth.uid(), 'report.shared', 'weekly_report', target_report, jsonb_build_object('channel', channel));
end;
$$;

revoke all on function public.mark_report_shared(uuid, text) from public, anon;
grant execute on function public.mark_report_shared(uuid, text) to authenticated;

-- Explicitly keep private records unreachable from normal app sessions.
revoke all on all tables in schema payroll_private from public, anon, authenticated;
revoke all on all sequences in schema payroll_private from public, anon, authenticated;

-- Realtime updates are still filtered by each signed-in user's RLS policies.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weekly_reports') then
    alter publication supabase_realtime add table public.weekly_reports;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_cost_snapshots') then
    alter publication supabase_realtime add table public.site_cost_snapshots;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_site_metrics') then
    alter publication supabase_realtime add table public.daily_site_metrics;
  end if;
end;
$$;

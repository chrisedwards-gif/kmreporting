-- Weekly management delivery settings, daily waste capture and salary accruals.
--
-- Waste entries remain open until the report covering their business date is
-- submitted. Salary allocations are private, site-scoped and optionally added
-- to the aggregate labour cost. Individual salary data is never exposed to
-- Kitchen Managers or reporting viewers.

begin;

alter table public.sites
  add column if not exists include_salary_costs boolean not null default false;

alter table public.site_cost_snapshots
  add column if not exists hourly_staff_cost numeric(14,2) not null default 0,
  add column if not exists salary_staff_cost numeric(14,2) not null default 0,
  add column if not exists salary_oncost_cost numeric(14,2) not null default 0,
  add column if not exists salaries_included boolean not null default false;

create table if not exists public.management_email_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  recipient_name text not null default 'Jake Atkinson' check (length(trim(recipient_name)) between 2 and 120),
  recipient_email text,
  enabled boolean not null default false,
  send_day smallint not null default 3 check (send_day between 0 and 6),
  send_hour smallint not null default 10 check (send_hour between 0 and 23),
  timezone text not null default 'Europe/London',
  allow_partial boolean not null default true,
  last_sent_period_id uuid references public.reporting_periods(id) on delete set null,
  last_sent_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.management_email_settings (organisation_id)
select organisation.id
from public.organisations organisation
on conflict (organisation_id) do nothing;

alter table public.management_email_settings enable row level security;

drop policy if exists management_email_settings_read on public.management_email_settings;
create policy management_email_settings_read on public.management_email_settings
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.current_app_role() in ('admin', 'group_manager')
);

drop policy if exists management_email_settings_write on public.management_email_settings;
create policy management_email_settings_write on public.management_email_settings
for all to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.current_app_role() in ('admin', 'group_manager')
)
with check (
  organisation_id = app_private.current_organisation_id()
  and app_private.current_app_role() in ('admin', 'group_manager')
);

create table if not exists public.waste_log_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  item_name text not null check (length(trim(item_name)) between 2 and 160),
  category text not null default 'Food' check (length(trim(category)) between 2 and 80),
  reason text not null default 'Other' check (length(trim(reason)) between 2 and 80),
  quantity numeric(12,3),
  unit text check (unit is null or length(trim(unit)) between 1 and 30),
  estimated_cost numeric(12,2) not null check (estimated_cost > 0),
  notes text not null default '' check (length(notes) <= 1000),
  logged_by uuid not null references public.profiles(id) on delete restrict,
  report_id uuid references public.weekly_reports(id) on delete restrict,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waste_log_open_site_date_idx
  on public.waste_log_entries(site_id, business_date desc)
  where report_id is null;
create index if not exists waste_log_report_idx
  on public.waste_log_entries(report_id)
  where report_id is not null;

alter table public.waste_log_entries enable row level security;

drop policy if exists waste_log_read on public.waste_log_entries;
create policy waste_log_read on public.waste_log_entries
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_read_site(site_id)
);

drop policy if exists waste_log_insert on public.waste_log_entries;
create policy waste_log_insert on public.waste_log_entries
for insert to authenticated
with check (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_access_site(site_id)
  and report_id is null
  and logged_by = auth.uid()
);

drop policy if exists waste_log_update on public.waste_log_entries;
create policy waste_log_update on public.waste_log_entries
for update to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_access_site(site_id)
  and report_id is null
)
with check (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_access_site(site_id)
  and report_id is null
);

drop policy if exists waste_log_delete on public.waste_log_entries;
create policy waste_log_delete on public.waste_log_entries
for delete to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_access_site(site_id)
  and report_id is null
);

create table if not exists payroll_private.salary_allocations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  staff_name text not null check (length(trim(staff_name)) between 2 and 120),
  role_title text not null default '' check (length(role_title) <= 120),
  annual_salary numeric(14,2) not null check (annual_salary > 0),
  oncost_rate numeric(7,4) not null default 0 check (oncost_rate between 0 and 100),
  allocation_pct numeric(7,4) not null default 100 check (allocation_pct > 0 and allocation_pct <= 100),
  valid_from date not null,
  valid_to date,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists salary_allocations_site_validity_idx
  on payroll_private.salary_allocations(site_id, valid_from, valid_to)
  where active;

create or replace function public.save_waste_entry(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  target_id uuid := nullif(payload->>'id', '')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  target_date date := (payload->>'businessDate')::date;
  target_item text := trim(coalesce(payload->>'itemName', ''));
  target_category text := trim(coalesce(payload->>'category', 'Food'));
  target_reason text := trim(coalesce(payload->>'reason', 'Other'));
  target_quantity numeric := nullif(payload->>'quantity', '')::numeric;
  target_unit text := nullif(trim(coalesce(payload->>'unit', '')), '');
  target_cost numeric := coalesce((payload->>'estimatedCost')::numeric, 0);
  target_notes text := left(coalesce(payload->>'notes', ''), 1000);
  organisation uuid := app_private.current_organisation_id();
  existing_report uuid;
begin
  if auth.uid() is null or not app_private.can_access_site(target_site) then
    raise exception 'site access denied';
  end if;
  if length(target_item) < 2 or length(target_item) > 160 then raise exception 'invalid waste item'; end if;
  if length(target_category) < 2 or length(target_category) > 80 then raise exception 'invalid waste category'; end if;
  if length(target_reason) < 2 or length(target_reason) > 80 then raise exception 'invalid waste reason'; end if;
  if target_cost <= 0 then raise exception 'waste cost must be positive'; end if;
  if target_quantity is not null and target_quantity <= 0 then raise exception 'waste quantity must be positive'; end if;
  if target_date > current_date then raise exception 'waste cannot be logged in the future'; end if;

  select report.id into existing_report
  from public.weekly_reports report
  join public.reporting_periods period on period.id = report.period_id
  where report.site_id = target_site
    and target_date between period.week_start and period.week_end
    and report.status <> 'draft'
  limit 1;
  if existing_report is not null then
    raise exception 'the reporting week containing this date has already been submitted';
  end if;

  if target_id is null then
    insert into public.waste_log_entries (
      organisation_id, site_id, business_date, item_name, category, reason,
      quantity, unit, estimated_cost, notes, logged_by
    ) values (
      organisation, target_site, target_date, target_item, target_category,
      target_reason, target_quantity, target_unit, target_cost, target_notes,
      auth.uid()
    ) returning id into target_id;
  else
    update public.waste_log_entries
    set business_date = target_date,
        item_name = target_item,
        category = target_category,
        reason = target_reason,
        quantity = target_quantity,
        unit = target_unit,
        estimated_cost = target_cost,
        notes = target_notes,
        updated_at = now()
    where id = target_id
      and site_id = target_site
      and organisation_id = organisation
      and report_id is null;
    if not found then raise exception 'waste entry cannot be edited'; end if;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (organisation, auth.uid(), 'waste.saved', 'waste_log_entry', target_id,
    jsonb_build_object('site_id', target_site, 'business_date', target_date, 'estimated_cost', target_cost));
  return target_id;
end;
$$;

create or replace function public.delete_waste_entry(target_entry uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  entry public.waste_log_entries%rowtype;
begin
  select * into entry
  from public.waste_log_entries
  where id = target_entry
    and organisation_id = app_private.current_organisation_id()
  for update;
  if not found or not app_private.can_access_site(entry.site_id) then raise exception 'waste entry access denied'; end if;
  if entry.report_id is not null then raise exception 'captured waste cannot be deleted'; end if;
  delete from public.waste_log_entries where id = target_entry;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (entry.organisation_id, auth.uid(), 'waste.deleted', 'waste_log_entry', entry.id,
    jsonb_build_object('site_id', entry.site_id, 'business_date', entry.business_date, 'estimated_cost', entry.estimated_cost));
end;
$$;

create or replace function public.get_waste_summary(
  target_site uuid,
  range_start date,
  range_end date,
  target_report uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.can_read_site(target_site) then raise exception 'site access denied'; end if;
  if range_end < range_start or range_end - range_start > 31 then raise exception 'invalid waste range'; end if;
  select jsonb_build_object(
    'total', coalesce(sum(entry.estimated_cost), 0),
    'entryCount', count(*),
    'entries', coalesce(jsonb_agg(jsonb_build_object(
      'id', entry.id,
      'businessDate', entry.business_date,
      'itemName', entry.item_name,
      'estimatedCost', entry.estimated_cost,
      'reason', entry.reason
    ) order by entry.business_date, entry.created_at) filter (where entry.id is not null), '[]'::jsonb)
  ) into result
  from public.waste_log_entries entry
  where entry.site_id = target_site
    and entry.organisation_id = app_private.current_organisation_id()
    and entry.business_date between range_start and range_end
    and (entry.report_id is null or entry.report_id = target_report);
  return result;
end;
$$;

revoke all on function public.save_waste_entry(jsonb) from public, anon;
revoke all on function public.delete_waste_entry(uuid) from public, anon;
revoke all on function public.get_waste_summary(uuid, date, date, uuid) from public, anon;
grant execute on function public.save_waste_entry(jsonb) to authenticated;
grant execute on function public.delete_waste_entry(uuid) to authenticated;
grant execute on function public.get_waste_summary(uuid, date, date, uuid) to authenticated;

create or replace function public.get_salary_allocations()
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  profile_id uuid,
  staff_name text,
  role_title text,
  annual_salary numeric,
  oncost_rate numeric,
  allocation_pct numeric,
  valid_from date,
  valid_to date,
  active boolean,
  weekly_base_cost numeric,
  weekly_oncost numeric,
  weekly_loaded_cost numeric
)
language sql
stable
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
  select
    allocation.id,
    allocation.site_id,
    site.name,
    allocation.profile_id,
    allocation.staff_name,
    allocation.role_title,
    allocation.annual_salary,
    allocation.oncost_rate,
    allocation.allocation_pct,
    allocation.valid_from,
    allocation.valid_to,
    allocation.active,
    round(allocation.annual_salary / 52 * allocation.allocation_pct / 100, 2),
    round(allocation.annual_salary / 52 * allocation.allocation_pct / 100 * allocation.oncost_rate / 100, 2),
    round(allocation.annual_salary / 52 * allocation.allocation_pct / 100 * (1 + allocation.oncost_rate / 100), 2)
  from payroll_private.salary_allocations allocation
  join public.sites site on site.id = allocation.site_id
  where allocation.organisation_id = app_private.current_organisation_id()
    and app_private.current_app_role() = 'admin'
  order by allocation.active desc, site.name, allocation.staff_name;
$$;

create or replace function public.save_salary_allocation(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  target_id uuid := nullif(payload->>'id', '')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  target_profile uuid := nullif(payload->>'profileId', '')::uuid;
  target_name text := trim(coalesce(payload->>'staffName', ''));
  target_role text := left(trim(coalesce(payload->>'roleTitle', '')), 120);
  target_salary numeric := coalesce((payload->>'annualSalary')::numeric, 0);
  target_oncost numeric := coalesce((payload->>'oncostRate')::numeric, 0);
  target_allocation numeric := coalesce((payload->>'allocationPct')::numeric, 100);
  target_from date := (payload->>'validFrom')::date;
  target_to date := nullif(payload->>'validTo', '')::date;
  target_active boolean := coalesce((payload->>'active')::boolean, true);
  organisation uuid := app_private.current_organisation_id();
begin
  if auth.uid() is null or app_private.current_app_role() <> 'admin' then raise exception 'admin access required'; end if;
  if not exists (select 1 from public.sites where id = target_site and organisation_id = organisation) then raise exception 'site not found'; end if;
  if target_profile is not null and not exists (select 1 from public.profiles where id = target_profile and organisation_id = organisation) then raise exception 'profile not found'; end if;
  if length(target_name) < 2 or length(target_name) > 120 then raise exception 'invalid staff name'; end if;
  if target_salary <= 0 then raise exception 'annual salary must be positive'; end if;
  if target_oncost < 0 or target_oncost > 100 then raise exception 'invalid oncost rate'; end if;
  if target_allocation <= 0 or target_allocation > 100 then raise exception 'invalid site allocation'; end if;
  if target_to is not null and target_to < target_from then raise exception 'invalid salary dates'; end if;

  if target_id is null then
    insert into payroll_private.salary_allocations (
      organisation_id, site_id, profile_id, staff_name, role_title,
      annual_salary, oncost_rate, allocation_pct, valid_from, valid_to,
      active, created_by
    ) values (
      organisation, target_site, target_profile, target_name, target_role,
      target_salary, target_oncost, target_allocation, target_from, target_to,
      target_active, auth.uid()
    ) returning id into target_id;
  else
    update payroll_private.salary_allocations
    set site_id = target_site,
        profile_id = target_profile,
        staff_name = target_name,
        role_title = target_role,
        annual_salary = target_salary,
        oncost_rate = target_oncost,
        allocation_pct = target_allocation,
        valid_from = target_from,
        valid_to = target_to,
        active = target_active,
        updated_at = now()
    where id = target_id and organisation_id = organisation;
    if not found then raise exception 'salary allocation not found'; end if;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (organisation, auth.uid(), 'salary_allocation.saved', 'salary_allocation', target_id,
    jsonb_build_object('site_id', target_site, 'staff_name', target_name, 'annual_salary', target_salary, 'oncost_rate', target_oncost, 'allocation_pct', target_allocation));
  return target_id;
end;
$$;

create or replace function public.delete_salary_allocation(target_allocation uuid)
returns void
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  allocation payroll_private.salary_allocations%rowtype;
begin
  if auth.uid() is null or app_private.current_app_role() <> 'admin' then raise exception 'admin access required'; end if;
  select * into allocation from payroll_private.salary_allocations
  where id = target_allocation and organisation_id = app_private.current_organisation_id();
  if not found then raise exception 'salary allocation not found'; end if;
  delete from payroll_private.salary_allocations where id = target_allocation;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (allocation.organisation_id, auth.uid(), 'salary_allocation.deleted', 'salary_allocation', allocation.id,
    jsonb_build_object('site_id', allocation.site_id, 'staff_name', allocation.staff_name));
end;
$$;

revoke all on function public.get_salary_allocations() from public, anon;
revoke all on function public.save_salary_allocation(jsonb) from public, anon;
revoke all on function public.delete_salary_allocation(uuid) from public, anon;
grant execute on function public.get_salary_allocations() to authenticated;
grant execute on function public.save_salary_allocation(jsonb) to authenticated;
grant execute on function public.delete_salary_allocation(uuid) to authenticated;

create or replace function app_private.salary_cost_for_period(
  target_organisation uuid,
  target_site uuid,
  period_start date,
  period_end date
)
returns table (base_cost numeric, oncost_cost numeric, total_cost numeric)
language sql
stable
security definer
set search_path = payroll_private, public, pg_temp
as $$
  select
    coalesce(sum(
      allocation.annual_salary / 52
      * allocation.allocation_pct / 100
      * ((least(coalesce(allocation.valid_to, period_end), period_end) - greatest(allocation.valid_from, period_start) + 1)::numeric / 7)
    ), 0) as base_cost,
    coalesce(sum(
      allocation.annual_salary / 52
      * allocation.allocation_pct / 100
      * ((least(coalesce(allocation.valid_to, period_end), period_end) - greatest(allocation.valid_from, period_start) + 1)::numeric / 7)
      * allocation.oncost_rate / 100
    ), 0) as oncost_cost,
    coalesce(sum(
      allocation.annual_salary / 52
      * allocation.allocation_pct / 100
      * ((least(coalesce(allocation.valid_to, period_end), period_end) - greatest(allocation.valid_from, period_start) + 1)::numeric / 7)
      * (1 + allocation.oncost_rate / 100)
    ), 0) as total_cost
  from payroll_private.salary_allocations allocation
  where allocation.organisation_id = target_organisation
    and allocation.site_id = target_site
    and allocation.active
    and allocation.valid_from <= period_end
    and (allocation.valid_to is null or allocation.valid_to >= period_start);
$$;

revoke all on function app_private.salary_cost_for_period(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.recalculate_report_costs(target_report uuid)
returns void
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  r public.weekly_reports%rowtype;
  src public.report_source_values%rowtype;
  target public.sites%rowtype;
  period public.reporting_periods%rowtype;
  cogs_total numeric := 0;
  staff_total numeric := 0;
  hourly_staff_total numeric := 0;
  salary_base_total numeric := 0;
  salary_oncost_total numeric := 0;
  salary_loaded_total numeric := 0;
  food_pct numeric := 0;
  labour_pct numeric := 0;
  waste_pct numeric := 0;
  flags jsonb := '[]'::jsonb;
  time_record_count integer := 0;
  unrated_record_count integer := 0;
  actionable_count integer := 0;
begin
  select * into r from public.weekly_reports where id = target_report;
  if not found or (auth.role() <> 'service_role' and not app_private.can_access_site(r.site_id)) then raise exception 'report access denied'; end if;
  select * into src from public.report_source_values where report_id = target_report;
  select * into target from public.sites where id = r.site_id;
  select * into period from public.reporting_periods where id = r.period_id;

  if src.stocktake_completed then
    cogs_total := src.opening_stock + src.purchases - src.credits + src.transfers_in - src.transfers_out - src.closing_stock + src.adjustments;
  else
    cogs_total := src.purchases - src.credits + src.transfers_in - src.transfers_out + src.adjustments;
    flags := flags || jsonb_build_array(jsonb_build_object('code','SPEND_BASIS_ONLY','label','Spend-based food indicator','detail','Opening and closing stock were not counted; this is purchase spend, not stock-adjusted COGS.','severity','info'));
  end if;

  if src.labour_source in ('manual','rotacloud_upload','rotacloud_adjusted') and src.labour_confirmed then
    hourly_staff_total := src.staff_cost;
    time_record_count := case when src.staff_cost > 0 then 1 else 0 end;
  else
    select coalesce(sum(te.paid_hours * coalesce(pr.loaded_hourly_rate,0) + te.agency_cost + te.overtime_premium),0),
           count(*),
           count(*) filter (where te.paid_hours > 0 and pr.loaded_hourly_rate is null)
    into hourly_staff_total, time_record_count, unrated_record_count
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
  end if;

  if target.include_salary_costs then
    select base_cost, oncost_cost, total_cost
    into salary_base_total, salary_oncost_total, salary_loaded_total
    from app_private.salary_cost_for_period(r.organisation_id, r.site_id, period.week_start, period.week_end);
    if salary_loaded_total > 0 then
      flags := flags || jsonb_build_array(jsonb_build_object(
        'code','SALARY_COST_INCLUDED',
        'label','Salary allocation included',
        'detail',round(salary_base_total,2)::text || ' salary + ' || round(salary_oncost_total,2)::text || ' on-cost',
        'severity','info'
      ));
    else
      flags := flags || jsonb_build_array(jsonb_build_object(
        'code','SALARY_COST_NOT_CONFIGURED',
        'label','Salary inclusion is enabled but no allocation applies',
        'detail','Add an active salary allocation covering this reporting week or switch salary inclusion off for the site.',
        'severity','warning'
      ));
    end if;
  end if;

  staff_total := hourly_staff_total + salary_loaded_total;
  if src.net_sales > 0 then
    food_pct := cogs_total / src.net_sales * 100;
    labour_pct := staff_total / src.net_sales * 100;
    waste_pct := src.waste_cost / src.net_sales * 100;
  end if;

  if food_pct > target.food_cost_target then flags := flags || jsonb_build_array(jsonb_build_object('code','FOOD_COST_OVER_TARGET','label',case when src.stocktake_completed then 'Food cost over target' else 'Food spend over target' end,'detail',round(food_pct,1)::text || '% vs ' || round(target.food_cost_target,1)::text || '% target','severity',case when food_pct > target.food_cost_target + 3 then 'critical' else 'warning' end)); end if;
  if labour_pct > target.labour_target then flags := flags || jsonb_build_array(jsonb_build_object('code','LABOUR_OVER_TARGET','label','Labour over target','detail',round(labour_pct,1)::text || '% vs ' || round(target.labour_target,1)::text || '% target','severity',case when labour_pct > target.labour_target + 3 then 'critical' else 'warning' end)); end if;
  if waste_pct > target.waste_target then flags := flags || jsonb_build_array(jsonb_build_object('code','WASTE_OVER_TARGET','label','Waste over target','detail',round(waste_pct,1)::text || '% vs ' || round(target.waste_target,1)::text || '% target','severity','warning')); end if;
  if staff_total <= 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','STAFF_COST_MISSING','label','Aggregate wage cost missing','detail','A positive site-level RotaCloud, salary or payroll total is required.','severity','critical')); end if;
  if hourly_staff_total <= 0 and salary_loaded_total > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','HOURLY_STAFF_COST_MISSING','label','Hourly labour cost is missing','detail','The labour result currently contains salary allocations only. Add the RotaCloud aggregate before approval.','severity','warning')); end if;
  if unrated_record_count > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','PAY_RATE_MISSING','label','One or more private pay rates are missing','severity','critical')); end if;
  if src.pending_credits > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','PENDING_SUPPLIER_CREDIT','label','Supplier credit pending','detail',round(src.pending_credits,2)::text || ' is requested but not yet issued; it has not reduced spend.','severity','warning')); end if;
  if length(trim(r.compliance_issues)) > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','COMPLIANCE_REVIEW','label','Compliance issue reported','severity','critical')); end if;
  if length(trim(r.support_needed)) > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','SUPPORT_REQUESTED','label','Support requested','severity','info')); end if;

  insert into public.site_cost_snapshots(
    report_id, organisation_id, site_id, period_id, net_sales, cogs,
    food_cost_pct, staff_cost, hourly_staff_cost, salary_staff_cost,
    salary_oncost_cost, salaries_included, labour_pct, waste_cost,
    waste_pct, prime_cost, prime_cost_pct, food_cost_basis, review_flags,
    refreshed_at
  ) values (
    r.id, r.organisation_id, r.site_id, r.period_id, src.net_sales, cogs_total,
    food_pct, staff_total, hourly_staff_total, salary_base_total,
    salary_oncost_total, target.include_salary_costs, labour_pct, src.waste_cost,
    waste_pct, cogs_total + staff_total,
    case when src.net_sales > 0 then (cogs_total + staff_total) / src.net_sales * 100 else 0 end,
    case when src.stocktake_completed then 'stock_adjusted' else 'spend' end,
    flags, now()
  )
  on conflict(report_id) do update set
    net_sales = excluded.net_sales,
    cogs = excluded.cogs,
    food_cost_pct = excluded.food_cost_pct,
    staff_cost = excluded.staff_cost,
    hourly_staff_cost = excluded.hourly_staff_cost,
    salary_staff_cost = excluded.salary_staff_cost,
    salary_oncost_cost = excluded.salary_oncost_cost,
    salaries_included = excluded.salaries_included,
    labour_pct = excluded.labour_pct,
    waste_cost = excluded.waste_cost,
    waste_pct = excluded.waste_pct,
    prime_cost = excluded.prime_cost,
    prime_cost_pct = excluded.prime_cost_pct,
    food_cost_basis = excluded.food_cost_basis,
    review_flags = excluded.review_flags,
    refreshed_at = now();

  select count(*) into actionable_count
  from jsonb_array_elements(flags) flag
  where flag->>'severity' in ('warning','critical');
  if r.status='submitted' and actionable_count > 0 then
    update public.weekly_reports set status='review_required', updated_at=now() where id=r.id;
  end if;
end;
$$;

create or replace function app_private.refresh_salary_cost_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  affected_site uuid := coalesce(new.site_id, old.site_id);
  affected_start date := least(coalesce(new.valid_from, old.valid_from), coalesce(old.valid_from, new.valid_from));
  affected_end date := greatest(coalesce(new.valid_to, old.valid_to, '9999-12-31'::date), coalesce(old.valid_to, new.valid_to, '9999-12-31'::date));
  report_id uuid;
begin
  for report_id in
    select report.id
    from public.weekly_reports report
    join public.reporting_periods period on period.id = report.period_id
    where report.site_id = affected_site
      and period.week_end >= affected_start
      and period.week_start <= affected_end
  loop
    perform public.recalculate_report_costs(report_id);
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists salary_allocation_refresh_snapshots on payroll_private.salary_allocations;
create trigger salary_allocation_refresh_snapshots
after insert or update or delete on payroll_private.salary_allocations
for each row execute function app_private.refresh_salary_cost_snapshots();

create or replace function app_private.refresh_site_salary_toggle_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare report_id uuid;
begin
  if old.include_salary_costs is distinct from new.include_salary_costs then
    for report_id in select id from public.weekly_reports where site_id = new.id loop
      perform public.recalculate_report_costs(report_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists site_salary_toggle_refresh_snapshots on public.sites;
create trigger site_salary_toggle_refresh_snapshots
after update of include_salary_costs on public.sites
for each row execute function app_private.refresh_site_salary_toggle_snapshots();

create or replace function public.save_weekly_report_v2(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  report uuid;
  purchase_item jsonb;
  sales_day jsonb;
  sales_item jsonb;
  sales_category jsonb;
  item_description text;
  item_reference text;
  item_amount numeric;
  manual_total numeric := 0;
  waste_total numeric := 0;
  waste_count integer := 0;
  item_count integer := 0;
  day_count integer := 0;
  product_count integer := 0;
  category_count integer := 0;
  report_row public.weekly_reports%rowtype;
  period_row public.reporting_periods%rowtype;
begin
  report := public.save_weekly_report(payload);
  select * into report_row from public.weekly_reports where id = report;
  if not found or not app_private.can_access_site(report_row.site_id) then raise exception 'report access denied'; end if;
  select * into period_row from public.reporting_periods where id = report_row.period_id;

  select coalesce(sum(entry.estimated_cost), 0), count(*)
  into waste_total, waste_count
  from public.waste_log_entries entry
  where entry.site_id = report_row.site_id
    and entry.business_date between period_row.week_start and period_row.week_end
    and (entry.report_id is null or entry.report_id = report);

  if waste_count > 0 then
    update public.report_source_values
    set waste_cost = waste_total, updated_at = now()
    where report_id = report;
  end if;

  if coalesce(payload->>'status', '') = 'submitted' and waste_count > 0 then
    update public.waste_log_entries
    set report_id = report, captured_at = now(), updated_at = now()
    where site_id = report_row.site_id
      and business_date between period_row.week_start and period_row.week_end
      and report_id is null;
  end if;

  delete from public.report_manual_purchases where report_id = report;
  for purchase_item in select value from jsonb_array_elements(coalesce(payload->'manualPurchases', '[]'::jsonb)) loop
    item_description := trim(coalesce(purchase_item->>'description', ''));
    item_reference := trim(coalesce(purchase_item->>'receiptReference', ''));
    item_amount := coalesce((purchase_item->>'amount')::numeric, 0);
    if length(item_description) < 2 or length(item_description) > 120 then raise exception 'invalid manual purchase description'; end if;
    if length(item_reference) > 120 then raise exception 'invalid manual purchase reference'; end if;
    if item_amount <= 0 then raise exception 'manual purchase amount must be positive'; end if;
    insert into public.report_manual_purchases (report_id, description, amount, receipt_reference, added_by)
    values (report, item_description, item_amount, item_reference, auth.uid());
    manual_total := manual_total + item_amount;
    item_count := item_count + 1;
  end loop;

  update public.report_source_values
  set purchases = purchases + manual_total, updated_at = now()
  where report_id = report;

  if payload ? 'salesInsights' then
    delete from public.report_sales_days where report_id = report;
    for sales_day in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'days', '[]'::jsonb)) loop
      if (sales_day->>'businessDate')::date < period_row.week_start or (sales_day->>'businessDate')::date > period_row.week_end then raise exception 'sales day is outside the reporting week'; end if;
      insert into public.report_sales_days (report_id, business_date, gross_sales, net_sales, transactions, covers)
      values (report, (sales_day->>'businessDate')::date, greatest(coalesce((sales_day->>'grossSales')::numeric, 0), 0), greatest(coalesce((sales_day->>'netSales')::numeric, 0), 0), greatest(coalesce((sales_day->>'transactions')::integer, 0), 0), greatest(coalesce((sales_day->>'covers')::integer, 0), 0))
      on conflict (report_id, business_date) do update set gross_sales=excluded.gross_sales, net_sales=excluded.net_sales, transactions=excluded.transactions, covers=excluded.covers, updated_at=now();
      day_count := day_count + 1;
    end loop;

    delete from public.report_sales_items where report_id = report;
    for sales_item in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'items', '[]'::jsonb)) loop
      item_description := left(trim(coalesce(sales_item->>'itemName', '')), 180);
      if item_description = '' then continue; end if;
      insert into public.report_sales_items (report_id, item_name, category, quantity, net_sales)
      values (report, item_description, left(coalesce(nullif(trim(sales_item->>'category'), ''), 'Uncategorised'), 120), greatest(coalesce((sales_item->>'quantity')::numeric, 0), 0), greatest(coalesce((sales_item->>'netSales')::numeric, 0), 0))
      on conflict (report_id, item_name, category) do update set quantity=excluded.quantity, net_sales=excluded.net_sales, updated_at=now();
      product_count := product_count + 1;
    end loop;

    delete from public.report_sales_categories where report_id = report;
    for sales_category in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'categories', '[]'::jsonb)) loop
      item_description := left(trim(coalesce(sales_category->>'category', '')), 120);
      if item_description = '' then continue; end if;
      insert into public.report_sales_categories (report_id, category, quantity, net_sales)
      values (report, item_description, greatest(coalesce((sales_category->>'quantity')::numeric, 0), 0), greatest(coalesce((sales_category->>'netSales')::numeric, 0), 0))
      on conflict (report_id, category) do update set quantity=excluded.quantity, net_sales=excluded.net_sales, updated_at=now();
      category_count := category_count + 1;
    end loop;

    if category_count = 0 then
      insert into public.report_sales_categories (report_id, category, quantity, net_sales)
      select report, item.category, sum(item.quantity), sum(item.net_sales)
      from public.report_sales_items item where item.report_id = report
      group by item.category having sum(item.quantity) > 0 or sum(item.net_sales) > 0;
      get diagnostics category_count = row_count;
    end if;

    with ranked as (select id, row_number() over (order by net_sales desc, quantity desc, item_name)::integer as position from public.report_sales_items where report_id = report)
    update public.report_sales_items item set sales_rank = ranked.position from ranked where item.id = ranked.id;
    with ranked as (select id, row_number() over (order by net_sales desc, quantity desc, category)::integer as position from public.report_sales_categories where report_id = report)
    update public.report_sales_categories category set sales_rank = ranked.position from ranked where category.id = ranked.id;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    values (report_row.organisation_id, auth.uid(), 'report.safe_sales_insights_saved', 'weekly_report', report,
      jsonb_build_object('daily_rows', day_count, 'product_rows', product_count, 'category_rows', category_count));
  end if;

  if item_count > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    values (report_row.organisation_id, auth.uid(), 'report.manual_purchases_recorded', 'weekly_report', report,
      jsonb_build_object('item_count', item_count, 'total', manual_total));
  end if;

  if waste_count > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    values (report_row.organisation_id, auth.uid(), case when coalesce(payload->>'status','')='submitted' then 'report.waste_captured' else 'report.waste_previewed' end, 'weekly_report', report,
      jsonb_build_object('entry_count', waste_count, 'total', waste_total));
  end if;

  return report;
end;
$$;

revoke all on function public.save_weekly_report_v2(jsonb) from public, anon;
grant execute on function public.save_weekly_report_v2(jsonb) to authenticated;

commit;

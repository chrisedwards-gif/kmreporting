-- Manager-led source imports and Sunday-to-Saturday reporting.
-- Raw EPOS, purchasing and rota files are parsed in the browser. Only safe
-- site/week aggregates and a file fingerprint enter the public schema.

begin;

alter table public.reporting_periods drop constraint if exists reporting_period_starts_monday;
alter table public.reporting_periods add column if not exists reporting_cycle text;
update public.reporting_periods set reporting_cycle = 'legacy_monday_sunday' where reporting_cycle is null;
alter table public.reporting_periods alter column reporting_cycle set default 'sunday_saturday';
alter table public.reporting_periods alter column reporting_cycle set not null;
alter table public.reporting_periods drop constraint if exists reporting_period_cycle_valid;
alter table public.reporting_periods add constraint reporting_period_cycle_valid
check (reporting_cycle in ('legacy_monday_sunday', 'sunday_saturday'));

alter table public.report_source_values
  add column if not exists stocktake_completed boolean not null default false,
  add column if not exists staff_cost numeric(14,2) not null default 0 check (staff_cost >= 0),
  add column if not exists paid_hours numeric(10,2) not null default 0 check (paid_hours >= 0),
  add column if not exists pending_credits numeric(14,2) not null default 0 check (pending_credits >= 0),
  add column if not exists awaiting_invoice numeric(14,2) not null default 0 check (awaiting_invoice >= 0),
  add column if not exists sales_source text not null default 'manual',
  add column if not exists purchasing_source text not null default 'manual',
  add column if not exists labour_source text not null default 'private_payroll',
  add column if not exists sales_source_reference text not null default '',
  add column if not exists purchasing_source_reference text not null default '',
  add column if not exists labour_source_reference text not null default '',
  add column if not exists sales_confirmed boolean not null default false,
  add column if not exists purchasing_confirmed boolean not null default false,
  add column if not exists labour_confirmed boolean not null default false;

alter table public.site_cost_snapshots
  add column if not exists food_cost_basis text not null default 'spend'
  check (food_cost_basis in ('spend', 'stock_adjusted'));

create or replace function public.save_weekly_report(payload jsonb)
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
  existing_status public.report_status;
begin
  if auth.uid() is null or not app_private.can_access_site(target_site) then raise exception 'site access denied'; end if;
  if target_end <> target_start + 6 or extract(dow from target_start) <> 0 then raise exception 'reporting period must be Sunday to Saturday'; end if;
  if target_status not in ('draft', 'submitted') then raise exception 'invalid submission status'; end if;
  if target_status = 'submitted' and (
    coalesce((payload->>'netSales')::numeric, 0) <= 0
    or coalesce((payload->>'staffCost')::numeric, 0) <= 0
    or coalesce((payload->>'salesConfirmed')::boolean, false) is false
    or coalesce((payload->>'purchasingConfirmed')::boolean, false) is false
    or coalesce((payload->>'labourConfirmed')::boolean, false) is false
  ) then raise exception 'required weekly source totals are not confirmed'; end if;

  insert into public.reporting_periods (organisation_id, week_start, week_end, due_at, reporting_cycle)
  values (organisation, target_start, target_end, ((target_end + 2) + time '12:00') at time zone 'Europe/London', 'sunday_saturday')
  on conflict (organisation_id, week_start) do update set week_end = excluded.week_end, reporting_cycle = 'sunday_saturday'
  returning id into period;

  select status into existing_status from public.weekly_reports where site_id = target_site and period_id = period;
  if existing_status is not null and existing_status <> 'draft' then
    raise exception 'a submitted or approved report cannot be overwritten';
  end if;

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
    submitted_at = case when excluded.status = 'submitted' then now() else weekly_reports.submitted_at end,
    updated_at = now()
  returning id into report;

  insert into public.report_source_values (
    report_id, net_sales, opening_stock, purchases, credits, transfers_in, transfers_out,
    closing_stock, adjustments, waste_cost, stocktake_completed, staff_cost, paid_hours,
    pending_credits, awaiting_invoice, sales_source, purchasing_source, labour_source,
    sales_source_reference, purchasing_source_reference, labour_source_reference,
    sales_confirmed, purchasing_confirmed, labour_confirmed, confirmed_by, confirmed_at, updated_at
  ) values (
    report, coalesce((payload->>'netSales')::numeric, 0), coalesce((payload->>'openingStock')::numeric, 0),
    coalesce((payload->>'purchases')::numeric, 0), coalesce((payload->>'credits')::numeric, 0),
    coalesce((payload->>'transfersIn')::numeric, 0), coalesce((payload->>'transfersOut')::numeric, 0),
    coalesce((payload->>'closingStock')::numeric, 0), coalesce((payload->>'adjustments')::numeric, 0),
    coalesce((payload->>'wasteCost')::numeric, 0), coalesce((payload->>'stocktakeCompleted')::boolean, false),
    coalesce((payload->>'staffCost')::numeric, 0), coalesce((payload->>'paidHours')::numeric, 0),
    coalesce((payload->>'pendingCredits')::numeric, 0), coalesce((payload->>'awaitingInvoice')::numeric, 0),
    left(coalesce(payload->>'salesSource', 'manual'), 80), left(coalesce(payload->>'purchasingSource', 'manual'), 80),
    left(coalesce(payload->>'labourSource', 'manual'), 80), left(coalesce(payload->>'salesSourceReference', ''), 250),
    left(coalesce(payload->>'purchasingSourceReference', ''), 250), left(coalesce(payload->>'labourSourceReference', ''), 250),
    coalesce((payload->>'salesConfirmed')::boolean, false), coalesce((payload->>'purchasingConfirmed')::boolean, false),
    coalesce((payload->>'labourConfirmed')::boolean, false), auth.uid(), now(), now()
  )
  on conflict (report_id) do update set
    net_sales = excluded.net_sales, opening_stock = excluded.opening_stock, purchases = excluded.purchases,
    credits = excluded.credits, transfers_in = excluded.transfers_in, transfers_out = excluded.transfers_out,
    closing_stock = excluded.closing_stock, adjustments = excluded.adjustments, waste_cost = excluded.waste_cost,
    stocktake_completed = excluded.stocktake_completed, staff_cost = excluded.staff_cost, paid_hours = excluded.paid_hours,
    pending_credits = excluded.pending_credits, awaiting_invoice = excluded.awaiting_invoice,
    sales_source = excluded.sales_source, purchasing_source = excluded.purchasing_source, labour_source = excluded.labour_source,
    sales_source_reference = excluded.sales_source_reference, purchasing_source_reference = excluded.purchasing_source_reference,
    labour_source_reference = excluded.labour_source_reference, sales_confirmed = excluded.sales_confirmed,
    purchasing_confirmed = excluded.purchasing_confirmed, labour_confirmed = excluded.labour_confirmed,
    confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now();

  with imported as (select * from app_private.rollup_daily_metrics(target_site, target_start, target_end))
  update public.report_source_values values_row set
    net_sales = case when imported.has_sales then coalesce(imported.net_sales, 0) else values_row.net_sales end,
    purchases = case when imported.has_purchasing then coalesce(imported.purchases, 0) else values_row.purchases end,
    credits = case when imported.has_purchasing then coalesce(imported.credits, 0) else values_row.credits end,
    waste_cost = case when imported.has_waste then coalesce(imported.waste_cost, 0) else values_row.waste_cost end,
    sales_source = case when imported.has_sales then 'provider_api' else values_row.sales_source end,
    purchasing_source = case when imported.has_purchasing then 'provider_api' else values_row.purchasing_source end,
    sales_confirmed = case when imported.has_sales then true else values_row.sales_confirmed end,
    purchasing_confirmed = case when imported.has_purchasing then true else values_row.purchasing_confirmed end,
    updated_at = now()
  from imported where values_row.report_id = report;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    organisation, auth.uid(), case when target_status = 'submitted' then 'report.submitted' else 'report.saved' end,
    'weekly_report', report,
    jsonb_build_object(
      'sales_source', left(coalesce(payload->>'salesSource', 'manual'), 80),
      'purchasing_source', left(coalesce(payload->>'purchasingSource', 'manual'), 80),
      'labour_source', left(coalesce(payload->>'labourSource', 'manual'), 80),
      'stocktake_completed', coalesce((payload->>'stocktakeCompleted')::boolean, false)
    )
  );
  return report;
end;
$$;

revoke all on function public.save_weekly_report(jsonb) from public, anon;
grant execute on function public.save_weekly_report(jsonb) to authenticated;

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
  cogs_total numeric := 0;
  staff_total numeric := 0;
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

  if src.stocktake_completed then
    cogs_total := src.opening_stock + src.purchases - src.credits + src.transfers_in - src.transfers_out - src.closing_stock + src.adjustments;
  else
    cogs_total := src.purchases - src.credits + src.transfers_in - src.transfers_out + src.adjustments;
    flags := flags || jsonb_build_array(jsonb_build_object(
      'code','SPEND_BASIS_ONLY','label','Spend-based food indicator','detail','Opening and closing stock were not counted; this is purchase spend, not stock-adjusted COGS.','severity','info'
    ));
  end if;

  if src.labour_source in ('manual', 'rotacloud_upload', 'rotacloud_adjusted') and src.labour_confirmed then
    staff_total := src.staff_cost;
    time_record_count := case when src.staff_cost > 0 then 1 else 0 end;
  else
    select
      coalesce(sum(te.paid_hours * coalesce(pr.loaded_hourly_rate, 0) + te.agency_cost + te.overtime_premium), 0),
      count(*), count(*) filter (where te.paid_hours > 0 and pr.loaded_hourly_rate is null)
      into staff_total, time_record_count, unrated_record_count
    from payroll_private.time_entries te
    join public.reporting_periods rp on rp.id = te.period_id
    left join lateral (
      select rate.loaded_hourly_rate from payroll_private.pay_rates rate
      where rate.organisation_id = te.organisation_id and rate.site_id = te.site_id
        and rate.employee_ref = te.employee_ref and rate.valid_from <= rp.week_end
        and (rate.valid_to is null or rate.valid_to >= rp.week_start)
      order by rate.valid_from desc limit 1
    ) pr on true
    where te.site_id = r.site_id and te.period_id = r.period_id;
  end if;

  if src.net_sales > 0 then
    food_pct := cogs_total / src.net_sales * 100;
    labour_pct := staff_total / src.net_sales * 100;
    waste_pct := src.waste_cost / src.net_sales * 100;
  end if;

  if food_pct > target.food_cost_target then flags := flags || jsonb_build_array(jsonb_build_object('code','FOOD_COST_OVER_TARGET','label',case when src.stocktake_completed then 'Food cost over target' else 'Food spend over target' end,'detail',round(food_pct,1)::text || '% vs ' || round(target.food_cost_target,1)::text || '% target','severity',case when food_pct > target.food_cost_target + 3 then 'critical' else 'warning' end)); end if;
  if labour_pct > target.labour_target then flags := flags || jsonb_build_array(jsonb_build_object('code','LABOUR_OVER_TARGET','label','Labour over target','detail',round(labour_pct,1)::text || '% vs ' || round(target.labour_target,1)::text || '% target','severity',case when labour_pct > target.labour_target + 3 then 'critical' else 'warning' end)); end if;
  if waste_pct > target.waste_target then flags := flags || jsonb_build_array(jsonb_build_object('code','WASTE_OVER_TARGET','label','Waste over target','detail',round(waste_pct,1)::text || '% vs ' || round(target.waste_target,1)::text || '% target','severity','warning')); end if;
  if time_record_count = 0 or staff_total <= 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','STAFF_COST_MISSING','label','Aggregate wage cost missing','detail','A positive site-level RotaCloud or payroll total is required.','severity','critical')); end if;
  if unrated_record_count > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','PAY_RATE_MISSING','label','One or more private pay rates are missing','severity','critical')); end if;
  if src.pending_credits > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','PENDING_SUPPLIER_CREDIT','label','Supplier credit pending','detail',round(src.pending_credits,2)::text || ' is requested but not yet issued; it has not reduced spend.','severity','warning')); end if;
  if length(trim(r.compliance_issues)) > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','COMPLIANCE_REVIEW','label','Compliance issue reported','severity','critical')); end if;
  if length(trim(r.support_needed)) > 0 then flags := flags || jsonb_build_array(jsonb_build_object('code','SUPPORT_REQUESTED','label','Support requested','severity','info')); end if;

  insert into public.site_cost_snapshots (
    report_id, organisation_id, site_id, period_id, net_sales, cogs, food_cost_pct,
    staff_cost, labour_pct, waste_cost, waste_pct, prime_cost, prime_cost_pct,
    food_cost_basis, review_flags, refreshed_at
  ) values (
    r.id, r.organisation_id, r.site_id, r.period_id, src.net_sales, cogs_total, food_pct,
    staff_total, labour_pct, src.waste_cost, waste_pct, cogs_total + staff_total,
    case when src.net_sales > 0 then (cogs_total + staff_total) / src.net_sales * 100 else 0 end,
    case when src.stocktake_completed then 'stock_adjusted' else 'spend' end, flags, now()
  ) on conflict (report_id) do update set
    net_sales = excluded.net_sales, cogs = excluded.cogs, food_cost_pct = excluded.food_cost_pct,
    staff_cost = excluded.staff_cost, labour_pct = excluded.labour_pct, waste_cost = excluded.waste_cost,
    waste_pct = excluded.waste_pct, prime_cost = excluded.prime_cost, prime_cost_pct = excluded.prime_cost_pct,
    food_cost_basis = excluded.food_cost_basis, review_flags = excluded.review_flags, refreshed_at = now();

  select count(*) into actionable_count from jsonb_array_elements(flags) flag where flag->>'severity' in ('warning', 'critical');
  if r.status = 'submitted' and actionable_count > 0 then
    update public.weekly_reports set status = 'review_required', updated_at = now() where id = r.id;
  end if;
end;
$$;

revoke all on function public.recalculate_report_costs(uuid) from public, anon;
grant execute on function public.recalculate_report_costs(uuid) to authenticated;
grant execute on function public.recalculate_report_costs(uuid) to service_role;

create or replace function public.decide_report(target_report uuid, target_decision public.approval_decision, decision_notes text default '')
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
  if report_row.status not in ('submitted', 'review_required') then raise exception 'only submitted reports can receive a decision'; end if;
  if target_decision = 'approved' and exists (
    select 1 from jsonb_array_elements(coalesce((select review_flags from public.site_cost_snapshots where report_id = target_report), '[]'::jsonb)) flag
    where flag->>'severity' in ('warning', 'critical')
      and not exists (select 1 from public.report_review_resolutions rr where rr.report_id = target_report and rr.flag_code = flag->>'code')
  ) then raise exception 'all actionable review flags must be resolved before approval'; end if;
  insert into public.report_approvals (report_id, decision, notes, decided_by) values (target_report, target_decision, coalesce(decision_notes,''), auth.uid());
  update public.weekly_reports set status = case when target_decision = 'approved' then 'approved'::public.report_status else 'draft'::public.report_status end,
    approved_at = case when target_decision = 'approved' then now() else null end, updated_at = now()
  where id = target_report;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (report_row.organisation_id, auth.uid(), 'report.' || target_decision::text, 'weekly_report', target_report, jsonb_build_object('notes', coalesce(decision_notes,'')));
end;
$$;

revoke all on function public.decide_report(uuid, public.approval_decision, text) from public, anon;
grant execute on function public.decide_report(uuid, public.approval_decision, text) to authenticated;

create or replace function public.resolve_and_approve_report(target_report uuid, resolution_notes text)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare flag jsonb;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then raise exception 'approval access denied'; end if;
  if length(trim(coalesce(resolution_notes, ''))) = 0 and exists (
    select 1 from public.site_cost_snapshots snapshot, jsonb_array_elements(snapshot.review_flags) item
    where snapshot.report_id = target_report and item->>'severity' in ('warning', 'critical')
  ) then raise exception 'resolution notes are required for actionable flags'; end if;
  for flag in
    select value from jsonb_array_elements(coalesce((select review_flags from public.site_cost_snapshots where report_id = target_report), '[]'::jsonb))
    where value->>'severity' in ('warning', 'critical')
  loop
    insert into public.report_review_resolutions (report_id, flag_code, resolution, resolved_by)
    values (target_report, flag->>'code', resolution_notes, auth.uid())
    on conflict (report_id, flag_code) do update set resolution = excluded.resolution, resolved_by = auth.uid(), resolved_at = now();
  end loop;
  perform public.decide_report(target_report, 'approved'::public.approval_decision, resolution_notes);
end;
$$;

revoke all on function public.resolve_and_approve_report(uuid, text) from public, anon;
grant execute on function public.resolve_and_approve_report(uuid, text) to authenticated;

-- Existing server-side payroll connectors still take precedence when used.
create or replace function public.import_private_cost_data(payload jsonb)
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
    insert into payroll_private.pay_rates (organisation_id, site_id, employee_ref, hourly_rate, annual_salary, contracted_weekly_hours, employer_ni_rate, pension_rate, other_oncost_rate, valid_from, valid_to)
    values (organisation, target_site, item->>'employeeRef', (item->>'hourlyRate')::numeric, (item->>'annualSalary')::numeric, (item->>'contractedWeeklyHours')::numeric, coalesce((item->>'employerNiRate')::numeric,0), coalesce((item->>'pensionRate')::numeric,0), coalesce((item->>'otherOncostRate')::numeric,0), (item->>'validFrom')::date, (item->>'validTo')::date)
    on conflict (organisation_id, employee_ref, valid_from) do update set site_id=excluded.site_id, hourly_rate=excluded.hourly_rate, annual_salary=excluded.annual_salary, contracted_weekly_hours=excluded.contracted_weekly_hours, employer_ni_rate=excluded.employer_ni_rate, pension_rate=excluded.pension_rate, other_oncost_rate=excluded.other_oncost_rate, valid_to=excluded.valid_to;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(payload->'timeEntries', '[]'::jsonb)) loop
    insert into payroll_private.time_entries (organisation_id, site_id, period_id, employee_ref, paid_hours, agency_cost, overtime_premium, source_reference, imported_at)
    values (organisation, target_site, target_period, item->>'employeeRef', coalesce((item->>'paidHours')::numeric,0), coalesce((item->>'agencyCost')::numeric,0), coalesce((item->>'overtimePremium')::numeric,0), item->>'sourceReference', now())
    on conflict (site_id, period_id, employee_ref) do update set paid_hours=excluded.paid_hours, agency_cost=excluded.agency_cost, overtime_premium=excluded.overtime_premium, source_reference=excluded.source_reference, imported_at=now();
  end loop;
  select id into target_report from public.weekly_reports where site_id=target_site and period_id=target_period;
  if target_report is not null then
    update public.report_source_values set labour_source='private_payroll', labour_confirmed=true, labour_source_reference='server integration', updated_at=now() where report_id=target_report;
    perform public.recalculate_report_costs(target_report);
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (organisation, null, 'costs.private_imported', 'site', target_site, jsonb_build_object('period_id', target_period));
end;
$$;

revoke all on function public.import_private_cost_data(jsonb) from public, anon, authenticated;
grant execute on function public.import_private_cost_data(jsonb) to service_role;

commit;

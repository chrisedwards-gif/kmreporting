-- Safe kitchen lifecycle controls and historical reporting comparisons.
--
-- Kitchens with operational history are archived rather than deleted. A hard
-- delete is available only when every dependent record count is zero.
-- Historical comparisons combine daily EPOS totals with approved weekly cost
-- snapshots and remain useful while the data history is still building.

begin;

create or replace function public.get_site_usage_summary()
returns table (
  site_id uuid,
  reports bigint,
  daily_records bigint,
  checks bigint,
  people_records bigint,
  sops bigint,
  training bigint,
  products bigint,
  messages bigint,
  payroll_records bigint,
  total_dependencies bigint
)
language sql
stable
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
  select
    site.id,
    (select count(*) from public.weekly_reports item where item.site_id = site.id) as reports,
    (
      (select count(*) from public.daily_site_metrics item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_items item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_categories item where item.site_id = site.id)
    ) as daily_records,
    (
      (select count(*) from public.kitchen_check_templates item where item.site_id = site.id)
      + (select count(*) from public.kitchen_check_runs item where item.site_id = site.id)
    ) as checks,
    (
      (select count(*) from public.site_manager_assignments item where item.site_id = site.id)
      + (select count(*) from public.site_memberships item where item.site_id = site.id)
      + (select count(*) from public.one_to_one_reviews item where item.site_id = site.id)
      + (select count(*) from public.manager_actions item where item.site_id = site.id)
      + (select count(*) from public.managers item where item.site_id = site.id)
    ) as people_records,
    (
      (select count(*) from public.sops item where item.site_id = site.id)
      + (select count(*) from public.sop_versions item where item.site_id = site.id)
    ) as sops,
    (select count(*) from public.training_records item where item.site_id = site.id) as training,
    (select count(*) from public.product_development_items item where item.site_id = site.id) as products,
    (
      (select count(*) from public.manager_messages item where item.site_id = site.id)
      + (select count(*) from public.teamup_calendar_links item where item.site_id = site.id)
      + (select count(*) from public.notification_log item where item.site_id = site.id)
    ) as messages,
    (
      (select count(*) from payroll_private.pay_rates item where item.site_id = site.id)
      + (select count(*) from payroll_private.time_entries item where item.site_id = site.id)
    ) as payroll_records,
    (
      (select count(*) from public.weekly_reports item where item.site_id = site.id)
      + (select count(*) from public.daily_site_metrics item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_items item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_categories item where item.site_id = site.id)
      + (select count(*) from public.kitchen_check_templates item where item.site_id = site.id)
      + (select count(*) from public.kitchen_check_runs item where item.site_id = site.id)
      + (select count(*) from public.site_manager_assignments item where item.site_id = site.id)
      + (select count(*) from public.site_memberships item where item.site_id = site.id)
      + (select count(*) from public.one_to_one_reviews item where item.site_id = site.id)
      + (select count(*) from public.manager_actions item where item.site_id = site.id)
      + (select count(*) from public.managers item where item.site_id = site.id)
      + (select count(*) from public.sops item where item.site_id = site.id)
      + (select count(*) from public.sop_versions item where item.site_id = site.id)
      + (select count(*) from public.training_records item where item.site_id = site.id)
      + (select count(*) from public.product_development_items item where item.site_id = site.id)
      + (select count(*) from public.manager_messages item where item.site_id = site.id)
      + (select count(*) from public.teamup_calendar_links item where item.site_id = site.id)
      + (select count(*) from public.notification_log item where item.site_id = site.id)
      + (select count(*) from payroll_private.pay_rates item where item.site_id = site.id)
      + (select count(*) from payroll_private.time_entries item where item.site_id = site.id)
    ) as total_dependencies
  from public.sites site
  where site.organisation_id = app_private.current_organisation_id()
    and app_private.current_app_role() = 'admin'
  order by site.name;
$$;

revoke all on function public.get_site_usage_summary() from public, anon;
grant execute on function public.get_site_usage_summary() to authenticated;

create or replace function public.delete_unused_site(target_site uuid, confirmation_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  target public.sites%rowtype;
  usage record;
begin
  if auth.uid() is null or app_private.current_app_role() <> 'admin' then
    raise exception 'admin access required';
  end if;

  select * into target
  from public.sites
  where id = target_site
    and organisation_id = app_private.current_organisation_id()
  for update;

  if not found then raise exception 'kitchen not found'; end if;
  if upper(trim(coalesce(confirmation_code, ''))) <> upper(target.code) then
    raise exception 'confirmation code does not match';
  end if;
  if target.active then
    raise exception 'archive kitchen before permanent deletion';
  end if;

  select * into usage
  from public.get_site_usage_summary()
  where site_id = target_site;

  if coalesce(usage.total_dependencies, 0) > 0 then
    raise exception 'kitchen has linked history and must be archived instead';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    target.organisation_id,
    auth.uid(),
    'site.deleted_unused',
    'site',
    target.id,
    jsonb_build_object('name', target.name, 'code', target.code)
  );

  delete from public.sites where id = target.id;
  return jsonb_build_object('deleted', true, 'site_id', target.id, 'name', target.name, 'code', target.code);
end;
$$;

revoke all on function public.delete_unused_site(uuid, text) from public, anon;
grant execute on function public.delete_unused_site(uuid, text) to authenticated;

create index if not exists weekly_reports_site_period_idx on public.weekly_reports(site_id, period_id);
create index if not exists report_sales_days_business_date_idx on public.report_sales_days(business_date, report_id);
create index if not exists reporting_periods_week_end_idx on public.reporting_periods(organisation_id, week_end desc);

create or replace function public.get_reporting_comparison(
  target_site uuid,
  range_start date,
  range_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  organisation uuid := app_private.current_organisation_id();
  caller_role public.app_role := app_private.current_app_role();
  range_days integer;
  previous_start date;
  previous_end date;
  prior_year_start date;
  prior_year_end date;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if range_start is null or range_end is null or range_end < range_start then
    raise exception 'invalid comparison range';
  end if;

  range_days := range_end - range_start + 1;
  if range_days > 370 then raise exception 'comparison range cannot exceed 370 days'; end if;

  if target_site is null then
    if caller_role not in ('admin', 'group_manager', 'finance', 'viewer') then
      raise exception 'group comparison access denied';
    end if;
  elsif not app_private.can_read_site(target_site) then
    raise exception 'site comparison access denied';
  end if;

  previous_end := range_start - 1;
  previous_start := previous_end - (range_days - 1);
  prior_year_start := (range_start - interval '1 year')::date;
  prior_year_end := (range_end - interval '1 year')::date;

  with scope_sites as (
    select id
    from public.sites
    where organisation_id = organisation
      and (target_site is null or id = target_site)
  ),
  report_daily as (
    select report.site_id, day.business_date, day.gross_sales, day.net_sales, day.transactions, day.covers, 1 as source_priority
    from public.report_sales_days day
    join public.weekly_reports report on report.id = day.report_id
    join scope_sites scope on scope.id = report.site_id
    where report.organisation_id = organisation
      and day.business_date between least(previous_start, prior_year_start) and range_end
  ),
  imported_daily as (
    select metrics.site_id, metrics.business_date, metrics.gross_sales, metrics.net_sales, metrics.transactions, metrics.covers, 2 as source_priority
    from public.daily_site_metrics metrics
    join scope_sites scope on scope.id = metrics.site_id
    where metrics.organisation_id = organisation
      and metrics.has_sales
      and metrics.business_date between least(previous_start, prior_year_start) and range_end
  ),
  daily as (
    select distinct on (source.site_id, source.business_date)
      source.site_id, source.business_date, source.gross_sales, source.net_sales, source.transactions, source.covers
    from (
      select * from report_daily
      union all
      select * from imported_daily
    ) source
    order by source.site_id, source.business_date, source.source_priority desc
  ),
  approved_costs as (
    select snapshot.site_id, period.week_end, snapshot.net_sales, snapshot.cogs, snapshot.staff_cost, snapshot.waste_cost, snapshot.prime_cost
    from public.site_cost_snapshots snapshot
    join public.weekly_reports report on report.id = snapshot.report_id
    join public.reporting_periods period on period.id = snapshot.period_id
    join scope_sites scope on scope.id = snapshot.site_id
    where snapshot.organisation_id = organisation
      and report.status in ('approved', 'shared')
      and period.week_end between least(previous_start, prior_year_start) and range_end
  ),
  windows(label, starts_on, ends_on) as (
    values
      ('current'::text, range_start, range_end),
      ('previous'::text, previous_start, previous_end),
      ('prior_year'::text, prior_year_start, prior_year_end)
  ),
  window_metrics as (
    select
      window.label,
      window.starts_on,
      window.ends_on,
      coalesce(daily_totals.net_sales, 0) as daily_sales,
      coalesce(daily_totals.gross_sales, 0) as gross_sales,
      coalesce(daily_totals.transactions, 0) as transactions,
      coalesce(daily_totals.covers, 0) as covers,
      coalesce(daily_totals.sales_days, 0) as sales_days,
      coalesce(cost_totals.snapshot_sales, 0) as snapshot_sales,
      coalesce(cost_totals.cogs, 0) as cogs,
      coalesce(cost_totals.staff_cost, 0) as staff_cost,
      coalesce(cost_totals.waste_cost, 0) as waste_cost,
      coalesce(cost_totals.prime_cost, 0) as prime_cost,
      coalesce(cost_totals.report_weeks, 0) as report_weeks
    from windows window
    left join lateral (
      select sum(item.net_sales) as net_sales, sum(item.gross_sales) as gross_sales, sum(item.transactions) as transactions, sum(item.covers) as covers, count(distinct item.business_date) as sales_days
      from daily item
      where item.business_date between window.starts_on and window.ends_on
    ) daily_totals on true
    left join lateral (
      select sum(item.net_sales) as snapshot_sales, sum(item.cogs) as cogs, sum(item.staff_cost) as staff_cost, sum(item.waste_cost) as waste_cost, sum(item.prime_cost) as prime_cost, count(*) as report_weeks
      from approved_costs item
      where item.week_end between window.starts_on and window.ends_on
    ) cost_totals on true
  ),
  daily_json as (
    select jsonb_object_agg(
      window.label,
      coalesce((
        select jsonb_agg(jsonb_build_object('businessDate', item.business_date, 'netSales', item.net_sales, 'grossSales', item.gross_sales, 'transactions', item.transactions, 'covers', item.covers) order by item.business_date)
        from daily item
        where item.business_date between window.starts_on and window.ends_on
      ), '[]'::jsonb)
    ) as value
    from windows window
  ),
  metrics_json as (
    select jsonb_object_agg(
      metrics.label,
      jsonb_build_object(
        'start', metrics.starts_on,
        'end', metrics.ends_on,
        'netSales', case when metrics.sales_days > 0 then metrics.daily_sales else metrics.snapshot_sales end,
        'grossSales', metrics.gross_sales,
        'transactions', metrics.transactions,
        'covers', metrics.covers,
        'averageTransactionValue', case when metrics.transactions > 0 then metrics.daily_sales / metrics.transactions else null end,
        'foodCost', metrics.cogs,
        'foodCostPct', case when metrics.snapshot_sales > 0 then metrics.cogs / metrics.snapshot_sales * 100 else null end,
        'staffCost', metrics.staff_cost,
        'labourPct', case when metrics.snapshot_sales > 0 then metrics.staff_cost / metrics.snapshot_sales * 100 else null end,
        'wasteCost', metrics.waste_cost,
        'wastePct', case when metrics.snapshot_sales > 0 then metrics.waste_cost / metrics.snapshot_sales * 100 else null end,
        'primeCost', metrics.prime_cost,
        'primeCostPct', case when metrics.snapshot_sales > 0 then metrics.prime_cost / metrics.snapshot_sales * 100 else null end,
        'salesDays', metrics.sales_days,
        'reportWeeks', metrics.report_weeks
      )
    ) as value
    from window_metrics metrics
  ),
  availability as (
    select min(item.business_date) as first_daily_date, max(item.business_date) as last_daily_date, count(distinct item.business_date) as total_sales_days
    from daily item
  ),
  snapshot_availability as (
    select min(item.week_end) as first_week_end, max(item.week_end) as last_week_end, count(*) as total_report_weeks
    from approved_costs item
  )
  select jsonb_build_object(
    'siteId', target_site,
    'rangeDays', range_days,
    'metrics', metrics_json.value,
    'daily', daily_json.value,
    'availability', jsonb_build_object(
      'firstDailyDate', availability.first_daily_date,
      'lastDailyDate', availability.last_daily_date,
      'totalSalesDays', coalesce(availability.total_sales_days, 0),
      'firstWeekEnd', snapshot_availability.first_week_end,
      'lastWeekEnd', snapshot_availability.last_week_end,
      'totalReportWeeks', coalesce(snapshot_availability.total_report_weeks, 0)
    )
  ) into result
  from metrics_json, daily_json, availability, snapshot_availability;

  return result;
end;
$$;

revoke all on function public.get_reporting_comparison(uuid, date, date) from public, anon;
grant execute on function public.get_reporting_comparison(uuid, date, date) to authenticated;

commit;

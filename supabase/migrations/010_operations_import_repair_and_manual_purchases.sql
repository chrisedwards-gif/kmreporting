-- Repairs environments whose base schema predates the daily-metrics work:
-- migration 006 recreated the table and rollup helper but not the
-- import_operating_metrics endpoint, so POST /api/imports/operations still
-- failed there. This migration recreates the function everywhere.
--
-- It also fixes a data defect: applying a provider purchasing rollup used to
-- overwrite the week's purchases total, silently discarding structured manual
-- purchases (shop top-ups, emergency buys) recorded by save_weekly_report_v2.
-- Provider totals now have the audited manual purchase total added back, so a
-- webhook retry or nightly sync can no longer erase off-system spend.
--
-- Requires migrations 006 (daily_site_metrics + rollup) and 008
-- (report_manual_purchases) to have been applied first.

begin;

create or replace function public.import_operating_metrics(payload jsonb)
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
      has_sales = daily_site_metrics.has_sales or excluded.has_sales,
      has_purchasing = daily_site_metrics.has_purchasing or excluded.has_purchasing,
      has_waste = daily_site_metrics.has_waste or excluded.has_waste,
      gross_sales = case when excluded.has_sales then excluded.gross_sales else daily_site_metrics.gross_sales end,
      net_sales = case when excluded.has_sales then excluded.net_sales else daily_site_metrics.net_sales end,
      covers = case when excluded.has_sales then excluded.covers else daily_site_metrics.covers end,
      food_purchases = case when excluded.has_purchasing then excluded.food_purchases else daily_site_metrics.food_purchases end,
      credits = case when excluded.has_purchasing then excluded.credits else daily_site_metrics.credits end,
      waste_cost = case when excluded.has_waste then excluded.waste_cost else daily_site_metrics.waste_cost end,
      source_reference = coalesce(excluded.source_reference, daily_site_metrics.source_reference),
      imported_at = now();
  end loop;

  -- Approved and shared weeks are decision records: a late provider retry must
  -- not rewrite figures a manager has already signed off. The daily metrics are
  -- still stored above and will apply if the week returns to draft.
  for report_row in
    select r.id, p.week_start, p.week_end
    from public.weekly_reports r
    join public.reporting_periods p on p.id = r.period_id
    where r.site_id = target_site
      and r.status in ('draft', 'submitted', 'review_required')
      and exists (
        select 1 from jsonb_array_elements(payload->'metrics') metric
        where (metric->>'businessDate')::date between p.week_start and p.week_end
      )
  loop
    -- Provider totals lead, but audited manual purchases stay in the week's spend.
    with imported as (
      select * from app_private.rollup_daily_metrics(target_site, report_row.week_start, report_row.week_end)
    ), manual as (
      select coalesce(sum(mp.amount), 0) as total
      from public.report_manual_purchases mp
      where mp.report_id = report_row.id
    )
    update public.report_source_values values_row set
      net_sales = case when imported.has_sales then coalesce(imported.net_sales, 0) else values_row.net_sales end,
      purchases = case when imported.has_purchasing then coalesce(imported.purchases, 0) + manual.total else values_row.purchases end,
      credits = case when imported.has_purchasing then coalesce(imported.credits, 0) else values_row.credits end,
      waste_cost = case when imported.has_waste then coalesce(imported.waste_cost, 0) else values_row.waste_cost end,
      sales_source = case when imported.has_sales then 'provider_api' else values_row.sales_source end,
      purchasing_source = case when imported.has_purchasing then 'provider_api' else values_row.purchasing_source end,
      sales_source_reference = case when imported.has_sales then source_name else values_row.sales_source_reference end,
      purchasing_source_reference = case when imported.has_purchasing then source_name else values_row.purchasing_source_reference end,
      sales_confirmed = case when imported.has_sales then true else values_row.sales_confirmed end,
      purchasing_confirmed = case when imported.has_purchasing then true else values_row.purchasing_confirmed end,
      source_reference = source_name,
      updated_at = now()
    from imported, manual
    where values_row.report_id = report_row.id;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    organisation, null, 'operations.metrics_imported', 'site', target_site,
    jsonb_build_object('source_system', source_name, 'domains', domains, 'row_count', jsonb_array_length(coalesce(payload->'metrics', '[]'::jsonb)))
  );
end;
$$;

revoke all on function public.import_operating_metrics(jsonb) from public, anon, authenticated;
grant execute on function public.import_operating_metrics(jsonb) to service_role;

commit;

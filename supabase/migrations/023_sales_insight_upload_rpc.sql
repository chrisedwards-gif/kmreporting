-- Securely attach safe EPOS summaries to an editable weekly report.
-- This allows the detailed insight extractor to run after the headline weekly
-- report has been saved, without retaining the raw EPOS file.

begin;

create or replace function public.save_report_sales_insights(target_report uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  report_row public.weekly_reports%rowtype;
  period_row public.reporting_periods%rowtype;
  source_row public.report_source_values%rowtype;
  day_item jsonb;
  product_item jsonb;
  category_item jsonb;
  safe_name text;
  day_total numeric := 0;
  day_count integer := 0;
  product_count integer := 0;
  category_count integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into report_row from public.weekly_reports where id = target_report for update;
  if not found or not app_private.can_access_site(report_row.site_id) then raise exception 'report access denied'; end if;
  if report_row.status not in ('draft', 'submitted', 'review_required') then
    raise exception 'approved or shared reports cannot be changed';
  end if;
  select * into period_row from public.reporting_periods where id = report_row.period_id;
  select * into source_row from public.report_source_values where report_id = target_report;

  delete from public.report_sales_days where report_id = target_report;
  for day_item in select value from jsonb_array_elements(coalesce(payload->'days', '[]'::jsonb)) loop
    if (day_item->>'businessDate')::date < period_row.week_start or (day_item->>'businessDate')::date > period_row.week_end then
      raise exception 'sales day is outside the reporting week';
    end if;
    insert into public.report_sales_days (report_id, business_date, gross_sales, net_sales, transactions, covers)
    values (
      target_report,
      (day_item->>'businessDate')::date,
      greatest(coalesce((day_item->>'grossSales')::numeric, 0), 0),
      greatest(coalesce((day_item->>'netSales')::numeric, 0), 0),
      greatest(coalesce((day_item->>'transactions')::integer, 0), 0),
      greatest(coalesce((day_item->>'covers')::integer, 0), 0)
    )
    on conflict (report_id, business_date) do update set
      gross_sales = excluded.gross_sales,
      net_sales = excluded.net_sales,
      transactions = excluded.transactions,
      covers = excluded.covers,
      updated_at = now();
    day_total := day_total + greatest(coalesce((day_item->>'netSales')::numeric, 0), 0);
    day_count := day_count + 1;
  end loop;

  if day_count > 0 and source_row.net_sales > 0 and abs(day_total - source_row.net_sales) > greatest(5, source_row.net_sales * 0.02) then
    raise exception 'daily sales do not reconcile to the saved weekly net-sales total';
  end if;

  delete from public.report_sales_items where report_id = target_report;
  for product_item in select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
    safe_name := left(trim(coalesce(product_item->>'itemName', '')), 180);
    if safe_name = '' then continue; end if;
    insert into public.report_sales_items (report_id, item_name, category, quantity, net_sales)
    values (
      target_report,
      safe_name,
      left(coalesce(nullif(trim(product_item->>'category'), ''), 'Uncategorised'), 120),
      greatest(coalesce((product_item->>'quantity')::numeric, 0), 0),
      greatest(coalesce((product_item->>'netSales')::numeric, 0), 0)
    )
    on conflict (report_id, item_name, category) do update set
      quantity = excluded.quantity,
      net_sales = excluded.net_sales,
      updated_at = now();
    product_count := product_count + 1;
  end loop;

  delete from public.report_sales_categories where report_id = target_report;
  for category_item in select value from jsonb_array_elements(coalesce(payload->'categories', '[]'::jsonb)) loop
    safe_name := left(trim(coalesce(category_item->>'category', '')), 120);
    if safe_name = '' then continue; end if;
    insert into public.report_sales_categories (report_id, category, quantity, net_sales)
    values (
      target_report,
      safe_name,
      greatest(coalesce((category_item->>'quantity')::numeric, 0), 0),
      greatest(coalesce((category_item->>'netSales')::numeric, 0), 0)
    )
    on conflict (report_id, category) do update set
      quantity = excluded.quantity,
      net_sales = excluded.net_sales,
      updated_at = now();
    category_count := category_count + 1;
  end loop;

  if category_count = 0 then
    insert into public.report_sales_categories (report_id, category, quantity, net_sales)
    select target_report, item.category, sum(item.quantity), sum(item.net_sales)
    from public.report_sales_items item
    where item.report_id = target_report
    group by item.category
    having sum(item.quantity) > 0 or sum(item.net_sales) > 0;
    get diagnostics category_count = row_count;
  end if;

  with ranked as (
    select id, row_number() over (order by net_sales desc, quantity desc, item_name)::integer as position
    from public.report_sales_items where report_id = target_report
  ) update public.report_sales_items item set sales_rank = ranked.position from ranked where item.id = ranked.id;

  with ranked as (
    select id, row_number() over (order by net_sales desc, quantity desc, category)::integer as position
    from public.report_sales_categories where report_id = target_report
  ) update public.report_sales_categories category set sales_rank = ranked.position from ranked where category.id = ranked.id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    report_row.organisation_id,
    auth.uid(),
    'report.safe_sales_insights_imported',
    'weekly_report',
    target_report,
    jsonb_build_object('daily_rows', day_count, 'product_rows', product_count, 'category_rows', category_count)
  );
end;
$$;

revoke all on function public.save_report_sales_insights(uuid, jsonb) from public, anon;
grant execute on function public.save_report_sales_insights(uuid, jsonb) to authenticated;

commit;

-- A normal weekly-report edit does not include detailed EPOS payloads yet.
-- Preserve any previously imported sales insight unless the caller explicitly
-- supplies salesInsights for replacement.

begin;

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
      if (sales_day->>'businessDate')::date < period_row.week_start or (sales_day->>'businessDate')::date > period_row.week_end then
        raise exception 'sales day is outside the reporting week';
      end if;
      insert into public.report_sales_days (report_id, business_date, gross_sales, net_sales, transactions, covers)
      values (
        report,
        (sales_day->>'businessDate')::date,
        greatest(coalesce((sales_day->>'grossSales')::numeric, 0), 0),
        greatest(coalesce((sales_day->>'netSales')::numeric, 0), 0),
        greatest(coalesce((sales_day->>'transactions')::integer, 0), 0),
        greatest(coalesce((sales_day->>'covers')::integer, 0), 0)
      )
      on conflict (report_id, business_date) do update set
        gross_sales = excluded.gross_sales,
        net_sales = excluded.net_sales,
        transactions = excluded.transactions,
        covers = excluded.covers,
        updated_at = now();
      day_count := day_count + 1;
    end loop;

    delete from public.report_sales_items where report_id = report;
    for sales_item in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'items', '[]'::jsonb)) loop
      item_description := left(trim(coalesce(sales_item->>'itemName', '')), 180);
      if item_description = '' then continue; end if;
      insert into public.report_sales_items (report_id, item_name, category, quantity, net_sales)
      values (
        report,
        item_description,
        left(coalesce(nullif(trim(sales_item->>'category'), ''), 'Uncategorised'), 120),
        greatest(coalesce((sales_item->>'quantity')::numeric, 0), 0),
        greatest(coalesce((sales_item->>'netSales')::numeric, 0), 0)
      )
      on conflict (report_id, item_name, category) do update set
        quantity = excluded.quantity,
        net_sales = excluded.net_sales,
        updated_at = now();
      product_count := product_count + 1;
    end loop;

    delete from public.report_sales_categories where report_id = report;
    for sales_category in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'categories', '[]'::jsonb)) loop
      item_description := left(trim(coalesce(sales_category->>'category', '')), 120);
      if item_description = '' then continue; end if;
      insert into public.report_sales_categories (report_id, category, quantity, net_sales)
      values (
        report,
        item_description,
        greatest(coalesce((sales_category->>'quantity')::numeric, 0), 0),
        greatest(coalesce((sales_category->>'netSales')::numeric, 0), 0)
      )
      on conflict (report_id, category) do update set
        quantity = excluded.quantity,
        net_sales = excluded.net_sales,
        updated_at = now();
      category_count := category_count + 1;
    end loop;

    if category_count = 0 then
      insert into public.report_sales_categories (report_id, category, quantity, net_sales)
      select report, item.category, sum(item.quantity), sum(item.net_sales)
      from public.report_sales_items item
      where item.report_id = report
      group by item.category
      having sum(item.quantity) > 0 or sum(item.net_sales) > 0;
      get diagnostics category_count = row_count;
    end if;

    with ranked as (
      select id, row_number() over (order by net_sales desc, quantity desc, item_name)::integer as position
      from public.report_sales_items where report_id = report
    ) update public.report_sales_items item set sales_rank = ranked.position from ranked where item.id = ranked.id;

    with ranked as (
      select id, row_number() over (order by net_sales desc, quantity desc, category)::integer as position
      from public.report_sales_categories where report_id = report
    ) update public.report_sales_categories category set sales_rank = ranked.position from ranked where category.id = ranked.id;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    values (
      report_row.organisation_id,
      auth.uid(),
      'report.safe_sales_insights_saved',
      'weekly_report',
      report,
      jsonb_build_object('daily_rows', day_count, 'product_rows', product_count, 'category_rows', category_count)
    );
  end if;

  if item_count > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    values (
      report_row.organisation_id,
      auth.uid(),
      'report.manual_purchases_recorded',
      'weekly_report',
      report,
      jsonb_build_object('item_count', item_count, 'total', manual_total)
    );
  end if;

  return report;
end;
$$;

revoke all on function public.save_weekly_report_v2(jsonb) from public, anon;
grant execute on function public.save_weekly_report_v2(jsonb) to authenticated;

commit;

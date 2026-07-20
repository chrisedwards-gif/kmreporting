-- Production fixes batch 002: richer weekly sales insight.
--
-- Raw EPOS files remain in the browser/provider. The public schema stores only
-- safe daily totals and aggregated menu/category performance used by the report.

begin;

alter table public.daily_site_metrics
  add column if not exists transactions integer not null default 0 check (transactions >= 0);

create table if not exists public.daily_sales_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  source_system text not null,
  item_name text not null check (char_length(item_name) between 1 and 180),
  category text not null default 'Uncategorised' check (char_length(category) between 1 and 120),
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  source_reference text,
  imported_at timestamptz not null default now(),
  unique (site_id, business_date, source_system, item_name, category)
);

create table if not exists public.daily_sales_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  source_system text not null,
  category text not null check (char_length(category) between 1 and 120),
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  source_reference text,
  imported_at timestamptz not null default now(),
  unique (site_id, business_date, source_system, category)
);

create table if not exists public.report_sales_days (
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  business_date date not null,
  gross_sales numeric(14,2) not null default 0 check (gross_sales >= 0),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  transactions integer not null default 0 check (transactions >= 0),
  covers integer not null default 0 check (covers >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (report_id, business_date)
);

create table if not exists public.report_sales_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  item_name text not null check (char_length(item_name) between 1 and 180),
  category text not null default 'Uncategorised' check (char_length(category) between 1 and 120),
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  sales_rank integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, item_name, category)
);

create table if not exists public.report_sales_categories (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  category text not null check (char_length(category) between 1 and 120),
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  net_sales numeric(14,2) not null default 0 check (net_sales >= 0),
  sales_rank integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, category)
);

create index if not exists daily_sales_items_site_date_idx on public.daily_sales_items(site_id, business_date, source_system);
create index if not exists daily_sales_categories_site_date_idx on public.daily_sales_categories(site_id, business_date, source_system);
create index if not exists report_sales_items_rank_idx on public.report_sales_items(report_id, sales_rank, net_sales desc);
create index if not exists report_sales_categories_rank_idx on public.report_sales_categories(report_id, sales_rank, net_sales desc);

alter table public.daily_sales_items enable row level security;
alter table public.daily_sales_categories enable row level security;
alter table public.report_sales_days enable row level security;
alter table public.report_sales_items enable row level security;
alter table public.report_sales_categories enable row level security;

drop policy if exists report_sales_days_read on public.report_sales_days;
create policy report_sales_days_read on public.report_sales_days for select to authenticated using (
  exists (
    select 1 from public.weekly_reports report
    where report.id = report_sales_days.report_id
      and app_private.can_access_site(report.site_id)
  )
);

drop policy if exists report_sales_items_read on public.report_sales_items;
create policy report_sales_items_read on public.report_sales_items for select to authenticated using (
  exists (
    select 1 from public.weekly_reports report
    where report.id = report_sales_items.report_id
      and app_private.can_access_site(report.site_id)
  )
);

drop policy if exists report_sales_categories_read on public.report_sales_categories;
create policy report_sales_categories_read on public.report_sales_categories for select to authenticated using (
  exists (
    select 1 from public.weekly_reports report
    where report.id = report_sales_categories.report_id
      and app_private.can_access_site(report.site_id)
  )
);

grant select on public.report_sales_days, public.report_sales_items, public.report_sales_categories to authenticated;

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

  if day_count = 0 then
    insert into public.report_sales_days (report_id, business_date, gross_sales, net_sales, transactions, covers)
    select report, latest.business_date, latest.gross_sales, latest.net_sales, latest.transactions, latest.covers
    from (
      select distinct on (metrics.business_date)
        metrics.business_date, metrics.gross_sales, metrics.net_sales, metrics.transactions, metrics.covers
      from public.daily_site_metrics metrics
      where metrics.site_id = report_row.site_id
        and metrics.business_date between period_row.week_start and period_row.week_end
        and metrics.has_sales
      order by metrics.business_date, metrics.imported_at desc
    ) latest;
    get diagnostics day_count = row_count;
  end if;

  delete from public.report_sales_items where report_id = report;
  for sales_item in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'items', '[]'::jsonb)) loop
    item_description := left(trim(coalesce(sales_item->>'itemName', '')), 180);
    if length(item_description) = 0 then continue; end if;
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

  if product_count = 0 then
    insert into public.report_sales_items (report_id, item_name, category, quantity, net_sales)
    select
      report,
      item.item_name,
      item.category,
      sum(item.quantity),
      sum(item.net_sales)
    from public.daily_sales_items item
    where item.site_id = report_row.site_id
      and item.business_date between period_row.week_start and period_row.week_end
    group by item.item_name, item.category
    having sum(item.quantity) > 0 or sum(item.net_sales) > 0
    on conflict (report_id, item_name, category) do update set
      quantity = excluded.quantity,
      net_sales = excluded.net_sales,
      updated_at = now();
    get diagnostics product_count = row_count;
  end if;

  delete from public.report_sales_categories where report_id = report;
  for sales_category in select value from jsonb_array_elements(coalesce(payload->'salesInsights'->'categories', '[]'::jsonb)) loop
    item_description := left(trim(coalesce(sales_category->>'category', '')), 120);
    if length(item_description) = 0 then continue; end if;
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
    having sum(item.quantity) > 0 or sum(item.net_sales) > 0
    on conflict (report_id, category) do update set
      quantity = excluded.quantity,
      net_sales = excluded.net_sales,
      updated_at = now();
    get diagnostics category_count = row_count;
  end if;

  with ranked as (
    select id, row_number() over (order by net_sales desc, quantity desc, item_name)::integer as position
    from public.report_sales_items where report_id = report
  )
  update public.report_sales_items item set sales_rank = ranked.position
  from ranked where item.id = ranked.id;

  with ranked as (
    select id, row_number() over (order by net_sales desc, quantity desc, category)::integer as position
    from public.report_sales_categories where report_id = report
  )
  update public.report_sales_categories category set sales_rank = ranked.position
  from ranked where category.id = ranked.id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    report_row.organisation_id,
    auth.uid(),
    'report.safe_sales_insights_saved',
    'weekly_report',
    report,
    jsonb_build_object('daily_rows', day_count, 'product_rows', product_count, 'category_rows', category_count, 'manual_purchase_rows', item_count)
  );
  return report;
end;
$$;

revoke all on function public.save_weekly_report_v2(jsonb) from public, anon;
grant execute on function public.save_weekly_report_v2(jsonb) to authenticated;

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
  target_date date;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from public.sites where id = target_site and organisation_id = organisation) then raise exception 'site mismatch'; end if;

  for item in select value from jsonb_array_elements(coalesce(payload->'metrics', '[]'::jsonb)) loop
    insert into public.daily_site_metrics (
      organisation_id, site_id, business_date, source_system, has_sales, has_purchasing,
      has_waste, gross_sales, net_sales, transactions, covers, food_purchases, credits,
      waste_cost, source_reference, imported_at
    ) values (
      organisation, target_site, (item->>'businessDate')::date, source_name,
      domains ? 'sales', domains ? 'purchasing', domains ? 'waste',
      coalesce((item->>'grossSales')::numeric, 0), coalesce((item->>'netSales')::numeric, 0),
      coalesce((item->>'transactions')::integer, 0), coalesce((item->>'covers')::integer, 0),
      coalesce((item->>'foodPurchases')::numeric, 0), coalesce((item->>'credits')::numeric, 0),
      coalesce((item->>'wasteCost')::numeric, 0), item->>'sourceReference', now()
    ) on conflict (site_id, business_date, source_system) do update set
      has_sales = daily_site_metrics.has_sales or excluded.has_sales,
      has_purchasing = daily_site_metrics.has_purchasing or excluded.has_purchasing,
      has_waste = daily_site_metrics.has_waste or excluded.has_waste,
      gross_sales = case when excluded.has_sales then excluded.gross_sales else daily_site_metrics.gross_sales end,
      net_sales = case when excluded.has_sales then excluded.net_sales else daily_site_metrics.net_sales end,
      transactions = case when excluded.has_sales then excluded.transactions else daily_site_metrics.transactions end,
      covers = case when excluded.has_sales then excluded.covers else daily_site_metrics.covers end,
      food_purchases = case when excluded.has_purchasing then excluded.food_purchases else daily_site_metrics.food_purchases end,
      credits = case when excluded.has_purchasing then excluded.credits else daily_site_metrics.credits end,
      waste_cost = case when excluded.has_waste then excluded.waste_cost else daily_site_metrics.waste_cost end,
      source_reference = coalesce(excluded.source_reference, daily_site_metrics.source_reference),
      imported_at = now();
  end loop;

  if payload ? 'items' then
    for target_date in select distinct (metric->>'businessDate')::date from jsonb_array_elements(coalesce(payload->'metrics', '[]'::jsonb)) metric loop
      delete from public.daily_sales_items where site_id = target_site and business_date = target_date and source_system = source_name;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
      insert into public.daily_sales_items (
        organisation_id, site_id, business_date, source_system, item_name, category,
        quantity, net_sales, source_reference, imported_at
      ) values (
        organisation, target_site, (item->>'businessDate')::date, source_name,
        left(trim(item->>'itemName'), 180),
        left(coalesce(nullif(trim(item->>'category'), ''), 'Uncategorised'), 120),
        greatest(coalesce((item->>'quantity')::numeric, 0), 0),
        greatest(coalesce((item->>'netSales')::numeric, 0), 0),
        item->>'sourceReference', now()
      ) on conflict (site_id, business_date, source_system, item_name, category) do update set
        quantity = excluded.quantity,
        net_sales = excluded.net_sales,
        source_reference = coalesce(excluded.source_reference, daily_sales_items.source_reference),
        imported_at = now();
    end loop;
  end if;

  if payload ? 'categories' then
    for target_date in select distinct (metric->>'businessDate')::date from jsonb_array_elements(coalesce(payload->'metrics', '[]'::jsonb)) metric loop
      delete from public.daily_sales_categories where site_id = target_site and business_date = target_date and source_system = source_name;
    end loop;
    for item in select value from jsonb_array_elements(coalesce(payload->'categories', '[]'::jsonb)) loop
      insert into public.daily_sales_categories (
        organisation_id, site_id, business_date, source_system, category, quantity,
        net_sales, source_reference, imported_at
      ) values (
        organisation, target_site, (item->>'businessDate')::date, source_name,
        left(trim(item->>'category'), 120),
        greatest(coalesce((item->>'quantity')::numeric, 0), 0),
        greatest(coalesce((item->>'netSales')::numeric, 0), 0),
        item->>'sourceReference', now()
      ) on conflict (site_id, business_date, source_system, category) do update set
        quantity = excluded.quantity,
        net_sales = excluded.net_sales,
        source_reference = coalesce(excluded.source_reference, daily_sales_categories.source_reference),
        imported_at = now();
    end loop;
  end if;

  for report_row in
    select r.id, r.status, p.week_start, p.week_end
    from public.weekly_reports r
    join public.reporting_periods p on p.id = r.period_id
    where r.site_id = target_site
      and r.status in ('draft', 'submitted', 'review_required')
      and exists (
        select 1 from jsonb_array_elements(payload->'metrics') metric
        where (metric->>'businessDate')::date between p.week_start and p.week_end
      )
  loop
    with imported as (
      select * from app_private.rollup_daily_metrics(target_site, report_row.week_start, report_row.week_end)
    ), manual as (
      select coalesce(sum(mp.amount), 0) as total from public.report_manual_purchases mp where mp.report_id = report_row.id
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
    from imported, manual where values_row.report_id = report_row.id;

    if domains ? 'sales' then
      delete from public.report_sales_days where report_id = report_row.id;
      insert into public.report_sales_days (report_id, business_date, gross_sales, net_sales, transactions, covers)
      select report_row.id, latest.business_date, latest.gross_sales, latest.net_sales, latest.transactions, latest.covers
      from (
        select distinct on (metrics.business_date)
          metrics.business_date, metrics.gross_sales, metrics.net_sales, metrics.transactions, metrics.covers
        from public.daily_site_metrics metrics
        where metrics.site_id = target_site
          and metrics.business_date between report_row.week_start and report_row.week_end
          and metrics.has_sales
        order by metrics.business_date, metrics.imported_at desc
      ) latest;

      if payload ? 'items' then
        delete from public.report_sales_items where report_id = report_row.id;
        insert into public.report_sales_items (report_id, item_name, category, quantity, net_sales)
        select report_row.id, detail.item_name, detail.category, sum(detail.quantity), sum(detail.net_sales)
        from public.daily_sales_items detail
        where detail.site_id = target_site
          and detail.source_system = source_name
          and detail.business_date between report_row.week_start and report_row.week_end
        group by detail.item_name, detail.category;
      end if;

      delete from public.report_sales_categories where report_id = report_row.id;
      if payload ? 'categories' then
        insert into public.report_sales_categories (report_id, category, quantity, net_sales)
        select report_row.id, detail.category, sum(detail.quantity), sum(detail.net_sales)
        from public.daily_sales_categories detail
        where detail.site_id = target_site
          and detail.source_system = source_name
          and detail.business_date between report_row.week_start and report_row.week_end
        group by detail.category;
      else
        insert into public.report_sales_categories (report_id, category, quantity, net_sales)
        select report_row.id, item.category, sum(item.quantity), sum(item.net_sales)
        from public.report_sales_items item where item.report_id = report_row.id
        group by item.category;
      end if;

      with ranked as (
        select id, row_number() over (order by net_sales desc, quantity desc, item_name)::integer as position
        from public.report_sales_items where report_id = report_row.id
      ) update public.report_sales_items item set sales_rank = ranked.position from ranked where item.id = ranked.id;
      with ranked as (
        select id, row_number() over (order by net_sales desc, quantity desc, category)::integer as position
        from public.report_sales_categories where report_id = report_row.id
      ) update public.report_sales_categories category set sales_rank = ranked.position from ranked where category.id = ranked.id;
    end if;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    organisation, null, 'operations.metrics_imported', 'site', target_site,
    jsonb_build_object(
      'source_system', source_name,
      'domains', domains,
      'row_count', jsonb_array_length(coalesce(payload->'metrics', '[]'::jsonb)),
      'item_count', jsonb_array_length(coalesce(payload->'items', '[]'::jsonb)),
      'category_count', jsonb_array_length(coalesce(payload->'categories', '[]'::jsonb))
    )
  );
end;
$$;

revoke all on function public.import_operating_metrics(jsonb) from public, anon, authenticated;
grant execute on function public.import_operating_metrics(jsonb) to service_role;

-- Backfill immutable report snapshots from any provider daily metrics already held.
insert into public.report_sales_days (report_id, business_date, gross_sales, net_sales, transactions, covers)
select report.id, latest.business_date, latest.gross_sales, latest.net_sales, latest.transactions, latest.covers
from public.weekly_reports report
join public.reporting_periods period on period.id = report.period_id
join lateral (
  select distinct on (metrics.business_date)
    metrics.business_date, metrics.gross_sales, metrics.net_sales, metrics.transactions, metrics.covers
  from public.daily_site_metrics metrics
  where metrics.site_id = report.site_id
    and metrics.business_date between period.week_start and period.week_end
    and metrics.has_sales
  order by metrics.business_date, metrics.imported_at desc
) latest on true
on conflict (report_id, business_date) do nothing;

commit;

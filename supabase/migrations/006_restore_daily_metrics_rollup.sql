-- Repairs staging projects created without the original daily-metrics helper.
-- It returns only safe site/week aggregates; no employee or transaction detail.

begin;

create or replace function app_private.rollup_daily_metrics(target_site_id uuid, target_start date, target_end date)
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

commit;

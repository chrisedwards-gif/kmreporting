-- Repairs staging projects created without the original daily-metrics helper.
-- It returns only safe site/week aggregates; no employee or transaction detail.

begin;

create table if not exists public.daily_site_metrics (
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

create index if not exists daily_metrics_site_date_idx
  on public.daily_site_metrics (site_id, business_date);

alter table public.daily_site_metrics enable row level security;

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

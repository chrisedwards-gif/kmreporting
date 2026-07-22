-- Operations Intelligence learning observations
--
-- One aggregate record per site/day captures what the forecast knew, what a
-- manager decided, and what actually happened. No individual wage data is stored.

begin;

create table public.operations_intelligence_observations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  forecast_sales numeric(14,2) check (forecast_sales is null or forecast_sales >= 0),
  forecast_low numeric(14,2) check (forecast_low is null or forecast_low >= 0),
  forecast_high numeric(14,2) check (forecast_high is null or forecast_high >= 0),
  actual_sales numeric(14,2) check (actual_sales is null or actual_sales >= 0),
  planned_labour_hours numeric(10,2) check (planned_labour_hours is null or planned_labour_hours >= 0),
  actual_labour_hours numeric(10,2) check (actual_labour_hours is null or actual_labour_hours >= 0),
  planned_labour_cost numeric(14,2) check (planned_labour_cost is null or planned_labour_cost >= 0),
  actual_labour_cost numeric(14,2) check (actual_labour_cost is null or actual_labour_cost >= 0),
  weather jsonb not null default '{}'::jsonb,
  nearby_events jsonb not null default '[]'::jsonb,
  manager_adjustments jsonb not null default '[]'::jsonb,
  staffing_feedback jsonb not null default '{}'::jsonb,
  forecast_model_version text not null default 'rota-v1' check (length(forecast_model_version) between 2 and 80),
  review_model text,
  evidence_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, business_date)
);

create index operations_intelligence_observations_site_date_idx
  on public.operations_intelligence_observations(site_id, business_date desc);
create index operations_intelligence_observations_organisation_idx
  on public.operations_intelligence_observations(organisation_id, business_date desc);

alter table public.operations_intelligence_observations enable row level security;

grant select on public.operations_intelligence_observations to authenticated;
grant select, insert, update, delete on public.operations_intelligence_observations to service_role;

create policy operations_intelligence_observations_read
on public.operations_intelligence_observations
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

create or replace function public.upsert_operations_intelligence_observation(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  organisation uuid := (payload->>'organisationId')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  target_date date := (payload->>'businessDate')::date;
  observation_id uuid;
begin
  if not exists (
    select 1 from public.sites
    where id = target_site and organisation_id = organisation
  ) then
    raise exception 'site mismatch';
  end if;

  insert into public.operations_intelligence_observations (
    organisation_id, site_id, business_date,
    forecast_sales, forecast_low, forecast_high, actual_sales,
    planned_labour_hours, actual_labour_hours,
    planned_labour_cost, actual_labour_cost,
    weather, nearby_events, manager_adjustments, staffing_feedback,
    forecast_model_version, review_model, evidence_complete, updated_at
  ) values (
    organisation, target_site, target_date,
    nullif(payload->>'forecastSales', '')::numeric,
    nullif(payload->>'forecastLow', '')::numeric,
    nullif(payload->>'forecastHigh', '')::numeric,
    nullif(payload->>'actualSales', '')::numeric,
    nullif(payload->>'plannedLabourHours', '')::numeric,
    nullif(payload->>'actualLabourHours', '')::numeric,
    nullif(payload->>'plannedLabourCost', '')::numeric,
    nullif(payload->>'actualLabourCost', '')::numeric,
    coalesce(payload->'weather', '{}'::jsonb),
    coalesce(payload->'nearbyEvents', '[]'::jsonb),
    coalesce(payload->'managerAdjustments', '[]'::jsonb),
    coalesce(payload->'staffingFeedback', '{}'::jsonb),
    left(coalesce(payload->>'forecastModelVersion', 'rota-v1'), 80),
    nullif(left(coalesce(payload->>'reviewModel', ''), 120), ''),
    coalesce((payload->>'evidenceComplete')::boolean, false),
    now()
  )
  on conflict (site_id, business_date) do update set
    forecast_sales = coalesce(excluded.forecast_sales, operations_intelligence_observations.forecast_sales),
    forecast_low = coalesce(excluded.forecast_low, operations_intelligence_observations.forecast_low),
    forecast_high = coalesce(excluded.forecast_high, operations_intelligence_observations.forecast_high),
    actual_sales = coalesce(excluded.actual_sales, operations_intelligence_observations.actual_sales),
    planned_labour_hours = coalesce(excluded.planned_labour_hours, operations_intelligence_observations.planned_labour_hours),
    actual_labour_hours = coalesce(excluded.actual_labour_hours, operations_intelligence_observations.actual_labour_hours),
    planned_labour_cost = coalesce(excluded.planned_labour_cost, operations_intelligence_observations.planned_labour_cost),
    actual_labour_cost = coalesce(excluded.actual_labour_cost, operations_intelligence_observations.actual_labour_cost),
    weather = case when excluded.weather = '{}'::jsonb then operations_intelligence_observations.weather else excluded.weather end,
    nearby_events = case when excluded.nearby_events = '[]'::jsonb then operations_intelligence_observations.nearby_events else excluded.nearby_events end,
    manager_adjustments = case when excluded.manager_adjustments = '[]'::jsonb then operations_intelligence_observations.manager_adjustments else excluded.manager_adjustments end,
    staffing_feedback = case when excluded.staffing_feedback = '{}'::jsonb then operations_intelligence_observations.staffing_feedback else excluded.staffing_feedback end,
    forecast_model_version = excluded.forecast_model_version,
    review_model = coalesce(excluded.review_model, operations_intelligence_observations.review_model),
    evidence_complete = excluded.evidence_complete,
    updated_at = now()
  returning id into observation_id;

  return observation_id;
end;
$$;

revoke all on function public.upsert_operations_intelligence_observation(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_operations_intelligence_observation(jsonb) to service_role;

commit;

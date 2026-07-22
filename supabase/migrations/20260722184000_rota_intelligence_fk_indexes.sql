-- Cover rota-intelligence foreign keys used by cascades, audit lookups and
-- organisation-scoped maintenance. Kept separate because staging linted the
-- main migration before this follow-up was generated.

begin;

create index rota_site_settings_updated_by_idx on public.rota_site_settings(updated_by) where updated_by is not null;
create index rota_day_rules_organisation_idx on public.rota_day_rules(organisation_id);
create index rota_demand_templates_organisation_idx on public.rota_demand_templates(organisation_id);
create index hourly_sales_metrics_organisation_idx on public.hourly_sales_metrics(organisation_id);
create index rota_forecast_events_organisation_idx on public.rota_forecast_events(organisation_id);
create index rota_forecast_events_created_by_idx on public.rota_forecast_events(created_by) where created_by is not null;
create index rota_plans_organisation_idx on public.rota_plans(organisation_id);
create index rota_plans_generated_by_idx on public.rota_plans(generated_by) where generated_by is not null;
create index rota_plan_days_organisation_idx on public.rota_plan_days(organisation_id);
create index rota_plan_shifts_organisation_idx on public.rota_plan_shifts(organisation_id);
create index rota_plan_shifts_day_idx on public.rota_plan_shifts(plan_day_id);
create index rota_plan_shifts_site_idx on public.rota_plan_shifts(site_id);
create index rota_staff_memberships_organisation_idx on payroll_private.rota_staff_site_memberships(organisation_id);

commit;

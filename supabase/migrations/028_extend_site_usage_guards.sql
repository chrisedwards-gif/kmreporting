-- Extend the safe site-deletion guard for the new waste and salary records.

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
      + (select count(*) from public.waste_log_entries item where item.site_id = site.id)
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
      + (select count(*) from payroll_private.salary_allocations item where item.site_id = site.id)
    ) as payroll_records,
    (
      (select count(*) from public.weekly_reports item where item.site_id = site.id)
      + (select count(*) from public.daily_site_metrics item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_items item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_categories item where item.site_id = site.id)
      + (select count(*) from public.waste_log_entries item where item.site_id = site.id)
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
      + (select count(*) from payroll_private.salary_allocations item where item.site_id = site.id)
    ) as total_dependencies
  from public.sites site
  where site.organisation_id = app_private.current_organisation_id()
    and app_private.current_app_role() = 'admin'
  order by site.name;
$$;

revoke all on function public.get_site_usage_summary() from public, anon;
grant execute on function public.get_site_usage_summary() to authenticated;

commit;

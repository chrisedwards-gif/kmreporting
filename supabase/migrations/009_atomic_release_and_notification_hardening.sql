-- Make a complete management-summary release one atomic database operation.
-- Either every expected approved report is marked shared, or none are changed.

begin;

create index if not exists notification_log_org_created_idx
  on public.notification_log (organisation_id, created_at desc);

create or replace function public.release_management_summary(target_period uuid)
returns integer
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  period_row public.reporting_periods%rowtype;
  expected_count integer := 0;
  changed_count integer := 0;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'sharing access denied';
  end if;

  select * into period_row
  from public.reporting_periods
  where id = target_period
    and organisation_id = app_private.current_organisation_id();

  if not found then raise exception 'reporting period not found'; end if;

  select count(*) into expected_count
  from public.sites site
  where site.organisation_id = period_row.organisation_id
    and site.reporting_start_date <= period_row.week_end
    and (site.reporting_end_date is null or site.reporting_end_date >= period_row.week_start);

  if expected_count = 0 then raise exception 'no kitchens are expected for this period'; end if;

  if exists (
    select 1
    from public.sites site
    where site.organisation_id = period_row.organisation_id
      and site.reporting_start_date <= period_row.week_end
      and (site.reporting_end_date is null or site.reporting_end_date >= period_row.week_start)
      and not exists (
        select 1
        from public.weekly_reports report
        where report.period_id = target_period
          and report.site_id = site.id
          and report.status in ('approved', 'shared')
      )
  ) then
    raise exception 'every required kitchen must be approved before group release';
  end if;

  with changed as (
    update public.weekly_reports report
    set status = 'shared', shared_at = now(), updated_at = now()
    where report.organisation_id = period_row.organisation_id
      and report.period_id = target_period
      and report.status = 'approved'
      and exists (
        select 1
        from public.sites site
        where site.id = report.site_id
          and site.reporting_start_date <= period_row.week_end
          and (site.reporting_end_date is null or site.reporting_end_date >= period_row.week_start)
      )
    returning report.id, report.organisation_id
  ), logged as (
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    select organisation_id, auth.uid(), 'report.shared', 'weekly_report', id,
      jsonb_build_object('channel', 'management_summary')
    from changed
    returning 1
  )
  select count(*) into changed_count from changed;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  select
    period_row.organisation_id,
    auth.uid(),
    'summary.released',
    'reporting_period',
    target_period,
    jsonb_build_object('channel', 'management_summary', 'expected_reports', expected_count, 'newly_shared_reports', changed_count)
  where not exists (
    select 1 from public.audit_log
    where organisation_id = period_row.organisation_id
      and action = 'summary.released'
      and entity_type = 'reporting_period'
      and entity_id = target_period
  );

  return changed_count;
end;
$$;

revoke all on function public.release_management_summary(uuid) from public, anon;
grant execute on function public.release_management_summary(uuid) to authenticated;

commit;

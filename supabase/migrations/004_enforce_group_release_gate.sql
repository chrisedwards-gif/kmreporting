-- Sharing a single approved report must not bypass the complete group gate.
-- The group release action can call this once for each approved report only
-- after every expected kitchen for the period is present and approved.

create or replace function public.mark_report_shared(target_report uuid, channel text)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  report_row public.weekly_reports%rowtype;
  period_row public.reporting_periods%rowtype;
  expected_count integer;
  ready_count integer;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then raise exception 'sharing access denied'; end if;
  select * into report_row from public.weekly_reports where id = target_report and organisation_id = app_private.current_organisation_id();
  if not found or report_row.status <> 'approved' then raise exception 'only approved reports can be shared'; end if;
  select * into period_row from public.reporting_periods where id = report_row.period_id;

  select count(*) into expected_count
  from public.sites site
  where site.organisation_id = report_row.organisation_id
    and site.reporting_start_date <= period_row.week_end
    and (site.reporting_end_date is null or site.reporting_end_date >= period_row.week_start);

  select count(*) into ready_count
  from public.weekly_reports report
  where report.organisation_id = report_row.organisation_id
    and report.period_id = report_row.period_id
    and report.status in ('approved', 'shared');

  if expected_count = 0 or ready_count <> expected_count then
    raise exception 'every required kitchen must be approved before group release';
  end if;

  update public.weekly_reports set status = 'shared', shared_at = now(), updated_at = now() where id = target_report;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (report_row.organisation_id, auth.uid(), 'report.shared', 'weekly_report', target_report, jsonb_build_object('channel', channel));
end;
$$;

revoke all on function public.mark_report_shared(uuid, text) from public, anon;
grant execute on function public.mark_report_shared(uuid, text) to authenticated;

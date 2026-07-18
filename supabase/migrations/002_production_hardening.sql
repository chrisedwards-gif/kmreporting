-- Production hardening discovered during the pre-launch workflow review.
-- Prevent a privileged user from approving a report that is still a draft or
-- re-approving a report after it has already been shared.

alter table public.sites add column if not exists reporting_start_date date;
alter table public.sites add column if not exists reporting_end_date date;

update public.sites site
set reporting_start_date = coalesce(
  site.reporting_start_date,
  (select min(period.week_start) from public.reporting_periods period where period.organisation_id = site.organisation_id),
  current_date
);

alter table public.sites alter column reporting_start_date set default current_date;
alter table public.sites alter column reporting_start_date set not null;

alter table public.sites drop constraint if exists site_reporting_dates_valid;
alter table public.sites add constraint site_reporting_dates_valid
check (reporting_end_date is null or reporting_end_date >= reporting_start_date);

create or replace function public.decide_report(target_report uuid, target_decision public.approval_decision, decision_notes text default '')
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare report_row public.weekly_reports%rowtype;
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then raise exception 'approval access denied'; end if;
  select * into report_row from public.weekly_reports where id = target_report and organisation_id = app_private.current_organisation_id();
  if not found then raise exception 'report not found'; end if;
  if report_row.status not in ('submitted', 'review_required') then raise exception 'only submitted reports can receive a decision'; end if;
  if target_decision = 'approved' and exists (
    select 1 from jsonb_array_elements(coalesce((select review_flags from public.site_cost_snapshots where report_id = target_report), '[]'::jsonb)) f
    where not exists (select 1 from public.report_review_resolutions rr where rr.report_id = target_report and rr.flag_code = f->>'code')
  ) then raise exception 'all review flags must be resolved before approval'; end if;

  insert into public.report_approvals (report_id, decision, notes, decided_by) values (target_report, target_decision, coalesce(decision_notes,''), auth.uid());
  update public.weekly_reports set
    status = case when target_decision = 'approved' then 'approved'::public.report_status else 'draft'::public.report_status end,
    approved_at = case when target_decision = 'approved' then now() else null end,
    updated_at = now()
  where id = target_report;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (report_row.organisation_id, auth.uid(), 'report.' || target_decision::text, 'weekly_report', target_report, jsonb_build_object('notes', coalesce(decision_notes,'')));
end;
$$;

revoke all on function public.decide_report(uuid, public.approval_decision, text) from public, anon;
grant execute on function public.decide_report(uuid, public.approval_decision, text) to authenticated;

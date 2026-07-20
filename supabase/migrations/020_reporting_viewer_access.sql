-- Production fixes batch 001: give the existing viewer role a deliberately
-- read-only group reporting surface without making it elevated or writable.
-- app_private.can_access_site remains the write/operational gate.

begin;

create or replace function app_private.can_read_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    exists (
      select 1
      from public.sites s
      where s.id = target_site_id
        and s.organisation_id = app_private.current_organisation_id()
        and (
          app_private.current_app_role() = 'viewer'
          or app_private.can_access_site(s.id)
        )
    ),
    false
  )
$$;

revoke all on function app_private.can_read_site(uuid) from public, anon;
grant execute on function app_private.can_read_site(uuid) to authenticated;

-- Viewer can read names used in submitted reports, but remains unable to edit
-- profiles or access Auth administration.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (
    organisation_id = app_private.current_organisation_id()
    and (app_private.is_elevated() or app_private.current_app_role() = 'viewer')
  )
);

drop policy if exists sites_read on public.sites;
create policy sites_read on public.sites for select to authenticated
using (app_private.can_read_site(id));

drop policy if exists reports_read on public.weekly_reports;
create policy reports_read on public.weekly_reports for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_read_site(site_id)
);

drop policy if exists source_values_read on public.report_source_values;
create policy source_values_read on public.report_source_values for select to authenticated
using (
  exists (
    select 1 from public.weekly_reports r
    where r.id = report_id and app_private.can_read_site(r.site_id)
  )
);

drop policy if exists daily_metrics_read on public.daily_site_metrics;
create policy daily_metrics_read on public.daily_site_metrics for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_read_site(site_id)
);

drop policy if exists snapshots_read on public.site_cost_snapshots;
create policy snapshots_read on public.site_cost_snapshots for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.can_read_site(site_id)
);

drop policy if exists resolutions_read on public.report_review_resolutions;
create policy resolutions_read on public.report_review_resolutions for select to authenticated
using (
  exists (
    select 1 from public.weekly_reports r
    where r.id = report_id and app_private.can_read_site(r.site_id)
  )
);

drop policy if exists approvals_read on public.report_approvals;
create policy approvals_read on public.report_approvals for select to authenticated
using (
  exists (
    select 1 from public.weekly_reports r
    where r.id = report_id and app_private.can_read_site(r.site_id)
  )
);

drop policy if exists manual_purchases_read on public.report_manual_purchases;
create policy manual_purchases_read on public.report_manual_purchases for select to authenticated
using (
  exists (
    select 1 from public.weekly_reports report
    where report.id = report_id and app_private.can_read_site(report.site_id)
  )
);

insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
select id, null, 'security.reporting_viewer_read_model_installed', 'organisation', id,
  jsonb_build_object('role', 'viewer', 'write_access', false)
from public.organisations
where not exists (
  select 1 from public.audit_log log
  where log.organisation_id = organisations.id
    and log.action = 'security.reporting_viewer_read_model_installed'
);

commit;

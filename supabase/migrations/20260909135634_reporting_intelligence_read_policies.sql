create policy weekly_upload_batches_read on public.weekly_upload_batches
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (site_id is null and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role))
    or (site_id is not null and app_private.can_read_site(site_id))
  )
);

create policy weekly_upload_files_read on public.weekly_upload_files
for select to authenticated
using (
  exists (
    select 1
    from public.weekly_upload_batches batch
    where batch.id = weekly_upload_files.batch_id
      and batch.organisation_id = (select app_private.current_organisation_id())
      and (
        (batch.site_id is null and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role))
        or (batch.site_id is not null and app_private.can_read_site(batch.site_id))
      )
  )
);

create policy weekly_master_metrics_read on public.weekly_master_metrics
for select to authenticated
using (app_private.can_read_site(site_id));

create policy weekly_reconciliations_read on public.weekly_reconciliations
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

create policy weekly_ai_insights_read on public.weekly_ai_insights
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (site_id is null and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role))
    or (site_id is not null and app_private.can_read_site(site_id))
  )
);

create policy weekly_decision_signals_read on public.weekly_decision_signals
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (site_id is null and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role))
    or (site_id is not null and app_private.can_read_site(site_id))
  )
);

create policy hourly_labour_metrics_read on public.hourly_labour_metrics
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

create policy menu_item_costs_read on public.menu_item_costs
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

drop policy if exists weekly_master_metrics_read on public.weekly_master_metrics;
drop policy if exists weekly_reconciliations_read on public.weekly_reconciliations;
drop policy if exists weekly_ai_insights_read on public.weekly_ai_insights;
drop policy if exists weekly_decision_signals_read on public.weekly_decision_signals;
drop policy if exists hourly_labour_metrics_read on public.hourly_labour_metrics;
drop policy if exists menu_item_costs_read on public.menu_item_costs;

create policy weekly_master_metrics_read on public.weekly_master_metrics
for select to authenticated
using (
  (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
  and exists (
    select 1
    from public.weekly_upload_batches batch
    where batch.id = weekly_master_metrics.batch_id
      and batch.organisation_id = (select app_private.current_organisation_id())
  )
);

create policy weekly_reconciliations_read on public.weekly_reconciliations
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
);

create policy weekly_ai_insights_read on public.weekly_ai_insights
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
);

create policy weekly_decision_signals_read on public.weekly_decision_signals
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
);

create policy hourly_labour_metrics_read on public.hourly_labour_metrics
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
);

create policy menu_item_costs_read on public.menu_item_costs
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
);

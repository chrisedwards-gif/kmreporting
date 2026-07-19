-- Production launch hardening.
--
-- Keep the legacy managers table closed, avoid duplicate permissive policies,
-- cache auth lookups inside the busiest RLS policies, and add covering indexes
-- for the foreign keys used by operational history and audit screens.

begin;

revoke all on table public.managers from public, anon, authenticated;

-- Replace ALL policies that also participated in SELECT with action-specific
-- policies. Read access remains controlled by sites_read / memberships_read.
drop policy if exists sites_manage on public.sites;
create policy sites_insert on public.sites
for insert to authenticated
with check (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) = 'admin'
);
create policy sites_update on public.sites
for update to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) = 'admin'
)
with check (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) = 'admin'
);
create policy sites_delete on public.sites
for delete to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) = 'admin'
);

drop policy if exists memberships_manage on public.site_memberships;
create policy memberships_insert on public.site_memberships
for insert to authenticated
with check (
  (select app_private.current_app_role()) = 'admin'
  and app_private.can_access_site(site_id)
);
create policy memberships_update on public.site_memberships
for update to authenticated
using (
  (select app_private.current_app_role()) = 'admin'
  and app_private.can_access_site(site_id)
)
with check (
  (select app_private.current_app_role()) = 'admin'
  and app_private.can_access_site(site_id)
);
create policy memberships_delete on public.site_memberships
for delete to authenticated
using (
  (select app_private.current_app_role()) = 'admin'
  and app_private.can_access_site(site_id)
);

-- Cache auth.uid() once per statement rather than evaluating it for every row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (
    organisation_id = (select app_private.current_organisation_id())
    and (select app_private.is_elevated())
  )
);

drop policy if exists memberships_read on public.site_memberships;
create policy memberships_read on public.site_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select app_private.is_elevated())
);

drop policy if exists reports_update on public.weekly_reports;
create policy reports_update on public.weekly_reports
for update to authenticated
using (
  app_private.can_access_site(site_id)
  and (manager_id = (select auth.uid()) or (select app_private.is_elevated()))
)
with check (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_access_site(site_id)
);

drop policy if exists notifications_read on public.notification_log;
create policy notifications_read on public.notification_log
for select to authenticated
using (
  recipient_id = (select auth.uid())
  or (
    organisation_id = (select app_private.current_organisation_id())
    and (select app_private.is_elevated())
  )
);

drop policy if exists one_to_one_reviews_read on public.one_to_one_reviews;
create policy one_to_one_reviews_read on public.one_to_one_reviews
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or manager_profile_id = (select auth.uid())
  )
);

drop policy if exists manager_details_read on public.manager_details;
create policy manager_details_read on public.manager_details
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or profile_id = (select auth.uid())
  )
);

drop policy if exists manager_actions_read on public.manager_actions;
create policy manager_actions_read on public.manager_actions
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or manager_profile_id = (select auth.uid())
  )
);

drop policy if exists site_manager_assignments_read on public.site_manager_assignments;
create policy site_manager_assignments_read on public.site_manager_assignments
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or manager_profile_id = (select auth.uid())
  )
);

drop policy if exists product_development_items_read on public.product_development_items;
create policy product_development_items_read on public.product_development_items
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or owner_profile_id = (select auth.uid())
    or exists (
      select 1 from public.site_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.site_id = product_development_items.site_id
    )
  )
);

-- Cover operational foreign keys and common history filters.
create index if not exists profiles_organisation_idx on public.profiles(organisation_id);
create index if not exists weekly_reports_period_idx on public.weekly_reports(period_id);
create index if not exists weekly_reports_manager_idx on public.weekly_reports(manager_id);
create index if not exists audit_log_org_time_idx on public.audit_log(organisation_id, occurred_at desc);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id) where actor_id is not null;
create index if not exists daily_site_metrics_org_idx on public.daily_site_metrics(organisation_id);
create index if not exists report_source_values_confirmed_by_idx on public.report_source_values(confirmed_by) where confirmed_by is not null;
create index if not exists report_approvals_report_idx on public.report_approvals(report_id);
create index if not exists report_approvals_decided_by_idx on public.report_approvals(decided_by);
create index if not exists report_review_resolutions_resolved_by_idx on public.report_review_resolutions(resolved_by);
create index if not exists report_manual_purchases_added_by_idx on public.report_manual_purchases(added_by);
create index if not exists site_cost_snapshots_site_period_idx on public.site_cost_snapshots(site_id, period_id);
create index if not exists notification_log_recipient_time_idx on public.notification_log(recipient_id, created_at desc);
create index if not exists notification_log_report_idx on public.notification_log(report_id) where report_id is not null;
create index if not exists notification_log_site_idx on public.notification_log(site_id) where site_id is not null;
create index if not exists manager_details_org_idx on public.manager_details(organisation_id);
create index if not exists site_manager_assignments_org_idx on public.site_manager_assignments(organisation_id);
create index if not exists site_manager_assignments_assigned_by_idx on public.site_manager_assignments(assigned_by) where assigned_by is not null;
create index if not exists one_to_one_reviews_org_idx on public.one_to_one_reviews(organisation_id);
create index if not exists one_to_one_reviews_site_idx on public.one_to_one_reviews(site_id) where site_id is not null;
create index if not exists one_to_one_reviews_reviewer_idx on public.one_to_one_reviews(reviewer_id) where reviewer_id is not null;
create index if not exists one_to_one_reviews_finalised_by_idx on public.one_to_one_reviews(finalised_by) where finalised_by is not null;
create index if not exists one_to_one_reviews_acknowledged_by_idx on public.one_to_one_reviews(acknowledged_by) where acknowledged_by is not null;
create index if not exists one_to_one_action_links_action_idx on public.one_to_one_action_links(action_id);
create index if not exists manager_actions_org_idx on public.manager_actions(organisation_id);
create index if not exists manager_actions_site_idx on public.manager_actions(site_id) where site_id is not null;
create index if not exists manager_actions_assignment_idx on public.manager_actions(assignment_id) where assignment_id is not null;
create index if not exists manager_actions_source_review_idx on public.manager_actions(source_review_id) where source_review_id is not null;
create index if not exists manager_actions_carried_from_idx on public.manager_actions(carried_from) where carried_from is not null;
create index if not exists manager_actions_source_check_response_idx on public.manager_actions(source_check_response_id) where source_check_response_id is not null;
create index if not exists kitchen_check_templates_org_idx on public.kitchen_check_templates(organisation_id);
create index if not exists kitchen_check_templates_created_by_idx on public.kitchen_check_templates(created_by) where created_by is not null;
create index if not exists kitchen_check_items_section_idx on public.kitchen_check_items(section_id);
create index if not exists kitchen_check_runs_started_by_idx on public.kitchen_check_runs(started_by) where started_by is not null;
create index if not exists kitchen_check_runs_completed_by_idx on public.kitchen_check_runs(completed_by) where completed_by is not null;
create index if not exists kitchen_check_runs_reviewed_by_idx on public.kitchen_check_runs(reviewed_by) where reviewed_by is not null;
create index if not exists kitchen_check_responses_item_idx on public.kitchen_check_responses(item_id);
create index if not exists kitchen_check_responses_owner_idx on public.kitchen_check_responses(action_owner_profile_id) where action_owner_profile_id is not null;
create index if not exists kitchen_check_responses_action_idx on public.kitchen_check_responses(manager_action_id) where manager_action_id is not null;
create index if not exists kitchen_check_responses_updated_by_idx on public.kitchen_check_responses(updated_by) where updated_by is not null;
create index if not exists product_development_events_org_idx on public.product_development_events(organisation_id);
create index if not exists product_development_events_actor_idx on public.product_development_events(actor_id) where actor_id is not null;
create index if not exists product_development_items_created_by_idx on public.product_development_items(created_by) where created_by is not null;
create index if not exists product_development_items_updated_by_idx on public.product_development_items(updated_by) where updated_by is not null;
create index if not exists sop_versions_org_idx on public.sop_versions(organisation_id);
create index if not exists sop_versions_site_idx on public.sop_versions(site_id);
create index if not exists sop_versions_created_by_idx on public.sop_versions(created_by) where created_by is not null;
create index if not exists sops_created_by_idx on public.sops(created_by) where created_by is not null;
create index if not exists sops_updated_by_idx on public.sops(updated_by) where updated_by is not null;
create index if not exists training_records_signed_off_by_idx on public.training_records(signed_off_by) where signed_off_by is not null;
create index if not exists training_records_created_by_idx on public.training_records(created_by) where created_by is not null;
create index if not exists training_records_updated_by_idx on public.training_records(updated_by) where updated_by is not null;
create index if not exists time_entries_org_idx on payroll_private.time_entries(organisation_id);
create index if not exists time_entries_period_only_idx on payroll_private.time_entries(period_id);

commit;

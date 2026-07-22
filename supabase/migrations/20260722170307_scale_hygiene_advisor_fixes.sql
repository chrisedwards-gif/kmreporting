-- Production fixes 015: cache request-scoped identity values once per query
-- in the policies highlighted by the Supabase performance advisor, and merge
-- the overlapping management-email policies.

begin;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (
    organisation_id = (select app_private.current_organisation_id())
    and (
      (select app_private.is_elevated())
      or (select app_private.current_app_role()) = 'viewer'::public.app_role
    )
  )
);

drop policy if exists manager_messages_read on public.manager_messages;
create policy manager_messages_read on public.manager_messages
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin', 'group_manager')
    or (
      active
      and visible_from <= current_date
      and (visible_until is null or visible_until >= current_date)
      and (
        recipient_profile_id = (select auth.uid())
        or (recipient_profile_id is null and site_id is null)
        or (
          recipient_profile_id is null
          and exists (
            select 1
            from public.site_memberships membership
            where membership.user_id = (select auth.uid())
              and membership.site_id = manager_messages.site_id
          )
        )
      )
    )
  )
);

drop policy if exists teamup_calendar_links_read on public.teamup_calendar_links;
create policy teamup_calendar_links_read on public.teamup_calendar_links
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and active
  and (
    (select app_private.current_app_role()) in ('admin', 'group_manager')
    or site_id is null
    or exists (
      select 1
      from public.site_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.site_id = teamup_calendar_links.site_id
    )
  )
);

drop policy if exists waste_log_insert on public.waste_log_entries;
create policy waste_log_insert on public.waste_log_entries
for insert to authenticated
with check (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_access_site(site_id)
  and report_id is null
  and logged_by = (select auth.uid())
);

drop policy if exists evidence_files_read on public.evidence_files;
create policy evidence_files_read on public.evidence_files
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin', 'group_manager')
    or (
      (select app_private.current_app_role()) = 'kitchen_manager'
      and site_id is not null
      and exists (
        select 1
        from public.site_memberships membership
        where membership.user_id = (select auth.uid())
          and membership.site_id = evidence_files.site_id
      )
    )
  )
);

drop policy if exists management_email_settings_read on public.management_email_settings;
drop policy if exists management_email_settings_write on public.management_email_settings;
create policy management_email_settings_access on public.management_email_settings
for all to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin', 'group_manager')
)
with check (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin', 'group_manager')
);

commit;

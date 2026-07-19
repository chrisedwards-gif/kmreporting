-- Production fixes batch 002: Kitchen Manager operating home.
--
-- Adds scheduled management messages and safe Teamup calendar links. Existing
-- site_memberships remain the source of truth for one manager working across
-- multiple kitchens; no new identity or duplicate-manager model is introduced.

begin;

create table if not exists public.manager_messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  body text not null check (char_length(body) between 2 and 4000),
  priority text not null default 'info' check (priority in ('info','important','urgent')),
  visible_from timestamptz not null default now(),
  visible_until timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_message_window_valid check (visible_until is null or visible_until > visible_from)
);

create index if not exists manager_messages_visibility_idx
  on public.manager_messages(organisation_id, active, visible_from, visible_until);
create index if not exists manager_messages_site_idx
  on public.manager_messages(site_id, visible_from desc) where site_id is not null;
create index if not exists manager_messages_recipient_idx
  on public.manager_messages(recipient_profile_id, visible_from desc) where recipient_profile_id is not null;

create table if not exists public.teamup_calendar_links (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  calendar_url text not null check (calendar_url ~* '^https://([a-z0-9-]+\.)?teamup\.com/'),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists teamup_calendar_links_scope_idx
  on public.teamup_calendar_links(organisation_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.manager_messages enable row level security;
alter table public.teamup_calendar_links enable row level security;

drop policy if exists manager_messages_read on public.manager_messages;
create policy manager_messages_read on public.manager_messages
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and (
    app_private.current_app_role() in ('admin','group_manager')
    or recipient_profile_id = auth.uid()
    or (
      recipient_profile_id is null
      and site_id is null
    )
    or (
      recipient_profile_id is null
      and exists (
        select 1 from public.site_memberships membership
        where membership.user_id = auth.uid()
          and membership.site_id = manager_messages.site_id
      )
    )
  )
);

drop policy if exists teamup_calendar_links_read on public.teamup_calendar_links;
create policy teamup_calendar_links_read on public.teamup_calendar_links
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and active
  and (
    app_private.current_app_role() in ('admin','group_manager')
    or site_id is null
    or exists (
      select 1 from public.site_memberships membership
      where membership.user_id = auth.uid()
        and membership.site_id = teamup_calendar_links.site_id
    )
  )
);

grant select on public.manager_messages, public.teamup_calendar_links to authenticated;

insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
select id, null, 'km.operating_home_installed', 'organisation', id,
  jsonb_build_object('scheduled_messages', true, 'teamup_calendar_links', true, 'multi_site_source', 'site_memberships')
from public.organisations
where not exists (
  select 1 from public.audit_log log
  where log.organisation_id = organisations.id
    and log.action = 'km.operating_home_installed'
);

commit;

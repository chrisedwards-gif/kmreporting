-- Canonical manager identity and dated site-manager assignments.
--
-- A person is identified everywhere by public.profiles.id, which is the same
-- UUID as auth.users.id. Site-manager assignments are separate dated records,
-- so changing a kitchen manager never rewrites the previous manager's reviews.
--
-- This migration upgrades UAT 011 safely. Legacy public.managers rows remain
-- available for audit/mapping, but all new 1-1 data uses profile UUIDs.

begin;

create table if not exists public.manager_details (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  role_title text not null default 'Kitchen Manager',
  employment_start_date date,
  focus_areas text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  manager_profile_id uuid not null references public.profiles (id) on delete restrict,
  starts_on date not null,
  ends_on date,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_manager_assignment_dates_valid check (ends_on is null or ends_on >= starts_on),
  constraint site_manager_assignment_starts_sunday check (extract(dow from starts_on) = 0),
  constraint site_manager_assignment_ends_saturday check (ends_on is null or extract(dow from ends_on) = 6),
  unique (site_id, manager_profile_id, starts_on)
);

create unique index if not exists site_manager_one_current_idx
  on public.site_manager_assignments (site_id)
  where ends_on is null;
create index if not exists site_manager_profile_history_idx
  on public.site_manager_assignments (manager_profile_id, starts_on desc);
create index if not exists site_manager_site_history_idx
  on public.site_manager_assignments (site_id, starts_on desc);

alter table public.one_to_one_reviews
  add column if not exists manager_profile_id uuid references public.profiles (id) on delete restrict,
  add column if not exists site_id uuid references public.sites (id) on delete restrict,
  add column if not exists assignment_id uuid references public.site_manager_assignments (id) on delete restrict;

alter table public.one_to_one_reviews alter column manager_id drop not null;

alter table public.manager_actions
  add column if not exists manager_profile_id uuid references public.profiles (id) on delete restrict,
  add column if not exists site_id uuid references public.sites (id) on delete set null,
  add column if not exists assignment_id uuid references public.site_manager_assignments (id) on delete set null;

alter table public.manager_actions alter column manager_id drop not null;

create table if not exists public.one_to_one_action_links (
  review_id uuid not null references public.one_to_one_reviews (id) on delete cascade,
  action_id uuid not null references public.manager_actions (id) on delete restrict,
  position smallint not null default 1 check (position between 1 and 7),
  carried_forward boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (review_id, action_id),
  unique (review_id, position)
);

create unique index if not exists one_to_one_assignment_week_idx
  on public.one_to_one_reviews (assignment_id, week_commencing)
  where assignment_id is not null;
create index if not exists one_to_one_profile_history_idx
  on public.one_to_one_reviews (manager_profile_id, week_commencing desc)
  where manager_profile_id is not null;
create index if not exists manager_actions_profile_idx
  on public.manager_actions (manager_profile_id, status, due_date)
  where manager_profile_id is not null;

-- Link legacy manager rows to the canonical profile when the same organisation
-- has exactly one active profile with the same name.
do $$
begin
  if to_regclass('public.managers') is not null then
    with unique_matches as (
      select m.id as manager_id, min(p.id::text)::uuid as profile_id
      from public.managers m
      join public.profiles p
        on p.organisation_id = m.organisation_id
       and lower(trim(p.full_name)) = lower(trim(m.full_name))
      where m.profile_id is null
      group by m.id
      having count(*) = 1
    )
    update public.managers m
       set profile_id = u.profile_id,
           updated_at = now()
      from unique_matches u
     where m.id = u.manager_id;
  end if;
end;
$$;

-- Every kitchen-manager login gets one manager-details extension row. The
-- identity itself remains profiles.id/auth.users.id.
insert into public.manager_details (
  profile_id, organisation_id, role_title, employment_start_date, focus_areas
)
select
  p.id,
  p.organisation_id,
  coalesce(legacy.role_title, 'Kitchen Manager'),
  legacy.start_date,
  coalesce(legacy.focus_areas, '{}')
from public.profiles p
left join lateral (
  select m.role_title, m.start_date, m.focus_areas
  from public.managers m
  where m.profile_id = p.id
  order by m.updated_at desc
  limit 1
) legacy on true
where p.role = 'kitchen_manager'
on conflict (profile_id) do update set
  organisation_id = excluded.organisation_id,
  role_title = excluded.role_title,
  employment_start_date = coalesce(public.manager_details.employment_start_date, excluded.employment_start_date),
  focus_areas = case
    when cardinality(public.manager_details.focus_areas) = 0 then excluded.focus_areas
    else public.manager_details.focus_areas
  end,
  updated_at = now();

-- Bootstrap a primary assignment only when a site currently has exactly one
-- active kitchen-manager membership. Sites with multiple manager memberships
-- are intentionally left unassigned so an admin can choose the primary KM.
with membership_candidates as (
  select
    s.organisation_id,
    s.id as site_id,
    sm.user_id as manager_profile_id,
    coalesce(
      s.reporting_start_date,
      current_date - extract(dow from current_date)::integer
    ) as starts_on,
    count(*) over (partition by s.id) as manager_count
  from public.sites s
  join public.site_memberships sm on sm.site_id = s.id
  join public.profiles p
    on p.id = sm.user_id
   and p.organisation_id = s.organisation_id
   and p.role = 'kitchen_manager'
   and p.active
)
insert into public.site_manager_assignments (
  organisation_id, site_id, manager_profile_id, starts_on
)
select organisation_id, site_id, manager_profile_id, starts_on
from membership_candidates c
where c.manager_count = 1
  and not exists (
    select 1
    from public.site_manager_assignments a
    where a.site_id = c.site_id and a.ends_on is null
  )
on conflict (site_id, manager_profile_id, starts_on) do nothing;

-- Map any existing UAT 011 reviews/actions that already have a linked profile.
do $$
begin
  if to_regclass('public.managers') is not null then
    update public.one_to_one_reviews r
       set manager_profile_id = m.profile_id,
           site_id = m.site_id
      from public.managers m
     where r.manager_id = m.id
       and r.manager_profile_id is null
       and m.profile_id is not null;

    update public.manager_actions a
       set manager_profile_id = m.profile_id,
           site_id = m.site_id
      from public.managers m
     where a.manager_id = m.id
       and a.manager_profile_id is null
       and m.profile_id is not null;
  end if;
end;
$$;

-- Create closed historical assignments for already-recorded legacy reviews so
-- those reviews keep their original site/person context.
insert into public.site_manager_assignments (
  organisation_id, site_id, manager_profile_id, starts_on, ends_on
)
select
  r.organisation_id,
  r.site_id,
  r.manager_profile_id,
  min(r.week_commencing),
  max(r.week_commencing) + 6
from public.one_to_one_reviews r
where r.manager_profile_id is not null
  and r.site_id is not null
  and r.assignment_id is null
  and not exists (
    select 1
    from public.site_manager_assignments a
    where a.site_id = r.site_id
      and a.manager_profile_id = r.manager_profile_id
      and a.starts_on <= r.week_commencing + 6
      and (a.ends_on is null or a.ends_on >= r.week_commencing)
  )
group by r.organisation_id, r.site_id, r.manager_profile_id
on conflict (site_id, manager_profile_id, starts_on) do nothing;

update public.one_to_one_reviews r
set assignment_id = (
  select a.id
  from public.site_manager_assignments a
  where a.site_id = r.site_id
    and a.manager_profile_id = r.manager_profile_id
    and a.starts_on <= r.week_commencing + 6
    and (a.ends_on is null or a.ends_on >= r.week_commencing)
  order by a.starts_on desc
  limit 1
)
where r.assignment_id is null
  and r.manager_profile_id is not null
  and r.site_id is not null;

update public.manager_actions ma
set assignment_id = coalesce(
  ma.assignment_id,
  (
    select a.id
    from public.site_manager_assignments a
    where a.site_id = ma.site_id
      and a.manager_profile_id = ma.manager_profile_id
    order by a.starts_on desc
    limit 1
  )
)
where ma.manager_profile_id is not null and ma.site_id is not null;

insert into public.one_to_one_action_links (review_id, action_id, position, carried_forward)
select
  ma.source_review_id,
  ma.id,
  row_number() over (partition by ma.source_review_id order by ma.created_at, ma.id)::smallint,
  ma.carried_from is not null
from public.manager_actions ma
where ma.source_review_id is not null
  and not exists (
    select 1
    from public.one_to_one_action_links l
    where l.review_id = ma.source_review_id and l.action_id = ma.id
  )
  and (
    select count(*)
    from public.manager_actions x
    where x.source_review_id = ma.source_review_id
      and (x.created_at, x.id) <= (ma.created_at, ma.id)
  ) <= 7;

alter table public.manager_details enable row level security;
alter table public.site_manager_assignments enable row level security;
alter table public.one_to_one_action_links enable row level security;

-- Replace the UAT 011 read policies with canonical profile-based rules.
drop policy if exists managers_read on public.managers;
drop policy if exists one_to_one_reviews_read on public.one_to_one_reviews;
drop policy if exists one_to_one_scores_read on public.one_to_one_scores;
drop policy if exists manager_actions_read on public.manager_actions;
drop policy if exists manager_details_read on public.manager_details;
drop policy if exists site_manager_assignments_read on public.site_manager_assignments;
drop policy if exists one_to_one_action_links_read on public.one_to_one_action_links;

create policy manager_details_read on public.manager_details for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (
      app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
      or profile_id = auth.uid()
    )
  );

create policy site_manager_assignments_read on public.site_manager_assignments for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (
      app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
      or manager_profile_id = auth.uid()
    )
  );

create policy one_to_one_reviews_read on public.one_to_one_reviews for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (
      app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
      or manager_profile_id = auth.uid()
    )
  );

create policy one_to_one_scores_read on public.one_to_one_scores for select to authenticated
  using (exists (
    select 1 from public.one_to_one_reviews r where r.id = review_id
  ));

create policy manager_actions_read on public.manager_actions for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (
      app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
      or manager_profile_id = auth.uid()
    )
  );

create policy one_to_one_action_links_read on public.one_to_one_action_links for select to authenticated
  using (exists (
    select 1 from public.one_to_one_reviews r where r.id = review_id
  ));

grant select on public.manager_details to authenticated;
grant select on public.site_manager_assignments to authenticated;
grant select on public.one_to_one_action_links to authenticated;

-- Admin-only primary manager replacement. The prior assignment is ended on the
-- Saturday before the new assignment begins; its reviews remain untouched.
create or replace function public.assign_primary_site_manager(
  target_site uuid,
  target_profile uuid,
  effective_from date
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  current_assignment public.site_manager_assignments%rowtype;
  assignment_id uuid;
begin
  if actor is null or app_private.current_app_role() <> 'admin' then
    raise exception 'Only an administrator can replace a kitchen manager.';
  end if;
  if extract(dow from effective_from) <> 0 then
    raise exception 'A manager assignment must start on a Sunday.';
  end if;
  if not exists (
    select 1 from public.sites s
    where s.id = target_site and s.organisation_id = org
  ) then
    raise exception 'That kitchen is outside your organisation.';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = target_profile
      and p.organisation_id = org
      and p.role = 'kitchen_manager'
      and p.active
  ) then
    raise exception 'The selected account is not an active kitchen manager.';
  end if;

  select a.* into current_assignment
  from public.site_manager_assignments a
  where a.site_id = target_site and a.ends_on is null
  order by a.starts_on desc
  limit 1
  for update;

  if current_assignment.id is not null
     and current_assignment.manager_profile_id = target_profile then
    return current_assignment.id;
  end if;

  if current_assignment.id is not null and current_assignment.starts_on > effective_from then
    raise exception 'A future manager assignment already exists for this kitchen.';
  end if;

  if current_assignment.id is not null then
    if current_assignment.starts_on = effective_from then
      if exists (
        select 1 from public.one_to_one_reviews r
        where r.assignment_id = current_assignment.id
      ) then
        raise exception 'That assignment already has a review. Choose the next Sunday as the replacement date.';
      end if;
      delete from public.site_manager_assignments where id = current_assignment.id;
    else
      update public.site_manager_assignments
         set ends_on = effective_from - 1,
             updated_at = now()
       where id = current_assignment.id;
    end if;
  end if;

  insert into public.site_manager_assignments (
    organisation_id, site_id, manager_profile_id, starts_on, assigned_by
  ) values (
    org, target_site, target_profile, effective_from, actor
  )
  on conflict (site_id, manager_profile_id, starts_on) do update set
    ends_on = null,
    assigned_by = excluded.assigned_by,
    updated_at = now()
  returning id into assignment_id;

  insert into public.manager_details (profile_id, organisation_id)
  values (target_profile, org)
  on conflict (profile_id) do update set updated_at = now();

  insert into public.site_memberships (user_id, site_id, can_submit)
  values (target_profile, target_site, true)
  on conflict (user_id, site_id) do update set can_submit = true;

  if current_assignment.id is not null
     and current_assignment.manager_profile_id <> target_profile then
    delete from public.site_memberships sm
    using public.profiles p
    where sm.site_id = target_site
      and sm.user_id = current_assignment.manager_profile_id
      and p.id = sm.user_id
      and p.role = 'kitchen_manager';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    actor,
    'site.primary_manager_assigned',
    'site_manager_assignment',
    assignment_id,
    jsonb_build_object(
      'site_id', target_site,
      'manager_profile_id', target_profile,
      'effective_from', effective_from,
      'previous_assignment_id', current_assignment.id,
      'previous_manager_profile_id', current_assignment.manager_profile_id
    )
  );

  return assignment_id;
end;
$$;

-- Canonical 1-1 save: assignment is the source of truth for both person and
-- site. The client cannot submit a different manager/site combination.
create or replace function public.save_one_to_one(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  target_assignment uuid := (payload->>'assignmentId')::uuid;
  target_week date := (payload->>'weekCommencing')::date;
  target_manager uuid;
  target_site uuid;
  review_id uuid;
  score_item jsonb;
  action_item jsonb;
  action_id uuid;
  action_position smallint := 0;
  incoming_count integer := 0;
begin
  if actor is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can record 1-1 reviews.';
  end if;

  select a.manager_profile_id, a.site_id
    into target_manager, target_site
  from public.site_manager_assignments a
  where a.id = target_assignment
    and a.organisation_id = org
    and a.starts_on <= target_week + 6
    and (a.ends_on is null or a.ends_on >= target_week);

  if target_manager is null or target_site is null then
    raise exception 'The manager was not assigned to this kitchen for that week.';
  end if;

  insert into public.one_to_one_reviews as r (
    organisation_id,
    manager_profile_id,
    site_id,
    assignment_id,
    reviewer_id,
    week_commencing,
    review_date,
    status,
    wins,
    kpi_manual,
    focus_areas,
    summary,
    updated_at
  ) values (
    org,
    target_manager,
    target_site,
    target_assignment,
    actor,
    target_week,
    (payload->>'reviewDate')::date,
    'draft',
    coalesce(payload->'wins', '{}'::jsonb),
    coalesce(payload->'kpiManual', '{}'::jsonb),
    coalesce(payload->'focusAreas', '[]'::jsonb),
    coalesce(payload->'summary', '{}'::jsonb),
    now()
  )
  on conflict (assignment_id, week_commencing) where assignment_id is not null do update set
    review_date = excluded.review_date,
    wins = excluded.wins,
    kpi_manual = excluded.kpi_manual,
    focus_areas = excluded.focus_areas,
    summary = excluded.summary,
    reviewer_id = excluded.reviewer_id,
    updated_at = now()
  where r.status in ('draft', 'in_review', 'reopened')
  returning r.id into review_id;

  if review_id is null then
    raise exception 'This review is finalised. Reopen it with a reason before editing.';
  end if;

  for score_item in
    select value from jsonb_array_elements(coalesce(payload->'scores', '[]'::jsonb))
  loop
    insert into public.one_to_one_scores (
      review_id, area, score, evidence, development_note
    ) values (
      review_id,
      score_item->>'area',
      nullif(score_item->>'score', '')::numeric,
      coalesce(score_item->>'evidence', ''),
      coalesce(score_item->>'developmentNote', '')
    )
    on conflict (review_id, area) do update set
      score = excluded.score,
      evidence = excluded.evidence,
      development_note = excluded.development_note;
  end loop;

  delete from public.one_to_one_action_links where review_id = save_one_to_one.review_id;

  for action_item in
    select value from jsonb_array_elements(coalesce(payload->'actions', '[]'::jsonb))
  loop
    action_id := null;
    action_position := action_position + 1;
    if action_position > 7 then
      raise exception 'A weekly 1-1 can contain at most seven agreed actions.';
    end if;

    if coalesce(action_item->>'id', '') <> '' then
      update public.manager_actions
         set priority = action_item->>'priority',
             action = action_item->>'action',
             success_measure = coalesce(action_item->>'successMeasure', ''),
             owner = action_item->>'owner',
             due_date = nullif(action_item->>'dueDate', '')::date,
             status = action_item->>'status',
             outcome = coalesce(action_item->>'outcome', ''),
             completed_at = case
               when action_item->>'status' = 'complete' then coalesce(completed_at, now())
               else null
             end,
             updated_at = now()
       where id = (action_item->>'id')::uuid
         and organisation_id = org
         and manager_profile_id = target_manager
       returning id into action_id;

      if action_id is null then
        raise exception 'An agreed action is outside this manager record.';
      end if;
    else
      insert into public.manager_actions (
        organisation_id,
        manager_profile_id,
        site_id,
        assignment_id,
        source_review_id,
        priority,
        action,
        success_measure,
        owner,
        due_date,
        status,
        outcome,
        carried_from
      ) values (
        org,
        target_manager,
        target_site,
        target_assignment,
        review_id,
        action_item->>'priority',
        action_item->>'action',
        coalesce(action_item->>'successMeasure', ''),
        action_item->>'owner',
        nullif(action_item->>'dueDate', '')::date,
        coalesce(action_item->>'status', 'not_started'),
        coalesce(action_item->>'outcome', ''),
        nullif(action_item->>'carriedFrom', '')::uuid
      )
      returning id into action_id;
    end if;

    insert into public.one_to_one_action_links (
      review_id, action_id, position, carried_forward
    ) values (
      review_id,
      action_id,
      action_position,
      coalesce(action_item->>'carriedFrom', '') <> ''
    );
    incoming_count := incoming_count + 1;
  end loop;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    actor,
    'one_to_one.saved',
    'one_to_one_review',
    review_id,
    jsonb_build_object(
      'manager_profile_id', target_manager,
      'site_id', target_site,
      'assignment_id', target_assignment,
      'action_count', incoming_count
    )
  );

  return review_id;
end;
$$;

create or replace function public.finalise_one_to_one(
  target_review uuid,
  kpi_snapshot jsonb,
  overall numeric
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if auth.uid() is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can finalise a review.';
  end if;

  update public.one_to_one_reviews
     set status = 'finalised',
         kpi_snapshot = finalise_one_to_one.kpi_snapshot,
         overall_score = overall,
         finalised_at = now(),
         finalised_by = auth.uid(),
         updated_at = now()
   where id = target_review
     and organisation_id = org
     and assignment_id is not null
     and status in ('draft', 'in_review', 'reopened');

  if not found then
    raise exception 'The review is missing or already finalised.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    auth.uid(),
    'one_to_one.finalised',
    'one_to_one_review',
    target_review,
    jsonb_build_object('overall_score', overall)
  );
end;
$$;

create or replace function public.reopen_one_to_one(target_review uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if auth.uid() is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can reopen a review.';
  end if;
  if length(trim(coalesce(reason, ''))) < 3 then
    raise exception 'A reason is required to reopen a finalised review.';
  end if;

  update public.one_to_one_reviews
     set status = 'reopened',
         reopen_reason = reason,
         updated_at = now()
   where id = target_review
     and organisation_id = org
     and status in ('finalised', 'acknowledged');

  if not found then
    raise exception 'Only a finalised review can be reopened.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    auth.uid(),
    'one_to_one.reopened',
    'one_to_one_review',
    target_review,
    jsonb_build_object('reason', reason)
  );
end;
$$;

create or replace function public.acknowledge_one_to_one(target_review uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  update public.one_to_one_reviews r
     set status = 'acknowledged',
         acknowledged_at = now(),
         updated_at = now()
   where r.id = target_review
     and r.organisation_id = org
     and r.status = 'finalised'
     and (
       app_private.current_app_role() in ('admin', 'group_manager')
       or r.manager_profile_id = auth.uid()
     );

  if not found then
    raise exception 'Only the named manager or group management can acknowledge a finalised review.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    auth.uid(),
    'one_to_one.acknowledged',
    'one_to_one_review',
    target_review,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.assign_primary_site_manager(uuid, uuid, date) from public, anon;
revoke all on function public.save_one_to_one(jsonb) from public, anon;
revoke all on function public.finalise_one_to_one(uuid, jsonb, numeric) from public, anon;
revoke all on function public.reopen_one_to_one(uuid, text) from public, anon;
revoke all on function public.acknowledge_one_to_one(uuid) from public, anon;

grant execute on function public.assign_primary_site_manager(uuid, uuid, date) to authenticated;
grant execute on function public.save_one_to_one(jsonb) to authenticated;
grant execute on function public.finalise_one_to_one(uuid, jsonb, numeric) to authenticated;
grant execute on function public.reopen_one_to_one(uuid, text) to authenticated;
grant execute on function public.acknowledge_one_to_one(uuid) to authenticated;

commit;

-- Kitchen Manager performance 1-1s: Phase 1.
-- Managers are records, not logins (a profile can be linked later), reviews
-- carry the eight-area scoring model, and agreed actions live in one master
-- log that carries forward between reviews instead of disappearing.
-- KPI values are not re-entered: sales, GP, labour, waste, stock basis and
-- report status come from the existing weekly report snapshots; only audit
-- score and compliance are recorded in the meeting.

begin;

create table public.managers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  profile_id uuid references public.profiles (id) on delete set null,
  full_name text not null,
  role_title text not null default 'Kitchen Manager',
  start_date date,
  focus_areas text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index managers_org_idx on public.managers (organisation_id, active);

create table public.one_to_one_reviews (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  manager_id uuid not null references public.managers (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  week_commencing date not null,
  review_date date,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'finalised', 'acknowledged', 'reopened')),
  wins jsonb not null default '{}'::jsonb,
  kpi_manual jsonb not null default '{}'::jsonb,
  kpi_snapshot jsonb,
  focus_areas jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  overall_score numeric(3, 1),
  finalised_at timestamptz,
  finalised_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (manager_id, week_commencing)
);

create index one_to_one_reviews_manager_idx on public.one_to_one_reviews (manager_id, week_commencing desc);

create table public.one_to_one_scores (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.one_to_one_reviews (id) on delete cascade,
  area text not null check (area in (
    'leadership', 'communication', 'organisation', 'kitchen_standards',
    'product_quality', 'commercial_awareness', 'problem_solving', 'ownership'
  )),
  score numeric(2, 1) check (score between 1 and 5),
  evidence text not null default '',
  development_note text not null default '',
  unique (review_id, area),
  constraint low_scores_need_development check (score is null or score >= 3 or length(trim(development_note)) > 0)
);

create table public.manager_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  manager_id uuid not null references public.managers (id) on delete cascade,
  source_review_id uuid references public.one_to_one_reviews (id) on delete set null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  action text not null,
  success_measure text not null default '',
  owner text not null,
  due_date date,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'complete', 'cancelled')),
  outcome text not null default '',
  carried_from uuid references public.manager_actions (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manager_actions_manager_idx on public.manager_actions (manager_id, status, due_date);

alter table public.managers enable row level security;
alter table public.one_to_one_reviews enable row level security;
alter table public.one_to_one_scores enable row level security;
alter table public.manager_actions enable row level security;

-- Group roles read everything in their organisation; a linked kitchen manager
-- reads their own record, reviews, scores and actions.
create policy managers_read on public.managers for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer') or profile_id = auth.uid())
  );

create policy one_to_one_reviews_read on public.one_to_one_reviews for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (
      app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
      or exists (select 1 from public.managers m where m.id = manager_id and m.profile_id = auth.uid())
    )
  );

create policy one_to_one_scores_read on public.one_to_one_scores for select to authenticated
  using (exists (select 1 from public.one_to_one_reviews r where r.id = review_id));

create policy manager_actions_read on public.manager_actions for select to authenticated
  using (
    organisation_id = app_private.current_organisation_id()
    and (
      app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
      or exists (select 1 from public.managers m where m.id = manager_id and m.profile_id = auth.uid())
    )
  );

-- All writes go through security-definer RPCs, mirroring the weekly report model.
create or replace function public.save_one_to_one(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  target_manager uuid := (payload->>'managerId')::uuid;
  review_id uuid;
  score_item jsonb;
  action_item jsonb;
  incoming_ids uuid[] := '{}';
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can record 1-1 reviews.';
  end if;
  if not exists (select 1 from public.managers m where m.id = target_manager and m.organisation_id = org) then
    raise exception 'Unknown manager.';
  end if;

  insert into public.one_to_one_reviews as r (
    organisation_id, manager_id, reviewer_id, week_commencing, review_date,
    status, wins, kpi_manual, focus_areas, summary, updated_at
  ) values (
    org, target_manager, actor, (payload->>'weekCommencing')::date, (payload->>'reviewDate')::date,
    'draft', coalesce(payload->'wins', '{}'::jsonb), coalesce(payload->'kpiManual', '{}'::jsonb),
    coalesce(payload->'focusAreas', '[]'::jsonb), coalesce(payload->'summary', '{}'::jsonb), now()
  )
  on conflict (manager_id, week_commencing) do update set
    review_date = excluded.review_date,
    wins = excluded.wins,
    kpi_manual = excluded.kpi_manual,
    focus_areas = excluded.focus_areas,
    summary = excluded.summary,
    updated_at = now()
  where r.status in ('draft', 'in_review', 'reopened')
  returning r.id into review_id;

  if review_id is null then
    raise exception 'This review is finalised. Reopen it with a reason before editing.';
  end if;

  for score_item in select value from jsonb_array_elements(coalesce(payload->'scores', '[]'::jsonb)) loop
    insert into public.one_to_one_scores (review_id, area, score, evidence, development_note)
    values (
      review_id, score_item->>'area',
      nullif(score_item->>'score', '')::numeric,
      coalesce(score_item->>'evidence', ''), coalesce(score_item->>'developmentNote', '')
    )
    on conflict (review_id, area) do update set
      score = excluded.score, evidence = excluded.evidence, development_note = excluded.development_note;
  end loop;

  -- Agreed actions: upsert by id so edits do not duplicate log entries.
  for action_item in select value from jsonb_array_elements(coalesce(payload->'actions', '[]'::jsonb)) loop
    if action_item->>'id' is not null and (action_item->>'id') <> '' then
      update public.manager_actions set
        priority = action_item->>'priority', action = action_item->>'action',
        success_measure = coalesce(action_item->>'successMeasure', ''),
        owner = action_item->>'owner', due_date = nullif(action_item->>'dueDate', '')::date,
        status = action_item->>'status', outcome = coalesce(action_item->>'outcome', ''),
        completed_at = case when action_item->>'status' = 'complete' then coalesce(completed_at, now()) else null end,
        updated_at = now()
      where id = (action_item->>'id')::uuid and organisation_id = org
      returning id into strict incoming_ids[cardinality(incoming_ids) + 1];
    else
      insert into public.manager_actions (
        organisation_id, manager_id, source_review_id, priority, action,
        success_measure, owner, due_date, status, outcome, carried_from
      ) values (
        org, target_manager, review_id, action_item->>'priority', action_item->>'action',
        coalesce(action_item->>'successMeasure', ''), action_item->>'owner',
        nullif(action_item->>'dueDate', '')::date, coalesce(action_item->>'status', 'not_started'),
        coalesce(action_item->>'outcome', ''), nullif(action_item->>'carriedFrom', '')::uuid
      )
      returning id into strict incoming_ids[cardinality(incoming_ids) + 1];
    end if;
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, actor, 'one_to_one.saved', 'one_to_one_review', review_id,
    jsonb_build_object('manager_id', target_manager, 'action_count', cardinality(incoming_ids)));
  return review_id;
end;
$$;

create or replace function public.finalise_one_to_one(target_review uuid, kpi_snapshot jsonb, overall numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can finalise a review.';
  end if;
  update public.one_to_one_reviews set
    status = 'finalised', kpi_snapshot = finalise_one_to_one.kpi_snapshot,
    overall_score = overall, finalised_at = now(), finalised_by = auth.uid(), updated_at = now()
  where id = target_review and organisation_id = org and status in ('draft', 'in_review', 'reopened');
  if not found then
    raise exception 'The review is missing or already finalised.';
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, auth.uid(), 'one_to_one.finalised', 'one_to_one_review', target_review,
    jsonb_build_object('overall_score', overall));
end;
$$;

create or replace function public.reopen_one_to_one(target_review uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can reopen a review.';
  end if;
  if length(trim(coalesce(reason, ''))) = 0 then
    raise exception 'A reason is required to reopen a finalised review.';
  end if;
  update public.one_to_one_reviews set status = 'reopened', reopen_reason = reason, updated_at = now()
  where id = target_review and organisation_id = org and status in ('finalised', 'acknowledged');
  if not found then raise exception 'Only a finalised review can be reopened.'; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, auth.uid(), 'one_to_one.reopened', 'one_to_one_review', target_review,
    jsonb_build_object('reason', reason));
end;
$$;

create or replace function public.acknowledge_one_to_one(target_review uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  update public.one_to_one_reviews r set status = 'acknowledged', acknowledged_at = now(), updated_at = now()
  where r.id = target_review and r.organisation_id = org and r.status = 'finalised'
    and (
      app_private.current_app_role() in ('admin', 'group_manager')
      or exists (select 1 from public.managers m where m.id = r.manager_id and m.profile_id = auth.uid())
    );
  if not found then raise exception 'Only a finalised review can be acknowledged.'; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, auth.uid(), 'one_to_one.acknowledged', 'one_to_one_review', target_review, '{}'::jsonb);
end;
$$;

revoke all on function public.save_one_to_one(jsonb) from public, anon;
revoke all on function public.finalise_one_to_one(uuid, jsonb, numeric) from public, anon;
revoke all on function public.reopen_one_to_one(uuid, text) from public, anon;
revoke all on function public.acknowledge_one_to_one(uuid) from public, anon;
grant execute on function public.save_one_to_one(jsonb) to authenticated;
grant execute on function public.finalise_one_to_one(uuid, jsonb, numeric) to authenticated;
grant execute on function public.reopen_one_to_one(uuid, text) to authenticated;
grant execute on function public.acknowledge_one_to_one(uuid) to authenticated;

commit;

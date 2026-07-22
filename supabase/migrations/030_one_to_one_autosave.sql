-- Reliability release: make client-generated 1-1 action IDs idempotent so autosave cannot duplicate actions.

begin;

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
  saved_review_id uuid;
  score_item jsonb;
  action_item jsonb;
  saved_action_id uuid;
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
    nullif(payload->>'reviewDate', '')::date,
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
  returning r.id into saved_review_id;

  if saved_review_id is null then
    raise exception 'This review is finalised. Reopen it with a reason before editing.';
  end if;

  for score_item in
    select item.value from jsonb_array_elements(coalesce(payload->'scores', '[]'::jsonb)) as item(value)
  loop
    insert into public.one_to_one_scores as existing_score (
      review_id, area, score, evidence, development_note
    ) values (
      saved_review_id,
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

  delete from public.one_to_one_action_links links
  where links.review_id = saved_review_id;

  for action_item in
    select item.value from jsonb_array_elements(coalesce(payload->'actions', '[]'::jsonb)) as item(value)
  loop
    saved_action_id := null;
    action_position := action_position + 1;
    if action_position > 7 then
      raise exception 'A weekly 1-1 can contain at most seven agreed actions.';
    end if;

    if coalesce(action_item->>'id', '') <> '' then
      update public.manager_actions actions
         set priority = action_item->>'priority',
             action = action_item->>'action',
             success_measure = coalesce(action_item->>'successMeasure', ''),
             owner = coalesce(action_item->>'owner', ''),
             due_date = nullif(action_item->>'dueDate', '')::date,
             status = coalesce(action_item->>'status', 'not_started'),
             outcome = coalesce(action_item->>'outcome', ''),
             completed_at = case
               when action_item->>'status' = 'complete' then coalesce(actions.completed_at, now())
               else null
             end,
             updated_at = now()
       where actions.id = (action_item->>'id')::uuid
         and actions.organisation_id = org
         and actions.manager_profile_id = target_manager
       returning actions.id into saved_action_id;

      if saved_action_id is null and coalesce((action_item->>'isNew')::boolean, false) then
        insert into public.manager_actions (
          id, organisation_id, manager_profile_id, site_id, assignment_id, source_review_id,
          priority, action, success_measure, owner, due_date, status, outcome, carried_from
        ) values (
          (action_item->>'id')::uuid, org, target_manager, target_site, target_assignment, saved_review_id,
          action_item->>'priority', action_item->>'action', coalesce(action_item->>'successMeasure', ''),
          coalesce(action_item->>'owner', ''), nullif(action_item->>'dueDate', '')::date,
          coalesce(action_item->>'status', 'not_started'), coalesce(action_item->>'outcome', ''),
          nullif(action_item->>'carriedFrom', '')::uuid
        )
        on conflict (id) do nothing
        returning id into saved_action_id;
      end if;

      if saved_action_id is null then
        raise exception 'An agreed action is outside this manager record.';
      end if;
    else
      insert into public.manager_actions (
        organisation_id, manager_profile_id, site_id, assignment_id, source_review_id,
        priority, action, success_measure, owner, due_date, status, outcome, carried_from
      ) values (
        org, target_manager, target_site, target_assignment, saved_review_id,
        action_item->>'priority', action_item->>'action', coalesce(action_item->>'successMeasure', ''),
        coalesce(action_item->>'owner', ''), nullif(action_item->>'dueDate', '')::date,
        coalesce(action_item->>'status', 'not_started'), coalesce(action_item->>'outcome', ''),
        nullif(action_item->>'carriedFrom', '')::uuid
      )
      returning id into saved_action_id;
    end if;

    insert into public.one_to_one_action_links (
      review_id, action_id, position, carried_forward
    ) values (
      saved_review_id,
      saved_action_id,
      action_position,
      coalesce(action_item->>'carriedFrom', '') <> ''
    );
    incoming_count := incoming_count + 1;
  end loop;

  if coalesce(payload->>'saveMode', 'manual') <> 'autosave' then
    insert into public.audit_log (
      organisation_id, actor_id, action, entity_type, entity_id, detail
    ) values (
      org,
      actor,
      'one_to_one.saved',
      'one_to_one_review',
      saved_review_id,
      jsonb_build_object(
        'manager_profile_id', target_manager,
        'site_id', target_site,
        'assignment_id', target_assignment,
        'action_count', incoming_count
      )
    );
  end if;

  return saved_review_id;
end;
$$;


revoke all on function public.save_one_to_one(jsonb) from public, anon;
grant execute on function public.save_one_to_one(jsonb) to authenticated;

commit;

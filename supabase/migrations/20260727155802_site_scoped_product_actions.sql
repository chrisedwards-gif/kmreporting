-- Give each Kitchen Manager a site-scoped product workspace and allow
-- authorised managers to create standalone Action Log entries.

begin;

create or replace function public.create_manager_action(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  actor_role public.app_role := app_private.current_app_role();
  target_manager uuid := nullif(payload->>'managerProfileId', '')::uuid;
  target_site uuid := nullif(payload->>'siteId', '')::uuid;
  target_priority text := coalesce(nullif(payload->>'priority', ''), 'medium');
  target_action text := trim(coalesce(payload->>'action', ''));
  target_success_measure text := trim(coalesce(payload->>'successMeasure', ''));
  target_owner text := trim(coalesce(payload->>'owner', ''));
  target_due_date date := nullif(payload->>'dueDate', '')::date;
  target_assignment uuid;
  saved_id uuid;
begin
  if actor is null or actor_role not in ('admin', 'group_manager', 'kitchen_manager') then
    raise exception 'You do not have permission to add manager actions.';
  end if;
  if target_manager is null or target_site is null then
    raise exception 'Choose a manager and kitchen.';
  end if;
  if target_priority not in ('high', 'medium', 'low') then
    raise exception 'Choose a valid action priority.';
  end if;
  if length(target_action) < 3 then
    raise exception 'Describe the action.';
  end if;
  if length(target_owner) < 2 then
    raise exception 'Add the person responsible.';
  end if;
  if target_due_date is null then
    raise exception 'Add a due date.';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = target_manager
      and profile.organisation_id = org
      and profile.role = 'kitchen_manager'
      and profile.active
  ) then
    raise exception 'That manager is outside your organisation.';
  end if;
  if not exists (
    select 1
    from public.sites site
    where site.id = target_site
      and site.organisation_id = org
      and site.active
  ) then
    raise exception 'That kitchen is outside your organisation.';
  end if;
  if not exists (
    select 1
    from public.site_memberships membership
    where membership.user_id = target_manager
      and membership.site_id = target_site
  ) and not exists (
    select 1
    from public.site_manager_assignments assignment
    where assignment.manager_profile_id = target_manager
      and assignment.site_id = target_site
      and assignment.ends_on is null
  ) then
    raise exception 'That manager is not assigned to this kitchen.';
  end if;
  if actor_role = 'kitchen_manager' and (
    target_manager <> actor
    or not exists (
      select 1
      from public.site_memberships membership
      where membership.user_id = actor
        and membership.site_id = target_site
    )
  ) then
    raise exception 'You can only add actions inside your assigned kitchens.';
  end if;

  select assignment.id into target_assignment
  from public.site_manager_assignments assignment
  where assignment.manager_profile_id = target_manager
    and assignment.site_id = target_site
    and assignment.ends_on is null
  order by assignment.starts_on desc
  limit 1;

  insert into public.manager_actions (
    organisation_id,
    manager_profile_id,
    site_id,
    assignment_id,
    priority,
    action,
    success_measure,
    owner,
    due_date,
    status,
    outcome
  ) values (
    org,
    target_manager,
    target_site,
    target_assignment,
    target_priority,
    left(target_action, 500),
    left(target_success_measure, 500),
    left(target_owner, 120),
    target_due_date,
    'not_started',
    ''
  )
  returning id into saved_id;

  insert into public.audit_log (
    organisation_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    detail
  ) values (
    org,
    actor,
    'manager_action.created',
    'manager_action',
    saved_id,
    jsonb_build_object(
      'manager_profile_id', target_manager,
      'site_id', target_site,
      'priority', target_priority,
      'source', 'action_log'
    )
  );

  return saved_id;
end;
$$;

create or replace function public.save_product_development_item(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  actor_role public.app_role := app_private.current_app_role();
  target_id uuid := nullif(payload->>'id', '')::uuid;
  target_site uuid := nullif(payload->>'siteId', '')::uuid;
  target_owner uuid := nullif(payload->>'ownerProfileId', '')::uuid;
  next_status text := coalesce(nullif(payload->>'status', ''), 'idea');
  previous_status text;
  previous_site uuid;
  previous_owner uuid;
  saved_id uuid;
  payload_allergens text[] := coalesce(array(select jsonb_array_elements_text(coalesce(payload->'allergens', '[]'::jsonb))), '{}');
begin
  if actor is null or actor_role not in ('admin', 'group_manager', 'kitchen_manager') then
    raise exception 'You do not have permission to manage product development.';
  end if;

  if target_site is not null and not exists (
    select 1 from public.sites site
    where site.id = target_site and site.organisation_id = org
  ) then
    raise exception 'That kitchen is outside your organisation.';
  end if;

  if actor_role = 'kitchen_manager' and (
    target_site is null or not exists (
      select 1 from public.site_memberships membership
      where membership.user_id = actor and membership.site_id = target_site
    )
  ) then
    raise exception 'That product is outside your assigned kitchen.';
  end if;

  if target_owner is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = target_owner and profile.organisation_id = org and profile.active
  ) then
    raise exception 'That owner is outside your organisation.';
  end if;
  if actor_role = 'kitchen_manager' and target_owner is not null and target_owner <> actor then
    raise exception 'A Kitchen Manager can only assign a product to their own account.';
  end if;

  if target_id is not null then
    select item.status, item.site_id, item.owner_profile_id
      into previous_status, previous_site, previous_owner
    from public.product_development_items item
    where item.id = target_id and item.organisation_id = org
    for update;
    if previous_status is null then
      raise exception 'Product development item not found.';
    end if;
    if actor_role = 'kitchen_manager' and not (
      previous_owner = actor
      or exists (
        select 1 from public.site_memberships membership
        where membership.user_id = actor
          and membership.site_id = previous_site
      )
    ) then
      raise exception 'That product is outside your assigned kitchen.';
    end if;
  end if;

  if next_status = 'live' then
    if target_id is null then raise exception 'Save the product before attaching evidence and moving it Live.'; end if;
    if length(trim(coalesce(payload->>'recipeSummary', ''))) < 5 then raise exception 'A Live product needs its final recipe/specification.'; end if;
    if length(trim(coalesce(payload->>'methodText', ''))) < 5 then raise exception 'A Live product needs its method.'; end if;
    if length(trim(coalesce(payload->>'portionText', ''))) < 2 then raise exception 'A Live product needs its portion specification.'; end if;
    if nullif(payload->>'foodCost', '') is null or nullif(payload->>'sellPrice', '') is null then raise exception 'A Live product needs an approved cost and selling price.'; end if;
    if cardinality(payload_allergens) = 0 then raise exception 'A Live product needs an allergen declaration, including None where applicable.'; end if;
    if length(trim(coalesce(payload->>'shelfLifeText', ''))) < 2 then raise exception 'A Live product needs shelf-life and storage guidance.'; end if;
    if length(trim(coalesce(payload->>'operationalPlan', ''))) < 5 then raise exception 'A Live product needs an operational and training plan.'; end if;
    if not exists (
      select 1 from public.evidence_files evidence
      where evidence.organisation_id = org
        and evidence.entity_type = 'product_development'
        and evidence.entity_id = target_id
        and evidence.evidence_type = 'finished_photo'
        and evidence.mime_type like 'image/%'
    ) then
      raise exception 'Upload a finished-product photo before moving this product Live.';
    end if;
  end if;

  if target_id is not null then
    update public.product_development_items item set
      site_id = target_site,
      owner_profile_id = target_owner,
      title = left(trim(payload->>'title'), 160),
      category = left(coalesce(nullif(trim(payload->>'category'), ''), 'Dish'), 80),
      status = next_status,
      target_launch_date = nullif(payload->>'targetLaunchDate', '')::date,
      next_trial_date = nullif(payload->>'nextTrialDate', '')::date,
      recipe_summary = left(coalesce(payload->>'recipeSummary', ''), 8000),
      method_text = left(coalesce(payload->>'methodText', ''), 12000),
      yield_text = left(coalesce(payload->>'yieldText', ''), 160),
      portion_text = left(coalesce(payload->>'portionText', ''), 160),
      shelf_life_text = left(coalesce(payload->>'shelfLifeText', ''), 1000),
      operational_plan = left(coalesce(payload->>'operationalPlan', ''), 8000),
      food_cost = nullif(payload->>'foodCost', '')::numeric,
      sell_price = nullif(payload->>'sellPrice', '')::numeric,
      allergens = payload_allergens,
      trial_notes = left(coalesce(payload->>'trialNotes', ''), 12000),
      approval_notes = left(coalesce(payload->>'approvalNotes', ''), 8000),
      version = case when previous_status = 'approved' and next_status <> 'approved' then item.version + 1 else item.version end,
      updated_by = actor,
      updated_at = now()
    where item.id = target_id
    returning item.id into saved_id;
  else
    insert into public.product_development_items (
      organisation_id, site_id, owner_profile_id, title, category, status,
      target_launch_date, next_trial_date, recipe_summary, method_text, yield_text,
      portion_text, shelf_life_text, operational_plan, food_cost, sell_price,
      allergens, trial_notes, approval_notes, created_by, updated_by
    ) values (
      org, target_site, target_owner, left(trim(payload->>'title'), 160),
      left(coalesce(nullif(trim(payload->>'category'), ''), 'Dish'), 80), next_status,
      nullif(payload->>'targetLaunchDate', '')::date, nullif(payload->>'nextTrialDate', '')::date,
      left(coalesce(payload->>'recipeSummary', ''), 8000), left(coalesce(payload->>'methodText', ''), 12000),
      left(coalesce(payload->>'yieldText', ''), 160), left(coalesce(payload->>'portionText', ''), 160),
      left(coalesce(payload->>'shelfLifeText', ''), 1000), left(coalesce(payload->>'operationalPlan', ''), 8000),
      nullif(payload->>'foodCost', '')::numeric, nullif(payload->>'sellPrice', '')::numeric,
      payload_allergens, left(coalesce(payload->>'trialNotes', ''), 12000),
      left(coalesce(payload->>'approvalNotes', ''), 8000), actor, actor
    ) returning id into saved_id;
    previous_status := null;
  end if;

  insert into public.product_development_events (
    organisation_id, item_id, actor_id, event_type, from_status, to_status, detail
  ) values (
    org, saved_id, actor,
    case when target_id is null then 'created' when previous_status is distinct from next_status then 'status_changed' else 'updated' end,
    previous_status, next_status,
    jsonb_build_object('title', payload->>'title', 'version', (select version from public.product_development_items where id = saved_id))
  );

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, actor, 'product_development.saved', 'product_development_item', saved_id,
    jsonb_build_object('status', next_status, 'site_id', target_site));

  return saved_id;
end;
$$;

revoke all on function public.create_manager_action(jsonb) from public, anon;
revoke all on function public.save_product_development_item(jsonb) from public, anon;
grant execute on function public.create_manager_action(jsonb) to authenticated;
grant execute on function public.save_product_development_item(jsonb) to authenticated;

commit;

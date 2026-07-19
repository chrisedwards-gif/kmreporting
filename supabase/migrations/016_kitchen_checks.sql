-- UAT 011: site-specific daily and weekly kitchen checks.
--
-- Templates are versioned and tied to one kitchen. Historic runs retain the
-- template version and item definitions used at the time. Green / Amber / Red
-- scoring follows the Dough Religion workbook: 2 / 1 / 0 points, 90% pass,
-- 75-89% watch, below 75% fail, and any critical Red is an automatic fail.

begin;

create table if not exists public.kitchen_check_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  description text not null default '',
  cadence text not null check (cadence in ('daily', 'weekly')),
  response_mode text not null default 'gar' check (response_mode in ('gar')),
  require_actions boolean not null default true,
  pass_threshold numeric(5,2) not null default 90 check (pass_threshold between 0 and 100),
  watch_threshold numeric(5,2) not null default 75 check (watch_threshold between 0 and 100),
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, name, version)
);

create table if not exists public.kitchen_check_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.kitchen_check_templates(id) on delete cascade,
  title text not null,
  description text not null default '',
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  unique (template_id, sort_order)
);

create table if not exists public.kitchen_check_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.kitchen_check_templates(id) on delete cascade,
  section_id uuid not null references public.kitchen_check_sections(id) on delete cascade,
  subgroup text,
  title text not null,
  standard text not null default '',
  critical boolean not null default false,
  required boolean not null default true,
  max_points numeric(6,2) not null default 2 check (max_points >= 0),
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  unique (template_id, sort_order)
);

create table if not exists public.kitchen_check_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  template_id uuid not null references public.kitchen_check_templates(id) on delete restrict,
  template_version integer not null,
  cadence text not null check (cadence in ('daily', 'weekly')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed', 'reopened')),
  score numeric(10,2) not null default 0,
  max_score numeric(10,2) not null default 0,
  percentage numeric(7,2),
  result text not null default 'in_progress' check (result in ('in_progress', 'pass', 'watch', 'fail')),
  critical_fail boolean not null default false,
  answered_count integer not null default 0,
  required_count integer not null default 0,
  issue_count integer not null default 0,
  started_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_check_period_valid check (period_end >= period_start),
  unique (template_id, period_start)
);

create table if not exists public.kitchen_check_responses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.kitchen_check_runs(id) on delete cascade,
  item_id uuid not null references public.kitchen_check_items(id) on delete restrict,
  rating text check (rating is null or rating in ('green', 'amber', 'red', 'na')),
  points numeric(6,2),
  notes text not null default '',
  action_text text not null default '',
  action_owner_profile_id uuid references public.profiles(id) on delete set null,
  action_due_date date,
  evidence_paths text[] not null default '{}',
  manager_action_id uuid references public.manager_actions(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, item_id)
);

alter table public.manager_actions
  add column if not exists source_check_run_id uuid references public.kitchen_check_runs(id) on delete set null,
  add column if not exists source_check_response_id uuid references public.kitchen_check_responses(id) on delete set null;

create index if not exists kitchen_check_templates_site_idx
  on public.kitchen_check_templates(site_id, cadence, active);
create index if not exists kitchen_check_items_template_idx
  on public.kitchen_check_items(template_id, sort_order);
create index if not exists kitchen_check_runs_site_period_idx
  on public.kitchen_check_runs(site_id, period_start desc, cadence);
create index if not exists kitchen_check_runs_status_idx
  on public.kitchen_check_runs(organisation_id, status, period_start desc);
create index if not exists kitchen_check_responses_run_idx
  on public.kitchen_check_responses(run_id, item_id);
create index if not exists manager_actions_check_run_idx
  on public.manager_actions(source_check_run_id)
  where source_check_run_id is not null;

alter table public.kitchen_check_templates enable row level security;
alter table public.kitchen_check_sections enable row level security;
alter table public.kitchen_check_items enable row level security;
alter table public.kitchen_check_runs enable row level security;
alter table public.kitchen_check_responses enable row level security;

drop policy if exists kitchen_check_templates_read on public.kitchen_check_templates;
drop policy if exists kitchen_check_sections_read on public.kitchen_check_sections;
drop policy if exists kitchen_check_items_read on public.kitchen_check_items;
drop policy if exists kitchen_check_runs_read on public.kitchen_check_runs;
drop policy if exists kitchen_check_responses_read on public.kitchen_check_responses;

create policy kitchen_check_templates_read on public.kitchen_check_templates
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin', 'group_manager', 'finance', 'viewer')
    or exists (
      select 1 from public.site_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.site_id = kitchen_check_templates.site_id
    )
  )
);

create policy kitchen_check_sections_read on public.kitchen_check_sections
for select to authenticated
using (exists (
  select 1 from public.kitchen_check_templates template
  where template.id = kitchen_check_sections.template_id
));

create policy kitchen_check_items_read on public.kitchen_check_items
for select to authenticated
using (exists (
  select 1 from public.kitchen_check_templates template
  where template.id = kitchen_check_items.template_id
));

create policy kitchen_check_runs_read on public.kitchen_check_runs
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin', 'group_manager', 'finance', 'viewer')
    or exists (
      select 1 from public.site_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.site_id = kitchen_check_runs.site_id
    )
  )
);

create policy kitchen_check_responses_read on public.kitchen_check_responses
for select to authenticated
using (exists (
  select 1 from public.kitchen_check_runs run
  where run.id = kitchen_check_responses.run_id
));

grant select on table
  public.kitchen_check_templates,
  public.kitchen_check_sections,
  public.kitchen_check_items,
  public.kitchen_check_runs,
  public.kitchen_check_responses
  to authenticated;

create or replace function app_private.can_access_kitchen_check_site(target_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  select
    app_private.current_organisation_id() is not null
    and exists (
      select 1 from public.sites site
      where site.id = target_site
        and site.organisation_id = app_private.current_organisation_id()
    )
    and (
      app_private.current_app_role() in ('admin', 'group_manager')
      or exists (
        select 1 from public.site_memberships membership
        where membership.user_id = auth.uid()
          and membership.site_id = target_site
          and membership.can_submit
      )
    );
$$;

create or replace function public.start_kitchen_check(
  target_template uuid,
  target_period_start date
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  template_row public.kitchen_check_templates%rowtype;
  run_id uuid;
  target_period_end date;
begin
  if auth.uid() is null then raise exception 'Sign in before starting a kitchen check.'; end if;

  select template.* into template_row
  from public.kitchen_check_templates template
  where template.id = target_template
    and template.active
    and template.organisation_id = app_private.current_organisation_id();

  if template_row.id is null then raise exception 'Kitchen check template not found.'; end if;
  if not app_private.can_access_kitchen_check_site(template_row.site_id) then
    raise exception 'You cannot complete checks for that kitchen.';
  end if;
  if template_row.cadence = 'weekly' and extract(dow from target_period_start) <> 0 then
    raise exception 'Weekly checks must start on a Sunday.';
  end if;

  target_period_end := case when template_row.cadence = 'weekly' then target_period_start + 6 else target_period_start end;

  insert into public.kitchen_check_runs as run (
    organisation_id, site_id, template_id, template_version, cadence,
    period_start, period_end, status, started_by, required_count
  ) values (
    template_row.organisation_id,
    template_row.site_id,
    template_row.id,
    template_row.version,
    template_row.cadence,
    target_period_start,
    target_period_end,
    'draft',
    auth.uid(),
    (select count(*) from public.kitchen_check_items item where item.template_id = template_row.id and item.required)
  )
  on conflict (template_id, period_start) do update set updated_at = now()
  returning run.id into run_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    template_row.organisation_id,
    auth.uid(),
    'kitchen_check.started',
    'kitchen_check_run',
    run_id,
    jsonb_build_object('template_id', template_row.id, 'site_id', template_row.site_id, 'period_start', target_period_start)
  );

  return run_id;
end;
$$;

create or replace function public.save_kitchen_check(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  target_run uuid := (payload->>'runId')::uuid;
  intent text := coalesce(nullif(payload->>'intent', ''), 'draft');
  run_row public.kitchen_check_runs%rowtype;
  template_row public.kitchen_check_templates%rowtype;
  response_item jsonb;
  response_id uuid;
  response_rating text;
  owner_name text;
  owner_assignment uuid;
  calculated_score numeric := 0;
  calculated_max numeric := 0;
  calculated_percentage numeric;
  calculated_critical_fail boolean := false;
  calculated_answered integer := 0;
  calculated_required integer := 0;
  calculated_issues integer := 0;
  calculated_result text := 'in_progress';
  linked_action uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before saving a kitchen check.'; end if;
  if intent not in ('draft', 'submit') then raise exception 'Invalid kitchen check intent.'; end if;

  select run.* into run_row
  from public.kitchen_check_runs run
  where run.id = target_run
    and run.organisation_id = app_private.current_organisation_id()
  for update;

  if run_row.id is null then raise exception 'Kitchen check not found.'; end if;
  if run_row.status not in ('draft', 'reopened') then raise exception 'This kitchen check is already locked.'; end if;
  if not app_private.can_access_kitchen_check_site(run_row.site_id) then
    raise exception 'You cannot update checks for that kitchen.';
  end if;

  select template.* into template_row
  from public.kitchen_check_templates template
  where template.id = run_row.template_id;

  for response_item in
    select item.value from jsonb_array_elements(coalesce(payload->'responses', '[]'::jsonb)) as item(value)
  loop
    response_rating := nullif(lower(trim(response_item->>'rating')), '');
    if response_rating is not null and response_rating not in ('green', 'amber', 'red', 'na') then
      raise exception 'Invalid rating supplied.';
    end if;

    if not exists (
      select 1 from public.kitchen_check_items item
      where item.id = (response_item->>'itemId')::uuid
        and item.template_id = run_row.template_id
    ) then
      raise exception 'A response item is outside this kitchen check template.';
    end if;

    insert into public.kitchen_check_responses as response (
      run_id,
      item_id,
      rating,
      points,
      notes,
      action_text,
      action_owner_profile_id,
      action_due_date,
      evidence_paths,
      updated_by,
      updated_at
    ) values (
      target_run,
      (response_item->>'itemId')::uuid,
      response_rating,
      case response_rating when 'green' then 2 when 'amber' then 1 when 'red' then 0 else null end,
      left(coalesce(response_item->>'notes', ''), 4000),
      left(coalesce(response_item->>'actionText', ''), 1000),
      nullif(response_item->>'ownerProfileId', '')::uuid,
      nullif(response_item->>'dueDate', '')::date,
      coalesce(array(select jsonb_array_elements_text(coalesce(response_item->'evidencePaths', '[]'::jsonb))), '{}'),
      auth.uid(),
      now()
    )
    on conflict (run_id, item_id) do update set
      rating = excluded.rating,
      points = excluded.points,
      notes = excluded.notes,
      action_text = excluded.action_text,
      action_owner_profile_id = excluded.action_owner_profile_id,
      action_due_date = excluded.action_due_date,
      evidence_paths = excluded.evidence_paths,
      updated_by = excluded.updated_by,
      updated_at = now()
    returning response.id into response_id;
  end loop;

  select
    coalesce(sum(case when response.rating = 'na' then 0 else coalesce(response.points, 0) end), 0),
    coalesce(sum(case when response.rating = 'na' then 0 else item.max_points end), 0),
    count(*) filter (where response.rating is not null),
    count(*) filter (where item.required),
    count(*) filter (where response.rating in ('amber', 'red')),
    coalesce(bool_or(item.critical and response.rating = 'red'), false)
  into
    calculated_score,
    calculated_max,
    calculated_answered,
    calculated_required,
    calculated_issues,
    calculated_critical_fail
  from public.kitchen_check_items item
  left join public.kitchen_check_responses response
    on response.item_id = item.id and response.run_id = target_run
  where item.template_id = run_row.template_id;

  if calculated_max > 0 then
    calculated_percentage := round((calculated_score / calculated_max) * 100, 2);
  else
    calculated_percentage := null;
  end if;

  if intent = 'submit' then
    if exists (
      select 1
      from public.kitchen_check_items item
      left join public.kitchen_check_responses response
        on response.item_id = item.id and response.run_id = target_run
      where item.template_id = run_row.template_id
        and item.required
        and response.rating is null
    ) then
      raise exception 'Rate every required check before submitting.';
    end if;

    if template_row.require_actions and exists (
      select 1
      from public.kitchen_check_items item
      join public.kitchen_check_responses response
        on response.item_id = item.id and response.run_id = target_run
      where item.template_id = run_row.template_id
        and response.rating in ('amber', 'red')
        and (
          length(trim(response.notes)) = 0
          or length(trim(response.action_text)) = 0
          or response.action_owner_profile_id is null
          or response.action_due_date is null
        )
    ) then
      raise exception 'Every Amber or Red needs notes, an action, an owner and a deadline.';
    end if;

    calculated_result := case
      when calculated_critical_fail then 'fail'
      when calculated_percentage >= template_row.pass_threshold then 'pass'
      when calculated_percentage >= template_row.watch_threshold then 'watch'
      else 'fail'
    end;

    for response_id, response_rating in
      select response.id, response.rating
      from public.kitchen_check_responses response
      where response.run_id = target_run
        and response.rating in ('amber', 'red')
    loop
      select profile.full_name into owner_name
      from public.profiles profile
      join public.kitchen_check_responses response on response.action_owner_profile_id = profile.id
      where response.id = response_id
        and profile.organisation_id = run_row.organisation_id;

      if owner_name is null then raise exception 'An action owner is outside your organisation.'; end if;

      select assignment.id into owner_assignment
      from public.site_manager_assignments assignment
      join public.kitchen_check_responses response on response.action_owner_profile_id = assignment.manager_profile_id
      where response.id = response_id
        and assignment.site_id = run_row.site_id
        and assignment.ends_on is null
      order by assignment.starts_on desc
      limit 1;

      select response.manager_action_id into linked_action
      from public.kitchen_check_responses response
      where response.id = response_id;

      if linked_action is null then
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
          outcome,
          source_check_run_id,
          source_check_response_id
        )
        select
          run_row.organisation_id,
          response.action_owner_profile_id,
          run_row.site_id,
          owner_assignment,
          case when response.rating = 'red' then 'high' else 'medium' end,
          response.action_text,
          'Resolve the check issue and verify the standard is restored.',
          owner_name,
          response.action_due_date,
          'not_started',
          '',
          target_run,
          response.id
        from public.kitchen_check_responses response
        where response.id = response_id
        returning id into linked_action;

        update public.kitchen_check_responses response
        set manager_action_id = linked_action, updated_at = now()
        where response.id = response_id;
      else
        update public.manager_actions action
        set
          priority = case when response_rating = 'red' then 'high' else 'medium' end,
          action = response.action_text,
          owner = owner_name,
          manager_profile_id = response.action_owner_profile_id,
          due_date = response.action_due_date,
          updated_at = now()
        from public.kitchen_check_responses response
        where action.id = linked_action and response.id = response_id;
      end if;
    end loop;
  end if;

  update public.kitchen_check_runs run
  set
    status = case when intent = 'submit' then 'submitted' else run.status end,
    score = calculated_score,
    max_score = calculated_max,
    percentage = calculated_percentage,
    result = case when intent = 'submit' then calculated_result else 'in_progress' end,
    critical_fail = calculated_critical_fail,
    answered_count = calculated_answered,
    required_count = calculated_required,
    issue_count = calculated_issues,
    completed_by = case when intent = 'submit' then auth.uid() else run.completed_by end,
    submitted_at = case when intent = 'submit' then now() else run.submitted_at end,
    updated_at = now()
  where run.id = target_run;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    run_row.organisation_id,
    auth.uid(),
    case when intent = 'submit' then 'kitchen_check.submitted' else 'kitchen_check.saved' end,
    'kitchen_check_run',
    target_run,
    jsonb_build_object(
      'site_id', run_row.site_id,
      'percentage', calculated_percentage,
      'result', case when intent = 'submit' then calculated_result else 'in_progress' end,
      'critical_fail', calculated_critical_fail,
      'issue_count', calculated_issues
    )
  );

  return target_run;
end;
$$;

create or replace function public.review_kitchen_check(target_run uuid, notes text default '')
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if auth.uid() is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can review kitchen checks.';
  end if;

  update public.kitchen_check_runs run
  set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = left(trim(coalesce(notes, '')), 4000), updated_at = now()
  where run.id = target_run
    and run.organisation_id = org
    and run.status = 'submitted';

  if not found then raise exception 'Only a submitted kitchen check can be reviewed.'; end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, auth.uid(), 'kitchen_check.reviewed', 'kitchen_check_run', target_run,
    jsonb_build_object('notes_recorded', length(trim(coalesce(notes, ''))) > 0));
end;
$$;

revoke all on function app_private.can_access_kitchen_check_site(uuid) from public, anon, authenticated;
revoke all on function public.start_kitchen_check(uuid, date) from public, anon;
revoke all on function public.save_kitchen_check(jsonb) from public, anon;
revoke all on function public.review_kitchen_check(uuid, text) from public, anon;

grant execute on function public.start_kitchen_check(uuid, date) to authenticated;
grant execute on function public.save_kitchen_check(jsonb) to authenticated;
grant execute on function public.review_kitchen_check(uuid, text) to authenticated;

commit;

-- Optional UAT seed for performance focus areas and initial actions.
-- Launch order: invite managers -> assign kitchens -> run this seed.
--
-- This script never creates a second Scott/Warren identity. profiles.id is the
-- canonical person UUID and site_manager_assignments supplies the kitchen.

insert into public.manager_details (
  profile_id,
  organisation_id,
  role_title,
  employment_start_date,
  focus_areas
)
select
  p.id,
  p.organisation_id,
  'Kitchen Manager',
  template.start_date,
  template.focus_areas
from public.profiles p
join (values
  (
    'Scott Hutton',
    date '2026-06-15',
    array[
      'Product quality', 'Dough and flour testing', 'Menu development',
      'Greek concept development', 'Specs and costings', 'Product documentation',
      'Team quality training'
    ]::text[]
  ),
  (
    'Warren Raisbeck',
    date '2026-05-01',
    array[
      'Operational ownership', 'Stock taking', 'Procure Wizard', 'GP and waste',
      'Reporting', 'SOPs', 'Close-down standards', 'Compliance',
      'Team accountability'
    ]::text[]
  )
) as template(full_name, start_date, focus_areas)
  on lower(trim(template.full_name)) = lower(trim(p.full_name))
where p.role = 'kitchen_manager'
on conflict (profile_id) do update set
  role_title = excluded.role_title,
  employment_start_date = excluded.employment_start_date,
  focus_areas = excluded.focus_areas,
  updated_at = now();

with action_templates as (
  select 'Scott Hutton'::text as full_name, action
  from unnest(array[
    'Complete flour testing with documented results',
    'Rework the chicken product',
    'Rework the Chicken Parm using vodka sauce',
    'Develop lasagne-style bites to replace the current mac and cheese bites',
    'Document approved trials with recipes, yields, portions, costings and photos',
    'Learn the weekly reporting flow'
  ]) as action
  union all
  select 'Warren Raisbeck'::text as full_name, action
  from unnest(array[
    'Complete Monday stock take',
    'Export the original CSV without renaming the file',
    'Only edit the required stock figures',
    'Chase outstanding Procure Wizard supplier credits',
    'Copy Chris into supplier credit emails',
    'Trial an in-house breaded chicken breast for the Chicken Parm',
    'Support the move from sugo to vodka sauce',
    'Continue the Dough Religion specification and SOP book'
  ]) as action
), canonical_assignments as (
  select
    p.id as profile_id,
    p.organisation_id,
    p.full_name,
    a.id as assignment_id,
    a.site_id
  from public.profiles p
  join public.site_manager_assignments a
    on a.manager_profile_id = p.id
   and a.ends_on is null
  where p.role = 'kitchen_manager'
)
insert into public.manager_actions (
  organisation_id,
  manager_profile_id,
  site_id,
  assignment_id,
  priority,
  action,
  owner,
  status
)
select
  c.organisation_id,
  c.profile_id,
  c.site_id,
  c.assignment_id,
  'high',
  t.action,
  c.full_name,
  'not_started'
from canonical_assignments c
join action_templates t
  on lower(trim(t.full_name)) = lower(trim(c.full_name))
where not exists (
  select 1
  from public.manager_actions existing
  where existing.manager_profile_id = c.profile_id
    and lower(trim(existing.action)) = lower(trim(t.action))
);

-- A fresh database can apply this seed successfully while creating nothing if
-- the canonical manager profiles and assignments do not exist yet. Report the
-- result loudly so launch setup cannot silently produce an empty workspace.
do $$
declare
  manager_count integer;
  assignment_count integer;
  action_count integer;
begin
  select count(*) into manager_count from public.profiles where role = 'kitchen_manager';
  select count(*) into assignment_count from public.site_manager_assignments where ends_on is null;
  select count(*) into action_count from public.manager_actions;

  raise notice 'seed_performance: % kitchen manager profile(s), % open assignment(s), % focus action(s).',
    manager_count, assignment_count, action_count;

  if assignment_count = 0 then
    raise warning 'seed_performance: no manager assignments exist, so no focus actions were seeded. Invite Scott and Warren from People & access, assign their kitchens, then re-run this seed.';
  end if;
end;
$$;

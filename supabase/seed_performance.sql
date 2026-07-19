-- Seed the initial Kitchen Manager records and their agreed focus actions.
-- Run once per environment after migration 011. Managers are data, not code:
-- add future managers with plain inserts or the forthcoming admin screen.

with org as (select id from public.organisations limit 1),
     dough as (select id from public.sites where code = 'DR' limit 1)
insert into public.managers (organisation_id, site_id, full_name, role_title, start_date, focus_areas)
select org.id, dough.id, manager.full_name, 'Kitchen Manager', manager.start_date, manager.focus
from org, dough, (values
  ('Scott Hutton', date '2026-06-15', array[
    'Product quality', 'Dough and flour testing', 'Menu development',
    'Greek concept development', 'Specs and costings', 'Product documentation', 'Team quality training']),
  ('Warren Raisbeck', date '2026-05-01', array[
    'Operational ownership', 'Stock taking', 'Procure Wizard', 'GP and waste',
    'Reporting', 'SOPs', 'Close-down standards', 'Compliance', 'Team accountability'])
) as manager (full_name, start_date, focus)
on conflict do nothing;

with scott as (select id, organisation_id from public.managers where full_name = 'Scott Hutton' limit 1)
insert into public.manager_actions (organisation_id, manager_id, priority, action, owner, status)
select scott.organisation_id, scott.id, 'high', action, 'Scott Hutton', 'not_started'
from scott, unnest(array[
  'Complete flour testing with documented results',
  'Rework the chicken product',
  'Rework the Chicken Parm using vodka sauce',
  'Develop lasagne-style bites to replace the current mac and cheese bites',
  'Document approved trials with recipes, yields, portions, costings and photos',
  'Learn the weekly reporting flow'
]) as action
on conflict do nothing;

with warren as (select id, organisation_id from public.managers where full_name = 'Warren Raisbeck' limit 1)
insert into public.manager_actions (organisation_id, manager_id, priority, action, owner, status)
select warren.organisation_id, warren.id, 'high', action, 'Warren Raisbeck', 'not_started'
from warren, unnest(array[
  'Complete Monday stock take',
  'Export the original CSV without renaming the file',
  'Only edit the required stock figures',
  'Chase outstanding Procure Wizard supplier credits',
  'Copy Chris into supplier credit emails',
  'Trial an in-house breaded chicken breast for the Chicken Parm',
  'Support the move from sugo to vodka sauce',
  'Continue the Dough Religion specification and SOP book'
]) as action
on conflict do nothing;

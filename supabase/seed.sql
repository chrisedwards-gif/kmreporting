-- Local/demo configuration. Create Auth users separately, then add profiles and site memberships.
insert into public.organisations (id, name, timezone)
values ('00000000-0000-4000-8000-000000000000', 'House of Social', 'Europe/London')
on conflict (id) do nothing;

insert into public.sites (id, organisation_id, code, name, active, food_cost_target, labour_target, waste_target, reporting_start_date, reporting_end_date)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000', 'DR-MCR', 'Dough Religion', true, 30, 32, 1.2, '2026-07-06', null),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000000', 'CW-MCR', 'Choi Wan', true, 31, 32, 1.2, '2026-07-06', null),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000000', 'KAR-MCR', 'Kardia', true, 30.5, 33, 1.2, '2026-07-06', null),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000000', 'ANT-MCR', 'Antoma', false, 30, 32, 1.2, '2000-01-01', '2000-01-01'),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000000', 'BB-MCR', 'Bombay Bird', false, 30, 32, 1.2, '2000-01-01', '2000-01-01')
on conflict (id) do update set name = excluded.name, active = excluded.active;

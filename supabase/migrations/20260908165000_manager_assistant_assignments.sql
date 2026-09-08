begin;

alter table public.site_manager_assignments
  add column if not exists assignment_role text not null default 'primary';

alter table public.site_manager_assignments
  drop constraint if exists site_manager_assignments_assignment_role_check;

alter table public.site_manager_assignments
  add constraint site_manager_assignments_assignment_role_check
  check (assignment_role in ('primary', 'assistant'));

drop index if exists public.site_manager_one_current_idx;

create unique index if not exists site_manager_one_current_primary_idx
  on public.site_manager_assignments(site_id)
  where ends_on is null and assignment_role = 'primary';

create unique index if not exists site_manager_one_current_person_site_idx
  on public.site_manager_assignments(site_id, manager_profile_id)
  where ends_on is null;

comment on column public.site_manager_assignments.assignment_role is
  'primary owns the kitchen reporting relationship; assistant participates in weekly 1-1s without replacing the primary KM.';

commit;

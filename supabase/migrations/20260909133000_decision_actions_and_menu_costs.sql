alter table public.manager_actions
  add column if not exists source_decision_signal_id uuid references public.weekly_decision_signals(id) on delete set null;

create unique index if not exists manager_actions_source_decision_signal_idx
  on public.manager_actions(source_decision_signal_id)
  where source_decision_signal_id is not null;

create table if not exists public.menu_item_costs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  item_name text not null,
  item_key text not null,
  unit_food_cost numeric not null check (unit_food_cost >= 0),
  source_system text not null default 'manual',
  source_reference text not null default '',
  valid_from date not null,
  valid_to date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists menu_item_costs_lookup_idx
  on public.menu_item_costs(site_id,item_key,valid_from desc);

create unique index if not exists menu_item_costs_period_idx
  on public.menu_item_costs(site_id,item_key,valid_from);

alter table public.menu_item_costs enable row level security;

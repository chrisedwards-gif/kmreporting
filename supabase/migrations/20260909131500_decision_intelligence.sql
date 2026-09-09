create table if not exists public.weekly_decision_signals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  week_start date not null,
  site_id uuid references public.sites(id) on delete cascade,
  scope text not null check (scope in ('site','group')),
  category text not null check (category in ('sales','menu','pricing','labour','food_cost','waste','procurement','reconciliation','data_quality')),
  signal_key text not null,
  severity text not null check (severity in ('opportunity','watch','risk','info')),
  title text not null,
  finding text not null,
  recommendation text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence smallint not null check (confidence between 0 and 100),
  estimated_weekly_impact numeric,
  impact_direction text check (impact_direction in ('revenue','saving','margin','service','none')),
  source_hash text not null,
  status text not null default 'open' check (status in ('open','accepted','dismissed','measuring','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, week_start, scope, site_id, signal_key, source_hash)
);

create index if not exists weekly_decision_signals_lookup_idx
  on public.weekly_decision_signals (organisation_id, week_start, site_id, severity, confidence desc);

alter table public.weekly_decision_signals enable row level security;

create table if not exists public.hourly_labour_metrics (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  slot_time time not null,
  interval_minutes smallint not null default 60 check (interval_minutes in (15,30,60)),
  staffed_hours numeric not null default 0 check (staffed_hours >= 0),
  staff_count numeric not null default 0 check (staff_count >= 0),
  hourly_cost numeric not null default 0 check (hourly_cost >= 0),
  source_system text not null default 'rotacloud',
  source_reference text not null default '',
  imported_at timestamptz not null default now(),
  unique (organisation_id, site_id, business_date, slot_time, interval_minutes, source_system)
);

create index if not exists hourly_labour_metrics_site_date_idx
  on public.hourly_labour_metrics(site_id,business_date,slot_time);

alter table public.hourly_labour_metrics enable row level security;

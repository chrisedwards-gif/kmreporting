create table if not exists public.weekly_upload_batches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  batch_kind text not null check (batch_kind in ('site','group')),
  status text not null default 'open' check (status in ('open','processing','ready','error','archived')),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (week_end = week_start + 6),
  check ((batch_kind = 'site' and site_id is not null) or (batch_kind = 'group' and site_id is null))
);

create index if not exists weekly_upload_batches_lookup_idx on public.weekly_upload_batches (organisation_id, week_start, batch_kind, site_id);

create table if not exists public.weekly_upload_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.weekly_upload_batches(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  content_type text not null default 'application/octet-stream',
  byte_size bigint not null default 0 check (byte_size >= 0),
  sha256 text not null,
  classification text not null default 'supporting',
  parse_status text not null default 'pending' check (parse_status in ('pending','parsed','unrecognised','error')),
  site_hint text,
  period_start date,
  period_end date,
  parsed_summary jsonb not null default '{}'::jsonb,
  parse_error text not null default '',
  uploaded_at timestamptz not null default now(),
  unique (batch_id, sha256)
);

create index if not exists weekly_upload_files_batch_idx on public.weekly_upload_files (batch_id, classification, parse_status);

create table if not exists public.weekly_master_metrics (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.weekly_upload_batches(id) on delete cascade,
  source_file_id uuid references public.weekly_upload_files(id) on delete set null,
  site_id uuid not null references public.sites(id) on delete cascade,
  metric_key text not null,
  numeric_value numeric not null,
  created_at timestamptz not null default now(),
  unique (batch_id, site_id, metric_key)
);

create table if not exists public.weekly_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  week_start date not null,
  site_id uuid not null references public.sites(id) on delete cascade,
  report_id uuid references public.weekly_reports(id) on delete set null,
  master_batch_id uuid references public.weekly_upload_batches(id) on delete set null,
  metric_key text not null,
  site_value numeric,
  master_value numeric,
  variance numeric,
  variance_pct numeric,
  status text not null check (status in ('match','warning','missing_site','missing_master')),
  checked_at timestamptz not null default now(),
  unique (organisation_id, week_start, site_id, metric_key)
);

create table if not exists public.weekly_ai_insights (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  week_start date not null,
  site_id uuid references public.sites(id) on delete cascade,
  scope text not null check (scope in ('site','group')),
  source_hash text not null,
  provider text not null,
  model text not null,
  insight jsonb not null default '{}'::jsonb,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (organisation_id, week_start, scope, site_id, source_hash)
);

alter table public.weekly_upload_batches enable row level security;
alter table public.weekly_upload_files enable row level security;
alter table public.weekly_master_metrics enable row level security;
alter table public.weekly_reconciliations enable row level security;
alter table public.weekly_ai_insights enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'weekly-report-packs',
  'weekly-report-packs',
  false,
  26214400,
  array[
    'text/csv','text/plain','text/html','application/pdf','application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

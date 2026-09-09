alter table public.sites
  add column if not exists master_sales_expected boolean not null default true,
  add column if not exists master_purchasing_expected boolean not null default true,
  add column if not exists master_labour_expected boolean not null default true;

-- Choi Wan does not use Procure Wizard for purchasing and does not use the
-- group RotaCloud feed. Its KM submission remains the source of truth for
-- those metrics, while Access/StockLink sales are still independently checked.
update public.sites
set
  master_purchasing_expected = false,
  master_labour_expected = false
where lower(name) = 'choi wan' or upper(code) = 'CW-MCR';

create table if not exists public.external_brand_weekly_sales (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  brand_key text not null,
  brand_name text not null,
  source_file_id uuid references public.weekly_upload_files(id) on delete set null,
  gross_sales numeric,
  vat numeric,
  service_charge numeric,
  net_sales numeric not null,
  sales_insights jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  check (week_end = week_start + 6),
  unique (organisation_id, week_start, brand_key)
);

create index if not exists external_brand_weekly_sales_lookup_idx
  on public.external_brand_weekly_sales (organisation_id, week_start desc, brand_key);

alter table public.external_brand_weekly_sales enable row level security;

create policy external_brand_weekly_sales_group_read
on public.external_brand_weekly_sales
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and (select app_private.current_app_role()) in ('admin'::public.app_role, 'group_manager'::public.app_role)
);

-- Rota intelligence learning loop
--
-- Stores aggregate scheduled/actual labour and manager shift feedback without
-- exposing individual wage data to kitchen-facing views.

begin;

create table public.rota_daily_labour_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  scheduled_hours numeric(10,2) not null default 0 check (scheduled_hours >= 0),
  scheduled_hourly_cost numeric(14,2) not null default 0 check (scheduled_hourly_cost >= 0),
  actual_hours numeric(10,2) not null default 0 check (actual_hours >= 0),
  actual_hourly_cost numeric(14,2) not null default 0 check (actual_hourly_cost >= 0),
  salary_cost_allocated numeric(14,2) not null default 0 check (salary_cost_allocated >= 0),
  scheduled_shift_count integer not null default 0 check (scheduled_shift_count >= 0),
  actual_shift_count integer not null default 0 check (actual_shift_count >= 0),
  source_system text not null check (length(trim(source_system)) between 2 and 80),
  source_reference text not null default '' check (length(source_reference) <= 250),
  imported_at timestamptz not null default now(),
  unique (site_id, business_date, source_system)
);

create table public.rota_shift_feedback (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  business_date date not null,
  staffing_rating text not null check (
    staffing_rating in ('very_under', 'slightly_under', 'about_right', 'slightly_over', 'very_over')
  ),
  affected_periods text[] not null default '{}'::text[],
  causes text[] not null default '{}'::text[],
  service_impact text not null default 'none' check (service_impact in ('none', 'minor', 'major')),
  left_early_count smallint not null default 0 check (left_early_count between 0 and 50),
  stayed_late_count smallint not null default 0 check (stayed_late_count between 0 and 50),
  absence_count smallint not null default 0 check (absence_count between 0 and 50),
  would_repeat boolean,
  notes text not null default '' check (length(notes) <= 2000),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, business_date, submitted_by)
);

create index rota_daily_labour_history_site_date_idx
  on public.rota_daily_labour_history(site_id, business_date desc);
create index rota_shift_feedback_site_date_idx
  on public.rota_shift_feedback(site_id, business_date desc);
create index rota_shift_feedback_submitted_by_idx
  on public.rota_shift_feedback(submitted_by, business_date desc);

alter table public.rota_daily_labour_history enable row level security;
alter table public.rota_shift_feedback enable row level security;

grant select on public.rota_daily_labour_history to authenticated;
grant select on public.rota_shift_feedback to authenticated;
grant select, insert, update, delete on public.rota_daily_labour_history to service_role;
grant select, insert, update, delete on public.rota_shift_feedback to service_role;

create policy rota_daily_labour_history_read
on public.rota_daily_labour_history
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

create policy rota_shift_feedback_read
on public.rota_shift_feedback
for select to authenticated
using (
  organisation_id = (select app_private.current_organisation_id())
  and app_private.can_read_site(site_id)
);

create or replace function public.import_rota_labour_metrics(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  organisation uuid := (payload->>'organisationId')::uuid;
  target_site uuid := (payload->>'siteId')::uuid;
  source_name text := trim(payload->>'sourceSystem');
  item jsonb;
begin
  if not exists (
    select 1 from public.sites
    where id = target_site and organisation_id = organisation
  ) then
    raise exception 'site mismatch';
  end if;

  if source_name is null or length(source_name) < 2 then
    raise exception 'source system required';
  end if;

  for item in
    select value from jsonb_array_elements(coalesce(payload->'days', '[]'::jsonb))
  loop
    insert into public.rota_daily_labour_history (
      organisation_id,
      site_id,
      business_date,
      scheduled_hours,
      scheduled_hourly_cost,
      actual_hours,
      actual_hourly_cost,
      salary_cost_allocated,
      scheduled_shift_count,
      actual_shift_count,
      source_system,
      source_reference,
      imported_at
    ) values (
      organisation,
      target_site,
      (item->>'businessDate')::date,
      greatest(coalesce((item->>'scheduledHours')::numeric, 0), 0),
      greatest(coalesce((item->>'scheduledHourlyCost')::numeric, 0), 0),
      greatest(coalesce((item->>'actualHours')::numeric, 0), 0),
      greatest(coalesce((item->>'actualHourlyCost')::numeric, 0), 0),
      greatest(coalesce((item->>'salaryCostAllocated')::numeric, 0), 0),
      greatest(coalesce((item->>'scheduledShiftCount')::integer, 0), 0),
      greatest(coalesce((item->>'actualShiftCount')::integer, 0), 0),
      source_name,
      left(coalesce(item->>'sourceReference', ''), 250),
      now()
    )
    on conflict (site_id, business_date, source_system) do update set
      scheduled_hours = excluded.scheduled_hours,
      scheduled_hourly_cost = excluded.scheduled_hourly_cost,
      actual_hours = excluded.actual_hours,
      actual_hourly_cost = excluded.actual_hourly_cost,
      salary_cost_allocated = excluded.salary_cost_allocated,
      scheduled_shift_count = excluded.scheduled_shift_count,
      actual_shift_count = excluded.actual_shift_count,
      source_reference = excluded.source_reference,
      imported_at = now();
  end loop;

  insert into public.audit_log (
    organisation_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    detail
  ) values (
    organisation,
    null,
    'rota.labour_history_imported',
    'site',
    target_site,
    jsonb_build_object(
      'source_system', source_name,
      'row_count', jsonb_array_length(coalesce(payload->'days', '[]'::jsonb))
    )
  );
end;
$$;

revoke all on function public.import_rota_labour_metrics(jsonb) from public, anon, authenticated;
grant execute on function public.import_rota_labour_metrics(jsonb) to service_role;

commit;

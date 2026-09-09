create or replace function public.ingest_hourly_labour_from_weekly_file()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  batch_row public.weekly_upload_batches%rowtype;
  item jsonb;
begin
  if new.classification <> 'rotacloud_labour' or new.parse_status <> 'parsed' then return new; end if;
  if not (new.parsed_summary ? 'hourlyLabour') then return new; end if;
  select * into batch_row from public.weekly_upload_batches where id = new.batch_id;
  if not found or batch_row.site_id is null then return new; end if;

  for item in select value from jsonb_array_elements(coalesce(new.parsed_summary->'hourlyLabour','[]'::jsonb)) loop
    if coalesce(item->>'businessDate','') = '' or coalesce(item->>'slotTime','') = '' then continue; end if;
    insert into public.hourly_labour_metrics (
      organisation_id, site_id, business_date, slot_time, interval_minutes,
      staffed_hours, staff_count, hourly_cost, source_system, source_reference, imported_at
    ) values (
      batch_row.organisation_id,
      batch_row.site_id,
      (item->>'businessDate')::date,
      (item->>'slotTime')::time,
      60,
      greatest(coalesce((item->>'staffedHours')::numeric,0),0),
      greatest(coalesce((item->>'staffCount')::numeric,0),0),
      greatest(coalesce((item->>'hourlyCost')::numeric,0),0),
      'rotacloud_weekly_pack',
      left(new.file_name || ':' || left(new.sha256,16),250),
      now()
    )
    on conflict (organisation_id, site_id, business_date, slot_time, interval_minutes, source_system)
    do update set
      staffed_hours = excluded.staffed_hours,
      staff_count = excluded.staff_count,
      hourly_cost = excluded.hourly_cost,
      source_reference = excluded.source_reference,
      imported_at = now();
  end loop;
  return new;
end;
$$;

drop trigger if exists weekly_upload_file_hourly_labour on public.weekly_upload_files;
create trigger weekly_upload_file_hourly_labour
after insert or update of parsed_summary, parse_status, classification on public.weekly_upload_files
for each row execute function public.ingest_hourly_labour_from_weekly_file();

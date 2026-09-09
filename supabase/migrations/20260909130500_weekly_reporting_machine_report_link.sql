alter table public.weekly_upload_batches
  add column if not exists report_id uuid references public.weekly_reports(id) on delete set null;

create index if not exists weekly_upload_batches_report_idx
  on public.weekly_upload_batches(report_id)
  where report_id is not null;

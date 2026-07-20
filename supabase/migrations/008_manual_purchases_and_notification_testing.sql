-- Structured off-system purchases (shop top-ups, emergency buys, local cash/card
-- purchases) are stored separately and included in the safe weekly food total.

begin;

create table if not exists public.report_manual_purchases (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  description text not null check (length(trim(description)) between 2 and 120),
  amount numeric(14,2) not null check (amount > 0),
  receipt_reference text not null default '' check (length(receipt_reference) <= 120),
  added_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists manual_purchases_report_idx on public.report_manual_purchases (report_id);
alter table public.report_manual_purchases enable row level security;
drop policy if exists manual_purchases_read on public.report_manual_purchases;
create policy manual_purchases_read on public.report_manual_purchases for select to authenticated
using (exists (
  select 1 from public.weekly_reports report
  where report.id = report_id and app_private.can_access_site(report.site_id)
));

create or replace function public.save_weekly_report_v2(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  report uuid;
  item jsonb;
  item_description text;
  item_reference text;
  item_amount numeric;
  manual_total numeric := 0;
  item_count integer := 0;
  report_row public.weekly_reports%rowtype;
begin
  report := public.save_weekly_report(payload);
  select * into report_row from public.weekly_reports where id = report;
  if not found or not app_private.can_access_site(report_row.site_id) then raise exception 'report access denied'; end if;

  delete from public.report_manual_purchases where report_id = report;
  for item in select value from jsonb_array_elements(coalesce(payload->'manualPurchases', '[]'::jsonb)) loop
    item_description := trim(coalesce(item->>'description', ''));
    item_reference := trim(coalesce(item->>'receiptReference', ''));
    item_amount := coalesce((item->>'amount')::numeric, 0);
    if length(item_description) < 2 or length(item_description) > 120 then raise exception 'invalid manual purchase description'; end if;
    if length(item_reference) > 120 then raise exception 'invalid manual purchase reference'; end if;
    if item_amount <= 0 then raise exception 'manual purchase amount must be positive'; end if;
    insert into public.report_manual_purchases (report_id, description, amount, receipt_reference, added_by)
    values (report, item_description, item_amount, item_reference, auth.uid());
    manual_total := manual_total + item_amount;
    item_count := item_count + 1;
  end loop;

  update public.report_source_values
  set purchases = purchases + manual_total, updated_at = now()
  where report_id = report;

  if item_count > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
    values (report_row.organisation_id, auth.uid(), 'report.manual_purchases_recorded', 'weekly_report', report,
      jsonb_build_object('item_count', item_count, 'total', manual_total));
  end if;
  return report;
end;
$$;

revoke all on function public.save_weekly_report_v2(jsonb) from public, anon;
grant execute on function public.save_weekly_report_v2(jsonb) to authenticated;

commit;

-- Make salary snapshot refresh safe for INSERT, UPDATE and DELETE operations.

begin;

create or replace function app_private.refresh_salary_cost_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  affected_site uuid;
  affected_start date;
  affected_end date;
  target_report uuid;
begin
  if tg_op = 'DELETE' then
    affected_site := old.site_id;
    affected_start := old.valid_from;
    affected_end := coalesce(old.valid_to, '9999-12-31'::date);
  elsif tg_op = 'INSERT' then
    affected_site := new.site_id;
    affected_start := new.valid_from;
    affected_end := coalesce(new.valid_to, '9999-12-31'::date);
  else
    affected_site := new.site_id;
    affected_start := least(old.valid_from, new.valid_from);
    affected_end := greatest(coalesce(old.valid_to, '9999-12-31'::date), coalesce(new.valid_to, '9999-12-31'::date));
  end if;

  for target_report in
    select report.id
    from public.weekly_reports report
    join public.reporting_periods period on period.id = report.period_id
    where report.site_id = affected_site
      and period.week_end >= affected_start
      and period.week_start <= affected_end
  loop
    perform public.recalculate_report_costs(target_report);
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

commit;

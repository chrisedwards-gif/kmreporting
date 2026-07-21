-- Safe aggregate inputs for the weekly report form.
-- Kitchen Managers can see the waste total and aggregate salary accrual applied
-- to their site, but never individual salary records or annual pay values.

begin;

create or replace function public.get_report_support_summary(
  target_site uuid,
  range_start date,
  range_end date,
  target_report uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
declare
  organisation uuid := app_private.current_organisation_id();
  target public.sites%rowtype;
  waste_total numeric := 0;
  waste_count integer := 0;
  salary_base numeric := 0;
  salary_oncost numeric := 0;
  salary_total numeric := 0;
begin
  if auth.uid() is null or not app_private.can_read_site(target_site) then
    raise exception 'site access denied';
  end if;
  if range_start is null or range_end is null or range_end < range_start or range_end - range_start > 31 then
    raise exception 'invalid report support range';
  end if;

  select * into target
  from public.sites
  where id = target_site and organisation_id = organisation;
  if not found then raise exception 'site not found'; end if;

  select coalesce(sum(entry.estimated_cost), 0), count(*)
  into waste_total, waste_count
  from public.waste_log_entries entry
  where entry.organisation_id = organisation
    and entry.site_id = target_site
    and entry.business_date between range_start and range_end
    and (entry.report_id is null or entry.report_id = target_report);

  if target.include_salary_costs then
    select base_cost, oncost_cost, total_cost
    into salary_base, salary_oncost, salary_total
    from app_private.salary_cost_for_period(organisation, target_site, range_start, range_end);
  end if;

  return jsonb_build_object(
    'wasteTotal', waste_total,
    'wasteEntryCount', waste_count,
    'salariesIncluded', target.include_salary_costs,
    'salaryBaseCost', salary_base,
    'salaryOncostCost', salary_oncost,
    'salaryTotalCost', salary_total
  );
end;
$$;

revoke all on function public.get_report_support_summary(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_report_support_summary(uuid, date, date, uuid) to authenticated;

commit;

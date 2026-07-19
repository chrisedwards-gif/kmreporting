-- The launch workflow uses aggregate site-level labour totals from RotaCloud or
-- confirmed manual entry. Employee-level pay-rate ingestion is deliberately
-- disabled until HR, DPO and finance approve a separate restricted integration.

begin;

create or replace function public.import_private_cost_data(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  raise exception 'Private payroll connector is not enabled. Use confirmed aggregate labour imports.';
end;
$$;

revoke all on function public.import_private_cost_data(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_private_cost_data(jsonb)
  to service_role;

commit;

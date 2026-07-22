-- Atomic admin-only updates for forecast calibration and day-level operating
-- rules. The browser never writes these control tables directly.

begin;

create or replace function public.save_rota_site_configuration_private(
  target_organisation uuid,
  target_site uuid,
  target_actor uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  actor_role public.app_role;
  rule jsonb;
begin
  select profile.role into actor_role
  from public.profiles profile
  where profile.id = target_actor
    and profile.organisation_id = target_organisation
    and profile.active;
  if actor_role not in ('admin', 'group_manager') then raise exception 'rota configuration access denied'; end if;
  if not exists (select 1 from public.sites site where site.id = target_site and site.organisation_id = target_organisation) then raise exception 'site not found'; end if;

  insert into public.rota_site_settings (
    site_id, organisation_id, forecast_weeks, minimum_history_weeks,
    interval_minutes, sales_per_labour_hour_target, minimum_rest_hours,
    active, updated_by, updated_at
  ) values (
    target_site, target_organisation, (payload->>'forecastWeeks')::smallint,
    (payload->>'minimumHistoryWeeks')::smallint, (payload->>'intervalMinutes')::smallint,
    (payload->>'salesPerLabourHourTarget')::numeric, (payload->>'minimumRestHours')::numeric,
    true, target_actor, now()
  )
  on conflict (site_id) do update set
    forecast_weeks = excluded.forecast_weeks,
    minimum_history_weeks = excluded.minimum_history_weeks,
    interval_minutes = excluded.interval_minutes,
    sales_per_labour_hour_target = excluded.sales_per_labour_hour_target,
    minimum_rest_hours = excluded.minimum_rest_hours,
    active = true,
    updated_by = excluded.updated_by,
    updated_at = now();

  for rule in select value from jsonb_array_elements(coalesce(payload->'dayRules', '[]'::jsonb)) loop
    insert into public.rota_day_rules (
      organisation_id, site_id, weekday, open_time, close_time, prep_minutes,
      close_minutes, minimum_staff, maximum_staff, required_skills, trading, updated_at
    ) values (
      target_organisation, target_site, (rule->>'weekday')::smallint,
      (rule->>'openTime')::time, (rule->>'closeTime')::time,
      (rule->>'prepMinutes')::smallint, (rule->>'closeMinutes')::smallint,
      (rule->>'minimumStaff')::smallint, (rule->>'maximumStaff')::smallint,
      coalesce(array(select jsonb_array_elements_text(coalesce(rule->'requiredSkills', '[]'::jsonb))), '{}'::text[]),
      (rule->>'trading')::boolean, now()
    ) on conflict (site_id, weekday) do update set
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      prep_minutes = excluded.prep_minutes,
      close_minutes = excluded.close_minutes,
      minimum_staff = excluded.minimum_staff,
      maximum_staff = excluded.maximum_staff,
      required_skills = excluded.required_skills,
      trading = excluded.trading,
      updated_at = now();
  end loop;

  if (select count(*) from jsonb_array_elements(coalesce(payload->'dayRules', '[]'::jsonb))) <> 7 then
    raise exception 'all seven day rules are required';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (target_organisation, target_actor, 'rota.site_configuration_saved', 'site', target_site,
    jsonb_build_object('sales_per_labour_hour_target', payload->'salesPerLabourHourTarget',
      'forecast_weeks', payload->'forecastWeeks', 'minimum_rest_hours', payload->'minimumRestHours'));
end;
$$;

revoke all on function public.save_rota_site_configuration_private(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_rota_site_configuration_private(uuid, uuid, uuid, jsonb) to service_role;

commit;

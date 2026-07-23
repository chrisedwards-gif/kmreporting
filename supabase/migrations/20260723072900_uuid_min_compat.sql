-- Temporary compatibility aggregate used by the immediately following
-- unambiguous rota-identity name backfill. PostgreSQL has no built-in min(uuid).

begin;

create or replace function app_private.uuid_min_state(current_value uuid, candidate uuid)
returns uuid
language sql
immutable
parallel safe
as $$
  select case
    when current_value is null then candidate
    when candidate is null then current_value
    when candidate::text < current_value::text then candidate
    else current_value
  end;
$$;

create aggregate public.min(uuid) (
  sfunc = app_private.uuid_min_state,
  stype = uuid,
  combinefunc = app_private.uuid_min_state,
  parallel = safe
);

commit;

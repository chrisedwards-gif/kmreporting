-- The rota identity backfill is complete; remove the temporary compatibility
-- aggregate so the application does not permanently extend public.min.

begin;

drop aggregate if exists public.min(uuid);
drop function if exists app_private.uuid_min_state(uuid, uuid);

commit;

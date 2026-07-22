-- Production fixes 015: make the manager acknowledgement RPC explicit,
-- diagnosable and safe to retry from the client workflow.

begin;

alter table public.one_to_one_reviews
  add column if not exists acknowledged_by uuid references public.profiles(id) on delete set null,
  add column if not exists manager_response text not null default '';

drop function if exists public.acknowledge_one_to_one(uuid);

create or replace function public.acknowledge_one_to_one(
  target_review uuid,
  response text default ''
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  actor_role text := app_private.current_app_role();
  review_status text;
  review_manager uuid;
begin
  if actor is null or org is null then
    raise exception 'Sign in again before acknowledging this review.';
  end if;

  select review.status, review.manager_profile_id
    into review_status, review_manager
    from public.one_to_one_reviews review
   where review.id = target_review
     and review.organisation_id = org;

  if not found then
    raise exception 'The review was not found in this workspace.';
  end if;

  if actor_role not in ('admin', 'group_manager') and review_manager is distinct from actor then
    raise exception 'Only the named manager or group management can acknowledge this review.';
  end if;

  if review_status = 'acknowledged' then
    raise exception 'This review has already been acknowledged.';
  end if;

  if review_status <> 'finalised' then
    raise exception 'Only a finalised review can be acknowledged.';
  end if;

  update public.one_to_one_reviews
     set status = 'acknowledged',
         acknowledged_at = now(),
         acknowledged_by = actor,
         manager_response = left(trim(coalesce(response, '')), 4000),
         updated_at = now()
   where id = target_review
     and organisation_id = org
     and status = 'finalised';

  if not found then
    raise exception 'The review status changed before the acknowledgement was recorded.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    actor,
    'one_to_one.acknowledged',
    'one_to_one_review',
    target_review,
    jsonb_build_object(
      'response_recorded', length(trim(coalesce(response, ''))) > 0,
      'response_length', length(trim(coalesce(response, '')))
    )
  );
end;
$$;

revoke all on function public.acknowledge_one_to_one(uuid, text) from public, anon;
grant execute on function public.acknowledge_one_to_one(uuid, text) to authenticated;

comment on function public.acknowledge_one_to_one(uuid, text) is
  'Records the named manager or group management acknowledgement and optional response for a finalised 1-1.';

commit;

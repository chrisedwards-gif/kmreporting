-- UAT 009: complete the manager performance workspace.
--
-- - Draft reviews may contain incomplete development notes; those are enforced
--   only when a review is finalised.
-- - Finalised 1-1s can be queued and tracked through the existing notification
--   delivery system.
-- - Managers can acknowledge with a response and update their own action status.
-- - Manager metadata supports probation scoring without creating another person
--   identity: profiles.id remains the canonical UUID.

begin;

alter table public.one_to_one_scores
  drop constraint if exists low_scores_need_development;

alter table public.one_to_one_reviews
  add column if not exists acknowledged_by uuid references public.profiles(id) on delete set null,
  add column if not exists manager_response text not null default '';

alter table public.manager_details
  add column if not exists probation_end_date date,
  add column if not exists probation_weights jsonb not null default jsonb_build_object(
    'leadership', 0.15,
    'communication', 0.10,
    'organisation', 0.15,
    'kitchen_standards', 0.20,
    'product_quality', 0.15,
    'commercial_awareness', 0.10,
    'problem_solving', 0.05,
    'ownership', 0.10
  );

alter table public.notification_log
  add column if not exists one_to_one_review_id uuid references public.one_to_one_reviews(id) on delete cascade,
  add column if not exists recipient_email text,
  add column if not exists subject text,
  add column if not exists message text,
  add column if not exists action_path text,
  add column if not exists error_message text;

create index if not exists notification_log_one_to_one_idx
  on public.notification_log(one_to_one_review_id, created_at desc)
  where one_to_one_review_id is not null;

create index if not exists one_to_one_manager_status_idx
  on public.one_to_one_reviews(manager_profile_id, status, week_commencing desc)
  where manager_profile_id is not null;

-- Recreate finalisation with database-level validation. Drafts stay permissive,
-- but incomplete low scores and actions cannot enter the signed-off record.
create or replace function public.finalise_one_to_one(
  target_review uuid,
  kpi_snapshot jsonb,
  overall numeric
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if auth.uid() is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can finalise a review.';
  end if;

  if exists (
    select 1
    from public.one_to_one_scores s
    where s.review_id = target_review
      and s.score < 3
      and length(trim(s.development_note)) = 0
  ) then
    raise exception 'Every score below 3 needs a development note before finalising.';
  end if;

  if exists (
    select 1
    from public.one_to_one_action_links l
    join public.manager_actions a on a.id = l.action_id
    where l.review_id = target_review
      and (length(trim(a.owner)) = 0 or a.due_date is null)
  ) then
    raise exception 'Every agreed action needs an owner and due date before finalising.';
  end if;

  update public.one_to_one_reviews
     set status = 'finalised',
         kpi_snapshot = finalise_one_to_one.kpi_snapshot,
         overall_score = overall,
         finalised_at = now(),
         finalised_by = auth.uid(),
         acknowledged_at = null,
         acknowledged_by = null,
         manager_response = '',
         updated_at = now()
   where id = target_review
     and organisation_id = org
     and assignment_id is not null
     and status in ('draft', 'in_review', 'reopened');

  if not found then
    raise exception 'The review is missing or already finalised.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    auth.uid(),
    'one_to_one.finalised',
    'one_to_one_review',
    target_review,
    jsonb_build_object('overall_score', overall)
  );
end;
$$;

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
begin
  update public.one_to_one_reviews r
     set status = 'acknowledged',
         acknowledged_at = now(),
         acknowledged_by = auth.uid(),
         manager_response = left(trim(coalesce(response, '')), 4000),
         updated_at = now()
   where r.id = target_review
     and r.organisation_id = org
     and r.status = 'finalised'
     and (
       app_private.current_app_role() in ('admin', 'group_manager')
       or r.manager_profile_id = auth.uid()
     );

  if not found then
    raise exception 'Only the named manager or group management can acknowledge a finalised review.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    auth.uid(),
    'one_to_one.acknowledged',
    'one_to_one_review',
    target_review,
    jsonb_build_object('response_recorded', length(trim(coalesce(response, ''))) > 0)
  );
end;
$$;

-- Managers may update progress on their own agreed actions without being able
-- to rewrite the action, owner, deadline or the signed-off review.
create or replace function public.update_own_manager_action(
  target_action uuid,
  next_status text,
  next_outcome text default ''
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
begin
  if next_status not in ('not_started', 'in_progress', 'blocked', 'complete') then
    raise exception 'Invalid action status.';
  end if;

  update public.manager_actions a
     set status = next_status,
         outcome = left(trim(coalesce(next_outcome, '')), 1000),
         completed_at = case
           when next_status = 'complete' then coalesce(a.completed_at, now())
           else null
         end,
         updated_at = now()
   where a.id = target_action
     and a.organisation_id = org
     and (
       app_private.current_app_role() in ('admin', 'group_manager')
       or a.manager_profile_id = auth.uid()
     );

  if not found then
    raise exception 'That action is outside your performance record.';
  end if;

  insert into public.audit_log (
    organisation_id, actor_id, action, entity_type, entity_id, detail
  ) values (
    org,
    auth.uid(),
    'manager_action.status_updated',
    'manager_action',
    target_action,
    jsonb_build_object('status', next_status)
  );
end;
$$;

revoke all on function public.acknowledge_one_to_one(uuid, text) from public, anon;
revoke all on function public.update_own_manager_action(uuid, text, text) from public, anon;
grant execute on function public.acknowledge_one_to_one(uuid, text) to authenticated;
grant execute on function public.update_own_manager_action(uuid, text, text) to authenticated;

grant select on public.notification_log to authenticated;

commit;

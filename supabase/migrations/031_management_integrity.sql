-- Production fixes 014: management integrity.
--
-- - Private evidence files for product development, SOPs, training, checks and probation.
-- - Audited RAG overrides that preserve the calculated status and management reason.
-- - Draft/finalised probation decisions with immutable final snapshots.
-- - A hard product Live gate requiring the full operating specification and finished photo.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'management-evidence',
  'management-evidence',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  entity_type text not null check (entity_type in (
    'product_development', 'sop', 'training_record', 'kitchen_check_run', 'probation_review'
  )),
  entity_id uuid not null,
  evidence_type text not null default 'supporting_document' check (evidence_type in (
    'finished_photo', 'trial_photo', 'signed_document', 'training_evidence',
    'check_photo', 'supporting_document', 'other'
  )),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  caption text not null default '',
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists evidence_files_entity_idx
  on public.evidence_files(organisation_id, entity_type, entity_id, created_at desc);
create index if not exists evidence_files_site_idx
  on public.evidence_files(site_id, created_at desc)
  where site_id is not null;

alter table public.evidence_files enable row level security;
drop policy if exists evidence_files_read on public.evidence_files;
create policy evidence_files_read on public.evidence_files
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and (
    app_private.current_app_role() in ('admin', 'group_manager')
    or (
      app_private.current_app_role() = 'kitchen_manager'
      and site_id is not null
      and exists (
        select 1 from public.site_memberships membership
        where membership.user_id = auth.uid() and membership.site_id = evidence_files.site_id
      )
    )
  )
);
grant select on public.evidence_files to authenticated;

alter table public.product_development_items
  add column if not exists method_text text not null default '',
  add column if not exists shelf_life_text text not null default '',
  add column if not exists operational_plan text not null default '';

create table if not exists public.rag_overrides (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null check (entity_type in ('manager_probation')),
  entity_id uuid not null,
  metric_key text not null,
  calculated_rag text not null check (calculated_rag in ('green', 'amber', 'red', 'neutral')),
  override_rag text not null check (override_rag in ('green', 'amber', 'red', 'neutral')),
  reason text not null check (length(trim(reason)) >= 5),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text
);

create unique index if not exists rag_overrides_active_idx
  on public.rag_overrides(organisation_id, entity_type, entity_id, metric_key)
  where revoked_at is null;
create index if not exists rag_overrides_history_idx
  on public.rag_overrides(entity_type, entity_id, metric_key, created_at desc);

alter table public.rag_overrides enable row level security;
drop policy if exists rag_overrides_read on public.rag_overrides;
create policy rag_overrides_read on public.rag_overrides
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.current_app_role() in ('admin', 'group_manager')
);
grant select on public.rag_overrides to authenticated;

create table if not exists public.probation_reviews (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  manager_profile_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid references public.sites(id) on delete set null,
  review_date date not null,
  review_stage text not null check (review_stage in ('30_day', '60_day', '90_day', 'final', 'other')),
  status text not null default 'draft' check (status in ('draft', 'finalised')),
  outcome text not null default 'pending' check (outcome in ('pending', 'pass', 'extend', 'fail')),
  extension_end_date date,
  notes text not null default '',
  required_actions text not null default '',
  score_snapshot numeric(4,2),
  rag_snapshot text check (rag_snapshot is null or rag_snapshot in ('green', 'amber', 'red', 'neutral')),
  final_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  finalised_by uuid references public.profiles(id) on delete set null,
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (outcome <> 'extend' or extension_end_date is not null)
);

create index if not exists probation_reviews_manager_idx
  on public.probation_reviews(manager_profile_id, review_date desc);
create index if not exists probation_reviews_status_idx
  on public.probation_reviews(organisation_id, status, review_date desc);

alter table public.probation_reviews enable row level security;
drop policy if exists probation_reviews_read on public.probation_reviews;
create policy probation_reviews_read on public.probation_reviews
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and app_private.current_app_role() in ('admin', 'group_manager')
);
grant select on public.probation_reviews to authenticated;

create or replace function public.set_rag_override(
  target_entity_type text,
  target_entity_id uuid,
  target_metric_key text,
  calculated text,
  override_value text,
  override_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  override_id uuid;
begin
  if actor is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can override a RAG status.';
  end if;
  if target_entity_type <> 'manager_probation' or target_metric_key <> 'weighted_score' then
    raise exception 'That RAG metric cannot be overridden.';
  end if;
  if calculated not in ('green', 'amber', 'red', 'neutral') or override_value not in ('green', 'amber', 'red', 'neutral') then
    raise exception 'Choose a valid RAG status.';
  end if;
  if length(trim(coalesce(override_reason, ''))) < 5 then
    raise exception 'Give a clear reason for the management override.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = target_entity_id and profile.organisation_id = org and profile.role = 'kitchen_manager'
  ) then
    raise exception 'Manager not found.';
  end if;

  update public.rag_overrides
     set revoked_by = actor,
         revoked_at = now(),
         revoke_reason = 'Superseded by a new override.'
   where organisation_id = org
     and entity_type = target_entity_type
     and entity_id = target_entity_id
     and metric_key = target_metric_key
     and revoked_at is null;

  insert into public.rag_overrides (
    organisation_id, entity_type, entity_id, metric_key,
    calculated_rag, override_rag, reason, created_by
  ) values (
    org, target_entity_type, target_entity_id, target_metric_key,
    calculated, override_value, left(trim(override_reason), 2000), actor
  ) returning id into override_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    org, actor, 'rag_override.created', target_entity_type, target_entity_id,
    jsonb_build_object(
      'metric_key', target_metric_key,
      'calculated_rag', calculated,
      'override_rag', override_value,
      'reason', left(trim(override_reason), 2000)
    )
  );

  return override_id;
end;
$$;

create or replace function public.revoke_rag_override(
  target_override uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  row_data public.rag_overrides%rowtype;
begin
  if actor is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can remove a RAG override.';
  end if;
  if length(trim(coalesce(reason, ''))) < 5 then
    raise exception 'Give a reason for removing the override.';
  end if;

  update public.rag_overrides item
     set revoked_by = actor,
         revoked_at = now(),
         revoke_reason = left(trim(reason), 2000)
   where item.id = target_override
     and item.organisation_id = org
     and item.revoked_at is null
  returning item.* into row_data;

  if row_data.id is null then raise exception 'Active override not found.'; end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    org, actor, 'rag_override.revoked', row_data.entity_type, row_data.entity_id,
    jsonb_build_object('metric_key', row_data.metric_key, 'reason', left(trim(reason), 2000))
  );
end;
$$;

create or replace function public.save_probation_review(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  target_id uuid := nullif(payload->>'id', '')::uuid;
  target_manager uuid := (payload->>'managerProfileId')::uuid;
  target_site uuid := nullif(payload->>'siteId', '')::uuid;
  target_stage text := payload->>'reviewStage';
  target_outcome text := coalesce(nullif(payload->>'outcome', ''), 'pending');
  saved_id uuid;
begin
  if actor is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can record probation decisions.';
  end if;
  if target_stage not in ('30_day', '60_day', '90_day', 'final', 'other') then
    raise exception 'Choose a valid probation review stage.';
  end if;
  if target_outcome not in ('pending', 'pass', 'extend', 'fail') then
    raise exception 'Choose a valid probation outcome.';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = target_manager and profile.organisation_id = org and profile.role = 'kitchen_manager'
  ) then
    raise exception 'Manager not found.';
  end if;
  if target_site is not null and not exists (
    select 1 from public.sites site where site.id = target_site and site.organisation_id = org
  ) then
    raise exception 'That kitchen is outside your organisation.';
  end if;
  if target_outcome = 'extend' and nullif(payload->>'extensionEndDate', '') is null then
    raise exception 'An extension needs a new probation end date.';
  end if;

  if target_id is null then
    insert into public.probation_reviews (
      organisation_id, manager_profile_id, site_id, review_date, review_stage,
      outcome, extension_end_date, notes, required_actions, created_by, updated_by
    ) values (
      org, target_manager, target_site, (payload->>'reviewDate')::date, target_stage,
      target_outcome, nullif(payload->>'extensionEndDate', '')::date,
      left(coalesce(payload->>'notes', ''), 12000),
      left(coalesce(payload->>'requiredActions', ''), 12000), actor, actor
    ) returning id into saved_id;
  else
    update public.probation_reviews review set
      manager_profile_id = target_manager,
      site_id = target_site,
      review_date = (payload->>'reviewDate')::date,
      review_stage = target_stage,
      outcome = target_outcome,
      extension_end_date = nullif(payload->>'extensionEndDate', '')::date,
      notes = left(coalesce(payload->>'notes', ''), 12000),
      required_actions = left(coalesce(payload->>'requiredActions', ''), 12000),
      updated_by = actor,
      updated_at = now()
    where review.id = target_id
      and review.organisation_id = org
      and review.status = 'draft'
    returning review.id into saved_id;
    if saved_id is null then raise exception 'Only a draft probation review can be edited.'; end if;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    org, actor, 'probation_review.saved', 'probation_review', saved_id,
    jsonb_build_object('manager_profile_id', target_manager, 'stage', target_stage, 'outcome', target_outcome)
  );

  return saved_id;
end;
$$;

create or replace function public.finalise_probation_review(
  target_review uuid,
  snapshot jsonb,
  score numeric,
  rag text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  review_row public.probation_reviews%rowtype;
begin
  if actor is null or app_private.current_app_role() not in ('admin', 'group_manager') then
    raise exception 'Only group management can finalise a probation decision.';
  end if;
  if rag not in ('green', 'amber', 'red', 'neutral') then raise exception 'Invalid RAG snapshot.'; end if;

  select * into review_row
  from public.probation_reviews review
  where review.id = target_review and review.organisation_id = org
  for update;

  if review_row.id is null or review_row.status <> 'draft' then
    raise exception 'Only a draft probation review can be finalised.';
  end if;
  if length(trim(review_row.notes)) < 10 then
    raise exception 'Add meaningful review notes before finalising.';
  end if;
  if review_row.outcome = 'extend' and (
    review_row.extension_end_date is null or length(trim(review_row.required_actions)) < 5
  ) then
    raise exception 'An extension needs a new end date and clear required actions.';
  end if;
  if review_row.outcome = 'fail' and length(trim(review_row.required_actions)) < 5 then
    raise exception 'A failed probation decision needs the required next steps recorded.';
  end if;
  if snapshot is null or jsonb_typeof(snapshot) <> 'object' or snapshot = '{}'::jsonb then
    raise exception 'The immutable review snapshot is missing.';
  end if;

  update public.probation_reviews review set
    status = 'finalised',
    score_snapshot = score,
    rag_snapshot = rag,
    final_snapshot = snapshot,
    finalised_by = actor,
    finalised_at = now(),
    updated_by = actor,
    updated_at = now()
  where review.id = target_review;

  if review_row.outcome = 'extend' then
    update public.manager_details
       set probation_end_date = review_row.extension_end_date,
           updated_at = now()
     where profile_id = review_row.manager_profile_id and organisation_id = org;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (
    org, actor, 'probation_review.finalised', 'probation_review', target_review,
    jsonb_build_object(
      'manager_profile_id', review_row.manager_profile_id,
      'stage', review_row.review_stage,
      'outcome', review_row.outcome,
      'score_snapshot', score,
      'rag_snapshot', rag
    )
  );
end;
$$;

create or replace function public.save_product_development_item(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  actor uuid := auth.uid();
  actor_role public.app_role := app_private.current_app_role();
  target_id uuid := nullif(payload->>'id', '')::uuid;
  target_site uuid := nullif(payload->>'siteId', '')::uuid;
  target_owner uuid := nullif(payload->>'ownerProfileId', '')::uuid;
  next_status text := coalesce(nullif(payload->>'status', ''), 'idea');
  previous_status text;
  saved_id uuid;
  payload_allergens text[] := coalesce(array(select jsonb_array_elements_text(coalesce(payload->'allergens', '[]'::jsonb))), '{}');
begin
  if actor is null or actor_role not in ('admin', 'group_manager', 'kitchen_manager') then
    raise exception 'You do not have permission to manage product development.';
  end if;

  if target_site is not null and not exists (
    select 1 from public.sites site
    where site.id = target_site and site.organisation_id = org
  ) then
    raise exception 'That kitchen is outside your organisation.';
  end if;

  if actor_role = 'kitchen_manager' and (
    target_site is null or not exists (
      select 1 from public.site_memberships membership
      where membership.user_id = actor and membership.site_id = target_site
    )
  ) then
    raise exception 'That product is outside your assigned kitchen.';
  end if;

  if target_owner is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = target_owner and profile.organisation_id = org and profile.active
  ) then
    raise exception 'That owner is outside your organisation.';
  end if;

  if next_status = 'live' then
    if target_id is null then raise exception 'Save the product before attaching evidence and moving it Live.'; end if;
    if length(trim(coalesce(payload->>'recipeSummary', ''))) < 5 then raise exception 'A Live product needs its final recipe/specification.'; end if;
    if length(trim(coalesce(payload->>'methodText', ''))) < 5 then raise exception 'A Live product needs its method.'; end if;
    if length(trim(coalesce(payload->>'portionText', ''))) < 2 then raise exception 'A Live product needs its portion specification.'; end if;
    if nullif(payload->>'foodCost', '') is null or nullif(payload->>'sellPrice', '') is null then raise exception 'A Live product needs an approved cost and selling price.'; end if;
    if cardinality(payload_allergens) = 0 then raise exception 'A Live product needs an allergen declaration, including None where applicable.'; end if;
    if length(trim(coalesce(payload->>'shelfLifeText', ''))) < 2 then raise exception 'A Live product needs shelf-life and storage guidance.'; end if;
    if length(trim(coalesce(payload->>'operationalPlan', ''))) < 5 then raise exception 'A Live product needs an operational and training plan.'; end if;
    if not exists (
      select 1 from public.evidence_files evidence
      where evidence.organisation_id = org
        and evidence.entity_type = 'product_development'
        and evidence.entity_id = target_id
        and evidence.evidence_type = 'finished_photo'
        and evidence.mime_type like 'image/%'
    ) then
      raise exception 'Upload a finished-product photo before moving this product Live.';
    end if;
  end if;

  if target_id is not null then
    select item.status into previous_status
    from public.product_development_items item
    where item.id = target_id and item.organisation_id = org
    for update;
    if previous_status is null then raise exception 'Product development item not found.'; end if;

    update public.product_development_items item set
      site_id = target_site,
      owner_profile_id = target_owner,
      title = left(trim(payload->>'title'), 160),
      category = left(coalesce(nullif(trim(payload->>'category'), ''), 'Dish'), 80),
      status = next_status,
      target_launch_date = nullif(payload->>'targetLaunchDate', '')::date,
      next_trial_date = nullif(payload->>'nextTrialDate', '')::date,
      recipe_summary = left(coalesce(payload->>'recipeSummary', ''), 8000),
      method_text = left(coalesce(payload->>'methodText', ''), 12000),
      yield_text = left(coalesce(payload->>'yieldText', ''), 160),
      portion_text = left(coalesce(payload->>'portionText', ''), 160),
      shelf_life_text = left(coalesce(payload->>'shelfLifeText', ''), 1000),
      operational_plan = left(coalesce(payload->>'operationalPlan', ''), 8000),
      food_cost = nullif(payload->>'foodCost', '')::numeric,
      sell_price = nullif(payload->>'sellPrice', '')::numeric,
      allergens = payload_allergens,
      trial_notes = left(coalesce(payload->>'trialNotes', ''), 12000),
      approval_notes = left(coalesce(payload->>'approvalNotes', ''), 8000),
      version = case when previous_status = 'approved' and next_status <> 'approved' then item.version + 1 else item.version end,
      updated_by = actor,
      updated_at = now()
    where item.id = target_id
    returning item.id into saved_id;
  else
    insert into public.product_development_items (
      organisation_id, site_id, owner_profile_id, title, category, status,
      target_launch_date, next_trial_date, recipe_summary, method_text, yield_text,
      portion_text, shelf_life_text, operational_plan, food_cost, sell_price,
      allergens, trial_notes, approval_notes, created_by, updated_by
    ) values (
      org, target_site, target_owner, left(trim(payload->>'title'), 160),
      left(coalesce(nullif(trim(payload->>'category'), ''), 'Dish'), 80), next_status,
      nullif(payload->>'targetLaunchDate', '')::date, nullif(payload->>'nextTrialDate', '')::date,
      left(coalesce(payload->>'recipeSummary', ''), 8000), left(coalesce(payload->>'methodText', ''), 12000),
      left(coalesce(payload->>'yieldText', ''), 160), left(coalesce(payload->>'portionText', ''), 160),
      left(coalesce(payload->>'shelfLifeText', ''), 1000), left(coalesce(payload->>'operationalPlan', ''), 8000),
      nullif(payload->>'foodCost', '')::numeric, nullif(payload->>'sellPrice', '')::numeric,
      payload_allergens, left(coalesce(payload->>'trialNotes', ''), 12000),
      left(coalesce(payload->>'approvalNotes', ''), 8000), actor, actor
    ) returning id into saved_id;
    previous_status := null;
  end if;

  insert into public.product_development_events (
    organisation_id, item_id, actor_id, event_type, from_status, to_status, detail
  ) values (
    org, saved_id, actor,
    case when target_id is null then 'created' when previous_status is distinct from next_status then 'status_changed' else 'updated' end,
    previous_status, next_status,
    jsonb_build_object('title', payload->>'title', 'version', (select version from public.product_development_items where id = saved_id))
  );

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, actor, 'product_development.saved', 'product_development_item', saved_id,
    jsonb_build_object('status', next_status, 'site_id', target_site));

  return saved_id;
end;
$$;

revoke all on function public.set_rag_override(text, uuid, text, text, text, text) from public, anon;
revoke all on function public.revoke_rag_override(uuid, text) from public, anon;
revoke all on function public.save_probation_review(jsonb) from public, anon;
revoke all on function public.finalise_probation_review(uuid, jsonb, numeric, text) from public, anon;
revoke all on function public.save_product_development_item(jsonb) from public, anon;
grant execute on function public.set_rag_override(text, uuid, text, text, text, text) to authenticated;
grant execute on function public.revoke_rag_override(uuid, text) to authenticated;
grant execute on function public.save_probation_review(jsonb) to authenticated;
grant execute on function public.finalise_probation_review(uuid, jsonb, numeric, text) to authenticated;
grant execute on function public.save_product_development_item(jsonb) to authenticated;

-- Keep safe permanent site deletion honest now that evidence and probation records exist.
create or replace function public.get_site_usage_summary()
returns table (
  site_id uuid,
  reports bigint,
  daily_records bigint,
  checks bigint,
  people_records bigint,
  sops bigint,
  training bigint,
  products bigint,
  messages bigint,
  payroll_records bigint,
  total_dependencies bigint
)
language sql
stable
security definer
set search_path = public, payroll_private, app_private, pg_temp
as $$
  select
    site.id,
    (select count(*) from public.weekly_reports item where item.site_id = site.id) as reports,
    (
      (select count(*) from public.daily_site_metrics item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_items item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_categories item where item.site_id = site.id)
      + (select count(*) from public.waste_log_entries item where item.site_id = site.id)
    ) as daily_records,
    (
      (select count(*) from public.kitchen_check_templates item where item.site_id = site.id)
      + (select count(*) from public.kitchen_check_runs item where item.site_id = site.id)
      + (select count(*) from public.evidence_files item where item.site_id = site.id and item.entity_type = 'kitchen_check_run')
    ) as checks,
    (
      (select count(*) from public.site_manager_assignments item where item.site_id = site.id)
      + (select count(*) from public.site_memberships item where item.site_id = site.id)
      + (select count(*) from public.one_to_one_reviews item where item.site_id = site.id)
      + (select count(*) from public.manager_actions item where item.site_id = site.id)
      + (select count(*) from public.managers item where item.site_id = site.id)
      + (select count(*) from public.probation_reviews item where item.site_id = site.id)
    ) as people_records,
    (
      (select count(*) from public.sops item where item.site_id = site.id)
      + (select count(*) from public.sop_versions item where item.site_id = site.id)
      + (select count(*) from public.evidence_files item where item.site_id = site.id and item.entity_type = 'sop')
    ) as sops,
    (
      (select count(*) from public.training_records item where item.site_id = site.id)
      + (select count(*) from public.evidence_files item where item.site_id = site.id and item.entity_type = 'training_record')
    ) as training,
    (
      (select count(*) from public.product_development_items item where item.site_id = site.id)
      + (select count(*) from public.evidence_files item where item.site_id = site.id and item.entity_type = 'product_development')
    ) as products,
    (
      (select count(*) from public.manager_messages item where item.site_id = site.id)
      + (select count(*) from public.teamup_calendar_links item where item.site_id = site.id)
      + (select count(*) from public.notification_log item where item.site_id = site.id)
    ) as messages,
    (
      (select count(*) from payroll_private.pay_rates item where item.site_id = site.id)
      + (select count(*) from payroll_private.time_entries item where item.site_id = site.id)
      + (select count(*) from payroll_private.salary_allocations item where item.site_id = site.id)
    ) as payroll_records,
    (
      (select count(*) from public.weekly_reports item where item.site_id = site.id)
      + (select count(*) from public.daily_site_metrics item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_items item where item.site_id = site.id)
      + (select count(*) from public.daily_sales_categories item where item.site_id = site.id)
      + (select count(*) from public.waste_log_entries item where item.site_id = site.id)
      + (select count(*) from public.kitchen_check_templates item where item.site_id = site.id)
      + (select count(*) from public.kitchen_check_runs item where item.site_id = site.id)
      + (select count(*) from public.site_manager_assignments item where item.site_id = site.id)
      + (select count(*) from public.site_memberships item where item.site_id = site.id)
      + (select count(*) from public.one_to_one_reviews item where item.site_id = site.id)
      + (select count(*) from public.manager_actions item where item.site_id = site.id)
      + (select count(*) from public.managers item where item.site_id = site.id)
      + (select count(*) from public.probation_reviews item where item.site_id = site.id)
      + (select count(*) from public.sops item where item.site_id = site.id)
      + (select count(*) from public.sop_versions item where item.site_id = site.id)
      + (select count(*) from public.training_records item where item.site_id = site.id)
      + (select count(*) from public.product_development_items item where item.site_id = site.id)
      + (select count(*) from public.evidence_files item where item.site_id = site.id)
      + (select count(*) from public.manager_messages item where item.site_id = site.id)
      + (select count(*) from public.teamup_calendar_links item where item.site_id = site.id)
      + (select count(*) from public.notification_log item where item.site_id = site.id)
      + (select count(*) from payroll_private.pay_rates item where item.site_id = site.id)
      + (select count(*) from payroll_private.time_entries item where item.site_id = site.id)
      + (select count(*) from payroll_private.salary_allocations item where item.site_id = site.id)
    ) as total_dependencies
  from public.sites site
  where site.organisation_id = app_private.current_organisation_id()
    and app_private.current_app_role() = 'admin'
  order by site.name;
$$;

revoke all on function public.get_site_usage_summary() from public, anon;
grant execute on function public.get_site_usage_summary() to authenticated;

commit;

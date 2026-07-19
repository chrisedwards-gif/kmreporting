-- UAT 010: Phase 3 product development tracker.

begin;

create table if not exists public.product_development_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  title text not null,
  category text not null default 'Dish',
  status text not null default 'idea' check (status in (
    'idea', 'trial_planned', 'trial_complete', 'amendments_required',
    'approved', 'costed', 'spec_complete', 'training_complete', 'live', 'archived'
  )),
  target_launch_date date,
  next_trial_date date,
  recipe_summary text not null default '',
  yield_text text not null default '',
  portion_text text not null default '',
  food_cost numeric(12,2) check (food_cost is null or food_cost >= 0),
  sell_price numeric(12,2) check (sell_price is null or sell_price >= 0),
  allergens text[] not null default '{}',
  trial_notes text not null default '',
  approval_notes text not null default '',
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_development_org_status_idx
  on public.product_development_items(organisation_id, status, target_launch_date);
create index if not exists product_development_site_idx
  on public.product_development_items(site_id, updated_at desc);
create index if not exists product_development_owner_idx
  on public.product_development_items(owner_profile_id, updated_at desc);

create table if not exists public.product_development_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  item_id uuid not null references public.product_development_items(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_development_events_item_idx
  on public.product_development_events(item_id, created_at desc);

alter table public.product_development_items enable row level security;
alter table public.product_development_events enable row level security;

drop policy if exists product_development_items_read on public.product_development_items;
drop policy if exists product_development_events_read on public.product_development_events;

create policy product_development_items_read on public.product_development_items
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and (
    app_private.current_app_role() in ('admin', 'group_manager', 'finance', 'viewer')
    or owner_profile_id = auth.uid()
    or exists (
      select 1 from public.site_memberships membership
      where membership.user_id = auth.uid()
        and membership.site_id = product_development_items.site_id
    )
  )
);

create policy product_development_events_read on public.product_development_events
for select to authenticated
using (
  organisation_id = app_private.current_organisation_id()
  and exists (
    select 1 from public.product_development_items item
    where item.id = item_id
  )
);

grant select on public.product_development_items, public.product_development_events to authenticated;

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

  if actor_role = 'kitchen_manager' and target_site is not null and not exists (
    select 1 from public.site_memberships membership
    where membership.user_id = actor and membership.site_id = target_site
  ) then
    raise exception 'That product is outside your assigned kitchen.';
  end if;

  if target_owner is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = target_owner and profile.organisation_id = org and profile.active
  ) then
    raise exception 'That owner is outside your organisation.';
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
      yield_text = left(coalesce(payload->>'yieldText', ''), 160),
      portion_text = left(coalesce(payload->>'portionText', ''), 160),
      food_cost = nullif(payload->>'foodCost', '')::numeric,
      sell_price = nullif(payload->>'sellPrice', '')::numeric,
      allergens = coalesce(array(select jsonb_array_elements_text(coalesce(payload->'allergens', '[]'::jsonb))), '{}'),
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
      target_launch_date, next_trial_date, recipe_summary, yield_text, portion_text,
      food_cost, sell_price, allergens, trial_notes, approval_notes, created_by, updated_by
    ) values (
      org, target_site, target_owner, left(trim(payload->>'title'), 160),
      left(coalesce(nullif(trim(payload->>'category'), ''), 'Dish'), 80), next_status,
      nullif(payload->>'targetLaunchDate', '')::date, nullif(payload->>'nextTrialDate', '')::date,
      left(coalesce(payload->>'recipeSummary', ''), 8000), left(coalesce(payload->>'yieldText', ''), 160),
      left(coalesce(payload->>'portionText', ''), 160), nullif(payload->>'foodCost', '')::numeric,
      nullif(payload->>'sellPrice', '')::numeric,
      coalesce(array(select jsonb_array_elements_text(coalesce(payload->'allergens', '[]'::jsonb))), '{}'),
      left(coalesce(payload->>'trialNotes', ''), 12000), left(coalesce(payload->>'approvalNotes', ''), 8000),
      actor, actor
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

revoke all on function public.save_product_development_item(jsonb) from public, anon;
grant execute on function public.save_product_development_item(jsonb) to authenticated;

commit;

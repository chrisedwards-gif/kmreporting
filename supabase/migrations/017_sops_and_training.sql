-- UAT 013: site-scoped SOP and training trackers.
-- SOP edits create immutable versions. All writes are role-checked RPCs.

begin;

create table public.sops (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 180),
  category text not null check (category in (
    'stock_take','ordering','procure_wizard','waste','close_down','date_labelling',
    'allergens','pizza_standards','prep_lists','cleaning','product_specifications',
    'training','compliance','other'
  )),
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  owner text not null check (char_length(owner) between 2 and 120),
  status text not null default 'not_started' check (status in (
    'not_started','draft','in_review','live','reviewed','archived'
  )),
  due_date date,
  last_reviewed_date date,
  next_review_date date,
  version integer not null default 1 check (version >= 1),
  document_link text not null default '' check (
    document_link = '' or document_link ~* '^https?://'
  ),
  notes text not null default '' check (char_length(notes) <= 8000),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sop_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  sop_id uuid not null references public.sops(id) on delete cascade,
  version integer not null check (version >= 1),
  site_id uuid not null references public.sites(id) on delete cascade,
  title text not null,
  category text not null,
  priority text not null,
  owner text not null,
  status text not null,
  due_date date,
  last_reviewed_date date,
  next_review_date date,
  document_link text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (sop_id, version)
);

create table public.training_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  training_date date not null,
  team_member text not null check (char_length(team_member) between 2 and 160),
  topic text not null check (char_length(topic) between 2 and 240),
  method text not null default '' check (char_length(method) <= 500),
  result text not null default '' check (char_length(result) <= 1200),
  follow_up_required boolean not null default false,
  follow_up_date date,
  signed_off boolean not null default false,
  signed_off_date date,
  signed_off_by uuid references public.profiles(id) on delete set null,
  notes text not null default '' check (char_length(notes) <= 8000),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_up_needs_date check (not follow_up_required or follow_up_date is not null)
);

create index sops_site_status_idx on public.sops(site_id, status, due_date);
create index sops_review_idx on public.sops(organisation_id, next_review_date) where status <> 'archived';
create index sop_versions_sop_idx on public.sop_versions(sop_id, version desc);
create index training_records_site_date_idx on public.training_records(site_id, training_date desc);
create index training_follow_up_idx on public.training_records(organisation_id, follow_up_date)
  where follow_up_required and not signed_off;

alter table public.sops enable row level security;
alter table public.sop_versions enable row level security;
alter table public.training_records enable row level security;

create or replace function app_private.can_maintain_operational_site(target_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.sites site
      where site.id = target_site
        and site.organisation_id = app_private.current_organisation_id()
    )
    and (
      app_private.current_app_role() in ('admin','group_manager')
      or (
        app_private.current_app_role() = 'kitchen_manager'
        and exists (
          select 1 from public.site_memberships membership
          where membership.site_id = target_site
            and membership.user_id = auth.uid()
            and membership.can_submit
        )
      )
    );
$$;

create policy sops_read on public.sops for select to authenticated using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or exists (
      select 1 from public.site_memberships membership
      where membership.site_id = sops.site_id and membership.user_id = (select auth.uid())
    )
  )
);

create policy sop_versions_read on public.sop_versions for select to authenticated using (
  organisation_id = (select app_private.current_organisation_id())
  and exists (select 1 from public.sops current_sop where current_sop.id = sop_versions.sop_id)
);

create policy training_records_read on public.training_records for select to authenticated using (
  organisation_id = (select app_private.current_organisation_id())
  and (
    (select app_private.current_app_role()) in ('admin','group_manager','finance','viewer')
    or exists (
      select 1 from public.site_memberships membership
      where membership.site_id = training_records.site_id and membership.user_id = (select auth.uid())
    )
  )
);

grant select on public.sops, public.sop_versions, public.training_records to authenticated;

create or replace function public.save_sop(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  target_site uuid := (payload->>'siteId')::uuid;
  target_id uuid := nullif(payload->>'id','')::uuid;
  current_row public.sops%rowtype;
  next_version integer := 1;
  next_status text := coalesce(nullif(payload->>'status',''),'not_started');
  next_link text := trim(coalesce(payload->>'documentLink',''));
begin
  if not app_private.can_maintain_operational_site(target_site) then
    raise exception 'You can only maintain SOPs for an assigned kitchen.';
  end if;
  if next_link <> '' and next_link !~* '^https?://' then
    raise exception 'Document links must start with http:// or https://.';
  end if;

  if target_id is null then
    insert into public.sops (
      organisation_id, site_id, title, category, priority, owner, status,
      due_date, last_reviewed_date, next_review_date, version, document_link,
      notes, created_by, updated_by
    ) values (
      org, target_site, left(trim(payload->>'title'),180), payload->>'category',
      coalesce(nullif(payload->>'priority',''),'medium'), left(trim(payload->>'owner'),120), next_status,
      nullif(payload->>'dueDate','')::date,
      case when next_status = 'reviewed' then current_date else null end,
      nullif(payload->>'nextReviewDate','')::date,
      1, next_link, left(coalesce(payload->>'notes',''),8000), auth.uid(), auth.uid()
    ) returning id, version into target_id, next_version;
  else
    select * into current_row from public.sops
    where id = target_id and organisation_id = org for update;
    if current_row.id is null then raise exception 'The SOP could not be found.'; end if;
    if not app_private.can_maintain_operational_site(current_row.site_id) then
      raise exception 'You cannot edit that SOP.';
    end if;
    next_version := current_row.version + 1;
    update public.sops set
      site_id = target_site,
      title = left(trim(payload->>'title'),180),
      category = payload->>'category',
      priority = coalesce(nullif(payload->>'priority',''),'medium'),
      owner = left(trim(payload->>'owner'),120),
      status = next_status,
      due_date = nullif(payload->>'dueDate','')::date,
      last_reviewed_date = case when next_status = 'reviewed' then current_date else current_row.last_reviewed_date end,
      next_review_date = nullif(payload->>'nextReviewDate','')::date,
      version = next_version,
      document_link = next_link,
      notes = left(coalesce(payload->>'notes',''),8000),
      updated_by = auth.uid(),
      updated_at = now()
    where id = target_id;
  end if;

  insert into public.sop_versions (
    organisation_id, sop_id, version, site_id, title, category, priority,
    owner, status, due_date, last_reviewed_date, next_review_date,
    document_link, notes, created_by
  )
  select organisation_id, id, version, site_id, title, category, priority,
    owner, status, due_date, last_reviewed_date, next_review_date,
    document_link, notes, auth.uid()
  from public.sops where id = target_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, auth.uid(), 'sop.saved', 'sop', target_id,
    jsonb_build_object('site_id',target_site,'status',next_status,'version',next_version));
  return target_id;
end;
$$;

create or replace function public.save_training_record(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  org uuid := app_private.current_organisation_id();
  target_site uuid := (payload->>'siteId')::uuid;
  target_id uuid := nullif(payload->>'id','')::uuid;
  current_row public.training_records%rowtype;
  next_signed boolean := coalesce((payload->>'signedOff')::boolean,false);
  next_follow_up boolean := coalesce((payload->>'followUpRequired')::boolean,false);
begin
  if not app_private.can_maintain_operational_site(target_site) then
    raise exception 'You can only record training for an assigned kitchen.';
  end if;
  if next_follow_up and nullif(payload->>'followUpDate','') is null then
    raise exception 'A follow-up needs a follow-up date.';
  end if;

  if target_id is null then
    insert into public.training_records (
      organisation_id, site_id, training_date, team_member, topic, method,
      result, follow_up_required, follow_up_date, signed_off, signed_off_date,
      signed_off_by, notes, created_by, updated_by
    ) values (
      org, target_site, (payload->>'trainingDate')::date,
      left(trim(payload->>'teamMember'),160), left(trim(payload->>'topic'),240),
      left(coalesce(payload->>'method',''),500), left(coalesce(payload->>'result',''),1200),
      next_follow_up, nullif(payload->>'followUpDate','')::date,
      next_signed, case when next_signed then current_date end,
      case when next_signed then auth.uid() end,
      left(coalesce(payload->>'notes',''),8000), auth.uid(), auth.uid()
    ) returning id into target_id;
  else
    select * into current_row from public.training_records
    where id = target_id and organisation_id = org for update;
    if current_row.id is null then raise exception 'The training record could not be found.'; end if;
    if not app_private.can_maintain_operational_site(current_row.site_id) then
      raise exception 'You cannot edit that training record.';
    end if;
    update public.training_records set
      site_id = target_site,
      training_date = (payload->>'trainingDate')::date,
      team_member = left(trim(payload->>'teamMember'),160),
      topic = left(trim(payload->>'topic'),240),
      method = left(coalesce(payload->>'method',''),500),
      result = left(coalesce(payload->>'result',''),1200),
      follow_up_required = next_follow_up,
      follow_up_date = nullif(payload->>'followUpDate','')::date,
      signed_off = next_signed,
      signed_off_date = case when next_signed then coalesce(current_row.signed_off_date,current_date) end,
      signed_off_by = case when next_signed then coalesce(current_row.signed_off_by,auth.uid()) end,
      notes = left(coalesce(payload->>'notes',''),8000),
      updated_by = auth.uid(),
      updated_at = now()
    where id = target_id;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, detail)
  values (org, auth.uid(), 'training.saved', 'training_record', target_id,
    jsonb_build_object('site_id',target_site,'signed_off',next_signed,'follow_up_required',next_follow_up));
  return target_id;
end;
$$;

revoke all on function app_private.can_maintain_operational_site(uuid) from public, anon, authenticated;
revoke all on function public.save_sop(jsonb) from public, anon;
revoke all on function public.save_training_record(jsonb) from public, anon;
grant execute on function public.save_sop(jsonb) to authenticated;
grant execute on function public.save_training_record(jsonb) to authenticated;

commit;

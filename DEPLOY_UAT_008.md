# UAT 008 — canonical manager identity and site assignment history

UAT 008 corrects the Phase 1 manager model before live 1-1 data is collected.

## Identity model

- `public.profiles.id` is the canonical person UUID and is the same UUID as `auth.users.id`.
- `public.manager_details` is a 1:1 extension keyed by that profile UUID. It stores manager-only metadata, not another identity.
- `public.site_manager_assignments` stores the dated primary manager for each kitchen.
- A 1-1 review stores the canonical profile UUID, the site UUID and the assignment UUID that was effective for that week.
- Replacing a manager ends the old assignment on the previous Saturday. Old reports, reviews, scores and actions remain attached to the old person/assignment.
- `site_memberships` remains the access-control record. The assignment RPC updates it when the primary manager changes.

## Database order

### When migration 011 has not been run

Run in this order in the staging Supabase SQL Editor:

1. `supabase/migrations/011_one_to_one_reviews.sql`
2. `supabase/migrations/012_canonical_manager_identity.sql`
3. Optionally `supabase/seed_performance.sql` after the real manager accounts have been assigned in the app.

### When migration 011 and the old seed were already run

Run only:

1. `supabase/migrations/012_canonical_manager_identity.sql`
2. Re-run the updated `supabase/seed_performance.sql` only after the real manager login/profile is assigned as primary KM.

Migration 012 maps legacy rows when a unique profile identity can be resolved. Unlinked legacy manager rows remain preserved but are not used for new reviews.

## Assignment smoke test

1. Open **Settings → Sites & access**.
2. Open **Dough Religion → Manage**.
3. Set the real manager name and work email.
4. Choose an effective Sunday.
5. Save **Assign primary manager**.
6. Confirm the site directory shows one primary manager and an assignment start date.
7. Open **Manager 1-1s** and confirm the card is created from that kitchen assignment.
8. Start the latest completed week's review and confirm the KPI panel pulls the Dough Religion weekly figures.
9. In Sites & access, replace the primary manager from a later Sunday.
10. Confirm the prior manager appears under assignment history, their old 1-1 remains openable, and the new manager receives the future 1-1 card.

## Identity checks

Run these in the Supabase SQL Editor after assigning a manager:

```sql
select
  p.id as canonical_profile_uuid,
  p.full_name,
  p.notification_email,
  a.id as assignment_uuid,
  s.name as kitchen,
  a.starts_on,
  a.ends_on
from public.site_manager_assignments a
join public.profiles p on p.id = a.manager_profile_id
join public.sites s on s.id = a.site_id
order by s.name, a.starts_on desc;
```

The same `canonical_profile_uuid` must be used for the login, manager details, manager actions and all 1-1 reviews for that person.

## Review integrity checks

```sql
select
  r.id as review_uuid,
  r.week_commencing,
  r.manager_profile_id,
  r.site_id,
  r.assignment_id,
  p.full_name,
  s.name as kitchen
from public.one_to_one_reviews r
join public.profiles p on p.id = r.manager_profile_id
join public.sites s on s.id = r.site_id
order by r.week_commencing desc;
```

A finalised review uses its saved KPI snapshot. Later changes to the site report or a manager replacement do not rewrite the review's person/site context.

## Do not do this

- Do not insert Scott, Warren or any future manager directly into the legacy `public.managers` table.
- Do not create a second profile for the same email.
- Do not delete old assignments when a manager changes.
- Do not run the old version of `seed_performance.sql` that created name-based manager records.

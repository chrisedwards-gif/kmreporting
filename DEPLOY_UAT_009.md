# UAT 009 — resumable 1-1s and performance workspace

## What changed

- **Draft fix:** the clicked submit button now supplies the server-side intent directly. Draft saving no longer depends on replacing text inside a JSON string.
- Drafts may contain incomplete development notes. A score below 3 is enforced only when the review is finalised.
- Saved drafts appear in a dedicated **Open drafts** section and can be continued from the 1-1 hub.
- Finalised reviews create the manager's immutable performance history and trend chart.
- Added the master action log with manager/status/priority filters, manager progress updates and CSV export.
- Added weighted probation scorecards using the existing tested scoring functions.
- Added canonical manager administration for account creation, email, employment dates, probation dates and focus areas.
- Kitchen managers can open their own finalised reviews, add a response, acknowledge them and update action progress.
- Finalising a 1-1 queues an email summary and action points for the manager. When `REMINDER_WEBHOOK_URL` is configured, the same provider-neutral webhook used by reminders delivers it immediately.
- Notification history now shows the 1-1 subject, intended email, status, delivery error and direct review link.

## Required database step

Apply after migrations 011 and 012:

```text
supabase/migrations/013_performance_workspace_and_delivery.sql
```

Migration 013 is required before testing draft scores below 3, manager acknowledgements, action updates or 1-1 email delivery.

## Email behaviour

The app does not claim an email was sent unless the configured delivery webhook accepts it.

- No `REMINDER_WEBHOOK_URL`: the 1-1 is finalised and the email is recorded as **queued**.
- Webhook configured: the app sends `kind: one_to_one_finalised` with recipient, subject, message and `actionPath`.
- `REMINDER_RECIPIENT_OVERRIDE` configured: UAT delivery is redirected while preserving the intended manager email in the log.
- Webhook failure: the review remains finalised and the notification is recorded as **failed** with an error.

A direct Resend adapter can replace the webhook later without changing the review workflow or database records.

## Smoke test

1. Apply migration 013 in staging.
2. Open **Manager 1-1s** and start a review.
3. Enter partial content, including a score below 3 with no development note.
4. Press **Save draft**.
5. Confirm the page redirects to the saved review and displays the success message.
6. Return to **Manager 1-1s** and confirm the review appears under **Open drafts**.
7. Open it and confirm all entered fields and scores remain.
8. Attempt to finalise without the development note and confirm finalisation is blocked.
9. Complete the note and all action owners/dates, then press **Finalise, lock & send**.
10. Confirm **Notifications** shows a `one to one finalised` delivery record.
11. Sign in as the manager and confirm they can open only their own 1-1, add a response and acknowledge it.
12. Open **Action log**, update an action, filter the table and export CSV.
13. Open **Probation** and confirm the latest finalised review feeds the weighted score.

## Migration health check

```sql
select
  to_regclass('public.site_manager_assignments') is not null as migration_012,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notification_log'
      and column_name = 'one_to_one_review_id'
  ) as migration_013,
  to_regprocedure('public.acknowledge_one_to_one(uuid,text)') is not null as response_rpc,
  to_regprocedure('public.update_own_manager_action(uuid,text,text)') is not null as action_rpc;
```

Every column should return `true`.

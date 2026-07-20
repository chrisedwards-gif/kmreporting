# UAT 011 — site-specific kitchen checks

## What is included

- Versioned daily and weekly templates tied to one kitchen.
- Dough Religion weekly audit imported from `Dough_Religion_Weekly_Audit.xlsm` with 43 checks.
- Dough Religion daily check with 16 food-safety, service, close-down, stock and handover checks.
- Green / Amber / Red / N/A scoring.
- Green = 2, Amber = 1, Red = 0.
- Pass at 90%, Watch at 75–89%, Fail below 75%.
- Any critical Red forces an automatic Fail.
- Incomplete drafts can be saved and resumed.
- Every Amber or Red requires notes, an action, an owner and a deadline before submission.
- Submitted findings create or update records in the master manager action log.
- Group management can review and sign off submitted checks.

## Database

The connected staging Supabase project already has the kitchen-check schema and Dough Religion templates installed.

Repository sources:

- `supabase/migrations/016_kitchen_checks.sql`
- `supabase/seed_dough_religion_checks.sql`

## UAT flow

1. Open **Kitchen checks**.
2. Start today's **Daily Kitchen Check**.
3. Rate a few lines, including one Amber, without completing its action.
4. Press **Save draft** and leave the page.
5. Reopen the current check and confirm the ratings and notes remain.
6. Complete all ratings.
7. Add notes, action, owner and deadline to every Amber or Red.
8. Submit the check.
9. Confirm the score, result and critical-fail rule are correct.
10. Open **Action log** and confirm each Amber/Red action appears once.
11. Sign in as group management and mark the check reviewed.
12. Start the weekly audit and compare its 43 items with the original workbook.

## Email delivery

Notification testing now tries direct Resend delivery first. `REMINDER_WEBHOOK_URL` is optional fallback infrastructure, not the recommended email setup.

Required Vercel variables for direct email:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- optional `RESEND_REPLY_TO`
- keep `REMINDER_RECIPIENT_OVERRIDE` during UAT

## Next kitchen templates

Kardia and Choi Wan should each receive their own versioned daily and weekly templates. Do not reuse Dough Religion checks unchanged where equipment, sections or food-safety risks differ.

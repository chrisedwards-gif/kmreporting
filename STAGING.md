# Shared test environment

Use an isolated staging deployment for kitchen-manager testing. Never connect a test deployment to the production payroll database or real reminder recipients.

## Recommended layout

```text
GitHub staging branch
        │
        ▼
Vercel Preview deployment ─────► Supabase staging project
        │                               │
        ├── staging secrets             ├── test Auth users
        ├── test import endpoint        ├── seed sites
        └── reminder sandbox            └── synthetic operating data
```

Production uses a different Vercel environment, Supabase project, service key, import secret and reminder destination.

## Bring staging online

1. Create a new Supabase project named `hos-kitchen-reports-staging`.
2. Copy `.env.staging.example` to `.env.staging.local` and insert staging-only values.
3. Apply every migration in `supabase/migrations` in filename order, then `supabase/seed.sql` for a new environment.
4. Create these test users in Supabase Auth:
   - one `group_manager` account;
   - one `kitchen_manager` for Dough Religion;
   - one `kitchen_manager` for Choi Wan;
   - one `finance` account.
5. Add matching `profiles` rows and only the required `site_memberships`. Use non-production email addresses.
6. Import the repository into Vercel. Add staging values to the Preview environment only and deploy.
7. Keep `REMINDER_WEBHOOK_URL` unset initially, or point it at a delivery sandbox.

## Exercise the live feed

Load the staging variables into your terminal, then run:

```bash
npm run test:connector
```

The simulator sends seven days of synthetic sales, covers, purchasing and waste. It is safe to repeat: imports are idempotent by site, date and source. Open the group dashboard in another browser; its live status should change to `Live reporting` and the dashboard will refresh as the import lands.

## Acceptance checks

- A kitchen manager can see only their assigned site.
- Two KMs can work on different reports simultaneously.
- Sunday-to-Saturday validation rejects an incorrect period.
- StockLink and Procure Wizard files for another site or week are rejected before submission.
- Raw source files and employee/product rows do not appear in network request bodies or database records.
- Delivered-but-uninvoiced food is included in spend; pending credits are flagged but not deducted.
- Reports without confirmed sales, purchasing and positive aggregate labour remain drafts.
- Imported sales replace only sales fields; they do not overwrite stock or payroll.
- Missing or zero aggregate labour blocks submission; a missing private payroll import creates a critical review flag when that connector is used.
- Cost or compliance flags require written resolution before approval.
- A non-approved report cannot be shared or printed as the final group summary.
- Repeating the test import does not duplicate the week.
- Individual pay rates never appear in browser network responses, exports or audit details.
- A shop/top-up purchase is added to the food total, appears on the report and survives a draft restore without storing a receipt image.
- An approved site report can be shared independently while the complete group release remains locked.
- A partial group update prints with an unmistakable outstanding-reports label.
- Notification self-tests create queue history; with a sandbox webhook configured they transition to sent or failed without contacting kitchen teams.

## Local visual test

The labelled sample workspace does not require Supabase:

```bash
npm run build
npm run start:test
```

Open `http://127.0.0.1:3100`. This checks the reporting journey and layout; the shared staging deployment is required to test real authentication, row-level permissions and Realtime updates between separate KM accounts.

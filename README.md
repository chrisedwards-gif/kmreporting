# HOS Kitchen Reports

A production-oriented weekly kitchen reporting app for multiple sites. Kitchen managers submit one report for their assigned kitchen; group leaders receive a consistent management summary, automated review flags, named approvals and a controlled sharing gate.

The app runs immediately with deterministic demo data. Connect Supabase to enable persistent authentication, row-level permissions, private payroll calculations, audit records and reminders.

## What is included

- Multi-site Supabase Auth with `admin`, `group_manager`, `finance`, `kitchen_manager` and `viewer` roles.
- Row-level security: kitchen managers only read and submit for assigned sites.
- Sunday-to-Saturday period validation matching the current StockLink and Procure Wizard exports.
- Sales, purchases, stock, waste and concise operational narratives.
- Manager-confirmed aggregate RotaCloud wage cost, with an optional private payroll connector. Individual salaries, rates and employee rows are never stored by the browser workflow.
- Safe weekly snapshots for COGS, food cost, staff cost, labour, waste and prime cost.
- Automatic review gates for target exceptions, missing payroll data, missing pay rates, compliance issues and support requests.
- Named resolution/approval records and an audit trail.
- A consistent group management summary that stays locked until every site is approved.
- Tuesday reminders for missing reports and management review, with deduplication.
- Browser-side StockLink, Procure Wizard and RotaCloud CSV parsing with manual fallbacks and no raw-file retention.
- A server-only cost import API remains available for future payroll/time integrations.
- Live dashboard refresh through Supabase Realtime when reports or imported metrics change.
- A normalized operations API for EPOS sales/covers, purchasing/credits and waste feeds.
- Admin site controls for kitchen targets, activation and audited manager invitations/assignments.
- Reporting-period history across weekly reports, approvals and management summaries.
- Audited group-summary release: printing is enabled only after every active kitchen is submitted, approved and released.

## Architecture

```text
Kitchen manager ──> local file parsing + confirmed weekly totals ──> public Supabase tables (RLS)
                                                            │
Payroll/time provider ──> authenticated import endpoint ──> payroll_private schema
                                                            │
                                                            ▼
                                                  security-definer cost engine
                                                            │
                                                            ▼
Management UI <── site totals + percentages only <── site_cost_snapshots
        │
        └── review resolution ──> approval ──> controlled summary/share + audit
```

Supabase is the system of record. Next.js Server Components form the read layer; Server Actions and checked database functions form the write layer. The browser never receives the service-role key or private payroll rows.

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. With no environment file, the app automatically uses the labelled demo workspace.

For the full shared test plan, see [`STAGING.md`](./STAGING.md).

Quality checks:

```bash
npm run test
npm run lint
npm run build
```

## Production setup

1. Create a Supabase project and install the Supabase CLI.
2. Copy `.env.example` to `.env.local` and supply the project URL, publishable key, service-role key and two different random secrets.
3. Link and migrate the project:

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   supabase db seed
   ```

   Existing installations should apply every later file in `supabase/migrations` in filename order. Migration `002_production_hardening.sql` prevents draft or already-shared reports from receiving an approval decision.

4. Existing databases must also apply `005_manager_source_imports.sql` before deploying the matching application update. It changes future periods to Sunday–Saturday and adds safe source metadata and aggregate labour inputs.
5. Create users with Supabase Auth. Insert a matching `profiles` row for each user and add `site_memberships` for kitchen managers. Do not give kitchen users `admin`, `group_manager` or `finance` roles.
6. Deploy to Vercel or another Node-compatible host and add the same environment variables there.
7. Put the deployed app URL and `CRON_SECRET` into Supabase Vault as `app_base_url` and `cron_secret`, then run `supabase/reminder_schedule.sql` once.

The reminder job invokes the app hourly on Mondays and Tuesdays. Kitchen reminders send at 09:00 and 12:00 Monday; approval reminders send at 10:00 Tuesday. Every reminder has a unique dedupe key.

## Roles and data visibility

| Role | Assigned reports | Group summary | Safe cost totals | Approve/share | Configure access | Private payroll rows |
|---|---:|---:|---:|---:|---:|---:|
| Kitchen manager | Yes | No | Assigned site | No | No | Never |
| Viewer | Scoped | Yes | Scoped | No | No | Never |
| Finance | All | Yes | All | No | No | Never through the app |
| Group manager | All | Yes | All | Yes | No | Never through the app |
| Admin | All | Yes | All | Yes | Yes | Never through the app |
| Service integration | No UI | No UI | Writes snapshot | No | No | Write-only RPC |

Finance payroll administration should occur in the payroll system or a separate tightly controlled back-office process. Keeping salary maintenance out of the general app reduces accidental disclosure.

## Cost rules

```text
Stock-adjusted COGS = opening stock + purchases - credits + transfers in - transfers out - closing stock + adjustments
Spend basis         = purchases - credits + transfers in - transfers out + adjustments
Food cost / spend   = selected basis / net sales
Staff cost          = confirmed aggregate RotaCloud total, or private payroll calculation
Labour     = staff cost / net sales
Prime cost = selected food basis + staff cost
```

Until a kitchen completes reliable opening and closing stocktakes, the UI explicitly labels its result as spend-based rather than stock-adjusted food cost. Pending supplier credits do not reduce spend and enter the review queue. If labour data is missing, the report cannot be submitted.

## Manager file imports

The weekly report accepts these current source formats:

- StockLink End of Week `.xls` exports (HTML-formatted Excel files): extracts the site, exact period and net sales excluding VAT and service charge.
- Procure Wizard Goods Delivered `.csv`: sums Food-category rows by delivery date and includes delivered items awaiting invoice.
- Procure Wizard Credits Overview `.csv`: deducts issued credit notes only and flags pending investigations separately.
- RotaCloud Daily Totals `.csv` (preferred): detects the site, exact week, aggregate wage cost and paid hours without retaining employee rows. Employee Totals is also handled without double-counting its summary rows, but contains unnecessary personal data. If a tenant-specific export uses different headings, the kitchen can enter the aggregate total manually.

Files are decoded and parsed in the signed-in browser. Only safe totals, source mode and a short SHA-256 fingerprint are submitted; the raw files and employee/product rows are not uploaded or retained.

## Payroll/time import

Send a `POST` request to `/api/imports/costs` with `Authorization: Bearer <IMPORT_SECRET>`. The endpoint validates the payload, does not log it, calls a service-only database function and refreshes the safe site snapshot.

Example shape (use non-sensitive test data only in development):

```json
{
  "organisationId": "00000000-0000-4000-8000-000000000000",
  "siteId": "00000000-0000-4000-8000-000000000001",
  "periodId": "PERIOD_UUID",
  "payRates": [{
    "employeeRef": "PAYROLL-123",
    "annualSalary": 36000,
    "contractedWeeklyHours": 45,
    "employerNiRate": 0.15,
    "pensionRate": 0.03,
    "validFrom": "2026-01-01"
  }],
  "timeEntries": [{
    "employeeRef": "PAYROLL-123",
    "paidHours": 46.5,
    "overtimePremium": 35,
    "sourceReference": "rota-export-2026-w29"
  }]
}
```

This connector is optional. The normal manager workflow stores a single site/week RotaCloud total. If an enterprise payroll connector is added later, map its employee identifier to `employeeRef`; never use employee names in the reporting UI.

## EPOS, purchasing and waste integrations

Provider adapters send normalized daily figures to `POST /api/imports/operations` using the same `IMPORT_SECRET`. Supported domains are `sales`, `purchasing` and `waste`. A connector can own one or several domains without overwriting stocktake or payroll fields.

The database keeps the most recent provider result for each site/date/domain, so webhook retries or a provider replacement do not double-count the week. Once a weekly report exists, imported daily data automatically updates its safe cost snapshot and the signed-in dashboard refreshes through Realtime.

Use `scripts/push-test-operations.mjs` as the reference adapter. A specific EPOS or purchasing product only needs to map its response into that stable daily shape.

## Reminder delivery

If `REMINDER_WEBHOOK_URL` is configured, the app posts a small delivery payload for each new reminder. Connect this to an email, Slack, Teams or automation provider. It contains recipient/site context and report IDs, but no payroll figures. If no webhook is configured, reminders remain queued in `notification_log` for an in-app/provider worker.

## Important production checks

- Rotate `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and `IMPORT_SECRET` if any are exposed.
- Keep the service-role key in server-side environment variables only.
- Test every role with separate accounts before inviting kitchen teams.
- Back up Supabase and set database retention to match company policy.
- Configure a transactional email/webhook provider and monitor failed `notification_log` rows.
- Review payroll/time mapping after starters, leavers, transfers and pay changes.
- Use HTTPS only and keep the app private until user acceptance testing is signed off.

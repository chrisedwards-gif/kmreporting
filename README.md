# HOS Kitchen Reports

A production-oriented weekly kitchen reporting app for multiple sites. Kitchen managers submit one report for their assigned kitchen; group leaders receive a consistent management summary, automated review flags, named approvals and a controlled sharing gate.

The app runs immediately with deterministic demo data. Connect Supabase to enable persistent authentication, row-level permissions, private payroll calculations, audit records and reminders.

## What is included

- Multi-site Supabase Auth with `admin`, `group_manager`, `finance`, `kitchen_manager` and `viewer` roles.
- Row-level security: kitchen managers only read and submit for assigned sites.
- Monday-to-Sunday period validation in both the application and database.
- Sales, purchases, stock, waste and concise operational narratives.
- Private payroll schema. Individual salaries, rates, employee references and time entries are never exposed to browser roles.
- Safe weekly snapshots for COGS, food cost, staff cost, labour, waste and prime cost.
- Automatic review gates for target exceptions, missing payroll data, missing pay rates, compliance issues and support requests.
- Named resolution/approval records and an audit trail.
- A consistent group management summary that stays locked until every site is approved.
- Tuesday reminders for missing reports and management review, with deduplication.
- A server-only cost import API for payroll/time integrations.

## Architecture

```text
Kitchen manager ──> weekly report + source totals ──> public Supabase tables (RLS)
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

4. Create users with Supabase Auth. Insert a matching `profiles` row for each user and add `site_memberships` for kitchen managers. Do not give kitchen users `admin`, `group_manager` or `finance` roles.
5. Deploy to Vercel or another Node-compatible host and add the same environment variables there.
6. Put the deployed app URL and `CRON_SECRET` into Supabase Vault as `app_base_url` and `cron_secret`, then run `supabase/reminder_schedule.sql` once.

The reminder job invokes the app hourly on Tuesdays, but the endpoint only sends at 09:00, 11:00 and 13:00 Europe/London. This preserves UK daylight-saving behaviour and uses a unique dedupe key so retries do not duplicate reminders.

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
COGS       = opening stock + purchases - credits + transfers in - transfers out - closing stock + adjustments
Food cost  = COGS / net sales
Staff cost = paid hours × effective loaded rate + agency cost + overtime premium
Labour     = staff cost / net sales
Prime cost = COGS + staff cost
```

Effective loaded rates include configured employer NI, pension and other on-cost percentages. If time data or a required private rate is missing, the report receives a critical review flag instead of silently reporting a low labour percentage.

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

For an existing payroll/rota product, map its employee identifier to `employeeRef`; never use employee names in the reporting UI.

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

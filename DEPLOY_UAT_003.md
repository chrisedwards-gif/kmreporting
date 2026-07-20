# UAT 003 — source imports and weekly controls

This update introduces the long-term manager-led workflow for StockLink, Procure Wizard and RotaCloud totals. Apply it to the test environment before production.

## Deploy in this order

1. Back up the Supabase test project.
2. In Supabase SQL Editor, run the complete file `supabase/migrations/005_manager_source_imports.sql` once. It runs in a transaction and is safe to rerun after a completed application.
3. Replace the app files in the Codespace with this package. Do not upload `.next`, `node_modules`, `.env*` or ZIP files to GitHub.
4. In the Codespace terminal run:

   ```bash
   git ls-files .next | head
   # If the command above prints any files, run this once:
   git rm -r --cached .next

   npm ci
   npm run lint
   npm test
   npm run build
   git add .
   git commit -m "Add weekly source imports and Sunday reporting"
   git push origin main
   ```

   The `.next` directory is generated build output. Removing it from Git tracking prevents the large pushes and HTTP 408 errors seen previously; it does not remove your source code.

5. Let Vercel deploy the new commit. The Vercel Root Directory must be blank because `package.json` is at the repository root.
6. After Vercel succeeds, run `supabase/reminder_schedule.sql` once so Monday submission and Tuesday approval reminders use the updated schedule.

Do not deploy the application before migration 005. The new screens read columns introduced by that migration.

## Database smoke check

Run this in Supabase SQL Editor after the migration:

```sql
select reporting_cycle, week_start, week_end
from public.reporting_periods
order by week_end desc
limit 5;

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'report_source_values'
  and column_name in (
    'staff_cost', 'paid_hours', 'pending_credits', 'awaiting_invoice',
    'sales_source', 'purchasing_source', 'labour_source', 'stocktake_completed'
  )
order by column_name;
```

The second query should return eight rows. Existing Monday-to-Sunday records remain labelled `legacy_monday_sunday`; new reports use `sunday_saturday`.

## Real-file UAT checkpoint

Create or use the Dough Religion test site and select Sunday 5 July to Saturday 11 July 2026. The supplied exports should produce:

| Source | Expected result |
|---|---:|
| StockLink gross after adjustments | £18,155.33 |
| VAT | £2,817.57 |
| Service charge | £963.88 |
| Net sales stored | £14,373.88 |
| Procure Wizard delivered food spend | £1,659.35 |
| Included amount awaiting invoice | £145.01 |
| Confirmed credits deducted | £0.00 |
| Pending credit sent to review | £2.40 |

Without opening and closing stocktakes, the result must say **Food spend**, not food cost. The £2.40 pending credit must not reduce spend and must create a review item.

For labour, use the RotaCloud **Daily Totals** report. It contains one row per day and is the preferred privacy-safe source. Employee Totals is supported but contains unnecessary names, payroll IDs and pay-rate columns. If costs are unavailable, enter the single aggregate weekly wage cost and optional paid hours manually, then confirm it. Employee names, salaries, hourly rates and source rows must never appear in the browser request or public database tables.

Before live use, HR should confirm that every hourly employee has the correct hourly/custom role rate, every salaried employee has an annual salary and weekly hours, salaried hourly-equivalent cost estimates are enabled, and your manager role can view wage and salary costs. Export Daily Totals again and check that `Total Cost` is positive for the week.

## Workflow acceptance test

- Save a partially completed report as a draft, return to Weekly reports, and reopen it. Totals, confirmations, stock setting and narrative should be restored.
- Try a StockLink or Procure Wizard file for the wrong site or week. The browser must reject it before submission.
- Confirm that submission stays disabled until sales, purchasing and a positive aggregate wage cost are confirmed.
- Submit the report. It should open the review screen and show source types, safe totals and any approval flags.
- Resolve actionable flags with a written note and approve using a group-manager account.
- Confirm that the group summary stays locked until every required kitchen is approved.
- Try browser print before release. Only the unreleased-summary warning should print.
- Release the summary, then print it. The released summary should print normally.
- Create a new kitchen and check the **First reporting week starts** field. It must accept a Sunday and must not make an earlier summary incomplete.

## Manual fallback policy

API connections are optional. Kitchen managers may use:

- StockLink upload or manual net sales excluding VAT and service charge;
- Procure Wizard uploads or manual delivered food spend and confirmed credits;
- opening and closing stock only when a reliable same-basis stocktake was completed;
- RotaCloud upload or one manual aggregate wage-cost total.

Every manual total requires an explicit manager confirmation. Raw exports should be retained according to the company’s normal finance document policy, outside this application.

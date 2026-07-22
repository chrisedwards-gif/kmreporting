# UAT 017 — Rota live-data learning loop

Run this in staging only. Production remains unchanged and RotaCloud write-back remains disabled.

## Staging data now loaded

Dough Religion has a provisional operating dataset built from the supplied exports:

- 87 days of Access EPOS daily net sales from 27 April to 22 July 2026
- 87 days of aggregate RotaCloud scheduled/actual labour history
- 1,044 modelled hourly sales points using real daily EPOS totals and the uploaded weekday Time Zone curve
- six private staff profiles with provisional hours, rates, roles and skills
- an £88 net-sales-per-labour-hour calibration derived from recent scheduled labour performance

The Time Zone curve is marked **manual** because it is an aggregated weekday profile, not date-level hourly EPOS history. Replace the modelled points when exact dated hourly exports become available.

## 1. Confirm the operating assumptions

1. Sign in as an admin or group manager.
2. Open **Rota intelligence → Calibrate site** and choose Dough Religion.
3. Confirm the displayed labour target. Staging currently inherits the site's existing 32% target; do not change it merely to match an example calculation.
4. Confirm opening, closing, prep and close-down times for all seven days.
5. Confirm the minimum cover of two and the days requiring a Kitchen Manager.
6. Confirm the £88 sales-per-labour-hour target is sensible as the initial productivity guardrail.
7. Save only after the assumptions match the real kitchen.

## 2. Confirm private staff profiles

Open **Staff profiles** and review each provisional record:

- Warren Raisbeck — salaried Kitchen Manager
- Owen Birrell — Pizzaiolo
- Bedreddine Dachraoui — Pizzaiolo
- Bhavya Pawar — Kitchen Team
- Logan Butler — Kitchen Team
- Finlay James-Lewis — Kitchen Team

For each person, confirm:

- pay basis and rate/salary
- minimum, target and maximum weekly hours
- site access
- working preferences
- opening/closing capability
- skills and stations
- shift-length limits

Employer NI, pension and other on-cost rates remain zero until confirmed. Do not treat the suggested cost as fully loaded until those values are entered.

## 3. Generate the first real suggestion

1. Open **Rota intelligence**.
2. Choose Dough Religion and week commencing 27 July 2026, or the next unplanned Monday.
3. Add any known events, promotions, catering orders or closures.
4. Generate the suggestion once.
5. Confirm all seven daily sales forecasts show evidence and a confidence range.
6. Confirm Friday/Saturday peak coverage is later and heavier than the weekday daytime pattern.
7. Confirm Sunday drops earlier than Friday/Saturday.
8. Review every unfilled shift and warning.
9. Download the CSV and manually compare the total daily cost with RotaCloud before entering any shift.

## 4. Check the learning loop

1. Open **Shift feedback** from the rota page.
2. Select a completed shift date with imported sales and labour.
3. Confirm the evidence card shows net sales, scheduled hours/cost and available actual hours/cost.
4. Submit a staffing rating, affected period, cause and whether the same staffing should be repeated.
5. Refresh and confirm the entry appears in recent feedback.
6. Submit the same date again and confirm it updates rather than creating a duplicate for the same manager.
7. Sign in as a manager restricted to another kitchen and confirm Dough Religion feedback is not visible.

## 5. Import endpoint check

Send a staging-only request to `POST /api/imports/rota-history` with the server `IMPORT_SECRET` and one disposable date. Confirm:

- an invalid secret returns 401
- invalid or negative values return 400
- a valid row is upserted, not duplicated
- individual employee wages or names are not accepted by the schema
- the import creates an audit-log entry

## Pass condition

UAT passes when the real weekly suggestion is operationally credible, private pay boundaries hold, daily budget calculations reconcile with RotaCloud, shift feedback is retained, and a manager confirms the provisional staff/site assumptions.

Do not merge to production until employer on-costs, staff constraints, site times and the first generated rota have been signed off.

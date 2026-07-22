# Rota intelligence implementation plan

## Outcome

Produce an explainable weekly staffing suggestion in one click, then let a manager review and copy it into RotaCloud. RotaCloud remains the published-rota system of record until read-only matching and real-kitchen UAT are proven.

## What the first release does

1. Forecasts each site/day from recent matching weekdays, excluding statistical outliers and applying a capped trend.
2. Shows a forecast range, confidence and historical backtest error rather than a false single-number certainty.
3. Applies known event uplifts with a named reason.
4. Calculates the loaded labour envelope from forecast sales and the site labour target.
5. Separates fixed salaried cost from controllable hourly cost.
6. Converts demand into required cover using sales-per-labour-hour, minimum/maximum staffing and a day-part curve.
7. Assigns named staff while enforcing skills, availability, leave, cross-site conflicts, maximum hours, shift limits, consecutive days and rest.
8. Leaves impossible shifts unfilled instead of breaking a hard rule.
9. Saves a versioned, audited suggestion and exports a CSV for manual entry into RotaCloud.

## Data needed for reliable suggestions

| Data | Minimum | Best available source | Why it matters |
|---|---|---|---|
| Daily net sales | 4 matching weekdays; 8–12 preferred | EPOS / weekly report | Daily sales forecast and variance |
| Intraday sales | 4 matching weekdays per day | Hourly EPOS export/API | Places extra cover around real peaks |
| Labour target | Per site | Commercial targets | Sets the loaded-cost ceiling |
| Opening model | Open/close, prep, close-down, min/max cover | Site calibration | Prevents unsafe cost optimisation |
| Staff cost | Hourly rate or annual salary, contracted hours and employer on-costs | Private profile / RotaCloud | Converts cover into real loaded cost |
| Working constraints | Min/target/max weekly hours, min/max shift, consecutive days and rest | Private profile | Keeps suggestions lawful and workable |
| Capability | Role and skills | Private profile / RotaCloud role | Ensures each shift has the required skill mix |
| Preferences | Preferred days and start/end times | Private profile | Improves fairness and acceptance after hard rules pass |
| Availability and leave | Planning-week dates | RotaCloud | Prevents assigning unavailable staff |
| Cross-site commitments | Planning-week shifts | Existing plans / RotaCloud | Prevents double-booking |
| Events | Date, expected uplift and evidence | Manager/calendar | Handles matches, holidays, promotions and closures |

## Decision hierarchy

Hard constraints always win: site access, trading hours, minimum cover, required skills, availability/leave, overlapping shifts, rest, maximum hours and shift length.

The optimiser then favours target/minimum-hour gaps, preferred days/times, appropriate skills and sensible use of salaried cover. Wage cost is one ranking input, never permission to violate a hard constraint.

## Forecast model and mistake controls

- Up to the configured number of recent matching weekdays are recency weighted.
- Median absolute deviation excludes one-off outliers.
- Recent trend influence is deliberately capped.
- Events are explicit, named adjustments.
- Daily demand curves average each day's sales proportions before combining days, preventing one unusually busy day from dominating the peak shape.
- Manual demand curves are explicit audited overrides; otherwise hourly actuals replace the fallback only after the minimum history threshold is met.
- Backtesting reports actual historical error. Low-history sites are labelled `building history`.
- Generated plans are suggestions, versioned on every rerun and never automatically published.

## RotaCloud boundary

The optional server-side connection reads locations, roles, staff, contracted hours/pay (including the default role's hourly override), availability and approved leave. Pagination is followed so larger accounts are not silently truncated. API keys stay server-side and should be treated as highly privileged.

The first release does not create or publish shifts. A manager reviews warnings and downloads the suggestion for manual entry. Write-back should be a later, separately approved release with a dry-run diff, idempotency key, explicit publish confirmation and rollback procedure.

Official references:

- [RotaCloud API documentation](https://rotacloud-api-docs.netlify.app/)
- [RotaCloud API help](https://help.rotacloud.com/en/articles/10429720-where-can-i-find-api-documentation-for-rotacloud)
- [RotaCloud labour-cost control](https://rotacloud.com/features/labour-cost-control/)

## AI role

The constraint engine—not a language model—owns the numbers and hard rules. A later OpenAI review layer can explain a plan, flag unusual patterns and propose manager questions, but it must consume the structured plan, never receive raw payroll exports, never invent availability, and never override hard constraints. It should be activated only after an API key, evaluation set and explicit UAT acceptance criteria exist.

## Accuracy learning loop

After each week, retain forecast versus actual sales, planned versus actual hours/cost, unfilled shifts, manager edits and the stated edit reason. Review accuracy by site and weekday monthly. Add weather or calendar features only when backtesting proves they reduce error; do not add complexity on intuition alone.

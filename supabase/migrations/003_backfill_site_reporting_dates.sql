-- Correct effective reporting dates for sites that existed before the
-- reporting_start_date/reporting_end_date columns were introduced.

with boundaries as (
  select
    site.id,
    min(period.week_start) filter (where report.id is not null) as first_report_week,
    max(period.week_end) filter (where report.id is not null) as last_report_week
  from public.sites site
  left join public.weekly_reports report on report.site_id = site.id
  left join public.reporting_periods period on period.id = report.period_id
  group by site.id
)
update public.sites site
set
  reporting_start_date = case
    when site.active then least(
      site.reporting_start_date,
      coalesce(boundaries.first_report_week, current_date - (extract(isodow from current_date)::integer + 6))
    )
    else coalesce(boundaries.first_report_week, date '2000-01-01')
  end,
  reporting_end_date = case
    when site.active then null
    else coalesce(boundaries.last_report_week, date '2000-01-01')
  end,
  updated_at = now()
from boundaries
where boundaries.id = site.id;

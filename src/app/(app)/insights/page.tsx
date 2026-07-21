import Link from "next/link";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarRange, DatabaseZap, Minus, TrendingUp } from "lucide-react";
import { ComparisonChart } from "@/components/insights/comparison-chart";
import { requireSessionProfile } from "@/lib/auth/dal";
import { getComparisonSites, getReportingComparison } from "@/lib/data/comparisons";
import { resolveComparisonRange } from "@/lib/reporting/comparison-ranges";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Performance history" };

type Params = {
  mode?: string;
  anchor?: string;
  start?: string;
  end?: string;
  site?: string;
};

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, profile] = await Promise.all([searchParams, requireSessionProfile()]);
  const sites = await getComparisonSites(profile);
  const requestedSite = sites.find((site) => site.id === params.site)?.id ?? null;
  const selectedSiteId = profile.siteScopeIds === null ? requestedSite : requestedSite ?? sites[0]?.id ?? null;
  const canViewGroup = profile.siteScopeIds === null;
  const range = resolveComparisonRange(params);
  const { data, error } = await getReportingComparison({ profile, siteId: selectedSiteId, start: range.start, end: range.end });
  const current = data.metrics.current;
  const previous = data.metrics.previous;
  const priorYear = data.metrics.prior_year;
  const selectedSite = sites.find((site) => site.id === selectedSiteId);
  const subject = selectedSite?.name ?? "All kitchens";
  const hasCurrentData = current.salesDays > 0 || current.reportWeeks > 0;
  const hasPriorYear = priorYear.salesDays > 0 || priorYear.reportWeeks > 0;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Insight · historical reporting</p>
          <h1 className="page-header__title">Performance history.</h1>
          <p className="page-header__copy">Compare a day, calendar month, calendar year or custom range against the previous equivalent period and the same dates last year.</p>
        </div>
        <Link className="button button--secondary" href="/summary"><ArrowLeft aria-hidden="true" size={16} /> Management summary</Link>
      </header>

      <form className="comparison-filters panel" method="get">
        <label className="field">
          <span className="field__label">Kitchen</span>
          <select className="field__input" defaultValue={selectedSiteId ?? "all"} name="site">
            {canViewGroup ? <option value="all">All kitchens</option> : null}
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.active ? "" : " · archived"}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Comparison view</span>
          <select className="field__input" defaultValue={range.mode} name="mode">
            <option value="day">Exact day</option>
            <option value="month">Calendar month</option>
            <option value="year">Calendar year</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        <label className="field"><span className="field__label">Anchor date</span><input className="field__input" defaultValue={range.anchor} name="anchor" type="date" /></label>
        <label className="field"><span className="field__label">Custom start</span><input className="field__input" defaultValue={params.start ?? range.start} name="start" type="date" /></label>
        <label className="field"><span className="field__label">Custom end</span><input className="field__input" defaultValue={params.end ?? range.end} name="end" type="date" /></label>
        <button className="button button--primary" type="submit"><CalendarRange aria-hidden="true" size={16} /> Compare</button>
      </form>

      {error ? <div className="form-message form-message--error" role="alert">{error}</div> : null}

      <section className="comparison-hero">
        <div>
          <p className="page-header__eyebrow">{subject}</p>
          <h2>{range.label}</h2>
          <p>{formatDate(range.start)} to {formatDate(range.end)} · previous equivalent and prior-year dates calculated automatically</p>
        </div>
        <div className="comparison-coverage">
          <strong>{current.salesDays} sales day{current.salesDays === 1 ? "" : "s"}</strong>
          <span>{current.reportWeeks} approved weekly cost snapshot{current.reportWeeks === 1 ? "" : "s"}</span>
        </div>
      </section>

      {!hasCurrentData ? (
        <section className="panel empty-state comparison-empty">
          <DatabaseZap aria-hidden="true" size={28} />
          <h2>No recorded data in this range yet.</h2>
          <p>The comparison system is ready. It will populate automatically as dated EPOS data and approved weekly reports are stored.</p>
          {data.availability.firstDailyDate ? <p>Available daily history currently runs from {formatDate(data.availability.firstDailyDate)} to {formatDate(data.availability.lastDailyDate ?? data.availability.firstDailyDate)}.</p> : null}
        </section>
      ) : (
        <>
          <section aria-label="Selected period scorecard" className="comparison-scorecard">
            <ComparisonMetric label="Net sales" current={current.netSales} previous={previous.netSales} priorYear={priorYear.netSales} format={(value) => value == null ? "—" : formatCurrency(value)} />
            <ComparisonMetric label="Average transaction" current={current.averageTransactionValue} previous={previous.averageTransactionValue} priorYear={priorYear.averageTransactionValue} format={(value) => value == null ? "—" : formatCurrency(value)} />
            <ComparisonMetric label="Transactions" current={current.transactions} previous={previous.transactions} priorYear={priorYear.transactions} format={(value) => value == null ? "—" : Math.round(value).toLocaleString("en-GB")} />
            <ComparisonMetric label="Covers" current={current.covers} previous={previous.covers} priorYear={priorYear.covers} format={(value) => value == null ? "—" : Math.round(value).toLocaleString("en-GB")} />
            <ComparisonMetric inverse label="Food cost / spend" current={current.foodCostPct} previous={previous.foodCostPct} priorYear={priorYear.foodCostPct} percentagePoints format={(value) => value == null ? "Pending" : formatPercentage(value)} />
            <ComparisonMetric inverse label="Labour" current={current.labourPct} previous={previous.labourPct} priorYear={priorYear.labourPct} percentagePoints format={(value) => value == null ? "Pending" : formatPercentage(value)} />
            <ComparisonMetric inverse label="Waste" current={current.wastePct} previous={previous.wastePct} priorYear={priorYear.wastePct} percentagePoints format={(value) => value == null ? "Pending" : formatPercentage(value)} />
            <ComparisonMetric inverse label="Prime cost" current={current.primeCostPct} previous={previous.primeCostPct} priorYear={priorYear.primeCostPct} percentagePoints format={(value) => value == null ? "Pending" : formatPercentage(value)} />
          </section>

          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Daily sales shape</h2><p className="panel__subtitle">Dates are aligned by position within each comparison period</p></div><TrendingUp aria-hidden="true" color="#2d7a62" size={20} /></div>
            <ComparisonChart current={data.daily.current} previous={data.daily.previous} priorYear={data.daily.prior_year} />
          </section>

          <section className="comparison-context-grid">
            <article className="panel comparison-context-card"><h2>Previous equivalent period</h2><p>{formatDate(previous.start)} to {formatDate(previous.end)}</p><strong>{previous.salesDays || previous.reportWeeks ? `${previous.salesDays} sales days · ${previous.reportWeeks} report weeks` : "No matching history yet"}</strong></article>
            <article className={`panel comparison-context-card${hasPriorYear ? "" : " comparison-context-card--pending"}`}><h2>Same period last year</h2><p>{formatDate(priorYear.start)} to {formatDate(priorYear.end)}</p><strong>{hasPriorYear ? `${priorYear.salesDays} sales days · ${priorYear.reportWeeks} report weeks` : "This comparison will unlock automatically when prior-year dates exist"}</strong></article>
            <article className="panel comparison-context-card"><h2>History coverage</h2><p>{data.availability.firstDailyDate ? `${formatDate(data.availability.firstDailyDate)} to ${formatDate(data.availability.lastDailyDate ?? data.availability.firstDailyDate)}` : "No dated sales history yet"}</p><strong>{data.availability.totalSalesDays} dated sales rows · {data.availability.totalReportWeeks} approved weekly snapshots</strong></article>
          </section>

          <section className="panel">
            <div className="panel__header"><div><h2 className="panel__title">Recorded days</h2><p className="panel__subtitle">Most recent 14 days inside the selected range</p></div></div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Net sales</th><th>Transactions</th><th>ATV</th><th>Covers</th></tr></thead>
                <tbody>{data.daily.current.slice(-14).reverse().map((day) => <tr key={day.businessDate}><td><strong>{formatDate(day.businessDate)}</strong></td><td>{formatCurrency(day.netSales)}</td><td>{day.transactions.toLocaleString("en-GB")}</td><td>{day.transactions ? formatCurrency(day.netSales / day.transactions) : "—"}</td><td>{day.covers.toLocaleString("en-GB")}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function ComparisonMetric({ label, current, previous, priorYear, format, inverse = false, percentagePoints = false }: { label: string; current: number | null; previous: number | null; priorYear: number | null; format: (value: number | null) => string; inverse?: boolean; percentagePoints?: boolean }) {
  return <article className="comparison-metric"><span>{label}</span><strong>{format(current)}</strong><div className="comparison-metric__deltas"><Delta current={current} inverse={inverse} label="vs previous" percentagePoints={percentagePoints} reference={previous} /><Delta current={current} inverse={inverse} label="vs last year" percentagePoints={percentagePoints} reference={priorYear} /></div></article>;
}

function Delta({ current, reference, label, inverse, percentagePoints }: { current: number | null; reference: number | null; label: string; inverse: boolean; percentagePoints: boolean }) {
  if (current == null || reference == null || (!percentagePoints && reference === 0)) return <span className="comparison-delta comparison-delta--muted"><Minus aria-hidden="true" size={12} /> {label}: no data</span>;
  const change = percentagePoints ? current - reference : (current - reference) / Math.abs(reference) * 100;
  const positive = change > 0.049;
  const negative = change < -0.049;
  const favourable = inverse ? negative : positive;
  const tone = !positive && !negative ? "muted" : favourable ? "good" : "bad";
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  return <span className={`comparison-delta comparison-delta--${tone}`}><Icon aria-hidden="true" size={12} /> {label}: {percentagePoints ? `${Math.abs(change).toFixed(1)}pp ${positive ? "higher" : negative ? "lower" : "flat"}` : `${Math.abs(change).toFixed(1)}% ${positive ? "up" : negative ? "down" : "flat"}`}</span>;
}

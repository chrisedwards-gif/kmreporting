import { DatabaseZap, EyeOff, LockKeyhole, RefreshCw } from "lucide-react";
import { SitePerformanceTable } from "@/components/dashboard/site-performance-table";
import { getReportingBundle } from "@/lib/data/reporting";

export const metadata = { title: "Cost control" };

export default async function CostsPage() {
  const { sites } = await getReportingBundle();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Finance-safe cost engine</p>
          <h1 className="page-header__title">Current costs. Private pay.</h1>
          <p className="page-header__copy">Payroll rates are joined to imported hours inside the database. The app receives only each kitchen’s aggregated staff cost.</p>
        </div>
        <button className="button button--secondary" type="button"><RefreshCw aria-hidden="true" size={16} /> Refresh source data</button>
      </header>

      <section aria-label="Privacy model" className="metric-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <article className="metric-card" style={{ "--accent": "#1e2e35" } as React.CSSProperties}><LockKeyhole aria-hidden="true" color="#1e2e35" size={22} /><div className="metric-card__value" style={{ fontSize: "1.2rem" }}>Private payroll schema</div><div className="metric-card__note">No browser or kitchen-role access</div></article>
        <article className="metric-card" style={{ "--accent": "#2d7a62" } as React.CSSProperties}><DatabaseZap aria-hidden="true" color="#2d7a62" size={22} /><div className="metric-card__value" style={{ fontSize: "1.2rem" }}>Server-side calculation</div><div className="metric-card__note">Hours × effective loaded rate</div></article>
        <article className="metric-card" style={{ "--accent": "#eb6b4f" } as React.CSSProperties}><EyeOff aria-hidden="true" color="#eb6b4f" size={22} /><div className="metric-card__value" style={{ fontSize: "1.2rem" }}>Safe snapshots</div><div className="metric-card__note">Site total and percentage only</div></article>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Current weekly cost snapshot</h2><p className="panel__subtitle">Refreshed after payroll/time and purchasing imports</p></div><span className="status-badge status-badge--approved">Safe aggregate</span></div>
        <SitePerformanceTable sites={sites} />
      </section>
    </>
  );
}

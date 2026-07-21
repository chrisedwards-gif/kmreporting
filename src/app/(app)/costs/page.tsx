import Link from "next/link";
import { BadgePoundSterling, DatabaseZap, EyeOff, LineChart, LockKeyhole } from "lucide-react";
import { SitePerformanceTable } from "@/components/dashboard/site-performance-table";
import { RefreshDataButton } from "@/components/ui/refresh-data-button";
import { getReportingBundle } from "@/lib/data/reporting";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";

export const metadata = { title: "Cost control" };

export default async function CostsPage() {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager", "finance"]);
  const { sites } = await getReportingBundle();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Finance-safe cost engine</p>
          <h1 className="page-header__title">Current costs. Private pay.</h1>
          <p className="page-header__copy">Kitchen managers confirm aggregate RotaCloud labour. Admin-controlled salary accruals and employer on-costs can then be added privately to produce the full weekly staff cost.</p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" href="/insights"><LineChart aria-hidden="true" size={16} /> Compare history</Link>
          {profile.actualRole === "admin" ? <Link className="button button--secondary" href="/costs/salaries"><BadgePoundSterling aria-hidden="true" size={16} /> Salary allocations</Link> : null}
          <RefreshDataButton />
        </div>
      </header>

      <section aria-label="Privacy model" className="metric-grid metric-grid--three">
        <article className="metric-card" style={{ "--accent": "#1e2e35" } as React.CSSProperties}><LockKeyhole aria-hidden="true" color="#1e2e35" size={22} /><div className="metric-card__value metric-card__value--compact">Aggregate labour</div><div className="metric-card__note">Hourly rota total plus optional weekly salary accrual</div></article>
        <article className="metric-card" style={{ "--accent": "#2d7a62" } as React.CSSProperties}><DatabaseZap aria-hidden="true" color="#2d7a62" size={22} /><div className="metric-card__value metric-card__value--compact">Source-controlled</div><div className="metric-card__note">RotaCloud upload, salary allocation or private API</div></article>
        <article className="metric-card" style={{ "--accent": "#eb6b4f" } as React.CSSProperties}><EyeOff aria-hidden="true" color="#eb6b4f" size={22} /><div className="metric-card__value metric-card__value--compact">Private detail</div><div className="metric-card__note">Reports expose site totals, never individual salaries</div></article>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Current weekly cost snapshot</h2><p className="panel__subtitle">Refreshed after manager confirmation, salary changes or connected imports</p></div><span className="status-badge status-badge--approved">Safe aggregate</span></div>
        <SitePerformanceTable sites={sites} />
      </section>
    </>
  );
}

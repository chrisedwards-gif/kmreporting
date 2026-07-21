import Link from "next/link";
import { ArrowLeft, BadgePoundSterling, LockKeyhole } from "lucide-react";
import { DeleteSalaryAllocationButton, SalaryAllocationForm, SalarySiteToggle } from "@/components/salaries/salary-allocation-form";
import { requireActualRole } from "@/lib/auth/dal";
import { getSalaryWorkspace } from "@/lib/data/salaries";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";
import { formatCurrency, formatDate } from "@/lib/utils";

export const metadata = { title: "Salary allocations" };

export default async function SalaryAllocationsPage() {
  await requireActualRole(["admin"]);
  const { sites, profiles, allocations } = await getSalaryWorkspace();
  const currentWeek = getCurrentReportingWeek();
  const activeAllocations = allocations.filter((item) => item.active);
  const weeklyBase = activeAllocations.reduce((total, item) => total + item.weeklyBaseCost, 0);
  const weeklyOncost = activeAllocations.reduce((total, item) => total + item.weeklyOncost, 0);
  const weeklyLoaded = activeAllocations.reduce((total, item) => total + item.weeklyLoadedCost, 0);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Private payroll control</p>
          <h1 className="page-header__title">Salary allocations.</h1>
          <p className="page-header__copy">Assign annual salaries to a kitchen, add employer on-costs and decide site by site whether the weekly accrual is included in reported staff cost. Kitchen Managers only see the aggregate weekly addition.</p>
        </div>
        <Link className="button button--secondary" href="/costs"><ArrowLeft aria-hidden="true" size={16} /> Cost control</Link>
      </header>

      <section aria-label="Salary totals" className="metric-grid metric-grid--three">
        <article className="metric-card" style={{ "--accent": "#1e2e35" } as React.CSSProperties}><div className="metric-card__label">Weekly base salary</div><div className="metric-card__value">{formatCurrency(weeklyBase)}</div><div className="metric-card__note">Across active allocations</div></article>
        <article className="metric-card" style={{ "--accent": "#d47a1f" } as React.CSSProperties}><div className="metric-card__label">Weekly on-cost</div><div className="metric-card__value">{formatCurrency(weeklyOncost)}</div><div className="metric-card__note">Employer NI, pension and other cost</div></article>
        <article className="metric-card" style={{ "--accent": "#2d7a62" } as React.CSSProperties}><BadgePoundSterling aria-hidden="true" color="#2d7a62" size={22} /><div className="metric-card__value metric-card__value--compact">{formatCurrency(weeklyLoaded)}</div><div className="metric-card__note">Full weekly loaded salary cost</div></article>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Kitchen inclusion</h2><p className="panel__subtitle">The toggle affects all weekly cost snapshots for that kitchen</p></div><LockKeyhole aria-hidden="true" size={18} /></div>
        <div className="panel__body salary-toggle-list">{sites.map((site) => <SalarySiteToggle key={site.id} site={site} />)}</div>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Add salary allocation</h2><p className="panel__subtitle">A salary can be linked to an app user or stored for a staff member who never logs in</p></div></div>
        <div className="panel__body"><SalaryAllocationForm defaultDate={currentWeek.start} profiles={profiles} sites={sites} /></div>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Current salary register</h2><p className="panel__subtitle">Private annual figures and their weekly site accrual</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Staff member</th><th>Kitchen</th><th>Annual salary</th><th>Allocation</th><th>On-cost</th><th>Weekly loaded cost</th><th>Valid</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {allocations.map((item) => <tr key={item.id}><td><strong>{item.staffName}</strong><span className="basis-label">{item.roleTitle || (item.profileId ? "Linked user" : "No login")}</span></td><td>{item.siteName}</td><td>{formatCurrency(item.annualSalary, 2)}</td><td>{item.allocationPct.toFixed(1)}%</td><td>{item.oncostRate.toFixed(1)}%<span className="basis-label">{formatCurrency(item.weeklyOncost, 2)} / week</span></td><td><strong>{formatCurrency(item.weeklyLoadedCost, 2)}</strong><span className="basis-label">{formatCurrency(item.weeklyBaseCost, 2)} base</span></td><td>{formatDate(item.validFrom)}{item.validTo ? ` – ${formatDate(item.validTo)}` : " onward"}<span className={`status-badge status-badge--${item.active ? "approved" : "draft"}`}>{item.active ? "Active" : "Inactive"}</span></td><td><DeleteSalaryAllocationButton allocationId={item.id} staffName={item.staffName} /></td></tr>)}
              {!allocations.length ? <tr><td colSpan={8}><div className="empty-inline">No salaries have been allocated yet. Add Warren at £35,000 with 18% on-cost to produce a weekly loaded cost of approximately £794.23.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

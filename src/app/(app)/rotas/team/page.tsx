import Link from "next/link";
import { ArrowLeft, EyeOff, LockKeyhole, UsersRound } from "lucide-react";
import { RotaCloudSync, StaffProfileEditor } from "@/components/rotas/staff-profile-editor";
import { requireActualRole } from "@/lib/auth/dal";
import { getRotaStaffWorkspace } from "@/lib/data/rotas";

export const metadata = { title: "Rota staff profiles" };

export default async function RotaTeamPage() {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const workspace = await getRotaStaffWorkspace(profile);
  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Private rota inputs</p><h1 className="page-header__title">Staff profiles.</h1><p className="page-header__copy">Capture wage basis, hour limits, skills and working preferences once. The planner uses them privately; kitchen rota views receive only names, shifts and site totals.</p></div><Link className="button button--secondary" href="/rotas"><ArrowLeft aria-hidden="true" size={16} /> Rota planner</Link></header>
      <section aria-label="Rota privacy" className="metric-grid metric-grid--three">
        <article className="metric-card"><LockKeyhole aria-hidden="true" color="#1e2e35" size={21} /><div className="metric-card__value metric-card__value--compact">Private pay</div><div className="metric-card__note">Rates and salaries stay in the protected payroll schema</div></article>
        <article className="metric-card"><UsersRound aria-hidden="true" color="#2d7a62" size={21} /><div className="metric-card__value metric-card__value--compact">Human constraints</div><div className="metric-card__note">Availability, preferences, rest, skills and hour limits</div></article>
        <article className="metric-card"><EyeOff aria-hidden="true" color="#eb6b4f" size={21} /><div className="metric-card__value metric-card__value--compact">Aggregate output</div><div className="metric-card__note">KMs never see an individual’s wage or calculated shift cost</div></article>
      </section>
      {workspace.error ? <div className="form-message form-message--error" role="alert">{workspace.error}</div> : null}
      <RotaCloudSync configured={workspace.rotacloudConfigured} />
      <StaffProfileEditor defaultDate={new Date().toISOString().slice(0, 10)} sites={workspace.sites} />
      <section className="staff-directory"><div className="panel__header"><div><h2 className="panel__title">Current planning profiles</h2><p className="panel__subtitle">One person may have multiple site allocations without exposing private rates outside this screen.</p></div><span className="status-badge status-badge--approved">{workspace.staff.length} site profiles</span></div>{workspace.staff.map((staff) => <StaffProfileEditor defaultDate={new Date().toISOString().slice(0, 10)} key={`${staff.id}-${staff.siteId}-${staff.validFrom}`} sites={workspace.sites} staff={staff} />)}{!workspace.staff.length ? <section className="panel empty-state"><h2>No staff profiles yet.</h2><p>Add them manually above, or connect RotaCloud for a read-only team import.</p></section> : null}</section>
    </>
  );
}

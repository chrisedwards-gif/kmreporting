import Link from "next/link";
import { AlertTriangle, ArrowLeft, EyeOff, Link2, LockKeyhole, UsersRound } from "lucide-react";
import { RotaOrderManager, type RotaOrderPerson } from "@/components/rotas/rota-order-manager";
import { RotaCloudSync, StaffProfileEditor } from "@/components/rotas/staff-profile-editor";
import { requireActualRole } from "@/lib/auth/dal";
import { getRotaStaffWorkspace } from "@/lib/data/rotas";

export const metadata = { title: "Rota staff profiles" };

export default async function RotaTeamPage() {
  const profile = await requireActualRole(["admin", "group_manager"]);
  const workspace = await getRotaStaffWorkspace(profile);
  const uniqueStaff = [...new Map(
    [...workspace.staff]
      .sort((a, b) => Number(a.primarySite) - Number(b.primarySite))
      .map((staff) => [staff.id, staff]),
  ).values()];
  const rotaOrder: RotaOrderPerson[] = uniqueStaff.map((staff) => ({
    id: staff.id,
    name: staff.staffName,
    role: staff.primaryRole || staff.roleTitle || "Kitchen Team",
    roleRank: staff.roleRank,
    displayOrder: staff.displayOrder,
  }));
  const unlinkedAccounts = workspace.appProfiles.filter((account) => !account.linkedStaffId);

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Private rota inputs</p><h1 className="page-header__title">Rota team and identity.</h1><p className="page-header__copy">Link each rota person to their real KM Reporting account, set where they can appear and control the order managers see in every weekly rota.</p></div><Link className="button button--secondary" href="/rotas"><ArrowLeft aria-hidden="true" size={16} /> Rota planner</Link></header>
      <section aria-label="Rota privacy" className="metric-grid metric-grid--three">
        <article className="metric-card"><Link2 aria-hidden="true" color="#2d7a62" size={21} /><div className="metric-card__value metric-card__value--compact">One identity</div><div className="metric-card__note">Login, rota, actions and 1‑1s use the same linked app UUID</div></article>
        <article className="metric-card"><LockKeyhole aria-hidden="true" color="#1e2e35" size={21} /><div className="metric-card__value metric-card__value--compact">Private pay</div><div className="metric-card__note">Rates and salaries stay in the protected payroll schema</div></article>
        <article className="metric-card"><EyeOff aria-hidden="true" color="#eb6b4f" size={21} /><div className="metric-card__value metric-card__value--compact">Safe output</div><div className="metric-card__note">Kitchen managers cannot receive or infer salaried pay</div></article>
      </section>
      {workspace.error ? <div className="form-message form-message--error" role="alert">{workspace.error}</div> : null}
      {unlinkedAccounts.length ? (
        <section className="panel rota-identity-warning">
          <AlertTriangle aria-hidden="true" size={19} />
          <div><strong>{unlinkedAccounts.length} active account{unlinkedAccounts.length === 1 ? " is" : "s are"} not linked to a rota person.</strong><p>{unlinkedAccounts.map((account) => account.name).join(", ")}. Use “Add staff member” below and choose the correct account. No duplicate rota identity will be created when the UUID is linked.</p></div>
        </section>
      ) : null}
      <RotaOrderManager people={rotaOrder} />
      <RotaCloudSync configured={workspace.rotacloudConfigured} />
      <StaffProfileEditor appProfiles={workspace.appProfiles} defaultDate={new Date().toISOString().slice(0, 10)} sites={workspace.sites} />
      <section className="staff-directory"><div className="panel__header"><div><h2 className="panel__title">Current planning profiles</h2><p className="panel__subtitle">One person can have multiple site allocations while retaining one linked identity and one group-level display order.</p></div><span className="status-badge status-badge--approved">{uniqueStaff.length} people · {workspace.staff.length} site allocation{workspace.staff.length === 1 ? "" : "s"}</span></div>{workspace.staff.map((staff) => <StaffProfileEditor appProfiles={workspace.appProfiles} defaultDate={new Date().toISOString().slice(0, 10)} key={`${staff.id}-${staff.siteId}-${staff.validFrom}`} sites={workspace.sites} staff={staff} />)}{!workspace.staff.length ? <section className="panel empty-state"><UsersRound size={26} /><h2>No staff profiles yet.</h2><p>Add a linked account manually above, or connect RotaCloud for a read-only team import.</p></section> : null}</section>
    </>
  );
}

import { LockKeyhole, UserRoundCog } from "lucide-react";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getManagedSiteDirectory } from "@/lib/data/sites";
import { CreateSiteForm } from "@/components/sites/create-site-form";
import { ManageSiteForm } from "@/components/sites/manage-site-form";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Sites and access" };

export default async function SitesPage() {
  await requireGroupWorkspaceRole(["admin"]);
  const sites = await getManagedSiteDirectory();
  const currentWeek = getCurrentReportingWeek();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Configuration</p>
          <h1 className="page-header__title">Sites & access.</h1>
          <p className="page-header__copy">Each kitchen has one dated primary-manager assignment. The manager uses one profile/login UUID everywhere; replacing them closes the old assignment without deleting its reports or 1-1s.</p>
        </div>
        <CreateSiteForm defaultReportingStartDate={currentWeek.start} />
      </header>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Kitchen directory</h2><p className="panel__subtitle">Primary manager assignments drive the weekly 1-1 and its site KPIs</p></div><UserRoundCog aria-hidden="true" color="#5d6b63" size={19} /></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Kitchen</th><th>Site code</th><th>Primary manager</th><th>Reporting</th><th>Assignment</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id}>
                  <td><strong>{site.name}</strong></td>
                  <td><span className="code-pill">{site.code}</span></td>
                  <td>{site.primaryManager ? site.primaryManager.fullName : <span className="muted-text">Choose primary manager</span>}</td>
                  <td><span className={`status-badge status-badge--${site.active ? "approved" : "draft"}`}>{site.active ? "Active" : "Inactive"}</span></td>
                  <td>{site.primaryManager ? `Since ${formatDate(site.primaryManager.startsOn)}` : site.managerHistory.length ? `${site.managerHistory.length} previous assignment${site.managerHistory.length === 1 ? "" : "s"}` : "No history"}</td>
                  <td><ManageSiteForm defaultAssignmentStart={currentWeek.start} site={site} /></td>
                </tr>
              ))}
              {!sites.length ? <tr><td colSpan={6}><div className="empty-inline">No kitchens have been configured yet.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <div className="privacy-callout privacy-callout--spaced"><LockKeyhole aria-hidden="true" className="privacy-callout__icon" size={15} />Pay-rate access is not assignable here. Login identity, site assignment and payroll access remain separate controls.</div>
    </>
  );
}

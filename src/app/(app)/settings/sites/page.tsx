import { LockKeyhole, UserRoundCog } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";
import { getSiteDirectory } from "@/lib/data/reporting";
import { CreateSiteForm } from "@/components/sites/create-site-form";
import { ManageSiteForm } from "@/components/sites/manage-site-form";

export const metadata = { title: "Sites and access" };

export default async function SitesPage() {
  await requireRole(["admin"]);
  const sites = await getSiteDirectory();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Configuration</p>
          <h1 className="page-header__title">Sites & access.</h1>
          <p className="page-header__copy">Kitchen managers see assigned sites only. Group and finance roles are granted separately and audited.</p>
        </div>
        <CreateSiteForm />
      </header>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Kitchen directory</h2><p className="panel__subtitle">Active sites receive a report every Monday</p></div><UserRoundCog aria-hidden="true" color="#5f6e68" size={19} /></div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Kitchen</th><th>Site code</th><th>Manager</th><th>Reporting</th><th>Scoped access</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id}>
                  <td><strong>{site.name}</strong></td>
                  <td><span className="code-pill">{site.code}</span></td>
                  <td>{site.managers.length ? site.managers.map((manager) => manager.fullName).join(", ") : <span className="muted-text">Unassigned</span>}</td>
                  <td><span className={`status-badge status-badge--${site.active ? "approved" : "draft"}`}>{site.active ? "Active" : "Inactive"}</span></td>
                  <td>{site.managers.length ? `${site.managers.length} kitchen manager${site.managers.length === 1 ? "" : "s"}` : "No manager access"}</td>
                  <td><ManageSiteForm site={site} /></td>
                </tr>
              ))}
              {!sites.length ? <tr><td colSpan={6}><div className="empty-inline">No kitchens have been configured yet.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <div className="privacy-callout" style={{ marginTop: "1rem" }}><LockKeyhole aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".4rem", verticalAlign: "text-bottom" }} />Pay-rate access is not assignable here. It remains a server-only finance function, separated from normal application roles.</div>
    </>
  );
}

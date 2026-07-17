import { LockKeyhole, Plus, UserRoundCog } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";

export const metadata = { title: "Sites and access" };

const sites = [
  { code: "DR-MCR", name: "Dough Religion", manager: "Warren", state: "Active", access: "1 kitchen manager" },
  { code: "CW-MCR", name: "Choi Wan", manager: "Ricky", state: "Active", access: "1 kitchen manager" },
  { code: "KAR-MCR", name: "Kardia", manager: "Manager TBC", state: "Active", access: "Unassigned" },
  { code: "ANT-MCR", name: "Antoma", manager: "—", state: "Inactive", access: "No access" },
  { code: "BB-MCR", name: "Bombay Bird", manager: "—", state: "Inactive", access: "No access" },
];

export default async function SitesPage() {
  await requireRole(["admin"]);
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Configuration</p>
          <h1 className="page-header__title">Sites & access.</h1>
          <p className="page-header__copy">Kitchen managers see assigned sites only. Group and finance roles are granted separately and audited.</p>
        </div>
        <button className="button button--primary" type="button"><Plus aria-hidden="true" size={16} /> Add kitchen</button>
      </header>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Kitchen directory</h2><p className="panel__subtitle">Active sites receive a report every Monday</p></div><UserRoundCog aria-hidden="true" color="#5f6e68" size={19} /></div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead><tr><th>Kitchen</th><th>Site code</th><th>Manager</th><th>Reporting</th><th>Scoped access</th></tr></thead>
            <tbody>{sites.map((site) => <tr key={site.code}><td><strong>{site.name}</strong></td><td>{site.code}</td><td>{site.manager}</td><td><span className={`status-badge status-badge--${site.state === "Active" ? "approved" : "draft"}`}>{site.state}</span></td><td>{site.access}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <div className="privacy-callout" style={{ marginTop: "1rem" }}><LockKeyhole aria-hidden="true" size={15} style={{ display: "inline", marginRight: ".4rem", verticalAlign: "text-bottom" }} />Pay-rate access is not assignable here. It remains a server-only finance function, separated from normal application roles.</div>
    </>
  );
}

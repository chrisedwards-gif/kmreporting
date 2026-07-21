import { CircleDollarSign, Trash2 } from "lucide-react";
import { deleteWasteEntry } from "@/app/actions/waste";
import { WasteEntryForm } from "@/components/waste/waste-entry-form";
import { requireSessionProfile } from "@/lib/auth/dal";
import { getWasteWorkspace } from "@/lib/data/waste";
import { formatCurrency, formatDate } from "@/lib/utils";

export const metadata = { title: "Daily waste log" };

export default async function WastePage() {
  const profile = await requireSessionProfile();
  const { sites, entries } = await getWasteWorkspace(profile);
  const activeSites = sites.filter((site) => site.active);
  const openEntries = entries.filter((entry) => !entry.reportId);
  const capturedEntries = entries.filter((entry) => entry.reportId);
  const openTotal = openEntries.reduce((total, entry) => total + entry.estimatedCost, 0);
  const capturedTotal = capturedEntries.reduce((total, entry) => total + entry.estimatedCost, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Kitchen control · daily capture</p>
          <h1 className="page-header__title">Daily waste log.</h1>
          <p className="page-header__copy">Log waste on the day it happens. Entries automatically feed the Sunday-to-Saturday report covering their date and move to captured history when that report is submitted.</p>
        </div>
      </header>

      <section aria-label="Waste status" className="metric-grid metric-grid--three">
        <article className="metric-card" style={{ "--accent": "#d64724" } as React.CSSProperties}><div className="metric-card__label">Open waste</div><div className="metric-card__value">{formatCurrency(openTotal)}</div><div className="metric-card__note">{openEntries.length} uncaptured entr{openEntries.length === 1 ? "y" : "ies"}</div></article>
        <article className="metric-card" style={{ "--accent": "#2d7a62" } as React.CSSProperties}><div className="metric-card__label">Captured history</div><div className="metric-card__value">{formatCurrency(capturedTotal)}</div><div className="metric-card__note">Last 70 days shown</div></article>
        <article className="metric-card" style={{ "--accent": "#1e2e35" } as React.CSSProperties}><CircleDollarSign aria-hidden="true" color="#1e2e35" size={22} /><div className="metric-card__value metric-card__value--compact">Date-led reporting</div><div className="metric-card__note">Only dates inside the submitted week are captured</div></article>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Log today’s waste</h2><p className="panel__subtitle">Use cost price, not selling price</p></div></div>
        <div className="panel__body">
          {activeSites.length ? <WasteEntryForm sites={activeSites} today={today} /> : <div className="empty-inline">No active kitchen is available in your current access scope.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Open entries</h2><p className="panel__subtitle">These remain editable until their reporting week is submitted</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Kitchen</th><th>Item</th><th>Reason</th><th>Quantity</th><th>Cost</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {openEntries.map((entry) => <tr key={entry.id}><td><strong>{formatDate(entry.businessDate)}</strong></td><td>{entry.siteName}</td><td>{entry.itemName}<span className="basis-label">{entry.category}</span></td><td>{entry.reason}</td><td>{entry.quantity == null ? "—" : `${entry.quantity} ${entry.unit ?? ""}`.trim()}</td><td><strong>{formatCurrency(entry.estimatedCost, 2)}</strong></td><td><form action={deleteWasteEntry}><input name="entryId" type="hidden" value={entry.id} /><button aria-label={`Delete ${entry.itemName}`} className="icon-button" title="Delete open waste entry" type="submit"><Trash2 aria-hidden="true" size={16} /></button></form></td></tr>)}
              {!openEntries.length ? <tr><td colSpan={7}><div className="empty-inline">No open waste entries. New entries appear here until the matching weekly report is submitted.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Captured waste</h2><p className="panel__subtitle">Locked into submitted weekly reports</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Kitchen</th><th>Item</th><th>Reason</th><th>Cost</th><th>Logged by</th><th>Status</th></tr></thead>
            <tbody>
              {capturedEntries.map((entry) => <tr key={entry.id}><td><strong>{formatDate(entry.businessDate)}</strong></td><td>{entry.siteName}</td><td>{entry.itemName}</td><td>{entry.reason}</td><td>{formatCurrency(entry.estimatedCost, 2)}</td><td>{entry.loggedBy}</td><td><span className="status-badge status-badge--approved">Captured</span></td></tr>)}
              {!capturedEntries.length ? <tr><td colSpan={7}><div className="empty-inline">Captured entries will appear after the first report containing logged waste is submitted.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

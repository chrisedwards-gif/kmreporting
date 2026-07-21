import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { ReportForm } from "@/components/reports/report-form";
import { ReportSalesBridge } from "@/components/reports/report-sales-bridge";
import { requireRole } from "@/lib/auth/dal";
import { getReportingWeek } from "@/lib/data/reporting";
import { getScopedAccessibleSites, getScopedEditableDraft } from "@/lib/data/scoped-reporting";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";

export const metadata = { title: "New weekly report" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ period?: string; report?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const { period: periodId, report: reportId } = await searchParams;
  const [sites, draft, requestedWeek] = await Promise.all([
    getScopedAccessibleSites(profile),
    reportId ? getScopedEditableDraft(profile, reportId) : Promise.resolve(null),
    periodId ? getReportingWeek(periodId) : Promise.resolve(null),
  ]);
  const editableDraft = draft && sites.some((site) => site.id === draft.siteId) ? draft : null;
  const week = editableDraft
    ? { start: editableDraft.weekStart, end: editableDraft.weekEnd }
    : requestedWeek ?? getLatestCompletedReportingWeek();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{editableDraft ? "Draft report" : "Kitchen submission"}</p>
          <h1 className="page-header__title">{editableDraft ? "Continue the week’s report." : "Build the week’s report."}</h1>
          <p className="page-header__copy">The app validates the reporting period and required figures. Daily waste dated inside the week is applied automatically, and enabled salary allocations are added privately to the final staff-cost snapshot.</p>
        </div>
        <div className="page-header__actions"><Link className="button button--secondary" href="/waste"><Trash2 aria-hidden="true" size={16} /> Daily waste log</Link><Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> All reports</Link></div>
      </header>
      {profile.isAccessPreview ? <div className="privacy-callout">Admin site mode for {profile.previewSiteName}. The kitchen selector and every saved draft are restricted to this site.</div> : null}
      <div className="privacy-callout waste-flow-note"><Trash2 aria-hidden="true" size={16} /><span>Waste entries remain open until this report is submitted. Only entries dated between {week.start} and {week.end} are captured; later or earlier entries stay in the waste log for the correct report.</span></div>
      {reportId && !editableDraft ? <div className="form-message form-message--error" role="alert">That draft is unavailable, already submitted, inactive, or outside your current kitchen access.</div> : null}
      {sites.length ? <><ReportForm initial={editableDraft ?? undefined} sites={sites} week={week} /><ReportSalesBridge sites={sites} /></> : (
        <section className="panel empty-state"><h2>No active kitchen is available.</h2><p>{profile.actualRole === "admin" ? "Return to the group view or create and activate a kitchen before starting its weekly report." : "Ask an administrator to assign you to an active kitchen."}</p>{profile.actualRole === "admin" ? <Link className="button button--primary" href="/settings/sites">Configure kitchens</Link> : null}</section>
      )}
    </>
  );
}

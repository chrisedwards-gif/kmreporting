import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportForm } from "@/components/reports/report-form";
import { ReportSalesBridge } from "@/components/reports/report-sales-bridge";
import { getAccessibleSites, getEditableDraft, getReportingWeek } from "@/lib/data/reporting";
import { requireRole } from "@/lib/auth/dal";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";

export const metadata = { title: "New weekly report" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ period?: string; report?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const { period: periodId, report: reportId } = await searchParams;
  const [allSites, draft, requestedWeek] = await Promise.all([
    getAccessibleSites(),
    reportId ? getEditableDraft(reportId) : Promise.resolve(null),
    periodId ? getReportingWeek(periodId) : Promise.resolve(null),
  ]);
  const sites = profile.previewSiteId ? allSites.filter((site) => site.id === profile.previewSiteId) : allSites;
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
          <p className="page-header__copy">The app validates the reporting period and required figures before the report enters management review.</p>
        </div>
        <Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> All reports</Link>
      </header>
      {profile.isAccessPreview ? <div className="privacy-callout">Admin site mode for {profile.previewSiteName}. Reports created here are scoped to this kitchen.</div> : null}
      {reportId && !editableDraft ? <div className="form-message form-message--error" role="alert">That draft is unavailable, already submitted, inactive, or outside your site access.</div> : null}
      {sites.length ? <><ReportForm initial={editableDraft ?? undefined} sites={sites} week={week} /><ReportSalesBridge sites={sites} /></> : (
        <section className="panel empty-state"><h2>No active kitchen is available.</h2><p>{profile.actualRole === "admin" ? "Create or activate a kitchen before starting its weekly report." : "Ask an administrator to assign you to an active kitchen."}</p>{profile.actualRole === "admin" ? <Link className="button button--primary" href="/settings/sites">Configure kitchens</Link> : null}</section>
      )}
    </>
  );
}

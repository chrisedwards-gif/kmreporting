import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { QuickReportReview } from "@/components/reports/quick-report-review";
import { ReportForm } from "@/components/reports/report-form";
import { WeeklyPackUploader } from "@/components/reports/weekly-pack-uploader";
import { requireRole } from "@/lib/auth/dal";
import { getReportingWeek } from "@/lib/data/reporting";
import { getScopedAccessibleSites, getScopedEditableDraft } from "@/lib/data/scoped-reporting";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";

export const metadata = { title: "Weekly report" };

export default async function NewReportPage({ searchParams }: { searchParams: Promise<{ period?: string; report?: string; mode?: string }> }) {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const { period: periodId, report: reportId, mode } = await searchParams;
  const isGroupRole = !profile.isAccessPreview && (profile.actualRole === "admin" || profile.actualRole === "group_manager");

  // Group roles normally use the independent HOS-wide master upload. Site mode remains available
  // for the exceptional case where management needs to complete a kitchen's report on its behalf.
  if (isGroupRole && !reportId && mode !== "site") redirect("/reports/group");

  const [sites, draft, requestedWeek] = await Promise.all([
    getScopedAccessibleSites(profile),
    reportId ? getScopedEditableDraft(profile, reportId) : Promise.resolve(null),
    periodId ? getReportingWeek(periodId) : Promise.resolve(null),
  ]);
  const editableDraft = draft && sites.some((site) => site.id === draft.siteId) ? draft : null;
  const week = editableDraft
    ? { start: editableDraft.weekStart, end: editableDraft.weekEnd }
    : requestedWeek ?? getLatestCompletedReportingWeek();
  const draftSite = editableDraft ? sites.find((site) => site.id === editableDraft.siteId) : null;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{isGroupRole ? "Management · kitchen upload override" : "Weekly kitchen reporting"}</p>
          <h1 className="page-header__title">{editableDraft ? "Review, explain, submit." : isGroupRole ? "Upload for one kitchen." : "Upload the week once."}</h1>
          <p className="page-header__copy">{editableDraft
            ? "The figures are already compiled. Add the operational context the data cannot know, then submit for management review."
            : isGroupRole
              ? "This is the KM-style site workflow. Use it only when you are completing a single kitchen's report on its behalf; your normal Group Chef upload is the HOS-wide Master Pack."
              : "Drop the weekly source pack together. The system identifies the reports, validates kitchen and dates, keeps the originals privately and builds the draft for you."}</p>
        </div>
        <div className="page-header__actions">
          {isGroupRole ? <Link className="button button--primary" href="/reports/group">Back to HOS-wide master upload</Link> : null}
          <Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> Weekly reports</Link>
        </div>
      </header>

      {profile.isAccessPreview ? <div className="privacy-callout">Admin site mode for {profile.previewSiteName}. Uploads and drafts are restricted to this kitchen.</div> : null}
      {isGroupRole && !editableDraft ? <div className="privacy-callout">You are deliberately in single-kitchen override mode. This creates/edits the same site report a KM would use; it is separate from your independent Group Chef master data.</div> : null}
      {reportId && !editableDraft ? <div className="form-message form-message--error" role="alert">That draft is unavailable, already submitted, inactive, or outside your current kitchen access.</div> : null}

      {sites.length ? (
        editableDraft ? (
          <>
            <QuickReportReview draft={editableDraft} siteName={draftSite?.name ?? "Kitchen"} />
            <details className="advanced-report-entry">
              <summary><SlidersHorizontal aria-hidden="true" size={16} /> Advanced / correct imported figures</summary>
              <p>Use this only when a source export is missing or genuinely wrong. The normal weekly workflow is the short review above.</p>
              <ReportForm initial={editableDraft} sites={sites} week={week} />
            </details>
          </>
        ) : (
          <>
            <WeeklyPackUploader sites={sites} weekStart={week.start} />
            <details className="advanced-report-entry">
              <summary><SlidersHorizontal aria-hidden="true" size={16} /> No exports available? Enter the week manually</summary>
              <p>Manual entry remains available as a fallback, but source uploads are preferred because they can be cross-checked and reprocessed later.</p>
              <ReportForm sites={sites} week={week} />
            </details>
          </>
        )
      ) : (
        <section className="panel empty-state"><h2>No active kitchen is available.</h2><p>{profile.actualRole === "admin" ? "Create and activate a kitchen before starting its weekly report." : "Ask an administrator to assign you to an active kitchen."}</p>{profile.actualRole === "admin" ? <Link className="button button--primary" href="/settings/sites">Configure kitchens</Link> : null}</section>
      )}
    </>
  );
}

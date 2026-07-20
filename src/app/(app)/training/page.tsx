import { TrainingTracker } from "@/components/trackers/training-tracker";
import { requireRole } from "@/lib/auth/dal";
import { getTrackerSites, getTrainingRecords } from "@/lib/data/trackers";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";

export const metadata = { title: "Team training" };

export default async function TrainingPage() {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const [allRecords, allSites] = await Promise.all([getTrainingRecords(), getTrackerSites()]);
  const records = profile.previewSiteId ? allRecords.filter((item) => item.siteId === profile.previewSiteId) : allRecords;
  const sites = profile.previewSiteId ? allSites.filter((item) => item.id === profile.previewSiteId) : allSites;
  const canEdit = !profile.isAccessPreview && ["admin", "group_manager", "kitchen_manager"].includes(profile.role);
  const week = getCurrentReportingWeek();

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Perform</p><h1 className="page-header__title">Team training.</h1><p className="page-header__copy">Record who was trained, what was covered, the result, sign-off and any follow-up still owed.</p></div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Read-only training register for {profile.previewSiteName}. A real assigned manager can record sessions, follow-ups and sign-off.</div> : null}
      <section className="panel"><div className="panel__body"><TrainingTracker canEdit={canEdit} records={records} sites={sites} weekEnd={week.end} weekStart={week.start} /></div></section>
    </>
  );
}

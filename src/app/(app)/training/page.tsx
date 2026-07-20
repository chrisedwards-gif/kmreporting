import { TrainingTracker } from "@/components/trackers/training-tracker";
import { requireRole } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import { getTrackerSites, getTrainingRecords } from "@/lib/data/trackers";
import { getCurrentReportingWeek } from "@/lib/reporting/periods";

export const metadata = { title: "Team training" };

export default async function TrainingPage() {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const [allRecords, allSites] = await Promise.all([getTrainingRecords(), getTrackerSites()]);
  const records = allRecords.filter((item) => scopeContainsSite(profile.siteScopeIds, item.siteId));
  const sites = allSites.filter((item) => scopeContainsSite(profile.siteScopeIds, item.id));
  const canEdit = profile.capabilities.maintainTrackers;
  const week = getCurrentReportingWeek();

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Perform</p><h1 className="page-header__title">Team training.</h1><p className="page-header__copy">Record who was trained, what was covered, the result, sign-off and any follow-up still owed.</p></div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Admin site mode for {profile.previewSiteName}. Only this kitchen’s sessions, follow-ups and sign-offs are loaded.</div> : null}
      <section className="panel"><div className="panel__body"><TrainingTracker canEdit={canEdit} records={records} sites={sites} weekEnd={week.end} weekStart={week.start} /></div></section>
    </>
  );
}

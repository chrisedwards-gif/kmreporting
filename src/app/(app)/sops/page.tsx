import { SopTracker } from "@/components/trackers/sop-tracker";
import { requireRole } from "@/lib/auth/dal";
import { getSops, getTrackerSites } from "@/lib/data/trackers";

export const metadata = { title: "SOPs & systems" };

export default async function SopsPage() {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const [allSops, allSites] = await Promise.all([getSops(), getTrackerSites()]);
  const sops = profile.previewSiteId ? allSops.filter((item) => item.siteId === profile.previewSiteId) : allSops;
  const sites = profile.previewSiteId ? allSites.filter((item) => item.id === profile.previewSiteId) : allSites;
  const canEdit = !profile.isAccessPreview && ["admin", "group_manager", "kitchen_manager"].includes(profile.role);

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Operate</p><h1 className="page-header__title">SOPs & systems.</h1><p className="page-header__copy">Every standard has a kitchen, owner, status, review date and immutable version history.</p></div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Read-only SOP register for {profile.previewSiteName}. A real assigned manager can create, revise and review these standards.</div> : null}
      <section className="panel"><div className="panel__body"><SopTracker canEdit={canEdit} sites={sites} sops={sops} /></div></section>
    </>
  );
}

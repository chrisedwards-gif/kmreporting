import { redirect } from "next/navigation";
import { SopTracker } from "@/components/trackers/sop-tracker";
import { requireRole } from "@/lib/auth/dal";
import { getSops, getTrackerSites } from "@/lib/data/trackers";

export const metadata = { title: "SOPs & systems" };

export default async function SopsPage() {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  if (profile.isAccessPreview) redirect("/dashboard");
  const [sops, sites] = await Promise.all([getSops(), getTrackerSites()]);
  const canEdit = ["admin", "group_manager", "kitchen_manager"].includes(profile.role);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Operate</p>
          <h1 className="page-header__title">SOPs & systems.</h1>
          <p className="page-header__copy">Every standard has a kitchen, owner, status, review date and immutable version history.</p>
        </div>
      </header>
      <section className="panel"><div className="panel__body"><SopTracker canEdit={canEdit} sites={sites} sops={sops} /></div></section>
    </>
  );
}

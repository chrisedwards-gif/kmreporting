import { CreateManagerForm, ManagerAdminCards } from "@/components/performance/manager-admin";
import { ReportingAccessAdmin } from "@/components/performance/reporting-access-admin";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getManagerAdminRecords } from "@/lib/data/performance";
import { getReportingViewerRecords } from "@/lib/data/reporting-access";

export const metadata = { title: "Manager admin" };

export default async function ManagerAdminPage() {
  await requireGroupWorkspaceRole(["admin"]);
  const [managers, viewers] = await Promise.all([getManagerAdminRecords(), getReportingViewerRecords()]);
  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Performance & access</p><h1 className="page-header__title">People & access.</h1><p className="page-header__copy">Create canonical Kitchen Manager identities for operational ownership, or reporting-only accounts for senior stakeholders such as Jake.</p></div></header>
      <ReportingAccessAdmin viewers={viewers} />
      <CreateManagerForm />
      <div className="section-heading"><div><h2>Kitchen Manager directory</h2><p>{managers.length} canonical manager account{managers.length === 1 ? "" : "s"}</p></div></div>
      <ManagerAdminCards managers={managers} />
    </>
  );
}

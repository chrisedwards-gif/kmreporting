import { CreateManagerForm, ManagerAdminCards } from "@/components/performance/manager-admin";
import { requireRole } from "@/lib/auth/dal";
import { getManagerAdminRecords } from "@/lib/data/performance";

export const metadata = { title: "Manager admin" };

export default async function ManagerAdminPage() {
  await requireRole(["admin"]);
  const managers = await getManagerAdminRecords();
  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Performance</p><h1 className="page-header__title">Manager admin.</h1><p className="page-header__copy">Create and maintain the single canonical login identity used by site access, 1-1s, actions, probation and email delivery.</p></div></header>
      <CreateManagerForm />
      <div className="section-heading"><div><h2>Manager directory</h2><p>{managers.length} canonical manager account{managers.length === 1 ? "" : "s"}</p></div></div>
      <ManagerAdminCards managers={managers} />
    </>
  );
}

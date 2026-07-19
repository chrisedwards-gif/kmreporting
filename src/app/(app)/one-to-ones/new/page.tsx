import { notFound } from "next/navigation";
import { OneToOneForm } from "@/components/one-to-ones/one-to-one-form";
import { requireRole } from "@/lib/auth/dal";
import { getManagers, getOpenActions, getWeekKpis } from "@/lib/data/one-to-ones";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "New 1-1 review" };

export default async function NewOneToOnePage({ searchParams }: { searchParams: Promise<{ manager?: string }> }) {
  await requireRole(["admin", "group_manager"]);
  const { manager: managerId } = await searchParams;
  const managers = await getManagers();
  const manager = managers.find((item) => item.id === managerId);
  if (!manager) notFound();
  const week = getLatestCompletedReportingWeek();
  const [kpis, openActions] = await Promise.all([
    getWeekKpis(manager.siteId, week.start),
    getOpenActions(manager.id),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">{manager.siteName} · Week commencing {formatDate(week.start)}</p>
          <h1 className="page-header__title">{manager.fullName}.</h1>
          <p className="page-header__copy">Weekly 1-1: the reported numbers, evidence-based scores and up to seven agreed actions.</p>
        </div>
      </header>
      <OneToOneForm
        detail={null}
        kpis={kpis}
        managerFirstName={manager.fullName.split(" ")[0]}
        managerId={manager.id}
        managerName={manager.fullName}
        openActions={openActions}
        weekCommencing={week.start}
      />
    </>
  );
}

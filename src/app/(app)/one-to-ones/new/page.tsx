import { notFound } from "next/navigation";
import { OneToOneForm } from "@/components/one-to-ones/one-to-one-form";
import { requireRole } from "@/lib/auth/dal";
import { getManagerAssignment, getOpenActions, getWeekKpis } from "@/lib/data/one-to-ones";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "New 1-1 review" };

export default async function NewOneToOnePage({ searchParams }: { searchParams: Promise<{ assignment?: string }> }) {
  await requireRole(["admin", "group_manager"]);
  const { assignment: assignmentId } = await searchParams;
  if (!assignmentId) notFound();
  const manager = await getManagerAssignment(assignmentId);
  if (!manager) notFound();
  const week = getLatestCompletedReportingWeek();
  const assignedForWeek = manager.assignmentStartsOn <= week.end && (!manager.assignmentEndsOn || manager.assignmentEndsOn >= week.start);
  if (!assignedForWeek) notFound();
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
          <p className="page-header__copy">This review is locked to the manager&apos;s canonical login UUID and the kitchen assignment active for this week.</p>
        </div>
      </header>
      <OneToOneForm
        assignmentId={manager.assignmentId}
        detail={null}
        initialActions={[]}
        kpis={kpis}
        managerFirstName={manager.fullName.split(" ")[0]}
        managerName={manager.fullName}
        openActions={openActions}
        weekCommencing={week.start}
      />
    </>
  );
}

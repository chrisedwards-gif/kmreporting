import { ProbationWorkspace } from "@/components/performance/probation-workspace";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getProbationSummaries } from "@/lib/data/performance";

export const metadata = { title: "Manager probation" };

export default async function ProbationPage() {
  await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const managers = await getProbationSummaries();

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Performance</p>
          <h1 className="page-header__title">Probation decisions.</h1>
          <p className="page-header__copy">Use weighted 1-1 evidence, record management judgement with a reason, attach private evidence and lock each final outcome as an auditable PDF record.</p>
        </div>
      </header>
      <ProbationWorkspace managers={managers} />
    </>
  );
}

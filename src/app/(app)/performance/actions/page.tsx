import { ListChecks } from "lucide-react";
import { ActionLogTable } from "@/components/performance/action-log-table";
import { requireRole } from "@/lib/auth/dal";
import { getPerformanceActions } from "@/lib/data/performance";

export const metadata = { title: "Manager action log" };

export default async function PerformanceActionsPage() {
  await requireRole(["admin", "group_manager", "finance", "viewer", "kitchen_manager"]);
  const actions = await getPerformanceActions();
  const openCount = actions.filter((item) => !["complete", "cancelled"].includes(item.status)).length;
  const overdueCount = actions.filter((item) => item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10) && !["complete", "cancelled"].includes(item.status)).length;

  return (
    <>
      <header className="page-header">
        <div><p className="page-header__eyebrow">Performance</p><h1 className="page-header__title">Master action log.</h1><p className="page-header__copy">One live record of every agreed action. Managers update progress here; items never disappear when a new 1-1 starts.</p></div>
      </header>
      <section className="metric-grid metric-grid--three" aria-label="Action summary">
        <article className="metric-card"><div className="metric-card__label">Open actions</div><div className="metric-card__value">{openCount}</div><div className="metric-card__note">Across visible managers</div></article>
        <article className={`metric-card${overdueCount ? " metric-card--over-target" : ""}`}><div className="metric-card__label">Overdue</div><div className="metric-card__value">{overdueCount}</div><div className="metric-card__note">Needs a decision or revised date</div></article>
        <article className="metric-card"><ListChecks aria-hidden="true" size={21} /><div className="metric-card__value metric-card__value--compact">Audit trail</div><div className="metric-card__note">Every status change is recorded</div></article>
      </section>
      <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Actions</h2><p className="panel__subtitle">Filter, update and export the current view</p></div></div><div className="panel__body"><ActionLogTable actions={actions} /></div></section>
    </>
  );
}

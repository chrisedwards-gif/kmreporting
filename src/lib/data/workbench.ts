import type { ReportingBundle } from "@/lib/data/reporting";
import { getKitchenCheckDashboard } from "@/lib/data/kitchen-checks";
import { getManagers, getOneToOnes } from "@/lib/data/one-to-ones";
import { getPerformanceActions } from "@/lib/data/performance";
import { isActionOverdue } from "@/lib/performance/scoring";
import type { AppRole } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export type WorkbenchItem = {
  key: string;
  tone: "attention" | "warn" | "ok";
  count: number | null;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

type WorkbenchResult = { items: WorkbenchItem[]; allClear: boolean; clearMessage: string };
type WorkbenchScope = { siteId?: string | null; managerId?: string | null };

const sundayFor = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const plural = (count: number, singular: string, pluralForm = `${singular}s`) => count === 1 ? singular : pluralForm;

export async function getWorkbench(role: AppRole, bundle: ReportingBundle, scope: WorkbenchScope = {}): Promise<WorkbenchResult> {
  const isGroup = role === "admin" || role === "group_manager";
  const isKitchenManager = role === "kitchen_manager";
  if (!isGroup && !isKitchenManager) return { items: [], allClear: true, clearMessage: "No operational actions are assigned to this access role." };

  const today = new Date().toISOString().slice(0, 10);
  const currentSunday = sundayFor(today);
  const items: WorkbenchItem[] = [];
  const [rawCheckboard, rawActions, managers, rawReviews] = await Promise.all([
    getKitchenCheckDashboard(),
    getPerformanceActions(),
    isGroup ? getManagers() : Promise.resolve([]),
    getOneToOnes(scope.managerId ?? undefined),
  ]);
  const checkboard = {
    templates: scope.siteId ? rawCheckboard.templates.filter((item) => item.siteId === scope.siteId) : rawCheckboard.templates,
    runs: scope.siteId ? rawCheckboard.runs.filter((item) => item.siteId === scope.siteId) : rawCheckboard.runs,
  };
  const actions = rawActions.filter((action) => (!scope.siteId || action.siteId === scope.siteId) && (!scope.managerId || action.managerId === scope.managerId));
  const reviews = rawReviews.filter((review) => (!scope.siteId || review.siteId === scope.siteId) && (!scope.managerId || review.managerId === scope.managerId));

  const reportBySite = new Map(bundle.reports.map((report) => [report.siteId, report]));
  const reportsDue = bundle.expectedSites.filter((site) => {
    const report = reportBySite.get(site.id);
    return !report || report.status === "draft" || report.status === "review_required";
  });
  const awaitingApproval = bundle.reports.filter((report) => report.status === "submitted");

  if (reportsDue.length) items.push({ key: "reports", tone: "attention", count: reportsDue.length, title: `${plural(reportsDue.length, "report")} not submitted`, detail: `${reportsDue.map((site) => site.name).join(", ")} · w/c ${formatDate(bundle.week.start)}`, href: isGroup ? "/reports" : "/reports/new", cta: isGroup ? "Open reports" : "Finish report" });
  if (isGroup && awaitingApproval.length) items.push({ key: "approvals", tone: "warn", count: awaitingApproval.length, title: `${plural(awaitingApproval.length, "report")} waiting for approval`, detail: awaitingApproval.map((report) => report.siteName).join(", "), href: "/approvals", cta: "Open approvals" });

  const existingRunKeys = new Set(checkboard.runs.map((run) => `${run.templateId}:${run.periodStart}`));
  const openRunKeys = new Set(checkboard.runs.filter((run) => run.status === "draft" || run.status === "reopened").map((run) => `${run.templateId}:${run.periodStart}`));
  for (const template of checkboard.templates) {
    const expectedStart = template.cadence === "daily" ? today : currentSunday;
    const key = `${template.id}:${expectedStart}`;
    if (!existingRunKeys.has(key)) openRunKeys.add(key);
  }
  if (openRunKeys.size) items.push({ key: "checks", tone: "warn", count: openRunKeys.size, title: `${plural(openRunKeys.size, "kitchen check")} due or open`, detail: "Current daily and weekly checks still need completion", href: "/checks", cta: "Open checks" });
  if (isGroup) {
    const submittedChecks = checkboard.runs.filter((run) => run.status === "submitted");
    if (submittedChecks.length) items.push({ key: "check-review", tone: "warn", count: submittedChecks.length, title: `${plural(submittedChecks.length, "check")} waiting for review`, detail: submittedChecks.map((run) => run.siteName).join(", "), href: "/checks", cta: "Review checks" });
  }

  const openActions = actions.filter((action) => !["complete", "cancelled"].includes(action.status));
  const overdueActions = openActions.filter((action) => isActionOverdue(action.dueDate, action.status, today));
  if (overdueActions.length) items.push({ key: "overdue-actions", tone: "attention", count: overdueActions.length, title: `${plural(overdueActions.length, "action")} overdue`, detail: isGroup ? "Across the manager action log" : "Your outstanding action log", href: "/performance/actions", cta: "Open action log" });
  else if (isKitchenManager && openActions.length) items.push({ key: "open-actions", tone: "ok", count: openActions.length, title: `${plural(openActions.length, "action")} in progress`, detail: "Nothing overdue — update progress as work is completed", href: "/performance/actions", cta: "Update actions" });

  if (isGroup) {
    const completedManagerIds = new Set(reviews.filter((review) => review.weekCommencing === bundle.week.start && ["finalised", "acknowledged"].includes(review.status)).map((review) => review.managerId));
    const uniqueManagers = [...new Map(managers.filter((manager) => manager.active).map((manager) => [manager.id, manager])).values()];
    const waiting = uniqueManagers.filter((manager) => !completedManagerIds.has(manager.id));
    if (waiting.length) items.push({ key: "one-to-ones", tone: "warn", count: waiting.length, title: `${plural(waiting.length, "1-1", "1-1s")} to complete this week`, detail: waiting.map((manager) => manager.fullName.split(" ")[0]).join(", "), href: "/one-to-ones", cta: "Open 1-1s" });
  } else {
    const pendingAcknowledgement = reviews.find((review) => review.status === "finalised");
    if (pendingAcknowledgement) items.push({ key: "acknowledge-one-to-one", tone: "warn", count: null, title: "1-1 ready to acknowledge", detail: `Week commencing ${formatDate(pendingAcknowledgement.weekCommencing)}`, href: `/one-to-ones/${pendingAcknowledgement.id}`, cta: "Read and acknowledge" });
  }

  const allClear = !items.some((item) => item.tone === "attention" || item.tone === "warn");
  return {
    items,
    allClear,
    clearMessage: isGroup ? "Reports are submitted, checks are clear, approvals are handled and this week’s 1-1s are complete." : "Your report and checks are complete, with no overdue actions or 1-1 acknowledgement waiting.",
  };
}

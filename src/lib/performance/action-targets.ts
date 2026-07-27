import type { SiteScopeIds } from "@/lib/auth/site-scope";

export type PerformanceActionTarget = {
  assignmentId: string | null;
  managerId: string;
  managerName: string;
  siteId: string;
  siteName: string;
};

export const filterPerformanceActionTargets = (
  targets: PerformanceActionTarget[],
  siteScopeIds: SiteScopeIds,
  scopeManagerId: string | null,
) => targets.filter((target) => (
  (siteScopeIds === null || siteScopeIds.includes(target.siteId))
  && (!scopeManagerId || target.managerId === scopeManagerId)
));

export const performanceActionTargetLabel = (target: PerformanceActionTarget) =>
  `${target.managerName} · ${target.siteName}`;

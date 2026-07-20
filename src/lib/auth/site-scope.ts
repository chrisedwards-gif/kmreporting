export type SiteScopeIds = readonly string[] | null;

/**
 * Group-wide rows use a null siteId and remain visible inside a kitchen
 * workspace. A row owned by another kitchen never does.
 */
export const siteIsInScope = (scope: SiteScopeIds, siteId: string | null | undefined): boolean =>
  scope === null || siteId == null || scope.includes(siteId);

export const filterToSiteScope = <T extends { siteId: string | null }>(scope: SiteScopeIds, rows: T[]): T[] =>
  scope === null ? rows : rows.filter((row) => siteIsInScope(scope, row.siteId));

export const scopeContainsSite = (scope: SiteScopeIds, siteId: string): boolean =>
  scope === null || scope.includes(siteId);

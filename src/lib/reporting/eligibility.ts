type SiteReference = { id: string };

/**
 * A site can retain historical reports after it is switched off, but it must
 * not remain in the current submission queue. The active directory is the
 * source of truth for weekly reporting expectations.
 */
export function filterActiveExpectedSites<T extends SiteReference>(
  expectedSites: readonly T[],
  activeSites: readonly SiteReference[],
): T[] {
  const activeSiteIds = new Set(activeSites.map((site) => site.id));
  return expectedSites.filter((site) => activeSiteIds.has(site.id));
}

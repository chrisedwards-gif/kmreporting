import "server-only";

import type { SessionProfile } from "@/lib/auth/dal";
import { scopeContainsSite } from "@/lib/auth/site-scope";
import {
  getAccessibleSites,
  getEditableDraft,
  getReportingBundle,
  type ReportingBundle,
} from "@/lib/data/reporting";

/**
 * Operational reporting data must cross this boundary before it reaches a
 * page. The active kitchen directory defines which sites are expected to
 * report. A manager/site scope then narrows the records further.
 */
export async function getScopedReportingBundle(
  profile: SessionProfile,
  periodId?: string,
  reportId?: string,
): Promise<ReportingBundle> {
  const [bundle, activeSites] = await Promise.all([
    getReportingBundle(periodId, reportId),
    getAccessibleSites(),
  ]);
  const activeSiteIds = new Set(activeSites.map((site) => site.id));
  const expectedSites = bundle.expectedSites.filter((site) => activeSiteIds.has(site.id));

  if (profile.siteScopeIds === null) {
    return {
      ...bundle,
      expectedSites,
      expectedSiteCount: expectedSites.length,
    };
  }

  const reports = bundle.reports.filter((report) => scopeContainsSite(profile.siteScopeIds, report.siteId));
  const sites = bundle.sites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
  const scopedExpectedSites = expectedSites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));

  return {
    ...bundle,
    reports,
    sites,
    expectedSites: scopedExpectedSites,
    expectedSiteCount: scopedExpectedSites.length,
  };
}

export async function getScopedAccessibleSites(profile: SessionProfile) {
  const sites = await getAccessibleSites();
  return profile.siteScopeIds === null
    ? sites
    : sites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
}

export async function getScopedEditableDraft(profile: SessionProfile, reportId: string) {
  const draft = await getEditableDraft(reportId);
  if (!draft || !scopeContainsSite(profile.siteScopeIds, draft.siteId)) return null;
  return draft;
}

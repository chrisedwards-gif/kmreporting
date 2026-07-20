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
 * page. Group roles receive the full bundle. Kitchen Manager accounts and an
 * Admin inspecting a kitchen receive only their permitted site rows.
 */
export async function getScopedReportingBundle(
  profile: SessionProfile,
  periodId?: string,
  reportId?: string,
): Promise<ReportingBundle> {
  const bundle = await getReportingBundle(periodId, reportId);
  if (profile.siteScopeIds === null) return bundle;

  const reports = bundle.reports.filter((report) => scopeContainsSite(profile.siteScopeIds, report.siteId));
  const sites = bundle.sites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));
  const expectedSites = bundle.expectedSites.filter((site) => scopeContainsSite(profile.siteScopeIds, site.id));

  return {
    ...bundle,
    reports,
    sites,
    expectedSites,
    expectedSiteCount: expectedSites.length,
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

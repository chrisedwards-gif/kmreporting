import { AppShell } from "@/components/app-shell";
import { getAdminPreviewSites, requireSessionProfile } from "@/lib/auth/dal";
import { environment } from "@/lib/env";

export default async function ApplicationLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireSessionProfile();
  const previewSites = profile.capabilities.admin ? await getAdminPreviewSites() : [];
  return (
    <AppShell
      isDemo={environment.isDemo}
      isPreview={environment.isPreview}
      previewSites={previewSites}
      user={{
        fullName: profile.fullName,
        role: profile.role,
        actualRole: profile.actualRole,
        navigationRole: profile.navigationRole,
        capabilities: profile.capabilities,
        isAccessPreview: profile.isAccessPreview,
        previewSiteId: profile.previewSiteId,
        previewSiteName: profile.previewSiteName,
        previewManagerName: profile.previewManagerName,
      }}
    >
      {children}
    </AppShell>
  );
}

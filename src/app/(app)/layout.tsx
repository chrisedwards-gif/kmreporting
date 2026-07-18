import { AppShell } from "@/components/app-shell";
import { requireSessionProfile } from "@/lib/auth/dal";
import { environment } from "@/lib/env";

export default async function ApplicationLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireSessionProfile();
  return <AppShell isDemo={environment.isDemo} isPreview={environment.isPreview} user={{ fullName: profile.fullName, role: profile.role }}>{children}</AppShell>;
}

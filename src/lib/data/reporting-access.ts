import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type ReportingViewerRecord = {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  createdAt: string;
};

export async function getReportingViewerRecords(): Promise<ReportingViewerRecord[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, notification_email, active, created_at")
    .eq("role", "viewer")
    .order("full_name");
  if (error) return [];
  return (data ?? []).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: profile.notification_email ?? "",
    active: profile.active,
    createdAt: profile.created_at,
  }));
}

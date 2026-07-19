import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";

export default async function ChecksLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  if (profile.isAccessPreview) redirect("/dashboard");
  return children;
}

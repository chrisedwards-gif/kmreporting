import { requireRole } from "@/lib/auth/dal";

export default async function ChecksLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["admin", "group_manager", "kitchen_manager"]);
  return children;
}

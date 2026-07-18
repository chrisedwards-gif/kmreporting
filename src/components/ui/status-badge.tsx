import { CircleCheck, CircleDashed, CircleDot, ShieldAlert } from "lucide-react";
import type { ReportStatus } from "@/lib/types";

const statusLabels: Record<ReportStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  review_required: "Review required",
  approved: "Approved",
  shared: "Shared",
};

const statusIcons = {
  draft: CircleDashed,
  submitted: CircleDot,
  review_required: ShieldAlert,
  approved: CircleCheck,
  shared: CircleCheck,
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  const Icon = statusIcons[status];
  return (
    <span className={`status-badge status-badge--${status}`}>
      <Icon aria-hidden="true" size={12} />
      {statusLabels[status]}
    </span>
  );
}

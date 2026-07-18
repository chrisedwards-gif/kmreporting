"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshDataButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button className="button button--secondary" disabled={pending} type="button" onClick={() => startTransition(() => router.refresh())}>
      <RefreshCw aria-hidden="true" className={pending ? "spin" : undefined} size={16} /> {pending ? "Refreshing…" : "Refresh displayed data"}
    </button>
  );
}

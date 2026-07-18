"use client";

import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { formatDate } from "@/lib/utils";

export function PeriodSelector({ periods, selected, basePath = "/reports" }: { periods: Array<{ id: string; week_start: string; week_end: string }>; selected?: string; basePath?: string }) {
  const router = useRouter();
  if (!periods.length) return null;
  return (
    <label className="period-selector">
      <CalendarRange aria-hidden="true" size={16} />
      <span className="sr-only">Reporting period</span>
      <select aria-label="Reporting period" value={selected ?? periods[0].id} onChange={(event) => router.push(`${basePath}?period=${event.target.value}`)}>
        {periods.map((period) => <option key={period.id} value={period.id}>Week ending {formatDate(period.week_end)}</option>)}
      </select>
    </label>
  );
}

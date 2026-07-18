"use client";

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type LiveState = "connecting" | "live" | "reconnecting" | "demo";

export function LiveReportingStatus({ isDemo }: { isDemo: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>(isDemo ? "demo" : "connecting");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isDemo) return;
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 450);
    };
    const channel = supabase
      .channel("kitchen-live-reporting")
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_reports" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "site_cost_snapshots" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_site_metrics" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setState("live");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setState("reconnecting");
      });

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [isDemo, router]);

  const label = state === "demo" ? "Demo snapshot" : state === "live" ? "Live reporting" : state === "reconnecting" ? "Reconnecting" : "Connecting";
  return (
    <div className={`live-status live-status--${state}`} title="Dashboard refreshes when kitchen or imported source data changes">
      <span className="live-status__dot" />
      <Radio aria-hidden="true" size={13} />
      {label}
    </div>
  );
}

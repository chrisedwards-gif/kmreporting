"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload } from "lucide-react";
import {
  syncRotaCloudPlanningTeam,
  type RotaTeamSyncState,
} from "@/app/actions/rota-team-sync";

const initialState: RotaTeamSyncState = { status: "idle", message: "" };

export function RotaCloudPlanningSync({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(syncRotaCloudPlanningTeam, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="rota-sync">
      <div>
        <strong>{configured ? "RotaCloud read-only sync is configured" : "RotaCloud is not connected"}</strong>
        <span>
          {configured
            ? "Imports people, hourly wages, roles, locations and contracted hours. Salaries remain controlled in Labour settings."
            : "Add ROTACLOUD_API_KEY in the server environment. Manual profiles work without it."}
        </span>
      </div>
      <button className="button button--secondary" disabled={pending || !configured} type="submit">
        <CloudDownload aria-hidden="true" size={16} />
        {pending ? "Reading RotaCloud…" : "Sync team from RotaCloud"}
      </button>
      {state.status !== "idle" ? (
        <p
          className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast-provider";

type ActionState = { status: string; message: string };

export function ActionToast({
  state,
  successTitle = "Saved",
  errorTitle = "Action failed",
}: {
  state: ActionState;
  successTitle?: string;
  errorTitle?: string;
}) {
  const { pushToast } = useToast();
  const lastMessage = useRef("");

  useEffect(() => {
    if (!state.message || state.status === "idle") return;
    const key = `${state.status}:${state.message}`;
    if (lastMessage.current === key) return;
    lastMessage.current = key;
    pushToast({
      title: state.status === "error" ? errorTitle : successTitle,
      description: state.message,
      variant: state.status === "error" ? "error" : "success",
      persistent: state.status === "error",
    });
  }, [errorTitle, pushToast, state.message, state.status, successTitle]);

  return null;
}

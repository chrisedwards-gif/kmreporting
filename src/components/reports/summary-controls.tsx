"use client";

import { LockKeyhole, Printer } from "lucide-react";

export function SummaryControls({ ready }: { ready: boolean }) {
  if (!ready) {
    return <button className="button button--secondary" disabled type="button"><LockKeyhole aria-hidden="true" size={16} /> Waiting for approvals</button>;
  }
  return <button className="button button--primary" onClick={() => window.print()} type="button"><Printer aria-hidden="true" size={16} /> Print approved summary</button>;
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle } from "lucide-react";
import { saveWasteEntry, type WasteActionState } from "@/app/actions/waste";

const initialState: WasteActionState = { status: "idle", message: "" };

export function WasteEntryForm({ sites, today }: { sites: Array<{ id: string; name: string; code: string }>; today: string }) {
  const [state, action, pending] = useActionState(saveWasteEntry, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "success") return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.status]);

  return (
    <form action={action} className="report-form" ref={formRef}>
      <div className="form-grid form-grid--three">
        <label className="field"><span className="field__label">Kitchen</span><select className="field__input" name="siteId" required>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.code}</option>)}</select></label>
        <label className="field"><span className="field__label">Waste date</span><input className="field__input" defaultValue={today} max={today} name="businessDate" required type="date" /></label>
        <label className="field"><span className="field__label">Estimated cost</span><input className="field__input" inputMode="decimal" min="0.01" name="estimatedCost" placeholder="0.00" required step="0.01" type="number" /></label>
        <label className="field"><span className="field__label">Item</span><input className="field__input" maxLength={160} name="itemName" placeholder="e.g. Chicken thigh" required /></label>
        <label className="field"><span className="field__label">Category</span><select className="field__input" defaultValue="Food" name="category"><option>Food</option><option>Packaging</option><option>Beverage</option><option>Other</option></select></label>
        <label className="field"><span className="field__label">Reason</span><select className="field__input" defaultValue="Overproduction" name="reason"><option>Overproduction</option><option>Expired / out of date</option><option>Preparation waste</option><option>Quality issue</option><option>Customer return</option><option>Spillage / damage</option><option>Supplier issue</option><option>Other</option></select></label>
        <label className="field"><span className="field__label">Quantity</span><input className="field__input" inputMode="decimal" min="0.001" name="quantity" placeholder="Optional" step="0.001" type="number" /></label>
        <label className="field"><span className="field__label">Unit</span><input className="field__input" maxLength={30} name="unit" placeholder="kg, portions, each…" /></label>
        <label className="field field--wide"><span className="field__label">Notes</span><input className="field__input" maxLength={1000} name="notes" placeholder="What happened and how it will be prevented" /></label>
      </div>
      {state.status !== "idle" ? <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      <button className="button button--primary" disabled={pending || !sites.length} type="submit"><PlusCircle aria-hidden="true" size={16} />{pending ? "Logging…" : "Log waste"}</button>
    </form>
  );
}

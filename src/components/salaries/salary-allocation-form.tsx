"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BadgePoundSterling, Trash2 } from "lucide-react";
import { deleteSalaryAllocation, saveSalaryAllocation, setSiteSalaryInclusion, type SalaryActionState } from "@/app/actions/salaries";

const initialState: SalaryActionState = { status: "idle", message: "" };

export function SalaryAllocationForm({
  sites,
  profiles,
  defaultDate,
}: {
  sites: Array<{ id: string; name: string; code: string }>;
  profiles: Array<{ id: string; fullName: string; email: string }>;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(saveSalaryAllocation, initialState);
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
        <label className="field"><span className="field__label">Link to login (optional)</span><select className="field__input" defaultValue="" name="profileId"><option value="">No login required</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName}{profile.email ? ` · ${profile.email}` : ""}</option>)}</select></label>
        <label className="field"><span className="field__label">Staff member</span><input className="field__input" maxLength={120} name="staffName" placeholder="e.g. Warren Raisbeck" required /></label>
        <label className="field"><span className="field__label">Role title</span><input className="field__input" maxLength={120} name="roleTitle" placeholder="Kitchen Manager" /></label>
        <label className="field"><span className="field__label">Annual salary</span><input className="field__input" inputMode="decimal" min="0.01" name="annualSalary" placeholder="35000" required step="0.01" type="number" /></label>
        <label className="field"><span className="field__label">Employer on-cost (%)</span><input className="field__input" defaultValue="18" inputMode="decimal" min="0" max="100" name="oncostRate" required step="0.01" type="number" /><span className="field__hint">NI, pension and other employer cost combined.</span></label>
        <label className="field"><span className="field__label">Allocated to this site (%)</span><input className="field__input" defaultValue="100" inputMode="decimal" min="0.01" max="100" name="allocationPct" required step="0.01" type="number" /><span className="field__hint">Use less than 100% for a salary split across sites.</span></label>
        <label className="field"><span className="field__label">Effective from</span><input className="field__input" defaultValue={defaultDate} name="validFrom" required type="date" /></label>
        <label className="field"><span className="field__label">Effective until</span><input className="field__input" name="validTo" type="date" /><span className="field__hint">Leave blank while ongoing.</span></label>
      </div>
      <input name="active" type="hidden" value="true" />
      {state.status !== "idle" ? <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      <button className="button button--primary" disabled={pending || !sites.length} type="submit"><BadgePoundSterling aria-hidden="true" size={16} />{pending ? "Saving…" : "Add salary allocation"}</button>
    </form>
  );
}

export function SalarySiteToggle({ site }: { site: { id: string; name: string; includeSalaryCosts: boolean } }) {
  const [state, action, pending] = useActionState(setSiteSalaryInclusion, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  return (
    <form action={action} className="salary-toggle">
      <input name="siteId" type="hidden" value={site.id} />
      <input name="includeSalaryCosts" type="hidden" value={String(!site.includeSalaryCosts)} />
      <div><strong>{site.name}</strong><span>{site.includeSalaryCosts ? "Salary accruals are included in weekly staff cost." : "Weekly staff cost currently uses hourly/rota labour only."}</span></div>
      <button className={`button ${site.includeSalaryCosts ? "button--secondary" : "button--primary"} button--compact`} disabled={pending} type="submit">{pending ? "Saving…" : site.includeSalaryCosts ? "Exclude salaries" : "Include salaries"}</button>
      {state.status !== "idle" ? <span className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`}>{state.message}</span> : null}
    </form>
  );
}

export function DeleteSalaryAllocationButton({ allocationId, staffName }: { allocationId: string; staffName: string }) {
  return <form action={deleteSalaryAllocation}><input name="allocationId" type="hidden" value={allocationId} /><button aria-label={`Delete salary allocation for ${staffName}`} className="icon-button" title="Delete salary allocation" type="submit"><Trash2 aria-hidden="true" size={16} /></button></form>;
}

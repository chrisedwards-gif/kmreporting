"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Link2, LockKeyhole, Plus, Save, ShieldCheck } from "lucide-react";
import { saveRotaStaffProfileV2, type RotaTeamActionState } from "@/app/actions/rota-team";
import { syncRotaCloudTeam, type RotaActionState } from "@/app/actions/rotas";
import type { RotaAppProfileOption, RotaSite, RotaStaffWorkspaceRow } from "@/lib/data/rotas";

const initialState: RotaTeamActionState = { status: "idle", message: "" };
const syncInitialState: RotaActionState = { status: "idle", message: "" };
const weekdays = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]] as const;

const suggestedRank = (role: string) => {
  const value = role.toLowerCase();
  if (value.includes("group") || value.includes("head chef") || value.includes("executive")) return 100;
  if (value.includes("kitchen manager") || value.includes("general manager")) return 200;
  if (value.includes("pizz")) return 300;
  if (value.includes("senior") || value.includes("supervisor")) return 350;
  return 400;
};

export function RotaCloudSync({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(syncRotaCloudTeam, syncInitialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return <form action={action} className="rota-sync"><div><strong>{configured ? "RotaCloud read-only sync is configured" : "RotaCloud is not connected"}</strong><span>{configured ? "Imports people, wages, roles, locations and contracted hours. It never creates or publishes shifts." : "Add ROTACLOUD_API_KEY in the server environment. Manual profiles work without it."}</span></div><button className="button button--secondary" disabled={pending || !configured} type="submit"><CloudDownload aria-hidden="true" size={16} />{pending ? "Reading RotaCloud…" : "Sync team from RotaCloud"}</button>{state.status !== "idle" ? <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}</form>;
}

export function StaffProfileEditor({
  sites,
  appProfiles,
  staff,
  defaultDate,
}: {
  sites: RotaSite[];
  appProfiles: RotaAppProfileOption[];
  staff?: RotaStaffWorkspaceRow;
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState(saveRotaStaffProfileV2, initialState);
  const [payBasis, setPayBasis] = useState(staff?.payBasis ?? "hourly");
  const [appProfileId, setAppProfileId] = useState(staff?.appProfileId ?? "");
  const [staffName, setStaffName] = useState(staff?.staffName ?? "");
  const [employeeRef, setEmployeeRef] = useState(staff?.employeeRef ?? "");
  const [roleTitle, setRoleTitle] = useState(staff?.roleTitle ?? "");
  const [roleRank, setRoleRank] = useState(staff?.roleRank ?? 400);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);

  const linkedAccount = useMemo(
    () => appProfiles.find((profile) => profile.id === appProfileId),
    [appProfileId, appProfiles],
  );

  const chooseAccount = (value: string) => {
    setAppProfileId(value);
    const selected = appProfiles.find((profile) => profile.id === value);
    if (!staff && selected) {
      setStaffName(selected.name);
      setEmployeeRef(`APP-${selected.id.slice(0, 8).toUpperCase()}`);
      const role = selected.role === "kitchen_manager" ? "Kitchen Manager" : selected.role === "group_manager" ? "Group Manager" : "Group Chef";
      setRoleTitle(role);
      setRoleRank(suggestedRank(role));
    }
  };

  return (
    <details className={`staff-profile panel ${staff ? "" : "staff-profile--new"}`} open={!staff}>
      <summary><div className="staff-profile__identity">{staff ? <><strong>{staff.staffName}</strong><span>{staff.roleTitle} · {sites.find((site) => site.id === staff.siteId)?.name ?? "Kitchen"}</span></> : <><strong><Plus aria-hidden="true" size={15} /> Add staff member</strong><span>Link their app account and private employment profile once</span></>}</div>{staff ? <div className="staff-profile__summary"><span>{staff.appProfileId ? <><Link2 size={13} /> Account linked</> : "No account link"}</span><span>{staff.targetWeeklyHours}h target</span><span>{staff.payBasis === "hourly" ? `£${staff.hourlyRate?.toFixed(2)}/h` : `£${staff.annualSalary?.toLocaleString("en-GB")}/yr`}</span></div> : null}</summary>
      <form action={action} className="report-form staff-profile__form">
        <input name="id" type="hidden" value={staff?.id ?? ""} />
        <div className="form-divider"><span><Link2 aria-hidden="true" size={14} /> One person, one UUID</span></div>
        <div className="form-grid form-grid--three">
          <label className="field field--wide"><span className="field__label">Linked app account</span><select className="field__input" name="appProfileId" value={appProfileId} onChange={(event) => chooseAccount(event.target.value)}><option value="">Not linked yet</option>{appProfiles.map((profile) => { const usedElsewhere = Boolean(profile.linkedStaffId && profile.linkedStaffId !== staff?.id); return <option disabled={usedElsewhere} key={profile.id} value={profile.id}>{profile.name} · {profile.role}{usedElsewhere ? " · already linked" : ""}</option>; })}</select><span className="field__hint">This connects the rota row to the same user used for login, permissions, 1‑1s and actions.</span></label>
          <label className="field"><span className="field__label">Kitchen allocation</span><select className="field__input" defaultValue={staff?.siteId ?? sites[0]?.id} name="siteId" required>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label className="field"><span className="field__label">Staff member</span><input className="field__input" maxLength={120} name="staffName" onChange={(event) => setStaffName(event.target.value)} required value={staffName} /></label>
          <label className="field"><span className="field__label">Payroll / employee reference</span><input className="field__input" maxLength={120} name="employeeRef" onChange={(event) => setEmployeeRef(event.target.value)} required value={employeeRef} /></label>
          <label className="field"><span className="field__label">Role</span><input className="field__input" maxLength={120} name="roleTitle" onChange={(event) => { setRoleTitle(event.target.value); if (!staff) setRoleRank(suggestedRank(event.target.value)); }} placeholder="Pizzaiolo" required value={roleTitle} /></label>
          <label className="field"><span className="field__label">Role priority</span><input className="field__input" max="9999" min="0" name="roleRank" onChange={(event) => setRoleRank(Number(event.target.value) || 0)} step="10" type="number" value={roleRank} /><span className="field__hint">Lower numbers appear higher in the rota.</span></label>
          <label className="field"><span className="field__label">Person order</span><input className="field__input" defaultValue={staff?.displayOrder ?? 1000} max="999999" min="0" name="displayOrder" step="10" type="number" /></label>
          <label className="field field--wide"><span className="field__label">Skills</span><input className="field__input" defaultValue={staff?.skills.join(", ") ?? ""} maxLength={500} name="skills" placeholder="pizza, closing, food safety" /><span className="field__hint">Comma-separated. Required skills are treated as hard constraints.</span></label>
          <label className="field"><span className="field__label">RotaCloud user ID</span><input className="field__input" defaultValue={staff?.rotacloudUserId ?? ""} inputMode="numeric" name="rotacloudUserId" /></label>
        </div>
        <div className="form-grid form-grid--two staff-profile__scope">
          <label className="check-card"><input defaultChecked={staff?.organisationWide ?? false} name="organisationWide" type="checkbox" value="true" /><span><strong>Show in every kitchen rota</strong><small>For group staff such as Group Chef or development managers. Other kitchens receive a zero salary allocation unless separately configured.</small></span></label>
          <label className="check-card"><input defaultChecked={staff?.primarySite ?? true} name="primarySite" type="checkbox" value="true" /><span><strong>Primary kitchen allocation</strong><small>Marks this as the person’s main payroll and role allocation.</small></span></label>
        </div>
        {linkedAccount ? <p className="form-message form-message--success"><ShieldCheck size={15} /> Linked to {linkedAccount.name}’s active app UUID.</p> : null}
        <div className="form-divider"><span>Weekly and shift limits</span></div>
        <div className="form-grid form-grid--three">
          <label className="field"><span className="field__label">Minimum weekly hours</span><input className="field__input" defaultValue={staff?.minimumWeeklyHours ?? 0} max="100" min="0" name="minimumWeeklyHours" required step="0.25" type="number" /></label>
          <label className="field"><span className="field__label">Target weekly hours</span><input className="field__input" defaultValue={staff?.targetWeeklyHours ?? 40} max="100" min="0" name="targetWeeklyHours" required step="0.25" type="number" /></label>
          <label className="field"><span className="field__label">Maximum weekly hours</span><input className="field__input" defaultValue={staff?.maximumWeeklyHours ?? 48} max="100" min="0" name="maximumWeeklyHours" required step="0.25" type="number" /></label>
          <label className="field"><span className="field__label">Minimum shift</span><div className="input-suffix"><input className="field__input" defaultValue={(staff?.minimumShiftMinutes ?? 240) / 60} max="12" min="1" name="minimumShiftHours" required step="0.5" type="number" /><span>h</span></div></label>
          <label className="field"><span className="field__label">Maximum shift</span><div className="input-suffix"><input className="field__input" defaultValue={(staff?.maximumShiftMinutes ?? 720) / 60} max="16" min="2" name="maximumShiftHours" required step="0.5" type="number" /><span>h</span></div></label>
          <label className="field"><span className="field__label">Maximum consecutive days</span><input className="field__input" defaultValue={staff?.maximumConsecutiveDays ?? 6} max="7" min="1" name="maximumConsecutiveDays" required type="number" /></label>
        </div>
        <fieldset className="staff-profile__days"><legend>Preferred working days</legend>{weekdays.map(([value, label]) => <label key={value}><input defaultChecked={staff ? staff.preferredDays.includes(value) : value >= 1 && value <= 5} name="preferredDays" type="checkbox" value={value} /> {label}</label>)}</fieldset>
        <div className="form-grid form-grid--three">
          <label className="field"><span className="field__label">Preferred earliest start</span><input className="field__input" defaultValue={staff?.preferredStart ?? ""} name="preferredStart" type="time" /></label>
          <label className="field"><span className="field__label">Preferred latest finish</span><input className="field__input" defaultValue={staff?.preferredEnd ?? ""} name="preferredEnd" type="time" /></label>
          <label className="field"><span className="field__label">Effective from</span><input className="field__input" defaultValue={staff?.validFrom ?? defaultDate} name="validFrom" required type="date" /></label>
        </div>
        <div className="form-divider"><span><LockKeyhole aria-hidden="true" size={14} /> Private employment cost</span></div>
        <div className="form-grid form-grid--three">
          <label className="field"><span className="field__label">Pay basis</span><select className="field__input" name="payBasis" value={payBasis} onChange={(event) => setPayBasis(event.target.value as "hourly" | "salaried")}><option value="hourly">Hourly</option><option value="salaried">Salaried</option></select></label>
          {payBasis === "hourly" ? <label className="field"><span className="field__label">Hourly wage</span><div className="input-prefix"><span>£</span><input className="field__input" defaultValue={staff?.hourlyRate ?? ""} min="0.01" name="hourlyRate" required step="0.01" type="number" /></div></label> : <><label className="field"><span className="field__label">Annual salary</span><div className="input-prefix"><span>£</span><input className="field__input" defaultValue={staff?.annualSalary ?? ""} min="0.01" name="annualSalary" required step="0.01" type="number" /></div></label><label className="field"><span className="field__label">Contracted weekly hours</span><input className="field__input" defaultValue={staff?.contractedWeeklyHours ?? 40} min="0.25" name="contractedWeeklyHours" required step="0.25" type="number" /></label></>}
          <label className="field"><span className="field__label">Employer NI</span><div className="input-suffix"><input className="field__input" defaultValue={(staff?.employerNiRate ?? 0) * 100} max="100" min="0" name="employerNiRate" required step="0.01" type="number" /><span>%</span></div></label>
          <label className="field"><span className="field__label">Employer pension</span><div className="input-suffix"><input className="field__input" defaultValue={(staff?.pensionRate ?? 0) * 100} max="100" min="0" name="pensionRate" required step="0.01" type="number" /><span>%</span></div></label>
          <label className="field"><span className="field__label">Other on-cost</span><div className="input-suffix"><input className="field__input" defaultValue={(staff?.otherOncostRate ?? 0) * 100} max="100" min="0" name="otherOncostRate" required step="0.01" type="number" /><span>%</span></div></label>
          <label className="field"><span className="field__label">Cost allocated to site</span><div className="input-suffix"><input className="field__input" defaultValue={staff?.costAllocationPct ?? 100} max="100" min="0" name="costAllocationPct" required step="0.01" type="number" /><span>%</span></div></label>
        </div>
        <label className="field"><span className="field__label">Planning note</span><textarea className="field__input" defaultValue={staff?.notes ?? ""} maxLength={1000} name="notes" rows={2} placeholder="Preferences or context the manager should review—never medical or sensitive personal data." /></label>
        {state.status !== "idle" ? <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
        <button className="button button--primary" disabled={pending} type="submit"><Save aria-hidden="true" size={16} />{pending ? "Saving privately…" : staff ? "Save profile" : "Add linked staff profile"}</button>
      </form>
    </details>
  );
}

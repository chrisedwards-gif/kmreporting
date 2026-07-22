"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, ShieldCheck } from "lucide-react";
import { saveRotaSiteConfiguration, type RotaActionState } from "@/app/actions/rotas";
import type { RotaSite } from "@/lib/data/rotas";
import type { DemandPoint, RotaDayRule } from "@/lib/rota/types";

const initialState: RotaActionState = { status: "idle", message: "" };
const days = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"], [0, "Sunday"]] as const;

export function RotaSiteSettingsForm({
  site,
  rules,
  demand,
  settings,
}: {
  site: RotaSite;
  rules: RotaDayRule[];
  demand: DemandPoint[];
  settings: { forecastWeeks: number; minimumHistoryWeeks: number; intervalMinutes: number; minimumRestHours: number; salesPerLabourHourTarget: number };
}) {
  const [state, action, pending] = useActionState(saveRotaSiteConfiguration, initialState);
  const router = useRouter();
  const demandSlots = [...new Set(demand.map((point) => point.slotTime))].sort();
  const demandMode = demand.some((point) => point.source === "manual") ? "manual" : "automatic";
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);
  return (
    <form action={action} className="report-form rota-settings">
      <input name="siteId" type="hidden" value={site.id} />
      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Forecast calibration</h2><p className="panel__subtitle">Start conservative, then change a target only when the backtest or operating model supports it.</p></div><ShieldCheck aria-hidden="true" color="#2d7a62" size={20} /></div>
        <div className="form-grid form-grid--three">
          <label className="field"><span className="field__label">Sales per labour hour target</span><div className="input-prefix"><span>£</span><input className="field__input" defaultValue={settings.salesPerLabourHourTarget} max="500" min="20" name="salesPerLabourHourTarget" required step="1" type="number" /></div><span className="field__hint">Controls how many staffed hours sales demand justifies; the labour % remains a separate cost ceiling.</span></label>
          <label className="field"><span className="field__label">Matching weekdays used</span><input className="field__input" defaultValue={settings.forecastWeeks} max="26" min="4" name="forecastWeeks" required type="number" /><span className="field__hint">Recent same-weekdays are weighted most heavily.</span></label>
          <label className="field"><span className="field__label">Minimum history before trusted</span><input className="field__input" defaultValue={settings.minimumHistoryWeeks} max="12" min="2" name="minimumHistoryWeeks" required type="number" /></label>
          <label className="field"><span className="field__label">Planning interval</span><select className="field__input" defaultValue={settings.intervalMinutes} name="intervalMinutes"><option value="60">60 minutes</option><option value="30">30 minutes</option><option value="15">15 minutes</option></select></label>
          <label className="field"><span className="field__label">Minimum rest between shifts</span><div className="input-suffix"><input className="field__input" defaultValue={settings.minimumRestHours} max="24" min="8" name="minimumRestHours" required step="0.5" type="number" /><span>h</span></div></label>
          <div className="rota-settings__target"><span>Current labour ceiling</span><strong>{site.labourTarget.toFixed(1)}%</strong><small>Managed with the kitchen’s commercial targets</small></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Trading hours and safe cover</h2><p className="panel__subtitle">The optimiser may exceed the budget before it breaks these minimums or a required skill.</p></div></div>
        <div className="table-scroll">
          <table className="data-table rota-settings__days">
            <thead><tr><th>Day</th><th>Trading</th><th>Open</th><th>Close</th><th>Prep</th><th>Close-down</th><th>Min cover</th><th>Max cover</th><th>Required skills</th></tr></thead>
            <tbody>{days.map(([weekday, label]) => {
              const rule = rules.find((item) => item.weekday === weekday) ?? { weekday, openTime: "10:00", closeTime: "22:00", prepMinutes: 0, closeMinutes: 0, minimumStaff: 2, maximumStaff: 5, requiredSkills: [], trading: true };
              return <tr key={weekday}><td><strong>{label}</strong></td><td><label className="rota-settings__check"><input defaultChecked={rule.trading} name={`trading_${weekday}`} type="checkbox" value="true" /><span>Open</span></label></td><td><input aria-label={`${label} opening time`} className="field__input" defaultValue={rule.openTime} name={`openTime_${weekday}`} required type="time" /></td><td><input aria-label={`${label} closing time`} className="field__input" defaultValue={rule.closeTime} name={`closeTime_${weekday}`} required type="time" /></td><td><div className="input-suffix"><input aria-label={`${label} preparation minutes`} className="field__input" defaultValue={rule.prepMinutes} max="360" min="0" name={`prepMinutes_${weekday}`} required type="number" /><span>m</span></div></td><td><div className="input-suffix"><input aria-label={`${label} close-down minutes`} className="field__input" defaultValue={rule.closeMinutes} max="360" min="0" name={`closeMinutes_${weekday}`} required type="number" /><span>m</span></div></td><td><input aria-label={`${label} minimum cover`} className="field__input" defaultValue={rule.minimumStaff} max="20" min="1" name={`minimumStaff_${weekday}`} required type="number" /></td><td><input aria-label={`${label} maximum cover`} className="field__input" defaultValue={rule.maximumStaff} max="30" min="1" name={`maximumStaff_${weekday}`} required type="number" /></td><td><input aria-label={`${label} required skills`} className="field__input" defaultValue={rule.requiredSkills.join(", ")} maxLength={300} name={`requiredSkills_${weekday}`} placeholder="kitchen manager" /></td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header"><div><h2 className="panel__title">Day-part demand curve</h2><p className="panel__subtitle">These percentages shape when extra cover is placed. Automatic mode replaces this fallback with actual hourly EPOS patterns once enough matching weekdays exist.</p></div></div>
        <input name="demandSlots" type="hidden" value={demandSlots.join(",")} />
        <div className="form-grid form-grid--two">
          <label className="field"><span className="field__label">Curve mode</span><select className="field__input" defaultValue={demandMode} name="demandMode"><option value="automatic">Automatic · prefer actual hourly sales</option><option value="manual">Manual · always use the percentages below</option></select><span className="field__hint">Use manual only when you know the normal trading shape but hourly data is missing or misleading.</span></label>
          <div className="rota-settings__target"><span>Current source</span><strong>{demand.some((point) => point.source === "hourly_sales") ? "Hourly EPOS" : demandMode === "manual" ? "Manual" : "Fallback template"}</strong><small>Each day is normalised to 100% when saved</small></div>
        </div>
        <div className="table-scroll">
          <table className="data-table rota-settings__demand">
            <thead><tr><th>Time</th>{days.map(([, label]) => <th key={label}>{label.slice(0, 3)}</th>)}</tr></thead>
            <tbody>{demandSlots.map((slotTime) => <tr key={slotTime}><td><strong>{slotTime}</strong></td>{days.map(([weekday, label]) => {
              const point = demand.find((item) => item.weekday === weekday && item.slotTime === slotTime);
              return <td key={weekday}><div className="input-suffix"><input aria-label={`${label} demand at ${slotTime}`} className="field__input" defaultValue={((point?.demandWeight ?? 0) * 100).toFixed(1)} max="100" min="0" name={`demand_${weekday}_${slotTime.replace(":", "")}`} required step="0.1" type="number" /><span>%</span></div></td>;
            })}</tr>)}</tbody>
          </table>
        </div>
      </section>
      {state.status !== "idle" ? <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      <button className="button button--primary" disabled={pending} type="submit"><Save aria-hidden="true" size={16} />{pending ? "Saving all rules…" : "Save rota calibration"}</button>
    </form>
  );
}

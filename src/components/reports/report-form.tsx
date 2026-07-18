"use client";

import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, LockKeyhole, Save, Send } from "lucide-react";
import { saveWeeklyReport, type ReportActionState } from "@/app/actions/reports";
import { calculateCosts } from "@/lib/reporting/calculations";
import { formatCurrency, formatPercentage } from "@/lib/utils";

const initialState: ReportActionState = { status: "idle", message: "" };

export function ReportForm({ sites }: { sites: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(saveWeeklyReport, initialState);
  const [values, setValues] = useState({
    netSales: 0,
    openingStock: 0,
    purchases: 0,
    credits: 0,
    transfersIn: 0,
    transfersOut: 0,
    closingStock: 0,
    adjustments: 0,
    wasteCost: 0,
  });

  const preview = useMemo(
    () => calculateCosts({ ...values, paidHours: 0, averageLoadedRate: 0, agencyCost: 0, overtimePremium: 0 }),
    [values],
  );

  const updateNumber = (name: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [name]: Number(value) || 0 }));
  };

  return (
    <form action={formAction} className="report-form">
      <section className="form-section">
        <h2 className="form-section__title">Kitchen & reporting week</h2>
        <p className="form-section__copy">Every submission must cover one complete Monday-to-Sunday period.</p>
        <div className="form-grid form-grid--three">
          <label className="field">
            <span className="field__label">Kitchen</span>
            <select className="field__input" defaultValue={sites[0]?.id} name="siteId" required>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Week starting</span>
            <input className="field__input" defaultValue="2026-07-13" name="weekStart" required type="date" />
          </label>
          <label className="field">
            <span className="field__label">Week ending</span>
            <input className="field__input" defaultValue="2026-07-19" name="weekEnd" required type="date" />
          </label>
        </div>
      </section>

      <section className="form-section">
        <h2 className="form-section__title">Sales, purchases & stock</h2>
        <p className="form-section__copy">Enter source totals from the EPOS, invoices and the signed stocktake.</p>
        <div className="form-grid form-grid--three">
          {[
            ["netSales", "Net sales", "EPOS net of VAT"],
            ["openingStock", "Opening stock", "Previous closing stock"],
            ["purchases", "Food purchases", "Invoice total"],
            ["credits", "Supplier credits", "Food credits only"],
            ["transfersIn", "Transfers in", "From other sites"],
            ["transfersOut", "Transfers out", "To other sites"],
            ["closingStock", "Closing stock", "Signed stocktake"],
            ["adjustments", "Adjustments", "Use negative values if required"],
            ["wasteCost", "Waste cost", "Recorded waste at cost"],
          ].map(([name, label, hint]) => (
            <label className="field" key={name}>
              <span className="field__label">{label}</span>
              <input
                className="field__input"
                inputMode="decimal"
                min={name === "adjustments" ? undefined : 0}
                name={name}
                onChange={(event) => updateNumber(name as keyof typeof values, event.target.value)}
                placeholder="0.00"
                step="0.01"
                type="number"
              />
              <span className="field__hint">{hint}</span>
            </label>
          ))}
        </div>
        <div className="privacy-callout" style={{ marginTop: "1rem" }}>
          <LockKeyhole aria-hidden="true" size={15} style={{ display: "inline", marginRight: "0.4rem", verticalAlign: "text-bottom" }} />
          Staff cost is calculated separately from secure pay rates and imported hours. Kitchen users never receive individual salaries or hourly rates.
        </div>
        <div className="cost-summary" style={{ marginTop: "1rem" }}>
          <div className="cost-summary__row"><span className="cost-summary__label">Preview COGS</span><span className="cost-summary__value">{formatCurrency(preview.cogs, 2)}</span></div>
          <div className="cost-summary__row"><span className="cost-summary__label">Preview food cost</span><span className="cost-summary__value">{formatPercentage(preview.foodCostPct)}</span></div>
        </div>
      </section>

      <section className="form-section">
        <h2 className="form-section__title">Kitchen update</h2>
        <p className="form-section__copy">Short, decision-ready notes work best. Empty issue fields mean there is nothing material to report.</p>
        <div className="form-grid">
          {[
            ["wins", "Wins & guest feedback", "What worked well this week?"],
            ["operationalIssues", "Operational issues", "Service, prep, suppliers or availability"],
            ["staffingIssues", "Staffing issues", "Absence, recruitment, training or conduct"],
            ["complianceIssues", "Compliance issues", "Food safety, H&S or required corrective action"],
            ["equipmentIssues", "Equipment issues", "Faults, engineer visits and downtime"],
            ["actionsUnderway", "Actions underway", "Owner and next step where possible"],
            ["supportNeeded", "Support needed", "Any decision or resource required from the group"],
          ].map(([name, label, placeholder], index) => (
            <label className={`field ${index === 6 ? "field--full" : ""}`} key={name}>
              <span className="field__label">{label}</span>
              <textarea className="field__input" name={name} placeholder={placeholder} />
            </label>
          ))}
        </div>
      </section>

      {state.status !== "idle" && (
        <div className={state.status === "error" ? "privacy-callout" : "privacy-callout"} role="status">
          {state.status === "success" && <CheckCircle2 aria-hidden="true" size={15} style={{ display: "inline", marginRight: "0.4rem", verticalAlign: "text-bottom" }} />}
          {state.message}
        </div>
      )}

      <div className="form-actions">
        <button className="button button--secondary" disabled={pending} name="intent" type="submit" value="draft">
          <Save aria-hidden="true" size={16} /> Save draft
        </button>
        <button className="button button--primary" disabled={pending} name="intent" type="submit" value="submit">
          <Send aria-hidden="true" size={16} /> {pending ? "Validating…" : "Submit for review"}
        </button>
      </div>
    </form>
  );
}

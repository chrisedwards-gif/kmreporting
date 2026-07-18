"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleDashed,
  FileCheck2,
  FileSpreadsheet,
  Info,
  LockKeyhole,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { saveWeeklyReport, type ReportActionState } from "@/app/actions/reports";
import {
  normaliseSiteName,
  parseCreditsOverview,
  parseGoodsDelivered,
  parseRotaCloudLabour,
  parseStockLinkEndOfWeek,
} from "@/lib/reporting/imports";
import { calculateCosts } from "@/lib/reporting/calculations";
import { isSundayToSaturday } from "@/lib/reporting/periods";
import type { ManualPurchase, ReportDraftInput } from "@/lib/types";
import { formatCurrency, formatPercentage } from "@/lib/utils";

const initialState: ReportActionState = { status: "idle", message: "" };
const browserDraftKey = "hos-kitchen-report-browser-draft-v1";

type SourceState = {
  mode: string;
  confirmed: boolean;
  reference: string;
  message: string;
  error: string;
};

const emptySource = (mode = "manual"): SourceState => ({ mode, confirmed: false, reference: "", message: "", error: "" });

const emptyNarrative: ReportDraftInput["narrative"] = {
  wins: "",
  operationalIssues: "",
  staffingIssues: "",
  complianceIssues: "",
  equipmentIssues: "",
  actionsUnderway: "",
  supportNeeded: "",
};

type BrowserDraft = {
  siteId: string;
  weekStart: string;
  weekEnd: string;
  stocktakeCompleted: boolean;
  values: ReportDraftInput["values"];
  sources: ReportDraftInput["sources"];
  narrative: ReportDraftInput["narrative"];
  manualPurchases: ManualPurchase[];
};

const restoredSource = (source: ReportDraftInput["sources"]["sales"], label: string): SourceState => ({
  ...source,
  message: `${label} total restored from the saved draft${source.confirmed ? " with its confirmation" : ""}.`,
  error: "",
});

const saturdayAfter = (sundayIso: string) => {
  const date = new Date(`${sundayIso}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
};

const readLegacyText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  return new TextDecoder("windows-1252").decode(buffer);
};

const fileReference = async (file: File) => {
  const buffer = await file.arrayBuffer();
  if (!globalThis.crypto?.subtle) return `${file.name}:${file.size}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `${file.name}:${hash}`;
};

export function ReportForm({
  initial,
  sites,
  week,
}: {
  initial?: ReportDraftInput;
  sites: Array<{ id: string; name: string; code?: string }>;
  week: { start: string; end: string };
}) {
  const [state, formAction, pending] = useActionState(saveWeeklyReport, initialState);
  const router = useRouter();
  const [selectedSiteId, setSelectedSiteId] = useState(initial?.siteId ?? sites[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(initial?.weekStart ?? week.start);
  const [weekEnd, setWeekEnd] = useState(initial?.weekEnd ?? week.end);
  const [stocktakeCompleted, setStocktakeCompleted] = useState(initial?.stocktakeCompleted ?? false);
  const [values, setValues] = useState(initial?.values ?? {
    netSales: 0,
    openingStock: 0,
    purchases: 0,
    credits: 0,
    transfersIn: 0,
    transfersOut: 0,
    closingStock: 0,
    adjustments: 0,
    wasteCost: 0,
    staffCost: 0,
    paidHours: 0,
    pendingCredits: 0,
    awaitingInvoice: 0,
  });
  const [salesSource, setSalesSource] = useState<SourceState>(initial ? restoredSource(initial.sources.sales, "Sales") : emptySource());
  const [purchasingSource, setPurchasingSource] = useState<SourceState>(initial ? restoredSource(initial.sources.purchasing, "Purchasing") : emptySource());
  const [labourSource, setLabourSource] = useState<SourceState>(initial ? restoredSource(initial.sources.labour, "Labour") : emptySource());
  const [manualPurchases, setManualPurchases] = useState<ManualPurchase[]>(initial?.manualPurchases ?? []);
  const [narrative, setNarrative] = useState<ReportDraftInput["narrative"]>(initial?.narrative ?? emptyNarrative);
  const [browserDraftRestored, setBrowserDraftRestored] = useState(false);
  const [browserDraftReady, setBrowserDraftReady] = useState(false);

  useEffect(() => {
    if (initial) {
      setBrowserDraftReady(true);
      return;
    }
    try {
      const saved = sessionStorage.getItem(browserDraftKey);
      if (!saved) return;
      const draft = JSON.parse(saved) as BrowserDraft;
      if (!sites.some((site) => site.id === draft.siteId)) return;
      setSelectedSiteId(draft.siteId);
      setWeekStart(draft.weekStart);
      setWeekEnd(draft.weekEnd);
      setStocktakeCompleted(draft.stocktakeCompleted);
      setValues(draft.values);
      setSalesSource(restoredSource(draft.sources.sales, "Sales"));
      setPurchasingSource(restoredSource(draft.sources.purchasing, "Purchasing"));
      setLabourSource(restoredSource(draft.sources.labour, "Labour"));
      setNarrative(draft.narrative);
      setManualPurchases(draft.manualPurchases ?? []);
      setBrowserDraftRestored(true);
    } catch {
      sessionStorage.removeItem(browserDraftKey);
    } finally {
      setBrowserDraftReady(true);
    }
  }, [initial, sites]);

  useEffect(() => {
    if (!browserDraftReady) return;
    const draft: BrowserDraft = {
      siteId: selectedSiteId,
      weekStart,
      weekEnd,
      stocktakeCompleted,
      values,
      sources: {
        sales: { mode: salesSource.mode, reference: salesSource.reference, confirmed: salesSource.confirmed },
        purchasing: { mode: purchasingSource.mode, reference: purchasingSource.reference, confirmed: purchasingSource.confirmed },
        labour: { mode: labourSource.mode, reference: labourSource.reference, confirmed: labourSource.confirmed },
      },
      narrative,
      manualPurchases,
    };
    sessionStorage.setItem(browserDraftKey, JSON.stringify(draft));
  }, [browserDraftReady, labourSource.confirmed, labourSource.mode, labourSource.reference, manualPurchases, narrative, purchasingSource.confirmed, purchasingSource.mode, purchasingSource.reference, salesSource.confirmed, salesSource.mode, salesSource.reference, selectedSiteId, stocktakeCompleted, values, weekEnd, weekStart]);

  useEffect(() => {
    if (state.status !== "success" || !state.reportId) return;
    sessionStorage.removeItem(browserDraftKey);
    if (state.intent === "submit") router.push(`/reports/${state.reportId}`);
    else router.replace(`/reports/new?report=${state.reportId}`);
    router.refresh();
  }, [router, state.intent, state.reportId, state.status]);

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0];
  const manualPurchaseTotal = useMemo(() => manualPurchases.reduce((total, item) => total + (Number(item.amount) || 0), 0), [manualPurchases]);
  const manualPurchasesPayload = useMemo(() => manualPurchases.filter((item) => item.description.trim() || item.amount > 0 || item.receiptReference.trim()), [manualPurchases]);
  const expectedPeriod = useMemo(() => ({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);
  const preview = useMemo(
    () => calculateCosts({
      ...values,
      purchases: values.purchases + manualPurchaseTotal,
      paidHours: values.paidHours,
      averageLoadedRate: 0,
      agencyCost: 0,
      overtimePremium: 0,
      staffCostOverride: values.staffCost,
      stocktakeCompleted,
    }),
    [manualPurchaseTotal, values, stocktakeCompleted],
  );
  const weekValid = isSundayToSaturday(weekStart, weekEnd);
  const checklist = [
    { label: "Sun–Sat week", done: weekValid },
    { label: "Net sales", done: values.netSales > 0 },
    { label: "Sales confirmed", done: salesSource.confirmed },
    { label: "Food confirmed", done: purchasingSource.confirmed },
    { label: "Staff cost", done: values.staffCost > 0 },
    { label: "Labour confirmed", done: labourSource.confirmed },
  ];
  const readyToSubmit = checklist.every((item) => item.done);

  const resetImports = () => {
    setSalesSource(emptySource());
    setPurchasingSource(emptySource());
    setLabourSource(emptySource());
    setValues((current) => ({ ...current, netSales: 0, purchases: 0, credits: 0, staffCost: 0, paidHours: 0, pendingCredits: 0, awaitingInvoice: 0 }));
    setManualPurchases([]);
  };

  const updateNumber = (name: keyof typeof values, value: string, domain?: "sales" | "purchasing" | "labour") => {
    setValues((current) => ({ ...current, [name]: Number(value) || 0 }));
    if (domain === "sales") setSalesSource((current) => ({ ...current, mode: current.reference ? "stocklink_adjusted" : "manual", confirmed: false }));
    if (domain === "purchasing") setPurchasingSource((current) => ({ ...current, mode: current.reference ? "procure_wizard_adjusted" : "manual", confirmed: false }));
    if (domain === "labour") setLabourSource((current) => ({ ...current, mode: current.reference ? "rotacloud_adjusted" : "manual", confirmed: false }));
  };

  const updateManualPurchase = (index: number, field: keyof ManualPurchase, value: string) => {
    setManualPurchases((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, [field]: field === "amount" ? Number(value) || 0 : value }
      : item));
    setPurchasingSource((current) => ({ ...current, mode: current.reference ? "procure_wizard_adjusted" : "manual", confirmed: false }));
  };

  const assertSite = (sourceSiteName: string) => {
    if (sourceSiteName && selectedSite && normaliseSiteName(sourceSiteName) !== normaliseSiteName(selectedSite.name)) {
      throw new Error(`This file is for ${sourceSiteName}, not ${selectedSite.name}.`);
    }
  };

  const importSales = async (file?: File) => {
    if (!file) return;
    try {
      const [content, reference] = await Promise.all([readLegacyText(file), fileReference(file)]);
      const result = parseStockLinkEndOfWeek(content, expectedPeriod);
      assertSite(result.siteName);
      setValues((current) => ({ ...current, netSales: result.netSales }));
      setSalesSource({
        mode: "stocklink_upload",
        confirmed: true,
        reference,
        error: "",
        message: `${result.siteName}: ${formatCurrency(result.netSales, 2)} net sales (gross ${formatCurrency(result.grossAfterAdjustments, 2)} less VAT ${formatCurrency(result.vat, 2)} and service charge ${formatCurrency(result.serviceCharge, 2)}).`,
      });
    } catch (error) {
      setSalesSource((current) => ({ ...current, confirmed: false, error: error instanceof Error ? error.message : "The EPOS file could not be read." }));
    }
  };

  const importPurchases = async (file?: File) => {
    if (!file) return;
    try {
      const [content, reference] = await Promise.all([readLegacyText(file), fileReference(file)]);
      const result = parseGoodsDelivered(content, expectedPeriod);
      assertSite(result.siteName);
      setValues((current) => ({ ...current, purchases: result.purchases, awaitingInvoice: result.awaitingInvoice }));
      setPurchasingSource({
        mode: "procure_wizard_upload",
        confirmed: true,
        reference,
        error: "",
        message: `${result.rowCount} food-delivery rows: ${formatCurrency(result.purchases, 2)} net, including ${formatCurrency(result.awaitingInvoice, 2)} awaiting invoice.`,
      });
    } catch (error) {
      setPurchasingSource((current) => ({ ...current, confirmed: false, error: error instanceof Error ? error.message : "The Goods Delivered file could not be read." }));
    }
  };

  const importCredits = async (file?: File) => {
    if (!file) return;
    try {
      const [content, reference] = await Promise.all([readLegacyText(file), fileReference(file)]);
      const result = parseCreditsOverview(content, expectedPeriod);
      assertSite(result.siteName);
      setValues((current) => ({ ...current, credits: result.confirmedCredits, pendingCredits: result.pendingCredits }));
      setPurchasingSource((current) => ({
        ...current,
        mode: current.mode === "manual" ? "procure_wizard_upload" : current.mode,
        confirmed: true,
        reference: [current.reference, reference].filter(Boolean).join(" | ").slice(0, 250),
        error: "",
        message: `${current.message ? `${current.message} ` : ""}${formatCurrency(result.confirmedCredits, 2)} confirmed credits; ${formatCurrency(result.pendingCredits, 2)} pending review.`,
      }));
    } catch (error) {
      setPurchasingSource((current) => ({ ...current, confirmed: false, error: error instanceof Error ? error.message : "The Credits Overview file could not be read." }));
    }
  };

  const importLabour = async (file?: File) => {
    if (!file) return;
    try {
      const [content, reference] = await Promise.all([readLegacyText(file), fileReference(file)]);
      const result = parseRotaCloudLabour(content, expectedPeriod);
      assertSite(result.siteName ?? "");
      setValues((current) => ({ ...current, staffCost: result.staffCost, paidHours: result.paidHours }));
      setLabourSource({
        mode: "rotacloud_upload",
        confirmed: true,
        reference,
        error: "",
        message: `${result.siteName ? `${result.siteName}: ` : ""}${formatCurrency(result.staffCost, 2)} aggregate wage cost${result.paidHours ? ` across ${result.paidHours.toFixed(2)} paid hours` : ""}. No employee rows will be stored.`,
      });
    } catch (error) {
      setLabourSource((current) => ({ ...current, confirmed: false, error: error instanceof Error ? error.message : "The RotaCloud file could not be read." }));
    }
  };

  const confirmation = (source: SourceState, setSource: (value: React.SetStateAction<SourceState>) => void, label: string) => (
    <label className="source-confirmation">
      <input checked={source.confirmed} onChange={(event) => setSource((current) => ({ ...current, confirmed: event.target.checked }))} type="checkbox" />
      <span>I confirm the {label} total matches this kitchen and reporting week.</span>
    </label>
  );

  return (
    <form action={formAction} className="report-form">
      {initial ? <div className="form-message form-message--success" role="status"><CheckCircle2 aria-hidden="true" size={15} />Draft restored. Review the totals and confirmations before submitting.</div> : null}
      {browserDraftRestored ? <div className="form-message form-message--success" role="status"><CheckCircle2 aria-hidden="true" size={15} />Your unsaved browser draft has been restored. Raw upload files are not retained, but their extracted totals and confirmations are.</div> : null}
      <input name="salesSource" type="hidden" value={salesSource.mode} />
      <input name="salesSourceReference" type="hidden" value={salesSource.reference} />
      <input name="salesConfirmed" type="hidden" value={String(salesSource.confirmed)} />
      <input name="purchasingSource" type="hidden" value={purchasingSource.mode} />
      <input name="purchasingSourceReference" type="hidden" value={purchasingSource.reference} />
      <input name="purchasingConfirmed" type="hidden" value={String(purchasingSource.confirmed)} />
      <input name="labourSource" type="hidden" value={labourSource.mode} />
      <input name="labourSourceReference" type="hidden" value={labourSource.reference} />
      <input name="labourConfirmed" type="hidden" value={String(labourSource.confirmed)} />
      <input name="stocktakeCompleted" type="hidden" value={String(stocktakeCompleted)} />
      <input name="pendingCredits" type="hidden" value={values.pendingCredits} />
      <input name="awaitingInvoice" type="hidden" value={values.awaitingInvoice} />
      <input name="manualPurchases" type="hidden" value={JSON.stringify(manualPurchasesPayload)} />

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Step 1</p><h2 className="form-section__title">Kitchen & reporting week</h2></div>
          <span className="source-chip source-chip--safe"><ShieldCheck aria-hidden="true" size={14} /> Sunday–Saturday</span>
        </div>
        <p className="form-section__copy">Every source must cover the same complete Sunday-to-Saturday period.</p>
        <div className="form-grid form-grid--three">
          <label className="field">
            <span className="field__label">Kitchen</span>
            <select className="field__input" name="siteId" onChange={(event) => { setSelectedSiteId(event.target.value); resetImports(); }} required value={selectedSiteId}>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.code ? ` · ${site.code}` : ""}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Week starting (Sunday)</span>
            <input className="field__input" name="weekStart" onChange={(event) => { setWeekStart(event.target.value); setWeekEnd(saturdayAfter(event.target.value)); resetImports(); }} required type="date" value={weekStart} />
          </label>
          <label className="field">
            <span className="field__label">Week ending (Saturday)</span>
            <input className="field__input" name="weekEnd" onChange={(event) => { setWeekEnd(event.target.value); resetImports(); }} required type="date" value={weekEnd} />
            <span className="field__hint">Fills automatically when the Sunday is chosen.</span>
          </label>
        </div>
        {!weekValid && (
          <div className="week-hint" role="alert">
            <span className="week-hint--invalid">This is not a complete Sunday-to-Saturday week, so the report cannot be submitted.</span>
            <button className="week-hint__reset" onClick={() => { setWeekStart(week.start); setWeekEnd(week.end); resetImports(); }} type="button">
              Use the latest completed week
            </button>
          </div>
        )}
      </section>

      <section className="form-section">
        <div className="form-section__heading"><div><p className="form-section__step">Step 2</p><h2 className="form-section__title">Sales</h2></div><span className="source-chip"><FileSpreadsheet aria-hidden="true" size={14} /> StockLink / EPOS</span></div>
        <p className="form-section__copy">Upload the End of Week `.xls` export. The browser extracts the safe total; the raw transaction file is never submitted or retained.</p>
        <div className="source-layout">
          <label className="source-upload">
            <Upload aria-hidden="true" size={20} />
            <span><strong>Upload EPOS report</strong><small>StockLink End of Week `.xls`</small></span>
            <input accept=".xls,.html" onChange={(event) => { void importSales(event.target.files?.[0]); event.target.value = ""; }} type="file" />
          </label>
          <label className="field">
            <span className="field__label">Net sales excluding VAT and service charge</span>
            <input className="field__input" inputMode="decimal" min="0" name="netSales" onChange={(event) => updateNumber("netSales", event.target.value, "sales")} step="0.01" type="number" value={values.netSales || ""} />
            <span className="field__hint">Manual entry remains available if no export can be produced.</span>
          </label>
        </div>
        {salesSource.message && <div className="source-result"><FileCheck2 aria-hidden="true" size={16} /><span>{salesSource.message}</span></div>}
        {salesSource.error && <div className="form-message form-message--error" role="alert">{salesSource.error}</div>}
        {confirmation(salesSource, setSalesSource, "net-sales")}
      </section>

      <section className="form-section">
        <div className="form-section__heading"><div><p className="form-section__step">Step 3</p><h2 className="form-section__title">Food spend & stock</h2></div><span className="source-chip"><FileSpreadsheet aria-hidden="true" size={14} /> Procure Wizard</span></div>
        <p className="form-section__copy">Upload Goods Delivered and Credits Overview. Delivered food counts even when the supplier invoice is still pending.</p>
        <div className="source-layout source-layout--three">
          <label className="source-upload">
            <Upload aria-hidden="true" size={20} />
            <span><strong>Goods Delivered</strong><small>Procure Wizard `.csv`</small></span>
            <input accept=".csv" onChange={(event) => { void importPurchases(event.target.files?.[0]); event.target.value = ""; }} type="file" />
          </label>
          <label className="source-upload">
            <Upload aria-hidden="true" size={20} />
            <span><strong>Credits Overview</strong><small>Confirmed and pending credits</small></span>
            <input accept=".csv" onChange={(event) => { void importCredits(event.target.files?.[0]); event.target.value = ""; }} type="file" />
          </label>
          <div className="source-stat"><span>Total food purchases</span><strong>{formatCurrency(values.purchases + manualPurchaseTotal - values.credits, 2)}</strong><small>{formatCurrency(manualPurchaseTotal, 2)} off-system · {formatCurrency(values.pendingCredits, 2)} pending credit</small></div>
        </div>
        {purchasingSource.message && <div className="source-result"><FileCheck2 aria-hidden="true" size={16} /><span>{purchasingSource.message}</span></div>}
        {purchasingSource.error && <div className="form-message form-message--error" role="alert">{purchasingSource.error}</div>}
        <div className="manual-purchases">
          <div className="manual-purchases__heading">
            <div><h3 className="form-subtitle">Off-system and top-up purchases</h3><p className="form-caption">Add shop runs, emergency ingredients or any food order not captured in Procure Wizard.</p></div>
            <button className="button button--secondary button--compact" onClick={() => setManualPurchases((current) => [...current, { description: "", amount: 0, receiptReference: "" }])} type="button"><Plus aria-hidden="true" size={14} /> Add purchase</button>
          </div>
          {manualPurchases.map((item, index) => (
            <div className="manual-purchase-row" key={index}>
              <label className="field"><span className="field__label">What was purchased?</span><input className="field__input" maxLength={120} onChange={(event) => updateManualPurchase(index, "description", event.target.value)} placeholder="e.g. Emergency produce top-up" value={item.description} /></label>
              <label className="field"><span className="field__label">Amount</span><input className="field__input" min="0.01" inputMode="decimal" onChange={(event) => updateManualPurchase(index, "amount", event.target.value)} placeholder="249.00" step="0.01" type="number" value={item.amount || ""} /></label>
              <label className="field"><span className="field__label">Receipt/reference</span><input className="field__input" maxLength={120} onChange={(event) => updateManualPurchase(index, "receiptReference", event.target.value)} placeholder="Optional receipt number" value={item.receiptReference} /></label>
              <button aria-label={`Remove purchase ${index + 1}`} className="icon-button manual-purchase-row__remove" onClick={() => { setManualPurchases((current) => current.filter((_, itemIndex) => itemIndex !== index)); setPurchasingSource((current) => ({ ...current, confirmed: false })); }} type="button"><Trash2 aria-hidden="true" size={17} /></button>
            </div>
          ))}
          {manualPurchases.length ? <div className="source-note"><Info aria-hidden="true" size={16} /><span>Off-system purchase total: <strong>{formatCurrency(manualPurchaseTotal, 2)}</strong>. This is added to delivered food before food spend/cost is calculated.</span></div> : null}
        </div>
        <details className="manual-details">
          <summary>Manual spend, transfers, waste and stock inputs</summary>
          <div className="form-grid form-grid--three">
            {[
              ["purchases", "Food delivered/purchased", "Net of VAT"],
              ["credits", "Confirmed supplier credits", "Issued credit notes only"],
              ["transfersIn", "Transfers in", "From other kitchens"],
              ["transfersOut", "Transfers out", "To other kitchens"],
              ["adjustments", "Other adjustments", "Negative values allowed"],
              ["wasteCost", "Waste cost", "Recorded waste at cost"],
            ].map(([name, label, hint]) => (
              <label className="field" key={name}>
                <span className="field__label">{label}</span>
                <input className="field__input" inputMode="decimal" min={name === "adjustments" ? undefined : 0} name={name} onChange={(event) => updateNumber(name as keyof typeof values, event.target.value, "purchasing")} step="0.01" type="number" value={values[name as keyof typeof values] || ""} />
                <span className="field__hint">{hint}</span>
              </label>
            ))}
          </div>
          <label className="source-confirmation source-confirmation--standalone">
            <input checked={stocktakeCompleted} onChange={(event) => setStocktakeCompleted(event.target.checked)} type="checkbox" />
            <span>A complete opening and closing stocktake was performed using the same valuation basis.</span>
          </label>
          {stocktakeCompleted && (
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field__label">Opening stock</span><input className="field__input" inputMode="decimal" min="0" name="openingStock" onChange={(event) => updateNumber("openingStock", event.target.value, "purchasing")} step="0.01" type="number" value={values.openingStock || ""} /></label>
              <label className="field"><span className="field__label">Closing stock</span><input className="field__input" inputMode="decimal" min="0" name="closingStock" onChange={(event) => updateNumber("closingStock", event.target.value, "purchasing")} step="0.01" type="number" value={values.closingStock || ""} /></label>
            </div>
          )}
        </details>
        {confirmation(purchasingSource, setPurchasingSource, "food-spend and credit")}
      </section>

      <section className="form-section">
        <div className="form-section__heading"><div><p className="form-section__step">Step 4</p><h2 className="form-section__title">Labour</h2></div><span className="source-chip source-chip--safe"><LockKeyhole aria-hidden="true" size={14} /> Aggregate only</span></div>
        <p className="form-section__copy">Use the RotaCloud Daily Totals CSV where possible, or enter the weekly site total. The app stores only aggregate cost and hours—never names, salaries or hourly rates.</p>
        <div className="source-layout source-layout--three">
          <label className="source-upload">
            <Upload aria-hidden="true" size={20} />
            <span><strong>Upload RotaCloud</strong><small>Daily Totals `.csv` preferred</small></span>
            <input accept=".csv" onChange={(event) => { void importLabour(event.target.files?.[0]); event.target.value = ""; }} type="file" />
          </label>
          <label className="field"><span className="field__label">Aggregate weekly wage cost</span><input className="field__input" inputMode="decimal" min="0" name="staffCost" onChange={(event) => updateNumber("staffCost", event.target.value, "labour")} step="0.01" type="number" value={values.staffCost || ""} /><span className="field__hint">Use the total shown by RotaCloud.</span></label>
          <label className="field"><span className="field__label">Paid hours (optional)</span><input className="field__input" inputMode="decimal" min="0" name="paidHours" onChange={(event) => updateNumber("paidHours", event.target.value, "labour")} step="0.01" type="number" value={values.paidHours || ""} /><span className="field__hint">Helpful for trend analysis; no employee detail.</span></label>
        </div>
        {labourSource.message && <div className="source-result"><FileCheck2 aria-hidden="true" size={16} /><span>{labourSource.message}</span></div>}
        {labourSource.error && <div className="form-message form-message--error" role="alert">{labourSource.error}</div>}
        {confirmation(labourSource, setLabourSource, "aggregate labour")}
      </section>

      <section className="form-section">
        <div className="form-section__heading"><div><p className="form-section__step">Step 5</p><h2 className="form-section__title">Calculated weekly position</h2></div><span className={`source-chip ${stocktakeCompleted ? "source-chip--safe" : "source-chip--attention"}`}>{stocktakeCompleted ? "Stock-adjusted" : "Spend basis"}</span></div>
        <div className="preview-grid">
          <div><span>Net sales</span><strong>{formatCurrency(values.netSales, 2)}</strong></div>
          <div><span>{stocktakeCompleted ? "Food cost" : "Food spend"}</span><strong>{formatPercentage(preview.foodCostPct)}</strong><small>{formatCurrency(preview.cogs, 2)}</small></div>
          <div><span>Staff cost</span><strong>{formatPercentage(preview.labourPct)}</strong><small>{formatCurrency(preview.staffCost, 2)}</small></div>
          <div><span>Prime cost</span><strong>{formatPercentage(preview.primeCostPct)}</strong><small>{formatCurrency(preview.primeCost, 2)}</small></div>
        </div>
        {!stocktakeCompleted && <div className="source-note"><Info aria-hidden="true" size={16} /><span>This is a spend-based indicator. It will be labelled as such until opening and closing stocktakes are completed.</span></div>}
      </section>

      <section className="form-section">
        <div className="form-section__heading"><div><p className="form-section__step">Step 6</p><h2 className="form-section__title">Kitchen update</h2></div></div>
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
              <textarea className="field__input" name={name} onChange={(event) => setNarrative((current) => ({ ...current, [name]: event.target.value }))} placeholder={placeholder} value={narrative[name as keyof ReportDraftInput["narrative"]]} />
            </label>
          ))}
        </div>
      </section>

      {state.status !== "idle" && (
        <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">
          {state.status === "success" && <CheckCircle2 aria-hidden="true" size={15} />}{state.message}
        </div>
      )}

      <div className="form-actions form-actions--sticky">
        <div aria-label="Submission readiness" className="form-checklist">
          {checklist.map((item) => (
            <span className={`form-checklist__item${item.done ? " form-checklist__item--done" : ""}`} key={item.label}>
              {item.done ? <CheckCircle2 aria-hidden="true" size={13} /> : <CircleDashed aria-hidden="true" size={13} />}
              {item.label}
            </span>
          ))}
        </div>
        <button className="button button--secondary" disabled={pending} name="intent" type="submit" value="draft"><Save aria-hidden="true" size={16} /> Save draft</button>
        <button className="button button--primary" disabled={pending || !readyToSubmit} name="intent" type="submit" value="submit"><Send aria-hidden="true" size={16} /> {pending ? "Validating…" : "Submit for review"}</button>
      </div>
    </form>
  );
}

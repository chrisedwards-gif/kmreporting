"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, FolderUp, LoaderCircle, ShieldCheck, TriangleAlert, X } from "lucide-react";
import styles from "./group-master-uploader.module.css";

type ReconciliationRow = {
  siteId: string;
  siteName: string;
  metricKey: string;
  siteValue: number | null;
  masterValue: number | null;
  variance: number | null;
  variancePct: number | null;
  status: "match" | "warning" | "missing_site" | "missing_master";
};

type UploadResult = {
  ok?: boolean;
  batchId?: string;
  weekStart?: string;
  parsed?: Array<{ name: string; site: string | null; classification: string; status: string; error: string; summary: Record<string, unknown> }>;
  reconciliation?: ReconciliationRow[];
  error?: string;
};

type MasterSource = {
  title: string;
  exportRule: string;
  unlocks: string;
};

const masterSources: MasterSource[] = [
  {
    title: "Access / StockLink — End Of Week Report",
    exportRule: "HTML/HTM · exact Sunday–Saturday week · one export per kitchen",
    unlocks: "Net sales, gross sales and the daily / item / category sales mix used by decision intelligence.",
  },
  {
    title: "Procure Wizard — Goods Delivered",
    exportRule: "CSV · Food category · exact reporting week · one kitchen per export",
    unlocks: "Food purchases and Awaiting Invoice values for the independent food-cost cross-check.",
  },
  {
    title: "Procure Wizard — Credits Overview",
    exportRule: "CSV · one kitchen per export",
    unlocks: "Confirmed credits and pending / investigation credits. Keep the kitchen name in the filename if the export is empty.",
  },
  {
    title: "RotaCloud — Labour / Daily Totals",
    exportRule: "CSV · one kitchen per export · include wage cost and paid hours",
    unlocks: "Staff cost and paid hours. A detailed dated/shift export also unlocks exact hourly staffing analysis.",
  },
];

const prettyClassification = (value: string) => ({
  sales_eow: "EPOS sales",
  procure_goods: "Goods Delivered",
  procure_credits: "Credits Overview",
  rotacloud_labour: "Labour",
  stocktake_support: "Stocktake support",
  waste_support: "Waste support",
  supporting: "Supporting file",
}[value] ?? value.replaceAll("_", " "));

const prettyMetric = (value: string) => ({
  net_sales: "Net sales",
  gross_sales: "Gross sales",
  purchases: "Purchases",
  credits: "Credits",
  staff_cost: "Staff cost",
  paid_hours: "Paid hours",
  pending_credits: "Pending credits",
  awaiting_invoice: "Awaiting invoice",
}[value] ?? value.replaceAll("_", " "));

const moneyKeys = new Set(["net_sales", "gross_sales", "purchases", "credits", "staff_cost", "pending_credits", "awaiting_invoice"]);
const formatValue = (key: string, value: number | null) => value == null
  ? "—"
  : moneyKeys.has(key)
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(value)
    : value.toFixed(2);

export function GroupMasterUploader({ weekStart, activeSites = [] }: { weekStart: string; activeSites?: string[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [start, setStart] = useState(weekStart);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const expectedCoreFiles = activeSites.length ? activeSites.length * masterSources.length : null;

  const addFiles = (next: File[]) => {
    const byKey = new Map(files.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
    for (const file of next) byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file);
    setFiles([...byKey.values()].slice(0, 80));
    setResult(null);
  };

  const upload = async () => {
    if (!start || !files.length || uploading) return;
    setUploading(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("weekStart", start);
      files.forEach((file) => body.append("files", file));
      const response = await fetch("/api/group-weekly-pack", { method: "POST", body });
      const payload = await response.json().catch(() => ({ error: "The server did not return a readable response." })) as UploadResult;
      setResult(payload);
    } catch {
      setResult({ error: "The group pack could not be uploaded. Check the connection and try again." });
    } finally {
      setUploading(false);
    }
  };

  const warnings = result?.reconciliation?.filter((row) => row.status !== "match") ?? [];
  const matches = result?.reconciliation?.filter((row) => row.status === "match") ?? [];
  const matchedSites = [...new Set((result?.parsed ?? []).filter((row) => row.status === "parsed" && row.site).map((row) => row.site!))];

  return (
    <section className="panel weekly-pack group-master-pack">
      <div className="panel__header weekly-pack__header">
        <div>
          <p className="page-header__eyebrow">Group source of truth</p>
          <h2 className="panel__title">Upload the four core exports for every kitchen.</h2>
          <p className="panel__subtitle">Drop them together. The app identifies each kitchen, extracts the recognised totals and checks them against the KM-submitted site reports.</p>
        </div>
        <span className="source-chip source-chip--safe"><ShieldCheck aria-hidden="true" size={14} /> Group management only</span>
      </div>
      <div className="panel__body weekly-pack__body">
        <div className="weekly-pack__selectors weekly-pack__selectors--single">
          <label className="field">
            <span className="field__label">Week starting Sunday</span>
            <input className="field__input" onChange={(event) => { setStart(event.target.value); setResult(null); }} type="date" value={start} />
          </label>
        </div>

        <section aria-label="Required master reports" className={styles["source-guide"]}>
          <div className={styles["source-guide__header"]}>
            <div className={styles["source-guide__header-copy"]}>
              <strong>What exactly do I need to export?</strong>
              <span>These four reports are the weekly core pack. Each data export must cover one kitchen only so it can be reconciled safely.</span>
              {activeSites.length ? <span><strong>Active kitchens:</strong> {activeSites.join(", ")}</span> : null}
            </div>
            <span className={styles["source-guide__count"]}>{expectedCoreFiles ? `${expectedCoreFiles} core files expected` : "4 files per kitchen"}</span>
          </div>
          <div className={styles["source-guide__grid"]}>
            {masterSources.map((source, index) => (
              <article className={styles["source-guide__item"]} key={source.title}>
                <div className={styles["source-guide__item-top"]}>
                  <span className={styles["source-guide__number"]}>{index + 1}</span>
                  <span className={styles["source-guide__required"]}>Required weekly</span>
                </div>
                <strong>{source.title}</strong>
                <span>{source.exportRule}</span>
                <small><strong>Used for:</strong> {source.unlocks}</small>
              </article>
            ))}
          </div>
          <div className={styles["source-guide__note"]}><strong>Important:</strong> use the original HTML/CSV exports for the four core reports. XLS/XLSX/PDF/TXT files can be retained as supporting evidence, but they do not currently populate the reconciliation figures. Stocktake and waste files are optional supporting evidence.</div>
        </section>

        <div className={styles["source-guide__separate"]}><strong>Menu / recipe costs are separate:</strong> upload those on the Decision Desk when costs change — they are not part of the weekly master pack.</div>

        <button
          className={`weekly-pack__drop${dragging ? " weekly-pack__drop--active" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
          type="button"
        >
          <FolderUp aria-hidden="true" size={34} />
          <strong>Drop the full HOS master pack here</strong>
          <span>{expectedCoreFiles ? `Aim for ${expectedCoreFiles} core data files for this week; optional evidence can be added too.` : "Upload all four core reports for every kitchen together."}</span>
          <small>Access / StockLink · Procure Wizard Goods · Procure Wizard Credits · RotaCloud Labour</small>
        </button>
        <input accept=".csv,.xls,.xlsx,.html,.htm,.pdf,.txt" hidden multiple onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ""; }} ref={inputRef} type="file" />

        {files.length ? (
          <div className="weekly-pack__queue">
            <div className="weekly-pack__queue-head"><strong>{files.length} master file{files.length === 1 ? "" : "s"}</strong><span>{(totalBytes / 1024 / 1024).toFixed(1)} MB</span></div>
            {files.map((file, index) => (
              <div className="weekly-pack__file" key={`${file.name}-${file.size}-${index}`}>
                <span className="weekly-pack__file-type">{file.name.split(".").pop()?.toUpperCase() || "FILE"}</span>
                <div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB</small></div>
                <button aria-label={`Remove ${file.name}`} className="icon-button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><X aria-hidden="true" size={15} /></button>
              </div>
            ))}
          </div>
        ) : null}

        {result?.error ? <div className="form-message form-message--error" role="alert">{result.error}</div> : null}
        {result?.ok ? (
          <div className="group-master-result" role="status">
            <div className="weekly-pack__result-title"><CheckCircle2 aria-hidden="true" size={18} /><strong>Master pack processed</strong></div>
            <p>{matchedSites.length} kitchen{matchedSites.length === 1 ? "" : "s"} recognised · {matches.length} metric checks matched · {warnings.length} need review.</p>
            <div className="group-master-result__sites">{matchedSites.map((site) => <span className="source-chip source-chip--safe" key={site}>{site}</span>)}</div>
            {result.parsed?.filter((item) => item.status !== "parsed").map((item) => (
              <div className="weekly-pack__parsed weekly-pack__parsed--error" key={item.name}>
                <FileSpreadsheet aria-hidden="true" size={15} />
                <span><strong>{prettyClassification(item.classification)}</strong> · {item.name}</span>
                <small>{item.error || "Stored but not used for reconciliation"}</small>
              </div>
            ))}
            {warnings.length ? (
              <div className="reconciliation-warnings">
                <h3><TriangleAlert aria-hidden="true" size={17} /> Reconciliation exceptions</h3>
                {warnings.slice(0, 20).map((row) => (
                  <div className="reconciliation-row" key={`${row.siteId}-${row.metricKey}`}>
                    <div><strong>{row.siteName}</strong><span>{prettyMetric(row.metricKey)}</span></div>
                    <span>Site {formatValue(row.metricKey, row.siteValue)}</span>
                    <span>Master {formatValue(row.metricKey, row.masterValue)}</span>
                    <span className="reconciliation-row__status">{row.status === "warning" ? `Δ ${formatValue(row.metricKey, row.variance)}` : row.status.replaceAll("_", " ")}</span>
                  </div>
                ))}
              </div>
            ) : <p className="weekly-pack__missing weekly-pack__missing--ready">All comparable submitted values agree with the master pack.</p>}
          </div>
        ) : null}

        <div className="weekly-pack__actions">
          <button className="button button--primary" disabled={!files.length || !start || uploading} onClick={() => void upload()} type="button">
            {uploading ? <><LoaderCircle aria-hidden="true" className="spin" size={17} /> Cross-checking every kitchen…</> : <><FolderUp aria-hidden="true" size={17} /> Upload & reconcile group pack</>}
          </button>
          <span>This does not overwrite a manager’s report; it creates an independent management source for comparison.</span>
        </div>
      </div>
    </section>
  );
}

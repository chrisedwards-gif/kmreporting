"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, FolderUp, LoaderCircle, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { WeeklySourceChecklist } from "@/components/reports/weekly-source-checklist";
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

type ParsedUpload = {
  name: string;
  site: string | null;
  sites?: string[];
  externalBrands?: string[];
  classification: string;
  status: string;
  error: string;
  summary: Record<string, unknown>;
};

type UploadResult = {
  ok?: boolean;
  batchId?: string;
  weekStart?: string;
  parsed?: ParsedUpload[];
  reconciliation?: ReconciliationRow[];
  error?: string;
};

type SourceException = {
  siteName: string;
  purchasingMasterExpected: boolean;
  labourMasterExpected: boolean;
};

const prettyClassification = (value: string) => ({
  sales_eow: "End Of Week Report",
  procure_goods: "Goods Purchased",
  procure_credits: "Credits Overview",
  rotacloud_labour: "RotaCloud Daily Totals",
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

const sourceExceptionLabel = (exception: SourceException) => {
  const missing = [
    !exception.purchasingMasterExpected ? "Procure Wizard" : null,
    !exception.labourMasterExpected ? "RotaCloud" : null,
  ].filter(Boolean);
  return `${exception.siteName}: ${missing.join(" + ")} not expected in the Group Chef master; the KM submission is the source for those metrics.`;
};

const dedupeFilesByContent = async (input: File[]) => {
  if (!globalThis.crypto?.subtle) return input;
  const seen = new Set<string>();
  const unique: File[] = [];
  for (const file of input) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    if (seen.has(hash)) continue;
    seen.add(hash);
    unique.push(file);
  }
  return unique;
};

export function GroupMasterUploader({
  weekStart,
  activeSites = [],
  sourceExceptions = [],
}: {
  weekStart: string;
  activeSites?: string[];
  sourceExceptions?: SourceException[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [start, setStart] = useState(weekStart);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

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
      const uniqueFiles = await dedupeFilesByContent(files);
      if (uniqueFiles.length !== files.length) setFiles(uniqueFiles);
      const body = new FormData();
      body.set("weekStart", start);
      uniqueFiles.forEach((file) => body.append("files", file));
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
  const matchedSites = [...new Set((result?.parsed ?? []).flatMap((row) => row.sites?.length ? row.sites : row.site ? [row.site] : []))];
  const externalBrands = [...new Set((result?.parsed ?? []).flatMap((row) => row.externalBrands ?? []))];

  return (
    <section className="panel weekly-pack group-master-pack">
      <div className="panel__header weekly-pack__header">
        <div>
          <p className="page-header__eyebrow">Group Chef source of truth</p>
          <h2 className="panel__title">Download the reports below, then upload them once.</h2>
          <p className="panel__subtitle">Choose All Sites / All Locations where that source applies. Competitor StockLink reports are retained as benchmarks; kitchen-specific source exceptions are not treated as missing data.</p>
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

        <WeeklySourceChecklist audience="group" />

        {activeSites.length ? <div className={styles["source-guide__separate"]}><strong>Active kitchens expected for applicable sources:</strong> {activeSites.join(", ")}.</div> : null}

        {sourceExceptions.map((exception) => (
          <div className={styles["source-guide__separate"]} key={exception.siteName}>
            <strong>Source exception:</strong> {sourceExceptionLabel(exception)}
          </div>
        ))}

        <div className={styles["source-guide__separate"]}><strong>Group shortcut:</strong> Procure Wizard can be exported as All Sites for kitchens that use PW. RotaCloud can be All Locations when the CSV contains per-location hours/cost columns; otherwise export the applicable kitchens separately. Access End Of Week Report remains one file per kitchen/brand and unmatched brands are kept as competitor benchmarks.</div>

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
          <strong>Drop the required Group Chef exports here</strong>
          <span>Use HOS-wide files wherever possible — no kitchen selector needed.</span>
          <small>End Of Week Report · Goods Purchased · Credits Overview · RotaCloud Daily Totals</small>
        </button>
        <input accept=".csv,.xls,.xlsx,.html,.htm,.pdf,.txt" hidden multiple onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ""; }} ref={inputRef} type="file" />

        {files.length ? (
          <div className="weekly-pack__queue">
            <div className="weekly-pack__queue-head"><strong>{files.length} group source file{files.length === 1 ? "" : "s"}</strong><span>{(totalBytes / 1024 / 1024).toFixed(1)} MB</span></div>
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
            <div className="weekly-pack__result-title"><CheckCircle2 aria-hidden="true" size={18} /><strong>Group master pack processed</strong></div>
            <p>{matchedSites.length} active kitchen{matchedSites.length === 1 ? "" : "s"} recognised · {externalBrands.length} competitor benchmark{externalBrands.length === 1 ? "" : "s"} captured · {matches.length} metric checks matched · {warnings.length} currently need review / a KM submission.</p>
            <div className="group-master-result__sites">
              {matchedSites.map((site) => <span className="source-chip source-chip--safe" key={site}>{site}</span>)}
              {externalBrands.map((brand) => <span className="source-chip" key={brand}>{brand} · competitor</span>)}
            </div>
            {result.parsed?.map((item) => {
              const competitors = item.externalBrands ?? [];
              return (
                <div className={`weekly-pack__parsed${item.status === "error" || item.error ? " weekly-pack__parsed--error" : ""}`} key={item.name}>
                  <FileSpreadsheet aria-hidden="true" size={15} />
                  <span><strong>{prettyClassification(item.classification)}</strong> · {item.name}</span>
                  <small>{competitors.length
                    ? `Competitor benchmark captured: ${competitors.join(", ")}`
                    : item.sites?.length
                      ? `${item.sites.length} kitchens: ${item.sites.join(", ")}${item.error ? ` · ${item.error}` : ""}`
                      : item.error || "Stored as supporting evidence"}</small>
                </div>
              );
            })}
            {warnings.length ? (
              <div className="reconciliation-warnings">
                <h3><TriangleAlert aria-hidden="true" size={17} /> Reconciliation still in progress / needs review</h3>
                {warnings.slice(0, 20).map((row) => (
                  <div className="reconciliation-row" key={`${row.siteId}-${row.metricKey}`}>
                    <div><strong>{row.siteName}</strong><span>{prettyMetric(row.metricKey)}</span></div>
                    <span>KM {formatValue(row.metricKey, row.siteValue)}</span>
                    <span>Master {formatValue(row.metricKey, row.masterValue)}</span>
                    <span className="reconciliation-row__status">{row.status === "warning" ? `Δ ${formatValue(row.metricKey, row.variance)}` : row.status.replaceAll("_", " ")}</span>
                  </div>
                ))}
              </div>
            ) : <p className="weekly-pack__missing weekly-pack__missing--ready">All comparable KM values agree with your independent master pack. Source-exception metrics remain owned by the KM submission.</p>}
          </div>
        ) : null}

        <div className="weekly-pack__actions">
          <button className="button button--primary" disabled={!files.length || !start || uploading} onClick={() => void upload()} type="button">
            {uploading ? <><LoaderCircle aria-hidden="true" className="spin" size={17} /> Splitting & cross-checking every kitchen…</> : <><FolderUp aria-hidden="true" size={17} /> Upload HOS-wide master pack</>}
          </button>
          <span>Your files never overwrite a KM report. They stay as the independent Group Chef source used to check it.</span>
        </div>
      </div>
    </section>
  );
}

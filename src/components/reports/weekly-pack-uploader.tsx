"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, FolderUp, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { WeeklySourceChecklist } from "@/components/reports/weekly-source-checklist";

type UploadResult = {
  ok?: boolean;
  reportId?: string;
  siteName?: string;
  missing?: string[];
  parsed?: Array<{ name: string; classification: string; status: string; error: string; summary: Record<string, unknown> }>;
  error?: string;
};

const shortType = (name: string) => {
  const extension = name.split(".").pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
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

export function WeeklyPackUploader({ sites, weekStart }: {
  sites: Array<{ id: string; name: string; code?: string }>;
  weekStart: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [start, setStart] = useState(weekStart);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const addFiles = (next: File[]) => {
    const byKey = new Map(files.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
    for (const file of next) byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file);
    setFiles([...byKey.values()].slice(0, 20));
    setResult(null);
  };

  const removeFile = (index: number) => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));

  const upload = async () => {
    if (!siteId || !start || !files.length || uploading) return;
    setUploading(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("siteId", siteId);
      body.set("weekStart", start);
      files.forEach((file) => body.append("files", file));
      const response = await fetch("/api/weekly-pack", { method: "POST", body });
      const payload = await response.json().catch(() => ({ error: "The server did not return a readable response." })) as UploadResult;
      setResult(payload);
      if (response.ok && payload.reportId) {
        window.setTimeout(() => router.push(`/reports/new?report=${payload.reportId}`), 900);
      }
    } catch {
      setResult({ error: "The weekly pack could not be uploaded. Check the connection and try again." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="panel weekly-pack">
      <div className="panel__header weekly-pack__header">
        <div>
          <p className="page-header__eyebrow">Kitchen Manager weekly upload</p>
          <h2 className="panel__title">Download four reports, then upload them together.</h2>
          <p className="panel__subtitle">The exact report names and filters are below. Use your kitchen only and the Sunday–Saturday reporting week.</p>
        </div>
        <span className="source-chip source-chip--safe"><ShieldCheck aria-hidden="true" size={14} /> Raw files retained privately</span>
      </div>
      <div className="panel__body weekly-pack__body">
        <div className="weekly-pack__selectors">
          <label className="field">
            <span className="field__label">Kitchen</span>
            <select className="field__input" onChange={(event) => { setSiteId(event.target.value); setResult(null); }} value={siteId}>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.code ? ` · ${site.code}` : ""}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Week starting Sunday</span>
            <input className="field__input" onChange={(event) => { setStart(event.target.value); setResult(null); }} type="date" value={start} />
          </label>
        </div>

        <WeeklySourceChecklist audience="kitchen" />

        <button
          className={`weekly-pack__drop${dragging ? " weekly-pack__drop--active" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
          type="button"
        >
          <FolderUp aria-hidden="true" size={32} />
          <strong>Drop the four required reports here</strong>
          <span>End Of Week Report · Goods Purchased · Credits Overview · RotaCloud Daily Totals</span>
          <small>HTML/HTM + CSV · optional supporting files can be added too</small>
        </button>
        <input
          accept=".csv,.xls,.xlsx,.html,.htm,.pdf,.txt"
          hidden
          multiple
          onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ""; }}
          ref={inputRef}
          type="file"
        />

        {files.length ? (
          <div className="weekly-pack__queue">
            <div className="weekly-pack__queue-head"><strong>{files.length} file{files.length === 1 ? "" : "s"} ready</strong><span>{(totalBytes / 1024 / 1024).toFixed(1)} MB</span></div>
            {files.map((file, index) => (
              <div className="weekly-pack__file" key={`${file.name}-${file.size}-${index}`}>
                <span className="weekly-pack__file-type">{shortType(file.name)}</span>
                <div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB</small></div>
                <button aria-label={`Remove ${file.name}`} className="icon-button" onClick={() => removeFile(index)} type="button"><X aria-hidden="true" size={15} /></button>
              </div>
            ))}
          </div>
        ) : null}

        {result?.error ? <div className="form-message form-message--error" role="alert">{result.error}</div> : null}
        {result?.ok ? (
          <div className="weekly-pack__result" role="status">
            <div className="weekly-pack__result-title"><CheckCircle2 aria-hidden="true" size={18} /><strong>{result.siteName} draft created</strong></div>
            {result.parsed?.map((item) => (
              <div className={`weekly-pack__parsed weekly-pack__parsed--${item.status}`} key={item.name}>
                <FileSpreadsheet aria-hidden="true" size={15} />
                <span><strong>{prettyClassification(item.classification)}</strong> · {item.name}</span>
                <small>{item.error || (item.status === "parsed" ? "Recognised" : "Stored as supporting evidence")}</small>
              </div>
            ))}
            {result.missing?.length ? <p className="weekly-pack__missing">Still needed before submission: <strong>{result.missing.join(", ")}</strong>.</p> : <p className="weekly-pack__missing weekly-pack__missing--ready">All four core sources are recognised. Opening the short review now.</p>}
          </div>
        ) : null}

        <div className="weekly-pack__actions">
          <button className="button button--primary" disabled={!files.length || !siteId || !start || uploading} onClick={() => void upload()} type="button">
            {uploading ? <><LoaderCircle aria-hidden="true" className="spin" size={17} /> Reading & cross-checking…</> : <><FolderUp aria-hidden="true" size={17} /> Upload & build draft</>}
          </button>
          <span>The original files stay attached to this reporting week for audit and future reprocessing.</span>
        </div>
      </div>
    </section>
  );
}

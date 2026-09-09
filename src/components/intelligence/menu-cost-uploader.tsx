"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, Upload } from "lucide-react";

type Result = { ok?: boolean; siteName?: string; imported?: number; validFrom?: string; sourceReference?: string; error?: string };

export function MenuCostUploader({ sites }: { sites: Array<{ id: string; name: string }> }) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const submit = async () => {
    if (!siteId || !validFrom || !file || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("siteId", siteId);
      body.set("validFrom", validFrom);
      body.set("file", file);
      const response = await fetch("/api/menu-costs", { method: "POST", body });
      const payload = await response.json().catch(() => ({ error: "The server response could not be read." })) as Result;
      setResult(payload);
    } catch {
      setResult({ error: "The menu cost file could not be uploaded." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel menu-cost-upload">
      <div className="panel__header"><div><h2 className="panel__title">Menu contribution costs</h2><p className="panel__subtitle">Optional but powerful: upload recipe/portion cost so pricing and removal recommendations can use margin, not revenue alone.</p></div></div>
      <div className="panel__body">
        <div className="menu-cost-upload__grid">
          <label className="field"><span className="field__label">Kitchen</span><select className="field__input" value={siteId} onChange={(event) => { setSiteId(event.target.value); setResult(null); }}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label className="field"><span className="field__label">Costs effective from</span><input className="field__input" type="date" value={validFrom} onChange={(event) => { setValidFrom(event.target.value); setResult(null); }} /></label>
          <label className="field"><span className="field__label">CSV file</span><input accept=".csv,.txt" className="field__input" type="file" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); }} /></label>
          <button className="button button--primary" disabled={!file || !siteId || !validFrom || loading} onClick={() => void submit()} type="button">{loading ? <><LoaderCircle className="spin" size={16} /> Importing…</> : <><Upload size={16} /> Import item costs</>}</button>
        </div>
        <p className="field__hint">Accepted headings are flexible: Item/Product/Dish/Recipe Name plus Unit Food Cost/Food Cost/Recipe Cost/Cost per Portion.</p>
        {result?.error ? <div className="form-message form-message--error" role="alert">{result.error}</div> : null}
        {result?.ok ? <div className="form-message form-message--success"><CheckCircle2 size={16} /> {result.imported} costs imported for {result.siteName} from {result.validFrom}. The original CSV is retained privately.</div> : null}
      </div>
    </section>
  );
}

"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, LoaderCircle, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { autosaveOneToOne, saveOneToOne, type OneToOneActionState } from "@/app/actions/one-to-ones";
import { ActionToast } from "@/components/ui/action-toast";
import { useToast } from "@/components/ui/toast-provider";
import type { ManagerAction, OneToOneDetail, WeekKpis } from "@/lib/data/one-to-ones";
import {
  buildFollowUpEmail,
  foodGpKpi,
  labourKpi,
  overallScore,
  SCORE_AREAS,
  scoreRag,
  type Rag,
  type ScoreMap,
} from "@/lib/performance/scoring";
import { formatCurrency, formatDate } from "@/lib/utils";

const areaLabels: Record<(typeof SCORE_AREAS)[number], string> = {
  leadership: "Leadership",
  communication: "Communication",
  organisation: "Organisation",
  kitchen_standards: "Kitchen standards",
  product_quality: "Product quality",
  commercial_awareness: "Commercial awareness",
  problem_solving: "Problem solving",
  ownership: "Ownership",
};

const winFields: Array<[string, string]> = [
  ["biggestWin", "Biggest win this week"],
  ["mostImproved", "Most improved area"],
  ["recognise", "Team member to recognise"],
  ["otherPositives", "Other positives"],
];

const summaryFields: Array<[string, string]> = [
  ["wentWell", "What went well?"],
  ["toImprove", "What needs to improve?"],
  ["supportNeeded", "What support is needed from Chris?"],
  ["managerComments", "Manager comments"],
  ["chrisComments", "Chris comments"],
];

type ScoreRow = {
  area: (typeof SCORE_AREAS)[number];
  score: string;
  evidence: string;
  developmentNote: string;
};

type ActionRow = {
  id: string;
  priority: "high" | "medium" | "low";
  action: string;
  successMeasure: string;
  owner: string;
  dueDate: string;
  status: ManagerAction["status"];
  outcome: string;
  carriedFrom: string;
  isNew: boolean;
};

const ragChip = (rag: Rag, label?: string) => (
  <span className={`rag-chip rag-chip--${rag}`}>{label ?? rag}</span>
);

const toActionRow = (item: ManagerAction): ActionRow => ({
  id: item.id,
  priority: item.priority,
  action: item.action,
  successMeasure: item.successMeasure,
  owner: item.owner,
  dueDate: item.dueDate ?? "",
  status: item.status,
  outcome: item.outcome,
  carriedFrom: "",
  isNew: false,
});

const initialState: OneToOneActionState = { status: "idle", message: "" };

export function OneToOneForm({
  assignmentId,
  detail,
  initialActions,
  kpis,
  managerFirstName,
  managerName,
  openActions,
  weekCommencing,
}: {
  assignmentId: string;
  detail: OneToOneDetail | null;
  initialActions: ManagerAction[];
  kpis: WeekKpis;
  managerFirstName: string;
  managerName: string;
  openActions: ManagerAction[];
  weekCommencing: string;
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [state, formAction, pending] = useActionState(saveOneToOne, initialState);
  const [wins, setWins] = useState<Record<string, string>>(detail?.wins ?? {});
  const [kpiManual, setKpiManual] = useState<Record<string, string>>(detail?.kpiManual ?? {});
  const [summary, setSummary] = useState<Record<string, string>>(detail?.summary ?? {});
  const [reviewDate, setReviewDate] = useState(detail?.reviewDate ?? new Date().toISOString().slice(0, 10));
  const [scores, setScores] = useState<ScoreRow[]>(
    SCORE_AREAS.map((area) => {
      const existing = detail?.scores.find((row) => row.area === area);
      return {
        area,
        score: existing?.score?.toString() ?? "",
        evidence: existing?.evidence ?? "",
        developmentNote: existing?.developmentNote ?? "",
      };
    }),
  );
  const [actions, setActions] = useState<ActionRow[]>(initialActions.map(toActionRow));
  const editable = !detail || ["draft", "in_review", "reopened"].includes(detail.status);

  const scoreMap = useMemo(() => {
    const map: ScoreMap = {};
    for (const row of scores) if (row.score !== "") map[row.area] = Number(row.score);
    return map;
  }, [scores]);
  const overall = overallScore(scoreMap);

  const carryForward = (item: ManagerAction) => {
    if (actions.length >= 7 || actions.some((row) => row.id === item.id)) return;
    setActions((current) => [
      ...current,
      {
        ...toActionRow(item),
        carriedFrom: item.id,
      },
    ]);
  };

  const addAction = () => {
    if (actions.length >= 7) return;
    setActions((current) => [
      ...current,
      {
        id: globalThis.crypto.randomUUID(),
        isNew: true,
        priority: current.length < 5 ? "high" : "medium",
        action: "",
        successMeasure: "",
        owner: managerName,
        dueDate: "",
        status: "not_started",
        outcome: "",
        carriedFrom: "",
      },
    ]);
  };

  const updateAction = (index: number, patch: Partial<ActionRow>) =>
    setActions((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const payload = useMemo(() => JSON.stringify({
    assignmentId,
    weekCommencing,
    reviewDate,
    wins,
    kpiManual,
    summary,
    scores,
    actions,
    saveMode: "manual",
    intent: "save",
  }), [actions, assignmentId, kpiManual, reviewDate, scores, summary, weekCommencing, wins]);
  const payloadRef = useRef(payload);
  const lastSavedPayloadRef = useRef(payload);
  const saveSequenceRef = useRef(0);
  const explicitSubmitRef = useRef(false);
  const explicitPayloadRef = useRef(payload);
  const [saveStatus, setSaveStatus] = useState<"idle" | "unsaved" | "saving" | "saved" | "error">(detail ? "saved" : "idle");
  const [savedAt, setSavedAt] = useState<Date | null>(detail ? new Date() : null);
  payloadRef.current = payload;

  useEffect(() => {
    if (state.status === "idle") return;
    explicitSubmitRef.current = false;
    if (state.status === "error") {
      setSaveStatus("error");
      return;
    }
    lastSavedPayloadRef.current = explicitPayloadRef.current;
    setSaveStatus(payloadRef.current === explicitPayloadRef.current ? "saved" : "unsaved");
    setSavedAt(new Date());
    if (!state.reviewId) return;
    if (!detail) router.replace(`/one-to-ones/${state.reviewId}`);
    else router.refresh();
  }, [detail, router, state.message, state.reviewId, state.status]);

  useEffect(() => {
    if (!editable || pending || explicitSubmitRef.current || payload === lastSavedPayloadRef.current) return;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(async () => {
      const sentPayload = payload;
      const sequence = ++saveSequenceRef.current;
      setSaveStatus("saving");
      const result = await autosaveOneToOne(sentPayload);
      if (sequence !== saveSequenceRef.current) return;
      if (result.status === "success") {
        lastSavedPayloadRef.current = sentPayload;
        setSavedAt(new Date());
        setSaveStatus(payloadRef.current === sentPayload ? "saved" : "unsaved");
        if (!detail && result.reviewId && window.location.pathname.endsWith("/new")) {
          window.history.replaceState(window.history.state, "", `/one-to-ones/${result.reviewId}`);
        }
        return;
      }
      setSaveStatus("error");
      pushToast({ title: "Autosave failed", description: result.message, variant: "error", persistent: true });
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [detail, editable, payload, pending, pushToast]);

  useEffect(() => {
    if (!editable) return;
    const hasUnsavedChanges = () => payloadRef.current !== lastSavedPayloadRef.current || saveStatus === "saving" || saveStatus === "error";
    const warning = "Your latest 1-1 changes have not been saved. Leave this page anyway?";
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const blockInternalNavigation = (event: MouseEvent) => {
      if (!hasUnsavedChanges() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (!window.confirm(warning)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const blockHistoryNavigation = () => {
      if (hasUnsavedChanges() && !window.confirm(warning)) window.history.go(1);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", blockInternalNavigation, true);
    window.addEventListener("popstate", blockHistoryNavigation);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", blockInternalNavigation, true);
      window.removeEventListener("popstate", blockHistoryNavigation);
    };
  }, [editable, saveStatus]);

  const email = buildFollowUpEmail({
    firstName: managerFirstName,
    weekCommencing: formatDate(weekCommencing),
    positives: [wins.biggestWin ?? "", wins.mostImproved ?? ""],
    developmentAreas: [summary.toImprove ?? ""],
    actions: actions.map((row) => ({ action: row.action, dueDate: row.dueDate ? formatDate(row.dueDate) : null })),
    support: summary.supportNeeded ?? "",
    nextReviewDate: null,
  });

  const gpRag = kpis.available ? foodGpKpi(kpis.foodGpPct, kpis.foodGpTarget).rag : "neutral";
  const labourRag = kpis.available ? labourKpi(kpis.labourPct, kpis.labourTarget).rag : "neutral";
  const saveLabel = saveStatus === "saving"
    ? "Saving changes…"
    : saveStatus === "error"
      ? "Autosave failed — use Save draft"
      : saveStatus === "unsaved"
        ? "Changes waiting to save"
        : saveStatus === "saved" && savedAt
          ? `Saved at ${savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : "Autosave starts when you edit";
  const SaveStateIcon = saveStatus === "saving" ? LoaderCircle : saveStatus === "error" ? AlertTriangle : CheckCircle2;
  const autosaveBusy = saveStatus === "saving";

  return (
    <form action={formAction} className="report-form" onSubmit={() => { explicitSubmitRef.current = true; explicitPayloadRef.current = payloadRef.current; setSaveStatus("saving"); }}>
      <input name="payload" type="hidden" value={payload} />
      <ActionToast errorTitle="1-1 could not be saved" state={state} successTitle="1-1 saved" />
      {editable ? <div className={`one-to-one-save-state one-to-one-save-state--${saveStatus}`} role="status"><span className="one-to-one-save-state__status"><SaveStateIcon aria-hidden="true" className={saveStatus === "saving" ? "one-to-one-save-state__spinner" : undefined} size={16} /><strong>{saveLabel}</strong></span><small>Drafts save automatically after 1.5 seconds of inactivity.</small></div> : null}

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Section 1</p><h2 className="form-section__title">Wins & recognition</h2></div>
        </div>
        <div className="form-grid form-grid--two">
          {winFields.map(([name, label]) => (
            <label className="field" key={name}>
              <span className="field__label">{label}</span>
              <textarea className="field__input" disabled={!editable} onChange={(event) => setWins((current) => ({ ...current, [name]: event.target.value }))} rows={2} value={wins[name] ?? ""} />
            </label>
          ))}
        </div>
      </section>

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Section 2</p><h2 className="form-section__title">KPI dashboard</h2></div>
          <span className="source-chip source-chip--safe"><ShieldCheck aria-hidden="true" size={14} /> Auto from assigned kitchen</span>
        </div>
        <p className="form-section__copy">
          Sales, GP, labour, waste, stock and report status come from the weekly report for the kitchen attached to this manager assignment. They are never re-entered in the 1-1.
        </p>
        {kpis.available ? (
          <div className="kpi-grid">
            <div className="kpi-row"><span>Net sales</span><strong>{formatCurrency(kpis.netSales ?? 0)}</strong>{ragChip("neutral", "reported")}</div>
            <div className="kpi-row"><span>Food GP</span><strong>{kpis.foodGpPct === null ? "—" : `${kpis.foodGpPct}%`}</strong>{ragChip(gpRag, kpis.foodGpTarget === null ? undefined : `target ${kpis.foodGpTarget}%`)}</div>
            <div className="kpi-row"><span>Labour</span><strong>{kpis.labourPct === null ? "—" : `${kpis.labourPct}%`}</strong>{ragChip(labourRag, kpis.labourTarget === null ? undefined : `target ≤ ${kpis.labourTarget}%`)}</div>
            <div className="kpi-row"><span>Waste</span><strong>{formatCurrency(kpis.wasteCost ?? 0)}</strong>{ragChip("neutral", "at cost")}</div>
            <div className="kpi-row"><span>Stock completed</span><strong>{kpis.stockCompleted ? "Yes" : "No"}</strong>{ragChip(kpis.stockCompleted ? "green" : "red")}</div>
            <div className="kpi-row"><span>Weekly report sent</span><strong>{kpis.reportSent ? "Yes" : "No"}</strong>{ragChip(kpis.reportSent ? "green" : "red")}</div>
          </div>
        ) : (
          <div className="privacy-callout">No weekly report snapshot exists yet for this assigned kitchen and week. The operational KPIs will appear automatically once the site report exists.</div>
        )}
        <div className="form-grid form-grid--three">
          <label className="field">
            <span className="field__label">Audit score %</span>
            <input className="field__input" disabled={!editable} inputMode="decimal" max={100} min={0} onChange={(event) => setKpiManual((current) => ({ ...current, auditScore: event.target.value }))} type="number" value={kpiManual.auditScore ?? ""} />
          </label>
          <label className="field">
            <span className="field__label">Compliance</span>
            <select className="field__input" disabled={!editable} onChange={(event) => setKpiManual((current) => ({ ...current, compliance: event.target.value }))} value={kpiManual.compliance ?? ""}>
              <option value="">Not recorded</option>
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="red">Red</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">KPI commentary</span>
            <input className="field__input" disabled={!editable} onChange={(event) => setKpiManual((current) => ({ ...current, commentary: event.target.value }))} value={kpiManual.commentary ?? ""} />
          </label>
        </div>
        {(kpiManual.compliance === "amber" || kpiManual.compliance === "red") && (
          <label className="field">
            <span className="field__label">Compliance issue and corrective action (required for amber or red)</span>
            <textarea className="field__input" disabled={!editable} onChange={(event) => setKpiManual((current) => ({ ...current, complianceAction: event.target.value }))} required rows={2} value={kpiManual.complianceAction ?? ""} />
          </label>
        )}
      </section>

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Section 3</p><h2 className="form-section__title">Operational & leadership review</h2></div>
          {overall !== null && <span className={`score-pill score-pill--${scoreRag(overall)}`}>Overall {overall.toFixed(1)}</span>}
        </div>
        <div className="score-list">
          {scores.map((row, index) => (
            <div className="score-row" key={row.area}>
              <div className="score-row__head">
                <span className="score-row__label">{areaLabels[row.area]}</span>
                <div className="score-row__scale" role="radiogroup" aria-label={`${areaLabels[row.area]} score`}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      aria-pressed={row.score === String(value)}
                      className={`score-dot${row.score === String(value) ? ` score-dot--active score-dot--${scoreRag(value)}` : ""}`}
                      disabled={!editable}
                      key={value}
                      onClick={() => setScores((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, score: item.score === String(value) ? "" : String(value) } : item)))}
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field__label">Evidence</span><input className="field__input" disabled={!editable} onChange={(event) => setScores((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, evidence: event.target.value } : item)))} value={row.evidence} /></label>
                <label className="field">
                  <span className="field__label">Development note{row.score !== "" && Number(row.score) < 3 ? " (required before finalising)" : ""}</span>
                  <input className="field__input" disabled={!editable} onChange={(event) => setScores((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, developmentNote: event.target.value } : item)))} value={row.developmentNote} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Section 4</p><h2 className="form-section__title">Previous open actions</h2></div>
        </div>
        {openActions.length ? (
          <div className="score-list">
            {openActions.map((item) => (
              <div className="carry-row" key={item.id}>
                <div>
                  <div className="carry-row__action">{item.action}</div>
                  <div className="carry-row__meta">{item.owner}{item.dueDate ? ` · due ${formatDate(item.dueDate)}` : ""} · {item.status.replaceAll("_", " ")}</div>
                </div>
                {editable && (
                  <button className="button button--secondary button--compact" disabled={actions.some((row) => row.id === item.id)} onClick={() => carryForward(item)} type="button">
                    {actions.some((row) => row.id === item.id) ? "Included" : "Carry forward"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-inline empty-inline--compact">No open actions — everything from previous reviews is complete.</div>
        )}
      </section>

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Section 5</p><h2 className="form-section__title">Agreed actions for next week</h2></div>
          {editable && <button className="button button--secondary button--compact" disabled={actions.length >= 7} onClick={addAction} type="button"><Plus aria-hidden="true" size={14} /> Add action ({actions.length}/7)</button>}
        </div>
        {actions.map((row, index) => (
          <div className={`action-editor${index < 5 ? " action-editor--priority" : ""}`} key={row.id}>
            <div className="form-grid form-grid--three">
              <label className="field"><span className="field__label">Action</span><input className="field__input" disabled={!editable} onChange={(event) => updateAction(index, { action: event.target.value })} value={row.action} /></label>
              <label className="field"><span className="field__label">Success measure</span><input className="field__input" disabled={!editable} onChange={(event) => updateAction(index, { successMeasure: event.target.value })} value={row.successMeasure} /></label>
              <label className="field"><span className="field__label">Owner</span><input className="field__input" disabled={!editable} onChange={(event) => updateAction(index, { owner: event.target.value })} value={row.owner} /></label>
            </div>
            <div className="form-grid form-grid--three">
              <label className="field"><span className="field__label">Priority</span>
                <select className="field__input" disabled={!editable} onChange={(event) => updateAction(index, { priority: event.target.value as ActionRow["priority"] })} value={row.priority}>
                  <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </label>
              <label className="field"><span className="field__label">Due date</span><input className="field__input" disabled={!editable} onChange={(event) => updateAction(index, { dueDate: event.target.value })} type="date" value={row.dueDate} /></label>
              <label className="field"><span className="field__label">Status</span>
                <select className="field__input" disabled={!editable} onChange={(event) => updateAction(index, { status: event.target.value as ActionRow["status"] })} value={row.status}>
                  <option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
            {editable && (
              <button aria-label={`Remove action ${index + 1}`} className="icon-button action-editor__remove" onClick={() => setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 aria-hidden="true" size={16} /></button>
            )}
          </div>
        ))}
        {!actions.length && <div className="empty-inline empty-inline--compact">Carry forward open items or add up to seven new actions. The first five are the week&apos;s priorities.</div>}
      </section>

      <section className="form-section">
        <div className="form-section__heading">
          <div><p className="form-section__step">Section 6</p><h2 className="form-section__title">Coaching & summary</h2></div>
        </div>
        <div className="form-grid form-grid--two">
          {summaryFields.map(([name, label]) => (
            <label className="field" key={name}>
              <span className="field__label">{label}</span>
              <textarea className="field__input" disabled={!editable} onChange={(event) => setSummary((current) => ({ ...current, [name]: event.target.value }))} rows={2} value={summary[name] ?? ""} />
            </label>
          ))}
          <label className="field">
            <span className="field__label">Review date</span>
            <input className="field__input" disabled={!editable} onChange={(event) => setReviewDate(event.target.value)} type="date" value={reviewDate} />
          </label>
        </div>
      </section>

      {(detail?.status === "finalised" || detail?.status === "acknowledged") && (
        <section className="form-section">
          <div className="form-section__heading">
            <div><p className="form-section__step">Follow-up</p><h2 className="form-section__title">Email summary</h2></div>
            <button className="button button--secondary button--compact" onClick={() => void navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`)} type="button"><Copy aria-hidden="true" size={14} /> Copy email</button>
          </div>
          <pre className="email-preview">{email.subject}{"\n\n"}{email.body}</pre>
        </section>
      )}

      {state.status !== "idle" && (
        <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">
          {state.status === "success" && <CheckCircle2 aria-hidden="true" size={15} />}{state.message}
        </div>
      )}

      {editable && (
        <div className="form-actions form-actions--sticky">
          <div aria-label="Overall score" className="form-checklist">
            <span className="form-checklist__item form-checklist__item--done">{managerName} · w/c {formatDate(weekCommencing)}</span>
            {overall !== null && <span className="form-checklist__item form-checklist__item--done">Overall {overall.toFixed(1)}</span>}
          </div>
          <button className="button button--secondary" disabled={pending || autosaveBusy} name="intent" type="submit" value="save"><Save aria-hidden="true" size={16} /> {pending ? "Saving…" : "Save draft"}</button>
          <button className="button button--primary" disabled={pending || autosaveBusy} name="intent" type="submit" value="finalise"><ShieldCheck aria-hidden="true" size={16} /> {pending ? "Saving…" : "Finalise, lock & send"}</button>
        </div>
      )}
    </form>
  );
}

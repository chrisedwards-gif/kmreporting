import Link from "next/link";
import { ArrowRight, BrainCircuit, CheckCircle2, Download, FileCheck2, FolderUp, Gauge, TriangleAlert } from "lucide-react";
import type { SessionProfile } from "@/lib/auth/dal";
import type { ReportingBundle } from "@/lib/data/reporting";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import styles from "./group-chef-control-centre.module.css";

type ControlStep = {
  title: string;
  status: string;
  copy: string;
  href: string;
  action: string;
  tone: "ready" | "attention" | "neutral";
};

export async function GroupChefControlCentre({ profile, bundle }: { profile: SessionProfile; bundle: ReportingBundle }) {
  const submittedSiteIds = new Set(bundle.reports.filter((report) => report.status !== "draft").map((report) => report.siteId));
  const submittedCount = submittedSiteIds.size;
  const missingSites = bundle.expectedSites.filter((site) => !submittedSiteIds.has(site.id));

  const supabase = await createServerSupabaseClient();
  const [batchResult, reconciliationResult] = supabase
    ? await Promise.all([
      supabase
        .from("weekly_upload_batches")
        .select("id, status")
        .eq("organisation_id", profile.organisationId)
        .eq("week_start", bundle.week.start)
        .eq("batch_kind", "group")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("weekly_reconciliations")
        .select("status")
        .eq("organisation_id", profile.organisationId)
        .eq("week_start", bundle.week.start),
    ])
    : [{ data: null }, { data: [] }];

  const masterReady = batchResult.data?.status === "ready";
  const reconciliationRows = reconciliationResult.data ?? [];
  const reconciliationWarnings = reconciliationRows.filter((row) => row.status !== "match").length;
  const reconciliationMatches = reconciliationRows.filter((row) => row.status === "match").length;
  const allKitchensSubmitted = bundle.expectedSiteCount > 0 && submittedCount >= bundle.expectedSiteCount;

  const nextAction = !allKitchensSubmitted
    ? `Wait for ${Math.max(bundle.expectedSiteCount - submittedCount, 0)} kitchen${bundle.expectedSiteCount - submittedCount === 1 ? "" : "s"} to submit, then upload your independent master pack.`
    : !masterReady
      ? "Upload the Group Master Pack — four core exports per kitchen."
      : reconciliationWarnings > 0
        ? `Review ${reconciliationWarnings} reconciliation exception${reconciliationWarnings === 1 ? "" : "s"} before trusting the week.`
        : "Open Decision Desk, review the ranked opportunities, then download the AI review pack for ChatGPT.";

  const steps: ControlStep[] = [
    {
      title: "KM submissions",
      status: `${submittedCount}/${bundle.expectedSiteCount} submitted`,
      copy: "Check every kitchen has completed its weekly report before you use the group cross-check.",
      href: "/reports",
      action: "Review reports",
      tone: allKitchensSubmitted ? "ready" : "attention",
    },
    {
      title: "Master pack",
      status: masterReady ? "Uploaded" : "Needed",
      copy: "Upload Access/StockLink sales, Procure Wizard goods + credits and RotaCloud labour for every kitchen.",
      href: `/reports/group?week=${bundle.week.start}`,
      action: masterReady ? "View master pack" : "Upload master pack",
      tone: masterReady ? "ready" : "attention",
    },
    {
      title: "Reconciliation",
      status: masterReady ? `${reconciliationMatches} match · ${reconciliationWarnings} exceptions` : "Waiting for master pack",
      copy: "The platform compares KM-entered source totals with your independent management exports.",
      href: `/reports/group?week=${bundle.week.start}`,
      action: "Check reconciliation",
      tone: masterReady && reconciliationWarnings === 0 ? "ready" : masterReady ? "attention" : "neutral",
    },
    {
      title: "Decision Desk",
      status: masterReady ? "Ready to review" : "Building evidence",
      copy: "Rank sales, labour, menu, cost and data-quality opportunities using the reconciled history.",
      href: "/intelligence",
      action: "Open Decision Desk",
      tone: masterReady ? "ready" : "neutral",
    },
    {
      title: "AI review pack",
      status: "Group Chef only",
      copy: "Download the rich Markdown export and upload it into ChatGPT while we refine the future in-app AI layer.",
      href: `/api/intelligence/export?week=${bundle.week.start}`,
      action: "Download AI review pack",
      tone: masterReady ? "ready" : "neutral",
    },
  ];

  const icons = [FileCheck2, FolderUp, Gauge, BrainCircuit, Download];

  return (
    <section aria-label="Group Chef weekly control centre" className={`panel ${styles["group-control"]}`}>
      <div className={`panel__header ${styles["group-control__header"]}`}>
        <div>
          <p className="page-header__eyebrow">Your weekly workflow</p>
          <h2 className="panel__title">Weekly control centre.</h2>
          <p className="panel__subtitle">Week commencing {formatDate(bundle.week.start)} · one place to see what is done, what is missing and what you should do next.</p>
        </div>
        <span className="source-chip source-chip--safe"><CheckCircle2 aria-hidden="true" size={14} /> Group Chef workspace</span>
      </div>
      <div className="panel__body">
        <div className={styles["group-control__next"]}>
          <div className={styles["group-control__next-copy"]}>
            <span>Next action</span>
            <strong>{nextAction}</strong>
            {missingSites.length ? <div className={styles["group-control__missing"]}>Missing: {missingSites.map((site) => site.name).join(", ")}</div> : null}
          </div>
          <Link className="button button--primary" href={!allKitchensSubmitted ? "/reports" : !masterReady || reconciliationWarnings > 0 ? `/reports/group?week=${bundle.week.start}` : "/intelligence"}>
            Go to next step <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>

        <div className={styles["group-control__steps"]}>
          {steps.map((step, index) => {
            const Icon = icons[index];
            return (
              <Link className={`${styles["group-control__step"]} ${styles[`group-control__step--${step.tone}`] ?? ""}`} href={step.href} key={step.title}>
                <div className={styles["group-control__step-top"]}>
                  <span className={styles["group-control__step-number"]}>{index + 1}</span>
                  <span className={styles["group-control__step-status"]}>{step.status}</span>
                </div>
                <Icon aria-hidden="true" size={19} />
                <div className={styles["group-control__step-title"]}>{step.title}</div>
                <div className={styles["group-control__step-copy"]}>{step.copy}</div>
                <span className={styles["group-control__step-action"]}>{step.action} <ArrowRight aria-hidden="true" size={13} /></span>
              </Link>
            );
          })}
        </div>
        {reconciliationWarnings > 0 ? <div className="form-message form-message--error" style={{ marginTop: "1rem" }}><TriangleAlert aria-hidden="true" size={15} /> {reconciliationWarnings} independent source check{reconciliationWarnings === 1 ? "" : "s"} need review before using the numbers as trusted management data.</div> : null}
      </div>
    </section>
  );
}

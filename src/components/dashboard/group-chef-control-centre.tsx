import Link from "next/link";
import { ArrowRight, BrainCircuit, CheckCircle2, Download, FileCheck2, FolderUp, Gauge, TriangleAlert, type LucideIcon } from "lucide-react";
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
  icon: LucideIcon;
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
  const reconciliationMatches = reconciliationRows.filter((row) => row.status === "match").length;
  const awaitingKmChecks = reconciliationRows.filter((row) => row.status === "missing_site").length;
  const reviewIssues = reconciliationRows.filter((row) => row.status === "warning" || row.status === "missing_master").length;
  const allKitchensSubmitted = bundle.expectedSiteCount > 0 && submittedCount >= bundle.expectedSiteCount;
  const kitchensRemaining = Math.max(bundle.expectedSiteCount - submittedCount, 0);

  const nextAction = !masterReady
    ? "Download the four named source reports, then upload your HOS-wide master exports once. KMs submit their own reports separately."
    : !allKitchensSubmitted
      ? `${kitchensRemaining} KM submission${kitchensRemaining === 1 ? " is" : "s are"} still outstanding. Your master data is already loaded and reconciliation will refresh as they submit.`
      : reviewIssues > 0
        ? `Review ${reviewIssues} genuine reconciliation issue${reviewIssues === 1 ? "" : "s"} before trusting the week.`
        : "The week is reconciled. Open Decision Desk, review the ranked opportunities, then download the AI review pack.";

  const steps: ControlStep[] = [
    {
      title: "Your HOS master exports",
      status: masterReady ? "Uploaded once" : "Upload once",
      copy: "Download: StockLink End Of Week Report, Procure Wizard Goods Purchased, Procure Wizard Credits Overview and RotaCloud Daily Totals. Use All Sites / All Locations where available.",
      href: `/reports/group?week=${bundle.week.start}`,
      action: masterReady ? "View master pack" : "See download checklist",
      tone: masterReady ? "ready" : "attention",
      icon: FolderUp,
    },
    {
      title: "KM submissions",
      status: `${submittedCount}/${bundle.expectedSiteCount} submitted`,
      copy: "KMs independently download the same four named source reports for their kitchen, upload them, then add the operational context you do not need to enter for them.",
      href: "/reports",
      action: "Review KM status",
      tone: allKitchensSubmitted ? "ready" : "neutral",
      icon: FileCheck2,
    },
    {
      title: "Reconciliation",
      status: !masterReady ? "Waiting for your master" : `${reconciliationMatches} match · ${awaitingKmChecks} awaiting KM · ${reviewIssues} review`,
      copy: "As KM reports arrive, their figures are automatically checked against your independent HOS-wide source data.",
      href: `/reports/group?week=${bundle.week.start}`,
      action: "Check reconciliation",
      tone: !masterReady ? "neutral" : reviewIssues > 0 ? "attention" : allKitchensSubmitted ? "ready" : "neutral",
      icon: Gauge,
    },
    {
      title: "Decision Desk",
      status: masterReady && allKitchensSubmitted && reviewIssues === 0 ? "Ready to review" : "Building evidence",
      copy: "Rank sales, labour, menu, cost and data-quality opportunities once the weekly evidence is complete enough to trust.",
      href: "/intelligence",
      action: "Open Decision Desk",
      tone: masterReady && allKitchensSubmitted && reviewIssues === 0 ? "ready" : "neutral",
      icon: BrainCircuit,
    },
    {
      title: "AI review pack",
      status: "Group Chef only",
      copy: "Download the rich Markdown export and upload it into ChatGPT while we refine the future in-app AI layer.",
      href: `/api/intelligence/export?week=${bundle.week.start}`,
      action: "Download AI review pack",
      tone: masterReady && allKitchensSubmitted && reviewIssues === 0 ? "ready" : "neutral",
      icon: Download,
    },
  ];

  const nextHref = !masterReady
    ? `/reports/group?week=${bundle.week.start}`
    : !allKitchensSubmitted
      ? "/reports"
      : reviewIssues > 0
        ? `/reports/group?week=${bundle.week.start}`
        : "/intelligence";

  return (
    <section aria-label="Group Chef weekly control centre" className={`panel ${styles["group-control"]}`}>
      <div className={`panel__header ${styles["group-control__header"]}`}>
        <div>
          <p className="page-header__eyebrow">Your weekly workflow</p>
          <h2 className="panel__title">Weekly control centre.</h2>
          <p className="panel__subtitle">Week commencing {formatDate(bundle.week.start)} · your group exports and the KM submissions are two independent sides of the same weekly check.</p>
        </div>
        <span className="source-chip source-chip--safe"><CheckCircle2 aria-hidden="true" size={14} /> Group Chef workspace</span>
      </div>
      <div className="panel__body">
        <div className={styles["group-control__next"]}>
          <div className={styles["group-control__next-copy"]}>
            <span>Next action</span>
            <strong>{nextAction}</strong>
            {missingSites.length ? <div className={styles["group-control__missing"]}>KM reports still missing: {missingSites.map((site) => site.name).join(", ")}</div> : null}
          </div>
          <Link className="button button--primary" href={nextHref}>
            Go to next step <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>

        <div className={styles["group-control__steps"]}>
          {steps.map((step, index) => {
            const Icon = step.icon;
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
        {reviewIssues > 0 ? <div className="form-message form-message--error" style={{ marginTop: "1rem" }}><TriangleAlert aria-hidden="true" size={15} /> {reviewIssues} independent source check{reviewIssues === 1 ? "" : "s"} genuinely disagree or are missing from your master data and need review.</div> : null}
      </div>
    </section>
  );
}

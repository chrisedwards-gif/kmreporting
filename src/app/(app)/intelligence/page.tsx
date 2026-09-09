import Link from "next/link";
import { BrainCircuit, Download, FileUp, Gauge, ShoppingBasket, TimerReset } from "lucide-react";
import { MenuCostUploader } from "@/components/intelligence/menu-cost-uploader";
import { PowerhouseDecisionDesk } from "@/components/intelligence/powerhouse-decision-desk";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getPowerhouseIntelligence } from "@/lib/data/powerhouse-intelligence";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Decision desk" };

export default async function IntelligencePage() {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const [intelligence, supabase] = await Promise.all([
    getPowerhouseIntelligence(profile),
    createServerSupabaseClient(),
  ]);
  const { data: sites = [] } = supabase
    ? await supabase.from("sites").select("id, name").eq("organisation_id", profile.organisationId).eq("active", true).order("name")
    : { data: [] };
  const weekStart = intelligence.weekStart ?? "";
  const hasMenuCosts = intelligence.dataCoverage.menuCostRows > 0;
  const hasHourlySales = intelligence.dataCoverage.hourlySalesRows > 0;
  const hasHourlyLabour = intelligence.dataCoverage.hourlyLabourRows > 0;
  const hasMasterChecks = intelligence.dataCoverage.reconciliationRows > 0;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Group Chef · decision intelligence</p>
          <h1 className="page-header__title">Decision desk.</h1>
          <p className="page-header__copy">The weekly data is converted into ranked commercial decisions, with evidence, confidence and measurable next actions. The maths runs without AI.</p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" href="/reports/group"><FileUp aria-hidden="true" size={16} /> Upload master pack</Link>
          <a className="button button--primary" href={weekStart ? `/api/intelligence/export?week=${weekStart}` : "/api/intelligence/export"}><Download aria-hidden="true" size={16} /> Download AI review pack</a>
        </div>
      </header>

      {weekStart ? <div className="privacy-callout intelligence-week-note"><BrainCircuit aria-hidden="true" className="privacy-callout__icon" size={16} />Latest intelligence week commencing {formatDate(weekStart)}. Recommendations remain traceable to uploaded source data and do not overwrite the weekly report.</div> : null}

      <PowerhouseDecisionDesk intelligence={intelligence} />

      <section className="intelligence-unlocks" aria-label="Decision engine data coverage">
        <article className={`intelligence-unlock${hasMasterChecks ? " intelligence-unlock--ready" : ""}`}>
          <Gauge aria-hidden="true" size={20} />
          <div><strong>Independent cross-check</strong><span>{hasMasterChecks ? `${intelligence.dataCoverage.reconciliationRows} master comparisons loaded` : "Upload the Group Master Pack to reconcile KM figures before acting."}</span></div>
        </article>
        <article className={`intelligence-unlock${hasMenuCosts ? " intelligence-unlock--ready" : ""}`}>
          <ShoppingBasket aria-hidden="true" size={20} />
          <div><strong>Menu contribution margin</strong><span>{hasMenuCosts ? `${intelligence.dataCoverage.menuCostRows} active item costs loaded` : "Add recipe/portion cost to unlock stars, workhorses, puzzles and removal candidates."}</span></div>
        </article>
        <article className={`intelligence-unlock${hasHourlySales && hasHourlyLabour ? " intelligence-unlock--ready" : ""}`}>
          <TimerReset aria-hidden="true" size={20} />
          <div><strong>Exact staffing windows</strong><span>{hasHourlySales && hasHourlyLabour ? `${intelligence.dataCoverage.hourlySalesRows} EPOS + ${intelligence.dataCoverage.hourlyLabourRows} labour rows available` : hasHourlySales ? "Hourly EPOS is ready; upload a detailed RotaCloud shift export to add exact labour coverage." : "Hourly EPOS and detailed RotaCloud data will unlock shift-window recommendations."}</span></div>
        </article>
      </section>

      {sites?.length ? <MenuCostUploader sites={sites} /> : null}

      <section className="panel intelligence-method" style={{ marginTop: "1rem" }}>
        <div className="panel__header"><div><h2 className="panel__title">How the machine decides</h2><p className="panel__subtitle">Strong conclusions need repeated evidence. Weak samples are labelled as tests or reviews, not facts.</p></div></div>
        <div className="panel__body intelligence-method__grid">
          <div><strong>1. Validate</strong><span>Site upload, master upload and source dates must agree before important numbers are trusted.</span></div>
          <div><strong>2. Compare</strong><span>Current week is tested against recent weeks, product history, dayparts, targets and other available source evidence.</span></div>
          <div><strong>3. Quantify</strong><span>Where possible the engine translates a gap or test into indicative weekly £ value.</span></div>
          <div><strong>4. Act & measure</strong><span>Accepting a recommendation creates an Action Log item with its baseline and success measure.</span></div>
        </div>
      </section>
    </>
  );
}

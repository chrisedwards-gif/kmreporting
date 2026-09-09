import { CheckCircle2, Download, FileSpreadsheet, Info, TriangleAlert } from "lucide-react";
import styles from "./weekly-source-checklist.module.css";

type Audience = "group" | "kitchen";

type SourceInstruction = {
  system: string;
  report: string;
  path: string;
  format: string;
  kitchenFilters: string;
  groupFilters: string;
  purpose: string;
};

const requiredSources: SourceInstruction[] = [
  {
    system: "Access / StockLink",
    report: "End Of Week Report",
    path: "Sales Reports → End Of Week Report",
    format: "HTML / HTM",
    kitchenFilters: "Select this kitchen and the exact Sunday–Saturday reporting week.",
    groupFilters: "Download one End Of Week Report per kitchen. If you already have a safe HOS-wide sales CSV containing Site/Location + Net Sales, you can upload that instead.",
    purpose: "Net sales, gross sales, VAT/service charge and richer daily / item / category sales detail.",
  },
  {
    system: "Procure Wizard",
    report: "Goods Purchased",
    path: "Reporting → Goods Purchased",
    format: "CSV",
    kitchenFilters: "Date Type = Date Delivered · Category = Food · Site = this kitchen · exact reporting week.",
    groupFilters: "Date Type = Date Delivered · Category = Food · Site = All Sites · exact reporting week.",
    purpose: "Food purchases and Awaiting Invoice value.",
  },
  {
    system: "Procure Wizard",
    report: "Credits Overview",
    path: "Reporting → Credits Overview",
    format: "CSV",
    kitchenFilters: "Site = this kitchen · exact reporting week · include all credit statuses.",
    groupFilters: "Site = All Sites · exact reporting week · include all credit statuses.",
    purpose: "Confirmed credits plus pending / investigation credits.",
  },
  {
    system: "RotaCloud",
    report: "Daily Totals",
    path: "Reports → Hours & Costs → Daily Totals",
    format: "CSV",
    kitchenFilters: "Location = this kitchen · exact reporting week · keep hours and costs visible.",
    groupFilters: "Location = All Locations · exact reporting week · keep hours and costs visible.",
    purpose: "Weekly wage cost and paid hours by kitchen.",
  },
];

export function WeeklySourceChecklist({ audience }: { audience: Audience }) {
  const group = audience === "group";

  return (
    <section aria-label="Weekly report download checklist" className={styles["source-checklist"]}>
      <div className={styles["source-checklist__header"]}>
        <div>
          <p className={styles["source-checklist__eyebrow"]}><Download aria-hidden="true" size={14} /> Download these reports first</p>
          <h3>{group ? "Group Chef weekly downloads" : "Kitchen Manager weekly downloads"}</h3>
          <p>{group
            ? "Use All Sites / All Locations wherever the system allows it. Upload the resulting HOS-wide files once; the app splits them by kitchen automatically."
            : "Use only your kitchen and the exact Sunday–Saturday week. Download these four reports, then drop them into the uploader together."}</p>
        </div>
        <span className={styles["source-checklist__required-count"]}>4 required</span>
      </div>

      <div className={styles["source-checklist__grid"]}>
        {requiredSources.map((source, index) => (
          <article className={styles["source-checklist__item"]} key={`${source.system}-${source.report}`}>
            <div className={styles["source-checklist__item-top"]}>
              <span className={styles["source-checklist__number"]}>{index + 1}</span>
              <div>
                <span className={styles["source-checklist__system"]}>{source.system}</span>
                <strong>{source.report}</strong>
              </div>
              <span className={styles["source-checklist__format"]}>{source.format}</span>
            </div>
            <div className={styles["source-checklist__path"]}><FileSpreadsheet aria-hidden="true" size={14} /><strong>Click:</strong> {source.path}</div>
            <div className={styles["source-checklist__filters"]}><CheckCircle2 aria-hidden="true" size={14} /><strong>Set:</strong> {group ? source.groupFilters : source.kitchenFilters}</div>
            <small><strong>Why:</strong> {source.purpose}</small>
          </article>
        ))}
      </div>

      <div className={styles["source-checklist__warning"]}>
        <TriangleAlert aria-hidden="true" size={16} />
        <div><strong>Access / StockLink: use End Of Week Report for the core upload.</strong><span>Do not substitute Sales Summary Report, PLU Sales Report, End Of Day Report or End Of Session Report — they are not the core StockLink report this workflow validates.</span></div>
      </div>

      <div className={styles["source-checklist__optional"]}>
        <Info aria-hidden="true" size={15} />
        <div><strong>Optional supporting files</strong><span>Stocktake, waste and detailed RotaCloud shift exports can be added when available. They are useful evidence, but they do not replace the four required reports above.</span></div>
      </div>
    </section>
  );
}

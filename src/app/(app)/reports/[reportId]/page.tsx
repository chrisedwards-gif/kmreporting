import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileCheck2, LockKeyhole, Pencil, ShieldAlert } from "lucide-react";
import { ApprovalForm } from "@/components/reports/approval-form";
import { SalesInsightUpload } from "@/components/reports/sales-insight-upload";
import { SalesInsightsPanel } from "@/components/reports/sales-insights-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSessionProfile } from "@/lib/auth/dal";
import { getScopedReportingBundle } from "@/lib/data/scoped-reporting";
import { getReportSalesInsights } from "@/lib/data/sales-insights";
import { formatCurrency, formatDate, formatPercentage } from "@/lib/utils";

export const metadata = { title: "Report review" };

const sourceLabel = (value?: string) => ({
  stocklink_upload: "StockLink upload",
  stocklink_adjusted: "StockLink + manual adjustment",
  procure_wizard_upload: "Procure Wizard upload",
  procure_wizard_adjusted: "Procure Wizard + manual adjustment",
  rotacloud_upload: "RotaCloud upload",
  rotacloud_adjusted: "RotaCloud + manual adjustment",
  private_payroll: "Private payroll integration",
  provider_api: "Provider API",
  labour_unavailable: "Labour cost unavailable",
  manual: "Manager-entered total",
}[value ?? ""] ?? "Recorded source");

export default async function ReportDetailPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const profile = await getSessionProfile();
  if (!profile) notFound();
  const { reports } = await getScopedReportingBundle(profile, undefined, reportId);
  const report = reports.find((item) => item.id === reportId);
  if (!report) notFound();
  const salesInsights = await getReportSalesInsights({ reportId: report.id, siteId: report.siteId, weekStart: report.weekStart });
  const actionableFlags = report.costs.flags.filter((flag) => flag.severity !== "info");
  const canEditDraft = profile.capabilities.editReports;
  const canUploadSales = canEditDraft && ["draft", "submitted", "review_required"].includes(report.status);
  const canApprove = profile.capabilities.approveReports;

  const narrative = [
    ["Wins & guest feedback", report.wins],
    ["Operational issues", report.operationalIssues],
    ["Staffing issues", report.staffingIssues],
    ["Compliance issues", report.complianceIssues],
    ["Equipment issues", report.equipmentIssues],
    ["Actions underway", report.actionsUnderway],
    ["Support needed", report.supportNeeded],
  ].filter(([, value]) => value);

  return (
    <>
      <header className="page-header">
        <div><p className="page-header__eyebrow">{report.costs.code} · Week ending {formatDate(report.weekEnd)}</p><h1 className="page-header__title">{report.siteName}</h1><p className="page-header__copy">Submitted by {report.manager}. Financial outputs are current safe aggregates; no pay rates or raw EPOS transactions are retained.</p></div>
        <div className="page-header__actions"><Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> Reports</Link>{report.status === "draft" && canEditDraft ? <Link className="button button--primary" href={`/reports/new?report=${report.id}`}><Pencil aria-hidden="true" size={16} /> Continue draft</Link> : null}</div>
      </header>

      {profile.isAccessPreview ? <div className="privacy-callout" style={{ marginBottom: "1rem" }}>Admin site mode for {profile.previewSiteName}. This report has passed the central kitchen-scope boundary and full Admin controls remain available.</div> : null}

      <section className="sales-report-section">
        <div className="sales-report-section__heading"><div><p className="page-header__eyebrow">Commercial performance</p><h2>Sales insight.</h2><p>Daily trade, transaction value, covers and menu mix for the reporting week.</p></div></div>
        <SalesInsightsPanel insights={salesInsights} />
        {canUploadSales ? <SalesInsightUpload reportId={report.id} savedNetSales={report.costs.netSales} siteName={report.siteName} weekEnd={report.weekEnd} weekStart={report.weekStart} /> : null}
      </section>

      <div className="report-detail-grid">
        <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Management update</h2><p className="panel__subtitle">Manager narrative preserved as submitted</p></div><StatusBadge status={report.status} /></div><div className="narrative-grid">{narrative.map(([label, value]) => <article className="narrative-item" key={label}><h3>{label}</h3><p>{value}</p></article>)}</div></section>

        <aside className="stack">
          <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Cost summary</h2><p className="panel__subtitle">Calculated from source data</p></div><LockKeyhole aria-hidden="true" color="#2d7a62" size={18} /></div><div className="panel__body"><div className="cost-summary"><div className="cost-summary__row"><span className="cost-summary__label">Net sales</span><span className="cost-summary__value">{formatCurrency(report.costs.netSales)}</span></div><div className="cost-summary__row"><span className="cost-summary__label">{report.costs.foodCostBasis === "stock_adjusted" ? "Stock-adjusted food cost" : "Food spend (not stock-adjusted)"}</span><span className="cost-summary__value">{formatCurrency(report.costs.cogs)} · {formatPercentage(report.costs.foodCostPct)}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Staff cost</span><span className="cost-summary__value">{report.sources?.labour === "labour_unavailable" ? "N/A · awaiting access" : `${formatCurrency(report.costs.staffCost)} · ${formatPercentage(report.costs.labourPct)}`}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Prime cost</span><span className="cost-summary__value">{report.sources?.labour === "labour_unavailable" ? "N/A until labour is available" : `${formatCurrency(report.costs.primeCost)} · ${formatPercentage(report.costs.primeCostPct)}`}</span></div></div><div className="privacy-callout" style={{ marginTop: "1rem" }}>Salary and hourly-rate records stay inside the private database schema. This report only stores the resulting site total.</div></div></section>

          {report.sources ? <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Source evidence</h2><p className="panel__subtitle">Safe totals and fingerprints only; raw files are not retained</p></div><FileCheck2 aria-hidden="true" color="#2d7a62" size={18} /></div><div className="panel__body"><div className="cost-summary"><div className="cost-summary__row"><span className="cost-summary__label">Sales</span><span className="cost-summary__value">{sourceLabel(report.sources.sales)}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Food spend</span><span className="cost-summary__value">{sourceLabel(report.sources.purchasing)}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Labour</span><span className="cost-summary__value">{sourceLabel(report.sources.labour)}</span></div><div className="cost-summary__row"><span className="cost-summary__label">Stock basis</span><span className="cost-summary__value">{report.sources.stocktakeCompleted ? "Opening + closing stocktake" : "Spend only"}</span></div>{report.sources.awaitingInvoice > 0 ? <div className="cost-summary__row"><span className="cost-summary__label">Awaiting invoice</span><span className="cost-summary__value">{formatCurrency(report.sources.awaitingInvoice)}</span></div> : null}{report.sources.pendingCredits > 0 ? <div className="cost-summary__row"><span className="cost-summary__label">Pending supplier credit</span><span className="cost-summary__value">{formatCurrency(report.sources.pendingCredits)}</span></div> : null}{report.manualPurchases?.map((item, index) => <div className="cost-summary__row" key={`${item.description}-${index}`}><span className="cost-summary__label">Off-system: {item.description}{item.receiptReference ? ` · ${item.receiptReference}` : ""}</span><span className="cost-summary__value">{formatCurrency(item.amount)}</span></div>)}</div></div></section> : null}

          <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Approval gates</h2><p className="panel__subtitle">All must clear before sharing</p></div><ShieldAlert aria-hidden="true" color="#c78324" size={18} /></div><div className="panel__body">{report.costs.flags.length ? <div className="review-list">{report.costs.flags.map((flag) => <div className={`review-item review-item--${flag.severity}`} key={flag.code}><div className="review-item__label">{flag.label}</div><div className="review-item__detail">{flag.detail}</div></div>)}</div> : <div className="privacy-callout"><CheckCircle2 aria-hidden="true" className="privacy-callout__icon" size={15} />All automated checks have passed.</div>}</div></section>
          {canApprove && ["submitted", "review_required", "approved", "shared"].includes(report.status) ? <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Management decision</h2><p className="panel__subtitle">Named, timestamped and added to the audit trail</p></div></div><div className="panel__body"><ApprovalForm hasFlags={actionableFlags.length > 0} reportId={report.id} status={report.status} /></div></section> : null}
          {canApprove && report.status === "draft" ? <div className="privacy-callout">This report is still a draft. It must be submitted before management can approve it.</div> : null}
        </aside>
      </div>
    </>
  );
}

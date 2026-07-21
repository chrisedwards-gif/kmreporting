import { PdfPageCanvas, wrapText } from "@/lib/pdf/simple-pdf";
import { formatCurrency, formatDate, formatPercentage, variance, type ManagementPackInput, type SiteView } from "@/lib/pdf/management-pack-data";
import { CONTENT_WIDTH, PAGE_BOTTOM, PAGE_MARGIN, PALETTE, drawBullets, drawCard, drawHeader, drawMetricCard, drawSectionTitle } from "@/lib/pdf/management-pack-theme";

export const drawSitePages = (input: ManagementPackInput, report: SiteView) => {
  const pages: PdfPageCanvas[] = [];
  let page = new PdfPageCanvas();
  let top = 116;
  const newPage = (continued: boolean) => {
    page = new PdfPageCanvas();
    pages.push(page);
    drawHeader(page, {
      title: report.siteName,
      subtitle: `${report.manager}  /  Week ending ${formatDate(input.week.end)}${continued ? "  /  Continued" : ""}`,
      rightTop: report.code,
      rightMain: continued ? "Site detail" : "Kitchen report",
      status: report.openControls ? "Review required" : "On track",
      tone: report.openControls ? "watch" : "good",
    });
    top = 116;
  };
  newPage(false);

  const gap = 8;
  const metricWidth = (CONTENT_WIDTH - gap * 3) / 4;
  drawMetricCard(page, PAGE_MARGIN, top, metricWidth, "Net sales", formatCurrency(report.netSales), "Approved weekly total");
  drawMetricCard(page, PAGE_MARGIN + metricWidth + gap, top, metricWidth, "Prime cost", formatPercentage(report.primeCostPct), `${formatCurrency(report.cogs + report.staffCost)}  /  target ${formatPercentage(report.foodTarget + report.labourTarget)}`, variance(report.primeCostPct, report.foodTarget + report.labourTarget));
  drawMetricCard(page, PAGE_MARGIN + 2 * (metricWidth + gap), top, metricWidth, report.foodLabel, formatPercentage(report.foodCostPct), `${formatCurrency(report.cogs)}  /  target ${formatPercentage(report.foodTarget)}`, variance(report.foodCostPct, report.foodTarget));
  drawMetricCard(page, PAGE_MARGIN + 3 * (metricWidth + gap), top, metricWidth, "Labour", formatPercentage(report.labourPct), `${formatCurrency(report.staffCost)}  /  target ${formatPercentage(report.labourTarget)}`, variance(report.labourPct, report.labourTarget));
  top += 110;

  top = drawSectionTitle(page, "Control position", top, "Financial and compliance controls");
  const salaryLoaded = report.salaryStaffCost + report.salaryOncostCost;
  const labourMix = report.salariesIncluded
    ? `${formatCurrency(report.hourlyStaffCost)} rota + ${formatCurrency(salaryLoaded)} salary`
    : `${formatCurrency(report.hourlyStaffCost)} hourly / rota only`;
  const controlCells = [
    ["Waste", `${formatPercentage(report.wastePct)} / ${formatCurrency(report.wasteCost)}`],
    ["Labour mix", labourMix],
    ["Stocktake", report.stocktakeCompleted ? "Complete" : "Not complete"],
    ["Pending credits", formatCurrency(report.pendingCredits)],
    ["Awaiting invoice", formatCurrency(report.awaitingInvoice)],
    ["Manual purchases", `${formatCurrency(report.manualPurchases)}${report.manualPurchaseCount ? ` / ${report.manualPurchaseCount} item${report.manualPurchaseCount === 1 ? "" : "s"}` : ""}`],
  ];
  const controlWidth = CONTENT_WIDTH / controlCells.length;
  page.rectangle(PAGE_MARGIN, top, CONTENT_WIDTH, 58, { fill: PALETTE.panel, stroke: PALETTE.line, strokeWidth: 0.6 });
  controlCells.forEach(([label, value], index) => {
    const x = PAGE_MARGIN + index * controlWidth;
    if (index) page.line(x, top, x, top + 58, { stroke: PALETTE.line, strokeWidth: 0.5 });
    page.text(label.toUpperCase(), x + 7, top + 10, { size: 5.8, font: "F2", fill: PALETTE.muted });
    page.textBlock(value, x + 7, top + 25, controlWidth - 14, { size: 7.2, font: "F2", fill: PALETTE.ink, lineHeight: 8.5, maxLines: 3, ellipsis: true });
  });
  top += 76;

  if (report.controls.length) {
    const controlHeight = 42 + report.controls.reduce((height, item) => height + wrapText(item, 7.6, CONTENT_WIDTH - 50).length * 10 + 4, 0);
    if (top + controlHeight > PAGE_BOTTOM) newPage(true);
    drawCard(page, PAGE_MARGIN, top, CONTENT_WIDTH, controlHeight, "Management controls to resolve", { fill: PALETTE.amberBackground, accent: PALETTE.amber });
    drawBullets(page, report.controls, PAGE_MARGIN + 15, top + 34, CONTENT_WIDTH - 30, { size: 7.6, lineHeight: 10, maxLines: 30 });
    top += controlHeight + 14;
  }

  const sections: Array<[string, string, "good" | "watch" | "neutral"]> = [
    ["What went well", report.wins, "good"],
    ["Operational priorities", report.priorities, "watch"],
    ["Actions underway", report.actions, "neutral"],
    ["Support required from group", report.support, "neutral"],
  ];

  for (const [title, text, sectionTone] of sections) {
    const lines = wrapText(text, 8.2, CONTENT_WIDTH - 28);
    const height = Math.max(62, 34 + lines.length * 11);
    if (top + height > PAGE_BOTTOM) newPage(true);
    drawCard(page, PAGE_MARGIN, top, CONTENT_WIDTH, height, title, {
      fill: sectionTone === "good" ? PALETTE.greenBackground : sectionTone === "watch" ? PALETTE.amberBackground : PALETTE.panel,
      accent: sectionTone === "good" ? PALETTE.green : sectionTone === "watch" ? PALETTE.amber : PALETTE.navy,
    });
    page.textBlock(text, PAGE_MARGIN + 14, top + 33, CONTENT_WIDTH - 28, { size: 8.2, lineHeight: 11, fill: PALETTE.ink });
    top += height + 12;
  }

  return pages;
};

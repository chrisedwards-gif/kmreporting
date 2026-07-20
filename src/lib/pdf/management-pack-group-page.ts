import { A4_WIDTH, PdfPageCanvas } from "@/lib/pdf/simple-pdf";
import { formatCurrency, formatDate, formatPercentage, variance, type ManagementPackInput, type SiteView } from "@/lib/pdf/management-pack-data";
import { CONTENT_WIDTH, PAGE_BOTTOM, PAGE_MARGIN, PALETTE, drawBullets, drawCard, drawHeader, drawMetricCard, drawSectionTitle } from "@/lib/pdf/management-pack-theme";

export const drawGroupPage = (input: ManagementPackInput, reports: SiteView[]) => {
  const page = new PdfPageCanvas();
  const totals = reports.reduce((sum, report) => ({
    sales: sum.sales + report.netSales,
    food: sum.food + report.cogs,
    labour: sum.labour + report.staffCost,
    waste: sum.waste + report.netSales * report.wastePct / 100,
    credits: sum.credits + report.pendingCredits,
    invoices: sum.invoices + report.awaitingInvoice,
    manual: sum.manual + report.manualPurchases,
  }), { sales: 0, food: 0, labour: 0, waste: 0, credits: 0, invoices: 0, manual: 0 });
  const foodPct = totals.sales ? totals.food / totals.sales * 100 : 0;
  const labourPct = totals.sales ? totals.labour / totals.sales * 100 : 0;
  const primePct = foodPct + labourPct;
  const foodTarget = totals.sales ? reports.reduce((sum, report) => sum + report.foodTarget * report.netSales, 0) / totals.sales : 0;
  const labourTarget = totals.sales ? reports.reduce((sum, report) => sum + report.labourTarget * report.netSales, 0) / totals.sales : 0;
  const ready = input.expectedSites.length > 0 && input.expectedSites.every((site) => {
    const report = input.reports.find((candidate) => candidate.siteId === site.id);
    return report && ["approved", "shared"].includes(report.status);
  });
  const released = ready && input.expectedSites.every((site) => input.reports.find((report) => report.siteId === site.id)?.status === "shared");
  const partial = !ready;
  const controls = reports.reduce((sum, report) => sum + report.openControls, 0);

  drawHeader(page, {
    title: "Weekly management pack",
    subtitle: `${formatDate(input.week.start)} to ${formatDate(input.week.end)}  /  Prepared for ${input.preparedFor ?? "Jake Atkinson"}`,
    rightTop: "WEEK ENDING",
    rightMain: formatDate(input.week.end),
    status: released ? "Released" : ready ? "Ready to release" : "Partial - review required",
    tone: partial ? "watch" : "good",
  });

  if (partial) {
    page.rectangle(PAGE_MARGIN, 108, CONTENT_WIDTH, 30, { fill: PALETTE.amberBackground, stroke: PALETTE.amber, strokeWidth: 0.6 });
    page.text(`${reports.length} of ${input.expectedSites.length} active kitchens included. Outstanding kitchens are excluded from group totals.`, PAGE_MARGIN + 12, 118, { size: 8, font: "F2", fill: [0.42, 0.27, 0.05] });
  }

  let top = partial ? 154 : 116;
  top = drawSectionTitle(page, "Executive scorecard", top, "Approved reports only");
  const gap = 8;
  const metricWidth = (CONTENT_WIDTH - gap * 3) / 4;
  drawMetricCard(page, PAGE_MARGIN, top, metricWidth, "Net sales", formatCurrency(totals.sales), `${reports.length} reporting kitchen${reports.length === 1 ? "" : "s"}`);
  drawMetricCard(page, PAGE_MARGIN + metricWidth + gap, top, metricWidth, "Prime cost", formatPercentage(primePct), `${formatCurrency(totals.food + totals.labour)}  /  target ${formatPercentage(foodTarget + labourTarget)}`, variance(primePct, foodTarget + labourTarget));
  drawMetricCard(page, PAGE_MARGIN + 2 * (metricWidth + gap), top, metricWidth, reports.every((report) => report.foodLabel === "Food cost") ? "Food cost" : "Food spend", formatPercentage(foodPct), `${formatCurrency(totals.food)}  /  target ${formatPercentage(foodTarget)}`, variance(foodPct, foodTarget));
  drawMetricCard(page, PAGE_MARGIN + 3 * (metricWidth + gap), top, metricWidth, "Labour", formatPercentage(labourPct), `${formatCurrency(totals.labour)}  /  target ${formatPercentage(labourTarget)}`, variance(labourPct, labourTarget));
  top += 110;

  top = drawSectionTitle(page, "Management readout", top, "What Jake needs to know");
  const cardWidth = (CONTENT_WIDTH - gap * 2) / 3;
  const wins = reports.map((report) => `${report.siteName}: ${report.wins}`).filter(Boolean);
  const risks = reports.flatMap((report) => [
    report.priorities !== "No operational, staffing, compliance or equipment issue was reported." ? `${report.siteName}: ${report.priorities}` : "",
    report.openControls ? `${report.siteName}: ${report.openControls} management control${report.openControls === 1 ? "" : "s"} remain open.` : "",
  ]).filter(Boolean);
  const support = reports.map((report) => report.support !== "No group support was requested." ? `${report.siteName}: ${report.support}` : "").filter(Boolean);
  if (partial) support.push("Before release: complete outstanding kitchen reports and approvals.");

  drawCard(page, PAGE_MARGIN, top, cardWidth, 142, "What went well", { fill: PALETTE.greenBackground, accent: PALETTE.green });
  drawBullets(page, wins.length ? wins : ["No material wins were recorded."], PAGE_MARGIN + 14, top + 34, cardWidth - 28, { maxLines: 8 });
  drawCard(page, PAGE_MARGIN + cardWidth + gap, top, cardWidth, 142, "Needs attention", { fill: PALETTE.amberBackground, accent: PALETTE.amber });
  drawBullets(page, risks.length ? risks : ["No material risks were recorded."], PAGE_MARGIN + cardWidth + gap + 14, top + 34, cardWidth - 28, { maxLines: 8 });
  drawCard(page, PAGE_MARGIN + 2 * (cardWidth + gap), top, cardWidth, 142, "Decision / support", { fill: PALETTE.light, accent: PALETTE.navy });
  drawBullets(page, support.length ? support : ["No group support was requested."], PAGE_MARGIN + 2 * (cardWidth + gap) + 14, top + 34, cardWidth - 28, { maxLines: 8 });
  top += 160;

  top = drawSectionTitle(page, "Reporting coverage", top, "Active kitchens only");
  const rowHeight = 30;
  input.expectedSites.slice(0, 4).forEach((site, index) => {
    const report = input.reports.find((candidate) => candidate.siteId === site.id);
    const rowTop = top + index * rowHeight;
    if (index % 2 === 0) page.rectangle(PAGE_MARGIN, rowTop, CONTENT_WIDTH, rowHeight, { fill: PALETTE.panel });
    page.text(site.name, PAGE_MARGIN + 10, rowTop + 9, { size: 8.4, font: "F2", fill: PALETTE.ink });
    page.text(site.code, PAGE_MARGIN + 155, rowTop + 9, { size: 7.3, fill: PALETTE.muted });
    const included = report && ["approved", "shared"].includes(report.status);
    const label = included ? "Included" : report ? "Awaiting approval" : "Not started";
    page.text(label.toUpperCase(), A4_WIDTH - PAGE_MARGIN - 10, rowTop + 9, { size: 7, font: "F2", fill: included ? PALETTE.green : PALETTE.amber, align: "right" });
    page.line(PAGE_MARGIN, rowTop + rowHeight, A4_WIDTH - PAGE_MARGIN, rowTop + rowHeight, { stroke: PALETTE.line, strokeWidth: 0.4 });
  });
  top += Math.max(rowHeight, Math.min(4, input.expectedSites.length) * rowHeight) + 18;

  top = drawSectionTitle(page, "Kitchen comparison", top, "Performance against target");
  const columns = [190, 72, 72, 72, 72, 33];
  const labels = ["Kitchen", "Sales", "Food", "Labour", "Prime", "Open"];
  let x = PAGE_MARGIN;
  page.rectangle(PAGE_MARGIN, top, CONTENT_WIDTH, 24, { fill: PALETTE.navy });
  labels.forEach((label, index) => {
    page.text(label.toUpperCase(), x + 6, top + 8, { size: 6.3, font: "F2", fill: PALETTE.white });
    x += columns[index];
  });
  let rowTop = top + 24;
  reports.slice(0, 5).forEach((report, index) => {
    const height = 36;
    if (index % 2 === 0) page.rectangle(PAGE_MARGIN, rowTop, CONTENT_WIDTH, height, { fill: PALETTE.panel });
    x = PAGE_MARGIN;
    page.text(report.siteName, x + 6, rowTop + 7, { size: 7.8, font: "F2", fill: PALETTE.ink });
    page.text(report.manager, x + 6, rowTop + 19, { size: 6.3, fill: PALETTE.muted });
    x += columns[0];
    page.text(formatCurrency(report.netSales), x + 6, rowTop + 12, { size: 7.4, font: "F2", fill: PALETTE.ink });
    x += columns[1];
    const comparisons = [[report.foodCostPct, report.foodTarget], [report.labourPct, report.labourTarget], [report.primeCostPct, report.foodTarget + report.labourTarget]];
    comparisons.forEach(([actual, target]) => {
      page.text(formatPercentage(actual), x + 6, rowTop + 7, { size: 7.4, font: "F2", fill: PALETTE.ink });
      page.text(variance(actual, target).text.replace(" target", ""), x + 6, rowTop + 19, { size: 5.8, fill: PALETTE.muted });
      x += 72;
    });
    page.text(String(report.openControls), x + 12, rowTop + 12, { size: 7.4, font: "F2", fill: report.openControls ? PALETTE.amber : PALETTE.green, align: "center" });
    page.line(PAGE_MARGIN, rowTop + height, A4_WIDTH - PAGE_MARGIN, rowTop + height, { stroke: PALETTE.line, strokeWidth: 0.4 });
    rowTop += height;
  });

  if (controls || totals.credits || totals.invoices || totals.manual) {
    const noteTop = Math.min(PAGE_BOTTOM - 28, rowTop + 10);
    page.text(`Controls: ${controls} open  /  Pending credits: ${formatCurrency(totals.credits)}  /  Awaiting invoice: ${formatCurrency(totals.invoices)}  /  Manual purchases: ${formatCurrency(totals.manual)}`, PAGE_MARGIN, noteTop, { size: 6.4, fill: PALETTE.muted });
  }
  return page;
};

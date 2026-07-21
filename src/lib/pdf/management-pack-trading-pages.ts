import { buildSalesInsights, type SalesDayInsight, type SalesInsights } from "@/lib/reporting/sales-insights";
import { A4_WIDTH, PdfPageCanvas, type PdfColor } from "@/lib/pdf/simple-pdf";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatPercentage,
  type ManagementPackInput,
  type SiteView,
} from "@/lib/pdf/management-pack-data";
import {
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PALETTE,
  drawCard,
  drawHeader,
  drawMetricCard,
  drawSectionTitle,
} from "@/lib/pdf/management-pack-theme";

const dayName = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })
  .format(new Date(`${date}T12:00:00Z`));

const heatFill = (value: number | null, values: Array<number | null>, higherIsBetter = true): PdfColor => {
  if (value === null) return PALETTE.light;
  const valid = values.filter((item): item is number => item !== null && Number.isFinite(item));
  if (valid.length < 2) return PALETTE.greenBackground;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max === min) return PALETTE.greenBackground;
  const score = (value - min) / (max - min);
  const adjusted = higherIsBetter ? score : 1 - score;
  if (adjusted >= 0.67) return PALETTE.greenBackground;
  if (adjusted >= 0.34) return PALETTE.amberBackground;
  return PALETTE.redBackground;
};

const signedChange = (value: number | null) => value === null
  ? "No prior-week data"
  : `${value >= 0 ? "+" : ""}${value.toFixed(1)}% vs prior week`;

const drawDailySalesChart = (
  page: PdfPageCanvas,
  days: SalesDayInsight[],
  top: number,
  title = "Day-by-day net sales",
) => {
  const chartTop = drawSectionTitle(page, title, top, "Bars show net sales; line shows weekly daily average");
  const height = 142;
  page.rectangle(PAGE_MARGIN, chartTop, CONTENT_WIDTH, height, { fill: PALETTE.panel, stroke: PALETTE.line, strokeWidth: 0.6 });
  if (!days.length) {
    page.text("Daily EPOS rows were not supplied for this report.", A4_WIDTH / 2, chartTop + 60, { size: 9, fill: PALETTE.muted, align: "center" });
    return chartTop + height + 14;
  }

  const values = days.map((day) => day.netSales);
  const max = Math.max(...values, 1);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const plotLeft = PAGE_MARGIN + 34;
  const plotTop = chartTop + 14;
  const plotHeight = 94;
  const plotWidth = CONTENT_WIDTH - 50;
  const gap = 9;
  const barWidth = (plotWidth - gap * (days.length - 1)) / days.length;

  [0, 0.5, 1].forEach((ratio) => {
    const y = plotTop + plotHeight - plotHeight * ratio;
    page.line(plotLeft, y, plotLeft + plotWidth, y, { stroke: PALETTE.line, strokeWidth: 0.4 });
    page.text(formatCompactCurrency(max * ratio), plotLeft - 6, y - 3, { size: 5.8, fill: PALETTE.muted, align: "right" });
  });

  const averageY = plotTop + plotHeight - (average / max) * plotHeight;
  page.line(plotLeft, averageY, plotLeft + plotWidth, averageY, { stroke: PALETTE.orange, strokeWidth: 1 });
  page.text(`AVG ${formatCompactCurrency(average)}`, plotLeft + plotWidth, averageY - 9, { size: 5.8, font: "F2", fill: PALETTE.orange, align: "right" });

  days.forEach((day, index) => {
    const x = plotLeft + index * (barWidth + gap);
    const barHeight = Math.max(2, (day.netSales / max) * plotHeight);
    const tone = day.salesVsDailyAveragePct !== null && day.salesVsDailyAveragePct < -15 ? PALETTE.amber : PALETTE.green;
    page.rectangle(x, plotTop + plotHeight - barHeight, barWidth, barHeight, { fill: tone });
    page.text(formatCompactCurrency(day.netSales), x + barWidth / 2, plotTop + plotHeight - barHeight - 11, { size: 5.8, font: "F2", fill: PALETTE.ink, align: "center" });
    page.text(dayName(day.businessDate).toUpperCase(), x + barWidth / 2, plotTop + plotHeight + 8, { size: 6.2, font: "F2", fill: PALETTE.muted, align: "center" });
  });

  return chartTop + height + 14;
};

const drawTradingHeatmap = (page: PdfPageCanvas, days: SalesDayInsight[], top: number) => {
  const tableTop = drawSectionTitle(page, "Trading heatmap", top, "Green is strongest within this reporting week");
  const rowLabelWidth = 82;
  const dayWidth = (CONTENT_WIDTH - rowLabelWidth) / Math.max(days.length, 7);
  const rows: Array<{ label: string; values: Array<number | null>; format: (value: number | null) => string }> = [
    { label: "Net sales", values: days.map((day) => day.netSales), format: (value) => value === null ? "-" : formatCompactCurrency(value) },
    { label: "Transactions", values: days.map((day) => day.transactions || null), format: (value) => value === null ? "-" : Math.round(value).toString() },
    { label: "ATV", values: days.map((day) => day.atv), format: (value) => value === null ? "-" : formatCurrency(value) },
    { label: "Covers", values: days.map((day) => day.covers || null), format: (value) => value === null ? "-" : Math.round(value).toString() },
  ];
  const rowHeight = 27;
  const headerHeight = 24;
  const totalHeight = headerHeight + rows.length * rowHeight;
  page.rectangle(PAGE_MARGIN, tableTop, CONTENT_WIDTH, totalHeight, { fill: PALETTE.white, stroke: PALETTE.line, strokeWidth: 0.6 });
  page.rectangle(PAGE_MARGIN, tableTop, CONTENT_WIDTH, headerHeight, { fill: PALETTE.navy });
  page.text("MEASURE", PAGE_MARGIN + 9, tableTop + 8, { size: 6.2, font: "F2", fill: PALETTE.white });
  days.forEach((day, index) => page.text(dayName(day.businessDate).toUpperCase(), PAGE_MARGIN + rowLabelWidth + dayWidth * index + dayWidth / 2, tableTop + 8, { size: 6.2, font: "F2", fill: PALETTE.white, align: "center" }));
  for (let index = days.length; index < 7; index += 1) page.text("-", PAGE_MARGIN + rowLabelWidth + dayWidth * index + dayWidth / 2, tableTop + 8, { size: 6.2, fill: PALETTE.white, align: "center" });

  rows.forEach((row, rowIndex) => {
    const y = tableTop + headerHeight + rowIndex * rowHeight;
    page.rectangle(PAGE_MARGIN, y, rowLabelWidth, rowHeight, { fill: PALETTE.panel });
    page.text(row.label.toUpperCase(), PAGE_MARGIN + 9, y + 9, { size: 6.3, font: "F2", fill: PALETTE.muted });
    for (let index = 0; index < 7; index += 1) {
      const value = row.values[index] ?? null;
      const x = PAGE_MARGIN + rowLabelWidth + dayWidth * index;
      page.rectangle(x, y, dayWidth, rowHeight, { fill: heatFill(value, row.values), stroke: PALETTE.line, strokeWidth: 0.3 });
      page.text(row.format(value), x + dayWidth / 2, y + 8, { size: 6.4, font: "F2", fill: PALETTE.ink, align: "center" });
    }
  });
  return tableTop + totalHeight + 14;
};

const drawCategoryMix = (page: PdfPageCanvas, insights: SalesInsights, x: number, top: number, width: number, height: number) => {
  drawCard(page, x, top, width, height, "Category mix", { fill: PALETTE.panel, accent: PALETTE.green });
  const categories = insights.categories.slice(0, 6);
  if (!categories.length) {
    page.textBlock("Category-level EPOS detail was not supplied. Add an item/category export to populate mix and concentration analysis.", x + 14, top + 38, width - 28, { size: 7.5, lineHeight: 10, fill: PALETTE.muted });
    return;
  }
  const max = Math.max(...categories.map((category) => category.netSales), 1);
  categories.forEach((category, index) => {
    const rowTop = top + 34 + index * 21;
    page.textBlock(category.category, x + 14, rowTop, 85, { size: 6.7, font: "F2", fill: PALETTE.ink, maxLines: 1, ellipsis: true });
    const barX = x + 104;
    const barWidth = width - 166;
    page.rectangle(barX, rowTop + 2, barWidth, 7, { fill: PALETTE.light });
    page.rectangle(barX, rowTop + 2, barWidth * category.netSales / max, 7, { fill: PALETTE.green });
    page.text(`${category.mixPct.toFixed(1)}%`, x + width - 12, rowTop, { size: 6.5, font: "F2", fill: PALETTE.ink, align: "right" });
  });
};

const drawMarginBridge = (page: PdfPageCanvas, report: SiteView, x: number, top: number, width: number, height: number) => {
  drawCard(page, x, top, width, height, "Sales-to-prime-cost bridge", { fill: PALETTE.panel, accent: PALETTE.navy });
  const contributionPct = Math.max(0, 100 - report.primeCostPct - report.wastePct);
  const rows = [
    ["Net sales", 100, formatCurrency(report.netSales), PALETTE.navy],
    [report.foodLabel, report.foodCostPct, formatCurrency(report.cogs), PALETTE.orange],
    ["Labour", report.labourPct, formatCurrency(report.staffCost), PALETTE.red],
    ["Waste", report.wastePct, formatCurrency(report.wasteCost), PALETTE.amber],
    ["After prime + waste", contributionPct, formatCurrency(report.netSales - report.cogs - report.staffCost - report.wasteCost), PALETTE.green],
  ] as const;
  rows.forEach(([label, pct, value, colour], index) => {
    const y = top + 34 + index * 25;
    page.text(label.toUpperCase(), x + 14, y, { size: 6.1, font: "F2", fill: PALETTE.muted });
    const barX = x + 115;
    const barWidth = width - 178;
    page.rectangle(barX, y + 1, barWidth, 8, { fill: PALETTE.light });
    page.rectangle(barX, y + 1, Math.max(1, barWidth * Math.min(pct, 100) / 100), 8, { fill: colour });
    page.text(`${pct.toFixed(1)}%`, x + width - 58, y, { size: 6.2, font: "F2", fill: PALETTE.ink, align: "right" });
    page.text(value, x + width - 12, y, { size: 6.2, fill: PALETTE.ink, align: "right" });
  });
  page.textBlock("Purchasing is currently supplied as a weekly total. Genuine day-by-day supplier spend requires dated order or invoice rows.", x + 14, top + height - 31, width - 28, { size: 6.2, lineHeight: 8, fill: PALETTE.muted, maxLines: 2, ellipsis: true });
};

const aggregateSales = (reports: SiteView[]) => {
  const days = new Map<string, { grossSales: number; netSales: number; transactions: number; covers: number }>();
  const categories = new Map<string, { category: string; quantity: number; netSales: number }>();
  for (const report of reports) {
    for (const day of report.salesInsights.days) {
      const current = days.get(day.businessDate) ?? { grossSales: 0, netSales: 0, transactions: 0, covers: 0 };
      current.grossSales += day.grossSales;
      current.netSales += day.netSales;
      current.transactions += day.transactions;
      current.covers += day.covers;
      days.set(day.businessDate, current);
    }
    for (const category of report.salesInsights.categories) {
      const key = category.category.trim().toLowerCase();
      const current = categories.get(key) ?? { category: category.category, quantity: 0, netSales: 0 };
      current.quantity += category.quantity;
      current.netSales += category.netSales;
      categories.set(key, current);
    }
  }
  return buildSalesInsights({
    days: [...days.entries()].map(([businessDate, value]) => ({ businessDate, ...value })),
    items: [],
    categories: [...categories.values()],
  });
};

export const drawGroupTradingPage = (input: ManagementPackInput, reports: SiteView[]) => {
  const page = new PdfPageCanvas();
  const insights = aggregateSales(reports);
  const weekendSales = insights.days.filter((day) => ["Fri", "Sat", "Sun"].includes(dayName(day.businessDate))).reduce((sum, day) => sum + day.netSales, 0);
  const weekendShare = insights.totalNetSales > 0 ? weekendSales / insights.totalNetSales * 100 : 0;
  const topSite = [...reports].sort((a, b) => b.netSales - a.netSales)[0];
  const topSiteShare = topSite && insights.totalNetSales > 0 ? topSite.netSales / insights.totalNetSales * 100 : 0;

  drawHeader(page, {
    title: "Group trading analysis",
    subtitle: `${formatDate(input.week.start)} to ${formatDate(input.week.end)}  /  Approved kitchens combined`,
    rightTop: "INVESTOR VIEW",
    rightMain: `${insights.tradingDays} trading days`,
    status: insights.hasDailySales ? "Daily data available" : "Daily data missing",
    tone: insights.hasDailySales ? "good" : "watch",
  });

  const gap = 8;
  const metricWidth = (CONTENT_WIDTH - gap * 3) / 4;
  drawMetricCard(page, PAGE_MARGIN, 116, metricWidth, "Transactions", insights.hasTransactions ? insights.totalTransactions.toLocaleString("en-GB") : "Not supplied", `${reports.length} included kitchen${reports.length === 1 ? "" : "s"}`);
  drawMetricCard(page, PAGE_MARGIN + metricWidth + gap, 116, metricWidth, "Group ATV", insights.atv === null ? "Not supplied" : formatCurrency(insights.atv), "Net sales / transactions");
  drawMetricCard(page, PAGE_MARGIN + 2 * (metricWidth + gap), 116, metricWidth, "Weekend share", formatPercentage(weekendShare), "Friday to Sunday share of sales");
  drawMetricCard(page, PAGE_MARGIN + 3 * (metricWidth + gap), 116, metricWidth, "Largest site share", formatPercentage(topSiteShare), topSite?.siteName ?? "No site data");

  let top = drawDailySalesChart(page, insights.days, 222, "Group day-by-day net sales");
  top = drawTradingHeatmap(page, insights.days, top);

  const columnGap = 10;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  drawCategoryMix(page, insights, PAGE_MARGIN, top, columnWidth, 176);
  drawCard(page, PAGE_MARGIN + columnWidth + columnGap, top, columnWidth, 176, "Site economics", { fill: PALETTE.panel, accent: PALETTE.orange });
  const maxSales = Math.max(...reports.map((report) => report.netSales), 1);
  reports.slice(0, 6).forEach((report, index) => {
    const rowTop = top + 35 + index * 22;
    page.textBlock(report.siteName, PAGE_MARGIN + columnWidth + columnGap + 14, rowTop, 90, { size: 6.7, font: "F2", fill: PALETTE.ink, maxLines: 1, ellipsis: true });
    const barX = PAGE_MARGIN + columnWidth + columnGap + 110;
    const barWidth = columnWidth - 178;
    page.rectangle(barX, rowTop + 2, barWidth, 7, { fill: PALETTE.light });
    page.rectangle(barX, rowTop + 2, barWidth * report.netSales / maxSales, 7, { fill: PALETTE.green });
    page.text(formatCompactCurrency(report.netSales), PAGE_MARGIN + CONTENT_WIDTH - 14, rowTop, { size: 6.5, font: "F2", fill: PALETTE.ink, align: "right" });
  });
  return page;
};

export const drawSiteTradingPage = (input: ManagementPackInput, report: SiteView) => {
  const page = new PdfPageCanvas();
  const insights = report.salesInsights;
  drawHeader(page, {
    title: `${report.siteName} trading`,
    subtitle: `${report.manager}  /  Week ending ${formatDate(input.week.end)}  /  Sales, demand and mix`,
    rightTop: report.code,
    rightMain: "Trading analysis",
    status: insights.hasDailySales ? "Daily data available" : "Daily data missing",
    tone: insights.hasDailySales ? "good" : "watch",
  });

  const gap = 8;
  const metricWidth = (CONTENT_WIDTH - gap * 3) / 4;
  drawMetricCard(page, PAGE_MARGIN, 116, metricWidth, "Trading days", String(insights.tradingDays), insights.bestDay ? `Best: ${insights.bestDay.dayLabel}` : "No daily rows");
  drawMetricCard(page, PAGE_MARGIN + metricWidth + gap, 116, metricWidth, "Transactions", insights.hasTransactions ? insights.totalTransactions.toLocaleString("en-GB") : "Not supplied", insights.atv === null ? "ATV unavailable" : `ATV ${formatCurrency(insights.atv)}`);
  drawMetricCard(page, PAGE_MARGIN + 2 * (metricWidth + gap), 116, metricWidth, "Sales vs prior week", insights.salesChangePct === null ? "No baseline" : `${insights.salesChangePct >= 0 ? "+" : ""}${insights.salesChangePct.toFixed(1)}%`, signedChange(insights.salesChangePct));
  drawMetricCard(page, PAGE_MARGIN + 3 * (metricWidth + gap), 116, metricWidth, "Best day", insights.bestDay ? formatCompactCurrency(insights.bestDay.netSales) : "Not supplied", insights.bestDay?.dayLabel ?? "Daily rows required");

  let top = drawDailySalesChart(page, insights.days, 222);
  top = drawTradingHeatmap(page, insights.days, top);

  const columnGap = 10;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  drawCategoryMix(page, insights, PAGE_MARGIN, top, columnWidth, 176);
  drawMarginBridge(page, report, PAGE_MARGIN + columnWidth + columnGap, top, columnWidth, 176);
  return page;
};

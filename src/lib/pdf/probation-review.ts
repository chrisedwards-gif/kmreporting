import { A4_HEIGHT, A4_WIDTH, buildPdfDocument, PdfPageCanvas, type PdfColor } from "@/lib/pdf/simple-pdf";

const palette = {
  ink: [0.055, 0.102, 0.082] as PdfColor,
  muted: [0.34, 0.40, 0.37] as PdfColor,
  line: [0.79, 0.83, 0.80] as PdfColor,
  green: [0.08, 0.42, 0.30] as PdfColor,
  greenSoft: [0.89, 0.96, 0.93] as PdfColor,
  amber: [0.73, 0.40, 0.04] as PdfColor,
  amberSoft: [1, 0.95, 0.82] as PdfColor,
  red: [0.73, 0.12, 0.10] as PdfColor,
  redSoft: [1, 0.90, 0.89] as PdfColor,
  neutral: [0.38, 0.42, 0.40] as PdfColor,
  neutralSoft: [0.94, 0.95, 0.94] as PdfColor,
  white: [1, 1, 1] as PdfColor,
};

const margin = 48;
const contentWidth = A4_WIDTH - margin * 2;

export type ProbationFinalSnapshot = {
  schemaVersion: number;
  review: {
    id: string;
    reviewDate: string;
    reviewStage: "30_day" | "60_day" | "90_day" | "final" | "other";
    outcome: "pending" | "pass" | "extend" | "fail";
    extensionEndDate: string | null;
    notes: string;
    requiredActions: string;
  };
  manager: {
    id: string;
    fullName: string;
    roleTitle: string;
    siteId: string | null;
    siteName: string;
    employmentStartDate: string | null;
    probationEndDate: string | null;
    stageLabel: string;
  };
  performance: {
    weightedScore: number | null;
    calculatedRag: "green" | "amber" | "red" | "neutral";
    displayedRag: "green" | "amber" | "red" | "neutral";
    reviewCount: number;
    latestReviewDate: string | null;
    weights: Record<string, number>;
    override: null | {
      calculatedRag: string;
      overrideRag: string;
      reason: string;
      createdByName: string;
      createdAt: string;
    };
  };
  evidence: Array<{
    id: string;
    fileName: string;
    evidenceType: string;
    caption: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByName: string;
    createdAt: string;
  }>;
  audit: {
    finalisedById: string;
    finalisedByName: string;
    finalisedAt: string;
  };
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
  : "Not recorded";

const stageLabels: Record<ProbationFinalSnapshot["review"]["reviewStage"], string> = {
  "30_day": "30-day review",
  "60_day": "60-day review",
  "90_day": "90-day review",
  final: "Final probation review",
  other: "Additional review",
};

const outcomeLabels: Record<ProbationFinalSnapshot["review"]["outcome"], string> = {
  pending: "Decision pending",
  pass: "Pass probation",
  extend: "Extend probation",
  fail: "Do not pass probation",
};

const ragLabels = { green: "Green", amber: "Amber", red: "Red", neutral: "Not enough evidence" } as const;
const tone = (rag: keyof typeof ragLabels) => ({
  green: { accent: palette.green, soft: palette.greenSoft },
  amber: { accent: palette.amber, soft: palette.amberSoft },
  red: { accent: palette.red, soft: palette.redSoft },
  neutral: { accent: palette.neutral, soft: palette.neutralSoft },
}[rag]);

const drawHeader = (page: PdfPageCanvas, snapshot: ProbationFinalSnapshot, pageNumber: number) => {
  page.rectangle(0, 0, A4_WIDTH, 10, { fill: palette.green });
  page.text("HOUSE OF SOCIAL / PEOPLE & PERFORMANCE", margin, 35, { size: 7, font: "F2", fill: palette.green });
  page.text(snapshot.manager.fullName, margin, 62, { size: 25, font: "F2", fill: palette.ink });
  page.text(`${snapshot.manager.roleTitle} / ${snapshot.manager.siteName}`, margin, 94, { size: 9, fill: palette.muted });
  page.text("Probation decision record", A4_WIDTH - margin, 38, { size: 8, font: "F2", fill: palette.ink, align: "right" });
  page.text(`Page ${pageNumber}`, A4_WIDTH - margin, 54, { size: 7, fill: palette.muted, align: "right" });
  page.line(margin, 118, A4_WIDTH - margin, 118, { stroke: palette.green, strokeWidth: 1.2 });
  return 138;
};

const drawFooter = (page: PdfPageCanvas, snapshot: ProbationFinalSnapshot) => {
  page.line(margin, A4_HEIGHT - 48, A4_WIDTH - margin, A4_HEIGHT - 48, { stroke: palette.line, strokeWidth: 0.6 });
  page.text(`Immutable record ${snapshot.review.id}`, margin, A4_HEIGHT - 35, { size: 6.5, fill: palette.muted });
  page.text(`Finalised ${formatDate(snapshot.audit.finalisedAt)} by ${snapshot.audit.finalisedByName}`, A4_WIDTH - margin, A4_HEIGHT - 35, { size: 6.5, fill: palette.muted, align: "right" });
};

const drawLabelValue = (page: PdfPageCanvas, x: number, top: number, width: number, label: string, value: string) => {
  page.text(label.toUpperCase(), x, top, { size: 6.5, font: "F2", fill: palette.muted });
  page.textBlock(value, x, top + 15, width, { size: 9.5, font: "F2", fill: palette.ink, lineHeight: 12, maxLines: 2, ellipsis: true });
};

const drawSection = (page: PdfPageCanvas, top: number, title: string, subtitle?: string) => {
  page.text(title, margin, top, { size: 13, font: "F2", fill: palette.ink });
  if (subtitle) page.text(subtitle, A4_WIDTH - margin, top + 2, { size: 7, fill: palette.muted, align: "right" });
  page.line(margin, top + 22, A4_WIDTH - margin, top + 22, { stroke: palette.line, strokeWidth: 0.7 });
  return top + 38;
};

const drawSummaryPage = (snapshot: ProbationFinalSnapshot) => {
  const page = new PdfPageCanvas();
  let y = drawHeader(page, snapshot, 1);
  const statusTone = tone(snapshot.performance.displayedRag);
  page.rectangle(margin, y, contentWidth, 96, { fill: statusTone.soft, stroke: statusTone.accent, strokeWidth: 0.8 });
  page.rectangle(margin, y, 7, 96, { fill: statusTone.accent });
  page.text(outcomeLabels[snapshot.review.outcome], margin + 22, y + 17, { size: 17, font: "F2", fill: palette.ink });
  page.text(`${stageLabels[snapshot.review.reviewStage]} · ${formatDate(snapshot.review.reviewDate)}`, margin + 22, y + 46, { size: 8.5, fill: palette.muted });
  page.text(ragLabels[snapshot.performance.displayedRag], A4_WIDTH - margin - 22, y + 18, { size: 14, font: "F2", fill: statusTone.accent, align: "right" });
  page.text(snapshot.performance.weightedScore === null ? "No score" : `${snapshot.performance.weightedScore.toFixed(1)} / 5`, A4_WIDTH - margin - 22, y + 47, { size: 9, fill: palette.ink, align: "right" });
  if (snapshot.performance.override) page.text("Management override recorded", A4_WIDTH - margin - 22, y + 67, { size: 7, fill: palette.muted, align: "right" });
  y += 118;

  y = drawSection(page, y, "Employment and review position");
  const col = contentWidth / 3;
  drawLabelValue(page, margin, y, col - 12, "Employment start", formatDate(snapshot.manager.employmentStartDate));
  drawLabelValue(page, margin + col, y, col - 12, "Probation end", formatDate(snapshot.manager.probationEndDate));
  drawLabelValue(page, margin + col * 2, y, col - 12, "Current stage", snapshot.manager.stageLabel);
  y += 65;
  drawLabelValue(page, margin, y, col - 12, "Finalised 1-1s", String(snapshot.performance.reviewCount));
  drawLabelValue(page, margin + col, y, col - 12, "Latest evidence", formatDate(snapshot.performance.latestReviewDate));
  drawLabelValue(page, margin + col * 2, y, col - 12, "Evidence attachments", String(snapshot.evidence.length));
  y += 84;

  y = drawSection(page, y, "Decision rationale", "Recorded before the outcome was locked");
  page.rectangle(margin, y, contentWidth, 146, { fill: palette.neutralSoft, stroke: palette.line, strokeWidth: 0.6 });
  page.textBlock(snapshot.review.notes || "No review notes recorded.", margin + 18, y + 18, contentWidth - 36, { size: 9, fill: palette.ink, lineHeight: 13, maxLines: 8, ellipsis: true });
  y += 166;

  y = drawSection(page, y, "Required actions and next steps");
  page.rectangle(margin, y, contentWidth, 112, { fill: snapshot.review.requiredActions ? palette.amberSoft : palette.neutralSoft, stroke: palette.line, strokeWidth: 0.6 });
  page.textBlock(snapshot.review.requiredActions || "No further actions were recorded.", margin + 18, y + 18, contentWidth - 36, { size: 9, fill: palette.ink, lineHeight: 13, maxLines: 6, ellipsis: true });
  if (snapshot.review.outcome === "extend" && snapshot.review.extensionEndDate) {
    page.text(`Revised probation end: ${formatDate(snapshot.review.extensionEndDate)}`, margin + 18, y + 88, { size: 8, font: "F2", fill: palette.amber });
  }
  drawFooter(page, snapshot);
  return page;
};

const drawPerformancePage = (snapshot: ProbationFinalSnapshot) => {
  const page = new PdfPageCanvas();
  let y = drawHeader(page, snapshot, 2);
  y = drawSection(page, y, "Performance evidence and judgement");
  const metricWidth = (contentWidth - 24) / 3;
  const metrics = [
    ["Weighted score", snapshot.performance.weightedScore === null ? "Not available" : snapshot.performance.weightedScore.toFixed(1)],
    ["Calculated RAG", ragLabels[snapshot.performance.calculatedRag]],
    ["Final displayed RAG", ragLabels[snapshot.performance.displayedRag]],
  ];
  metrics.forEach(([label, value], index) => {
    const x = margin + index * (metricWidth + 12);
    page.rectangle(x, y, metricWidth, 72, { fill: palette.neutralSoft, stroke: palette.line, strokeWidth: 0.6 });
    page.text(label.toUpperCase(), x + 14, y + 14, { size: 6.5, font: "F2", fill: palette.muted });
    page.text(value, x + 14, y + 36, { size: 14, font: "F2", fill: palette.ink });
  });
  y += 94;

  y = drawSection(page, y, "Management judgement", "Original calculation remains preserved");
  if (snapshot.performance.override) {
    page.rectangle(margin, y, contentWidth, 112, { fill: palette.amberSoft, stroke: palette.amber, strokeWidth: 0.7 });
    page.text(`${ragLabels[snapshot.performance.override.calculatedRag as keyof typeof ragLabels] ?? snapshot.performance.override.calculatedRag} → ${ragLabels[snapshot.performance.override.overrideRag as keyof typeof ragLabels] ?? snapshot.performance.override.overrideRag}`, margin + 18, y + 16, { size: 12, font: "F2", fill: palette.amber });
    page.textBlock(snapshot.performance.override.reason, margin + 18, y + 42, contentWidth - 36, { size: 8.5, fill: palette.ink, lineHeight: 12, maxLines: 4, ellipsis: true });
    page.text(`${snapshot.performance.override.createdByName} · ${formatDate(snapshot.performance.override.createdAt)}`, margin + 18, y + 91, { size: 6.8, fill: palette.muted });
  } else {
    page.rectangle(margin, y, contentWidth, 78, { fill: palette.greenSoft, stroke: palette.green, strokeWidth: 0.7 });
    page.text("No management override was active at finalisation.", margin + 18, y + 20, { size: 9.5, font: "F2", fill: palette.green });
    page.text("The displayed status matches the calculated score from the latest finalised 1-1 evidence.", margin + 18, y + 45, { size: 7.5, fill: palette.ink });
  }
  y += snapshot.performance.override ? 136 : 102;

  y = drawSection(page, y, "Role weighting used", "Missing score areas are ignored rather than treated as zero");
  const weights = Object.entries(snapshot.performance.weights);
  weights.forEach(([area, weight], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellWidth = contentWidth / 2 - 6;
    const x = margin + column * (cellWidth + 12);
    const top = y + row * 42;
    page.rectangle(x, top, cellWidth, 32, { fill: index % 4 < 2 ? palette.neutralSoft : palette.white, stroke: palette.line, strokeWidth: 0.4 });
    page.text(area.replaceAll("_", " "), x + 12, top + 10, { size: 7.5, fill: palette.ink });
    page.text(`${Math.round(weight * 100)}%`, x + cellWidth - 12, top + 10, { size: 7.5, font: "F2", fill: palette.green, align: "right" });
  });
  y += Math.ceil(weights.length / 2) * 42 + 12;

  y = drawSection(page, y, "Audit identity");
  page.rectangle(margin, y, contentWidth, 82, { fill: palette.neutralSoft, stroke: palette.line, strokeWidth: 0.6 });
  drawLabelValue(page, margin + 16, y + 15, contentWidth / 2 - 24, "Finalised by", snapshot.audit.finalisedByName);
  drawLabelValue(page, margin + contentWidth / 2, y + 15, contentWidth / 2 - 24, "Finalised at", formatDate(snapshot.audit.finalisedAt));
  drawFooter(page, snapshot);
  return page;
};

const drawEvidencePages = (snapshot: ProbationFinalSnapshot) => {
  const evidence = snapshot.evidence;
  const pageSize = 10;
  const chunks = evidence.length
    ? Array.from({ length: Math.ceil(evidence.length / pageSize) }, (_, index) => evidence.slice(index * pageSize, (index + 1) * pageSize))
    : [[]];

  return chunks.map((files, pageIndex) => {
    const page = new PdfPageCanvas();
    let y = drawHeader(page, snapshot, 3 + pageIndex);
    y = drawSection(page, y, pageIndex ? "Evidence register — continued" : "Evidence register", "Private source files remain in secure storage");
    if (!files.length) {
      page.rectangle(margin, y, contentWidth, 78, { fill: palette.neutralSoft, stroke: palette.line, strokeWidth: 0.6 });
      page.text("No documents or photographs were attached before finalisation.", margin + 18, y + 29, { size: 9, fill: palette.muted });
    } else {
      files.forEach((file, index) => {
        const rowHeight = 55;
        page.rectangle(margin, y, contentWidth, rowHeight, { fill: index % 2 ? palette.white : palette.neutralSoft, stroke: palette.line, strokeWidth: 0.4 });
        page.textBlock(file.caption || file.fileName, margin + 14, y + 9, contentWidth - 150, { size: 8.3, font: "F2", fill: palette.ink, lineHeight: 10, maxLines: 2, ellipsis: true });
        page.text(`${file.evidenceType.replaceAll("_", " ")} · ${file.uploadedByName}`, margin + 14, y + 36, { size: 6.7, fill: palette.muted });
        page.text(formatDate(file.createdAt), A4_WIDTH - margin - 14, y + 18, { size: 6.7, fill: palette.muted, align: "right" });
        y += rowHeight;
      });
      page.text(`Files ${pageIndex * pageSize + 1}–${pageIndex * pageSize + files.length} of ${evidence.length}`, margin, y + 14, { size: 7, fill: palette.muted });
    }
    drawFooter(page, snapshot);
    return page;
  });
};

export const buildProbationReviewPdf = (snapshot: ProbationFinalSnapshot) => buildPdfDocument([
  drawSummaryPage(snapshot),
  drawPerformancePage(snapshot),
  ...drawEvidencePages(snapshot),
]);

import { A4_WIDTH, PdfPageCanvas, measureText, wrapText, type PdfColor } from "@/lib/pdf/simple-pdf";
import type { Tone } from "@/lib/pdf/management-pack-data";

export const PAGE_MARGIN = 40;
export const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;
export const PAGE_BOTTOM = 782;

export const PALETTE = {
  ink: [0.086, 0.129, 0.114] as PdfColor,
  muted: [0.36, 0.42, 0.39] as PdfColor,
  navy: [0.055, 0.169, 0.129] as PdfColor,
  green: [0.12, 0.48, 0.35] as PdfColor,
  greenBackground: [0.91, 0.97, 0.94] as PdfColor,
  orange: [0.92, 0.31, 0.10] as PdfColor,
  amber: [0.78, 0.51, 0.14] as PdfColor,
  amberBackground: [1, 0.96, 0.86] as PdfColor,
  red: [0.72, 0.2, 0.16] as PdfColor,
  redBackground: [1, 0.92, 0.9] as PdfColor,
  line: [0.84, 0.87, 0.85] as PdfColor,
  panel: [0.97, 0.98, 0.97] as PdfColor,
  light: [0.94, 0.96, 0.95] as PdfColor,
  white: [1, 1, 1] as PdfColor,
};

export const toneColor = (tone: Tone) => tone === "bad" ? PALETTE.red : tone === "watch" ? PALETTE.amber : PALETTE.green;
export const toneBackground = (tone: Tone) => tone === "bad" ? PALETTE.redBackground : tone === "watch" ? PALETTE.amberBackground : PALETTE.greenBackground;

export const drawHeader = (page: PdfPageCanvas, options: {
  title: string;
  subtitle: string;
  rightTop: string;
  rightMain: string;
  status: string;
  tone: Tone;
}) => {
  page.rectangle(0, 0, A4_WIDTH, 8, { fill: PALETTE.navy });
  page.text("HOUSE OF SOCIAL  /  WEEKLY MANAGEMENT", PAGE_MARGIN, 28, { size: 7, font: "F2", fill: PALETTE.green });
  page.text(options.title, PAGE_MARGIN, 45, { size: 24, font: "F2", fill: PALETTE.ink });
  page.text(options.subtitle, PAGE_MARGIN, 76, { size: 8.5, fill: PALETTE.muted });
  page.text(options.rightTop, A4_WIDTH - PAGE_MARGIN, 29, { size: 7, font: "F2", fill: PALETTE.muted, align: "right" });
  page.text(options.rightMain, A4_WIDTH - PAGE_MARGIN, 44, { size: 12, font: "F2", fill: PALETTE.ink, align: "right" });
  const statusWidth = measureText(options.status.toUpperCase(), 7, "F2") + 18;
  page.rectangle(A4_WIDTH - PAGE_MARGIN - statusWidth, 64, statusWidth, 20, { fill: toneBackground(options.tone), stroke: toneColor(options.tone), strokeWidth: 0.6 });
  page.text(options.status.toUpperCase(), A4_WIDTH - PAGE_MARGIN - 9, 70, { size: 7, font: "F2", fill: toneColor(options.tone), align: "right" });
  page.line(PAGE_MARGIN, 96, A4_WIDTH - PAGE_MARGIN, 96, { stroke: PALETTE.navy, strokeWidth: 1.2 });
};

export const drawFooter = (page: PdfPageCanvas, pageNumber: number, totalPages: number, label: string) => {
  page.line(PAGE_MARGIN, 803, A4_WIDTH - PAGE_MARGIN, 803, { stroke: PALETTE.line, strokeWidth: 0.7 });
  page.text(`House of Social  /  ${label}`, PAGE_MARGIN, 813, { size: 6.6, fill: PALETTE.muted });
  page.text(`Page ${pageNumber} of ${totalPages}`, A4_WIDTH - PAGE_MARGIN, 813, { size: 6.6, font: "F2", fill: PALETTE.muted, align: "right" });
};

export const drawSectionTitle = (page: PdfPageCanvas, title: string, top: number, meta = "") => {
  page.text(title, PAGE_MARGIN, top, { size: 12.5, font: "F2", fill: PALETTE.ink });
  if (meta) page.text(meta, A4_WIDTH - PAGE_MARGIN, top + 2, { size: 7, fill: PALETTE.muted, align: "right" });
  page.line(PAGE_MARGIN, top + 20, A4_WIDTH - PAGE_MARGIN, top + 20, { stroke: PALETTE.line, strokeWidth: 0.6 });
  return top + 30;
};

export const drawMetricCard = (page: PdfPageCanvas, x: number, top: number, width: number, label: string, value: string, detail: string, status?: { text: string; tone: Tone }) => {
  const tone = status?.tone ?? "good";
  page.rectangle(x, top, width, 92, { fill: PALETTE.panel, stroke: PALETTE.line, strokeWidth: 0.7 });
  page.rectangle(x, top, 4, 92, { fill: toneColor(tone) });
  page.text(label.toUpperCase(), x + 14, top + 12, { size: 6.7, font: "F2", fill: PALETTE.muted });
  page.text(value, x + 14, top + 29, { size: 20, font: "F2", fill: PALETTE.ink });
  page.textBlock(detail, x + 14, top + 56, width - 28, { size: 7.2, fill: PALETTE.muted, lineHeight: 9, maxLines: 2, ellipsis: true });
  if (status) page.text(status.text, x + width - 12, top + 75, { size: 6.4, font: "F2", fill: toneColor(tone), align: "right" });
};

export const drawCard = (page: PdfPageCanvas, x: number, top: number, width: number, height: number, title: string, options: { fill?: PdfColor; accent?: PdfColor } = {}) => {
  page.rectangle(x, top, width, height, { fill: options.fill ?? PALETTE.white, stroke: PALETTE.line, strokeWidth: 0.7 });
  page.rectangle(x, top, 4, height, { fill: options.accent ?? PALETTE.line });
  page.text(title.toUpperCase(), x + 14, top + 12, { size: 6.8, font: "F2", fill: PALETTE.muted });
};

export const drawBullets = (page: PdfPageCanvas, items: string[], x: number, top: number, width: number, options: { size?: number; lineHeight?: number; maxLines?: number } = {}) => {
  const { size = 8, lineHeight = 11, maxLines = 7 } = options;
  let drawTop = top;
  let usedLines = 0;
  for (const item of items) {
    if (usedLines >= maxLines) break;
    const lines = wrapText(item, size, width - 14);
    const allowed = Math.min(lines.length, maxLines - usedLines);
    page.text("•", x, drawTop, { size: 8, font: "F2", fill: PALETTE.orange });
    for (let index = 0; index < allowed; index += 1) page.text(lines[index], x + 12, drawTop + index * lineHeight, { size, fill: PALETTE.ink });
    drawTop += allowed * lineHeight + 3;
    usedLines += allowed;
  }
};

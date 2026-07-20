export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

export type PdfColor = readonly [number, number, number];
export type PdfFontName = "F1" | "F2" | "F3";

const CP1252 = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

const number = (value: number) => Number(value.toFixed(3)).toString();
const color = (value: PdfColor) => value.map(number).join(" ");

const encodeText = (value: string) => {
  const bytes: number[] = [];
  for (const character of value.normalize("NFKC")) {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    if (codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff)) bytes.push(codePoint);
    else if (CP1252.has(codePoint)) bytes.push(CP1252.get(codePoint)!);
    else bytes.push(0x3f);
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
};

const characterWidth = (character: string, bold: boolean) => {
  if (character === " ") return 0.278;
  if (/\d/.test(character)) return 0.556;
  const punctuation: Record<string, number> = {
    ".": 0.278, ",": 0.278, ":": 0.278, ";": 0.278, "!": 0.278, "|": 0.26,
    "'": 0.191, '"': 0.355, "-": 0.333, "–": 0.556, "—": 1, "/": 0.278,
    "\\": 0.278, "(": 0.333, ")": 0.333, "[": 0.278, "]": 0.278, "{": 0.334,
    "}": 0.334, "+": 0.584, "=": 0.584, "%": 0.889, "£": 0.556, "$": 0.556,
    "&": 0.667, "?": 0.556, "@": 1.015, "#": 0.556, "*": 0.389, "_": 0.556,
    "•": 0.35,
  };
  if (punctuation[character] !== undefined) return punctuation[character];
  if (/[A-Z]/.test(character)) {
    const widths: Record<string, number> = { I: 0.278, J: 0.5, M: 0.833, W: 0.944, C: 0.722, D: 0.722, G: 0.778, O: 0.778, Q: 0.778, T: 0.611 };
    return (widths[character] ?? 0.667) + (bold ? 0.015 : 0);
  }
  if (/[a-z]/.test(character)) {
    const widths: Record<string, number> = { i: 0.222, l: 0.222, j: 0.222, f: 0.278, t: 0.278, r: 0.333, m: 0.833, w: 0.722, c: 0.5, s: 0.5 };
    return (widths[character] ?? 0.556) + (bold ? 0.012 : 0);
  }
  return 0.556;
};

export const measureText = (value: string, size: number, font: PdfFontName = "F1") => {
  const bold = font === "F2";
  return [...value].reduce((total, character) => total + characterWidth(character, bold) * size, 0);
};

export const wrapText = (value: string, size: number, maxWidth: number, font: PdfFontName = "F1") => {
  const paragraphs = value.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (paragraphIndex < paragraphs.length - 1) lines.push("");
      return;
    }

    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, size, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measureText(word, size, font) <= maxWidth) {
        line = word;
        continue;
      }

      let fragment = "";
      for (const character of word) {
        if (fragment && measureText(fragment + character, size, font) > maxWidth) {
          lines.push(fragment);
          fragment = character;
        } else {
          fragment += character;
        }
      }
      line = fragment;
    }
    if (line) lines.push(line);
    if (paragraphIndex < paragraphs.length - 1) lines.push("");
  });

  return lines;
};

export class PdfPageCanvas {
  readonly operations: string[] = [];

  rectangle(
    x: number,
    top: number,
    width: number,
    height: number,
    options: { fill?: PdfColor; stroke?: PdfColor; strokeWidth?: number } = {},
  ) {
    const y = A4_HEIGHT - top - height;
    const { fill, stroke, strokeWidth = 1 } = options;
    this.operations.push("q");
    if (fill) this.operations.push(`${color(fill)} rg`);
    if (stroke) this.operations.push(`${color(stroke)} RG ${number(strokeWidth)} w`);
    this.operations.push(`${number(x)} ${number(y)} ${number(width)} ${number(height)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`, "Q");
  }

  line(
    x1: number,
    top1: number,
    x2: number,
    top2: number,
    options: { stroke: PdfColor; strokeWidth?: number },
  ) {
    const strokeWidth = options.strokeWidth ?? 1;
    this.operations.push(`q ${color(options.stroke)} RG ${number(strokeWidth)} w ${number(x1)} ${number(A4_HEIGHT - top1)} m ${number(x2)} ${number(A4_HEIGHT - top2)} l S Q`);
  }

  text(
    value: string,
    x: number,
    top: number,
    options: { size?: number; font?: PdfFontName; fill?: PdfColor; align?: "left" | "right" | "center" } = {},
  ) {
    const { size = 10, font = "F1", fill = [0, 0, 0] as const, align = "left" } = options;
    let drawX = x;
    const width = measureText(value, size, font);
    if (align === "right") drawX -= width;
    else if (align === "center") drawX -= width / 2;
    const y = A4_HEIGHT - top - size;
    this.operations.push(`q ${color(fill)} rg BT /${font} ${number(size)} Tf 1 0 0 1 ${number(drawX)} ${number(y)} Tm <${encodeText(value)}> Tj ET Q`);
  }

  textBlock(
    value: string,
    x: number,
    top: number,
    width: number,
    options: {
      size?: number;
      font?: PdfFontName;
      fill?: PdfColor;
      lineHeight?: number;
      maxLines?: number;
      ellipsis?: boolean;
    } = {},
  ) {
    const { size = 9, font = "F1", fill = [0, 0, 0] as const, lineHeight = size * 1.35, maxLines, ellipsis = false } = options;
    let lines = wrapText(value, size, width, font);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (ellipsis) {
        let lastLine = lines.at(-1) ?? "";
        while (lastLine && measureText(`${lastLine}…`, size, font) > width) lastLine = lastLine.slice(0, -1);
        lines[lines.length - 1] = `${lastLine}…`;
      }
    }
    lines.forEach((line, index) => this.text(line, x, top + index * lineHeight, { size, font, fill }));
    return lines.length * lineHeight;
  }
}

export const buildPdfDocument = (pages: PdfPageCanvas[]) => {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>";

  const pageReferences: string[] = [];
  pages.forEach((page, index) => {
    const pageObject = 6 + index * 2;
    const contentObject = pageObject + 1;
    const stream = page.operations.join("\n");
    pageReferences.push(`${pageObject} 0 R`);
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(A4_WIDTH)} ${number(A4_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageReferences.join(" ")}] >>`;

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let index = 1; index < objects.length; index += 1) {
    const object = Buffer.from(`${index} 0 obj\n${objects[index]}\nendobj\n`, "binary");
    offsets[index] = offset;
    chunks.push(object);
    offset += object.length;
  }

  const xrefOffset = offset;
  let crossReference = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    crossReference += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  chunks.push(Buffer.from(`${crossReference}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "ascii"));
  return Buffer.concat(chunks);
};

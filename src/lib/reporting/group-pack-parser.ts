import {
  normaliseSiteName,
  parseCreditsOverview,
  parseCsv,
  parseGoodsDelivered,
  parseRotaCloudLabour,
  type SourcePeriod,
} from "@/lib/reporting/imports";
import { classifyWeeklyPackFile, type ParsedPackFile } from "@/lib/reporting/pack-parser";
import { parseRotaCloudHourlyCoverage } from "@/lib/reporting/rotacloud-hourly";

const normaliseHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanHeader = (value: string) => value.replace(/^\uFEFF/, "").trim();
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const siteHeaderCandidates = [
  "location",
  "site",
  "site name",
  "purchaser site",
  "purchaser unit",
  "purchaser unit name",
  "kitchen",
  "outlet",
  "venue",
  "unit",
  "store",
  "revenue centre",
  "revenue center",
];
const dateHeaderCandidates = ["business date", "trading date", "work date", "shift date", "date", "day"];
const netSalesHeaderCandidates = ["net sales", "net revenue", "net total", "sales net"];
const grossSalesHeaderCandidates = ["gross sales", "gross revenue", "gross total", "sales gross"];

const findHeader = (headers: string[], candidates: string[]) => {
  const wanted = new Set(candidates.map(normaliseHeader));
  return headers.find((header) => wanted.has(normaliseHeader(header)));
};

const parseMoney = (value: string) => {
  const text = value.trim();
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[£,$\s()]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
};

const isoDate = (value: string) => {
  const text = value.trim();
  const uk = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
};

const csvCell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const toCsv = (headers: string[], rows: string[][]) => [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

const meaningfulSite = (value: string) => {
  const clean = value.trim();
  if (!clean) return false;
  return !/^(all|all locations?|all sites?|total|grand total|group|house of social|hos)$/i.test(clean);
};

const rotaLocationHeader = (header: string) => {
  const explicit = header.match(/^Location:\s*(.+?)\s*\((Hours|Cost)\)$/i);
  if (explicit) return { siteName: explicit[1].trim(), kind: explicit[2].toLowerCase() as "hours" | "cost" };

  if (/^(Role|Department|Area|Position|Job):/i.test(header)) return null;
  const loose = header.match(/^(.+?)\s+(Hours|Cost)$/i) ?? header.match(/^(.+?)\s*\((Hours|Cost)\)$/i);
  if (!loose) return null;
  return { siteName: loose[1].trim(), kind: loose[2].toLowerCase() as "hours" | "cost" };
};

/**
 * Expands one physical Group Chef source file into one parsed result per kitchen.
 * Single-kitchen files remain supported through the existing parser.
 */
export function parseGroupWeeklyPackFile(fileName: string, content: string, expected: SourcePeriod): ParsedPackFile[] {
  const rows = parseCsv(content);
  const headers = (rows[0] ?? []).map(cleanHeader);

  if (headers.length > 0) {
    const goods = splitGoodsPurchased(headers, rows.slice(1), expected);
    if (goods) return goods;

    const credits = splitCreditsOverview(headers, rows.slice(1), expected);
    if (credits) return credits;

    const rota = splitRotaCloud(fileName, headers, rows.slice(1), expected);
    if (rota) return rota;

    const sales = splitGroupSales(headers, rows.slice(1), expected);
    if (sales) return sales;
  }

  return [classifyWeeklyPackFile(fileName, content, expected)];
}

function splitGoodsPurchased(headers: string[], rows: string[][], expected: SourcePeriod): ParsedPackFile[] | null {
  const siteHeader = findHeader(headers, ["Purchaser Unit Name", "Purchaser site", "Purchaser Unit", "Site", "Location"]);
  const dateHeader = findHeader(headers, ["Date Delivered", "Delivery Date", "Date of Delivery", "Requested Delivery", "Invoice Date", "Order Invoice Date"]);
  const valueHeader = findHeader(headers, ["Total Price Net", "Line Net Value", "Goods Net Value", "Total Net", "Net Value", "PO Net Value", "Invoice Net Value"]);
  if (!siteHeader || !dateHeader || !valueHeader) return null;
  const groups = groupRows(headers, rows, siteHeader);
  if (groups.size <= 1) return null;

  return [...groups.entries()].map(([siteName, siteRows]) => {
    try {
      const result = parseGoodsDelivered(toCsv(headers, siteRows), expected);
      return {
        classification: "procure_goods",
        parseStatus: "parsed",
        siteHint: result.siteName || siteName,
        periodStart: result.period.start,
        periodEnd: result.period.end,
        summary: { purchases: result.purchases, awaitingInvoice: result.awaitingInvoice, rowCount: result.rowCount, groupWideSource: true },
        error: "",
      };
    } catch (error) {
      return parsedError("procure_goods", siteName, error);
    }
  });
}

function splitCreditsOverview(headers: string[], rows: string[][], expected: SourcePeriod): ParsedPackFile[] | null {
  const siteHeader = findHeader(headers, ["Purchaser site", "Purchaser Unit", "Purchaser Unit Name", "Site", "Location"]);
  const noteValueHeader = findHeader(headers, ["Credit note total", "Credit Note Net Value", "Credit Note Total Value", "Credit Note Value"]);
  const requestValueHeader = findHeader(headers, ["Credit request net value", "Credit Request Net Value", "Credit Request Total", "Credit Request Value"]);
  if (!siteHeader || (!noteValueHeader && !requestValueHeader)) return null;
  const groups = groupRows(headers, rows, siteHeader);
  if (groups.size <= 1) return null;

  return [...groups.entries()].map(([siteName, siteRows]) => {
    try {
      const result = parseCreditsOverview(toCsv(headers, siteRows), expected);
      return {
        classification: "procure_credits",
        parseStatus: "parsed",
        siteHint: result.siteName || siteName,
        periodStart: expected.start,
        periodEnd: expected.end,
        summary: {
          confirmedCredits: result.confirmedCredits,
          pendingCredits: result.pendingCredits,
          confirmedCount: result.confirmedCount,
          pendingCount: result.pendingCount,
          groupWideSource: true,
        },
        error: "",
      };
    } catch (error) {
      return parsedError("procure_credits", siteName, error);
    }
  });
}

function splitRotaCloud(fileName: string, headers: string[], rows: string[][], expected: SourcePeriod): ParsedPackFile[] | null {
  const looksLikeRota = /rotacloud|rota cloud|daily[_ -]?totals/i.test(fileName)
    || headers.some((header) => /wage cost|staff cost|labour cost|labor cost|paid hours|total hours|total cost|total shifts/i.test(header));
  if (!looksLikeRota) return null;

  const rowSiteHeader = findHeader(headers, siteHeaderCandidates);
  if (rowSiteHeader) {
    const groups = groupRows(headers, rows, rowSiteHeader);
    if (groups.size > 1) {
      return [...groups.entries()].map(([siteName, siteRows]) => parseRotaSite(siteName, toCsv(headers, siteRows), expected));
    }
  }

  const wideLocations = new Map<string, { hours?: number; cost?: number }>();
  headers.forEach((header, index) => {
    const parsedHeader = rotaLocationHeader(header);
    if (!parsedHeader) return;
    const { siteName, kind } = parsedHeader;
    if (/^(total|paid|estimated|wage|staff|labour|labor|shift)$/i.test(siteName) || !meaningfulSite(siteName)) return;
    const current = wideLocations.get(siteName) ?? {};
    if (kind === "hours") current.hours = index;
    if (kind === "cost") current.cost = index;
    wideLocations.set(siteName, current);
  });
  if (wideLocations.size <= 1) return null;

  const locationColumnIndexes = new Set([...wideLocations.values()].flatMap((value) => [value.hours, value.cost].filter((item): item is number => item != null)));
  const sharedIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => !locationColumnIndexes.has(index) && !/^(total )?(paid )?hours$|^(total |estimated )?(wage |staff |labour |labor )?cost$/i.test(header));

  return [...wideLocations.entries()].map(([siteName, columns]) => {
    const siteHeaders = [...sharedIndexes.map(({ header }) => header), "Location", "Paid Hours", "Total Cost"];
    const siteRows = rows.map((row) => [
      ...sharedIndexes.map(({ index }) => row[index] ?? ""),
      siteName,
      columns.hours == null ? "" : row[columns.hours] ?? "",
      columns.cost == null ? "" : row[columns.cost] ?? "",
    ]);
    return parseRotaSite(siteName, toCsv(siteHeaders, siteRows), expected);
  });
}

function parseRotaSite(siteName: string, content: string, expected: SourcePeriod): ParsedPackFile {
  try {
    const result = parseRotaCloudLabour(content, expected);
    const hourlyLabour = parseRotaCloudHourlyCoverage(content, expected);
    return {
      classification: "rotacloud_labour",
      parseStatus: "parsed",
      siteHint: result.siteName || siteName,
      periodStart: result.period?.start ?? expected.start,
      periodEnd: result.period?.end ?? expected.end,
      summary: { staffCost: result.staffCost, paidHours: result.paidHours, hourlyRows: hourlyLabour.length, hourlyLabour, groupWideSource: true },
      error: "",
    };
  } catch (error) {
    return parsedError("rotacloud_labour", siteName, error);
  }
}

function splitGroupSales(headers: string[], rows: string[][], expected: SourcePeriod): ParsedPackFile[] | null {
  const siteHeader = findHeader(headers, siteHeaderCandidates);
  const netHeader = findHeader(headers, netSalesHeaderCandidates);
  if (!siteHeader || !netHeader) return null;
  const grossHeader = findHeader(headers, grossSalesHeaderCandidates);
  const dateHeader = findHeader(headers, dateHeaderCandidates);
  const groups = groupRows(headers, rows, siteHeader);
  if (groups.size <= 1) return null;

  const siteIndex = headers.indexOf(siteHeader);
  const netIndex = headers.indexOf(netHeader);
  const grossIndex = grossHeader ? headers.indexOf(grossHeader) : -1;
  const dateIndex = dateHeader ? headers.indexOf(dateHeader) : -1;

  return [...groups.entries()].map(([siteName, siteRows]) => {
    const datedRows = siteRows.map((row) => ({ row, date: dateIndex >= 0 ? isoDate(row[dateIndex] ?? "") : null }));
    const parsedDates = datedRows.map(({ date }) => date).filter((date): date is string => Boolean(date));
    if (parsedDates.some((date) => date < expected.start || date > expected.end)) {
      return parsedError("sales_eow", siteName, new Error(`The group sales export includes dates outside ${expected.start} to ${expected.end}.`));
    }
    if (siteRows.length > 1 && dateIndex < 0) {
      return parsedError("sales_eow", siteName, new Error("This group sales export has multiple rows per kitchen but no business-date column, so it was not totalled automatically."));
    }

    let netSales = 0;
    let grossSales = 0;
    let validRows = 0;
    for (const row of siteRows) {
      if (!meaningfulSite(row[siteIndex] ?? "")) continue;
      const net = parseMoney(row[netIndex] ?? "");
      if (net == null) continue;
      netSales += net;
      const gross = grossIndex >= 0 ? parseMoney(row[grossIndex] ?? "") : null;
      grossSales += gross ?? net;
      validRows += 1;
    }
    if (!validRows || netSales <= 0) return parsedError("sales_eow", siteName, new Error("No positive net-sales rows were found for this kitchen."));

    return {
      classification: "sales_eow",
      parseStatus: "parsed",
      siteHint: siteName,
      periodStart: parsedDates.length ? [...parsedDates].sort()[0] : expected.start,
      periodEnd: parsedDates.length ? [...parsedDates].sort().at(-1)! : expected.end,
      summary: { netSales: roundMoney(netSales), grossSales: roundMoney(grossSales), rowCount: validRows, groupWideSource: true },
      error: "",
    };
  });
}

function groupRows(headers: string[], rows: string[][], siteHeader: string) {
  const siteIndex = headers.indexOf(siteHeader);
  const groups = new Map<string, string[][]>();
  for (const row of rows) {
    const rawSite = row[siteIndex]?.trim() ?? "";
    if (!meaningfulSite(rawSite)) continue;
    const key = [...groups.keys()].find((existing) => normaliseSiteName(existing) === normaliseSiteName(rawSite)) ?? rawSite;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return groups;
}

function parsedError(classification: ParsedPackFile["classification"], siteHint: string, error: unknown): ParsedPackFile {
  return {
    classification,
    parseStatus: "error",
    siteHint,
    periodStart: null,
    periodEnd: null,
    summary: {},
    error: error instanceof Error ? error.message : "This kitchen could not be parsed from the group export.",
  };
}

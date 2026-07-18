export type SourcePeriod = { start: string; end: string };

export type SalesImportResult = {
  siteName: string;
  period: SourcePeriod;
  grossAfterAdjustments: number;
  vat: number;
  serviceCharge: number;
  netSales: number;
};

export type PurchasingImportResult = {
  siteName: string;
  period: SourcePeriod;
  purchases: number;
  awaitingInvoice: number;
  rowCount: number;
};

export type CreditsImportResult = {
  siteName: string;
  confirmedCredits: number;
  pendingCredits: number;
  confirmedCount: number;
  pendingCount: number;
};

export type LabourImportResult = {
  siteName?: string;
  staffCost: number;
  paidHours: number;
  costColumn: string;
  hoursColumn?: string;
  period?: SourcePeriod;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const decodeHtml = (value: string) => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&pound;/gi, "£")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, " ")
  .trim();

const parseMoney = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[£,$\s()]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
};

const toIsoDate = (value: string) => {
  const uk = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : undefined;
};

const assertExpectedPeriod = (actual: SourcePeriod, expected: SourcePeriod, source: string) => {
  if (actual.start !== expected.start || actual.end !== expected.end) {
    throw new Error(`${source} covers ${actual.start} to ${actual.end}; select ${expected.start} to ${expected.end}.`);
  }
};

const normaliseHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const rowsAsRecords = (input: string) => {
  const [headers = [], ...rows] = parseCsv(input);
  const seen = new Map<string, number>();
  const cleanHeaders = headers.map((header) => {
    const clean = header.replace(/^\uFEFF/, "").trim();
    const count = (seen.get(clean) ?? 0) + 1;
    seen.set(clean, count);
    return count === 1 ? clean : `${clean}__${count}`;
  });
  return {
    headers: cleanHeaders,
    records: rows.map((row) => Object.fromEntries(cleanHeaders.map((header, index) => [header, row[index] ?? ""]))),
  };
};

const getValue = (record: Record<string, string>, header: string) => {
  const match = Object.keys(record).find((key) => normaliseHeader(key) === normaliseHeader(header));
  return match ? record[match] : "";
};

export function parseStockLinkEndOfWeek(input: string, expected: SourcePeriod): SalesImportResult {
  if (!/<html[\s>]/i.test(input) || !/End Of Week Report/i.test(input)) {
    throw new Error("This is not a recognised StockLink End of Week export.");
  }
  const title = decodeHtml(input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? input.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const titleMatch = title.match(/End Of Week Report For (.+?) From (\d{1,2}\/\d{1,2}\/\d{4}) To (\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (!titleMatch) throw new Error("The StockLink site or reporting dates could not be read.");
  const period = { start: toIsoDate(titleMatch[2])!, end: toIsoDate(titleMatch[3])! };
  assertExpectedPeriod(period, expected, "The StockLink report");

  let section = "";
  let grossAfterAdjustments = 0;
  let vat = 0;
  let serviceCharge = 0;
  const rows = [...input.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => decodeHtml(cell[1]));
    const label = cells[0] ?? "";
    if (/colspan\s*=\s*['"]?3/i.test(row[1]) || /^(Gross Sales After Adjustment|Vat|Adjustments)$/i.test(label)) {
      section = label.toLowerCase();
      continue;
    }
    const numericValues = cells.slice(1).map(parseMoney).filter((value, index) => value !== 0 || /(?:^|\D)0(?:\.0+)?(?:\D|$)/.test(cells[index + 1] ?? ""));
    const total = numericValues.at(-1) ?? 0;
    if (section === "gross sales after adjustment" && /^Total$/i.test(label)) grossAfterAdjustments = total;
    if (section === "vat" && /^Total$/i.test(label)) vat = total;
    if (section === "adjustments" && /^Service Charge$/i.test(label)) serviceCharge = total;
  }
  if (grossAfterAdjustments <= 0 || vat < 0) throw new Error("The StockLink sales and VAT totals could not be read.");
  const netSales = roundMoney(grossAfterAdjustments - vat - Math.max(serviceCharge, 0));
  if (netSales <= 0) throw new Error("The calculated StockLink net-sales figure is not valid.");
  return {
    siteName: titleMatch[1].trim(),
    period,
    grossAfterAdjustments: roundMoney(grossAfterAdjustments),
    vat: roundMoney(vat),
    serviceCharge: roundMoney(serviceCharge),
    netSales,
  };
}

export function parseGoodsDelivered(input: string, expected: SourcePeriod): PurchasingImportResult {
  const { headers, records } = rowsAsRecords(input);
  const required = ["Purchaser Unit Name", "Date Delivered", "Category", "Order Status", "Total Price Net"];
  if (!required.every((header) => headers.some((value) => normaliseHeader(value) === normaliseHeader(header)))) {
    throw new Error("This is not a recognised Procure Wizard Goods Delivered export.");
  }
  const sites = new Set<string>();
  const deliveredDates: string[] = [];
  let purchases = 0;
  let awaitingInvoice = 0;
  let rowCount = 0;
  for (const record of records) {
    const category = getValue(record, "Category").trim().toLowerCase();
    if (category !== "food") continue;
    const date = toIsoDate(getValue(record, "Date Delivered"));
    if (!date) continue;
    deliveredDates.push(date);
    sites.add(getValue(record, "Purchaser Unit Name").trim());
    if (date < expected.start || date > expected.end) continue;
    const status = getValue(record, "Order Status");
    if (/cancelled|canceled|rejected/i.test(status)) continue;
    const value = parseMoney(getValue(record, "Total Price Net"));
    purchases += value;
    if (/awaiting invoice/i.test(status)) awaitingInvoice += value;
    rowCount += 1;
  }
  if (sites.size !== 1) throw new Error("The Goods Delivered export must contain exactly one kitchen.");
  if (!deliveredDates.length || !rowCount) throw new Error("No delivered Food rows were found for this reporting week.");
  const actual = { start: [...deliveredDates].sort()[0], end: [...deliveredDates].sort().at(-1)! };
  if (actual.start < expected.start || actual.end > expected.end) {
    throw new Error(`The Goods Delivered export includes dates outside ${expected.start} to ${expected.end}.`);
  }
  return {
    siteName: [...sites][0],
    period: expected,
    purchases: roundMoney(purchases),
    awaitingInvoice: roundMoney(awaitingInvoice),
    rowCount,
  };
}

export function parseCreditsOverview(input: string, expected: SourcePeriod): CreditsImportResult {
  const { headers, records } = rowsAsRecords(input);
  const required = ["Credit Request Date", "Credit Note Date", "Order Status", "Purchaser Unit", "Credit Note Net Value"];
  if (!required.every((header) => headers.some((value) => normaliseHeader(value) === normaliseHeader(header)))) {
    throw new Error("This is not a recognised Procure Wizard Credits Overview export.");
  }
  const sites = new Set<string>();
  let confirmedCredits = 0;
  let pendingCredits = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  for (const record of records) {
    const site = getValue(record, "Purchaser Unit").trim();
    if (site) sites.add(site);
    const status = getValue(record, "Order Status");
    const noteDate = toIsoDate(getValue(record, "Credit Note Date"));
    const requestDate = toIsoDate(getValue(record, "Credit Request Date"));
    const noteValue = Math.abs(parseMoney(getValue(record, "Credit Note Net Value")));
    const requestValue = Math.abs(parseMoney(getValue(record, "Credit Request Net Value")) || noteValue);
    if (noteDate && noteDate >= expected.start && noteDate <= expected.end && !/cancelled|canceled|rejected|pending|investigation/i.test(status)) {
      confirmedCredits += noteValue;
      confirmedCount += 1;
    } else if (requestDate && requestDate >= expected.start && requestDate <= expected.end && /pending|investigation|requested|query/i.test(status)) {
      pendingCredits += requestValue;
      pendingCount += 1;
    }
  }
  if (sites.size > 1) throw new Error("The Credits Overview export must contain one kitchen only.");
  return {
    siteName: [...sites][0] ?? "",
    confirmedCredits: roundMoney(confirmedCredits),
    pendingCredits: roundMoney(pendingCredits),
    confirmedCount,
    pendingCount,
  };
}

const findHeader = (headers: string[], candidates: string[]) => {
  const normalisedCandidates = candidates.map(normaliseHeader);
  return headers.find((header) => normalisedCandidates.includes(normaliseHeader(header)))
    ?? headers.find((header) => normalisedCandidates.some((candidate) => normaliseHeader(header).includes(candidate)));
};

export function parseRotaCloudLabour(input: string, expected: SourcePeriod): LabourImportResult {
  const { headers, records } = rowsAsRecords(input);
  const costColumn = findHeader(headers, [
    "total wage cost", "estimated wage cost", "wage cost", "staff cost", "labour cost", "labor cost", "total cost", "shift cost", "cost",
  ]);
  if (!costColumn) throw new Error("No recognised wage-cost column was found. Enter the aggregate RotaCloud total manually and keep the file as supporting evidence.");
  const hoursColumn = findHeader(headers, ["total paid hours", "paid hours", "total hours", "hours"]);
  const dateColumn = findHeader(headers, ["shift date", "work date", "date"]);
  const employeeColumn = headers.find((header) => normaliseHeader(header) === "employee");
  const locationColumn = headers.find((header) => normaliseHeader(header) === "location");
  const isDailyTotals = headers.some((header) => normaliseHeader(header) === "totalshifts")
    && headers.some((header) => normaliseHeader(header) === "totalcost");
  const headerLocations = headers.flatMap((header) => header.match(/^Location:\s*(.+?)\s*\((?:Hours|Cost)\)$/i)?.[1]?.trim() ?? []);
  const rowLocations = locationColumn
    ? records.map((record) => record[locationColumn]?.trim()).filter((value): value is string => Boolean(value))
    : [];
  const locations = [...new Set([...headerLocations, ...rowLocations])];
  if (locations.length > 1) throw new Error("The RotaCloud export must contain exactly one kitchen.");

  const labelColumn = headers.find((header) => /name|employee|staff|summary|description/i.test(header));
  const totalRows = records.filter((record) => labelColumn && /\btotal\b/i.test(record[labelColumn] ?? ""));
  const employeeShiftRows = employeeColumn ? records.filter((record) => Boolean(record[employeeColumn]?.trim())) : [];
  const rowsToUse = totalRows.length ? [totalRows.at(-1)!] : employeeShiftRows.length ? employeeShiftRows : records;
  const staffCost = roundMoney(rowsToUse.reduce((sum, record) => sum + parseMoney(record[costColumn]), 0));
  const paidHours = hoursColumn ? roundMoney(rowsToUse.reduce((sum, record) => sum + parseMoney(record[hoursColumn]), 0)) : 0;
  if (staffCost <= 0) throw new Error("The RotaCloud export did not contain a positive aggregate wage cost.");
  let period: SourcePeriod | undefined;
  if (dateColumn) {
    const dates = records.map((record) => toIsoDate(record[dateColumn])).filter((value): value is string => Boolean(value)).sort();
    if (dates.length) {
      period = { start: dates[0], end: dates.at(-1)! };
      if (period.start < expected.start || period.end > expected.end) {
        throw new Error(`The RotaCloud export includes dates outside ${expected.start} to ${expected.end}.`);
      }
      if (isDailyTotals) assertExpectedPeriod(period, expected, "The RotaCloud Daily Totals report");
    }
  }
  return { siteName: locations[0], staffCost, paidHours, costColumn, hoursColumn, period };
}

export function normaliseSiteName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

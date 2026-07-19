import type { SalesCategoryInput, SalesDayInput, SalesInsightsInput, SalesItemInput } from "@/lib/types";
import type { SourcePeriod } from "@/lib/reporting/imports";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
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

const parseNumber = (value: string) => {
  const text = value.trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[£,$%\s()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
};

const dateRange = (period: SourcePeriod) => {
  const dates: string[] = [];
  const cursor = new Date(`${period.start}T12:00:00Z`);
  const end = new Date(`${period.end}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const toIsoDate = (value: string, expectedDates: string[]) => {
  const clean = value.trim();
  const uk = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (uk) {
    const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return `${year}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  }
  const short = clean.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (short) return expectedDates.find((date) => Number(date.slice(8, 10)) === Number(short[1]) && Number(date.slice(5, 7)) === Number(short[2]));
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const weekday = normalise(clean).slice(0, 3);
  const weekdayIndex = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekday);
  return weekdayIndex >= 0 ? expectedDates.find((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === weekdayIndex) : undefined;
};

type HtmlRow = { cells: string[]; raw: string };
const htmlRows = (input: string): HtmlRow[] => [...input.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => ({
  raw: match[1],
  cells: [...match[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) => decodeHtml(cell[1])),
})).filter((row) => row.cells.length > 0);
const tableRows = (input: string) => [...input.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((table) => htmlRows(table[1]));
const headerIndex = (headers: string[], candidates: string[]) => headers.findIndex((header) => candidates.some((candidate) => normalise(header).includes(normalise(candidate))));
const isTotal = (value: string) => /^(grand\s+)?total$/i.test(value.trim());

function reconciles(days: SalesDayInput[], weeklyNetSales: number) {
  if (!days.length || weeklyNetSales <= 0) return true;
  const extractedTotal = days.reduce((sum, day) => sum + day.netSales, 0);
  return extractedTotal <= 0 || Math.abs(extractedTotal - weeklyNetSales) <= Math.max(5, weeklyNetSales * 0.02);
}

function matrixDailyInsights(rows: HtmlRow[], expected: SourcePeriod, weeklyNetSales: number): SalesDayInput[] {
  const dates = dateRange(expected);
  let dateColumns = new Map<number, string>();
  let section = "";
  const gross = new Map<string, number>();
  const vat = new Map<string, number>();
  const service = new Map<string, number>();
  const directNet = new Map<string, number>();
  const transactions = new Map<string, number>();
  const covers = new Map<string, number>();
  const assignValues = (target: Map<string, number>, cells: string[]) => {
    if (dateColumns.size >= 3) {
      for (const [index, date] of dateColumns) target.set(date, parseNumber(cells[index] ?? ""));
      return;
    }
    const numericCells = cells.slice(1).map(parseNumber);
    const probable = numericCells.length >= dates.length ? numericCells.slice(0, dates.length) : [];
    probable.forEach((value, index) => target.set(dates[index], value));
  };
  for (const row of rows) {
    const recognisedDates = row.cells.map((cell, index) => [index, toIsoDate(cell, dates)] as const).filter((entry): entry is readonly [number, string] => Boolean(entry[1] && dates.includes(entry[1])));
    if (recognisedDates.length >= 3) { dateColumns = new Map(recognisedDates); continue; }
    const label = row.cells[0]?.trim() ?? "";
    const rowHasNumbers = row.cells.slice(1).some((cell) => /\d/.test(cell));
    if (!rowHasNumbers && label) { section = normalise(label); continue; }
    const context = `${section}${normalise(label)}`;
    if ((section.includes("grosssalesafteradjustment") || context.includes("grosssalesafteradjustment")) && isTotal(label)) assignValues(gross, row.cells);
    else if ((section === "vat" || section.includes("vat")) && isTotal(label)) assignValues(vat, row.cells);
    else if (section.includes("adjustment") && /servicecharge/i.test(label)) assignValues(service, row.cells);
    else if (/netsales|nettakings|netrevenue/i.test(`${section} ${label}`) && (isTotal(label) || /netsales|nettakings|netrevenue/i.test(label))) assignValues(directNet, row.cells);
    else if (/transaction|orders|checks|bills|receipts/i.test(`${section} ${label}`) && !/value|sales|amount/i.test(label)) assignValues(transactions, row.cells);
    else if (/covers|guests|customers/i.test(`${section} ${label}`) && !/value|sales|amount/i.test(label)) assignValues(covers, row.cells);
  }
  if (!dates.some((date) => gross.has(date) || directNet.has(date))) return [];
  const result = dates.map((date) => ({
    businessDate: date,
    grossSales: roundMoney(gross.get(date) ?? directNet.get(date) ?? 0),
    netSales: roundMoney(directNet.get(date) ?? Math.max((gross.get(date) ?? 0) - (vat.get(date) ?? 0) - Math.max(service.get(date) ?? 0, 0), 0)),
    transactions: Math.max(0, Math.round(transactions.get(date) ?? 0)),
    covers: Math.max(0, Math.round(covers.get(date) ?? 0)),
  }));
  return reconciles(result, weeklyNetSales) ? result : [];
}

function tabularDailyInsights(tables: HtmlRow[][], expected: SourcePeriod): SalesDayInput[] {
  const dates = dateRange(expected);
  for (const rows of tables) {
    for (let headerRow = 0; headerRow < Math.min(rows.length, 8); headerRow += 1) {
      const headers = rows[headerRow].cells;
      const dateColumn = headerIndex(headers, ["business date", "trading date", "date", "day"]);
      const netColumn = headerIndex(headers, ["net sales", "net takings", "net revenue"]);
      const grossColumn = headerIndex(headers, ["gross sales", "gross takings", "gross revenue"]);
      if (dateColumn < 0 || (netColumn < 0 && grossColumn < 0)) continue;
      const transactionColumn = headerIndex(headers, ["transactions", "orders", "checks", "bills", "receipts"]);
      const coversColumn = headerIndex(headers, ["covers", "guests", "customers"]);
      const parsed = rows.slice(headerRow + 1).flatMap((row) => {
        const date = toIsoDate(row.cells[dateColumn] ?? "", dates);
        if (!date || !dates.includes(date) || isTotal(row.cells[dateColumn] ?? "")) return [];
        const grossSales = grossColumn >= 0 ? parseNumber(row.cells[grossColumn] ?? "") : parseNumber(row.cells[netColumn] ?? "");
        const netSales = netColumn >= 0 ? parseNumber(row.cells[netColumn] ?? "") : grossSales;
        return [{ businessDate: date, grossSales: roundMoney(grossSales), netSales: roundMoney(netSales), transactions: transactionColumn >= 0 ? Math.max(0, Math.round(parseNumber(row.cells[transactionColumn] ?? ""))) : 0, covers: coversColumn >= 0 ? Math.max(0, Math.round(parseNumber(row.cells[coversColumn] ?? ""))) : 0 }];
      });
      if (parsed.length >= 2) return parsed.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    }
  }
  return [];
}

function itemAndCategoryInsights(tables: HtmlRow[][]): { items: SalesItemInput[]; categories: SalesCategoryInput[] } {
  const items: SalesItemInput[] = [];
  const categories: SalesCategoryInput[] = [];
  for (const rows of tables) {
    for (let headerRow = 0; headerRow < Math.min(rows.length, 10); headerRow += 1) {
      const headers = rows[headerRow].cells;
      const itemColumn = headerIndex(headers, ["item name", "product name", "menu item", "product", "item", "description"]);
      const categoryColumn = headerIndex(headers, ["category", "department", "dept", "group", "family"]);
      const quantityColumn = headerIndex(headers, ["quantity sold", "qty sold", "quantity", "qty", "units"]);
      const salesColumn = headerIndex(headers, ["net sales", "sales value", "net value", "revenue", "sales"]);
      if (salesColumn < 0 || (itemColumn < 0 && categoryColumn < 0)) continue;
      const body = rows.slice(headerRow + 1);
      if (itemColumn >= 0) {
        for (const row of body) {
          const itemName = (row.cells[itemColumn] ?? "").trim();
          if (!itemName || isTotal(itemName)) continue;
          const netSales = parseNumber(row.cells[salesColumn] ?? "");
          const quantity = quantityColumn >= 0 ? parseNumber(row.cells[quantityColumn] ?? "") : 0;
          if (netSales <= 0 && quantity <= 0) continue;
          items.push({ itemName: itemName.slice(0, 180), category: (categoryColumn >= 0 ? row.cells[categoryColumn] : "")?.trim().slice(0, 120) || "Uncategorised", quantity: Math.max(0, roundMoney(quantity)), netSales: Math.max(0, roundMoney(netSales)) });
        }
      } else if (categoryColumn >= 0) {
        for (const row of body) {
          const category = (row.cells[categoryColumn] ?? "").trim();
          if (!category || isTotal(category)) continue;
          const netSales = parseNumber(row.cells[salesColumn] ?? "");
          const quantity = quantityColumn >= 0 ? parseNumber(row.cells[quantityColumn] ?? "") : 0;
          if (netSales <= 0 && quantity <= 0) continue;
          categories.push({ category: category.slice(0, 120), quantity: Math.max(0, roundMoney(quantity)), netSales: Math.max(0, roundMoney(netSales)) });
        }
      }
    }
  }
  const dedupeItems = new Map<string, SalesItemInput>();
  for (const item of items) {
    const key = `${normalise(item.category)}:${normalise(item.itemName)}`;
    const current = dedupeItems.get(key);
    dedupeItems.set(key, current ? { ...current, quantity: roundMoney(current.quantity + item.quantity), netSales: roundMoney(current.netSales + item.netSales) } : item);
  }
  const dedupeCategories = new Map<string, SalesCategoryInput>();
  for (const category of categories) {
    const key = normalise(category.category);
    const current = dedupeCategories.get(key);
    dedupeCategories.set(key, current ? { ...current, quantity: roundMoney(current.quantity + category.quantity), netSales: roundMoney(current.netSales + category.netSales) } : category);
  }
  if (!dedupeCategories.size && dedupeItems.size) {
    for (const item of dedupeItems.values()) {
      const key = normalise(item.category);
      const current = dedupeCategories.get(key);
      dedupeCategories.set(key, current ? { ...current, quantity: roundMoney(current.quantity + item.quantity), netSales: roundMoney(current.netSales + item.netSales) } : { category: item.category, quantity: item.quantity, netSales: item.netSales });
    }
  }
  return {
    items: [...dedupeItems.values()].sort((a, b) => b.netSales - a.netSales || b.quantity - a.quantity).slice(0, 100),
    categories: [...dedupeCategories.values()].sort((a, b) => b.netSales - a.netSales).slice(0, 40),
  };
}

export function parseStockLinkSalesInsights(input: string, expected: SourcePeriod, weeklyNetSales: number): SalesInsightsInput {
  if (!/<html[\s>]/i.test(input)) return { days: [], items: [], categories: [] };
  const rows = htmlRows(input);
  const tables = tableRows(input);
  const tabularDays = tabularDailyInsights(tables, expected);
  const days = reconciles(tabularDays, weeklyNetSales) ? tabularDays : [];
  const safeDays = days.length ? days : matrixDailyInsights(rows, expected, weeklyNetSales);
  const { items, categories } = itemAndCategoryInsights(tables);
  return { days: safeDays, items, categories };
}

import type { SalesCategoryInput, SalesDayInput, SalesItemInput } from "@/lib/types";

export type SalesDayInsight = SalesDayInput & {
  dayLabel: string;
  atv: number | null;
  salesPerCover: number | null;
  salesVsDailyAveragePct: number | null;
};

export type SalesCategoryInsight = SalesCategoryInput & { mixPct: number };

export type SalesInsights = {
  available: boolean;
  hasDailySales: boolean;
  hasTransactions: boolean;
  hasCovers: boolean;
  hasItemMix: boolean;
  totalNetSales: number;
  totalGrossSales: number;
  totalTransactions: number;
  totalCovers: number;
  atv: number | null;
  salesPerCover: number | null;
  averageDailySales: number | null;
  averageDailyCovers: number | null;
  tradingDays: number;
  bestDay: SalesDayInsight | null;
  weakestDay: SalesDayInsight | null;
  bestSeller: SalesItemInput | null;
  previousNetSales: number | null;
  salesChangePct: number | null;
  previousAtv: number | null;
  atvChangePct: number | null;
  days: SalesDayInsight[];
  items: SalesItemInput[];
  categories: SalesCategoryInsight[];
};

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const ratio = (numerator: number, denominator: number) => denominator > 0 ? round(numerator / denominator) : null;
const changePct = (current: number, previous: number | null) => previous !== null && previous > 0 ? round(((current - previous) / previous) * 100, 1) : null;
const labelDate = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function buildSalesInsights({
  days,
  items,
  categories,
  previousDays = [],
}: {
  days: SalesDayInput[];
  items: SalesItemInput[];
  categories: SalesCategoryInput[];
  previousDays?: SalesDayInput[];
}): SalesInsights {
  const sortedDays = [...days].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const tradingDays = sortedDays.filter((day) => day.netSales > 0 || day.grossSales > 0).length;
  const totalNetSales = round(sortedDays.reduce((sum, day) => sum + day.netSales, 0));
  const totalGrossSales = round(sortedDays.reduce((sum, day) => sum + day.grossSales, 0));
  const totalTransactions = Math.round(sortedDays.reduce((sum, day) => sum + day.transactions, 0));
  const totalCovers = Math.round(sortedDays.reduce((sum, day) => sum + day.covers, 0));
  const averageDailySales = tradingDays > 0 ? round(totalNetSales / tradingDays) : null;
  const averageDailyCovers = tradingDays > 0 && totalCovers > 0 ? round(totalCovers / tradingDays, 1) : null;
  const enrichedDays: SalesDayInsight[] = sortedDays.map((day) => ({
    ...day,
    dayLabel: labelDate(day.businessDate),
    atv: ratio(day.netSales, day.transactions),
    salesPerCover: ratio(day.netSales, day.covers),
    salesVsDailyAveragePct: averageDailySales && averageDailySales > 0 ? round(((day.netSales - averageDailySales) / averageDailySales) * 100, 1) : null,
  }));
  const activeDays = enrichedDays.filter((day) => day.netSales > 0);
  const bestDay = activeDays.length ? [...activeDays].sort((a, b) => b.netSales - a.netSales)[0] : null;
  const weakestDay = activeDays.length ? [...activeDays].sort((a, b) => a.netSales - b.netSales)[0] : null;
  const sortedItems = [...items].filter((item) => item.netSales > 0 || item.quantity > 0).sort((a, b) => b.netSales - a.netSales || b.quantity - a.quantity);
  const categoryRows = categories.length ? categories : aggregateCategories(sortedItems);
  const categorySales = categoryRows.reduce((sum, category) => sum + category.netSales, 0);
  const enrichedCategories = categoryRows
    .filter((category) => category.netSales > 0 || category.quantity > 0)
    .map((category) => ({ ...category, mixPct: categorySales > 0 ? round((category.netSales / categorySales) * 100, 1) : 0 }))
    .sort((a, b) => b.netSales - a.netSales);
  const previousNetSales = previousDays.length ? round(previousDays.reduce((sum, day) => sum + day.netSales, 0)) : null;
  const previousTransactions = previousDays.reduce((sum, day) => sum + day.transactions, 0);
  const previousAtv = previousDays.length && previousTransactions > 0 ? round((previousNetSales ?? 0) / previousTransactions) : null;
  const atv = ratio(totalNetSales, totalTransactions);

  return {
    available: enrichedDays.length > 0 || sortedItems.length > 0 || enrichedCategories.length > 0,
    hasDailySales: enrichedDays.length > 0,
    hasTransactions: totalTransactions > 0,
    hasCovers: totalCovers > 0,
    hasItemMix: sortedItems.length > 0 || enrichedCategories.length > 0,
    totalNetSales,
    totalGrossSales,
    totalTransactions,
    totalCovers,
    atv,
    salesPerCover: ratio(totalNetSales, totalCovers),
    averageDailySales,
    averageDailyCovers,
    tradingDays,
    bestDay,
    weakestDay,
    bestSeller: sortedItems[0] ?? null,
    previousNetSales,
    salesChangePct: changePct(totalNetSales, previousNetSales),
    previousAtv,
    atvChangePct: atv === null ? null : changePct(atv, previousAtv),
    days: enrichedDays,
    items: sortedItems.slice(0, 50),
    categories: enrichedCategories.slice(0, 30),
  };
}

function aggregateCategories(items: SalesItemInput[]): SalesCategoryInput[] {
  const rows = new Map<string, SalesCategoryInput>();
  for (const item of items) {
    const category = item.category.trim() || "Uncategorised";
    const key = category.toLowerCase();
    const current = rows.get(key);
    rows.set(key, current ? { ...current, quantity: round(current.quantity + item.quantity), netSales: round(current.netSales + item.netSales) } : { category, quantity: item.quantity, netSales: item.netSales });
  }
  return [...rows.values()];
}

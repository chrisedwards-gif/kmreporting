import { describe, expect, it } from "vitest";
import { buildSalesInsights } from "@/lib/reporting/sales-insights";
import { parseStockLinkSalesInsights } from "@/lib/reporting/sales-imports";

describe("sales insight calculations", () => {
  it("calculates ATV, covers, daily average and week comparison", () => {
    const result = buildSalesInsights({
      days: [
        { businessDate: "2026-07-12", grossSales: 1200, netSales: 1000, transactions: 50, covers: 80 },
        { businessDate: "2026-07-13", grossSales: 2400, netSales: 2000, transactions: 80, covers: 120 },
      ],
      items: [
        { itemName: "Caesar Wrap", category: "Wraps", quantity: 40, netSales: 480 },
        { itemName: "Saint Pep", category: "Pizza", quantity: 20, netSales: 300 },
      ],
      categories: [],
      previousDays: [
        { businessDate: "2026-07-05", grossSales: 1000, netSales: 900, transactions: 45, covers: 70 },
        { businessDate: "2026-07-06", grossSales: 1900, netSales: 1600, transactions: 75, covers: 100 },
      ],
    });

    expect(result.totalNetSales).toBe(3000);
    expect(result.atv).toBe(23.08);
    expect(result.salesPerCover).toBe(15);
    expect(result.averageDailyCovers).toBe(100);
    expect(result.averageDailySales).toBe(1500);
    expect(result.salesChangePct).toBe(20);
    expect(result.bestDay?.businessDate).toBe("2026-07-13");
    expect(result.weakestDay?.salesVsDailyAveragePct).toBe(-33.3);
    expect(result.bestSeller?.itemName).toBe("Caesar Wrap");
    expect(result.categories.find((item) => item.category === "Wraps")?.mixPct).toBe(61.5);
  });

  it("uses explicit unavailable states instead of invented zeros", () => {
    const result = buildSalesInsights({
      days: [{ businessDate: "2026-07-12", grossSales: 1000, netSales: 833.33, transactions: 0, covers: 0 }],
      items: [],
      categories: [],
    });
    expect(result.atv).toBeNull();
    expect(result.salesPerCover).toBeNull();
    expect(result.averageDailyCovers).toBeNull();
    expect(result.hasTransactions).toBe(false);
    expect(result.hasCovers).toBe(false);
  });
});

describe("StockLink safe detail extraction", () => {
  it("extracts daily sales, transactions, covers, products and category mix from tabular HTML", () => {
    const html = `
      <html><body>
        <table>
          <tr><th>Business Date</th><th>Gross Sales</th><th>Net Sales</th><th>Transactions</th><th>Covers</th></tr>
          <tr><td>12/07/2026</td><td>1200</td><td>1000</td><td>50</td><td>80</td></tr>
          <tr><td>13/07/2026</td><td>2400</td><td>2000</td><td>80</td><td>120</td></tr>
        </table>
        <table>
          <tr><th>Item Name</th><th>Category</th><th>Quantity Sold</th><th>Net Sales</th></tr>
          <tr><td>Caesar Wrap</td><td>Wraps</td><td>40</td><td>480</td></tr>
          <tr><td>Saint Pep</td><td>Pizza</td><td>20</td><td>300</td></tr>
        </table>
      </body></html>`;
    const result = parseStockLinkSalesInsights(html, { start: "2026-07-12", end: "2026-07-18" }, 3000);
    expect(result.days).toHaveLength(2);
    expect(result.days[1]).toMatchObject({ netSales: 2000, transactions: 80, covers: 120 });
    expect(result.items[0].itemName).toBe("Caesar Wrap");
    expect(result.categories.find((item) => item.category === "Wraps")?.netSales).toBe(480);
  });

  it("drops a daily extraction that does not reconcile with the weekly total", () => {
    const html = `<html><table><tr><th>Date</th><th>Net Sales</th></tr><tr><td>12/07/2026</td><td>100</td></tr><tr><td>13/07/2026</td><td>100</td></tr></table></html>`;
    const result = parseStockLinkSalesInsights(html, { start: "2026-07-12", end: "2026-07-18" }, 3000);
    expect(result.days).toHaveLength(0);
  });
});

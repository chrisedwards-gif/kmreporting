import { describe, expect, it } from "vitest";
import { calculateCosts } from "@/lib/reporting/calculations";
import { parseCreditsOverview, parseGoodsDelivered, parseRotaCloudLabour, parseStockLinkEndOfWeek } from "@/lib/reporting/imports";
import { getCurrentReportingWeek, getLatestCompletedReportingWeek, isSiteExpectedForReportingWeek, isSundayToSaturday } from "@/lib/reporting/periods";
import { buildReviewFlags } from "@/lib/reporting/review";

describe("weekly reporting calculations", () => {
  it("calculates COGS and staff cost without exposing individual pay", () => {
    const result = calculateCosts({
      netSales: 50_000,
      openingStock: 6_000,
      purchases: 15_000,
      credits: 500,
      transfersIn: 400,
      transfersOut: 250,
      closingStock: 5_650,
      adjustments: 0,
      paidHours: 900,
      averageLoadedRate: 16,
      agencyCost: 1_200,
      overtimePremium: 350,
      wasteCost: 550,
    });

    expect(result.cogs).toBe(15_000);
    expect(result.foodCostPct).toBe(30);
    expect(result.staffCost).toBe(15_950);
    expect(result.labourPct).toBeCloseTo(31.9);
    expect(result.primeCost).toBe(30_950);
  });

  it("requires a Sunday-to-Saturday seven-day period", () => {
    expect(isSundayToSaturday("2026-07-05", "2026-07-11")).toBe(true);
    expect(isSundayToSaturday("2026-07-06", "2026-07-12")).toBe(false);
    expect(isSundayToSaturday("2026-07-05", "2026-07-12")).toBe(false);
  });

  it("only reminds sites expected in the selected reporting week", () => {
    const week = { start: "2026-07-05", end: "2026-07-11" };
    expect(isSiteExpectedForReportingWeek({ active: true, reportingStartDate: "2026-07-05", reportingEndDate: null }, week)).toBe(true);
    expect(isSiteExpectedForReportingWeek({ active: true, reportingStartDate: "2026-07-12", reportingEndDate: null }, week)).toBe(false);
    expect(isSiteExpectedForReportingWeek({ active: false, reportingStartDate: "2026-07-05", reportingEndDate: null }, week)).toBe(false);
  });

  it("defaults new reports to the latest completed Sunday-to-Saturday week", () => {
    expect(getLatestCompletedReportingWeek(new Date("2026-07-18T10:00:00Z"))).toMatchObject({
      start: "2026-07-05",
      end: "2026-07-11",
    });
    expect(getLatestCompletedReportingWeek(new Date("2026-07-20T10:00:00Z"))).toMatchObject({
      start: "2026-07-12",
      end: "2026-07-18",
    });
  });

  it("aligns a newly configured kitchen to the current Sunday-to-Saturday cycle", () => {
    expect(getCurrentReportingWeek(new Date("2026-07-18T10:00:00Z"))).toMatchObject({ start: "2026-07-12", end: "2026-07-18" });
    expect(getCurrentReportingWeek(new Date("2026-07-18T23:30:00Z"))).toMatchObject({ start: "2026-07-19", end: "2026-07-25" });
    expect(getLatestCompletedReportingWeek(new Date("2026-07-18T23:30:00Z"))).toMatchObject({ start: "2026-07-12", end: "2026-07-18" });
  });

  it("raises cost and compliance review gates", () => {
    const flags = buildReviewFlags(
      {
        cogs: 17_000,
        foodCostPct: 34,
        staffCost: 17_500,
        labourPct: 35,
        wastePct: 1.4,
        primeCost: 34_500,
        primeCostPct: 69,
        foodCostBasis: "stock_adjusted",
      },
      { foodCostTarget: 31, labourTarget: 32, wasteTarget: 1 },
      { complianceIssues: "Fridge log gap" },
    );

    expect(flags.map((flag) => flag.code)).toEqual([
      "FOOD_COST_OVER_TARGET",
      "LABOUR_OVER_TARGET",
      "WASTE_OVER_TARGET",
      "COMPLIANCE_REVIEW",
    ]);
  });

  it("calculates a spend-based indicator when no stocktake was completed", () => {
    const result = calculateCosts({
      netSales: 10_000,
      openingStock: 5_000,
      purchases: 3_000,
      credits: 100,
      transfersIn: 50,
      transfersOut: 25,
      closingStock: 5_400,
      adjustments: 0,
      paidHours: 0,
      averageLoadedRate: 0,
      agencyCost: 0,
      overtimePremium: 0,
      wasteCost: 100,
      staffCostOverride: 3_200,
      stocktakeCompleted: false,
    });
    expect(result.cogs).toBe(2_925);
    expect(result.foodCostPct).toBe(29.25);
    expect(result.staffCost).toBe(3_200);
    expect(result.foodCostBasis).toBe("spend");
  });
});

describe("manager source-file imports", () => {
  const week = { start: "2026-07-05", end: "2026-07-11" };

  it("extracts safe StockLink net sales", () => {
    const html = `<html><head><title>End Of Week Report For Test Kitchen From 05/07/2026 To 11/07/2026</title></head><body><table>
      <tr><td>Adjustments</td></tr><tr><td>Service Charge</td><td>100.00</td></tr>
      <tr><td>Gross Sales After Adjustment</td></tr><tr><td>Total</td><td>1200.00</td></tr>
      <tr><td>Vat</td></tr><tr><td>Total</td><td>200.00</td></tr>
    </table></body></html>`;
    expect(parseStockLinkEndOfWeek(html, week)).toMatchObject({ siteName: "Test Kitchen", netSales: 900, vat: 200, serviceCharge: 100 });
  });

  it("sums delivered food and separates awaiting invoices", () => {
    const csv = [
      "Purchaser Unit Name,Date Delivered,Category,Order Status,Total Price Net",
      "Test Kitchen,06/07/2026,Food,Completed Invoices,100.00",
      "Test Kitchen,10/07/2026,Food,Awaiting Invoice,25.00",
      "Test Kitchen,10/07/2026,Non Food,Completed Invoices,40.00",
    ].join("\n");
    expect(parseGoodsDelivered(csv, week)).toMatchObject({ siteName: "Test Kitchen", purchases: 125, awaitingInvoice: 25, rowCount: 2 });
  });

  it("does not deduct pending supplier credits", () => {
    const csv = [
      "Credit Request Date,Credit Note Date,Order Status,Purchaser Unit,Credit Request Net Value,Credit Note Net Value,Order Status",
      "08/07/2026,,Pending Investigation Credit,Test Kitchen,2.40,2.40,Invoice Queries",
      "07/07/2026,09/07/2026,Credit Complete,Test Kitchen,5.00,5.00,Completed Invoices",
    ].join("\n");
    expect(parseCreditsOverview(csv, week)).toMatchObject({ confirmedCredits: 5, pendingCredits: 2.4, confirmedCount: 1, pendingCount: 1 });
  });

  it("extracts only aggregate RotaCloud cost and hours", () => {
    const csv = [
      "Shift Date,Employee,Total Wage Cost,Paid Hours",
      "06/07/2026,Employee A,120.00,8",
      "07/07/2026,Employee B,150.00,9",
    ].join("\n");
    expect(parseRotaCloudLabour(csv, week)).toMatchObject({ staffCost: 270, paidHours: 17, costColumn: "Total Wage Cost", hoursColumn: "Paid Hours" });
  });

  it("recognises RotaCloud Daily Totals and its kitchen", () => {
    const csv = [
      "Date,Total Shifts,Total Hours,Total Cost,Location: Test Kitchen (Hours),Location: Test Kitchen (Cost)",
      "2026-07-05,1,8,120,8,120",
      "2026-07-06,1,9,150,9,150",
      "2026-07-07,0,0,0,0,0",
      "2026-07-08,0,0,0,0,0",
      "2026-07-09,0,0,0,0,0",
      "2026-07-10,0,0,0,0,0",
      "2026-07-11,0,0,0,0,0",
    ].join("\n");
    expect(parseRotaCloudLabour(csv, week)).toMatchObject({ siteName: "Test Kitchen", staffCost: 270, paidHours: 17 });
  });

  it("does not double-count RotaCloud Employee Totals summary rows", () => {
    const csv = [
      "Employee ID,Employee,Date,Location,Hours,Cost",
      "1,Employee A,06/07/2026,Test Kitchen,8,120",
      "2,Employee B,07/07/2026,Test Kitchen,9,150",
      ",,,,17,270",
    ].join("\n");
    expect(parseRotaCloudLabour(csv, week)).toMatchObject({ siteName: "Test Kitchen", staffCost: 270, paidHours: 17 });
  });
});

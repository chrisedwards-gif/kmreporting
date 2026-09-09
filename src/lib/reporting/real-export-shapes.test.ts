import { describe, expect, it } from "vitest";
import { parseGroupWeeklyPackFile } from "@/lib/reporting/group-pack-parser";
import { parseRotaCloudLabour, parseStockLinkEndOfWeek } from "@/lib/reporting/imports";

describe("real exported report shapes", () => {
  it("does not let later StockLink totals overwrite the VAT total", () => {
    const week = { start: "2026-08-23", end: "2026-08-29" };
    const html = `<html><head><title>End Of Week Report For Dough Religion From 23/08/2026 To 29/08/2026</title></head><body><table>
      <tr><td>Adjustments</td></tr>
      <tr><td>Service Charge</td><td>907.66</td></tr>
      <tr><td>Gross Sales After Adjustment</td></tr>
      <tr><td>Total</td><td>16011.37</td></tr>
      <tr><td>Vat</td></tr>
      <tr><td>Vat 20%</td><td>2438.80</td></tr>
      <tr><td>Total</td><td>2438.80</td></tr>
      <tr><td>Takings</td></tr>
      <tr><td>Total</td><td>16034.47</td></tr>
      <tr><td>Cid Totals</td></tr>
      <tr><td>Total</td><td>1407.37</td></tr>
    </table></body></html>`;

    expect(parseStockLinkEndOfWeek(html, week)).toMatchObject({
      siteName: "Dough Religion",
      grossAfterAdjustments: 16011.37,
      vat: 2438.8,
      serviceCharge: 907.66,
      netSales: 12664.91,
    });
  });

  it("accepts RotaCloud Daily Totals with Location and Role columns", () => {
    const week = { start: "2026-07-26", end: "2026-08-01" };
    const csv = [
      '"Date","Total Shifts","Total Hours","Total Cost","Location: Dough Religion (Hours)","Location: Dough Religion (Cost)","Role: Kitchen Manager (Hours)","Role: Kitchen Manager (Cost)","Role: Pizzaiolo (Hours)","Role: Pizzaiolo (Cost)"',
      '"2026-07-26","3.00","28.25","133.00","28.25","133.00","9.50","0.00","18.75","133.00"',
      '"2026-07-27","3.00","39.50","371.63","39.50","371.63","10.50","0.00","29.00","371.63"',
      '"2026-07-28","3.00","27.25","224.25","27.25","224.25","10.50","0.00","16.75","224.25"',
      '"2026-07-29","3.00","31.00","276.75","31.00","276.75","10.50","0.00","20.50","276.75"',
      '"2026-07-30","4.00","38.50","224.00","38.50","224.00","22.00","0.00","16.50","224.00"',
      '"2026-07-31","3.00","34.00","292.50","34.00","292.50","11.50","0.00","22.50","292.50"',
      '"2026-08-01","5.00","43.00","351.00","43.00","351.00","16.00","0.00","27.00","351.00"',
    ].join("\n");

    expect(parseRotaCloudLabour(csv, week)).toMatchObject({
      siteName: "Dough Religion",
      paidHours: 241.5,
      staffCost: 1873.13,
    });
  });

  it("does not mistake RotaCloud role columns for kitchens in the group parser", () => {
    const week = { start: "2026-07-26", end: "2026-08-01" };
    const csv = [
      '"Date","Total Shifts","Total Hours","Total Cost","Location: Dough Religion (Hours)","Location: Dough Religion (Cost)","Role: Kitchen Manager (Hours)","Role: Kitchen Manager (Cost)"',
      '"2026-07-26","3.00","28.25","133.00","28.25","133.00","9.50","0.00"',
      '"2026-07-27","3.00","39.50","371.63","39.50","371.63","10.50","0.00"',
      '"2026-07-28","3.00","27.25","224.25","27.25","224.25","10.50","0.00"',
      '"2026-07-29","3.00","31.00","276.75","31.00","276.75","10.50","0.00"',
      '"2026-07-30","4.00","38.50","224.00","38.50","224.00","22.00","0.00"',
      '"2026-07-31","3.00","34.00","292.50","34.00","292.50","11.50","0.00"',
      '"2026-08-01","5.00","43.00","351.00","43.00","351.00","16.00","0.00"',
    ].join("\n");

    const parsed = parseGroupWeeklyPackFile("daily_totals_2026-07-26_to_2026-08-01.csv", csv, week);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      classification: "rotacloud_labour",
      parseStatus: "parsed",
      siteHint: "Dough Religion",
    });
    expect(parsed[0]?.summary).toMatchObject({ paidHours: 241.5, staffCost: 1873.13 });
  });
});

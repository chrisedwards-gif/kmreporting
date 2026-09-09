import { describe, expect, it } from "vitest";
import { parseGroupWeeklyPackFile } from "@/lib/reporting/group-pack-parser";

const week = { start: "2026-08-30", end: "2026-09-05" };

const bySite = (rows: ReturnType<typeof parseGroupWeeklyPackFile>) => new Map(rows.map((row) => [row.siteHint, row]));

describe("parseGroupWeeklyPackFile", () => {
  it("splits one Procure Wizard Goods Delivered export across kitchens", () => {
    const csv = [
      "Purchaser Unit Name,Date Delivered,Category,Order Status,Total Price Net",
      "Kardia,30/08/2026,Food,Invoiced,100.00",
      "Kardia,31/08/2026,Food,Awaiting Invoice,50.00",
      "Dough Religion,30/08/2026,Food,Invoiced,200.00",
      "Dough Religion,31/08/2026,Drink,Invoiced,500.00",
    ].join("\n");

    const parsed = bySite(parseGroupWeeklyPackFile("goods.csv", csv, week));
    expect(parsed.size).toBe(2);
    expect(parsed.get("Kardia")?.summary).toMatchObject({ purchases: 150, awaitingInvoice: 50, groupWideSource: true });
    expect(parsed.get("Dough Religion")?.summary).toMatchObject({ purchases: 200, awaitingInvoice: 0, groupWideSource: true });
  });

  it("splits one Procure Wizard Credits Overview export across kitchens", () => {
    const csv = [
      "Purchaser Unit,Credit Request Date,Credit Note Date,Order Status,Credit Note Net Value,Credit Request Net Value",
      "Kardia,01/09/2026,02/09/2026,Credited,25.00,25.00",
      "Dough Religion,01/09/2026,,Investigation,0.00,18.00",
    ].join("\n");

    const parsed = bySite(parseGroupWeeklyPackFile("credits.csv", csv, week));
    expect(parsed.get("Kardia")?.summary).toMatchObject({ confirmedCredits: 25, pendingCredits: 0 });
    expect(parsed.get("Dough Religion")?.summary).toMatchObject({ confirmedCredits: 0, pendingCredits: 18 });
  });

  it("splits one RotaCloud export with a Location column across kitchens", () => {
    const csv = [
      "Location,Date,Paid Hours,Total Cost",
      "Kardia,30/08/2026,10,120.00",
      "Kardia,31/08/2026,8,96.00",
      "Dough Religion,30/08/2026,12,150.00",
      "Dough Religion,31/08/2026,9,112.50",
    ].join("\n");

    const parsed = bySite(parseGroupWeeklyPackFile("rotacloud-labour.csv", csv, week));
    expect(parsed.get("Kardia")?.summary).toMatchObject({ staffCost: 216, paidHours: 18, groupWideSource: true });
    expect(parsed.get("Dough Religion")?.summary).toMatchObject({ staffCost: 262.5, paidHours: 21, groupWideSource: true });
  });

  it("accepts a safe multi-kitchen sales CSV when it has business dates", () => {
    const csv = [
      "Site,Business Date,Gross Sales,Net Sales",
      "Kardia,30/08/2026,1200,1000",
      "Kardia,31/08/2026,600,500",
      "Dough Religion,30/08/2026,2400,2000",
      "Dough Religion,31/08/2026,1200,1000",
    ].join("\n");

    const parsed = bySite(parseGroupWeeklyPackFile("access-group-sales.csv", csv, week));
    expect(parsed.get("Kardia")?.summary).toMatchObject({ grossSales: 1800, netSales: 1500, groupWideSource: true });
    expect(parsed.get("Dough Religion")?.summary).toMatchObject({ grossSales: 3600, netSales: 3000, groupWideSource: true });
  });

  it("does not guess totals from a multi-row sales file with no business date", () => {
    const csv = [
      "Site,Gross Sales,Net Sales",
      "Kardia,1200,1000",
      "Kardia,600,500",
      "Dough Religion,2400,2000",
      "Dough Religion,1200,1000",
    ].join("\n");

    const parsed = parseGroupWeeklyPackFile("sales.csv", csv, week);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((row) => row.parseStatus === "error")).toBe(true);
    expect(parsed[0]?.error).toContain("no business-date column");
  });
});

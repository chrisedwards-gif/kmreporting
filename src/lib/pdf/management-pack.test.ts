import { describe, expect, it } from "vitest";
import { buildManagementPackPdf } from "@/lib/pdf/management-pack";
import { buildSalesInsights } from "@/lib/reporting/sales-insights";
import type { WeeklyReport } from "@/lib/types";

const report = (overrides: Partial<WeeklyReport> = {}): WeeklyReport => ({
  id: "00000000-0000-4000-8000-000000000101",
  siteId: "00000000-0000-4000-8000-000000000001",
  siteName: "Dough Religion",
  manager: "Chris Edwards",
  weekStart: "2026-07-12",
  weekEnd: "2026-07-18",
  status: "shared",
  updatedAt: "2026-07-19T12:00:00Z",
  wins: "Scott started, very strong.",
  operationalIssues: "Issues around wait times.",
  staffingIssues: "n/a",
  complianceIssues: "n/a",
  equipmentIssues: "Engineer logged for Tuesday.",
  actionsUnderway: "",
  supportNeeded: "none",
  manualPurchases: [{ description: "Shop top-up", amount: 198, receiptReference: "" }],
  costs: {
    reportId: "00000000-0000-4000-8000-000000000101",
    id: "00000000-0000-4000-8000-000000000001",
    code: "DR-MCR",
    name: "Dough Religion",
    manager: "Chris Edwards",
    netSales: 12504,
    cogs: 2158,
    foodCostPct: 17.3,
    staffCost: 2330,
    labourPct: 18.6,
    wastePct: 0,
    primeCost: 4488,
    primeCostPct: 35.9,
    foodCostBasis: "spend",
    foodCostTarget: 30,
    labourTarget: 32,
    wasteTarget: 1.2,
    status: "shared",
    flags: [
      { code: "credit", label: "Supplier credit pending", detail: "£7.09 is requested but not yet issued.", severity: "warning" },
      { code: "compliance", label: "Compliance issue reported", detail: "This check must be resolved before approval.", severity: "critical" },
    ],
  },
  sources: {
    sales: "manual",
    purchasing: "manual",
    labour: "manual",
    pendingCredits: 7.09,
    awaitingInvoice: 647,
    stocktakeCompleted: false,
  },
  ...overrides,
});

const insights = buildSalesInsights({
  days: [
    { businessDate: "2026-07-12", grossSales: 1200, netSales: 1000, transactions: 80, covers: 0 },
    { businessDate: "2026-07-13", grossSales: 1400, netSales: 1200, transactions: 90, covers: 0 },
    { businessDate: "2026-07-14", grossSales: 1600, netSales: 1400, transactions: 100, covers: 0 },
    { businessDate: "2026-07-15", grossSales: 1800, netSales: 1600, transactions: 110, covers: 0 },
    { businessDate: "2026-07-16", grossSales: 2100, netSales: 1850, transactions: 125, covers: 0 },
    { businessDate: "2026-07-17", grossSales: 2800, netSales: 2450, transactions: 155, covers: 0 },
    { businessDate: "2026-07-18", grossSales: 3400, netSales: 3004, transactions: 201, covers: 0 },
  ],
  previousDays: [{ businessDate: "2026-07-11", grossSales: 11000, netSales: 10500, transactions: 790, covers: 0 }],
  items: [
    { itemName: "NYC Caesar Wrap", category: "Wraps", quantity: 220, netSales: 2860 },
    { itemName: "Queen Marg", category: "Pizza", quantity: 160, netSales: 2400 },
  ],
  categories: [
    { category: "Pizza", quantity: 400, netSales: 6200 },
    { category: "Wraps", quantity: 300, netSales: 4300 },
    { category: "Sides", quantity: 180, netSales: 2004 },
  ],
});

const pageCount = (pdf: Buffer) => (pdf.toString("binary").match(/\/Type \/Page\s/g) ?? []).length;

describe("buildManagementPackPdf", () => {
  it("generates an executive page, group trading page and two kitchen pages", () => {
    const current = report();
    const pdf = buildManagementPackPdf({
      week: { start: "2026-07-12", end: "2026-07-18", dueAt: "2026-07-21T12:00:00Z" },
      expectedSites: [
        { id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion", code: "DR-MCR" },
        { id: "00000000-0000-4000-8000-000000000003", name: "Kardia", code: "KAR-MCR" },
      ],
      reports: [current],
      salesInsightsByReport: { [current.id]: insights },
    });

    const source = pdf.toString("binary");
    expect(source.startsWith("%PDF-1.4")).toBe(true);
    expect(source).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pageCount(pdf)).toBe(4);
    expect(pdf.length).toBeGreaterThan(20_000);
  });

  it("adds continuation pages rather than clipping long management commentary", () => {
    const longNarrative = Array.from({ length: 180 }, (_, index) => `Action ${index + 1} needs an owner and a clear deadline.`).join(" ");
    const current = report({ actionsUnderway: longNarrative });
    const pdf = buildManagementPackPdf({
      week: { start: "2026-07-12", end: "2026-07-18", dueAt: "2026-07-21T12:00:00Z" },
      expectedSites: [{ id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion", code: "DR-MCR" }],
      reports: [current],
      salesInsightsByReport: { [current.id]: insights },
    });

    expect(pageCount(pdf)).toBeGreaterThan(4);
  });

  it("rejects an export with no approved kitchen reports", () => {
    expect(() => buildManagementPackPdf({
      week: { start: "2026-07-12", end: "2026-07-18", dueAt: "2026-07-21T12:00:00Z" },
      expectedSites: [{ id: "00000000-0000-4000-8000-000000000001", name: "Dough Religion", code: "DR-MCR" }],
      reports: [report({ status: "submitted" })],
    })).toThrow("At least one approved kitchen report");
  });
});

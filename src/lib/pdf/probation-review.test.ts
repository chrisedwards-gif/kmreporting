import { describe, expect, it } from "vitest";
import { buildProbationReviewPdf, type ProbationFinalSnapshot } from "@/lib/pdf/probation-review";

const snapshot: ProbationFinalSnapshot = {
  schemaVersion: 1,
  review: {
    id: "00000000-0000-4000-8000-000000000101",
    reviewDate: "2026-07-22",
    reviewStage: "30_day",
    outcome: "extend",
    extensionEndDate: "2026-09-01",
    notes: "Scott is making good progress, but the operating controls need more consistent evidence before probation can be passed.",
    requiredActions: "Complete allergen sign-off, deliver two kitchen standards reviews and close the agreed actions by the revised end date.",
  },
  manager: {
    id: "00000000-0000-4000-8000-000000000102",
    fullName: "Scott Hutton",
    roleTitle: "Kitchen Manager",
    siteId: "00000000-0000-4000-8000-000000000001",
    siteName: "Kardia",
    employmentStartDate: "2026-06-20",
    probationEndDate: "2026-08-20",
    stageLabel: "Days 31–60",
  },
  performance: {
    weightedScore: 3.6,
    calculatedRag: "amber",
    displayedRag: "red",
    reviewCount: 4,
    latestReviewDate: "2026-07-19",
    weights: { leadership: 0.2, communication: 0.1, organisation: 0.15, kitchen_standards: 0.2, product_quality: 0.15, commercial_awareness: 0.1, problem_solving: 0.05, ownership: 0.05 },
    override: {
      calculatedRag: "amber",
      overrideRag: "red",
      reason: "The calculated score does not yet reflect two unresolved compliance actions.",
      createdByName: "Chris Edwards",
      createdAt: "2026-07-22T09:00:00Z",
    },
  },
  evidence: [{
    id: "00000000-0000-4000-8000-000000000103",
    fileName: "signed-review.pdf",
    evidenceType: "signed_document",
    caption: "Signed 30-day review",
    mimeType: "application/pdf",
    sizeBytes: 128000,
    uploadedByName: "Chris Edwards",
    createdAt: "2026-07-22T09:15:00Z",
  }],
  audit: {
    finalisedById: "00000000-0000-4000-8000-000000000104",
    finalisedByName: "Chris Edwards",
    finalisedAt: "2026-07-22T09:30:00Z",
  },
};

const pageCount = (pdf: Buffer) => (pdf.toString("binary").match(/\/Type \/Page\s/g) ?? []).length;

describe("buildProbationReviewPdf", () => {
  it("creates a fixed A4 immutable A4 decision record", () => {
    const pdf = buildProbationReviewPdf(snapshot);
    expect(pdf.toString("binary").startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.toString("binary")).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pageCount(pdf)).toBe(3);
    expect(pdf.length).toBeGreaterThan(8_000);
  });
});

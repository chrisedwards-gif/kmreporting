import { describe, expect, it } from "vitest";
import {
  auditKpi,
  booleanKpi,
  buildFollowUpEmail,
  dashboardCategories,
  foodGpKpi,
  isActionOverdue,
  labourKpi,
  overallScore,
  probationStage,
  salesKpi,
  scoreRag,
  wasteKpi,
  weightedProbationScore,
} from "@/lib/performance/scoring";

describe("performance score RAG", () => {
  it("maps score bands to green, amber and red", () => {
    expect(scoreRag(4)).toBe("green");
    expect(scoreRag(3.9)).toBe("amber");
    expect(scoreRag(2.9)).toBe("red");
    expect(scoreRag(null)).toBe("neutral");
  });
});

describe("overall and dashboard scores", () => {
  it("averages only completed scores and rounds to one decimal", () => {
    expect(overallScore({ leadership: 4, communication: 3, organisation: 5 })).toBe(4);
    expect(overallScore({ leadership: 4, communication: 3.5 })).toBe(3.8);
  });

  it("never treats an empty score as zero", () => {
    expect(overallScore({ leadership: 5, ownership: null })).toBe(5);
    expect(overallScore({})).toBeNull();
  });

  it("derives the five headline categories", () => {
    const result = dashboardCategories({
      leadership: 4,
      communication: 3,
      organisation: 4,
      kitchen_standards: 5,
      product_quality: 2,
      commercial_awareness: 3,
      problem_solving: 4,
      ownership: 5,
    });
    expect(result.leadership).toBe(4);
    expect(result.standards).toBe(4);
    expect(result.commercial).toBe(3);
    expect(result.product).toBe(2);
    expect(result.ownership).toBe(4.5);
    expect(result.overall).toBe(3.8);
  });
});

describe("KPI calculations", () => {
  it("treats sales as higher-is-better with a 5% amber band", () => {
    expect(salesKpi(10500, 10000).rag).toBe("green");
    expect(salesKpi(9600, 10000).rag).toBe("amber");
    expect(salesKpi(9400, 10000).rag).toBe("red");
    expect(salesKpi(9400, 10000).variance).toBe(-600);
  });

  it("measures food GP in percentage points, not growth", () => {
    const result = foodGpKpi(70, 72);
    expect(result.variance).toBe(-2);
    expect(result.rag).toBe("amber");
    expect(foodGpKpi(69.9, 72).rag).toBe("red");
    expect(foodGpKpi(72, 72).rag).toBe("green");
  });

  it("treats labour as lower-is-better in percentage points", () => {
    expect(labourKpi(28, 28).rag).toBe("green");
    expect(labourKpi(30, 28).rag).toBe("amber");
    expect(labourKpi(30.1, 28).rag).toBe("red");
  });

  it("gives waste a 10% proportional band and survives a zero target", () => {
    expect(wasteKpi(95, 100).rag).toBe("green");
    expect(wasteKpi(109, 100).rag).toBe("amber");
    expect(wasteKpi(111, 100).rag).toBe("red");
    expect(wasteKpi(5, 0).rag).toBe("red");
    expect(wasteKpi(0, 0).rag).toBe("green");
  });

  it("scores audits against the configured target with a 5-point band", () => {
    expect(auditKpi(95, 95).rag).toBe("green");
    expect(auditKpi(90, 95).rag).toBe("amber");
    expect(auditKpi(89.9, 95).rag).toBe("red");
  });

  it("handles boolean KPIs including not-applicable", () => {
    expect(booleanKpi(true)).toBe("green");
    expect(booleanKpi(false)).toBe("red");
    expect(booleanKpi(null)).toBe("neutral");
  });

  it("returns neutral when data is missing rather than guessing", () => {
    expect(salesKpi(null, 10000).rag).toBe("neutral");
    expect(foodGpKpi(70, null).variance).toBeNull();
  });
});

describe("probation", () => {
  it("derives the stage from days employed", () => {
    expect(probationStage("2026-07-01", "2026-07-30")).toBe("first_30");
    expect(probationStage("2026-07-01", "2026-07-31")).toBe("days_31_60");
    expect(probationStage("2026-07-01", "2026-08-29")).toBe("days_31_60");
    expect(probationStage("2026-07-01", "2026-08-30")).toBe("days_61_90");
    expect(probationStage("2026-07-01", "2026-09-29")).toBe("ongoing");
  });

  it("computes role-weighted probation scores and renormalises missing areas", () => {
    expect(
      weightedProbationScore([
        { score: 4, weight: 0.25 },
        { score: 3, weight: 0.2 },
        { score: 5, weight: 0.2 },
        { score: 4, weight: 0.15 },
        { score: 3, weight: 0.1 },
        { score: 4, weight: 0.1 },
      ]),
    ).toBe(3.9);
    expect(weightedProbationScore([{ score: null, weight: 0.5 }, { score: 4, weight: 0.5 }])).toBe(4);
    expect(weightedProbationScore([])).toBeNull();
  });
});

describe("actions", () => {
  it("marks overdue only when past due and still open", () => {
    expect(isActionOverdue("2026-07-01", "in_progress", "2026-07-19")).toBe(true);
    expect(isActionOverdue("2026-07-01", "complete", "2026-07-19")).toBe(false);
    expect(isActionOverdue("2026-07-01", "cancelled", "2026-07-19")).toBe(false);
    expect(isActionOverdue("2026-07-20", "not_started", "2026-07-19")).toBe(false);
    expect(isActionOverdue(null, "not_started", "2026-07-19")).toBe(false);
  });
});

describe("follow-up email", () => {
  it("builds the agreed structure with the top five priorities", () => {
    const email = buildFollowUpEmail({
      firstName: "Warren",
      weekCommencing: "13 Jul 2026",
      positives: ["Stock take completed on time"],
      developmentAreas: ["Chase supplier credits weekly"],
      actions: [
        { action: "Complete Monday stock take", dueDate: "20 Jul 2026" },
        { action: "Chase Procure Wizard credits", dueDate: null },
        { action: "A", dueDate: null },
        { action: "B", dueDate: null },
        { action: "C", dueDate: null },
        { action: "Sixth action stays in the log, not the email", dueDate: null },
      ],
      support: "Chris to join Monday count",
      nextReviewDate: "27 Jul 2026",
    });
    expect(email.subject).toBe("Weekly 1-1 Summary – 13 Jul 2026");
    expect(email.body).toContain("Hi Warren,");
    expect(email.body).toContain("1. Complete Monday stock take — due 20 Jul 2026");
    expect(email.body).toContain("5. C");
    expect(email.body).not.toContain("Sixth action");
    expect(email.body).toContain("• Chris to join Monday count");
  });
});

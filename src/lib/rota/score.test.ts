import { describe, expect, it } from "vitest";
import { calculateRotaScore } from "@/lib/rota/score";

describe("rota score", () => {
  it("awards 100 for full cover, affordable cost, assigned shifts and target hours", () => {
    expect(calculateRotaScore({
      coverage: [{ required: 2, assigned: 2 }, { required: 3, assigned: 3 }],
      plannedCost: 900,
      labourBudget: 1000,
      totalShifts: 4,
      openShifts: 0,
      people: [{ plannedHours: 40, targetHours: 40, maximumHours: 48 }],
    })).toEqual({
      score: 100,
      parts: { cover: 35, cost: 30, staffed: 15, hours: 20 },
    });
  });

  it("scores cover and assigned shifts proportionally", () => {
    const result = calculateRotaScore({
      coverage: [{ required: 2, assigned: 2 }, { required: 3, assigned: 2 }],
      plannedCost: 900,
      labourBudget: 1000,
      totalShifts: 4,
      openShifts: 1,
      people: [{ plannedHours: 40, targetHours: 40, maximumHours: 48 }],
    });

    expect(result.parts.cover).toBe(18);
    expect(result.parts.staffed).toBe(11);
    expect(result.score).toBe(79);
  });

  it("reduces cost points as the rota moves over budget", () => {
    const result = calculateRotaScore({
      coverage: [{ required: 2, assigned: 2 }],
      plannedCost: 1250,
      labourBudget: 1000,
      totalShifts: 1,
      openShifts: 0,
      people: [{ plannedHours: 40, targetHours: 40, maximumHours: 48 }],
    });

    expect(result.parts.cost).toBe(15);
    expect(result.score).toBe(85);
  });

  it("gives no hours points to a person above their maximum", () => {
    const result = calculateRotaScore({
      coverage: [{ required: 2, assigned: 2 }],
      plannedCost: 900,
      labourBudget: 1000,
      totalShifts: 1,
      openShifts: 0,
      people: [
        { plannedHours: 49, targetHours: 40, maximumHours: 48 },
        { plannedHours: 40, targetHours: 40, maximumHours: 48 },
      ],
    });

    expect(result.parts.hours).toBe(10);
    expect(result.score).toBe(90);
  });

  it("does not award cost or assigned-shift points to an empty rota", () => {
    const result = calculateRotaScore({
      coverage: [],
      plannedCost: 0,
      labourBudget: 0,
      totalShifts: 0,
      openShifts: 0,
      people: [],
    });

    expect(result).toEqual({
      score: 20,
      parts: { cover: 0, cost: 0, staffed: 0, hours: 20 },
    });
  });
});

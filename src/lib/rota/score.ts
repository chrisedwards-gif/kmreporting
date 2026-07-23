export type RotaScorePerson = {
  plannedHours: number;
  targetHours: number;
  maximumHours: number;
};

export type RotaScoreInput = {
  coverage: Array<{ required: number; assigned: number }>;
  plannedCost: number;
  labourBudget: number;
  totalShifts: number;
  openShifts: number;
  people: RotaScorePerson[];
};

export type RotaScoreParts = {
  cover: number;
  cost: number;
  staffed: number;
  hours: number;
};

export type RotaScoreResult = {
  score: number;
  parts: RotaScoreParts;
};

const weights = {
  cover: 35,
  cost: 30,
  staffed: 15,
  hours: 20,
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function calculateRotaScore(input: RotaScoreInput): RotaScoreResult {
  const coveredSlots = input.coverage.filter(
    (slot) => slot.assigned >= slot.required,
  ).length;
  const coveragePoints = input.coverage.length
    ? weights.cover * coveredSlots / input.coverage.length
    : 0;

  const overBudgetRatio = input.labourBudget > 0
    ? Math.max(0, input.plannedCost - input.labourBudget) / input.labourBudget
    : 1;
  const costPoints = input.plannedCost <= 0
    ? 0
    : weights.cost * Math.max(0, 1 - overBudgetRatio * 2);

  const staffedPoints = input.totalShifts
    ? weights.staffed * Math.max(0, input.totalShifts - input.openShifts) / input.totalShifts
    : 0;

  const hoursPoints = input.people.length
    ? weights.hours * input.people.reduce((sum, person) => {
        if (person.plannedHours > person.maximumHours) return sum;
        return sum + Math.max(
          0,
          1 - Math.abs(person.plannedHours - person.targetHours)
            / Math.max(person.targetHours, 1),
        );
      }, 0) / input.people.length
    : weights.hours;

  const parts: RotaScoreParts = {
    cover: Math.round(coveragePoints),
    cost: Math.round(costPoints),
    staffed: Math.round(staffedPoints),
    hours: Math.round(hoursPoints),
  };

  return {
    score: clamp(
      Math.round(coveragePoints + costPoints + staffedPoints + hoursPoints),
      0,
      100,
    ),
    parts,
  };
}

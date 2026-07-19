const DAY_IN_MS = 86_400_000;

const parseIsoDate = (value: string) => new Date(`${value}T00:00:00Z`);

export const isSunday = (value: string) => {
  const date = parseIsoDate(value);
  return Number.isFinite(date.valueOf()) && date.getUTCDay() === 0;
};

export const assignmentCoversWeek = (
  startsOn: string,
  endsOn: string | null,
  weekStart: string,
  weekEnd: string,
) => startsOn <= weekEnd && (!endsOn || endsOn >= weekStart);

export const previousSaturday = (effectiveSunday: string) => {
  const date = parseIsoDate(effectiveSunday);
  if (!Number.isFinite(date.valueOf()) || date.getUTCDay() !== 0) return null;
  return new Date(date.valueOf() - DAY_IN_MS).toISOString().slice(0, 10);
};

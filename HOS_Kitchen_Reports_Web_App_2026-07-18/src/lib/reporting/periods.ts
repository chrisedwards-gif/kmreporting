const DAY_IN_MS = 86_400_000;

export function isSevenDayReportingPeriod(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return Number.isFinite(startDate.valueOf()) &&
    Number.isFinite(endDate.valueOf()) &&
    (endDate.valueOf() - startDate.valueOf()) / DAY_IN_MS === 6;
}

export function isMondayToSunday(start: string, end: string) {
  if (!isSevenDayReportingPeriod(start, end)) return false;
  return new Date(`${start}T00:00:00Z`).getUTCDay() === 1 &&
    new Date(`${end}T00:00:00Z`).getUTCDay() === 0;
}

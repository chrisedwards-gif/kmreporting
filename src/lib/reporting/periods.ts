const DAY_IN_MS = 86_400_000;

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export function getLatestCompletedReportingWeek(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  const isoWeekday = date.getUTCDay() || 7;
  const end = new Date(date);
  end.setUTCDate(date.getUTCDate() - isoWeekday);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const due = new Date(end);
  due.setUTCDate(end.getUTCDate() + 2);
  due.setUTCHours(11, 0, 0, 0);
  return { start: toIsoDate(start), end: toIsoDate(end), dueAt: due.toISOString() };
}

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

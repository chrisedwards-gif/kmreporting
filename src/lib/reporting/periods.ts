const DAY_IN_MS = 86_400_000;

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const getLondonDate = (now: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/London",
    year: "numeric",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
};

const londonNoonIso = (value: string) => {
  const probe = new Date(`${value}T12:00:00Z`);
  const zoneName = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = zoneName.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const offsetMinutes = sign * (Number(match?.[2] ?? 0) * 60 + Number(match?.[3] ?? 0));
  return new Date(probe.valueOf() - offsetMinutes * 60_000).toISOString();
};

export function getLatestCompletedReportingWeek(now = new Date()) {
  const date = getLondonDate(now);
  const daysSincePreviousSaturday = ((date.getUTCDay() + 1) % 7) || 7;
  const end = new Date(date);
  end.setUTCDate(date.getUTCDate() - daysSincePreviousSaturday);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const due = new Date(end);
  due.setUTCDate(end.getUTCDate() + 2);
  return { start: toIsoDate(start), end: toIsoDate(end), dueAt: londonNoonIso(toIsoDate(due)) };
}

export function getCurrentReportingWeek(now = new Date()) {
  const date = getLondonDate(now);
  const daysSinceSunday = date.getUTCDay();
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - daysSinceSunday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const due = new Date(end);
  due.setUTCDate(end.getUTCDate() + 2);
  return { start: toIsoDate(start), end: toIsoDate(end), dueAt: londonNoonIso(toIsoDate(due)) };
}

export function isSevenDayReportingPeriod(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return Number.isFinite(startDate.valueOf()) &&
    Number.isFinite(endDate.valueOf()) &&
    (endDate.valueOf() - startDate.valueOf()) / DAY_IN_MS === 6;
}

export function isSundayToSaturday(start: string, end: string) {
  if (!isSevenDayReportingPeriod(start, end)) return false;
  return new Date(`${start}T00:00:00Z`).getUTCDay() === 0 &&
    new Date(`${end}T00:00:00Z`).getUTCDay() === 6;
}

export function isSiteExpectedForReportingWeek(
  site: {
    active: boolean;
    reportingStartDate: string | null;
    reportingEndDate: string | null;
  },
  week: { start: string; end: string },
) {
  if (!site.active || !isSundayToSaturday(week.start, week.end)) return false;
  return (!site.reportingStartDate || site.reportingStartDate <= week.end) &&
    (!site.reportingEndDate || site.reportingEndDate >= week.start);
}

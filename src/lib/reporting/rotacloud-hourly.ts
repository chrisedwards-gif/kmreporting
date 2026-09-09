import { parseCsv, type SourcePeriod } from "@/lib/reporting/imports";

export type HourlyLabourImportRow = {
  businessDate: string;
  slotTime: string;
  staffedHours: number;
  staffCount: number;
  hourlyCost: number;
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const parseMoney = (value: string) => {
  const negative = /^\(.*\)$/.test(value.trim());
  const parsed = Number(value.replace(/[£,$\s()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
};
const parseHours = (value: string) => {
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};
const isoDate = (value: string) => {
  const text = value.trim();
  const uk = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
};
const minutesFromTime = (value: string) => {
  const text = value.trim().toLowerCase();
  const time = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s*([ap]m))?/);
  if (!time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  if (time[3] === "pm" && hour < 12) hour += 12;
  if (time[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
};
const findHeader = (headers: string[], candidates: string[]) => {
  const normalised = candidates.map(normalise);
  return headers.find((header) => normalised.includes(normalise(header)))
    ?? headers.find((header) => normalised.some((candidate) => normalise(header).includes(candidate)));
};

export function parseRotaCloudHourlyCoverage(input: string, expected: SourcePeriod): HourlyLabourImportRow[] {
  const [rawHeaders = [], ...rawRows] = parseCsv(input);
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  if (!headers.length || !rawRows.length) return [];
  const dateColumn = findHeader(headers, ["shift date", "work date", "date"]);
  const startColumn = findHeader(headers, ["start time", "shift start", "start"]);
  const endColumn = findHeader(headers, ["end time", "shift end", "finish time", "finish", "end"]);
  if (!dateColumn || !startColumn || !endColumn) return [];
  const hoursColumn = findHeader(headers, ["paid hours", "total paid hours", "hours"]);
  const costColumn = findHeader(headers, ["shift cost", "total cost", "estimated wage cost", "wage cost", "labour cost", "labor cost", "cost"]);
  const breakColumn = findHeader(headers, ["break minutes", "break mins", "break"]);
  const index = new Map(headers.map((header, position) => [header, position]));
  const value = (row: string[], header?: string) => header ? row[index.get(header) ?? -1] ?? "" : "";
  const buckets = new Map<string, HourlyLabourImportRow>();

  for (const row of rawRows) {
    const businessDate = isoDate(value(row, dateColumn));
    if (!businessDate || businessDate < expected.start || businessDate > expected.end) continue;
    const start = minutesFromTime(value(row, startColumn));
    let end = minutesFromTime(value(row, endColumn));
    if (start == null || end == null) continue;
    if (end <= start) end += 24 * 60;
    const rawDuration = (end - start) / 60;
    if (rawDuration <= 0 || rawDuration > 18) continue;
    const breakMinutes = breakColumn ? Math.min(Math.max(parseHours(value(row, breakColumn)), 0), 240) : 0;
    const suppliedPaidHours = hoursColumn ? parseHours(value(row, hoursColumn)) : 0;
    const paidHours = suppliedPaidHours > 0 ? suppliedPaidHours : Math.max(rawDuration - breakMinutes / 60, 0);
    const shiftCost = costColumn ? Math.max(parseMoney(value(row, costColumn)), 0) : 0;
    const paidFactor = rawDuration > 0 ? Math.min(paidHours / rawDuration, 1) : 1;

    for (let slotStart = Math.floor(start / 60) * 60; slotStart < end; slotStart += 60) {
      const overlapMinutes = Math.max(0, Math.min(end, slotStart + 60) - Math.max(start, slotStart));
      if (!overlapMinutes) continue;
      const overlapHours = overlapMinutes / 60;
      const effectiveHours = overlapHours * paidFactor;
      const costShare = paidHours > 0 ? shiftCost * (effectiveHours / paidHours) : 0;
      const slotMinute = slotStart % (24 * 60);
      const slotDate = slotStart >= 24 * 60 ? addDay(businessDate) : businessDate;
      const slotTime = `${String(Math.floor(slotMinute / 60)).padStart(2, "0")}:00:00`;
      const key = `${slotDate}:${slotTime}`;
      const current = buckets.get(key) ?? { businessDate: slotDate, slotTime, staffedHours: 0, staffCount: 0, hourlyCost: 0 };
      current.staffedHours += effectiveHours;
      current.staffCount += overlapHours;
      current.hourlyCost += costShare;
      buckets.set(key, current);
    }
  }

  return [...buckets.values()]
    .map((row) => ({ ...row, staffedHours: round(row.staffedHours), staffCount: round(row.staffCount), hourlyCost: round(row.hourlyCost) }))
    .sort((a, b) => `${a.businessDate}:${a.slotTime}`.localeCompare(`${b.businessDate}:${b.slotTime}`));
}

function addDay(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

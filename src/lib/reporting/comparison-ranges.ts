export type ComparisonMode = "day" | "month" | "year" | "custom";

export type ComparisonRange = {
  mode: ComparisonMode;
  anchor: string;
  start: string;
  end: string;
  label: string;
};

const isoPattern = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (value: string) => {
  if (!isoPattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (date: Date) => date.toISOString().slice(0, 10);
const endOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

export function resolveComparisonRange(input: {
  mode?: string;
  anchor?: string;
  start?: string;
  end?: string;
  today?: string;
}): ComparisonRange {
  const mode: ComparisonMode = input.mode === "day" || input.mode === "year" || input.mode === "custom" ? input.mode : "month";
  const today = toDate(input.today ?? "") ?? new Date();
  const anchorDate = toDate(input.anchor ?? "") ?? today;
  const anchor = toIso(anchorDate);

  if (mode === "day") {
    return { mode, anchor, start: anchor, end: anchor, label: anchorDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) };
  }

  if (mode === "year") {
    const start = new Date(Date.UTC(anchorDate.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(anchorDate.getUTCFullYear(), 11, 31));
    return { mode, anchor, start: toIso(start), end: toIso(end), label: String(anchorDate.getUTCFullYear()) };
  }

  if (mode === "custom") {
    const customStart = toDate(input.start ?? "");
    const customEnd = toDate(input.end ?? "");
    if (customStart && customEnd && customEnd >= customStart) {
      return {
        mode,
        anchor,
        start: toIso(customStart),
        end: toIso(customEnd),
        label: `${customStart.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} – ${customEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`,
      };
    }
  }

  const start = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1));
  const end = endOfMonth(anchorDate);
  return {
    mode: "month",
    anchor,
    start: toIso(start),
    end: toIso(end),
    label: anchorDate.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

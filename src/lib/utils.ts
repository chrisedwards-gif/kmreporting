export const formatCurrency = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits,
  }).format(value);

export const formatPercentage = (value: number) => `${value.toFixed(1)}%`;

export const formatDate = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
};

export const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/London",
      timeZoneName: "short",
    }).formatToParts(date).map(({ type, value: part }) => [type, part]),
  );

  return `${parts.day} ${parts.month} ${parts.year} at ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
};

export const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

// Accepts only same-origin absolute paths, so a crafted auth link can never
// redirect a signed-in session to an external site.
export const safeInternalPath = (value: string | null | undefined): string | null => {
  if (!value || value.length > 200) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\s]|:\/\//.test(value)) return null;
  return value;
};

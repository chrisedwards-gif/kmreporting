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

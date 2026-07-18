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

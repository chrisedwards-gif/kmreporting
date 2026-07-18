export const formatCurrency = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits,
  }).format(value);

export const formatPercentage = (value: number) => `${value.toFixed(1)}%`;

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));

export const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

export const PRODUCT_STATUSES = [
  "idea",
  "trial_planned",
  "trial_complete",
  "amendments_required",
  "approved",
  "costed",
  "spec_complete",
  "training_complete",
  "live",
  "archived",
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const productStatusLabel = (status: ProductStatus) => status
  .split("_")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

export const grossProfitPercentage = (foodCost: number | null, sellPrice: number | null) => {
  if (foodCost === null || sellPrice === null || !Number.isFinite(foodCost) || !Number.isFinite(sellPrice) || sellPrice <= 0) return null;
  return Math.round(((sellPrice - foodCost) / sellPrice) * 1000) / 10;
};

export const nextProductStatus = (status: ProductStatus): ProductStatus | null => {
  const index = PRODUCT_STATUSES.indexOf(status);
  if (index < 0 || index >= PRODUCT_STATUSES.length - 2) return null;
  return PRODUCT_STATUSES[index + 1];
};

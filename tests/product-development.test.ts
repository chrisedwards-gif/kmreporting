import { describe, expect, it } from "vitest";
import { grossProfitPercentage, nextProductStatus, productStatusLabel } from "@/lib/product-development/calculations";

describe("product development calculations", () => {
  it("calculates gross profit percentage", () => {
    expect(grossProfitPercentage(3, 12)).toBe(75);
    expect(grossProfitPercentage(4.25, 15)).toBe(71.7);
  });

  it("returns no GP when the selling price is unavailable", () => {
    expect(grossProfitPercentage(null, 12)).toBeNull();
    expect(grossProfitPercentage(3, 0)).toBeNull();
  });

  it("moves through the delivery workflow without automatically archiving", () => {
    expect(nextProductStatus("idea")).toBe("trial_planned");
    expect(nextProductStatus("training_complete")).toBe("live");
    expect(nextProductStatus("live")).toBeNull();
  });

  it("formats status labels", () => {
    expect(productStatusLabel("amendments_required")).toBe("Amendments Required");
  });
});

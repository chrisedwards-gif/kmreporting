import { describe, expect, it } from "vitest";
import {
  createRotaWarning,
  parseRotaWarning,
  prefixRotaWarning,
  visibleRotaWarnings,
} from "@/lib/rota/warnings";

describe("rota warning visibility", () => {
  it("shows operational warnings to every rota audience", () => {
    const warning = createRotaWarning("Friday 18:00 is below cover.", "all");

    expect(visibleRotaWarnings([warning], "all")).toEqual([
      "Friday 18:00 is below cover.",
    ]);
    expect(visibleRotaWarnings([warning], "management")).toEqual([
      "Friday 18:00 is below cover.",
    ]);
  });

  it("hides management warnings without relying on their wording", () => {
    const warning = createRotaWarning(
      "Committed leadership allocation exceeds the visible allowance.",
      "management",
    );

    expect(visibleRotaWarnings([warning], "all")).toEqual([]);
    expect(visibleRotaWarnings([warning], "management")).toEqual([
      "Committed leadership allocation exceeds the visible allowance.",
    ]);
  });

  it("treats untagged legacy warnings as management-only", () => {
    const legacy = "A historical warning with unknown privacy semantics.";

    expect(parseRotaWarning(legacy)).toEqual({
      message: legacy,
      visibility: "management",
    });
    expect(visibleRotaWarnings([legacy], "all")).toEqual([]);
  });

  it("preserves visibility when a business date is prefixed", () => {
    const dated = prefixRotaWarning(
      "2026-07-31: ",
      createRotaWarning("One time slot is below cover.", "all"),
    );

    expect(parseRotaWarning(dated)).toEqual({
      message: "2026-07-31: One time slot is below cover.",
      visibility: "all",
    });
  });
});

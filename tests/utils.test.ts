import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/utils";

describe("shared formatters", () => {
  it("formats reporting dates without shifting the day", () => {
    expect(formatDate("2026-07-18")).toBe("18 Jul 2026");
  });

  it("formats database timestamps without creating an invalid date", () => {
    expect(formatDate("2026-07-18T20:16:00.000Z")).toBe("18 Jul 2026");
  });

  it("fails safely for an invalid date value", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});

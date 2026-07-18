import { describe, expect, it } from "vitest";
import { formatDate, safeInternalPath } from "@/lib/utils";

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

describe("auth redirect path allow-listing", () => {
  it("accepts same-origin absolute paths, including query strings", () => {
    expect(safeInternalPath("/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("/auth/set-password?source=invite")).toBe("/auth/set-password?source=invite");
  });

  it("rejects protocol-relative and absolute external destinations", () => {
    expect(safeInternalPath("//evil.example.com")).toBeNull();
    expect(safeInternalPath("https://evil.example.com/dashboard")).toBeNull();
    expect(safeInternalPath("/redirect?to=https://evil.example.com")).toBeNull();
  });

  it("rejects empty, relative, oversized and malformed values", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath("")).toBeNull();
    expect(safeInternalPath("dashboard")).toBeNull();
    expect(safeInternalPath("/a\\b")).toBeNull();
    expect(safeInternalPath(`/${"x".repeat(220)}`)).toBeNull();
  });
});

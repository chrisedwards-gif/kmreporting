import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";


const expectNoSeriousAccessibilityViolations = async (page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
};

const switchPersona = async (page, role) => {
  await page.context().clearCookies();
  await page.context().addCookies([{
    name: "hos_demo_persona",
    value: role,
    url: "http://127.0.0.1:3000",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard");
};

test("Admin lands in the group workspace", async ({ page }) => {
  await switchPersona(page, "admin");
  await expect(page.getByRole("heading", { name: "The group at a glance." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toBeVisible();
  await expect(page.getByText("Dough Religion", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Kardia", { exact: true }).first()).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager sees only their kitchen persona and records", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await expect(page.getByRole("heading", { name: "Hi, Scott." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kitchen checks" })).toBeVisible();
  await expect(page.getByText("Kardia", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dough Religion", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Management summary" })).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);
});

test("Viewer lands on reporting insight with no operational controls", async ({ page }) => {
  await switchPersona(page, "viewer");
  await expect(page.getByText("Management summary", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Management summary", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kitchen checks" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByText("No operational actions are assigned to this access role.")).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);
});

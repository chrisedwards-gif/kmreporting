import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const appUrl = "http://127.0.0.1:3100";

const expectNoSeriousAccessibilityViolations = async (page) => {
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  const summary = blocking.flatMap((violation) => violation.nodes.map((node) => ({
    rule: violation.id,
    target: node.target.join(" "),
    message: node.failureSummary?.replaceAll("\n", " ") ?? violation.help,
  })));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
};

const switchPersona = async (page, role) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.context().clearCookies();
  await page.context().addCookies([{
    name: "hos_demo_persona",
    value: role,
    url: appUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
};

test("Admin lands in the group workspace", async ({ page }) => {
  await switchPersona(page, "admin");
  await expect(page.getByRole("heading", { name: "The group at a glance." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toBeVisible();
  await expect(page.getByText("Dough Religion", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Kardia", { exact: true }).first()).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager sees their kitchen, actions and nightly staffing check", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await expect(page.getByRole("heading", { name: "Hi, Scott." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kitchen checks" })).toBeVisible();
  await expect(page.getByText("Kardia", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dough Religion", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Management summary" })).toHaveCount(0);
  await expect(page.getByText("Tonight’s staffing check", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Was the cover right?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Right" })).toBeVisible();

  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace search" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start weekly report" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager can see and unlock weekly submission before reaching the form footer", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await page.goto("/reports/new", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Build the week’s report." })).toBeVisible();
  const submitButton = page.getByRole("button", { name: "Submit weekly report" }).first();
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeDisabled();
  await expect(page.getByText(/checks before submission/)).toBeVisible();

  await page.getByLabel("Net sales excluding VAT and service charge").fill("12000");
  await page.getByLabel(/confirm the net-sales total/).check();
  await page.getByLabel(/confirm the food-spend and credit total/).check();
  await page.getByLabel("Aggregate weekly wage cost").fill("3650");
  await page.getByLabel(/confirm the aggregate labour total/).check();

  await expect(submitButton).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Ready to submit" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager builds a ranked salary-safe rota with group locations", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await page.goto("/rotas?week=2026-07-20", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Build the week with demand, cost and cover/ })).toBeVisible();
  await expect(page.getByLabel("Kitchen")).toHaveValue("kardia");
  await expect(page.getByRole("option", { name: /Dough Religion/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Week 30 rota/ })).toBeVisible();
  await expect(page.getByLabel(/Live rota score/i)).toBeVisible();
  await expect(page.getByText("Sales forecast", { exact: true })).toBeVisible();
  await expect(page.getByText("Hourly COL %", { exact: true })).toBeVisible();
  const rotaGrid = page.getByLabel("Weekly rota builder");
  await expect(rotaGrid.getByText("Group Chef", { exact: true }).first()).toBeVisible();
  await expect(rotaGrid.getByText("Chris Edwards", { exact: true })).toBeVisible();
  await expect(rotaGrid.getByText("Scott Hutton", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "CSV" })).toBeVisible();
  await expect(page.getByText(/Kitchen managers see hourly-team cost only/)).toBeVisible();
  await expect(page.getByText("Allocated salary cost", { exact: true })).toHaveCount(0);

  const chrisRow = page.getByRole("row").filter({ hasText: "Chris Edwards" }).first();
  await chrisRow.getByRole("button", { name: /Add/ }).first().click();
  await page.getByRole("button", { name: "Status / location" }).click();
  await expect(page.getByRole("option", { name: "Head office" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "Ask a senior operator to challenge the plan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Was the cover right?" })).toHaveCount(0);
  await expectNoSeriousAccessibilityViolations(page);
});

test("Admin can calibrate the rota demand curve and safety rules", async ({ page }) => {
  await switchPersona(page, "admin");
  await page.goto("/rotas/settings?site=00000000-0000-4000-8000-000000000001", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Rota calibration." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trading hours and safe cover" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Day-part demand curve" })).toBeVisible();
  await expect(page.getByLabel("Curve mode")).toHaveValue("automatic");
  await expect(page.getByLabel("Saturday demand at 17:00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save rota calibration" })).toBeVisible();
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

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
  await expect(page.getByRole("heading", { name: "What should we do next?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toBeVisible();
  await expect(page.getByText("Dough Religion", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Kardia", { exact: true }).first()).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager sees their scoped kitchen and reporting actions", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await expect(page.getByRole("heading", { name: "Hi, Scott." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Weekly reports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "My 1-1s" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Action log" })).toBeVisible();
  await expect(page.getByText("Kardia", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Dough Religion", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Management summary" })).toHaveCount(0);

  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace search" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start weekly report" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager can start a site-scoped product and add an action", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await page.goto("/product-development", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Product development." })).toBeVisible();
  await page.getByRole("button", { name: "New product" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Kitchen / concept")).toHaveValue("kardia");
  await expect(page.getByRole("option", { name: "Group-wide" })).toHaveCount(0);
  await page.getByLabel("Close", { exact: true }).click();

  await page.goto("/performance/actions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Today’s actions." })).toBeVisible();
  await page.getByRole("button", { name: "New action" }).click();
  const actionDialog = page.getByRole("dialog", { name: "Add an action" });
  await expect(actionDialog).toBeVisible();
  await expect(actionDialog.getByText("Scott Hutton", { exact: true })).toBeVisible();
  await expect(actionDialog).toContainText("Kardia");
  await expect(actionDialog.getByRole("textbox", { name: "Action", exact: true })).toBeVisible();
  await expect(actionDialog.getByRole("button", { name: "Add action", exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("Kitchen Manager sees the upload-first weekly reporting workflow", async ({ page }) => {
  await switchPersona(page, "kitchen_manager");
  await page.goto("/reports/new", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Upload the week once." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Drop the whole week in once." })).toBeVisible();
  await expect(page.getByText("Drop all weekly reports here", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Upload & build draft/ })).toBeDisabled();
  await expect(page.getByText("No exports available? Enter the week manually", { exact: true })).toBeVisible();
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
  const locationSelect = page.getByLabel("Status or working location");
  await expect(locationSelect).toBeVisible();
  await locationSelect.selectOption("head_office");
  await expect(locationSelect).toHaveValue("head_office");
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
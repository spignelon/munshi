import { expect, test } from "@playwright/test";
import { FULL_PLAN, demoLogin, ledgerTotal, sendToMunshi } from "./helpers";

test.describe("Munshi voice screen (voice-first; no chat view)", () => {
  test.beforeEach(async ({ page }) => { await demoLogin(page); });

  test("one request → plan → nothing moves until the owner approves → approve → results + audit trail", async ({ page }) => {
    await sendToMunshi(page, FULL_PLAN);
    const plan = page.getByTestId("voice-plan");
    await expect(plan).toContainText("Shree Foods Distributors ko phone karke order");
    await expect(plan).toContainText("41 udhaar customers");
    await expect(plan).toContainText("Aapki haan ka intezaar");
    expect(await ledgerTotal(page)).toBe(38000); // the checks: nothing has moved yet

    await plan.getByRole("button", { name: "Haan, karo" }).click();
    await expect(plan).toContainText(/MUN-\d+/, { timeout: 30_000 });
    await expect(plan).toContainText(/\d+% chhoot/);
    await expect(plan).toContainText("41 reminders bheje");
    expect(await ledgerTotal(page)).toBeLessThan(38000); // simulated payments came back

    // audit trail: the approval is traceable, and the (simulated) supplier call transcript is stored
    await page.goto("/app/activity");
    await expect(page.getByText(/Approved via web/).first()).toBeVisible();
    await expect(page.getByText("Simulated").first()).toBeVisible();
    await page.getByRole("button", { name: /Call transcript/ }).first().click();
    await expect(page.getByText(/Munshi bol raha hoon/).first()).toBeVisible();
    await page.getByRole("tab", { name: "Audit log" }).click();
    await expect(page.getByText("plan_approved").first()).toBeVisible();
    await expect(page.getByText("supplier_order_confirmed").first()).toBeVisible();
  });

  test("a pending plan also shows up on the dashboard for approval", async ({ page }) => {
    await sendToMunshi(page, "udhaar wapas lao");
    await page.goto("/app");
    await expect(page.getByTestId("plan-card").first()).toContainText("udhaar customers");
    await page.getByTestId("plan-card").first().getByRole("button", { name: "Haan, karo" }).click();
    await expect(page.getByText(/udhaar reminder bheje/).first()).toBeVisible({ timeout: 30_000 }); // confirmation toast
    await expect(page.getByTestId("plan-card")).toHaveCount(0); // no longer pending
    await expect(page.getByText("Sab clear hai")).toBeVisible();
  });

  test("rejecting a plan does nothing", async ({ page }) => {
    await sendToMunshi(page, "udhaar wapas lao");
    const plan = page.getByTestId("voice-plan");
    await expect(plan).toContainText("udhaar customers");
    await plan.getByRole("button", { name: "Nahi", exact: true }).click();
    await expect(plan).toContainText("rejected");
    expect(await ledgerTotal(page)).toBe(38000);
  });

  test("spending cap blocks an oversized order, even if the owner says yes", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByLabel("Max per order (₹)").fill("10000");
    await page.getByRole("button", { name: "Save karein" }).click();
    await expect(page.getByText("Settings save ho gayi")).toBeVisible();
    await sendToMunshi(page, "supplier ko order do");
    const plan = page.getByTestId("voice-plan");
    await expect(plan).toContainText(/per-order limit/);
    await expect(plan.getByRole("button", { name: "Haan, karo" })).toHaveCount(0);
  });

  test("typing 'haan' in the type-instead box approves the pending plan", async ({ page }) => {
    await sendToMunshi(page, "loan chahiye");
    await expect(page.getByTestId("voice-plan")).toContainText("loan");
    await page.getByRole("button", { name: "Type a message" }).click();
    await page.getByLabel("Type to Munshi").fill("haan");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("voice-reply")).toContainText(/loan offer ready hai/, { timeout: 20_000 });
  });
});

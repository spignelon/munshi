import { expect, test } from "@playwright/test";
import { DIWALI, demoLogin, sendToMunshi } from "./helpers";

test.describe("Munshi journey (the pitch's demo flow)", () => {
  test.beforeEach(async ({ page }) => { await demoLogin(page); });

  test("one sentence → plan → nothing moves until Raj approves → approve → results + audit trail", async ({ page }) => {
    await sendToMunshi(page, DIWALI);
    const card = page.getByTestId("plan-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Sharma Distributors ko phone karke order");
    await expect(card).toContainText("41 udhaar customers");
    await expect(card).toContainText("Approval chahiye");

    // The checks: ledger untouched before approval
    await page.goto("/app/udhaar");
    await expect(page.getByTestId("udhaar-total")).toHaveText("₹38,000");

    await page.goto("/app/munshi");
    await page.getByRole("button", { name: "Haan, karo" }).click();
    await expect(page.getByText(/MUN-\d+/).first()).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(/\d+% chhoot/);
    await expect(card).toContainText("41 reminders bheje");
    await expect(page.getByText("Simulated").first()).toBeVisible();

    // call transcript expands
    await page.getByRole("button", { name: /Call transcript/ }).first().click();
    await expect(page.getByText("Namaste Sharma ji").first()).toBeVisible();

    // udhaar went down (simulated payments)
    await page.goto("/app/udhaar");
    await expect(page.getByTestId("udhaar-total")).not.toHaveText("₹38,000");

    // audit trail: approval is traceable
    await page.goto("/app/activity");
    await expect(page.getByText(/Approved via web/).first()).toBeVisible();
    await page.getByRole("tab", { name: "Audit log" }).click();
    await expect(page.getByText("plan_approved").first()).toBeVisible();
    await expect(page.getByText("supplier_order_confirmed").first()).toBeVisible();
  });

  test("rejecting a plan does nothing", async ({ page }) => {
    await sendToMunshi(page, "udhaar wapas lao");
    await expect(page.getByTestId("plan-card").first()).toBeVisible();
    await page.getByRole("button", { name: "Nahi", exact: true }).click();
    await expect(page.getByText("Rejected").first()).toBeVisible();
    await page.goto("/app/udhaar");
    await expect(page.getByTestId("udhaar-total")).toHaveText("₹38,000");
  });

  test("spending cap blocks an oversized order, even if Raj says yes", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByLabel("Max per order (₹)").fill("10000");
    await page.getByRole("button", { name: "Save karein" }).click();
    await expect(page.getByText("Settings save ho gayi")).toBeVisible();
    await sendToMunshi(page, "Sharma ji ko order do");
    await expect(page.getByText(/per-order limit/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Haan, karo" })).toHaveCount(0);
  });

  test("typing 'haan' approves the pending plan", async ({ page }) => {
    await sendToMunshi(page, "loan chahiye");
    await expect(page.getByTestId("plan-card").first()).toContainText("loan");
    await page.getByLabel("Munshi ko likhein").fill("haan");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/loan offer ready hai/).first()).toBeVisible({ timeout: 20_000 });
  });

  test("hold the mic: Hindi speech → Whisper → plan (fake mic feeds hindi.wav)", async ({ page }) => {
    await page.goto("/app/munshi");
    await page.getByRole("button", { name: "Bolkar batayein" }).click();
    await expect(page.getByText(/Sun raha hoon/)).toBeVisible();
    await page.waitForTimeout(4500); // let the fake device play the clip
    await page.getByRole("button", { name: /Recording rokein/ }).click();
    await expect(page.getByTestId("plan-card").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Diwali aa rahi hai").first()).toBeVisible();
  });
});

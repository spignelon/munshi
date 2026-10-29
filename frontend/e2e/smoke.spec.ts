// Production smoke test: E2E_BASE_URL=https://<deployment> npx playwright test e2e/smoke.spec.ts
// Uses the real backend (real Groq, Turso). Mock mode must be ON so nothing real is sent.
import { expect, test } from "@playwright/test";
import { DIWALI, demoLogin, sendToMunshi } from "./helpers";

test("health endpoint reports the stack", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  console.log("health:", JSON.stringify(j));
  expect(j.ok).toBe(true);
  expect(j.groq).toBe(true);
});

test("demo login → Diwali command → plan → approve (simulated)", async ({ page }) => {
  await demoLogin(page);
  await expect(page.getByText("₹38,000").first()).toBeVisible();
  await sendToMunshi(page, DIWALI);
  const card = page.getByTestId("plan-card").first();
  await expect(card).toContainText("Sharma Distributors", { timeout: 45_000 });
  await page.getByRole("button", { name: "Haan, karo" }).click();
  await expect(page.getByText(/MUN-\d+/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Simulated").first()).toBeVisible();
});

// Production smoke test: E2E_BASE_URL=https://<deployment> npx playwright test e2e/smoke.spec.ts
// Uses the real backend (real Groq, Turso). Mock mode must be ON so nothing real is sent.
import { expect, test } from "@playwright/test";
import { FULL_PLAN, demoLogin, sendToMunshi } from "./helpers";

test("health endpoint reports the stack", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  console.log("health:", JSON.stringify(j));
  expect(j.ok).toBe(true);
  expect(j.groq).toBe(true);
});

test("demo login → voice screen with a typed request → plan → approve (simulated)", async ({ page }) => {
  await demoLogin(page);
  await expect(page.getByText("₹38,000").first()).toBeVisible();
  await sendToMunshi(page, FULL_PLAN); // typed through the voice screen (no speech credits); the fake mic is muted
  const plan = page.getByTestId("voice-plan");
  await expect(plan).toContainText("Shree Foods Distributors", { timeout: 45_000 });
  await plan.getByRole("button", { name: "Haan, karo" }).click();
  await expect(plan).toContainText(/MUN-\d+/, { timeout: 60_000 });
  await expect(plan).toContainText("simulated");
});

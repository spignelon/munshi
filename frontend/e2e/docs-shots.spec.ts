// Captures the README screenshots into ../docs/screenshots (run with E2E_LIVE=1 for real Groq replies; actions stay simulated in mock mode).
// Not an assertion suite:  E2E_LIVE=1 GROQ_API_KEY=… npx playwright test e2e/docs-shots.spec.ts
import { expect, test } from "@playwright/test";
import { demoLogin, sendToMunshi } from "./helpers";

const OUT = "../docs/screenshots";
const REQUEST = "Diwali aa rahi hai. Stock check karo, supplier ko order do, aur udhaar wapas lao.";

test("README screenshots", async ({ page }, info) => {
  test.setTimeout(240_000);
  const tag = info.project.name;
  const shot = (name: string, full = false) => page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: full });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await shot("landing");

  await demoLogin(page);
  await page.waitForLoadState("networkidle");
  await shot("dashboard");

  await sendToMunshi(page, REQUEST);
  await expect(page.getByTestId("voice-plan")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(1500);
  await shot("voice-plan");

  await page.getByTestId("voice-plan").getByRole("button", { name: "Haan, karo" }).click();
  await expect(page.getByTestId("voice-reply")).toContainText(/order|pakka|reminder|bheje|Ho gaya/i, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot("voice-done");

  for (const [name, url] of [["activity", "/app/activity"], ["udhaar", "/app/udhaar"], ["stock", "/app/stock"], ["customers", "/app/customers"]] as const) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    await shot(name);
  }
});

test("README screenshot: voice mode, Munshi thinking", async ({ page }, info) => {
  await demoLogin(page, false);
  await page.goto("/app/munshi");
  await expect(page.getByTestId("voice-mode")).toBeVisible();
  // the fake microphone loops a Hindi clip, so after a moment Munshi is mid-turn: the "thinking" look
  await expect(page.getByTestId("avatar-thinking")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/${info.project.name}-voice-thinking.png` });
});

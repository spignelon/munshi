// Captures the README screenshots into ../docs/screenshots for desktop (1440x900) and mobile (Pixel 7).
// Real Groq planning, fresh sample shop, actions stay in the app's practice mode so nothing real is sent.
//   E2E_LIVE=1 GROQ_API_KEY=… npx playwright test e2e/docs-shots.spec.ts
// Not an assertion suite. Compress afterwards:  pngquant --quality 70-92 --ext .png --force ../docs/screenshots/*.png
import { expect, test } from "@playwright/test";
import { adminLogin, demoLogin, sendToMunshi } from "./helpers";

const OUT = "../docs/screenshots";
const REQUEST = "Diwali aa rahi hai. Stock check karo, supplier ko order do, aur udhaar wapas lao.";

test.beforeEach(async ({ page }) => {
  // the purple practice-mode strip is chrome, not content: keep it out of the marketing shots
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = '[data-testid="mock-banner"]{display:none!important}';
      document.head.appendChild(s);
    });
  });
});

test("README screenshots: every screen", async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name;
  const mobile = tag === "mobile";
  const shot = (name: string) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const visit = async (name: string, url: string) => {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(700);
    await shot(name);
  };

  await visit("landing", "/");
  await visit("login", "/login");
  await visit("signup", "/signup");

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

  await visit("activity", "/app/activity");
  await page.getByRole("tab", { name: /Audit log/ }).click().catch(() => page.getByText("Audit log").first().click());
  await page.waitForTimeout(800);
  await shot("audit-log");
  await visit("udhaar", "/app/udhaar");
  await visit("stock", "/app/stock");
  await visit("customers", "/app/customers");
  await visit("suppliers", "/app/suppliers");
  await visit("settings", "/app/settings");
  if (mobile) {
    await page.goto("/app");
    await page.getByRole("button", { name: "More" }).click();
    await page.waitForTimeout(600);
    await shot("more-menu");
  }

  // Munshi mid-thought: the fake microphone loops a Hindi clip, so a turn starts on its own
  await page.goto("/app/munshi");
  await expect(page.getByTestId("avatar-thinking")).toBeVisible({ timeout: 30_000 });
  await shot("voice-thinking");
});

test("README screenshots: admin console", async ({ page }, info) => {
  test.setTimeout(120_000);
  const tag = info.project.name;
  await adminLogin(page);
  await page.evaluate(async () => {
    await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json", Authorization: `Bearer ${localStorage.getItem("munshi.token")}` },
      body: JSON.stringify({ values: { mock_mode: false } }) });
  });
  await page.goto("/app/admin");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${tag}-admin-providers.png` });
  await page.getByRole("tab", { name: /System/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${tag}-admin-system.png` });
});

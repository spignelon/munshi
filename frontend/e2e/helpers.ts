import { expect, type Page } from "@playwright/test";

export const FULL_PLAN = "Stock check karo, supplier ko order do, udhaar wapas lao, aur purane customers ko offer bhejo.";

/** Log in as the demo merchant and reset the demo shop to its pristine seeded state. */
export async function demoLogin(page: Page, reset = true) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("heading", { name: /Namaste, Ramesh ji/ })).toBeVisible({ timeout: 30_000 });
  if (reset) {
    await page.evaluate(async () => {
      await fetch("/api/shop/demo-data", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("munshi.token")}` } });
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: /Namaste, Ramesh ji/ })).toBeVisible();
  }
}

export async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@munshi.app");
  await page.getByLabel("Password").fill("admin12345");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}

/** Opens Munshi's voice screen and sends `text` as the first turn. The mic is muted right away: in tests Chromium's fake
 *  microphone loops a Hindi clip, which would otherwise start extra voice turns. */
export async function sendToMunshi(page: Page, text: string) {
  await page.goto(`/app/munshi?q=${encodeURIComponent(text)}&send=1`);
  await expect(page.getByTestId("voice-mode")).toBeVisible();
  await page.getByRole("button", { name: "Mute mic" }).click();
  await expect(page.getByTestId("voice-reply")).toBeVisible({ timeout: 45_000 });
}

/** Total udhaar from the API (what the ledger page shows), read with the logged-in token. */
export async function ledgerTotal(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const r = await fetch("/api/udhaar", { headers: { Authorization: `Bearer ${localStorage.getItem("munshi.token")}` } });
    return Math.round((await r.json()).total);
  });
}

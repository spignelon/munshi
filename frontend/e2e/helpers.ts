import { expect, type Page } from "@playwright/test";

export const DIWALI = "Diwali aa rahi hai. Stock check karo, Sharma ji ko order do, aur udhaar wapas lao.";

/** Log in as the demo merchant and reset the demo shop to its pristine seeded state. */
export async function demoLogin(page: Page, reset = true) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try demo as Raj" }).click();
  await expect(page.getByRole("heading", { name: /Namaste, Raj ji/ })).toBeVisible({ timeout: 30_000 });
  if (reset) {
    await page.evaluate(async () => {
      await fetch("/api/shop/demo-data", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("munshi.token")}` } });
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: /Namaste, Raj ji/ })).toBeVisible();
  }
}

export async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@munshi.app");
  await page.getByLabel("Password").fill("admin12345");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/app/);
}

export async function sendToMunshi(page: Page, text: string) {
  await page.goto("/app/munshi");
  await page.getByLabel("Munshi ko likhein").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

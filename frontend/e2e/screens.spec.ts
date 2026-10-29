// Visual review helper: captures every page into ./screenshots (gitignored). Not an assertion suite.
import { expect, test } from "@playwright/test";

const pages = [["dashboard", "/app"], ["munshi", "/app/munshi"], ["activity", "/app/activity"], ["udhaar", "/app/udhaar"], ["stock", "/app/stock"],
  ["customers", "/app/customers"], ["suppliers", "/app/suppliers"], ["settings", "/app/settings"]] as const;

test("capture screens", async ({ page }, info) => {
  const tag = info.project.name;
  await page.goto("/");
  await page.screenshot({ path: `screenshots/${tag}-landing.png`, fullPage: true });
  await page.getByRole("link", { name: "Log in" }).first().click();
  await page.screenshot({ path: `screenshots/${tag}-login.png` });
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("heading", { name: /Namaste, Ramesh ji/ })).toBeVisible({ timeout: 30_000 });
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `screenshots/${tag}-${name}.png`, fullPage: true });
  }
});

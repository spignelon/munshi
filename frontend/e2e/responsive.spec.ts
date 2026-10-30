import { expect, test } from "@playwright/test";
import { demoLogin } from "./helpers";

const routes = ["/app", "/app/munshi", "/app/activity", "/app/udhaar", "/app/stock", "/app/customers", "/app/suppliers", "/app/settings"];

test("no horizontal overflow on any page; navigation fits the viewport", async ({ page }, info) => {
  test.setTimeout(150_000); // eight pages in a row (the Munshi page also starts the mic + voice detection)
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await demoLogin(page, false);
  for (const r of routes) {
    await page.goto(r);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${r} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    if (info.project.name === "mobile") await page.screenshot({ path: `screenshots/mobile-${r.replace(/\//g, "_")}.png` });
  }
  if (info.project.name === "mobile") {
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  }
});

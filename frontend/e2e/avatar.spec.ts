// The animated assistant on the voice screen: expressions per state, lip movement from the real reply audio, blinking.
import { expect, test } from "@playwright/test";
import { demoLogin } from "./helpers";

test.beforeEach(async ({ page }) => { await demoLogin(page); });

test("avatar shows listening → thinking → speaking and her mouth moves with the reply audio", async ({ page }) => {
  // hold the server reply so the 'thinking' look can be observed reliably, even on a slow machine
  await page.route("**/api/voice/turn", async (route) => { await new Promise((r) => setTimeout(r, 7000)); await route.continue(); });
  await page.goto("/app/munshi?q=" + encodeURIComponent("loan chahiye") + "&send=1");
  const avatar = page.getByTestId("avatar");
  await expect(avatar).toBeVisible();

  await expect(avatar).toHaveAttribute("data-state", "thinking", { timeout: 10_000 });
  await expect(page.getByTestId("avatar-thinking")).toBeVisible();
  await expect(page.getByTestId("voice-status")).toContainText("Soch rahi hoon"); // status text and avatar agree
  await page.screenshot({ path: "screenshots/avatar-thinking.png" });
  await page.getByRole("button", { name: "Mute mic" }).click(); // the fake mic loops a Hindi clip; keep it out of the rest of this test

  await expect(avatar).toHaveAttribute("data-state", "speaking", { timeout: 40_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "screenshots/avatar-speaking-a.png" });
  await page.waitForTimeout(350);
  await page.screenshot({ path: "screenshots/avatar-speaking-b.png" });
  // lip-sync: the mouth opened measurably while the reply audio played
  await expect.poll(async () => Number(await avatar.getAttribute("data-peak-mouth")), { timeout: 15_000 }).toBeGreaterThan(0.08);

  await expect(avatar).toHaveAttribute("data-state", "listening", { timeout: 60_000 });
  await expect(page.getByTestId("avatar-thinking")).toHaveCount(0);
  await page.screenshot({ path: "screenshots/avatar-listening.png" });
});

test("avatar blinks on her own", async ({ page }) => {
  await page.goto("/app/munshi");
  const avatar = page.getByTestId("avatar");
  await expect(avatar).toBeVisible();
  await page.getByRole("button", { name: "Mute mic" }).click();
  // blinks are scheduled every ~2-6 s by her animation loop (counted there, so this does not depend on screenshot/frame timing)
  await expect.poll(async () => Number(await avatar.getAttribute("data-blinks")), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
});

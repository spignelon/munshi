import { expect, test } from "@playwright/test";
import { FULL_PLAN, adminLogin, demoLogin, sendToMunshi } from "./helpers";

test("merchants cannot open the admin console", async ({ page }) => {
  await demoLogin(page, false);
  await page.goto("/app/admin");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("admin: mock toggle, TTS provider, secrets masked, system status", async ({ page }) => {
  await adminLogin(page);
  await page.getByRole("link", { name: "Admin" }).first().click();
  await expect(page.getByRole("heading", { name: "Providers & system" })).toBeVisible();
  await expect(page.getByTestId("mock-banner")).toBeVisible();

  // ElevenLabs settings from the admin dashboard
  await page.getByRole("radio", { name: /ElevenLabs/ }).click();
  await page.getByLabel("ElevenLabs API key").fill("sk_test_abcd1234");
  await page.getByLabel("Voice ID").fill("voice123");
  await page.getByRole("button", { name: "Save voice" }).click();
  await expect(page.getByText("Settings save ho gayi")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("ElevenLabs API key")).toHaveValue(/^••••1234$/); // secret never sent back in clear
  await page.getByRole("radio", { name: /Edge TTS/ }).click();
  await page.getByRole("button", { name: "Save voice" }).click();

  // Twilio fields persist
  await page.getByLabel("Account SID").fill("ACtest123");
  await page.getByLabel("Voice number (calls)").fill("+15551234567");
  await page.getByRole("button", { name: "Save Twilio" }).click();
  await expect(page.getByText("Settings save ho gayi").last()).toBeVisible();
  await expect(page.getByText(/\/api\/webhooks\/whatsapp/)).toHaveCount(0); // it's an input value, not text
  await expect(page.getByRole("textbox", { name: /WhatsApp sandbox → “When a message comes in”/ })).toHaveValue(/\/api\/webhooks\/whatsapp$/);

  // flip mock OFF → banner disappears; real mode without creds fails loudly
  await page.getByRole("switch", { name: "Mock mode" }).click();
  await expect(page.getByTestId("mock-banner")).toHaveCount(0);
  await page.getByRole("tab", { name: "System" }).click();
  await expect(page.getByTestId("db-kind")).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();

  await demoLoginSwitch(page);
  await sendToMunshi(page, FULL_PLAN);
  await page.getByRole("button", { name: "Haan, karo" }).click();
  await expect(page.getByText(/Twilio is not configured/).first()).toBeVisible({ timeout: 30_000 });

  // back to mock → works again
  await adminLoginAgain(page);
});

async function demoLoginSwitch(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await demoLogin(page);
}

async function adminLoginAgain(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await adminLogin(page);
  await page.goto("/app/admin");
  await page.getByRole("switch", { name: "Mock mode" }).click();
  await expect(page.getByTestId("mock-banner")).toBeVisible();
  await page.getByRole("tab", { name: "Users" }).click();
  await expect(page.getByTestId("user-row").first()).toBeVisible();
}


test("admin sees Sarvam voice controls and the credit meter", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/app/admin");
  const panel = page.getByTestId("sarvam-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Sarvam API key")).toBeVisible();
  await expect(panel.getByLabel("Sarvam voice")).toContainText("Simran");
  await expect(panel.getByTestId("sarvam-meter")).toContainText("Estimated Sarvam spend");
  await page.getByRole("tab", { name: "System" }).click();
  await expect(page.getByText("Sarvam credits (this deployment)")).toBeVisible();
});

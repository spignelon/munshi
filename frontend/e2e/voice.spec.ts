// Hands-free voice mode. Chromium's fake microphone plays e2e/fixtures/hindi.wav, so the real VAD, WAV encoder and
// /api/voice/turn round trip run (backend uses fake Groq; no Sarvam key => no credits are spent).
import { expect, test } from "@playwright/test";
import { demoLogin } from "./helpers";

test.beforeEach(async ({ page }) => { await demoLogin(page); });

test("voice mode: listens, detects the end of speech, plans, and approves from inside the overlay", async ({ page }) => {
  await page.goto("/app/munshi"); // voice is the default Munshi screen: it opens listening immediately
  const vm = page.getByTestId("voice-mode");
  await expect(vm).toBeVisible();
  await expect(page.getByTestId("voice-status")).toContainText(/sun rahi|Boliye|Soch rahi|bol rahi/i);

  // the fake mic speaks; after ~0.9 s of silence the utterance is sent and Munshi replies with a plan
  await expect(page.getByTestId("voice-heard")).toContainText("Stock check karo", { timeout: 45_000 });
  const plan = page.getByTestId("voice-plan");
  await expect(plan).toContainText("Shree Foods Distributors ko phone");
  await expect(page.getByTestId("voice-reply")).not.toBeEmpty();

  await page.getByRole("button", { name: "Mute mic" }).click(); // stop the looping fake mic from starting another turn
  await expect(page.getByTestId("voice-status")).toContainText("mute");
  await plan.getByRole("button", { name: "Haan, karo" }).click();
  await expect(plan).toContainText("done", { timeout: 30_000 });
  await expect(plan).toContainText(/chhoot/);

  await page.getByRole("button", { name: "End voice mode" }).click();
  await expect(vm).toHaveCount(0);
  await expect(page).toHaveURL(/\/app$/); // leaving voice returns to the dashboard

  // the spoken turn is recorded in Activity with the approval that followed it
  await page.goto("/app/activity");
  await expect(page.getByText(/Stock check karo/).first()).toBeVisible();
  await expect(page.getByText(/Approved via web/).first()).toBeVisible();
});

test("the Munshi tab is the voice screen; Escape returns to the dashboard", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Voice mode" }).click();
  await expect(page).toHaveURL(/\/app\/munshi/);
  await expect(page.getByTestId("voice-mode")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("voice-mode")).toHaveCount(0);
  await expect(page).toHaveURL(/\/app$/);
  // no chat view any more: there is no message list or composer on the Munshi route
  await page.goto("/app/munshi");
  await expect(page.getByLabel("Munshi ko likhein")).toHaveCount(0);
});

test("mic permission denied shows a clear message instead of a dead screen", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [] });
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  });
  const page = await ctx.newPage();
  await demoLogin(page, false);
  await page.goto("/app/munshi");
  await expect(page.getByTestId("voice-mode")).toHaveAttribute("data-state", "error");
  await expect(page.getByText(/Mic ki permission chahiye/)).toBeVisible();
  // typing is offered automatically, so the screen is never a dead end
  await page.getByLabel("Type to Munshi").fill("loan chahiye");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("voice-plan")).toContainText("loan");
  await ctx.close();
});

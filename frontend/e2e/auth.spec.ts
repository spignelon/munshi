import { expect, test } from "@playwright/test";

test("protected routes redirect to login, then back after login", async ({ page }) => {
  await page.goto("/app/udhaar");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Try demo as Raj" }).click();
  await expect(page.getByRole("heading", { name: /Namaste, Raj ji/ })).toBeVisible({ timeout: 30_000 });
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("wrongpass123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("galat");
});

test("signup → onboarding with demo data → dashboard → logout → login", async ({ page }) => {
  const email = `owner${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Meena Devi");
  await page.getByLabel("Shop name").fill("Meena General Store");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("WhatsApp number").fill("98111 22233");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("UPI ID").fill("meena@paytm");
  await page.getByRole("button", { name: "Aage badhein" }).click();
  await page.getByRole("button", { name: /Demo data se shuru karein/ }).click();

  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Namaste, Meena ji/ })).toBeVisible();
  await expect(page.getByText("₹38,000").first()).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Namaste, Meena ji/ })).toBeVisible();
});

test("new empty shop: onboarding is enforced and empty states render", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Empty Owner");
  await page.getByLabel("Email").fill(`empty${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.goto("/app/udhaar");
  await expect(page).toHaveURL(/\/onboarding/); // can't skip onboarding
  await page.getByRole("button", { name: "Aage badhein" }).click();
  await page.getByRole("button", { name: /Khaali dukaan/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Udhaar" }).first().click();
  await expect(page.getByText("Koi udhaar baaki nahi")).toBeVisible();
});

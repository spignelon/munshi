import { expect, test } from "@playwright/test";
import path from "node:path";
import { demoLogin } from "./helpers";

test.beforeEach(async ({ page }) => { await demoLogin(page); });

test("scan a notebook photo → review → import", async ({ page }) => {
  await page.goto("/app/udhaar");
  await page.getByTestId("ledger-file").setInputFiles(path.resolve("e2e/fixtures/ledger.png"));
  await expect(page.getByTestId("scan-row")).toHaveCount(3, { timeout: 30_000 });
  await page.getByLabel("Amount 1").fill("500"); // the owner corrects an OCR mistake before importing
  await page.getByRole("button", { name: "Remove row 3" }).click();
  await page.getByRole("button", { name: "Ledger mein import karein" }).click();
  await expect(page.getByText("2 entries ledger mein jud gayi")).toBeVisible();
  await expect(page.getByTestId("udhaar-total")).toHaveText("₹39,700"); // 38,000 + 500 + 1,200
});

test("add a manual entry, settle it, and send a single reminder", async ({ page }) => {
  await page.goto("/app/udhaar");
  await page.getByRole("button", { name: "Nayi entry" }).click();
  await page.getByLabel("Customer ka naam").fill("Naya Grahak");
  await page.getByLabel("Amount (₹)").fill("750");
  await page.getByLabel(/Phone/).fill("9811100000");
  await page.getByRole("button", { name: "Save karein" }).click();
  await expect(page.getByTestId("udhaar-total")).toHaveText("₹38,750");
  const row = page.getByTestId("udhaar-row").filter({ hasText: "Naya Grahak" });
  await row.getByRole("button", { name: "Remind" }).click();
  await expect(page.getByText("Naya Grahak ko WhatsApp reminder bhej diya")).toBeVisible();
  await row.getByRole("button", { name: "Mila" }).click();
  await page.getByRole("button", { name: "Save karein" }).click();
  await expect(page.getByTestId("udhaar-total")).toHaveText("₹38,000");
});

test("stock page shows the festival forecast and customers page filters lapsed regulars", async ({ page }) => {
  await page.goto("/app/stock");
  await expect(page.getByText(/12 items pichhle .* jaisi demand/)).toBeVisible();
  await page.getByRole("button", { name: "Tyohaar items" }).click();
  await expect(page.getByTestId("product-row").first()).toBeVisible();
  await page.goto("/app/customers");
  await page.getByRole("button", { name: "30+ din se nahi aaye" }).click();
  await expect(page.getByTestId("customer-row").first()).toContainText("din pehle");
  await page.goto("/app/suppliers");
  await expect(page.getByText("Shree Foods Distributors")).toBeVisible();
});

// PWA checks need the production build (the service worker is registered only in prod):
//   npm run build && npx vite preview --port 4174   then   E2E_BASE_URL=http://127.0.0.1:4174 npx playwright test e2e/pwa.spec.ts
// or against the deployed site: E2E_BASE_URL=https://munshi-web-navy.vercel.app
import { expect, test } from "@playwright/test";
import { demoLogin } from "./helpers";

test.skip(!process.env.E2E_BASE_URL, "PWA checks run against a production build (set E2E_BASE_URL)");

test("manifest is valid and every icon / screenshot resolves", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m).toMatchObject({ short_name: "Munshi", display: "standalone", scope: "/", theme_color: "#111B33" });
  expect(m.start_url).toMatch(/^\/app/);
  const purposes = m.icons.map((i: any) => `${i.sizes}:${i.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const asset of [...m.icons, ...m.screenshots]) {
    const r = await request.get(asset.src);
    expect(r.ok(), asset.src).toBeTruthy();
    expect(r.headers()["content-type"], asset.src).toContain("image/png");
  }
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).toBeTruthy();
});

test("service worker activates and controls the page; Chrome reports no installability errors", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors, JSON.stringify(installabilityErrors)).toEqual([]);
});

test("works offline: app shell / offline page shown, and /api is never served from cache", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // second load populates the shell cache
  await page.goto("/");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("body")).toContainText(/Munshi|offline/i);
  const api = await page.evaluate(() => fetch("/api/health").then(() => "served").catch(() => "network-error"));
  expect(api).toBe("network-error");
  await context.setOffline(false);
});

test("Install app button appears when Chrome offers installation", async ({ page }) => {
  await demoLogin(page, false);
  await page.goto("/app/settings");
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
  await page.evaluate(() => {
    const ev: any = new Event("beforeinstallprompt", { cancelable: true });
    ev.prompt = async () => {};
    ev.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(ev);
  });
  const btn = page.getByTestId("install-card").getByRole("button", { name: "Install app" });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByText("install ho gaya")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
});

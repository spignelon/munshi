import { expect, test } from "@playwright/test";

test("time 'Try the live demo' → dashboard, fresh browser each run", async ({ browser }) => {
  for (let run = 1; run <= 5; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const reqs: { url: string; ms: number; status: number; size: number }[] = [];
    const starts = new Map<string, number>();
    page.on("request", (r) => starts.set(r.url() + r.method(), Date.now()));
    page.on("response", async (r) => {
      const st = starts.get(r.url() + r.request().method()) ?? Date.now();
      const len = Number(r.headers()["content-length"] ?? 0);
      reqs.push({ url: r.url().replace("https://munshi-web-navy.vercel.app", ""), ms: Date.now() - st, status: r.status(), size: len });
    });
    const t0 = Date.now();
    await page.goto("/", { waitUntil: "load" });
    const tLoad = Date.now() - t0;
    const t1 = Date.now();
    await page.getByRole("button", { name: "Try the live demo" }).first().click();
    await expect(page.getByRole("heading", { name: /Namaste, Ramesh ji/ })).toBeVisible({ timeout: 90_000 });
    const tDash = Date.now() - t1;
    await page.waitForLoadState("networkidle");
    const slow = reqs.filter((r) => r.ms > 800).map((r) => `${r.ms}ms ${r.status} ${r.url.slice(0, 60)}`);
    console.log(`run ${run}: landing=${tLoad}ms  click→dashboard=${tDash}ms  requests=${reqs.length}  slow(>800ms)=${JSON.stringify(slow)}`);
    await ctx.close();
  }
});

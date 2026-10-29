// Renders the PWA icons from the logo SVG with Playwright's Chromium:  node scripts/gen-icons.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const M = "M16 46V18h6l10 17 10-17h6v28h-6V29L32 46 22 29v17z";
const svg = (size, { maskable, scale }) => `<!doctype html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" ${maskable ? "" : 'rx="14"'} fill="#111B33"/>
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)"><path d="${M}" fill="#E8912D"/></g>
</svg></body>`;

const jobs = [
  ["public/icons/icon-192.png", 192, { maskable: false, scale: 1.2 }],
  ["public/icons/icon-512.png", 512, { maskable: false, scale: 1.2 }],
  ["public/icons/maskable-512.png", 512, { maskable: true, scale: 1.05 }], // glyph stays inside the 80% safe zone
  ["public/icons/apple-touch-icon.png", 180, { maskable: true, scale: 1.1 }], // iOS rounds corners itself
];
mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
for (const [file, size, opts] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(svg(size, opts));
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  console.log("wrote", file);
}
await browser.close();

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Local run: spins up the real FastAPI backend (fresh SQLite, fake Groq unless E2E_LIVE=1) and the Vite dev server.
// Production smoke: E2E_BASE_URL=https://<deployment> npx playwright test e2e/smoke.spec.ts  (no servers started)
const live = process.env.E2E_LIVE === "1";
const remote = process.env.E2E_BASE_URL;
const API_PORT = 8011;
const WEB_PORT = 5174;
const fakeAudio = path.resolve(process.cwd(), "e2e/fixtures/hindi.wav");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: remote ?? `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${fakeAudio}`],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(responsive|smoke)\.spec\.ts/ },
  ],
  webServer: remote ? undefined : [
    {
      command: `rm -f e2e.db && ../backend/.venv/bin/uvicorn index:app --app-dir ../backend --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: "sqlite:///./e2e.db", GROQ_FAKE: live ? "0" : "1", USE_TURSO: "0", PUBLIC_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        GROQ_API_KEY: live ? (process.env.GROQ_API_KEY ?? "") : "", CRON_SECRET: "e2e-cron",
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { VITE_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

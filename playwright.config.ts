import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "npm run build && npm run prepare:standalone && npm run start:standalone",
    env: {
      ...process.env,
      APP_BUILD_ID: "playwright-fixture",
      HS_TRACKER_RUNTIME_MODE: "fixture",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    url: `${baseURL}/healthz`,
  },
});

import { defineConfig } from "@playwright/test";

if (!process.env.BASE_URL) throw new Error("BrowserStack E2E 需要 BASE_URL");
process.env.BROWSERSTACK_REAL_DEVICE = "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "browserstack.spec.ts",
  outputDir: "test-results/browserstack-artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 20 * 60 * 1000,
  expect: { timeout: 45_000 },
  forbidOnly: true,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-browserstack-report", open: "never" }],
    ["junit", { outputFile: "test-results/browserstack-junit.xml" }],
    ["json", { outputFile: "test-results/browserstack-results.json" }],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    actionTimeout: 60_000,
  },
  projects: [
    { name: "browserstack-iphone", use: { browserName: "webkit" } },
    { name: "browserstack-ipad", use: { browserName: "webkit" } },
    { name: "browserstack-android-pad", use: { browserName: "chromium" } },
  ],
});

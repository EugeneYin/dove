import { defineConfig, devices } from "@playwright/test";

const remoteURL = process.env.BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "devices.spec.ts",
  outputDir: "test-results/device-artifacts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 12 * 60 * 1000,
  expect: { timeout: 30_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-device-report", open: "never" }],
    ["junit", { outputFile: "test-results/device-junit.xml" }],
    ["json", { outputFile: "test-results/device-results.json" }],
  ],
  use: {
    baseURL: remoteURL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "allow",
  },
  webServer: remoteURL
    ? undefined
    : {
        command: "pnpm run build && pnpm run preview -- --host 127.0.0.1",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    { name: "pc-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 15"] } },
    { name: "ipad-webkit", use: { ...devices["iPad Pro 11"] } },
    { name: "android-pad-chromium", use: { ...devices["Galaxy Tab S9"] } },
  ],
});

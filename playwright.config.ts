import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

function git(command: string[]) {
  try {
    return execFileSync("git", command, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa.spec.ts",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 12 * 60 * 1000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  metadata: {
    appVersion: version,
    gitSha: process.env.GITHUB_SHA ?? git(["rev-parse", "HEAD"]),
    gitRef: process.env.GITHUB_REF_NAME ?? git(["branch", "--show-current"]),
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "pwa-chromium",
      // 与原有 CDP 回归脚本保持同一视口；取词坐标以整页 PDF 文本层为基准。
      use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1800 } },
    },
  ],
});

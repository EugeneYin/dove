import { test } from "@playwright/test";
import { runDeviceFlow } from "./device-flow";

test("Cloudflare Preview 设备兼容 smoke", async ({ page }, testInfo) => {
  await runDeviceFlow(page, testInfo);
});

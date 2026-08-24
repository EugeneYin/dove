import { test } from "./browserstack-fixture";
import { runDeviceFlow } from "./device-flow";

test("BrowserStack 真机 PWA 离线链路", async ({ page }, testInfo) => {
  await runDeviceFlow(page, testInfo);
});

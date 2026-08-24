import { test as base, expect, type Page } from "@playwright/test";
import { _android } from "playwright";

type Device = {
  browser: "chrome" | "safari";
  deviceName: string;
  osVersion: string;
  engine: "android" | "webkit";
  remotePlaywrightVersion: string;
};

const DEVICES: Record<string, Device> = {
  "browserstack-iphone": {
    browser: "safari",
    deviceName: "iPhone 16 Pro Max",
    osVersion: "18.6",
    engine: "webkit",
    remotePlaywrightVersion: "1.61",
  },
  "browserstack-ipad": {
    browser: "safari",
    deviceName: "iPad Pro 11 2021",
    osVersion: "18.6",
    engine: "webkit",
    remotePlaywrightVersion: "1.61",
  },
  "browserstack-android-pad": {
    browser: "chrome",
    deviceName: "Samsung Galaxy Tab S9",
    osVersion: "13.0",
    engine: "android",
    remotePlaywrightVersion: "1.59",
  },
};

function credentials() {
  const username = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!username || !accessKey) {
    throw new Error("BrowserStack E2E 需要 BROWSERSTACK_USERNAME 和 BROWSERSTACK_ACCESS_KEY");
  }
  return { username, accessKey };
}

function status(status: string) {
  return status === "passed" ? "passed" : "failed";
}

async function report(page: Page, testStatus: string, reason: string) {
  const command = {
    action: "setSessionStatus",
    arguments: { status: status(testStatus), reason: reason.slice(0, 255) },
  };
  await page
    .evaluate((_) => {}, `browserstack_executor: ${JSON.stringify(command)}`)
    .catch(() => undefined);
}

export const test = base.extend<{ page: Page }>({
  page: async ({ playwright }, use, testInfo) => {
    const device = DEVICES[testInfo.project.name];
    if (!device) throw new Error(`未知 BrowserStack project: ${testInfo.project.name}`);

    const { username, accessKey } = credentials();
    const caps = {
      browser: device.browser,
      deviceName: device.deviceName,
      osVersion: device.osVersion,
      realMobile: "true",
      project: "Dove PWA",
      build: process.env.BROWSERSTACK_BUILD_ID ?? "local",
      name: `${testInfo.project.name} · ${testInfo.title}`,
      "browserstack.username": username,
      "browserstack.accessKey": accessKey,
      "browserstack.playwrightVersion": device.remotePlaywrightVersion,
      "client.playwrightVersion": "1.62.1",
    };
    const endpoint = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(
      JSON.stringify(caps),
    )}`;

    let page: Page;
    let close: () => Promise<void>;
    if (device.engine === "android") {
      const android = await _android.connect(endpoint, { timeout: 120_000 });
      await android.shell("am force-stop com.android.chrome");
      const context = await android.launchBrowser({ baseURL: testInfo.project.use.baseURL });
      page = await context.newPage();
      close = () => android.close();
    } else {
      const browser = await playwright.webkit.connect({ wsEndpoint: endpoint, timeout: 120_000 });
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
      page = await context.newPage();
      close = () => browser.close();
    }

    try {
      await use(page);
    } finally {
      const testStatus = testInfo.status ?? "failed";
      await report(page, testStatus, testInfo.error?.message ?? testStatus);
      await close();
    }
  },
});

export { expect };

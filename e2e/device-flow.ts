import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const SAMPLE = resolve(PROJECT_ROOT, "public/sample.pdf");
const { version: APP_VERSION } = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8"),
) as { version: string };
const REAL_DEVICE = process.env.BROWSERSTACK_REAL_DEVICE === "1";

async function waitForTextLayer(page: Page, timeout = 120_000) {
  await page.waitForFunction(() => document.querySelectorAll("#text-layer span").length > 0, null, {
    timeout,
  });
}

async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function prefetch(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ done: number; failed: number; failures: string[] }>((done, reject) => {
        const timer = window.setTimeout(() => reject(new Error("等待离线资源预缓存超时")), 600_000);
        const onMessage = (event: MessageEvent) => {
          if (event.data?.type !== "prefetch" || !event.data.finished) return;
          window.clearTimeout(timer);
          navigator.serviceWorker.removeEventListener("message", onMessage);
          done(event.data);
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        navigator.serviceWorker.controller?.postMessage({ type: "prefetch" });
      }),
  );
}

async function positionOf(page: Page, word: string) {
  return page.evaluate((target) => {
    for (const span of document.querySelectorAll("#text-layer span")) {
      if (!span.firstChild) continue;
      const index = (span.textContent ?? "").indexOf(target);
      if (index < 0) continue;
      span.scrollIntoView({ block: "center", inline: "center" });
      const range = document.createRange();
      range.setStart(span.firstChild, index);
      range.setEnd(span.firstChild, index + target.length);
      const box = range.getBoundingClientRect();
      range.detach();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return null;
  }, word);
}

async function lookUp(page: Page, word: string) {
  await page.locator("#popup").evaluate((node) => node.setAttribute("hidden", ""));
  const position = await positionOf(page, word);
  expect(position).not.toBeNull();

  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) {
    const layer = page.locator("#text-layer");
    const event = {
      bubbles: true,
      clientX: position?.x,
      clientY: position?.y,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
    };
    await layer.dispatchEvent("pointerdown", event);
    await page.waitForTimeout(500);
    await layer.dispatchEvent("pointerup", event);
  } else {
    await page.mouse.dblclick(position?.x ?? 0, position?.y ?? 0);
  }

  await expect(page.locator("#popup")).toBeVisible();
  return page.locator("#popup .word").textContent();
}

async function sessionId(page: Page) {
  const command = `browserstack_executor: ${JSON.stringify({ action: "getSessionDetails" })}`;
  const raw = (await page.evaluate((_) => {}, command)) as unknown as string;
  const details = JSON.parse(raw) as { hashed_id?: string };
  if (!details.hashed_id) throw new Error("BrowserStack 未返回 session id");
  return details.hashed_id;
}

async function setNetwork(id: string, networkProfile: "no-network" | "4g-lte-good") {
  const username = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!username || !accessKey) throw new Error("缺少 BrowserStack 凭据");

  const response = await fetch(
    `https://api.browserstack.com/automate/sessions/${id}/update_network.json`,
    {
      method: "PUT",
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${accessKey}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ networkProfile }),
    },
  );
  if (!response.ok) throw new Error(`BrowserStack 网络切换失败: HTTP ${response.status}`);
}

async function waitUntilDeviceOffline(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          try {
            await fetch(`https://example.com/?probe=${Date.now()}`, {
              cache: "no-store",
              mode: "no-cors",
            });
            return false;
          } catch {
            return true;
          }
        }),
      { message: "真机必须已经断网", timeout: 120_000 },
    )
    .toBe(true);
}

export async function runDeviceFlow(page: Page, testInfo: TestInfo) {
  await testInfo.attach("device-test-case-catalog", {
    body: readFileSync(resolve(PROJECT_ROOT, "e2e/device-test-cases.json")),
    contentType: "application/json",
  });

  await test.step("DEVICE-001 HTTPS 部署与 PWA 元数据", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Dove — PDF 英语阅读");
    await expect(page.locator("#bar")).toBeVisible();
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/manifest.webmanifest");
      return response.json();
    });
    expect(manifest).toMatchObject({ start_url: "/", display: "standalone" });
  });

  await test.step("DEVICE-002 Service Worker 接管", async () => {
    const emulatedWebKit = !REAL_DEVICE && testInfo.project.name.includes("webkit");
    if (emulatedWebKit) {
      testInfo.annotations.push({
        type: "limitation",
        description: "Playwright WebKit 不支持 Service Worker 自动化；由 BrowserStack 真机覆盖",
      });
      return;
    }
    await waitForServiceWorker(page);
  });

  await test.step("DEVICE-007 顶部菜单抽屉兼容性", async () => {
    await expect(page.locator("#bar > .bar-region")).toHaveCount(3);
    const regions = await page.locator("#bar").evaluate(() => {
      const box = (id: string) => document.getElementById(id)?.getBoundingClientRect();
      return { file: box("file-menu"), prev: box("prev"), next: box("next"), settings: box("settings-menu") };
    });
    expect(regions.file?.right).toBeLessThanOrEqual(regions.prev?.left ?? 0);
    expect(regions.next?.right).toBeLessThanOrEqual(regions.settings?.left ?? 0);

    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(page.locator("#file-drawer")).toBeVisible();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.locator("#file-drawer")).toBeHidden();
    await expect(page.locator("#settings-drawer")).toBeVisible();
    await expect(page.getByRole("switch", { name: /在线例句/ })).not.toBeChecked();
    await page.getByRole("button", { name: "设置", exact: true }).click();
  });

  let cached = false;
  if (REAL_DEVICE) {
    const result = await prefetch(page);
    expect(result.failed, result.failures.join("\n")).toBe(0);
    expect(result.done).toBeGreaterThan(0);
    cached = true;
  }

  await test.step("DEVICE-003 PDF、词典与画布", async () => {
    await page.locator("#file").setInputFiles(SAMPLE);
    await waitForTextLayer(page);
    await page.waitForFunction(() => document.body.dataset.dict === "ready", null, {
      timeout: 120_000,
    });
    const canvas = await page.locator("#canvas").evaluate((node) => ({
      width: (node as HTMLCanvasElement).width,
      height: (node as HTMLCanvasElement).height,
    }));
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  await test.step("DEVICE-004 桌面双击或移动端长按取词", async () => {
    expect(await lookUp(page, "ubiquitous")).toBe("ubiquitous");
  });

  await test.step("DEVICE-008 在线例句开关与折叠词卡", async () => {
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === "https://freedictionaryapi.com/api/v1/entries/en/convey") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                word: "convey",
                entries: [
                  {
                    senses: [
                      {
                        examples: [
                          "Air conveys sound.",
                          "She conveyed the news calmly.",
                          "This third example must not be shown.",
                        ],
                        subsenses: [],
                      },
                    ],
                  },
                ],
                source: { url: "https://en.wiktionary.org/wiki/convey" },
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }
        return originalFetch(input, init);
      };
    });

    await page.getByRole("button", { name: "设置", exact: true }).click();
    const toggle = page.getByRole("switch", { name: /在线例句/ });
    await toggle.check();
    await page.getByRole("button", { name: "设置", exact: true }).click();

    expect(await lookUp(page, "conveys")).toBe("convey");
    const examples = page.locator("#popup .examples");
    await expect(examples).not.toHaveAttribute("open", "");
    await examples.locator("summary").click();
    await expect(examples.locator(".example-item")).toHaveText([
      "Air conveys sound.",
      "She conveyed the news calmly.",
    ]);
    await expect(examples.locator(".example-source")).toContainText(
      "FreeDictionaryAPI.com · Wiktionary",
    );

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await toggle.uncheck();
    await page.getByRole("button", { name: "设置", exact: true }).click();
  });

  await test.step("DEVICE-005 v2.1 诊断面板", async () => {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.locator("#diag").click();
    await expect(page.locator(".diag-panel")).toBeVisible();
    await expect(page.locator(".diag-panel")).toContainText(APP_VERSION);
    expect(await page.locator(".diag-row").count()).toBeGreaterThan(10);
    await page.getByRole("button", { name: "关闭" }).click();
  });

  await test.step("DEVICE-006 真机断网后离线重载", async () => {
    if (!REAL_DEVICE) {
      testInfo.annotations.push({
        type: "limitation",
        description: "设备模拟矩阵只做在线 smoke；真断网由 BrowserStack 真机覆盖",
      });
      return;
    }
    expect(cached).toBe(true);
    const id = await sessionId(page);
    try {
      await setNetwork(id, "no-network");
      await waitUntilDeviceOffline(page);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await expect(page).toHaveTitle("Dove — PDF 英语阅读");
      await page.waitForFunction(() => document.body.dataset.dict === "ready", null, {
        timeout: 120_000,
      });
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await expect(page.locator("#recent .recent-row", { hasText: "sample.pdf" })).toBeVisible();
      await page
        .locator("#recent .recent-row", { hasText: "sample.pdf" })
        .locator(".recent-open")
        .click();
      await waitForTextLayer(page);
      expect(await lookUp(page, "conveys")).toBe("convey");
    } finally {
      await setNetwork(id, "4g-lte-good");
    }
  });
}

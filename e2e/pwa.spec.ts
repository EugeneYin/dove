import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { preview, type PreviewServer } from "vite";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const { version: APP_VERSION } = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8"),
) as { version: string };
const SAMPLE = resolve(PROJECT_ROOT, "public/sample.pdf");
const SAMPLE_PAGES = resolve(PROJECT_ROOT, "public/sample-pages.pdf");
const SAMPLE_SCANNED = resolve(PROJECT_ROOT, "public/sample-scanned.pdf");

let server: PreviewServer | null = null;
let serverStopped = false;
let baseURL = "";

async function stopServer() {
  if (!server || serverStopped) return;
  serverStopped = true;

  const stopped = new Promise<void>((done, reject) => {
    server?.httpServer.close((error) => (error ? reject(error) : done()));
  });
  // Chromium 可能还保留 keep-alive 连接；强制关闭连接才能让离线基准真实成立。
  server.httpServer.closeAllConnections();
  await stopped;
}

async function waitUntilUnreachable(url: string) {
  await expect
    .poll(
      async () => {
        try {
          await fetch(url);
          return false;
        } catch {
          return true;
        }
      },
      { message: "preview 服务器必须已经不可访问", timeout: 10_000 },
    )
    .toBe(true);
}

async function waitForTextLayer(page: Page, minimum = 0, timeout = 30_000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll("#text-layer span").length > count,
    minimum,
    { timeout },
  );
}

async function lookUp(page: Page, word: string) {
  await page.locator("#popup").evaluate((node) => node.setAttribute("hidden", ""));
  const position = await page.evaluate((target) => {
    for (const span of document.querySelectorAll("#text-layer span")) {
      if (!span.firstChild) continue;
      const index = (span.textContent ?? "").indexOf(target);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(span.firstChild, index);
      range.setEnd(span.firstChild, index + target.length);
      const box = range.getBoundingClientRect();
      range.detach();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return null;
  }, word);

  if (!position) return null;
  await page.mouse.dblclick(position.x, position.y);
  await page.waitForTimeout(400);
  return page.locator("#popup").evaluate((popup) => {
    if ((popup as HTMLElement).hidden) return null;
    return {
      word: popup.querySelector(".word")?.textContent ?? null,
      trans: (popup.querySelector(".trans")?.textContent ?? "").split("\n")[0],
      empty: popup.querySelector(".empty")?.textContent ?? null,
    };
  });
}

test.describe("PWA 离线完整链路", () => {
  test.beforeAll(async () => {
    server = await preview({
      root: PROJECT_ROOT,
      logLevel: "error",
      preview: { host: "127.0.0.1", port: 4173, strictPort: false },
    });
    baseURL = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${server.config.preview.port}/`;
  });

  test.afterAll(async () => {
    await stopServer();
  });

  test(`v${APP_VERSION} 当前 PWA 离线回归基线`, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "catalog", description: "e2e/test-cases.json" });
    await testInfo.attach("test-case-catalog", {
      body: readFileSync(resolve(PROJECT_ROOT, "e2e/test-cases.json")),
      contentType: "application/json",
    });

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));

    await page.goto(baseURL);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 60_000,
    });

    const prefetch = await page.evaluate(
      () =>
        new Promise<{ done: number; failed: number; failures: string[] }>((done, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error("等待离线资源预缓存超时")),
            300_000,
          );
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

    await test.step("PWA-001 预缓存离线资源", async () => {
      expect.soft(prefetch.failed, prefetch.failures.join("\n")).toBe(0);
      expect.soft(prefetch.done).toBeGreaterThan(0);
    });

    await test.step("PWA-002 只缓存一个 OCR 核心变体", async () => {
      const cores = await page.evaluate(async () => {
        const key = (await caches.keys()).find((candidate) => candidate.startsWith("dove-v"));
        if (!key) return [];
        return (await (await caches.open(key)).keys())
          .map((request) => new URL(request.url).pathname)
          .filter((path) => path.startsWith("/tesseract/tesseract-core-"));
      });
      expect.soft(cores, cores.join(", ")).toHaveLength(1);
    });

    // 联网时准备两本最近文档和阅读位置，供真正断开服务器后的步骤验证。
    await page.locator("#file").setInputFiles(SAMPLE_PAGES);
    await waitForTextLayer(page);
    await page.waitForFunction(() => document.body.dataset.dict === "ready");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#pager")).toHaveText("2 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#pager")).toHaveText("3 / 3");

    await page.locator("#file").setInputFiles(SAMPLE_SCANNED);
    await waitForTextLayer(page, 5, 120_000);

    await stopServer();
    await waitUntilUnreachable(baseURL);

    await test.step("PWA-003 服务器关闭后仍能冷启动", async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await expect.soft(page).toHaveTitle("Dove — PDF 英语阅读");
      await expect.soft(page.locator("#bar")).toBeVisible();
    });

    await test.step("PWA-004 离线加载词典", async () => {
      await page.waitForFunction(() => document.body.dataset.dict === "ready", null, {
        timeout: 60_000,
      });
      expect.soft(await page.locator("body").getAttribute("data-dict")).toBe("ready");
    });

    const recent = await test.step("PWA-005 离线列出最近文档", async () => {
      await expect(page.locator("#recent .recent-row")).toHaveCount(2, { timeout: 20_000 });
      const rows = await page.locator("#recent .recent-row").evaluateAll((nodes) =>
        nodes.map((node) => ({
          name: node.querySelector(".recent-name")?.textContent ?? "",
          meta: node.querySelector(".recent-meta")?.textContent ?? "",
        })),
      );
      expect.soft(rows.map((row) => row.name).sort()).toEqual(
        ["sample-pages.pdf", "sample-scanned.pdf"].sort(),
      );
      return rows;
    });

    await test.step("PWA-006 记住阅读页码", async () => {
      const pagesRow = recent.find((row) => row.name === "sample-pages.pdf");
      expect.soft(pagesRow?.meta).toContain("第 3 页");
    });

    await test.step("PWA-007 离线续读到原位置", async () => {
      await page
        .locator("#recent .recent-row", { hasText: "sample-pages.pdf" })
        .locator(".recent-open")
        .click();
      await waitForTextLayer(page);
      await expect.soft(page.locator("#pager")).toHaveText("3 / 3");
    });

    await test.step("PWA-008 续读内容与页码一致", async () => {
      await expect.soft(page.locator("#text-layer span").first()).toHaveText("gamma");
    });

    await test.step("PWA-009 离线取词与词形还原", async () => {
      await page.locator("#file").setInputFiles(SAMPLE);
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("#text-layer span")].some((span) =>
            span.textContent?.includes("conveys"),
          ),
        null,
        { timeout: 30_000 },
      );
      const popup = await lookUp(page, "conveys");
      expect.soft(popup?.word).toBe("convey");
      expect.soft(popup?.empty).toBeNull();
    });

    let ocrWords = 0;
    await test.step("PWA-010 离线 OCR 扫描件", async () => {
      await page.locator("#file").setInputFiles(SAMPLE_SCANNED);
      await waitForTextLayer(page, 5, 180_000);
      ocrWords = await page.locator("#text-layer span").count();
      expect.soft(ocrWords).toBeGreaterThan(5);
    });

    await test.step("PWA-011 离线在扫描件上取词", async () => {
      const source = await page.locator("#text-layer span").evaluateAll((spans) =>
        spans.map((span) => span.textContent ?? "").find((word) => /^[A-Za-z]{5,}$/.test(word)),
      );
      expect.soft(source).toBeTruthy();
      const popup = source ? await lookUp(page, source) : null;
      expect.soft(popup?.word.toLowerCase()).toBe(source?.toLowerCase());
    });

    await testInfo.attach("page-errors", {
      body: Buffer.from(JSON.stringify(pageErrors, null, 2)),
      contentType: "application/json",
    });
  });
});

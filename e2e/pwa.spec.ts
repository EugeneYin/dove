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
  if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
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

async function waitForDictionary(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => ["ready", "failed"].includes(document.body.dataset.dict ?? ""),
    null,
    { timeout },
  );
  const state = await page.locator("body").getAttribute("data-dict");
  if (state !== "ready") {
    const detail = await page.locator(".dict-status").textContent();
    throw new Error(detail?.trim() || `词典加载失败（状态：${state ?? "unknown"}）`);
  }
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
    console.log("[pwa-e2e] Service Worker 已接管");

    await test.step("PWA-013 顶部三区与抽屉进度迁移", async () => {
      await expect(page.locator("#bar > .bar-region")).toHaveCount(3);
      await expect(page.getByRole("button", { name: "文件", exact: true })).toBeVisible();
      await expect(page.getByLabel("翻页")).toBeVisible();
      await expect(page.getByRole("button", { name: "设置", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "文件", exact: true }).click();
      await expect(page.locator("#file-drawer")).toBeVisible();
      await expect(page.getByRole("button", { name: "打开 PDF" })).toBeVisible();
      await expect(page.locator("#file-drawer")).toContainText("最近打开");

      await page.getByRole("button", { name: "设置", exact: true }).click();
      await expect(page.locator("#file-drawer")).toBeHidden();
      await expect(page.locator("#settings-drawer")).toBeVisible();
      await expect(page.getByRole("switch", { name: /在线例句/ })).not.toBeChecked();
      const menuButtons = await page.locator("#settings-drawer > button").evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.querySelector(".button-label")?.textContent ?? button.textContent,
          top: button.getBoundingClientRect().top,
        })),
      );
      expect(menuButtons.map((button) => button.text?.trim())).toEqual(["安装", "诊断"]);
      expect(menuButtons[1]?.top).toBeGreaterThan(menuButtons[0]?.top ?? 0);

      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.evaluate(() => {
        navigator.serviceWorker.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "prefetch",
              done: 5 * 1024 * 1024,
              total: 10 * 1024 * 1024,
              failed: 0,
              failures: [],
              finished: false,
            },
          }),
        );
      });
      await expect(page.locator("#settings-progress")).toContainText(/\d+(?:\.\d)? \/ \d+(?:\.\d)? (?:KB|MB)/);
      await expect(page.locator("#settings-progress")).toBeVisible();
      const collapsedProgress = await page.locator("#settings-menu").evaluate((node) =>
        Number.parseInt((node as HTMLElement).style.getPropertyValue("--progress"), 10),
      );
      expect(collapsedProgress).toBeGreaterThan(0);
      expect(collapsedProgress).toBeLessThanOrEqual(100);

      await page.getByRole("button", { name: /设置/ }).click();
      await expect(page.locator("#settings-progress")).toBeHidden();
      await expect(page.locator("#install-progress")).toBeVisible();
      const [settingsProgress, installProgress] = await page.locator("#bar").evaluate(() => [
        document.getElementById("settings-menu")?.style.getPropertyValue("--progress"),
        document.getElementById("install")?.style.getPropertyValue("--progress"),
      ]);
      expect(installProgress).toBe(settingsProgress);
      await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
      await expect(page.locator("#install-label")).toHaveText("已安装");
      await page.keyboard.press("Escape");
      await expect(page.locator("#settings-drawer")).toBeHidden();
    });

    await test.step("PWA-016 打开单词本并自动补全词条", async () => {
      await waitForDictionary(page);
      await page.getByRole("button", { name: "单词本", exact: true }).click();
      await expect(page.locator("#wordbook-page")).toBeVisible();
      await expect(page.locator("#viewer")).toBeHidden();
      await expect(page.getByLabel("翻页")).toBeHidden();
      await expect(page.locator(".wordbook-table th:not(.wordbook-select-cell)")).toHaveText([
        "单词",
        "音标",
        "词性与含义",
      ]);

      await page.getByRole("button", { name: "添加单词" }).click();
      await page.locator("#wordbook-word").fill("convey");
      await expect(page.locator("#wordbook-lookup-status")).toContainText("已从离线词典补全");
      await expect(page.locator("#wordbook-phonetic")).not.toHaveValue("");
      await expect(page.locator("#wordbook-meaning")).not.toHaveValue("");
      await page.getByRole("button", { name: "保存" }).click();

      const row = page.locator("#wordbook-list tr", { hasText: "convey" });
      await expect(row).toBeVisible();
      await expect(row.locator("td:not(.wordbook-select-cell)")).toHaveCount(3);
      const meaningStyle = await row.locator(".wordbook-cell-scroll").last().evaluate((node) => ({
        overflowX: getComputedStyle(node).overflowX,
        whiteSpace: getComputedStyle(node).whiteSpace,
      }));
      expect.soft(meaningStyle).toEqual({ overflowX: "auto", whiteSpace: "nowrap" });
    });

    await test.step("PWA-017 查无结果时手填并管理删除", async () => {
      await page.getByRole("button", { name: "添加单词" }).click();
      await page.locator("#wordbook-word").fill("codexmissingword");
      await expect(page.locator("#wordbook-lookup-status")).toContainText("请手动填写");
      await page.locator("#wordbook-phonetic").fill("manual-phonetic");
      await page.locator("#wordbook-meaning").fill("n. 第一行\nv. 第二行");
      await page.getByRole("button", { name: "保存" }).click();

      const manualRow = page.locator("#wordbook-list tr", { hasText: "codexmissingword" });
      await expect(manualRow).toContainText("manual-phonetic");
      await expect(manualRow).toContainText("n. 第一行；v. 第二行");

      await page.getByRole("button", { name: "管理", exact: true }).click();
      await expect(page.locator("#wordbook-list input[type=checkbox]")).toHaveCount(2);
      await page.getByRole("checkbox", { name: "选择 convey" }).check();
      await page.getByRole("button", { name: "删除（1）" }).click();
      await expect(page.locator("#wordbook-list tr")).toHaveCount(1);
      await expect(manualRow).toBeVisible();
      await page.getByRole("button", { name: "返回阅读" }).click();
      await expect(page.locator("#viewer")).toBeVisible();
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
    console.log(`[pwa-e2e] 预缓存完成：${prefetch.done} 成功，${prefetch.failed} 失败`);

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
    await waitForDictionary(page);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#pager")).toHaveText("2 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#pager")).toHaveText("3 / 3");

    await test.step("PWA-015 在线例句开关与折叠词卡", async () => {
      let requests = 0;
      await page.route("https://freedictionaryapi.com/api/v1/entries/en/gamma", async (route) => {
        requests += 1;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            word: "gamma",
            entries: [
              {
                senses: [
                  {
                    examples: [
                      "Gamma rays have very high energy.",
                      "The detector measured a gamma burst.",
                      "This third example must not be shown.",
                    ],
                    subsenses: [],
                  },
                ],
              },
            ],
            source: { url: "https://en.wiktionary.org/wiki/gamma" },
          }),
        });
      });

      expect((await lookUp(page, "gamma"))?.word).toBe("gamma");
      await expect(page.locator("#popup .examples")).toHaveCount(0);
      expect(requests).toBe(0);

      await page.getByRole("button", { name: "设置", exact: true }).click();
      const toggle = page.getByRole("switch", { name: /在线例句/ });
      await toggle.check();
      await expect(toggle).toBeChecked();
      expect(await page.evaluate(() => localStorage.getItem("dove.onlineExamples"))).toBe("1");

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await expect(toggle).toBeChecked();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.locator("#file").setInputFiles(SAMPLE_PAGES);
      await waitForTextLayer(page);

      expect((await lookUp(page, "gamma"))?.word).toBe("gamma");
      const examples = page.locator("#popup .examples");
      await expect(examples).toBeVisible();
      await expect(examples).not.toHaveAttribute("open", "");
      expect(requests).toBe(0);

      await examples.locator("summary").click();
      await expect(examples.locator(".example-item")).toHaveText([
        "Gamma rays have very high energy.",
        "The detector measured a gamma burst.",
      ]);
      await expect(examples.locator(".example-source")).toContainText(
        "FreeDictionaryAPI.com · Wiktionary",
      );
      expect(requests).toBe(1);

      await page.getByRole("button", { name: "设置", exact: true }).click();
      await toggle.uncheck();
      await expect(toggle).not.toBeChecked();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      expect((await lookUp(page, "gamma"))?.word).toBe("gamma");
      await expect(page.locator("#popup .examples")).toHaveCount(0);
      expect(requests).toBe(1);
    });

    await page.locator("#file").setInputFiles(SAMPLE_SCANNED);
    await waitForTextLayer(page, 5, 120_000);
    console.log("[pwa-e2e] 联网 OCR 准备完成");

    await stopServer();
    await waitUntilUnreachable(baseURL);
    console.log("[pwa-e2e] Preview 已关闭，进入真实离线阶段");

    await test.step("PWA-003 服务器关闭后仍能冷启动", async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await expect.soft(page).toHaveTitle("Dove — PDF 英语阅读");
      await expect.soft(page.locator("#bar")).toBeVisible();
    });

    await test.step("PWA-004 离线加载词典", async () => {
      await waitForDictionary(page);
      expect.soft(await page.locator("body").getAttribute("data-dict")).toBe("ready");
    });

    await test.step("PWA-018 离线重启后恢复单词本", async () => {
      await page.getByRole("button", { name: "单词本", exact: true }).click();
      await expect(page.locator("#wordbook-list tr")).toHaveCount(1);
      await expect(page.locator("#wordbook-list tr")).toContainText("codexmissingword");
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("dove.wordbook.v1") ?? "[]"),
      );
      expect.soft(stored).toHaveLength(1);
      await page.getByRole("button", { name: "返回阅读" }).click();
    });

    await test.step("PWA-005 离线列出最近文档", async () => {
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await expect(page.locator("#recent .recent-row")).toHaveCount(2, { timeout: 20_000 });
      const rows = await page.locator("#recent .recent-name").allTextContents();
      expect.soft(rows.sort()).toEqual(["sample-pages.pdf", "sample-scanned.pdf"].sort());
    });

    await test.step("PWA-006 记住阅读页码", async () => {
      const savedPage = await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("dove", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("docs", "readonly");
        const request = transaction.objectStore("docs").getAll();
        const records = await new Promise<Array<{ name: string; page: number }>>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        return records.find((record) => record.name === "sample-pages.pdf")?.page;
      });
      expect.soft(savedPage).toBe(3);
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
      console.log(`[pwa-e2e] 离线 OCR 完成：${ocrWords} 个文本项`);
      expect.soft(ocrWords).toBeGreaterThan(5);
    });

    await test.step("PWA-011 离线在扫描件上取词", async () => {
      const source = await page.locator("#text-layer span").evaluateAll((spans) =>
        spans.map((span) => span.textContent ?? "").find((word) => /^[A-Za-z]{5,}$/.test(word)),
      );
      expect.soft(source).toBeTruthy();
      const popup = source ? await lookUp(page, source) : null;
      expect.soft(popup?.word?.toLowerCase()).toBe(source?.toLowerCase());
    });

    await test.step("PWA-014 最近打开限制为日期倒序五项", async () => {
      await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("dove", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("docs", "readwrite");
        const store = transaction.objectStore("docs");
        store.clear();
        for (let index = 1; index <= 6; index += 1) {
          const name = `recent-${index}.pdf`;
          store.put({
            id: name,
            name,
            size: index,
            file: new File(["pdf"], name, { type: "application/pdf" }),
            page: 1,
            openedAt: index,
          });
        }
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
        database.close();
      });

      await page.getByRole("button", { name: "文件", exact: true }).click();
      await expect(page.locator("#recent .recent-row")).toHaveCount(5);
      await expect(page.locator("#recent .recent-name")).toHaveText([
        "recent-6.pdf",
        "recent-5.pdf",
        "recent-4.pdf",
        "recent-3.pdf",
        "recent-2.pdf",
      ]);
      await page.getByRole("button", { name: "文件", exact: true }).click();
    });

    await test.step("PWA-012 离线打开 v2.1 诊断面板", async () => {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page.locator("#diag").click();
      await expect.soft(page.locator(".diag-panel")).toBeVisible();
      await expect.soft(page.locator(".diag-panel")).toContainText(APP_VERSION);
      expect.soft(await page.locator(".diag-row").count()).toBeGreaterThan(10);
      await page.getByRole("button", { name: "关闭" }).click();
    });

    await testInfo.attach("page-errors", {
      body: Buffer.from(JSON.stringify(pageErrors, null, 2)),
      contentType: "application/json",
    });
  });
});

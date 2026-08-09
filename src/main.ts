// polyfill 必须最先执行，pdfjs 一调 getTextContent 就会用到
import "./polyfills";
// 用 legacy 构建：现代构建的语法在较旧的浏览器内核上会直接解析失败
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { wordAtPoint } from "./word";
import { dictInfo, loadDict, lookup as lookupWord } from "./dict";
import { canSpeak, initSpeech, speak, voiceName } from "./speech";
import { buildTextLayer, recognize, type OcrWord } from "./ocr";
import { forgetDoc, recentDocs, rememberDoc, rememberPage } from "./library";
import { initDiag, log, setAppProbe } from "./diag";

// 自己创建 worker，好让 polyfill 先于 pdfjs worker 执行
pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf-worker.ts", import.meta.url), {
  type: "module",
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file");
const pageEl = $<HTMLDivElement>("page");
const canvas = $<HTMLCanvasElement>("canvas");
const textLayerEl = $<HTMLDivElement>("text-layer");
const pagerEl = $<HTMLSpanElement>("pager");
const popupEl = $<HTMLDivElement>("popup");
const hintEl = $<HTMLParagraphElement>("hint");
const recentEl = $<HTMLElement>("recent");
const statusEl = $<HTMLDivElement>("status");
const installEl = $<HTMLButtonElement>("install");

let doc: PDFDocumentProxy | null = null;
let pageNum = 1;
/** 当前文档在最近文档库里的 id，用于记住读到第几页 */
let docId: string | null = null;

/**
 * 移动端浏览器对画布总面积有上限，超过后 getContext 照常成功、绘制却是全空白且不报错。
 * 这里主动限制面积，必要时降低渲染倍率——宁可略糊，也不能白屏。
 */
const MAX_CANVAS_PX = 16_777_216;

function outputScaleFor(width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  const area = width * height * dpr * dpr;
  return area > MAX_CANVAS_PX ? dpr * Math.sqrt(MAX_CANVAS_PX / area) : dpr;
}

// 渲染串行化：后发的请求作废先前的，而不是被先前的挡掉
let renderToken = 0;
let currentTask: { cancel(): void } | null = null;

async function renderPage(n: number) {
  if (!doc) return;
  const token = ++renderToken;
  const stale = () => token !== renderToken;
  const began = performance.now();

  currentTask?.cancel();
  currentTask = null;

  try {
    const page = await doc.getPage(n);
    if (stale()) return;

    // 按可视宽度缩放，Pad 上铺满
    const available = pageEl.parentElement!.clientWidth - 32;
    const base = page.getViewport({ scale: 1 });
    const scale = available / base.width;
    const viewport = page.getViewport({ scale });

    const output = outputScaleFor(viewport.width, viewport.height);
    canvas.width = Math.floor(viewport.width * output);
    canvas.height = Math.floor(viewport.height * output);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;
    // PDF.js 6 的文本层用这个变量定位
    pageEl.style.setProperty("--total-scale-factor", String(scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 2D 画布上下文");

    // 必须在绘制新页之前清空：一旦渲染中途失败或被取代，残留的旧文本层
    // 会盖在新页画布上，长按取到的是上一页的词。
    textLayerEl.replaceChildren();

    const task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: output !== 1 ? [output, 0, 0, output, 0, 0] : undefined,
    });
    currentTask = task;
    await task.promise;
    if (stale()) return;

    const textContent = await page.getTextContent();
    if (stale()) return;

    log(
      `渲染第 ${n} 页 ${Math.round(performance.now() - began)}ms · 画布 ${canvas.width}×${canvas.height}` +
        ` @${output.toFixed(2)} · 文本 ${textContent.items.length} 段`,
    );

    pagerEl.textContent = `${n} / ${doc.numPages}`;
    $<HTMLButtonElement>("prev").disabled = n <= 1;
    $<HTMLButtonElement>("next").disabled = n >= doc.numPages;

    if (textContent.items.length > 0) {
      const textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayerEl,
        viewport,
      });
      await textLayer.render();
      if (stale()) return;
      showStatus(null);
    } else {
      // 扫描版 PDF 没有文本层，只能靠 OCR 把图像上的文字还原成可取词的坐标
      await runOcr(n, viewport.width, stale);
    }
  } catch (e) {
    if (e instanceof pdfjs.RenderingCancelledException || stale()) return;
    showStatus(`第 ${n} 页渲染失败：${(e as Error).message}`, true);
  }
}

// OCR 一页要数百毫秒到数秒，翻回来时不该重跑。
// 词坐标属于识别时那张画布的像素空间，缩放变了就不再适用，故一并记下画布宽度。
const ocrCache = new Map<number, { words: OcrWord[]; canvasWidth: number }>();

async function runOcr(n: number, cssWidth: number, stale: () => boolean) {
  const show = (words: OcrWord[], canvasWidth: number) => {
    buildTextLayer(textLayerEl, words, canvasWidth, cssWidth);
    showStatus(words.length ? null : "本页没有识别到文字。");
  };

  const cached = ocrCache.get(n);
  if (cached) return show(cached.words, cached.canvasWidth);

  try {
    const canvasWidth = canvas.width;
    const began = performance.now();
    const words = await recognize(canvas, (msg) => {
      if (!stale()) showStatus(msg);
    });
    if (stale()) return;

    log(`识别第 ${n} 页 ${Math.round(performance.now() - began)}ms · ${words.length} 个词`);
    ocrCache.set(n, { words, canvasWidth });
    show(words, canvasWidth);
  } catch (e) {
    if (stale()) return;
    showStatus(`文字识别失败：${(e as Error).message}`, true);
  }
}

/** 页面出问题时必须让用户看见原因，白屏且无提示是最难排查的状态 */
function showStatus(message: string | null, isError = false) {
  // 用户看到的错误同时进日志：他截图给你的那一句，在日志里能找到上下文
  if (isError && message) console.error(message);
  hintEl.hidden = message === null;
  hintEl.textContent = message ?? "";
  hintEl.classList.toggle("error", isError);
}

async function openFile(file: File) {
  log(`打开 ${file.name} · ${size(file.size)}`);
  showStatus(`正在打开 ${file.name}…`);
  // 解析新文档要花时间，期间旧文本层若还留着，长按会取到上一个文档的词
  textLayerEl.replaceChildren();
  dismiss();
  recentEl.hidden = true;
  try {
    const [data, remembered] = await Promise.all([file.arrayBuffer(), rememberDoc(file)]);
    doc = await pdfjs.getDocument({
      data,
      standardFontDataUrl: "/standard_fonts/",
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      wasmUrl: "/wasm/",
    }).promise;
    docId = remembered.id;
    // 续读上次的位置。文件可能被换过，页码得夹到实际范围内
    pageNum = Math.min(Math.max(remembered.page, 1), doc.numPages);
    log(`文档就绪 · ${doc.numPages} 页，从第 ${pageNum} 页开始`);
    ocrCache.clear();
    await renderPage(pageNum);
  } catch (e) {
    showStatus(`打开失败：${(e as Error).message}`, true);
  }
}

const size = (bytes: number) =>
  bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

/** 没有打开任何文档时列出最近读过的，装成 App 后这就是首屏 */
async function showRecent() {
  const all = await recentDocs();
  // 删掉最后一本时要把整块收起来，否则会留下一个空的可见区域
  recentEl.hidden = true;
  recentEl.replaceChildren();
  if (!all.length) return;

  recentEl.append(el("h2", "", "最近阅读"));
  for (const record of all) {
    const open = el("button", "recent-open");
    open.append(
      el("span", "recent-name", record.name),
      el("span", "recent-meta", `第 ${record.page} 页 · ${size(record.size)}`),
    );
    open.addEventListener("click", () => void openFile(record.file));

    const remove = el("button", "recent-remove", "×");
    remove.title = `移除 ${record.name}`;
    remove.addEventListener("click", async () => {
      await forgetDoc(record.id);
      await showRecent();
    });

    const row = el("div", "recent-row");
    row.append(open, remove);
    recentEl.append(row);
  }
  recentEl.hidden = false;
  showStatus(null);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
});

initSpeech();

// 词典约 3.8MB，首次加载需要时间，期间给出反馈
const dictStatus = el("span", "dict-status", "词典加载中…");
statusEl.append(dictStatus);
const dictBegan = performance.now();
void loadDict().then(
  () => {
    const info = dictInfo();
    log(
      `词典就绪 ${Math.round(performance.now() - dictBegan)}ms · ${info?.words ?? 0} 词条 / ${info?.lemmas ?? 0} 变形`,
    );
    dictStatus.remove();
    document.body.dataset.dict = "ready";
  },
  (e: Error) => {
    dictStatus.textContent = `词典加载失败：${e.message}`;
    dictStatus.classList.add("failed");
    document.body.dataset.dict = "failed";
  },
);

// ---------------- 启动 ----------------
// 实际的调用在文件末尾：这里用到的常量都是 const，提前调用会撞上暂时性死区。

async function start() {
  // 从别的应用分享过来的文件优先，用户刚做完这个动作，等的就是它
  const shared = await takeSharedFile();
  if (shared) return void openFile(shared);

  // 开发环境自动载入样例文档，便于调试取词（生产构建会被剔除）
  if (import.meta.env.DEV) {
    try {
      const res = await fetch("/sample.pdf");
      return void openFile(new File([await res.blob()], "sample.pdf"));
    } catch {
      // 没有样张就当普通启动
    }
  }

  await showRecent();
}

/**
 * PWA 的「用 Dove 打开」入口。系统直接把文件句柄递进来，
 * 这正好补上了当初选网页方案时让掉的那点便利（见 docs/decisions.md）。
 * iOS 不支持，那里仍然走「打开 PDF」按钮。
 */
interface LaunchParams {
  files: readonly FileSystemFileHandle[];
}
const launchQueue = (window as { launchQueue?: { setConsumer(c: (p: LaunchParams) => void): void } })
  .launchQueue;

launchQueue?.setConsumer(({ files }) => {
  const handle = files[0];
  if (handle) void handle.getFile().then(openFile);
});

/**
 * 分享进来的 PDF 由 Service Worker 暂存在缓存里再重定向回来（见 src/sw.js 的
 * receiveShare）。这两个名字必须与那边一致——sw.js 不能有 import，没法共用常量。
 */
const SHARE_CACHE = "dove-share";
const SHARE_KEY = "/__shared__";

async function takeSharedFile(): Promise<File | null> {
  if (!new URLSearchParams(location.search).has("shared")) return null;
  // 清掉查询参数，免得刷新时又当成一次新的分享
  history.replaceState(null, "", location.pathname);
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_KEY);
    if (!res) return null;
    await cache.delete(SHARE_KEY);
    const name = decodeURIComponent(res.headers.get("x-filename") ?? "shared.pdf");
    return new File([await res.blob()], name, { type: "application/pdf" });
  } catch {
    return null;
  }
}

// ---------------- 安装与离线 ----------------

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

let installPrompt: InstallPromptEvent | null = null;

const standalone =
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

// iOS 上没有 beforeinstallprompt，添加到主屏只能由用户手动完成，只好给出指引。
// iPadOS 的 UA 伪装成 macOS，靠触点数量把它区分出来。
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installEl.hidden = true;
});

/**
 * 装不了的时候要说清为什么。
 *
 * 最常见的情形是用局域网 IP 打开：那不是安全上下文，Service Worker 注册不了，
 * beforeinstallprompt 也就永远不会触发。按钮若只是默默隐藏，用户只会以为
 * 「这应用没有安装功能」，而真正的原因（差一个 https）完全无从得知。
 */
function whyNotInstallable(): string {
  if (isIOS) return "点底部的「分享」，选择「添加到主屏幕」，之后就能像 App 一样离线使用。";
  if (!window.isSecureContext) {
    return `当前是 ${location.protocol}//${location.host}，浏览器只允许在 HTTPS（或 localhost）下安装应用。换成 https 地址打开即可安装。`;
  }
  return "这个浏览器没有提供安装入口。Chrome、Edge 可以安装；Firefox 与 iOS 上的 Safari 请用菜单里的「添加到主屏幕」。";
}

installEl.addEventListener("click", async () => {
  if (installPrompt) {
    installEl.hidden = true;
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    return;
  }
  showStatus(whyNotInstallable());
});

// 已经装好了就不必再提示，其余情况一律显示按钮——装不了也要让用户点得到解释
installEl.hidden = standalone;

// 注册的调用同样放在文件末尾：registerWorker 的回调会用到下面才声明的 offlineStatus，
// 眼下靠 await 的时序侥幸不出错，但那正是本轮踩过的暂时性死区的同款写法。

async function registerWorker() {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    navigator.serviceWorker.addEventListener("message", (e) => onWorkerMessage(e.data));

    // install 只拉了外壳，剩下十几 MB 的词典、字体与 OCR 引擎由页面在这里点火
    const ready = await navigator.serviceWorker.ready;
    log(`Service Worker 就绪 · scope ${registration.scope}`);
    ready.active?.postMessage({ type: "prefetch" });

    registration.addEventListener("updatefound", () => {
      const next = registration.installing;
      if (!next) return;
      next.addEventListener("statechange", () => {
        // 有 controller 才说明这是一次更新，而不是首次安装
        if (next.state === "installed" && navigator.serviceWorker.controller) offerUpdate(next);
      });
    });
  } catch (e) {
    console.warn("Service Worker 注册失败：", e);
  }
}

const offlineStatus = el("span", "dict-status");
statusEl.append(offlineStatus);

function onWorkerMessage(data: unknown) {
  const msg = data as {
    type?: string;
    done: number;
    total: number;
    failed: number;
    failures: string[];
    finished: boolean;
  };
  if (msg?.type !== "prefetch") return;

  if (!msg.finished) {
    offlineStatus.textContent = `离线资源 ${size(msg.done)} / ${size(msg.total)}`;
    return;
  }
  if (msg.failed) {
    offlineStatus.textContent = `离线资源缺 ${msg.failed} 项，下次启动继续`;
    // 缺了什么必须留档：这些文件是离线时功能时好时坏的直接原因
    console.warn(`预缓存缺 ${msg.failed} 项：${msg.failures.join("；")}`);
    return;
  }
  log(`离线资源齐全 ${size(msg.total)}`);
  offlineStatus.textContent = "已可离线使用";
  setTimeout(() => (offlineStatus.textContent = ""), 4000);
}

/**
 * 不自动切到新版本：当前页面已经加载了旧版的分块，中途换掉缓存会让它去取
 * 已经不存在的文件。等用户点一下再刷新。
 */
function offerUpdate(worker: ServiceWorker) {
  const button = el("button", "chip", "新版本 · 刷新");
  button.addEventListener("click", () => worker.postMessage({ type: "skip-waiting" }));
  statusEl.prepend(button);

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---------------- 长按取词 ----------------

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE = 10;

let timer: number | undefined;
let origin: { x: number; y: number } | null = null;

function clearTimer() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

function showHighlight(rects: DOMRect[]) {
  document.getElementById("hl")?.remove();
  const first = rects[0];
  if (!first) return;
  const box = pageEl.getBoundingClientRect();
  const hl = document.createElement("div");
  hl.id = "hl";
  hl.style.left = `${first.left - box.left}px`;
  hl.style.top = `${first.top - box.top}px`;
  hl.style.width = `${first.width}px`;
  hl.style.height = `${first.height}px`;
  pageEl.appendChild(hl);
}

function el(tag: string, cls: string, text?: string) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function lookup(word: string, rects: DOMRect[]) {
  showHighlight(rects);

  const entry = lookupWord(word);
  const head = el("div", "head");
  head.append(el("span", "word", entry?.word ?? word));
  if (entry?.phonetic) head.append(el("span", "phonetic", `/${entry.phonetic}/`));

  if (canSpeak()) {
    const btn = el("button", "speak", "🔊");
    btn.title = voiceName() ?? "系统默认语音";
    btn.addEventListener("click", () => speak(entry?.word ?? word));
    head.append(btn);
  }

  popupEl.replaceChildren(head);

  if (entry?.lemmaOf) {
    popupEl.append(el("div", "lemma", `原型 · 页面上是 ${entry.lemmaOf}`));
  }
  popupEl.append(
    entry ? el("div", "trans", entry.translation) : el("div", "empty", "词典未收录该词"),
  );

  popupEl.hidden = false;
}

function dismiss() {
  popupEl.hidden = true;
  document.getElementById("hl")?.remove();
}

function lookupAt(x: number, y: number) {
  const hit = wordAtPoint(x, y, textLayerEl);
  if (hit) lookup(hit.word, hit.rects);
}

textLayerEl.addEventListener("pointerdown", (e) => {
  origin = { x: e.clientX, y: e.clientY };
  clearTimer();
  timer = window.setTimeout(() => lookupAt(e.clientX, e.clientY), LONG_PRESS_MS);
});

// 桌面端用双击更顺手，触屏端长按更自然，两者都支持
textLayerEl.addEventListener("dblclick", (e) => {
  clearTimer();
  lookupAt(e.clientX, e.clientY);
});

textLayerEl.addEventListener("pointermove", (e) => {
  if (!origin) return;
  if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_TOLERANCE) clearTimer();
});

for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
  textLayerEl.addEventListener(type, () => {
    clearTimer();
    origin = null;
  });
}

// 长按后 Android 仍会尝试弹原生菜单，压掉
textLayerEl.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener("pointerdown", (e) => {
  if (!popupEl.hidden && !popupEl.contains(e.target as Node)) dismiss();
});

window.addEventListener("resize", () => {
  if (doc) void renderPage(pageNum);
});

// 翻页
function go(delta: number) {
  if (!doc) return;
  const target = pageNum + delta;
  if (target < 1 || target > doc.numPages) return;
  pageNum = target;
  dismiss();
  if (docId) void rememberPage(docId, pageNum);
  void renderPage(pageNum);
}

$<HTMLButtonElement>("prev").addEventListener("click", () => go(-1));
$<HTMLButtonElement>("next").addEventListener("click", () => go(1));

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") go(1);
  if (e.key === "ArrowLeft") go(-1);
});

// ---------------- 诊断 ----------------

initDiag();

setAppProbe(async () => {
  const info = dictInfo();
  const all = await recentDocs();
  return {
    词典: info
      ? `${info.words} 词条 / ${info.lemmas} 变形`
      : `未就绪（${document.body.dataset.dict ?? "加载中"}）`,
    当前文档: doc ? `第 ${pageNum} / ${doc.numPages} 页 · OCR 缓存 ${ocrCache.size} 页` : "未打开",
    最近阅读: `${all.length} 本 · ${size(all.reduce((sum, r) => sum + r.size, 0))}`,
    发音音色: voiceName() ?? "无",
  };
});

if (import.meta.env.PROD && "serviceWorker" in navigator) void registerWorker();

void start();

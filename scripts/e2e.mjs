/**
 * 端到端验证取词交互：用 CDP 驱动无头 Chrome，零依赖。
 * 需要先 `npm run dev`，用例依赖 public/sample.pdf 的内容。
 *
 * 用法: node scripts/e2e.mjs [url]
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://127.0.0.1:5173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profile = await mkdtemp(join(tmpdir(), "dove-e2e-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=9222",
  `--user-data-dir=${profile}`,
  "--window-size=1400,1800",
  "--no-first-run",
  "--disable-gpu",
  URL_,
]);

// 必须保证任何退出路径都收掉 Chrome：残留进程会占住调试端口，
// 下次运行会连上它那份旧页面，得到看似合理却完全过时的结果。
const cleanup = () => chrome.kill();
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "uncaughtException"]) {
  process.on(sig, (err) => {
    cleanup();
    if (err) console.error(err);
    process.exit(1);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("找不到 Chrome 调试目标");
}

const ws = new WebSocket(await findTarget());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(fn, ...args) {
  const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "页面异常");
  return r.result.value;
}

async function waitFor(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(fn)) return;
    await sleep(300);
  }
  throw new Error(`超时: ${label}`);
}

// ---- 页面内辅助 ----

const centerOfWord = (word) => {
  const spans = [...document.querySelectorAll("#text-layer span")];
  for (const s of spans) {
    if (!s.firstChild) continue;
    const t = s.textContent ?? "";
    const i = t.indexOf(word);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(s.firstChild, i);
    r.setEnd(s.firstChild, i + word.length);
    const b = r.getBoundingClientRect();
    r.detach();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  return null;
};

const readPopup = () => {
  const p = document.getElementById("popup");
  if (!p || p.hidden) return null;
  const hl = document.getElementById("hl");
  return {
    word: p.querySelector(".word")?.textContent ?? null,
    phonetic: p.querySelector(".phonetic")?.textContent ?? null,
    lemma: p.querySelector(".lemma")?.textContent ?? null,
    trans: (p.querySelector(".trans")?.textContent ?? "").split("\n")[0],
    empty: p.querySelector(".empty")?.textContent ?? null,
    highlight: hl ? { w: Math.round(hl.offsetWidth), h: Math.round(hl.offsetHeight) } : null,
  };
};

async function mouse(type, x, y, clickCount) {
  await send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount,
  });
}

async function doubleClick(x, y) {
  for (const n of [1, 2]) {
    await mouse("mousePressed", x, y, n);
    await mouse("mouseReleased", x, y, n);
  }
}

async function longPress(x, y, ms = 600) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await mouse("mousePressed", x, y, 1);
  await sleep(ms);
  await mouse("mouseReleased", x, y, 1);
}

// ---- 用例 ----

await send("Runtime.enable");
await send("Page.enable");

const logs = [];
await send("Log.enable");
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    logs.push(m.params.entry.text);
  }
});

await waitFor(() => document.querySelectorAll("#text-layer span").length > 0, "PDF 文本层渲染");
await waitFor(() => document.body.dataset.dict === "ready", "词典加载");

const results = [];
async function check(label, word, act, expect) {
  await evaluate(() => document.getElementById("popup")?.setAttribute("hidden", ""));
  const pos = await evaluate(centerOfWord, word);
  if (!pos) return results.push({ label, ok: false, detail: `页面上找不到 "${word}"` });
  await act(pos.x, pos.y);
  await sleep(400);
  const popup = await evaluate(readPopup);
  const detail = popup
    ? `${popup.word}${popup.phonetic ? " " + popup.phonetic : ""}${popup.lemma ? " · " + popup.lemma : ""} | ${popup.empty ?? popup.trans} | 高亮 ${popup.highlight ? popup.highlight.w + "x" + popup.highlight.h : "无"}`
    : "词卡未弹出";
  results.push({ label, ok: popup ? expect(popup) : false, detail });
}

await check("双击取词", "vocabulary", doubleClick, (p) => p.word === "vocabulary");
await check("长按取词", "ubiquitous", longPress, (p) => p.word === "ubiquitous");
await check("跨行连字符拼接", "under-", doubleClick, (p) => p.word === "understanding");
await check("跨行的下半截", "standing", doubleClick, (p) => p.word === "standing");
await check("行内复合词不拼接", "well-", doubleClick, (p) => p.word === "well");
await check("所有格剥离", "learner’s", doubleClick, (p) => p.word === "learner");
await check("词形还原", "conveys", doubleClick, (p) => p.word === "convey" && !!p.lemma);
await check("尾随标点剥离", "ubiquitous.", doubleClick, (p) => p.word === "ubiquitous");
await check("高亮框覆盖单词", "collocations", doubleClick, (p) => (p.highlight?.w ?? 0) > 20);

// ---- 扫描件：没有文本层，取词全靠 OCR 合成 ----

async function checkScanned() {
  const label = "扫描件 OCR 取词";
  await evaluate(async () => {
    const blob = await (await fetch("/sample-scanned.pdf")).blob();
    const input = document.getElementById("file");
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "sample-scanned.pdf", { type: "application/pdf" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });

  // OCR 要下载数 MB 的引擎再识别，给足时间
  const start = Date.now();
  let words = 0;
  while (Date.now() - start < 90000) {
    words = await evaluate(() => document.querySelectorAll("#text-layer span").length);
    if (words > 5) break;
    await sleep(1000);
  }
  if (words <= 5) {
    return results.push({ label, ok: false, detail: `90s 内未识别出文字（${words} 个）` });
  }

  const pos = await evaluate(() => {
    const s = [...document.querySelectorAll("#text-layer span")].find((x) =>
      /^[A-Za-z]{5,}$/.test(x.textContent),
    );
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { word: s.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!pos) return results.push({ label, ok: false, detail: "识别结果里没有可用的英文单词" });

  await doubleClick(pos.x, pos.y);
  await sleep(500);
  const popup = await evaluate(readPopup);
  results.push({
    label,
    ok: !!popup && popup.word.toLowerCase() === pos.word.toLowerCase(),
    detail: `识别 ${words} 词，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s，双击 "${pos.word}" → ${popup ? popup.word + " " + (popup.empty ?? popup.trans) : "无词卡"}`,
  });
}

await checkScanned();

// ---- 旧 WebKit 模拟 ----
// iOS 上所有浏览器都用 WebKit，而它直到 Safari 18.4 才支持 ReadableStream 异步迭代。
// 这里在页面脚本之前抹掉该能力，验证 polyfill 确实先于 pdfjs 生效。
async function checkOldWebKit() {
  const label = "旧 WebKit 兼容";
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `delete ReadableStream.prototype[Symbol.asyncIterator];
             delete ReadableStream.prototype.values;`,
  });
  await send("Page.navigate", { url: URL_ });

  const start = Date.now();
  while (Date.now() - start < 30000) {
    const st = await evaluate(() => ({
      spans: document.querySelectorAll("#text-layer span").length,
      hint: document.getElementById("hint").hidden
        ? null
        : document.getElementById("hint").textContent,
    }));
    if (st.spans > 0) {
      return results.push({ label, ok: true, detail: `无原生异步迭代仍渲染出 ${st.spans} 个文本项` });
    }
    if (st.hint?.includes("失败")) {
      return results.push({ label, ok: false, detail: st.hint });
    }
    await sleep(500);
  }
  results.push({ label, ok: false, detail: "30s 内未渲染出文本层" });
}

await checkOldWebKit();

console.log();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "✔" : "✘"} ${r.label.padEnd(24)} ${r.detail}`);
}
if (logs.length) console.log("\n页面错误:\n  " + logs.join("\n  "));

chrome.kill();
console.log(`\n${results.length - failed} / ${results.length} 通过`);
process.exit(failed ? 1 : 0);

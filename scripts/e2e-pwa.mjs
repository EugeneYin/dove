/**
 * 端到端验证离线可用：先联网装好 Service Worker，然后**把服务器杀掉**，再重新加载。
 *
 * 不用 CDP 的 Network.emulateNetworkConditions 模拟断网：那是对页面 target 生效的，
 * Service Worker 跑在自己的 target 里，未必受同一份限制——万一它还能摸到网络，
 * 整个用例就变成了自欺。服务器进程没了是任何一方都绕不过去的事实。
 *
 * 用法: node scripts/e2e-pwa.mjs
 * 会自行 npm run build 并起 vite preview。
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 4173;
const URL_ = `http://127.0.0.1:${PORT}/`;
const DEBUG_PORT = 9333;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 进程管理 ----
// 任何退出路径都必须收掉这两个进程：残留的 Chrome 会占住调试端口，
// 下次运行连上的是它那份过时页面；残留的 preview 会让「断网」测试根本没断网。

let chrome = null;
let preview = null;

/**
 * 按端口杀，而不是按进程句柄。
 *
 * preview 是 npx 起的，真正监听端口的是它的孙子进程；脚本异常退出时那个进程会被
 * 挂到 init 名下继续活着，下次运行 --strictPort 让位给它，于是「杀掉服务器」杀了个
 * 寂寞，测试连的还是活着的旧服务器——看着全绿，其实根本没断网。
 * 认端口不认进程树，才能保证端口真的空了。
 */
function killPort(port) {
  try {
    const pids = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const pid of pids) process.kill(Number(pid), "SIGKILL");
  } catch {
    // lsof 无匹配时退出码非 0，说明端口本来就空着
  }
}

const cleanup = () => {
  chrome?.kill();
  preview = null;
  killPort(PORT);
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "uncaughtException"]) {
  process.on(sig, (err) => {
    cleanup();
    if (err) console.error(err);
    process.exit(1);
  });
}

function run(cmd, args) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} 退出码 ${code}`))));
  });
}

async function waitForServer(url, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await sleep(200);
  }
  throw new Error(`服务器没起来: ${url}`);
}

/** 确认端口真的不通了，否则后面的「离线」全是假的 */
async function waitForServerGone(url, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fetch(url);
    } catch {
      return true;
    }
    await sleep(200);
  }
  throw new Error("服务器还活着，断网测试无从谈起");
}

console.log("构建…");
await run("npm", ["run", "build"]);

// 先清掉可能残留的旧服务器，否则 --strictPort 会让位给它
killPort(PORT);
preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  detached: true,
});
await waitForServer(URL_);
console.log(`preview 已启动 ${URL_}`);

// ---- CDP ----

const profile = await mkdtemp(join(tmpdir(), "dove-pwa-"));
chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  "--window-size=1400,1800",
  "--no-first-run",
  "--disable-gpu",
  URL_,
]);

async function findTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
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

async function waitFor(fn, label, timeout = 120000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await evaluate(fn);
    if (last) return last;
    await sleep(400);
  }
  throw new Error(`超时: ${label}（最后一次取到 ${JSON.stringify(last)}）`);
}

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

/** 用真实的文件选择器投喂本地文件——离线之后没法再 fetch 样张 */
async function pickFile(path) {
  const { root } = await send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#file",
  });
  await send("DOM.setFileInputFiles", { nodeId, files: [resolve(path)] });
}

const readPopup = () => {
  const p = document.getElementById("popup");
  if (!p || p.hidden) return null;
  return {
    word: p.querySelector(".word")?.textContent ?? null,
    trans: (p.querySelector(".trans")?.textContent ?? "").split("\n")[0],
    empty: p.querySelector(".empty")?.textContent ?? null,
  };
};

const centerOfWord = (word) => {
  for (const s of document.querySelectorAll("#text-layer span")) {
    if (!s.firstChild) continue;
    const i = (s.textContent ?? "").indexOf(word);
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

async function lookUp(word) {
  await evaluate(() => document.getElementById("popup")?.setAttribute("hidden", ""));
  const pos = await evaluate(centerOfWord, word);
  if (!pos) return null;
  await doubleClick(pos.x, pos.y);
  await sleep(400);
  return evaluate(readPopup);
}

const results = [];
const check = (label, ok, detail) => results.push({ label, ok, detail });

// ================= 联网阶段 =================

await send("Runtime.enable");
await send("Page.enable");

console.log("等待 Service Worker 安装并拉齐离线资源（十几 MB，本地很快）…");

await waitFor(
  () => navigator.serviceWorker.controller !== null,
  "Service Worker 接管页面",
  60000,
);

// 预缓存进度由 SW 主动推给页面，这里等它宣布完成
await evaluate(() => {
  window.__prefetch = null;
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "prefetch" && e.data.finished) window.__prefetch = e.data;
  });
  // 监听器装晚了可能错过消息，再催一次
  navigator.serviceWorker.controller?.postMessage({ type: "prefetch" });
});
const prefetch = await waitFor(() => window.__prefetch, "离线资源预缓存完成", 300000);
check(
  "预缓存离线资源",
  prefetch.failed === 0 && prefetch.done > 0,
  `${(prefetch.done / 1048576).toFixed(1)}MB，失败 ${prefetch.failed} 项`,
);

// 只缓存实际会用到的那个 tesseract 核心变体
const cores = await evaluate(async () => {
  const cache = await caches.open((await caches.keys()).find((k) => k.startsWith("dove-v")));
  return (await cache.keys())
    .map((r) => new URL(r.url).pathname)
    .filter((p) => p.startsWith("/tesseract/tesseract-core-"));
});
check("只缓存一个 OCR 核心变体", cores.length === 1, cores.join(", ") || "一个都没有");

// 打开多页样张，翻到第 3 页，让阅读位置被记下来
await pickFile("public/sample-pages.pdf");
await waitFor(() => document.querySelectorAll("#text-layer span").length > 0, "多页样张渲染");
await waitFor(() => document.body.dataset.dict === "ready", "词典加载");

await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", windowsVirtualKeyCode: 39 }); // prettier-ignore
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", windowsVirtualKeyCode: 39 }); // prettier-ignore
await waitFor(() => document.getElementById("pager").textContent === "3 / 3", "翻到第 3 页");

// 再打开扫描件，让它也进最近文档，供离线阶段验证 OCR
await pickFile("public/sample-scanned.pdf");
await waitFor(
  () => document.querySelectorAll("#text-layer span").length > 5,
  "扫描件 OCR 识别（联网阶段）",
  120000,
);

// ================= 断网 =================

console.log("杀掉 preview 服务器…");
killPort(PORT);
preview = null;
await waitForServerGone(URL_);

await send("Page.reload", { ignoreCache: false });
await sleep(1500);

// ---- 用例 ----

const booted = await waitFor(
  () => (document.querySelector("#bar") ? document.title : null),
  "离线冷启动",
  30000,
).catch(() => null);
check("服务器已关闭后仍能冷启动", booted === "Dove — PDF 英语阅读", `title = ${booted}`);

const dictOk = await waitFor(() => document.body.dataset.dict === "ready", "离线词典", 60000)
  .then(() => true)
  .catch(() => false);
check("离线加载 3.7MB 词典", dictOk, dictOk ? "dict = ready" : "词典没能从缓存加载");

const recent = await waitFor(
  () => {
    const rows = [...document.querySelectorAll("#recent .recent-row")];
    return rows.length
      ? rows.map((r) => ({
          name: r.querySelector(".recent-name").textContent,
          meta: r.querySelector(".recent-meta").textContent,
        }))
      : null;
  },
  "最近文档列表",
  20000,
).catch(() => null);
check(
  "离线列出最近文档",
  recent?.length === 2,
  recent ? recent.map((r) => `${r.name}(${r.meta})`).join(", ") : "列表为空",
);

// 记住的是第 3 页
const pagesRow = recent?.find((r) => r.name === "sample-pages.pdf");
check("记住读到第几页", !!pagesRow?.meta.includes("第 3 页"), pagesRow?.meta ?? "找不到该条目");

// 从 IndexedDB 里把书取出来接着读
await evaluate(() => {
  const rows = [...document.querySelectorAll("#recent .recent-row")];
  rows.find((r) => r.querySelector(".recent-name").textContent === "sample-pages.pdf")
    ?.querySelector(".recent-open")
    .click();
});
const resumed = await waitFor(
  () => {
    const pager = document.getElementById("pager").textContent;
    return document.querySelectorAll("#text-layer span").length > 0 ? pager : null;
  },
  "离线续读",
  30000,
).catch(() => null);
check("离线从本地库续读到原位置", resumed === "3 / 3", `打开后停在 ${resumed}`);

const gamma = await evaluate(() => document.querySelector("#text-layer span")?.textContent);
check("续读的确实是第 3 页", gamma === "gamma", `页面上的词是 ${gamma}`);

// 离线查词
await pickFile("public/sample.pdf");
await waitFor(() => document.querySelectorAll("#text-layer span").length > 3, "离线渲染样张");
const popup = await lookUp("conveys");
check(
  "离线取词与词形还原",
  popup?.word === "convey" && !popup.empty,
  popup ? `conveys → ${popup.word} | ${popup.empty ?? popup.trans}` : "词卡未弹出",
);

// 离线 OCR：引擎与语言包全部来自缓存
await pickFile("public/sample-scanned.pdf");
const ocrWords = await waitFor(
  () => {
    const n = document.querySelectorAll("#text-layer span").length;
    return n > 5 ? n : null;
  },
  "离线 OCR",
  180000,
).catch(() => 0);
check("离线 OCR 扫描件", ocrWords > 5, ocrWords ? `识别出 ${ocrWords} 个词` : "没识别出文字");

const ocrPopup = ocrWords
  ? await (async () => {
      const pos = await evaluate(() => {
        const s = [...document.querySelectorAll("#text-layer span")].find((x) =>
          /^[A-Za-z]{5,}$/.test(x.textContent),
        );
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { word: s.textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!pos) return null;
      await doubleClick(pos.x, pos.y);
      await sleep(500);
      const p = await evaluate(readPopup);
      return p && { ...p, source: pos.word };
    })()
  : null;
check(
  "离线在扫描件上取词",
  !!ocrPopup && ocrPopup.word.toLowerCase() === ocrPopup.source.toLowerCase(),
  ocrPopup ? `"${ocrPopup.source}" → ${ocrPopup.word}` : "没能取到词",
);

// ---- 汇总 ----

console.log();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "✔" : "✘"} ${r.label.padEnd(26)} ${r.detail}`);
}

cleanup();
console.log(`\n${results.length - failed} / ${results.length} 通过`);
process.exit(failed ? 1 : 0);

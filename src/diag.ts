/**
 * 自诊断与日志查看。
 *
 * 平板和手机上没有 devtools：连不上电脑、看不到 console、复现不了就问不出原因。
 * 这一层的目标是让用户在设备上点一下「诊断」，就能把足以定位问题的现场
 * 一次性复制出来——环境、能力自检、离线缓存明细、以及带上一次会话的日志。
 *
 * 日志的收集不在这里，而在 index.html 的内联脚本里（模块起不来时也要有日志），
 * 本文件只负责读取 window.__dove 里已经攒下的内容并把它渲染出来。
 */

export type Level = "info" | "warn" | "error";

interface LogEntry {
  t: number;
  l: Level;
  m: string;
}

interface Store {
  logs: LogEntry[];
  /** 上一次会话遗留的日志，崩溃后的现场只剩这一份 */
  prev: LogEntry[];
  push(level: Level, message: string): void;
  open: () => void;
}

const store = (window as unknown as { __dove?: Store }).__dove;

/** 记一条正常的运行轨迹。出问题的分支直接用 console.warn / console.error，内联脚本会接住 */
export function log(message: string) {
  store?.push("info", message);
}

/** 诊断面板里「运行时」一节的应用侧内容，由 main.ts 提供 */
type Probe = () => Promise<Record<string, string>>;
let appProbe: Probe = async () => ({});

export function setAppProbe(probe: Probe) {
  appProbe = probe;
}

// ---------------- 采集 ----------------

type Row = [label: string, value: string, bad?: boolean];

const yes = (ok: boolean): Row[1] => (ok ? "✓" : "✗");

function size(bytes: number) {
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  // 配额动辄几十 GB，只到 MB 会显示成一串没法一眼读出的数字
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

declare const __APP_VERSION__: string;

function environment(): Row[] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (nav as { standalone?: boolean }).standalone === true;

  return [
    ["版本", __APP_VERSION__],
    ["时间", new Date().toLocaleString()],
    ["地址", location.href],
    ["UA", nav.userAgent],
    ["平台", `${nav.platform} · 触点 ${nav.maxTouchPoints}`],
    ["运行模式", standalone ? "已安装（独立窗口）" : "浏览器标签页"],
    ["视口", `${innerWidth}×${innerHeight} @${devicePixelRatio}`],
    ["屏幕", `${screen.width}×${screen.height}`],
    ["网络", nav.onLine ? "在线" : "离线", !nav.onLine],
    ["安全上下文", yes(isSecureContext), !isSecureContext],
    ["内存 / 核心", `${nav.deviceMemory ?? "?"} GB / ${nav.hardwareConcurrency ?? "?"}`],
  ];
}

/** 每一项都对应一条会真的挂掉的功能，缺哪项就知道哪条路径走不通 */
function capabilities(): Row[] {
  const doc = document as Document & {
    caretPositionFromPoint?: unknown;
    caretRangeFromPoint?: unknown;
  };
  const checks: [string, boolean][] = [
    ["Intl.Segmenter（切词）", typeof Intl !== "undefined" && "Segmenter" in Intl],
    ["DecompressionStream（词典解压）", "DecompressionStream" in window],
    ["caret 命中（取词）", !!(doc.caretPositionFromPoint || doc.caretRangeFromPoint)],
    ["CSS round()（文本层对齐）", CSS.supports("width", "round(down, 10px, 1px)")],
    ["Service Worker（离线）", "serviceWorker" in navigator],
    ["Cache Storage（离线）", "caches" in window],
    ["IndexedDB（最近阅读）", "indexedDB" in window],
    ["WebAssembly（OCR）", typeof WebAssembly !== "undefined"],
    ["语音合成（发音）", "speechSynthesis" in window],
  ];
  return checks.map(([name, ok]): Row => [name, yes(ok), !ok]);
}

interface SwDiag {
  /** 形如 dove-v6d3ba83969f5，版本号已含在里面 */
  cache: string;
  core: string;
  cachedBytes: number;
  totalBytes: number;
  missing: string[];
  shellMissing: string[];
  caches: string[];
}

/** 向 Service Worker 要一份缓存明细。它可能不存在、或正卡在某个状态里，所以要有超时 */
function askWorker(active: ServiceWorker | null): Promise<SwDiag | null> {
  if (!active) return Promise.resolve(null);

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 5000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as SwDiag);
    };
    active.postMessage({ type: "diag" }, [channel.port2]);
  });
}

/**
 * 画布上有没有东西。
 *
 * 移动端超过画布面积上限时 getContext 与 render 都照常成功，只是画出来全是空白，
 * 一个错误都不报。「白屏」这类反馈里，这一行往往是唯一能区分
 * 「没渲染」和「渲染了但看不见」的证据。
 */
function canvasInk(): Row[] {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  // 没渲染过的 canvas 也有 300×150 的默认尺寸；渲染过的才会被写上行内 width
  if (!canvas?.style.width) return [["画布", "尚未渲染"]];

  const row: Row = ["画布", `${canvas.width}×${canvas.height}`];
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [row, ["画布内容", "无法读取上下文", true]];

    // 均匀抽 40×40 个点即可判断有无墨迹，整幅读取在大画布上太慢
    const step = {
      x: Math.max(1, Math.floor(canvas.width / 40)),
      y: Math.max(1, Math.floor(canvas.height / 40)),
    };
    let ink = 0;
    let total = 0;
    for (let y = 0; y < canvas.height; y += step.y) {
      for (let x = 0; x < canvas.width; x += step.x) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        total++;
        if (a > 0 && (r < 240 || g < 240 || b < 240)) ink++;
      }
    }
    const blank = ink === 0;
    return [
      row,
      ["画布内容", blank ? "全空白" : `有墨迹 ${Math.round((ink / total) * 100)}%`, blank],
    ];
  } catch (e) {
    return [row, ["画布内容", `读取失败：${(e as Error).message}`, true]];
  }
}

async function runtime(): Promise<Row[]> {
  const rows: Row[] = [];

  const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (!registration) {
    // 开发模式下本来就不注册（见 main.ts 末尾），那不是故障
    const expected = import.meta.env.DEV;
    rows.push(["Service Worker", expected ? "未注册（开发模式）" : "未注册", !expected]);
  } else {
    const state = registration.active
      ? "active"
      : registration.installing
        ? "installing"
        : "waiting";
    rows.push(["Service Worker", `${state} · scope ${registration.scope}`]);
    rows.push([
      "页面已被接管",
      yes(!!navigator.serviceWorker.controller),
      !navigator.serviceWorker.controller,
    ]);
    if (registration.waiting) rows.push(["等待中的新版本", "有（顶栏可刷新）"]);
  }

  // 首次访问时页面还没被接管，但 SW 已经在跑了，这时同样问得到
  const sw = await askWorker(navigator.serviceWorker?.controller ?? registration?.active ?? null);
  if (sw) {
    rows.push(["缓存版本", sw.cache]);
    rows.push([
      "离线资源",
      `${size(sw.cachedBytes)} / ${size(sw.totalBytes)}${sw.missing.length ? ` · 缺 ${sw.missing.length} 项` : " · 齐全"}`,
      sw.missing.length > 0,
    ]);
    // 缺失清单是排查「离线时某个功能突然不能用」的直接证据，全列出来
    if (sw.missing.length) rows.push(["缺失明细", sw.missing.join("\n")]);
    if (sw.shellMissing.length) rows.push(["外壳缺失", sw.shellMissing.join("\n"), true]);
    rows.push(["OCR 核心", sw.core]);
    if (sw.caches.length > 1) rows.push(["残留缓存", sw.caches.join("、")]);
  } else if (registration) {
    rows.push(["缓存明细", "Service Worker 未响应", true]);
  }

  try {
    const estimate = await navigator.storage?.estimate();
    if (estimate) {
      rows.push(["存储占用", `${size(estimate.usage ?? 0)} / ${size(estimate.quota ?? 0)}`]);
    }
    const persisted = await navigator.storage?.persisted?.();
    if (persisted !== undefined) rows.push(["持久化存储", yes(persisted), !persisted]);
  } catch (e) {
    rows.push(["存储", `查询失败：${(e as Error).message}`, true]);
  }

  for (const [label, value] of Object.entries(await appProbe())) rows.push([label, value]);
  rows.push(...canvasInk());

  return rows;
}

// ---------------- 渲染 ----------------

function el(tag: string, cls: string, text?: string) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title: string, rows: Row[]): HTMLElement {
  const box = el("section", "diag-section");
  box.append(el("h3", "", title));
  for (const [label, value, bad] of rows) {
    const row = el("div", bad ? "diag-row bad" : "diag-row");
    row.append(el("span", "diag-label", label), el("span", "diag-value", value));
    box.append(row);
  }
  return box;
}

const stamp = (t: number) => new Date(t).toISOString().slice(11, 23);

function logSection(): HTMLElement {
  const box = el("section", "diag-section");
  const all = store?.logs ?? [];
  const prev = store?.prev ?? [];
  box.append(el("h3", "", `日志（本次 ${all.length} 条，上次会话 ${prev.length} 条）`));

  const list = el("div", "diag-log");
  const line = (e: LogEntry, old: boolean) => {
    const row = el("div", `diag-line ${e.l}${old ? " old" : ""}`);
    row.append(el("span", "diag-time", stamp(e.t)), el("span", "diag-msg", e.m));
    return row;
  };
  for (const e of prev) list.append(line(e, true));
  if (prev.length) list.append(el("div", "diag-sep", "—— 以上为上次会话 ——"));
  for (const e of all) list.append(line(e, false));

  box.append(list);
  return box;
}

/** 复制出去的纯文本版本，用户直接粘贴给开发者 */
function asText(sections: [string, Row[]][]): string {
  const out: string[] = [];
  for (const [title, rows] of sections) {
    out.push(`## ${title}`);
    for (const [label, value] of rows) out.push(`${label}: ${value}`);
    out.push("");
  }
  out.push("## 日志");
  for (const e of store?.prev ?? []) out.push(`${stamp(e.t)} [${e.l}] (上次) ${e.m}`);
  for (const e of store?.logs ?? []) out.push(`${stamp(e.t)} [${e.l}] ${e.m}`);
  return out.join("\n");
}

/**
 * 复制。clipboard API 在非安全上下文和部分 WebKit 版本上会直接失败，
 * 失败了必须给出能手动选中的文本框——否则用户拿不出这份报告，整个模块就白做了。
 */
async function copy(text: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "已复制";
    setTimeout(() => (button.textContent = "复制"), 2000);
  } catch {
    const area = document.createElement("textarea");
    area.className = "diag-copyout";
    area.value = text;
    area.readOnly = true;
    button.after(area);
    area.select();
    button.textContent = "请手动复制 ↓";
  }
}

/** 卡在某个坏掉的缓存版本上时的逃生口：清干净重来 */
async function reset() {
  if (
    !confirm(
      "将删除全部离线缓存并注销 Service Worker（最近阅读的书不受影响），随后重新加载。继续？",
    )
  ) {
    return;
  }
  for (const key of await caches.keys()) await caches.delete(key);
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  location.reload();
}

let panel: HTMLElement | null = null;

async function render() {
  if (!panel) return;

  const sections: [string, Row[]][] = [
    ["环境", environment()],
    ["能力自检", capabilities()],
    ["运行时", await runtime()],
  ];

  const body = el("div", "diag-body");
  for (const [title, rows] of sections) body.append(section(title, rows));
  body.append(logSection());

  const bar = el("header", "diag-bar");
  bar.append(el("strong", "", "诊断"));

  const button = (label: string, onClick: () => void) => {
    const b = el("button", "chip", label) as HTMLButtonElement;
    b.addEventListener("click", onClick);
    return b;
  };

  const copyButton = button("复制", () => void copy(asText(sections), copyButton));
  bar.append(
    copyButton,
    button("刷新", () => void render()),
    button("清空日志", () => {
      if (store) {
        store.logs.length = 0;
        store.prev.length = 0;
      }
      localStorage.removeItem("dove.log");
      void render();
    }),
    button("重置缓存", () => void reset()),
    button("关闭", () => panel?.remove()),
  );

  panel.replaceChildren(bar, body);
}

export function initDiag() {
  if (!store) return;
  store.open = () => {
    // 已经开着就当刷新，避免叠出两层面板
    if (!panel?.isConnected) {
      panel = el("div", "diag-panel");
      document.body.append(panel);
    }
    void render();
  };
}

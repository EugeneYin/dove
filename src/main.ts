import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { wordAtPoint } from "./word";
import { loadDict, lookup as lookupWord } from "./dict";
import { canSpeak, initSpeech, speak } from "./speech";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>("file");
const pageEl = $<HTMLDivElement>("page");
const canvas = $<HTMLCanvasElement>("canvas");
const textLayerEl = $<HTMLDivElement>("text-layer");
const pagerEl = $<HTMLSpanElement>("pager");
const popupEl = $<HTMLDivElement>("popup");
const hintEl = $<HTMLParagraphElement>("hint");

let doc: PDFDocumentProxy | null = null;
let pageNum = 1;
let rendering = false;

async function renderPage(n: number) {
  if (!doc || rendering) return;
  rendering = true;
  try {
    const page = await doc.getPage(n);

    // 按可视宽度缩放，Pad 上铺满
    const available = pageEl.parentElement!.clientWidth - 32;
    const base = page.getViewport({ scale: 1 });
    const scale = available / base.width;
    const viewport = page.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;
    // PDF.js 6 的文本层用这个变量定位
    pageEl.style.setProperty("--total-scale-factor", String(scale));

    const ctx = canvas.getContext("2d")!;
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise;

    textLayerEl.replaceChildren();
    const textLayer = new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(),
      container: textLayerEl,
      viewport,
    });
    await textLayer.render();

    pagerEl.textContent = `${n} / ${doc.numPages}`;
    $<HTMLButtonElement>("prev").disabled = n <= 1;
    $<HTMLButtonElement>("next").disabled = n >= doc.numPages;
  } finally {
    rendering = false;
  }
}

async function openFile(file: File) {
  const data = await file.arrayBuffer();
  doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: "/standard_fonts/",
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    wasmUrl: "/wasm/",
  }).promise;
  pageNum = 1;
  hintEl.hidden = true;
  await renderPage(pageNum);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
});

initSpeech();

// 词典约 3.8MB，首次加载需要时间，期间给出反馈
const dictStatus = el("span", "dict-status", "词典加载中…");
$("bar").append(dictStatus);
void loadDict().then(
  () => {
    dictStatus.remove();
    document.body.dataset.dict = "ready";
  },
  (e: Error) => {
    dictStatus.textContent = `词典加载失败：${e.message}`;
    dictStatus.classList.add("failed");
    document.body.dataset.dict = "failed";
  },
);

// 开发环境自动载入样例文档，便于调试取词（生产构建会被剔除）
if (import.meta.env.DEV) {
  fetch("/sample.pdf")
    .then((r) => r.blob())
    .then((b) => openFile(new File([b], "sample.pdf")))
    .catch(() => {});
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
  void renderPage(pageNum);
}

$<HTMLButtonElement>("prev").addEventListener("click", () => go(-1));
$<HTMLButtonElement>("next").addEventListener("click", () => go(1));

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") go(1);
  if (e.key === "ArrowLeft") go(-1);
});

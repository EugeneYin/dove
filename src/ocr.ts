/**
 * 扫描版 PDF 的取词支持。
 *
 * 思路是不给 OCR 单开一套取词逻辑，而是把识别出的词按坐标合成一个
 * 与 PDF.js 结构相同的透明文本层。这样 word.ts 里的取词、跨行连字符
 * 拼接、所有格剥离等逻辑全部原样复用。
 *
 * 所有资源自托管于 /tesseract，不依赖 CDN，断网可用。
 */

export interface OcrWord {
  text: string;
  /** 画布像素坐标 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

/**
 * 插图里的线条常被误读成低置信度的碎字符。低于此阈值一律丢弃，
 * 否则长按插图会弹出无意义的词条。
 */
const MIN_CONFIDENCE = 60;

type Worker = {
  recognize: (
    image: unknown,
    opts: unknown,
    output: unknown,
  ) => Promise<{ data: { blocks?: unknown[] } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<Worker> | null = null;

/** tesseract 及其 wasm 合计数 MB，只在真正遇到扫描页时才加载 */
async function getWorker(onProgress?: (msg: string) => void): Promise<Worker> {
  workerPromise ??= (async () => {
    onProgress?.("正在加载识别引擎…");
    const { createWorker, OEM } = await import("tesseract.js");
    return (await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/",
      langPath: "/tesseract/lang",
      gzip: true,
      // 词级坐标够用，逐字符坐标会明显拖慢识别
      legacyCore: false,
      legacyLang: false,
    })) as unknown as Worker;
  })();
  return workerPromise;
}

interface RawWord {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

/** tesseract 的结果是 blocks → paragraphs → lines → words 的四层嵌套 */
function flattenWords(blocks: unknown[]): RawWord[] {
  const out: RawWord[] = [];
  for (const block of blocks as { paragraphs?: unknown[] }[]) {
    for (const para of (block.paragraphs ?? []) as { lines?: unknown[] }[]) {
      for (const line of (para.lines ?? []) as { words?: RawWord[] }[]) {
        out.push(...(line.words ?? []));
      }
    }
  }
  return out;
}

export async function recognize(
  canvas: HTMLCanvasElement,
  onProgress?: (msg: string) => void,
): Promise<OcrWord[]> {
  const worker = await getWorker(onProgress);
  onProgress?.("正在识别文字…");
  const { data } = await worker.recognize(canvas, {}, { blocks: true });

  return flattenWords(data.blocks ?? [])
    .filter((w): w is Required<RawWord> => {
      if (!w.bbox || !w.text?.trim()) return false;
      return (w.confidence ?? 0) >= MIN_CONFIDENCE;
    })
    .map((w) => ({
      text: w.text,
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1,
      confidence: w.confidence,
    }));
}

/**
 * 把识别结果铺成透明文本层。
 *
 * 每个词一个 span，按盒子横向拉伸，使字形铺满整个词框——否则词框右半部分
 * 按不到字，长按会落空。
 */
export function buildTextLayer(
  container: HTMLElement,
  words: OcrWord[],
  canvasWidth: number,
  cssWidth: number,
) {
  // PDF.js 渲染过的容器上留有它写入的行内 width/height 与 --min-font-size，
  // 那是上一页的尺寸，必须清掉，让样式表里的 inset: 0 重新生效。
  container.removeAttribute("style");

  const k = cssWidth / canvasWidth;
  const measure = document.createElement("canvas").getContext("2d");
  const frag = document.createDocumentFragment();

  for (const w of words) {
    const height = (w.y1 - w.y0) * k;
    const width = (w.x1 - w.x0) * k;
    if (height <= 0 || width <= 0) continue;

    const span = document.createElement("span");
    span.textContent = w.text;
    span.style.left = `${w.x0 * k}px`;
    span.style.top = `${w.y0 * k}px`;
    span.style.fontSize = `${height}px`;
    span.style.fontFamily = "sans-serif";

    if (measure) {
      measure.font = `${height}px sans-serif`;
      const natural = measure.measureText(w.text).width;
      if (natural > 0) span.style.transform = `scaleX(${width / natural})`;
    }
    frag.append(span);
  }

  container.replaceChildren(frag);
}

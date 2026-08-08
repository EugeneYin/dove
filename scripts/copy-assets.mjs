// PDF.js 与 Tesseract 的运行时资源需要以静态文件形式提供，从 node_modules 拷到 public/。
// 全部自托管，不走 CDN，保证断网可用。
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);

const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
await mkdir("public", { recursive: true });
for (const dir of ["standard_fonts", "cmaps", "wasm"]) {
  await cp(join(pdfjsRoot, dir), join("public", dir), { recursive: true });
}
console.log("已拷贝 pdfjs 资源");

// Tesseract 的核心按浏览器的 SIMD 支持情况三选一，运行时只会下载其中一个。
// 只带 LSTM 变体：识别用不到 legacy 引擎，带上白白多 0.8MB。
const tesseractRoot = dirname(require.resolve("tesseract.js/package.json"));
// 必须从 tesseract.js 的依赖树里解析 core，否则会拿到版本不配套的副本：
// tesseract.js 7 会请求 relaxedsimd 变体，而 core 的 latest（6.1.2）并不提供该文件。
const coreRoot = dirname(
  require.resolve("tesseract.js-core/package.json", { paths: [tesseractRoot] }),
);
const workerFile = join(tesseractRoot, "dist/worker.min.js");

await mkdir("public/tesseract", { recursive: true });
for (const f of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
]) {
  await cp(join(coreRoot, f), join("public/tesseract", f));
}
await cp(workerFile, "public/tesseract/worker.min.js");

// 英语语言包用 fast 版：实测正文识别置信度已达 95+，标准版体积是它的 6 倍不划算
const LANG_URL = "https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz";
const cached = ".cache/eng.traineddata.gz";
await mkdir(".cache", { recursive: true });
if (!existsSync(cached)) {
  process.stdout.write("下载 eng.traineddata.gz ...");
  const res = await fetch(LANG_URL);
  if (!res.ok) throw new Error(`下载语言包失败: HTTP ${res.status}`);
  await writeFile(cached, Readable.fromWeb(res.body));
  console.log(" 完成");
}
await mkdir("public/tesseract/lang", { recursive: true });
await cp(cached, "public/tesseract/lang/eng.traineddata.gz");
console.log("已拷贝 tesseract 资源");

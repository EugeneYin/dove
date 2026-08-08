/**
 * 生成三份测试样张：
 *   public/sample.pdf           带文本层，覆盖跨行连字符、行内复合词、所有格、词形还原
 *   public/sample-scanned.pdf   把上面那份渲染成图片再封装，模拟扫描件，用于验证 OCR 路径
 *   public/sample-pages.pdf     三页，每页一个不同的词，用于验证「记住读到第几页」
 */
import { writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/** 按顺序写出 PDF 对象并补上正确的 xref 表 */
function assemble(objs) {
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [];
  let size = chunks[0].length;
  objs.forEach((body, i) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    size += chunk.length;
  });
  const xref = [`xref\n0 ${objs.length + 1}\n`, "0000000000 65535 f \n"];
  for (const off of offsets) xref.push(`${String(off).padStart(10, "0")} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join("")));
  return Buffer.concat(chunks);
}

function stream(dict, bytes) {
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    Buffer.from("\nendstream"),
  ]);
}

const LINES = [
  "The Ecology of Language Learning",
  "",
  "Reading authentic texts is one of the most effective ways to",
  "acquire vocabulary. When a learner encounters an unfamiliar",
  "word in context, the surrounding sentence provides cues that",
  "make the meaning easier to infer and remember.",
  "",
  "Researchers have long argued that incidental vocabulary under-",
  "standing develops gradually through repeated exposure rather",
  "than through memorization of isolated word lists.",
  "",
  "This well-known finding shaped a learner's expectations about",
  "how quickly progress ought to arrive.",
  "",
  "Consider the word ubiquitous. A dictionary defines it as",
  "present everywhere, but seeing it used in a real paragraph",
  "conveys its register and typical collocations far better.",
];

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const ops = ["BT", "/F1 14 Tf", "18 TL", "60 760 Td"];
for (const line of LINES) {
  if (line) ops.push(`(${escape(line)}) Tj`);
  ops.push("T*");
}
ops.push("ET");
const content = Buffer.from(ops.join("\n"), "latin1");

await writeFile(
  "public/sample.pdf",
  assemble([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
        "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    ),
    stream("", content),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ]),
);
console.log("已生成 public/sample.pdf");

// ---- 多页样张：验证阅读位置能被记住并续读 ----
// 每页只放一个好认的词，测试据此判断当前停在第几页。

const PAGE_WORDS = ["alpha", "beta", "gamma"];

function pageText(word) {
  return Buffer.from(
    ["BT", "/F1 32 Tf", `60 700 Td`, `(${escape(word)}) Tj`, "ET"].join("\n"),
    "latin1",
  );
}

{
  // 对象编号：1 目录，2 页树，3 字体，之后每页两个对象（页 + 内容流）
  const kids = PAGE_WORDS.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  const objs = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${PAGE_WORDS.length} >>`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  PAGE_WORDS.forEach((word, i) => {
    objs.push(
      Buffer.from(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
          `/Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      ),
      stream("", pageText(word)),
    );
  });
  await writeFile("public/sample-pages.pdf", assemble(objs));
  console.log("已生成 public/sample-pages.pdf");
}

// ---- 扫描件样张：渲染成位图后重新封装，页面上便只剩图像、没有文本层 ----

const require = createRequire(import.meta.url);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { createCanvas } = require("@napi-rs/canvas");

const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile("public/sample.pdf")) })
  .promise;
const page = await doc.getPage(1);
// 放大渲染，让 OCR 有足够的像素可辨认
const viewport = page.getViewport({ scale: 2 });
const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, canvas.width, canvas.height);
await page.render({ canvas, canvasContext: ctx, viewport }).promise;
const jpeg = canvas.toBuffer("image/jpeg", 0.92);

const W = 595;
const H = 842;
await writeFile(
  "public/sample-scanned.pdf",
  assemble([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
        "/Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>",
    ),
    stream("", Buffer.from(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`)),
    stream(
      `/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
        "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
      jpeg,
    ),
  ]),
);
console.log(`已生成 public/sample-scanned.pdf（${(jpeg.length / 1024).toFixed(0)}KB 位图）`);

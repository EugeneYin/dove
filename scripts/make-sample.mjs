/**
 * 生成 public/sample.pdf —— 取词逻辑的测试样张。
 * 内容刻意覆盖几种边界：跨行连字符、行内复合词、所有格、需还原的变形。
 */
import { writeFile } from "node:fs/promises";

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
const stream = Buffer.from(ops.join("\n"), "latin1");

const objs = [
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  Buffer.from(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  ),
  Buffer.concat([
    Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
    stream,
    Buffer.from("\nendstream"),
  ]),
  Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
];

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

await writeFile("public/sample.pdf", Buffer.concat(chunks));
console.log("已生成 public/sample.pdf");

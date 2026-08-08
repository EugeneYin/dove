// PDF.js 的字体/编码资源需要以静态文件形式提供，从 node_modules 拷到 public/
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));

await mkdir("public", { recursive: true });
for (const dir of ["standard_fonts", "cmaps", "wasm"]) {
  await cp(join(pdfjsRoot, dir), join("public", dir), { recursive: true });
}
console.log("pdfjs assets copied to public/");

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

// 目标定在 2021 年前后的浏览器，兼顾较旧的 Pad 内核。
// 注意这只降级语法，Intl.Segmenter / DecompressionStream 等运行时 API 无法由此获得，
// 缺失时由 index.html 里的兜底脚本给出明确提示。
const TARGET = ["chrome90", "safari15", "firefox90"];

/**
 * Service Worker 只在安全上下文里注册，局域网 IP 走 http 就装不了 PWA。
 * `scripts/serve.mjs` 会先用 mkcert 签好证书再设上这个变量；
 * 普通的 `pnpm run preview` 不设，仍然是明文 http。
 */
function previewHttps() {
  if (!process.env.DOVE_HTTPS) return undefined;
  return {
    key: readFileSync(join(CERT_DIR, "key.pem")),
    cert: readFileSync(join(CERT_DIR, "cert.pem")),
  };
}

/** 与 scripts/serve.mjs 约定的证书位置 */
const CERT_DIR = ".cache/certs";

/** 不进预缓存：sw.js 自己，以及 e2e 的样张——没必要占用户的离线存储 */
const SKIP = new Set(["sw.js", "sample.pdf", "sample-scanned.pdf", "sample-pages.pdf"]);

/** 应用外壳：装不上这些就等于装不上应用，其余归入 EXTRAS 慢慢补 */
const SHELL = ["index.html", "assets", "icons", "manifest.webmanifest"];

async function walk(root: string, dir = "", out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (SKIP.has(rel)) continue;
    if (entry.isDirectory()) await walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * 生成 dist/sw.js。
 *
 * 清单直接遍历构建完成后的 dist/ 得出，而不是从 rollup 的 bundle 对象里拼：
 * JS/CSS 的文件名带内容 hash，index.html 与 public/ 下的文件又不在 bundle 里，
 * 拼出来的清单必然有缺口，而缺一个分块在离线时就是白屏。
 *
 * 因此挂在 closeBundle 上——那时 dist/ 才是完整的部署产物。
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "dove-sw",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const files = (await walk(outDir)).sort();
      const inShell = (path: string) =>
        SHELL.some((s) => path === s || path.startsWith(`${s}/`));

      const shell: string[] = [];
      // EXTRAS 附上体积，页面才能显示真实的下载进度而不是一个转圈
      const extras: [string, number][] = [];

      // 版本号取自全部被缓存内容的摘要：任何一个文件变了都必须换 cache 名，
      // 否则用户会永远停在旧版本上。public/ 下的文件名不带 hash，只看名字不够。
      const hash = createHash("sha256");

      for (const f of files) {
        const bytes = await readFile(join(outDir, f));
        hash.update(f);
        hash.update(bytes);
        if (inShell(f)) shell.push(`/${f}`);
        else extras.push([`/${f}`, bytes.byteLength]);
      }

      // sw.js 里那三个常量只在 sw-globals.d.ts 里声明过类型，运行时的值在这里补上。
      // 它是纯 JS，无需转译，原样输出即可。
      const preamble = [
        `var __VERSION__ = ${JSON.stringify(hash.digest("hex").slice(0, 12))};`,
        `var __SHELL__ = ${JSON.stringify(shell)};`,
        `var __EXTRAS__ = ${JSON.stringify(extras)};`,
      ].join("\n");

      const body = await readFile("src/sw.js", "utf8");
      // 必须落在站点根目录，SW 的控制范围不能超出自身所在路径
      await writeFile(join(outDir, "sw.js"), `${preamble}\n${body}`);

      const mb = (n: number) => `${(n / 1048576).toFixed(1)}MB`;
      const extraBytes = extras.reduce((sum, [, b]) => sum + b, 0);
      console.log(
        `dist/sw.js  外壳 ${shell.length} 项，离线资源 ${extras.length} 项 ${mb(extraBytes)}`,
      );
    },
  };
}

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  // 诊断面板要报版本号，用户报告问题时才知道他跑的是哪一版
  define: { __APP_VERSION__: JSON.stringify(version) },
  // 绑定所有网卡，便于用局域网 IP 在 Android Pad 真机上调试
  server: { host: true },
  preview: {
    host: true,
    // 隧道域名不放行的话 Vite 会以 403 挡掉
    allowedHosts: [".trycloudflare.com"],
    https: previewHttps(),
  },
  esbuild: { target: TARGET },
  build: { target: TARGET },
  optimizeDeps: { esbuildOptions: { target: TARGET } },
  plugins: [serviceWorker()],
});

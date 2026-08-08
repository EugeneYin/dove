import { defineConfig } from "vite";

// 目标定在 2021 年前后的浏览器，兼顾较旧的 Pad 内核。
// 注意这只降级语法，Intl.Segmenter / DecompressionStream 等运行时 API 无法由此获得，
// 缺失时由 index.html 里的兜底脚本给出明确提示。
const TARGET = ["chrome90", "safari15", "firefox90"];

export default defineConfig({
  // 绑定所有网卡，便于用局域网 IP 在 Android Pad 真机上调试
  server: { host: true },
  esbuild: { target: TARGET },
  build: { target: TARGET },
  optimizeDeps: { esbuildOptions: { target: TARGET } },
});

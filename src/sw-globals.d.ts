// 由 vite.config.ts 的 dove-sw 插件在 sw.js 顶部注入的常量。
// 这里只声明类型，运行时的值来自构建产物。

/** 全部被缓存内容的摘要，任一文件变动都会换出新的 cache 名 */
declare const __VERSION__: string;

/** 应用外壳，install 阶段阻塞下载，缺一不可 */
declare const __SHELL__: string[];

/** 其余离线资源及其体积，由页面触发后逐个补齐 */
declare const __EXTRAS__: [url: string, bytes: number][];

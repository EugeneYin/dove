/**
 * PDF.js worker 的入口。
 *
 * worker 里同样用到了 ReadableStream 的异步迭代，而 worker 有独立的全局环境，
 * 主线程打的 polyfill 到不了这里，必须在加载 pdfjs worker 之前自己补一遍。
 */
import "./polyfills";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";

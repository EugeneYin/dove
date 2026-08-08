/**
 * ReadableStream 的异步迭代（`for await (const x of stream)`）。
 *
 * PDF.js 在 getTextContent 和 worker 里都用了它，而 WebKit 直到 Safari 18.4 才支持。
 * iOS 上所有浏览器（包括 Chrome）都强制使用 WebKit，因此 iPad 上必须补齐，
 * 否则一打开 PDF 就报 "undefined is not a function"。
 *
 * 这是运行时 API 而非语法，降级编译目标解决不了，只能 polyfill。
 * 必须在 pdfjs 之前导入。
 */

interface StreamIterOptions {
  preventCancel?: boolean;
}

if (typeof ReadableStream !== "undefined") {
  // 这里是在给原型打补丁，用 Record 视图绕开 lib 里更严格的声明
  const proto = ReadableStream.prototype as unknown as Record<string | symbol, unknown>;

  if (typeof proto[Symbol.asyncIterator] !== "function") {
    function values(this: ReadableStream<unknown>, { preventCancel = false }: StreamIterOptions = {}) {
      const reader = this.getReader();
      return {
        async next() {
          try {
            const result = await reader.read();
            if (result.done) reader.releaseLock();
            return result;
          } catch (e) {
            reader.releaseLock();
            throw e;
          }
        },
        async return(value?: unknown) {
          if (!preventCancel) await reader.cancel(value);
          reader.releaseLock();
          return { done: true as const, value };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    }

    proto.values = values;
    proto[Symbol.asyncIterator] = values;
  }
}

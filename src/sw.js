/**
 * Service Worker：把应用连同词典、字体与 OCR 引擎一起收进 Cache Storage，
 * 装到主屏之后彻底不依赖网络。
 *
 * 分两批缓存，因为这两批的失败代价完全不同：
 *
 * - SHELL（约 1.9MB）在 install 里阻塞下载，拿不全就不算安装成功，下次访问重来。
 *   量小，弱网也扛得住。
 * - EXTRAS（约 12MB）由页面在加载完成后发消息触发，不阻塞 install，
 *   逐个文件跳过已缓存的，因此中断后下次进来会自动续上。
 *
 * 若整包都压在 install 里，移动网络下断一次就前功尽弃、且 SW 永远装不上。
 *
 * 全项目只有这个文件是 JS 而非 TS：TypeScript 7 不再提供 transpileModule 之类的
 * JS API，为 6KB 代码引入一个打包器不值当。改用 JSDoc 标注类型，由
 * tsconfig.sw.json 以 checkJs 检查，构建时原样输出，只在顶部补上注入的常量。
 * 也因此，**本文件不能有任何 import**。
 */

// __VERSION__ / __SHELL__ / __EXTRAS__ 由构建期注入，类型见 sw-globals.d.ts

// WebWorker 的 self 类型是 WorkerGlobalScope，这里换成 SW 专有的全局类型
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

const CACHE = `dove-v${__VERSION__}`;
/** 分享进来的 PDF 暂存于此，独立于版本化缓存，换版本时不该被清掉 */
const SHARE_CACHE = "dove-share";
const SHARE_KEY = "/__shared__";

// ---------------- tesseract 核心变体 ----------------

/**
 * tesseract.js 按浏览器的 SIMD 支持在三个核心变体里挑一个下载
 * （见其 worker-script/browser/getCore.js），我们只缓存会被选中的那一个：
 * 每个 4.1MB，三个全缓存等于白占 8MB。
 *
 * 下面两段字节是 wasm-feature-detect@1.8.0 的探测模块，从 tesseract.js 打包出的
 * dist/worker.min.js 里原样取出。**升级 tesseract.js 后必须重新核对**，
 * 探测结果与它不一致的话，缓存的会是用不上的那个变体，离线时 OCR 直接 404。
 */
const SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]; // prettier-ignore
const RELAXED_SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]; // prettier-ignore

const CORE_PREFIX = "/tesseract/tesseract-core-";

/** @param {number[]} bytes @returns {boolean} */
function wasmSupports(bytes) {
  try {
    return WebAssembly.validate(new Uint8Array(bytes));
  } catch {
    return false;
  }
}

/** @returns {string} */
function tesseractCore() {
  if (wasmSupports(RELAXED_SIMD)) return `${CORE_PREFIX}relaxedsimd-lstm.wasm.js`;
  if (wasmSupports(SIMD)) return `${CORE_PREFIX}simd-lstm.wasm.js`;
  return `${CORE_PREFIX}lstm.wasm.js`;
}

// ---------------- 生命周期 ----------------

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(__SHELL__)));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 只清版本化缓存，dove-share 里可能正躺着用户刚分享过来的文件
      for (const key of await caches.keys()) {
        if (key.startsWith("dove-v") && key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  const data = /** @type {{ type?: string } | null} */ (event.data);
  // 页面上点了「刷新」才切到新版本：中途换版本会让已加载的页面去取不存在的旧分块
  if (data?.type === "skip-waiting") void sw.skipWaiting();
  if (data?.type === "prefetch") event.waitUntil(prefetch());
  // 诊断面板问缓存明细。回信走请求方给的端口，免得广播给无关页面
  if (data?.type === "diag" && event.ports[0]) event.waitUntil(describe(event.ports[0]));
});

/**
 * 缓存到底缺了什么。
 *
 * 「装上了但某个功能时好时坏」几乎都是某个文件没进缓存，而进度条只报了个
 * 失败计数，看不出缺的是词典还是 OCR 语言包。这里把清单原样交出去。
 *
 * @param {MessagePort} port
 */
async function describe(port) {
  const core = tesseractCore();
  const wanted = __EXTRAS__.filter(([url]) => !url.startsWith(CORE_PREFIX) || url === core);
  const cache = await caches.open(CACHE);

  let cachedBytes = 0;
  let totalBytes = 0;
  const missing = [];
  for (const [url, bytes] of wanted) {
    totalBytes += bytes;
    if (await cache.match(url, { ignoreVary: true })) cachedBytes += bytes;
    else missing.push(url);
  }

  const shellMissing = [];
  for (const url of __SHELL__) {
    if (!(await cache.match(url, { ignoreVary: true }))) shellMissing.push(url);
  }

  port.postMessage({
    cache: CACHE,
    core,
    cachedBytes,
    totalBytes,
    missing,
    shellMissing,
    caches: await caches.keys(),
  });
}

// ---------------- 预缓存 ----------------

/**
 * @typedef {object} Progress
 * @property {"prefetch"} type
 * @property {number} done   已就绪字节数
 * @property {number} total
 * @property {number} failed
 * @property {string[]} failures 失败的 URL 及原因，供诊断面板显示
 * @property {boolean} finished
 */

/** @param {Progress} message */
async function post(message) {
  // includeUncontrolled：首次安装时页面尚未被本 SW 接管，但它正等着看进度
  for (const client of await sw.clients.matchAll({ includeUncontrolled: true })) {
    client.postMessage(message);
  }
}

/** @type {Promise<void> | null} */
let running = null;

/** @returns {Promise<void>} */
function prefetch() {
  running ??= fill().finally(() => {
    running = null;
  });
  return running;
}

async function fill() {
  const core = tesseractCore();
  const wanted = __EXTRAS__.filter(([url]) => !url.startsWith(CORE_PREFIX) || url === core);
  const total = wanted.reduce((sum, [, bytes]) => sum + bytes, 0);

  const cache = await caches.open(CACHE);
  let done = 0;
  /** @type {string[]} */
  const failures = [];

  for (const [url, bytes] of wanted) {
    // 已缓存的直接跳过，这正是中断后能续传的原因
    if (await cache.match(url, { ignoreVary: true })) {
      done += bytes;
      continue;
    }
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await cache.put(url, res);
      done += bytes;
    } catch (e) {
      failures.push(`${url} — ${e instanceof Error ? e.message : String(e)}`);
    }
    await post({
      type: "prefetch",
      done,
      total,
      failed: failures.length,
      failures,
      finished: false,
    });
  }

  await post({ type: "prefetch", done, total, failed: failures.length, failures, finished: true });
}

// ---------------- 请求拦截 ----------------

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (request.method === "POST" && url.pathname === "/share") {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;

  // 导航一律回同一份外壳：分享跳转与文件打开都会带查询参数，
  // 按完整 URL 找缓存必然落空。
  if (request.mode === "navigate") {
    event.respondWith(serve("/index.html", request));
    return;
  }
  event.respondWith(serve(request, request));
});

/**
 * cache-first。资源全是构建产物或不可变的静态文件，没有「取到旧内容」的风险；
 * 换了版本会整个换 cache 名，旧缓存在 activate 里删掉。
 *
 * 未列入预缓存的同源请求（例如某个冷门 cmap）在这里被顺手收进缓存，
 * 用过一次之后离线也能用。
 */
/**
 * @param {Request | string} key
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function serve(key, request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key, { ignoreVary: true });
  if (hit) return hit;

  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") await cache.put(key, res.clone());
    return res;
  } catch {
    // 离线且没缓存。返回一个像样的响应，而不是让页面撞上原始网络错误——
    // 后者在 pdfjs 内部会变成一句看不懂的报错。
    return new Response("离线且该资源未缓存", { status: 504, statusText: "Offline" });
  }
}

// ---------------- 分享目标 ----------------

/**
 * 从别的应用分享过来的 PDF 会以 POST 落到这里。它没法直接交给页面，
 * 于是先塞进缓存再重定向，页面带着 ?shared=1 启动后自己来取。
 */
/** @param {Request} request @returns {Promise<Response>} */
async function receiveShare(request) {
  try {
    const file = (await request.formData()).get("file");
    if (file instanceof File) {
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(
        SHARE_KEY,
        new Response(file, {
          headers: {
            "content-type": "application/pdf",
            // 文件名可能含非 ASCII 字符，HTTP 头放不下，编码后再存
            "x-filename": encodeURIComponent(file.name),
          },
        }),
      );
      return Response.redirect("/?shared=1", 303);
    }
  } catch {
    // 拿不到文件就当普通启动，总好过给用户一个错误页
  }
  return Response.redirect("/", 303);
}

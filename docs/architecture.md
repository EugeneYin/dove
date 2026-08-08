# 架构

## 核心思路

整个应用围绕一个判断展开：**取词不该自己算字符坐标**。

PDF.js 在 canvas 之上会额外铺一层透明的 `<span>` 文本层，每段文字是真实 DOM 节点，
用 CSS 精确对齐到画布上的位置。于是「点了哪个词」变成浏览器原生能力
（`caretPositionFromPoint` + `Intl.Segmenter`），字符命中、词边界、双向文字这些
麻烦事全部交给浏览器。

这个判断的回报在做扫描件支持时兑现：OCR 只需把识别结果**摆成同样结构的文本层**，
取词层一行都不用改。

## 模块

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/main.ts` | 528 | 渲染调度、手势、词卡 UI、状态提示、安装与离线接线 |
| `src/sw.js` | 224 | Service Worker：预缓存、请求拦截、分享目标 |
| `src/library.ts` | 149 | 最近文档与阅读位置（IndexedDB） |
| `src/word.ts` | 124 | 屏幕坐标 → 单词，含连字符拼接与所有格剥离 |
| `src/dict.ts` | 82 | 词典加载与查询，含词形还原 |
| `src/ocr.ts` | 139 | Tesseract 识别，并把结果合成为文本层 |
| `src/speech.ts` | 107 | 音色挑选与朗读 |
| `src/polyfills.ts` | 48 | ReadableStream 异步迭代（WebKit 需要） |
| `src/pdf-worker.ts` | 8 | PDF.js worker 入口，先打补丁再加载 |

`src/sw.js` 是全项目唯一的 JS 文件。TypeScript 7 不再提供 `transpileModule` 这类 JS API，
为 6KB 代码引入打包器不划算；它改用 JSDoc 标注类型，由 `tsconfig.sw.json` 以 `checkJs`
检查，类型覆盖不减。也因此它**不能有任何 import**。

构建期脚本：

| 文件 | 职责 |
|---|---|
| `scripts/build-dict.mjs` | 从 ECDICT 裁剪生成 `public/dict.json.gz` |
| `scripts/copy-assets.mjs` | 把 PDF.js 与 Tesseract 的运行时资源拷进 `public/` |
| `scripts/make-icons.mjs` | 用 Path2D 画出 PWA 图标（含 maskable 与 apple-touch） |
| `scripts/make-sample.mjs` | 生成三份测试样张（带文本层 / 扫描件 / 多页） |
| `scripts/e2e.mjs` | CDP 驱动无头 Chrome 的端到端测试 |
| `scripts/e2e-pwa.mjs` | 同上，但会杀掉服务器验证真离线 |
| `scripts/serve.mjs` | 起一个能真正安装 PWA 的服务器（局域网 https / 隧道） |

`vite.config.ts` 里的 `dove-sw` 插件在 `closeBundle` 阶段生成 `dist/sw.js`：遍历构建完成的
`dist/`，把文件名与体积注入 `sw.js` 顶部。挂在 `closeBundle` 而非 `generateBundle`，是因为
`index.html` 与 `public/` 下的文件都不在 rollup 的 bundle 对象里，那时拼出的清单必有缺口。

## 渲染路径

`renderPage(n)` 是唯一的渲染入口，流程如下：

1. **按可视宽度算缩放** — `scale = (容器宽度 - 32) / 页面原始宽度`
2. **算输出倍率** — 以 `devicePixelRatio` 为准，但画布总面积不得超过
   `MAX_CANVAS_PX`（16,777,216）。超限时按面积开方降倍率。
   移动端浏览器超过画布面积上限后，`getContext` 照常成功、绘制却全白且不报错，
   所以宁可略糊也不能白屏。
3. **清空文本层** — 必须在绘制新页之前做，否则渲染中途失败会让旧文本层盖在新画布上
4. **绘制画布**
5. **取文本内容** — `getTextContent()`
   - `items.length > 0` → 用 PDF.js 的 `TextLayer` 渲染
   - `items.length === 0` → 判定为扫描件，走 OCR

### 渲染串行化

`renderPage` 用递增的 `renderToken` 作废先前的调用，每个 `await` 之后检查
`stale()`。**不能用「有渲染在进行就直接返回」的写法**——Android 收起地址栏会触发
`resize`，那样会把整页渲染吞掉。

## 取词路径

```
长按/双击坐标
   ↓ caretPositionFromPoint（旧 WebKit 回退到 caretRangeFromPoint）
文本节点 + 字符偏移
   ↓ Intl.Segmenter（granularity: "word"）
命中的词及其起止位置
   ↓ endsLineWithHyphen 判断是否行尾断词
   ↓ 是 → 取下一个文本节点的首词拼接
   ↓ normalizeWord 剥离所有格与首尾标点
可查询的词 + DOMRect（用于高亮）
```

两处容易搞错的地方：

- **行尾连字符 vs 行内复合词**。`vocabulary under-` 要与次行的 `standing` 拼成
  `understanding`；而 `well-known` 不能拼成 `wellknown`。判据是连字符是否位于
  该段文本的末尾（`endsLineWithHyphen`）。
- **所有格**。`Intl.Segmenter` 把 `learner's` 整体判为一个词，不剥掉 `'s` 查词典必然落空。

## 词典

ECDICT 全量 77 万词条约 63MB，网页端不现实。收词标准是「有 BNC/COCA 词频排名，
或属柯林斯/牛津核心，或带考试标签」——实测 ECDICT 的词频排名天然止于约 5.7 万词，
这个集合本身就界定了合适的规模，不需要人为设阈值。

结果：58226 词条 + 43013 条变形映射，压缩后 3.7MB。

查询顺序：精确匹配（小写）→ 变形表还原 → 未收录。

> 词表里真的收录了 `constructor` 这个词，所以查询必须用 `Object.hasOwn`。
> 详见 [pitfalls.md](pitfalls.md#词典查询的原型污染)。

## OCR

只在 `getTextContent()` 返回空时触发，引擎与语言包合计约 5.6MB，懒加载，
带文本层的 PDF 完全不受影响。

```
canvas ──► Tesseract（LSTM，eng fast）──► blocks/paragraphs/lines/words
                                              ↓ 置信度 ≥ 60 过滤
                                         词 + 画布像素坐标
                                              ↓ × (cssWidth / canvasWidth)
                                         绝对定位的透明 span
```

三个要点：

- **置信度过滤**。插图里的线条常被误读成低置信度碎字符，不滤掉的话长按插图会
  弹出无意义词条。
- **横向拉伸**。每个 span 按词框宽度做 `scaleX`，否则字形填不满词框，词框右半部分
  按不到字。
- **缓存连画布宽度一起存**。词坐标属于识别时那张画布的像素空间，屏幕旋转重建画布后
  旧坐标不再适用。

## 文本层的 CSS 契约

`text_layer.js` 只在 span 上写出自定义属性：

```
--font-height: 14.00px;  --scale-x: 0.9554541671237108;
```

真正的 `font-size` 与 `transform` **必须由样式表算出来**。`src/style.css` 中相应
规则取自 pdf.js 的 `web/text_layer_builder.css`，改动它之前请先读
[pitfalls.md](pitfalls.md#pdfjs-文本层的-css-契约)。

OCR 合成的 span 也会命中同一条规则，但它们的 `font-size` 与 `transform` 是行内
设置的，优先级更高，因此不受影响。

## 离线层（v2.0）

### 两批预缓存

失败代价不同，所以分开处理：

| 批次 | 内容 | 体积 | 时机 |
|---|---|---|---|
| SHELL | `index.html`、带 hash 的 JS/CSS、manifest、图标 | ~1.9MB | `install` 阶段阻塞，拿不全就不算装上 |
| EXTRAS | 词典、cmaps、字体、wasm、OCR 引擎与语言包 | ~12MB | 页面加载完成后发消息触发，不阻塞 |

EXTRAS 逐个文件跳过已缓存的，因此**中断后下次打开会自动续上**。若把全部十几 MB
压在 `install` 里，移动网络断一次就前功尽弃，而且 Service Worker 永远装不上——
装不上就没有任何离线能力，比慢慢补齐糟得多。

进度由 SW 用 `postMessage` 推给页面（含已完成与总字节数），顶栏显示「离线资源 8.2 / 12.4 MB」。

### OCR 核心变体

`tesseract.js` 会按浏览器的 SIMD 支持在三个核心变体里挑一个下载，每个约 4MB。
SW 自己跑同一套 `WebAssembly.validate` 探测，只缓存会被选中的那一个，省下约 8MB。

探测用的两段字节取自 `wasm-feature-detect@1.8.0`，与 `tesseract.js` 内部完全一致。
**升级 `tesseract.js` 后必须重新核对**：探测结果一旦与它不一致，缓存的就是用不上的变体，
离线时 OCR 直接 404。

### 缓存策略

`dove-v<摘要>` 存版本化内容，`dove-share` 单独存分享进来的文件，换版本时不清它。

全部走 cache-first——资源要么是内容 hash 命名的构建产物，要么是不会变的静态文件，
没有取到旧内容的风险；换了版本会整个换 cache 名，旧的在 `activate` 里删掉。
未列入预缓存的同源请求（例如某个冷门 cmap）会被顺手收进缓存，用过一次后离线也能用。

导航请求一律回同一份 `/index.html`：分享跳转与文件打开都会带查询参数，按完整 URL
找缓存必然落空。

版本号是**全部被缓存内容的摘要**。只看文件名不行——`public/` 下的文件名不带 hash，
词典重新生成后名字一模一样，用户会永远停在旧词典上。

新版本不自动切换：当前页面已经加载了旧版分块，中途换缓存会让它去取已经不存在的文件。
顶栏出现「新版本 · 刷新」，由用户点。

### 最近文档

`src/library.ts`，IndexedDB 直接存 `File` 对象（可结构化克隆，不必转 base64）。
键是「文件名 + 大小 + 修改时间」而非内容 hash——几十 MB 的文件算一次 hash 要几秒。

上限 10 本且总量不超过 400MB，按最久未打开淘汰。**两个上限都要有**：教材扫描件动辄
几十 MB，只按本数限制会把存储配额吃光，连带把 Service Worker 的离线缓存一起挤掉。

首次写入时请求 `navigator.storage.persist()`，否则系统紧张时会把离线缓存整个清掉，
而那正是最不能丢的部分。

### 系统入口

manifest 里的 `file_handlers` 让 Android / 桌面能「用 Dove 打开」某个 PDF，
页面用 `launchQueue.setConsumer` 接住——这恰好补上了当初选网页方案时让掉的那点便利。

`share_target` 是 POST，文件没法直接交给页面：SW 拦下 `/share`，把文件塞进 `dove-share`
缓存后重定向到 `/?shared=1`，页面启动时自己来取并清掉。iOS 两者都不支持，仍走文件选择按钮。

## 浏览器兼容

iOS/iPadOS 上所有浏览器都被强制使用 WebKit。WebKit 直到 Safari 18.4 才支持
`ReadableStream` 的异步迭代，而 PDF.js 在 `getTextContent` 和 worker 里都用了它。

因此：

- `src/polyfills.ts` 补齐该能力，并在 `main.ts` 里**最先导入**
- worker 有独立全局环境，主线程的 polyfill 到不了，故 worker 经由
  `src/pdf-worker.ts` 启动（先补丁，再加载 pdfjs worker），通过 `workerPort` 挂上
- `index.html` 里有一段**普通脚本**做兜底诊断：模块脚本若解析失败，模块内的错误
  处理同样不会执行，页面会彻底空白。那段脚本先于模块运行，负责把原因显示出来

## 资源与体积

| 资源 | 体积 | 加载时机 | 预缓存批次 |
|---|---|---|---|
| 主包 | 542KB（gzip 163KB） | 启动 | SHELL |
| PDF.js worker | 1.25MB | 启动 | SHELL |
| 图标与 manifest | 27KB | 安装 | SHELL |
| 词典 | 3.7MB | 启动（并行） | EXTRAS |
| cmaps | 1.1MB / 169 文件 | 仅 CJK 嵌入字体 | EXTRAS |
| standard_fonts | 0.7MB | 多数 PDF | EXTRAS |
| pdfjs wasm | 1.5MB | jbig2 / openjpeg 等 | EXTRAS |
| Tesseract 核心 | ~3.7MB | 首次遇到扫描页 | EXTRAS（三选一） |
| 英语语言包 | 2.1MB | 首次遇到扫描页 | EXTRAS |

全部自托管，不走 CDN。装成 PWA 后离线占用约 12.7MB（实测），加上最近文档的 PDF 本身。

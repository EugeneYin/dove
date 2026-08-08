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
| `src/main.ts` | 328 | 渲染调度、手势、词卡 UI、状态提示 |
| `src/word.ts` | 124 | 屏幕坐标 → 单词，含连字符拼接与所有格剥离 |
| `src/dict.ts` | 82 | 词典加载与查询，含词形还原 |
| `src/ocr.ts` | 139 | Tesseract 识别，并把结果合成为文本层 |
| `src/speech.ts` | 107 | 音色挑选与朗读 |
| `src/polyfills.ts` | 48 | ReadableStream 异步迭代（WebKit 需要） |
| `src/pdf-worker.ts` | 8 | PDF.js worker 入口，先打补丁再加载 |

构建期脚本：

| 文件 | 职责 |
|---|---|
| `scripts/build-dict.mjs` | 从 ECDICT 裁剪生成 `public/dict.json.gz` |
| `scripts/copy-assets.mjs` | 把 PDF.js 与 Tesseract 的运行时资源拷进 `public/` |
| `scripts/make-sample.mjs` | 生成两份测试样张（带文本层 / 扫描件） |
| `scripts/e2e.mjs` | CDP 驱动无头 Chrome 的端到端测试 |

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

| 资源 | 体积 | 加载时机 |
|---|---|---|
| 主包 | 537KB（gzip 161KB） | 启动 |
| PDF.js worker | 1.25MB | 启动 |
| 词典 | 3.7MB | 启动（并行） |
| Tesseract 核心 | ~3.7MB | 首次遇到扫描页 |
| 英语语言包 | 1.9MB | 首次遇到扫描页 |

全部自托管，不走 CDN。Tesseract 核心按浏览器 SIMD 支持情况三选一，
运行时只下载其中一个。

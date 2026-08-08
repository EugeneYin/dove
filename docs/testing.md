# 测试策略

## 分层

| 层次 | 命令 | 覆盖 | 依赖 |
|---|---|---|---|
| 单元测试 | `npm test` | 纯逻辑：分词、归一化、词典查询 | 无（`node --test` 内置） |
| 端到端 | `npm run e2e` | 真实事件、渲染、对齐、OCR、兼容性 | 本机 Chrome + `npm run dev` |
| 离线端到端 | `npm run e2e:pwa` | 安装、预缓存、断网后的全部功能 | 本机 Chrome（自行构建并起 preview） |
| 类型检查 | `npm run typecheck` | 接口契约（含 `sw.js` 的 JSDoc） | 无 |

e2e 用 CDP 直接驱动本机 Chrome，不需要 Playwright 之类的框架，也不下载额外的
浏览器二进制。

## 一条必须遵守的原则

**基准必须来自被测对象之外。**

这条是踩出来的。早期的取词用例是这样写的：从文本层里挑一个 span，算出它的中心点，
在那里双击，断言弹出的词等于该 span 的文本。它永远通过——因为每个 span 只含一个词，
点它自己的中心必然命中它自己。于是**整个文本层相对画布偏移 5% 的 bug 被完全掩盖**，
一直到用户报告才发现。

现在「文本层与画布对齐」用例改为扫描 canvas 像素、找出每行墨迹的真实横向范围，
再与文本层的行宽比较。基准是渲染出来的像素，与文本层无关。

同理，扫描件的 OCR 用例之所以可信，是因为 `sample-scanned.pdf` 是
`sample.pdf` 的位图版——同一页内容的两种形态，可以互为参照。

离线用例遵守的也是这条：**不模拟断网，而是把 preview 服务器进程杀掉再确认端口不通**。
CDP 的 `Network.emulateNetworkConditions` 只对页面 target 生效，Service Worker 在自己的
target 里，未必受同一份限制——用它来测离线，等于让被测对象自证。服务器没了则谁也绕不过去。

## 测试样张

`npm run sample` 生成三份，正文是按用例需要设计的，改动会影响 e2e：

| 文件 | 用途 |
|---|---|
| `public/sample.pdf` | 带文本层。含跨行连字符、行内复合词、所有格、需还原的变形 |
| `public/sample-scanned.pdf` | 上面那份渲染成 JPEG 再封装，无文本层，用于 OCR 路径 |
| `public/sample-pages.pdf` | 三页，正文分别是 `alpha` / `beta` / `gamma`，用于验证阅读位置 |

正文里各边界情况对应的位置：

| 边界 | 样张中的文本 |
|---|---|
| 跨行连字符 | `...vocabulary under-` / `standing develops...` |
| 行内复合词 | `This well-known finding...` |
| 所有格 | `...shaped a learner's expectations...`（渲染为 `learner’s`） |
| 词形还原 | `conveys`、`collocations` |
| 尾随标点 | `Consider the word ubiquitous.` |

## 单元用例（9）

`src/word.test.ts`

| 用例 | 守住什么 |
|---|---|
| `normalizeWord` 去掉所有格和标点 | `learner’s → learner`、`boys' → boys`、`ubiquitous. → ubiquitous` |
| `segmentAt` 命中光标所在的词 | 含光标停在词尾字符之后的情形 |
| `endsLineWithHyphen` 只在行尾连字符时成立 | 区分 `under-`（拼接）与 `well-known`（不拼接） |

`src/dict.test.ts`

| 用例 | 守住什么 |
|---|---|
| 直接命中 | 基本查询与音标返回 |
| 大小写不敏感 | `Run` / `CONVEYS` |
| 词形还原并标注原查询词 | `ran → run`，且记录页面上的原词 |
| 变形指向的原型不在词表时不误报 | 变形表与词表不一致时返回 null |
| **不会命中 `Object.prototype` 上的属性** | `constructor` 返回真实词条；`toString` / `hasOwnProperty` / `__proto__` 返回未收录 |
| 未收录返回 null | — |

## 端到端用例（12）

| 用例 | 守住什么 |
|---|---|
| 双击取词 | 桌面手势 |
| 长按取词 | 触屏手势（用 pointer 事件模拟按住） |
| 跨行连字符拼接 | `under-` + `standing` → `understanding` |
| 跨行的下半截 | 单独点 `standing` 仍得到 `standing`，不被拼接逻辑污染 |
| 行内复合词不拼接 | `well-known` → `well`，不得拼成 `wellknown` |
| 所有格剥离 | `learner’s` → `learner` |
| 词形还原 | `conveys` → `convey`，且词卡标注原词 |
| 尾随标点剥离 | `ubiquitous.` → `ubiquitous` |
| 高亮框覆盖单词 | 高亮宽度非零且合理 |
| **文本层与画布对齐** | 以画布墨迹为基准，行宽偏差 < 3% |
| **扫描件 OCR 取词** | 无文本层的页面能识别并取词查出释义 |
| **旧 WebKit 兼容** | 抹掉原生 `ReadableStream` 异步迭代后仍能渲染 |

后三条是核心防线，分别对应三类曾经真实发生的故障。

## 离线端到端用例（11）

`npm run e2e:pwa`。先联网装好 Service Worker 并等预缓存完成，随后**杀掉服务器**，
再重新加载页面跑余下的用例。

| 用例 | 守住什么 |
|---|---|
| 预缓存离线资源 | 12.7MB 全部就位，零失败 |
| 只缓存一个 OCR 核心变体 | SIMD 探测与 tesseract.js 一致，没多存 8MB |
| 服务器已关闭后仍能冷启动 | 外壳与导航请求确实来自缓存 |
| 离线加载 3.7MB 词典 | 词典进了缓存，且 gzip 判定在缓存路径下依然正确 |
| 离线列出最近文档 | IndexedDB 里两本书都在 |
| 记住读到第几页 | 联网阶段翻到第 3 页，离线后列表仍显示第 3 页 |
| 离线从本地库续读到原位置 | 点开直接停在 3 / 3，不是回到第 1 页 |
| 续读的确实是第 3 页 | 以页面正文 `gamma` 为准，而不是只看页码显示 |
| 离线取词与词形还原 | `conveys → convey`，释义来自缓存的词典 |
| 离线 OCR 扫描件 | 引擎与语言包全部来自缓存 |
| 离线在扫描件上取词 | OCR 合成文本层 + 词典查询在离线下贯通 |

倒数第二、三条是这一轮的核心防线：它们同时证明预缓存清单没有缺口、变体探测选对了。

## 无法自动验证的部分

以下只能人工在真机上确认，改动相关代码后请手动复验：

| 项目 | 原因 |
|---|---|
| 发音是否出声、音质如何 | 无头浏览器没有音频输出 |
| 移动端画布面积上限 | 桌面 Chrome 复现不了真机 GPU 限制 |
| Android 原生长按菜单是否被压住 | 移动端浏览器特有行为 |
| 真机 OCR 耗时 | 平板 CPU 与桌面差异大（实测 iPad 1 秒以内） |
| iOS「添加到主屏幕」后是否全屏 | 依赖 `apple-mobile-web-app-*` 系列标签，无头环境不生效 |
| 安装按钮与安装横幅 | `beforeinstallprompt` 在无头 Chrome 里不触发 |
| 文件打开与分享入口 | `file_handlers` / `share_target` 需要真的把应用装到系统里 |
| 安全区留白（刘海、home 条） | `env(safe-area-inset-*)` 只在真机全屏下有值 |
| 弱网下预缓存中断后续传 | 需要真实的不稳定网络；本地服务器要么通要么不通 |
| `navigator.storage.persist()` 是否获批 | 取决于系统与用户使用频度，无法在测试里构造 |

## 调试手法

排查渲染或对齐问题时，直接读画布像素是最可靠的手段：

```js
// 找出每行墨迹的真实横向范围（见 scripts/e2e.mjs 的 INK_BANDS）
const img = ctx.getImageData(0, 0, c.width, c.height).data;
const dark = (x, y) => { const i = (y * c.width + x) * 4; return img[i] < 160; };
```

排查 PDF 本身的问题时，用 pdfjs 的 legacy 构建在 Node 里直接解析：

```js
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await pdfjs.getDocument({ data }).promise;
const tc = await (await doc.getPage(n)).getTextContent();
console.log(tc.items.length);   // 0 表示扫描件
```

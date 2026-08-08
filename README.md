# Dove

英语 PDF 阅读学习工具。长按单词查看释义、音标与发音，面向 Android Pad 浏览器使用。

## 开发

```bash
pnpm install
npm run dict    # 首次必须执行：生成离线词典（会下载约 63MB 的 ECDICT 源数据）
npm run dev
```

`npm run dev` 会输出局域网地址，Pad 连同一 Wi-Fi 后直接访问即可真机调试。

其他命令：

```bash
npm test        # 单元测试（node --test，无额外依赖）
npm run e2e     # 端到端验证取词交互，需先 npm run dev
npm run build   # 生产构建到 dist/
npm run sample  # 重新生成测试样张 public/sample.pdf
```

`npm run e2e` 用 CDP 驱动本机 Chrome 无头模式，不依赖 Playwright 之类的框架。
它覆盖的是单元测试碰不到的部分：真实的双击/长按事件、文本层与 canvas 的对齐、
词卡内容。样张 `public/sample.pdf` 的正文是按用例需要设计的，改动它会影响 e2e。

## 交互

| 设备 | 取词方式 |
|---|---|
| 桌面（鼠标） | 双击单词，或按住 400ms |
| 触屏（Pad） | 长按 400ms |

## 结构

| 文件 | 作用 |
|---|---|
| `src/word.ts` | 从屏幕坐标取出单词，处理跨行连字符与所有格 |
| `src/dict.ts` | 离线词典查询，含词形还原 |
| `src/ocr.ts` | 扫描件 OCR，并把结果合成为文本层 |
| `src/speech.ts` | Web Speech API 发音 |
| `src/main.ts` | PDF 渲染、长按手势、词卡 UI |
| `scripts/build-dict.mjs` | 从 ECDICT 裁剪生成词典 |
| `scripts/copy-assets.mjs` | 拷贝 PDF.js 与 Tesseract 的运行时资源到 `public/` |
| `scripts/make-sample.mjs` | 生成两份测试样张（带文本层 / 扫描件） |

## 浏览器兼容

iOS/iPadOS 上所有浏览器（包括 Chrome）都被强制使用 WebKit，因此 iPad 的实际内核是
Safari 的。WebKit 直到 **Safari 18.4** 才支持 `ReadableStream` 的异步迭代，而 PDF.js
在 `getTextContent` 和它的 worker 里都用了这个特性——缺了它一打开 PDF 就报
`undefined is not a function`。

这是运行时 API 而非语法，降低编译目标或改用 legacy 构建都无济于事，只能 polyfill
（`src/polyfills.ts`）。worker 有独立的全局环境，主线程的 polyfill 到不了，所以 worker
经由 `src/pdf-worker.ts` 启动，先打补丁再加载 pdfjs worker。

`npm run e2e` 里有一项会在页面脚本之前抹掉原生的异步迭代能力，以此守住这条兼容路径。

## 取词原理

PDF.js 在 canvas 之上铺一层透明的 `<span>` 文本层，因此取词直接用浏览器的
`caretPositionFromPoint` + `Intl.Segmenter`，无需自己做字符级坐标命中。

两个需要特殊处理的情况：

- **跨行连字符**：`under-` / `standing` 分属两个文本运行，需拼接成 `understanding`；
  而行内的 `well-known` 不能拼接。判断依据是连字符是否位于文本运行末尾。
- **所有格**：`Intl.Segmenter` 把 `learner’s` 整体识别为一个词，查词典前必须剥掉 `’s`。

## 扫描版 PDF

扫描件页面上只有图像，没有文本层，长按无从命中。这类页面会自动走 Tesseract OCR，
把识别出的词按坐标合成一个透明文本层——**结构与 PDF.js 生成的一致，所以 `word.ts`
里的取词、连字符拼接、所有格剥离等逻辑全部原样复用**，OCR 只负责把图像变成带坐标的文字。

几个要点：

- 置信度低于 60 的词会被丢弃。插图里的线条常被误读成碎字符，不滤掉的话长按插图
  会弹出无意义的词条。
- 识别结果按页缓存，并连同当时的画布宽度一起存——词坐标属于那张画布的像素空间，
  屏幕旋转导致画布重建后，旧坐标不再适用。
- 引擎与语言包合计约 5.6MB，只在真正遇到扫描页时才懒加载，带文本层的 PDF 不受影响。
- 语言包用 `tessdata_fast`（1.9MB）。实测正文识别置信度 95 以上，标准版体积是它的
  6 倍，不划算。
- 必须从 `tesseract.js` 的依赖树里解析 `tesseract.js-core`：tesseract.js 7 会请求
  `relaxedsimd` 变体，而 core 在 npm 上的 `latest`（6.1.2）并不提供该文件。

## 词典

来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）。全量 77 万词条约 63MB，
网页端不现实，因此按「有 BNC/COCA 词频排名，或属柯林斯/牛津核心，或带考试标签」
裁剪至 58226 词，配 43013 条变形映射，gzip 后 3.7MB。

词典预压缩为 `dict.json.gz`。注意部分服务器（含 Vite dev）会给 `.gz` 文件加上
`Content-Encoding: gzip`，浏览器便已透明解压；因此客户端靠 gzip 魔数判断是否需要
自己解压，两种情况都能正确处理。生成产物不入库，克隆后需自行执行 `npm run dict`。

极生僻的专业术语和部分英式拼写（如 `memorisation`）不在收词范围内。

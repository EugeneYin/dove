# 踩坑记录

全部是真实调试出来的问题，多数症状与根因相距甚远。改动相关代码前请先读对应条目。

---

## PDF.js 文本层的 CSS 契约

**症状** 长按取到的词是对的，但蓝色高亮框罩在真实单词左侧，覆盖「上一个词的后半 +
目标词的前半」；必须按在词的首字母附近才选得中。

**根因** `text_layer.js` 只在 span 上写出自定义属性：

```
--font-height: 14.00px;  --scale-x: 0.9554541671237108;
```

真正的 `font-size` 与 `transform` 要由样式表算出来。我们手写文本层 CSS 时漏了这条
规则，于是 span 的 `font-size` 变成从 `body` 继承的 15px，`--scale-x` 的横向修正
**从未被应用**。`1 / 0.9554 = 1.047`，与实测的 4.98% 偏差吻合。误差沿每行累积，
行中位置就差出半个词。

**修法** 把 pdf.js `web/text_layer_builder.css` 中的相应规则搬进 `src/style.css`：

```css
.textLayer > :not(.markedContent) {
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
```

**如何守住** e2e 的「文本层与画布对齐」用例，以**画布像素的真实墨迹**为基准。
升级 pdfjs-dist 时应重新核对该 CSS 是否仍然匹配。

**教训** 这个 bug 存在了很久却没被测出来，因为原有测试是从文本层自身算出点击坐标
再去验证文本层——**用被测对象验证自己**。基准必须来自外部。

---

## 词典查询的原型污染

**症状** 构建脚本崩在 `prev.join is not a function`；运行时则更隐蔽——查 `toString`
会返回一个函数而不是「未收录」。

**根因** 英语词表里真的收录了 `constructor` 这个词。用普通对象存词典时，
`words["constructor"]` 命中的是 `Object.prototype.constructor`。

**修法** 构建期用 `Map`；运行时查询一律经 `Object.hasOwn`。

**如何守住** `src/dict.test.ts` 里有专门用例，断言 `constructor` 返回真实词条，
而 `toString` / `hasOwnProperty` / `__proto__` 返回未收录。

---

## gzip 双重解压

**症状** iPad 与 Mac 上词典完全加载不了，但本地 `curl` 一切正常。

**根因** Vite（以及不少静态服务器）会给 `.gz` 文件自动加上
`Content-Encoding: gzip`，浏览器**已经透明解压过一遍**，客户端再解压一次就抛异常。
是否发生取决于服务器配置，因此「预压缩就与服务器无关」的想法是错的。

**修法** 按 gzip 魔数（`1f 8b`）判断是否需要自己解压，两种情况都能正确处理。

---

## WebKit 缺少 ReadableStream 异步迭代

**症状** iPad 上一打开 PDF 就报
`undefined is not a function (near '...value of readableStream...')`。

**根因** iOS/iPadOS 强制所有浏览器使用 WebKit，所以 iPad 上的「Chrome」跑的是
Safari 引擎。WebKit 直到 **Safari 18.4** 才支持 `for await (const x of stream)`，
而 PDF.js 在 `getTextContent`（`pdf.mjs`）和 worker（`pdf.worker.mjs`）里都用了它。

**注意** 这是**运行时 API 而非语法**。换 legacy 构建、降低 esbuild 编译目标都无效
——`for await` 降级后仍要调用 `ReadableStream.prototype[Symbol.asyncIterator]`。

**修法** `src/polyfills.ts`，且必须在 `main.ts` 里最先导入。worker 有独立全局环境，
故经由 `src/pdf-worker.ts` 启动（先补丁再加载 pdfjs worker），用 `workerPort` 挂上。

**如何守住** e2e 的「旧 WebKit 兼容」用例会在页面脚本之前抹掉原生实现。
反向验证也做过：移除 polyfill 后能精确复现 iPad 上的报错。

---

## tesseract.js-core 版本错配

**症状** （在真机上会表现为）OCR 加载 404 失败。

**根因** `tesseract.js@7` 在支持 relaxed SIMD 的浏览器（Chrome 114+）上会请求
`tesseract-core-relaxedsimd-lstm.wasm.js`，而 `tesseract.js-core` 在 npm 上的
`latest` 是 **6.1.2**（版本号看着比 7.0.0 新，实为另一分支），**不含该文件**。

手动 `pnpm add tesseract.js-core` 恰好会拉到错误的那个。

**修法** `scripts/copy-assets.mjs` 从 tesseract.js 的依赖树里解析 core：

```js
require.resolve("tesseract.js-core/package.json", { paths: [tesseractRoot] })
```

---

## macOS 的玩笑音色

**症状** 同一份代码，iPad 发音清晰，Mac 上非常沙哑。

**根因** macOS 自带约二十个玩笑音色（Albert、Zarvox、Bubbles、Trinoids……），
它们同样是本地的 en-US 语音，且在 `getVoices()` 里**排在自然音色前面**。
按语言取第一个会选中 **Albert**——一个故意做成沙哑腔调的卡通音色。

实测还发现：**没有任何音色带 `default` 标志**，所以不能指望系统给出首选。

**修法** `src/speech.ts` 改为优先白名单（Samantha、Google US English、
Microsoft Aria……）+ 玩笑音色黑名单兜底。词卡上 🔊 按钮的 `title` 会显示实际
使用的音色，便于排查。

---

## 移动端画布面积上限

**症状** 平板上打开 PDF 后一片空白，无任何报错。

**根因** 移动端浏览器对画布总面积有上限，超过后 `getContext` 照常成功、
绘制却是全白且不抛异常。2000×1200 的平板在 dpr 3 下会要求 **49.3M 像素**。

**修法** `MAX_CANVAS_PX = 16_777_216`，超限时按面积开方降低渲染倍率。宁可略糊。

**注意** 无头桌面 Chrome 复现不了真机的画布上限，这条只能靠推理与防御。

---

## 渲染被静默丢弃

**症状** 偶发的空白页。

**根因** 原先写成「有渲染在进行就直接返回」。Android 收起地址栏会触发 `resize`，
若此时有渲染在途，新请求会被整个吞掉。

**修法** 改用递增的 `renderToken` 作废先前调用，每个 `await` 后检查 `stale()`。

---

## 文本层残留

**症状** 长按取到的是上一页、或上一个文档里的词。

**根因** 两处：

1. 清空文本层的代码写在渲染流程末尾，一旦中途失败或被取代就执行不到，
   旧文本层便盖在新画布上
2. 打开新文档时 `getDocument` 要花时间，期间旧文本层仍然可点

**修法** 绘制新页**之前**清空；`openFile` 一进来就清空。

---

## OCR 缓存必须连画布宽度一起存

**根因** OCR 词坐标属于识别时那张画布的像素空间。屏幕旋转会以不同尺寸重建画布，
只存词坐标的话，旋转后整层坐标全部错位。

**修法** 缓存 `{ words, canvasWidth }`，换算时用存下来的宽度。

---

## Intl.Segmenter 把所有格算作一个词

**根因** `learner's` 会被整体判为一个 word-like 片段，不剥掉 `'s` 查词典必然落空。
注意 PDF 里的撇号通常是 `’`（U+2019）而非 `'`。

**修法** `normalizeWord` 先剥 `['’]s$`，再去掉首尾非字母字符。

---

## 行尾连字符 vs 行内复合词

`vocabulary under-` 要与次行的 `standing` 拼成 `understanding`；
而 `well-known` 不能拼成 `wellknown`。

判据是**连字符是否位于该段文本的末尾**（`endsLineWithHyphen`）。
PDF.js 的文本层里每行通常是独立的 text item，所以这个判断成立。

---

## 预缓存清单不能从 rollup 的 bundle 对象里拼

**症状** 离线加载全白，控制台报某个 JS 分块 404。

**根因** 构建插件原本挂在 `generateBundle` 上，从 `Object.keys(bundle)` 取文件名。
Vite 8 下 **`index.html` 根本不在 bundle 对象里**，`public/` 下的文件也不在（它们由
Vite 单独拷贝）。于是清单里没有外壳本身，导航请求一离线就落空。

顺带还有第二个后果：版本摘要也漏算了 index.html，改一行 `<meta>` 不会换 cache 名，
用户永远停在旧外壳上。

**修法** 改挂 `closeBundle`，直接遍历写完的 `dist/`——那才是真正要部署的东西。
清单与摘要都从实际产物算出，不存在「以为它在里面」的空间。

**教训** 与文本层那条同源：**清单的来源必须是真实产物，而不是对产物的推断**。

---

## 断网测试杀不掉服务器

**症状** PWA 的离线用例全绿，但其实一次都没断过网。

**根因** 两层：

1. `vite preview` 是用 `npx` 起的，真正监听端口的是它的孙子进程。杀掉 `npx`
   句柄，服务器还活着。
2. 脚本异常退出时那个孙子进程被挂到 init 名下继续运行。下次跑测试，
   `--strictPort` 让位给这个旧进程，`waitForServer` 连上的是它——于是「杀掉服务器」
   杀了个寂寞，页面照常能联网。

**修法** `scripts/e2e-pwa.mjs` 里认端口不认进程树：用 `lsof -ti tcp:<port>` 找出占用者
全部杀掉，启动前先清一遍，杀完再用 `waitForServerGone` 确认端口真的不通了才继续。

**注意** 同理没有采用 CDP 的 `Network.emulateNetworkConditions`：那是对页面 target
生效的，Service Worker 跑在自己的 target 里，未必受同一份限制。服务器进程消失是
任何一方都绕不过去的事实，这才是合格的外部基准。

---

## `takeSharedFile` 撞上暂时性死区

**症状** 从别的应用分享 PDF 过来时白屏（普通启动一切正常）。

**根因** 启动函数写在文件中段，而它同步调用的 `takeSharedFile` 用到的
`SHARE_CACHE` / `SHARE_KEY` 声明在其后。`const` 有暂时性死区，普通启动因为提前
`return` 碰不到，只有走分享路径才会踩中——一条只在少数入口出现的崩溃。

**修法** 启动调用移到文件末尾。

---

## e2e 的残留 Chrome 进程

**症状** 测试结果看似合理，实际是上一次运行的旧页面给出的。

**根因** 脚本异常退出时没有回收 Chrome，残留进程占着调试端口，
下次运行会连上它那份过时的页面。

**修法** `scripts/e2e.mjs` 在 `exit` / `SIGINT` / `SIGTERM` / `uncaughtException`
上都注册了清理。

---

## 扫描版 PDF 没有文本层

严格说不是 bug，而是必须知道的前提：扫描件页面上只有图像，
`getTextContent()` 返回 0 个 item，长按无从命中。

用户报告的「第 13 页之后长按无反应」，实际是整本 100 页**全部**没有文本层——
前 12 页同样无效，只是恰好没试。

诊断方式：

```bash
node -e '...' # 逐页打印 getTextContent().items.length
```

现在这类页面会自动走 OCR，并在识别不出文字时明确提示。

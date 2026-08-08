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
npm run build   # 生产构建到 dist/
```

## 结构

| 文件 | 作用 |
|---|---|
| `src/word.ts` | 从屏幕坐标取出单词，处理跨行连字符与所有格 |
| `src/dict.ts` | 离线词典查询，含词形还原 |
| `src/speech.ts` | Web Speech API 发音 |
| `src/main.ts` | PDF 渲染、长按手势、词卡 UI |
| `scripts/build-dict.mjs` | 从 ECDICT 裁剪生成词典 |
| `scripts/copy-assets.mjs` | 拷贝 PDF.js 的字体/编码资源到 `public/` |

## 取词原理

PDF.js 在 canvas 之上铺一层透明的 `<span>` 文本层，因此取词直接用浏览器的
`caretPositionFromPoint` + `Intl.Segmenter`，无需自己做字符级坐标命中。

两个需要特殊处理的情况：

- **跨行连字符**：`under-` / `standing` 分属两个文本运行，需拼接成 `understanding`；
  而行内的 `well-known` 不能拼接。判断依据是连字符是否位于文本运行末尾。
- **所有格**：`Intl.Segmenter` 把 `learner’s` 整体识别为一个词，查词典前必须剥掉 `’s`。

## 词典

来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）。全量 77 万词条约 63MB，
网页端不现实，因此按「有 BNC/COCA 词频排名，或属柯林斯/牛津核心，或带考试标签」
裁剪至 58226 词，配 43013 条变形映射，gzip 后 3.7MB。

词典预压缩为 `dict.json.gz`，由客户端 `DecompressionStream` 解压，不依赖服务器
是否开启 gzip。生成产物不入库，克隆后需自行执行 `npm run dict`。

极生僻的专业术语和部分英式拼写（如 `memorisation`）不在收词范围内。

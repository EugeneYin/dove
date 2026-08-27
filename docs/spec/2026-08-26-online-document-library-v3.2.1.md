# Dove v3.2.1 在线文档库 Spec

## 版本与范围

- 模式：AllInOne
- 分支：`feat/online-document-library`
- 基线：`master@32ec878` / `3.1.0`
- 目标版本：`3.2.1`

## 用户故事

1. 用户可在文件抽屉的“打开 PDF”和“最近打开”之外进入“在线文档库”。
2. 内置源 `https://github.com/EugeneYin/awesome-english-ebooks` 可逐级浏览；列表只显示目录和 PDF。
3. 用户点击在线 PDF 后可在 Dove 中直接阅读，文档进入既有最近阅读与续读流程。
4. 用户可在设置中粘贴 GitHub 仓库首页或 `tree` 目录链接，保存后跨页面重载继续使用。
5. 用户可把内置源和已添加源导出为 JSON 文件。
6. 匿名 GitHub API 额度耗尽时，用户无需配置 Token 仍可继续浏览公开仓库。

## 验收标准

- `PWA-022`：在线文档库能过滤非 PDF 文件、逐级进入目录并在线打开 PDF。
- `PWA-023`：设置可新增并持久化 GitHub 源，重复或非 GitHub 链接给出明确错误，且可下载导出 JSON。
- `PWA-024`：GitHub Contents API 返回限流错误时自动切到备用文件树，进入后续目录时不重复请求受限接口。
- `DEVICE-011`：桌面、iPhone、iPad 与 Android Pad 模拟视口下，新增抽屉内容可访问且不超出视口。
- `UNIT`：链接解析、存储、Contents API 地址、目录过滤和导出结构有单元测试。

## 关键决策与限制

- 正常情况下使用 GitHub Contents API 按当前目录读取；收到 `403/429` 限流响应时，使用 UNGH 的匿名仓库文件树并在本次页面会话中复用。
- 备用文件树只用于生成目录和 PDF 元数据，PDF 内容仍由 `raw.githubusercontent.com` 下载；备用服务不可用时显示明确错误。
- 无密钥访问公开 GitHub 仓库；私有仓库、GitHub Enterprise 和令牌配置不在本次范围内。
- 支持仓库首页和单段分支名的 `tree/<branch>/<path>` 链接；GitHub 分支名含 `/` 时 URL 无法无歧义拆分，本次不处理。
- 在线 PDF 下载为 `File` 后复用现有 PDF.js、最近阅读和本地配额策略。
- 导出格式为带 `schemaVersion`、`exportedAt` 和源列表的 JSON；导入、重命名和删除源不在本次范围内。

## 验证记录

- `pnpm test`：24/24 通过，含 7 项在线文档源单元测试和限流降级覆盖。
- `pnpm run typecheck` 与 `pnpm run build`：通过。
- `pnpm run e2e:catalog`：PWA 24 项、Device 11 项目录有效。
- `pnpm run e2e:pwa`：2/2 通过；关闭 Preview 后完成离线冷启动、词典、PDF 与 OCR 回归。
- `pnpm run e2e:devices`：4/4 通过，覆盖 PC、iPhone、iPad、Android Pad 的 Playwright 模拟环境。
- 浏览器强制模拟 GitHub Contents API `403` 限流后，真实 UNGH 仓库信息和文件树均返回 HTTP 200；页面可进入 `01_economist/te_2026.08.22`，在线打开 GitHub Raw PDF 并渲染 `1 / 301`。
- 设备矩阵不是物理真机结果；BrowserStack 与远程 Preview 结果由本提交的 GitHub Actions Run 记录。

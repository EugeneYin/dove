# Dove PWA E2E 环境搭建 Playbook

这份文档说明 Dove 的 PWA E2E 环境为什么这样搭、各文件负责什么，以及以后如何新增、运行和回溯测试。

## 1. 目标与验收标准

这套环境解决四件事：

1. 在真实 Chromium、真实 Service Worker、Cache Storage 和 IndexedDB 中运行。
2. 离线验证时真正关闭 HTTP 服务器，避免 Service Worker 仍能访问网络造成假通过。
3. 每个用例有稳定编号，并保存首次进入基线的版本，能从版本和 Git 提交反查测试证据。
4. PR 和主分支提交自动执行；失败时保留 HTML、JUnit、JSON、截图、视频和 Trace。

当前基线是应用 `v2.1.0`，用例目录为 `e2e/test-cases.json`，共有 11 个 PWA 用例。

## 2. 文件和职责

| 文件 | 职责 |
|---|---|
| `playwright.config.ts` | 浏览器、超时、重试、报告器和版本元数据 |
| `e2e/pwa.spec.ts` | PWA 联网准备、关闭服务器、离线冷启动与完整功能回归 |
| `e2e/test-cases.json` | 稳定用例编号、名称、首次进入版本和所保护的行为 |
| `scripts/check-e2e-catalog.mjs` | 阻止“测试已写但未登记”或“目录有用例但实现丢失” |
| `.github/workflows/pwa-e2e.yml` | PR、主分支和手动触发的自动化入口 |
| `scripts/e2e-pwa.mjs` | 迁移前的 CDP 版本，保留为 `e2e:pwa:legacy` 供对照 |

## 3. 本地初始化

项目使用 `pnpm@10.33.0` 和 Node.js 24：

```bash
pnpm install
pnpm exec playwright install chromium
```

Linux CI 需要浏览器系统依赖，因此工作流使用：

```bash
pnpm exec playwright install --with-deps chromium
```

Playwright 浏览器由工具自己管理，不再依赖 `/Applications/Google Chrome.app` 这类本机路径。

## 4. 如何运行

完整 CI 同等检查：

```bash
pnpm run test:ci
```

它依次执行：

```text
单元测试
  → 用例目录一致性检查
  → 类型检查与生产构建
  → Playwright PWA E2E
```

只运行 PWA E2E：

```bash
pnpm run e2e:pwa
```

查看最近一次 HTML 报告：

```bash
pnpm run e2e:pwa:report
```

旧 CDP 脚本仍可用于结果对照：

```bash
pnpm run e2e:pwa:legacy
```

## 5. 测试生命周期

`e2e/pwa.spec.ts` 的一次运行共享同一个浏览器上下文，因为 Cache Storage、Service Worker 和 IndexedDB 状态正是被测对象：

```text
启动 Vite Preview
  → 浏览器安装并激活 Service Worker
  → 等待全部离线资源预缓存
  → 联网写入两本最近文档和第 3 页阅读位置
  → 关闭 Vite HTTP Server 并确认 URL 不可访问
  → 从 Service Worker 缓存冷启动
  → 验证词典、最近文档、续读、取词和 OCR
```

关闭服务器是关键基准。单纯调用浏览器的离线模拟可能只影响页面请求；直接停止源站才能证明页面和 Service Worker 都没有偷偷访问网络。

## 6. 用例如何回溯

三层信息共同形成证据链：

- `e2e/test-cases.json`：记录稳定编号、名称、首次进入版本和防回归目标。
- `playwright.config.ts`：把 `package.json` 版本、Git SHA 和 Git 分支写进报告元数据。
- GitHub Artifact：文件名为 `dove-pwa-e2e-v<版本>-<完整 SHA>`，保留 90 天。

因此从任何失败报告都能回答：运行的是哪个应用版本、哪次提交、哪条用例、失败时的页面状态是什么。

Git 仍是永久历史。需要长期保存某个发布版本的证据时，应在发布提交上打 tag，并从对应 Actions Run 下载 Artifact；如果团队要求超过 90 天留存，可把报告同步到长期对象存储。

## 7. 如何新增用例

先为用例分配下一个稳定编号。例如新增 `PWA-012`：

1. 在 `e2e/test-cases.json` 添加编号、名称、`introducedIn` 和 `protects`。
2. 在 `e2e/pwa.spec.ts` 添加同编号的 `test.step`。
3. 运行目录校验和目标测试。

```bash
pnpm run e2e:catalog
pnpm run e2e:pwa
```

示例：

```ts
await test.step("PWA-012 离线打开分享目标", async () => {
  // 准备状态
  // 执行用户可观察的行为
  // 用独立于实现的结果断言
});
```

目录检查会比较测试源码中的 `PWA-xxx` 与 JSON：任一侧遗漏、重复或多出都会失败，CI 也会阻止合并。

新增测试时继续遵守项目已有原则：基准来自被测对象之外。例如页码恢复既检查 `3 / 3`，也检查 PDF 实际文本是 `gamma`；离线能力通过关闭服务器验证，而不是让网络模拟器自证。

## 8. 报告与排错

每次运行生成：

| 路径 | 内容 |
|---|---|
| `playwright-report/index.html` | 人可读报告、步骤和附件 |
| `test-results/results.json` | 机器可读结果与版本元数据 |
| `test-results/junit.xml` | CI/测试管理平台通用格式 |
| `test-results/artifacts/` | 失败截图、视频、Trace 和错误上下文 |

失败后优先打开 HTML 报告；需要逐事件定位时运行：

```bash
pnpm exec playwright show-trace test-results/artifacts/<用例目录>/trace.zip
```

常见问题：

- Service Worker 未接管：确认测试运行的是生产构建和 `localhost`/HTTPS，而不是普通 Vite dev。
- 离线资源失败：先看 `PWA-001` 的 failure 列表，再核对 `dist/sw.js` 注入的资源清单。
- 点击错词：坐标测试必须保持 `1400 × 1800` 基准视口，并等待目标 PDF 的特征词出现，不能只等任意文本层。
- OCR 超时：检查 Tesseract 核心、语言包是否进入缓存，并查看失败视频和页面错误附件。

## 9. GitHub Actions 工作方式

工作流在以下情况自动执行：

- 任意 Pull Request；
- 推送到 `master` 或 `main`；
- Actions 页面手动触发。

同一分支有更新时会取消旧运行，避免过时提交继续消耗 runner。工作流不需要 Cloudflare Token，也不部署代码，因此来自 fork 的 PR 也能安全执行。

把 `PWA E2E / PWA regression baseline` 设置为分支保护的 Required Check 后，失败提交就不能合并。

## 10. 接入 Cloudflare Preview（可选）

当前测试刻意使用本地 Vite Preview：无 Secret、PR 都能运行，并且可以在测试中关闭源站验证真正离线。若以后还需要验证 Cloudflare 缓存头、路由或 Workers API，可在独立部署 Job 中：

1. 用 Wrangler 部署 `dist/` 到 Pages Preview。
2. 把 `deployment-url` 作为 `BASE_URL` 传给一组只读远程 smoke tests。
3. 保留本地 PWA 离线套件；远端环境无法通过测试安全地“关闭 Cloudflare 源站”，不能替代它。

Cloudflare API Token 只应存放在 GitHub Environment/Actions Secrets 中，绝不能写入仓库或测试报告。

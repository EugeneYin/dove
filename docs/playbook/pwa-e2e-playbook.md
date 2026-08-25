# Dove PWA E2E 搭建与使用 Playbook

这份文档说明 Dove 如何用 GitHub Actions、Cloudflare Pages、Playwright 和 BrowserStack
建立 PC、iPhone、iPad、Android Pad 的可回溯 E2E 能力，以及这套方案能证明什么、不能证明什么。

## 1. 当前结论

截至 2026-08-25，Dove 已建立独立的 `stage` 分支与 `dove-stage` Cloudflare Pages 项目，并完成
固定域名验收。开发期 localhost、Quick Tunnel 和单次 deployment URL 不再作为用户验收链接。

### 2026-08-25 固定 stage 验收

- 应用版本：`2.1.1`
- 分支：`stage`
- Git SHA：`8c01575d742d6f63be3dc2356cb19a41b34381a1`
- GitHub Run：[32806615158](https://github.com/EugeneYin/dove/actions/runs/32806615158)
- 候选 deployment：`https://b5abfb09.dove-e2e.pages.dev`
- 候选稳定别名：`https://e2e-stage.dove-e2e.pages.dev`
- stage deployment：`https://037060fd.dove-stage.pages.dev`
- 固定验收链接：`https://stage.dove.ethanyin.com`

| 层次 | 2026-08-25 结果 |
|---|---|
| 完整离线基线 | `PWA regression baseline` 成功，版本、完整 SHA 与 Artifact 已记录 |
| Cloudflare 候选部署 | 成功，随后在候选 URL 上执行设备模拟 |
| PC / iPhone / iPad / Android Pad 模拟 | Actions 4 / 4 通过；固定验收域名上再次执行 4 / 4 通过 |
| stage promotion | `dove-stage` 部署、DNS 检查、自定义域激活和固定 URL 探针全部成功 |
| 固定域名资源 | 首页、manifest、Service Worker、词典连续三轮共 12 / 12 返回 200 |
| BrowserStack 三类真机 | 本次 stage Run 按策略跳过，不能表述为真机通过 |
| 安装到主屏幕后人工验收 | 尚未执行 |

因此当前可以准确说：**固定 Cloudflare stage 验收链路已经完成并通过，且能回溯到版本、SHA、Run、
候选产物和 stage 产物；BrowserStack 真机与安装到主屏幕后的人工验收仍是独立待办。**

### 2026-08-24 首轮环境验证

验证对象：

- 应用版本：`2.1.0`
- 分支：`feat/v2.1-diagnostics`
- 需求基线：PR #2 的 `3ae47bfe716a0b086e4e94cf3782da1c1d45fd2a`
- E2E 实现提交：`48a4d0bcbf9dc3b67fbc469ff9ddf860ccc4fb64`
- GitHub Run：[32707819495](https://github.com/EugeneYin/dove/actions/runs/32707819495)
- PR 测试 merge ref：`72ae0703d4668fe0752c897645cad9a96c50b34e`
- Cloudflare deployment：`https://e4dc4e60.dove-e2e.pages.dev`
- PR 稳定别名：`https://pr-2.dove-e2e.pages.dev`

| 层次 | 当前状态 | 2026-08-24 结果 |
|---|---|---|
| 单元测试 | 已实现 | 9 / 9 通过 |
| 原有交互 E2E | 已实现 | 13 / 13 通过，含 v2.1 诊断面板 |
| 用例目录一致性 | 已实现 | 12 个 `PWA-xxx` + 6 个 `DEVICE-xxx`，校验通过 |
| 桌面 Chromium 完整离线基线 | 已实现 | 1 个场景、12 个步骤通过 |
| PC / iPhone / iPad / Android Pad 模拟 smoke | 已实现 | 4 / 4 project 通过 |
| Cloudflare Quick Tunnel 技术验证 | 临时验证 | 三个 URL 探针 200，公网四端 smoke 4 / 4 通过；URL 已随进程关闭 |
| Cloudflare Pages Preview | 已启用 | Run 32707819495 创建 `dove-e2e` 并部署；首页、manifest、SW、词典均为 200 |
| BrowserStack 三类真机 | 配置与用例已实现 | 尚未运行：本机没有 BrowserStack 凭据 |
| GitHub Actions | 已验证 | baseline、Pages deploy、device smoke 全部成功；两类 Artifact 已归档 90 天 |

首轮环境结论为：**可回溯的四端公网设备模拟 E2E 环境已经完成并通过；BrowserStack
真机和人工安装测试尚未执行，不能把 4 / 4 设备模拟写成真机通过。**

## 2. 要达到的目标

这套环境把验证拆成三层：

1. 每次 PR/主分支提交都在 GitHub Runner 上执行无需 Secret 的桌面完整离线回归。
2. 构建产物部署到 Cloudflare Pages Preview，以真实公网 HTTPS 地址执行四端浏览器兼容 smoke。
3. 主分支、夜间计划任务或手动触发时，在 BrowserStack 的 iPhone、iPad、Android Pad 真机上
   验证 Safari/Chrome、触控、Service Worker、PDF、词典、诊断面板和断网后重载。

每一层均保存用例目录、HTML/JUnit/JSON 报告和失败证据，并以应用版本与 Git SHA 命名 Artifact。

## 3. 架构和原理

```text
GitHub PR / push / schedule / manual
  ├─ PWA regression baseline
  │    └─ 本地 Vite Preview → Chromium → 预缓存 → 关闭源站 → 离线功能闭环
  ├─ Cloudflare Pages preview
  │    └─ dist/ → 固定项目下的分支 Preview HTTPS URL
  ├─ Device emulation smoke
  │    └─ PC Chromium / iPhone WebKit / iPad WebKit / Android Pad Chromium
  └─ BrowserStack real devices
       └─ iPhone Safari / iPad Safari / Galaxy Tab Chrome → 真机断网 → 离线重载
```

### 为什么保留本地完整离线基线

`e2e/pwa.spec.ts` 会先安装 Service Worker、完整预缓存并写入 IndexedDB，然后直接关闭
Vite HTTP Server，再验证冷启动、词典、最近阅读、续读、OCR、取词和诊断面板。

关闭源站比只调用浏览器的网络模拟更可信：页面和 Service Worker 都无法再访问源站，能避免
“看起来离线，实际仍由网络补资源”的假通过。这个基线无须云端 Secret，fork PR 也能运行。

### Cloudflare Pages 的作用

Cloudflare Pages 提供公开、可追踪的 HTTPS Preview URL。PWA 的 Service Worker 需要安全上下文，
BrowserStack 真机也需要从公网访问应用；Pages 把一次 GitHub Run 的构建产物变成两者共同的测试入口。

Pages 只负责托管，不负责驱动设备，也不能替代本地关闭源站的离线基线。

### 设备模拟的作用

Playwright 的 device descriptor 模拟 viewport、screen、UA、DPR、触控和移动布局，适合快速发现
响应式布局、WebKit/Chromium 差异、文件加载和手势问题。

它不等于真机。Playwright WebKit 也不等于设备上的 Safari；WebKit 模拟 project 中的 Service Worker
步骤会明确记录 limitation，而不是伪造通过。

### BrowserStack 真机的作用

真机任务通过 Playwright WebSocket 直接连接 BrowserStack，不额外引入 BrowserStack SDK。
当前矩阵为：

| Project | 真机 | 系统 | 浏览器 |
|---|---|---|---|
| `browserstack-iphone` | iPhone 16 Pro Max | iOS 18.6 | Safari |
| `browserstack-ipad` | iPad Pro 11 2021 | iPadOS 18.6 | Safari |
| `browserstack-android-pad` | Samsung Galaxy Tab S9 | Android 13 | Chrome |

每台设备先预缓存，然后通过 BrowserStack session/network API 切到 `no-network`，确认公网探针失败，
再重载应用并验证词典、最近文档和离线取词，最后在 `finally` 中切回 `4g-lte-good`。

设备与系统版本属于供应商可用性配置；若 BrowserStack 下架某个组合，应在
`e2e/browserstack-fixture.ts` 中更新，并记录变更日期。

## 4. 文件与职责

| 文件 | 职责 |
|---|---|
| `playwright.config.ts` | 桌面 Chromium 完整离线基线与版本/Git 报告元数据 |
| `e2e/pwa.spec.ts` | 关闭本地源站后的 12 步离线链路 |
| `e2e/test-cases.json` | 稳定的 `PWA-001` 至 `PWA-012` 目录 |
| `playwright.devices.config.ts` | PC、iPhone、iPad、Android Pad 模拟矩阵 |
| `e2e/devices.spec.ts` | 设备模拟入口 |
| `playwright.browserstack.config.ts` | BrowserStack 三个真机 project、报告与超时 |
| `e2e/browserstack-fixture.ts` | 真机能力、连接、关闭和 session 状态上报 |
| `e2e/device-flow.ts` | 模拟与真机共用的 6 步用户链路 |
| `e2e/device-test-cases.json` | 稳定的 `DEVICE-001` 至 `DEVICE-006` 目录 |
| `scripts/check-e2e-catalog.mjs` | 检查两份目录与源码中的 step 编号完全一致 |
| `tsconfig.e2e.json` | 把 Playwright 配置和 E2E 源码纳入类型检查 |
| `.github/workflows/pwa-e2e.yml` | 基线、Pages 部署、设备 smoke、真机任务与证据留存 |

主要组件版本来自 `package.json` 和锁文件。Playwright Test 与本地客户端固定在 `1.62.1`；
根据 2026-08-24 的 BrowserStack 兼容表，远端 iOS 固定为 Playwright `1.61`，Android 固定为
`1.59`，并传入准确的 `client.playwrightVersion` 供 BrowserStack 做协议映射。供应商支持表变化时需同步更新。

## 5. 用例覆盖

### 完整离线基线

`pnpm run e2e:pwa` 覆盖：

- `PWA-001..002`：预缓存完整性与 OCR 核心变体；
- `PWA-003..004`：源站关闭后的冷启动与离线词典；
- `PWA-005..008`：IndexedDB 最近文档、页码和正文恢复；
- `PWA-009..011`：PDF/OCR 文本层、词形还原与离线取词；
- `PWA-012`：离线状态下仍能打开 v2.1 诊断面板并看到版本和运行时信息。

### 设备共用链路

`DEVICE-001..006` 覆盖：

1. HTTPS、安全上下文、manifest 与应用外壳；
2. Service Worker 接管；
3. PDF、词典和非空画布；
4. 桌面双击或触屏长按取词；
5. v2.1 诊断面板；
6. 真机预缓存、切断网络、离线重载、恢复文档和查词。

设备模拟只执行 1–5 的适用部分，第 6 步明确标注为真机限定。

## 6. 本地运行

初始化：

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
```

与 GitHub 基线相同的检查：

```bash
pnpm run test:ci
```

本地四端模拟：

```bash
pnpm run e2e:devices
```

对已经部署的 HTTPS 地址执行四端模拟：

```bash
BASE_URL=https://example.pages.dev pnpm run e2e:devices
```

手工运行 BrowserStack 真机：

```bash
BASE_URL=https://example.pages.dev \
BROWSERSTACK_USERNAME=... \
BROWSERSTACK_ACCESS_KEY=... \
BROWSERSTACK_BUILD_ID=dove-local-v2.1 \
pnpm run e2e:browserstack
```

不要把凭据写进 `.env` 后提交，也不要把完整 WebSocket URL 打进日志，因为 capability 中包含账号凭据。

## 7. GitHub 与云端的一次性启用

### Cloudflare

1. 创建只允许目标 Account 的 Cloudflare Pages Edit API Token。
2. 在 GitHub Actions Secrets 配置：
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
3. 若项目名不是 `dove-e2e`，新增 Repository Variable：
   - `CLOUDFLARE_PAGES_PROJECT`

工作流会在首次部署时创建缺失的 Direct Upload 项目，后续只部署 `dist/`，不会删除项目。
CI 还会运行 `pnpm run dict` 生成被 `.gitignore` 排除的离线词典；缺少这一步时
`/dict.json.gz` 会被 SPA fallback 错误地返回为 `index.html`。

### BrowserStack

在 GitHub Actions Secrets 配置：

- `BROWSERSTACK_USERNAME`
- `BROWSERSTACK_ACCESS_KEY`

建议使用团队专用自动化账号，限制谁能读取或更新 Secrets，并定期轮换 Access Key。

### GitHub

将本次改动推送后：

1. 手动运行一次 `PWA E2E`，保留 `real_devices=true`；
2. 确认四个 job 的结论和 Artifact；
3. 在分支保护中把 `PWA regression baseline` 设为 Required Check；
4. 根据真机额度决定是否保留每日 `03:00 UTC` 的计划任务。

同仓库 PR 可以部署 Preview；fork PR 不会接触 Cloudflare Secrets，因此只运行无 Secret 的本地基线。
真机任务默认只在主分支 push、夜间计划任务和明确选择的手动运行中执行，避免每个 PR 消耗真机分钟数。

## 8. 报告和回溯

| Artifact/路径 | 内容 |
|---|---|
| `dove-pwa-e2e-v<version>-<sha>` | 完整离线基线、目录、HTML/JUnit/JSON、失败 Trace/截图/视频 |
| `dove-device-smoke-<sha>` | 四端模拟报告和设备目录 |
| `dove-browserstack-v2.1-<sha>` | 三台真机报告和设备目录 |
| BrowserStack Automate dashboard | 真机 session、设备、系统、视频和供应商日志 |
| Cloudflare deployment URL | 此次设备测试使用的公开构建 |

GitHub Artifact 保留 90 天，Git tag/commit 是永久索引。发布版本应保留：

- Git SHA 与 tag；
- GitHub Run URL；
- Cloudflare deployment URL；
- BrowserStack build/session URL；
- 两份用例目录快照。

这样才能从某条失败回到当时的代码、产物、设备和用例定义。

### Stage 验收链接

验收版本通过 `stage` 分支发布到独立的 `dove-stage` Pages 项目。`stage-promote` 只在同一提交的
baseline、Cloudflare 候选部署和四端模拟全部成功后执行，并验证以下固定地址：

- `https://stage.dove.ethanyin.com/`
- `https://stage.dove.ethanyin.com/manifest.webmanifest`
- `https://stage.dove.ethanyin.com/sw.js`
- `https://stage.dove.ethanyin.com/dict.json.gz`

交付验收时应提供固定地址、`stage` 完整 Git SHA、应用版本和 GitHub Actions Run。localhost、
Quick Tunnel、单次 deployment URL 或仅在本机打开的报告都不是用户验收链接。

## 9. 局限性

- Playwright 设备模拟不是 iPhone/iPad/Android Pad 真机。
- BrowserStack 自动化验证的是设备浏览器中的 PWA Web 能力，不代表“添加到主屏幕”后的全部系统 UI。
- iOS/iPadOS 添加到主屏幕、standalone 模式、安全区、系统分享/文件打开入口仍需人工真机验收。
- 发音是否真正出声、音色质量、安装横幅、系统权限提示无法可靠由无头断言判断。
- 真机 OCR 性能、GPU/内存上限和弱网续传宜单独做性能/人工测试；当前只断言功能结果。
- Cloudflare 部署成功只证明产物可托管；完整“源站消失”离线能力仍由本地基线证明。
- BrowserStack 设备清单、系统版本、并发数和 network API 能力会随账号套餐或供应商更新而变化。
- 当前真机矩阵串行执行，稳定但耗时；不要在没有额度评估时提高 workers。

相关官方限制和能力说明：

- [Playwright 设备模拟](https://playwright.dev/docs/emulation)
- [Playwright Service Worker](https://playwright.dev/docs/service-workers)
- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Wrangler GitHub Action](https://github.com/cloudflare/wrangler-action)
- [BrowserStack Playwright iOS 真机](https://www.browserstack.com/docs/automate/playwright/playwright-ios/nodejs)
- [BrowserStack Playwright Android 真机](https://www.browserstack.com/docs/automate/playwright/playwright-android/nodejs)
- [BrowserStack 网络条件](https://www.browserstack.com/docs/automate/selenium/simulate-network-conditions)

## 10. 使用注意事项

- 只对生产构建运行 PWA 测试；Vite dev 模式不注册 Service Worker。
- 修改离线资源清单、词典、PDF.js、Tesseract、IndexedDB 或诊断面板时，必须跑 `pnpm run test:ci`。
- 修改布局、手势或移动端兼容代码时，再跑 `pnpm run e2e:devices`。
- 修改 Service Worker、触控、Safari 兼容或系统相关代码时，运行 BrowserStack 真机并补人工安装测试。
- 新增步骤时先分配稳定编号，同时更新 JSON 和源码；`pnpm run e2e:catalog` 会阻止单边遗漏。
- Cloudflare URL 必须等 `manifest.webmanifest` 可访问后再启动设备测试，工作流已有 retry。
- 真实断网步骤必须在 `finally` 恢复网络，避免污染后续 BrowserStack session。
- 不要把 Quick Tunnel 当 CI 环境；其 URL 随进程消失，也没有与 Git SHA 对应的部署记录。
- 本机已有 SSH Tunnel 的 `~/.cloudflared/config.yml` 时，临时 Quick Tunnel 要用
  `cloudflared --config /dev/null tunnel --url http://127.0.0.1:4173`；否则 SSH ingress 的
  catch-all 规则会让临时域名全部返回 404。
- 构建当前仍有 Vite deprecated option 和大 chunk 警告；本次不影响通过，但应在依赖升级任务中处理。

## 11. 云端首轮验收标准

本次 Run 已满足 GitHub Run、Cloudflare 四个资源探针、Device emulation 4 / 4 和两类 Artifact
可回溯。BrowserStack 3 / 3 与三种系统的人工安装验收仍是后续真机阶段的待办。

只有以下条件全部满足，才能把状态从“仓库侧完成”改为“四端真机环境已完备”：

- GitHub 上能看到本次提交对应的 `PWA E2E` Run；
- Cloudflare Preview 的 `/`、`/manifest.webmanifest` 和 `/sw.js` 均返回成功；
- Device emulation smoke 4 / 4 通过；
- BrowserStack iPhone、iPad、Android Pad 3 / 3 通过；
- 三台真机的 `DEVICE-006` 都实际进入 no-network 并离线重载成功；
- 所有 Artifact 可下载，并能从报告反查应用版本和 Git SHA；
- iOS/iPadOS/Android 各至少做一次人工安装到主屏幕后断网启动验收。

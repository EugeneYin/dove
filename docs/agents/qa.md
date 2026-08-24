# Dove QA Agent Runbook

本文件是独立 QA Agent 的工作契约。目标是对指定版本做可回溯回归，给出证据充分的结论，
而不是在没有授权时顺手修改产品代码。

## 0. Agent Teams 角色契约

QA 接收 PMO 分配的验收范围和 RD 交付的稳定分支/SHA，独立设计并执行验证。QA 不直接向用户提问；
需求歧义交给 PM，环境故障交给 OPS，产品缺陷携带证据经 PMO 退回 RD。

团队模式下必须遵守：

- QA 不参与其负责验收部分的产品 Coding；如被授权编写测试，也不能私自改变验收含义；
- 关键验收优先使用与 RD 不同的 Agent 实例和独立上下文，降低同源盲点；
- 测试对象必须固定到分支、完整 SHA、版本和环境；RD 的新提交会使旧结论失效；
- 只报告 `PASS`、`FAIL`、`PARTIAL` 或 `BLOCKED`，并明确未执行项和模拟/真机边界；
- QA 不自行 commit、push、merge、deploy，也不通过修改产品代码顺手修复缺陷。

QA 不绑定具体模型或客户端。模型自评不构成证据，最终结论必须来自可复现测试和可检查附件。

QA 交接除 [team-protocol.md](team-protocol.md) 的共同字段外，还要包含用例/验收编号、首次失败证据、
重试情况、缺陷编号、覆盖限制和发布建议。

## 1. 任务入口

开始前必须确认并记录：

- 测试目标：需求、缺陷、发布候选或完整回归；
- 被测分支、完整 Git SHA、`package.json` 版本；
- 工作区是否有未提交改动；
- 目标环境：本地、Cloudflare Preview、BrowserStack 真机；
- 允许的操作：只测试，还是也允许修测试/修产品。

若用户只要求测试，默认只允许读取代码、运行测试和生成报告；不要修改产品实现、提交、推送、
合并或更改云端配置。发现问题时先报告可复现证据。

## 2. 基线与通过标准

当前版本化基线是 Dove `2.1.0`：

| 层次 | 命令 | 通过标准 |
|---|---|---|
| 单元 + 目录 + 完整离线 | `pnpm run test:ci` | 9 个单元测试、18 个目录项、1 个 12 步 PWA 场景全部通过 |
| 四端模拟 | `pnpm run e2e:devices` | PC、iPhone、iPad、Android Pad 4 个 project 全部通过 |
| Cloudflare 四端模拟 | `BASE_URL=<preview> pnpm run e2e:devices` | Preview 三个探针成功，4 个 project 全部通过 |
| BrowserStack 真机 | `pnpm run e2e:browserstack` | iPhone、iPad、Android Pad 3 个 project 全部通过，且 `DEVICE-006` 真断网重载成功 |

`e2e/test-cases.json` 和 `e2e/device-test-cases.json` 是稳定用例目录。测试源码中的
`PWA-xxx` / `DEVICE-xxx` 必须与目录一一对应；不能删除失败用例、放宽断言或标记 skip 来制造绿灯。

## 3. 标准执行流程

### 3.1 固化测试对象

```bash
git status --short --branch
git rev-parse HEAD
node -p "require('./package.json').version"
git log -1 --format='%cI %s'
```

先阅读本次需求、最近提交、`docs/playbook/testing.md`、
`docs/playbook/pwa-e2e-playbook.md` 和相关代码。
把需求拆成：已有稳定用例、新增自动化候选、只能人工验收的项目。

### 3.2 安装与静态检查

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
pnpm run typecheck
pnpm run e2e:catalog
```

依赖或浏览器安装失败属于环境故障；保留完整错误并交给 Ops Agent，不要把它归类为产品缺陷。

### 3.3 执行本地回归

先运行 `pnpm run test:ci`，再运行 `pnpm run e2e:devices`。测试失败时保留第一次失败现场，
查看 `playwright-report/`、`playwright-device-report/`、`test-results/`，必要时只重跑失败 project。

重跑示例：

```bash
pnpm exec playwright test --config=playwright.devices.config.ts --project=iphone-webkit
pnpm exec playwright show-trace test-results/<case>/trace.zip
```

不得只用重跑后的绿灯覆盖首次失败；报告中要注明是否发生 flaky、重试次数及两次证据。

### 3.4 执行云端与真机回归

先验证测试 URL 是本次 Git SHA 对应的 Cloudflare deployment，不要复用无法回溯的 Quick Tunnel。

```bash
curl --fail --location "$BASE_URL/"
curl --fail --location "$BASE_URL/manifest.webmanifest"
curl --fail --location "$BASE_URL/sw.js"
BASE_URL="$BASE_URL" pnpm run e2e:devices
```

真机凭据只能来自环境变量或 GitHub Secrets：

```bash
BASE_URL="$BASE_URL" \
BROWSERSTACK_BUILD_ID="dove-v2.1-<git-sha>" \
pnpm run e2e:browserstack
```

没有 BrowserStack 凭据或套餐能力时，结论必须写成“真机未执行”，不能把 Playwright device
emulation 写成真机通过。没有 Cloudflare Preview 时，也不能把 localhost 结果写成公网环境通过。

### 3.5 人工真机补充

iOS、iPadOS、Android 各至少一次：安装到主屏幕、断网冷启动、打开最近 PDF、长按取词、
打开诊断面板并复制报告。发音、系统安装 UI、文件分享入口、安全区和真机资源上限只能人工确认。

## 4. 缺陷判定与最小证据

每个失败至少记录：

- `BUG-<日期>-<序号>`；
- 分支、完整 SHA、应用版本、环境与设备；
- 对应需求和用例 ID；
- 前置条件、最短复现步骤、预期、实际；
- 首次失败日志、截图/视频/Trace 或真机 session；
- 可复现次数，例如 `3/3`；
- 初步归类：产品、测试、数据、部署、供应商或待定。

不要仅凭 console 文本下结论。PWA 离线缺陷应同时检查 Service Worker、Cache Storage、IndexedDB、
公网探针和诊断面板；取词/对齐应使用画布或样张中的独立基准。

## 5. 回归报告模板

```markdown
# QA 回归结论

- Result: PASS / FAIL / BLOCKED
- Version: <package version>
- Branch / SHA: <branch> / <full sha>
- Requirements: <本次验证需求>
- Workspace: clean / dirty（列出与被测版本有关的改动）
- Cloudflare URL: <url 或未执行原因>
- GitHub Run: <url 或未执行原因>
- BrowserStack Build: <url/id 或未执行原因>

## Results
| Layer | Passed | Failed | Skipped/Blocked | Evidence |
|---|---:|---:|---:|---|

## Defects
<按 BUG 编号列出>

## Limitations and residual risk
<明确区分模拟、真机与人工未覆盖项>

## Release recommendation
<可以发布 / 不建议发布 / 补齐哪些证据后再决定>
```

只有目标版本的必跑层全部成功、失败证据已关闭、局限已明示，才可给出 PASS。Secret 缺失、云服务
不可用或真机额度不足应给出 BLOCKED 或 PARTIAL，不得降级成 PASS。

## 6. 测试维护规则

- 新需求先分配稳定用例 ID，再同时更新 JSON 目录和 `test.step()`；
- 断言用户可观察结果，基准尽量来自被测实现之外；
- PWA 必须测试生产构建；Vite dev 不注册 Service Worker；
- 完整离线基线必须关闭本地源站，不能只依赖浏览器网络模拟；
- 修改布局/手势时跑四端模拟；修改 SW/Safari/触控时补 BrowserStack 和人工安装；
- 报告必须携带应用版本、Git SHA、分支、用例目录和失败附件；
- 任何测试能力变更都同步更新 `docs/playbook/testing.md` 和
  `docs/playbook/pwa-e2e-playbook.md`。

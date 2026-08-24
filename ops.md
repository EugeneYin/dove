# Dove E2E Ops Agent Runbook

本文件是独立 Ops Agent 的工作契约。目标是维护 GitHub Actions、Cloudflare Pages、Playwright
和 BrowserStack 组成的 E2E 环境，让失败能快速定位、修复可验证、变更可回滚。

## 1. 环境拓扑

```text
GitHub PR / feat push / default-branch push / schedule / manual
  -> PWA regression baseline (no secrets)
  -> build dist/
  -> Cloudflare Pages Direct Upload preview
  -> Playwright PC/iPhone/iPad/Android Pad emulation
  -> BrowserStack iPhone/iPad/Android Pad real devices
```

核心文件：

- `.github/workflows/pwa-e2e.yml`：触发条件、四个 job、Artifact；
- `playwright.config.ts`：桌面完整离线基线；
- `playwright.devices.config.ts`：四端模拟；
- `playwright.browserstack.config.ts`、`e2e/browserstack-fixture.ts`：真机连接；
- `docs/pwa-e2e-playbook.md`：架构、限制和使用手册；
- `qa.md`：测试执行和结论标准。

## 2. 权限与安全边界

- 先做只读诊断，再做最小修复；
- 不打印、复制到日志或提交任何 Token、Access Key、Cloudflare certificate；
- 不读取浏览器 cookie、密码库或无关账户资料；
- Secret 只存 GitHub Actions Secrets，真机凭据只经环境变量传入；
- 未经明确授权，不删除 Pages 项目、deployment、GitHub environment、Artifact 或 BrowserStack build；
- 不用 Quick Tunnel 代替 CI Preview；它随进程消失，无法和 Git SHA 建立稳定证据链；
- 修改工作流后先本地验证 YAML/类型/测试，再推送到功能分支观察首轮 Run。

## 3. 一次性启用

### 3.1 GitHub CLI

确认 SSH 与 API 两条认证链：

```bash
ssh -T git@github.com
gh auth status
```

SSH 成功但 `gh auth status` 失败时，重新授权 API：

```bash
gh auth login --hostname github.com --git-protocol ssh --web --scopes repo,workflow
```

### 3.2 Cloudflare Pages

登录并创建 Direct Upload 项目：

```bash
pnpm dlx wrangler@4 login
pnpm dlx wrangler@4 pages project create dove-e2e --production-branch master
pnpm dlx wrangler@4 pages project list
```

在 Cloudflare 创建最小权限 API Token：仅目标 Account，权限为 Cloudflare Pages Edit。
然后在 GitHub 仓库设置：

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set CLOUDFLARE_API_TOKEN
gh variable set CLOUDFLARE_PAGES_PROJECT --body dove-e2e
```

不要把 SSH Tunnel 的 tunnel credential 或 `cert.pem` 当 Pages API Token；两者用途和权限不同。

### 3.3 BrowserStack

使用 BrowserStack Automate 账号的 Username / Access Key：

```bash
gh secret set BROWSERSTACK_USERNAME
gh secret set BROWSERSTACK_ACCESS_KEY
```

真机矩阵在 `e2e/browserstack-fixture.ts`。供应商下架设备或 Playwright 版本时，只更新被影响的
capability，并在变更说明中记录查询日期、替代设备和旧/新版本。

## 4. 首轮验收

推送 `feat/**` 分支会运行本地基线、Pages Preview 和四端模拟；真机只在默认分支 push、每日计划
任务或手动选择 `real_devices=true` 时运行，避免功能分支消耗真机分钟数。

```bash
git push origin feat/v2.1-diagnostics
gh run list --workflow pwa-e2e.yml --branch feat/v2.1-diagnostics --limit 5
gh run watch <run-id> --exit-status
gh run view <run-id> --log-failed
```

验收清单：

- `PWA regression baseline` 成功；
- `Cloudflare Pages preview` 产生 deployment URL；
- URL 的 `/`、`/manifest.webmanifest`、`/sw.js` 返回 2xx；
- `Device emulation smoke` 4/4 成功；
- 默认分支或手动 Run 的 BrowserStack 3/3 成功，`DEVICE-006` 真断网重载完成；
- 三类 Artifact 可下载，报告里的版本、SHA 与 Run 一致。

## 5. 日常健康检查

```bash
gh run list --workflow pwa-e2e.yml --limit 10
pnpm dlx wrangler@4 pages project list
pnpm dlx wrangler@4 pages deployment list --project-name dove-e2e
curl --fail --location "$BASE_URL/" --output /dev/null
curl --fail --location "$BASE_URL/manifest.webmanifest" --output /dev/null
curl --fail --location "$BASE_URL/sw.js" --output /dev/null
```

每周至少确认：夜间 Run 是否持续成功、Artifact 未异常膨胀、Pages URL 可访问、BrowserStack 配额和
设备矩阵仍可用。每次依赖升级后重新确认 Playwright 客户端与 BrowserStack 远端支持表。

## 6. 故障分流

| 现象 | 首查 | 常见根因 | 修复后验证 |
|---|---|---|---|
| workflow 根本没出现 | trigger、分支、workflow 是否已在远端 | 文件未推送、分支不匹配、Actions 被禁用 | 新 push 后 `gh run list` 可见 |
| install 失败 | lockfile、Node/pnpm/Action 版本 | lock 漂移、registry、Action 主版本过旧 | frozen install + `test:ci` |
| baseline 失败 | HTML/JSON/JUnit/Trace | 产品回归、SW 清单、OCR 超时 | 本地关闭源站用例通过 |
| deploy 被跳过 | GitHub Secrets 名称 | Cloudflare Secret 缺失 | deploy job 产生 URL |
| deploy 401/403 | Token scope、Account ID | Token 过期/账号不匹配 | `wrangler whoami` + 新 Preview |
| Pages 项目不存在 | `pages project list` | 项目名/变量错误 | `dove-e2e` 可列出并部署 |
| Preview 404/旧版本 | deployment URL、branch alias、SHA | 测错 URL、CDN 尚未就绪 | 三个 URL 探针 + 页面版本 |
| WebKit smoke 失败 | 失败附件、limitation 注解 | WebKit 差异、误把模拟 SW 当真机 | 目标 project 重跑 |
| BrowserStack 未运行 | job 条件、Secrets | PR/feat push 被有意跳过、凭据缺失 | 手动/default run 可见 3 sessions |
| BrowserStack 设备创建失败 | capability、配额、并发 | 设备下架、版本不支持、套餐限制 | 替代矩阵 3/3 |
| 真机断网步骤失败 | session id、network API、finally | 套餐不支持、网络未切换、恢复失败 | 探针失败后离线重载成功 |
| 报告/Artifact 缺失 | upload step、路径 | reporter 路径变化、前序提前退出 | `if: always()` 上传成功 |

## 7. 分层排障顺序

1. 固化 Run ID、Git SHA、失败 job/step、首次错误和时间；
2. 判断是代码、GitHub Runner、Cloudflare、BrowserStack 还是账号/额度；
3. 在不改配置时重现一次，区分稳定故障和供应商瞬时故障；
4. 检查对应服务状态页和官方变更说明；
5. 做最小修复，只改一个层次；
6. 本地运行 `pnpm run typecheck && pnpm run e2e:catalog`，相关 E2E 全跑；
7. 功能分支推送，观察真实 GitHub/Cloudflare Run；
8. 记录根因、修复、证据、残余风险和回滚方法。

Secret 过期或泄漏时先在供应商侧轮换，再更新 GitHub Secret，最后撤销旧凭据。日志中若曾出现
凭据，应按已泄漏处理；单纯删除日志不能恢复安全性。

## 8. 变更与回滚

所有环境改动应在独立提交中说明：

- 为什么改；
- 影响哪些 job/device；
- 本地与云端验证结果；
- 新增或变更的 Secret/Variable 名称（不含值）；
- 回滚到哪个 Git SHA；
- 是否影响真机分钟数、Artifact 存储或 Cloudflare 配额。

优先通过 Git revert 回滚工作流提交。不要用强推或删除远端证据掩盖故障。供应商矩阵回滚前先确认
旧设备仍可用，否则保留新矩阵并回滚其他改动。

## 9. Incident 记录模板

```markdown
# E2E Incident
- Started / Detected / Resolved: <UTC timestamps>
- Run / SHA / Version: <links and identifiers>
- Impact: <哪些平台和发布被阻塞>
- Symptom: <首次错误，不含 Secret>
- Layer: GitHub / Cloudflare / BrowserStack / Playwright / Product
- Root cause: <证据支持的根因>
- Mitigation: <临时措施>
- Permanent fix: <提交和配置变更>
- Verification: <命令、Run、deployment、sessions>
- Rollback: <步骤或 SHA>
- Follow-up: <负责人和期限>
```

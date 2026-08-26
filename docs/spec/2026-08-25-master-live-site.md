# Master 固定在线站点

- 日期：2026-08-25
- 模式：AllInOne
- 基线：`master@7e2554b30542c2a825b7fa53089ce31cfa7ef760` / `3.0.0`
- 对外固定地址：`https://master.dove.ethanyin.com`
- Pages 固定地址：`https://dove-master.pages.dev`
- Cloudflare Pages 项目：`dove-master`

## 目标

为 `master` 提供 7×24 小时可访问的固定 HTTPS 地址。每次 `master` push 都先运行现有完整 PWA
基线、Cloudflare Preview 和 PC/iPhone/iPad/Android Pad 四端模拟；全部通过后，才把同一 SHA 的构建
提升到独立的 `dove-master` Pages 项目。

## 范围与非目标

- 增加 `master-promote`，不改变 `stage-promote`、Preview 和 BrowserStack 的既有触发策略。
- 使用 Pages 项目的固定生产域名；日常部署 Token 继续只需要 Pages Edit。
- “最新 master”指最近一次通过门禁并成功发布的 `master` SHA。失败的提交不会覆盖当前在线版本。
- 本次不修改应用功能、版本号、stage 内容或真机测试矩阵。

## 验收标准

1. `master` push 的 baseline、Preview、四端模拟成功后，`master-promote` 自动执行。
2. `dove-master` 生产分支为 `master`，部署内容来自该次 GitHub Actions 的 `github.sha`。
3. Pages 固定地址的 `/`、`/manifest.webmanifest`、`/sw.js`、`/dict.json.gz` 均为 2xx。
4. 上述四个资源与本次不可变 deployment URL 的响应体逐一相同。
5. 对外固定地址的上述四个资源均为 2xx，并与本次不可变 deployment URL 的响应体逐一相同；该项属于
   每次 `master-promote` 的发布门禁。
6. 每日计划任务检查对外固定地址与 Pages 固定地址的四个资源仍然逐字节一致。
7. Actions Summary 记录应用版本、完整 SHA、候选 deployment、master deployment、Pages 固定地址和
   对外固定地址。
8. 新的 `master` push 若门禁失败，`master-promote` 不运行，固定站点保留上一版。

## 初始化与回滚

- 在 Cloudflare Pages 创建 `dove-master`，生产分支设置为 `master`。
- 对外固定地址 `master.dove.ethanyin.com` 已绑定到 `dove-master`，并使用指向
  `dove-master.pages.dev` 的 Proxied CNAME；绑定与 DNS 仍是一次性配置，日常发布只做只读验收。
- 代码回滚使用 Git revert；站点内容需要紧急回退时，在 `master` revert 后由同一门禁重新发布。
- 不删除旧 deployment，保留 Cloudflare 与 GitHub Actions 的 SHA 证据链。

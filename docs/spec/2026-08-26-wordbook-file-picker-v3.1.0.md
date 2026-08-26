# Dove v3.1.0 单词本文件与词卡操作 Spec

## 版本与范围

- 模式：AllInOne
- 分支：`feature/wordbook-file-picker`
- 基线：`origin/master@704aa9aa011f4cf8244fa6b5ddaefb81751150da` / `3.0.0`
- 目标版本：`3.1.0`
- 范围：为现有单词本增加用户指定的 JSON 文件，并在查词弹窗增加添加与删除入口

## 用户故事

1. 首次进入单词本时，用户可选择或创建 `dove-wordbook.json`；支持的浏览器默认从 Documents 开始选择。
2. 浏览器不能直接写文件时，单词本改为下载到系统默认下载目录。
3. 用户双击或长按单词后，可在播放按钮旁用“＋”把词条加入单词本。
4. 已加入的单词显示“📒”；点击后必须确认，确认后才从单词本删除。

## 非目标

- 不新增账号、云同步、跨设备冲突合并或自定义文件格式。
- 不改变 PDF、OCR、词典、在线例句或现有单词本管理页的其他交互。
- 本轮不包含提交、推送、远程 Preview、部署或物理真机验收。

## 验收标准

| ID | 验收点 | 自动化证据 |
|---|---|---|
| PWA-019 | 首次选择文件时建议 `dove-wordbook.json` 与 Documents，并写入当前词条 | `e2e/pwa.spec.ts` |
| PWA-020 | “＋/📒”状态、文件写入与删除确认 | `e2e/pwa.spec.ts` |
| DEVICE-010 | 桌面双击及触屏长按的词卡按钮可见且不溢出 | `e2e/device-flow.ts` |
| UNIT | JSON 严格解析、序列化、忽略大小写查找与删除 | `src/wordbook.test.ts` |

## 关键决策与限制

- `localStorage["dove.wordbook.v1"]` 保留为离线缓存；用户选择的 JSON 文件是可见持久化副本。
- File System Access API 可用时，文件句柄存入独立 IndexedDB；已授权时冷启动可直接恢复文件。
- WebKit 等不支持直接写文件的浏览器每次变更会下载新的 `dove-wordbook.json`，由系统决定实际 Downloads 位置。
- Playwright 可以验证选择器参数与文件写入，但模拟句柄不能证明各操作系统的真实授权恢复；物理设备结果必须另行验证。

## 本地验证记录

- `pnpm test`：17/17 通过。
- `pnpm run e2e:catalog`：PWA 20 项、Device 10 项目录有效。
- `pnpm run e2e:pwa`：1/1 完整离线链路通过，包含 PWA-019、PWA-020 与服务器关闭后的冷启动/OCR 回归。
- `pnpm run e2e:devices`：4/4 通过，覆盖 PC、iPhone、iPad、Android Pad 的 Playwright 模拟环境。
- 首轮设备矩阵的 iPad 在既有 DEVICE-007 抽屉切换处波动失败；单项重跑及最终全矩阵均通过。
- 未运行 BrowserStack 物理真机，也未创建远程 Preview 或固定验收 URL。

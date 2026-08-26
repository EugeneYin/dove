# Dove v3.2.2 选择已有单词本文件 Spec

## 版本与范围

- 模式：AllInOne
- 分支：`feat/online-document-library`
- 基线：`2ebc858` / `3.2.1`
- 目标版本：`3.2.2`
- 范围：修复单词本首次指定文件时只能打开 Save 窗口、不能选择已有 JSON 文件的问题

## 用户故事

1. 用户可明确选择已有的 Dove 单词本 JSON 文件，并加载其中的词条。
2. 用户也可明确创建一个新的 `dove-wordbook.json` 文件。
3. 选择已有文件后，后续修改继续写回同一个文件。

## 验收标准

- `PWA-025`：点击“选择已有文件”调用 Open Picker，不调用 Save Picker；读取现有词条并取得写回能力。
- `PWA-020`：点击“创建新文件”继续调用 Save Picker，并建议从 Documents 创建 `dove-wordbook.json`。
- `DEVICE-012`：支持文件系统访问时两个入口在 PC、iPhone、iPad 与 Android Pad 模拟视口中可见且不溢出。

## 关键决策与限制

- 浏览器没有能同时表达 Open 与 Save 的单个系统窗口，因此界面提供“选择已有文件”和“创建新文件”两个明确操作。
- 已有文件使用 `showOpenFilePicker()`，新文件使用 `showSaveFilePicker()`；两者都只允许单个 JSON 文件并默认从 Documents 开始。
- 选择已有文件后立即读取并写回规范化 JSON，以确认后续保存所需的写权限。
- 不支持 File System Access API 的浏览器维持下载新文件的降级方式，不能直接写回用户已有文件。

## 验证记录

- `pnpm test`：24/24 通过。
- `pnpm run typecheck`：通过；`pnpm run build`：通过（由离线 PWA 回归构建阶段覆盖）。
- `pnpm run e2e:catalog`：通过，PWA 25 条、设备 12 条。
- `pnpm run e2e:pwa`：3/3 通过；包含选择已有文件、创建新文件及关闭 Preview 后的真实断网冷启动回归。
- `pnpm run e2e:devices`：4/4 通过（PC、iPhone、iPad、Android Pad 均为 Playwright 模拟视口）。
- BrowserStack 物理真机：未执行；自动化通过模拟 Picker 句柄验证 Open/Save 分流，未覆盖原生系统文件窗口的人工交互。

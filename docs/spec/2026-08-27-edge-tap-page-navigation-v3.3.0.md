# Dove v3.3.0 页面边缘点击翻页 Spec

## 版本与范围

- 模式：AllInOne
- 分支：`feat/edge-tap-page-navigation`
- 基线：线上 `master@7a0b468ab9fac9befa17a30b9270b40d909ecb45` / `3.2.2`
- 目标版本：`3.3.0`

## 用户故事

1. PC 用户可用鼠标点击 PDF 页面左侧或右侧，分别进入上一页或下一页。
2. 手机与 Pad 用户可触碰同一位置完成翻页，不需要精确点击顶栏按钮。
3. 用户双击、长按或拖动选择正文单词时，不会同时触发翻页。

## 验收标准

- 左侧热区进入上一页，右侧热区进入下一页；第一页和最后一页保持既有边界行为。
- 每侧热区为页面宽度的 18%，并限制在 48–120px；页面宽度 30% 处不属于热区。
- 指针移动超过既有 10px 容差、按住达到长按时长、命中文字、已有文本选区或已打开词卡时，本次点击不翻页。
- `PWA-026` 覆盖 PC 鼠标边缘点击、内侧非热区、双击取词和已有文本选区。
- `DEVICE-013` 覆盖 PC、iPhone、iPad 与 Android Pad 的鼠标或触屏路径。

## 非目标与限制

- 不新增左右滑动手势、翻页动画、可配置热区或可见的页面遮罩。
- 保留顶栏按钮和键盘左右方向键，不改变 PDF 缩放、OCR 或选词词卡行为。
- Playwright 手机与 Pad 项目属于设备模拟；物理真机验收需在后续 Preview/BrowserStack 阶段单独记录。

## 验证记录

- `pnpm install --frozen-lockfile` 与 `pnpm run dict`：通过。
- 新增实现前，`PWA-026` 按预期失败在右侧点击仍停留 `1 / 3`；实现后通过。
- `pnpm run test:ci`：通过；24 项单元测试、26 项 E2E 目录校验、3 项 Chromium PWA 测试全部成功。
- `pnpm run e2e:devices`：4/4 通过，覆盖 PC Chromium、iPhone WebKit、iPad WebKit 与 Android Pad Chromium 模拟环境。
- `git diff --check`：通过。
- 本轮未执行 BrowserStack 物理真机、Cloudflare Preview、push、PR、合并或线上发布。

# Dove Agent 工作模式

本目录定义 Dove 项目的 Agent 工作契约。它解决三个问题：何时由一个 Agent 完成，何时组建
Agent Teams，各角色如何协作，以及不同模型能力如何路由。用户指令、系统约束和根目录
`AGENTS.md` 的优先级始终高于本目录。

## 1. 两种模式

### AllInOne（默认）

目标清晰、改动聚焦、风险可控、无需独立并行工作流时，由一个 Agent 按 PMO、PM、RD、QA、OPS
的必要步骤顺序完成。它可以自检，但不能把自检描述成“独立 QA”。详见 [all-in-one.md](all-in-one.md)。

### Agent Teams（必须确认）

出现多个可独立推进的工作流、跨代码/测试/环境的复杂变更、较高风险或明确的独立验收要求时，
PMO 可以提出组队建议，但在用户明确确认前不得创建或启动任何子 Agent。用户在当前请求中明确写出
“使用 Agent Teams”可视为确认；否则 PMO 必须展示团队、分工、文件所有权、风险和 Spec 路径并等待答复。

确认后的共同协议见 [team-protocol.md](team-protocol.md)。

## 2. 角色

| 角色 | 主要产出 | 文件 |
|---|---|---|
| PMO | 用户沟通、启动门禁、计划、分工、集成和最终结论 | [pmo.md](pmo.md) |
| PM | 需求澄清、范围、优先级、用户故事和验收标准 | [pm.md](pm.md) |
| RD | 技术设计、Coding、调试、单元测试和实现交接 | [rd.md](rd.md) |
| QA | 独立测试设计、回归证据和质量结论 | [qa.md](qa.md) |
| OPS | CI/CD、环境、部署、监控和回滚 | [ops.md](ops.md) |

PM、QA、OPS 都是按需角色。明确的缺陷修复可以只启用 PMO + RD + QA；纯环境故障可以只启用
PMO + OPS。多个 RD 可以并行，但必须有互斥的文件或模块所有权。

## 3. 模型能力路由

角色契约不绑定供应商。选择模型时按能力画像路由，并在任务记录中写明实际模型与推理等级：

| 能力画像 | 推荐任务 | 当前可用的代表能力 |
|---|---|---|
| 前沿 Coding 与工具执行 | RD、复杂调试、多文件实现、终端验证 | GPT-5.6 Sol `high` |
| 稳健判断与反复验证 | QA、OPS、代码审查、风险检查、长步骤执行 | Claude Opus 5 |
| 超长任务与复杂综合推理 | 大型 PM/PMO 规划、长上下文分析、复杂 Spec 或仓库级任务 | Claude Fable 5 |

这只是默认路由，不是权限授予，也不是质量结论。模型不可用时使用当前环境中能力最接近的模型；
关键 QA 宜与 RD 使用不同的 Agent 实例，条件允许时也使用不同模型，以降低同源盲点。Fable 的安全
分类器或供应商回退属于能力/环境限制，PMO 应如实记录，不能尝试绕过。

能力说明核对日期为 2026-08-24：

- [OpenAI GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [Anthropic Claude Opus 5](https://www.anthropic.com/news/claude-opus-5)
- [Anthropic Claude Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)

型号、可用性和工具支持会变化；应更新本节，而不是把易变型号散落到每个角色的硬规则里。

## 4. 不变规则

- 用户只与 PMO 交互；其他 Agent 把问题和结果交给 PMO。
- Agent Teams 启动必须经过用户确认，不能用“任务复杂”代替授权。
- 一个文件同一时间只有一个写入负责人；共享工作区不得覆盖他人改动。
- PM 负责需求内容，PMO 负责协作流程，RD 负责实现，QA 负责独立结论，OPS 负责环境。
- 子 Agent 不自行提交、推送、合并、发布或修改生产；外部变更仍需符合用户授权范围。
- 模型能力不能扩大权限。无论模型多强，都必须保留证据、说明限制并遵守安全边界。

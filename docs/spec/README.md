# 迭代 Spec

本目录用于保存每次迭代的需求与技术 Spec。每份 Spec 应独立成文，并至少记录目标、范围、
验收标准、关键决策和关联版本或 Git 提交，保证后续实现、测试与回溯使用同一份事实来源。

建议文件名使用 `YYYY-MM-DD-主题.md`，例如 `2026-08-24-offline-search.md`。

Agent Teams 模式必须指定一份 Spec 作为事实基线。章节所有权遵循
[`docs/agents/team-protocol.md`](../agents/team-protocol.md)：PM 维护需求和验收，PMO 维护计划与决策，
RD 补充技术设计，QA 补充测试证据，OPS 补充部署与回滚。需求变化必须记录用户确认和日期。

仅在 Agent Teams 模式下，PMO 还必须创建同目录、同主文件名的通信账本，例如：

```text
2026-08-24-offline-search.md
2026-08-24-offline-search.team-log.md
```

Team Log 由 PMO 唯一写入，记录 Message ID、消息类型、发送方/接收方、Spec Revision、状态、ACK、阻塞、
证据引用和用户决策闭环。运行时消息负责通知，Team Log 负责持久化；只有完成登记和 ACK 的可执行消息
才生效。消息记录只能追加，不能覆盖或删除；更正使用新 Message ID 并引用原消息。PMO 可以更新任务状态
表，但必须保留对应消息链。AllInOne 不创建 Team Log。

最小 Team Log 模板：

```markdown
# <Task ID> Team Log

- Spec: <path>
- Spec Revision: <revision>
- PMO:
- Started at: <ISO 8601 timestamp>

## Task state

| Task | Owner | Assigned scope | Dependencies | Status | Last message |
|---|---|---|---|---|---|

## Messages (append-only)

### <Message ID>
- Type:
- From / To:
- Created at:
- Spec / Revision:
- Related task / previous message:
- Assigned scope or payload:
- Evidence references:
- User evaluation required: yes / no
- ACK required: yes / no
- Reply by / checkpoint:
- Status:

## User decisions

<只记录决定、日期、影响、对应 Message ID 和更新后的 Spec Revision>
```

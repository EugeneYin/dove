# Agent Teams 协作协议

本协议只在用户确认启动 Agent Teams 后生效。未确认时继续使用 AllInOne。

## 1. 启动门禁

PMO 在创建任何子 Agent 前提交：

```markdown
## Agent Teams 启动提案

- 启动原因：
- 计划角色和 Agent 数量：
- 每个 Agent 的目标与交付物：
- 文件或模块所有权：
- 并行关系与依赖：
- Spec 路径：
- Team Log 路径：
- 通信通道与回执能力：
- 外部操作与风险：
- 预计成本或耗时变化：

请确认是否启动 Agent Teams。
```

未收到明确确认，不得先启动“仅用于调研”的 Agent。确认内容若只覆盖部分角色，PMO 只能启动被确认的范围。
运行环境若不能提供 Agent 间消息、持久记录或确认回执能力，不得启动 Agent Teams；PMO 应改用 AllInOne
或向用户提出可行的替代载体并等待确认。

## 2. 建立事实基线

PMO 在 `docs/spec/` 创建或指定本次 Spec，并记录需求版本、`Spec Revision`、分支、Git SHA、工作区状态、
团队名单和验收标准。各角色只引用这份基线；发生歧义时不得各自猜测。

Agent Teams 还必须有与 Spec 同目录、同主文件名的 Team Log。例如 Spec 是
`docs/spec/2026-08-24-offline-search.md`，通信账本就是
`docs/spec/2026-08-24-offline-search.team-log.md`。Spec 是需求、设计和验收的事实基线；Team Log 是任务、
消息、回执、阻塞和用户决策的通信基线。Team Log 由 PMO 唯一写入，其他角色通过标准消息提交内容，
避免多个 Agent 同时修改同一文件。

Spec 内容所有权：

- PM：背景、目标、非目标、用户故事、业务规则、优先级、验收标准；
- PMO：团队计划、任务状态、所有权、决策记录和用户确认；
- RD：技术设计、接口和迁移说明；
- QA：测试计划、覆盖矩阵、证据和质量结论；
- OPS：环境影响、部署、监控和回滚。

## 3. 分工与共享工作区

- 每项任务只有一个直接负责人和一个明确输出。
- 多个 RD 必须按模块或文件划分互斥写入范围；公共文件由 PMO 指定唯一负责人。
- Agent 开始前先检查工作区；发现非本人改动时保留并通知 PMO。
- Agent 不做任务外重构，不清理别人的临时文件，不用 reset/checkout 覆盖共享改动。
- 依赖前序产出的任务保持等待；真正独立的任务才并行。

### 3.1 角色拦截器（强制）

每个角色在执行会产生写入、结论、外部影响或职责承诺的动作前，必须依次检查：

1. 该动作是否属于本角色职责；
2. 是否在 PMO 分配的任务、文件/模块所有权和用户授权内；
3. 是否保持已确认的范围、验收标准、产品取舍、外部状态和风险边界不变；
4. 是否不需要由另一角色独立完成或复核。

任一项答案为“否”“不确定”或涉及其他角色时，拦截器必须触发：立即停止该动作，不先做一部分、不以
“顺手修复”或“临时验证”为由越权；只允许保留不改变状态的必要证据，然后按下列格式交给 PMO：

```markdown
- Intercepted action:
- Why out of scope or uncertain:
- Evidence collected (read-only):
- Recommended owner:
- User evaluation required: yes / no
- Decision needed and impact:
```

PMO 可以在用户已确认的团队和范围内重新分配普通任务。只要事项涉及需求或验收变化、新权限、未授权的
外部写操作、生产影响、高风险操作、显著成本/时间变化，或多个方案会改变产品结果，就必须标记
`User evaluation required: yes`，由 PMO 提交用户评估；在用户明确答复并更新 Spec 前，所有角色保持
该事项阻塞。子 Agent 不得绕过 PMO 直接询问用户，也不得把沉默视为同意。

## 4. Agent Teams 通信协议

本节只在用户已经确认 Agent Teams 后生效。AllInOne 不创建 Team Log，也不使用 Agent 间消息协议。

### 4.1 沟通路径

```text
用户 ⇄ PMO
        ├── PM ──需求基线──┐
        ├── RD ──实现──────┼── QA
        ├── RD-2 ─实现─────┤
        └── OPS ─环境──────┘
```

PMO 是控制消息的中心路由。其他 Agent 可以直接交换只读事实或证据，但必须同时抄送 PMO；未经 PMO
登记和确认，直接消息不能创建任务、改变范围/所有权/状态，也不能作为下游 Agent 开始工作的依据。
范围变化、冲突裁决和用户问题必须回到 PMO。子 Agent 不直接要求用户做决定，PMO 应合并重复问题、
说明选项与影响后，明确请求用户评估。

### 4.2 通信载体

- **运行时消息通道**：传递任务通知、事实、交接、阻塞和回执，负责低延迟，不作为唯一事实来源；
- **Team Log**：持久记录所有可执行消息及状态，是上下文中断、Agent 重启和争议处理时的通信依据；
- **Spec**：保存已确认的需求、设计、验收和决策结果，不记录过程聊天；
- **共享工作区与证据附件**：保存 diff、测试报告、日志、Trace、Run 和部署 URL；消息只引用路径或链接。

Git commit、终端输出、聊天历史或某个 Agent 的内部记忆都不能单独替代 Team Log。任何 Agent 启动、
恢复或接手任务时，必须先读取最新 Spec、Spec Revision、Team Log 和自己被分配的文件所有权。
Team Log 不可读、不可写或与 Spec Revision 无法对应时，所有依赖团队通信的动作立即进入 `blocked`。

### 4.3 消息类型与格式

只使用以下消息类型：

- `TASK`：PMO 分配或变更任务；
- `FACT`：不改变范围的只读事实或证据；
- `HANDOFF`：角色提交结果并建议下一负责人；
- `BLOCKER`：在现有授权内无法继续；
- `DECISION_REQUEST`：必须由用户评估的选项与影响；
- `ACK`：确认目标消息已经登记、接收和校验，不表示结果已通过验收；ACK 本身不再要求 ACK。

每条消息必须使用同一信封：

```markdown
- Message ID: <task-id>-<sender>-<sequence>
- Type: TASK / FACT / HANDOFF / BLOCKER / DECISION_REQUEST / ACK
- From / To:
- Created at: <ISO 8601 timestamp>
- Spec / Revision:
- Related task / previous message:
- Assigned scope or payload:
- Evidence references:
- User evaluation required: yes / no
- ACK required: yes / no
- Reply by / checkpoint:
- Status: sent / acknowledged / resolved / blocked
```

`Message ID` 在一次 Team 任务内唯一；重试必须复用原 ID，接收方不得重复执行同一 ID。`ACK` 使用自己
的 Message ID，并通过 `Related task / previous message` 指向被确认的消息。内容发生变化时必须创建新
ID，并指向被替代消息。禁止在运行时消息、Team Log、Spec 或证据索引中写入 Token、密码、Cookie 或
完整连接凭据。

### 4.4 送达、回执和恢复

1. PMO 先把 `TASK` 写入 Team Log，再通过运行时通道通知接收角色。
2. 接收角色核对 Message ID、Spec Revision、范围和所有权；一致后返回指向该 `TASK` 的 `ACK`，PMO
   登记 ACK 并更新消息状态；不一致则返回 `BLOCKER`。ACK 只有写入 Team Log 后才生效。
3. 角色只有在 `TASK` 和自己的 ACK 都已登记后才能开始产生写入或结论。
4. 子 Agent 发送 `HANDOFF`、`BLOCKER` 或 `DECISION_REQUEST` 后，PMO 必须先写入 Team Log，再创建、
   登记并返回指向原 Message ID 的 `ACK`。收到该 ACK 前，发送方不得假定消息已送达或触发后续工作。
5. 到 `Reply by / checkpoint` 仍未在 Team Log 看到 ACK 时，原消息发送方使用相同 Message ID 重发一次；
   接收角色发送的 ACK 尚未登记时，也使用同一 ACK Message ID 重发一次。再次到期仍未登记，则停止依赖
   动作并将任务保持为 `blocked`。不得创建新 ID 绕过未确认消息，也不得重复执行。
6. Agent 上下文中断或更换实例后，以 Spec 和 Team Log 恢复；聊天历史与 Team Log 不一致时，以已登记的
   最新 Spec Revision 和消息状态为准，并向 PMO 报告差异。

`completed` 只表示负责人已完成其任务；只有 `HANDOFF` 已登记并 ACK、证据可访问、下游责任人明确时，
该角色的交接才完成。一个消息 ACK、某个 Agent 完成或文件已写入，都不能单独表示整体完成。

### 4.5 用户评估闭环

需要用户评估时，子 Agent 发送 `DECISION_REQUEST` 或带同一标记的 `BLOCKER`，不得直接询问用户。PMO
登记消息，合并重复问题，向用户提供选项、影响和建议。用户答复后，PMO 必须：

1. 把原始决定、日期和影响写入 Spec 决策记录；
2. 提升 `Spec Revision`；
3. 在 Team Log 将请求标记为 `resolved`；
4. 用新的 `TASK` Message ID 重新分配或恢复工作。

用户未答复、答复不明确或 Spec 尚未更新时，相关任务保持 `blocked`，其他角色不得根据推测继续。

## 5. 标准交接

每次交接都必须作为 `HANDOFF` 消息发送，并在消息信封的 payload 中包含：

```markdown
- Role / Task:
- Input branch / SHA:
- Assigned scope:
- Changed files:
- Result:
- Verification and evidence:
- Risks and limitations:
- Blockers or open questions:
- Recommended next owner/action:
```

Team Log 只记录证据路径或链接，不复制大段日志、报告正文或二进制附件。

## 6. 工作流

1. PM 澄清需求并由 PMO 获得用户确认，形成 Spec 基线。
2. RD 完成 Coding、自检和实现交接。
3. QA 基于同一 SHA 独立验证；产品缺陷经 PMO 退回 RD，环境故障经 PMO 转给 OPS。
4. OPS 只在环境或发布进入范围时执行，先诊断、再最小修改、最后验证回滚能力。
5. PMO 解决集成冲突，核对工作区、测试证据、外部状态和未完成项。
6. PMO 向用户交付统一结论；子 Agent 的“完成”不等于整体完成。

需求变化必须走 `PM → PMO → 用户确认 → Spec 更新 → 重新分工`。不得让 RD 在 Coding 时自行决定
产品范围，也不得让 QA 通过放宽标准吸收需求变化。

## 7. 状态和阻塞

任务状态统一为 `pending`、`in_progress`、`completed`、`blocked`。Agent 应先穷尽其授权范围内的
只读检查和安全替代方案，再报告阻塞。需要新权限、外部账号、产品取舍或扩大范围时立即交给 PMO。

## 8. Git 与外部操作

- PMO 统一决定最终提交边界，并在获得相应授权后执行 push、merge 或发布。
- 子 Agent 默认不提交和推送；如 PMO 明确分配独立提交，仍不得自行推送或合并。
- 删除、强推、生产变更、Secret 轮换等高影响操作必须逐项确认目标和授权。
- 最终报告写明分支、SHA、工作区状态、测试结果、部署链接、未执行项和残余风险。

## 9. 完成标准

只有需求验收项有证据、RD 交接完成、QA 给出独立结论、相关环境经 OPS 验证、Spec 与 Git 状态可回溯，
PMO 才能宣布完成。模型自评、编译成功或某个子 Agent 的完成消息都不能单独替代验收。

---
"@node-agent-runtime/types": minor
"@node-agent-runtime/memory": minor
"@node-agent-runtime/core": minor
---

M7-5 底座部分：Agent 配方编译与快照。新增 `compileAgent(input, options?)`，把「工具重名 / 参数 schema 非法 / MCP 引用不可达」三类缺陷从运行时提前到**编译期一次性报错**（`AgentCompileError.issues` 汇总全部问题，非 fail-fast）；产物 `CompiledAgent` 含 `toolsHash` / `instructionsHash`，确定性故可缓存；`agentSnapshotOf(compiled)` 产出可直接写入 checkpoint 的配方快照。`Agent` 增可选 `mcpTools?`（结构化 `{ server, tool }`），经注入的 `resolveMcp` 解析后与本地工具同一命名空间参与重名检测 —— 依赖方向为 `mcp → core`，故刻意采用结构化参数而非 import `McpToolRef`，避免成环。新增纯函数 `validateSchema(schema)`（`types`）：校验 schema **自身**（未知 `type`、`required` 引用未定义属性、`minimum > maximum` 等，带字段路径），与既有 `validate(value, schema)` 的值校验互补 —— schema 写错在运行时不报错，只表现为模型一直调错参数。配方指纹拆两级：`toolsHash` 为硬校验（工具集变化即 transcript 无法复现），新增 `instructionsHash` 为软校验（语义漂移，可 `allowInstructionChange: true` 显式放行）；`AgentSnapshot` 增**可选** `instructionsHash?`，旧快照无此字段时退回既有校验，零破坏。`compileAgent()` **不是**授权检查 —— 编译通过的工具仍须逐次过 M3 审批与沙箱。全部 additive，无需 major。

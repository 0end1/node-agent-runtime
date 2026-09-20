---
"@node-agent-runtime/types": minor
"@node-agent-runtime/core": minor
"@node-agent-runtime/provider-openai": minor
"@node-agent-runtime/acp": minor
---

M8-4 流式 —— 给底座补齐「模型边想边说」，**全部 additive、默认行为与 M8-4 之前逐字一致**：

- **`types`**：新增 `MessageDeltaEvent`（`message:delta`，含 `runId` / `step` / `delta` / `index` / 可选 `traceId`）；`ModelProvider` 增**可选** `chatStream(request, onDelta)` —— 未实现即「不支持流式」，既有 provider 零改动。
- **`core`**：需 `RunOptions.stream` / `AgentRuntimeOptions.stream` 显式开启（**默认 false**）才走流式，`chatStream` 的调用收口在 `callModel` 单一处。
- **`provider-openai`**：新增 SSE 解析（跨 chunk 半帧重组、工具调用参数按 `index` 累积、`[DONE]` 终止）。
- **`acp`**：`AcpAgentOptions.stream`（**默认 true** —— ACP 客户端本就把回复当流渲染）把增量推为 `agent_message_chunk`；已流式流过的消息在 `model:response` 时**不再整段补发**（否则客户端看到两遍文本）。

三条关键取舍：**回退只在「还没吐出任何增量之前」发生**（已出块再失败直接抛给 run 的错误路径 —— 服务端已接收并计费，重跑会重复扣费，且消费者会先收到半截增量再收到一整段重复文本）；**流式是体验增强不是能力前提**（provider 未实现则静默走非流式，不是错误）；**脱敏逐块进行**，故跨块边界的敏感串不被识别，完整文本的安全保证仍由整段脱敏的 `model:response` 承担。

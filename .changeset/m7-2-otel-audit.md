---
"@node-agent-runtime/types": minor
"@node-agent-runtime/core": minor
"@node-agent-runtime/host": minor
---

M7-2 可观测与合规导出（收尾：OTEL + 审计导出）。`StepStartEvent` / `ToolStartEvent` / `ToolEndEvent` 增可选 `at?`（epoch ms，由 runtime 在发射点补齐），补上此前「仅 run 级有时间戳」的缺口；`core` 新增 `toOtelSpans` 纯函数，产出 OTLP-JSON span 形状（确定性 id、`run→step→tool` 父子关系、单调 `startTimeUnixNano` / `endTimeUnixNano`），**只产形状、不绑定 OTLP 传输**，不新增包、零第三方运行时依赖；`host` 新增 `serializeAudit` / `exportAudit`（CSV RFC 4180 + JSON 稳定键序），固定列序仅含 `argumentsFingerprint`（不含工具参数原文），每条记录先过 `redact` 再落盘。全部 additive，无需 major。

---
"@node-agent-runtime/types": minor
"@node-agent-runtime/core": minor
---

M7-2 可观测与合规导出（横切面先行）：traceId 贯穿。19 个事件接口统一增可选 `traceId?`，`run:start` 增 `startedAt`、`run:end` 增 `endedAt`（epoch ms）；`RunOptions` 增可选 `traceId?`（缺省 `newId("trace")`，宿主可注入以对齐外部链路），`RunResult` 增 `traceId` 以回显。traceId 的注入点收口在 `emit()`（与 `redact()` 同处），且以 run 内闭包传递而非实例字段，故同一 runtime 上并发的 run 互不串扰。`Logger` 增可选 `child?(ctx: LogContext): Logger` 使日志行可携带 trace/run 上下文，`ConsoleLogger` 已实现——未绑定上下文时输出格式与改动前逐字一致，既有解析脚本不受影响。全部为 additive，无需 major。

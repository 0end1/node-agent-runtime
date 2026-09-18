# @node-agent-runtime/acp

Expose the runtime as an **[Agent Client Protocol](https://agentclientprotocol.com) v1** agent over stdio, so any ACP client (Zed, JetBrains, DeepChat …) can drive it without a bespoke UI.

> Status: **M8-2 + M8-3**. Turn flow, permission bridging and mode negotiation are implemented.
> Spec notes: [`docs/acp-spec-review.md`](../../docs/acp-spec-review.md) · Plan: [`docs/development-checklist.md`](../../docs/development-checklist.md) §3.4

## Usage

```ts
import { Agent } from "@node-agent-runtime/core";
import { AcpAgent } from "@node-agent-runtime/acp";
import { builtinTools } from "@node-agent-runtime/tools-basic";
import { provider } from "./your-provider.js"; // any ModelProvider

await new AcpAgent({
  provider,
  agents: [new Agent({ name: "assistant", tools: builtinTools })],
  defaultAgentId: "assistant",
}).start(); // reads stdin, writes stdout
```

Point the client at the process (`node ./agent.mjs`) and it speaks ACP. **stdout carries ACP messages only** — diagnostics go to stderr, per the transport rules.

## Method mapping

| ACP method | Runtime |
|---|---|
| `initialize` | protocol version + capabilities (no auth) |
| `session/new` | `SessionManager.createSession`; `cwd` becomes the sandbox workspace root |
| `session/prompt` | `SessionManager.chat` + EventBus → `session/update` |
| `session/cancel` | `AbortSignal` → `cancelled` stop reason |
| `session/load` | replays the persisted transcript (`loadSession: true`) |
| `session/close` | abort + `closeSession` |
| `session/request_permission` | agent → client; a pending `PermissionManager` decision becomes a dialog |
| `session/set_mode` | `SandboxMode` (legacy surface, still served) |
| `session/set_config_option` | same modes, preferred surface (`configId: "mode"`) |

Which recipe a session binds to: `params._meta.agentId`, else `defaultAgentId`, else the first registered agent.

## Event mapping

| Runtime event | `session/update` |
|---|---|
| `model:response` (text) | `agent_message_chunk` |
| `tool:start` | `tool_call` (`pending`, kind inferred) |
| `tool:end` | `tool_call_update` (`completed` / `failed`) |
| `usage:update`, `run:end` | `usage_update` (`used` / `size` / `cost`) |
| mode switch | `current_mode_update` |

Stop reasons: `end_turn`, `max_turn_requests` (step cap), `cancelled`.

## Design notes

- **One runtime + event bus per session.** The runtime bus is process-wide, so a shared bus would interleave concurrent turns. Per-session buses also keep sandbox scope and pending approvals isolated.
- **Cancellation is never an error.** Both `RunAbortedError` and the `AbortError` that provider SDKs raise are caught and answered as `cancelled` — clients otherwise render a cancellation as a failure.
- **Title safety.** Tool titles append path-like arguments only; arbitrary argument values are never echoed into the client UI.
- **Approval is a real bridge, and it degrades.** `AcpPermissionBridge` keeps `ask` verdicts and turns each pending decision into a `session/request_permission` carrying the *real* `toolCallId` (the client is already rendering that call as `pending`) and redacted arguments. `allow_always` is persisted as a grant; a client that answers `-32601` is remembered, and later decisions are denied immediately instead of stalling for the 60s approval timeout.
- **Modes change the boundary, not just the label.** `session/new` returns `modes` *and* `configOptions` from one table, so both surfaces agree. Switching writes through to `SessionManager.setSandboxMode()`, which `sandbox.begin()` re-reads at the start of every run — so the change lands on the **next** turn rather than moving the sandbox under a tool that was already authorized.

## Known limits (M8-3)

- **One chunk per message.** Streaming is a MAY in the spec, not a MUST, so a step's full text is sent as a single `agent_message_chunk`. Token-level chunking arrives with M8-4.
- `reject_always` is remembered for the session only — `PermissionManager` persists grants, not a reject list, so a restart asks again rather than silently reusing a forgotten refusal.
- `usage_update.size` reports live context occupancy; the runtime has no fixed window to advertise.
- Prompts accept `text` (and `resource` when sent); image/audio are not advertised.

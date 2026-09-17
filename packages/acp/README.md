# @node-agent-runtime/acp

Expose the runtime as an **[Agent Client Protocol](https://agentclientprotocol.com) v1** agent over stdio, so any ACP client (Zed, JetBrains, DeepChat …) can drive it without a bespoke UI.

> Status: **M8-2**. Core turn flow is implemented; permission bridging is M8-3.
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

Which recipe a session binds to: `params._meta.agentId`, else `defaultAgentId`, else the first registered agent.

## Event mapping

| Runtime event | `session/update` |
|---|---|
| `model:response` (text) | `agent_message_chunk` |
| `tool:start` | `tool_call` (`pending`, kind inferred) |
| `tool:end` | `tool_call_update` (`completed` / `failed`) |
| `usage:update`, `run:end` | `usage_update` (`used` / `size` / `cost`) |

Stop reasons: `end_turn`, `max_turn_requests` (step cap), `cancelled`.

## Design notes

- **One runtime + event bus per session.** The runtime bus is process-wide, so a shared bus would interleave concurrent turns. Per-session buses also keep sandbox scope and pending approvals isolated.
- **Cancellation is never an error.** Both `RunAbortedError` and the `AbortError` that provider SDKs raise are caught and answered as `cancelled` — clients otherwise render a cancellation as a failure.
- **Title safety.** Tool titles append path-like arguments only; arbitrary argument values are never echoed into the client UI.

## Known limits (M8-2)

- **No approval channel.** `ask` verdicts degrade to `deny` (`NoAskPolicy`) so a turn never stalls waiting for a UI that isn't wired. M8-3 replaces this with `session/request_permission`.
- **One chunk per message.** Streaming is a MAY in the spec, not a MUST, so a step's full text is sent as a single `agent_message_chunk`. Token-level chunking arrives with M8-4.
- `usage_update.size` reports live context occupancy; the runtime has no fixed window to advertise.
- Prompts accept `text` (and `resource` when sent); image/audio are not advertised.

import type { RuntimeEvent } from "@node-agent-runtime/core";
import type { RunUsage } from "@node-agent-runtime/types";
import { classifyToolName } from "@node-agent-runtime/sandbox";
import type { SessionUpdate, ToolKind } from "./protocol.js";

/**
 * Translate the runtime's EventBus stream into ACP `session/update` payloads.
 *
 * The runtime publishes a rich lifecycle stream (docs/architecture.md §7); ACP
 * clients expect a narrower vocabulary. This module is the whole mapping and is
 * deliberately a pure function so it can be unit-tested without a connection.
 *
 * M8-2 covers: message chunks, tool calls, usage. M8-3 adds plan/current mode.
 */

/** Runtime `ToolKind` (sensitivity class) + name heuristics → ACP display kind. */
export function mapToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  // Name heuristics run *before* the sensitivity class: they are more specific.
  // `search_code` is metered as a network-read by the runtime, yet ACP models
  // "search" as a kind of its own, and the UI icon should follow that.
  if (/search|find|grep|query|lookup/.test(name)) return "search";
  if (/delete|remove|unlink/.test(name)) return "delete";
  if (/move|rename/.test(name)) return "move";
  if (/think|plan|reason/.test(name)) return "think";

  switch (classifyToolName(toolName)) {
    case "network-read":
      return "fetch";
    case "write":
      return "edit";
    case "exec":
      return "execute";
    case "credential":
      return "other";
    default:
      break;
  }

  if (/read|list|show|cat|open|get/.test(name)) return "read";
  return "other";
}

/**
 * A short human-readable title for a tool call (ACP shows it in the UI).
 *
 * Only path-like arguments are appended: a title is rendered verbatim in the
 * client, so echoing arbitrary argument values would leak whatever the model
 * put in them (tokens, secrets, file contents).
 */
export function toolTitle(toolName: string, args: Record<string, unknown>): string {
  for (const key of ["path", "file", "filePath", "target", "url", "command"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.length > 60 ? `${toolName} ${value.slice(0, 57)}…` : `${toolName} ${value}`;
    }
  }
  return toolName;
}

/**
 * `usage_update` requires both `used` and `size` to be non-null token counts.
 * The runtime meters `used` precisely; it has no notion of a fixed window, so
 * `size` reports the live context occupancy (post-compaction) when known.
 */
export function usageUpdate(usage: RunUsage, contextUsed?: number): SessionUpdate {
  const used = usage.inputTokens + usage.outputTokens;
  const size = contextUsed !== undefined && contextUsed > used ? contextUsed : used;
  return {
    sessionUpdate: "usage_update",
    used,
    size,
    ...(usage.costUsd !== undefined
      ? { cost: { amount: usage.costUsd, currency: "USD" } }
      : {}),
  };
}

/** One runtime event → zero or more ACP updates. */
export function translateEvent(event: RuntimeEvent): SessionUpdate[] {
  switch (event.type) {
    case "model:response": {
      const text = event.message.content ?? "";
      if (!text.trim()) return [];
      return [
        {
          sessionUpdate: "agent_message_chunk",
          // Chunks sharing a messageId belong to one message; per-step ids keep
          // intermediate turns (text followed by tool calls) visually separate.
          messageId: `${event.runId}:${event.step}`,
          content: { type: "text", text },
        },
      ];
    }
    case "tool:start": {
      const { toolCall } = event;
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId: toolCall.id,
          title: toolTitle(toolCall.name, toolCall.arguments ?? {}),
          kind: mapToolKind(toolCall.name),
          status: "pending",
          rawInput: toolCall.arguments ?? {},
        },
      ];
    }
    case "tool:end": {
      const { toolCall, result, ok } = event;
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.id,
          status: ok ? "completed" : "failed",
          content: [{ type: "content", content: { type: "text", text: result } }],
        },
      ];
    }
    case "usage:update":
      return [usageUpdate(event.usage, event.contextUsed)];
    case "run:end":
      return [usageUpdate(event.usage)];
    default:
      // session/task/checkpoint/permission events have no ACP counterpart yet.
      return [];
  }
}

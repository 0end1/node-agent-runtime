/**
 * A minimal ACP agent process — the thing a client actually spawns.
 *
 * Used by `test/stdio.test.ts` to exercise the real stdio path (subprocess,
 * pipes, newline framing) instead of the in-memory transport pair.
 */
import { Agent, defineTool } from "@node-agent-runtime/core";
import { MockProvider } from "@node-agent-runtime/mock";
import { AcpAgent } from "../../src/agent.js";

const echo = defineTool({
  name: "echo",
  description: "Echo a string back.",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute(args: { text: string }) {
    return args.text;
  },
});

const agent = new AcpAgent({
  provider: new MockProvider({ now: () => new Date() }),
  agents: [new Agent({ name: "assistant", tools: [echo] })],
  defaultAgentId: "assistant",
  // Diagnostics are dropped entirely: stdout is reserved for ACP messages.
  logger: () => {},
});

void agent.start();

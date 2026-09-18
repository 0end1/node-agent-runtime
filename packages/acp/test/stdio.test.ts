import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import {
  LineDecoder,
  encodeMessage,
  isResponse,
  parseMessage,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from "../src/jsonrpc.js";
import type {
  InitializeResult,
  NewSessionResult,
  PromptResult,
  SessionUpdateParams,
} from "../src/protocol.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = resolve(here, "fixtures/stdio-agent.ts");
const tsxBin = resolve(here, "../../../node_modules/.bin/tsx");

/** A hand-rolled client: exactly what an ACP host does over stdio. */
class StdioClient {
  private readonly decoder = new LineDecoder();
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly updates: SessionUpdateParams[] = [];
  /** stdout lines that were not valid JSON-RPC — anything here is a protocol leak. */
  readonly badLines: string[] = [];
  private id = 0;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  start(): void {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      for (const line of this.decoder.push(chunk)) this.ingest(line);
    });
  }

  private ingest(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = parseMessage(line);
    } catch {
      this.badLines.push(line);
      return;
    }
    if (isResponse(message)) {
      const response = message as JsonRpcResponse;
      const id = Number(response.id);
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      if ("error" in response) waiter.reject(new Error(JSON.stringify(response.error)));
      else waiter.resolve(response.result);
      return;
    }
    if ("method" in message && message.method === "session/update") {
      this.updates.push((message as { params: SessionUpdateParams }).params);
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.id;
    const promise = this.waitFor(id, method);
    this.child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
    return promise;
  }

  /** Same request, but delivered in two writes — proves the decoder re-frames. */
  requestSplit(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.id;
    const promise = this.waitFor(id, method);
    const frame = encodeMessage({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    const half = Math.floor(frame.length / 2);
    this.child.stdin.write(frame.slice(0, half));
    setTimeout(() => this.child.stdin.write(frame.slice(half)), 20);
    return promise;
  }

  private waitFor(id: number, method: string): Promise<unknown> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`timeout waiting for ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      });
    });
  }
}

describe("AcpAgent — real stdio subprocess", () => {
  let child: ChildProcessWithoutNullStreams;
  let client: StdioClient;

  before(() => {
    child = spawn(tsxBin, [fixture], { stdio: ["pipe", "pipe", "pipe"] });
    client = new StdioClient(child);
    client.start();
  });

  after(() => {
    child.kill();
  });

  it("completes a full ACP session across process boundaries", async () => {
    const init = (await client.request("initialize", { protocolVersion: 1 })) as InitializeResult;
    assert.equal(init.protocolVersion, 1);

    const created = (await client.request("session/new", {
      cwd: mkdtempSync(resolve(tmpdir(), "acp-")),
    })) as NewSessionResult;
    assert.ok(created.sessionId.startsWith("session_"));

    const prompt = (await client.request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })) as PromptResult;
    assert.equal(prompt.stopReason, "end_turn");

    const kinds = client.updates.map((entry) => entry.update.sessionUpdate);
    assert.ok(kinds.includes("agent_message_chunk"), `expected a message chunk, got: ${kinds.join()}`);
    // stdout carries ACP messages only — no logs smuggled into the stream.
    assert.deepEqual(client.badLines, []);
  });

  it("re-assembles a request split across two writes", async () => {
    const created = (await client.requestSplit("session/new", {
      cwd: mkdtempSync(resolve(tmpdir(), "acp-")),
    })) as NewSessionResult;
    assert.ok(created.sessionId.startsWith("session_"));
    // If framing were broken, the second half would surface as a bad line
    // (or the request would never be answered and the call would time out).
    assert.deepEqual(client.badLines, []);
  });
});

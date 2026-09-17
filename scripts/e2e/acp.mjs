#!/usr/bin/env node
/**
 * 跨形态 E2E · ACP 形态（M8-2 / M8-3 真机前验证）
 *
 *   npm run e2e -- --only=acp
 *
 * 真机（Zed / DeepChat 等 GUI Client）联调只能人工做，但「能不能自动验证的
 * 那部分」必须自动：这里 spawn 一个**真实 agent 子进程**，用一个协议级
 * 客户端（自己解帧、自己应答审批请求）走完
 *
 *   握手 → 建会话 → 带审批的对话 → 回放 → 切模式 → 只读下拒绝 → 取消 → 关闭
 *
 * 全程经过真实 stdio 管道。与 `packages/acp/test/stdio.test.ts` 的分工：
 * 那个只验帧（能否重组），这里验**语义**（模式是否真的改变策略、取消是否
 * 回 `cancelled`、审批参数是否脱敏）。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

import {
  MODE_CONFIG_ID,
  LineDecoder,
  encodeMessage,
  isRequest,
  isResponse,
  parseMessage,
} from "@node-agent-runtime/acp";

import { REPO_ROOT, createReporter, makeWorkdir, removeDir } from "./lib.mjs";

const FIXTURE = join(REPO_ROOT, "packages", "acp", "test", "fixtures", "stdio-agent-governed.ts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const METHOD_NOT_FOUND = -32601;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 一个协议级 ACP 客户端：与真实 Client 做同样的事 —— 解帧、应答、发通知。 */
class AcpClient {
  #decoder = new LineDecoder();
  #pending = new Map();
  #requests = new Map();
  #id = 0;

  /** 收到的 session/update 通知。 */
  updates = [];
  /** stdout 上不是合法 JSON-RPC 的行 —— 非空即协议泄漏。 */
  badLines = [];

  constructor(child) {
    this.child = child;
  }

  start() {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      for (const line of this.#decoder.push(chunk)) this.#ingest(line);
    });
  }

  /** 注册一个「agent → client」请求的处理函数（如 session/request_permission）。 */
  onRequest(method, handler) {
    this.#requests.set(method, handler);
  }

  request(method, params) {
    const id = ++this.#id;
    const promise = this.#wait(id, method);
    this.#write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    return promise;
  }

  notify(method, params) {
    this.#write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  #write(message) {
    this.child.stdin.write(encodeMessage(message));
  }

  #ingest(line) {
    let message;
    try {
      message = parseMessage(line);
    } catch {
      this.badLines.push(line);
      return;
    }
    if (isResponse(message)) {
      const waiter = this.#pending.get(Number(message.id));
      if (!waiter) return;
      this.#pending.delete(Number(message.id));
      if ("error" in message) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
      return;
    }
    if (isRequest(message)) {
      void this.#answer(message);
      return;
    }
    if (message.method === "session/update") this.updates.push(message.params);
  }

  async #answer(request) {
    const handler = this.#requests.get(request.method);
    if (!handler) {
      this.#write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: METHOD_NOT_FOUND, message: `Method not found: ${request.method}` },
      });
      return;
    }
    try {
      const result = (await handler(request.params)) ?? null;
      this.#write({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      this.#write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: error?.code ?? -32603, message: error?.message ?? String(error) },
      });
    }
  }

  #wait(id, method) {
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectPromise(new Error(`timeout waiting for ${method}`));
      }, 30_000);
      this.#pending.set(id, {
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

/** 客户端看到的某个 tool call 的最终状态。 */
function statusOf(updates, toolCallId) {
  const patches = updates
    .map((entry) => entry.update)
    .filter((update) => update.sessionUpdate === "tool_call_update")
    .filter((update) => update.toolCallId === toolCallId);
  return patches.at(-1)?.status;
}

export async function runAcp() {
  const workdir = makeWorkdir("node-agent-runtime-e2e-acp-");
  const child = spawn(TSX, [FIXTURE], { stdio: ["pipe", "pipe", "pipe"], cwd: workdir });
  const client = new AcpClient(child);
  client.start();
  const report = createReporter("acp");

  /** 客户端收到的每一次审批请求（含参数快照）。 */
  const approvals = [];
  client.onRequest("session/request_permission", (params) => {
    approvals.push(params);
    const allow = params.options.find((option) => option.kind === "allow_once");
    return { outcome: { outcome: "selected", optionId: allow.optionId } };
  });

  let sessionId;

  try {
    await report.step("initialize 握手（protocolVersion=1）", async () => {
      const init = await client.request("initialize", { protocolVersion: 1 });
      assert.equal(init.protocolVersion, 1);
      assert.equal(init.agentCapabilities.loadSession, true);
    });

    await report.step("session/new：modes 与 configOptions 同值发布", async () => {
      const created = await client.request("session/new", { cwd: workdir });
      sessionId = created.sessionId;
      assert.match(sessionId, /^session_/);
      assert.equal(created.modes.currentModeId, "workspace-write");
      assert.equal(created.configOptions[0].id, MODE_CONFIG_ID);
      // 两个选择面必须恒一致，否则只读旧面的客户端会看到过期值。
      assert.equal(created.configOptions[0].currentValue, created.modes.currentModeId);
      assert.equal(created.configOptions[0].options.length, created.modes.availableModes.length);
    });

    await report.step("session/prompt：工具 pending → 客户端批准 → completed", async () => {
      const result = await client.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "写点东西" }],
      });
      assert.equal(result.stopReason, "end_turn");
      assert.equal(approvals.length, 1, "应恰好问一次审批");

      const request = approvals[0];
      assert.equal(request.sessionId, sessionId);
      assert.equal(request.toolCall.status, "pending");
      // 审批 UI 拿到的是真实 toolCallId（客户端此刻已在渲染这次调用）。
      assert.ok(request.toolCall.toolCallId);
      // P3.2：密钥形参数不得出现在审批请求里。
      assert.equal(request.toolCall.rawInput.apiKey, "***REDACTED***");
      assert.equal(statusOf(client.updates, request.toolCall.toolCallId), "completed");
    });

    await report.step("session/load：回放持久化 transcript", async () => {
      const before = client.updates.length;
      await client.request("session/load", { sessionId, cwd: workdir });
      const kinds = client.updates.slice(before).map((entry) => entry.update.sessionUpdate);
      assert.ok(kinds.includes("user_message_chunk"), `期望回放用户消息，实际：${kinds.join()}`);
      assert.ok(kinds.includes("agent_message_chunk"), `期望回放助手消息，实际：${kinds.join()}`);
    });

    await report.step("session/set_config_option 切到 read-only（回 current_mode_update）", async () => {
      const before = client.updates.length;
      const result = await client.request("session/set_config_option", {
        sessionId,
        configId: MODE_CONFIG_ID,
        value: "read-only",
      });
      assert.equal(result.configOptions[0].currentValue, "read-only");
      const mirrored = client.updates
        .slice(before)
        .map((entry) => entry.update)
        .filter((update) => update.sessionUpdate === "current_mode_update");
      assert.equal(mirrored.at(-1)?.modeId, "read-only", "只认 modes 面的客户端也要同步");
    });

    await report.step("read-only：写工具被策略直接拒绝，不再弹审批", async () => {
      const before = client.updates.length;
      const result = await client.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "再写一次" }],
      });
      assert.equal(result.stopReason, "end_turn");
      assert.equal(approvals.length, 1, "read-only 下不该再问用户");

      const patches = client.updates
        .slice(before)
        .map((entry) => entry.update)
        .filter((update) => update.sessionUpdate === "tool_call_update");
      assert.ok(patches.length > 0, "工具应被调用并被拒绝");
      assert.equal(patches.at(-1).status, "failed");
    });

    await report.step("session/cancel：飞行中的轮次回 cancelled（不是 error）", async () => {
      const created = await client.request("session/new", { cwd: workdir });
      const inflight = client.request("session/prompt", {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "写点东西" }],
      });
      await sleep(80);
      client.notify("session/cancel", { sessionId: created.sessionId });
      const result = await inflight;
      assert.equal(result.stopReason, "cancelled");
    });

    await report.step("session/close：关闭后该会话不再可用", async () => {
      await client.request("session/close", { sessionId });
      const error = await client
        .request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: "还能聊吗" }],
        })
        .then(() => null, (err) => err);
      assert.ok(error, "已关闭的会话应被拒绝");
    });

    await report.step("stdout 只承载 ACP 消息（日志走 stderr）", () => {
      assert.deepEqual(client.badLines, []);
    });
  } finally {
    child.kill();
    removeDir(workdir);
  }

  return report.steps;
}

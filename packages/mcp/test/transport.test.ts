import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  McpConnectionError,
  StdioTransport,
  StreamableHttpTransport,
  validateMcpServerUrl,
} from "@agent-runtime/mcp";

describe("validateMcpServerUrl (P3.6 / SSRF)", () => {
  it("accepts http/https URLs", () => {
    assert.equal(validateMcpServerUrl("https://example.com/mcp").protocol, "https:");
    assert.equal(validateMcpServerUrl("http://127.0.0.1:8080/mcp").protocol, "http:");
  });

  it("rejects non-http(s) schemes", () => {
    assert.throws(() => validateMcpServerUrl("ftp://evil/mcp"), McpConnectionError);
    assert.throws(() => validateMcpServerUrl("file:///etc/passwd"), McpConnectionError);
  });

  it("enforces the allowlist when provided", () => {
    assert.throws(
      () => validateMcpServerUrl("https://evil.com/mcp", ["https://allowed.com"]),
      McpConnectionError,
    );
    assert.equal(
      validateMcpServerUrl("https://allowed.com/mcp", ["https://allowed.com"]).host,
      "allowed.com",
    );
    assert.equal(
      validateMcpServerUrl("https://allowed.com/x", ["https://allowed.com/"]).host,
      "allowed.com",
    );
  });
});

describe("StreamableHttpTransport SSRF guard", () => {
  it("throws on a blocked URL at construction", () => {
    assert.throws(() => new StreamableHttpTransport({ url: "ftp://evil/mcp" }), McpConnectionError);
  });
});

describe("StdioTransport start timeout (P3.6)", () => {
  it("rejects when the server never becomes ready", async () => {
    const t = new StdioTransport({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"], // emits nothing, stays alive
      startTimeoutMs: 60,
      logger: () => {},
    });
    await assert.rejects(() => t.start(), McpConnectionError);
  });

  it("resolves once the server emits output", async () => {
    const t = new StdioTransport({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ready')"],
      startTimeoutMs: 1000,
      logger: () => {},
    });
    await t.start();
    await t.close();
  });
});

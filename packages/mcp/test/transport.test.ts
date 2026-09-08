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

describe("StreamableHttpTransport redirect guard (P3.6 / SSRF)", () => {
  /** A fetch stub that answers the first call with `redirectTo`, then the envelope. */
  function redirectingFetch(redirectTo: string, status = 302) {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(null, { status, headers: { location: redirectTo } });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("refuses to follow a redirect into the private network", async () => {
    const { impl, calls } = redirectingFetch("http://169.254.169.254/latest/meta-data/");
    const t = new StreamableHttpTransport({
      url: "https://allowed.example/mcp",
      urlAllowlist: ["https://allowed.example"],
      fetchImpl: impl,
    });

    await assert.rejects(
      () => t.post({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      McpConnectionError,
    );
    // The guarded request must never actually hit the metadata address.
    assert.equal(calls.length, 1);
    assert.ok(!calls.some((u) => u.includes("169.254.169.254")));
  });

  it("follows a redirect that stays inside the allowlist", async () => {
    const { impl, calls } = redirectingFetch("https://allowed.example/v2/mcp", 307);
    const t = new StreamableHttpTransport({
      url: "https://allowed.example/mcp",
      urlAllowlist: ["https://allowed.example"],
      fetchImpl: impl,
    });

    const res = (await t.post({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
      result: unknown;
    };
    assert.deepEqual(res.result, { ok: true });
    assert.equal(calls.length, 2);
  });
});

describe("StdioTransport env isolation (P3.6)", () => {
  const PROBE =
    "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:process.env.AGENT_TEST_HOST_SECRET ?? 'absent'}))";

  async function probeEnv(options: {
    env?: NodeJS.ProcessEnv;
    inheritEnv?: boolean;
  }): Promise<unknown> {
    const t = new StdioTransport({
      command: process.execPath,
      args: ["-e", PROBE],
      logger: () => {},
      ...options,
    });
    await t.start();
    const res = (await t.post({ jsonrpc: "2.0", id: 1, method: "probe" })) as {
      result: unknown;
    };
    await t.close();
    return res.result;
  }

  it("does not leak the host environment by default", async () => {
    process.env.AGENT_TEST_HOST_SECRET = "leak-me";
    try {
      assert.equal(await probeEnv({}), "absent");
    } finally {
      delete process.env.AGENT_TEST_HOST_SECRET;
    }
  });

  it("forwards explicitly injected env and can opt into inheritance", async () => {
    process.env.AGENT_TEST_HOST_SECRET = "leak-me";
    try {
      assert.equal(await probeEnv({ env: { AGENT_TEST_HOST_SECRET: "injected" } }), "injected");
      assert.equal(await probeEnv({ inheritEnv: true }), "leak-me");
    } finally {
      delete process.env.AGENT_TEST_HOST_SECRET;
    }
  });
});

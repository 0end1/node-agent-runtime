/**
 * McpClient — reference `McpServerHandle` implementation (docs §5.3, M4).
 *
 * Talks JSON-RPC 2.0 to one MCP server over any `McpTransport`. After
 * `connect()` performs the `initialize` handshake + `notifications/initialized`,
 * the server's tools are enumerated through `listTools()` and invoked via
 * `callTool()` — always by their *remote* name; local prefixing happens later
 * in the registry.
 */

import {
  McpConnectionError,
  McpError,
  makeNotification,
  makeRequest,
  nextRequestId,
  responseError,
  type JsonRpcResponse,
  type JsonRpcResponseErr,
} from "./jsonrpc.js";
import {
  MCP_PROTOCOL_VERSION,
  type McpCallToolResult,
  type McpClientOptions,
  type McpInitializeResult,
  type McpReadResourceResult,
  type McpResourceMeta,
  type McpServerCapabilities,
  type McpServerHandle,
  type McpServerInfo,
  type McpToolMeta,
} from "./types.js";

const CLIENT_INFO = { name: "node-agent-runtime-mcp", version: "0.4.0" };

export class McpClient implements McpServerHandle {
  readonly name: string;
  private readonly transport: import("./transport.js").McpTransport;
  private readonly logger?: (line: string) => void;
  private connected = false;
  private closed = false;
  private serverInfoValue?: McpServerInfo;
  private protocolVersion?: string;
  private capabilitiesValue?: McpServerCapabilities;

  constructor(options: McpClientOptions) {
    if (!options.name?.trim()) throw new Error("McpClient 需要一个非空 name");
    this.name = options.name.trim();
    this.transport = options.transport;
    this.logger = options.logger;
  }

  get serverInfo(): McpServerInfo | undefined {
    return this.serverInfoValue;
  }

  /** Negotiated protocol revision (available after `connect()`). */
  get negotiatedProtocolVersion(): string | undefined {
    return this.protocolVersion;
  }

  /** Capabilities the server advertised in `initialize` (M7-6b). */
  get capabilities(): McpServerCapabilities | undefined {
    return this.capabilitiesValue;
  }

  /**
   * M7-6b: whether the server advertised the `resources` capability. Gates
   * `listResources()` / `readResource()` so an unsupported server fails fast
   * and locally instead of paying a round trip for a method-not-found frame.
   */
  get resourcesSupported(): boolean {
    return this.capabilitiesValue?.resources !== undefined;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.transport.start();
    const result = (await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })) as McpInitializeResult;
    if (!result || typeof result !== "object") {
      throw new McpError("initialize 响应缺少 result", { remote: true });
    }
    const serverVersion = result.protocolVersion;
    if (typeof serverVersion !== "string" || !/^202[45]-/.test(serverVersion)) {
      throw new McpError(
        `服务器协议版本 ${String(serverVersion)} 不受支持（客户端为 ${MCP_PROTOCOL_VERSION}）`,
        { remote: true },
      );
    }
    this.protocolVersion = serverVersion;
    this.serverInfoValue = result.serverInfo;
    this.capabilitiesValue = result.capabilities;
    // Mark ourselves initialized; the server now accepts requests.
    await this.transport.notify(makeNotification("notifications/initialized"));
    this.connected = true;
    this.logger?.(
      `[mcp] ${this.name} connected (${result.serverInfo?.name ?? "?"} v${result.serverInfo?.version ?? "?"} @ ${serverVersion})`,
    );
  }

  async listTools(): Promise<McpToolMeta[]> {
    this.requireConnected();
    const tools: McpToolMeta[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: McpToolMeta[];
        nextCursor?: string;
      };
      if (!result || !Array.isArray(result.tools)) {
        throw new McpError("tools/list 响应缺少 tools 数组", { remote: true });
      }
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  /**
   * M7-6b: the server's advertised read-only resources (`resources/list`,
   * cursor-paginated like `tools/list`).
   *
   * A server that never advertised the `resources` capability has no
   * resources — this returns `[]` rather than throwing, so callers (the
   * registry, hosts) can probe unconditionally. Protocol-level malformed
   * replies still raise `McpError`. URIs are remote-supplied and therefore
   * filtered here: entries without a usable `uri` never reach the caller.
   */
  async listResources(): Promise<McpResourceMeta[]> {
    this.requireConnected();
    if (!this.resourcesSupported) return [];
    const resources: McpResourceMeta[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.request("resources/list", cursor ? { cursor } : {})) as {
        resources?: McpResourceMeta[];
        nextCursor?: string;
      };
      if (!result || !Array.isArray(result.resources)) {
        throw new McpError("resources/list 响应缺少 resources 数组", { remote: true });
      }
      for (const entry of result.resources) {
        if (entry && typeof entry.uri === "string" && entry.uri.trim()) resources.push(entry);
      }
      cursor = result.nextCursor;
    } while (cursor);
    return resources;
  }

  /**
   * M7-6b: read one advertised resource (`resources/read`). `uri` should come
   * from `listResources()`; an “越权” URI is rejected by `McpRegistry` before
   * it ever reaches this call (defence in depth — the URI is remote data).
   */
  async readResource(uri: string): Promise<McpReadResourceResult> {
    this.requireConnected();
    if (typeof uri !== "string" || !uri.trim()) throw new Error("readResource 需要非空 uri");
    if (!this.resourcesSupported) {
      throw new McpError(`MCP server "${this.name}" 未声明 resources 能力`);
    }
    const result = (await this.request("resources/read", { uri })) as McpReadResourceResult;
    if (!result || !Array.isArray(result.contents)) {
      throw new McpError("resources/read 响应缺少 contents 数组", { remote: true });
    }
    return result;
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<McpCallToolResult> {
    this.requireConnected();
    if (!name) throw new Error("callTool 需要一个工具名");
    const result = (await this.request("tools/call", {
      name,
      arguments: arguments_ ?? {},
    })) as McpCallToolResult;
    if (!result || !Array.isArray(result.content)) {
      throw new McpError("tools/call 响应缺少 content 数组", { remote: true });
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    await this.transport.close();
    this.logger?.(`[mcp] ${this.name} closed`);
  }

  private requireConnected(): void {
    if (!this.connected) {
      throw new McpConnectionError("McpClient 尚未 connect()");
    }
  }

  /** One request/response round trip. Throws `McpError` on error frames. */
  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.connected && method !== "initialize") this.requireConnected();
    const id = nextRequestId();
    const envelope = await this.transport.post(makeRequest(id, method, params));
    if ("error" in envelope && envelope.error) {
      throw responseError(envelope as JsonRpcResponseErr);
    }
    return (envelope as Exclude<JsonRpcResponse, JsonRpcResponseErr>).result;
  }
}

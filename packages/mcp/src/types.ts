/**
 * MCP adapter types (docs/architecture.md §5.3, M4).
 *
 * An MCP server's only product is a **dynamic tool collection**: once
 * registered, its tools are materialized as plain local `ToolDefinition`s and
 * flow through the exact same engine path (validation / gate / sandbox) as
 * built-in tools. This file holds the protocol-facing contracts; the JSON-RPC
 * plumbing lives in `jsonrpc.ts`, transports in `transport.ts`.
 */

/** The MCP protocol revision this client speaks. */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** One tool advertised by a remote MCP server (`tools/list`). */
export interface McpToolMeta {
  name: string;
  description?: string;
  /** MCP input schema: a JSON Schema object (possibly with $schema/title). */
  inputSchema?: Record<string, unknown>;
}

/** Text payload of an MCP call result (the only content type we forward). */
export interface McpTextContent {
  type: "text";
  text: string;
}

/** Result of `tools/call` (spec: CallToolResult). */
export interface McpCallToolResult {
  content: McpTextContent[];
  /** true = the tool ran but reported a business-level error. */
  isError?: boolean;
}

export interface McpServerInfo {
  name: string;
  version?: string;
}

/** Capability advertisement in the `initialize` result. */
export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpServerCapabilities;
  serverInfo: McpServerInfo;
  instructions?: string;
}

/** A stable reference to one remote tool (used by Agent recipes, §5.3). */
export interface McpToolRef {
  server: string;
  tool: string;
}

/**
 * The connection-level contract a registry can register (docs §5.3).
 * `McpClient` is the reference implementation over a `McpTransport`.
 */
export interface McpServerHandle {
  /** Unique server name — also the tool-name scope prefix. */
  readonly name: string;
  /** Server metadata once `connect()` has negotiated. */
  readonly serverInfo?: McpServerInfo;
  /** Negotiate protocol version and mark the client initialized. */
  connect(): Promise<void>;
  /** Fetch the server's current tool list. */
  listTools(): Promise<McpToolMeta[]>;
  /** Invoke one tool by its *remote* name (no prefix). */
  callTool(name: string, arguments_: Record<string, unknown>): Promise<McpCallToolResult>;
  /** Shut the connection down. Idempotent. */
  close(): Promise<void>;
}

export interface McpClientOptions {
  /** Unique server name — the tool-name scope prefix. */
  name: string;
  /** Transport carrying the JSON-RPC frames (stdio / streamable HTTP). */
  transport: import("./transport.js").McpTransport;
  /** Per-request timeout in ms (default 10_000). */
  requestTimeoutMs?: number;
  /** Optional trace logger (subprocess stderr, wire bytes…). */
  logger?: (line: string) => void;
}

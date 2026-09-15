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

/**
 * One read-only resource advertised by a remote MCP server (`resources/list`,
 * M7-6b). `uri` is the only required field and — being remote-supplied — is
 * treated as untrusted input everywhere downstream.
 */
export interface McpResourceMeta {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

/** One item of a `resources/read` result (text payload or base64 blob). */
export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  /** Base64-encoded payload for non-text resources. */
  blob?: string;
}

/** Result of `resources/read` (spec: ReadResourceResult). */
export interface McpReadResourceResult {
  contents: McpResourceContent[];
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
  /**
   * M7-6b (optional capability): the server's read-only resources. Absent ⇒
   * the server has no resources, so callers may probe unconditionally.
   */
  listResources?(): Promise<McpResourceMeta[]>;
  /**
   * M7-6b (optional capability): read one advertised resource. Callers are
   * expected to pass a URI obtained from `listResources()` — reading an
   * undeclared URI is rejected upstream in `McpRegistry.readResource()`.
   */
  readResource?(uri: string): Promise<McpReadResourceResult>;
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

// ---- MCP adapter (C6, docs §5.3 / M4) ----
// 原位于 core 的 `src/mcp/`，M6 拆包批次 B1 外置为独立包。
// 方向单向：mcp → core（工具契约），core 不再反向依赖 mcp。

export { McpClient } from "./client.js";

export { StdioTransport, StreamableHttpTransport, parseSse, validateMcpServerUrl } from "./transport.js";
export type {
  McpTransport,
  StdioTransportOptions,
  StreamableHttpTransportOptions,
} from "./transport.js";

export {
  McpRegistry,
  McpResourceError,
  MCP_TOOL_PREFIX,
  MCP_RESOURCE_MARKER,
  DEFAULT_MAX_RESOURCE_CHARS,
  DEFAULT_MAX_RESOURCE_TOOLS,
  mcpToolName,
  mcpResourceToolName,
  parseMcpToolName,
  normalizeSchema,
  pathArgKeysOf,
  resourceText,
} from "./registry.js";
export type {
  RegisteredServer,
  McpRegistryOptions,
  RegistryResource,
  McpResourceRead,
} from "./registry.js";

export { McpError, McpTimeoutError, McpConnectionError } from "./jsonrpc.js";

export { MCP_PROTOCOL_VERSION } from "./types.js";
export type {
  McpServerHandle,
  McpToolMeta,
  McpTextContent,
  McpCallToolResult,
  McpResourceMeta,
  McpResourceContent,
  McpReadResourceResult,
  McpServerInfo,
  McpServerCapabilities,
  McpInitializeResult,
  McpToolRef,
  McpClientOptions,
} from "./types.js";

/**
 * McpRegistry — turn remote MCP servers into plain local tools
 * (docs/architecture.md §5.3, M4).
 *
 * MCP servers are inherently dynamic: their tool list is only known at
 * connect time. The registry connects, lists tools and **materializes** each
 * one as a local `ToolDefinition` under a `mcp__<server>__<tool>` name — after
 * which the engine path is 100% identical to built-in tools: JSON-schema
 * validation, `gate()` authorization and the sandbox all just work.
 */

// C6 依赖 core 的工具契约（C4 决策：契约暂不下沉 C1），方向单向 mcp → core。
import { defineTool, type AnyTool, type ToolDefinition } from "@agent-runtime/core";
import { classifyToolName } from "@agent-runtime/types";
import type { JsonSchema } from "@agent-runtime/types";
import type { McpServerHandle, McpToolMeta, McpToolRef } from "./types.js";

/** Prefix scoping remote tools so they can never collide with local ones. */
export const MCP_TOOL_PREFIX = "mcp__";

export interface RegisteredServer {
  name: string;
  handle: McpServerHandle;
  tools: AnyTool[];
  registeredAt: number;
}

/** Compose the local name of a remote tool: `mcp__<server>__<tool>`. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

/** Split a materialized local name back into `{ server, tool }`. */
export function parseMcpToolName(localName: string): McpToolRef | undefined {
  const rest = localName.startsWith(MCP_TOOL_PREFIX)
    ? localName.slice(MCP_TOOL_PREFIX.length)
    : localName;
  const sep = rest.indexOf("__");
  if (sep <= 0 || sep === rest.length - 2) return undefined;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

export interface McpRegistryOptions {
  /** Clock for timestamps (deterministic tests). */
  now?: () => number;
}

/**
 * Registry of live MCP connections. `register()` connects + lists + caches;
 * the materialized tools are exposed through `tools()` for hosts to splice
 * into an Agent recipe (or attach to a runtime) exactly like local tools.
 */
export class McpRegistry {
  private readonly now: () => number;
  private readonly servers = new Map<string, RegisteredServer>();
  private readonly toolsByLocalName = new Map<string, AnyTool>();

  constructor(options: McpRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Connect a server handle and materialize its tools. Idempotent per name. */
  async register(handle: McpServerHandle): Promise<RegisteredServer> {
    if (!handle.name?.trim()) throw new Error("McpRegistry.register 需要带 name 的 handle");
    const name = handle.name.trim();
    if (name.includes("__")) {
      throw new Error(`MCP server 名不能包含 "__"：${name}`);
    }
    if (this.servers.has(name)) return this.servers.get(name)!;

    await handle.connect();
    let metas: McpToolMeta[];
    try {
      metas = await handle.listTools();
    } catch (err) {
      await handle.close().catch(() => {});
      throw err;
    }
    const tools = metas.map((meta) => this.materialize(name, handle, meta));
    const registered: RegisteredServer = {
      name,
      handle,
      tools,
      registeredAt: this.now(),
    };
    this.servers.set(name, registered);
    for (const tool of tools) this.toolsByLocalName.set(tool.name, tool);
    return registered;
  }

  /** Close the connection and drop the server's materialized tools. */
  async unregister(serverName: string): Promise<void> {
    const registered = this.servers.get(serverName);
    if (!registered) return;
    for (const tool of registered.tools) this.toolsByLocalName.delete(tool.name);
    this.servers.delete(serverName);
    await registered.handle.close();
  }

  /** All currently materialized remote tools (flat, ready for an Agent). */
  tools(): AnyTool[] {
    return [...this.toolsByLocalName.values()];
  }

  /** Servers by name; `tools` are the materialized local `ToolDefinition`s. */
  list(): RegisteredServer[] {
    return [...this.servers.values()];
  }

  /** Resolve a `{ server, tool }` ref to its materialized tool (§5.3 API). */
  resolve(ref: McpToolRef): ToolDefinition | undefined {
    return this.toolsByLocalName.get(mcpToolName(ref.server, ref.tool));
  }

  /** Look up the materialized tool by its local (prefixed) name. */
  get(localName: string): AnyTool | undefined {
    return this.toolsByLocalName.get(localName);
  }

  /** True when `name` was registered as an MCP server. */
  has(serverName: string): boolean {
    return this.servers.has(serverName);
  }

  /** Close every registered server (host shutdown). */
  async closeAll(): Promise<void> {
    const names = [...this.servers.keys()];
    for (const name of names) await this.unregister(name);
  }

  // ------------------------------------------------------------ materialize

  /**
   * One remote tool becomes one local ToolDefinition:
   *  - name   → prefixed, collision-free
   *  - schema → normalized into the engine's local JsonSchema subset
   *  - meta   → sensitivity class inferred from the *remote* tool name and
   *             path-bearing arguments detected from its schema
   *  - execute → forwards to `tools/call`, returns text content; throws on
   *             business-level `isError` so the model sees the server's words
   */
  private materialize(serverName: string, handle: McpServerHandle, meta: McpToolMeta): AnyTool {
    const localName = mcpToolName(serverName, meta.name);
    const description = meta.description
      ? `${meta.description}\n（远程工具，由 MCP server "${serverName}" 提供）`
      : `远程工具（由 MCP server "${serverName}" 提供）。`;
    const parameters = normalizeSchema(meta.inputSchema);

    const tool = defineTool({
      name: localName,
      description,
      ...(parameters ? { parameters } : {}),
      meta: {
        // Classify by the *remote* name: the mcp__ prefix must not skew the
        // sensitivity guess (write/exec/network keywords live in the tool name).
        kind: classifyToolName(meta.name),
        pathArgs: pathArgKeysOf(meta.inputSchema),
      },
      execute: async (args: Record<string, unknown>) => {
        const result = await handle.callTool(meta.name, args ?? {});
        const text = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        if (result.isError) {
          throw new Error(text || `${localName} 远端报告执行失败`);
        }
        return text || "（无文本输出）";
      },
    }) as ToolDefinition<Record<string, unknown>, unknown>;

    return tool;
  }
}

/**
 * Keep only the fields the engine's local validator understands, recursively.
 * MCP input schemas routinely carry `$schema`/`title`/`default`… which the
 * dependency-free validator neither needs nor knows.
 */
export function normalizeSchema(input: unknown): JsonSchema | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const src = input as Record<string, unknown>;
  const out: JsonSchema = {};
  for (const key of [
    "type",
    "description",
    "enum",
    "required",
    "additionalProperties",
    "minimum",
    "maximum",
  ] as const) {
    if (key in src) {
      (out as Record<string, unknown>)[key] = src[key];
    }
  }
  if (src.properties && typeof src.properties === "object" && !Array.isArray(src.properties)) {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(src.properties as Record<string, unknown>)) {
      const normalized = normalizeSchema(child);
      if (normalized) properties[key] = normalized;
    }
    if (Object.keys(properties).length > 0) out.properties = properties;
  }
  if (src.items && typeof src.items === "object") {
    const items = normalizeSchema(src.items);
    if (items) out.items = items;
  }
  return out;
}

const PATH_ARG_KEY = /(^|_)(path|paths|file|filepath|filename|dir|folder|target|root)$/i;

/** Detect which schema properties carry filesystem paths (for the sandbox). */
export function pathArgKeysOf(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const properties = (input as Record<string, unknown>).properties;
  if (!properties || typeof properties !== "object") return [];
  return Object.keys(properties as Record<string, unknown>).filter((key) => PATH_ARG_KEY.test(key));
}

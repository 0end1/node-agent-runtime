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
import {
  defineTool,
  ToolIndex,
  type AnyTool,
  type ToolDefinition,
  type ToolSearchEntry,
} from "@node-agent-runtime/core";
import { classifyToolName } from "@node-agent-runtime/types";
import type { JsonSchema } from "@node-agent-runtime/types";
import type {
  McpReadResourceResult,
  McpResourceMeta,
  McpServerHandle,
  McpToolMeta,
  McpToolRef,
} from "./types.js";

/** Prefix scoping remote tools so they can never collide with local ones. */
export const MCP_TOOL_PREFIX = "mcp__";

/** Local name marker separating materialized resources from real tools. */
export const MCP_RESOURCE_MARKER = "resource__";

/** M7-6b: resource text handed to the model is capped (context governance, M7-1). */
export const DEFAULT_MAX_RESOURCE_CHARS = 32_000;

/**
 * M7-6b: upper bound on resource tools materialized per server. A filesystem
 * MCP server can advertise thousands of resources; materializing all of them
 * would blow up the declared tool surface — the exact thing M7-6a governs.
 * Aligned with M7-6a's `maxDeclared` (50). Resources beyond the cap stay
 * reachable through `McpRegistry.readResource()`.
 */
export const DEFAULT_MAX_RESOURCE_TOOLS = 50;

export interface RegisteredServer {
  name: string;
  handle: McpServerHandle;
  tools: AnyTool[];
  /** M7-6b: resources advertised by this server (empty when unsupported). */
  resources: McpResourceMeta[];
  registeredAt: number;
}

/** An advertised resource together with the server that owns it. */
export interface RegistryResource extends McpResourceMeta {
  server: string;
  /** Local tool name, present only when the resource was materialized. */
  toolName?: string;
}

/** `resources/read` payload tagged with the owning server. */
export interface McpResourceRead extends McpReadResourceResult {
  server: string;
}

/** Raised when a resource URI is unknown / not declared by any server. */
export class McpResourceError extends Error {
  constructor(
    message: string,
    readonly uri?: string,
  ) {
    super(message);
    this.name = "McpResourceError";
  }
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

/**
 * M7-6b: local name of a materialized resource, e.g.
 * `mcp__docs__resource__readme_md_8f3c1a02`.
 *
 * Deterministic (same URI ⇒ same name) and collision-resistant: the URI is
 * slugified and suffixed with its FNV-1a hash, so two URIs that differ only
 * in characters the slug strips cannot collapse onto one tool.
 */
export function mcpResourceToolName(serverName: string, uri: string): string {
  return mcpToolName(serverName, `${MCP_RESOURCE_MARKER}${resourceSlug(uri)}`);
}

export interface McpRegistryOptions {
  /** Clock for timestamps (deterministic tests). */
  now?: () => number;
  /**
   * M7-6b: materialize advertised resources as read-only tools (default
   * `true`). Set `false` for resource-heavy servers (or when the host drives
   * reads itself) — resources stay reachable via `readResource()` either way.
   */
  resourceTools?: boolean;
  /** M7-6b: per-server cap on materialized resource tools (default 50). */
  maxResourceTools?: number;
  /** M7-6b: cap on resource text handed to the model (default 32_000 chars). */
  maxResourceChars?: number;
}

/**
 * Registry of live MCP connections. `register()` connects + lists + caches;
 * the materialized tools are exposed through `tools()` for hosts to splice
 * into an Agent recipe (or attach to a runtime) exactly like local tools.
 */
export class McpRegistry {
  private readonly now: () => number;
  private readonly resourceTools: boolean;
  private readonly maxResourceTools: number;
  private readonly maxResourceChars: number;
  private readonly servers = new Map<string, RegisteredServer>();
  private readonly toolsByLocalName = new Map<string, AnyTool>();
  private readonly resourcesByServer = new Map<string, McpResourceMeta[]>();
  /** Lazily built search index; invalidated whenever the tool set changes. */
  private toolIndex?: ToolIndex;

  constructor(options: McpRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.resourceTools = options.resourceTools ?? true;
    this.maxResourceTools = Math.max(0, options.maxResourceTools ?? DEFAULT_MAX_RESOURCE_TOOLS);
    this.maxResourceChars = Math.max(1, options.maxResourceChars ?? DEFAULT_MAX_RESOURCE_CHARS);
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

    // M7-6b: resources are an *optional* capability — a server without them
    // simply yields []. Anything malformed (no usable uri) is dropped: the
    // URI is remote-supplied and later becomes part of a tool name.
    let resources: McpResourceMeta[] = [];
    if (typeof handle.listResources === "function") {
      const listed = await handle.listResources();
      resources = (listed ?? []).filter(
        (entry): entry is McpResourceMeta =>
          Boolean(entry) && typeof entry.uri === "string" && entry.uri.trim().length > 0,
      );
    }
    const resourceTools = this.resourceTools
      ? resources
          .slice(0, this.maxResourceTools)
          .map((resource) => this.materializeResource(name, handle, resource))
      : [];

    const registered: RegisteredServer = {
      name,
      handle,
      tools,
      resources,
      registeredAt: this.now(),
    };
    this.servers.set(name, registered);
    this.resourcesByServer.set(name, resources);
    for (const tool of tools) this.toolsByLocalName.set(tool.name, tool);
    for (const tool of resourceTools) this.toolsByLocalName.set(tool.name, tool);
    this.toolIndex = undefined;
    return registered;
  }

  /** Close the connection and drop the server's materialized tools. */
  async unregister(serverName: string): Promise<void> {
    const registered = this.servers.get(serverName);
    if (!registered) return;
    for (const tool of registered.tools) this.toolsByLocalName.delete(tool.name);
    // M7-6b: drop this server's materialized resource tools too.
    for (const localName of [...this.toolsByLocalName.keys()]) {
      const parsed = parseMcpToolName(localName);
      if (parsed?.server === serverName && parsed.tool.startsWith(MCP_RESOURCE_MARKER)) {
        this.toolsByLocalName.delete(localName);
      }
    }
    this.servers.delete(serverName);
    this.resourcesByServer.delete(serverName);
    this.toolIndex = undefined;
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

  /**
   * M7-6b: every advertised resource of every registered server (optionally
   * narrowed to one). `toolName` is present only for resources that were
   * materialized as tools (see `McpRegistryOptions.resourceTools`).
   */
  listResources(serverName?: string): RegistryResource[] {
    const out: RegistryResource[] = [];
    for (const [server, resources] of this.resourcesByServer) {
      if (serverName !== undefined && server !== serverName) continue;
      resources.forEach((resource, index) => {
        const materialized = this.resourceTools && index < this.maxResourceTools;
        out.push({
          ...resource,
          server,
          ...(materialized ? { toolName: mcpResourceToolName(server, resource.uri) } : {}),
        });
      });
    }
    return out;
  }

  /**
   * M7-6b: read one resource by URI (optionally pinned to a server).
   *
   * The URI must have been **declared** by `resources/list` — this is the
   * sandbox's declared domain for resources: since URIs are remote-supplied
   * (and a model may hallucinate or be prompt-injected into asking for
   * `file:///etc/shadow`), anything outside the declared set is rejected here
   * instead of being forwarded to the server.
   */
  async readResource(uri: string, serverName?: string): Promise<McpResourceRead> {
    const target = typeof uri === "string" ? uri.trim() : "";
    if (!target) throw new McpResourceError("readResource 需要非空 uri", uri);
    const names = serverName !== undefined ? [serverName] : [...this.resourcesByServer.keys()];
    for (const name of names) {
      const declared = this.resourcesByServer.get(name);
      if (!declared?.some((resource) => resource.uri === target)) continue;
      const registered = this.servers.get(name);
      const handle = registered?.handle;
      if (!handle || typeof handle.readResource !== "function") {
        throw new McpResourceError(`MCP server "${name}" 不支持 resources/read`, target);
      }
      const result = await handle.readResource(target);
      return { server: name, contents: result?.contents ?? [] };
    }
    throw new McpResourceError(`资源 URI 未被声明，越权读取被拒：${target}`, target);
  }

  /**
   * M7-6b: rank the materialized catalog (tools + resource tools) for a query.
   * Delegates to core's `ToolIndex` (M7-6a) so MCP surfaces are discoverable
   * the same way local ones are. Empty/whitespace query ⇒ `[]` (never throws).
   */
  searchTools(query: string, limit = 10): ToolSearchEntry[] {
    if (!this.toolIndex) this.toolIndex = new ToolIndex(this.tools());
    return this.toolIndex.search(query, limit);
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

  /**
   * M7-6b: one advertised resource becomes one **read-only** local tool whose
   * URI is fixed in the closure — the model cannot widen it at call time.
   *
   * Sensitivity is set conservatively to `network-read` (never inferred from
   * the URI, which may read `harmless`): a resource read is an outbound fetch
   * from the agent's point of view, so it flows through the existing gate
   * matrix and sandbox (`network: "deny"` ⇒ denied) like any other tool.
   */
  private materializeResource(
    serverName: string,
    handle: McpServerHandle,
    resource: McpResourceMeta,
  ): AnyTool {
    const localName = mcpResourceToolName(serverName, resource.uri);
    const label = resource.name?.trim() || resource.uri;
    const description = [
      `只读资源（MCP server "${serverName}"）：${label}`,
      resource.description?.trim(),
      `URI: ${resource.uri}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    return defineTool({
      name: localName,
      description,
      meta: { kind: "network-read" },
      execute: async () => {
        if (typeof handle.readResource !== "function") {
          throw new McpResourceError(`MCP server "${serverName}" 不支持 resources/read`, resource.uri);
        }
        const result = await handle.readResource(resource.uri);
        return resourceText(result, this.maxResourceChars);
      },
    }) as ToolDefinition<Record<string, unknown>, unknown>;
  }
}

const TEXTISH_MIME = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|toml)|.*\+(json|xml))$/i;

/**
 * M7-6b: flatten a `resources/read` result into the text handed to the model.
 *
 * - `text` contents are used verbatim;
 * - `blob` contents are base64-decoded **only** for text-ish mime types
 *   (binary stays out of the context — it would be worse than useless there);
 * - the result is capped at `maxChars` (default 32k): resource text lands in
 *   the model's context, and an unbounded read is a context-blowup vector
 *   (M7-1 governs exactly this).
 */
export function resourceText(
  result: McpReadResourceResult | undefined,
  maxChars: number = DEFAULT_MAX_RESOURCE_CHARS,
): string {
  const parts: string[] = [];
  for (const content of result?.contents ?? []) {
    if (!content) continue;
    if (typeof content.text === "string") {
      parts.push(content.text);
      continue;
    }
    if (typeof content.blob === "string") {
      if (content.mimeType && TEXTISH_MIME.test(content.mimeType)) {
        parts.push(Buffer.from(content.blob, "base64").toString("utf8"));
      } else {
        const mime = content.mimeType ?? "application/octet-stream";
        parts.push(
          `（二进制资源 ${mime}，约 ${Math.ceil(content.blob.length / 4) * 3} 字节，未内联）`,
        );
      }
    }
  }
  const joined = parts.join("\n");
  if (!joined) return "（资源无文本内容）";
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars)}\n…（已截断：共 ${joined.length} 字符，上限 ${maxChars}）`;
}

/** Slug + FNV-1a suffix — see `mcpResourceToolName`. */
function resourceSlug(uri: string): string {
  const base = uri
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${base || "resource"}_${fnv1aHex(uri)}`;
}

/** 32-bit FNV-1a, hex — deterministic ids without pulling in a dependency. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

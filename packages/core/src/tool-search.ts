import { classifyToolName, type AnyTool, type ToolKind } from "@node-agent-runtime/types";

export interface ToolSearchEntry {
  name: string;
  description: string;
  kind: ToolKind;
}

/**
 * M7-6a: inverted index over tools powering `tool_search`. Zero-dependency;
 * substring scoring over name / description / kind, with a bonus for a
 * whole-phrase match. Used both to drive the `tool_search` meta-tool and to
 * rank which tools get declared to the model when the catalog exceeds
 * `maxDeclared` (so a relevant default surface still shows up).
 */
export class ToolIndex {
  private entries = new Map<string, ToolSearchEntry>();
  private haystack = new Map<string, string>();

  constructor(tools: Iterable<AnyTool>) {
    for (const tool of tools) {
      if (this.entries.has(tool.name)) continue;
      const kind = tool.meta?.kind ?? classifyToolName(tool.name);
      const entry: ToolSearchEntry = {
        name: tool.name,
        description: tool.description,
        kind,
      };
      this.entries.set(tool.name, entry);
      this.haystack.set(tool.name, `${tool.name} ${tool.description} ${kind}`.toLowerCase());
    }
  }

  /** All indexed tools, in insertion order. */
  all(): ToolSearchEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Rank tools by relevance to `query`. An empty/whitespace query yields `[]`
   * (never throws). Returns at most `limit` entries, highest score first; ties
   * are broken by name for determinism.
   */
  search(query: string, limit = 10): ToolSearchEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const phrases = tokenize(q);
    const scores = new Map<string, number>();
    for (const [name, hay] of this.haystack) {
      let score = 0;
      for (const p of phrases) {
        if (p && hay.includes(p)) score += 1;
      }
      if (hay.includes(q)) score += 2; // whole-phrase match bonus
      if (score > 0) scores.set(name, score);
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name]) => this.entries.get(name)!);
  }
}

/**
 * Build the `tool_search` meta-tool for a run. It is a pure discovery tool: it
 * returns matching tool names/descriptions from the full catalog so the model
 * can call them by name. It does **not** narrow permissions — execution still
 * goes through the full `toolMap`, so gate / sandbox semantics are unchanged.
 */
export function createToolSearchTool(index: ToolIndex): AnyTool {
  return {
    name: "tool_search",
    description:
      "Search the full tool catalog by natural-language query and return matching tool names with descriptions. To use a tool, call it by its returned name. This is a discovery aid, not a permission boundary.",
    meta: { kind: "harmless" },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: 'e.g. "weather" or "文件写入"' },
        limit: { type: "number", description: "max results (default 10)" },
      },
      required: ["query"],
    },
    execute(args: { query: string; limit?: number }) {
      const results = index.search(args.query, args.limit ?? 10);
      return {
        query: args.query,
        count: results.length,
        tools: results.map((r) => ({ name: r.name, description: r.description, kind: r.kind })),
      };
    },
  };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/u)
    .filter(Boolean);
}

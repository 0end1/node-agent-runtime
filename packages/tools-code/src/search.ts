import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool, type AnyTool } from "@node-agent-runtime/core";
import {
  assertInside,
  limitsOf,
  SKIP_DIRS,
  truncateBytes,
  type CodeToolOptions,
} from "./paths.js";

/** 单行返回的最大字节数 —— 一行几 MB 的压缩产物不该整行进上下文。 */
const MAX_LINE_BYTES = 2_000;

export interface ListDirArgs extends Record<string, unknown> {
  path?: string;
}

export interface DirEntry {
  name: string;
  type: "file" | "dir" | "link" | "other";
  bytes?: number;
}

export interface ListDirResult {
  path: string;
  entries: DirEntry[];
  count: number;
  /** 目录实际条目数（截断时大于 count）。 */
  total: number;
  truncated: boolean;
}

export interface GlobArgs extends Record<string, unknown> {
  pattern: string;
  path?: string;
}

export interface GlobResult {
  pattern: string;
  matches: string[];
  count: number;
  truncated: boolean;
}

export interface GrepArgs extends Record<string, unknown> {
  pattern: string;
  path?: string;
  /** 只在这些文件里找（glob 模式，如 `*.ts`）。 */
  include?: string;
  /** 是否按正则解释 pattern，默认 false（子串匹配）。 */
  regex?: boolean;
  /** 大小写敏感，默认 true。 */
  caseSensitive?: boolean;
}

export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

export interface GrepResult {
  pattern: string;
  hits: GrepHit[];
  count: number;
  filesScanned: number;
  truncated: boolean;
}

/** glob → 正则：`**` 跨目录、`*` 不跨目录、`?` 单字符。 */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` 表示「零层或多层目录」——必须能吃掉后面的分隔斜杠，
        // 否则 src/**/*.ts 会要求至少一层子目录，匹配不到 src/a.ts。
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * 递归收集相对路径。
 *
 * 零依赖（不引 `fast-glob`）：依赖会成为每个下游的传递依赖，而这里只需要
 * 「跳过大目录 + 上限保护」这一层，自己写更可控。
 */
async function walk(root: string, maxEntries: number): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [""];
  let visited = 0;

  while (stack.length > 0 && visited < maxEntries) {
    const rel = stack.pop() as string;
    visited += 1;
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      continue; // 权限/消失的文件：跳过比失败更有用
    }
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(childRel);
      } else {
        files.push(childRel);
      }
      if (files.length >= maxEntries) return files;
    }
  }
  return files;
}

/** `list_dir` —— 单层列举。递归检索请用 `glob`。 */
export function createListDirTool(options: CodeToolOptions = {}): AnyTool {
  const limits = limitsOf(options);

  return defineTool<ListDirArgs, ListDirResult>({
    name: "list_dir",
    description:
      "列举一个目录下的条目（单层，不递归）。返回名称与类型（file/dir/link）；条目过多会被截断并标记。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径，默认为作用域根" },
      },
    },
    meta: { kind: "harmless", pathArgs: ["path"] },
    async execute(args) {
      const requested = args.path ?? ".";
      const real = await assertInside(options, String(requested), "目录路径");
      const raw = await readdir(real, { withFileTypes: true });

      const entries: DirEntry[] = raw.slice(0, limits.dirEntries).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "link" : entry.isFile() ? "file" : "other",
      }));

      return {
        path: String(requested),
        entries,
        count: entries.length,
        total: raw.length,
        truncated: raw.length > entries.length,
      };
    },
  });
}

/** `glob` —— 按模式匹配文件路径（相对作用域根）。 */
export function createGlobTool(options: CodeToolOptions = {}): AnyTool {
  const limits = limitsOf(options);

  return defineTool<GlobArgs, GlobResult>({
    name: "glob",
    description:
      "按 glob 模式查找文件，如 `src/**/*.ts`。`**` 跨目录、`*` 不跨目录。默认跳过 node_modules/.git/dist 等大目录。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "glob 模式，如 src/**/*.ts" },
        path: { type: "string", description: "起始目录，默认为作用域根" },
      },
      required: ["pattern"],
    },
    meta: { kind: "harmless", pathArgs: ["path"] },
    async execute(args) {
      const requested = args.path ?? ".";
      const real = await assertInside(options, String(requested), "检索目录");
      const all = await walk(real, limits.walkEntries);
      const re = globToRegExp(String(args.pattern));
      const matched = all.filter((rel) => re.test(rel));

      return {
        pattern: String(args.pattern),
        matches: matched.slice(0, limits.searchHits),
        count: Math.min(matched.length, limits.searchHits),
        truncated: matched.length > limits.searchHits,
      };
    },
  });
}

/** `grep` —— 在文件内容中搜索，返回命中行与行号。 */
export function createGrepTool(options: CodeToolOptions = {}): AnyTool {
  const limits = limitsOf(options);

  return defineTool<GrepArgs, GrepResult>({
    name: "grep",
    description:
      "在文件内容中查找匹配行，返回文件、行号与该行文本。默认按子串匹配（regex=true 时按正则）。命中过多会被截断并标记。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "要查找的内容或正则" },
        path: { type: "string", description: "起始目录，默认为作用域根" },
        include: { type: "string", description: "只匹配这些文件，glob 模式如 *.ts" },
        regex: { type: "boolean", description: "是否按正则解释 pattern，默认 false" },
        caseSensitive: { type: "boolean", description: "是否大小写敏感，默认 true" },
      },
      required: ["pattern"],
    },
    meta: { kind: "harmless", pathArgs: ["path"] },
    async execute(args) {
      const requested = args.path ?? ".";
      const real = await assertInside(options, String(requested), "检索目录");
      const pattern = String(args.pattern);

      // 无效正则必须显式报错：静默回退成子串匹配会让模型以为没匹配到
      let test: (line: string) => boolean;
      if (args.regex === true) {
        const flags = args.caseSensitive === false ? "i" : "";
        try {
          const re = new RegExp(pattern, flags);
          test = (line) => re.test(line);
        } catch (err) {
          throw new Error(`无效的正则「${pattern}」：${(err as Error).message}`);
        }
      } else if (args.caseSensitive === false) {
        const needle = pattern.toLowerCase();
        test = (line) => line.toLowerCase().includes(needle);
      } else {
        test = (line) => line.includes(pattern);
      }

      let candidates = await walk(real, limits.walkEntries);
      if (args.include) {
        const includeRe = globToRegExp(String(args.include));
        candidates = candidates.filter((rel) => includeRe.test(rel));
      }

      const hits: GrepHit[] = [];
      let filesScanned = 0;
      let truncated = false;

      for (const rel of candidates) {
        if (hits.length >= limits.searchHits) {
          truncated = true;
          break;
        }
        let content: string;
        try {
          content = await readFile(join(real, rel), "utf8");
        } catch {
          continue; // 二进制/权限问题：跳过
        }
        if (content.includes("\u0000")) continue; // 二进制快速排除
        filesScanned += 1;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          if (!test(lines[i])) continue;
          if (hits.length >= limits.searchHits) {
            truncated = true;
            break;
          }
          hits.push({
            file: rel,
            line: i + 1,
            text: truncateBytes(lines[i], MAX_LINE_BYTES).text,
          });
        }
      }

      return { pattern, hits, count: hits.length, filesScanned, truncated };
    },
  });
}

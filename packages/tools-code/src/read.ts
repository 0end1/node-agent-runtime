import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { defineTool, type AnyTool } from "@node-agent-runtime/core";
import { assertInside, limitsOf, truncateBytes, type CodeToolOptions } from "./paths.js";

/** 含 NUL 字节即视为二进制 —— 返回乱码不如明确拒绝。 */
async function looksBinary(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

export interface ReadFileArgs extends Record<string, unknown> {
  path: string;
  /** 起始行（1-based，含）。默认 1。 */
  offset?: number;
  /** 最多返回多少行。默认不限（仍受字节上限约束）。 */
  limit?: number;
}

export interface ReadFileResult {
  path: string;
  /** 本次返回内容的起始行号，便于模型定位。 */
  startLine: number;
  /** 本次实际返回的行数。 */
  lineCount: number;
  /** 文件总行数；因截断而未能读完时为 null。 */
  totalLines: number | null;
  content: string;
  bytes: number;
  truncated: boolean;
  /** 截断原因：字节上限 / 行数上限 / 未截断。 */
  truncatedBy: "bytes" | "lines" | "none";
}

/**
 * `read_file` —— 读取文本文件内容。
 *
 * 无副作用故为 `harmless`；越界由两处拦：沙箱按 `meta.pathArgs` 拦**声明**的
 * 路径，本工具在真正读取前再按 `realpath` 拦一次**解析后**的路径（symlink 逃逸）。
 */
export function createReadFileTool(options: CodeToolOptions = {}): AnyTool {
  const limits = limitsOf(options);

  return defineTool<ReadFileArgs, ReadFileResult>({
    name: "read_file",
    description:
      "读取一个文本文件的内容。可用 offset/limit 只读其中一段；超出上限会被截断并在结果中标记 truncated。二进制文件（含 NUL 字节）会被拒绝。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要读取的文件路径（相对作用域根或绝对路径）" },
        offset: { type: "number", description: "起始行号，1-based，默认 1" },
        limit: { type: "number", description: "最多返回的行数，默认不限" },
      },
      required: ["path"],
    },
    meta: { kind: "harmless", pathArgs: ["path"] },
    async execute(args) {
      const real = await assertInside(options, String(args.path), "读取路径");
      const info = await stat(real);
      if (info.isDirectory()) {
        throw new Error(`「${args.path}」是目录而非文件；列举目录请用 list_dir`);
      }
      if (await looksBinary(real)) {
        throw new Error(`「${args.path}」看起来是二进制文件，已拒绝读取`);
      }

      const startLine = Math.max(1, Math.trunc(args.offset ?? 1));
      const hasLineLimit = args.limit !== undefined;
      const lineLimit = hasLineLimit ? Math.max(0, Math.trunc(args.limit as number)) : Number.POSITIVE_INFINITY;

      // 逐行流式读取：内存恒定，并同时施加「行数」与「字节」两个上限。
      const rl = createInterface({
        input: createReadStream(real, "utf8"),
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      const collected: string[] = [];
      let seen = 0;
      let bytes = 0;
      let truncatedBy: "bytes" | "lines" | "none" = "none";

      for await (const line of rl) {
        seen += 1;
        if (seen < startLine) continue;

        if (collected.length >= lineLimit) {
          // 已达行数上限即停：不为统计总行数而把整个文件读完（大文件上这是真实开销）
          truncatedBy = "lines";
          break;
        }

        const nextBytes = bytes + Buffer.byteLength(line, "utf8") + 1;
        if (nextBytes > limits.readBytes) {
          truncatedBy = "bytes";
          break;
        }
        bytes = nextBytes;
        collected.push(line);
      }

      const content = collected.join("\n");
      const { text, truncated } = truncateBytes(content, limits.readBytes);

      return {
        path: String(args.path),
        startLine,
        lineCount: collected.length,
        totalLines: truncatedBy === "none" ? seen : null,
        content: text,
        bytes: Buffer.byteLength(text, "utf8"),
        truncated: truncated || truncatedBy !== "none",
        truncatedBy: truncated ? "bytes" : truncatedBy,
      };
    },
  });
}

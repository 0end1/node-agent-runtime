import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool, type AnyTool } from "@node-agent-runtime/core";
import { assertInside, type CodeToolOptions } from "./paths.js";

export interface WriteFileArgs extends Record<string, unknown> {
  path: string;
  content: string;
  /** 默认 false：目标已存在时拒绝，避免静默覆盖。 */
  overwrite?: boolean;
}

export interface WriteFileResult {
  path: string;
  bytes: number;
  created: boolean;
}

export interface EditFileArgs extends Record<string, unknown> {
  path: string;
  /** 必须**在文件中唯一**的原文片段。 */
  oldText: string;
  newText: string;
}

export interface EditFileResult {
  path: string;
  /** `oldText` 在文件中的命中次数（成功时恒为 1）。 */
  occurrences: number;
  bytes: number;
}

/**
 * `write_file` —— 写入文本文件（父目录自动创建）。
 *
 * `kind: "write"` 让沙箱两件事都成立：read-only 模式直接拒绝（不弹审批），
 * 执行后产出 `sandbox:write` diff —— **复用既有机制，本工具不自己做 diff**。
 */
export function createWriteFileTool(options: CodeToolOptions = {}): AnyTool {
  return defineTool<WriteFileArgs, WriteFileResult>({
    name: "write_file",
    description:
      "把内容写入一个文本文件（父目录自动创建）。默认拒绝覆盖已存在的文件，需显式 overwrite=true。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目标文件路径" },
        content: { type: "string", description: "要写入的完整内容" },
        overwrite: { type: "boolean", description: "允许覆盖已存在的文件，默认 false" },
      },
      required: ["path", "content"],
    },
    meta: { kind: "write", pathArgs: ["path"] },
    async execute(args) {
      const real = await assertInside(options, String(args.path), "写入路径");

      let exists = false;
      try {
        exists = (await stat(real)).isFile();
      } catch {
        exists = false;
      }
      if (exists && args.overwrite !== true) {
        throw new Error(`「${args.path}」已存在；如需覆盖请传 overwrite=true`);
      }

      await mkdir(dirname(real), { recursive: true });
      const content = String(args.content ?? "");
      await writeFile(real, content, "utf8");

      return {
        path: String(args.path),
        bytes: Buffer.byteLength(content, "utf8"),
        created: !exists,
      };
    },
  });
}

/**
 * `edit_file` —— 按**精确字符串**替换一处。
 *
 * 为什么不用行号：模型给行号极易错位。为什么要求唯一：命中多处时替哪个都是
 * 猜；报错并把命中次数回给模型，让它自己收窄片段，比猜一次更可靠。
 * 失败时**绝不改文件**。
 */
export function createEditFileTool(options: CodeToolOptions = {}): AnyTool {
  return defineTool<EditFileArgs, EditFileResult>({
    name: "edit_file",
    description:
      "把文件中一段唯一的原文替换为新内容。oldText 必须在文件中恰好出现一次，否则报错且不修改文件（0 次=没找到，多次=片段不够具体）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目标文件路径" },
        oldText: { type: "string", description: "要被替换的原文片段，必须在文件中唯一" },
        newText: { type: "string", description: "替换后的内容" },
      },
      required: ["path", "oldText", "newText"],
    },
    meta: { kind: "write", pathArgs: ["path"] },
    async execute(args) {
      const real = await assertInside(options, String(args.path), "编辑路径");
      const original = await readFile(real, "utf8");
      const oldText = String(args.oldText ?? "");
      const newText = String(args.newText ?? "");

      if (oldText.length === 0) {
        throw new Error("oldText 不能为空：请给出要替换的原文片段");
      }

      let occurrences = 0;
      let at = original.indexOf(oldText);
      while (at !== -1) {
        occurrences += 1;
        at = original.indexOf(oldText, at + oldText.length);
      }

      if (occurrences === 0) {
        throw new Error(`oldText 在「${args.path}」中未找到（0 次命中），文件未被修改`);
      }
      if (occurrences > 1) {
        throw new Error(
          `oldText 在「${args.path}」中出现 ${occurrences} 次，不够唯一；请给出更具体的片段（文件未被修改）`,
        );
      }

      const updated = original.replace(oldText, () => newText);
      await writeFile(real, updated, "utf8");

      return {
        path: String(args.path),
        occurrences,
        bytes: Buffer.byteLength(updated, "utf8"),
      };
    },
  });
}

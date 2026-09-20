/**
 * `@node-agent-runtime/tools-code` —— 受治理的文件与命令工具（M9）。
 *
 * 设计取舍记在 `docs/m9-tools-code.md`，这里只说装配要点：
 * - **作用域必须显式给**：`ToolExecutionContext` 不含 workspace，工具无从得知
 *   宿主声明的域，故由装配方通过 `workspace` 传入（默认 `process.cwd()`）。
 * - **路径域由沙箱拦**：每个工具都在 `meta.pathArgs` 声明了承载路径的字段，
 *   交给 `LocalSandbox` 统一校验；本包只补沙箱拦不住的 symlink 逃逸。
 * - **`bash` 是 `exec` 类**：read-only 沙箱下会被直接拒绝（不弹审批）。
 */
import type { AnyTool } from "@node-agent-runtime/core";

import { createBashTool, type BashArgs, type BashResult, type BashToolOptions } from "./exec.js";
import {
  CODE_TOOL_LIMITS,
  type CodeToolLimits,
  type CodeToolOptions,
} from "./paths.js";
import { createReadFileTool, type ReadFileArgs, type ReadFileResult } from "./read.js";
import {
  createGlobTool,
  createGrepTool,
  createListDirTool,
  globToRegExp,
  type DirEntry,
  type GlobArgs,
  type GlobResult,
  type GrepArgs,
  type GrepHit,
  type GrepResult,
  type ListDirArgs,
  type ListDirResult,
} from "./search.js";
import {
  createEditFileTool,
  createWriteFileTool,
  type EditFileArgs,
  type EditFileResult,
  type WriteFileArgs,
  type WriteFileResult,
} from "./write.js";

/** 本包提供的工具名（顺序即 `createCodeTools()` 的返回顺序）。 */
export const CODE_TOOL_NAMES = [
  "read_file",
  "write_file",
  "edit_file",
  "list_dir",
  "glob",
  "grep",
  "bash",
] as const;

export type CodeToolsOptions = BashToolOptions;

/** 按给定作用域装配全部七件工具。 */
export function createCodeTools(options: CodeToolsOptions = {}): AnyTool[] {
  return [
    createReadFileTool(options),
    createWriteFileTool(options),
    createEditFileTool(options),
    createListDirTool(options),
    createGlobTool(options),
    createGrepTool(options),
    createBashTool(options),
  ];
}

/** 默认实例：作用域为 `process.cwd()`。多数场景请用 `createCodeTools()` 显式指定。 */
export const codeTools: AnyTool[] = createCodeTools();

export {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListDirTool,
  createGlobTool,
  createGrepTool,
  createBashTool,
  globToRegExp,
  CODE_TOOL_LIMITS,
};

export type {
  CodeToolOptions,
  CodeToolLimits,
  BashToolOptions,
  BashArgs,
  BashResult,
  ReadFileArgs,
  ReadFileResult,
  WriteFileArgs,
  WriteFileResult,
  EditFileArgs,
  EditFileResult,
  ListDirArgs,
  ListDirResult,
  DirEntry,
  GlobArgs,
  GlobResult,
  GrepArgs,
  GrepHit,
  GrepResult,
};

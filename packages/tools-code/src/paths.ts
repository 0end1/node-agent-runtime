import { basename, dirname, join, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { SandboxViolationError } from "@node-agent-runtime/sandbox";

/**
 * 共享的路径与截断基础设施（包内部使用，不对外导出到 index）。
 *
 * 两条纪律：
 * 1. **域判定不在这里重复实现** —— 声明 `meta.pathArgs` 后由沙箱 `wrap()`
 *    统一拦；本文件只补沙箱拦不住的那一层（见第 2 条）。两处各自实现必然漂移。
 * 2. **符号链接逃逸** —— 沙箱的 `isPathAllowed()` 走 `path.resolve()`，不解析
 *    symlink：workspace 内一个指向 `/etc` 的链接能通过检查，随后被真实读写。
 *    故工具在**真正访问文件前**再做一次 `realpath()` 校验。
 */

/** 输出上限。工具不该把上下文撑爆（M7-6 工具规模治理的延伸）。 */
export interface CodeToolLimits {
  /** 单次文件读取的最大字节数。 */
  readBytes: number;
  /** 单次目录列举的最大条目数。 */
  dirEntries: number;
  /** 单次搜索（glob / grep）的最大结果数。 */
  searchHits: number;
  /** 单次命令输出（stdout / stderr 各计）的最大字节数。 */
  outputBytes: number;
  /** 递归遍历时的最大访问条目数（防超大仓库把一次工具调用拖死）。 */
  walkEntries: number;
}

// 刻意**不用** `as const`：那会把字段类型钉成字面量（200000），
// 装配方想覆盖成任意数字就会类型报错。
export const CODE_TOOL_LIMITS: CodeToolLimits = {
  readBytes: 200_000,
  dirEntries: 500,
  searchHits: 200,
  outputBytes: 64_000,
  walkEntries: 20_000,
};

export interface CodeToolOptions {
  /**
   * 工具的作用域根。默认 `process.cwd()`。
   *
   * 刻意做成**配置项**而非从执行上下文取：`ToolExecutionContext` 只有
   * conversationId / runId / sessionId / taskId / now()，不含 workspace，
   * 工具无法得知宿主声明的域 —— 只能由装配方告知。
   */
  workspace?: string;
  /** 除 workspace 外额外允许的根（与 `SandboxScope.writablePaths` 同义）。 */
  writablePaths?: readonly string[];
  /** 覆盖默认上限。 */
  limits?: Partial<CodeToolLimits>;
}

/** 取生效上限。 */
export function limitsOf(options: CodeToolOptions = {}): CodeToolLimits {
  return { ...CODE_TOOL_LIMITS, ...options.limits };
}

/** 作用域根（第一个根即 workspace，命令的 cwd 也用它）。 */
export function workspaceRoot(options: CodeToolOptions = {}): string {
  return resolve(options.workspace ?? process.cwd());
}

/** 全部允许的根（workspace + writablePaths）。 */
export function resolveRoots(options: CodeToolOptions = {}): string[] {
  return [workspaceRoot(options), ...(options.writablePaths ?? []).map((r) => resolve(r))];
}

function inside(roots: readonly string[], target: string): boolean {
  return roots.some((root) => target === root || target.startsWith(root + sep));
}

/**
 * 解析 `target` 的**真实路径**并断言其落在域内，返回真实路径。
 *
 * 目标不存在时（写入新文件的场景）退化为「父目录真实路径 + 文件名」——
 * 父目录若本身是逃出域的 symlink，此处仍会被拦下。
 */
/**
 * 逐级向上找到**存在的**祖先并 realpath，再拼回尚不存在的尾部。
 *
 * 为什么需要它：判定时两侧必须落在同一个路径空间。目标文件往往还不存在
 * （写入场景），无法直接 realpath；而域根在 macOS 上 `/tmp`、`/var` 本身就是
 * symlink —— 一侧真实、一侧原始，域内文件会被误判越界。两侧都过这个函数，
 * 就都在真实路径空间里比较了。
 */
async function realpathish(target: string): Promise<string> {
  const tail: string[] = [];
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return target; // 已到文件系统根，无法再上溯
      tail.push(basename(probe));
      probe = parent;
    }
  }
}

export async function assertInside(
  options: CodeToolOptions,
  target: string,
  what = "路径",
): Promise<string> {
  const roots = await Promise.all(resolveRoots(options).map((root) => realpathish(root)));
  const resolved = resolve(workspaceRoot(options), target);
  const real = await realpathish(resolved);

  if (!inside(roots, real)) {
    throw new SandboxViolationError(
      `${what}越界「${target}」：解析后为 ${real}，不在作用域 ${roots.join(", ")} 内`,
    );
  }
  return real;
}

/** 按字节截断文本。**必须**返回标记 —— 静默截断会让模型以为自己看完了。 */
export function truncateBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  const sliced = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  return { text: sliced, truncated: true };
}

/** 目录遍历时默认跳过的目录（与 glob 的常识一致，避免扫进依赖黑洞）。 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
]);

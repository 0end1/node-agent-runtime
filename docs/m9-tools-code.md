# M9 · `tools-code`：受治理的文件与命令工具包

> 定位：**M9 执行清单**。对应 `docs/development-checklist.md` §3.4 中原「延后」项 `tools-code`，2026-09-20 拍板激活。
> 事实源：代码与测试；本文记录**立项依据、取舍与验收口径**，不复制代码。

## 0. 立项依据

**来源**：`development-checklist.md` §3.4 的「延后」行 —— `tools-code`（`read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` / `bash`），原状态 ⏸，理由「ACP 模式下由 Client 提供」。

**激活理由**：ACP Client 提供的 fs/terminal 是**客户端侧能力**，只在跑 ACP 时才存在。底座自己跑（CLI / Web / 嵌入式接入）时，一个文件工具都没有 —— 开发者拿到 `create-node-agent-runtime` 生成的第一项目，仍要自己手写七件工具才能干活。生态位缺的是「**开箱即用、且已被治理能力覆盖**的文件与命令工具」。

### 三问准入（`docs/base-convergence.md` §3）

| 问 | 答 |
|---|---|
| 1. 属于底座哪层/哪个包？ | 新包 `packages/tools-code`（第 15 个）。依赖只向下：`types`（`ToolDefinition`）+ `core`（`defineTool`）+ `sandbox`（复用 `isPathAllowed`）。`core` 不 import 它，与 `acp` 同构。 |
| 2. 验收物是 API / 测试 / 发布物？ | 三者都有：7 个 `ToolDefinition` + `codeTools` 集合（API）、逐工具单测与沙箱集成测试（测试）、npm 包（发布物）。 |
| 3. 验证载体改动在验证哪项能力？ | 不适用 —— 是底座新包，非验证载体改动。 |

**不在范围内**：不进 `core` 依赖（保持引擎精简，与 M6 P1 把 `tools-basic` 外置同一取舍）；不做 MCP 化（外部工具走 `mcp` 包）；不提供 LSP / 语义检索。

## 1. 设计决策（关键取舍）

### 1.1 路径域交给沙箱，工具内只补符号链接

沙箱 `wrap()` 第 3 步已用 `meta.pathArgs` + `isPathAllowed()` 校验，**工具不重复实现域判定**（两处实现必然漂移）。

但 `isPathAllowed()` 走 `path.resolve()`，**不解析符号链接** —— workspace 内一个指向 `/etc` 的 symlink 能通过 `resolve` 检查，随后被真实读取。故工具内对**每一次实际访问**再补一次 `fs.realpath()` 校验（纵深防御，不是替代）。

> 这是「沙箱拦得住声明、拦不住解析后路径」的具体形态；写工具同样受益（写穿 symlink 等效越界写）。

### 1.2 `bash` 的超时必须杀进程树

沙箱的 `withTimeout()` 只是**不再 await** 那个 Promise，被 spawn 的子进程仍在跑 —— 超时后进程变成无人回收的孤儿，且可能继续写文件。`bash` 因此自管超时：`spawn(..., { detached: true })` 拿独立进程组，超时 `process.kill(-pid)` 杀整组，而不是只 kill 直接子进程。

### 1.3 `bash` 不接受 `cwd` 参数

`cwd` 一旦可由模型指定，就成了绕过 `pathArgs` 的越界通道（`cd /etc && cat passwd` 的路径参数是相对路径，`isPathAllowed` 查不出来）。故 **cwd 固定为 workspace，不暴露为参数**。

### 1.4 输出一律截断，且必须显式标记

工具不该把上下文撑爆（M7-6 工具规模治理的延伸）。四类输出都设上限：文件读取限字节、目录列举限条目、搜索限命中数、命令输出限长度。

关键在**被截断时必须返回 `truncated: true` 与实际条数** —— 静默截断会让模型以为"我看完了"，是基于半截信息做决策，比不截断更危险。

### 1.5 `edit_file` 用精确字符串替换，不用行号

模型给行号极易错位（数错、忘了 0/1 基）。要求传入 `old` 片段，**必须唯一**；命中 0 次或多次一律报错并把命中次数回给模型（让它自己收窄），不做"猜一个改掉"。

### 1.6 `kind` 划分

| 工具 | kind | 理由 |
|---|---|---|
| `read_file` / `list_dir` / `glob` / `grep` | `harmless` | 无副作用。越界由路径校验拦，不由 kind 拦（kind 只描述副作用等级）。 |
| `write_file` / `edit_file` | `write` | 沙箱据此产出 `sandbox:write` diff，且 read-only 模式直接拒。 |
| `bash` | `exec` | read-only 模式直接拒（`BLOCKED_IN_READ_ONLY`）。 |

> `grep` / `glob` 的 `pathArgs` 必须**显式声明**（`PATH_KEY` 正则只认 `path/dir/file/...` 结尾的键名，`pattern` 之类不会命中，但也别指望它猜）。

## 2. API 草案

```
packages/tools-code/
  src/index.ts        合集与常量导出
  src/paths.ts        realpath 纵深校验 + 截断工具（内部）
  src/read.ts         read_file
  src/write.ts        write_file / edit_file
  src/search.ts       list_dir / glob / grep
  src/exec.ts         bash
  test/*.test.ts
```

导出：`readFileTool` / `writeFileTool` / `editFileTool` / `listDirTool` / `globTool` / `grepTool` / `bashTool`、集合 `codeTools`、常量 `CODE_TOOL_NAMES`。

## 3. 验收用例

**逐工具正向**：读回预期内容 / 写后可读回 / 编辑后旧串消失新串在且只改一处 / 列举含预期条目 / glob 命中预期模式 / grep 给出行号与命中行 / bash 拿到 stdout 与退出码。

**治理集成（关键，证明"受治理"而非"能跑"）**：

1. `read_file("/etc/passwd")` 经沙箱 → `SandboxViolationError`（`pathArgs` 越界）
2. workspace 内 symlink 指向域外 → 工具内 realpath 校验拒绝
3. read-only 模式下 `write_file` / `bash` → 沙箱直接拒绝，**不弹审批**
4. `write_file` 后 `sandbox:write` 事件带 diff（复用既有机制，非新增）
5. `bash` 跑 `sleep 30` 配 1s 超时 → 超时错误返回，且**子进程确实已死**（断言进程不在）
6. `edit_file` 的 `old` 命中 2 次 → 报错并回 `occurrences: 2`，文件**不被修改**
7. 超大文件读取 → 返回带 `truncated: true`

## 4. 接线清单（新包必做）

- `package.json`（发布包：非 `private`、`publishConfig.access`、`files: ["dist"]`、Apache-2.0）+ `LICENSE` + `tsconfig.json`
- 根 `tsconfig.json` paths 增 `@node-agent-runtime/tools-code`
- 根 `package.json` 的 `build` / `test` 增 `-w @node-agent-runtime/tools-code`
- `scripts/check-api-surface.ts` 的 `PACKAGES` 增条目并冻结基线（`npm run check:api:update`）
- `docs/api-surface.md` 随之更新
- **changeset 随代码一起提交**（M8 整批漏带的教训，见 §13 v1.24）

## 5. 已知风险

- **零外部依赖优先**：`glob` 用 `node:fs` 递归遍历 + 自写匹配，不引 `fast-glob`；`grep` 用逐行匹配，不引 `ripgrep`。理由：底座迄今零运行时依赖，引入依赖要过准入三问第 1 条（会变成每个下游的传递依赖）。
- **二进制文件**：`read_file` 遇二进制（含 NUL 字节）拒绝并明确报错，不返回乱码。
- **`bash` 的能力边界**：不做交互式会话、不做 PTY、不继承宿主环境变量白名单之外的密钥。

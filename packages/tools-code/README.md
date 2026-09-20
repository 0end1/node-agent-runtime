# @node-agent-runtime/tools-code

七件**受治理**的文件与命令工具：`read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` / `bash`。

它们是普通 `ToolDefinition` —— 与手写工具唯一的区别是：承载路径的参数都通过 `meta.pathArgs` 声明了，因此 `LocalSandbox` 能替你守住执行域。

## 用法

```ts
import { createCodeTools } from "@node-agent-runtime/tools-code";

const tools = createCodeTools({ workspace: "/srv/my-agent" });
```

`workspace` 必须显式给：工具的执行上下文里没有 workspace 信息，工具无从得知你声明的域。`createCodeTools()` 不传参时退化为 `process.cwd()`。

也可以只取其中几件：

```ts
import { createReadFileTool, createGrepTool } from "@node-agent-runtime/tools-code";

const read = createReadFileTool({ workspace: "/srv/my-agent" });
```

## 治理行为

| 工具 | kind | read-only 沙箱 | 越界路径 |
|---|---|---|---|
| `read_file` / `list_dir` / `glob` / `grep` | `harmless` | 允许 | 拒绝 |
| `write_file` / `edit_file` | `write` | **拒绝**（不弹审批） | 拒绝 |
| `bash` | `exec` | **拒绝** | cwd 锁定在作用域根 |

`write` 类工具执行后由沙箱产出 `sandbox:write` diff（既有机制，本包不自己做）。

## 两点使用注意

- **`bash` 的超时是硬终止**：默认 30s，超时会杀掉整个进程树（`process.kill(-pid)`），而不只是"不等了"。非 0 退出码**不是异常**，会正常返回 `exitCode`。
- **输出可能被截断**，此时结果里 `truncated: true`。截断上限可用 `limits` 覆盖：

```ts
createCodeTools({ workspace, limits: { readBytes: 50_000, searchHits: 50 } });
```

设计取舍与验收口径见 `docs/m9-tools-code.md`。

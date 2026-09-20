---
"@node-agent-runtime/tools-code": minor
---

M9：新增 `@node-agent-runtime/tools-code`，提供七件**受治理**的文件与命令工具 —— `read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` / `bash`。补上底座自己跑（CLI / Web / 嵌入式接入）时「一个文件工具都没有」的缺口：此前这类能力只在 ACP 客户端侧存在。新增包，全部 API 为 additive，不影响既有包的任何行为。

五条取舍：① **路径域交给沙箱** —— 每个工具用 `meta.pathArgs` 声明承载路径的字段，由 `LocalSandbox` 统一校验，包内不重复实现域判定（两处实现必然漂移）；② **只补沙箱拦不住的一层** —— `isPathAllowed()` 走 `path.resolve()` 不解析 symlink，域内一个指向域外的链接会被真实读写，故工具在访问前再按 `realpath` 拦一次，且**两侧（域根与目标）都归一到真实路径空间**（否则 macOS 的 `/tmp → /private/tmp` 会让域内新建文件被误判越界）；③ **`bash` 的超时必须杀进程树** —— 沙箱的 `withTimeout()` 只是不再 await，子进程仍在跑并可能继续写文件，故 `bash` 以 `detached` 起独立进程组并在超时时 `process.kill(-pid)`（Windows 退 `taskkill /T`）；④ **`bash` 不接受 `cwd` 参数** —— cwd 一旦可由模型指定就成了绕过路径校验的越界通道（`cd /etc && cat passwd` 的参数是相对路径，查不出来），cwd 固定为作用域根；⑤ **输出一律截断且显式标记 `truncated`** —— 静默截断会让模型以为自己看完了，比不截断更危险。

另有三点：`edit_file` 要求 `oldText` 在文件中**唯一**，命中 0 次或多次一律报错且**不改文件**（模型给行号极易错位，猜一个改掉更糟）；`bash` 默认继承的环境变量会剔除凭据类（`*_TOKEN` / `*_KEY` / `*_SECRET` 等），真正需要的由装配方显式注入；`glob` / `grep` 零依赖自实现（依赖会成为每个下游的传递依赖）。

作用域需由装配方显式给出：`ToolExecutionContext` 不含 workspace，工具无从得知宿主声明的域，故 `createCodeTools({ workspace })` 为推荐用法（`codeTools` 默认用 `process.cwd()`）。

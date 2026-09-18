# Cookbook —— 三条主线

M8-1 示例库。三个例子各自独立可跑，跑完就理解这个运行时的三个核心能力：

```bash
npx tsx examples/cookbook/governance.ts   # 治理：审批 + 三档执行模式
npx tsx examples/cookbook/resume.ts       # 续跑：checkpoint + resume
npx tsx examples/cookbook/audit.ts        # 审计：审批留痕 + 导出 + traceId
```

不需要 API Key、不需要联网。

## 为什么用脚本化 provider

`MockProvider` 是**规则式**的（只认计算 / 时间 / 天气 / 汇率），不会调用写工具 —— 用它演示治理，审批与沙箱这两条主链根本跑不起来。所以示例共用 `scripted-provider.ts`：几十行，把模型行为写成固定脚本，可复现。真实项目换成 `OpenAIClientProvider` 即可，宿主代码一行不用改。

| 文件 | 主线 | 你会看到 |
|---|---|---|
| `governance.ts` | 治理 | ① 写工具先要授权，批准了才执行；② 越界路径被拦（生产由沙箱 scope 保证，示例为自包含在工具里做了同样校验）；③ **切 read-only 后策略直接拒绝，连审批都不再弹** —— 模式改变的是策略，不是 UI |
| `resume.ts` | 续跑 | 跑一轮 → 列出该 task 的 checkpoint（消息 + 用量 + 工具指纹）→ 从快照续跑 |
| `audit.ts` | 审计 | 每次授权决策落 `ApprovalRecord`，导出 CSV / JSON；traceId 贯穿一次 run 的所有事件 |

## 两个容易踩的点

- **审批可以在事件里同步批准**：`permission:request` 发出时 waiter 已登记，`manager.approve(event.decisionId)` 立即生效（修复前会等满 `askTimeoutMs` 才按超时拒绝）。
- **审计里没有原始参数**：只有 `argumentsFingerprint`（P3.2/P3.3）—— 审计轨迹不能变成第二份敏感数据，所以 CSV 里 `sessionId` 也是脱敏后的。

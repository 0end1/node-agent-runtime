# Agent Runtime

一个**零第三方运行时依赖**的 TypeScript/Node.js Agent 运行时：提供模型接入层、工具系统、事件总线与**多步推理（ReAct 式）事件循环**。同一套核心即可对接任意 OpenAI 兼容模型服务，也可使用内置的免密钥 Mock Provider 在离线环境完整演示「模型决策 → 工具调用 → 结果回填 → 继续推理 → 最终回答」闭环。

## 快速开始

```bash
npm install
npm run demo:cli     # 交互式终端演示（默认 Mock，免 API Key）
npm run demo:web     # Web 控制台（SSE 实时流），然后打开 http://127.0.0.1:8787
```

接入真实大模型（OpenAI 兼容端点，如 OpenAI / DeepSeek / 通义千问 / Ollama）：

```bash
OPENAI_API_KEY=sk-xxx npm run demo:web                    # OpenAI
OPENAI_BASE_URL=https://api.deepseek.com/v1 OPENAI_API_KEY=sk-xxx OPENAI_MODEL=deepseek-chat npm run demo:web
```

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `ModelProvider` | 模型后端抽象。自带 `OpenAIClientProvider`（fetch 实现）与 `MockProvider`（规则模型，免密钥）。实现该接口即可接入任意 LLM。 |
| `ToolDefinition` | 工具 = 名称 + 描述 + JSON Schema 参数 + `execute()`。参数在本地做类型校验，结果序列化回填给模型。 |
| `Agent` | 系统提示词 + 工具列表 + 步数/温度等运行参数。一个运行时可运行多个 Agent。 |
| `AgentRuntime` | 事件循环核心：`run()` 内循环调用模型，直到无工具调用或达到 `maxSteps`。 |
| `EventBus` | 每个生命周期节点（run / step / model / tool / 错误）都会发事件，便于 CLI、Web、SDK 消费推理过程。 |

运行时主循环：

```
while steps < maxSteps:
    response = provider.chat({ history + agent.instructions + tools })
    if response.toolCalls:
        for each call:
            validate(arguments)          # 本地 JSON Schema 校验
            result = tool.execute(...)   # 执行
            history.push(tool result)    # 回填给模型继续推理
        continue
    else:
        break                            # 模型给出最终回答
```

## 代码示例

```ts
import {
  Agent, AgentRuntime, MockProvider,
  builtinTools, defineTool, type AnyTool,
} from "./src/index.js";

// 1. 模型（免密钥）或 new OpenAIClientProvider({ model: "gpt-4o-mini" })
const runtime = new AgentRuntime({ provider: new MockProvider() });

// 2. 自定义工具
const temperatureTool = defineTool({
  name: "celsius_to_fahrenheit",
  description: "摄氏温度转华氏温度",
  parameters: { type: "object", properties: { c: { type: "number" } }, required: ["c"] },
  execute(args) { return { f: Math.round((args.c * 9) / 5 + 32) }; },
});

// 3. Agent 装配（内置 calculator/now/geocode/weather/exchange 可直接用）
const agent = new Agent({
  name: "assistant",
  tools: [...builtinTools, temperatureTool] as AnyTool[],
  maxSteps: 6,
});

// 4. 订阅事件流（UI/CLI 都从这里拿过程）
runtime.subscribe((e) => console.log(e.type, e));

// 5. 多轮会话：把上一轮 result.messages 作为 history 传入即可
const result = await runtime.run({ agent, input: "把 18°C 转成华氏温度，然后算出它乘以 2 的结果" });
console.log(result.output);   // 最终自然语言答案
```

## 项目结构

```
src/
├── index.ts                 # 公共 API
├── types.ts                 # 消息 / 工具调用等核心类型
├── schema.ts                # JSON Schema 子集校验器（无依赖）
├── tool.ts                  # 工具抽象
├── tools/
│   ├── calculator.ts        # 安全表达式求值（Pratt 解析，不用 eval）
│   └── builtin.ts           # calculator / now / geocode / weather / exchange
├── provider.ts              # ModelProvider 接口 + 错误类型
├── providers/
│   ├── openai-compatible.ts # OpenAI 兼容端点（fetch）
│   └── mock.ts              # 免密钥规则模型（演示/测试）
├── agent.ts                 # Agent 定义
├── events.ts                # 事件总线
└── runtime.ts               # 多步推理事件循环
examples/
├── cli.ts                   # 终端交互演示
└── web/
    ├── server.ts            # SSE 服务器（会话存内存）
    └── public/index.html    # 流式控制台前端
test/                        # node:test 自动化测试
```

## 运行中的事件

| 事件 | 载荷要点 | 含义 |
| --- | --- | --- |
| `run:start` | agentName, input | 一次 run 开始 |
| `message:user` | message | 用户消息已入队 |
| `step:start` | step | 新一轮模型往返开始 |
| `model:response` | message{content, toolCalls} | 模型的决策（文字/工具调用） |
| `tool:start` | toolCall | 开始执行工具 |
| `tool:end` | result, ok, durationMs | 工具执行结果 |
| `run:end` | output, usage, steps | run 完成（output 为最终回答） |
| `run:error` | error | 发生错误（含 Abort） |

## 内置工具

- `calculator` — 安全数学表达式计算（支持 `+ - * / % ^`、括号、小数；Pratt 解析器，绝无 eval）
- `now` — 当前本地时间/日期
- `geocode` — 演示城市经纬度解析
- `weather` — 演示城市天气（确定性伪数据，可复现）
- `exchange` — 参考汇率换算

## 验证

```bash
npm run typecheck   # tsc --noEmit（src + examples + test）
npm test            # node:test，覆盖事件循环/多步推理/工具安全/参数校验/中止
npm run build       # 产出 dist/（供作为库引用）
```

## 目录结构 & 设计取舍

- **零运行时依赖**：HTTP 全部走 Node 18+ 全局 fetch；解析器/校验器自研，无 eval。
- **Mock 免密钥演示**：`MockProvider` 用规则识别「数学 / 时间 / 天气 / 汇率」四类意图并按真实两段式流程（如 geocode → weather）推进，让离线也能看到完整多步推理。
- **前端友好**：运行时不接触 DOM/HTTP，所有过程以事件发布，Web 端通过 SSE 一行行还原。
- **健壮性**：工具参数本地校验失败会回填错误让模型自纠；未知工具 / 工具抛异常 / 模型调用中止均有明确事件与错误传播；`maxSteps` 上限防止死循环。

> 提示：Web 服务器把会话记录保存在内存（`Map`），重启即清空；多端隔离可使用不同 `session` 参数。

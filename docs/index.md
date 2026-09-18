---
layout: home

hero:
  name: Node Agent Runtime
  text: 受治理 · 可续跑 · 可审计
  tagline: 零依赖的 TypeScript / Node.js Agent 运行时 —— 把工具执行的边界、授权与留痕交给运行时，而不是交给模型自觉。
  actions:
    - theme: brand
      text: 5 分钟上手
      link: /#三步跑通
    - theme: alt
      text: 架构总览
      link: /architecture
  image:
    src: /logo.svg
    alt: Node Agent Runtime

features:
  - icon: 🛡️
    title: 受治理
    details: 三档执行模式（read-only / workspace-write / full-access）× 最小权限策略；写类与 exec 类工具默认要授权，授权决策可持久化成 grant。
    link: /architecture
  - icon: 🔁
    title: 可续跑
    details: 每完成一步落一个 checkpoint（消息 + 用量 + 工具指纹），重启后从快照续跑，输出与一次性跑完等价。
  - icon: 🧾
    title: 可审计
    details: 每次授权决策落 ApprovalRecord（含决策人与参数**指纹**），可导出 CSV / JSON；traceId 贯穿一次 run 的所有事件。
    link: /api-surface
---

## 三步跑通

```bash
npx create-node-agent-runtime my-agent   # ① 生成第一个受治理 Agent 项目
cd my-agent && npm install
npm start                                # ② 默认 MockProvider，无需 API Key
```

③ 换真实模型：`npm i @node-agent-runtime/provider-openai`，然后把 `src/main.ts` 里的 `MockProvider` 换成 `OpenAIClientProvider`（读 `OPENAI_API_KEY`）—— 宿主代码一行不用改。

生成的项目里已经把三条主链接好：最小权限策略 + 锁定沙箱域、授权与沙箱写入事件订阅、`FileStorage` 落盘。

## 装哪些包

| 你想干什么 | 装什么 |
|---|---|
| 引擎 + 契约 | `@node-agent-runtime/core` `@node-agent-runtime/types` |
| 会话编排（多轮、续跑、审计） | `@node-agent-runtime/host` |
| 真实模型 | `@node-agent-runtime/provider-openai` |
| SQLite 存储 | `@node-agent-runtime/store-sqlite` |
| 把底座暴露为 ACP agent | `@node-agent-runtime/acp` |

细节见仓库 [README](https://github.com/0end1/node-agent-runtime#readme)（安装、包清单、目录结构）。

## 三份值得先看的文档

- [**架构总览**](/architecture) —— 12 层架构、消息流水线、治理模型与配置参考
- [**公共 API 快照**](/api-surface) —— 每个包导出什么、多少符号，以及**变更规则**（快照受 CI 门禁）
- [**ACP 适配**](/m8-acp-adapter) —— 如何把底座接到 Zed / DeepChat 这类 ACP Client

> 本站点由仓库 `docs/` 直接生成（单一事实源）：改 markdown 即改站点，没有第二份副本。

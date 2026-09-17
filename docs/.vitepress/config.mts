import { defineConfig } from "vitepress";

/**
 * 文档站配置 —— 源码即仓库 `docs/`（单一事实源）。
 *
 * 取舍：
 * - **不复制一份 markdown 到 site/**：文档一改就得同步两处，必然漂移。
 *   VitePress 以 `docs` 为 srcDir，`.vitepress` 放在其中即可。
 * - **`ignoreDeadLinks: true`**：`docs/` 里存在指向仓库内其他位置（如根
 *   README）的相对链接，那些路径在站点里并不存在；内部执行文档的链接也常
 *   指向尚未成文的位置。让构建因它们失败，只会逼人去改文档正文。
 * - 站点**不进 CI**：文档构建不阻塞代码质量门，`npm run docs:build` 由人
 *   在发布前跑一次即可。
 */
export default defineConfig({
  title: "Node Agent Runtime",
  description: "受治理、可续跑、可审计的 TypeScript / Node.js Agent 运行时",
  lang: "zh-CN",
  srcDir: ".",
  cleanUrls: true,
  ignoreDeadLinks: true,
  head: [["meta", { name: "theme-color", content: "#3c7afe" }]],

  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "架构", link: "/architecture" },
      { text: "API 快照", link: "/api-surface" },
      { text: "ACP 适配", link: "/m8-acp-adapter" },
      {
        text: "更多",
        items: [
          { text: "底座收敛", link: "/base-convergence" },
          { text: "产品方向", link: "/product-direction" },
          { text: "形态路径", link: "/product-build-paths" },
          { text: "ACP 规范核对", link: "/acp-spec-review" },
        ],
      },
    ],

    sidebar: {
      "/": [
        {
          text: "开始",
          items: [{ text: "概览与 5 分钟上手", link: "/" }],
        },
        {
          text: "架构",
          items: [
            { text: "架构总览", link: "/architecture" },
            { text: "底座收敛", link: "/base-convergence" },
            { text: "公共 API 快照", link: "/api-surface" },
          ],
        },
        {
          text: "产品",
          items: [
            { text: "产品方向", link: "/product-direction" },
            { text: "形态路径", link: "/product-build-paths" },
          ],
        },
        {
          text: "协议与集成",
          items: [
            { text: "ACP 适配执行清单", link: "/m8-acp-adapter" },
            { text: "ACP v1 规范核对", link: "/acp-spec-review" },
          ],
        },
        {
          text: "项目内部（研发用）",
          collapsed: true,
          items: [
            { text: "开发清单", link: "/development-checklist" },
            { text: "历史归档", link: "/historical/remaining-tasks" },
          ],
        },
      ],
    },

    outline: { level: [2, 3], label: "本页目录" },
    search: { provider: "local" },
    docFooter: { prev: "上一页", next: "下一页" },
    lastUpdated: { text: "最后更新于" },

    socialLinks: [{ icon: "github", link: "https://github.com/0end1/node-agent-runtime" }],

    footer: {
      message: "文档源即仓库 docs/ —— 改 markdown 即改站点。",
      copyright: "Copyright © 2026 · Apache-2.0",
    },

    editLink: {
      pattern: "https://github.com/0end1/node-agent-runtime/edit/dev/docs/:path",
      text: "在 GitHub 上改进此页",
    },
  },
});

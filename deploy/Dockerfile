# P5.6 · Web 部署形态：多阶段构建，运行时镜像只含产物与必要依赖。
#
# 在**仓库根目录**执行：
#   docker build -f deploy/Dockerfile -t node-agent-runtime/console:0.2.0 .
#   docker run --rm -p 8787:8787 --env-file deploy/env/prod.env.example node-agent-runtime/console:0.2.0
#
# 说明：控制台以 `tsx` 直接运行 TS 源码（与 `npm run demo:web` 一致）；
# 若需纯 JS 启动，可在 build 阶段把 examples 一并 tsc 输出后改 CMD。

# ------------------------------- build -------------------------------
FROM node:22.22.1-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts

COPY tsconfig.base.json tsconfig.json ./
COPY examples ./examples
RUN npm run build

# ------------------------------ runtime ------------------------------
FROM node:22.22.1-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    AGENT_LOG_LEVEL=info
WORKDIR /app

RUN npm i -g tsx@4 --no-fund --no-audit

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/examples ./examples
RUN mkdir -p .runtime-data

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 非 root 运行
RUN useradd -r -u 10001 agent && chown -R agent:agent /app
USER agent

CMD ["tsx", "examples/web/server.ts"]

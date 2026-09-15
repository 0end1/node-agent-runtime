# 部署样例（P5.5 / P5.6）

Web 控制台（SSE 实时流）的三种部署形态样例与运维说明。所有命令均在**仓库根目录**执行。

```
deploy/
├── Dockerfile                     # 多阶段构建：build 阶段装依赖并构建 dist，runtime 只带产物
├── docker-compose.yml             # console（+ 可选 nginx 边缘反代，profile: edge）
├── nginx/node-agent-runtime.conf       # 反代样例（含 SSE 必需的 proxy_buffering off）
├── systemd/node-agent-runtime.service  # systemd 单元（最小权限 + 自动重启）
├── env/                           # 环境分层样例：dev / staging / prod
│   ├── dev.env.example
│   ├── staging.env.example
│   └── prod.env.example
└── README.md                      # 本文件
```

## 1. Docker Compose（推荐）

```bash
cp deploy/env/prod.env.example deploy/env/prod.env   # 填入真实值（勿提交）
docker compose -f deploy/docker-compose.yml up -d --build
curl -fsS http://127.0.0.1:8787/healthz     # → {"ok":true}
```

需要对外提供 HTTPS 时启用边缘反代（把证书放到 `deploy/certs/`）：

```bash
docker compose -f deploy/docker-compose.yml --profile edge up -d
```

约定：控制台容器监听 `0.0.0.0:8787`，宿主只映射 `127.0.0.1:8787`；对外一律经 nginx 终止 TLS。

## 2. systemd + nginx（裸机）

```bash
sudo useradd -r -s /usr/sbin/nologin agent
sudo mkdir -p /opt/node-agent-runtime /etc/node-agent-runtime
# 部署仓库（含 packages/*/dist，先在本地 `npm ci && npm run build`）
sudo rsync -a --exclude node_modules ./ /opt/node-agent-runtime/
cd /opt/node-agent-runtime && sudo npm ci --omit=dev

sudo install -m 600 deploy/env/prod.env.example /etc/node-agent-runtime/console.env
sudo install -m 644 deploy/systemd/node-agent-runtime.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now node-agent-runtime

sudo cp deploy/nginx/node-agent-runtime.conf /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx
```

## 3. 本地（开发/验证）

```bash
cp deploy/env/dev.env.example .env
npm run demo:web                  # http://127.0.0.1:8787
npm run smoke:web                 # 启动 + /healthz 探活 + 退出
```

## 4. 环境分层

| 变量 | dev | staging / prod | 说明 |
| --- | --- | --- | --- |
| `HOST` | `127.0.0.1` | `0.0.0.0` | 非 loopback 监听必须配 `AGENT_API_TOKEN`，否则拒绝启动（P3.5） |
| `AGENT_API_TOKEN` | 不设 | 必设 | Bearer 鉴权 |
| `AGENT_CORS_ALLOW_ORIGINS` | 不设 | 显式白名单 | 跨站请求按白名单放行，其余 403 |
| `AGENT_LOG_LEVEL` | `debug` | `info` / `warn` | 日志级别 |
| `AGENT_SANDBOX_NETWORK` | `deny` | `deny`（或 `allowlist` + 域名） | 沙箱网络（P3.7） |
| `AGENT_LIMIT_*`、`AGENT_RATE_TOOL_*` | 不设 | 建议设 | 运行预算，超限产 `run:error`（P3.4） |
| `AGENT_MCP_HTTP_ALLOWLIST` | 不设 | 使用 MCP 时必设 | 端点白名单，逐跳校验重定向（P3.6） |

完整变量表见仓库根 `README.md`「生产用法」节与 `docs/m6-productionization.md` §3。

## 5. 数据持久化与备份恢复（P5.5）

会话、任务、消息流与产物默认落在 `RUNTIME_DATA`（默认 `.runtime-data/`），容器部署时挂到命名卷 `runtime-data`。

使用 SQLite 后端（`@node-agent-runtime/store-sqlite`）时：

- **WAL**：连接自动开启 `journal_mode=WAL` 与 `synchronous=NORMAL`，读写不互相阻塞。
- **在线备份**：`SQLiteStorage.backup(dest)` 基于 `VACUUM INTO`，无需停服，且拒绝覆盖已有文件。

  ```ts
  import { SQLiteStorage } from "@node-agent-runtime/store-sqlite";

  const storage = new SQLiteStorage({ file: ".runtime-data/app.db" });
  storage.backup(`.runtime-data/backup-${Date.now()}.db`);   // 一致性快照
  ```

  命令行等价物（可放进 crontab）：

  ```bash
  sqlite3 .runtime-data/app.db "VACUUM INTO '.runtime-data/backup-$(date +%F).db'"
  ```

- **恢复**：停服 → 用备份文件替换 `app.db`（同时删除 `app.db-wal` / `app.db-shm`）→ 启动。启动会自动补齐 schema 迁移。
- **迁移**：schema 版本记录在 `PRAGMA user_version`（当前 2），每次打开自动应用缺失迁移，脚本幂等可重复执行；若数据库版本高于程序支持版本会直接报错而不是 silently 破坏数据。

## 6. 探活与冒烟

| 手段 | 位置 | 说明 |
| --- | --- | --- |
| `GET /healthz` | 控制台内置 | 返回 `{"ok":true}`，不经鉴权、不记敏感信息 |
| Docker `HEALTHCHECK` | `deploy/Dockerfile` | 30s 间隔探测 `/healthz` |
| `npm run smoke:web` | `scripts/smoke-web.mjs` | 启动 → 轮询探活 → 关闭；容器内亦可运行，用于验收"容器启动后 :8787 探活通过" |

## 7. 生产检查清单

- [ ] `AGENT_API_TOKEN` 已设置且足够随机；`AGENT_CORS_ALLOW_ORIGINS` 只列可信来源
- [ ] 控制台不直接暴露公网（nginx 终止 TLS，转发时保留 `X-Forwarded-*`）
- [ ] nginx 已关闭 SSE 缓冲（`proxy_buffering off` + `proxy_read_timeout` 放宽）
- [ ] 沙箱为 `deny`（或最小 `allowlist`），Agent 使用 `createProductionDefaults` 最小权限策略
- [ ] 已设置运行预算 `AGENT_LIMIT_*` 与工具速率
- [ ] 使用 MCP 时配置 `AGENT_MCP_HTTP_ALLOWLIST`
- [ ] 数据目录在持久化卷上，备份任务已排期并验证可恢复
- [ ] 以非 root 运行（镜像内 `agent` 用户 / systemd `User=agent`）

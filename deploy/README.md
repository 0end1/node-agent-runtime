# 部署样例（P5.5 / P5.6）

Web 控制台（SSE 实时流）的三种部署形态样例与运维说明。所有命令均在**仓库根目录**执行。

```
deploy/
├── Dockerfile                     # 多阶段构建：build 阶段装依赖并构建 dist，runtime 只带产物
├── docker-compose.yml             # console（+ 可选 nginx 边缘反代，profile: edge）
├── helm/node-agent-runtime/       # K8s 形态（M8-5）：Chart + values + templates
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

## 7. Kubernetes（Helm）

Chart 在 `deploy/helm/node-agent-runtime/`，**复用同一个 Dockerfile**（多阶段构建、非 root、`/healthz` 探活），只是把编排换成 K8s 对象。

### 7.1 构建并推送镜像

```bash
docker build -f deploy/Dockerfile -t <registry>/node-agent-runtime/console:0.2.0 .
docker push  <registry>/node-agent-runtime/console:0.2.0
```

### 7.2 安装

```bash
# 密钥先落集群 —— 不要写进 values：values 会进 Git，也会出现在 helm get values 里
kubectl create ns agent
kubectl -n agent create secret generic node-agent-runtime \
  --from-literal=AGENT_API_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=OPENAI_API_KEY="sk-..."

helm upgrade --install console deploy/helm/node-agent-runtime \
  -n agent --create-namespace \
  --set existingSecret=node-agent-runtime \
  --set image.repository=<registry>/node-agent-runtime/console \
  --set image.tag=0.2.0 \
  --set config.AGENT_CORS_ALLOW_ORIGINS=https://console.example.com \
  --wait --atomic
```

```bash
kubectl -n agent get pods,svc
kubectl -n agent port-forward svc/console 8787:8787
curl -fsS http://127.0.0.1:8787/healthz          # → {"ok":true}
```

不连集群也能自检模板：

```bash
helm lint    deploy/helm/node-agent-runtime
helm template console deploy/helm/node-agent-runtime -n agent --set existingSecret=node-agent-runtime
```

### 7.3 对外暴露（Ingress）

```bash
helm upgrade console deploy/helm/node-agent-runtime -n agent \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=console.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix \
  --set ingress.tls[0].secretName=console-tls \
  --set ingress.tls[0].hosts[0]=console.example.com
```

Ingress 注解已默认带上 `proxy-buffering: "off"` 与放宽的 `proxy-read-timeout` —— **SSE 必需**（与 `deploy/nginx/` 同口径），否则增量被攒着不发。

### 7.4 设计取舍

| 决策 | 取值 | 为什么 |
| --- | --- | --- |
| 副本数 | `replicaCount: 1` | SQLite 是**本机文件**存储，多副本会各写各的库 —— 会话与审批审计直接串台。要多副本请先外部化存储 |
| 发布策略 | `strategy: Recreate` | `ReadWriteOnce` 卷不能被新旧 Pod 同时挂载，RollingUpdate 会卡在等旧 Pod 释放卷 |
| 配置变更生效 | `checksum/config` 注解 | 少了它，改完 ConfigMap 而 Pod 不重启 —— "我以为生效了"是最难查的一类事故 |
| 密钥来源 | `existingSecret` 或 `--set-string` | values 会进 Git、会进 `helm get values`（而那份输出常被贴进工单） |
| 根文件系统 | `readOnlyRootFilesystem: true` + `/tmp` 内存盘 | 容器里可被写入的面更小 |
| 数据卷 | `helm.sh/resource-policy: keep` | 删 release 不删数据 —— 否则"回滚"无从谈起 |
| ServiceAccount | `automountServiceAccountToken: false` | 控制台不调 K8s API，不必白送一条横向移动的通路 |
| 探活 | `/healthz`（liveness + readiness） | 不经鉴权、不记敏感信息，与 Dockerfile `HEALTHCHECK` 同一端点 |
| 沙箱/预算 | 沿用 `prod.env.example` | 禁网 + `AGENT_LIMIT_*`，K8s 形态不放松任何一条生产约定 |

## 8. 升级与回滚

**核心事实：代码可回滚，数据未必。** schema 迁移只前进（`PRAGMA user_version`，当前 2，启动自动应用），把镜像退回旧版本时，若新版本已把库升上去，旧程序会**直接报错拒绝启动**而不是静默破坏数据（见 §5）。所以顺序固定：**先备份 → 再升级；先回滚代码 → 必要时才恢复数据**。

### 8.1 升级

```bash
# 1) 在线备份（VACUUM INTO，无需停服）
kubectl -n agent exec deploy/console -- \
  sqlite3 "$RUNTIME_DATA/app.db" "VACUUM INTO '$RUNTIME_DATA/backup-$(date +%F).db'"

# 2) 只改镜像 tag
helm upgrade console deploy/helm/node-agent-runtime -n agent \
  --set image.tag=0.3.0 --wait --atomic --timeout 5m
```

`--atomic`：失败自动回滚到上一个 revision，不留半吊子状态。`--wait`：等 rollout 结束再返回，CI 里别省。

### 8.2 回滚

```bash
helm history console -n agent              # 找目标 REVISION
helm rollback console 2 -n agent --wait
kubectl -n agent rollout status deploy/console
```

### 8.3 回滚后起不来（schema 已升上去）

1. 先确认是数据问题而不是配置问题：`kubectl -n agent logs deploy/console --previous`
2. 停 Pod（**必须**，否则边写边换库）：`kubectl -n agent scale deploy/console --replicas=0`
3. 在数据卷里把 `app.db` 换成备份文件，并删除 `app.db-wal` / `app.db-shm`
4. 起回来：`kubectl -n agent scale deploy/console --replicas=1`

> 建议在 staging 用同一份 values 演练一遍「升级 → 回滚 → 恢复数据」并记下耗时。真出事时，**第一次跑演练就是事故本身**。

## 9. 生产检查清单

- [ ] `AGENT_API_TOKEN` 已设置且足够随机；`AGENT_CORS_ALLOW_ORIGINS` 只列可信来源
- [ ] 控制台不直接暴露公网（nginx 终止 TLS，转发时保留 `X-Forwarded-*`）
- [ ] nginx 已关闭 SSE 缓冲（`proxy_buffering off` + `proxy_read_timeout` 放宽）
- [ ] 沙箱为 `deny`（或最小 `allowlist`），Agent 使用 `createProductionDefaults` 最小权限策略
- [ ] 已设置运行预算 `AGENT_LIMIT_*` 与工具速率
- [ ] 使用 MCP 时配置 `AGENT_MCP_HTTP_ALLOWLIST`
- [ ] 数据目录在持久化卷上，备份任务已排期并验证可恢复
- [ ] 以非 root 运行（镜像内 `agent` 用户 / systemd `User=agent`）

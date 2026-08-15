# 部署指南（Docker）

用 Docker 一键部署 StudyMate Agent（Web + REST API + 备考闭环）。

> ⚠️ **先读安全章节**：本项目保存个人学习数据（资料、成绩、错题、搭子对话）。
> 默认配置只监听宿主机回环地址（`127.0.0.1:3456`），适合本机使用。
> **直接暴露到公网 VPS 前，必须完成「公网部署安全清单」，否则你的学习数据会对全网开放读写。**

## 前置

- Docker 20.10+ 与 Docker Compose v2

## 构建与启动（本机使用）

```bash
docker compose up -d --build
```

- 服务启动在 **http://localhost:3456**（宿主机只绑定 `127.0.0.1`，局域网内其他设备无法访问）
- `workspace/` 目录以卷挂载，容器重启/重建不丢数据
- 容器内服务绑定 `0.0.0.0`（端口映射必需），暴露面由宿主机端口绑定控制

## 公网 / VPS 部署安全清单（必做）

StudyMate 默认不含多用户体系，个人数据防护依赖以下配置：

1. **启用访问 Token**：在 `.env` 中设置

   ```env
   STUDYMATE_ACCESS_TOKEN=<长随机字符串>
   ```

   设置后所有 `/api/*` 请求需要认证（`Authorization: Bearer <token>`、`X-Access-Token` 头或 `studymate_token` Cookie 任一方式，**不支持 URL 查询参数**——Token 不应进入 URL/访问日志）。未认证请求一律 `401`，无法读取考试数据、薄弱点、搭子历史或修改计划。Web 前端收到 401 时会弹出令牌输入门禁，令牌仅存浏览器会话（sessionStorage），关闭标签页即失效。

2. **HTTPS 反向代理**：用 Caddy / Nginx + Let's Encrypt 终结 TLS，仅将 `127.0.0.1:3456` 反代到公网 443。Token 走明文 HTTP 会被中间人截获。

3. **限制绑定面**：确需局域网访问时把 `docker-compose.yml` 的 ports 改为 `"3456:3456"`；配合防火墙只放行可信网段。

4. **限制 CORS**（可选）：如有跨域前端，设置 `ALLOWED_ORIGINS=https://你的域名`（逗号分隔）。默认同源访问、不下发 CORS 头。

5. **速率限制**（可选）：`RATE_LIMIT_PER_MINUTE=300`（默认），按需收紧。

6. **密钥卫生**：
   - `OPENAI_API_KEY` / `SERP_API_KEY` / `STUDYMATE_ACCESS_TOKEN` 只放 `.env`（已 gitignore），不写入命令行历史或事件日志；
   - 事件日志与错误响应不会记录这些密钥；
   - 定期备份 `./workspace/`（见下），泄漏时第一时间轮换 Token 与 API Key。

### Caddy 反代示例

```Caddyfile
studymate.example.com {
    reverse_proxy 127.0.0.1:3456
}
```

## 生成示例数据（首次可选）

```bash
docker compose exec studymate npm run demo
```

生成 CPA 会计演示数据（已有数据自动备份到容器内 `workspace_pre_demo.bak`），即可体验完整闭环。

## 配置真实 LLM（可选）

在 `docker-compose.yml` 同级建 `.env`：

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
SERP_API_KEY=...   # 可选，备考调研搜索；不配置时 Web 建档跳过调研、引导上传本地资料
STUDYMATE_ACCESS_TOKEN=...   # 公网部署必配
```

然后 `docker compose up -d` 重启生效。不配置 LLM Key 则走 Mock 模式（完整可用、离线，事件日志中 model 标记为 `mock-llm`）。

## 数据与备份

- 全部数据在宿主机 `./workspace/`（考试项目、资料切片、概念图、计划、掌握度、错题、搭子状态、事件日志）
- 备份：直接复制/打包 `./workspace/` 目录即可
- 删除数据：删除 `./workspace/`（删除后重启服务即全新）
- 事件日志 `workspace/event_log/events.jsonl` 是 append-only **审计日志**，不支持从事件重放恢复状态；恢复以 `workspace/` 目录整体备份为准

## 常见问题

| 问题 | 处理 |
|---|---|
| 端口被占 | 修改 `docker-compose.yml` 的 `ports: "127.0.0.1:3456:3456"` 左侧为其他端口 |
| 局域网/外网访问不了 | 默认只绑定本机；按「公网部署安全清单」修改 ports 并配置 Token + HTTPS |
| 前端空白 | 确认 `web/dist` 已构建进镜像（Dockerfile 前端阶段） |
| 想用真实数据 | 把本地 `workspace/` 拷到项目根（`docker compose` 挂载的就是它） |
| API 全部 401 | 你设置了 `STUDYMATE_ACCESS_TOKEN`——请求需携带 Token（见上） |

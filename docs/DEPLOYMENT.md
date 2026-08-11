# 部署指南（Docker）

用 Docker 一键部署 StudyMate Agent（Web + REST API + 备考闭环），适合 VPS 或本地演示。

## 前置

- Docker 20.10+ 与 Docker Compose v2

## 构建与启动

```bash
docker compose up -d --build
```

- 服务启动在 **http://localhost:3456**
- `workspace/` 目录以卷挂载，容器重启/重建不丢数据

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
SERP_API_KEY=...   # 可选，备考调研搜索
```

然后 `docker compose up -d` 重启生效。不配置则走 Mock 模式（完整可用、离线）。

## 数据与备份

- 全部数据在宿主机 `./workspace/`（考试项目、资料切片、概念图、计划、掌握度、错题、搭子状态、事件日志）
- 备份：直接复制/打包 `./workspace/` 目录即可
- 删除数据：删除 `./workspace/`（删除后重启服务即全新）

## 常见问题

| 问题 | 处理 |
|---|---|
| 端口被占 | 修改 `docker-compose.yml` 的 `ports: "3456:3456"` 左侧为其他端口 |
| 前端空白 | 确认 `web/dist` 已构建进镜像（Dockerfile 前端阶段） |
| 想用真实数据 | 把本地 `workspace/` 拷到项目根（`docker compose` 挂载的就是它） |

import express from 'express';
import { createApp } from '../src/server/app.js';
import { initWorkspace } from '../src/core/workspace.js';

// Vercel Serverless 函数的文件系统只读，仅 /tmp 可写。
// workspace 数据为实例级临时存储：同一热实例内持续存在，冷启动后重置。
const workspaceRoot = process.env.STUDYMATE_WORKSPACE_ROOT ?? '/tmp/workspace';

const workspaceReady = initWorkspace(workspaceRoot);

const api = createApp({ workspaceRoot });

// 外层先等 workspace 目录建好，再进入业务路由
const handler = express();
handler.use((_req, _res, next) => {
  void workspaceReady.then(() => next(), next);
});
handler.use(api);

export default handler;

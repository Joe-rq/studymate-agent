import { createApp } from './app.js';
import path from 'path';
import fs from 'fs';
import express from 'express';

const PORT = parseInt(process.env.PORT ?? '3456', 10);
// 默认只绑定本机回环地址：个人学习数据不经配置不暴露到局域网/公网。
// 需要 LAN/容器外访问时显式设置 HOST=0.0.0.0（务必配合 STUDYMATE_ACCESS_TOKEN 与 HTTPS 反代）。
const HOST = process.env.HOST ?? '127.0.0.1';
const app = createApp();

// Serve Web UI static files in production
const webDist = path.join(process.cwd(), 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback: serve index.html for non-API routes
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && req.method === 'GET') {
      res.sendFile(path.join(webDist, 'index.html'));
    } else {
      next();
    }
  });
}

app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`StudyMate server listening on http://${displayHost}:${PORT} (bind: ${HOST})`);
  if (HOST === '0.0.0.0') {
    console.log(
      '⚠️  服务已绑定到所有网络接口。公网/LAN 部署请务必：\n' +
        '   1. 设置 STUDYMATE_ACCESS_TOKEN 启用访问认证；\n' +
        '   2. 使用 HTTPS 反向代理；\n' +
        '   3. 按需配置 ALLOWED_ORIGINS 限制 CORS。'
    );
    if (!process.env.STUDYMATE_ACCESS_TOKEN) {
      console.log('❌ 当前未设置 STUDYMATE_ACCESS_TOKEN，API 将对网络内所有设备开放读写！');
    }
  }
  if (!fs.existsSync(webDist)) {
    console.log('Web UI not built yet. Run: cd web && npm run build');
    console.log('Or start dev server: cd web && npm run dev');
  }
});

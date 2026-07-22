import { createApp } from './app.js';
import path from 'path';
import fs from 'fs';
import express from 'express';

const PORT = parseInt(process.env.PORT ?? '3456', 10);
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

app.listen(PORT, () => {
  console.log(`StudyMate server running at http://localhost:${PORT}`);
  if (!fs.existsSync(webDist)) {
    console.log(`Web UI not built yet. Run: cd web && npm run build`);
    console.log(`Or start dev server: cd web && npm run dev`);
  }
});

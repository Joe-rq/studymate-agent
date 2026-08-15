/**
 * 对 StudyMate Web UI 各页面做 fullPage 高清截图（用于演示视频）。
 *
 * 前置：server 已在 127.0.0.1:3456 运行（npm run serve / node dist/server/index.js）
 * 用法：node scripts/capture-demo-pages.mjs [输出目录，默认 screenshots/demo_v3/pages]
 *
 * 使用 playwright-core + 系统 Edge（channel: 'msedge'），无需下载浏览器。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const flags = process.argv.slice(2);
const posArg = flags.find((a, i) => !a.startsWith('--') && flags[i - 1] !== '--only');
const OUT = path.resolve(posArg ?? path.join(__dirname, '..', 'screenshots', 'demo_v3', 'pages'));
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3456';

const PAGES = [
  { name: 'home', path: '/', dark: false },
  { name: 'tasks', path: '/tasks', dark: false },
  { name: 'studio', path: '/studio', dark: false },
  { name: 'quiz', path: '/quiz', dark: false },
  { name: 'growth', path: '/growth', dark: false },
  { name: 'chat', path: '/chat', dark: false },
  { name: 'plan', path: '/plan', dark: false },
  { name: 'settings', path: '/settings', dark: false },
  { name: 'home_dark', path: '/', dark: true },
];

// 可选：逗号分隔的名称过滤，如 node scripts/capture-demo-pages.mjs --only growth,home
const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;
const targets = ONLY ? PAGES.filter((p) => ONLY.has(p.name)) : PAGES;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
});

for (const p of targets) {
  const page = await context.newPage();
  if (p.dark) {
    await page.addInitScript(() => localStorage.setItem('studymate-theme', 'dark'));
  } else {
    await page.addInitScript(() => localStorage.setItem('studymate-theme', 'light'));
  }
  await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    /* SPA 轮询会阻止 networkidle，超时即可继续 */
  }
  await page.waitForTimeout(1200); // 等 React 渲染与进场动画稳定
  const file = path.join(OUT, `${p.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  console.log(`${p.name}: ${width}x${height} -> ${file}`);
  await page.close();
}

await browser.close();
console.log('done');

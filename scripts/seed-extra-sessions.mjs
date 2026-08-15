/**
 * 为 demo 数据补 6 天学习闭环记录（workspace/progress/session_history.jsonl），
 * 让 Growth 页趋势图与首页「今日学习时长」展示真实感数据。
 *
 * 前置：npm run demo 已生成 CPA 概念数据（node_1..node_4）。
 * 用法：node scripts/seed-extra-sessions.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'workspace', 'progress', 'session_history.jsonl');

const days = [
  { offset: 5, node: 'node_1', name: '会计基本假设', dur: 1500, q: 5, c: 3, acc: 0.6, score: 60, mOld: 0.0, mNew: 0.25 },
  { offset: 4, node: 'node_2', name: '复式记账原理', dur: 1800, q: 5, c: 3, acc: 0.6, score: 62, mOld: 0.1, mNew: 0.35 },
  { offset: 3, node: 'node_3', name: '收入确认', dur: 2100, q: 5, c: 4, acc: 0.8, score: 78, mOld: 0.2, mNew: 0.45 },
  { offset: 2, node: 'node_4', name: '期间费用', dur: 1650, q: 5, c: 4, acc: 0.8, score: 80, mOld: 0.3, mNew: 0.55 },
  { offset: 1, node: 'node_1', name: '会计基本假设', dur: 1200, q: 5, c: 5, acc: 1.0, score: 95, mOld: 0.4, mNew: 0.65 },
  { offset: 0, node: 'node_2', name: '复式记账原理', dur: 1380, q: 5, c: 4, acc: 0.8, score: 84, mOld: 0.5, mNew: 0.68 },
];

const iso = (d) => d.toISOString().slice(0, 10);
const lines = days.map((r, i) => {
  const day = new Date(Date.now() - r.offset * 24 * 3600 * 1000);
  const date = iso(day);
  const end = new Date(day.getTime() + r.dur * 1000);
  return JSON.stringify({
    sessionId: `demo_sess_${i + 1}`,
    date,
    startedAt: day.toISOString(),
    endedAt: end.toISOString(),
    taskType: i % 2 === 0 ? 'learn' : 'review',
    nodeId: r.node,
    nodeName: r.name,
    durationSeconds: r.dur,
    knowledgePoints: 3 + (i % 2),
    answeredQuestions: r.q,
    correct: r.c,
    accuracy: r.acc,
    score: r.score,
    masteryDeltaSum: +(r.mNew - r.mOld).toFixed(2),
    masteryChanges: [{ nodeId: r.node, nodeName: r.name, oldMastery: r.mOld, newMastery: r.mNew }],
  });
});

fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, lines.join('\n') + '\n');
console.log(`seeded ${lines.length} session records -> ${path.relative(process.cwd(), FILE)}`);
